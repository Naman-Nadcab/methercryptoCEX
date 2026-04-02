/**
 * Inventory + mark-to-market vs benchmark and WAC walk (MM user trades).
 */
import { db } from '../lib/database.js';

export type MtmTradeRow = { side: 'buy' | 'sell'; p: number; q: number; fee: number };

export type MmMarkToMarket = {
  inventoryBase: number;
  inventoryQuote: number;
  oracleMid: number;
  /** Base marked at mid minus same base at benchmark (quote). */
  unrealizedVsBenchmarkQuote: number;
  /** If WAC walk aligns with balance: base * (mid - wac). */
  wacUnrealizedQuote: number | null;
  wacQuotePerBase: number | null;
  /** True when |walkNetBase - inventoryBase| / max(|inv|,ε) > 15%. */
  wacApproximate: boolean;
};

export async function fetchBalancesForSymbol(
  symbol: string,
  userId: string
): Promise<{ baseAsset: string; quoteAsset: string; base: number; quote: number; mid: number } | null> {
  try {
    const m = await db.query<{ base_asset: string; quote_asset: string }>(
      `SELECT base_asset, quote_asset FROM spot_markets WHERE symbol = $1`,
      [symbol]
    );
    if (m.rows.length === 0) return null;
    const baseAsset = m.rows[0]!.base_asset;
    const quoteAsset = m.rows[0]!.quote_asset;

    const bal = await db.query<{ asset: string; total: string }>(
      `SELECT c.symbol AS asset, (ub.available_balance::numeric + ub.locked_balance::numeric)::text AS total
       FROM user_balances ub
       JOIN currencies c ON c.id = ub.currency_id
       WHERE ub.user_id = $1::uuid AND ub.account_type = 'trading' AND COALESCE(ub.chain_id, '') = ''
         AND UPPER(TRIM(c.symbol)) IN (UPPER($2), UPPER($3))`,
      [userId, baseAsset, quoteAsset]
    );
    const base = parseFloat(bal.rows.find((r) => r.asset.toUpperCase() === baseAsset.toUpperCase())?.total ?? '0') || 0;
    const quote = parseFloat(bal.rows.find((r) => r.asset.toUpperCase() === quoteAsset.toUpperCase())?.total ?? '0') || 0;

    const mp = await db.query<{ price: string }>(
      `SELECT mp.price::text AS price
       FROM market_prices mp
       JOIN spot_markets sm ON sm.base_currency_id = mp.base_currency_id AND sm.quote_currency_id = mp.quote_currency_id
       WHERE sm.symbol = $1 LIMIT 1`,
      [symbol]
    );
    const mid = parseFloat(mp.rows[0]?.price ?? '');
    if (!Number.isFinite(mid) || mid <= 0) return null;

    return { baseAsset, quoteAsset, base, quote, mid };
  } catch {
    return null;
  }
}

/**
 * Walk ascending trades: average-cost inventory; returns ending Q, cost, WAC.
 */
export function walkAverageCostFromTrades(trades: MtmTradeRow[]): {
  netBase: number;
  totalCostQuote: number;
  wacQuotePerBase: number | null;
} {
  let Q = 0;
  let totalCost = 0;

  for (const t of trades) {
    const n = t.p * t.q;
    if (t.side === 'buy') {
      totalCost += n + t.fee;
      Q += t.q;
    } else {
      let rem = t.q;
      if (Q > 1e-16) {
        const avg = totalCost / Q;
        const use = Math.min(rem, Q);
        totalCost -= avg * use;
        Q -= use;
        rem -= use;
      }
      if (rem > 1e-16) {
        Q -= rem;
        totalCost -= t.p * rem;
      }
    }
  }

  const wac = Q > 1e-12 ? totalCost / Q : null;
  return { netBase: Q, totalCostQuote: totalCost, wacQuotePerBase: wac != null && Number.isFinite(wac) ? wac : null };
}

export function computeMarkToMarket(
  bal: { base: number; quote: number; mid: number },
  benchmarkPrice: number | null,
  /** Blended mark (micro + oracle/bench); used instead of oracle-only for MTM. */
  markMid: number,
  tradesAsc: MtmTradeRow[]
): MmMarkToMarket {
  const { base: B, quote: Qq, mid: M } = bal;
  const bench = benchmarkPrice != null && benchmarkPrice > 0 ? benchmarkPrice : markMid;
  const unrealizedVsBenchmarkQuote = B * (markMid - bench);

  const { netBase, wacQuotePerBase } = walkAverageCostFromTrades(tradesAsc);
  const denom = Math.max(Math.abs(B), 1e-12);
  const drift = Math.abs(netBase - B) / denom;
  const wacApproximate = drift > 0.15;
  let wacUnrealized: number | null = null;
  if (wacQuotePerBase != null && Number.isFinite(wacQuotePerBase) && B > 1e-12) {
    wacUnrealized = B * (markMid - wacQuotePerBase);
  }

  return {
    inventoryBase: B,
    inventoryQuote: Qq,
    oracleMid: M,
    unrealizedVsBenchmarkQuote,
    wacUnrealizedQuote: wacApproximate ? null : wacUnrealized,
    wacQuotePerBase: wacApproximate ? null : wacQuotePerBase,
    wacApproximate,
  };
}
