'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth';
import { api } from '@/lib/api';
import { useBalancesSummary, useBalancesFunding, useBalancesSpot, type TokenBalance, type SpotBalanceRow } from '@/lib/balances';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import Link from 'next/link';
import {
  Eye, EyeOff, Download, Upload, ArrowLeftRight, RefreshCw, Wallet,
  TrendingUp, TrendingDown, ArrowRight, FileText, Search, ChevronDown,
  BarChart3, Sparkles, Filter, ArrowUpRight, ArrowDownRight, Trash2,
} from 'lucide-react';
import { Skeleton } from '@/components/ui/Skeleton';
import { CoinIcon } from '@/components/ui/CoinIcon';

/* ── Types ── */
interface Transaction {
  id: string; type: 'deposit' | 'withdrawal' | 'transfer'; symbol: string;
  amount: string; status: string; created_at: string;
}
type TickerRow = { symbol: string; base_asset?: string; quote_asset?: string; lastPrice?: string; last_price?: string; priceChangePercent?: string; change_pct?: number };
type PortfolioPoint = { timestamp: string; total_usd: number };

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
function PortfolioMiniChart({ data, width = 280, height = 60 }: { data: PortfolioPoint[]; width?: number; height?: number }) {
  if (data.length < 2) return <div className="flex items-center justify-center text-xs text-muted-foreground" style={{ width, height }}>Collecting data…</div>;
  const vals = data.map((d) => d.total_usd);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const isUp = vals[vals.length - 1] >= vals[0];
  const color = isUp ? '#0ecb81' : '#f6465d';
  const pts = vals.map((v, i) => {
    const x = (i / (vals.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  });
  const areaPath = `M0,${height} L${pts.join(' L')} L${width},${height} Z`;
  const linePath = `M${pts.join(' L')}`;
  return (
    <svg width={width} height={height} className="shrink-0">
      <defs>
        <linearGradient id="pfGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.25} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#pfGrad)" />
      <path d={linePath} fill="none" stroke={color} strokeWidth={1.5} />
    </svg>
  );
}

/* ── Allocation donut ── */
function AllocationDonut({ items, size = 140 }: { items: { symbol: string; value: number; percent: number }[]; size?: number }) {
  const r = size / 2 - 4;
  const cx = size / 2;
  const cy = size / 2;
  const COLORS = ['#0ecb81', '#f0b90b', '#3861fb', '#627eea', '#e84142', '#f7931a', '#9945ff', '#e6007a', '#26a17b', '#00c08b'];
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
    return { ...item, d, color: COLORS[i % COLORS.length] };
  });
  return (
    <div className="flex items-center gap-4">
      <svg width={size} height={size} className="shrink-0">
        {paths.map((p) => <path key={p.symbol} d={p.d} fill={p.color} opacity={0.9} className="transition-opacity hover:opacity-100" />)}
        <circle cx={cx} cy={cy} r={r * 0.55} className="fill-card" />
      </svg>
      <div className="flex flex-col gap-1 min-w-0">
        {paths.map((p) => (
          <div key={p.symbol} className="flex items-center gap-2 text-xs">
            <CoinIcon symbol={p.symbol} size={16} />
            <span className="text-foreground font-medium">{p.symbol}</span>
            <span className="text-muted-foreground tabular-nums">{p.percent.toFixed(1)}%</span>
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
  const [dustLoading, setDustLoading] = useState(false);
  const [statementLoading, setStatementLoading] = useState(false);

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
  useEffect(() => {
    const base = getApiBaseUrl();
    if (!base) return;
    fetch(`${base}/api/v1/spot/tickers`).then((r) => r.json()).then((d) => {
      if (d?.success && Array.isArray(d.data)) setTickers(d.data);
    }).catch(() => {});
  }, []);

  /* ── Fetch portfolio history ── */
  useEffect(() => {
    if (!accessToken) return;
    api.get<{ success: boolean; data?: PortfolioPoint[] }>(`/api/v1/wallet/portfolio-history?period=${chartPeriod}`, { notifyOnError: false })
      .then((r) => { if (r.data?.success && r.data.data) setPortfolioHistory(r.data.data); })
      .catch(() => {});
  }, [accessToken, chartPeriod]);

  /* ── Fetch recent transactions ── */
  useEffect(() => {
    if (!accessToken) return;
    api.get<{ success: boolean; data?: Transaction[] }>('/api/v1/wallet/transactions/all?limit=8', { notifyOnError: false })
      .then((r) => { if (r.data?.success && r.data.data) setRecentTxs(r.data.data); })
      .catch(() => {});
  }, [accessToken]);

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

  /* ── Today's PnL (from portfolio history) ── */
  const todayPnl = useMemo(() => {
    if (portfolioHistory.length < 2) return { amount: 0, percent: 0 };
    const first = portfolioHistory[0].total_usd;
    const last = portfolioHistory[portfolioHistory.length - 1].total_usd;
    return { amount: last - first, percent: first > 0 ? ((last - first) / first) * 100 : 0 };
  }, [portfolioHistory]);

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
    } catch { /* ignore */ }
    setDustLoading(false);
  }, [refetchSummary]);

  const handleExportStatement = useCallback(async () => {
    setStatementLoading(true);
    try {
      const year = new Date().getFullYear();
      const base = getApiBaseUrl();
      window.open(`${base}/api/v1/wallet/statement?year=${year}&format=csv`, '_blank');
    } catch { /* ignore */ }
    setStatementLoading(false);
  }, []);

  const toggleSort = (field: typeof sortField) => {
    if (sortField === field) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortField(field); setSortDir('desc'); }
  };

  const isLoading = summaryLoading || fundingLoading;
  const mask = (v: string) => (showBalance ? v : '****');
  const fmtUsd = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtBtc = (n: number) => n.toFixed(8);
  const fmtBalance = (n: number) => {
    if (n === 0) return '0';
    if (n < 0.0001) return n.toFixed(8);
    if (n < 1) return n.toFixed(6);
    return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">

        {/* ── Header ── */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-foreground">Assets Overview</h1>
            <button type="button" onClick={() => setShowBalance((v) => !v)} className="rounded-full p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors" aria-label="Toggle balance visibility">
              {showBalance ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/dashboard/deposit/crypto" className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors">
              <Download className="h-3.5 w-3.5" /> Deposit
            </Link>
            <Link href="/dashboard/withdraw/crypto" className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3.5 py-2 text-xs font-medium text-foreground hover:bg-muted transition-colors">
              <Upload className="h-3.5 w-3.5" /> Withdraw
            </Link>
            <Link href="/dashboard/transfer" className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3.5 py-2 text-xs font-medium text-foreground hover:bg-muted transition-colors">
              <ArrowLeftRight className="h-3.5 w-3.5" /> Transfer
            </Link>
            <Link href="/dashboard/assets/convert" className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3.5 py-2 text-xs font-medium text-foreground hover:bg-muted transition-colors">
              <RefreshCw className="h-3.5 w-3.5" /> Convert
            </Link>
          </div>
        </div>

        {/* ── Balance Card ── */}
        <div className="mb-6 rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex-1">
              <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">Total Balance</p>
              {isLoading ? (
                <Skeleton className="h-10 w-48" />
              ) : (
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-bold tabular-nums text-foreground">{mask(fmtUsd(totalUsd))}</span>
                  <span className="text-sm text-muted-foreground">USD</span>
                </div>
              )}
              <p className="mt-0.5 text-xs text-muted-foreground">≈ {mask(fmtBtc(totalBtc))} BTC</p>

              <div className="mt-3 flex items-center gap-4">
                <div className="flex items-center gap-1.5">
                  {todayPnl.amount >= 0 ? (
                    <ArrowUpRight className="h-3.5 w-3.5 text-buy" />
                  ) : (
                    <ArrowDownRight className="h-3.5 w-3.5 text-sell" />
                  )}
                  <span className={`text-sm font-semibold tabular-nums ${todayPnl.amount >= 0 ? 'text-buy' : 'text-sell'}`}>
                    {mask(`${todayPnl.amount >= 0 ? '+' : ''}${fmtUsd(todayPnl.amount)} (${todayPnl.percent >= 0 ? '+' : ''}${todayPnl.percent.toFixed(2)}%)`)}
                  </span>
                  <span className="text-[10px] text-muted-foreground">Period P&L</span>
                </div>
              </div>

              <div className="mt-4 flex gap-3 text-xs">
                <div className="rounded-lg bg-muted/50 px-3 py-2">
                  <p className="text-muted-foreground">Funding</p>
                  <p className="font-semibold tabular-nums text-foreground">{mask(fmtUsd(fundingTotal))}</p>
                </div>
                <div className="rounded-lg bg-muted/50 px-3 py-2">
                  <p className="text-muted-foreground">Spot / Trading</p>
                  <p className="font-semibold tabular-nums text-foreground">{mask(fmtUsd(tradingTotal))}</p>
                </div>
              </div>
            </div>

            {/* Portfolio value chart */}
            <div className="flex flex-col items-end gap-2">
              <div className="flex gap-1">
                {(['24h', '7d', '30d', '90d', '1y'] as const).map((p) => (
                  <button key={p} type="button" onClick={() => setChartPeriod(p)}
                    className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${chartPeriod === p ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}
                  >
                    {p}
                  </button>
                ))}
              </div>
              <PortfolioMiniChart data={portfolioHistory} width={280} height={60} />
              <p className="text-[10px] text-muted-foreground">Portfolio value over time</p>
            </div>
          </div>
        </div>

        {/* ── Account / Asset tabs + Allocation ── */}
        <div className="mb-6 grid gap-6 lg:grid-cols-[1fr_320px]">
          {/* Left: tabs content */}
          <div>
            <div className="mb-4 flex items-center gap-4 border-b border-border">
              {(['account', 'asset'] as const).map((tab) => (
                <button key={tab} type="button" onClick={() => setActiveTab(tab)}
                  className={`border-b-2 px-1 pb-2 text-sm font-medium capitalize transition-colors ${activeTab === tab ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
                >
                  {tab}
                </button>
              ))}
            </div>

            {activeTab === 'account' ? (
              <div className="space-y-3">
                {/* Funding Account */}
                <Link href="/dashboard/assets/funding" className="flex items-center justify-between rounded-xl border border-border bg-card p-4 transition-colors hover:bg-muted/50 group">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary"><Wallet className="h-5 w-5" /></div>
                    <div>
                      <p className="text-sm font-semibold text-foreground">Funding Account</p>
                      <p className="text-xs text-muted-foreground">Deposits, P2P payouts, withdrawals</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold tabular-nums text-foreground">{mask(fmtUsd(fundingTotal))} <span className="text-xs text-muted-foreground">USD</span></p>
                    <ArrowRight className="mt-1 ml-auto h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </Link>

                {/* Spot/Trading Account */}
                <Link href="/dashboard/wallet/spot" className="flex items-center justify-between rounded-xl border border-border bg-card p-4 transition-colors hover:bg-muted/50 group">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/10 text-amber-500"><BarChart3 className="h-5 w-5" /></div>
                    <div>
                      <p className="text-sm font-semibold text-foreground">Spot / Trading Account</p>
                      <p className="text-xs text-muted-foreground">Used for spot trading orders</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold tabular-nums text-foreground">{mask(fmtUsd(tradingTotal))} <span className="text-xs text-muted-foreground">USD</span></p>
                    <ArrowRight className="mt-1 ml-auto h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </Link>
              </div>
            ) : (
              /* ── Asset tab: full table ── */
              <div>
                <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="relative flex-1 max-w-xs">
                    <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <input type="text" value={coinSearch} onChange={(e) => setCoinSearch(e.target.value)}
                      placeholder="Search coin…" className="h-8 w-full rounded-lg border border-border bg-background pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/30" />
                  </div>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
                      <input type="checkbox" checked={hideSmall} onChange={(e) => setHideSmall(e.target.checked)} className="h-3.5 w-3.5 rounded border-border accent-primary" />
                      Hide small balances
                    </label>
                    <button type="button" onClick={handleDustConvert} disabled={dustLoading}
                      className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 text-[10px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50 transition-colors"
                      title="Convert small balances to USDT"
                    >
                      <Sparkles className="h-3 w-3" /> {dustLoading ? 'Converting…' : 'Convert Small Balances'}
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-border bg-muted/50 text-muted-foreground">
                      <tr>
                        <th className="py-2.5 px-3 font-medium cursor-pointer select-none" onClick={() => toggleSort('symbol')}>
                          Coin {sortField === 'symbol' && (sortDir === 'asc' ? '↑' : '↓')}
                        </th>
                        <th className="py-2.5 px-3 font-medium text-right">Total</th>
                        <th className="py-2.5 px-3 font-medium text-right">Funding</th>
                        <th className="py-2.5 px-3 font-medium text-right">Trading</th>
                        <th className="py-2.5 px-3 font-medium text-right cursor-pointer select-none" onClick={() => toggleSort('usd')}>
                          USD Value {sortField === 'usd' && (sortDir === 'asc' ? '↑' : '↓')}
                        </th>
                        <th className="py-2.5 px-3 font-medium text-right cursor-pointer select-none" onClick={() => toggleSort('change')}>
                          24h {sortField === 'change' && (sortDir === 'asc' ? '↑' : '↓')}
                        </th>
                        <th className="py-2.5 px-3 font-medium text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.length === 0 ? (
                        <tr><td colSpan={7} className="py-8 text-center text-muted-foreground">No assets found</td></tr>
                      ) : filtered.map((a) => (
                        <tr key={a.symbol} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => router.push(`/dashboard/assets/${a.symbol}`)}>
                          <td className="py-2.5 px-3">
                            <div className="flex items-center gap-2">
                              <CoinIcon symbol={a.symbol} size={24} />
                              <div>
                                <span className="font-medium text-foreground">{a.symbol}</span>
                                <p className="text-[10px] text-muted-foreground">{a.name}</p>
                              </div>
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums text-foreground">{mask(fmtBalance(a.total))}</td>
                          <td className="py-2.5 px-3 text-right tabular-nums text-muted-foreground">{fmtBalance(a.funding)}</td>
                          <td className="py-2.5 px-3 text-right tabular-nums text-muted-foreground">{fmtBalance(a.trading)}</td>
                          <td className="py-2.5 px-3 text-right tabular-nums text-foreground">${mask(fmtUsd(a.usd))}</td>
                          <td className={`py-2.5 px-3 text-right tabular-nums font-medium ${a.change >= 0 ? 'text-buy' : 'text-sell'}`}>
                            {a.change >= 0 ? '+' : ''}{a.change.toFixed(2)}%
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                              <Link href={`/trade/spot?symbol=${a.symbol}_USDT`} className="rounded px-2 py-1 text-[10px] font-medium text-primary hover:bg-primary/10 transition-colors">Trade</Link>
                              <Link href={`/dashboard/deposit/crypto?coin=${a.symbol}`} className="rounded px-2 py-1 text-[10px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">Deposit</Link>
                              <Link href={`/dashboard/withdraw/crypto?coin=${a.symbol}`} className="rounded px-2 py-1 text-[10px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">Withdraw</Link>
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

          {/* Right: Portfolio Allocation */}
          <div className="space-y-5">
            <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
              <h3 className="mb-3 text-sm font-semibold text-foreground">Portfolio Allocation</h3>
              {allocation.length === 0 ? (
                <p className="py-4 text-center text-xs text-muted-foreground">No assets</p>
              ) : (
                <AllocationDonut items={allocation} size={130} />
              )}
            </div>

            {/* Quick tools */}
            <div className="rounded-xl border border-border bg-card p-4 shadow-sm space-y-2">
              <h3 className="text-sm font-semibold text-foreground">Quick Tools</h3>
              <button type="button" onClick={handleDustConvert} disabled={dustLoading}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50">
                <Sparkles className="h-4 w-4" /> {dustLoading ? 'Converting…' : 'Convert Small Balances to USDT'}
              </button>
              <button type="button" onClick={handleExportStatement} disabled={statementLoading}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50">
                <FileText className="h-4 w-4" /> {statementLoading ? 'Exporting…' : 'Export Transaction Statement'}
              </button>
              <Link href="/dashboard/assets/pnl" className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
                <TrendingUp className="h-4 w-4" /> P&L Analysis
              </Link>
              <Link href="/dashboard/assets/history" className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
                <FileText className="h-4 w-4" /> Transaction History
              </Link>
            </div>
          </div>
        </div>

        {/* ── Recent Activity ── */}
        <div className="rounded-xl border border-border bg-card shadow-sm">
          <div className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-5">
            <h3 className="text-sm font-semibold text-foreground">Recent Activity</h3>
            <Link href="/dashboard/assets/history" className="flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80">
              All <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="divide-y divide-border">
            {recentTxs.length === 0 ? (
              <div className="px-5 py-8 text-center text-xs text-muted-foreground">No recent activity</div>
            ) : recentTxs.slice(0, 6).map((tx) => {
              const isDeposit = tx.type === 'deposit';
              const isWithdraw = tx.type === 'withdrawal';
              const amt = parseFloat(tx.amount) || 0;
              return (
                <div key={tx.id} className="flex items-center justify-between px-4 py-3 sm:px-5 hover:bg-muted/30 transition-colors">
                  <div className="flex items-center gap-3">
                    <CoinIcon symbol={tx.symbol || ''} size={32} />
                    <div>
                      <p className="text-sm font-medium text-foreground capitalize">{tx.type}</p>
                      <p className="text-[10px] text-muted-foreground">{tx.symbol}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-medium tabular-nums ${isDeposit ? 'text-buy' : isWithdraw ? 'text-sell' : 'text-foreground'}`}>
                      {isDeposit ? '+' : isWithdraw ? '-' : ''}{Math.abs(amt).toFixed(8)}
                    </p>
                    <p className="text-[10px] text-muted-foreground">{tx.created_at ? new Date(tx.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : ''}</p>
                  </div>
                  <span className={`ml-3 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    tx.status === 'completed' || tx.status === 'confirmed' ? 'bg-buy/10 text-buy' :
                    tx.status === 'pending' ? 'bg-amber-500/10 text-amber-500' :
                    tx.status === 'failed' ? 'bg-sell/10 text-sell' : 'bg-muted text-muted-foreground'
                  }`}>
                    {tx.status}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
