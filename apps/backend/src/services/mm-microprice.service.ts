/**
 * Order-book microprice μ = (P_bid·Q_ask + P_ask·Q_bid)/(Q_bid+Q_ask) with trading-desk reliability gates.
 */
import { getCachedOrderbook, getOrderbookFromDb, type OrderbookSnapshot } from './spot-orderbook-cache.service.js';
import { redis } from '../lib/redis.js';
import { config } from '../config/index.js';

const MICRO_PREV_PREFIX = 'mm:micro_prev:';

export type ReliableMicroprice = {
  price: number | null;
  reliable: boolean;
  notionalBidQuote: number;
  notionalAskQuote: number;
  spreadBpsTop: number;
};

function parseSnap(snap: OrderbookSnapshot | null, topLevels: number): OrderbookSnapshot | null {
  if (!snap?.bids?.length || !snap?.asks?.length) return null;
  return {
    ...snap,
    bids: snap.bids.slice(0, topLevels),
    asks: snap.asks.slice(0, topLevels),
  };
}

async function loadBook(symbol: string, topLevels: number): Promise<OrderbookSnapshot | null> {
  let snap = await getCachedOrderbook(symbol, topLevels);
  snap = parseSnap(snap, topLevels);
  if (!snap) {
    try {
      const dbSnap = await getOrderbookFromDb(symbol, topLevels);
      snap = parseSnap(dbSnap, topLevels);
    } catch {
      return null;
    }
  }
  return snap;
}

/**
 * Raw microprice from top of book (single level).
 */
export async function getMicroprice(symbol: string, topLevels = 1): Promise<number | null> {
  const snap = await loadBook(symbol, Math.max(1, topLevels));
  if (!snap) return null;
  const b0 = snap.bids[0];
  const a0 = snap.asks[0];
  if (!b0 || !a0) return null;
  const Pb = parseFloat(b0.price);
  const Qb = parseFloat(b0.quantity);
  const Pa = parseFloat(a0.price);
  const Qa = parseFloat(a0.quantity);
  if (![Pb, Qb, Pa, Qa].every((x) => Number.isFinite(x) && x > 0)) return null;
  const den = Qb + Qa;
  if (den <= 0) return null;
  return (Pb * Qa + Pa * Qb) / den;
}

/**
 * Ignore microprice when top depth is thin, spread is wide vs mid, or μ jumps vs recent print (unstable).
 */
export async function getReliableMicroprice(symbol: string): Promise<ReliableMicroprice> {
  const em = config.eliteMm;
  const L = Math.max(1, Math.min(10, em.deskMicroReliabilityLevels));
  const snap = await loadBook(symbol, L);
  const bad = (): ReliableMicroprice => ({
    price: null,
    reliable: false,
    notionalBidQuote: 0,
    notionalAskQuote: 0,
    spreadBpsTop: 0,
  });
  if (!snap) return bad();

  const b0 = snap.bids[0];
  const a0 = snap.asks[0];
  if (!b0 || !a0) return bad();

  const Pb = parseFloat(b0.price);
  const Qb = parseFloat(b0.quantity);
  const Pa = parseFloat(a0.price);
  const Qa = parseFloat(a0.quantity);
  if (![Pb, Qb, Pa, Qa].every((x) => Number.isFinite(x) && x > 0)) return bad();

  let notionalBidQuote = 0;
  let notionalAskQuote = 0;
  for (const b of snap.bids) {
    const p = parseFloat(b.price);
    const q = parseFloat(b.quantity);
    if (Number.isFinite(p) && Number.isFinite(q) && p > 0 && q > 0) notionalBidQuote += p * q;
  }
  for (const a of snap.asks) {
    const p = parseFloat(a.price);
    const q = parseFloat(a.quantity);
    if (Number.isFinite(p) && Number.isFinite(q) && p > 0 && q > 0) notionalAskQuote += p * q;
  }

  const midTop = (Pb + Pa) / 2;
  const spreadBpsTop = midTop > 0 ? ((Pa - Pb) / midTop) * 10_000 : 9999;

  const minN = Math.max(0, em.deskMicroMinNotionalQuote);
  const depthOk =
    notionalBidQuote >= minN &&
    notionalAskQuote >= minN &&
    spreadBpsTop <= em.deskMicroMaxSpreadBpsTop;

  const den = Qb + Qa;
  if (den <= 0) return bad();
  const micro = (Pb * Qa + Pa * Qb) / den;

  let jumpOk = true;
  if (em.deskMicroJumpFilterEnabled && micro > 0) {
    const key = `${MICRO_PREV_PREFIX}${symbol}`;
    try {
      const prevRaw = await redis.get(key);
      if (prevRaw != null && prevRaw !== '') {
        const prev = parseFloat(prevRaw);
        if (Number.isFinite(prev) && prev > 0) {
          const jumpBps = (Math.abs(micro - prev) / prev) * 10_000;
          if (jumpBps > em.deskMicroMaxJumpBps) jumpOk = false;
        }
      }
      if (depthOk && jumpOk) {
        await redis.set(key, String(micro), Math.max(2, em.deskMicroPrevTtlSec));
      }
    } catch {
      /* ignore redis */
    }
  }

  const reliable = depthOk && jumpOk;
  return {
    price: reliable ? micro : null,
    reliable,
    notionalBidQuote,
    notionalAskQuote,
    spreadBpsTop,
  };
}
