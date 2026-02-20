import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { getMessageFromApiError } from '@/lib/errorMessages';

export type Order = {
  id: string;
  market: string;
  side: string;
  type: string;
  price: string | null;
  quantity: string;
  filled_quantity: string;
  status: string;
  created_at: string;
};

export type Trade = {
  id: string;
  order_id: string;
  market: string;
  side: string;
  price: string;
  quantity: string;
  fee: string;
  fee_asset: string | null;
  created_at: string;
};

interface UseSpotBottomPanelParams {
  symbol: string;
  isAuth: boolean;
  ordersVersion: number;
}

export function useSpotBottomPanel({ symbol, isAuth, ordersVersion }: UseSpotBottomPanelParams) {
  const [tab, setTab] = useState<'open' | 'orders' | 'trades'>('open');
  const [openOrders, setOpenOrders] = useState<Order[]>([]);
  const [openLoading, setOpenLoading] = useState(false);
  const [orderHistory, setOrderHistory] = useState<Order[]>([]);
  const [orderHistoryNext, setOrderHistoryNext] = useState<string | null>(null);
  const [orderHistoryLoading, setOrderHistoryLoading] = useState(false);
  const [orderHistoryLoadMore, setOrderHistoryLoadMore] = useState(false);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [tradesLoading, setTradesLoading] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const fetchOpen = useCallback(async () => {
    if (!isAuth) return;
    setOpenLoading(true);
    try {
      const raw = await api.get(`/api/v1/spot/orders?status=OPEN&limit=50`);
      const res = raw as { success?: boolean; data?: { orders?: Order[] } };
      if (res.success && res.data?.orders) {
        setOpenOrders(res.data.orders.filter((o) => !symbol || o.market === symbol));
      }
    } catch {
      setOpenOrders([]);
    } finally {
      setOpenLoading(false);
    }
  }, [isAuth, symbol]);

  const fetchOrderHistory = useCallback(async (cursor: string | null, append: boolean) => {
    if (!isAuth) return;
    if (append) setOrderHistoryLoadMore(true);
    else setOrderHistoryLoading(true);
    try {
      const url = `/api/v1/spot/orders?status=HISTORY&limit=30${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const raw = await api.get(url);
      const res = raw as { success?: boolean; data?: { orders?: Order[]; next_cursor?: string | null } };
      if (res.success && res.data?.orders) {
        const list = res.data.orders.filter((o) => !symbol || o.market === symbol);
        setOrderHistory((prev) => (append ? [...prev, ...list] : list));
        setOrderHistoryNext(res.data.next_cursor ?? null);
      }
    } catch {
      if (!append) setOrderHistory([]);
    } finally {
      if (append) setOrderHistoryLoadMore(false);
      else setOrderHistoryLoading(false);
    }
  }, [isAuth, symbol]);

  const fetchTrades = useCallback(async (page: number) => {
    if (!isAuth) return;
    setTradesLoading(true);
    try {
      const raw = await api.get(
        `/api/v1/spot/trade-history?page=${page}&limit=30${symbol ? `&market=${encodeURIComponent(symbol)}` : ''}`
      );
      const res = raw as { success?: boolean; data?: Trade[] };
      if (res.success && Array.isArray(res.data)) {
        setTrades(res.data);
      } else {
        setTrades([]);
      }
    } catch {
      setTrades([]);
    } finally {
      setTradesLoading(false);
    }
  }, [isAuth, symbol]);

  useEffect(() => {
    if (tab === 'open') fetchOpen();
    if (tab === 'orders') fetchOrderHistory(null, false);
    if (tab === 'trades') fetchTrades(1);
  }, [tab, symbol, ordersVersion, fetchOpen, fetchOrderHistory, fetchTrades]);

  const handleCancel = useCallback(async (orderId: string) => {
    if (!isAuth || cancellingId) return;
    setCancelError(null);
    setCancellingId(orderId);
    try {
      const res = await api.post(`/api/v1/spot/orders/${encodeURIComponent(orderId)}/cancel`, {});
      if (res.success) {
        setOpenOrders((prev) => prev.filter((o) => o.id !== orderId));
      } else {
        setCancelError(getMessageFromApiError(res.error) ?? 'Cancel failed');
      }
    } catch {
      setCancelError('Connection issue. Try again.');
    } finally {
      setCancellingId(null);
    }
  }, [isAuth, cancellingId]);

  return {
    tab,
    setTab,
    openOrders,
    openLoading,
    orderHistory,
    orderHistoryNext,
    orderHistoryLoading,
    orderHistoryLoadMore,
    trades,
    tradesLoading,
    cancellingId,
    cancelError,
    setCancelError,
    fetchOrderHistory,
    fetchTrades,
    handleCancel,
  };
}
