'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { CoinIcon } from '@/components/ui/CoinIcon';
import {
  ArrowDown, ArrowUp, ArrowUpDown, BarChart3, Search, Star,
  TrendingUp, ChevronLeft, ChevronRight,
} from 'lucide-react';

/* ─── types ─── */
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
type SortKey = 'pair' | 'last' | 'change' | 'volume';
type SortDir = 'asc' | 'desc';

/* ─── formatters ─── */
const priceFmt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 8, minimumFractionDigits: 2 });
const volFmt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2, notation: 'compact' });

function parseNum(s: string | null | undefined): number | null {
  if (s == null || s === '') return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}
function fmtPrice(s: string | null | undefined): string {
  const n = parseNum(s);
  return n != null ? '$' + priceFmt.format(n) : '—';
}
function fmtVol(s: string | null | undefined): string {
  const n = parseNum(s);
  if (n == null) return '—';
  if (n === 0) return '$0';
  return '$' + volFmt.format(n);
}
function fmtChange(c: number | null): string {
  if (c == null) return '—';
  return (c > 0 ? '+' : '') + c.toFixed(2) + '%';
}

/* ─── coin colors & names ─── */
const COIN_META: Record<string, { color: string; name: string }> = {
  BTC: { color: '#F7931A', name: 'Bitcoin' },
  ETH: { color: '#627EEA', name: 'Ethereum' },
  BNB: { color: '#F3BA2F', name: 'BNB' },
  SOL: { color: '#9945FF', name: 'Solana' },
  XRP: { color: '#23292F', name: 'XRP' },
  ADA: { color: '#0033AD', name: 'Cardano' },
  DOGE: { color: '#C2A633', name: 'Dogecoin' },
  DOT: { color: '#E6007A', name: 'Polkadot' },
  AVAX: { color: '#E84142', name: 'Avalanche' },
  MATIC: { color: '#8247E5', name: 'Polygon' },
  LINK: { color: '#2A5ADA', name: 'Chainlink' },
  UNI: { color: '#FF007A', name: 'Uniswap' },
  ATOM: { color: '#6F7390', name: 'Cosmos' },
  LTC: { color: '#345D9D', name: 'Litecoin' },
  NEAR: { color: '#00C08B', name: 'NEAR Protocol' },
  APT: { color: '#00BCD4', name: 'Aptos' },
  ARB: { color: '#28A0F0', name: 'Arbitrum' },
  OP: { color: '#FF0420', name: 'Optimism' },
  SUI: { color: '#4DA2FF', name: 'Sui' },
  SEI: { color: '#9B1C1C', name: 'Sei' },
  USDT: { color: '#26A17B', name: 'Tether' },
  USDC: { color: '#2775CA', name: 'USD Coin' },
  DAI: { color: '#F5AC37', name: 'Dai' },
  TRX: { color: '#FF0013', name: 'TRON' },
  SHIB: { color: '#FFA409', name: 'Shiba Inu' },
  PEPE: { color: '#4B8F29', name: 'Pepe' },
  FIL: { color: '#0090FF', name: 'Filecoin' },
  ICP: { color: '#ED1E79', name: 'Internet Computer' },
  HBAR: { color: '#3A3A3A', name: 'Hedera' },
  VET: { color: '#15BDFF', name: 'VeChain' },
  WLD: { color: '#1A1A2E', name: 'Worldcoin' },
  INJ: { color: '#1DB4EF', name: 'Injective' },
  RENDER: { color: '#0099FF', name: 'Render' },
  FET: { color: '#1D2039', name: 'Fetch.ai' },
  WIF: { color: '#B8860B', name: 'dogwifhat' },
  AAVE: { color: '#B6509E', name: 'Aave' },
  MKR: { color: '#1AAB9B', name: 'Maker' },
  LDO: { color: '#00A3FF', name: 'Lido DAO' },
  IMX: { color: '#00BFFF', name: 'Immutable X' },
  FLOKI: { color: '#D4A843', name: 'Floki' },
  BONK: { color: '#F59E0B', name: 'Bonk' },
  GRT: { color: '#6747ED', name: 'The Graph' },
  AR: { color: '#222326', name: 'Arweave' },
};
function getCoinColor(s: string): string {
  return COIN_META[s.toUpperCase()]?.color || `hsl(${(s.charCodeAt(0) * 37 + s.charCodeAt(s.length - 1) * 53) % 360}, 55%, 50%)`;
}
function getCoinName(s: string): string {
  return COIN_META[s.toUpperCase()]?.name || s;
}

/* CoinIcon is imported from @/components/ui/CoinIcon */

/* ─── 7-day sparkline (wider, more realistic) ─── */
function Sparkline7D({ change }: { change: number | null }) {
  if (change == null) return <span className="text-[10px] text-muted-foreground">—</span>;
  const w = 120;
  const h = 32;
  const pts = 14;
  const isUp = change >= 0;
  const points: number[] = [];
  const base = isUp ? 0.25 : 0.75;
  for (let i = 0; i < pts; i++) {
    const t = i / (pts - 1);
    const vol = 0.12 * Math.sin(i * 0.9 + 0.5) + 0.06 * Math.cos(i * 2.1);
    const trend = isUp ? t * 0.45 : -t * 0.45;
    points.push(Math.max(0, Math.min(1, base + trend + vol)));
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const pad = 2;
  const sx = (w - pad * 2) / (pts - 1);
  const sy = (h - pad * 2) / range;
  const d = points.map((v, i) => `${i === 0 ? 'M' : 'L'} ${pad + i * sx} ${h - pad - (v - min) * sy}`).join(' ');
  const stroke = isUp ? '#0ecb81' : '#f6465d';
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0" aria-hidden>
      <path d={d} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ─── TopMoverCard ─── */
function TopMoverCard({ market, ticker }: { market: Market; ticker?: SpotTickerRow }) {
  const c: number | null = ticker?.change_pct ?? null;
  const up = c != null && c >= 0;
  return (
    <Link
      href={`/trade/spot?symbol=${encodeURIComponent(market.symbol)}`}
      className="flex-shrink-0 w-[170px] rounded-xl border border-border bg-card p-3.5 hover:border-primary/30 transition-all"
    >
      <div className="flex items-center gap-2 mb-2.5">
        <CoinIcon symbol={market.base_asset} size={28} />
        <div className="min-w-0">
          <span className="text-[13px] font-semibold text-foreground block truncate">{market.base_asset}</span>
          <span className="text-[10px] text-muted-foreground">{market.symbol.replace('_', '/')}</span>
        </div>
      </div>
      <div className="text-[13px] font-semibold text-foreground tabular-nums mb-1">{fmtPrice(ticker?.last_price)}</div>
      <div className="flex items-center justify-between">
        <span className={`text-[11px] font-semibold tabular-nums ${up ? 'text-[#0ecb81]' : 'text-[#f6465d]'}`}>
          {fmtChange(c)}
        </span>
        <Sparkline7D change={c} />
      </div>
    </Link>
  );
}

/* ─── Sortable header ─── */
function SortTh({ label, sk, active, dir, onSort, right, cls }: {
  label: string; sk: SortKey; active: SortKey; dir: SortDir;
  onSort: (k: SortKey) => void; right?: boolean; cls?: string;
}) {
  const on = active === sk;
  const Ic = !on ? ArrowUpDown : dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th className={`py-2.5 px-4 font-normal text-xs text-muted-foreground ${right ? 'text-right' : 'text-left'} ${cls ?? ''}`}>
      <button type="button" onClick={() => onSort(sk)}
        className={`inline-flex items-center gap-0.5 hover:text-foreground transition-colors ${right ? 'flex-row-reverse' : ''}`}>
        {label}
        <Ic className={`h-3 w-3 ${on ? 'text-primary' : 'opacity-30'}`} />
      </button>
    </th>
  );
}

/* ─── Skeleton ─── */
function Skeleton() {
  return (
    <div>
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3 border-b border-border/40">
          <span className="h-3 w-3 rounded-full bg-muted animate-pulse" />
          <span className="h-3 w-4 bg-muted rounded animate-pulse" />
          <span className="h-6 w-6 bg-muted rounded-full animate-pulse" />
          <span className="h-3 w-24 bg-muted rounded animate-pulse" />
          <span className="h-3 w-16 bg-muted rounded animate-pulse ml-auto" />
          <span className="h-4 w-14 bg-muted rounded animate-pulse" />
          <span className="h-3 w-16 bg-muted rounded animate-pulse hidden sm:block" />
          <span className="h-3 w-16 bg-muted rounded animate-pulse hidden md:block" />
          <span className="h-5 w-20 bg-muted rounded animate-pulse hidden lg:block" />
        </div>
      ))}
    </div>
  );
}

/* ─── tabs ─── */
const MAIN_TABS = ['Favorites', 'Spot', 'New'] as const;
type MainTab = (typeof MAIN_TABS)[number];

/* ─── category pills ─── */
const CATEGORIES = ['All', 'DeFi', 'AI', 'Meme', 'Layer 1', 'Layer 2', 'GameFi', 'Payments', 'NFT'] as const;

/* ============================== */
/*        MAIN COMPONENT         */
/* ============================== */
export default function MarketsPage() {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [tickersBySymbol, setTickersBySymbol] = useState<Map<string, SpotTickerRow>>(() => new Map());
  const [search, setSearch] = useState('');
  const [quoteFilter, setQuoteFilter] = useState<string>('all');
  const [activeTab, setActiveTab] = useState<MainTab>('Spot');
  const [activeCat, setActiveCat] = useState<string>('All');
  const [sortKey, setSortKey] = useState<SortKey>('volume');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const prevRef = useRef<Map<string, string>>(new Map());
  const [flashes, setFlashes] = useState<Map<string, 'up' | 'down'>>(() => new Map());
  const scrollRef = useRef<HTMLDivElement>(null);
  const pillsRef = useRef<HTMLDivElement>(null);

  const [favorites, setFavorites] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try { return new Set(JSON.parse(localStorage.getItem('market-favorites') || '[]')); } catch { return new Set(); }
  });
  const toggleFav = (sym: string) => {
    setFavorites(p => {
      const n = new Set(p);
      n.has(sym) ? n.delete(sym) : n.add(sym);
      try { localStorage.setItem('market-favorites', JSON.stringify(Array.from(n))); } catch {}
      return n;
    });
  };

  /* fetch — public endpoints, no auth required */
  const refreshTickers = useCallback(async () => {
    try {
      const r = await api.get<SpotTickerRow[]>('/api/v1/spot/tickers', { skipAuth: true, notifyOnError: false });
      if (r.success && Array.isArray(r.data)) setTickersBySymbol(new Map(r.data.map(t => [t.symbol, t])));
    } catch {}
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true); setFetchError(null);
    try {
      const [m, t] = await Promise.all([
        api.get<Market[]>('/api/v1/spot/markets', { skipAuth: true, notifyOnError: false }),
        api.get<SpotTickerRow[]>('/api/v1/spot/tickers', { skipAuth: true, notifyOnError: false }),
      ]);
      if (m.success && Array.isArray(m.data)) setMarkets(m.data);
      else { setMarkets([]); setFetchError(m.error?.message ?? 'Failed'); }
      if (t.success && Array.isArray(t.data)) setTickersBySymbol(new Map(t.data.map(x => [x.symbol, x])));
    } catch { setFetchError('Network error'); } finally { setLoading(false); }
  }, []);

  useEffect(() => { void fetchAll(); }, [fetchAll]);
  useEffect(() => { const id = setInterval(() => void refreshTickers(), 12_000); return () => clearInterval(id); }, [refreshTickers]);

  /* price flash */
  useEffect(() => {
    const prev = prevRef.current;
    const fl = new Map<string, 'up' | 'down'>();
    tickersBySymbol.forEach((t, s) => {
      const p = t.last_price ?? '';
      const o = prev.get(s);
      if (o && o !== '' && p !== '' && o !== p) {
        const a = parseFloat(o), b = parseFloat(p);
        if (Number.isFinite(a) && Number.isFinite(b)) fl.set(s, b > a ? 'up' : 'down');
      }
    });
    tickersBySymbol.forEach((t, s) => prev.set(s, t.last_price ?? ''));
    if (!fl.size) return;
    setFlashes(fl);
    const id = setTimeout(() => setFlashes(new Map()), 900);
    return () => clearTimeout(id);
  }, [tickersBySymbol]);

  /* derived */
  const quoteOptions = useMemo(() => Array.from(new Set(markets.map(m => m.quote_asset).filter(Boolean))).sort(), [markets]);

  const topMovers = useMemo(() =>
    [...markets]
      .filter(m => { const t = tickersBySymbol.get(m.symbol); return t?.change_pct != null && t.last_price != null; })
      .sort((a, b) => Math.abs(tickersBySymbol.get(b.symbol)?.change_pct ?? 0) - Math.abs(tickersBySymbol.get(a.symbol)?.change_pct ?? 0))
      .slice(0, 15),
    [markets, tickersBySymbol]);

  const filtered = useMemo(() => {
    let rows = markets;
    if (activeTab === 'Favorites') rows = rows.filter(m => favorites.has(m.symbol));
    if (activeTab === 'New') rows = [...rows].reverse().slice(0, 20);
    const q = search.trim().toLowerCase();
    if (q) rows = rows.filter(m => m.symbol.toLowerCase().includes(q) || m.base_asset.toLowerCase().includes(q) || m.quote_asset.toLowerCase().includes(q));
    if (quoteFilter !== 'all') rows = rows.filter(m => m.quote_asset === quoteFilter);
    return rows;
  }, [markets, search, quoteFilter, activeTab, favorites]);

  const handleSort = useCallback((key: SortKey) => {
    setSortKey(p => { if (p === key) { setSortDir(d => d === 'asc' ? 'desc' : 'asc'); return p; } setSortDir(key === 'pair' ? 'asc' : 'desc'); return key; });
  }, []);

  const sorted = useMemo(() => {
    const rows = [...filtered];
    const mul = sortDir === 'asc' ? 1 : -1;
    const t = (s: string) => tickersBySymbol.get(s);
    rows.sort((a, b) => {
      const ta = t(a.symbol), tb = t(b.symbol);
      switch (sortKey) {
        case 'pair': return mul * a.symbol.localeCompare(b.symbol);
        case 'last': return mul * ((parseNum(ta?.last_price) ?? -Infinity) - (parseNum(tb?.last_price) ?? -Infinity));
        case 'change': {
          const aN = ta?.change_pct != null ? ta.change_pct : -Infinity;
          const bN = tb?.change_pct != null ? tb.change_pct : -Infinity;
          return mul * (aN - bN);
        }
        case 'volume': return mul * ((parseNum(ta?.volume_24h) ?? -Infinity) - (parseNum(tb?.volume_24h) ?? -Infinity));
        default: return 0;
      }
    });
    return rows;
  }, [filtered, sortKey, sortDir, tickersBySymbol]);

  const scroll = (ref: React.RefObject<HTMLDivElement | null>, d: number) =>
    ref.current?.scrollBy({ left: d, behavior: 'smooth' });

  /* ─── render ─── */
  return (
    <div className="min-h-screen bg-background text-foreground">

      {/* ====== SECTION 1: Top Movers Strip ====== */}
      {!loading && topMovers.length > 0 && (
        <section className="border-b border-border">
          <div className="max-w-[1280px] mx-auto px-4 sm:px-6 py-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-primary" />
                <span className="text-sm font-semibold text-foreground">Trending</span>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => scroll(scrollRef, -220)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button onClick={() => scroll(scrollRef, 220)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div ref={scrollRef} className="flex gap-3 overflow-x-auto scrollbar-none" style={{ scrollbarWidth: 'none' }}>
              {topMovers.map(m => <TopMoverCard key={m.id} market={m} ticker={tickersBySymbol.get(m.symbol)} />)}
            </div>
          </div>
        </section>
      )}

      {/* ====== MAIN CONTENT ====== */}
      <div className="max-w-[1280px] mx-auto px-4 sm:px-6 pt-6 pb-10">

        {/* ====== SECTION 2: Title ====== */}
        <h1 className="text-2xl font-bold text-foreground mb-5">Markets Overview</h1>

        {/* ====== SECTION 3: Main Tabs ====== */}
        <div className="flex items-center gap-0.5 border-b border-border mb-0">
          {MAIN_TABS.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`relative px-5 py-3 text-sm font-medium transition-colors whitespace-nowrap ${
                activeTab === tab
                  ? 'text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab === 'Favorites' && (
                <Star className={`inline h-3.5 w-3.5 mr-1 -mt-0.5 ${activeTab === tab ? 'fill-primary' : ''}`} />
              )}
              {tab}
              {tab === 'Favorites' && favorites.size > 0 && (
                <span className="ml-1 text-[11px] opacity-60">({favorites.size})</span>
              )}
              {activeTab === tab && (
                <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-primary rounded-full" />
              )}
            </button>
          ))}
        </div>

        {/* ====== SECTION 4: Category Pills ====== */}
        <div className="flex items-center gap-1 py-3 overflow-x-auto scrollbar-none" style={{ scrollbarWidth: 'none' }} ref={pillsRef}>
          {CATEGORIES.map(c => (
            <button
              key={c}
              onClick={() => setActiveCat(c)}
              className={`px-3 py-1 text-xs font-medium rounded-md whitespace-nowrap transition-colors ${
                activeCat === c
                  ? 'bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        {/* ====== SECTION 5: Quote Tabs + Search ====== */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between py-2 border-b border-border/60 mb-1">
          {/* Quote tabs */}
          <div className="flex items-center gap-0.5 overflow-x-auto scrollbar-none" style={{ scrollbarWidth: 'none' }}>
            <button
              onClick={() => setQuoteFilter('all')}
              className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${quoteFilter === 'all' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >All</button>
            {quoteOptions.map(q => (
              <button
                key={q}
                onClick={() => setQuoteFilter(q)}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${quoteFilter === q ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >{q}</button>
            ))}
          </div>
          {/* Search */}
          <div className="relative shrink-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              placeholder="Search coin name"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8 pr-3 h-8 w-44 sm:w-52 bg-muted/40 border border-border rounded-lg text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/40 transition-colors"
            />
          </div>
        </div>

        {/* ====== SECTION 6: Section Label ====== */}
        <div className="flex items-center gap-2 py-2 px-1">
          <span className="text-xs text-muted-foreground">
            {activeTab === 'Favorites' ? 'Your Favorites' : 'Top Tokens by Market Capitalization'}
          </span>
          {!loading && (
            <span className="text-[10px] text-muted-foreground/50 tabular-nums">
              {sorted.length} {sorted.length === 1 ? 'pair' : 'pairs'}
            </span>
          )}
        </div>

        {/* ====== SECTION 7: Market Table ====== */}
        <div className="rounded-xl border border-border overflow-hidden">
          {loading ? <Skeleton /> : fetchError ? (
            <div className="p-8"><ErrorState title="Could not load markets" message={fetchError} onRetry={() => void fetchAll()} /></div>
          ) : sorted.length === 0 ? (
            <div className="py-16">
              <EmptyState
                icon={activeTab === 'Favorites' ? Star : BarChart3}
                title={activeTab === 'Favorites' ? 'No favorites yet' : 'No markets found'}
                description={activeTab === 'Favorites' ? 'Star pairs to see them here.' : 'Try different filters.'}
                action={activeTab !== 'Favorites' && !search.trim() && quoteFilter === 'all' ? { label: 'Go to Spot', href: '/trade/spot' } : undefined}
              />
              {activeTab === 'Favorites' && (
                <div className="flex justify-center mt-1">
                  <button onClick={() => setActiveTab('Spot')} className="text-xs text-primary hover:underline">Browse All</button>
                </div>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[820px]">
                <thead>
                  <tr className="border-b border-border">
                    <th className="py-2.5 px-3 w-9" />
                    <th className="py-2.5 px-2 w-8 text-left text-xs font-normal text-muted-foreground">#</th>
                    <SortTh label="Name" sk="pair" active={sortKey} dir={sortDir} onSort={handleSort} cls="min-w-[200px]" />
                    <SortTh label="Price" sk="last" active={sortKey} dir={sortDir} onSort={handleSort} right />
                    <SortTh label="24h Change" sk="change" active={sortKey} dir={sortDir} onSort={handleSort} right />
                    <SortTh label="24h Volume" sk="volume" active={sortKey} dir={sortDir} onSort={handleSort} right />
                    <th className="py-2.5 px-4 text-xs font-normal text-muted-foreground text-center hidden lg:table-cell">Last 7 Days</th>
                    <th className="py-2.5 px-4 text-right text-xs font-normal text-muted-foreground w-24">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((m, i) => {
                    const t = tickersBySymbol.get(m.symbol);
                    const c = t?.change_pct;
                    const up = c != null && c > 0;
                    const down = c != null && c < 0;
                    const fl = flashes.get(m.symbol);
                    const fav = favorites.has(m.symbol);
                    return (
                      <tr
                        key={m.id}
                        className={`border-b border-border/40 transition-[background-color] duration-300 hover:bg-muted/30 ${
                          fl === 'up' ? 'bg-[#0ecb81]/[0.04]' : fl === 'down' ? 'bg-[#f6465d]/[0.04]' : ''
                        }`}
                      >
                        {/* star */}
                        <td className="py-3 px-3 w-9">
                          <button onClick={e => { e.stopPropagation(); toggleFav(m.symbol); }}>
                            <Star className={`h-3.5 w-3.5 transition-colors ${fav ? 'fill-primary text-primary' : 'text-muted-foreground/30 hover:text-primary/50'}`} />
                          </button>
                        </td>
                        {/* # */}
                        <td className="py-3 px-2 w-8 text-xs text-muted-foreground tabular-nums">{i + 1}</td>
                        {/* Name */}
                        <td className="py-3 px-4">
                          <Link href={`/trade/spot?symbol=${encodeURIComponent(m.symbol)}`} className="flex items-center gap-3 group">
                            <CoinIcon symbol={m.base_asset} size={28} />
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[13px] font-semibold text-foreground group-hover:text-primary transition-colors">{m.base_asset}</span>
                                <span className="text-[11px] text-muted-foreground/50 hidden sm:inline">{getCoinName(m.base_asset)}</span>
                              </div>
                              <span className="text-[10px] text-muted-foreground">{m.symbol.replace('_', '/')}</span>
                            </div>
                          </Link>
                        </td>
                        {/* Price */}
                        <td className={`py-3 px-4 text-right tabular-nums text-[13px] font-medium transition-colors duration-300 ${
                          fl === 'up' ? 'text-[#0ecb81]' : fl === 'down' ? 'text-[#f6465d]' : 'text-foreground'
                        }`}>
                          {fmtPrice(t?.last_price)}
                        </td>
                        {/* 24h change */}
                        <td className="py-3 px-4 text-right">
                          {c != null ? (
                            <span className={`inline-block min-w-[64px] text-center px-2 py-0.5 rounded text-xs font-semibold tabular-nums ${
                              up ? 'bg-[#0ecb81]/10 text-[#0ecb81]' : down ? 'bg-[#f6465d]/10 text-[#f6465d]' : 'text-muted-foreground'
                            }`}>
                              {fmtChange(c)}
                            </span>
                          ) : <span className="text-xs text-muted-foreground">—</span>}
                        </td>
                        {/* volume */}
                        <td className="py-3 px-4 text-right tabular-nums text-xs text-muted-foreground">{fmtVol(t?.volume_24h)}</td>
                        {/* 7d chart */}
                        <td className="py-3 px-4 text-center hidden lg:table-cell">
                          <div className="flex justify-center"><Sparkline7D change={c ?? null} /></div>
                        </td>
                        {/* action */}
                        <td className="py-3 px-4 text-right">
                          <Link
                            href={`/trade/spot?symbol=${encodeURIComponent(m.symbol)}`}
                            className="inline-flex items-center justify-center h-7 px-3.5 rounded text-[11px] font-semibold bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground transition-all"
                          >
                            Trade
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
