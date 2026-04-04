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
} from 'lucide-react';

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
  if (!active) return <ChevronsUpDown className="w-3 h-3 opacity-40" />;
  return dir === 'asc'
    ? <ChevronUp className="w-3 h-3 text-primary" />
    : <ChevronDown className="w-3 h-3 text-primary" />;
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
    <div ref={ref} className="relative inline-flex items-center gap-1">
      <Link
        href={`/dashboard/deposit/crypto?coin=${symbol}`}
        className="px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/5 rounded-md transition-colors"
      >
        Deposit
      </Link>
      <Link
        href={`/dashboard/withdraw/crypto?coin=${symbol}`}
        className="px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/5 rounded-md transition-colors"
      >
        Withdraw
      </Link>
      <button
        onClick={() => setOpen(o => !o)}
        className="px-2 py-1.5 text-xs font-medium text-primary hover:bg-primary/5 rounded-md transition-colors flex items-center gap-0.5"
      >
        More <ChevronDown className="w-3 h-3" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-40 bg-card border border-border rounded-xl shadow-xl z-50 py-1 animate-in fade-in slide-in-from-top-1 duration-150">
          <Link
            href="/dashboard/transfer"
            className="flex items-center gap-2 px-4 py-2.5 text-sm text-foreground hover:bg-accent transition-colors"
            onClick={() => setOpen(false)}
          >
            <ArrowLeftRight className="w-3.5 h-3.5 text-muted-foreground" /> Transfer
          </Link>
          <Link
            href={`/trade/spot?symbol=${symbol}_USDT`}
            className="flex items-center gap-2 px-4 py-2.5 text-sm text-foreground hover:bg-accent transition-colors"
            onClick={() => setOpen(false)}
          >
            <BarChart3 className="w-3.5 h-3.5 text-muted-foreground" /> Trade
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
  const [hideZero, setHideZero] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('value');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [refreshing, setRefreshing] = useState(false);

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

  const mask = (v: string) => (showBalance ? v : '••••••');
  const maskNum = (v: string, dec?: number) => (showBalance ? formatCrypto(v, dec) : '••••••');

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      {/* ── Page header ── */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold text-foreground tracking-tight">Funding Account</h1>
          <button
            onClick={() => setShowBalance(s => !s)}
            className="p-1.5 text-muted-foreground hover:text-foreground rounded-lg transition-colors"
            title={showBalance ? 'Hide balances' : 'Show balances'}
          >
            {showBalance ? <Eye className="w-5 h-5" /> : <EyeOff className="w-5 h-5" />}
          </button>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="p-1.5 text-muted-foreground hover:text-foreground rounded-lg transition-colors disabled:opacity-50"
            title="Refresh balances"
          >
            <RefreshCw className={`w-4.5 h-4.5 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/dashboard/deposit/crypto"
            className="flex items-center gap-2 px-5 py-2 bg-primary hover:bg-primary/90 text-primary-foreground font-medium text-sm rounded-lg transition-colors"
          >
            <Download className="w-4 h-4" /> Deposit
          </Link>
          <Link
            href="/dashboard/withdraw/crypto"
            className="flex items-center gap-2 px-5 py-2 bg-card text-foreground font-medium text-sm rounded-lg border border-border hover:bg-accent transition-colors"
          >
            <Upload className="w-4 h-4" /> Withdraw
          </Link>
          <Link
            href="/dashboard/transfer"
            className="flex items-center gap-2 px-5 py-2 bg-card text-foreground font-medium text-sm rounded-lg border border-border hover:bg-accent transition-colors"
          >
            <ArrowLeftRight className="w-4 h-4" /> Transfer
          </Link>
        </div>
      </div>

      {/* ── Session error ── */}
      {sessionError && (
        <div className="mb-6 p-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 flex flex-wrap items-center justify-between gap-4">
          <p className="text-sm text-amber-800 dark:text-amber-200">{sessionError}</p>
          <Link href="/login" className="px-4 py-2 text-sm font-medium rounded-lg bg-amber-600 text-white hover:bg-amber-700 transition-colors">
            Log in again
          </Link>
        </div>
      )}

      {/* ── Equity summary cards ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-card rounded-xl p-5 border border-border">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
              <Wallet className="w-4.5 h-4.5 text-white" />
            </div>
            <span className="text-sm font-medium text-muted-foreground">Total Equity</span>
          </div>
          <p className="text-2xl font-bold text-foreground tabular-nums">
            {showBalance ? `$${formatUsd(totalEquity.usd)}` : '••••••'}
          </p>
          <p className="text-xs text-muted-foreground mt-1 tabular-nums">
            ≈ {showBalance ? `${formatCrypto(totalEquity.btc, 8)} BTC` : '••••••••'}
          </p>
        </div>
        <div className="bg-card rounded-xl p-5 border border-border">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center">
              <ArrowUpRight className="w-4.5 h-4.5 text-white" />
            </div>
            <span className="text-sm font-medium text-muted-foreground">Available Balance</span>
          </div>
          <p className="text-2xl font-bold text-foreground tabular-nums">
            {showBalance ? `$${formatUsd(availableBalance.usd)}` : '••••••'}
          </p>
          <p className="text-xs text-muted-foreground mt-1 tabular-nums">
            ≈ {showBalance ? `${formatCrypto(availableBalance.btc, 8)} BTC` : '••••••••'}
          </p>
        </div>
        <div className="bg-card rounded-xl p-5 border border-border">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center">
              <Clock className="w-4.5 h-4.5 text-white" />
            </div>
            <span className="text-sm font-medium text-muted-foreground">In Use / Locked</span>
          </div>
          <p className="text-2xl font-bold text-foreground tabular-nums">
            {showBalance ? `$${formatUsd(inUse.usd)}` : '••••••'}
          </p>
          <p className="text-xs text-muted-foreground mt-1 tabular-nums">
            ≈ {showBalance ? `${formatCrypto(inUse.btc, 8)} BTC` : '••••••••'}
          </p>
        </div>
      </div>

      {/* ── Crypto / Fiat tabs + table ── */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        {/* Tab bar + controls */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-border">
          <div className="flex items-center gap-1 bg-muted p-1 rounded-lg">
            <button
              onClick={() => setActiveTab('crypto')}
              className={`px-5 py-2 text-sm font-medium rounded-md transition-all ${
                activeTab === 'crypto'
                  ? 'bg-card text-primary shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Crypto
            </button>
            <button
              onClick={() => setActiveTab('fiat')}
              className={`px-5 py-2 text-sm font-medium rounded-md transition-all ${
                activeTab === 'fiat'
                  ? 'bg-card text-primary shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Fiat
            </button>
          </div>

          {activeTab === 'crypto' && (
            <div className="flex items-center gap-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <input
                  type="text"
                  placeholder="Search coin..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 pr-8 py-2 bg-muted border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 w-56 transition-shadow"
                />
                {searchQuery && (
                  <button onClick={() => setSearchQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <label className="flex items-center gap-2 cursor-pointer select-none text-sm text-muted-foreground hover:text-foreground transition-colors">
                <input
                  type="checkbox"
                  checked={hideZero}
                  onChange={(e) => setHideZero(e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-border text-primary focus:ring-primary/40 accent-primary"
                />
                Hide zero balances
              </label>
            </div>
          )}
        </div>

        {/* ── Fiat coming-soon ── */}
        {activeTab === 'fiat' && (
          <div className="flex flex-col items-center justify-center py-24 px-6">
            <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-5">
              <Banknote className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-1">Fiat Balances Coming Soon</h3>
            <p className="text-sm text-muted-foreground max-w-md text-center">
              We&apos;re working on fiat currency support. You&apos;ll be able to deposit and withdraw USD, EUR, and other fiat currencies here.
            </p>
          </div>
        )}

        {/* ── Crypto table ── */}
        {activeTab === 'crypto' && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px]">
              <thead>
                <tr className="bg-muted/50">
                  {([
                    ['symbol', 'Coin', 'left'],
                    ['balance', 'Total Balance', 'right'],
                    [null, 'Available', 'right'],
                    [null, 'In Use / Locked', 'right'],
                    ['value', 'USD Value', 'right'],
                    [null, 'Action', 'right'],
                  ] as const).map(([key, label, align], i) => {
                    const sortable = key !== null;
                    return (
                      <th
                        key={i}
                        className={`px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground ${
                          align === 'right' ? 'text-right' : 'text-left'
                        } ${sortable ? 'cursor-pointer select-none hover:text-foreground transition-colors' : ''}`}
                        onClick={sortable ? () => cycleSort(key) : undefined}
                      >
                        <span className="inline-flex items-center gap-1">
                          {label}
                          {sortable && <SortIcon active={sortKey === key} dir={sortDir} />}
                        </span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {isLoading ? (
                  <SkeletonTableBody rows={8} columns={6} />
                ) : filteredBalances.length > 0 ? (
                  filteredBalances.map((b: TokenBalance) => {
                    const fullName = COIN_NAMES[b.symbol] ?? b.name ?? b.symbol;
                    const usdVal = parseFloat(b.usd_value || '0');
                    const lockedVal = parseFloat(b.locked_balance || '0');

                    return (
                      <tr key={b.token_id} className="group hover:bg-accent/40 transition-colors">
                        {/* Coin */}
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-3">
                            <CoinIcon symbol={b.symbol} size={32} />
                            <div className="min-w-0">
                              <span className="font-semibold text-sm text-foreground">{b.symbol}</span>
                              <p className="text-xs text-muted-foreground truncate">{fullName}</p>
                            </div>
                          </div>
                        </td>
                        {/* Total */}
                        <td className="px-5 py-3.5 text-right font-mono text-sm text-foreground tabular-nums">
                          {maskNum(b.total_balance)}
                        </td>
                        {/* Available */}
                        <td className="px-5 py-3.5 text-right font-mono text-sm text-foreground tabular-nums">
                          {maskNum(b.available_balance)}
                        </td>
                        {/* Locked */}
                        <td className="px-5 py-3.5 text-right font-mono text-sm tabular-nums">
                          <span className={lockedVal > 0 ? 'text-orange-500' : 'text-muted-foreground'}>
                            {maskNum(b.locked_balance)}
                          </span>
                        </td>
                        {/* USD Value */}
                        <td className="px-5 py-3.5 text-right">
                          <span className="font-mono text-sm text-foreground tabular-nums">
                            {showBalance ? `$${formatUsd(usdVal)}` : '••••••'}
                          </span>
                        </td>
                        {/* Actions */}
                        <td className="px-5 py-3.5 text-right">
                          <ActionDropdown symbol={b.symbol} />
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={6} className="py-20 text-center">
                      <div className="flex flex-col items-center">
                        <div className="w-16 h-16 bg-muted rounded-2xl flex items-center justify-center mb-4">
                          <Wallet className="w-8 h-8 text-muted-foreground" />
                        </div>
                        <p className="text-foreground font-medium">No assets found</p>
                        <p className="text-sm text-muted-foreground mt-1">
                          {searchQuery ? 'Try a different search term' : 'Deposit funds to get started'}
                        </p>
                        {!searchQuery && (
                          <Link
                            href="/dashboard/deposit/crypto"
                            className="mt-4 px-6 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground font-medium text-sm rounded-lg transition-colors"
                          >
                            Deposit Now
                          </Link>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
