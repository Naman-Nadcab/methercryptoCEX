'use client';

import { useState, useEffect, useMemo, useCallback, useId } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth';
import { api } from '@/lib/api';
import { useBalancesSummary, useBalancesFunding, useBalancesSpot } from '@/lib/balances';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import Link from 'next/link';
import {
  Eye, EyeOff, Download, Upload, ArrowLeftRight, RefreshCw, Wallet,
  TrendingUp, ArrowRight, FileText, Search,
  BarChart3, Sparkles, ArrowUpRight, ArrowDownRight,
  Shield, ChevronRight,
} from 'lucide-react';
import { Skeleton } from '@/components/ui/Skeleton';
import { CoinIcon } from '@/components/ui/CoinIcon';
import { ErrorState } from '@/components/ui/ErrorState';
import { toast } from '@/components/ui/toaster';

/* ── Types ── */
interface Transaction {
  id: string; type: 'deposit' | 'withdrawal' | 'transfer'; symbol: string;
  amount: string; status: string; created_at: string;
}
type TickerRow = { symbol: string; base_asset?: string; quote_asset?: string; lastPrice?: string; last_price?: string; priceChangePercent?: string; change_pct?: number };
type PortfolioPoint = { timestamp: string; total_usd: number };

/** Backend `/wallet/transactions/all` uses coin, quantity, date_time, type "withdraw". */
function normalizeWalletTx(row: Record<string, unknown>): Transaction {
  const typeRaw = String(row.type || '');
  const type: Transaction['type'] =
    typeRaw === 'withdraw' || typeRaw === 'withdrawal' ? 'withdrawal' :
      typeRaw === 'deposit' ? 'deposit' : 'transfer';
  const qty = row.quantity ?? row.amount ?? '0';
  return {
    id: String(row.id ?? ''),
    type,
    symbol: String(row.coin ?? row.symbol ?? ''),
    amount: typeof qty === 'number' ? String(qty) : String(qty),
    status: String(row.status ?? ''),
    created_at: String(row.date_time ?? row.created_at ?? ''),
  };
}

/** Shared USD formatter — used as fallback if chart/donut props are missing (HMR / stale bundles). */
function formatUsdDefault(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function maskStrDefault(s: string): string {
  return s;
}

/* ── Coin names ── */
const COIN_NAMES: Record<string, string> = {
  BTC: 'Bitcoin', ETH: 'Ethereum', BNB: 'BNB', SOL: 'Solana', XRP: 'Ripple',
  ADA: 'Cardano', AVAX: 'Avalanche', DOT: 'Polkadot', ATOM: 'Cosmos', NEAR: 'NEAR Protocol',
  SUI: 'Sui', APT: 'Aptos', SEI: 'Sei', TRX: 'TRON', LTC: 'Litecoin',
  MATIC: 'Polygon', ARB: 'Arbitrum', OP: 'Optimism', UNI: 'Uniswap', AAVE: 'Aave',
  LINK: 'Chainlink', MKR: 'Maker', INJ: 'Injective', DOGE: 'Dogecoin', SHIB: 'Shiba Inu',
  PEPE: 'Pepe', FLOKI: 'FLOKI', BONK: 'Bonk', FET: 'Fetch.ai', RENDER: 'Render',
  WLD: 'Worldcoin', FIL: 'Filecoin', GRT: 'The Graph', ICP: 'Internet Computer',
  HBAR: 'Hedera', VET: 'VeChain', USDT: 'Tether', USDC: 'USD Coin', DAI: 'Dai',
  LDO: 'Lido DAO', IMX: 'Immutable', WIF: 'dogwifhat', AR: 'Arweave',
};

/* ── Mini area chart ── */
function PortfolioMiniChart({
  data,
  width = 360,
  height = 120,
  periodLabel,
  maskStr,
  formatUsd,
}: {
  data: PortfolioPoint[];
  width?: number;
  height?: number;
  periodLabel: string;
  maskStr?: (s: string) => string;
  formatUsd?: (n: number) => string;
}) {
  const gradId = useId().replace(/:/g, '');
  const maskFn = typeof maskStr === 'function' ? maskStr : maskStrDefault;
  const fmtUsdFn = typeof formatUsd === 'function' ? formatUsd : formatUsdDefault;
  if (data.length < 2) {
    return (
      <div className="w-full" style={{ maxWidth: width }}>
        <div className="flex items-center justify-center rounded-lg border border-border bg-muted/20 text-xs text-muted-foreground" style={{ width, height }}>
          <div className="text-center px-2">
            <BarChart3 className="mx-auto mb-1 h-5 w-5 text-muted-foreground/40" />
            <p>Collecting data…</p>
            <p className="mt-1 text-xs text-muted-foreground/80">{periodLabel} range</p>
          </div>
        </div>
      </div>
    );
  }
  const vals = data.map((d) => d.total_usd);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const isUp = vals[vals.length - 1] >= vals[0];
  const color = isUp ? 'hsl(var(--exchange-buy))' : 'hsl(var(--exchange-sell))';
  const pts = vals.map((v, i) => {
    const x = (i / (vals.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 8) - 4;
    return `${x},${y}`;
  });
  const areaPath = `M0,${height} L${pts.join(' L')} L${width},${height} Z`;
  const linePath = `M${pts.join(' L')}`;
  const first = vals[0];
  const last = vals[vals.length - 1];
  return (
    <div className="w-full" style={{ maxWidth: width }}>
      <svg width={width} height={height} className="shrink-0 rounded-lg w-full max-w-full" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.2} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <path d={areaPath} fill={`url(#${gradId})`} />
        <path d={linePath} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="mt-2 flex justify-between gap-4 border-t border-border/60 pt-2 text-xs text-muted-foreground">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Start</p>
          <p className="numeric mt-0.5 text-sm font-semibold text-foreground">${maskFn(fmtUsdFn(first))}</p>
        </div>
        <div className="text-right">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">End</p>
          <p className="numeric mt-0.5 text-sm font-semibold text-foreground">${maskFn(fmtUsdFn(last))}</p>
        </div>
      </div>
    </div>
  );
}

/* Donut slice colors: semantic HSL only (matches tailwind theme tokens). */
const DONUT_COLORS = [
  'hsl(var(--exchange-buy))',
  'hsl(var(--primary))',
  'hsl(var(--exchange-sell))',
  'hsl(var(--ring))',
  'hsl(45 86% 49%)',
  'hsl(var(--secondary-foreground))',
  'hsl(var(--muted-foreground))',
  'hsl(var(--destructive))',
] as const;

/* ── Allocation donut ── */
function AllocationDonut({
  items,
  size = 190,
  centerUsd,
  maskStr,
  formatUsd,
}: {
  items: { symbol: string; value: number; percent: number }[];
  size?: number;
  centerUsd: number;
  maskStr?: (s: string) => string;
  formatUsd?: (n: number) => string;
}) {
  const maskFn = typeof maskStr === 'function' ? maskStr : maskStrDefault;
  const fmtUsdFn = typeof formatUsd === 'function' ? formatUsd : formatUsdDefault;
  const r = size / 2 - 6;
  const cx = size / 2;
  const cy = size / 2;
  let startAngle = -Math.PI / 2;
  const paths = items.slice(0, 8).map((item, i) => {
    const sweep = (item.percent / 100) * 2 * Math.PI;
    const endAngle = startAngle + sweep;
    const large = sweep > Math.PI ? 1 : 0;
    const x1 = cx + r * Math.cos(startAngle);
    const y1 = cy + r * Math.sin(startAngle);
    const x2 = cx + r * Math.cos(endAngle);
    const y2 = cy + r * Math.sin(endAngle);
    const d = `M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2} Z`;
    startAngle = endAngle;
    return { ...item, d, color: DONUT_COLORS[i % DONUT_COLORS.length] };
  });

  const fmtVal = (n: number) => n < 1 ? `$${n.toFixed(4)}` : `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="flex flex-col items-center gap-5">
      {/* Donut chart — always centered */}
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="block">
          {paths.map((p) => (
            <path key={p.symbol} d={p.d} fill={p.color} opacity={0.88} className="transition-opacity hover:opacity-100" />
          ))}
          <circle cx={cx} cy={cy} r={r * 0.52} className="fill-card" />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center px-2 text-center pointer-events-none">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Portfolio</span>
          <span className="numeric mt-0.5 text-sm font-bold text-foreground">{maskFn(fmtUsdFn(centerUsd))}</span>
          <span className="mt-0.5 text-xs text-muted-foreground">{items.length} assets</span>
        </div>
      </div>

      {/* Legend — full width below the donut */}
      <div className="w-full space-y-2">
        {paths.map((p) => (
          <div key={p.symbol} className="grid items-center gap-x-2" style={{ gridTemplateColumns: '10px 1fr auto auto' }}>
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: p.color }} />
            <div className="flex min-w-0 items-center gap-1.5">
              <CoinIcon symbol={p.symbol} size={16} />
              <span className="truncate text-sm font-semibold text-foreground">{p.symbol}</span>
            </div>
            <span className="whitespace-nowrap tabular-nums text-xs text-muted-foreground">{p.percent.toFixed(1)}%</span>
            <span className="whitespace-nowrap tabular-nums text-xs text-foreground">{fmtVal(p.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AssetsOverviewPage() {
  const router = useRouter();
  const { accessToken, _hasHydrated } = useAuthStore();
  const ready = !!_hasHydrated && !!accessToken;

  /* ── State ── */
  const [showBalance, setShowBalance] = useState(true);
  const [activeTab, setActiveTab] = useState<'account' | 'asset'>('account');
  const [hideSmall, setHideSmall] = useState(false);
  const [coinSearch, setCoinSearch] = useState('');
  const [sortField, setSortField] = useState<'symbol' | 'usd' | 'change'>('usd');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [chartPeriod, setChartPeriod] = useState<'24h' | '7d' | '30d' | '90d' | '1y'>('7d');
  const [portfolioHistory, setPortfolioHistory] = useState<PortfolioPoint[]>([]);
  const [recentTxs, setRecentTxs] = useState<Transaction[]>([]);
  const [tickers, setTickers] = useState<TickerRow[]>([]);
  const [portfolioError, setPortfolioError] = useState<string | null>(null);
  const [recentTxError, setRecentTxError] = useState<string | null>(null);
  const [dustLoading, setDustLoading] = useState(false);
  const [statementLoading, setStatementLoading] = useState(false);
  const [security, setSecurity] = useState<{ loading: boolean; totp: boolean; hasEmail: boolean }>({
    loading: true,
    totp: false,
    hasEmail: false,
  });

  /* ── Data hooks ── */
  const { data: summary, isLoading: summaryLoading, refetch: refetchSummary } = useBalancesSummary(ready);
  const { data: fundingData, isLoading: fundingLoading } = useBalancesFunding(ready);
  const { data: spotBalances = [] } = useBalancesSpot(ready);

  const fundingBalances = fundingData?.balances ?? [];
  const fundingTotalObj = fundingData?.totalEquity ?? { usd: 0, btc: 0 };
  const fundingTotal = typeof fundingTotalObj === 'number' ? fundingTotalObj : (fundingTotalObj.usd ?? 0);
  const tradingTotal = summary?.tradingBalance?.totalUsd ?? 0;
  const totalUsd = fundingTotal + tradingTotal;
  const totalBtc = (summary?.fundingBalance?.totalBtc ?? 0) + (summary?.tradingBalance?.totalBtc ?? 0);

  /* ── Fetch tickers for 24h change ── */
  const fetchPortfolioHistory = useCallback(async () => {
    if (!accessToken) return;
    try {
      setPortfolioError(null);
      const r = await api.get<{ success: boolean; data?: PortfolioPoint[] }>(
        `/api/v1/wallet/portfolio-history?period=${chartPeriod}`,
        { notifyOnError: false }
      );
      if (r.success && Array.isArray(r.data)) {
        setPortfolioHistory(r.data as PortfolioPoint[]);
        return;
      }
      setPortfolioError('Portfolio history is temporarily unavailable.');
    } catch {
      setPortfolioError('Portfolio history is temporarily unavailable.');
      toast({
        title: 'Portfolio history unavailable',
        description: 'Could not load your performance chart. Try again.',
        variant: 'destructive',
      });
    }
  }, [accessToken, chartPeriod]);

  useEffect(() => {
    const base = getApiBaseUrl();
    if (!base) return;
    fetch(`${base}/api/v1/spot/tickers`).then((r) => r.json()).then((d) => {
      if (d?.success && Array.isArray(d.data)) setTickers(d.data);
    }).catch(() => {
      toast({
        title: 'Market data unavailable',
        description: 'Live ticker data could not be loaded.',
        variant: 'destructive',
      });
    });
  }, []);

  /* ── Fetch portfolio history ── */
  useEffect(() => {
    void fetchPortfolioHistory();
  }, [fetchPortfolioHistory]);

  /* ── Fetch recent transactions (normalize API shape: coin, quantity, date_time, withdraw) ── */
  const fetchRecentTransactions = useCallback(async () => {
    if (!accessToken) return;
    try {
      setRecentTxError(null);
      const r = await api.get<{ success: boolean; data?: unknown[] }>(
        '/api/v1/wallet/transactions/all?limit=8',
        { notifyOnError: false }
      );
      if (r.success && Array.isArray(r.data)) {
        setRecentTxs(r.data.map((row) => normalizeWalletTx(row as Record<string, unknown>)));
        return;
      }
      setRecentTxError('Recent activity is temporarily unavailable.');
      setRecentTxs([]);
    } catch {
      setRecentTxError('Recent activity is temporarily unavailable.');
      setRecentTxs([]);
      toast({
        title: 'Recent activity unavailable',
        description: 'Could not load wallet activity. Try again.',
        variant: 'destructive',
      });
    }
  }, [accessToken]);

  useEffect(() => {
    void fetchRecentTransactions();
  }, [fetchRecentTransactions]);

  /* ── Security snapshot from profile (no fake badges) ── */
  useEffect(() => {
    if (!_hasHydrated) return;
    if (!accessToken) {
      setSecurity({ loading: false, totp: false, hasEmail: false });
      return;
    }
    setSecurity({ loading: true, totp: false, hasEmail: false });
    const base = getApiBaseUrl();
    if (!base) {
      setSecurity((s) => ({ ...s, loading: false }));
      return;
    }
    let cancelled = false;
    fetch(`${base}/api/v1/auth/profile`, { headers: { Authorization: `Bearer ${accessToken}` } })
      .then((res) => res.json())
      .then((result: { success?: boolean; data?: { user?: { totp_enabled?: boolean; email?: string | null } } }) => {
        if (cancelled) return;
        if (result?.success && result.data?.user) {
          const u = result.data.user;
          setSecurity({
            loading: false,
            totp: !!u.totp_enabled,
            hasEmail: !!(u.email && String(u.email).trim()),
          });
        } else {
          setSecurity({ loading: false, totp: false, hasEmail: false });
        }
      })
      .catch(() => {
        if (!cancelled) setSecurity({ loading: false, totp: false, hasEmail: false });
      });
    return () => {
      cancelled = true;
    };
  }, [_hasHydrated, accessToken]);

  /* ── Price map for USD values ── */
  const priceMap = useMemo(() => {
    const m: Record<string, number> = { USDT: 1, USDC: 1, DAI: 1 };
    for (const t of tickers) {
      const base = t.base_asset || t.symbol?.split('_')[0];
      const price = parseFloat(t.last_price || t.lastPrice || '0');
      if (base && price > 0) m[base] = price;
    }
    return m;
  }, [tickers]);

  /* ── 24h change map ── */
  const changeMap = useMemo(() => {
    const m: Record<string, number> = {};
    for (const t of tickers) {
      const base = t.base_asset || t.symbol?.split('_')[0];
      const ch = t.change_pct ?? parseFloat(t.priceChangePercent || '0');
      if (base && typeof ch === 'number') m[base] = ch;
    }
    return m;
  }, [tickers]);

  /* ── Combined assets (funding + spot) ── */
  type AssetRow = { symbol: string; name: string; funding: number; trading: number; total: number; usd: number; change: number };
  const allAssets = useMemo(() => {
    const map = new Map<string, AssetRow>();
    for (const b of fundingBalances) {
      const sym = b.symbol || '';
      const amt = parseFloat(b.total_balance ?? '0');
      const existing = map.get(sym);
      if (existing) { existing.funding += amt; existing.total += amt; }
      else map.set(sym, { symbol: sym, name: COIN_NAMES[sym] || sym, funding: amt, trading: 0, total: amt, usd: 0, change: changeMap[sym] ?? 0 });
    }
    for (const b of spotBalances) {
      const sym = b.asset || '';
      const amt = parseFloat(b.balance ?? '0');
      const existing = map.get(sym);
      if (existing) { existing.trading += amt; existing.total += amt; }
      else map.set(sym, { symbol: sym, name: COIN_NAMES[sym] || sym, funding: 0, trading: amt, total: amt, usd: 0, change: changeMap[sym] ?? 0 });
    }
    const entries = Array.from(map.values());
    for (const row of entries) {
      row.usd = row.total * (priceMap[row.symbol] ?? 0);
      row.change = changeMap[row.symbol] ?? 0;
    }
    return entries;
  }, [fundingBalances, spotBalances, priceMap, changeMap]);

  /* ── Filtered + sorted assets ── */
  const filtered = useMemo(() => {
    let list = allAssets;
    if (hideSmall) list = list.filter((a) => a.usd >= 1);
    if (coinSearch) {
      const q = coinSearch.toLowerCase();
      list = list.filter((a) => a.symbol.toLowerCase().includes(q) || a.name.toLowerCase().includes(q));
    }
    list.sort((a, b) => {
      let diff = 0;
      if (sortField === 'symbol') diff = a.symbol.localeCompare(b.symbol);
      else if (sortField === 'usd') diff = a.usd - b.usd;
      else if (sortField === 'change') diff = a.change - b.change;
      return sortDir === 'desc' ? -diff : diff;
    });
    return list;
  }, [allAssets, hideSmall, coinSearch, sortField, sortDir]);

  /* ── Allocation chart data ── */
  const allocation = useMemo(() => {
    const total = allAssets.reduce((s, a) => s + a.usd, 0) || 1;
    return allAssets.filter((a) => a.usd > 0).sort((a, b) => b.usd - a.usd)
      .slice(0, 8).map((a) => ({ symbol: a.symbol, value: a.usd, percent: (a.usd / total) * 100 }));
  }, [allAssets]);

  /* ── Top holdings per account ── */
  const topFunding = useMemo(() => {
    return [...fundingBalances]
      .map((b) => ({ symbol: b.symbol || '', amount: parseFloat(b.total_balance ?? '0'), usd: (parseFloat(b.total_balance ?? '0')) * (priceMap[b.symbol || ''] ?? 0) }))
      .filter((b) => b.usd > 0)
      .sort((a, b) => b.usd - a.usd)
      .slice(0, 4);
  }, [fundingBalances, priceMap]);

  const topTrading = useMemo(() => {
    return [...spotBalances]
      .map((b) => ({ symbol: b.asset || '', amount: parseFloat(b.balance ?? '0'), usd: (parseFloat(b.balance ?? '0')) * (priceMap[b.asset || ''] ?? 0) }))
      .filter((b) => b.usd > 0)
      .sort((a, b) => b.usd - a.usd)
      .slice(0, 4);
  }, [spotBalances, priceMap]);

  /* ── Today's PnL (from portfolio history) ── */
  const todayPnl = useMemo(() => {
    if (portfolioHistory.length < 2) return { amount: 0, percent: 0 };
    const first = portfolioHistory[0].total_usd;
    const last = portfolioHistory[portfolioHistory.length - 1].total_usd;
    return { amount: last - first, percent: first > 0 ? ((last - first) / first) * 100 : 0 };
  }, [portfolioHistory]);

  /* ── Balance distribution ── */
  const fundingPct = totalUsd > 0 ? (fundingTotal / totalUsd) * 100 : 50;

  /* ── Actions ── */
  const handleDustConvert = useCallback(async () => {
    setDustLoading(true);
    try {
      const r = await api.post<{ success: boolean; data?: { converted_count: number; total_usdt_received: string } }>('/api/v1/wallet/convert-dust', { threshold: 1 });
      if (r.data?.success && r.data.data) {
        const d = r.data.data;
        if (d.converted_count > 0) {
          refetchSummary();
        }
      }
    } catch {
      toast({
        title: 'Dust conversion failed',
        description: 'Could not convert small balances right now.',
        variant: 'destructive',
      });
    }
    setDustLoading(false);
  }, [refetchSummary]);

  const handleExportStatement = useCallback(async () => {
    setStatementLoading(true);
    try {
      const year = new Date().getFullYear();
      const base = getApiBaseUrl();
      window.open(`${base}/api/v1/wallet/statement?year=${year}&format=csv`, '_blank');
    } catch {
      toast({
        title: 'Statement export failed',
        description: 'Could not start the statement download.',
        variant: 'destructive',
      });
    }
    setStatementLoading(false);
  }, []);

  const toggleSort = (field: typeof sortField) => {
    if (sortField === field) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortField(field); setSortDir('desc'); }
  };

  const isLoading = summaryLoading || fundingLoading;
  const mask = (v: string) => (showBalance ? v : '••••••');
  const fmtUsd = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtBtc = (n: number) => n.toFixed(8);
  const fmtBalance = (n: number) => {
    if (n === 0) return '0.00';
    if (n < 0.0001) return n.toFixed(8);
    if (n < 1) return n.toFixed(6);
    return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
  };
  const fmtAmount = (n: number) => {
    if (n === 0) return '0.00';
    const abs = Math.abs(n);
    if (abs < 0.01) return n.toFixed(6);
    return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 });
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:py-8">

        {/* ── Header ── */}
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-foreground">Assets Overview</h1>
            <button type="button" onClick={() => setShowBalance((v) => !v)} className="rounded-full p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors" aria-label="Toggle balance visibility">
              {showBalance ? <Eye className="h-5 w-5" /> : <EyeOff className="h-5 w-5" />}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/dashboard/deposit/crypto" className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors">
              <Download className="h-4 w-4" /> Deposit
            </Link>
            <Link href="/dashboard/withdraw/crypto" className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted transition-colors">
              <Upload className="h-4 w-4" /> Withdraw
            </Link>
            <Link href="/dashboard/transfer" className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted transition-colors">
              <ArrowLeftRight className="h-4 w-4" /> Transfer
            </Link>
            <Link href="/dashboard/assets/convert" className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted transition-colors">
              <RefreshCw className="h-4 w-4" /> Convert
            </Link>
          </div>
        </div>

        {/* ── Balance Card ── */}
        <div className="mb-8 rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex-1 space-y-5">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Total Balance</p>
                {isLoading ? (
                  <Skeleton className="h-12 w-56" />
                ) : (
                  <div className="flex items-baseline gap-3">
                    <span className="numeric text-4xl font-bold tracking-tight text-foreground sm:text-5xl">{mask(fmtUsd(totalUsd))}</span>
                    <span className="text-lg font-medium text-muted-foreground">USD</span>
                  </div>
                )}
                <p className="mt-1 text-sm text-muted-foreground">≈ <span className="numeric">{mask(fmtBtc(totalBtc))}</span> BTC</p>
              </div>

              {/* PnL badge */}
              <div className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 ${todayPnl.amount >= 0 ? 'bg-buy/10' : 'bg-sell/10'}`}>
                {todayPnl.amount >= 0 ? (
                  <ArrowUpRight className="h-4 w-4 text-buy" />
                ) : (
                  <ArrowDownRight className="h-4 w-4 text-sell" />
                )}
                <span className={`numeric text-sm font-semibold ${todayPnl.amount >= 0 ? 'text-buy' : 'text-sell'}`}>
                  {mask(`${todayPnl.amount >= 0 ? '+' : ''}${fmtUsd(todayPnl.amount)} (${todayPnl.percent >= 0 ? '+' : ''}${todayPnl.percent.toFixed(2)}%)`)}
                </span>
                <span className="text-xs text-muted-foreground">{chartPeriod} P&L</span>
              </div>

              {/* Funding / Trading split */}
              <div className="space-y-3">
                <div className="flex gap-4">
                  <div className="flex-1 rounded-xl border border-border bg-muted/30 p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Wallet className="h-4 w-4 text-primary" />
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Funding</p>
                    </div>
                    <p className="numeric text-xl font-bold text-foreground">${mask(fmtUsd(fundingTotal))}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Deposits & P2P</p>
                  </div>
                  <div className="flex-1 rounded-xl border border-border bg-muted/30 p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <BarChart3 className="h-4 w-4 text-primary" />
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Spot / Trading</p>
                    </div>
                    <p className="numeric text-xl font-bold text-foreground">${mask(fmtUsd(tradingTotal))}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Open orders & trades</p>
                  </div>
                </div>
                {/* Distribution bar */}
                <div>
                  <div className="flex h-2 overflow-hidden rounded-full bg-muted">
                    <div className="rounded-l-full bg-primary transition-all duration-500" style={{ width: `${fundingPct}%` }} />
                    <div className="rounded-r-full bg-primary/40 transition-all duration-500" style={{ width: `${100 - fundingPct}%` }} />
                  </div>
                  <div className="mt-1 flex justify-between text-xs text-muted-foreground">
                    <span>Funding {fundingPct.toFixed(0)}%</span>
                    <span>Trading {(100 - fundingPct).toFixed(0)}%</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Portfolio value chart */}
            <div className="flex flex-col items-end gap-3 lg:min-w-[380px]">
              <div className="flex gap-1 rounded-lg bg-muted/50 p-1">
                {(['24h', '7d', '30d', '90d', '1y'] as const).map((p) => (
                  <button key={p} type="button" onClick={() => setChartPeriod(p)}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${chartPeriod === p ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    {p}
                  </button>
                ))}
              </div>
              <PortfolioMiniChart
                data={portfolioHistory}
                width={360}
                height={120}
                periodLabel={chartPeriod}
                maskStr={mask}
                formatUsd={fmtUsd}
              />
              {portfolioError ? (
                <button
                  type="button"
                  onClick={() => void fetchPortfolioHistory()}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  {portfolioError} Retry
                </button>
              ) : null}
              <p className="text-xs text-muted-foreground">Portfolio value · {chartPeriod}</p>
            </div>
          </div>
        </div>

        {/* ── Account / Asset tabs + Right sidebar ── */}
        <div className="mb-8 grid gap-8 lg:grid-cols-[1fr_340px]">
          {/* Left: tabs content */}
          <div>
            <div className="mb-5 flex items-center gap-6 border-b border-border">
              {(['account', 'asset'] as const).map((tab) => (
                <button key={tab} type="button" onClick={() => setActiveTab(tab)}
                  className={`border-b-2 px-1 pb-3 text-sm font-semibold capitalize transition-colors ${activeTab === tab ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
                >
                  {tab}
                </button>
              ))}
            </div>

            {activeTab === 'account' ? (
              <div className="space-y-4">
                {/* Funding Account — expanded with top holdings */}
                <Link href="/dashboard/assets/funding" className="block rounded-2xl border border-border bg-card p-5 transition-colors hover:border-primary/30 group">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary"><Wallet className="h-5 w-5" /></div>
                      <div>
                        <p className="text-base font-semibold text-foreground">Funding Account</p>
                        <p className="text-xs text-muted-foreground">Deposits, P2P payouts, withdrawals</p>
                      </div>
                    </div>
                    <div className="text-right flex items-center gap-2">
                      <div>
                        <p className="numeric text-lg font-bold text-foreground">{mask(fmtUsd(fundingTotal))}</p>
                        <p className="text-xs text-muted-foreground">USD</p>
                      </div>
                      <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
                    </div>
                  </div>
                  {topFunding.length > 0 && (
                    <div className="rounded-xl bg-muted/30 p-4">
                      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Top Holdings</p>
                      <div className="space-y-2.5">
                        {topFunding.map((h) => (
                          <div key={h.symbol} className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-3">
                            <CoinIcon symbol={h.symbol} size={22} />
                            <div className="min-w-0">
                              <span className="text-sm font-semibold text-foreground">{h.symbol}</span>
                              {COIN_NAMES[h.symbol] ? (
                                <span className="ml-2 text-xs text-muted-foreground">{COIN_NAMES[h.symbol]}</span>
                              ) : null}
                            </div>
                            <span className="numeric text-right text-sm text-foreground">{fmtBalance(h.amount)}</span>
                            <span className="numeric w-[5.5rem] text-right text-sm font-medium text-muted-foreground">${fmtUsd(h.usd)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </Link>

                {/* Spot/Trading Account — expanded with top holdings */}
                <Link href="/dashboard/wallet/spot" className="block rounded-2xl border border-border bg-card p-5 transition-colors hover:border-primary/30 group">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500"><BarChart3 className="h-5 w-5" /></div>
                      <div>
                        <p className="text-base font-semibold text-foreground">Spot / Trading Account</p>
                        <p className="text-xs text-muted-foreground">Used for spot trading orders</p>
                      </div>
                    </div>
                    <div className="text-right flex items-center gap-2">
                      <div>
                        <p className="numeric text-lg font-bold text-foreground">{mask(fmtUsd(tradingTotal))}</p>
                        <p className="text-xs text-muted-foreground">USD</p>
                      </div>
                      <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
                    </div>
                  </div>
                  {topTrading.length > 0 && (
                    <div className="rounded-xl bg-muted/30 p-4">
                      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Top Holdings</p>
                      <div className="space-y-2.5">
                        {topTrading.map((h) => (
                          <div key={h.symbol} className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-3">
                            <CoinIcon symbol={h.symbol} size={22} />
                            <div className="min-w-0">
                              <span className="text-sm font-semibold text-foreground">{h.symbol}</span>
                              {COIN_NAMES[h.symbol] ? (
                                <span className="ml-2 text-xs text-muted-foreground">{COIN_NAMES[h.symbol]}</span>
                              ) : null}
                            </div>
                            <span className="numeric text-right text-sm text-foreground">{fmtBalance(h.amount)}</span>
                            <span className="numeric w-[5.5rem] text-right text-sm font-medium text-muted-foreground">${fmtUsd(h.usd)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </Link>
              </div>
            ) : (
              /* ── Asset tab: full table ── */
              <div>
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="relative flex-1 max-w-xs">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <input type="text" value={coinSearch} onChange={(e) => setCoinSearch(e.target.value)}
                      placeholder="Search coin…" className="h-10 w-full rounded-lg border border-border bg-background pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
                  </div>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
                      <input type="checkbox" checked={hideSmall} onChange={(e) => setHideSmall(e.target.checked)} className="h-4 w-4 rounded border-border accent-primary" />
                      Hide small balances
                    </label>
                    <button type="button" onClick={handleDustConvert} disabled={dustLoading}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50 transition-colors"
                    >
                      <Sparkles className="h-3.5 w-3.5" /> {dustLoading ? 'Converting…' : 'Convert Dust'}
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-border bg-muted/40">
                      <tr>
                        <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground cursor-pointer select-none" onClick={() => toggleSort('symbol')}>
                          Coin {sortField === 'symbol' && (sortDir === 'asc' ? '↑' : '↓')}
                        </th>
                        <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground text-right">Total</th>
                        <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground text-right">Funding</th>
                        <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground text-right">Trading</th>
                        <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground text-right cursor-pointer select-none" onClick={() => toggleSort('usd')}>
                          USD Value {sortField === 'usd' && (sortDir === 'asc' ? '↑' : '↓')}
                        </th>
                        <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground text-right cursor-pointer select-none" onClick={() => toggleSort('change')}>
                          24h {sortField === 'change' && (sortDir === 'asc' ? '↑' : '↓')}
                        </th>
                        <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.length === 0 ? (
                        <tr><td colSpan={7} className="py-12 text-center text-sm text-muted-foreground">No assets found</td></tr>
                      ) : filtered.map((a) => (
                        <tr key={a.symbol} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => router.push(`/dashboard/assets/${a.symbol}`)}>
                          <td className="py-3.5 px-4">
                            <div className="flex items-center gap-3">
                              <CoinIcon symbol={a.symbol} size={28} />
                              <div>
                                <span className="text-sm font-semibold text-foreground">{a.symbol}</span>
                                <p className="text-xs text-muted-foreground">{a.name}</p>
                              </div>
                            </div>
                          </td>
                          <td className="py-3.5 px-4 text-right numeric text-sm text-foreground">{mask(fmtBalance(a.total))}</td>
                          <td className="py-3.5 px-4 text-right numeric text-sm text-muted-foreground">{fmtBalance(a.funding)}</td>
                          <td className="py-3.5 px-4 text-right numeric text-sm text-muted-foreground">{fmtBalance(a.trading)}</td>
                          <td className="py-3.5 px-4 text-right numeric text-sm font-medium text-foreground">${mask(fmtUsd(a.usd))}</td>
                          <td className={`py-3.5 px-4 text-right numeric text-sm font-medium ${a.change >= 0 ? 'text-buy' : 'text-sell'}`}>
                            {a.change >= 0 ? '+' : ''}{a.change.toFixed(2)}%
                          </td>
                          <td className="py-3.5 px-4 text-right">
                            <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                              <Link href={`/trade/spot?symbol=${a.symbol}_USDT`} className="rounded-md px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 transition-colors">Trade</Link>
                              <Link href={`/dashboard/deposit/crypto?coin=${a.symbol}`} className="rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">Deposit</Link>
                              <Link href={`/dashboard/withdraw/crypto?coin=${a.symbol}`} className="rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">Withdraw</Link>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* Right sidebar */}
          <div className="space-y-6">
            {/* Portfolio Allocation */}
            <div className="overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-semibold text-foreground">Portfolio Allocation</h3>
                <span className="text-xs text-muted-foreground">{allocation.length} assets</span>
              </div>
              {allocation.length === 0 ? (
                <div className="py-8 text-center">
                  <Wallet className="mx-auto mb-2 h-8 w-8 text-muted-foreground/30" />
                  <p className="text-sm text-muted-foreground">No assets yet</p>
                  <Link href="/dashboard/deposit/crypto" className="mt-2 inline-block text-sm font-medium text-primary hover:underline">Make your first deposit</Link>
                </div>
              ) : (
                <AllocationDonut
                  items={allocation}
                  size={190}
                  centerUsd={totalUsd}
                  maskStr={mask}
                  formatUsd={fmtUsd}
                />
              )}
            </div>

            {/* Quick Tools — card-based */}
            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <h3 className="mb-4 text-base font-semibold text-foreground">Quick Tools</h3>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3">
                <button type="button" onClick={handleDustConvert} disabled={dustLoading}
                  className="flex min-h-[4.5rem] w-full flex-col justify-center gap-1 rounded-xl border border-border bg-muted/20 p-3 text-left transition-colors hover:bg-muted/50 disabled:opacity-50 sm:min-h-[5rem]">
                  <div className="flex items-start gap-2">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                      <Sparkles className="h-4 w-4 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground">{dustLoading ? 'Converting…' : 'Convert dust'}</p>
                      <p className="mt-0.5 text-xs leading-snug text-muted-foreground">Small balances → USDT</p>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </div>
                </button>
                <button type="button" onClick={handleExportStatement} disabled={statementLoading}
                  className="flex min-h-[4.5rem] w-full flex-col justify-center gap-1 rounded-xl border border-border bg-muted/20 p-3 text-left transition-colors hover:bg-muted/50 disabled:opacity-50 sm:min-h-[5rem]">
                  <div className="flex items-start gap-2">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                      <FileText className="h-4 w-4 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground">{statementLoading ? 'Exporting…' : 'Statement'}</p>
                      <p className="mt-0.5 text-xs leading-snug text-muted-foreground">CSV download</p>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </div>
                </button>
                <Link href="/dashboard/assets/pnl" className="flex min-h-[4.5rem] w-full flex-col justify-center gap-1 rounded-xl border border-border bg-muted/20 p-3 text-left transition-colors hover:bg-muted/50 sm:min-h-[5rem]">
                  <div className="flex items-start gap-2">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-buy/10">
                      <TrendingUp className="h-4 w-4 text-buy" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground">P&L</p>
                      <p className="mt-0.5 text-xs leading-snug text-muted-foreground">Profit & loss</p>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </div>
                </Link>
                <Link href="/dashboard/assets/history" className="flex min-h-[4.5rem] w-full flex-col justify-center gap-1 rounded-xl border border-border bg-muted/20 p-3 text-left transition-colors hover:bg-muted/50 sm:min-h-[5rem]">
                  <div className="flex items-start gap-2">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                      <FileText className="h-4 w-4 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground">History</p>
                      <p className="mt-0.5 text-xs leading-snug text-muted-foreground">All movements</p>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </div>
                </Link>
              </div>
            </div>

            {/* Security snapshot (from /auth/profile) */}
            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <div className="flex items-center gap-3 mb-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                  <Shield className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Security</h3>
                  <p className="text-xs text-muted-foreground">From your account</p>
                </div>
              </div>
              {security.loading ? (
                <div className="space-y-2">
                  <Skeleton className="h-10 w-full rounded-lg" />
                  <Skeleton className="h-10 w-full rounded-lg" />
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between rounded-lg bg-muted/30 px-3 py-2.5">
                    <span className="text-sm text-foreground">Authenticator (2FA)</span>
                    <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${security.totp ? 'bg-buy/10 text-buy' : 'bg-muted text-muted-foreground'}`}>
                      {security.totp ? 'On' : 'Off'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg bg-muted/30 px-3 py-2.5">
                    <span className="text-sm text-foreground">Email on file</span>
                    <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${security.hasEmail ? 'bg-buy/10 text-buy' : 'bg-sell/10 text-sell'}`}>
                      {security.hasEmail ? 'Yes' : 'Add'}
                    </span>
                  </div>
                </div>
              )}
              <Link href="/dashboard/security" className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                Manage security <ChevronRight className="h-3 w-3" />
              </Link>
            </div>
          </div>
        </div>

        {/* ── Recent Activity ── */}
        <div className="rounded-2xl border border-border bg-card shadow-sm">
          <div className="flex items-center justify-between border-b border-border px-5 py-4 sm:px-6">
            <h3 className="text-base font-semibold text-foreground">Recent Activity</h3>
            <Link href="/dashboard/assets/history" className="flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary/80">
              View all <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="divide-y divide-border">
            {recentTxError ? (
              <div className="px-6 py-8">
                <ErrorState
                  title="Could not load recent activity"
                  message={recentTxError}
                  onRetry={() => void fetchRecentTransactions()}
                />
              </div>
            ) : recentTxs.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <FileText className="mx-auto mb-2 h-8 w-8 text-muted-foreground/30" />
                <p className="text-sm font-medium text-foreground">No recent activity</p>
                <p className="mt-1 text-xs text-muted-foreground">Your deposits, withdrawals, and transfers will appear here.</p>
              </div>
            ) : recentTxs.slice(0, 6).map((tx) => {
              const isDeposit = tx.type === 'deposit';
              const isWithdraw = tx.type === 'withdrawal';
              const amt = parseFloat(tx.amount) || 0;
              return (
                <div key={tx.id} className="flex items-center justify-between gap-4 px-5 py-4 sm:px-6 hover:bg-muted/20 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${isDeposit ? 'bg-buy/10' : isWithdraw ? 'bg-sell/10' : 'bg-muted'}`}>
                      {isDeposit ? <Download className="h-4 w-4 text-buy" /> : isWithdraw ? <Upload className="h-4 w-4 text-sell" /> : <ArrowLeftRight className="h-4 w-4 text-muted-foreground" />}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground capitalize">{tx.type}</p>
                      <p className="text-xs text-muted-foreground">
                        {tx.symbol} · {tx.created_at ? new Date(tx.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <p className={`numeric text-sm font-semibold ${isDeposit ? 'text-buy' : isWithdraw ? 'text-sell' : 'text-foreground'}`}>
                      <span>{isDeposit ? '+' : isWithdraw ? '-' : ''}{fmtAmount(Math.abs(amt))}</span>
                      {tx.symbol ? <span className="ml-1 text-xs font-medium text-muted-foreground">{tx.symbol}</span> : null}
                    </p>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                      tx.status === 'completed' || tx.status === 'confirmed' ? 'bg-buy/10 text-buy' :
                      tx.status === 'pending' ? 'bg-amber-500/10 text-amber-500' :
                      tx.status === 'failed' ? 'bg-sell/10 text-sell' : 'bg-muted text-muted-foreground'
                    }`}>
                      {tx.status}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
