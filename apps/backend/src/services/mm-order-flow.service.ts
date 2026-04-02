/**
 * Order-flow imbalance (OFI) from recent executed trades (volume-signed).
 */
import { config } from '../config/index.js';
import { fetchRecentTradesForMm } from './mm-spot-recent-trades.service.js';

export type OrderFlowImbalance = {
  /** ∈ [-1, 1]: buy-heavy positive, sell-heavy negative. */
  ofi: number;
  buyVol: number;
  sellVol: number;
};

export async function getOrderFlowImbalance(symbol: string): Promise<OrderFlowImbalance> {
  const em = config.eliteMm;
  const rows = await fetchRecentTradesForMm(symbol, em.flowWindowSec, em.flowTradeLimit);
  let buyVol = 0;
  let sellVol = 0;
  for (const t of rows) {
    if (t.side === 'buy') buyVol += t.qty;
    else sellVol += t.qty;
  }
  const tot = buyVol + sellVol;
  if (tot <= 0) return { ofi: 0, buyVol: 0, sellVol: 0 };
  const ofi = (buyVol - sellVol) / tot;
  return { ofi, buyVol, sellVol };
}
