import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { getMessageFromApiError } from '@/lib/errorMessages';
import { toast } from '@/components/ui/toaster';

export type Order = {
  id: string;
  market: string;
  side: string;
  type?: string;
  price: string | null;
  stop_price?: string | null;
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
  tradesVersion?: number;
}

export function useSpotBottomPanel({ symbol, isAuth, ordersVersion, tradesVersion = 0 }: UseSpotBottomPanelParams) {
  const [tab, setTab] = useState<'open' | 'orders' | 'trades' | 'assets'>('open');
  const [openOrders, setOpenOrders] = useState<Order[]>([]);
  const [openLoading, setOpenLoading] = useState(false);
  const [orderHistory, setOrderHistory] = useState<Order[]>([]);
  const [orderHistoryNext, setOrderHistoryNext] = useState<string | null>(null);
  const [orderHistoryLoading, setOrderHistoryLoading] = useState(false);
  const [orderHistoryLoadMore, setOrderHistoryLoadMore] = useState(false);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [tradesPage, setTradesPage] = useState(1);
  const [tradesTotalPages, setTradesTotalPages] = useState(1);
  const [tradesLoading, setTradesLoading] = useState(false);
  const [tradesLoadMore, setTradesLoadMore] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancellingAll, setCancellingAll] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const fetchOpen = useCallback(async () => {
    if (!isAuth) return;
    setOpenLoading(true);
    try {
      const raw = await api.get(`/api/v1/spot/orders?status=OPEN&limit=50`, { notifyOnError: false });
      const res = raw as { success?: boolean; data?: { orders?: Order[] }; orders?: Order[] };
      const orders = (res.success && (res.data?.orders ?? res.orders)) ? (res.data?.orders ?? res.orders ?? []) : [];
      setOpenOrders(Array.isArray(orders) ? orders : []);
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
      const raw = await api.get(url, { notifyOnError: false });
      const res = raw as { success?: boolean; data?: { orders?: Order[]; next_cursor?: string | null }; orders?: Order[] };
      const orders = (res.success && (res.data?.orders ?? res.orders)) ? (res.data?.orders ?? res.orders ?? []) : [];
      const list = Array.isArray(orders) ? orders : [];
      setOrderHistory((prev) => (append ? [...prev, ...list] : list));
      setOrderHistoryNext(res.data?.next_cursor ?? null);
    } catch {
      if (!append) setOrderHistory([]);
    } finally {
      if (append) setOrderHistoryLoadMore(false);
      else setOrderHistoryLoading(false);
    }
  }, [isAuth, symbol]);

  const fetchTrades = useCallback(async (page: number, append: boolean) => {
    if (!isAuth) return;
    if (append) setTradesLoadMore(true);
    else setTradesLoading(true);
    try {
      const raw = await api.get(
        `/api/v1/spot/trade-history?page=${page}&limit=30`,
        { notifyOnError: false }
      );
      const res = raw as { success?: boolean; data?: Trade[]; pagination?: { page: number; totalPages: number; total: number } };
      if (res.success && Array.isArray(res.data)) {
        setTrades((prev) => (append ? [...prev, ...res.data!] : res.data!));
        if (res.pagination) {
          setTradesTotalPages(res.pagination.totalPages ?? 1);
          setTradesPage(append ? page : (res.pagination.page ?? 1));
        }
      } else if (!append) {
        setTrades([]);
      }
    } catch {
      if (!append) setTrades([]);
    } finally {
      if (append) setTradesLoadMore(false);
      else setTradesLoading(false);
    }
  }, [isAuth, symbol]);

  useEffect(() => {
    if (tab === 'open') fetchOpen();
    if (tab === 'orders') fetchOrderHistory(null, false);
    if (tab === 'trades') fetchTrades(1, false);
  }, [tab, symbol, ordersVersion, tradesVersion, fetchOpen, fetchOrderHistory, fetchTrades]);

  const handleCancel = useCallback(async (orderId: string) => {
    if (!isAuth || cancellingId) return;
    setCancelError(null);
    setCancellingId(orderId);
    try {
      const res = await api.post(`/api/v1/spot/orders/${encodeURIComponent(orderId)}/cancel`, {});
      if (res.success) {
        setOpenOrders((prev) => prev.filter((o) => o.id !== orderId));
        toast({ title: 'Order cancelled', description: 'Removed from the open order book.', variant: 'default' });
      } else {
        setCancelError(getMessageFromApiError(res.error) ?? 'Cancel failed');
        toast({
          title: 'Cancel failed',
          description: getMessageFromApiError(res.error) ?? 'Could not cancel order',
          variant: 'destructive',
        });
      }
    } catch {
      setCancelError('Connection issue. Try again.');
    } finally {
      setCancellingId(null);
    }
  }, [isAuth, cancellingId]);

  const handleCancelAll = useCallback(async () => {
    if (!isAuth || !symbol || cancellingAll) return;
    const forMarket = openOrders.filter((o) => o.market === symbol);
    if (forMarket.length === 0) return;
    setCancelError(null);
    setCancellingAll(true);
    try {
      const res = await api.post('/api/v1/spot/orders/cancel-all', { market: symbol });
      if (res.success) {
        setOpenOrders((prev) => prev.filter((o) => o.market !== symbol));
        toast({
          title: 'Orders cancelled',
          description: `All open orders for ${symbol} were cancelled.`,
          variant: 'default',
        });
      } else {
        setCancelError(getMessageFromApiError(res.error) ?? 'Cancel all failed');
        toast({
          title: 'Cancel all failed',
          description: getMessageFromApiError(res.error) ?? 'Could not cancel all',
          variant: 'destructive',
        });
      }
    } catch {
      setCancelError('Connection issue. Try again.');
    } finally {
      setCancellingAll(false);
    }
  }, [isAuth, symbol, openOrders, cancellingAll]);

  const loadMoreTrades = useCallback(() => {
    const nextPage = tradesPage + 1;
    if (nextPage <= tradesTotalPages && !tradesLoadMore) {
      setTradesPage(nextPage);
      fetchTrades(nextPage, true);
    }
  }, [tradesPage, tradesTotalPages, tradesLoadMore, fetchTrades]);

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
    tradesLoadMore,
    tradesPage,
    tradesTotalPages,
    loadMoreTrades,
    cancellingId,
    cancellingAll,
    cancelError,
    setCancelError,
    fetchOpen,
    fetchOrderHistory,
    fetchTrades,
    handleCancel,
    handleCancelAll,
    openOrdersForMarket: symbol ? openOrders.filter((o) => o.market === symbol) : openOrders,
  };
}
