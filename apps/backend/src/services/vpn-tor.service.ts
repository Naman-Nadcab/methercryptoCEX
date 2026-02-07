/**
 * VPN / TOR detection: pluggable provider with Redis cache and fail-open strategy.
 * If the provider is down or errors, we allow the request (fail-open).
 */

import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';

export interface VpnTorResult {
  isVpnOrTor: boolean;
  provider: string;
  fromCache?: boolean;
}

/**
 * Provider interface: check a single IP.
 */
export interface VpnTorProvider {
  name: string;
  check(ip: string): Promise<boolean>;
}

const CACHE_PREFIX = 'vpn_tor:';
const CACHE_TTL_SEC = 3600; // 1 hour

/**
 * Stub provider: always returns false (no VPN/TOR). Replace with real API (e.g. IPQualityScore, GetIPIntel) in production.
 */
export const stubVpnTorProvider: VpnTorProvider = {
  name: 'stub',
  async check(_ip: string): Promise<boolean> {
    return false;
  },
};

let activeProvider: VpnTorProvider = stubVpnTorProvider;

export function setVpnTorProvider(provider: VpnTorProvider): void {
  activeProvider = provider;
}

export function getVpnTorProvider(): VpnTorProvider {
  return activeProvider;
}

/**
 * Check if IP is VPN/TOR. Results are cached in Redis. Fail-open: on provider error, returns { isVpnOrTor: false }.
 */
export async function checkVpnTor(ip: string): Promise<VpnTorResult> {
  const cacheKey = `${CACHE_PREFIX}${ip}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached !== null) {
      return {
        isVpnOrTor: cached === '1',
        provider: activeProvider.name,
        fromCache: true,
      };
    }
  } catch (e) {
    logger.warn('VPN/TOR cache read failed (fail-open)', { ip, error: e instanceof Error ? e.message : 'Unknown' });
    return { isVpnOrTor: false, provider: activeProvider.name };
  }

  try {
    const isVpnOrTor = await activeProvider.check(ip);
    try {
      await redis.set(cacheKey, isVpnOrTor ? '1' : '0', CACHE_TTL_SEC);
    } catch (e) {
      logger.warn('VPN/TOR cache write failed', { ip, error: e instanceof Error ? e.message : 'Unknown' });
    }
    return { isVpnOrTor, provider: activeProvider.name, fromCache: false };
  } catch (e) {
    logger.warn('VPN/TOR provider check failed (fail-open)', {
      ip,
      provider: activeProvider.name,
      error: e instanceof Error ? e.message : 'Unknown',
    });
    return { isVpnOrTor: false, provider: activeProvider.name };
  }
}
