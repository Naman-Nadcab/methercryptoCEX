'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuthStore } from '@/store/auth';
import Link from 'next/link';
import {
  RefreshCw,
  AlertCircle,
  Wallet,
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Eye,
  EyeOff,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';
import { CoinIcon } from '@/components/ui/CoinIcon';
import { useBalancesSpot } from '@/lib/balances';
import { EmptyState } from '@/components/ui/EmptyState';
import { getApiBaseUrl } from '@/lib/getApiUrl';

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

const usdFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const balFmt = (val: string) => {
  const n = parseFloat(val);
  if (!Number.isFinite(n)) return '0.00';
  if (n === 0) return '0.00';
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 8 });
};

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ArrowUpDown className="ml-1 inline h-3 w-3 opacity-40" />;
  return dir === 'asc'
    ? <ChevronUp className="ml-1 inline h-3 w-3 text-primary" />
    : <ChevronDown className="ml-1 inline h-3 w-3 text-primary" />;
}

export default function SpotWalletPage() {
  const { accessToken, _hasHydrated } = useAuthStore();
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
  const [hideSmall, setHideSmall] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('usdValue');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [prices, setPrices] = useState<TickerMap>({});
  const [balanceHidden, setBalanceHidden] = useState(false);

  const fetchPrices = useCallback(async () => {
    try {
      const base = getApiBaseUrl();
      const res = await fetch(`${base}/api/v1/spot/tickers`);
      const json = await res.json();
      if (json?.success && Array.isArray(json.data)) {
        const map: TickerMap = {};
        for (const t of json.data as SpotTickerRow[]) {
          if (!t.symbol || !t.last_price) continue;
          const base = t.symbol.replace(/_?USDT$/, '');
          map[base] = parseNum(t.last_price);
        }
        map['USDT'] = 1;
        map['USDC'] = 1;
        setPrices(map);
      }
    } catch { /* silently ignore — USD values will show as $0.00 */ }
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

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir(key === 'asset' ? 'asc' : 'desc'); }
  };

  const filtered = useMemo(() => {
    let rows = [...balances];
    if (search) {
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

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      {/* ── Equity header ── */}
      <div className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold text-foreground sm:text-xl">Spot Wallet</h1>
              <button
                type="button"
                onClick={() => setBalanceHidden(h => !h)}
                className="text-muted-foreground transition-colors hover:text-foreground"
                aria-label={balanceHidden ? 'Show balance' : 'Hide balance'}
              >
                {balanceHidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">Estimated Balance</p>
            <p className="mt-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              {balanceHidden ? '****' : loading ? '—' : usdFmt.format(totalEquityUsd)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/dashboard/deposit/crypto"
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/85"
            >
              Deposit
            </Link>
            <Link
              href="/dashboard/withdraw/crypto"
              className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              Withdraw
            </Link>
            <Link
              href="/dashboard/transfer"
              className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              Transfer
            </Link>
          </div>
        </div>
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-border bg-muted px-4 py-3 text-sm text-sell" role="alert">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* ── Table card ── */}
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        {/* toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search coin"
              className="h-9 w-56 rounded-lg border border-border bg-background pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground outline-none transition-colors focus:border-primary"
            />
          </div>
          <div className="flex items-center gap-3">
            <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-muted-foreground">
              <button
                type="button"
                role="switch"
                aria-checked={hideSmall}
                onClick={() => setHideSmall(h => !h)}
                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${hideSmall ? 'bg-primary' : 'bg-muted-foreground/30'}`}
              >
                <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${hideSmall ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
              </button>
              Hide small balances
            </label>
            <button
              type="button"
              onClick={() => refetch()}
              disabled={loading}
              className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Refresh"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* table */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                <SortableHeader label="Coin" sortKey="asset" current={sortKey} dir={sortDir} onSort={toggleSort} className="pl-5" />
                <SortableHeader label="Total" sortKey="balance" current={sortKey} dir={sortDir} onSort={toggleSort} align="right" />
                <SortableHeader label="Available" sortKey="available" current={sortKey} dir={sortDir} onSort={toggleSort} align="right" />
                <SortableHeader label="In Order" sortKey="locked" current={sortKey} dir={sortDir} onSort={toggleSort} align="right" />
                <SortableHeader label="USD Value" sortKey="usdValue" current={sortKey} dir={sortDir} onSort={toggleSort} align="right" />
                <th className="px-4 py-3 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-b border-border">
                    <td className="px-5 py-3.5"><div className="flex items-center gap-3"><div className="h-8 w-8 animate-pulse rounded-full bg-muted" /><div className="space-y-1.5"><div className="h-3.5 w-12 animate-pulse rounded bg-muted" /><div className="h-3 w-20 animate-pulse rounded bg-muted" /></div></div></td>
                    {[1, 2, 3, 4].map(j => <td key={j} className="px-4 py-3.5 text-right"><div className="ml-auto h-4 w-20 animate-pulse rounded bg-muted" /></td>)}
                    <td className="px-4 py-3.5 text-right"><div className="ml-auto h-7 w-14 animate-pulse rounded bg-muted" /></td>
                  </tr>
                ))
              ) : filtered.length === 0 && !error ? (
                <tr>
                  <td colSpan={6} className="p-0 align-top">
                    {search || hideSmall ? (
                      <div className="flex flex-col items-center justify-center py-16 text-center">
                        <Search className="mb-3 h-10 w-10 text-muted-foreground/40" />
                        <p className="text-sm font-medium text-foreground">No matching assets</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {hideSmall ? 'Try disabling "Hide small balances" or adjusting your search.' : 'Try a different search term.'}
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
                filtered.map(row => {
                  const usd = getUsdValue(row.asset, row.balance);
                  return (
                    <tr key={row.asset} className="group border-b border-border transition-colors hover:bg-muted/40">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <CoinIcon symbol={row.asset} size={32} />
                          <div className="leading-tight">
                            <span className="font-semibold text-foreground">{row.asset}</span>
                            <span className="ml-0 block text-xs text-muted-foreground">{COIN_NAMES[row.asset] ?? row.asset}</span>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono tabular-nums text-foreground">
                        {balanceHidden ? '****' : balFmt(row.balance)}
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono tabular-nums text-foreground">
                        {balanceHidden ? '****' : balFmt(row.available_balance)}
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono tabular-nums text-muted-foreground">
                        {balanceHidden ? '****' : balFmt(row.locked_balance ?? '0')}
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono tabular-nums text-foreground">
                        {balanceHidden ? '****' : usdFmt.format(usd)}
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <Link
                          href={`/trade/spot?symbol=${row.asset}_USDT`}
                          className="inline-block rounded-md bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/20"
                        >
                          Trade
                        </Link>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* footer summary */}
        {!loading && filtered.length > 0 && (
          <div className="flex items-center justify-between border-t border-border px-5 py-3 text-xs text-muted-foreground">
            <span>{filtered.length} asset{filtered.length !== 1 ? 's' : ''}</span>
            <span>
              Total: <span className="font-medium text-foreground">{balanceHidden ? '****' : usdFmt.format(totalEquityUsd)}</span>
            </span>
          </div>
        )}
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
      className={`cursor-pointer select-none px-4 py-3 font-medium transition-colors hover:text-foreground ${align === 'right' ? 'text-right' : ''} ${className}`}
      onClick={() => onSort(sortKey)}
    >
      <span className="inline-flex items-center gap-0.5">
        {label}
        <SortIcon active={active} dir={dir} />
      </span>
    </th>
  );
}
