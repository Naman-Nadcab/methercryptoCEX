import { randomUUID } from 'node:crypto';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config/index.js';
import { db } from '../lib/database.js';
import { Decimal } from '../lib/decimal.js';
import { logger } from '../lib/logger.js';
import { redis } from '../lib/redis.js';
import { getAdminWithPermission } from './admin.fastify.js';
import { redisBlocksHighRiskActions } from '../services/redis-health.service.js';
import { logAuditFromRequest } from '../services/audit-log.service.js';
import { externalLiquidityConfigService } from '../services/external-liquidity-config.service.js';
import { encryptProviderSecret, maskSecret, decryptProviderSecret } from '../lib/hybrid-credentials-crypto.js';
import { testBinanceProviderCredentials } from '../services/hedge-engine.service.js';
import { invalidateBinanceSymbolFiltersCache } from '../services/binance-spot-symbol-filters.service.js';
import { decideExecution } from '../services/hybrid-decision.service.js';
import {
  readHedgeSystemBool,
  setHedgeEmergencyStop,
  setHedgeGlobalEnabled,
  refreshHedgePositionExposureSnapshot,
  HEDGE_PROVIDER_TRIP_FAILURES,
} from '../services/hedge-risk.service.js';
import { getTodayAdverseUsd, getTodayRealizedPnlUsd } from '../services/pnl.service.js';

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

function getRequiredActionReason(request: FastifyRequest): string {
  const fromBody = typeof request.body === 'object' && request.body !== null
    ? (request.body as Record<string, unknown>).reason
    : undefined;
  const fromHeader = request.headers['x-admin-reason'];
  const reason = String(fromBody ?? fromHeader ?? '').trim();
  return reason;
}

const ADMIN_STEP_UP_TTL_SEC = 10 * 60;

async function requireRecentAdminStepUp(
  request: FastifyRequest,
  reply: FastifyReply,
  adminId: string
): Promise<boolean> {
  const cacheKey = `admin:stepup:${adminId}`;
  try {
    const hit = await redis.getClient().get(cacheKey);
    if (hit === '1') return true;
  } catch {
    // best effort; fallback to on-request verification
  }
  const body = typeof request.body === 'object' && request.body !== null ? (request.body as Record<string, unknown>) : {};
  const twofaCodeRaw = body.twofa_code ?? request.headers['x-admin-2fa'];
  const twofaCode = String(twofaCodeRaw ?? '').trim();
  if (!twofaCode) {
    reply.status(401).send({
      success: false,
      error: {
        code: 'STEP_UP_REQUIRED',
        message: 'Recent step-up authentication required',
        hint: 'Provide twofa_code in body or X-Admin-2FA header',
        actionable: true,
      },
    });
    return false;
  }
  try {
    const { admin2FAService } = await import('../services/admin-2fa.service.js');
    const ok = await admin2FAService.verifyTokenForLogin(adminId, twofaCode);
    if (!ok) {
      reply.status(401).send({
        success: false,
        error: {
          code: 'INVALID_2FA',
          message: 'Invalid 2FA code for step-up',
          hint: 'Retry with valid authenticator code',
          actionable: true,
        },
      });
      return false;
    }
    await redis.getClient().set(cacheKey, '1', 'EX', ADMIN_STEP_UP_TTL_SEC);
    return true;
  } catch (e) {
    logger.warn('admin step-up verification failed', { error: e instanceof Error ? e.message : String(e) });
    reply.status(500).send({
      success: false,
      error: {
        code: 'STEP_UP_VERIFICATION_FAILED',
        message: 'Could not verify step-up authentication',
        hint: 'Retry after 2FA service recovery',
        actionable: true,
      },
    });
    return false;
  }
}

export default async function adminHybridRoutes(app: FastifyInstance) {
  app.get('/hybrid/config', async (request, reply) => {
    const admin = await getAdminWithPermission(app, request as FastifyRequest, reply, 'monitoring:view');
    if (!admin) return;
    try {
      const r = await db.query(
        `SELECT id::text, market, enabled,
                small_trade_max_notional_usd::text, large_trade_min_notional_usd::text,
                between_band_policy, hedge_enabled, fallback_to_internal, max_slippage_bps,
                max_hedge_notional_usd_per_order::text, max_net_hedge_exposure_usd::text, hedge_max_daily_loss_usd::text,
                system_counterparty_user_id::text, updated_at::text
         FROM hybrid_execution_config
         ORDER BY market NULLS FIRST`
      );
      return reply.send({ success: true, data: r.rows });
    } catch (e) {
      logger.error('admin hybrid config list failed', { error: e instanceof Error ? e.message : String(e) });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to load hybrid config' } });
    }
  });

  app.patch<{ Body: Record<string, unknown> }>('/hybrid/config', async (request, reply) => {
    const admin = await getAdminWithPermission(app, request, reply, 'markets:manage');
    if (!admin) return;
    if (!(await requireRecentAdminStepUp(request, reply, admin.adminId))) return;
    if (redisBlocksHighRiskActions()) {
      return reply.status(503).send({
        success: false,
        error: { code: 'REDIS_UNAVAILABLE', message: 'Redis unhealthy; hybrid config updates blocked.' },
      });
    }
    const id = typeof request.body?.id === 'string' ? request.body.id : '';
    if (!isUuid(id)) {
      return reply.status(400).send({ success: false, error: { code: 'INVALID_ID', message: 'body.id must be a UUID' } });
    }
    const fields: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    const num = (k: string) => {
      const v = request.body?.[k];
      if (v === undefined) return;
      fields.push(`${k} = $${i++}::numeric`);
      vals.push(String(v));
    };
    const int = (k: string) => {
      const v = request.body?.[k];
      if (v === undefined) return;
      fields.push(`${k} = $${i++}::int`);
      vals.push(parseInt(String(v), 10));
    };
    const bool = (k: string) => {
      const v = request.body?.[k];
      if (v === undefined) return;
      fields.push(`${k} = $${i++}`);
      vals.push(Boolean(v));
    };
    const text = (k: string) => {
      const v = request.body?.[k];
      if (v === undefined) return;
      fields.push(`${k} = $${i++}`);
      vals.push(String(v));
    };
    const uuidNull = (k: string) => {
      const v = request.body?.[k];
      if (v === undefined) return;
      if (v === null) {
        fields.push(`${k} = NULL`);
        return;
      }
      const s = String(v);
      if (!isUuid(s)) return;
      fields.push(`${k} = $${i++}::uuid`);
      vals.push(s);
    };

    bool('enabled');
    num('small_trade_max_notional_usd');
    num('large_trade_min_notional_usd');
    text('between_band_policy');
    bool('hedge_enabled');
    bool('fallback_to_internal');
    int('max_slippage_bps');
    num('max_hedge_notional_usd_per_order');
    num('max_net_hedge_exposure_usd');
    num('hedge_max_daily_loss_usd');
    uuidNull('system_counterparty_user_id');

    if (!fields.length) {
      return reply.status(400).send({ success: false, error: { code: 'NO_FIELDS', message: 'No updatable fields provided' } });
    }
    fields.push('updated_at = NOW()');
    vals.push(id);
    try {
      const q = `UPDATE hybrid_execution_config SET ${fields.join(', ')} WHERE id = $${i}::uuid RETURNING id::text`;
      const r = await db.query(q, vals);
      if (!r.rowCount) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Hybrid config row not found' } });
      }
      await externalLiquidityConfigService.invalidateCache();
      return reply.send({ success: true, data: r.rows[0] });
    } catch (e) {
      logger.error('admin hybrid config patch failed', { error: e instanceof Error ? e.message : String(e) });
      return reply.status(500).send({ success: false, error: { code: 'UPDATE_FAILED', message: 'Failed to update hybrid config' } });
    }
  });

  /** Clone global defaults into a per-market row (unique `market`). Requires active spot_markets row. */
  app.post<{ Body: Record<string, unknown> }>('/hybrid/config', async (request, reply) => {
    const admin = await getAdminWithPermission(app, request, reply, 'markets:manage');
    if (!admin) return;
    if (!(await requireRecentAdminStepUp(request, reply, admin.adminId))) return;
    if (redisBlocksHighRiskActions()) {
      return reply.status(503).send({
        success: false,
        error: { code: 'REDIS_UNAVAILABLE', message: 'Redis unhealthy; hybrid config updates blocked.' },
      });
    }
    const raw = String(request.body?.market ?? '')
      .trim()
      .replace(/-/g, '_')
      .toUpperCase();
    if (!raw) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_BODY', message: 'body.market is required (e.g. BTC_USDT)' },
      });
    }
    try {
      const mkt = await db.query(`SELECT 1 FROM spot_markets WHERE symbol = $1 AND status = 'active' LIMIT 1`, [raw]);
      if (!mkt.rowCount) {
        return reply.status(400).send({
          success: false,
          error: { code: 'UNKNOWN_MARKET', message: `No active spot market ${raw}` },
        });
      }
      const exists = await db.query(`SELECT id FROM hybrid_execution_config WHERE market = $1 LIMIT 1`, [raw]);
      if (exists.rowCount) {
        return reply.status(409).send({
          success: false,
          error: { code: 'ALREADY_EXISTS', message: `Hybrid row already exists for ${raw}` },
        });
      }
      const ins = await db.query<{ id: string }>(
        `INSERT INTO hybrid_execution_config (
           market, enabled, small_trade_max_notional_usd, large_trade_min_notional_usd,
           between_band_policy, hedge_enabled, fallback_to_internal, max_slippage_bps,
           max_hedge_notional_usd_per_order, max_net_hedge_exposure_usd, hedge_max_daily_loss_usd,
           system_counterparty_user_id
         )
         SELECT $1::text, enabled, small_trade_max_notional_usd, large_trade_min_notional_usd,
                between_band_policy, hedge_enabled, fallback_to_internal, max_slippage_bps,
                max_hedge_notional_usd_per_order, max_net_hedge_exposure_usd, hedge_max_daily_loss_usd,
                system_counterparty_user_id
         FROM hybrid_execution_config WHERE market IS NULL LIMIT 1
         RETURNING id::text`,
        [raw]
      );
      const id = ins.rows[0]?.id;
      if (!id) {
        return reply.status(500).send({
          success: false,
          error: { code: 'NO_GLOBAL_ROW', message: 'Global hybrid_execution_config row missing; cannot clone defaults.' },
        });
      }
      await externalLiquidityConfigService.invalidateCache();
      return reply.send({ success: true, data: { id, market: raw } });
    } catch (e) {
      logger.error('admin hybrid per-market create failed', { error: e instanceof Error ? e.message : String(e) });
      return reply.status(500).send({
        success: false,
        error: { code: 'INSERT_FAILED', message: 'Failed to create hybrid config row' },
      });
    }
  });

  /** Remove per-market override only (`market IS NOT NULL`). Global defaults row cannot be deleted. */
  app.delete<{ Params: { id: string } }>('/hybrid/config/:id', async (request, reply) => {
    const admin = await getAdminWithPermission(app, request, reply, 'markets:manage');
    if (!admin) return;
    if (!(await requireRecentAdminStepUp(request, reply, admin.adminId))) return;
    if (redisBlocksHighRiskActions()) {
      return reply.status(503).send({
        success: false,
        error: { code: 'REDIS_UNAVAILABLE', message: 'Redis unhealthy; hybrid config updates blocked.' },
      });
    }
    const id = (request.params.id || '').trim();
    if (!isUuid(id)) {
      return reply.status(400).send({ success: false, error: { code: 'INVALID_ID', message: 'Invalid id' } });
    }
    try {
      const r = await db.query<{ id: string }>(
        `DELETE FROM hybrid_execution_config WHERE id = $1::uuid AND market IS NOT NULL RETURNING id::text`,
        [id]
      );
      if (!r.rowCount) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Per-market hybrid row not found, or refusing to delete global defaults row',
          },
        });
      }
      await externalLiquidityConfigService.invalidateCache();
      return reply.send({ success: true, data: r.rows[0] });
    } catch (e) {
      logger.error('admin hybrid row delete failed', { error: e instanceof Error ? e.message : String(e) });
      return reply.status(500).send({
        success: false,
        error: { code: 'DELETE_FAILED', message: 'Failed to delete hybrid config row' },
      });
    }
  });

  app.get('/external-liquidity/providers', async (request, reply) => {
    const admin = await getAdminWithPermission(app, request as FastifyRequest, reply, 'monitoring:view');
    if (!admin) return;
    try {
      const rows = await externalLiquidityConfigService.listAllProvidersForAdmin();
      return reply.send({ success: true, data: rows });
    } catch (e) {
      logger.error('admin external providers list failed', { error: e instanceof Error ? e.message : String(e) });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to list providers' } });
    }
  });

  app.post<{ Body: Record<string, unknown> }>('/external-liquidity/providers', async (request, reply) => {
    const admin = await getAdminWithPermission(app, request, reply, 'markets:manage');
    if (!admin) return;
    if (!(await requireRecentAdminStepUp(request, reply, admin.adminId))) return;
    if (redisBlocksHighRiskActions()) {
      return reply.status(503).send({
        success: false,
        error: { code: 'REDIS_UNAVAILABLE', message: 'Redis unhealthy; provider create blocked.' },
      });
    }
    const provider_name = String(request.body?.provider_name ?? '').trim();
    const base_url = String(request.body?.base_url ?? '').trim().replace(/\/+$/, '');
    const api_key = String(request.body?.api_key ?? '').trim();
    const api_secret = String(request.body?.api_secret ?? '').trim();
    const enabled = Boolean(request.body?.enabled);
    const is_testnet = Boolean(request.body?.is_testnet);
    const priority = parseInt(String(request.body?.priority ?? '0'), 10) || 0;
    if (!provider_name || !base_url || !api_key || !api_secret) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_BODY', message: 'provider_name, base_url, api_key, api_secret required' },
      });
    }
    try {
      const ins = await db.query<{ id: string }>(
        `INSERT INTO external_liquidity_providers (
           provider_name, enabled, api_key_ciphertext, api_secret_ciphertext, base_url, is_testnet, priority
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id::text`,
        [provider_name, enabled, encryptProviderSecret(api_key), encryptProviderSecret(api_secret), base_url, is_testnet, priority]
      );
      await externalLiquidityConfigService.invalidateCache();
      await invalidateBinanceSymbolFiltersCache();
      return reply.send({ success: true, data: { id: ins.rows[0]?.id } });
    } catch (e) {
      logger.error('admin external provider create failed', { error: e instanceof Error ? e.message : String(e) });
      return reply.status(500).send({ success: false, error: { code: 'INSERT_FAILED', message: 'Failed to create provider' } });
    }
  });

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/external-liquidity/providers/:id',
    async (request, reply) => {
      const admin = await getAdminWithPermission(app, request, reply, 'markets:manage');
      if (!admin) return;
      if (!(await requireRecentAdminStepUp(request, reply, admin.adminId))) return;
      const reason = getRequiredActionReason(request);
      if (reason.length < 8) {
        return reply.status(400).send({
          success: false,
          error: { code: 'REASON_REQUIRED', message: 'reason (min 8 chars) is required for provider updates' },
        });
      }
      if (redisBlocksHighRiskActions()) {
        return reply.status(503).send({
          success: false,
          error: { code: 'REDIS_UNAVAILABLE', message: 'Redis unhealthy; provider update blocked.' },
        });
      }
      const id = (request.params.id || '').trim();
      if (!isUuid(id)) {
        return reply.status(400).send({ success: false, error: { code: 'INVALID_ID', message: 'Invalid provider id' } });
      }
      const before = await db.query<{
        id: string;
        provider_name: string;
        base_url: string;
        enabled: boolean;
        is_testnet: boolean;
        priority: number;
      }>(
        `SELECT id::text, provider_name, base_url, enabled, is_testnet, priority
         FROM external_liquidity_providers WHERE id = $1::uuid`,
        [id]
      );
      if (!before.rowCount) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Provider not found' } });
      }
      const fields: string[] = [];
      const vals: unknown[] = [];
      let i = 1;
      if (request.body?.provider_name !== undefined) {
        fields.push(`provider_name = $${i++}`);
        vals.push(String(request.body.provider_name).trim());
      }
      if (request.body?.base_url !== undefined) {
        fields.push(`base_url = $${i++}`);
        vals.push(String(request.body.base_url).trim().replace(/\/+$/, ''));
      }
      if (request.body?.enabled !== undefined) {
        fields.push(`enabled = $${i++}`);
        vals.push(Boolean(request.body.enabled));
      }
      if (request.body?.is_testnet !== undefined) {
        fields.push(`is_testnet = $${i++}`);
        vals.push(Boolean(request.body.is_testnet));
      }
      if (request.body?.priority !== undefined) {
        fields.push(`priority = $${i++}`);
        vals.push(parseInt(String(request.body.priority), 10) || 0);
      }
      if (request.body?.api_key !== undefined && String(request.body.api_key).trim()) {
        fields.push(`api_key_ciphertext = $${i++}`);
        vals.push(encryptProviderSecret(String(request.body.api_key).trim()));
      }
      if (request.body?.api_secret !== undefined && String(request.body.api_secret).trim()) {
        fields.push(`api_secret_ciphertext = $${i++}`);
        vals.push(encryptProviderSecret(String(request.body.api_secret).trim()));
      }
      if (!fields.length) {
        return reply.status(400).send({ success: false, error: { code: 'NO_FIELDS', message: 'No updatable fields' } });
      }
      fields.push('updated_at = NOW()');
      vals.push(id);
      try {
        const q = `UPDATE external_liquidity_providers
                   SET ${fields.join(', ')}
                   WHERE id = $${i}::uuid
                   RETURNING id::text, provider_name, base_url, enabled, is_testnet, priority`;
        const r = await db.query<{
          id: string;
          provider_name: string;
          base_url: string;
          enabled: boolean;
          is_testnet: boolean;
          priority: number;
        }>(q, vals);
        if (!r.rowCount) {
          return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Provider not found' } });
        }
        await logAuditFromRequest(request, {
          actorType: 'admin',
          actorId: admin.adminId,
          action: 'admin_hybrid_provider_update',
          resourceType: 'external_liquidity_provider',
          resourceId: id,
          oldValue: before.rows[0],
          newValue: {
            ...r.rows[0],
            reason,
            credentials_updated: {
              api_key: request.body?.api_key !== undefined && String(request.body.api_key).trim().length > 0,
              api_secret: request.body?.api_secret !== undefined && String(request.body.api_secret).trim().length > 0,
            },
          },
        });
        await externalLiquidityConfigService.invalidateCache();
        await invalidateBinanceSymbolFiltersCache();
        return reply.send({ success: true, data: r.rows[0] });
      } catch (e) {
        logger.error('admin external provider patch failed', { error: e instanceof Error ? e.message : String(e) });
        return reply.status(500).send({ success: false, error: { code: 'UPDATE_FAILED', message: 'Failed to update provider' } });
      }
    }
  );

  app.delete<{ Params: { id: string } }>('/external-liquidity/providers/:id', async (request, reply) => {
    const admin = await getAdminWithPermission(app, request, reply, 'markets:manage');
    if (!admin) return;
    if (!(await requireRecentAdminStepUp(request, reply, admin.adminId))) return;
    const reason = getRequiredActionReason(request);
    if (reason.length < 8) {
      return reply.status(400).send({
        success: false,
        error: { code: 'REASON_REQUIRED', message: 'reason (min 8 chars) is required for provider deletion' },
      });
    }
    if (redisBlocksHighRiskActions()) {
      return reply.status(503).send({
        success: false,
        error: { code: 'REDIS_UNAVAILABLE', message: 'Redis unhealthy; provider delete blocked.' },
      });
    }
    const id = (request.params.id || '').trim();
    if (!isUuid(id)) {
      return reply.status(400).send({ success: false, error: { code: 'INVALID_ID', message: 'Invalid provider id' } });
    }
    try {
      const current = await db.query<{ id: string; enabled: boolean; provider_name: string; base_url: string; priority: number }>(
        `SELECT id::text, enabled, provider_name, base_url, priority
         FROM external_liquidity_providers WHERE id = $1::uuid`,
        [id]
      );
      if (!current.rowCount) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Provider not found' } });
      }
      if (current.rows[0]?.enabled) {
        return reply.status(409).send({
          success: false,
          error: { code: 'DISABLE_FIRST', message: 'Disable provider before deletion' },
        });
      }

      const inFlight = await db.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n
         FROM hedge_jobs
         WHERE provider_id = $1::uuid
           AND LOWER(status) NOT IN ('completed', 'failed', 'cancelled')`,
        [id]
      );
      const inFlightCount = parseInt(inFlight.rows[0]?.n ?? '0', 10) || 0;
      if (inFlightCount > 0) {
        return reply.status(409).send({
          success: false,
          error: { code: 'PROVIDER_IN_USE', message: `Provider has ${inFlightCount} active hedge job(s)` },
        });
      }

      await db.query(`DELETE FROM external_liquidity_providers WHERE id = $1::uuid`, [id]);
      await logAuditFromRequest(request, {
        actorType: 'admin',
        actorId: admin.adminId,
        action: 'admin_hybrid_provider_delete',
        resourceType: 'external_liquidity_provider',
        resourceId: id,
        oldValue: current.rows[0],
        newValue: { id, deleted: true, reason },
      });
      await externalLiquidityConfigService.invalidateCache();
      await invalidateBinanceSymbolFiltersCache();
      return reply.send({ success: true, data: { id } });
    } catch (e) {
      logger.error('admin external provider delete failed', { error: e instanceof Error ? e.message : String(e) });
      return reply.status(500).send({ success: false, error: { code: 'DELETE_FAILED', message: 'Failed to delete provider' } });
    }
  });

  app.post<{ Body: { provider_ids?: unknown; enabled?: unknown; dry_run?: unknown; reason?: unknown; idempotency_key?: unknown } }>(
    '/external-liquidity/providers/bulk-state',
    async (request, reply) => {
      const admin = await getAdminWithPermission(app, request, reply, 'markets:manage');
      if (!admin) return;
      if (!(await requireRecentAdminStepUp(request, reply, admin.adminId))) return;
      if (redisBlocksHighRiskActions()) {
        return reply.status(503).send({
          success: false,
          error: { code: 'REDIS_UNAVAILABLE', message: 'Redis unhealthy; bulk provider update blocked.' },
        });
      }
      const reason = getRequiredActionReason(request);
      if (reason.length < 8) {
        return reply.status(400).send({
          success: false,
          error: { code: 'REASON_REQUIRED', message: 'reason (min 8 chars) is required for bulk provider updates' },
        });
      }
      const rawIds = Array.isArray(request.body?.provider_ids) ? request.body.provider_ids : [];
      const providerIds = rawIds.map((v) => String(v || '').trim()).filter((v) => isUuid(v));
      if (providerIds.length === 0) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_PROVIDER_IDS', message: 'provider_ids must contain at least one valid UUID' },
        });
      }
      const enabled = request.body?.enabled === true || request.body?.enabled === 'true';
      const dryRun = request.body?.dry_run === true || request.body?.dry_run === 'true';
      const idempotencyKey = String(request.body?.idempotency_key ?? request.headers['idempotency-key'] ?? '').trim();

      const current = await db.query<{
        id: string;
        provider_name: string;
        enabled: boolean;
      }>(
        `SELECT id::text, provider_name, enabled
         FROM external_liquidity_providers
         WHERE id = ANY($1::uuid[])
         ORDER BY provider_name ASC`,
        [providerIds]
      );
      const toUpdate = current.rows.filter((r) => r.enabled !== enabled);
      if (dryRun) {
        return reply.send({
          success: true,
          data: {
            dry_run: true,
            requested: providerIds.length,
            matched: current.rows.length,
            would_update: toUpdate.length,
            target_enabled: enabled,
            provider_ids: toUpdate.map((r) => r.id),
          },
        });
      }

      const idempotencyRedisKey = idempotencyKey
        ? `admin:bulk_provider_state:${admin.adminId}:${idempotencyKey}`
        : '';
      if (idempotencyRedisKey) {
        const existing = await redis.get(idempotencyRedisKey).catch(() => null);
        if (existing) {
          return reply.send({
            success: true,
            data: { idempotent_replay: true, updated: 0, requested: providerIds.length, matched: current.rows.length },
          });
        }
      }

      const updateRes = await db.query(
        `UPDATE external_liquidity_providers
         SET enabled = $2, updated_at = NOW()
         WHERE id = ANY($1::uuid[]) AND enabled IS DISTINCT FROM $2`,
        [providerIds, enabled]
      );
      await logAuditFromRequest(request, {
        actorType: 'admin',
        actorId: admin.adminId,
        action: 'admin_hybrid_provider_bulk_state',
        resourceType: 'external_liquidity_provider',
        resourceId: 'bulk',
        oldValue: { provider_ids: toUpdate.map((r) => r.id), enabled_before_mixed: true },
        newValue: {
          provider_ids: providerIds,
          enabled,
          reason,
          requested: providerIds.length,
          matched: current.rows.length,
          updated: updateRes.rowCount ?? 0,
        },
      });
      if (idempotencyRedisKey) {
        await redis.set(idempotencyRedisKey, '1', 600).catch(() => {});
      }
      await externalLiquidityConfigService.invalidateCache();
      await invalidateBinanceSymbolFiltersCache();
      return reply.send({
        success: true,
        data: {
          dry_run: false,
          requested: providerIds.length,
          matched: current.rows.length,
          updated: updateRes.rowCount ?? 0,
          target_enabled: enabled,
        },
      });
    }
  );

  app.post<{ Params: { id: string } }>('/external-liquidity/providers/:id/test', async (request, reply) => {
    const admin = await getAdminWithPermission(app, request, reply, 'markets:manage');
    if (!admin) return;
    const id = (request.params.id || '').trim();
    if (!isUuid(id)) {
      return reply.status(400).send({ success: false, error: { code: 'INVALID_ID', message: 'Invalid provider id' } });
    }
    try {
      const r = await db.query<{
        base_url: string;
        api_key_ciphertext: string;
        api_secret_ciphertext: string;
      }>(
        `SELECT base_url, api_key_ciphertext, api_secret_ciphertext FROM external_liquidity_providers WHERE id = $1::uuid`,
        [id]
      );
      const row = r.rows[0];
      if (!row?.base_url || !row.api_key_ciphertext || !row.api_secret_ciphertext) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INCOMPLETE_PROVIDER', message: 'Provider missing base_url or credentials' },
        });
      }
      let key: string;
      let sec: string;
      try {
        key = decryptProviderSecret(row.api_key_ciphertext);
        sec = decryptProviderSecret(row.api_secret_ciphertext);
      } catch {
        return reply.status(500).send({
          success: false,
          error: { code: 'DECRYPT_FAILED', message: 'Could not decrypt stored credentials (check ENCRYPTION_KEY)' },
        });
      }
      const t = await testBinanceProviderCredentials(row.base_url, key, sec);
      return reply.send({
        success: t.ok,
        data: {
          httpStatus: t.status,
          ok: t.ok,
          summary: t.ok ? 'Signed request succeeded' : 'Signed request failed',
          bodyPreview:
            typeof t.body === 'object' && t.body !== null
              ? JSON.stringify(t.body).slice(0, 2000)
              : String(t.body).slice(0, 2000),
          apiKeyMask: maskSecret(key),
        },
      });
    } catch (e) {
      logger.error('admin external provider test failed', { error: e instanceof Error ? e.message : String(e) });
      return reply.status(500).send({ success: false, error: { code: 'TEST_FAILED', message: 'Provider test failed' } });
    }
  });

  /** QA only: set HYBRID_DECISION_DEBUG=true. Admin JWT + markets:manage. */
  app.get('/hybrid/decision-test', async (request, reply) => {
    if (!config.hybrid.decisionDebug) {
      return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Not found' } });
    }
    const admin = await getAdminWithPermission(app, request as FastifyRequest, reply, 'markets:manage');
    if (!admin) return;
    if (!(await requireRecentAdminStepUp(request, reply, admin.adminId))) return;
    const q = request.query as Record<string, string | undefined>;
    const market = (q.market ?? '').trim().replace(/-/g, '_').toUpperCase();
    const priceStr = (q.price ?? '').trim();
    const qtyStr = (q.qty ?? '').trim();
    const side = (q.side ?? 'buy').toLowerCase() === 'sell' ? 'sell' : 'buy';
    const type = (q.type ?? 'limit').trim().toLowerCase() || 'limit';
    if (!market || !priceStr || !qtyStr) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION', message: 'Query params market, price, and qty are required' },
      });
    }
    const price = new Decimal(priceStr);
    const qty = new Decimal(qtyStr);
    if (!price.isFinite() || !qty.isFinite() || price.lte(0) || qty.lte(0)) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION', message: 'price and qty must be positive finite numbers' },
      });
    }
    const mRes = await db.query<{ quote_asset: string }>(
      `SELECT quote_asset FROM spot_markets WHERE symbol = $1 LIMIT 1`,
      [market]
    );
    const quoteAsset = mRes.rows[0]?.quote_asset;
    if (!quoteAsset) {
      return reply.status(400).send({
        success: false,
        error: { code: 'UNKNOWN_MARKET', message: `No spot_markets row for ${market}` },
      });
    }
    const quoteIsUsd = ['USDT', 'USD', 'BUSD', 'FDUSD'].includes(quoteAsset.toUpperCase());
    const notionalUsd = quoteIsUsd ? price.mul(qty).toString() : null;
    const decision = await decideExecution({
      userId: randomUUID(),
      market,
      side,
      type,
      notionalUsd,
      quoteIsUsd,
    });
    return reply.send({
      success: true,
      data: {
        decision,
        inputs: { market, side, type, price: priceStr, qty: qtyStr, notionalUsd, quoteAsset, quoteIsUsd },
      },
    });
  });

  app.get('/hybrid/risk/overview', async (request, reply) => {
    const admin = await getAdminWithPermission(app, request as FastifyRequest, reply, 'monitoring:view');
    if (!admin) return;
    try {
      await refreshHedgePositionExposureSnapshot().catch(() => {});
      const [glob, hk, gh, exposures, adverse, todayPnL] = await Promise.all([
        externalLiquidityConfigService.getGlobalHybridConfig(),
        readHedgeSystemBool('hedge_emergency_stop'),
        readHedgeSystemBool('hedge_global_enabled'),
        db.query<{
          market: string;
          exposure_usd: string;
          realized_pnl: string;
          unrealized_pnl: string;
          updated_at: string;
        }>(`SELECT market, exposure_usd::text, realized_pnl::text, unrealized_pnl::text, updated_at::text FROM hedge_positions ORDER BY market`),
        getTodayAdverseUsd(),
        getTodayRealizedPnlUsd(),
      ]);
      const maxDailyLossUsd = glob?.hedge_max_daily_loss_usd ?? '25000';
      return reply.send({
        success: true,
        data: {
          flags: {
            hedge_emergency_stop: hk,
            hedge_global_enabled: gh,
          },
          limits: glob
            ? {
                max_hedge_notional_usd_per_order: glob.max_hedge_notional_usd_per_order,
                max_net_hedge_exposure_usd: glob.max_net_hedge_exposure_usd,
                hedge_max_daily_loss_usd: maxDailyLossUsd,
              }
            : null,
          pnlToday: { signed_realized_usd: todayPnL.toString(), adverse_usd: adverse.toString() },
          exposures: exposures.rows ?? [],
          circuit_trip_failure_count: HEDGE_PROVIDER_TRIP_FAILURES,
        },
      });
    } catch (e) {
      logger.error('admin hybrid risk overview failed', { error: e instanceof Error ? e.message : String(e) });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to load hedge risk overview' } });
    }
  });

  app.post<{ Body: { active?: unknown } }>('/hybrid/risk/emergency-stop', async (request, reply) => {
    const admin = await getAdminWithPermission(app, request as FastifyRequest, reply, 'markets:manage');
    if (!admin) return;
    if (!(await requireRecentAdminStepUp(request, reply, admin.adminId))) return;
    const reason = getRequiredActionReason(request);
    if (reason.length < 8) {
      return reply.status(400).send({
        success: false,
        error: { code: 'REASON_REQUIRED', message: 'reason (min 8 chars) is required for emergency-stop changes' },
      });
    }
    if (redisBlocksHighRiskActions()) {
      return reply.status(503).send({ success: false, error: { code: 'REDIS_UNAVAILABLE', message: 'Redis unhealthy' } });
    }
    const before = await readHedgeSystemBool('hedge_emergency_stop');
    const active = request.body?.active === true || request.body?.active === 'true';
    await setHedgeEmergencyStop(active);
    await logAuditFromRequest(request, {
      actorType: 'admin',
      actorId: admin.adminId,
      action: 'admin_hybrid_risk_emergency_stop',
      resourceType: 'hedge_risk_flags',
      resourceId: 'hedge_emergency_stop',
      oldValue: { hedge_emergency_stop: before },
      newValue: { hedge_emergency_stop: active, reason },
    });
    return reply.send({ success: true, data: { hedge_emergency_stop: active } });
  });

  app.post<{ Body: { enabled?: unknown } }>('/hybrid/risk/global-enabled', async (request, reply) => {
    const admin = await getAdminWithPermission(app, request as FastifyRequest, reply, 'markets:manage');
    if (!admin) return;
    if (!(await requireRecentAdminStepUp(request, reply, admin.adminId))) return;
    const reason = getRequiredActionReason(request);
    if (reason.length < 8) {
      return reply.status(400).send({
        success: false,
        error: { code: 'REASON_REQUIRED', message: 'reason (min 8 chars) is required for hedge global toggle' },
      });
    }
    if (redisBlocksHighRiskActions()) {
      return reply.status(503).send({ success: false, error: { code: 'REDIS_UNAVAILABLE', message: 'Redis unhealthy' } });
    }
    const before = await readHedgeSystemBool('hedge_global_enabled');
    const enabled = request.body?.enabled === true || request.body?.enabled === 'true';
    await setHedgeGlobalEnabled(enabled);
    await logAuditFromRequest(request, {
      actorType: 'admin',
      actorId: admin.adminId,
      action: 'admin_hybrid_risk_global_enabled',
      resourceType: 'hedge_risk_flags',
      resourceId: 'hedge_global_enabled',
      oldValue: { hedge_global_enabled: before },
      newValue: { hedge_global_enabled: enabled, reason },
    });
    return reply.send({ success: true, data: { hedge_global_enabled: enabled } });
  });

  app.post<{ Params: { id: string } }>('/external-liquidity/providers/:id/circuit-reset', async (request, reply) => {
    const admin = await getAdminWithPermission(app, request as FastifyRequest, reply, 'markets:manage');
    if (!admin) return;
    const reason = getRequiredActionReason(request);
    if (reason.length < 8) {
      return reply.status(400).send({
        success: false,
        error: { code: 'REASON_REQUIRED', message: 'reason (min 8 chars) is required for circuit reset' },
      });
    }
    if (redisBlocksHighRiskActions()) {
      return reply.status(503).send({ success: false, error: { code: 'REDIS_UNAVAILABLE', message: 'Redis unhealthy' } });
    }
    const id = (request.params.id || '').trim();
    if (!isUuid(id)) {
      return reply.status(400).send({ success: false, error: { code: 'INVALID_ID', message: 'Invalid provider id' } });
    }
    try {
      const before = await db.query<{
        id: string;
        enabled: boolean;
        consecutive_failures: number;
        last_failure_at: string | null;
      }>(
        `SELECT id::text, enabled, consecutive_failures, last_failure_at::text
         FROM external_liquidity_providers WHERE id = $1::uuid`,
        [id]
      );
      await db.query(
        `UPDATE external_liquidity_providers
         SET enabled = TRUE,
             consecutive_failures = 0,
             last_failure_at = NULL,
             updated_at = NOW()
         WHERE id = $1::uuid`,
        [id]
      );
      await logAuditFromRequest(request, {
        actorType: 'admin',
        actorId: admin.adminId,
        action: 'admin_hybrid_provider_circuit_reset',
        resourceType: 'external_liquidity_provider',
        resourceId: id,
        oldValue: before.rows[0] ?? null,
        newValue: { id, enabled: true, consecutive_failures: 0, last_failure_at: null, reason },
      });
      await externalLiquidityConfigService.invalidateCache();
      return reply.send({ success: true, data: { id, consecutive_failures: 0, enabled: true } });
    } catch (e) {
      logger.error('admin circuit reset failed', { error: e instanceof Error ? e.message : String(e) });
      return reply.status(500).send({ success: false, error: { code: 'UPDATE_FAILED', message: 'Circuit reset failed' } });
    }
  });

  app.post<{ Params: { id: string }; Body: { reason?: unknown; reset_circuit?: unknown } }>(
    '/external-liquidity/providers/:id/failover',
    async (request, reply) => {
      const admin = await getAdminWithPermission(app, request as FastifyRequest, reply, 'markets:manage');
      if (!admin) return;
      if (!(await requireRecentAdminStepUp(request, reply, admin.adminId))) return;
      if (redisBlocksHighRiskActions()) {
        return reply.status(503).send({ success: false, error: { code: 'REDIS_UNAVAILABLE', message: 'Redis unhealthy' } });
      }
      const targetProviderId = (request.params.id || '').trim();
      if (!isUuid(targetProviderId)) {
        return reply.status(400).send({ success: false, error: { code: 'INVALID_ID', message: 'Invalid provider id' } });
      }
      const reason = getRequiredActionReason(request);
      if (reason.length < 8) {
        return reply.status(400).send({
          success: false,
          error: { code: 'REASON_REQUIRED', message: 'reason (min 8 chars) is required for manual failover' },
        });
      }
      const resetCircuit = request.body?.reset_circuit === true || request.body?.reset_circuit === 'true';
      try {
        const [targetRes, currentRes] = await Promise.all([
          db.query<{ id: string; provider_name: string; enabled: boolean; priority: number }>(
            `SELECT id::text, provider_name, enabled, priority
             FROM external_liquidity_providers
             WHERE id = $1::uuid`,
            [targetProviderId]
          ),
          db.query<{ id: string; provider_name: string; priority: number }>(
            `SELECT id::text, provider_name, priority
             FROM external_liquidity_providers
             WHERE enabled = TRUE
             ORDER BY priority DESC, created_at ASC
             LIMIT 1`
          ),
        ]);
        const target = targetRes.rows[0];
        if (!target) {
          return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Provider not found' } });
        }
        const fromProvider = currentRes.rows[0] ?? null;
        const maxPriorityRes = await db.query<{ n: string }>(`SELECT COALESCE(MAX(priority), 0)::text AS n FROM external_liquidity_providers`);
        const nextPriority = (parseInt(maxPriorityRes.rows[0]?.n ?? '0', 10) || 0) + 1;

        await db.transaction(async (client) => {
          await client.query(
            `UPDATE external_liquidity_providers
             SET enabled = TRUE,
                 priority = $2,
                 consecutive_failures = CASE WHEN $3 THEN 0 ELSE consecutive_failures END,
                 last_failure_at = CASE WHEN $3 THEN NULL ELSE last_failure_at END,
                 updated_at = NOW()
             WHERE id = $1::uuid`,
            [targetProviderId, nextPriority, resetCircuit]
          );
          await client.query(
            `INSERT INTO hedge_provider_failover_events (from_provider_id, to_provider_id, mode, reason, actor_admin_id, metadata)
             VALUES ($1::uuid, $2::uuid, 'manual', $3, $4::uuid, $5::jsonb)`,
            [
              fromProvider?.id ?? null,
              targetProviderId,
              reason,
              admin.adminId,
              JSON.stringify({
                reset_circuit: resetCircuit,
                from_provider_name: fromProvider?.provider_name ?? null,
                to_provider_name: target.provider_name,
              }),
            ]
          );
        });

        await logAuditFromRequest(request, {
          actorType: 'admin',
          actorId: admin.adminId,
          action: 'admin_hybrid_provider_manual_failover',
          resourceType: 'external_liquidity_provider',
          resourceId: targetProviderId,
          oldValue: {
            current_primary_provider_id: fromProvider?.id ?? null,
            current_primary_provider_name: fromProvider?.provider_name ?? null,
            target_provider_id: targetProviderId,
            target_enabled: target.enabled,
            target_priority: target.priority,
          },
          newValue: {
            current_primary_provider_id: targetProviderId,
            target_priority: nextPriority,
            reset_circuit: resetCircuit,
            reason,
          },
        });
        await externalLiquidityConfigService.invalidateCache();
        await invalidateBinanceSymbolFiltersCache();
        return reply.send({
          success: true,
          data: {
            from_provider_id: fromProvider?.id ?? null,
            to_provider_id: targetProviderId,
            to_provider_name: target.provider_name,
            new_priority: nextPriority,
            reset_circuit: resetCircuit,
          },
        });
      } catch (e) {
        logger.error('admin manual provider failover failed', { error: e instanceof Error ? e.message : String(e) });
        return reply.status(500).send({ success: false, error: { code: 'FAILOVER_FAILED', message: 'Manual failover failed' } });
      }
    }
  );

  app.get<{ Querystring: { limit?: string } }>('/external-liquidity/failover/history', async (request, reply) => {
    const admin = await getAdminWithPermission(app, request as FastifyRequest, reply, 'monitoring:view');
    if (!admin) return;
    const limitRaw = parseInt(String(request.query?.limit ?? '50'), 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, limitRaw)) : 50;
    try {
      const rows = await db.query<{
        id: string;
        from_provider_id: string | null;
        from_provider_name: string | null;
        to_provider_id: string;
        to_provider_name: string;
        mode: string;
        reason: string;
        actor_admin_id: string | null;
        metadata: unknown;
        created_at: string;
      }>(
        `SELECT
           e.id::text,
           e.from_provider_id::text,
           fp.provider_name AS from_provider_name,
           e.to_provider_id::text,
           tp.provider_name AS to_provider_name,
           e.mode,
           e.reason,
           e.actor_admin_id::text,
           e.metadata,
           e.created_at::text
         FROM hedge_provider_failover_events e
         LEFT JOIN external_liquidity_providers fp ON fp.id = e.from_provider_id
         LEFT JOIN external_liquidity_providers tp ON tp.id = e.to_provider_id
         ORDER BY e.created_at DESC
         LIMIT $1`,
        [limit]
      );
      return reply.send({ success: true, data: rows.rows });
    } catch (e) {
      logger.error('admin failover history fetch failed', { error: e instanceof Error ? e.message : String(e) });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to load failover history' } });
    }
  });
}
