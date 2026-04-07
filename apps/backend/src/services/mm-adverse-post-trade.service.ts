/**
 * Post-trade adverse selection: directional move after MM fills; lookahead horizon adapts to vol & trade rate.
 */
import { db } from '../lib/database.js';
import { getSpotTradesUseMarketSync } from '../lib/spot-schema-cache.js';
import { getSpotTradesShapeSync } from '../lib/spot-trades-shape.js';
import { config } from '../config/index.js';

type Print = { p: number; ts: number };

function parseRows(rows: Array<{ price: string; created_at: Date }>): Print[] {
  return rows
    .map((r) => {
      const p = parseFloat(r.price);
      const ts = new Date(r.created_at).getTime();
      if (!Number.isFinite(p) || p <= 0 || !Number.isFinite(ts)) return null;
      return { p, ts };
    })
    .filter((x): x is Print => x != null)
    .sort((a, b) => a.ts - b.ts);
}

export async function countMarketTrades(symbol: string, windowSec: number): Promise<number> {
  const w = Math.max(30, Math.floor(windowSec));
  const useMarket = getSpotTradesUseMarketSync();
  try {
    if (useMarket) {
      const r = await db.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM spot_trades
         WHERE market = $1 AND created_at > NOW() - ($2::text || ' seconds')::interval`,
        [symbol, String(w)]
      );
      return parseInt(r.rows[0]?.c ?? '0', 10) || 0;
    }
    const r = await db.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c
       FROM spot_trades st
       INNER JOIN trading_pairs tp ON tp.id = st.trading_pair_id
       WHERE tp.symbol = $1 AND st.created_at > NOW() - ($2::text || ' seconds')::interval`,
      [symbol, String(w)]
    );
    return parseInt(r.rows[0]?.c ?? '0', 10) || 0;
  } catch {
    return 0;
  }
}

/**
 * k = k₀ + k_σ·min(1,σ/σ_ref) + k_f / √(λ+1), λ = trades per minute.
 */
export function computeAdverseLookaheadTrades(volBps: number, marketTradeCount: number, windowSec: number): number {
  const em = config.eliteMm;
  const w = Math.max(60, windowSec);
  const tpm = marketTradeCount / Math.max(w / 60, 1 / 60);
  const volNorm = Math.min(1, Math.max(0, volBps) / Math.max(1, em.adverseHorizonVolRefBps));
  const kFloat =
    em.adverseHorizonBaseTrades +
    em.adverseHorizonVolCoeff * volNorm +
    em.adverseHorizonFreqCoeff / Math.sqrt(tpm + 1);
  const k = Math.round(kFloat);
  return Math.max(em.adverseHorizonMinTrades, Math.min(em.adverseHorizonMaxTrades, k));
}

/**
 * Volume-weighted average adverse cost (bps): harmful post-print move after each MM fill.
 */
export async function getAdverseSelectionCostBps(
  symbol: string,
  userId: string,
  windowSec: number,
  lookaheadTrades: number
): Promise<number> {
  const w = Math.max(60, Math.floor(windowSec));
  const k = Math.max(1, Math.min(25, Math.floor(lookaheadTrades)));
  const useMarket = getSpotTradesUseMarketSync();

  try {
    let mmRows: Array<{ price: string; created_at: Date; side: string }> = [];
    let mktRows: Array<{ price: string; created_at: Date }> = [];

    if (useMarket) {
      const [mm, mkt] = await Promise.all([
        db.query<{ price: string; created_at: Date; side: string }>(
          `SELECT price::text, created_at, side::text
           FROM spot_trades
           WHERE market = $1 AND user_id = $2::uuid
             AND created_at > NOW() - ($3::text || ' seconds')::interval
           ORDER BY created_at ASC
           LIMIT 400`,
          [symbol, userId, String(w)]
        ),
        db.query<{ price: string; created_at: Date }>(
          `SELECT price::text, created_at
           FROM spot_trades
           WHERE market = $1
             AND created_at > NOW() - ($3::text || ' seconds')::interval
           ORDER BY created_at ASC
           LIMIT 5000`,
          [symbol, String(w + 120)]
        ),
      ]);
      mmRows = mm.rows;
      mktRows = mkt.rows;
    } else {
      const shape = getSpotTradesShapeSync();
      const userFilter = shape?.hasUserId
        ? 'st.user_id = $2::uuid'
        : shape?.hasMakerUserId
          ? '(st.maker_user_id = $2::uuid OR st.taker_user_id = $2::uuid)'
          : 'FALSE';
      const [mm, mkt] = await Promise.all([
        db.query<{ price: string; created_at: Date; side: string }>(
          `SELECT st.price::text, st.created_at, st.side::text
           FROM spot_trades st
           INNER JOIN trading_pairs tp ON tp.id = st.trading_pair_id
           WHERE tp.symbol = $1 AND ${userFilter}
             AND st.created_at > NOW() - ($3::text || ' seconds')::interval
           ORDER BY st.created_at ASC
           LIMIT 400`,
          [symbol, userId, String(w)]
        ),
        db.query<{ price: string; created_at: Date }>(
          `SELECT st.price::text, st.created_at
           FROM spot_trades st
           INNER JOIN trading_pairs tp ON tp.id = st.trading_pair_id
           WHERE tp.symbol = $1
             AND st.created_at > NOW() - ($3::text || ' seconds')::interval
           ORDER BY st.created_at ASC
           LIMIT 5000`,
          [symbol, String(w + 120)]
        ),
      ]);
      mmRows = mm.rows;
      mktRows = mkt.rows;
    }

    const prints = parseRows(mktRows);
    if (prints.length < 2 || mmRows.length === 0) return 0;

    let num = 0;
    let den = 0;

    for (const row of mmRows) {
      const p0 = parseFloat(row.price);
      const t0 = new Date(row.created_at).getTime();
      const side = (row.side ?? '').toLowerCase();
      if (!Number.isFinite(p0) || p0 <= 0 || !Number.isFinite(t0)) continue;

      const startIdx = prints.findIndex((pr) => pr.ts > t0);
      if (startIdx < 0) continue;
      const endIdx = Math.min(prints.length - 1, startIdx + k - 1);
      const pLater = prints[endIdx]!.p;
      let adv = 0;
      if (side === 'sell' || side === 's') {
        adv = Math.max(0, ((p0 - pLater) / p0) * 10_000);
      } else if (side === 'buy' || side === 'b') {
        adv = Math.max(0, ((pLater - p0) / p0) * 10_000);
      } else continue;

      num += adv * p0;
      den += p0;
    }

    return den > 0 ? num / den : 0;
  } catch {
    return 0;
  }
}
