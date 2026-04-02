/**
 * Rolling realized volatility from recent spot trades (for dynamic spread).
 */
import { db } from '../lib/database.js';
import { getSpotTradesUseMarket } from '../lib/spot-schema-cache.js';
import { config } from '../config/index.js';

function stdDevPctChanges(prices: number[]): number {
  if (prices.length < 3) return 0;
  const changes: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    const a = prices[i - 1]!;
    const b = prices[i]!;
    if (a > 0 && b > 0 && Number.isFinite(a) && Number.isFinite(b)) {
      changes.push((b - a) / a);
    }
  }
  if (changes.length < 2) return 0;
  const mean = changes.reduce((s, x) => s + x, 0) / changes.length;
  const v = changes.reduce((s, x) => s + (x - mean) ** 2, 0) / (changes.length - 1);
  return Math.sqrt(Math.max(0, v));
}

/**
 * Recent-trade volatility expressed in basis points (std dev of simple returns), capped.
 */
export async function getRealizedVolatilityBps(symbol: string): Promise<number> {
  const mm = config.institutionalMm;
  const windowMin = mm.volWindowMinutes;
  const minSamples = mm.volMinSamples;
  const capBps = mm.volSpreadCapBps;

  try {
    const useMarket = await getSpotTradesUseMarket();
    const r = useMarket
      ? await db.query<{ price: string }>(
          `SELECT price::text AS price FROM spot_trades
           WHERE market = $1 AND created_at > NOW() - INTERVAL '1 minute' * $2
           ORDER BY created_at ASC`,
          [symbol, windowMin]
        )
      : await db.query<{ price: string }>(
          `SELECT st.price::text AS price FROM spot_trades st
           JOIN trading_pairs tp ON tp.id = st.trading_pair_id
           WHERE tp.symbol = $1 AND st.created_at > NOW() - INTERVAL '1 minute' * $2
           ORDER BY st.created_at ASC`,
          [symbol, windowMin]
        );

    const rows = r.rows;
    const prices = rows.map((x) => parseFloat(x.price)).filter((p) => Number.isFinite(p) && p > 0);
    if (prices.length < minSamples) return 0;
    const sigma = stdDevPctChanges(prices);
    const bps = sigma * 10_000;
    return Math.min(capBps, Math.max(0, bps));
  } catch {
    return 0;
  }
}

/** Multiplier ≥1 applied to base spread from volatility (coeff scales vol bps). */
export function volatilitySpreadMultiplier(volBps: number): number {
  const mm = config.institutionalMm;
  const m = 1 + mm.volSpreadCoeff * (volBps / 100);
  return Math.min(mm.volSpreadMultCap, Math.max(1, m));
}
