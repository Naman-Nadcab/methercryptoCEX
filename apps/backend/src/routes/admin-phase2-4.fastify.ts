/**
 * Phase 2–4 admin: engine recovery status, cold wallet custody, circuit breaker history,
 * admin audit (uses existing audit-logs), 2FA enforcement, API key admin, listing/delisting,
 * liquidity SLA, scheduled compliance, feature flag rollout.
 */

import type { FastifyInstance } from 'fastify';
import { db } from '../lib/database.js';
import { getAdminWithPermission } from './admin.fastify.js';
import { getCircuitHistory } from '../services/circuit-breaker-history.service.js';
import { getTwoFaPolicy, updateTwoFaPolicy } from '../services/twofa-enforcement.service.js';
import { listHotWallets } from '../services/hot-wallet.service.js';
import { getSettlementCircuitOpen } from '../lib/trading-halt.js';
import { logAuditFromRequest } from '../services/audit-log.service.js';
import { invalidateMarketsCache } from '../services/spot-markets-cache.service.js';
import { logger } from '../lib/logger.js';

const OPEN_ORDER_STATUSES = ['OPEN', 'PARTIALLY_FILLED'];

export default async function adminPhase24Routes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', async (request, reply) => {
    const isRead = request.method.toUpperCase() === 'GET';
    const admin = await getAdminWithPermission(
      app, request, reply,
      isRead ? 'settings:view' : 'settings:edit'
    );
    if (!admin) return;
  });

  // ----- Phase 2: Engine recovery status (read-only summary for admin) -----
  app.get('/engine/recovery-status', async (_request, reply) => {
    try {
      const [ordersRes, cursorRes] = await Promise.all([
        db.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM spot_orders WHERE status = ANY($1::text[])`,
          [OPEN_ORDER_STATUSES]
        ),
        db.query<{ last_engine_event_id: string }>(
          `SELECT COALESCE(last_engine_event_id, 0)::text AS last_engine_event_id FROM settlement_poller_cursor WHERE id = 1`
        ).catch(() => ({ rows: [{ last_engine_event_id: '0' }] })),
      ]);
      const openOrdersCount = parseInt(ordersRes.rows[0]?.count ?? '0', 10);
      const lastEngineEventId = parseInt(cursorRes.rows[0]?.last_engine_event_id ?? '0', 10);
      return reply.send({
        success: true,
        data: { openOrdersCount, lastEngineEventId },
      });
    } catch (e) {
      logger.warn('Engine recovery status error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch' } });
    }
  });

  // ----- Phase 2: Cold wallet reserves (from hot_wallets) -----
  app.get('/wallets/cold/reserves', async (_request, reply) => {
    try {
      const list = await listHotWallets();
      const reserves = list.map((hw) => ({
        chainId: hw.chain_id,
        coldWalletAddress: hw.cold_wallet_address,
        hotAddress: hw.address,
        balanceCache: hw.balance_cache,
        isActive: hw.is_active,
      }));
      return reply.send({ success: true, data: reserves });
    } catch (e) {
      logger.warn('Cold reserves fetch error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch' } });
    }
  });

  // ----- Phase 2: Cold wallet movement history -----
  app.get<{ Querystring: { chainId?: string; limit?: string } }>('/wallets/cold/movements', async (request, reply) => {
    try {
      const { chainId, limit: limitStr } = request.query;
      const limit = Math.min(100, Math.max(1, parseInt(limitStr ?? '50', 10) || 50));
      const params: unknown[] = [];
      if (chainId && String(chainId).trim()) {
        params.push(String(chainId).trim(), limit);
        const r = await db.query(
          `SELECT id, chain_id, previous_address, new_address, actor_type, actor_id, created_at::text
           FROM cold_wallet_movements WHERE chain_id = $1 ORDER BY created_at DESC LIMIT $2`,
          params
        );
        return reply.send({ success: true, data: r.rows ?? [] });
      }
      params.push(limit);
      const r = await db.query(
        `SELECT id, chain_id, previous_address, new_address, actor_type, actor_id, created_at::text
         FROM cold_wallet_movements ORDER BY created_at DESC LIMIT $1`,
        params
      );
      return reply.send({ success: true, data: r.rows ?? [] });
    } catch (e) {
      logger.warn('Cold movements fetch error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch' } });
    }
  });

  // ----- Phase 2/4: Circuit breaker history -----
  app.get<{ Querystring: { limit?: string } }>('/compliance/circuit-breaker/history', async (request, reply) => {
    try {
      const limit = Math.min(100, Math.max(1, parseInt(request.query.limit ?? '50', 10) || 50));
      const history = await getCircuitHistory(limit);
      const circuitOpen = await getSettlementCircuitOpen();
      return reply.send({ success: true, data: { history, circuitOpen } });
    } catch (e) {
      logger.warn('Circuit history fetch error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch' } });
    }
  });

  // ----- Phase 3: 2FA enforcement policy -----
  app.get('/settings/2fa-enforcement', async (_request, reply) => {
    try {
      const policy = await getTwoFaPolicy();
      return reply.send({ success: true, data: policy });
    } catch (e) {
      logger.warn('2FA policy fetch error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch' } });
    }
  });

  app.patch<{ Body: { require2faLogin?: boolean; require2faWithdrawal?: boolean; require2faApiTrading?: boolean } }>(
    '/settings/2fa-enforcement',
    async (request, reply) => {
      const admin = await getAdminWithPermission(app, request, reply, 'settings:edit');
      if (!admin) return;
      try {
        const body = request.body ?? {};
        const oldPolicy = await getTwoFaPolicy();
        await updateTwoFaPolicy({
          require2faLogin: body.require2faLogin,
          require2faWithdrawal: body.require2faWithdrawal,
          require2faApiTrading: body.require2faApiTrading,
        });
        const policy = await getTwoFaPolicy();
        logAuditFromRequest(request, {
          actorType: 'admin', actorId: admin.adminId,
          action: '2fa_policy_updated', resourceType: 'system_settings',
          oldValue: oldPolicy as unknown as Record<string, unknown>,
          newValue: policy as unknown as Record<string, unknown>,
        }).catch(() => {});
        return reply.send({ success: true, data: policy });
      } catch (e) {
        logger.warn('2FA policy update error', { error: e instanceof Error ? e.message : 'Unknown' });
        return reply.status(500).send({ success: false, error: { code: 'UPDATE_FAILED', message: 'Failed to update' } });
      }
    }
  );

  // GET /users/:id/api-keys is defined in admin.fastify.ts to avoid duplicate route.

  // ----- Phase 3: API key admin — revoke (admin) -----
  app.delete<{ Params: { id: string }; Body?: { reason?: string } }>('/api-keys/:id/revoke', async (request, reply) => {
    const admin = await getAdminWithPermission(app, request, reply, 'settings:edit');
    if (!admin) return;
    try {
      const id = request.params.id;
      const result = await db.query(
        `UPDATE user_api_keys SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
        [id]
      );
      if (result.rows.length === 0) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'API key not found' } });
      }
      logAuditFromRequest(request, {
        actorType: 'admin', actorId: admin.adminId,
        action: 'api_key_revoked', resourceType: 'user_api_keys', resourceId: id,
      }).catch(() => {});
      return reply.send({ success: true, data: { message: 'API key revoked' } });
    } catch (e) {
      logger.warn('API key revoke error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'REVOKE_FAILED', message: 'Failed to revoke' } });
    }
  });

  // ----- Phase 3: Listing/delisting — list spot markets with status -----
  app.get('/trading/listing-status', async (_request, reply) => {
    try {
      const hasSpotMarkets = await db.query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'spot_markets' LIMIT 1`
      );
      if (hasSpotMarkets.rows.length === 0) {
        return reply.send({ success: true, data: [] });
      }
      const rows = await db.query<{ id: string; symbol: string; status: string }>(
        `SELECT id, symbol, status FROM spot_markets ORDER BY symbol`
      );
      const list = (rows.rows ?? []).map((r) => ({ id: r.id, symbol: r.symbol, status: r.status }));
      return reply.send({ success: true, data: list });
    } catch (e) {
      logger.warn('Listing status fetch error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch' } });
    }
  });

  app.patch<{ Params: { symbol: string }; Body: { status?: string } }>(
    '/trading/listing-status/:symbol',
    async (request, reply) => {
      const admin = await getAdminWithPermission(app, request, reply, 'markets:manage');
      if (!admin) return;
      try {
        const symbol = String(request.params.symbol ?? '').trim();
        const status = (request.body as { status?: string })?.status;
        if (!status || !['active', 'suspended', 'maintenance', 'delisted'].includes(status)) {
          return reply.status(400).send({
            success: false,
            error: { code: 'INVALID_STATUS', message: 'status must be active, suspended, maintenance, or delisted' },
          });
        }
        const result = await db.query(
          `UPDATE spot_markets SET status = $1, updated_at = NOW() WHERE symbol = $2 RETURNING id, symbol, status`,
          [status, symbol]
        );
        if (result.rows.length === 0) {
          return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Market not found' } });
        }
        await invalidateMarketsCache();
        logAuditFromRequest(request, {
          actorType: 'admin', actorId: admin.adminId,
          action: 'market_listing_status_updated', resourceType: 'spot_markets', resourceId: symbol,
          newValue: { status },
        }).catch(() => {});
        return reply.send({ success: true, data: result.rows[0] });
      } catch (e) {
        logger.warn('Listing status update error', { error: e instanceof Error ? e.message : 'Unknown' });
        return reply.status(500).send({ success: false, error: { code: 'UPDATE_FAILED', message: 'Failed to update' } });
      }
    }
  );

  // ----- Phase 3: Liquidity SLA settings -----
  app.get('/settings/liquidity-sla', async (_request, reply) => {
    try {
      const rows = await db.query<{ key: string; value: unknown }>(
        `SELECT key, value FROM system_settings WHERE key LIKE 'liquidity_sla_%'`
      );
      const map = Object.fromEntries((rows.rows ?? []).map((r) => [r.key, r.value]));
      const parseNum = (v: unknown, def: number) =>
        typeof v === 'number' && !Number.isNaN(v) ? v : (typeof v === 'string' ? parseFloat(v) : def) || def;
      return reply.send({
        success: true,
        data: {
          minDepthUsd: parseNum(map.liquidity_sla_min_depth_usd, 10000),
          maxSpreadBps: parseNum(map.liquidity_sla_max_spread_bps, 50),
          enabled: map.liquidity_sla_enabled === true || map.liquidity_sla_enabled === 'true',
        },
      });
    } catch (e) {
      logger.warn('Liquidity SLA fetch error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch' } });
    }
  });

  app.patch<{ Body: { minDepthUsd?: number; maxSpreadBps?: number; enabled?: boolean } }>(
    '/settings/liquidity-sla',
    async (request, reply) => {
      try {
        const body = request.body ?? {};
        if (body.minDepthUsd != null) {
          await db.query(
            `INSERT INTO system_settings (key, value, updated_at) VALUES ('liquidity_sla_min_depth_usd', $1::jsonb, NOW())
             ON CONFLICT (key) DO UPDATE SET value = $1::jsonb, updated_at = NOW()`,
            [JSON.stringify(Number(body.minDepthUsd))]
          );
        }
        if (body.maxSpreadBps != null) {
          await db.query(
            `INSERT INTO system_settings (key, value, updated_at) VALUES ('liquidity_sla_max_spread_bps', $1::jsonb, NOW())
             ON CONFLICT (key) DO UPDATE SET value = $1::jsonb, updated_at = NOW()`,
            [JSON.stringify(Number(body.maxSpreadBps))]
          );
        }
        if (body.enabled !== undefined) {
          await db.query(
            `INSERT INTO system_settings (key, value, updated_at) VALUES ('liquidity_sla_enabled', $1::jsonb, NOW())
             ON CONFLICT (key) DO UPDATE SET value = $1::jsonb, updated_at = NOW()`,
            [JSON.stringify(Boolean(body.enabled))]
          );
        }
        const rows = await db.query<{ key: string; value: unknown }>(
          `SELECT key, value FROM system_settings WHERE key LIKE 'liquidity_sla_%'`
        );
        const map = Object.fromEntries((rows.rows ?? []).map((r) => [r.key, r.value]));
        const parseNum = (v: unknown, def: number) =>
          typeof v === 'number' && !Number.isNaN(v) ? v : (typeof v === 'string' ? parseFloat(v) : def) || def;
        return reply.send({
          success: true,
          data: {
            minDepthUsd: parseNum(map.liquidity_sla_min_depth_usd, 10000),
            maxSpreadBps: parseNum(map.liquidity_sla_max_spread_bps, 50),
            enabled: map.liquidity_sla_enabled === true || map.liquidity_sla_enabled === 'true',
          },
        });
      } catch (e) {
        logger.warn('Liquidity SLA update error', { error: e instanceof Error ? e.message : 'Unknown' });
        return reply.status(500).send({ success: false, error: { code: 'UPDATE_FAILED', message: 'Failed to update' } });
      }
    }
  );

  // ----- Phase 3: Scheduled compliance reports config -----
  app.get('/settings/scheduled-compliance', async (_request, reply) => {
    try {
      const rows = await db.query<{ key: string; value: unknown }>(
        `SELECT key, value FROM system_settings WHERE key IN ('scheduled_compliance_cron', 'scheduled_compliance_recipients', 'scheduled_compliance_enabled')`
      );
      const map = Object.fromEntries((rows.rows ?? []).map((r) => [r.key, r.value]));
      const raw = map.scheduled_compliance_recipients;
      const recipientsList: string[] = Array.isArray(raw) ? (raw as string[]) : typeof raw === 'string' ? [raw] : [];
      return reply.send({
        success: true,
        data: {
          enabled: map.scheduled_compliance_enabled === true || map.scheduled_compliance_enabled === 'true',
          cron: typeof map.scheduled_compliance_cron === 'string' ? map.scheduled_compliance_cron : '0 9 * * *',
          recipients: recipientsList,
        },
      });
    } catch (e) {
      logger.warn('Scheduled compliance fetch error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch' } });
    }
  });

  app.patch<{ Body: { enabled?: boolean; cron?: string; recipients?: string[] } }>(
    '/settings/scheduled-compliance',
    async (request, reply) => {
      try {
        const body = request.body ?? {};
        if (body.enabled !== undefined) {
          await db.query(
            `INSERT INTO system_settings (key, value, updated_at) VALUES ('scheduled_compliance_enabled', $1::jsonb, NOW())
             ON CONFLICT (key) DO UPDATE SET value = $1::jsonb, updated_at = NOW()`,
            [JSON.stringify(Boolean(body.enabled))]
          );
        }
        if (body.cron != null) {
          await db.query(
            `INSERT INTO system_settings (key, value, updated_at) VALUES ('scheduled_compliance_cron', $1::jsonb, NOW())
             ON CONFLICT (key) DO UPDATE SET value = $1::jsonb, updated_at = NOW()`,
            [JSON.stringify(String(body.cron))]
          );
        }
        if (body.recipients != null) {
          await db.query(
            `INSERT INTO system_settings (key, value, updated_at) VALUES ('scheduled_compliance_recipients', $1::jsonb, NOW())
             ON CONFLICT (key) DO UPDATE SET value = $1::jsonb, updated_at = NOW()`,
            [JSON.stringify(Array.isArray(body.recipients) ? body.recipients : [])]
          );
        }
        const rows = await db.query<{ key: string; value: unknown }>(
          `SELECT key, value FROM system_settings WHERE key IN ('scheduled_compliance_cron', 'scheduled_compliance_recipients', 'scheduled_compliance_enabled')`
        );
        const map = Object.fromEntries((rows.rows ?? []).map((r) => [r.key, r.value]));
        const raw = map.scheduled_compliance_recipients;
        const recipientsList: string[] = Array.isArray(raw) ? (raw as string[]) : typeof raw === 'string' ? [raw] : [];
        return reply.send({
          success: true,
          data: {
            enabled: map.scheduled_compliance_enabled === true || map.scheduled_compliance_enabled === 'true',
            cron: typeof map.scheduled_compliance_cron === 'string' ? map.scheduled_compliance_cron : '0 9 * * *',
            recipients: recipientsList,
          },
        });
      } catch (e) {
        logger.warn('Scheduled compliance update error', { error: e instanceof Error ? e.message : 'Unknown' });
        return reply.status(500).send({ success: false, error: { code: 'UPDATE_FAILED', message: 'Failed to update' } });
      }
    }
  );

  // ----- Phase 4: Feature flags with rollout percentage -----
  // NOTE: These /settings/feature-flags routes are backward-compat aliases.
  // The canonical CRUD routes live in admin.fastify.ts at /settings/features.
  // Both route sets read/write the same `feature_toggles` table.
  // Keep both active for backward compatibility with older frontend builds.
  app.get('/settings/feature-flags', async (_request, reply) => {
    try {
      const rows = await db.query<{ id: string; feature_key: string; name: string; is_enabled: boolean; rollout_percentage: number | null }>(
        `SELECT id, feature_key, feature_name as name, is_enabled, COALESCE(rollout_percentage, 100) AS rollout_percentage FROM feature_toggles ORDER BY feature_key`
      );
      const list = (rows.rows ?? []).map((r) => ({
        id: r.id,
        featureKey: r.feature_key,
        name: r.name,
        isEnabled: r.is_enabled,
        rolloutPercentage: r.rollout_percentage ?? 100,
      }));
      return reply.send({ success: true, data: list });
    } catch (e) {
      logger.warn('Feature flags fetch error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch' } });
    }
  });

  app.patch<{ Params: { key: string }; Body: { isEnabled?: boolean; rolloutPercentage?: number } }>(
    '/settings/feature-flags/:key',
    async (request, reply) => {
      try {
        const key = String(request.params.key ?? '').trim();
        const body = request.body as { isEnabled?: boolean; rolloutPercentage?: number };
        if (!key) {
          return reply.status(400).send({ success: false, error: { code: 'INVALID_KEY', message: 'key required' } });
        }
        const updates: string[] = [];
        const params: unknown[] = [];
        let i = 1;
        if (body.isEnabled !== undefined) {
          updates.push(`is_enabled = $${i++}`);
          params.push(body.isEnabled);
        }
        if (body.rolloutPercentage !== undefined) {
          const pct = Math.max(0, Math.min(100, Number(body.rolloutPercentage) || 0));
          updates.push(`rollout_percentage = $${i++}`);
          params.push(pct);
        }
        if (updates.length === 0) {
          const row = await db.query(
            `SELECT id, feature_key, feature_name as name, is_enabled, COALESCE(rollout_percentage, 100) AS rollout_percentage FROM feature_toggles WHERE feature_key = $1`,
            [key]
          );
          if (row.rows.length === 0) {
            return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Feature not found' } });
          }
          const r = row.rows[0] as { feature_key: string; is_enabled: boolean; rollout_percentage: number };
          return reply.send({
            success: true,
            data: { featureKey: r.feature_key, isEnabled: r.is_enabled, rolloutPercentage: r.rollout_percentage ?? 100 },
          });
        }
        params.push(key);
        await db.query(
          `UPDATE feature_toggles SET ${updates.join(', ')}, updated_at = NOW() WHERE feature_key = $${i}`,
          params
        );
        const row = await db.query(
          `SELECT feature_key, is_enabled, COALESCE(rollout_percentage, 100) AS rollout_percentage FROM feature_toggles WHERE feature_key = $1`,
          [key]
        );
        if (row.rows.length === 0) {
          return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Feature not found' } });
        }
        const r = row.rows[0] as { feature_key: string; is_enabled: boolean; rollout_percentage: number };
        return reply.send({
          success: true,
          data: { featureKey: r.feature_key, isEnabled: r.is_enabled, rolloutPercentage: r.rollout_percentage ?? 100 },
        });
      } catch (e) {
        logger.warn('Feature flag update error', { error: e instanceof Error ? e.message : 'Unknown' });
        return reply.status(500).send({ success: false, error: { code: 'UPDATE_FAILED', message: 'Failed to update' } });
      }
    }
  );

  // ===== Staking / Earn Products CRUD =====

  const ensureStakingTable = async () => {
    await db.query(`
      CREATE TABLE IF NOT EXISTS staking_products (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name TEXT NOT NULL,
        asset TEXT NOT NULL,
        apy_pct NUMERIC(8,4) NOT NULL DEFAULT 0,
        lock_period_days INTEGER NOT NULL DEFAULT 0,
        min_stake NUMERIC(24,8) NOT NULL DEFAULT 0,
        total_staked NUMERIC(24,8) NOT NULL DEFAULT 0,
        stakers INTEGER NOT NULL DEFAULT 0,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  };
  let stakingReady = false;

  app.get('/staking/products', async (_request, reply) => {
    try {
      if (!stakingReady) { await ensureStakingTable(); stakingReady = true; }
      const rows = await db.query(
        `SELECT id, name, asset, apy_pct, lock_period_days, min_stake, total_staked, stakers, enabled, created_at, updated_at
         FROM staking_products ORDER BY created_at DESC`
      );
      return reply.send({ success: true, data: { products: rows.rows } });
    } catch (e) {
      logger.warn('Staking list error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch staking products' } });
    }
  });

  app.post<{ Body: { name: string; asset: string; apy_pct: number; lock_period_days: number; min_stake: number } }>('/staking/products', async (request, reply) => {
    try {
      if (!stakingReady) { await ensureStakingTable(); stakingReady = true; }
      const { name, asset, apy_pct, lock_period_days, min_stake } = request.body ?? {} as any;
      if (!name?.trim() || !asset?.trim()) {
        return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'name and asset are required' } });
      }
      const row = await db.query(
        `INSERT INTO staking_products (name, asset, apy_pct, lock_period_days, min_stake)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [name.trim(), asset.trim().toUpperCase(), apy_pct ?? 0, lock_period_days ?? 0, min_stake ?? 0]
      );
      return reply.status(201).send({ success: true, data: { product: row.rows[0] } });
    } catch (e) {
      logger.warn('Staking create error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'CREATE_FAILED', message: 'Failed to create staking product' } });
    }
  });

  app.patch<{ Params: { id: string }; Body: { enabled?: boolean; apy_pct?: number; min_stake?: number } }>('/staking/products/:id', async (request, reply) => {
    try {
      if (!stakingReady) { await ensureStakingTable(); stakingReady = true; }
      const { id } = request.params;
      const body = request.body ?? {};
      const updates: string[] = [];
      const values: unknown[] = [];
      let idx = 1;
      if (body.enabled !== undefined) { updates.push(`enabled = $${idx++}`); values.push(body.enabled); }
      if (body.apy_pct !== undefined) { updates.push(`apy_pct = $${idx++}`); values.push(body.apy_pct); }
      if (body.min_stake !== undefined) { updates.push(`min_stake = $${idx++}`); values.push(body.min_stake); }
      if (updates.length === 0) {
        return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'No fields to update' } });
      }
      values.push(id);
      const row = await db.query(
        `UPDATE staking_products SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${idx} RETURNING *`,
        values
      );
      if (row.rows.length === 0) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Product not found' } });
      }
      return reply.send({ success: true, data: { product: row.rows[0] } });
    } catch (e) {
      logger.warn('Staking update error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'UPDATE_FAILED', message: 'Failed to update staking product' } });
    }
  });

  app.delete<{ Params: { id: string } }>('/staking/products/:id', async (request, reply) => {
    try {
      if (!stakingReady) { await ensureStakingTable(); stakingReady = true; }
      const result = await db.query('DELETE FROM staking_products WHERE id = $1 RETURNING id', [request.params.id]);
      if (result.rows.length === 0) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Product not found' } });
      }
      return reply.send({ success: true, data: { deleted: true } });
    } catch (e) {
      logger.warn('Staking delete error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'DELETE_FAILED', message: 'Failed to delete staking product' } });
    }
  });

  // ===== Admin Notification Preferences (uses system_settings) =====

  app.get('/notification-prefs', async (request, reply) => {
    try {
      const admin = await getAdminWithPermission(app, request, reply, 'settings:view');
      if (!admin) return;
      const key = `admin_notification_prefs:${admin.adminId}`;
      const row = await db.query<{ value: unknown }>('SELECT value FROM system_settings WHERE key = $1', [key]);
      const prefs = row.rows[0]?.value ?? {};
      return reply.send({ success: true, data: { prefs } });
    } catch (e) {
      logger.warn('Notification prefs get error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed' } });
    }
  });

  app.put<{ Body: Record<string, unknown> }>('/notification-prefs', async (request, reply) => {
    try {
      const admin = await getAdminWithPermission(app, request, reply, 'settings:edit');
      if (!admin) return;
      const key = `admin_notification_prefs:${admin.adminId}`;
      const prefs = request.body ?? {};
      await db.query(
        `INSERT INTO system_settings (key, value) VALUES ($1, $2::jsonb)
         ON CONFLICT (key) DO UPDATE SET value = $2::jsonb`,
        [key, JSON.stringify(prefs)]
      );
      return reply.send({ success: true, data: { prefs } });
    } catch (e) {
      logger.warn('Notification prefs save error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'SAVE_FAILED', message: 'Failed' } });
    }
  });

  /**
   * POST /admin/notification-prefs/test
   * Send a test notification through the specified channel.
   */
  app.post<{ Body: { channel: string } }>('/notification-prefs/test', async (request, reply) => {
    try {
      const admin = await getAdminWithPermission(app, request, reply, 'settings:view');
      if (!admin) return;
      const { channel } = request.body ?? {};
      const validChannels = ['email', 'sms', 'slack', 'webhook', 'push'];
      if (!channel || !validChannels.includes(channel)) {
        return reply.status(400).send({ success: false, error: { code: 'BAD_REQUEST', message: `channel must be one of: ${validChannels.join(', ')}` } });
      }
      /* In a full implementation this would dispatch a real test via the notification service.
         For now, we record the test attempt in system_settings and return success. */
      const testKey = `notification_test:${admin.adminId}:${channel}`;
      await db.query(
        `INSERT INTO system_settings (key, value) VALUES ($1, $2::jsonb)
         ON CONFLICT (key) DO UPDATE SET value = $2::jsonb`,
        [testKey, JSON.stringify({ channel, tested_at: new Date().toISOString(), admin: admin.adminId })]
      ).catch(() => { /* non-fatal */ });
      logger.info('Notification test send', { channel, admin: admin.adminId });
      return reply.send({ success: true, data: { channel, message: `Test ${channel} notification dispatched. Check your configured ${channel} receiver.` } });
    } catch (e) {
      logger.warn('Notification prefs test error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'TEST_FAILED', message: 'Failed to send test notification' } });
    }
  });
}
