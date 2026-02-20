'use client';

import { Loader2 } from 'lucide-react';
import { useSpotBottomPanel } from './useSpotBottomPanel';

interface SpotBottomPanelProps {
  symbol: string;
  isAuth: boolean;
  ordersVersion?: number;
}

export function SpotBottomPanel(props: SpotBottomPanelProps) {
  const { symbol, isAuth, ordersVersion = 0 } = props;
  const data = useSpotBottomPanel({ symbol, isAuth, ordersVersion });

  if (!isAuth) {
    return (
      <div className="h-[200px] flex-shrink-0 flex items-center justify-center border-t border-white/5 bg-[#0b0e11] text-gray-500 text-sm">
        Sign in to view open orders, order history, and trade history
      </div>
    );
  }

  return (
    <div className="h-[260px] flex-shrink-0 flex border-t border-white/5 bg-[#0b0e11]">
      <div className="flex border-r border-white/5">
        <button
          type="button"
          onClick={() => data.setTab('open')}
          className="px-4 py-2 text-xs font-medium text-white"
        >
          Open Orders
        </button>
        <button
          type="button"
          onClick={() => data.setTab('orders')}
          className="px-4 py-2 text-xs font-medium text-gray-500"
        >
          Order History
        </button>
        <button
          type="button"
          onClick={() => data.setTab('trades')}
          className="px-4 py-2 text-xs font-medium text-gray-500"
        >
          Trade History
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-auto p-4 text-xs text-gray-500">
        {data.tab === 'open' && (data.openLoading ? <Loader2 className="animate-spin" /> : `Open: ${data.openOrders.length}`)}
        {data.tab === 'orders' && (data.orderHistoryLoading ? <Loader2 className="animate-spin" /> : `History: ${data.orderHistory.length}`)}
        {data.tab === 'trades' && (data.tradesLoading ? <Loader2 className="animate-spin" /> : `Trades: ${data.trades.length}`)}
      </div>
    </div>
  );
}
