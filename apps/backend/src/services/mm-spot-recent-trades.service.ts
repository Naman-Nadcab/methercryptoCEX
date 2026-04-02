/**
 * Recent spot_trades rows for MM flow / microstructure (schema-aware: market vs trading_pair_id).
 */
import { db } from '../lib/database.js';
import { getSpotTradesUseMarketSync } from '../lib/spot-schema-cache.js';

export type MmTradeTick = {
  side: 'buy' | 'sell';
  qty: number;
  price: number;
  createdAt: Date;
};

function parseSide(raw: string | null): 'buy' | 'sell' | null {
  const s = (raw ?? '').trim().toLowerCase();
  if (s === 'buy' || s === 'b') return 'buy';
  if (s === 'sell' || s === 's') return 'sell';
  return null;
}

export async function fetchRecentTradesForMm(symbol: string, windowSec: number, limit: number): Promise<MmTradeTick[]> {
  const w = Math.max(5, Math.min(600, Math.floor(windowSec)));
  const lim = Math.max(10, Math.min(500, Math.floor(limit)));
  const useMarket = getSpotTradesUseMarketSync();

  try {
    if (useMarket) {
      const r = await db.query<{ side: string; qty: string; price: string; created_at: Date }>(
        `SELECT lower(side::text) AS side, quantity::text AS qty, price::text AS price, created_at
         FROM spot_trades
         WHERE market = $1 AND created_at > NOW() - ($2::text || ' seconds')::interval
         ORDER BY created_at DESC
         LIMIT $3`,
        [symbol, String(w), lim]
      );
      return r.rows
        .map((row) => {
          const side = parseSide(row.side);
          const qty = parseFloat(row.qty);
          const price = parseFloat(row.price);
          if (!side || !Number.isFinite(qty) || !Number.isFinite(price) || price <= 0) return null;
          return { side, qty, price, createdAt: row.created_at };
        })
        .filter((x): x is MmTradeTick => x != null);
    }

    const r = await db.query<{ side: string; qty: string; price: string; created_at: Date }>(
      `SELECT lower(st.side::text) AS side, st.quantity::text AS qty, st.price::text AS price, st.created_at
       FROM spot_trades st
       INNER JOIN trading_pairs tp ON tp.id = st.trading_pair_id
       WHERE tp.symbol = $1 AND st.created_at > NOW() - ($2::text || ' seconds')::interval
       ORDER BY st.created_at DESC
       LIMIT $3`,
      [symbol, String(w), lim]
    );
    return r.rows
      .map((row) => {
        const side = parseSide(row.side);
        const qty = parseFloat(row.qty);
        const price = parseFloat(row.price);
        if (!side || !Number.isFinite(qty) || !Number.isFinite(price) || price <= 0) return null;
        return { side, qty, price, createdAt: row.created_at };
      })
      .filter((x): x is MmTradeTick => x != null);
  } catch {
    return [];
  }
}
