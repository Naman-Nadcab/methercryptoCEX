/**
 * Step-by-step progress for Exchange build.
 * Update status as features are completed. UI reads this to show "Kya karna hai" / "Kya ho chuka hai".
 */
export type StepStatus = 'done' | 'in_progress' | 'pending';

export interface ProgressStep {
  id: string;
  category: 'spot_backend' | 'spot_frontend' | 'p2p_backend' | 'p2p_frontend' | 'general';
  title: string;
  titleHindi?: string;
  description: string;
  status: StepStatus;
  routeOrLocation?: string; // e.g. /trade/spot, POST /api/v1/spot/order
}

export const EXCHANGE_PROGRESS_STEPS: ProgressStep[] = [
  // --- Spot Backend ---
  { id: 'sb-1', category: 'spot_backend', title: 'Limit & market order + matching', titleHindi: 'Limit/Market order + matching', description: 'POST /spot/order — FIFO, partial fills, balance lock.', status: 'done', routeOrLocation: 'POST /api/v1/spot/order' },
  { id: 'sb-2', category: 'spot_backend', title: 'Orderbook cache + WebSocket', titleHindi: 'Orderbook cache + WebSocket', description: 'Redis cache, broadcast on order/cancel.', status: 'done' },
  { id: 'sb-3', category: 'spot_backend', title: 'Candles from trades', titleHindi: 'Trades se candles', description: 'Aggregation job spot_trades → ohlcv_candles.', status: 'done' },
  { id: 'sb-4', category: 'spot_backend', title: 'API key auth for spot (market making)', titleHindi: 'Spot ke liye API key auth (market making)', description: 'X-API-Key se place/cancel order for bots.', status: 'done', routeOrLocation: 'Spot routes' },
  { id: 'sb-5', category: 'spot_backend', title: 'Stop loss / stop limit orders', titleHindi: 'Stop loss / stop limit', description: 'Place, cancel, match logic for stop orders.', status: 'done', routeOrLocation: 'POST /api/v1/spot/order' },
  // --- Spot Frontend ---
  { id: 'sf-1', category: 'spot_frontend', title: 'Place order (limit + market)', titleHindi: 'Order place (limit + market)', description: 'Frontend uses POST /spot/order with matching.', status: 'done', routeOrLocation: '/trade/spot' },
  { id: 'sf-2', category: 'spot_frontend', title: 'Chart with our candle data', titleHindi: 'Apne candle data wala chart', description: 'LightweightCharts + getChartCandles API.', status: 'done' },
  { id: 'sf-3', category: 'spot_frontend', title: 'Chart interval switch (1m/5m/15m/1H/4H/1D)', titleHindi: 'Chart interval switch', description: 'Click se interval change, candles refetch.', status: 'done', routeOrLocation: '/trade/spot' },
  { id: 'sf-4', category: 'spot_frontend', title: 'Trade markers on chart', titleHindi: 'Chart par trade markers', description: 'Executed trades as buy/sell markers on chart.', status: 'done', routeOrLocation: '/trade/spot' },
  { id: 'sf-5', category: 'spot_frontend', title: 'Live orderbook + recent trades + WS', titleHindi: 'Live orderbook + trades', description: 'useSpotWs subscriptions.', status: 'done' },
  { id: 'sf-6', category: 'spot_frontend', title: 'Open orders / history / trade history', titleHindi: 'Open orders / history', description: 'Bottom panel tabs.', status: 'done' },
  // --- P2P Backend ---
  { id: 'pb-1', category: 'p2p_backend', title: 'Ads CRUD + filters', titleHindi: 'Ads create/update/cancel', description: 'p2p.service + p2p.fastify.', status: 'done' },
  { id: 'pb-2', category: 'p2p_backend', title: 'Create order + escrow lock', titleHindi: 'Order + escrow lock', description: 'moveToEscrow in transaction.', status: 'done' },
  { id: 'pb-3', category: 'p2p_backend', title: 'Confirm payment, release, cancel', titleHindi: 'Confirm payment, release, cancel', description: 'confirmPayment, releaseCrypto, cancelOrder.', status: 'done' },
  { id: 'pb-4', category: 'p2p_backend', title: 'Dispute + admin resolve', titleHindi: 'Dispute + admin resolve', description: 'openDispute, resolveDispute.', status: 'done' },
  { id: 'pb-5', category: 'p2p_backend', title: 'Expiry auto-refund (scheduler)', titleHindi: 'Expiry auto-refund', description: 'processExpiredP2POrders every 90s.', status: 'done' },
  { id: 'pb-6', category: 'p2p_backend', title: 'P2P order chat API', titleHindi: 'P2P order chat API', description: 'Messages per order for Binance-style chat.', status: 'done', routeOrLocation: 'GET/POST /p2p/orders/:id/messages' },
  // --- P2P Frontend ---
  { id: 'pf-1', category: 'p2p_frontend', title: 'Ads list, filters, create ad', titleHindi: 'Ads list + create', description: 'P2P trading page.', status: 'done', routeOrLocation: '/p2p' },
  { id: 'pf-2', category: 'p2p_frontend', title: 'Create order, confirm, release, cancel', titleHindi: 'Order flow', description: 'Order detail page actions.', status: 'done', routeOrLocation: '/p2p/orders/[id]' },
  { id: 'pf-3', category: 'p2p_frontend', title: 'Payment methods CRUD', titleHindi: 'Payment methods', description: 'List, add, edit.', status: 'done', routeOrLocation: '/p2p/payment-methods' },
  { id: 'pf-4', category: 'p2p_frontend', title: 'P2P order chat UI', titleHindi: 'P2P order chat UI', description: 'Chat component on order detail (after backend).', status: 'done', routeOrLocation: '/p2p/orders/[id]' },
  // --- General ---
  { id: 'g-1', category: 'general', title: 'Auth: OTP, rate limits, 503 on OTP fail', titleHindi: 'Auth + OTP', description: 'send-otp, verify-otp, OTP_DELIVERY_UNAVAILABLE.', status: 'done' },
  { id: 'g-2', category: 'general', title: 'Progress tracker UI', titleHindi: 'Progress tracker UI', description: 'Yahi page — kya karna hai / kya ho chuka hai.', status: 'done', routeOrLocation: '/dashboard/progress' },
];

export const CATEGORY_LABELS: Record<ProgressStep['category'], string> = {
  spot_backend: 'Spot — Backend',
  spot_frontend: 'Spot — Frontend',
  p2p_backend: 'P2P — Backend',
  p2p_frontend: 'P2P — Frontend',
  general: 'General',
};
