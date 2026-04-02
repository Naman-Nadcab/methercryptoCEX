/**
 * Per-market → engine base URL routing (feature-flagged).
 * Instance ids and URL lists: matching-engine-registry.ts
 *
 * Strict mode: every traded market must appear in MATCHING_ENGINE_ROUTES (no silent primary fallback).
 * Startup validation: route URLs must match a configured instance (MATCHING_ENGINE_URL / MATCHING_ENGINE_URLS).
 */
import { config } from '../../config/index.js';
import { logger } from '../../lib/logger.js';
import {
  getPrimaryMatchingEngineBaseUrl,
  listMatchingEngineInstances,
  normalizeEngineBaseUrl,
  resolveEngineIdForBaseUrl,
} from './matching-engine-registry.js';

export class MarketEngineRoutingError extends Error {
  override readonly name = 'MarketEngineRoutingError';
  constructor(message: string) {
    super(message);
  }
}

export function parseMatchingEngineRoutes(raw: string | undefined): Map<string, string> {
  const m = new Map<string, string>();
  if (!raw?.trim()) return m;
  for (const part of raw.split(',')) {
    const p = part.trim();
    if (!p) continue;
    const eq = p.indexOf('=');
    if (eq <= 0) continue;
    const sym = p
      .slice(0, eq)
      .trim()
      .toUpperCase()
      .replace(/\//g, '_');
    let url = p.slice(eq + 1).trim().replace(/\/$/, '');
    if (!sym || !url) continue;
    if (!/^https?:\/\//i.test(url)) {
      logger.warn('matching-engine-shard-router: skipped invalid URL in MATCHING_ENGINE_ROUTES', {
        sym,
        url: url.slice(0, 80),
      });
      continue;
    }
    m.set(sym, url);
  }
  return m;
}

/** Base URL for POST /engine/place for this market (Rust order.market / spot symbol). */
export function getMatchingEngineBaseUrlForMarket(market: string): string {
  const primary = getPrimaryMatchingEngineBaseUrl();
  if (!config.rustMatchingEngine.shardRoutingEnabled) {
    return primary;
  }
  const routes = parseMatchingEngineRoutes(config.rustMatchingEngine.routesRaw);
  const key = market.trim().toUpperCase().replace(/\//g, '_');
  const mapped = routes.get(key);
  if (config.rustMatchingEngine.strictMarketRouting) {
    if (mapped === undefined) {
      throw new MarketEngineRoutingError(
        `Market ${key} is not mapped in MATCHING_ENGINE_ROUTES (strict routing is enabled)`
      );
    }
    return normalizeEngineBaseUrl(mapped);
  }
  return normalizeEngineBaseUrl(mapped ?? primary);
}

/**
 * Resolved placement target: validates URL is registered and returns stable engine id.
 */
export function resolvePlaceTargetForMarket(market: string): { engineId: string; baseUrl: string } {
  const baseUrl = getMatchingEngineBaseUrlForMarket(market);
  const engineId = resolveEngineIdForBaseUrl(baseUrl);
  if (!engineId) {
    throw new MarketEngineRoutingError(
      `Engine URL ${baseUrl} is not listed in MATCHING_ENGINE_URL / MATCHING_ENGINE_URLS — cannot assign instance id`
    );
  }
  return { engineId, baseUrl };
}

/**
 * Validate MATCHING_ENGINE_ROUTES URLs against configured instances. Call at startup.
 * When strictDependencyStartup and Rust enabled, unknown URLs fail the process.
 */
export function validateMatchingEngineRouteTableOrExit(): void {
  if (!config.rustMatchingEngine.enabled || !config.rustMatchingEngine.shardRoutingEnabled) {
    return;
  }
  const routes = parseMatchingEngineRoutes(config.rustMatchingEngine.routesRaw);
  if (routes.size === 0) return;
  const known = new Set(listMatchingEngineInstances().map((i) => i.baseUrl));
  for (const [sym, url] of routes) {
    const n = normalizeEngineBaseUrl(url);
    if (!known.has(n)) {
      const msg = `MATCHING_ENGINE_ROUTES market ${sym} → ${n} is not a configured engine instance`;
      logger.error(msg, { known: [...known] });
      if (config.strictDependencyStartup) {
        process.exit(1);
      }
    }
  }
}

/**
 * Legacy single-URL poller helper (primary only). Prefer per-engine cursors + multi-poller.
 * @deprecated multi-engine — use listMatchingEngineInstances()
 */
export function getMatchingEnginePollerBaseUrl(): string {
  return getPrimaryMatchingEngineBaseUrl();
}

/**
 * When multi-engine routing was enabled without URL lists, ops could misconfigure pollers.
 * Now multi-poller is implemented; this log is informational.
 */
export function logMatchingEngineShardRoutingCompliance(): void {
  const inst = listMatchingEngineInstances();
  if (inst.length > 1) {
    logger.info('Multi-engine matching: poller will fetch /engine/matches from all configured instances', {
      instanceCount: inst.length,
      ids: inst.map((i) => i.id),
    });
  }
  const { shardRoutingEnabled, routesRaw } = config.rustMatchingEngine;
  if (!shardRoutingEnabled) return;
  const routes = parseMatchingEngineRoutes(routesRaw);
  if (routes.size === 0) {
    logger.info(
      'MATCHING_ENGINE_SHARD_ROUTING_ENABLED with empty MATCHING_ENGINE_ROUTES — all markets use primary URL'
    );
  }
}
