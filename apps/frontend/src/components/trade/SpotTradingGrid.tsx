'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { useThemeStore } from '@/store/theme';
import { useBalancesByAccount } from '@/lib/balances';
import { useSpotFavorites } from '@/hooks/useSpotFavorites';
import { getMessageFromApiError } from '@/lib/errorMessages';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { toast } from '@/components/ui/toaster';
import { SpotMarketDataProvider } from './SpotMarketDataContext';
import { SpotTradingGridTerminal } from './SpotTradingGridTerminal';
import type { OrderUpdateMessage } from '@/hooks/useSpotWs';
import { Skeleton } from '@/components/ui/Skeleton';
import { SPOT_TRADE_HREF } from '@/lib/tier1-canonical-routes';
import { useAuth } from '@/context/AuthContext';

type Market = {
  symbol: string;
  base_asset: string;
  quote_asset: string;
  status?: string;
  maker_fee?: string;
  taker_fee?: string;
  min_qty?: string;
  min_notional?: string;
  price_precision?: number;
  qty_precision?: number;
  last_price?: string | null;
  volume_24h?: string | null;
  open_24h?: string | null;
  high_24h?: string | null;
  low_24h?: string | null;
  change_pct?: number | null;
};

type SpotGridOrderType = 'limit' | 'market' | 'stop_loss' | 'stop_limit' | 'trailing_stop_market';

type TradePreferences = {
  promptConfirmationOrders: boolean;
  promptCancelAllConfirmation: boolean;
};

function toPositiveNumber(value: string): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function spotOrderTypePlacementLabel(t: SpotGridOrderType): string {
  switch (t) {
    case 'market':
      return 'Market';
    case 'limit':
      return 'Limit';
    case 'stop_loss':
      return 'Stop';
    case 'stop_limit':
      return 'Stop-limit';
    case 'trailing_stop_market':
      return 'Trailing stop';
    default:
      return t;
  }
}

function generateClientOrderId(): string {
  return crypto.randomUUID?.() ?? 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function SpotTradingGrid() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const symbolParam = searchParams.get('symbol')?.toUpperCase().replace(/-/g, '_') ?? '';
  const { accessToken, user } = useAuthStore();
  const { authResolved, isAuthenticated } = useAuth();
  const { resolvedTheme } = useThemeStore();
  const isAuth = authResolved && isAuthenticated && Boolean(accessToken);
  const chartTheme = resolvedTheme === 'dark' ? 'dark' : 'light';
  const [chartIntervalSeconds, setChartIntervalSeconds] = useState(60);
  const [chartViewMode, setChartViewMode] = useState<'chart' | 'depth'>('chart');

  const [markets, setMarkets] = useState<Market[]>([]);
  const [marketsLoading, setMarketsLoading] = useState(true);
  const [marketsError, setMarketsError] = useState<string | null>(null);
  const [symbol, setSymbol] = useState('');

  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [orderType, setOrderType] = useState<SpotGridOrderType>('limit');
  const [timeInForce, setTimeInForce] = useState<'gtc' | 'ioc' | 'fok'>('gtc');
  const [postOnly, setPostOnly] = useState(false);
  const [price, setPrice] = useState('');
  const [stopPrice, setStopPrice] = useState('');
  const [trailingDelta, setTrailingDelta] = useState('');
  const [quantity, setQuantity] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [ordersVersion, setOrdersVersion] = useState(0);
  const [tradesVersion, setTradesVersion] = useState(0);
  const [tradePreferences, setTradePreferences] = useState<TradePreferences>({
    promptConfirmationOrders: true,
    promptCancelAllConfirmation: true,
  });
  const [preferencesSyncIssue, setPreferencesSyncIssue] = useState(false);
  const clientOrderIdRef = useRef(generateClientOrderId());

  const { data: balancesByAccount = [], refetch: refetchBalances } = useBalancesByAccount(isAuth);
  const { sortWithFavoritesFirst, isFavorite, toggle: toggleFavorite } = useSpotFavorites();
  const balanceMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const row of balancesByAccount) {
      m[row.symbol] = row.trading ?? '0';
    }
    return m;
  }, [balancesByAccount]);

  const sortedMarkets = useMemo(() => sortWithFavoritesFirst(markets), [markets, sortWithFavoritesFirst]);
  const selectedMarket = useMemo(() => markets.find((m) => m.symbol === symbol), [markets, symbol]);
  const baseAsset = selectedMarket?.base_asset ?? '';
  const quoteAsset = selectedMarket?.quote_asset ?? '';

  const setSymbolAndUrl = useCallback(
    (s: string) => {
      setSymbol(s);
      const base = pathname === '/dashboard/spot' ? '/dashboard/spot' : SPOT_TRADE_HREF;
      router.replace(`${base}?symbol=${encodeURIComponent(s)}`, { scroll: false });
    },
    [router, pathname]
  );

  const handleSideChange = useCallback((s: 'buy' | 'sell') => {
    setSide(s);
  }, []);

  useEffect(() => {
    if (orderType !== 'limit') setPostOnly(false);
  }, [orderType]);

  useEffect(() => {
    if (postOnly && timeInForce !== 'gtc') setTimeInForce('gtc');
  }, [postOnly, timeInForce]);

  const availableBalance = useMemo(() => {
    if (side === 'buy') return balanceMap[quoteAsset] ?? '0';
    return balanceMap[baseAsset] ?? '0';
  }, [side, baseAsset, quoteAsset, balanceMap]);

  const quoteBalance = useMemo(() => balanceMap[quoteAsset] ?? '0', [quoteAsset, balanceMap]);
  const baseBalance = useMemo(() => balanceMap[baseAsset] ?? '0', [baseAsset, balanceMap]);

  useEffect(() => {
    if (!isAuth) {
      setTradePreferences({
        promptConfirmationOrders: true,
        promptCancelAllConfirmation: true,
      });
      return;
    }
    const ac = new AbortController();
    void api
      .get<Partial<TradePreferences>>('/api/v1/auth/preferences', { signal: ac.signal, notifyOnError: false })
      .then((res) => {
        if (!res.success || !res.data) return;
        setPreferencesSyncIssue(false);
        setTradePreferences((prev) => ({
          promptConfirmationOrders:
            typeof res.data?.promptConfirmationOrders === 'boolean'
              ? res.data.promptConfirmationOrders
              : prev.promptConfirmationOrders,
          promptCancelAllConfirmation:
            typeof res.data?.promptCancelAllConfirmation === 'boolean'
              ? res.data.promptCancelAllConfirmation
              : prev.promptCancelAllConfirmation,
        }));
      })
      .catch(() => {
        setPreferencesSyncIssue(true);
      });
    return () => ac.abort();
  }, [isAuth]);

  const validateOrderInput = useCallback(
    (candidateSide: 'buy' | 'sell', candidateQty: string): string | null => {
      const qty = toPositiveNumber(candidateQty.trim());
      if (!qty) return 'Enter a valid quantity greater than 0.';

      if (orderType === 'limit' || orderType === 'stop_limit') {
        if (!toPositiveNumber(price.trim())) return 'Enter a valid limit price greater than 0.';
      }
      if (orderType === 'stop_loss' || orderType === 'stop_limit') {
        if (!toPositiveNumber(stopPrice.trim())) return 'Enter a valid trigger price greater than 0.';
      }
      if (orderType === 'trailing_stop_market') {
        const delta = toPositiveNumber(trailingDelta.trim());
        if (!delta || delta > 100) return 'Enter trailing delta between 0 and 100.';
      }

      const minQty = selectedMarket?.min_qty ? Number(selectedMarket.min_qty) : NaN;
      if (Number.isFinite(minQty) && minQty > 0 && qty < minQty) {
        return `Minimum quantity is ${selectedMarket?.min_qty} ${baseAsset}.`;
      }

      const referencePrice = toPositiveNumber(price.trim());
      const minNotional = selectedMarket?.min_notional ? Number(selectedMarket.min_notional) : NaN;
      if (
        Number.isFinite(minNotional) &&
        minNotional > 0 &&
        Number.isFinite(referencePrice) &&
        referencePrice != null &&
        qty * referencePrice < minNotional
      ) {
        return `Minimum notional is ${selectedMarket?.min_notional} ${quoteAsset}.`;
      }

      if (candidateSide === 'buy' && Number(quoteBalance || '0') <= 0) {
        return `Insufficient ${quoteAsset} balance for buy order.`;
      }
      if (candidateSide === 'sell' && qty > Number(baseBalance || '0')) {
        return `Insufficient ${baseAsset} balance for sell order.`;
      }
      return null;
    },
    [
      orderType,
      price,
      stopPrice,
      trailingDelta,
      selectedMarket?.min_qty,
      selectedMarket?.min_notional,
      baseAsset,
      quoteAsset,
      quoteBalance,
      baseBalance,
    ]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement;
      const panel = document.getElementById('spot-order-entry-panel');

      if (e.key === 'Enter') {
        if (!panel?.contains(target)) return;
        if (target.closest('[role="dialog"]')) return;
        if (target.tagName === 'TEXTAREA' && e.shiftKey) return;
        const btn = panel.querySelector<HTMLButtonElement>('[data-spot-place-order]');
        if (btn && !btn.disabled) {
          e.preventDefault();
          btn.click();
        }
        return;
      }

      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      const key = e.key?.toLowerCase();
      if (key === 'b') {
        setSide('buy');
        e.preventDefault();
        requestAnimationFrame(() => document.getElementById('spot-price')?.focus());
      } else if (key === 's') {
        setSide('sell');
        e.preventDefault();
        requestAnimationFrame(() => document.getElementById('spot-price')?.focus());
      } else if (key === 'p') {
        document.getElementById('spot-price')?.focus();
        e.preventDefault();
      } else if (key === 'q') {
        document.getElementById('spot-quantity')?.focus();
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handlePriceClick = useCallback((p: string, q: string) => {
    setPrice(p);
    setQuantity((prev) => {
      if (q && !prev.trim()) return q;
      return prev;
    });
  }, []);

  const handleSubmit = useCallback(async (overrideSide?: 'buy' | 'sell', overrideQty?: string): Promise<void> => {
    const effectiveSide = overrideSide ?? side;
    const effectiveQty = (overrideQty ?? quantity).trim();
    if (!isAuth || !symbol || submitting) {
      throw new Error('Cannot submit order');
    }
    const validationError = validateOrderInput(effectiveSide, effectiveQty);
    if (validationError) {
      setSubmitError(validationError);
      toast({ title: 'Order not placed', description: validationError, variant: 'destructive' });
      throw new Error(validationError);
    }
    setSubmitError(null);
    setSubmitting(true);
    if (overrideSide) setSide(overrideSide);
    if (overrideQty) setQuantity(overrideQty);
    const qtySnap = effectiveQty;
    try {
      const cid = generateClientOrderId();
      clientOrderIdRef.current = cid;
      const body: Record<string, string | boolean> = {
        market: symbol,
        side: effectiveSide,
        type: orderType,
        quantity: qtySnap,
        client_order_id: cid,
      };
      if ((orderType === 'limit' || orderType === 'stop_limit') && price.trim()) body.price = price.trim();
      if ((orderType === 'stop_loss' || orderType === 'stop_limit') && stopPrice.trim()) body.stop_price = stopPrice.trim();
      if (orderType === 'trailing_stop_market' && trailingDelta.trim()) body.trailing_delta = trailingDelta.trim();
      if (orderType === 'limit' || orderType === 'stop_limit') body.time_in_force = timeInForce;
      if (orderType === 'market' || orderType === 'trailing_stop_market') body.time_in_force = 'ioc';
      if (orderType === 'limit' && postOnly) body.post_only = true;

      const res = await api.post<{
        id?: string;
        status?: string;
        displayStatus?: string;
        filled_quantity?: string;
      }>('/api/v1/spot/order', body);
      if (res.success) {
        const base = baseAsset;
        const sd = effectiveSide;
        const ot = orderType;
        const d = res.data;
        const st = String(d?.status ?? '').toUpperCase();
        const label = typeof d?.displayStatus === 'string' ? d.displayStatus : st || 'Accepted';
        setQuantity('');
        setPrice('');
        setStopPrice('');
        setTrailingDelta('');
        setOrdersVersion((v) => v + 1);
        queryClient.invalidateQueries({ queryKey: ['balances'] });
        refetchBalances();
        const baseDesc = `${sd === 'buy' ? 'Buy' : 'Sell'} ${qtySnap} ${base} · ${spotOrderTypePlacementLabel(ot)}`;
        if (st === 'FILLED') {
          toast({ title: 'Filled', description: `${baseDesc} — fully matched.`, variant: 'success' });
        } else if (st === 'PARTIALLY_FILLED') {
          const fq = d?.filled_quantity?.trim();
          toast({
            title: 'Partially filled',
            description: fq ? `${baseDesc} — ${fq} filled so far.` : `${baseDesc} — partially filled.`,
            variant: 'default',
          });
        } else if (st === 'REJECTED') {
          toast({ title: 'Order rejected', description: `${baseDesc} was not accepted.`, variant: 'destructive' });
        } else {
          toast({
            title: 'Order accepted',
            description: `${baseDesc}. Status: ${label}. Open Orders updates live; fills notify here.`,
            variant: 'success',
          });
        }
      } else {
        const code = res.error?.code ? ` (${res.error.code})` : '';
        const msg = getMessageFromApiError(res.error) ?? res.error?.message ?? 'Order was not accepted';
        const detail = `${msg}${code}`;
        setSubmitError(detail);
        toast({
          title: 'Order not placed',
          description: detail,
          variant: 'destructive',
        });
        const rej = new Error(detail) as Error & { spotApiRejected?: true };
        rej.spotApiRejected = true;
        throw rej;
      }
    } catch (e) {
      if (e && typeof e === 'object' && 'spotApiRejected' in e) {
        throw e;
      }
      if (e instanceof Error && e.message === 'Cannot submit order') {
        throw e;
      }
      const msg =
        e instanceof Error ? e.message : 'Could not reach the server. Check your connection and try again.';
      setSubmitError(msg);
      toast({ title: 'Order not placed', description: msg, variant: 'destructive' });
      throw e;
    } finally {
      setSubmitting(false);
    }
  }, [
    isAuth,
    symbol,
    side,
    orderType,
    timeInForce,
    postOnly,
    price,
    stopPrice,
    trailingDelta,
    quantity,
    submitting,
    baseAsset,
    validateOrderInput,
    queryClient,
    refetchBalances,
  ]);

  const onOrderStreamStatus = useCallback((data: OrderUpdateMessage) => {
    const st = (data.status || '').toUpperCase();
    const mkt = data.market ? `${data.market} — ` : '';
    const disp = data.displayStatus ? String(data.displayStatus) : st;
    if (st === 'PENDING_TRIGGER') {
      toast({ title: 'Pending trigger', description: `${mkt}Activates when stop conditions are met.`, variant: 'default' });
      return;
    }
    if (st === 'FILLED') {
      toast({
        title: 'Filled',
        description: data.market
          ? `${data.market} — order fully matched. Balances update automatically.`
          : 'Order fully matched.',
        variant: 'success',
      });
      return;
    }
    if (st === 'PARTIALLY_FILLED') {
      const fq = data.filled_quantity?.trim();
      const q = data.quantity?.trim();
      const detail =
        fq && q
          ? `${fq} of ${q} filled; remainder stays on the book unless cancelled.`
          : disp || 'Part of your order matched.';
      toast({
        title: 'Partial fill',
        description: detail,
        variant: 'default',
      });
      return;
    }
    if (st === 'CANCELLED') {
      toast({ title: 'Cancelled', description: `${mkt}Order removed from the book.`, variant: 'default' });
      return;
    }
    if (st === 'REJECTED') {
      toast({ title: 'Rejected', description: `${mkt}${disp || 'Order was rejected.'}`, variant: 'destructive' });
    }
  }, []);

  const fetchMarkets = useCallback(
    async (signal?: AbortSignal) => {
      setMarketsError(null);
      setMarketsLoading(true);
      try {
        const res = await api.get<Market[]>('/api/v1/spot/markets', {
          signal,
          notifyOnError: false,
          skipAuth: true,
        });
        if (signal?.aborted) return;
        if (res.success && Array.isArray(res.data) && res.data.length > 0) {
          setMarkets(res.data);
          const preferred = res.data.find((m) => m.symbol === 'BTC_USDT');
          const sym =
            symbolParam && res.data.some((m) => m.symbol === symbolParam)
              ? symbolParam
              : (preferred?.symbol ?? res.data[0]!.symbol);
          setSymbol(sym);
        } else {
          setMarkets([]);
          setMarketsError(res.success ? 'No markets available' : (res.error?.message ?? 'Failed to load markets'));
        }
      } catch (e) {
        if ((e as { name?: string })?.name === 'AbortError') return;
        setMarkets([]);
        setMarketsError('Failed to load markets. Retry.');
      } finally {
        if (!signal?.aborted) setMarketsLoading(false);
      }
    },
    [symbolParam]
  );

  useEffect(() => {
    const ac = new AbortController();
    const fallback = setTimeout(() => {
      ac.abort();
      setMarketsLoading(false);
      setMarketsError('Request timed out — backend slow or unreachable. Start API (e.g. port 4000) and retry.');
    }, 45000);

    fetchMarkets(ac.signal).finally(() => clearTimeout(fallback));

    return () => {
      ac.abort();
      clearTimeout(fallback);
    };
  }, [symbolParam, fetchMarkets]);

  if (marketsLoading && markets.length === 0 && !marketsError) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-muted px-4 dark:bg-background">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" aria-hidden />
        <p className="text-sm font-medium text-muted-foreground">Loading spot markets…</p>
      </div>
    );
  }

  if (markets.length === 0) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-5 bg-muted px-4 dark:bg-background">
        <div className="max-w-md rounded-xl border border-border bg-card p-6 text-center shadow-sm dark:border-border dark:bg-card">
          <p className="text-sm font-semibold text-foreground">
            {marketsError || 'No spot markets available'}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Start the backend, ensure Postgres is up, and run migrations/seed if{' '}
            <code className="rounded bg-accent px-1 dark:bg-accent">spot_markets</code> is empty.
          </p>
          {typeof window !== 'undefined' && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              API base: <span className="font-mono">{getApiBaseUrl() || '(same origin)'}</span>
              {' · '}
              Override with <span className="font-mono">NEXT_PUBLIC_API_BASE_URL</span>
            </p>
          )}
          {(marketsError || marketsLoading) && (
            <button
              type="button"
              onClick={() => fetchMarkets()}
              disabled={marketsLoading}
              className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-foreground hover:bg-primary/85 disabled:opacity-50"
            >
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  if (markets.length > 0 && !symbol) {
    return (
      <div
        className="flex h-full w-full flex-col bg-background"
        aria-busy="true"
        aria-label="Preparing trading terminal"
      >
        <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4 dark:border-border">
          <Skeleton className="h-8 w-36" />
          <Skeleton className="h-8 max-w-sm flex-1" />
        </div>
        <div className="flex min-h-0 flex-1 gap-2 p-2">
          <Skeleton className="hidden w-40 shrink-0 rounded-lg sm:block" />
          <Skeleton className="min-h-0 flex-1 rounded-lg" />
        </div>
      </div>
    );
  }

  return (
    <SpotMarketDataProvider
      symbol={symbol}
      isAuth={isAuth}
      onOrderActivity={() => setOrdersVersion((v) => v + 1)}
      onUserTradeActivity={() => setTradesVersion((v) => v + 1)}
      onOrderStreamStatus={onOrderStreamStatus}
    >
      <SpotTradingGridTerminal
        markets={markets}
        sortedMarkets={sortedMarkets}
        symbol={symbol}
        setSymbolAndUrl={setSymbolAndUrl}
        isAuth={isAuth}
        userTierLevel={user?.tierLevel}
        chartTheme={chartTheme}
        chartIntervalSeconds={chartIntervalSeconds}
        setChartIntervalSeconds={setChartIntervalSeconds}
        chartViewMode={chartViewMode}
        setChartViewMode={setChartViewMode}
        isFavorite={isFavorite}
        toggleFavorite={toggleFavorite}
        side={side}
        orderType={orderType}
        timeInForce={timeInForce}
        postOnly={postOnly}
        price={price}
        stopPrice={stopPrice}
        trailingDelta={trailingDelta}
        submitting={submitting}
        submitError={submitError}
        setSubmitError={setSubmitError}
        ordersVersion={ordersVersion}
        tradesVersion={tradesVersion}
        handleSideChange={handleSideChange}
        setOrderType={setOrderType}
        setPrice={setPrice}
        setStopPrice={setStopPrice}
        setTrailingDelta={setTrailingDelta}
        setQuantity={setQuantity}
        setTimeInForce={setTimeInForce}
        setPostOnly={setPostOnly}
        handleSubmit={handleSubmit}
        handlePriceClick={handlePriceClick}
        availableBalance={availableBalance}
        quoteBalance={quoteBalance}
        baseBalance={baseBalance}
        requireOrderConfirmation={tradePreferences.promptConfirmationOrders}
        requireCancelAllConfirmation={tradePreferences.promptCancelAllConfirmation}
        preferencesSyncIssue={preferencesSyncIssue}
      />
    </SpotMarketDataProvider>
  );
}
