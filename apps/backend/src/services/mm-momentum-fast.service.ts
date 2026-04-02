/**
 * Short-horizon return from recent prints: (p_last/p_first − 1)·10⁴ bps.
 */
import { fetchRecentTradesForMm } from './mm-spot-recent-trades.service.js';
import { config } from '../config/index.js';

export async function getFastMomentumBps(symbol: string): Promise<number> {
  const em = config.eliteMm;
  const w = Math.max(5, Math.min(120, em.deskMomentumWindowSec));
  const rows = await fetchRecentTradesForMm(symbol, w, em.deskMomentumMaxTrades);
  if (rows.length < 2) return 0;
  const chrono = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const p0 = chrono[0]!.price;
  const p1 = chrono[chrono.length - 1]!.price;
  if (!Number.isFinite(p0) || !Number.isFinite(p1) || p0 <= 0) return 0;
  return ((p1 - p0) / p0) * 10_000;
}
