/**
 * Withdrawal limits by KYC tier.
 * Tier limits stored in system_settings (withdrawal_tier_{0-3}_daily, withdrawal_tier_{0-3}_monthly).
 * When KYC is approved, user's users.daily_withdrawal_limit and users.monthly_withdrawal_limit
 * are set from the tier corresponding to their kyc_level.
 */

import { Decimal } from '../lib/decimal.js';
import { db } from '../lib/database.js';
import { logger } from '../lib/logger.js';

const TIER_KEYS = [
  'withdrawal_tier_0_daily', 'withdrawal_tier_0_monthly',
  'withdrawal_tier_1_daily', 'withdrawal_tier_1_monthly',
  'withdrawal_tier_2_daily', 'withdrawal_tier_2_monthly',
  'withdrawal_tier_3_daily', 'withdrawal_tier_3_monthly',
] as const;

const DEFAULT_TIERS: Record<string, string> = {
  withdrawal_tier_0_daily: '0',
  withdrawal_tier_0_monthly: '0',
  withdrawal_tier_1_daily: '10000',
  withdrawal_tier_1_monthly: '100000',
  withdrawal_tier_2_daily: '100000',
  withdrawal_tier_2_monthly: '1000000',
  withdrawal_tier_3_daily: '500000',
  withdrawal_tier_3_monthly: '5000000',
};

export interface TierLimits {
  tier: number;
  dailyLimit: string;
  monthlyLimit: string;
}

export interface AllTierLimits {
  tiers: TierLimits[];
}

/** Get tier limits from system_settings. kyc_level 0 = no KYC, 1-3 = tier 1-3. */
export async function getTierLimitsFromSettings(): Promise<AllTierLimits> {
  const rows = await db.query<{ key: string; value: unknown }>(
    `SELECT key, value FROM system_settings WHERE key = ANY($1::text[])`,
    [TIER_KEYS as unknown as string[]]
  );
  const map = Object.fromEntries(
    (rows.rows ?? []).map((r) => [r.key, r.value != null && typeof r.value === 'string' ? r.value : String(r.value ?? '')])
  );
  const tiers: TierLimits[] = [];
  for (let t = 0; t <= 3; t++) {
    const daily = map[`withdrawal_tier_${t}_daily`] ?? DEFAULT_TIERS[`withdrawal_tier_${t}_daily`] ?? '0';
    const monthly = map[`withdrawal_tier_${t}_monthly`] ?? DEFAULT_TIERS[`withdrawal_tier_${t}_monthly`] ?? '0';
    tiers.push({ tier: t, dailyLimit: daily, monthlyLimit: monthly });
  }
  return { tiers };
}

/** Get limits for a specific tier (0-3). */
export async function getLimitsForTier(kycLevel: number): Promise<{ dailyLimit: string; monthlyLimit: string }> {
  const tier = Math.min(3, Math.max(0, kycLevel));
  const all = await getTierLimitsFromSettings();
  const t = all.tiers.find((x) => x.tier === tier) ?? all.tiers[0]!;
  return { dailyLimit: t.dailyLimit, monthlyLimit: t.monthlyLimit };
}

/** Set user's withdrawal limits from their KYC tier. Call when KYC is approved. */
export async function applyTierLimitsToUser(userId: string, kycLevel: number): Promise<void> {
  const { dailyLimit, monthlyLimit } = await getLimitsForTier(kycLevel);
  await db.query(
    `UPDATE users SET daily_withdrawal_limit = $1::numeric, monthly_withdrawal_limit = $2::numeric WHERE id = $3`,
    [dailyLimit, monthlyLimit, userId]
  );
  logger.info('Withdrawal tier limits applied to user', { userId, kycLevel, dailyLimit, monthlyLimit });
}

/** Update tier limits in system_settings. */
export async function updateTierLimits(tiers: { tier: number; dailyLimit: string; monthlyLimit: string }[]): Promise<void> {
  for (const t of tiers) {
    if (t.tier < 0 || t.tier > 3) continue;
    const dailyKey = `withdrawal_tier_${t.tier}_daily`;
    const monthlyKey = `withdrawal_tier_${t.tier}_monthly`;
    await db.query(
      `INSERT INTO system_settings (key, value, updated_at) VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = NOW()`,
      [dailyKey, JSON.stringify(t.dailyLimit)]
    );
    await db.query(
      `INSERT INTO system_settings (key, value, updated_at) VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = NOW()`,
      [monthlyKey, JSON.stringify(t.monthlyLimit)]
    );
  }
}
