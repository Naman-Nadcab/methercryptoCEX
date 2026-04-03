'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useAuthStore } from '@/store/auth';
import { api } from '@/lib/api';
import { notifyError, notifySuccess } from '@/lib/notifyError';
import Link from 'next/link';
import {
  TrendingUp,
  TrendingDown,
  RefreshCw,
  BarChart3,
  ChevronDown,
  Filter,
  Download,
  Trophy,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownRight,
  Search,
} from 'lucide-react';
import { CoinIcon } from '@/components/ui/CoinIcon';

interface PnlAsset {
  symbol: string;
  pnl: number;
  pnlPercent: number;
  buyVolume: number;
  sellVolume: number;
  avgBuyPrice: number;
  avgSellPrice: number;
}

interface PnlPayload {
  totalPnl: number;
  totalPnlPercent: number;
  assets: PnlAsset[];
}

type Period = 'today' | '7d' | '30d' | '90d';

const PERIODS: { id: Period; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: '7d', label: '7D' },
  { id: '30d', label: '30D' },
  { id: '90d', label: '90D' },
];

function fmt(n: number, decimals = 2): string {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  return fmt(n);
}

function pnlColor(v: number): string {
  if (v > 0) return 'text-buy';
  if (v < 0) return 'text-sell';
  return 'text-muted-foreground';
}

function pnlSign(v: number): string {
  return v > 0 ? '+' : '';
}

// ── Equity-curve SVG chart ────────────────────────────────────────────
function EquityCurve({ assets, totalPnl }: { assets: PnlAsset[]; totalPnl: number }) {
  const W = 720;
  const H = 200;
  const PX = 40;
  const PY = 24;

  const points = useMemo(() => {
    if (assets.length === 0) return [];
    let cumulative = 0;
    return assets.map((a) => {
      cumulative += a.pnl;
      return cumulative;
    });
  }, [assets]);

  if (points.length < 2) {
    return (
      <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
        Not enough data to render chart
      </div>
    );
  }

  const min = Math.min(0, ...points);
  const max = Math.max(0, ...points);
  const range = max - min || 1;

  const toX = (i: number) => PX + ((W - PX * 2) / (points.length - 1)) * i;
  const toY = (v: number) => PY + (H - PY * 2) * (1 - (v - min) / range);

  const linePath = points.map((v, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L${toX(points.length - 1).toFixed(1)},${toY(0).toFixed(1)} L${toX(0).toFixed(1)},${toY(0).toFixed(1)} Z`;

  const isPositive = totalPnl >= 0;
  const gradientId = isPositive ? 'pnl-grad-pos' : 'pnl-grad-neg';
  const strokeColor = isPositive ? 'var(--color-buy, #22c55e)' : 'var(--color-sell, #ef4444)';

  const zeroY = toY(0);
  const gridValues = [max, max * 0.5, 0, min * 0.5, min].filter(
    (v, _, arr) => arr.indexOf(v) === arr.lastIndexOf(v) || v !== 0
  );
  const uniqueGrid = Array.from(new Set(gridValues.map((v) => toY(v).toFixed(0)))).map((yStr) => {
    const y = Number(yStr);
    const value = min + (1 - (y - PY) / (H - PY * 2)) * range;
    return { y, value };
  });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={strokeColor} stopOpacity={0.25} />
          <stop offset="100%" stopColor={strokeColor} stopOpacity={0.02} />
        </linearGradient>
      </defs>

      {uniqueGrid.map((g, i) => (
        <g key={i}>
          <line x1={PX} y1={g.y} x2={W - PX} y2={g.y} stroke="currentColor" strokeOpacity={0.07} strokeDasharray="4 4" />
          <text x={PX - 4} y={g.y + 3} textAnchor="end" className="fill-muted-foreground" fontSize={9}>
            {fmtCompact(g.value)}
          </text>
        </g>
      ))}

      <line x1={PX} y1={zeroY} x2={W - PX} y2={zeroY} stroke="currentColor" strokeOpacity={0.15} />

      <path d={areaPath} fill={`url(#${gradientId})`} />
      <path d={linePath} fill="none" stroke={strokeColor} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

      <circle cx={toX(points.length - 1)} cy={toY(points[points.length - 1])} r={4} fill={strokeColor} />
    </svg>
  );
}

// ── Main page ─────────────────────────────────────────────────────────
export default function PnlAnalysisPage() {
  const { accessToken, _hasHydrated } = useAuthStore();

  const [period, setPeriod] = useState<Period>('7d');
  const [selectedSymbol, setSelectedSymbol] = useState('all');
  const [symbolSearch, setSymbolSearch] = useState('');
  const [showSymbolDropdown, setShowSymbolDropdown] = useState(false);

  const [assets, setAssets] = useState<PnlAsset[]>([]);
  const [totalPnl, setTotalPnl] = useState(0);
  const [totalPnlPercent, setTotalPnlPercent] = useState(0);
  const [loading, setLoading] = useState(true);

  const [sortKey, setSortKey] = useState<'pnl' | 'pnlPercent' | 'volume'>('pnl');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowSymbolDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const fetchPnl = useCallback(
    async (p: Period, sym: string) => {
      try {
        setLoading(true);
        const qs = new URLSearchParams({ period: p, type: 'all', symbol: sym });
        const res = await api.get<PnlPayload>(`/api/v1/wallet/pnl?${qs}`, { notifyOnError: false });
        if (!res.success || !res.data) {
          notifyError(res.error?.message ?? 'Failed to load P&L data');
          setAssets([]);
          setTotalPnl(0);
          setTotalPnlPercent(0);
          return;
        }
        const d = res.data;
        setAssets(Array.isArray(d.assets) ? d.assets : []);
        setTotalPnl(Number(d.totalPnl) || 0);
        setTotalPnlPercent(Number(d.totalPnlPercent) || 0);
      } catch {
        notifyError('Failed to load P&L data');
        setAssets([]);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!_hasHydrated || !accessToken) return;
    void fetchPnl(period, selectedSymbol);
  }, [accessToken, _hasHydrated, period, selectedSymbol, fetchPnl]);

  // Derived data
  const symbolOptions = useMemo(() => {
    return Array.from(new Set(assets.map((a) => a.symbol))).sort();
  }, [assets]);

  const filteredSymbols = useMemo(() => {
    if (!symbolSearch.trim()) return symbolOptions;
    const q = symbolSearch.trim().toUpperCase();
    return symbolOptions.filter((s) => s.toUpperCase().includes(q));
  }, [symbolOptions, symbolSearch]);

  const bestPerformer = useMemo(() => {
    if (assets.length === 0) return null;
    return [...assets].sort((a, b) => b.pnl - a.pnl)[0];
  }, [assets]);

  const worstPerformer = useMemo(() => {
    if (assets.length === 0) return null;
    return [...assets].sort((a, b) => a.pnl - b.pnl)[0];
  }, [assets]);

  const sortedAssets = useMemo(() => {
    const copy = [...assets];
    copy.sort((a, b) => {
      let diff = 0;
      if (sortKey === 'pnl') diff = a.pnl - b.pnl;
      else if (sortKey === 'pnlPercent') diff = a.pnlPercent - b.pnlPercent;
      else diff = a.buyVolume + a.sellVolume - (b.buyVolume + b.sellVolume);
      return sortDir === 'desc' ? -diff : diff;
    });
    return copy;
  }, [assets, sortKey, sortDir]);

  const maxAbsPnl = useMemo(() => {
    return Math.max(1, ...assets.map((a) => Math.abs(a.pnl)));
  }, [assets]);

  const handleSort = (key: typeof sortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const handleExport = () => {
    if (assets.length === 0) {
      notifyError('No data to export');
      return;
    }
    const header = 'Symbol,PnL (USD),PnL %,Buy Volume,Sell Volume,Avg Buy Price,Avg Sell Price';
    const rows = assets.map(
      (a) =>
        `${a.symbol},${a.pnl},${a.pnlPercent},${a.buyVolume},${a.sellVolume},${a.avgBuyPrice},${a.avgSellPrice}`,
    );
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `pnl_${period}_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    notifySuccess('Exported', 'CSV file downloaded');
  };

  const handlePeriodChange = (p: Period) => {
    setPeriod(p);
  };

  const handleSymbolSelect = (sym: string) => {
    setSelectedSymbol(sym);
    setShowSymbolDropdown(false);
    setSymbolSearch('');
  };

  const hasNoData = !loading && assets.length === 0 && totalPnl === 0;

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">P&L Analysis</h1>
          <div className="flex items-center gap-2 rounded-xl border border-border bg-primary/10 px-3 py-1.5">
            <BarChart3 className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium text-primary">Performance</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExport}
            className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:border-primary/40"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </button>
          <button
            type="button"
            onClick={() => void fetchPnl(period, selectedSymbol)}
            className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:border-primary/40"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Period chips + Symbol filter */}
      <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex flex-wrap gap-2">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => handlePeriodChange(p.id)}
              className={`rounded-xl px-4 py-2 text-sm font-medium transition-all ${
                period === p.id
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'border border-border bg-muted text-muted-foreground hover:border-primary/40 hover:text-foreground'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div ref={dropdownRef} className="relative min-w-[200px]">
          <button
            type="button"
            onClick={() => setShowSymbolDropdown(!showSymbolDropdown)}
            className="flex w-full items-center justify-between gap-4 rounded-xl border border-border bg-muted px-4 py-2.5 text-sm text-foreground transition-colors hover:border-primary/40"
          >
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              {selectedSymbol === 'all' ? (
                <span>All Symbols</span>
              ) : (
                <span className="flex items-center gap-2">
                  <CoinIcon symbol={selectedSymbol} size={16} />
                  {selectedSymbol}
                </span>
              )}
            </div>
            <ChevronDown className={`h-4 w-4 transition-transform ${showSymbolDropdown ? 'rotate-180' : ''}`} />
          </button>

          {showSymbolDropdown && (
            <div className="absolute right-0 top-full z-20 mt-2 w-full min-w-[220px] overflow-hidden rounded-xl border border-border bg-card shadow-xl">
              <div className="border-b border-border p-2">
                <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2">
                  <Search className="h-4 w-4 text-muted-foreground" />
                  <input
                    type="text"
                    value={symbolSearch}
                    onChange={(e) => setSymbolSearch(e.target.value)}
                    placeholder="Search symbol…"
                    className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                    autoFocus
                  />
                </div>
              </div>
              <div className="max-h-56 overflow-y-auto">
                <button
                  type="button"
                  onClick={() => handleSymbolSelect('all')}
                  className={`w-full px-4 py-3 text-left text-sm transition-colors ${
                    selectedSymbol === 'all' ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted'
                  }`}
                >
                  All Symbols
                </button>
                {filteredSymbols.map((sym) => (
                  <button
                    type="button"
                    key={sym}
                    onClick={() => handleSymbolSelect(sym)}
                    className={`flex w-full items-center gap-2.5 px-4 py-3 text-left text-sm transition-colors ${
                      sym === selectedSymbol ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted'
                    }`}
                  >
                    <CoinIcon symbol={sym} size={18} />
                    {sym}
                  </button>
                ))}
                {filteredSymbols.length === 0 && (
                  <p className="px-4 py-3 text-center text-sm text-muted-foreground">No matches</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {hasNoData ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-card py-16 shadow-sm">
          <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-xl bg-muted">
            <BarChart3 className="h-10 w-10 text-muted-foreground" />
          </div>
          <p className="font-medium text-foreground">No P&L data available</p>
          <p className="mt-1 max-w-md text-center text-sm text-muted-foreground">
            Start trading to see your profit & loss analysis. Your performance summary and per-asset breakdown will appear here.
          </p>
          <Link
            href="/dashboard/trade/spot"
            className="mt-6 rounded-xl bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go to Spot Trading
          </Link>
        </div>
      ) : (
        <>
          {/* Equity curve */}
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <h3 className="text-sm font-semibold text-foreground">Cumulative P&L</h3>
              <span className={`text-sm font-semibold tabular-nums ${pnlColor(totalPnl)}`}>
                {pnlSign(totalPnl)}${fmt(Math.abs(totalPnl))}
              </span>
            </div>
            <div className="px-2 py-3 sm:px-4">
              {loading ? (
                <div className="flex h-[200px] items-center justify-center">
                  <RefreshCw className="h-6 w-6 animate-spin text-primary" />
                </div>
              ) : (
                <EquityCurve assets={sortedAssets} totalPnl={totalPnl} />
              )}
            </div>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* Total PnL */}
            <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
              <div className="flex items-center gap-3">
                <div
                  className={`flex h-11 w-11 items-center justify-center rounded-xl ${
                    totalPnl >= 0 ? 'bg-buy-light' : 'bg-sell-light'
                  }`}
                >
                  {totalPnl >= 0 ? (
                    <ArrowUpRight className="h-5 w-5 text-buy" />
                  ) : (
                    <ArrowDownRight className="h-5 w-5 text-sell" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-muted-foreground">Total P&L</p>
                  <p className={`truncate text-xl font-bold tabular-nums ${pnlColor(totalPnl)}`}>
                    {pnlSign(totalPnl)}${fmt(Math.abs(totalPnl))}
                  </p>
                </div>
              </div>
            </div>

            {/* ROI */}
            <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15">
                  <BarChart3 className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-muted-foreground">ROI</p>
                  <p className={`truncate text-xl font-bold tabular-nums ${pnlColor(totalPnlPercent)}`}>
                    {pnlSign(totalPnlPercent)}{fmt(totalPnlPercent)}%
                  </p>
                </div>
              </div>
            </div>

            {/* Best Performer */}
            <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-buy-light">
                  <Trophy className="h-5 w-5 text-buy" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-muted-foreground">Best Performer</p>
                  {bestPerformer ? (
                    <div className="flex items-center gap-2">
                      <CoinIcon symbol={bestPerformer.symbol} size={18} />
                      <span className="text-sm font-semibold text-foreground">{bestPerformer.symbol}</span>
                      <span className="text-sm font-semibold tabular-nums text-buy">
                        +{fmt(bestPerformer.pnlPercent)}%
                      </span>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">—</p>
                  )}
                </div>
              </div>
            </div>

            {/* Worst Performer */}
            <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-sell-light">
                  <AlertTriangle className="h-5 w-5 text-sell" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-muted-foreground">Worst Performer</p>
                  {worstPerformer ? (
                    <div className="flex items-center gap-2">
                      <CoinIcon symbol={worstPerformer.symbol} size={18} />
                      <span className="text-sm font-semibold text-foreground">{worstPerformer.symbol}</span>
                      <span className="text-sm font-semibold tabular-nums text-sell">
                        {fmt(worstPerformer.pnlPercent)}%
                      </span>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">—</p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Per-asset table */}
          <div className="rounded-xl border border-border bg-card shadow-sm">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <h3 className="text-sm font-semibold text-foreground">P&L by Asset</h3>
              <span className="text-xs text-muted-foreground">{assets.length} asset{assets.length !== 1 ? 's' : ''}</span>
            </div>

            {/* Table header */}
            <div className="hidden border-b border-border px-5 py-3 sm:grid sm:grid-cols-[1.5fr_1fr_0.8fr_1.5fr_0.8fr_0.8fr] sm:gap-4">
              <span className="text-xs font-semibold uppercase text-muted-foreground">Asset</span>
              <button
                type="button"
                onClick={() => handleSort('pnl')}
                className={`text-right text-xs font-semibold uppercase transition-colors ${
                  sortKey === 'pnl' ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                P&L {sortKey === 'pnl' && (sortDir === 'desc' ? '↓' : '↑')}
              </button>
              <button
                type="button"
                onClick={() => handleSort('pnlPercent')}
                className={`text-right text-xs font-semibold uppercase transition-colors ${
                  sortKey === 'pnlPercent' ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                P&L % {sortKey === 'pnlPercent' && (sortDir === 'desc' ? '↓' : '↑')}
              </button>
              <span className="text-center text-xs font-semibold uppercase text-muted-foreground">Relative</span>
              <button
                type="button"
                onClick={() => handleSort('volume')}
                className={`text-right text-xs font-semibold uppercase transition-colors ${
                  sortKey === 'volume' ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Volume {sortKey === 'volume' && (sortDir === 'desc' ? '↓' : '↑')}
              </button>
              <span className="text-right text-xs font-semibold uppercase text-muted-foreground">Avg Price</span>
            </div>

            {loading ? (
              <div className="flex flex-col items-center justify-center py-16">
                <RefreshCw className="mb-3 h-7 w-7 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Loading P&L…</p>
              </div>
            ) : sortedAssets.length > 0 ? (
              <div className="divide-y divide-border">
                {sortedAssets.map((asset) => {
                  const barWidth = Math.abs(asset.pnl) / maxAbsPnl;
                  const isPositive = asset.pnl >= 0;
                  const totalVol = asset.buyVolume + asset.sellVolume;

                  return (
                    <div
                      key={asset.symbol}
                      className="flex flex-col gap-3 px-5 py-4 transition-colors hover:bg-muted/50 sm:grid sm:grid-cols-[1.5fr_1fr_0.8fr_1.5fr_0.8fr_0.8fr] sm:items-center sm:gap-4"
                    >
                      {/* Asset */}
                      <div className="flex items-center gap-3">
                        <CoinIcon symbol={asset.symbol} size={28} />
                        <div>
                          <p className="text-sm font-semibold text-foreground">{asset.symbol}</p>
                          <p className="text-xs text-muted-foreground sm:hidden">
                            Vol ${fmtCompact(totalVol)}
                          </p>
                        </div>
                      </div>

                      {/* PnL USD */}
                      <div className="flex items-center justify-between sm:justify-end">
                        <span className="text-xs text-muted-foreground sm:hidden">P&L</span>
                        <span className={`flex items-center gap-1 text-sm font-semibold tabular-nums ${pnlColor(asset.pnl)}`}>
                          {isPositive ? (
                            <TrendingUp className="h-3.5 w-3.5 shrink-0" />
                          ) : asset.pnl < 0 ? (
                            <TrendingDown className="h-3.5 w-3.5 shrink-0" />
                          ) : null}
                          {pnlSign(asset.pnl)}${fmt(Math.abs(asset.pnl))}
                        </span>
                      </div>

                      {/* PnL % */}
                      <div className="flex items-center justify-between sm:justify-end">
                        <span className="text-xs text-muted-foreground sm:hidden">P&L %</span>
                        <span
                          className={`rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums ${
                            isPositive
                              ? 'bg-buy/10 text-buy'
                              : asset.pnl < 0
                                ? 'bg-sell/10 text-sell'
                                : 'bg-muted text-muted-foreground'
                          }`}
                        >
                          {pnlSign(asset.pnlPercent)}{fmt(asset.pnlPercent)}%
                        </span>
                      </div>

                      {/* Relative bar */}
                      <div className="hidden sm:block">
                        <div className="relative h-5 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className={`absolute inset-y-0 left-0 rounded-full transition-all ${
                              isPositive ? 'bg-buy/25' : 'bg-sell/25'
                            }`}
                            style={{ width: `${(barWidth * 100).toFixed(1)}%` }}
                          />
                          <div
                            className={`absolute inset-y-0 left-0 rounded-full transition-all ${
                              isPositive ? 'bg-buy' : 'bg-sell'
                            }`}
                            style={{ width: `${(barWidth * 100).toFixed(1)}%`, opacity: 0.6 }}
                          />
                        </div>
                      </div>

                      {/* Volume */}
                      <div className="flex items-center justify-between sm:justify-end">
                        <span className="text-xs text-muted-foreground sm:hidden">Volume</span>
                        <span className="text-sm tabular-nums text-foreground">
                          ${fmtCompact(totalVol)}
                        </span>
                      </div>

                      {/* Avg Prices */}
                      <div className="flex items-center justify-between sm:justify-end">
                        <span className="text-xs text-muted-foreground sm:hidden">Avg Buy / Sell</span>
                        <div className="text-right text-xs tabular-nums">
                          <span className="text-buy">${fmt(asset.avgBuyPrice)}</span>
                          <span className="mx-1 text-muted-foreground">/</span>
                          <span className="text-sell">
                            {asset.avgSellPrice > 0 ? `$${fmt(asset.avgSellPrice)}` : '—'}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-16">
                <p className="font-medium text-muted-foreground">No assets found for this filter</p>
                {selectedSymbol !== 'all' && (
                  <button
                    type="button"
                    onClick={() => handleSymbolSelect('all')}
                    className="mt-3 text-sm font-medium text-primary hover:underline"
                  >
                    Show all symbols
                  </button>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
