'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuthStore } from '@/store/auth';
import Link from 'next/link';
import {
  RefreshCw,
  AlertCircle,
  Wallet,
  Search,
  Eye,
  EyeOff,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  Download,
  Upload,
  ArrowLeftRight,
  ArrowUpRight,
  Clock,
  X,
  ChevronLeft,
  ChevronRight,
  BarChart3,
} from 'lucide-react';
import { CoinIcon } from '@/components/ui/CoinIcon';
import { useBalancesSpot } from '@/lib/balances';
import { EmptyState } from '@/components/ui/EmptyState';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { useDisplayCurrency } from '@/context/DisplayCurrencyProvider';

const COIN_NAMES: Record<string, string> = {
  BTC: 'Bitcoin', ETH: 'Ethereum', BNB: 'BNB', SOL: 'Solana',
  USDT: 'Tether', USDC: 'USD Coin', XRP: 'XRP', ADA: 'Cardano',
  AVAX: 'Avalanche', DOT: 'Polkadot', ATOM: 'Cosmos', NEAR: 'NEAR Protocol',
  SUI: 'Sui', APT: 'Aptos', SEI: 'Sei', TRX: 'TRON', LTC: 'Litecoin',
  MATIC: 'Polygon', ARB: 'Arbitrum', OP: 'Optimism', IMX: 'Immutable X',
  UNI: 'Uniswap', AAVE: 'Aave', LINK: 'Chainlink', MKR: 'Maker',
  LDO: 'Lido DAO', INJ: 'Injective', DOGE: 'Dogecoin', SHIB: 'Shiba Inu',
  PEPE: 'Pepe', WIF: 'dogwifhat', FLOKI: 'Floki', BONK: 'Bonk',
  FET: 'Fetch.ai', RENDER: 'Render', WLD: 'Worldcoin', FIL: 'Filecoin',
  GRT: 'The Graph', AR: 'Arweave', ICP: 'Internet Computer',
  HBAR: 'Hedera', VET: 'VeChain', DAI: 'Dai',
};

const SMALL_BALANCE_THRESHOLD_USD = 1;
const PAGE_SIZE = 25;

type SortKey = 'asset' | 'balance' | 'available' | 'locked' | 'usdValue';
type SortDir = 'asc' | 'desc';

type TickerMap = Record<string, number>;

interface SpotTickerRow {
  symbol: string;
  last_price: string | null;
}

function parseNum(v: string | null | undefined): number {
  const n = parseFloat(v ?? '');
  return Number.isFinite(n) ? n : 0;
}

function balFmt(val: string): string {
  const n = parseFloat(val);
  if (!Number.isFinite(n)) return '0.00';
  if (n === 0) return '0.00';
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 8 });
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ChevronsUpDown className="ml-1 inline h-3.5 w-3.5 opacity-50" />;
  return dir === 'asc'
    ? <ChevronUp className="ml-1 inline h-3.5 w-3.5 text-primary" />
    : <ChevronDown className="ml-1 inline h-3.5 w-3.5 text-primary" />;
}

function RowActions({ asset }: { asset: string }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      <Link
        href={`/dashboard/deposit/crypto?coin=${asset}`}
        className="inline-flex items-center rounded-lg border border-border bg-muted/40 px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-primary/10 hover:text-primary"
      >
        Deposit
      </Link>
      <Link
        href={`/dashboard/withdraw/crypto?coin=${asset}`}
        className="inline-flex items-center rounded-lg border border-border bg-muted/40 px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-primary/10 hover:text-primary"
      >
        Withdraw
      </Link>
      <Link
        href={`/trade/spot?symbol=${asset}_USDT`}
        className="inline-flex items-center rounded-lg border border-primary/30 bg-primary/10 px-2.5 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/20"
      >
        <BarChart3 className="mr-1 h-3 w-3" /> Trade
      </Link>
    </div>
  );
}

export default function SpotWalletPage() {
  const { accessToken, _hasHydrated } = useAuthStore();
  const { displayCurrency, formatFromUsdt } = useDisplayCurrency();
  const {
    data: balances = [],
    isLoading: loading,
    isError,
    error: queryError,
    refetch,
  } = useBalancesSpot(!!_hasHydrated && !!accessToken);

  const isCancelled = queryError instanceof Error &&
    (queryError.name === 'AbortError' || String(queryError.message).toLowerCase().includes('abort'));
  const error = isError && !isCancelled
    ? (queryError instanceof Error ? queryError.message : 'Failed to load spot balances')
    : null;

  const [search, setSearch] = useState('');
  const [hideSmall, setHideSmall] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>('usdValue');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [prices, setPrices] = useState<TickerMap>({});
  const [balanceHidden, setBalanceHidden] = useState(false);
  const [page, setPage] = useState(1);

  const fetchPrices = useCallback(async () => {
    try {
      const base = getApiBaseUrl();
      const res = await fetch(`${base}/api/v1/spot/tickers`);
      const json = await res.json();
      if (json?.success && Array.isArray(json.data)) {
        const map: TickerMap = {};
        for (const t of json.data as SpotTickerRow[]) {
          if (!t.symbol || !t.last_price) continue;
          const baseSym = t.symbol.replace(/_?USDT$/, '');
          map[baseSym] = parseNum(t.last_price);
        }
        map['USDT'] = 1;
        map['USDC'] = 1;
        setPrices(map);
      }
    } catch { /* USD values may show as $0.00 */ }
  }, []);

  useEffect(() => {
    fetchPrices();
    const iv = setInterval(fetchPrices, 30_000);
    return () => clearInterval(iv);
  }, [fetchPrices]);

  const getUsdValue = useCallback((asset: string, amount: string) => {
    const qty = parseNum(amount);
    const px = prices[asset.toUpperCase()] ?? 0;
    return qty * px;
  }, [prices]);

  const totalEquityUsd = useMemo(
    () => balances.reduce((sum, r) => sum + getUsdValue(r.asset, r.balance), 0),
    [balances, getUsdValue],
  );

  const availableUsd = useMemo(
    () => balances.reduce((sum, r) => sum + getUsdValue(r.asset, r.available_balance), 0),
    [balances, getUsdValue],
  );

  const lockedUsd = useMemo(
    () => balances.reduce((sum, r) => sum + getUsdValue(r.asset, r.locked_balance ?? '0'), 0),
    [balances, getUsdValue],
  );

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir(key === 'asset' ? 'asc' : 'desc'); }
  };

  const filtered = useMemo(() => {
    let rows = [...balances];
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(r =>
        r.asset.toLowerCase().includes(q) ||
        (COIN_NAMES[r.asset] ?? '').toLowerCase().includes(q),
      );
    }
    if (hideSmall) {
      rows = rows.filter(r => getUsdValue(r.asset, r.balance) >= SMALL_BALANCE_THRESHOLD_USD);
    }
    const mul = sortDir === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      switch (sortKey) {
        case 'asset': return mul * a.asset.localeCompare(b.asset);
        case 'balance': return mul * (parseNum(a.balance) - parseNum(b.balance));
        case 'available': return mul * (parseNum(a.available_balance) - parseNum(b.available_balance));
        case 'locked': return mul * (parseNum(a.locked_balance) - parseNum(b.locked_balance));
        case 'usdValue': return mul * (getUsdValue(a.asset, a.balance) - getUsdValue(b.asset, b.balance));
        default: return 0;
      }
    });
    return rows;
  }, [balances, search, hideSmall, sortKey, sortDir, getUsdValue]);

  const totalFiltered = filtered.length;
  const pageCount = Math.max(1, Math.ceil(totalFiltered / PAGE_SIZE));
  const paginated = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page]);

  useEffect(() => {
    setPage(1);
  }, [search, hideSmall, sortKey, sortDir]);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const rangeStart = totalFiltered === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, totalFiltered);

  const maskBal = (s: string) => (balanceHidden ? '••••••' : balFmt(s));
  const maskUsd = (n: number) => (balanceHidden ? '••••••' : formatFromUsdt(n, 2));

  return (
    <div className="mx-auto min-h-screen max-w-[1400px] bg-background px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      {/* ── Header ── */}
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Spot / Trading Account</h1>
          <span className="hidden text-sm text-muted-foreground sm:inline">Balances used for spot orders</span>
          <button
            type="button"
            onClick={() => setBalanceHidden(h => !h)}
            className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label={balanceHidden ? 'Show balances' : 'Hide balances'}
          >
            {balanceHidden ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
          </button>
          <button
            type="button"
            onClick={() => refetch()}
            disabled={loading}
            className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
            aria-label="Refresh"
          >
            <RefreshCw className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/dashboard/deposit/crypto"
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
          >
            <Download className="h-4 w-4" /> Deposit
          </Link>
          <Link
            href="/dashboard/withdraw/crypto"
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            <Upload className="h-4 w-4" /> Withdraw
          </Link>
          <Link
            href="/dashboard/transfer"
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            <ArrowLeftRight className="h-4 w-4" /> Transfer
          </Link>
        </div>
      </div>

      {/* ── Summary cards ── */}
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:gap-5">
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Wallet className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Estimated total</p>
              <p className="text-xs text-muted-foreground/90">Spot wallet ({displayCurrency})</p>
            </div>
          </div>
          <p className="numeric text-3xl font-bold tracking-tight text-foreground">
            {loading ? '—' : maskUsd(totalEquityUsd)}
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-buy/10 text-buy">
              <ArrowUpRight className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Available</p>
              <p className="text-xs text-muted-foreground/90">Free for new orders</p>
            </div>
          </div>
          <p className="numeric text-3xl font-bold tracking-tight text-foreground">
            {loading ? '—' : maskUsd(availableUsd)}
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6 sm:col-span-2 lg:col-span-1">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-warning/15 text-warning">
              <Clock className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">In open orders</p>
              <p className="text-xs text-muted-foreground/90">Locked margin</p>
            </div>
          </div>
          <p className="numeric text-3xl font-bold tracking-tight text-foreground">
            {loading ? '—' : maskUsd(lockedUsd)}
          </p>
        </div>
      </div>

      {error ? (
        <div className="mb-6 flex items-center gap-3 rounded-2xl border border-sell/30 bg-sell/10 px-4 py-3 text-sm text-sell" role="alert">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {/* ── Table ── */}
      <div className="rounded-2xl border border-border bg-card shadow-sm">
        <div className="flex flex-col gap-4 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:py-5">
          <div className="relative min-w-[200px] max-w-md flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search coin…"
              className="h-10 w-full rounded-lg border border-border bg-background py-2 pl-10 pr-9 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            {search ? (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex cursor-pointer select-none items-center gap-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
              <input
                type="checkbox"
                checked={hideSmall}
                onChange={(e) => setHideSmall(e.target.checked)}
                className="h-4 w-4 rounded border-border accent-primary"
              />
              {`Hide small balances (under ${formatFromUsdt(SMALL_BALANCE_THRESHOLD_USD, 0)})`}
            </label>
            {!loading && totalFiltered > 0 ? (
              <span className="text-xs text-muted-foreground">
                {totalFiltered} asset{totalFiltered !== 1 ? 's' : ''}
              </span>
            ) : null}
          </div>
        </div>

        <div className="overflow-x-auto rounded-b-2xl">
          <table className="w-full min-w-[880px] border-collapse text-sm">
            <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-20 [&_th]:bg-muted/95 [&_th]:shadow-[0_1px_0_0_hsl(var(--border))] [&_th]:backdrop-blur-sm">
              <tr className="border-b border-border">
                <SortableHeader label="Coin" sortKey="asset" current={sortKey} dir={sortDir} onSort={toggleSort} className="pl-6" />
                <SortableHeader label="Total balance" sortKey="balance" current={sortKey} dir={sortDir} onSort={toggleSort} align="right" />
                <SortableHeader label="Available" sortKey="available" current={sortKey} dir={sortDir} onSort={toggleSort} align="right" />
                <SortableHeader label="In order" sortKey="locked" current={sortKey} dir={sortDir} onSort={toggleSort} align="right" />
                <SortableHeader label={`${displayCurrency} value`} sortKey="usdValue" current={sortKey} dir={sortDir} onSort={toggleSort} align="right" />
                <th scope="col" className="sticky top-0 z-20 bg-muted/95 px-4 py-3.5 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground shadow-[0_1px_0_0_hsl(var(--border))] backdrop-blur-sm first:pl-6 last:pr-6">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-b border-border">
                    <td className="px-5 py-4 pl-6">
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 animate-pulse rounded-full bg-muted" />
                        <div className="space-y-1.5">
                          <div className="h-3.5 w-12 animate-pulse rounded bg-muted" />
                          <div className="h-3 w-24 animate-pulse rounded bg-muted" />
                        </div>
                      </div>
                    </td>
                    {[1, 2, 3, 4].map((j) => (
                      <td key={j} className="px-4 py-4 text-right">
                        <div className="ml-auto h-4 w-20 animate-pulse rounded bg-muted" />
                      </td>
                    ))}
                    <td className="px-4 py-4 pr-6 text-right">
                      <div className="ml-auto h-8 w-32 animate-pulse rounded-lg bg-muted" />
                    </td>
                  </tr>
                ))
              ) : filtered.length === 0 && !error ? (
                <tr>
                  <td colSpan={6} className="p-0 align-top">
                    {search || hideSmall ? (
                      <div className="flex flex-col items-center justify-center px-6 py-16 text-center sm:py-20">
                        <Search className="mb-4 h-10 w-10 text-muted-foreground/40" />
                        <p className="font-medium text-foreground">No matching assets</p>
                        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                          {hideSmall && balances.length > 0
                            ? '“Hide small balances” is hiding rows under $1. Turn it off or search by symbol.'
                            : search
                              ? 'Try another search term or clear the filter.'
                              : 'Adjust filters to see more rows.'}
                        </p>
                      </div>
                    ) : (
                      <EmptyState
                        icon={Wallet}
                        title="No spot balances yet"
                        description="Transfer from Funding to Spot when you're ready to trade, or deposit first."
                        actionLabel="Assets overview"
                        actionHref="/dashboard/assets/overview"
                      />
                    )}
                  </td>
                </tr>
              ) : (
                paginated.map((row) => {
                  const usd = getUsdValue(row.asset, row.balance);
                  const lockedN = parseNum(row.locked_balance);
                  return (
                    <tr
                      key={row.asset}
                      className="group border-b border-border/80 transition-colors last:border-0 hover:bg-muted/35"
                    >
                      <td className="px-5 py-4 pl-6 align-middle">
                        <div className="flex items-center gap-3">
                          <CoinIcon symbol={row.asset} size={36} />
                          <div className="min-w-0 leading-tight">
                            <span className="text-sm font-semibold text-foreground">{row.asset}</span>
                            <p className="truncate text-xs text-muted-foreground">{COIN_NAMES[row.asset] ?? row.asset}</p>
                          </div>
                        </div>
                      </td>
                      <td className="numeric px-5 py-4 text-right align-middle text-sm text-foreground">
                        {maskBal(row.balance)}
                      </td>
                      <td className="numeric px-5 py-4 text-right align-middle text-sm text-foreground">
                        {maskBal(row.available_balance)}
                      </td>
                      <td className="numeric px-5 py-4 text-right align-middle text-sm">
                        <span className={lockedN > 0 ? 'font-medium text-warning' : 'text-muted-foreground'}>
                          {maskBal(row.locked_balance ?? '0')}
                        </span>
                      </td>
                      <td className="numeric px-5 py-4 text-right align-middle text-sm font-medium text-foreground">
                        {balanceHidden ? '••••••' : formatFromUsdt(usd, 2)}
                      </td>
                      <td className="px-4 py-3 pr-6 text-right align-middle">
                        <RowActions asset={row.asset} />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {!loading && totalFiltered > 0 ? (
          <div className="flex flex-col gap-3 border-t border-border px-5 py-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                Showing{' '}
                <span className="numeric font-medium text-foreground">{rangeStart}</span>
                {'–'}
                <span className="numeric font-medium text-foreground">{rangeEnd}</span>
                {' of '}
                <span className="numeric font-medium text-foreground">{totalFiltered}</span>
                <span className="mx-2 hidden text-muted-foreground/50 sm:inline">·</span>
                <span className="mt-1 block text-xs text-muted-foreground sm:mt-0 sm:inline sm:text-sm">
                  Portfolio total:{' '}
                  <span className="numeric font-semibold text-foreground">
                    {balanceHidden ? '••••••' : formatFromUsdt(totalEquityUsd, 2)}
                  </span>
                </span>
              </p>
              {pageCount > 1 ? (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
                  >
                    <ChevronLeft className="h-4 w-4" /> Previous
                  </button>
                  <span className="numeric px-2 text-sm text-muted-foreground">
                    Page {page} / {pageCount}
                  </span>
                  <button
                    type="button"
                    disabled={page >= pageCount}
                    onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                    className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
                  >
                    Next <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SortableHeader({
  label,
  sortKey,
  current,
  dir,
  onSort,
  align = 'left',
  className = '',
}: {
  label: string;
  sortKey: SortKey;
  current: SortKey;
  dir: SortDir;
  onSort: (k: SortKey) => void;
  align?: 'left' | 'right';
  className?: string;
}) {
  const active = current === sortKey;
  return (
    <th
      scope="col"
      className={`sticky top-0 z-20 whitespace-nowrap bg-muted/95 px-5 py-3.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground shadow-[0_1px_0_0_hsl(var(--border))] backdrop-blur-sm first:pl-6 ${
        align === 'right' ? 'cursor-pointer select-none text-right transition-colors hover:text-foreground' : 'cursor-pointer select-none text-left transition-colors hover:text-foreground'
      } ${className}`}
      onClick={() => onSort(sortKey)}
    >
      <span className={`inline-flex items-center gap-1 ${align === 'right' ? 'justify-end' : ''}`}>
        {label}
        <SortIcon active={active} dir={dir} />
      </span>
    </th>
  );
}
