import { adminFetch } from '@/lib/api';

/** POST /control/orders/cancel-all — cancels ALL open orders on market (all users). */
export async function postAdminCancelAllOrders(token: string | null, market?: string) {
  return adminFetch<{ cancelled: number }>('/control/orders/cancel-all', {
    method: 'POST',
    body: market ? { market } : {},
    token,
  });
}

export type AdminOrderbookLevel = { price: string; quantity: string };

/** GET /spot/orderbook/:symbol — L2 snapshot (admin). */
export async function getAdminSpotOrderbook(
  token: string | null,
  symbol: string,
  depth = 25
) {
  return adminFetch<{
    symbol: string;
    bids: AdminOrderbookLevel[];
    asks: AdminOrderbookLevel[];
    lastUpdateId?: number;
  }>(`/spot/orderbook/${encodeURIComponent(symbol)}`, { token, params: { depth } });
}

/** GET /control/mm-elite-profitability — per-symbol MM metrics (fill quality, MTM, windows). */
export async function getMmEliteProfitability(token: string | null) {
  return adminFetch<{
    configured: boolean;
    message?: string;
    symbols?: Record<string, unknown>;
    capitalWeights?: Record<string, number>;
  }>('/control/mm-elite-profitability', { token });
}
