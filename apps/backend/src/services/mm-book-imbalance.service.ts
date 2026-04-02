/**
 * Resting liquidity imbalance at top-K levels (pre-trade adverse proxy).
 * OBI = (ΣQ_bid − ΣQ_ask) / (ΣQ_bid + ΣQ_ask) ∈ [−1,1]
 */
import { getCachedOrderbook, getOrderbookFromDb } from './spot-orderbook-cache.service.js';
import { config } from '../config/index.js';

export async function getTopKBookObi(symbol: string): Promise<number> {
  const em = config.eliteMm;
  const k = Math.max(1, Math.min(15, em.deskBookObiLevels));
  let snap = await getCachedOrderbook(symbol, k);
  if (!snap?.bids?.length || !snap?.asks?.length) {
    try {
      snap = await getOrderbookFromDb(symbol, k);
    } catch {
      return 0;
    }
  }
  let bidQ = 0;
  let askQ = 0;
  for (let i = 0; i < k; i++) {
    const b = snap.bids[i];
    const a = snap.asks[i];
    if (b) {
      const q = parseFloat(b.quantity);
      if (Number.isFinite(q) && q > 0) bidQ += q;
    }
    if (a) {
      const q = parseFloat(a.quantity);
      if (Number.isFinite(q) && q > 0) askQ += q;
    }
  }
  const den = bidQ + askQ;
  if (den <= 0) return 0;
  return Math.max(-1, Math.min(1, (bidQ - askQ) / den));
}
