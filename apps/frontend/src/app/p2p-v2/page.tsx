'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useAuthStore } from '@/store/auth';
import {
  fetchP2PAds,
  fetchMyPaymentMethods,
  createOrder,
  P2P_V2_ADS_KEY,
  type P2PAdRow,
  type P2PPaymentMethodRow,
} from '@/lib/p2pApi';
import { api } from '@/lib/api';
import { toast } from '@/components/ui/toaster';
import { P2PFilters, type P2PFiltersValue } from '@/components/p2p-v2/P2PFilters';
import { P2PAdsTable } from '@/components/p2p-v2/P2PAdsTable';
import {
  p2pAdDisplayPrice,
  p2pAdSide,
  formatFiatSymbol,
  formatP2pFiatPrice,
} from '@/lib/p2p-v2-utils';
import {
  X, Shield, TrendingUp, TrendingDown,
  BadgeCheck, Timer, Crown,
} from 'lucide-react';
import { Skeleton } from '@/components/ui/Skeleton';
import { CoinIcon } from '@/components/ui/CoinIcon';

/* ─── Market data types ─── */
type TickerRow = {
  symbol: string;
  last_price: string | null;
  change_pct: number | null;
  volume_24h: string;
};

function parseNum(s: string | null | undefined): number | null {
  if (s == null || s === '') return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

const priceFmt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 });
function fmtUsd(n: number): string { return '$' + priceFmt.format(n); }

/* ═══════════════════════════════════════════════════════
   TakeOrderModal — logic unchanged, compact UI
   ═══════════════════════════════════════════════════════ */
function TakeOrderModal({
  ad,
  fiat,
  onClose,
  onCreated,
}: {
  ad: P2PAdRow;
  fiat: string;
  onClose: () => void;
  onCreated: (orderId: string) => void;
}) {
  const sym = formatFiatSymbol(fiat);
  const side = p2pAdSide(ad);
  const rawPrice = p2pAdDisplayPrice(ad);
  const priceFmtModal = formatP2pFiatPrice(rawPrice, fiat);
  const min = ad.min_amount ?? '0';
  const max = ad.max_amount ?? '0';
  const accepted = (ad.accepted_platform_method_ids as string[] | undefined) ?? [];

  const { data: methods = [], isLoading: pmLoading } = useQuery({
    queryKey: ['p2p-v2', 'pm-for-order', ad.id],
    queryFn: () => fetchMyPaymentMethods(),
  });

  const selectable = useMemo(() => {
    if (!accepted.length) return methods;
    const set = new Set(accepted);
    return methods.filter((m) => m.payment_method_id && set.has(m.payment_method_id));
  }, [methods, accepted]);

  const [qty, setQty] = useState(min);
  const [pmId, setPmId] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: () =>
      createOrder({
        adId: ad.id,
        quantity: qty.trim(),
        paymentMethodId: pmId,
        idempotencyKey: crypto.randomUUID(),
      }),
    onSuccess: (res) => {
      if (res.success && res.data && typeof res.data === 'object' && 'id' in res.data) {
        onCreated(String((res.data as { id: string }).id));
        onClose();
      } else {
        setErr(res.error?.message ?? 'Order failed');
      }
    },
    onError: () => setErr('Network error'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" role="dialog">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-border/30 bg-card p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-bold text-foreground">
            <CoinIcon symbol={ad.crypto_symbol || ''} size={24} />
            {side === 'sell' ? 'Buy' : 'Sell'} {ad.crypto_symbol}
          </h2>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mb-5 rounded-lg border border-border/20 bg-muted/15 px-4 py-3 text-sm text-muted-foreground">
          <span className="numeric text-lg font-bold tabular-nums text-foreground">{sym}{priceFmtModal}</span>
          <span className="text-muted-foreground"> / {ad.crypto_symbol}</span>
          <span className="mx-2 text-border/40">·</span>
          Limits{' '}
          <span className="numeric font-semibold tabular-nums text-foreground">
            {sym}{formatP2pFiatPrice(min, fiat)} – {sym}{formatP2pFiatPrice(max, fiat)}
          </span>
        </div>

        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Amount ({ad.crypto_symbol})</label>
        <input
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          className="mb-5 w-full rounded-lg border border-border/40 bg-background px-3.5 py-2.5 font-mono text-sm text-foreground transition-colors focus:border-primary/40 focus:outline-none"
        />

        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Payment method</label>
        {pmLoading ? (
          <div className="mb-5 space-y-2">
            <Skeleton className="h-10 w-full rounded-lg" />
          </div>
        ) : selectable.length === 0 ? (
          <p className="mb-5 text-sm text-muted-foreground">
            No matching method.{' '}
            <Link href="/p2p/payment-methods" className="font-semibold text-primary underline underline-offset-2">Add one</Link>
          </p>
        ) : (
          <select
            value={pmId}
            onChange={(e) => setPmId(e.target.value)}
            className="mb-5 w-full rounded-lg border border-border/40 bg-background px-3.5 py-2.5 text-sm text-foreground transition-colors focus:border-primary/40 focus:outline-none"
          >
            <option value="">Select…</option>
            {selectable.map((m: P2PPaymentMethodRow) => (
              <option key={m.id} value={m.id}>{m.display_name || m.method_name}</option>
            ))}
          </select>
        )}

        {err && <p className="mb-4 rounded-md bg-[#f6465d]/8 border border-[#f6465d]/15 px-3 py-2 text-sm font-medium text-[#f6465d]">{err}</p>}

        <button
          type="button"
          disabled={mut.isPending || !pmId || selectable.length === 0}
          onClick={() => mut.mutate()}
          className="w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
        >
          {mut.isPending ? 'Creating…' : 'Create Order'}
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   MAIN PAGE — Binance-style dense trading layout
   ═══════════════════════════════════════════════════════ */
export default function P2PV2MarketplacePage() {
  const queryClient = useQueryClient();
  const { accessToken, _hasHydrated } = useAuthStore();
  const authed = _hasHydrated && !!accessToken;

  /* ── Filters state ── */
  const [filters, setFilters] = useState<P2PFiltersValue>({
    side: 'buy',
    crypto: 'USDT',
    fiat: 'INR',
    paymentCode: '',
  });
  const [modalAd, setModalAd] = useState<P2PAdRow | null>(null);

  /* ── Ads query ── */
  const { data: ads = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: [...P2P_V2_ADS_KEY, filters],
    queryFn: () =>
      fetchP2PAds({
        type: filters.side,
        currency: filters.crypto,
        fiat: filters.fiat,
        limit: 50,
        offset: 0,
      }),
  });

  /* ── Tickers ── */
  const [tickers, setTickers] = useState<TickerRow[]>([]);
  const [tickerLoadFailed, setTickerLoadFailed] = useState(false);

  const fetchTickers = useCallback(async () => {
    try {
      const r = await api.get<TickerRow[]>('/api/v1/spot/tickers', { skipAuth: true, notifyOnError: false });
      if (r.success && Array.isArray(r.data)) {
        setTickers(r.data);
        setTickerLoadFailed(false);
      }
    } catch {
      setTickerLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    void fetchTickers();
    const id = setInterval(() => void fetchTickers(), 15_000);
    return () => clearInterval(id);
  }, [fetchTickers]);

  /* ── Derived values ── */
  const sym = formatFiatSymbol(filters.fiat);

  const spotPrice = useMemo(() => {
    const s = `${filters.crypto}_USDT`;
    const t = tickers.find(x => x.symbol === s);
    return t ? parseNum(t.last_price) : null;
  }, [tickers, filters.crypto]);

  const p2pAvg = useMemo(() => {
    const prices = ads.map(a => parseNum(p2pAdDisplayPrice(a))).filter((n): n is number => n != null && n > 0);
    if (!prices.length) return null;
    return prices.reduce((s, v) => s + v, 0) / prices.length;
  }, [ads]);

  /* ── Quick filter chips ── */
  const [activeChips, setActiveChips] = useState<Set<string>>(() => new Set());
  const toggleChip = useCallback((chip: string) => {
    setActiveChips(prev => {
      const next = new Set(prev);
      next.has(chip) ? next.delete(chip) : next.add(chip);
      return next;
    });
  }, []);

  const chipFilteredAds = useMemo(() => {
    if (activeChips.size === 0) return ads;
    let result = [...ads];
    if (activeChips.has('best_price')) {
      result.sort((a, b) => {
        const pa = parseNum(p2pAdDisplayPrice(a)) ?? Infinity;
        const pb = parseNum(p2pAdDisplayPrice(b)) ?? Infinity;
        return pa - pb;
      });
    }
    if (activeChips.has('verified')) {
      result = result.filter(a => (a as { verified_merchant?: boolean }).verified_merchant);
    }
    if (activeChips.has('fast_trade')) {
      result = result.filter(a => {
        const rt = (a as { merchant_avg_release_time_minutes?: number }).merchant_avg_release_time_minutes;
        return rt != null && Number(rt) <= 5;
      });
    }
    return result;
  }, [ads, activeChips]);

  /* ── Inline ticker items ── */
  const tickerCoins = useMemo(() => {
    return ['BTC_USDT', 'ETH_USDT'].map(sym => {
      const t = tickers.find(x => x.symbol === sym);
      if (!t) return null;
      return { symbol: sym.split('_')[0], price: parseNum(t.last_price), chg: t.change_pct };
    }).filter(Boolean) as { symbol: string; price: number | null; chg: number | null }[];
  }, [tickers]);

  const quickChips = [
    { id: 'best_price', label: 'Best Price', icon: Crown },
    { id: 'fast_trade', label: 'Fast Trade', icon: Timer },
    { id: 'verified', label: 'Verified', icon: BadgeCheck },
  ];

  return (
    <div className="mx-auto max-w-[1200px] px-4 sm:px-6">

      {/* ── Header strip ── */}
      <div className="flex flex-col gap-3 border-b border-border/20 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">P2P Trading</h1>
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-[#0ecb81]/10 px-2.5 py-1 text-xs font-semibold text-[#0ecb81] ring-1 ring-[#0ecb81]/20 sm:inline-flex">
            <Shield className="h-3.5 w-3.5 shrink-0" />
            Escrow
          </span>
        </div>

        {/* Inline tickers */}
        <div className="hidden flex-wrap items-center gap-4 sm:flex sm:justify-end">
          {tickerCoins.map(({ symbol, price, chg }) => {
            const up = chg != null && chg >= 0;
            return (
              <div key={symbol} className="flex items-center gap-2 text-sm">
                <CoinIcon symbol={symbol} size={20} />
                <span className="font-semibold text-foreground">{symbol}</span>
                <span className="numeric font-semibold text-foreground">{price != null ? fmtUsd(price) : '—'}</span>
                {chg != null && (
                  <span className={`numeric flex items-center gap-0.5 text-sm font-semibold ${up ? 'text-[#0ecb81]' : 'text-[#f6465d]'}`}>
                    {up ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                    {chg > 0 ? '+' : ''}{chg.toFixed(2)}%
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Compact filters ── */}
      <div className="border-b border-border/10 py-4">
        <P2PFilters value={filters} onChange={setFilters} onRefresh={() => void refetch()} />
      </div>
      {tickerLoadFailed && (
        <div className="mt-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
          Spot reference feed is reconnecting. P2P listing remains available.
          <button
            type="button"
            onClick={() => {
              void fetchTickers();
              toast({ title: 'Retrying feed', description: 'Refreshing spot reference prices.', variant: 'default' });
            }}
            className="ml-2 font-semibold underline-offset-2 hover:underline"
          >
            Retry
          </button>
        </div>
      )}

      {/* ── Sub-bar: quick chips + reference prices ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/10 py-3">
        <div className="flex flex-wrap items-center gap-2">
          {quickChips.map(({ id, label, icon: Icon }) => {
            const on = activeChips.has(id);
            return (
              <button
                key={id}
                type="button"
                aria-pressed={on}
                onClick={() => toggleChip(id)}
                className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-all duration-150 ${
                  on
                    ? 'bg-primary/15 text-primary ring-1 ring-primary/20'
                    : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0 opacity-90" />
                {label}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
          {spotPrice != null && (
            <span>
              Spot{' '}
              <span className="numeric font-semibold text-foreground">{sym}{priceFmt.format(spotPrice)}</span>
            </span>
          )}
          {p2pAvg != null && (
            <span>
              P2P Avg{' '}
              <span className="numeric font-semibold text-foreground">{sym}{priceFmt.format(p2pAvg)}</span>
            </span>
          )}
          {!isLoading && (
            <span className="numeric rounded-lg bg-muted/40 px-2.5 py-1 text-xs font-semibold text-foreground">
              {chipFilteredAds.length} ad{chipFilteredAds.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      {/* ── Trading table ── */}
      <P2PAdsTable
        ads={chipFilteredAds}
        fiat={filters.fiat}
        loading={isLoading}
        authed={authed}
        paymentFilter={filters.paymentCode}
        isError={isError}
        errorMessage={error instanceof Error ? error.message : undefined}
        onRetry={() => void refetch()}
        onTakeAd={(ad) => {
          if (!authed) return;
          setModalAd(ad);
        }}
      />

      {/* ── Order modal ── */}
      {modalAd && authed && (
        <TakeOrderModal
          ad={modalAd}
          fiat={filters.fiat}
          onClose={() => setModalAd(null)}
          onCreated={(orderId) => {
            queryClient.invalidateQueries({ queryKey: P2P_V2_ADS_KEY });
            window.location.href = `/p2p/orders/${orderId}`;
          }}
        />
      )}
    </div>
  );
}
