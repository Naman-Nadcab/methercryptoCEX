/**
 * Sanctions / Travel Rule screening — Tier-1 fail-closed.
 * When provider is configured: call provider; on any failure return allowed: false.
 * In production with no provider configured: return allowed: false (refuse to allow without screening).
 * Config: env (SANCTIONS_*) or system_settings (SANCTIONS_PROVIDER, SANCTIONS_API_URL, SANCTIONS_API_KEY).
 */

import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';
import { db } from '../lib/database.js';

export interface SanctionsCheckParams {
  /** On-chain address or counterparty identifier */
  address?: string;
  /** Counterparty name (Travel Rule) */
  name?: string;
  /** Amount in token units */
  amount: string;
  /** Asset symbol */
  asset: string;
  /** User ID for audit */
  userId: string;
}

export interface SanctionsCheckResult {
  allowed: boolean;
  /** Provider-specific risk score 0–100 */
  riskScore?: number;
  /** Block reason if not allowed */
  reason?: string;
  /** Provider name for audit */
  provider?: string;
}

const SANCTIONS_UNAVAILABLE = 'Sanctions service unavailable';
const SANCTIONS_NOT_CONFIGURED = 'Sanctions provider not configured (production requires screening)';

export interface SanctionsConfig {
  provider: string;
  apiUrl: string;
  apiKey: string;
}

/** Get sanctions config from env or system_settings. */
export async function getSanctionsConfig(): Promise<SanctionsConfig> {
  let provider = process.env.SANCTIONS_PROVIDER?.trim() ?? '';
  let apiUrl = process.env.SANCTIONS_API_URL?.trim() ?? '';
  let apiKey = process.env.SANCTIONS_API_KEY?.trim() ?? '';
  if (!apiUrl || !apiKey) {
    try {
      const rows = await db.query<{ key: string; value: unknown }>(
        `SELECT key, value FROM system_settings WHERE key IN ('SANCTIONS_PROVIDER', 'SANCTIONS_API_URL', 'SANCTIONS_API_KEY')`
      );
      const map = Object.fromEntries(
        (rows.rows ?? []).map((r) => [r.key, typeof r.value === 'string' ? r.value : String(r.value ?? '')])
      );
      if (map.SANCTIONS_PROVIDER) provider = map.SANCTIONS_PROVIDER;
      if (map.SANCTIONS_API_URL) apiUrl = map.SANCTIONS_API_URL;
      if (map.SANCTIONS_API_KEY) apiKey = map.SANCTIONS_API_KEY;
    } catch {
      // ignore
    }
  }
  return { provider, apiUrl, apiKey };
}

/**
 * Call external sanctions API (Chainalysis, Elliptic, TRM, or OFAC gateway).
 * Returns allowed: false on any error (fail closed).
 */
async function callSanctionsProvider(
  params: SanctionsCheckParams,
  provider: string,
  apiUrl: string,
  apiKey: string
): Promise<SanctionsCheckResult> {
  if (!apiUrl || !apiKey) {
    logger.warn('Sanctions provider configured but SANCTIONS_API_URL or SANCTIONS_API_KEY missing', {
      provider,
      userId: params.userId,
    });
    return { allowed: false, reason: SANCTIONS_UNAVAILABLE, provider };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify({
        address: params.address,
        name: params.name,
        amount: params.amount,
        asset: params.asset,
        userId: params.userId,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      logger.warn('Sanctions API returned non-OK', {
        status: res.status,
        provider,
        userId: params.userId,
      });
      return { allowed: false, reason: SANCTIONS_UNAVAILABLE, provider };
    }

    const data = (await res.json()) as { allowed?: boolean; riskScore?: number; reason?: string };
    const allowed = data.allowed !== false;
    return {
      allowed,
      riskScore: data.riskScore,
      reason: data.reason,
      provider,
    };
  } catch (e) {
    logger.warn('Sanctions check failed (fail closed)', {
      error: e instanceof Error ? e.message : String(e),
      provider,
      userId: params.userId,
    });
    return { allowed: false, reason: SANCTIONS_UNAVAILABLE, provider };
  }
}

/**
 * Tier-1: Fail closed. No provider in production -> block. Provider error -> block.
 */
export async function checkSanctions(params: SanctionsCheckParams): Promise<SanctionsCheckResult> {
  const { provider, apiUrl, apiKey } = await getSanctionsConfig();
  const isProduction = config.isProduction;

  if (!provider || provider === 'none' || !apiUrl || !apiKey) {
    if (isProduction) {
      logger.warn('Sanctions check in production without provider — blocking', { userId: params.userId });
      return {
        allowed: false,
        reason: SANCTIONS_NOT_CONFIGURED,
      };
    }
    return { allowed: true };
  }

  try {
    const result = await callSanctionsProvider(params, provider, apiUrl, apiKey);
    return result;
  } catch (e) {
    logger.warn('Sanctions check threw (fail closed)', {
      error: e instanceof Error ? e.message : String(e),
      userId: params.userId,
    });
    return {
      allowed: false,
      reason: SANCTIONS_UNAVAILABLE,
      provider,
    };
  }
}
