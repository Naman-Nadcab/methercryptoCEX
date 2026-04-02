'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import {
  NO_TRADES_ACTIONABLE,
  NO_ACTIVITY_24H,
  TOOLTIP_PAIR,
  TOOLTIP_LAST_PRICE,
  TOOLTIP_24H_CHANGE,
  TOOLTIP_24H_HIGH,
  TOOLTIP_24H_LOW,
  TOOLTIP_QUOTE_VOLUME_24H,
} from '@/lib/marketDataUxCopy';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { InfoTooltip } from '@/components/ui/InfoTooltip';
import { ArrowDown, ArrowUp, ArrowUpDown, BarChart3 } from 'lucide-react';

type Market = { id: string; symbol: string; base_asset: string; quote_asset: string };

type SpotTickerRow = {
  symbol: string;
  last_price: string | null;
  open_24h?: string | null;
  high_24h: string | null;
  low_24h: string | null;
  volume_24h: string;
  base_volume_24h?: string;
  change_pct: number | null;
};

type SortKey = 'pair' | 'last' | 'change' | 'high' | 'low' | 'volume';
type SortDir = 'asc' | 'desc';

const priceFmt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 8, minimumFractionDigits: 2 });
const volFmt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2, notation: 'compact' });

function parseNum(s: string | null | undefined): number | null {
  if (s == null || s === '') return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function fmtPriceValue(s: string | null | undefined): string | null {
  if (s == null || s === '') return null;
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return null;
  return priceFmt.format(n);
}

function fmtVolQuote(s: string | null | undefined): string | null {
  if (s == null || s === '') return null;
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return null;
  if (n === 0) return '0';
  return volFmt.format(n);
}

function hasLastTrade(t: SpotTickerRow | undefined): boolean {
  return t != null && t.last_price != null && t.last_price !== '';
}

function MarketsTableSkeleton() {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-white/10 text-left text-xs text-gray-500 uppercase tracking-wider">
          <th className="py-3 px-3 font-medium">Pair</th>
          <th className="py-3 px-3 font-medium text-right">Last Price</th>
          <th className="py-3 px-3 font-medium text-right">24h Change</th>
          <th className="py-3 px-3 font-medium text-right">24h High</th>
          <th className="py-3 px-3 font-medium text-right">24h Low</th>
          <th className="py-3 px-3 font-medium text-right">24h Vol</th>
          <th className="py-3 px-3 font-medium text-right">Action</th>
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: 8 }).map((_, i) => (
          <tr key={i} className="border-b border-white/5">
            <td className="py-2.5 px-3"><span className="h-4 w-20 bg-white/10 rounded block animate-pulse" /></td>
            <td className="py-2.5 px-3 text-right"><span className="h-4 w-16 bg-white/10 rounded block animate-pulse ml-auto" /></td>
            <td className="py-2.5 px-3 text-right"><span className="h-4 w-12 bg-white/10 rounded block animate-pulse ml-auto" /></td>
            <td className="py-2.5 px-3 text-right"><span className="h-4 w-16 bg-white/10 rounded block animate-pulse ml-auto" /></td>
            <td className="py-2.5 px-3 text-right"><span className="h-4 w-16 bg-white/10 rounded block animate-pulse ml-auto" /></td>
            <td className="py-2.5 px-3 text-right"><span className="h-4 w-14 bg-white/10 rounded block animate-pulse ml-auto" /></td>
            <td className="py-2.5 px-3 text-right"><span className="h-4 w-12 bg-white/10 rounded block animate-pulse ml-auto" /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SortableTh({
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
  align = 'left',
  tooltip,
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  dir: SortDir;
  onSort: (k: SortKey) => void;
  align?: 'left' | 'right';
  tooltip: string;
}) {
  const active = activeKey === sortKey;
  const Icon = !active ? ArrowUpDown : dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th className={`py-3 px-3 font-medium ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <div className={`inline-flex items-center gap-1 ${align === 'right' ? 'flex-row-reverse' : ''}`}>
        <button
          type="button"
          onClick={() => onSort(sortKey)}
          className="inline-flex items-center gap-1 rounded text-xs uppercase tracking-wider text-gray-500 transition-colors duration-200 hover:text-gray-300 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
          aria-label={`Sort by ${label}`}
        >
          {label}
          <Icon className="h-3 w-3 opacity-70" aria-hidden />
        </button>
        <InfoTooltip content={tooltip} className="text-gray-500" />
      </div>
    </th>
  );
}

export default function MarketsPage() {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [tickersBySymbol, setTickersBySymbol] = useState<Map<string, SpotTickerRow>>(() => new Map());
  const [search, setSearch] = useState('');
  const [quoteFilter, setQuoteFilter] = useState<string>('all');
  const [sortKey, setSortKey] = useState<SortKey>('pair');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const prevLastPricesRef = useRef<Map<string, string>>(new Map());
  const [priceFlashBySymbol, setPriceFlashBySymbol] = useState<Map<string, 'up' | 'down'>>(() => new Map());

  const refreshTickers = useCallback(async () => {
    try {
      const tRes = await api.get<SpotTickerRow[]>('/api/v1/spot/tickers', { notifyOnError: false });
      if (tRes.success && Array.isArray(tRes.data)) {
        setTickersBySymbol(new Map(tRes.data.map((t) => [t.symbol, t])));
      }
    } catch {
      /* ignore background refresh failures */
    }
  }, []);

  const fetchMarketsAndTickers = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const [mRes, tRes] = await Promise.all([
        api.get<Market[]>('/api/v1/spot/markets'),
        api.get<SpotTickerRow[]>('/api/v1/spot/tickers', { notifyOnError: false }),
      ]);

      if (mRes.success && Array.isArray(mRes.data)) {
        setMarkets(mRes.data);
        setFetchError(null);
      } else {
        setMarkets([]);
        setFetchError(mRes.error?.message ?? 'Failed to load markets');
      }

      if (tRes.success && Array.isArray(tRes.data)) {
        setTickersBySymbol(new Map(tRes.data.map((t) => [t.symbol, t])));
      }
    } catch {
      setFetchError('Network error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchMarketsAndTickers();
  }, [fetchMarketsAndTickers]);

  useEffect(() => {
    const id = setInterval(() => void refreshTickers(), 15_000);
    return () => clearInterval(id);
  }, [refreshTickers]);

  useEffect(() => {
    const prev = prevLastPricesRef.current;
    const flashes = new Map<string, 'up' | 'down'>();
    tickersBySymbol.forEach((t, sym) => {
      const p = t.last_price ?? '';
      const old = prev.get(sym);
      if (old !== undefined && old !== '' && p !== '' && old !== p) {
        const a = parseFloat(old);
        const b = parseFloat(p);
        if (Number.isFinite(a) && Number.isFinite(b)) {
          if (b > a) flashes.set(sym, 'up');
          else if (b < a) flashes.set(sym, 'down');
        }
      }
    });
    tickersBySymbol.forEach((t, sym) => {
      prev.set(sym, t.last_price ?? '');
    });
    if (flashes.size === 0) return;
    setPriceFlashBySymbol(flashes);
    const id = window.setTimeout(() => setPriceFlashBySymbol(new Map()), 1000);
    return () => clearTimeout(id);
  }, [tickersBySymbol]);

  const quoteOptions = useMemo(() => {
    const s = new Set(markets.map((m) => m.quote_asset).filter(Boolean));
    return Array.from(s).sort();
  }, [markets]);

  const filtered = useMemo(() => {
    let rows = markets;
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (m) =>
          m.symbol.toLowerCase().includes(q) ||
          m.base_asset.toLowerCase().includes(q) ||
          m.quote_asset.toLowerCase().includes(q)
      );
    }
    if (quoteFilter !== 'all') {
      rows = rows.filter((m) => m.quote_asset === quoteFilter);
    }
    return rows;
  }, [markets, search, quoteFilter]);

  const handleSort = useCallback((key: SortKey) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        return prev;
      }
      setSortDir(key === 'pair' ? 'asc' : 'desc');
      return key;
    });
  }, []);

  const sortedRows = useMemo(() => {
    const rows = [...filtered];
    const mul = sortDir === 'asc' ? 1 : -1;
    const t = (sym: string) => tickersBySymbol.get(sym);

    rows.sort((a, b) => {
      const ta = t(a.symbol);
      const tb = t(b.symbol);
      switch (sortKey) {
        case 'pair':
          return mul * a.symbol.localeCompare(b.symbol);
        case 'last': {
          const na = parseNum(ta?.last_price) ?? -Infinity;
          const nb = parseNum(tb?.last_price) ?? -Infinity;
          return mul * (na - nb);
        }
        case 'change': {
          const na = ta?.change_pct;
          const nb = tb?.change_pct;
          const aN = na != null && Number.isFinite(na) ? na : -Infinity;
          const bN = nb != null && Number.isFinite(nb) ? nb : -Infinity;
          return mul * (aN - bN);
        }
        case 'high': {
          const na = parseNum(ta?.high_24h) ?? -Infinity;
          const nb = parseNum(tb?.high_24h) ?? -Infinity;
          return mul * (na - nb);
        }
        case 'low': {
          const na = parseNum(ta?.low_24h) ?? -Infinity;
          const nb = parseNum(tb?.low_24h) ?? -Infinity;
          return mul * (na - nb);
        }
        case 'volume': {
          const na = parseNum(ta?.volume_24h) ?? -Infinity;
          const nb = parseNum(tb?.volume_24h) ?? -Infinity;
          return mul * (na - nb);
        }
        default:
          return 0;
      }
    });
    return rows;
  }, [filtered, sortKey, sortDir, tickersBySymbol]);

  return (
    <div className="min-h-screen bg-[#0b0e11] dark:bg-[#0b0e11] text-white p-4">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
          <h1 className="text-lg font-semibold text-white">Markets</h1>
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="markets-quote-filter">
              Quote currency
            </label>
            <select
              id="markets-quote-filter"
              value={quoteFilter}
              onChange={(e) => setQuoteFilter(e.target.value)}
              className="min-h-11 h-11 sm:h-9 sm:min-h-0 px-3 sm:px-2 bg-white/5 border border-white/10 rounded text-sm text-white focus:outline-none focus:border-white/20"
              aria-label="Filter by quote currency"
            >
              <option value="all">All quotes</option>
              {quoteOptions.map((q) => (
                <option key={q} value={q}>
                  {q}
                </option>
              ))}
            </select>
            <input
              type="text"
              placeholder="Search pair or asset…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="min-h-11 h-11 sm:h-9 sm:min-h-0 px-3 min-w-[12rem] flex-1 sm:flex-initial sm:w-56 bg-white/5 border border-white/10 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:border-white/20"
              aria-label="Search trading pairs"
            />
          </div>
        </div>
        <div className="border border-white/10 rounded overflow-hidden overflow-x-auto">
          {loading ? (
            <MarketsTableSkeleton />
          ) : fetchError ? (
            <div className="p-4">
              <ErrorState title="Could not load markets" message={fetchError} onRetry={() => void fetchMarketsAndTickers()} />
            </div>
          ) : sortedRows.length === 0 ? (
            <div className="py-12">
              <EmptyState
                icon={BarChart3}
                title="No markets found"
                description={
                  search.trim() || quoteFilter !== 'all'
                    ? 'Try clearing filters or a different search.'
                    : 'No trading markets are available yet.'
                }
                action={search.trim() || quoteFilter !== 'all' ? undefined : { label: 'Go to Spot', href: '/trade/spot' }}
              />
            </div>
          ) : (
              <table className="w-full text-sm min-w-[640px]">
                <thead>
                  <tr className="border-b border-white/10 text-left text-xs text-gray-500 uppercase tracking-wider">
                    <SortableTh
                      label="Pair"
                      sortKey="pair"
                      activeKey={sortKey}
                      dir={sortDir}
                      onSort={handleSort}
                      tooltip={TOOLTIP_PAIR}
                    />
                    <SortableTh
                      label="Last Price"
                      sortKey="last"
                      activeKey={sortKey}
                      dir={sortDir}
                      onSort={handleSort}
                      align="right"
                      tooltip={TOOLTIP_LAST_PRICE}
                    />
                    <SortableTh
                      label="24h Change"
                      sortKey="change"
                      activeKey={sortKey}
                      dir={sortDir}
                      onSort={handleSort}
                      align="right"
                      tooltip={TOOLTIP_24H_CHANGE}
                    />
                    <SortableTh
                      label="24h High"
                      sortKey="high"
                      activeKey={sortKey}
                      dir={sortDir}
                      onSort={handleSort}
                      align="right"
                      tooltip={TOOLTIP_24H_HIGH}
                    />
                    <SortableTh
                      label="24h Low"
                      sortKey="low"
                      activeKey={sortKey}
                      dir={sortDir}
                      onSort={handleSort}
                      align="right"
                      tooltip={TOOLTIP_24H_LOW}
                    />
                    <SortableTh
                      label="24h Vol"
                      sortKey="volume"
                      activeKey={sortKey}
                      dir={sortDir}
                      onSort={handleSort}
                      align="right"
                      tooltip={TOOLTIP_QUOTE_VOLUME_24H}
                    />
                    <th className="py-3 px-3 font-medium text-right text-xs uppercase tracking-wider text-gray-500">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((m) => (
                    <MarketsRow
                      key={m.id}
                      market={m}
                      ticker={tickersBySymbol.get(m.symbol)}
                      priceFlash={priceFlashBySymbol.get(m.symbol)}
                    />
                  ))}
                </tbody>
              </table>
          )}
        </div>
      </div>
    </div>
  );
}

function MarketsRow({
  market,
  ticker,
  priceFlash,
}: {
  market: Market;
  ticker: SpotTickerRow | undefined;
  priceFlash?: 'up' | 'down';
}) {
  const lastOk = hasLastTrade(ticker);
  const change = ticker?.change_pct;

  const changeTone =
    change == null ? 'neutral' : change > 0 ? 'up' : change < 0 ? 'down' : 'flat';
  const changeClass =
    changeTone === 'up'
      ? 'text-green-500'
      : changeTone === 'down'
        ? 'text-red-500'
        : changeTone === 'flat'
          ? 'text-gray-400'
          : 'text-gray-500';

  const lastText = lastOk ? fmtPriceValue(ticker!.last_price) : null;
  const highText = fmtPriceValue(ticker?.high_24h ?? null);
  const lowText = fmtPriceValue(ticker?.low_24h ?? null);
  const volText = fmtVolQuote(ticker?.volume_24h);

  const rowFlash =
    priceFlash === 'up' ? 'bg-emerald-500/15' : priceFlash === 'down' ? 'bg-red-500/15' : '';

  const lastCellClass =
    lastText == null
      ? 'text-gray-500'
      : priceFlash === 'up'
        ? 'text-emerald-400'
        : priceFlash === 'down'
          ? 'text-red-400'
          : 'text-gray-200';

  return (
    <tr
      className={`border-b border-white/5 transition-[background-color,color] duration-300 ease-out hover:bg-white/5 ${rowFlash}`}
    >
      <td className="py-2.5 px-3 font-medium tabular-nums text-white">{market.symbol.replace('_', '/')}</td>
      <td className={`py-2.5 px-3 text-right tabular-nums transition-colors duration-300 ${lastCellClass}`}>
        {lastText ?? NO_TRADES_ACTIONABLE}
      </td>
      <td className={`py-2.5 px-3 text-right tabular-nums max-w-[9rem] truncate sm:max-w-none ${changeClass}`}>
        {change != null ? `${change > 0 ? '+' : ''}${change.toFixed(2)}%` : '—'}
      </td>
      <td className="py-2.5 px-3 text-right tabular-nums text-gray-300 max-w-[7rem] truncate sm:max-w-none">
        {highText ?? (lastOk ? NO_ACTIVITY_24H : NO_TRADES_ACTIONABLE)}
      </td>
      <td className="py-2.5 px-3 text-right tabular-nums text-gray-300 max-w-[7rem] truncate sm:max-w-none">
        {lowText ?? (lastOk ? NO_ACTIVITY_24H : NO_TRADES_ACTIONABLE)}
      </td>
      <td className="py-2.5 px-3 text-right tabular-nums text-gray-300 max-w-[6rem] truncate sm:max-w-none">
        {volText ?? (lastOk ? NO_ACTIVITY_24H : NO_TRADES_ACTIONABLE)}
      </td>
      <td className="py-2.5 px-3 text-right">
        <Link
          href={`/trade/spot?symbol=${encodeURIComponent(market.symbol)}`}
          className="inline-flex min-h-11 min-w-[4.5rem] items-center justify-center rounded-md px-3 text-sm font-semibold text-blue-400 transition-colors hover:bg-white/5 hover:text-blue-300 sm:min-h-0 sm:text-xs sm:font-medium"
          aria-label={`Trade ${market.symbol.replace('_', '/')}`}
        >
          Trade
        </Link>
      </td>
    </tr>
  );
}
