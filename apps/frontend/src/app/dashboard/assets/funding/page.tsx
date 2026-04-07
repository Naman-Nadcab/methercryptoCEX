'use client';

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useAuthStore } from '@/store/auth';
import { useBalancesFunding, type TokenBalance } from '@/lib/balances';
import { CoinIcon } from '@/components/ui/CoinIcon';
import { SkeletonTableBody } from '@/components/ui/Skeleton';
import Link from 'next/link';
import {
  Eye,
  EyeOff,
  Download,
  Upload,
  ArrowLeftRight,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Wallet,
  Clock,
  Search,
  ArrowUpRight,
  BarChart3,
  Banknote,
  ChevronsUpDown,
  X,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

const PAGE_SIZE = 25;

const COIN_NAMES: Record<string, string> = {
  BTC: 'Bitcoin', ETH: 'Ethereum', BNB: 'BNB', SOL: 'Solana',
  USDT: 'Tether', USDC: 'USD Coin', XRP: 'Ripple', ADA: 'Cardano',
  AVAX: 'Avalanche', DOT: 'Polkadot', DOGE: 'Dogecoin', SHIB: 'Shiba Inu',
  LINK: 'Chainlink', UNI: 'Uniswap', LTC: 'Litecoin', MATIC: 'Polygon',
  ARB: 'Arbitrum', OP: 'Optimism',
};

type SortKey = 'symbol' | 'balance' | 'value';
type SortDir = 'asc' | 'desc';

function formatUsd(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatCrypto(v: number | string, decimals = 8): string {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  if (!Number.isFinite(n)) return '0.' + '0'.repeat(Math.min(decimals, 8));
  return n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />;
  return dir === 'asc'
    ? <ChevronUp className="h-3.5 w-3.5 text-primary" />
    : <ChevronDown className="h-3.5 w-3.5 text-primary" />;
}

function ActionDropdown({ symbol }: { symbol: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function close(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div ref={ref} className="relative flex flex-wrap items-center justify-end gap-1.5">
      <Link
        href={`/dashboard/deposit/crypto?coin=${symbol}`}
        className="inline-flex items-center rounded-lg border border-border bg-muted/40 px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-primary/10 hover:text-primary"
      >
        Deposit
      </Link>
      <Link
        href={`/dashboard/withdraw/crypto?coin=${symbol}`}
        className="inline-flex items-center rounded-lg border border-border bg-muted/40 px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-primary/10 hover:text-primary"
      >
        Withdraw
      </Link>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-muted/40 px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        More <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-[100] mt-1.5 w-44 rounded-xl border border-border bg-popover py-1 shadow-lg ring-1 ring-border/50"
        >
          <Link
            href="/dashboard/transfer"
            className="flex items-center gap-2.5 px-3 py-2.5 text-sm text-foreground transition-colors hover:bg-accent"
            onClick={() => setOpen(false)}
          >
            <ArrowLeftRight className="h-4 w-4 shrink-0 text-muted-foreground" /> Transfer
          </Link>
          <Link
            href={`/trade/spot?symbol=${symbol}_USDT`}
            className="flex items-center gap-2.5 px-3 py-2.5 text-sm text-foreground transition-colors hover:bg-accent"
            onClick={() => setOpen(false)}
          >
            <BarChart3 className="h-4 w-4 shrink-0 text-muted-foreground" /> Trade
          </Link>
        </div>
      )}
    </div>
  );
}

export default function FundingAccountPage() {
  const { accessToken, _hasHydrated } = useAuthStore();

  const [showBalance, setShowBalance] = useState(true);
  const [activeTab, setActiveTab] = useState<'crypto' | 'fiat'>('crypto');
  const [hideZero, setHideZero] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('value');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);

  const { data: fundingData, isLoading, refetch } = useBalancesFunding(!!_hasHydrated && !!accessToken);
  const balances = fundingData?.balances ?? [];
  const totalEquity = fundingData?.totalEquity ?? { usd: 0, btc: 0 };
  const availableBalance = fundingData?.availableBalance ?? { usd: 0, btc: 0 };
  const inUse = fundingData?.inUse ?? { usd: 0, btc: 0 };
  const sessionError = fundingData?.sessionError ?? null;

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setTimeout(() => setRefreshing(false), 600);
  }, [refetch]);

  const cycleSort = useCallback((key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'symbol' ? 'asc' : 'desc');
    }
  }, [sortKey]);

  const filteredBalances = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return balances
      .filter((b: TokenBalance) => {
        if (hideZero && parseFloat(b.usd_value || '0') < 0.01 && parseFloat(b.total_balance || '0') === 0) return false;
        if (q) {
          const fullName = (COIN_NAMES[b.symbol] ?? b.name ?? '').toLowerCase();
          return b.symbol.toLowerCase().includes(q) || fullName.includes(q);
        }
        return true;
      })
      .sort((a: TokenBalance, b: TokenBalance) => {
        const dir = sortDir === 'asc' ? 1 : -1;
        switch (sortKey) {
          case 'symbol':
            return a.symbol.localeCompare(b.symbol) * dir;
          case 'balance':
            return (parseFloat(a.total_balance || '0') - parseFloat(b.total_balance || '0')) * dir;
          case 'value':
            return (parseFloat(a.usd_value || '0') - parseFloat(b.usd_value || '0')) * dir;
          default:
            return 0;
        }
      });
  }, [balances, hideZero, searchQuery, sortKey, sortDir]);

  const totalFiltered = filteredBalances.length;
  const pageCount = Math.max(1, Math.ceil(totalFiltered / PAGE_SIZE));
  const paginatedBalances = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredBalances.slice(start, start + PAGE_SIZE);
  }, [filteredBalances, page]);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, hideZero, sortKey, sortDir]);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const rangeStart = totalFiltered === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, totalFiltered);

  const mask = (v: string) => (showBalance ? v : '••••••');
  const maskNum = (v: string, dec?: number) => (showBalance ? formatCrypto(v, dec) : '••••••');

  return (
    <div className="mx-auto min-h-screen max-w-[1400px] bg-background px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      {/* ── Page header ── */}
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Funding Account</h1>
          <span className="hidden text-sm text-muted-foreground sm:inline">Wallet balances for deposits &amp; withdrawals</span>
          <button
            type="button"
            onClick={() => setShowBalance(s => !s)}
            className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title={showBalance ? 'Hide balances' : 'Show balances'}
          >
            {showBalance ? <Eye className="h-5 w-5" /> : <EyeOff className="h-5 w-5" />}
          </button>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
            title="Refresh balances"
          >
            <RefreshCw className={`h-5 w-5 ${refreshing ? 'animate-spin' : ''}`} />
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

      {/* ── Session error ── */}
      {sessionError && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-warning/30 bg-warning/10 p-4">
          <p className="text-sm text-foreground">{sessionError}</p>
          <Link href="/login" className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">
            Log in again
          </Link>
        </div>
      )}

      {/* ── Equity summary cards ── */}
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:gap-5">
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Wallet className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Total equity</p>
              <p className="text-xs text-muted-foreground/90">Funding wallet (USD)</p>
            </div>
          </div>
          <p className="numeric text-3xl font-bold tracking-tight text-foreground">
            {showBalance ? `$${formatUsd(totalEquity.usd)}` : '••••••'}
          </p>
          <p className="numeric mt-2 text-sm text-muted-foreground">
            ≈ {showBalance ? `${formatCrypto(totalEquity.btc, 8)} BTC` : '••••••••'}
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-buy/10 text-buy">
              <ArrowUpRight className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Available</p>
              <p className="text-xs text-muted-foreground/90">Ready to trade or withdraw</p>
            </div>
          </div>
          <p className="numeric text-3xl font-bold tracking-tight text-foreground">
            {showBalance ? `$${formatUsd(availableBalance.usd)}` : '••••••'}
          </p>
          <p className="numeric mt-2 text-sm text-muted-foreground">
            ≈ {showBalance ? `${formatCrypto(availableBalance.btc, 8)} BTC` : '••••••••'}
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6 sm:col-span-2 lg:col-span-1">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-warning/15 text-warning">
              <Clock className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">In use</p>
              <p className="text-xs text-muted-foreground/90">Locked in orders or pending</p>
            </div>
          </div>
          <p className="numeric text-3xl font-bold tracking-tight text-foreground">
            {showBalance ? `$${formatUsd(inUse.usd)}` : '••••••'}
          </p>
          <p className="numeric mt-2 text-sm text-muted-foreground">
            ≈ {showBalance ? `${formatCrypto(inUse.btc, 8)} BTC` : '••••••••'}
          </p>
        </div>
      </div>

      {/* ── Crypto / Fiat tabs + table (no overflow-hidden — action menus need to escape) ── */}
      <div className="rounded-2xl border border-border bg-card shadow-sm">
        {/* Tab bar + controls */}
        <div className="flex flex-col gap-4 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:py-5">
          <div className="inline-flex w-fit rounded-xl bg-muted/80 p-1">
            <button
              type="button"
              onClick={() => setActiveTab('crypto')}
              className={`rounded-lg px-5 py-2.5 text-sm font-semibold transition-all ${
                activeTab === 'crypto'
                  ? 'bg-card text-foreground shadow-sm ring-1 ring-border/60'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Crypto
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('fiat')}
              className={`rounded-lg px-5 py-2.5 text-sm font-semibold transition-all ${
                activeTab === 'fiat'
                  ? 'bg-card text-foreground shadow-sm ring-1 ring-border/60'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Fiat
            </button>
          </div>

          {activeTab === 'crypto' && (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
              <div className="relative min-w-[200px] max-w-xs flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search coin…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-10 w-full rounded-lg border border-border bg-background py-2 pl-10 pr-9 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                {searchQuery ? (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    aria-label="Clear search"
                  >
                    <X className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
              <label className="flex cursor-pointer select-none items-center gap-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
                <input
                  type="checkbox"
                  checked={hideZero}
                  onChange={(e) => setHideZero(e.target.checked)}
                  className="h-4 w-4 rounded border-border accent-primary"
                />
                Hide zero balances
              </label>
              {!isLoading && totalFiltered > 0 ? (
                <span className="text-xs text-muted-foreground sm:ml-1">
                  {totalFiltered} asset{totalFiltered !== 1 ? 's' : ''}
                </span>
              ) : null}
            </div>
          )}
        </div>

        {/* ── Fiat coming-soon ── */}
        {activeTab === 'fiat' && (
          <div className="flex flex-col items-center justify-center px-6 py-20 sm:py-24">
            <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
              <Banknote className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="mb-2 text-lg font-semibold text-foreground">Fiat balances</h3>
            <p className="max-w-md text-center text-sm leading-relaxed text-muted-foreground">
              Fiat deposit and withdrawal support is coming soon. You&apos;ll manage USD, EUR, and other currencies here.
            </p>
          </div>
        )}

        {/* ── Crypto table ── */}
        {activeTab === 'crypto' && (
          <>
          <div className="overflow-x-auto rounded-b-2xl">
            <table className="w-full min-w-[880px] border-collapse">
              <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-20 [&_th]:bg-muted/95 [&_th]:shadow-[0_1px_0_0_hsl(var(--border))] [&_th]:backdrop-blur-sm">
                <tr className="border-b border-border">
                  {([
                    ['symbol', 'Coin', 'left'],
                    ['balance', 'Total balance', 'right'],
                    [null, 'Available', 'right'],
                    [null, 'In use', 'right'],
                    ['value', 'USD value', 'right'],
                    [null, 'Actions', 'right'],
                  ] as const).map(([key, label, align], i) => {
                    const sortable = key !== null;
                    return (
                      <th
                        key={i}
                        scope="col"
                        className={`whitespace-nowrap px-5 py-3.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground first:pl-6 last:pr-6 ${
                          align === 'right' ? 'text-right' : 'text-left'
                        } ${sortable ? 'cursor-pointer select-none transition-colors hover:text-foreground' : ''}`}
                        onClick={sortable ? () => cycleSort(key) : undefined}
                      >
                        <span className={`inline-flex items-center gap-1.5 ${align === 'right' ? 'justify-end' : ''}`}>
                          {label}
                          {sortable ? <SortIcon active={sortKey === key} dir={sortDir} /> : null}
                        </span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <SkeletonTableBody rows={8} columns={6} />
                ) : filteredBalances.length > 0 ? (
                  paginatedBalances.map((b: TokenBalance) => {
                    const fullName = COIN_NAMES[b.symbol] ?? b.name ?? b.symbol;
                    const usdVal = parseFloat(b.usd_value || '0');
                    const lockedVal = parseFloat(b.locked_balance || '0');

                    return (
                      <tr
                        key={b.token_id}
                        className="group border-b border-border/80 transition-colors last:border-0 hover:bg-muted/35"
                      >
                        <td className="px-5 py-4 pl-6 align-middle">
                          <div className="flex items-center gap-3">
                            <CoinIcon symbol={b.symbol} size={36} />
                            <div className="min-w-0">
                              <span className="text-sm font-semibold text-foreground">{b.symbol}</span>
                              <p className="truncate text-xs leading-snug text-muted-foreground">{fullName}</p>
                            </div>
                          </div>
                        </td>
                        <td className="numeric px-5 py-4 text-right align-middle text-sm text-foreground">
                          {maskNum(b.total_balance)}
                        </td>
                        <td className="numeric px-5 py-4 text-right align-middle text-sm text-foreground">
                          {maskNum(b.available_balance)}
                        </td>
                        <td className="numeric px-5 py-4 text-right align-middle text-sm">
                          <span className={lockedVal > 0 ? 'font-medium text-warning' : 'text-muted-foreground'}>
                            {maskNum(b.locked_balance)}
                          </span>
                        </td>
                        <td className="numeric px-5 py-4 text-right align-middle text-sm font-medium text-foreground">
                          {showBalance ? `$${formatUsd(usdVal)}` : '••••••'}
                        </td>
                        <td className="px-4 py-3 pr-6 text-right align-middle">
                          <ActionDropdown symbol={b.symbol} />
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={6} className="px-6 py-16 text-center sm:py-20">
                      <div className="flex flex-col items-center">
                        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
                          <Wallet className="h-8 w-8 text-muted-foreground" />
                        </div>
                        <p className="font-medium text-foreground">No assets found</p>
                        <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
                          {searchQuery
                            ? 'Try a different search term or clear filters.'
                            : hideZero && balances.length > 0
                              ? 'All rows are hidden while “Hide zero balances” is on. Turn it off to see every asset.'
                              : 'Deposit crypto to see balances here.'}
                        </p>
                        {!searchQuery && !(hideZero && balances.length > 0) ? (
                          <Link
                            href="/dashboard/deposit/crypto"
                            className="mt-5 inline-flex items-center rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
                          >
                            Deposit
                          </Link>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {!isLoading && totalFiltered > 0 ? (
            <div className="flex flex-col gap-3 border-t border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                Showing{' '}
                <span className="numeric font-medium text-foreground">{rangeStart}</span>
                {'–'}
                <span className="numeric font-medium text-foreground">{rangeEnd}</span>
                {' of '}
                <span className="numeric font-medium text-foreground">{totalFiltered}</span>
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
          ) : null}
          </>
        )}
      </div>
    </div>
  );
}
