/**
 * DB-backed hybrid execution + external liquidity providers with Redis cache.
 * Hedge execution MUST read providers only through this service (not process.env).
 */
import { db } from '../lib/database.js';
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';

const CACHE_PREFIX = 'hybridcfg:';
const DEFAULT_TTL_SEC = 45;

export type HybridExecutionConfigRow = {
  id: string;
  market: string | null;
  enabled: boolean;
  small_trade_max_notional_usd: string;
  large_trade_min_notional_usd: string;
  between_band_policy: string;
  hedge_enabled: boolean;
  fallback_to_internal: boolean;
  max_slippage_bps: number;
  max_hedge_notional_usd_per_order: string;
  max_net_hedge_exposure_usd: string;
  /** Rolling daily adverse hedge threshold (USD magnitude) before auto emergency_stop. */
  hedge_max_daily_loss_usd?: string | null;
  system_counterparty_user_id: string | null;
  updated_at: string;
};

export type ExternalLiquidityProviderRow = {
  id: string;
  provider_name: string;
  enabled: boolean;
  api_key_ciphertext: string;
  api_secret_ciphertext: string;
  base_url: string;
  is_testnet: boolean;
  priority: number;
  last_health_ok_at: string | null;
  consecutive_failures: number;
  created_at: string;
  updated_at: string;
};

class ExternalLiquidityConfigService {
  async invalidateCache(): Promise<void> {
    try {
      const client = redis.getClient();
      let cursor = '0';
      const keys: string[] = [];
      do {
        const [next, batch] = await client.scan(cursor, 'MATCH', `${CACHE_PREFIX}*`, 'COUNT', 128);
        cursor = next;
        if (batch.length) keys.push(...batch);
      } while (cursor !== '0');
      if (keys.length) await client.del(...keys);
    } catch (e) {
      logger.warn('hybridcfg: cache invalidate failed', { error: e instanceof Error ? e.message : String(e) });
    }
  }

  private async getCached<T>(key: string): Promise<T | null> {
    try {
      return await redis.getJson<T>(`${CACHE_PREFIX}${key}`);
    } catch {
      return null;
    }
  }

  private async setCached<T>(key: string, value: T, ttl = DEFAULT_TTL_SEC): Promise<void> {
    try {
      await redis.setJson(`${CACHE_PREFIX}${key}`, value, ttl);
    } catch {
      /* best-effort */
    }
  }

  /** Global defaults row (`market IS NULL`). */
  async getGlobalHybridConfig(): Promise<HybridExecutionConfigRow | null> {
    const cacheKey = 'hybrid:global';
    const hit = await this.getCached<HybridExecutionConfigRow>(cacheKey);
    if (hit) return hit;

    const glob = await db.query<HybridExecutionConfigRow>(
      `SELECT id, market, enabled,
              small_trade_max_notional_usd::text, large_trade_min_notional_usd::text,
              between_band_policy, hedge_enabled, fallback_to_internal, max_slippage_bps,
              max_hedge_notional_usd_per_order::text, max_net_hedge_exposure_usd::text,
              hedge_max_daily_loss_usd::text, system_counterparty_user_id::text, updated_at::text
       FROM hybrid_execution_config WHERE market IS NULL LIMIT 1`
    );
    const row = glob.rows[0] ?? null;
    if (row) await this.setCached(cacheKey, row);
    return row;
  }

  async getHybridConfig(market: string): Promise<HybridExecutionConfigRow | null> {
    const sym = market.toUpperCase().replace(/-/g, '_');
    const cacheKey = `hybrid:${sym}`;
    const hit = await this.getCached<HybridExecutionConfigRow>(cacheKey);
    if (hit) return hit;

    const specific = await db.query<HybridExecutionConfigRow>(
      `SELECT id, market, enabled,
              small_trade_max_notional_usd::text, large_trade_min_notional_usd::text,
              between_band_policy, hedge_enabled, fallback_to_internal, max_slippage_bps,
              max_hedge_notional_usd_per_order::text, max_net_hedge_exposure_usd::text,
              hedge_max_daily_loss_usd::text, system_counterparty_user_id::text, updated_at::text
       FROM hybrid_execution_config WHERE market = $1 LIMIT 1`,
      [sym]
    );
    let row = specific.rows[0] ?? null;
    if (!row) {
      const glob = await db.query<HybridExecutionConfigRow>(
        `SELECT id, market, enabled,
                small_trade_max_notional_usd::text, large_trade_min_notional_usd::text,
                between_band_policy, hedge_enabled, fallback_to_internal, max_slippage_bps,
                max_hedge_notional_usd_per_order::text, max_net_hedge_exposure_usd::text,
                hedge_max_daily_loss_usd::text, system_counterparty_user_id::text, updated_at::text
         FROM hybrid_execution_config WHERE market IS NULL LIMIT 1`
      );
      row = glob.rows[0] ?? null;
    }
    if (row) await this.setCached(cacheKey, row);
    return row;
  }

  /** Active providers sorted by priority (execution reads this; no env URLs). */
  async getActiveProviders(): Promise<ExternalLiquidityProviderRow[]> {
    const cacheKey = 'providers:active';
    const hit = await this.getCached<ExternalLiquidityProviderRow[]>(cacheKey);
    if (hit) return hit;

    const r = await db.query<ExternalLiquidityProviderRow>(
      `SELECT id, provider_name, enabled, api_key_ciphertext, api_secret_ciphertext,
              base_url, is_testnet, priority,
              last_health_ok_at::text, consecutive_failures,
              created_at::text, updated_at::text
       FROM external_liquidity_providers
       WHERE enabled = TRUE AND base_url <> '' AND api_key_ciphertext <> '' AND api_secret_ciphertext <> ''
       ORDER BY priority DESC, created_at ASC`
    );
    await this.setCached(cacheKey, r.rows);
    return r.rows;
  }

  async listAllProvidersForAdmin(): Promise<
    Array<{
      id: string;
      provider_name: string;
      enabled: boolean;
      base_url: string;
      is_testnet: boolean;
      priority: number;
      api_key_configured: boolean;
      api_secret_configured: boolean;
      last_health_ok_at: string | null;
      consecutive_failures: number;
      last_successful_execution_at: string | null;
      last_failure_reason: string | null;
      active_hedge_jobs: number;
      failover_count_7d: number;
      created_at: string;
      updated_at: string;
    }>
  > {
    const runDetailedQuery = async () =>
      db.query<{
      id: string;
      provider_name: string;
      enabled: boolean;
      base_url: string;
      is_testnet: boolean;
      priority: number;
      last_health_ok_at: string | null;
      consecutive_failures: number;
      last_successful_execution_at: string | null;
      last_failure_reason: string | null;
      active_hedge_jobs: number;
      failover_count_7d: number;
      created_at: string;
      updated_at: string;
      api_key_ciphertext: string;
      api_secret_ciphertext: string;
    }>(
      `SELECT
         p.id, p.provider_name, p.enabled, p.base_url, p.is_testnet, p.priority,
         p.last_health_ok_at::text, p.consecutive_failures, p.created_at::text, p.updated_at::text,
         p.api_key_ciphertext, p.api_secret_ciphertext,
         (
           SELECT hj.updated_at::text
           FROM hedge_jobs hj
           WHERE hj.provider_id = p.id::uuid
             AND LOWER(hj.status) = 'completed'
           ORDER BY hj.updated_at DESC NULLS LAST, hj.created_at DESC
           LIMIT 1
         ) AS last_successful_execution_at,
         (
           SELECT hj.last_error
           FROM hedge_jobs hj
           WHERE hj.provider_id = p.id::uuid
             AND hj.last_error IS NOT NULL
           ORDER BY hj.updated_at DESC NULLS LAST, hj.created_at DESC
           LIMIT 1
         ) AS last_failure_reason,
         (
           SELECT COUNT(*)::int
           FROM hedge_jobs hj
           WHERE hj.provider_id = p.id::uuid
             AND LOWER(hj.status) IN ('pending', 'processing')
         ) AS active_hedge_jobs,
         (
           SELECT COUNT(*)::int
           FROM hedge_provider_failover_events fe
           WHERE fe.to_provider_id = p.id::uuid
             AND fe.created_at > NOW() - INTERVAL '7 days'
         ) AS failover_count_7d
       FROM external_liquidity_providers p
       ORDER BY p.priority DESC, p.created_at ASC`
    );
    let r: Awaited<ReturnType<typeof runDetailedQuery>>;
    try {
      r = await runDetailedQuery();
    } catch (e) {
      logger.warn('external providers detailed list failed; falling back', {
        error: e instanceof Error ? e.message : String(e),
      });
      r = await db.query<{
        id: string;
        provider_name: string;
        enabled: boolean;
        base_url: string;
        is_testnet: boolean;
        priority: number;
        last_health_ok_at: string | null;
        consecutive_failures: number;
        created_at: string;
        updated_at: string;
        api_key_ciphertext: string;
        api_secret_ciphertext: string;
        last_successful_execution_at: string | null;
        last_failure_reason: string | null;
        active_hedge_jobs: number;
        failover_count_7d: number;
      }>(
        `SELECT
           id, provider_name, enabled, base_url, is_testnet, priority,
           last_health_ok_at::text, consecutive_failures, created_at::text, updated_at::text,
           api_key_ciphertext, api_secret_ciphertext,
           NULL::text AS last_successful_execution_at,
           NULL::text AS last_failure_reason,
           0::int AS active_hedge_jobs,
           0::int AS failover_count_7d
         FROM external_liquidity_providers
         ORDER BY priority DESC, created_at ASC`
      );
    }
    return r.rows.map((row) => ({
      id: row.id,
      provider_name: row.provider_name,
      enabled: row.enabled,
      base_url: row.base_url,
      is_testnet: row.is_testnet,
      priority: row.priority,
      api_key_configured: Boolean(row.api_key_ciphertext?.length),
      api_secret_configured: Boolean(row.api_secret_ciphertext?.length),
      last_health_ok_at: row.last_health_ok_at,
      consecutive_failures: row.consecutive_failures,
      last_successful_execution_at: row.last_successful_execution_at,
      last_failure_reason: row.last_failure_reason,
      active_hedge_jobs: row.active_hedge_jobs,
      failover_count_7d: row.failover_count_7d,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  }


  /** Hedge IOC / exchange-facing failure streak; disables provider at 3 consecutive failures. */
  async recordHedgeProviderFailure(id: string): Promise<{ consecutive: number; circuitTrippedAtThree: boolean }> {
    const r = await db.query<{ c: number }>(
      `UPDATE external_liquidity_providers
       SET consecutive_failures = consecutive_failures + 1,
           last_failure_at = NOW(),
           updated_at = NOW(),
           enabled = CASE WHEN consecutive_failures + 1 >= 3 THEN FALSE ELSE enabled END
       WHERE id = $1::uuid
       RETURNING consecutive_failures AS c`,
      [id]
    );
    await this.invalidateCache();
    const c = r.rows[0]?.c ?? 0;
    return { consecutive: c, circuitTrippedAtThree: c === 3 };
  }

  async markProviderHealthOk(id: string): Promise<void> {
    await db.query(
      `UPDATE external_liquidity_providers
       SET consecutive_failures = 0, last_health_ok_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [id]
    );
    await this.invalidateCache();
  }
}

export const externalLiquidityConfigService = new ExternalLiquidityConfigService();
