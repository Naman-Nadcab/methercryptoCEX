/**
 * Volume-based fee tiers. Returns maker/taker fee rates for a user based on 30-day spot volume.
 */
import { db } from '../lib/database.js';

export interface FeeRates {
  maker: string;
  taker: string;
  tierLevel: number;
}

const DEFAULT_MAKER = '0.001';
const DEFAULT_TAKER = '0.001';

/**
 * Get 30-day spot trading volume (quote amount) for a user.
 */
export async function getUser30dVolume(userId: string): Promise<string> {
  const r = await db.query<{ volume: string }>(
    `SELECT COALESCE(SUM(price::numeric * quantity::numeric), 0)::text as volume
     FROM spot_trades
     WHERE user_id = $1 AND created_at >= NOW() - INTERVAL '30 days'`,
    [userId]
  );
  return r.rows[0]?.volume ?? '0';
}

/**
 * Get fee tier for a user based on 30-day volume. Returns maker and taker rates.
 * Tiers are ordered by tier_level desc (higher volume = lower tier_level for better fees).
 */
export async function getFeeRatesForUser(userId: string): Promise<FeeRates> {
  const volume = await getUser30dVolume(userId);
  const vol = parseFloat(volume);

  const tiers = await db.query<{
    tier_level: number;
    min_trading_volume: string;
    spot_maker_fee: string;
    spot_taker_fee: string;
  }>(
    `SELECT tier_level, min_trading_volume::text, spot_maker_fee::text, spot_taker_fee::text
     FROM fee_tiers
     ORDER BY min_trading_volume DESC`
  );

  // Best tier that user qualifies for (highest min_volume <= user volume)
  // Tiers ordered by min_trading_volume DESC so first match is best
  let best = { tier_level: 0, maker: DEFAULT_MAKER, taker: DEFAULT_TAKER };
  for (const t of tiers.rows) {
    const minVol = parseFloat(t.min_trading_volume);
    if (vol >= minVol) {
      best = {
        tier_level: t.tier_level,
        maker: t.spot_maker_fee ?? DEFAULT_MAKER,
        taker: t.spot_taker_fee ?? DEFAULT_TAKER,
      };
      break;
    }
  }

  return {
    maker: best.maker,
    taker: best.taker,
    tierLevel: best.tier_level,
  };
}

export interface FeeTierDisplay {
  tierLevel: number;
  maker: string;
  taker: string;
  volume30d: string;
  nextTierMinVolume: string | null;
  tierName?: string;
}

/** Get fee tier plus 30d volume and next tier threshold for UI (progress to next tier). */
export async function getFeeTierDisplay(userId: string): Promise<FeeTierDisplay> {
  const volume = await getUser30dVolume(userId);
  const vol = parseFloat(volume);
  const rates = await getFeeRatesForUser(userId);

  const tiers = await db.query<{
    tier_level: number;
    tier_name: string | null;
    min_trading_volume: string;
  }>(
    `SELECT tier_level, tier_name, min_trading_volume::text
     FROM fee_tiers
     ORDER BY min_trading_volume ASC`
  );

  let nextTierMinVolume: string | null = null;
  let tierName: string | undefined;
  for (const t of tiers.rows) {
    const minVol = parseFloat(t.min_trading_volume);
    if (t.tier_level === rates.tierLevel) tierName = t.tier_name ?? undefined;
    if (minVol > vol) {
      nextTierMinVolume = t.min_trading_volume;
      break;
    }
  }

  return {
    tierLevel: rates.tierLevel,
    maker: rates.maker,
    taker: rates.taker,
    volume30d: volume,
    nextTierMinVolume,
    tierName,
  };
}
