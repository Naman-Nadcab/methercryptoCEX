import crypto from 'node:crypto';
import fs from 'node:fs';
import { FastifyInstance } from 'fastify';
import type { MultipartFile } from '@fastify/multipart';
import { db } from '../lib/database.js';
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';
import { p2pService } from '../services/p2p.service.js';
import { evaluateP2PRisk } from '../services/abuse-resilience.service.js';
import { recordAndEvaluate } from '../services/aml-transaction-monitor.service.js';
import { assertKycAllowed, KycRequiredError, KycPendingError } from '../services/kyc-enforcement.service.js';
import { checkSanctions } from '../services/sanctions-screening.service.js';
import { getCurrencyIdBySymbol, getTokenIdsByCurrencyId } from '../lib/currency-resolver.js';
import { rateLimitByUser } from '../lib/rate-limit-fastify.js';
import { P2PAdType, P2PAdStatus, P2PPriceType } from '../types/index.js';
import { config } from '../config/index.js';
import {
  getP2PReferencePrice,
  getP2PReferencePriceDecimal,
  applyFloatingMargin,
} from '../services/p2p-reference-price.service.js';
import {
  bumpP2PAdsListCacheGen,
  fingerprintP2PAdsQuery,
  getP2PAdsCacheGeneration,
} from '../services/p2p-ads-cache.service.js';
import { publishP2POrderRoom } from '../services/p2p-ws-publish.service.js';
import {
  saveP2pPaymentProofFromMultipart,
  isSecureProofRef,
  secureProofFilenameFromRef,
  resolveSecureProofAbsolutePath,
} from '../lib/p2p-payment-proof.js';

function getRequestIp(request: { ip?: string; headers: Record<string, string | string[] | undefined> }): string | undefined {
  const ip = (request as { ip?: string }).ip ?? request.headers['x-forwarded-for'];
  if (typeof ip === 'string') return ip.split(',')[0]?.trim();
  if (Array.isArray(ip) && ip[0]) return String(ip[0]).split(',')[0]?.trim();
  return undefined;
}

const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';
/** Idempotency cache TTLs capped for memory safety; keys always expire. */
const P2P_ORDER_CREATE_IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;
const P2P_RELEASE_IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;
const P2P_CONFIRM_IDEMPOTENCY_TTL_SECONDS = 60 * 60;   // 1h
const P2P_CANCEL_IDEMPOTENCY_TTL_SECONDS = 60 * 60;    // 1h
const P2P_IDEMPOTENCY_LOCK_TTL_SECONDS = 30;
const P2P_ORDER_COOLDOWN_SECONDS = 3;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** `p2p_ads.crypto_currency_id` + currencies join (new); else legacy `token_id` + tokens join. */
let p2pAdsModernSchemaCache: boolean | null = null;

async function detectP2PAdsModernSchema(): Promise<boolean> {
  if (p2pAdsModernSchemaCache !== null) return p2pAdsModernSchemaCache;
  const r = await db.query<{ e: boolean }>(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'p2p_ads' AND column_name = 'crypto_currency_id'
    ) AS e`
  );
  p2pAdsModernSchemaCache = Boolean(r.rows[0]?.e);
  return p2pAdsModernSchemaCache;
}

/** `p2p_orders.crypto_currency_id` + currencies join (full-schema); else slim `token_id` + tokens join. */
let p2pOrdersModernSchemaCache: boolean | null = null;

async function detectP2POrdersModernSchema(): Promise<boolean> {
  if (p2pOrdersModernSchemaCache !== null) return p2pOrdersModernSchemaCache;
  const r = await db.query<{ e: boolean }>(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'p2p_orders' AND column_name = 'crypto_currency_id'
    ) AS e`
  );
  p2pOrdersModernSchemaCache = Boolean(r.rows[0]?.e);
  return p2pOrdersModernSchemaCache;
}

function buildP2POrderCreateRequestHash(body: { adId?: string; quantity?: string; paymentMethodId?: string }): string {
  const normalized = {
    adId: String(body.adId ?? '').trim(),
    quantity: String(body.quantity ?? '').trim(),
    paymentMethodId: String(body.paymentMethodId ?? '').trim(),
  };
  return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

function buildP2PReleaseRequestHash(orderId: string): string {
  return crypto.createHash('sha256').update(String(orderId).trim()).digest('hex');
}

function buildP2PConfirmRequestHash(orderId: string, proofUrl?: string, transactionReference?: string): string {
  const payload = `${orderId}|${proofUrl ?? ''}|${transactionReference ?? ''}`;
  return crypto.createHash('sha256').update(payload).digest('hex');
}

function buildP2PCancelRequestHash(orderId: string, reason: string): string {
  return crypto.createHash('sha256').update(JSON.stringify({ orderId: String(orderId).trim(), reason: String(reason).trim() })).digest('hex');
}

interface P2POrderCreateIdempotencyCache {
  requestHash: string;
  response: { success: true; data: Record<string, unknown> };
}

interface P2PReleaseIdempotencyCache {
  requestHash: string;
  response: { success: true; data: Record<string, unknown> };
}

interface P2PConfirmIdempotencyCache {
  requestHash: string;
  response: { success: true; data: Record<string, unknown> };
}

interface P2PCancelIdempotencyCache {
  requestHash: string;
  response: { success: true; data: Record<string, unknown> };
}

export default async function p2pRoutes(app: FastifyInstance) {
  /**
   * GET /p2p/reference-price?asset=USDT&fiat=INR
   * Backend reference (internal spot last trade) for P2P floating ads — cached in Redis.
   */
  app.get<{ Querystring: { asset?: string; fiat?: string } }>('/reference-price', async (request, reply) => {
    const asset = String(request.query?.asset ?? 'USDT')
      .trim()
      .toUpperCase()
      .slice(0, 16);
    const fiat = String(request.query?.fiat ?? 'INR')
      .trim()
      .toUpperCase()
      .slice(0, 8);
    if (!asset || !fiat) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'asset and fiat are required' },
      });
    }
    try {
      const data = await getP2PReferencePrice(asset, fiat);
      return reply.send({ success: true, data });
    } catch (e) {
      logger.warn('P2P reference price failed', { asset, fiat, error: e instanceof Error ? e.message : String(e) });
      return reply.status(503).send({
        success: false,
        error: { code: 'REFERENCE_UNAVAILABLE', message: 'Reference price temporarily unavailable' },
      });
    }
  });

  /**
   * GET /p2p/ads
   * Get P2P advertisements. Uses optional auth to exclude blocked advertisers when logged in.
   * P1: limit/offset coerced and validated to avoid NaN in SQL.
   */
  app.get<{
    Querystring: { type?: string; currency?: string; fiat?: string; limit?: string | number; offset?: string | number };
  }>('/ads', {
    preHandler: [app.authenticateOptional],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          type: { type: 'string' },
          currency: { type: 'string' },
          fiat: { type: 'string' },
          advertiser_id: { type: 'string' },
          limit: { anyOf: [{ type: 'string' }, { type: 'number' }] },
          offset: { anyOf: [{ type: 'string' }, { type: 'number' }] },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const q = request.query;
      const type = q.type;
      const currency = q.currency;
      const fiat = q.fiat;
      const advertiserId =
        typeof (q as { advertiser_id?: string }).advertiser_id === 'string'
          ? (q as { advertiser_id?: string }).advertiser_id!.trim()
          : '';
      const limitRaw = q.limit != null ? q.limit : 20;
      const offsetRaw = q.offset != null ? q.offset : 0;
      const parsedLimit = typeof limitRaw === 'number' ? (Number.isFinite(limitRaw) ? Math.floor(limitRaw) : NaN) : parseInt(String(limitRaw), 10);
      const parsedOffset = typeof offsetRaw === 'number' ? (Number.isFinite(offsetRaw) ? Math.floor(offsetRaw) : NaN) : parseInt(String(offsetRaw), 10);
      const limit = Number.isFinite(parsedLimit) ? Math.min(100, Math.max(1, parsedLimit)) : 20;
      const offset = Number.isFinite(parsedOffset) ? Math.max(0, parsedOffset) : 0;
      const userId = (request as { user?: { id: string } }).user?.id;
      const isModernP2PAds = await detectP2PAdsModernSchema();

      const ttlAds = config.p2p.adsListCacheTtlSec;
      if (ttlAds > 0) {
        try {
          const gen = await getP2PAdsCacheGeneration();
          const fp = fingerprintP2PAdsQuery({
            schema: isModernP2PAds ? 'modern' : 'legacy',
            type: type ?? null,
            currency: currency ?? null,
            fiat: fiat ?? null,
            advertiserId,
            limit,
            offset,
            userId: userId ?? '',
          });
          const ck = `p2p:ads:list:v1:${gen}:${fp}`;
          const hit = await redis.getJson<{ rows: unknown[] }>(ck);
          if (hit && Array.isArray(hit.rows)) {
            return reply.send({ success: true, data: hit.rows });
          }
        } catch {
          /* cache miss */
        }
      }

      if (!isModernP2PAds) {
        let legacyQuery = `
        SELECT 
          pa.id,
          pa.user_id,
          pa.type AS ad_type,
          pa.price_type AS pricing_type,
          NULL::numeric AS fixed_price,
          pa.floating_price_margin AS float_percentage,
          pa.price AS current_price,
          pa.min_amount,
          pa.max_amount,
          pa.available_amount,
          pa.payment_time_limit,
          to_jsonb(COALESCE(pa.payment_methods, ARRAY[]::uuid[])) AS accepted_payment_methods,
          ARRAY[]::uuid[] AS accepted_platform_method_ids,
          NULL::int AS min_trades_required,
          NULL::numeric AS min_completion_rate,
          pa.remarks AS terms_and_conditions,
          0::int AS total_orders,
          pa.completed_orders,
          pa.created_at,
          pa.fiat_currency,
          t.symbol AS crypto_symbol,
          COALESCE(t.name, t.symbol) AS crypto_name,
          u.username,
          u.avatar_url,
          pms.total_orders AS merchant_total_orders,
          pms.completion_rate AS merchant_completion_rate,
          pms.average_rating AS merchant_rating,
          pms.avg_release_time AS merchant_avg_release_time_minutes
        FROM p2p_ads pa
        JOIN tokens t ON pa.token_id = t.id
        JOIN users u ON pa.user_id = u.id
        LEFT JOIN p2p_merchant_stats pms ON pa.user_id = pms.user_id
        WHERE pa.status = 'active'
      `;
        const legacyParams: unknown[] = [];
        let li = 1;
        if (type) {
          legacyQuery += ` AND pa.type = $${li++}`;
          legacyParams.push(type);
        }
        if (currency) {
          legacyQuery += ` AND UPPER(t.symbol) = $${li++}`;
          legacyParams.push(currency.toUpperCase());
        }
        if (fiat) {
          legacyQuery += ` AND pa.fiat_currency = $${li++}`;
          legacyParams.push(fiat.toUpperCase());
        }
        if (advertiserId && UUID_REGEX.test(advertiserId)) {
          legacyQuery += ` AND pa.user_id = $${li++}`;
          legacyParams.push(advertiserId);
        }
        if (userId) {
          legacyQuery += ` AND pa.user_id NOT IN (SELECT advertiser_id FROM p2p_blocked_advertisers WHERE user_id = $${li})`;
          legacyParams.push(userId);
          li++;
        }
        legacyQuery += ` ORDER BY pa.price ${type === 'sell' ? 'ASC' : 'DESC'}, pms.completion_rate DESC NULLS LAST`;
        legacyQuery += ` LIMIT $${li++} OFFSET $${li}`;
        legacyParams.push(limit, offset);

        const legacyResult = await db.queryRead(legacyQuery, legacyParams);
        const VERIFIED_MIN_COMPLETION_L = 98;
        const VERIFIED_MIN_ORDERS_L = 30;
        const VERIFIED_MIN_RATING_L = 4;
        const legacyRows = legacyResult.rows.map((r: Record<string, unknown>) => {
          const total = parseFloat(String(r.merchant_total_orders ?? 0)) || 0;
          const completion = parseFloat(String(r.merchant_completion_rate ?? 0)) || 0;
          const rating = parseFloat(String(r.merchant_rating ?? 0)) || 0;
          const verified_merchant =
            total >= VERIFIED_MIN_ORDERS_L && completion >= VERIFIED_MIN_COMPLETION_L && rating >= VERIFIED_MIN_RATING_L;
          return { ...r, verified_merchant };
        });

        if (ttlAds > 0) {
          try {
            const gen = await getP2PAdsCacheGeneration();
            const fp = fingerprintP2PAdsQuery({
              schema: 'legacy',
              type: type ?? null,
              currency: currency ?? null,
              fiat: fiat ?? null,
              advertiserId,
              limit,
              offset,
              userId: userId ?? '',
            });
            const ck = `p2p:ads:list:v1:${gen}:${fp}`;
            await redis.setJson(ck, { rows: legacyRows }, ttlAds);
          } catch {
            /* best-effort */
          }
        }

        return reply.send({ success: true, data: legacyRows });
      }

      let query = `
        SELECT 
          pa.id,
          pa.user_id,
          pa.ad_type,
          pa.pricing_type,
          pa.fixed_price,
          pa.float_percentage,
          pa.current_price,
          pa.min_amount,
          pa.max_amount,
          pa.available_amount,
          pa.payment_time_limit,
          pa.accepted_payment_methods,
          (
            SELECT COALESCE(array_agg(DISTINCT upm2.payment_method_id), ARRAY[]::uuid[])
            FROM jsonb_array_elements_text(
              CASE
                WHEN pa.accepted_payment_methods IS NULL THEN '[]'::jsonb
                WHEN jsonb_typeof(pa.accepted_payment_methods) = 'array' THEN pa.accepted_payment_methods
                ELSE '[]'::jsonb
              END
            ) AS elems(elem_text)
            INNER JOIN user_p2p_payment_methods upm2
              ON upm2.id::text = lower(trim(both from elems.elem_text))
          ) AS accepted_platform_method_ids,
          pa.min_trades_required,
          pa.min_completion_rate,
          pa.terms_and_conditions,
          pa.total_orders,
          pa.completed_orders,
          pa.created_at,
          pa.fiat_currency,
          c.symbol as crypto_symbol,
          c.name as crypto_name,
          u.username,
          u.avatar_url,
          pms.total_orders as merchant_total_orders,
          pms.completion_rate as merchant_completion_rate,
          pms.average_rating as merchant_rating,
          pms.avg_release_time as merchant_avg_release_time_minutes
        FROM p2p_ads pa
        JOIN currencies c ON pa.crypto_currency_id = c.id
        JOIN users u ON pa.user_id = u.id
        LEFT JOIN p2p_merchant_stats pms ON pa.user_id = pms.user_id
        WHERE pa.status = 'active'
      `;
      const params: any[] = [];
      let paramIndex = 1;

      if (type) {
        query += ` AND pa.ad_type = $${paramIndex++}`;
        params.push(type);
      }

      if (currency) {
        query += ` AND c.symbol = $${paramIndex++}`;
        params.push(currency.toUpperCase());
      }

      if (fiat) {
        query += ` AND pa.fiat_currency = $${paramIndex++}`;
        params.push(fiat.toUpperCase());
      }

      if (advertiserId && UUID_REGEX.test(advertiserId)) {
        query += ` AND pa.user_id = $${paramIndex++}`;
        params.push(advertiserId);
      }

      // Exclude blocked advertisers when user is authenticated (optional auth via preHandler)
      if (userId) {
        query += ` AND pa.user_id NOT IN (SELECT advertiser_id FROM p2p_blocked_advertisers WHERE user_id = $${paramIndex})`;
        params.push(userId);
        paramIndex++;
      }

      query += ` ORDER BY pa.current_price ${type === 'sell' ? 'ASC' : 'DESC'}, pms.completion_rate DESC NULLS LAST`;
      query += ` LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
      params.push(limit, offset);

      const result = await db.queryRead(query, params);
      const VERIFIED_MIN_COMPLETION = 98;
      const VERIFIED_MIN_ORDERS = 30;
      const VERIFIED_MIN_RATING = 4;
      const rows = result.rows.map((r: Record<string, unknown>) => {
        const total = parseFloat(String(r.merchant_total_orders ?? 0)) || 0;
        const completion = parseFloat(String(r.merchant_completion_rate ?? 0)) || 0;
        const rating = parseFloat(String(r.merchant_rating ?? 0)) || 0;
        const verified_merchant = total >= VERIFIED_MIN_ORDERS && completion >= VERIFIED_MIN_COMPLETION && rating >= VERIFIED_MIN_RATING;
        return { ...r, verified_merchant };
      });

      if (ttlAds > 0) {
        try {
          const gen = await getP2PAdsCacheGeneration();
          const fp = fingerprintP2PAdsQuery({
            schema: 'modern',
            type: type ?? null,
            currency: currency ?? null,
            fiat: fiat ?? null,
            advertiserId,
            limit,
            offset,
            userId: userId ?? '',
          });
          const ck = `p2p:ads:list:v1:${gen}:${fp}`;
          await redis.setJson(ck, { rows }, ttlAds);
        } catch {
          /* best-effort */
        }
      }

      return reply.send({
        success: true,
        data: rows,
      });
    } catch (error) {
      logger.error('Failed to fetch P2P ads', { error });
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to fetch ads' },
      });
    }
  });

  /**
   * POST /p2p/blocked-advertisers — block an advertiser (hide their ads)
   */
  app.post<{ Body: { advertiser_id?: string } }>('/blocked-advertisers', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const userId = request.user!.id;
    const advertiserId = (request.body?.advertiser_id ?? '').trim();
    if (!advertiserId || !UUID_REGEX.test(advertiserId)) {
      return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'advertiser_id required and must be a valid UUID' } });
    }
    if (advertiserId === userId) {
      return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Cannot block yourself' } });
    }
    try {
      await db.query(
        `INSERT INTO p2p_blocked_advertisers (user_id, advertiser_id) VALUES ($1, $2) ON CONFLICT (user_id, advertiser_id) DO NOTHING`,
        [userId, advertiserId]
      );
      return reply.send({ success: true });
    } catch (e) {
      logger.error('Failed to block advertiser', { error: e });
      return reply.status(500).send({ success: false, error: { code: 'BLOCK_FAILED', message: 'Failed to block advertiser' } });
    }
  });

  /**
   * DELETE /p2p/blocked-advertisers/:advertiserId — unblock an advertiser
   */
  app.delete<{ Params: { advertiserId: string } }>('/blocked-advertisers/:advertiserId', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const userId = request.user!.id;
    const advertiserId = request.params.advertiserId?.trim() ?? '';
    if (!advertiserId || !UUID_REGEX.test(advertiserId)) {
      return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'advertiserId must be a valid UUID' } });
    }
    try {
      const r = await db.query(
        `DELETE FROM p2p_blocked_advertisers WHERE user_id = $1 AND advertiser_id = $2 RETURNING 1`,
        [userId, advertiserId]
      );
      return reply.send({ success: true, removed: (r.rowCount ?? 0) > 0 });
    } catch (e) {
      logger.error('Failed to unblock advertiser', { error: e });
      return reply.status(500).send({ success: false, error: { code: 'UNBLOCK_FAILED', message: 'Failed to unblock advertiser' } });
    }
  });

  /**
   * GET /p2p/payment-methods
   * Get available payment methods
   */
  app.get('/payment-methods', async (request, reply) => {
    try {
      const result = await db.query(`
        SELECT id, name, code, method_type, icon_url, supported_countries, required_fields
        FROM p2p_payment_methods
        WHERE is_active = TRUE
        ORDER BY sort_order NULLS LAST, name
      `);

      return reply
        .header('Content-Type', 'application/json')
        .send({
          success: true,
          data: Array.isArray(result.rows) ? result.rows : [],
        });
    } catch (error) {
      logger.error('Failed to fetch platform payment methods', { error });
      return reply
        .status(500)
        .header('Content-Type', 'application/json')
        .send({
          success: false,
          error: { code: 'FETCH_FAILED', message: 'Failed to fetch payment methods' },
        });
    }
  });

  /**
   * GET /p2p/my-ads
   * Get user's own ads
   */
  app.get('/my-ads', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    try {
      const { id: userId } = request.user!;
      const modernAds = await detectP2PAdsModernSchema();
      const result = modernAds
        ? await db.query(
            `
        SELECT 
          pa.*,
          c.symbol as crypto_symbol,
          c.name as crypto_name
        FROM p2p_ads pa
        JOIN currencies c ON pa.crypto_currency_id = c.id
        WHERE pa.user_id = $1
        ORDER BY pa.created_at DESC
      `,
            [userId]
          )
        : await db.query(
            `
        SELECT 
          pa.*,
          t.symbol as crypto_symbol,
          COALESCE(t.name, t.symbol) as crypto_name
        FROM p2p_ads pa
        JOIN tokens t ON pa.token_id = t.id
        WHERE pa.user_id = $1
        ORDER BY pa.created_at DESC
      `,
            [userId]
          );

      return reply.send({
        success: true,
        data: result.rows,
      });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to fetch your ads' },
      });
    }
  });

  /**
   * PATCH /p2p/my-ads/:adId
   * Update own ad (price, limits, remarks, pause/resume). Backward-compatible additive route.
   */
  app.patch<{
    Params: { adId: string };
    Body: {
      price?: string;
      min_amount?: string;
      max_amount?: string;
      remarks?: string;
      auto_reply?: string;
      status?: string;
    };
  }>('/my-ads/:adId', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const userId = request.user!.id;
    const adId = request.params.adId?.trim();
    if (!adId || !UUID_REGEX.test(adId)) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Valid ad id required' },
      });
    }
    const body = request.body || {};
    try {
      const updates: {
        price?: string;
        minAmount?: string;
        maxAmount?: string;
        remarks?: string;
        autoReply?: string;
        status?: P2PAdStatus;
      } = {};
      if (typeof body.price === 'string' && body.price.trim()) {
        const p = parseFloat(body.price);
        if (!Number.isNaN(p) && p > 0) updates.price = body.price.trim();
      }
      if (typeof body.min_amount === 'string' && body.min_amount.trim()) {
        updates.minAmount = body.min_amount.trim();
      }
      if (typeof body.max_amount === 'string' && body.max_amount.trim()) {
        updates.maxAmount = body.max_amount.trim();
      }
      if (typeof body.remarks === 'string') {
        updates.remarks = body.remarks.trim().slice(0, 4000);
      }
      if (typeof body.auto_reply === 'string') {
        updates.autoReply = body.auto_reply.trim().slice(0, 2000);
      }
      if (typeof body.status === 'string') {
        const s = body.status.trim().toLowerCase();
        if (s === 'active') updates.status = P2PAdStatus.ACTIVE;
        else if (s === 'paused') updates.status = P2PAdStatus.PAUSED;
      }
      if (Object.keys(updates).length === 0) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'No valid fields to update' },
        });
      }
      const ad = await p2pService.updateAd(adId, userId, updates);
      return reply.send({ success: true, data: ad });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Update failed';
      return reply.status(400).send({
        success: false,
        error: { code: 'UPDATE_FAILED', message: msg },
      });
    }
  });

  /**
   * DELETE /p2p/my-ads/:adId
   * Cancel (close) own ad when no active orders.
   */
  app.delete<{ Params: { adId: string } }>('/my-ads/:adId', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const userId = request.user!.id;
    const adId = request.params.adId?.trim();
    if (!adId || !UUID_REGEX.test(adId)) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Valid ad id required' },
      });
    }
    try {
      const ad = await p2pService.cancelAd(adId, userId);
      return reply.send({ success: true, data: ad });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Delete failed';
      return reply.status(400).send({
        success: false,
        error: { code: 'DELETE_FAILED', message: msg },
      });
    }
  });

  /**
   * GET /p2p/disputes/:disputeId
   * Dispute detail for buyer/seller on the linked order (read-only).
   */
  app.get<{ Params: { disputeId: string } }>('/disputes/:disputeId', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const userId = request.user!.id;
    const disputeId = request.params.disputeId?.trim();
    if (!disputeId || !UUID_REGEX.test(disputeId)) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Valid dispute id required' },
      });
    }
    try {
      const r = await db.query(
        `SELECT d.*,
                po.status AS order_status,
                po.fiat_amount::text AS order_fiat_amount,
                po.quantity::text AS order_quantity,
                po.fiat_currency AS order_fiat_currency,
                po.payment_proof_url AS order_payment_proof_url,
                po.transaction_reference AS order_transaction_reference,
                po.payment_verification_status AS order_payment_verification_status
         FROM p2p_disputes d
         INNER JOIN p2p_orders po ON po.id = d.order_id
         WHERE d.id = $1 AND (po.buyer_id = $2 OR po.seller_id = $2)`,
        [disputeId, userId]
      );
      if (r.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Dispute not found' },
        });
      }
      return reply.send({ success: true, data: r.rows[0] });
    } catch (error) {
      logger.error('P2P dispute fetch failed', { error });
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to load dispute' },
      });
    }
  });

  /**
   * POST /p2p/ads
   * Create a P2P ad (buy or sell). No balance lock; funds move to escrow at order creation.
   */
  app.post<{
    Body: {
      type?: string;
      currency?: string;
      fiat?: string;
      price?: string;
      min_amount?: string;
      max_amount?: string;
      available_amount?: string;
      payment_method_ids?: string[];
      payment_time_limit?: number;
      auto_release?: boolean;
      remarks?: string;
      auto_reply?: string;
      /** 'fixed' | 'floating' — when floating, send float_margin_percent and price = snapshot at creation. */
      pricing_type?: string;
      float_margin_percent?: number;
    };
  }>('/ads', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const userId = request.user!.id;
    const body = request.body || {};
    const type = String(body.type ?? '').trim().toLowerCase();
    const currency = String(body.currency ?? '').trim().toUpperCase();
    const fiat = String(body.fiat ?? '').trim().toUpperCase();
    const price = body.price != null ? String(body.price).trim() : '';
    const minAmount = body.min_amount != null ? String(body.min_amount).trim() : '';
    const maxAmount = body.max_amount != null ? String(body.max_amount).trim() : '';
    const availableAmount = body.available_amount != null ? String(body.available_amount).trim() : '';
    const paymentMethodIds = Array.isArray(body.payment_method_ids) ? body.payment_method_ids : [];
    const paymentTimeLimit = typeof body.payment_time_limit === 'number' ? body.payment_time_limit : 15;
    const autoRelease = body.auto_release === true;
    const remarks = typeof body.remarks === 'string' ? body.remarks.trim().slice(0, 4000) : undefined;
    const autoReply = typeof body.auto_reply === 'string' ? body.auto_reply.trim().slice(0, 2000) : undefined;
    const pricingTypeRaw = String(body.pricing_type ?? 'fixed').trim().toLowerCase();
    const priceType = pricingTypeRaw === 'floating' ? P2PPriceType.FLOATING : P2PPriceType.FIXED;
    let floatingMargin: string | undefined;
    if (priceType === P2PPriceType.FLOATING) {
      const m = body.float_margin_percent;
      if (typeof m !== 'number' || !Number.isFinite(m) || m < -99 || m > 500) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'float_margin_percent is required for floating ads (-99 to 500)',
          },
        });
      }
      floatingMargin = String(m);
    }

    if (type !== 'buy' && type !== 'sell') {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'type must be buy or sell' },
      });
    }
    if (!currency || currency.length > 10) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'currency (crypto symbol) is required' },
      });
    }
    if (!fiat || fiat.length > 10) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'fiat is required' },
      });
    }
    let priceNum = parseFloat(price);
    if (priceType === P2PPriceType.FLOATING) {
      try {
        const ref = await getP2PReferencePriceDecimal(currency, fiat);
        priceNum = parseFloat(applyFloatingMargin(ref, floatingMargin!));
      } catch (e) {
        logger.warn('P2P create ad: reference price failed', { currency, fiat, error: e instanceof Error ? e.message : String(e) });
        return reply.status(503).send({
          success: false,
          error: {
            code: 'REFERENCE_PRICE_UNAVAILABLE',
            message: 'Could not compute floating price from internal reference. Check spot market and try again.',
          },
        });
      }
    }
    const minNum = parseFloat(minAmount);
    const maxNum = parseFloat(maxAmount);
    const availNum = parseFloat(availableAmount);
    if (Number.isNaN(priceNum) || priceNum <= 0) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'price must be a positive number' },
      });
    }
    if (Number.isNaN(minNum) || minNum <= 0 || Number.isNaN(maxNum) || maxNum <= 0) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'min_amount and max_amount must be positive numbers' },
      });
    }
    if (minNum > maxNum) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'min_amount cannot exceed max_amount' },
      });
    }
    if (Number.isNaN(availNum) || availNum < 0) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'available_amount must be a non-negative number' },
      });
    }
    if (availNum > maxNum) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'available_amount cannot exceed max_amount' },
      });
    }
    if (paymentMethodIds.length === 0) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'At least one payment_method_id is required' },
      });
    }
    const validPmIds = paymentMethodIds.filter((id) => typeof id === 'string' && UUID_REGEX.test(String(id).trim()));
    if (validPmIds.length === 0) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'payment_method_ids must be valid UUIDs' },
      });
    }
    if (paymentTimeLimit < 5 || paymentTimeLimit > 120) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'payment_time_limit must be between 5 and 120 minutes' },
      });
    }

    // Tier-1: KYC required for P2P selling — only approved users can create sell ads
    if (type === 'sell') {
      try {
        await assertKycAllowed({ userId, action: 'p2p_sell' });
      } catch (err) {
        if (err instanceof KycPendingError) {
          return reply.status(403).send({
            success: false,
            error: { code: 'KYC_PENDING', message: 'KYC approval is required for selling crypto. Your application is under review.' },
          });
        }
        return reply.status(403).send({
          success: false,
          error: { code: 'KYC_REQUIRED', message: 'KYC verification is required for selling crypto. Please complete identity verification.' },
        });
      }
      const sellerSanctions = await checkSanctions({
        userId,
        amount: availableAmount || maxAmount,
        asset: currency,
      });
      if (!sellerSanctions.allowed) {
        return reply.status(403).send({
          success: false,
          error: { code: 'SANCTIONS_BLOCKED', message: sellerSanctions.reason ?? 'Cannot create sell ad due to compliance check.' },
        });
      }
    }

    const cryptoCurrencyId = await getCurrencyIdBySymbol(currency);
    if (!cryptoCurrencyId) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: `Unsupported currency: ${currency}` },
      });
    }

    const tokenIds = await getTokenIdsByCurrencyId(cryptoCurrencyId);
    const tokenId = tokenIds[0];
    if (!tokenId) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: `No token found for currency: ${currency}` },
      });
    }

    try {
      const ad = await p2pService.createAd({
        userId,
        type: type === 'buy' ? P2PAdType.BUY : P2PAdType.SELL,
        tokenId,
        fiatCurrency: fiat,
        priceType,
        price: String(priceNum),
        floatingPriceMargin: floatingMargin,
        minAmount: String(minNum),
        maxAmount: String(maxNum),
        totalAmount: String(availNum),
        paymentMethodIds: validPmIds,
        paymentTimeLimit,
        autoRelease,
        remarks: remarks || undefined,
        autoReply: autoReply || undefined,
      });
      return reply.status(201).send({
        success: true,
        data: {
          id: ad.id,
          ad_type: ad.type,
          crypto_currency_id: cryptoCurrencyId,
          fiat_currency: ad.fiatCurrency,
          current_price: ad.price,
          min_amount: ad.minAmount,
          max_amount: ad.maxAmount,
          available_amount: ad.availableAmount,
          payment_time_limit: ad.paymentTimeLimit,
          accepted_payment_methods: ad.paymentMethods,
          status: ad.status,
          created_at: ad.createdAt,
        },
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to create ad';
      logger.error('Failed to create P2P ad', { error });
      return reply.status(400).send({
        success: false,
        error: { code: 'CREATE_FAILED', message: msg },
      });
    }
  });

  /**
   * GET /p2p/orders/:orderId
   * Get a single P2P order by id (caller must be buyer or seller).
   */
  app.get<{ Params: { orderId: string } }>('/orders/:orderId', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    try {
      const { id: userId } = request.user!;
      const orderId = request.params.orderId;
      if (!orderId || !UUID_REGEX.test(orderId)) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'orderId required and must be a valid UUID' },
        });
      }
      const modernOrders = await detectP2POrdersModernSchema();
      const result = modernOrders
        ? await db.query(
            `
        SELECT 
          po.*,
          c.symbol as crypto_symbol,
          buyer.username as buyer_username,
          seller.username as seller_username
        FROM p2p_orders po
        JOIN currencies c ON po.crypto_currency_id = c.id
        JOIN users buyer ON po.buyer_id = buyer.id
        JOIN users seller ON po.seller_id = seller.id
        WHERE po.id = $1 AND (po.buyer_id = $2 OR po.seller_id = $2)
      `,
            [orderId, userId]
          )
        : await db.query(
            `
        SELECT 
          po.*,
          t.symbol as crypto_symbol,
          buyer.username as buyer_username,
          seller.username as seller_username
        FROM p2p_orders po
        JOIN tokens t ON po.token_id = t.id
        JOIN users buyer ON po.buyer_id = buyer.id
        JOIN users seller ON po.seller_id = seller.id
        WHERE po.id = $1 AND (po.buyer_id = $2 OR po.seller_id = $2)
      `,
            [orderId, userId]
          );
      if (result.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Order not found' },
        });
      }
      const row = result.rows[0] as Record<string, unknown>;
      const isBuyer = row.buyer_id === userId;
      const status = String(row.status || '');
      if (isBuyer && status === 'payment_pending') {
        const sellerId = row.seller_id as string;
        const adId = row.ad_id as string | undefined;
        if (sellerId) {
          let pmResult: { rows: Record<string, unknown>[] } | null = null;
          if (adId) {
            const r = await db.query(`
              SELECT upm.payment_details, upm.display_name, pm.name as method_name, pm.code as method_code
              FROM p2p_ads pa
              JOIN user_p2p_payment_methods upm ON upm.user_id = $2 AND upm.is_active = TRUE
                AND upm.id IN (SELECT (jsonb_array_elements_text(COALESCE(pa.accepted_payment_methods, '[]'::jsonb)))::uuid)
              JOIN p2p_payment_methods pm ON pm.id = upm.payment_method_id
              WHERE pa.id = $1 AND pa.user_id = $2
              LIMIT 1
            `, [adId, sellerId]);
            if (r.rows.length > 0) pmResult = r;
          }
          if (!pmResult || pmResult.rows.length === 0) {
            const r = await db.query(`
              SELECT upm.payment_details, upm.display_name, pm.name as method_name, pm.code as method_code
              FROM user_p2p_payment_methods upm
              JOIN p2p_payment_methods pm ON pm.id = upm.payment_method_id
              WHERE upm.user_id = $1 AND upm.is_active = TRUE
              LIMIT 1
            `, [sellerId]);
            if (r.rows.length > 0) pmResult = r;
          }
          if (pmResult && pmResult.rows.length > 0) {
            const pm = pmResult.rows[0] as Record<string, unknown>;
            row.seller_payment_details = pm.payment_details;
            row.seller_payment_display_name = pm.display_name;
            row.seller_payment_method_name = pm.method_name;
            row.seller_payment_method_code = pm.method_code;
          }
        }
      }
      return reply.send({
        success: true,
        data: row,
      });
    } catch (error) {
      logger.error('Failed to fetch P2P order', { error });
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to fetch order' },
      });
    }
  });

  /**
   * GET /p2p/orders/:orderId/payment-proof
   * Authenticated buyer/seller only. Serves Tier-1 secure proofs (`secure:filename`); legacy `/assets/...` redirects to frontend static.
   */
  app.get<{ Params: { orderId: string } }>('/orders/:orderId/payment-proof', {
    preHandler: [app.authenticate, rateLimitByUser('p2p:proof-download', 120, 3600)],
  }, async (request, reply) => {
    const userId = request.user!.id;
    const orderId = request.params.orderId;
    if (!orderId || !UUID_REGEX.test(orderId)) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid order id' },
      });
    }
    const r = await db.query<{ buyer_id: string; seller_id: string; payment_proof_url: string | null }>(
      `SELECT buyer_id, seller_id, payment_proof_url FROM p2p_orders WHERE id = $1`,
      [orderId]
    );
    if (r.rows.length === 0) {
      return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Order not found' } });
    }
    const row = r.rows[0]!;
    if (row.buyer_id !== userId && row.seller_id !== userId) {
      return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Not a party to this order' } });
    }
    const ref = row.payment_proof_url;
    if (!ref) {
      return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'No payment proof' } });
    }
    if (isSecureProofRef(ref)) {
      const fname = secureProofFilenameFromRef(ref);
      if (!fname) {
        return reply.status(400).send({ success: false, error: { code: 'INVALID_PROOF_REF', message: 'Invalid proof reference' } });
      }
      const abs = resolveSecureProofAbsolutePath(fname);
      if (!fs.existsSync(abs)) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Proof file missing' } });
      }
      const ct = fname.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
      reply.header('Cache-Control', 'private, no-store');
      return reply.type(ct).send(fs.createReadStream(abs));
    }
    if (ref.startsWith('/assets/')) {
      const base = config.frontendUrl.replace(/\/$/, '');
      return reply.redirect(`${base}${ref}`, 302);
    }
    return reply.status(404).send({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Proof not available via this endpoint' },
    });
  });

  /**
   * GET /p2p/orders/:orderId/messages
   * List chat messages for a P2P order (caller must be buyer or seller).
   * Query: since=ISO timestamp — return only messages after this time (for long-poll / real-time polling).
   */
  app.get<{ Params: { orderId: string }; Querystring: { since?: string } }>('/orders/:orderId/messages', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    try {
      const { id: userId } = request.user!;
      const orderId = request.params.orderId;
      const sinceRaw = request.query?.since;
      let sinceDate: Date | null = null;
      if (sinceRaw && typeof sinceRaw === 'string') {
        const t = Date.parse(sinceRaw);
        if (!Number.isNaN(t)) sinceDate = new Date(t);
      }
      if (!orderId || !UUID_REGEX.test(orderId)) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'orderId required and must be a valid UUID' },
        });
      }
      const orderCheck = await db.query<{ id: string }>(
        `SELECT id FROM p2p_orders WHERE id = $1 AND (buyer_id = $2 OR seller_id = $2)`,
        [orderId, userId]
      );
      if (orderCheck.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Order not found' },
        });
      }
      const result = sinceDate
        ? await db.query(
            `SELECT m.id, m.order_id, m.sender_id, m.message, m.created_at, u.username as sender_username
             FROM p2p_order_messages m
             JOIN users u ON u.id = m.sender_id
             WHERE m.order_id = $1 AND m.created_at > $2
             ORDER BY m.created_at ASC`,
            [orderId, sinceDate]
          )
        : await db.query(
            `SELECT m.id, m.order_id, m.sender_id, m.message, m.created_at, u.username as sender_username
             FROM p2p_order_messages m
             JOIN users u ON u.id = m.sender_id
             WHERE m.order_id = $1
             ORDER BY m.created_at ASC`,
            [orderId]
          );
      const messages = (result.rows as Array<{ id: string; order_id: string; sender_id: string; message: string; created_at: Date; sender_username: string }>).map((r) => ({
        id: r.id,
        orderId: r.order_id,
        senderId: r.sender_id,
        message: r.message,
        createdAt: (r.created_at as Date).toISOString(),
        senderUsername: r.sender_username,
      }));
      return reply.send({ success: true, data: messages });
    } catch (error) {
      logger.error('Failed to fetch P2P order messages', { error });
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to fetch messages' },
      });
    }
  });

  /**
   * POST /p2p/orders/:orderId/messages
   * Send a chat message for a P2P order (caller must be buyer or seller).
   */
  app.post<{ Params: { orderId: string }; Body: { message?: string } }>('/orders/:orderId/messages', {
    preHandler: [app.authenticate, rateLimitByUser('p2p:chat', 60, 60)],
  }, async (request, reply) => {
    try {
      const { id: userId } = request.user!;
      const orderId = request.params.orderId;
      const text = typeof request.body?.message === 'string' ? request.body.message.trim() : '';
      if (!orderId || !UUID_REGEX.test(orderId)) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'orderId required and must be a valid UUID' },
        });
      }
      if (text.length === 0 || text.length > 2000) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Message must be 1–2000 characters' },
        });
      }
      const orderCheck = await db.query<{ id: string }>(
        `SELECT id FROM p2p_orders WHERE id = $1 AND (buyer_id = $2 OR seller_id = $2)`,
        [orderId, userId]
      );
      if (orderCheck.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Order not found' },
        });
      }
      const ins = await db.query<{ id: string; created_at: Date }>(
        `INSERT INTO p2p_order_messages (order_id, sender_id, message) VALUES ($1, $2, $3)
         RETURNING id, created_at`,
        [orderId, userId, text]
      );
      const row = ins.rows[0]!;
      const userRow = await db.query<{ username: string }>(`SELECT username FROM users WHERE id = $1`, [userId]);
      const senderUsername = userRow.rows[0]?.username ?? null;
      const payload = {
        id: row.id,
        orderId,
        senderId: userId,
        senderUsername,
        message: text,
        createdAt: (row.created_at as Date).toISOString(),
      };
      publishP2POrderRoom(orderId, 'message:new', payload);
      return reply.status(201).send({
        success: true,
        data: payload,
      });
    } catch (error) {
      logger.error('Failed to send P2P message', { error });
      return reply.status(500).send({
        success: false,
        error: { code: 'SEND_FAILED', message: 'Failed to send message' },
      });
    }
  });

  /**
   * POST /p2p/orders/:orderId/messages/read
   * Read receipt for chat (fan-out over WS). No DB column required — optional cursor for UI.
   */
  app.post<{
    Params: { orderId: string };
    Body: { last_read_message_id?: string };
  }>('/orders/:orderId/messages/read', {
    preHandler: [app.authenticate, rateLimitByUser('p2p:chat-read', 120, 60)],
  }, async (request, reply) => {
    try {
      const { id: userId } = request.user!;
      const orderId = request.params.orderId;
      const lastRead =
        typeof request.body?.last_read_message_id === 'string'
          ? request.body.last_read_message_id.trim()
          : '';
      if (!orderId || !UUID_REGEX.test(orderId)) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'orderId required and must be a valid UUID' },
        });
      }
      const orderCheck = await db.query<{ id: string }>(
        `SELECT id FROM p2p_orders WHERE id = $1 AND (buyer_id = $2 OR seller_id = $2)`,
        [orderId, userId]
      );
      if (orderCheck.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Order not found' },
        });
      }
      publishP2POrderRoom(orderId, 'message:read', {
        readerId: userId,
        orderId,
        lastReadMessageId: lastRead || null,
      });
      return reply.send({ success: true });
    } catch (error) {
      logger.error('P2P message read receipt failed', { error });
      return reply.status(500).send({
        success: false,
        error: { code: 'READ_FAILED', message: 'Failed to record read receipt' },
      });
    }
  });

  /**
   * GET /p2p/my-orders
   * Get user's P2P orders
   */
  app.get('/my-orders', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    try {
      const { id: userId } = request.user!;
      const { status } = request.query as any;
      const modernOrders = await detectP2POrdersModernSchema();

      let query = modernOrders
        ? `
        SELECT 
          po.*,
          c.symbol as crypto_symbol,
          buyer.username as buyer_username,
          seller.username as seller_username
        FROM p2p_orders po
        JOIN currencies c ON po.crypto_currency_id = c.id
        JOIN users buyer ON po.buyer_id = buyer.id
        JOIN users seller ON po.seller_id = seller.id
        WHERE (po.buyer_id = $1 OR po.seller_id = $1)
      `
        : `
        SELECT 
          po.*,
          t.symbol as crypto_symbol,
          buyer.username as buyer_username,
          seller.username as seller_username
        FROM p2p_orders po
        JOIN tokens t ON po.token_id = t.id
        JOIN users buyer ON po.buyer_id = buyer.id
        JOIN users seller ON po.seller_id = seller.id
        WHERE (po.buyer_id = $1 OR po.seller_id = $1)
      `;
      const params: unknown[] = [userId];

      if (status) {
        query += ` AND po.status = $2`;
        params.push(status);
      }

      query += ` ORDER BY po.created_at DESC`;

      const result = await db.query(query, params);

      return reply.send({
        success: true,
        data: result.rows,
      });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to fetch orders' },
      });
    }
  });

  /**
   * GET /p2p/merchant-stats
   * Get merchant statistics
   */
  app.get('/merchant-stats', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    try {
      const { id: userId } = request.user!;

      const result = await db.query(`
        SELECT * FROM p2p_merchant_stats WHERE user_id = $1
      `, [userId]);

      const row = result.rows[0] as Record<string, unknown> | undefined;
      if (!row) {
        return reply.send({ success: true, data: null });
      }
      const total = parseInt(String(row.total_orders ?? 0), 10) || 0;
      const completion = parseFloat(String(row.completion_rate ?? 0)) || 0;
      const rating = parseFloat(String(row.average_rating ?? 0)) || 0;
      const VERIFIED_MIN_ORDERS = 30;
      const VERIFIED_MIN_COMPLETION = 98;
      const VERIFIED_MIN_RATING = 4;
      const verified_merchant = total >= VERIFIED_MIN_ORDERS && completion >= VERIFIED_MIN_COMPLETION && rating >= VERIFIED_MIN_RATING;

      return reply.send({
        success: true,
        data: { ...row, verified_merchant },
      });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to fetch merchant stats' },
      });
    }
  });

  /**
   * GET /p2p/my-payment-methods
   * Get user's payment methods (active only by default; ?include_inactive=1 for management)
   */
  app.get('/my-payment-methods', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    try {
      const { id: userId } = request.user!;
      const q = request.query as { include_inactive?: string };
      const includeInactive = q.include_inactive === '1' || q.include_inactive === 'true';

      const result = await db.query(`
        SELECT 
          upm.id,
          upm.user_id,
          upm.payment_method_id,
          upm.payment_details,
          upm.display_name,
          upm.is_verified,
          upm.is_active,
          upm.created_at,
          upm.updated_at,
          pm.name as method_name,
          pm.code as method_code,
          pm.method_type,
          pm.icon_url
        FROM user_p2p_payment_methods upm
        JOIN p2p_payment_methods pm ON upm.payment_method_id = pm.id
        WHERE upm.user_id = $1${includeInactive ? '' : ' AND upm.is_active = TRUE'}
        ORDER BY upm.is_active DESC, upm.created_at DESC
      `, [userId]);

      return reply.send({
        success: true,
        data: result.rows,
      });
    } catch (error) {
      logger.error('Failed to fetch my payment methods', { error });
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to fetch payment methods' },
      });
    }
  });

  /**
   * POST /p2p/my-payment-methods
   * Add new payment method for user
   */
  app.post<{
    Body: { payment_method_id: string; payment_details?: Record<string, unknown>; display_name?: string };
  }>('/my-payment-methods', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    try {
      const { id: userId } = request.user!;
      const body = request.body || {};
      const paymentMethodId = typeof body.payment_method_id === 'string' ? body.payment_method_id.trim() : '';
      const paymentDetails = body.payment_details != null && typeof body.payment_details === 'object' ? body.payment_details : {};
      const displayName = typeof body.display_name === 'string' ? body.display_name.trim().slice(0, 100) : null;

      if (!paymentMethodId || !UUID_REGEX.test(paymentMethodId)) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Valid payment_method_id (UUID) is required' },
        });
      }

      const pmCheck = await db.query<{ id: string }>(
        'SELECT id FROM p2p_payment_methods WHERE id = $1 AND is_active = TRUE',
        [paymentMethodId]
      );
      if (pmCheck.rows.length === 0) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Invalid or inactive platform payment method' },
        });
      }

      const result = await db.query(
        `INSERT INTO user_p2p_payment_methods (user_id, payment_method_id, payment_details, display_name, is_active)
         VALUES ($1, $2, $3, $4, TRUE)
         RETURNING id, user_id, payment_method_id, payment_details, display_name, is_verified, is_active, created_at, updated_at`,
        [userId, paymentMethodId, JSON.stringify(paymentDetails), displayName]
      );

      const row = result.rows[0]!;
      const joined = await db.query(`
        SELECT upm.*, pm.name as method_name, pm.code as method_code, pm.method_type, pm.icon_url
        FROM user_p2p_payment_methods upm
        JOIN p2p_payment_methods pm ON upm.payment_method_id = pm.id
        WHERE upm.id = $1
      `, [row.id]);

      return reply.status(201).send({
        success: true,
        data: joined.rows[0],
      });
    } catch (error) {
      logger.error('Failed to add payment method', { error });
      return reply.status(500).send({
        success: false,
        error: { code: 'CREATE_FAILED', message: 'Failed to add payment method' },
      });
    }
  });

  /**
   * PATCH /p2p/my-payment-methods/:id
   * Toggle is_active or update method
   */
  app.patch<{
    Params: { id: string };
    Body: { is_active?: boolean; payment_details?: Record<string, unknown>; display_name?: string };
  }>('/my-payment-methods/:id', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    try {
      const { id: userId } = request.user!;
      const id = request.params?.id?.trim();
      const body = request.body || {};

      if (!id || !UUID_REGEX.test(id)) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Valid payment method id is required' },
        });
      }

      const owned = await db.query<{ id: string }>(
        'SELECT id FROM user_p2p_payment_methods WHERE id = $1 AND user_id = $2',
        [id, userId]
      );
      if (owned.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Payment method not found' },
        });
      }

      const updates: string[] = [];
      const values: unknown[] = [];
      let paramIndex = 1;

      if (typeof body.is_active === 'boolean') {
        updates.push(`is_active = $${paramIndex++}`);
        values.push(body.is_active);
      }
      if (body.payment_details != null && typeof body.payment_details === 'object') {
        updates.push(`payment_details = $${paramIndex++}`);
        values.push(JSON.stringify(body.payment_details));
      }
      if (typeof body.display_name === 'string') {
        updates.push(`display_name = $${paramIndex++}`);
        values.push(body.display_name.trim().slice(0, 100));
      }

      if (updates.length === 0) {
        const current = await db.query(`
          SELECT upm.*, pm.name as method_name, pm.code as method_code, pm.method_type, pm.icon_url
          FROM user_p2p_payment_methods upm
          JOIN p2p_payment_methods pm ON upm.payment_method_id = pm.id
          WHERE upm.id = $1
        `, [id]);
        return reply.send({ success: true, data: current.rows[0] });
      }

      values.push(id, userId);
      await db.query(
        `UPDATE user_p2p_payment_methods SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${paramIndex++} AND user_id = $${paramIndex}`,
        values
      );

      const result = await db.query(`
        SELECT upm.*, pm.name as method_name, pm.code as method_code, pm.method_type, pm.icon_url
        FROM user_p2p_payment_methods upm
        JOIN p2p_payment_methods pm ON upm.payment_method_id = pm.id
        WHERE upm.id = $1
      `, [id]);

      return reply.send({
        success: true,
        data: result.rows[0],
      });
    } catch (error) {
      logger.error('Failed to update payment method', { error });
      return reply.status(500).send({
        success: false,
        error: { code: 'UPDATE_FAILED', message: 'Failed to update payment method' },
      });
    }
  });

  /**
   * DELETE /p2p/my-payment-methods/:id
   * Delete user payment method
   */
  app.delete<{ Params: { id: string } }>('/my-payment-methods/:id', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    try {
      const { id: userId } = request.user!;
      const id = request.params?.id?.trim();

      if (!id || !UUID_REGEX.test(id)) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Valid payment method id is required' },
        });
      }

      const result = await db.query(
        'DELETE FROM user_p2p_payment_methods WHERE id = $1 AND user_id = $2 RETURNING id',
        [id, userId]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Payment method not found' },
        });
      }

      return reply.send({
        success: true,
        data: { deleted: true, id },
      });
    } catch (error) {
      logger.error('Failed to delete payment method', { error });
      return reply.status(500).send({
        success: false,
        error: { code: 'DELETE_FAILED', message: 'Failed to delete payment method' },
      });
    }
  });

  // --- P2P order lifecycle (POST). Idempotency on create and release per audit. ---

  /**
   * POST /p2p/orders
   * Create a P2P order. Requires Idempotency-Key. Balance lock happens in p2pService.createOrder.
   */
  app.post<{
    Body: { adId: string; quantity: string; paymentMethodId: string };
  }>('/orders', {
    preHandler: [app.authenticate, rateLimitByUser('p2p:order-create', 30, 60)],
  }, async (request, reply) => {
    const userId = request.user!.id;
    const body = request.body;

    const idempotencyKeyRaw = (request.headers[IDEMPOTENCY_KEY_HEADER] ?? request.headers['Idempotency-Key']) as string | undefined;
    const idempotencyKey = typeof idempotencyKeyRaw === 'string' ? idempotencyKeyRaw.trim() : '';
    if (!idempotencyKey) {
      return reply.status(400).send({
        success: false,
        error: { code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'Idempotency-Key header is required for P2P order creation.' },
      });
    }
    if (idempotencyKey.length > 256) {
      return reply.status(400).send({
        success: false,
        error: { code: 'IDEMPOTENCY_KEY_INVALID', message: 'Idempotency-Key must be at most 256 characters.' },
      });
    }

    const requestHash = buildP2POrderCreateRequestHash(body);
    const redisKey = `p2p:order-create:idempotency:${userId}:${idempotencyKey}`;
    const cached = await redis.getJson<P2POrderCreateIdempotencyCache>(redisKey);
    if (cached) {
      if (cached.requestHash !== requestHash) {
        return reply.status(409).send({
          success: false,
          error: {
            code: 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_BODY',
            message: 'Idempotency-Key was already used with a different request body. Use a new key or the same request body.',
          },
        });
      }
      return reply.status(200).send(cached.response);
    }

    const lockKey = `p2p:order-create:lock:${userId}:${idempotencyKey}`;
    const lockAcquired = await redis.setNxEx(lockKey, '1', P2P_IDEMPOTENCY_LOCK_TTL_SECONDS);
    if (!lockAcquired) {
      return reply.status(409).send({
        success: false,
        error: {
          code: 'DUPLICATE_REQUEST',
          message: 'A P2P order create with this Idempotency-Key is already in progress. Retry after a few seconds.',
        },
      });
    }

    if (!body.adId || !body.quantity || !body.paymentMethodId) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'adId, quantity, and paymentMethodId are required' },
      });
    }
    if (!UUID_REGEX.test(body.adId) || !UUID_REGEX.test(body.paymentMethodId)) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'adId and paymentMethodId must be valid UUIDs' },
      });
    }

    // Tier-1: Sanctions check for both buyer and seller before creating P2P order
    const adParty = await db.query<{ user_id: string; type: string }>(
      'SELECT user_id, type FROM p2p_ads WHERE id = $1',
      [body.adId]
    );
    if (adParty.rows.length === 0) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Ad not found' },
      });
    }
    const adOwnerId = adParty.rows[0]!.user_id;
    const adType = adParty.rows[0]!.type;
    const buyerId = adType === 'sell' ? userId : adOwnerId;
    const sellerId = adType === 'sell' ? adOwnerId : userId;
    const buyerCheck = await checkSanctions({ userId: buyerId, amount: body.quantity, asset: 'P2P' });
    const sellerCheck = await checkSanctions({ userId: sellerId, amount: body.quantity, asset: 'P2P' });
    if (!buyerCheck.allowed) {
      return reply.status(403).send({
        success: false,
        error: { code: 'SANCTIONS_BLOCKED', message: buyerCheck.reason ?? 'Cannot create order: compliance check failed for buyer.' },
      });
    }
    if (!sellerCheck.allowed) {
      return reply.status(403).send({
        success: false,
        error: { code: 'SANCTIONS_BLOCKED', message: sellerCheck.reason ?? 'Cannot create order: compliance check failed for seller.' },
      });
    }

    const ip = (request as { ip?: string }).ip ?? request.headers['x-forwarded-for'] ?? null;
    const ipStr = Array.isArray(ip) ? ip[0] : String(ip ?? '');
    const cfCountry = request.headers['cf-ipcountry'];
    const countryCode = (typeof cfCountry === 'string' ? cfCountry : Array.isArray(cfCountry) ? cfCountry[0] : null) ?? null;
    const decision = await evaluateP2PRisk({
      userId,
      requestId: (request as { id?: string }).id ?? (typeof request.headers['x-request-id'] === 'string' ? request.headers['x-request-id'] : null) ?? null,
      ip: ipStr || undefined,
      countryCode,
      isVpnOrTor: (request as { isVpnOrTor?: boolean }).isVpnOrTor,
    });
    if (decision === 'block') {
      return reply.status(403).send({
        success: false,
        error: { code: 'RISK_BLOCKED', message: 'Request blocked by risk policy' },
      });
    }

    try {
      const order = await p2pService.createOrder({
        userId,
        adId: body.adId,
        quantity: body.quantity,
        paymentMethodId: body.paymentMethodId,
      });
      const response = { success: true as const, data: order as unknown as Record<string, unknown> };
      try {
        await redis.setJson(redisKey, { requestHash, response }, P2P_ORDER_CREATE_IDEMPOTENCY_TTL_SECONDS);
      } catch {
        /* best effort */
      }
      return reply.status(201).send(response);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to create order';
      const code =
        msg === 'TRADING_HALTED'
          ? 'TRADING_HALTED'
          : msg === 'MM_CIRCUIT_TRADING_PAUSED'
            ? 'MM_CIRCUIT_TRADING_PAUSED'
            : msg === 'Ad not found'
              ? 'NOT_FOUND'
              : 'ORDER_FAILED';
      const status =
        msg === 'TRADING_HALTED' || msg === 'MM_CIRCUIT_TRADING_PAUSED' ? 503 : 400;
      return reply.status(status).send({
        success: false,
        error: { code, message: msg },
      });
    }
  });

  /**
   * POST /p2p/orders/:orderId/upload-payment-proof
   * Buyer uploads receipt (PNG/JPEG). Returns proof_url for JSON confirm-payment when not using /pay.
   * When P2P_REQUIRE_PAYMENT_PROOF: cannot replace after first upload (use /pay or one upload + confirm).
   */
  app.post<{ Params: { orderId: string } }>('/orders/:orderId/upload-payment-proof', {
    preHandler: [app.authenticate, rateLimitByUser('p2p:upload-proof', 8, 60)],
  }, async (request, reply) => {
    const userId = request.user!.id;
    const orderId = request.params.orderId;
    if (!orderId || !UUID_REGEX.test(orderId)) {
      return reply.status(400).send({ success: false, error: { code: 'INVALID_ORDER', message: 'Invalid order ID' } });
    }
    const orderCheck = await db.query<{ buyer_id: string; status: string; payment_proof_url: string | null }>(
      `SELECT buyer_id, status, payment_proof_url FROM p2p_orders WHERE id = $1`,
      [orderId]
    );
    if (orderCheck.rows.length === 0) {
      return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Order not found' } });
    }
    const row = orderCheck.rows[0]!;
    if (row.buyer_id !== userId) {
      return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Only buyer can upload payment proof' } });
    }
    if (row.status !== 'payment_pending') {
      return reply.status(400).send({ success: false, error: { code: 'INVALID_STATUS', message: 'Order must be in payment_pending to upload proof' } });
    }
    if (config.p2p.requirePaymentProof && row.payment_proof_url) {
      return reply.status(409).send({
        success: false,
        error: { code: 'PROOF_ALREADY_SUBMITTED', message: 'Proof already uploaded for this order. Use confirm-payment with transaction reference or POST /pay.' },
      });
    }
    const data = await request.file();
    if (!data) {
      return reply.status(400).send({ success: false, error: { code: 'NO_FILE', message: 'No file uploaded' } });
    }
    try {
      const { proofUrl } = await saveP2pPaymentProofFromMultipart(orderId, data, config.p2p.maxPaymentProofBytes);
      return reply.send({ success: true, data: { proof_url: proofUrl } });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'UPLOAD_FAILED';
      if (msg === 'INVALID_IMAGE_TYPE' || msg === 'INVALID_IMAGE_CONTENT') {
        return reply.status(400).send({ success: false, error: { code: msg, message: 'Only valid PNG/JPEG images are allowed.' } });
      }
      if (msg === 'FILE_TOO_LARGE') {
        return reply.status(400).send({
          success: false,
          error: { code: 'FILE_TOO_LARGE', message: `Image exceeds ${config.p2p.maxPaymentProofBytes} bytes` },
        });
      }
      logger.warn('P2P proof upload failed', { orderId, msg });
      return reply.status(500).send({ success: false, error: { code: 'UPLOAD_FAILED', message: 'Failed to save file' } });
    }
  });

  /**
   * POST /p2p/orders/:orderId/pay
   * Buyer marks paid in one step: multipart payment_proof_file + transaction_reference. Requires Idempotency-Key.
   */
  app.post<{ Params: { orderId: string } }>('/orders/:orderId/pay', {
    preHandler: [app.authenticate, rateLimitByUser('p2p:mark-paid', 20, 3600)],
  }, async (request, reply) => {
    const userId = request.user!.id;
    const orderId = request.params.orderId;
    if (!orderId || !UUID_REGEX.test(orderId)) {
      return reply.status(400).send({
        success: false,
        error: { code: 'MISSING_PARAM', message: 'orderId required and must be a valid UUID' },
      });
    }
    const idempotencyKeyRaw = (request.headers[IDEMPOTENCY_KEY_HEADER] ?? request.headers['Idempotency-Key']) as string | undefined;
    const idempotencyKey = typeof idempotencyKeyRaw === 'string' ? idempotencyKeyRaw.trim() : '';
    if (!idempotencyKey) {
      return reply.status(400).send({
        success: false,
        error: { code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'Idempotency-Key header is required.' },
      });
    }
    let transactionReference = '';
    let filePart: MultipartFile | null = null;
    try {
      for await (const part of request.parts()) {
        if (part.type === 'file' && part.fieldname === 'payment_proof_file') {
          filePart = part as MultipartFile;
        } else if (part.type === 'field' && part.fieldname === 'transaction_reference') {
          transactionReference = String((part as { value?: string }).value ?? '').trim();
        }
      }
    } catch {
      return reply.status(400).send({ success: false, error: { code: 'INVALID_MULTIPART', message: 'Invalid multipart body' } });
    }
    if (!filePart) {
      return reply.status(400).send({ success: false, error: { code: 'NO_FILE', message: 'payment_proof_file is required' } });
    }
    if (!transactionReference || transactionReference.length > 256) {
      return reply.status(400).send({
        success: false,
        error: { code: 'TRANSACTION_REFERENCE_REQUIRED', message: 'transaction_reference is required (max 256 chars)' },
      });
    }
    const orderPeek = await db.query<{ buyer_id: string; status: string }>(
      `SELECT buyer_id, status FROM p2p_orders WHERE id = $1`,
      [orderId]
    );
    if (orderPeek.rows.length === 0) {
      return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Order not found' } });
    }
    const peek = orderPeek.rows[0]!;
    if (peek.buyer_id !== userId) {
      return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Only buyer can mark paid' } });
    }
    if (peek.status !== 'payment_pending') {
      return reply.status(400).send({ success: false, error: { code: 'INVALID_STATUS', message: 'Order must be payment_pending' } });
    }
    const requestHash = buildP2PConfirmRequestHash(orderId, '[multipart]', transactionReference);
    const redisKey = `p2p:confirm:idempotency:${userId}:${idempotencyKey}`;
    const cached = await redis.getJson<P2PConfirmIdempotencyCache>(redisKey);
    if (cached) {
      if (cached.requestHash !== requestHash) {
        return reply.status(409).send({
          success: false,
          error: {
            code: 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_BODY',
            message: 'Idempotency-Key was already used for a different request.',
          },
        });
      }
      return reply.send(cached.response);
    }
    const cooldownKey = `p2p:cooldown:${orderId}`;
    if (!(await redis.setNxEx(cooldownKey, '1', P2P_ORDER_COOLDOWN_SECONDS))) {
      return reply.status(429).send({
        success: false,
        error: { code: 'COOLDOWN', message: 'Please wait before retrying this order action.' },
      });
    }
    const lockKey = `p2p:confirm:lock:${userId}:${idempotencyKey}`;
    const lockAcquired = await redis.setNxEx(lockKey, '1', P2P_IDEMPOTENCY_LOCK_TTL_SECONDS);
    if (!lockAcquired) {
      return reply.status(409).send({
        success: false,
        error: { code: 'DUPLICATE_REQUEST', message: 'A payment request is already in progress.' },
      });
    }
    const requestIp = getRequestIp(request);
    try {
      const { proofUrl } = await saveP2pPaymentProofFromMultipart(orderId, filePart, config.p2p.maxPaymentProofBytes);
      const order = await p2pService.confirmPayment(orderId, userId, requestIp, {
        proofUrl,
        transactionReference,
      });
      const response = { success: true as const, data: order as unknown as Record<string, unknown> };
      try {
        await redis.setJson(redisKey, { requestHash, response }, P2P_CONFIRM_IDEMPOTENCY_TTL_SECONDS);
      } catch {
        /* best effort */
      }
      return reply.send(response);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to mark paid';
      if (msg === 'Order not found') {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: msg } });
      }
      const code =
        msg === 'PAYMENT_PROOF_REQUIRED' || msg === 'TRANSACTION_REFERENCE_REQUIRED'
          ? msg
          : msg === 'INVALID_IMAGE_TYPE' || msg === 'INVALID_IMAGE_CONTENT'
            ? 'INVALID_IMAGE'
            : msg === 'FILE_TOO_LARGE' || msg === 'EMPTY_FILE'
              ? msg
              : 'PAY_FAILED';
      return reply.status(400).send({
        success: false,
        error: { code, message: msg },
      });
    }
  });

  /**
   * POST /p2p/orders/:orderId/confirm-payment
   * Buyer confirms payment. When P2P_REQUIRE_PAYMENT_PROOF: body must include proof_url + transaction_reference.
   */
  app.post<{
    Params: { orderId: string };
    Body: { proof_url?: string; transaction_reference?: string };
  }>('/orders/:orderId/confirm-payment', {
    preHandler: [app.authenticate, rateLimitByUser('p2p:confirm-payment', 30, 3600)],
  }, async (request, reply) => {
    const userId = request.user!.id;
    const orderId = request.params.orderId;
    if (!orderId || !UUID_REGEX.test(orderId)) {
      return reply.status(400).send({
        success: false,
        error: { code: 'MISSING_PARAM', message: 'orderId required and must be a valid UUID' },
      });
    }
    const idempotencyKeyRaw = (request.headers[IDEMPOTENCY_KEY_HEADER] ?? request.headers['Idempotency-Key']) as string | undefined;
    const idempotencyKey = typeof idempotencyKeyRaw === 'string' ? idempotencyKeyRaw.trim() : '';
    if (!idempotencyKey) {
      return reply.status(400).send({
        success: false,
        error: { code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'Idempotency-Key header is required for P2P confirm-payment.' },
      });
    }
    if (idempotencyKey.length > 256) {
      return reply.status(400).send({
        success: false,
        error: { code: 'IDEMPOTENCY_KEY_INVALID', message: 'Idempotency-Key must be at most 256 characters.' },
      });
    }
    const proofUrl =
      typeof request.body?.proof_url === 'string' ? request.body.proof_url.trim().slice(0, 2048) : '';
    const transactionReference =
      typeof request.body?.transaction_reference === 'string' ? request.body.transaction_reference.trim().slice(0, 256) : '';
    const requestHash = buildP2PConfirmRequestHash(orderId, proofUrl || undefined, transactionReference || undefined);
    const redisKey = `p2p:confirm:idempotency:${userId}:${idempotencyKey}`;
    const cached = await redis.getJson<P2PConfirmIdempotencyCache>(redisKey);
    if (cached) {
      if (cached.requestHash !== requestHash) {
        return reply.status(409).send({
          success: false,
          error: {
            code: 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_BODY',
            message: 'Idempotency-Key was already used for a different order. Use a new key or the same order.',
          },
        });
      }
      return reply.send(cached.response);
    }
    const cooldownKey = `p2p:cooldown:${orderId}`;
    if (!(await redis.setNxEx(cooldownKey, '1', P2P_ORDER_COOLDOWN_SECONDS))) {
      return reply.status(429).send({
        success: false,
        error: { code: 'COOLDOWN', message: 'Please wait before retrying this order action.' },
      });
    }
    const lockKey = `p2p:confirm:lock:${userId}:${idempotencyKey}`;
    const lockAcquired = await redis.setNxEx(lockKey, '1', P2P_IDEMPOTENCY_LOCK_TTL_SECONDS);
    if (!lockAcquired) {
      return reply.status(409).send({
        success: false,
        error: {
          code: 'DUPLICATE_REQUEST',
          message: 'A confirm-payment with this Idempotency-Key is already in progress. Retry after a few seconds.',
        },
      });
    }
    const requestIp = getRequestIp(request);
    try {
      const order = await p2pService.confirmPayment(orderId, userId, requestIp, {
        proofUrl,
        transactionReference,
      });
      const response = { success: true as const, data: order as unknown as Record<string, unknown> };
      try {
        await redis.setJson(redisKey, { requestHash, response }, P2P_CONFIRM_IDEMPOTENCY_TTL_SECONDS);
      } catch {
        /* best effort */
      }
      return reply.send(response);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to confirm payment';
      if (msg === 'PAYMENT_PROOF_REQUIRED' || msg === 'TRANSACTION_REFERENCE_REQUIRED') {
        return reply.status(400).send({
          success: false,
          error: {
            code: msg,
            message:
              msg === 'PAYMENT_PROOF_REQUIRED'
                ? 'Upload payment proof first (or use POST /pay), then send proof_url with transaction_reference.'
                : 'transaction_reference is required (1–256 characters).',
          },
        });
      }
      if (msg === 'TRANSACTION_REFERENCE_TOO_LONG') {
        return reply.status(400).send({
          success: false,
          error: { code: msg, message: 'transaction_reference must be at most 256 characters' },
        });
      }
      if (msg === 'Order not found') {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: msg } });
      }
      if (msg === 'Only buyer can confirm payment' || msg === 'Invalid order status') {
        return reply.status(400).send({ success: false, error: { code: 'CONFIRM_FAILED', message: msg } });
      }
      return reply.status(400).send({
        success: false,
        error: { code: 'CONFIRM_FAILED', message: msg },
      });
    }
  });

  /**
   * POST /p2p/orders/:orderId/verify-payment
   * Seller marks buyer payment as verified (pending → verified). Required before release when verification is enforced.
   */
  app.post<{ Params: { orderId: string } }>('/orders/:orderId/verify-payment', {
    preHandler: [app.authenticate, rateLimitByUser('p2p:verify-payment', 40, 3600)],
  }, async (request, reply) => {
    const userId = request.user!.id;
    const orderId = request.params.orderId;
    if (!orderId || !UUID_REGEX.test(orderId)) {
      return reply.status(400).send({
        success: false,
        error: { code: 'MISSING_PARAM', message: 'orderId required and must be a valid UUID' },
      });
    }
    const requestIp = getRequestIp(request);
    try {
      const order = await p2pService.sellerVerifyPayment(orderId, userId, requestIp);
      return reply.send({ success: true, data: order as unknown as Record<string, unknown> });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Verify failed';
      if (msg === 'Order not found') {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: msg } });
      }
      if (msg === 'Only seller can verify payment') {
        return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: msg } });
      }
      if (msg === 'Invalid order status' || msg === 'Payment is not pending seller verification') {
        return reply.status(400).send({ success: false, error: { code: 'VERIFY_FAILED', message: msg } });
      }
      return reply.status(400).send({ success: false, error: { code: 'VERIFY_FAILED', message: msg } });
    }
  });

  /**
   * POST /p2p/orders/:orderId/release
   * Seller releases crypto. Requires Idempotency-Key. Backend release is idempotent; this prevents double-submit.
   */
  app.post<{ Params: { orderId: string } }>('/orders/:orderId/release', {
    preHandler: [app.authenticate, rateLimitByUser('p2p:release', 60, 60)],
  }, async (request, reply) => {
    const userId = request.user!.id;
    const orderId = request.params.orderId;
    if (!orderId || !UUID_REGEX.test(orderId)) {
      return reply.status(400).send({
        success: false,
        error: { code: 'MISSING_PARAM', message: 'orderId required and must be a valid UUID' },
      });
    }
    const idempotencyKeyRaw = (request.headers[IDEMPOTENCY_KEY_HEADER] ?? request.headers['Idempotency-Key']) as string | undefined;
    const idempotencyKey = typeof idempotencyKeyRaw === 'string' ? idempotencyKeyRaw.trim() : '';
    if (!idempotencyKey) {
      return reply.status(400).send({
        success: false,
        error: { code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'Idempotency-Key header is required for P2P release.' },
      });
    }
    if (idempotencyKey.length > 256) {
      return reply.status(400).send({
        success: false,
        error: { code: 'IDEMPOTENCY_KEY_INVALID', message: 'Idempotency-Key must be at most 256 characters.' },
      });
    }
    const requestHash = buildP2PReleaseRequestHash(orderId);
    const redisKey = `p2p:release:idempotency:${userId}:${idempotencyKey}`;
    const cached = await redis.getJson<P2PReleaseIdempotencyCache>(redisKey);
    if (cached) {
      if (cached.requestHash !== requestHash) {
        return reply.status(409).send({
          success: false,
          error: {
            code: 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_BODY',
            message: 'Idempotency-Key was already used for a different order. Use a new key or the same order.',
          },
        });
      }
      return reply.send(cached.response);
    }
    const cooldownKey = `p2p:cooldown:${orderId}`;
    if (!(await redis.setNxEx(cooldownKey, '1', P2P_ORDER_COOLDOWN_SECONDS))) {
      return reply.status(429).send({
        success: false,
        error: { code: 'COOLDOWN', message: 'Please wait before retrying this order action.' },
      });
    }
    const lockKey = `p2p:release:lock:${userId}:${idempotencyKey}`;
    const lockAcquired = await redis.setNxEx(lockKey, '1', P2P_IDEMPOTENCY_LOCK_TTL_SECONDS);
    if (!lockAcquired) {
      return reply.status(409).send({
        success: false,
        error: {
          code: 'DUPLICATE_REQUEST',
          message: 'A release with this Idempotency-Key is already in progress. Retry after a few seconds.',
        },
      });
    }

    // Tier-1: KYC required for P2P seller (releaser); sanctions check for both parties before escrow release
    try {
      await assertKycAllowed({ userId, action: 'p2p_sell' });
    } catch (err) {
      if (err instanceof KycPendingError) {
        return reply.status(403).send({
          success: false,
          error: { code: 'KYC_PENDING', message: 'KYC approval is required for releasing crypto. Your application is under review.' },
        });
      }
      return reply.status(403).send({
        success: false,
        error: { code: 'KYC_REQUIRED', message: 'KYC verification is required for selling crypto. Please complete identity verification.' },
      });
    }
    const orderRow = await db.query<{ buyer_id: string; seller_id: string; quantity: string }>(
      'SELECT buyer_id, seller_id, quantity FROM p2p_orders WHERE id = $1',
      [orderId]
    );
    if (orderRow.rows.length === 0) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Order not found' },
      });
    }
    const ord = orderRow.rows[0]!;
    if (ord.seller_id !== userId) {
      return reply.status(403).send({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Only seller can release crypto' },
      });
    }
    const buyerSanctions = await checkSanctions({ userId: ord.buyer_id, amount: ord.quantity, asset: 'P2P' });
    const sellerSanctions = await checkSanctions({ userId: ord.seller_id, amount: ord.quantity, asset: 'P2P' });
    if (!buyerSanctions.allowed || !sellerSanctions.allowed) {
      const reason = !buyerSanctions.allowed ? buyerSanctions.reason : sellerSanctions.reason;
      return reply.status(403).send({
        success: false,
        error: { code: 'SANCTIONS_BLOCKED', message: reason ?? 'Cannot release: compliance check failed.' },
      });
    }

    const requestIp = getRequestIp(request);
    try {
      const order = await p2pService.releaseCrypto(orderId, userId, requestIp);
      const ord = order as { buyerId?: string; sellerId?: string; tokenId?: string; token_id?: string; quantity?: string };
      const tokenId = ord.tokenId ?? ord.token_id;
      const amt = ord.quantity ?? '0';
      if (tokenId && amt !== '0') {
        const symRow = await db.query<{ symbol: string }>('SELECT symbol FROM tokens WHERE id = $1 LIMIT 1', [tokenId]);
        const symbol = symRow.rows[0]?.symbol ?? 'CRYPTO';
        const params = { txnType: 'p2p' as const, asset: symbol, amount: amt, fiatAmount: null, fiatCurrency: null, countryCode: null };
        if (ord.buyerId) {
          recordAndEvaluate({ ...params, userId: ord.buyerId }).catch((e) =>
            logger.warn('AML P2P (buyer) failed (best-effort)', { userId: ord.buyerId, error: e instanceof Error ? e.message : String(e) })
          );
        }
        if (ord.sellerId) {
          recordAndEvaluate({ ...params, userId: ord.sellerId }).catch((e) =>
            logger.warn('AML P2P (seller) failed (best-effort)', { userId: ord.sellerId, error: e instanceof Error ? e.message : String(e) })
          );
        }
      }
      const response = { success: true as const, data: order as unknown as Record<string, unknown> };
      try {
        await redis.setJson(redisKey, { requestHash, response }, P2P_RELEASE_IDEMPOTENCY_TTL_SECONDS);
      } catch {
        /* best effort */
      }
      return reply.send(response);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to release crypto';
      if (msg === 'PAYMENT_NOT_VERIFIED') {
        return reply.status(403).send({
          success: false,
          error: {
            code: 'PAYMENT_NOT_VERIFIED',
            message:
              'Verify the buyer payment (or wait for SLA auto-release) before releasing crypto from escrow.',
          },
        });
      }
      return reply.status(400).send({
        success: false,
        error: { code: 'RELEASE_FAILED', message: msg },
      });
    }
  });

  /**
   * POST /p2p/orders/:orderId/cancel
   * Cancel a P2P order (buyer or seller). Requires Idempotency-Key. Reason required. Cooldown per order.
   */
  app.post<{
    Params: { orderId: string };
    Body: { reason: string };
  }>('/orders/:orderId/cancel', {
    preHandler: [app.authenticate, rateLimitByUser('p2p:cancel', 60, 60)],
  }, async (request, reply) => {
    const userId = request.user!.id;
    const orderId = request.params.orderId;
    const reason = request.body?.reason;
    if (!orderId || !UUID_REGEX.test(orderId)) {
      return reply.status(400).send({
        success: false,
        error: { code: 'MISSING_PARAM', message: 'orderId required and must be a valid UUID' },
      });
    }
    if (typeof reason !== 'string' || reason.trim().length < 1 || reason.length > 500) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'reason is required (1-500 characters)' },
      });
    }
    const idempotencyKeyRaw = (request.headers[IDEMPOTENCY_KEY_HEADER] ?? request.headers['Idempotency-Key']) as string | undefined;
    const idempotencyKey = typeof idempotencyKeyRaw === 'string' ? idempotencyKeyRaw.trim() : '';
    if (!idempotencyKey) {
      return reply.status(400).send({
        success: false,
        error: { code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'Idempotency-Key header is required for P2P cancel.' },
      });
    }
    if (idempotencyKey.length > 256) {
      return reply.status(400).send({
        success: false,
        error: { code: 'IDEMPOTENCY_KEY_INVALID', message: 'Idempotency-Key must be at most 256 characters.' },
      });
    }
    const reasonTrimmed = reason.trim();
    const requestHash = buildP2PCancelRequestHash(orderId, reasonTrimmed);
    const redisKey = `p2p:cancel:idempotency:${userId}:${idempotencyKey}`;
    const cached = await redis.getJson<P2PCancelIdempotencyCache>(redisKey);
    if (cached) {
      if (cached.requestHash !== requestHash) {
        return reply.status(409).send({
          success: false,
          error: {
            code: 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_BODY',
            message: 'Idempotency-Key was already used for a different order or reason. Use a new key or the same request.',
          },
        });
      }
      return reply.send(cached.response);
    }
    const cooldownKey = `p2p:cooldown:${orderId}`;
    if (!(await redis.setNxEx(cooldownKey, '1', P2P_ORDER_COOLDOWN_SECONDS))) {
      return reply.status(429).send({
        success: false,
        error: { code: 'COOLDOWN', message: 'Please wait before retrying this order action.' },
      });
    }
    const lockKey = `p2p:cancel:lock:${userId}:${idempotencyKey}`;
    const lockAcquired = await redis.setNxEx(lockKey, '1', P2P_IDEMPOTENCY_LOCK_TTL_SECONDS);
    if (!lockAcquired) {
      return reply.status(409).send({
        success: false,
        error: {
          code: 'DUPLICATE_REQUEST',
          message: 'A cancel with this Idempotency-Key is already in progress. Retry after a few seconds.',
        },
      });
    }
    const requestIp = getRequestIp(request);
    try {
      const order = await p2pService.cancelOrder(orderId, userId, reasonTrimmed, requestIp);
      const response = { success: true as const, data: order as unknown as Record<string, unknown> };
      try {
        await redis.setJson(redisKey, { requestHash, response }, P2P_CANCEL_IDEMPOTENCY_TTL_SECONDS);
      } catch {
        /* best effort */
      }
      return reply.send(response);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to cancel order';
      return reply.status(400).send({
        success: false,
        error: { code: 'CANCEL_FAILED', message: msg },
      });
    }
  });

  /**
   * POST /p2p/orders/:orderId/dispute
   * Open a dispute (buyer or seller, only when status is payment_confirmed)
   */
  app.post<{
    Params: { orderId: string };
    Body: { reason?: string; evidence?: string[] };
  }>('/orders/:orderId/dispute', {
    preHandler: [app.authenticate, rateLimitByUser('p2p:dispute', 10, 60)],
  }, async (request, reply) => {
    const userId = request.user!.id;
    const orderId = request.params.orderId;
    const reason = typeof request.body?.reason === 'string' ? request.body.reason.trim() : '';
    const evidence = Array.isArray(request.body?.evidence) ? request.body.evidence : undefined;
    if (!orderId || !UUID_REGEX.test(orderId)) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'orderId required and must be a valid UUID' },
      });
    }
    if (reason.length < 10 || reason.length > 1000) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'reason is required (10-1000 characters)' },
      });
    }
    try {
      const dispute = await p2pService.openDispute(orderId, userId, reason, evidence);
      return reply.status(201).send({
        success: true,
        data: dispute,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to open dispute';
      return reply.status(400).send({
        success: false,
        error: { code: 'DISPUTE_FAILED', message: msg },
      });
    }
  });
}
