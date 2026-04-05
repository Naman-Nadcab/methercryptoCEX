/**
 * Admin Integrations — indexer monitor, price oracle, geo-blocking, sanctions, network risk.
 * All require admin auth. Settings persisted in system_settings where applicable.
 */

import type { FastifyInstance } from 'fastify';
import { db } from '../lib/database.js';
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';
import { getAdminWithPermission } from './admin.fastify.js';
import { logAuditFromRequest } from '../services/audit-log.service.js';

const INDEXER_URL = process.env.INDEXER_API_URL || process.env.INDEXER_URL || 'http://localhost:4001';
const GEO_BLOCK_KEY = 'GEO_BLOCKED_COUNTRIES';
const GEO_BLOCK_ENABLED_KEY = 'GEO_BLOCKING_ENABLED';
const ORACLE_PREFIX = 'oracle.';

export default async function adminIntegrationsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (request, reply) => {
    const isRead = request.method.toUpperCase() === 'GET';
    const admin = await getAdminWithPermission(
      app, request, reply,
      isRead ? 'monitoring:view' : 'settings:edit'
    );
    if (!admin) return;
  });

  // ----- Indexer Monitor -----
  app.get('/indexer/status', async (request, reply) => {
    try {
      type IndexerChainStats = { chain?: string; lastProcessedBlock?: number; isRunning?: boolean; watchedAddresses?: number };
      let indexerStats: Record<string, IndexerChainStats> = {};
      try {
        const res = await fetch(`${INDEXER_URL.replace(/\/$/, '')}/stats`, { signal: AbortSignal.timeout(5000) });
        if (res.ok) {
          const json = (await res.json()) as { success?: boolean; data?: Record<string, IndexerChainStats> };
          if (json?.success && json?.data) indexerStats = json.data;
        }
      } catch (e) {
        logger.warn('Indexer stats fetch failed', { error: e instanceof Error ? e.message : 'Unknown' });
      }

      let pendingByChain: { rows: Array<{ chain: string; chain_name: string; pending: string; confirming: string }> } = { rows: [] };
      let chainList: Array<{ id: string; name: string }> = [];
      try {
        const hasBlockchain = await db.query<{ exists: boolean }>(
          `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'blockchains') AS exists`
        ).then(r => r.rows[0]?.exists === true);
        if (hasBlockchain) {
          pendingByChain = await db.query(
            `SELECT d.blockchain_id::text AS chain, COALESCE(b.chain_name, b.chain_symbol, 'unknown') AS chain_name,
                    COUNT(*) FILTER (WHERE d.status IN ('pending', 'detected'))::text AS pending,
                    COUNT(*) FILTER (WHERE d.status = 'confirming')::text AS confirming
             FROM deposits d LEFT JOIN blockchains b ON d.blockchain_id = b.id
             WHERE d.status IN ('pending', 'confirming', 'detected')
             GROUP BY d.blockchain_id, b.chain_name, b.chain_symbol`
          );
          const ch = await db.query<{ id: string; name: string }>(`SELECT id::text, COALESCE(chain_name, chain_symbol, id::text) AS name FROM blockchains LIMIT 50`);
          chainList = ch.rows ?? [];
        } else {
          const hasChainId = await db.query<{ exists: boolean }>(
            `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'deposits' AND column_name = 'chain_id') AS exists`
          ).then(r => r.rows[0]?.exists === true);
          if (hasChainId) {
            pendingByChain = await db.query(
              `SELECT d.chain_id AS chain, COALESCE(c.name, 'unknown') AS chain_name,
                      COUNT(*) FILTER (WHERE d.status IN ('pending', 'detected'))::text AS pending,
                      COUNT(*) FILTER (WHERE d.status = 'confirming')::text AS confirming
               FROM deposits d LEFT JOIN chains c ON d.chain_id = c.id
               WHERE d.status IN ('pending', 'confirming', 'detected')
               GROUP BY d.chain_id, c.name`
            );
            const ch = await db.query<{ id: string; name: string }>(`SELECT id::text, name FROM chains LIMIT 50`);
            chainList = ch.rows ?? [];
          }
        }
        if (chainList.length === 0 && pendingByChain.rows?.length) {
          chainList = pendingByChain.rows.map(r => ({ id: r.chain, name: r.chain_name }));
        }
      } catch (_) {
        // ignore
      }

      const statusByChain = chainList.map((ch) => {
        const idx = indexerStats[ch.id] || indexerStats[ch.name];
        const row = pendingByChain.rows?.find(r => r.chain === ch.id || r.chain_name === ch.name);
        return {
          chain: ch.name,
          chainId: ch.id,
          current_block_height: idx?.lastProcessedBlock ?? null,
          last_processed_block: idx?.lastProcessedBlock ?? null,
          pending_deposits: parseInt(row?.pending ?? '0', 10),
          confirming_deposits: parseInt(row?.confirming ?? '0', 10),
          sync_status: idx?.isRunning ? 'syncing' : (row ? 'pending' : 'idle'),
        };
      });

      const confirmationsTimeline = await db.query<{ hour: string; count: string }>(
        `SELECT date_trunc('hour', created_at) AS hour, COUNT(*)::text AS count
         FROM deposits WHERE status = 'completed' AND created_at > NOW() - INTERVAL '24 hours'
         GROUP BY 1 ORDER BY 1`
      ).catch(() => ({ rows: [] }));

      return reply.send({
        success: true,
        data: {
          chains: statusByChain,
          blockProgress: statusByChain.map(s => ({ chain: s.chain, block: s.last_processed_block ?? 0 })),
          confirmationsTimeline: (confirmationsTimeline.rows ?? []).map(r => ({ hour: r.hour, count: parseInt(r.count, 10) })),
          pendingPerChain: statusByChain.map(s => ({ chain: s.chain, pending: s.pending_deposits + s.confirming_deposits })),
        },
      });
    } catch (e) {
      logger.warn('Indexer status error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch indexer status' } });
    }
  });

  // ----- Price Oracle -----
  app.get('/oracle/status', async (request, reply) => {
    try {
      const settingsRes = await db.query<{ key: string; value: unknown }>(
        `SELECT key, value FROM system_settings WHERE key LIKE $1`,
        [`${ORACLE_PREFIX}%`]
      );
      const settings: Record<string, string> = {};
      (settingsRes.rows ?? []).forEach(r => { settings[r.key.replace(ORACLE_PREFIX, '')] = String(r.value ?? ''); });

      const lastUpdate = await redis.get('oracle:last_update').catch(() => null);
      const lastError = await redis.get('oracle:last_error').catch(() => null);
      const latency = await redis.get('oracle:last_latency_ms').catch(() => null);

      let prices: Array<{ symbol: string; price: string; updated_at: string }> = [];
      try {
        const hasSymbol = await db.query<{ exists: boolean }>(
          `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'market_prices' AND column_name = 'symbol') AS exists`
        ).then(r => r.rows[0]?.exists === true);
        if (hasSymbol) {
          const r = await db.query<{ symbol: string; price: string; updated_at: string }>(`SELECT symbol, price::text, last_updated::text AS updated_at FROM market_prices ORDER BY last_updated DESC LIMIT 20`);
          prices = r.rows ?? [];
        } else {
          const r = await db.query<{ symbol: string; price: string; updated_at: string }>(
            `SELECT (b.symbol || '_' || q.symbol) AS symbol, mp.price::text, mp.last_updated::text AS updated_at
             FROM market_prices mp JOIN currencies b ON mp.base_currency_id = b.id JOIN currencies q ON mp.quote_currency_id = q.id
             ORDER BY mp.last_updated DESC LIMIT 20`
          );
          prices = r.rows ?? [];
        }
      } catch (_) {
        // ignore
      }

      return reply.send({
        success: true,
        data: {
          provider: settings.provider || 'binance',
          updateIntervalSec: parseInt(settings.updateIntervalSec || '60', 10),
          failoverProvider: settings.failoverProvider || '',
          maxDeviationThreshold: parseFloat(settings.maxDeviationThreshold || '0.05'),
          lastUpdate: lastUpdate || null,
          lastError: lastError || null,
          lastLatencyMs: latency ? parseInt(latency, 10) : null,
          prices: prices.slice(0, 10),
          latencySeries: await (async () => {
            try {
              const raw = await redis.get('oracle:latency_series').catch(() => null);
              if (raw) return JSON.parse(raw);
            } catch { /* ignore */ }
            return [];
          })(),
          deviationSeries: await (async () => {
            try {
              const raw = await redis.get('oracle:deviation_series').catch(() => null);
              if (raw) return JSON.parse(raw);
            } catch { /* ignore */ }
            return [];
          })(),
        },
      });
    } catch (e) {
      logger.warn('Oracle status error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch oracle status' } });
    }
  });

  app.patch<{ Body: { provider?: string; updateIntervalSec?: number; failoverProvider?: string; maxDeviationThreshold?: number } }>('/oracle/settings', async (request, reply) => {
    const admin = await getAdminWithPermission(app, request, reply, 'settings:edit');
    if (!admin) return;
    try {
      const body = request.body || {};
      const toSet: Record<string, string> = {};
      if (body.provider != null) toSet[`${ORACLE_PREFIX}provider`] = String(body.provider);
      if (body.updateIntervalSec != null) toSet[`${ORACLE_PREFIX}updateIntervalSec`] = String(body.updateIntervalSec);
      if (body.failoverProvider != null) toSet[`${ORACLE_PREFIX}failoverProvider`] = String(body.failoverProvider);
      if (body.maxDeviationThreshold != null) toSet[`${ORACLE_PREFIX}maxDeviationThreshold`] = String(body.maxDeviationThreshold);
      for (const [k, v] of Object.entries(toSet)) {
        await db.query(
          `INSERT INTO system_settings (key, value, updated_at) VALUES ($1, $2::jsonb, NOW())
           ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = NOW()`,
          [k, JSON.stringify(v)]
        );
      }
      logAuditFromRequest(request, {
        actorType: 'admin', actorId: admin.adminId,
        action: 'oracle_settings_updated', resourceType: 'system_settings',
        newValue: toSet,
      }).catch(() => {});
      return reply.send({ success: true, data: { message: 'Oracle settings updated' } });
    } catch (e) {
      logger.warn('Oracle settings update error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'UPDATE_FAILED', message: 'Failed to update' } });
    }
  });

  // ----- Geo Blocking -----
  app.get('/security/geo-blocking', async (request, reply) => {
    try {
      const rows = await db.query<{ key: string; value: unknown }>(
        `SELECT key, value FROM system_settings WHERE key IN ($1, $2)`,
        [GEO_BLOCK_KEY, GEO_BLOCK_ENABLED_KEY]
      );
      const map = Object.fromEntries((rows.rows ?? []).map(r => [r.key, r.value]));
      const countriesStr = map[GEO_BLOCK_KEY];
      const list = typeof countriesStr === 'string'
        ? countriesStr.split(',').map(c => c.trim().toUpperCase()).filter(Boolean)
        : (Array.isArray(countriesStr) ? (countriesStr as string[]) : []);
      const enabled = map[GEO_BLOCK_ENABLED_KEY] === 'true' || map[GEO_BLOCK_ENABLED_KEY] === true;

      const loginByCountry = await db.query<{ country: string; count: string }>(
        `SELECT COALESCE(activity_details->>'country', 'UNKNOWN') AS country, COUNT(*)::text AS count
         FROM user_activity_logs WHERE activity_type = 'login' AND created_at > NOW() - INTERVAL '7 days'
         GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 15`
      ).catch(() => ({ rows: [] }));

      const blockedAttempts = await db.query<{ country: string; count: string }>(
        `SELECT COALESCE(activity_details->>'country', 'UNKNOWN') AS country, COUNT(*)::text AS count
         FROM user_activity_logs WHERE activity_type = 'login_blocked_geo' AND created_at > NOW() - INTERVAL '7 days'
         GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 10`
      ).catch(() => ({ rows: [] }));

      return reply.send({
        success: true,
        data: {
          enabled,
          blockedCountries: list,
          loginByCountry: (loginByCountry.rows ?? []).map(r => ({ country: r.country, count: parseInt(r.count, 10) })),
          blockedAttempts: (blockedAttempts.rows ?? []).map(r => ({ country: r.country, count: parseInt(r.count, 10) })),
          userDistribution: loginByCountry.rows ?? [],
        },
      });
    } catch (e) {
      logger.warn('Geo-blocking fetch error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch' } });
    }
  });

  app.patch<{ Body: { enabled?: boolean; blockedCountries?: string[] } }>('/security/geo-blocking', async (request, reply) => {
    const admin = await getAdminWithPermission(app, request, reply, 'settings:edit');
    if (!admin) return;
    try {
      const { enabled, blockedCountries } = request.body || {};
      if (enabled !== undefined) {
        await db.query(
          `INSERT INTO system_settings (key, value, updated_at) VALUES ($1, $2::jsonb, NOW())
           ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = NOW()`,
          [GEO_BLOCK_ENABLED_KEY, JSON.stringify(enabled ? 'true' : 'false')]
        );
        await redis.set('geo_block:enabled', enabled ? '1' : '0').catch(() => {});
      }
      if (blockedCountries !== undefined) {
        const str = Array.isArray(blockedCountries) ? blockedCountries.map(c => c.trim().toUpperCase()).filter(Boolean).join(',') : '';
        await db.query(
          `INSERT INTO system_settings (key, value, updated_at) VALUES ($1, $2::jsonb, NOW())
           ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = NOW()`,
          [GEO_BLOCK_KEY, JSON.stringify(str)]
        );
        await redis.set('geo_block:countries', str).catch(() => {});
      }
      logAuditFromRequest(request, {
        actorType: 'admin', actorId: admin.adminId,
        action: 'geo_blocking_updated', resourceType: 'system_settings',
        newValue: { enabled, blockedCountries },
      }).catch(() => {});
      return reply.send({ success: true, data: { message: 'Updated' } });
    } catch (e) {
      logger.warn('Geo-blocking update error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'UPDATE_FAILED', message: 'Failed to update' } });
    }
  });

  // ----- Sanctions Dashboard -----
  app.get('/compliance/sanctions', async (request, reply) => {
    try {
      const hits = await db.query<{ date: string; count: string }>(
        `SELECT date_trunc('day', created_at) AS date, COUNT(*)::text AS count
         FROM aml_alerts WHERE alert_type LIKE '%sanctions%' OR details::text ILIKE '%sanctions%'
         AND created_at > NOW() - INTERVAL '30 days'
         GROUP BY 1 ORDER BY 1`
      ).catch(() => ({ rows: [] }));

      const blockedWithdrawals = await db.query<{ date: string; count: string }>(
        `SELECT date_trunc('day', updated_at) AS date, COUNT(*)::text AS count
         FROM withdrawals WHERE status = 'failed' AND (failed_reason ILIKE '%sanctions%' OR rejection_reason ILIKE '%sanctions%')
         AND updated_at > NOW() - INTERVAL '30 days'
         GROUP BY 1 ORDER BY 1`
      ).catch(() => ({ rows: [] }));

      const flaggedUsers = await db.query<{ user_id: string; alert_count: string; max_severity: string }>(
        `SELECT user_id, COUNT(*)::text AS alert_count, MAX(severity) AS max_severity
         FROM aml_alerts WHERE status = 'open' AND (alert_type LIKE '%sanctions%' OR details::text ILIKE '%sanctions%')
         GROUP BY user_id ORDER BY COUNT(*) DESC LIMIT 20`
      ).catch(() => ({ rows: [] }));

      const summary = await db.query<{ total_hits: string; blocked_tx: string; flagged_users: string }>(
        `SELECT
          (SELECT COUNT(*) FROM aml_alerts WHERE (alert_type LIKE '%sanctions%' OR details::text ILIKE '%sanctions%') AND created_at > NOW() - INTERVAL '30 days')::text AS total_hits,
          (SELECT COUNT(*) FROM withdrawals WHERE status = 'failed' AND (failed_reason ILIKE '%sanctions%' OR rejection_reason ILIKE '%sanctions%') AND updated_at > NOW() - INTERVAL '30 days')::text AS blocked_tx,
          (SELECT COUNT(DISTINCT user_id) FROM aml_alerts WHERE status = 'open' AND (alert_type LIKE '%sanctions%' OR details::text ILIKE '%sanctions%'))::text AS flagged_users`
      ).catch(() => ({ rows: [{ total_hits: '0', blocked_tx: '0', flagged_users: '0' }] }));

      const row = summary.rows?.[0];
      return reply.send({
        success: true,
        data: {
          sanctionsHits: parseInt(row?.total_hits ?? '0', 10),
          blockedWithdrawals: parseInt(row?.blocked_tx ?? '0', 10),
          flaggedUsers: parseInt(row?.flagged_users ?? '0', 10),
          hitsTimeline: (hits.rows ?? []).map(r => ({ date: r.date, count: parseInt(r.count, 10) })),
          blockedTxTimeline: (blockedWithdrawals.rows ?? []).map(r => ({ date: r.date, count: parseInt(r.count, 10) })),
          highRiskUsers: (flaggedUsers.rows ?? []).map(r => ({
            userId: r.user_id,
            alertCount: parseInt(r.alert_count, 10),
            riskScore: r.max_severity === 'high' ? 90 : r.max_severity === 'critical' ? 100 : 50,
          })),
        },
      });
    } catch (e) {
      logger.warn('Sanctions dashboard error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch' } });
    }
  });

  // ----- Network Risk (VPN/TOR) -----
  app.get('/security/network-risk', async (request, reply) => {
    try {
      const suspiciousIps = await db.query<{ ip_address: string; cnt: string; last_at: string }>(
        `SELECT ip_address::text, COUNT(*)::text AS cnt, MAX(created_at)::text AS last_at
         FROM user_activity_logs
         WHERE created_at > NOW() - INTERVAL '24 hours' AND ip_address IS NOT NULL
         GROUP BY ip_address HAVING COUNT(*) > 10
         ORDER BY COUNT(*) DESC LIMIT 30`
      ).catch(() => ({ rows: [] }));

      const loginByHour = await db.query<{ hour: string; total: string; distinct_ips: string }>(
        `SELECT date_trunc('hour', created_at) AS hour, COUNT(*)::text AS total, COUNT(DISTINCT ip_address)::text AS distinct_ips
         FROM user_activity_logs WHERE activity_type IN ('login', 'login_failed') AND created_at > NOW() - INTERVAL '24 hours'
         GROUP BY 1 ORDER BY 1`
      ).catch(() => ({ rows: [] }));

      const highRiskLocations = await db.query<{ ip_address: string; user_id: string; count: string }>(
        `SELECT ip_address::text, user_id, COUNT(*)::text AS count
         FROM user_activity_logs
         WHERE created_at > NOW() - INTERVAL '7 days' AND ip_address IS NOT NULL
         GROUP BY ip_address, user_id HAVING COUNT(DISTINCT date_trunc('day', created_at)) >= 3
         ORDER BY COUNT(*) DESC LIMIT 20`
      ).catch(() => ({ rows: [] }));

      return reply.send({
        success: true,
        data: {
          suspiciousIps: (suspiciousIps.rows ?? []).map(r => ({
            ip: r.ip_address,
            requestCount: parseInt(r.cnt, 10),
            lastSeen: r.last_at,
          })),
          vpnLoginTrend: (loginByHour.rows ?? []).map(r => ({
            hour: r.hour,
            logins: parseInt(r.total, 10),
            distinctIps: parseInt(r.distinct_ips, 10),
          })),
          highRiskLocations: (highRiskLocations.rows ?? []).map(r => ({
            ip: r.ip_address,
            userId: r.user_id,
            loginCount: parseInt(r.count, 10),
          })),
          anomalyCount: suspiciousIps.rows?.length ?? 0,
        },
      });
    } catch (e) {
      logger.warn('Network risk fetch error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch' } });
    }
  });
}
