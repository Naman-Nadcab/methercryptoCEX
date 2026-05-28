'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {
  ArrowRight,
  Shield,
  Users,
  ChevronUp,
  ChevronDown,
  RefreshCw,
  BarChart3,
  TrendingUp,
  Zap,
  Globe,
  Lock,
  X,
  Menu,
} from 'lucide-react';
import ThemeToggle from '@/components/ThemeToggle';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { useAuthStore } from '@/store/auth';
import { ROUTES, walletPath, SPOT_TRADE_HREF, tradeSpotWithSymbol } from '@/lib/routes';

/* ─── Constants ──────────────────────────────────────────────── */

const NAV_LINKS = (spotHref: string) => [
  { label: 'Buy Crypto', href: walletPath.convert },
  { label: 'Markets', href: ROUTES.markets },
  { label: 'Trade', href: spotHref },
  { label: 'P2P', href: ROUTES.p2p },
];

const FOOTER_PRODUCTS = (spotHref: string) => [
  { label: 'Spot Trading', href: spotHref },
  { label: 'P2P Trading', href: ROUTES.p2p },
  { label: 'Markets', href: ROUTES.markets },
  { label: 'Buy Crypto', href: walletPath.convert },
];

const FOOTER_SUPPORT = [
  { label: 'Help Center', href: ROUTES.dashboard.help },
  { label: 'Fees', href: ROUTES.dashboard.feeRates },
  { label: 'API', href: ROUTES.dashboard.api },
];

const FOOTER_LEGAL = [
  { label: 'Terms of Use', href: ROUTES.terms },
  { label: 'Privacy Policy', href: ROUTES.privacy },
  { label: 'Risk Warning', href: ROUTES.terms },
];

/* ─── Data Hooks ─────────────────────────────────────────────── */

interface MarketPrice {
  base_symbol: string;
  price: string;
  change_24h_percent: string;
  base_logo?: string;
}

function useMarketPrices() {
  const [tickers, setTickers] = useState<MarketPrice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    const apiUrl = getApiBaseUrl();
    setLoading(true);
    setError(null);
    fetch(`${apiUrl}/api/v1/convert/market-prices`)
      .then(async (res) => {
        const json = (await res.json().catch(() => null)) as {
          success?: boolean;
          data?: unknown;
          error?: { message?: string };
        } | null;
        if (!res.ok) throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
        return json;
      })
      .then((json) => {
        if (json?.success && Array.isArray(json?.data) && json.data.length > 0) {
          const list = json.data
            .slice(0, 6)
            .map((row: { base_symbol: string; price: string; change_24h_percent: string; base_logo?: string }) => ({
              base_symbol: row.base_symbol,
              price: Number(row.price).toLocaleString('en-US', { maximumFractionDigits: 2 }),
              change_24h_percent: String(row.change_24h_percent ?? '0'),
              base_logo: row.base_logo,
            }));
          setTickers(list);
        } else {
          setTickers([]);
          setError(json?.error?.message ?? 'No live prices returned');
        }
      })
      .catch((e) => {
        setTickers([]);
        setError(e instanceof Error ? e.message : 'Could not load prices');
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);
  return { tickers, loading, error, retry: load };
}

type SpotPreviewRow = { symbol: string; base_asset: string; quote_asset: string };

function formatCompactNotional(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—';
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(n);
}

function useHomeSpotSummary() {
  const [preview, setPreview] = useState<SpotPreviewRow[]>([]);
  const [marketCount, setMarketCount] = useState<number | null>(null);
  const [volume24hQuote, setVolume24hQuote] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    const apiUrl = getApiBaseUrl();
    setLoading(true);
    setError(null);
    Promise.all([fetch(`${apiUrl}/api/v1/spot/markets`), fetch(`${apiUrl}/api/v1/spot/tickers`)])
      .then(async ([mr, tr]) => {
        const mJson = (await mr.json().catch(() => null)) as {
          success?: boolean;
          data?: { symbol: string; base_asset: string; quote_asset: string }[];
        } | null;
        const tJson = (await tr.json().catch(() => null)) as {
          success?: boolean;
          data?: { volume_24h?: string }[];
        } | null;
        if (mJson?.success && Array.isArray(mJson.data)) {
          setMarketCount(mJson.data.length);
          setPreview(mJson.data.slice(0, 8).map((row) => ({
            symbol: row.symbol,
            base_asset: row.base_asset,
            quote_asset: row.quote_asset,
          })));
        } else {
          setPreview([]);
          setMarketCount(0);
        }
        if (tJson?.success && Array.isArray(tJson.data)) {
          let sum = 0;
          for (const row of tJson.data) {
            const v = parseFloat(String(row.volume_24h ?? '0'));
            if (Number.isFinite(v)) sum += v;
          }
          setVolume24hQuote(sum);
        } else {
          setVolume24hQuote(null);
        }
      })
      .catch(() => {
        setError('Could not load spot market stats');
        setPreview([]);
        setMarketCount(null);
        setVolume24hQuote(null);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);
  return { preview, marketCount, volume24hQuote, loading, error, retry: load };
}

/* ─── Scroll Reveal ──────────────────────────────────────────── */

function useScrollReveal() {
  const ref = useRef<HTMLElement | null>(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setRevealed(true); observer.disconnect(); } },
      { threshold: 0.1, rootMargin: '0px 0px -40px 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { ref, revealed };
}

function RevealSection({ children, className = '', delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const { ref, revealed } = useScrollReveal();
  return (
    <section
      ref={ref as React.RefObject<HTMLElement>}
      className={`will-change-[transform,opacity] transition-all duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] ${revealed ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'} ${className}`}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </section>
  );
}

/* ─── Helpers ────────────────────────────────────────────────── */

function logoUrl(symbol: string) {
  return `/assets/upload/currency-logo/${symbol.toLowerCase()}.svg`;
}

function HeroTickerSkeleton() {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-border/50 bg-card/40 p-4 animate-pulse">
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 rounded-xl bg-muted/60" />
        <div className="h-4 w-14 rounded bg-muted/60" />
      </div>
      <div className="flex flex-col items-end gap-2">
        <div className="h-4 w-16 rounded bg-muted/60" />
        <div className="h-3 w-11 rounded bg-muted/60" />
      </div>
    </div>
  );
}

/* ─── Promo Banner ───────────────────────────────────────────── */

function PromoBanner({ spotHref }: { spotHref: string }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div className="relative z-40 flex h-11 w-full items-center overflow-hidden border-b border-primary/10 bg-gradient-to-r from-primary/[0.08] via-transparent to-primary/[0.08]">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_50%,_hsl(var(--primary)/0.06)_0%,_transparent_70%)]" />
      <div className="container relative mx-auto flex h-full max-w-[1400px] items-center justify-between gap-4 px-4 lg:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="shrink-0 rounded-[4px] bg-primary/15 px-1.5 py-px text-[10px] font-bold uppercase tracking-wider text-primary">
            New
          </span>
          <p className="min-w-0 truncate text-[13px] leading-none text-muted-foreground">
            <span className="mr-1">🔥</span>
            <span className="font-medium text-foreground">Zero Fee Week</span>
            <span className="hidden sm:inline"> — Trade Spot &amp; P2P with 0% fees</span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href={spotHref}
            className="group inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1 text-[11px] font-semibold text-primary-foreground transition-all duration-200 hover:shadow-[0_0_16px_hsl(var(--primary)/0.3)]"
          >
            Trade Now
            <ArrowRight className="h-3 w-3 transition-transform duration-200 group-hover:translate-x-px" />
          </Link>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="rounded-md p-1 text-muted-foreground/60 transition-colors duration-150 hover:bg-muted hover:text-foreground"
            aria-label="Dismiss banner"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Mobile Nav Drawer ──────────────────────────────────────── */

function MobileNav({ spotHref, open, onClose }: { spotHref: string; open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <>
      <div className="fixed inset-0 z-[60] bg-background/60 backdrop-blur-sm" onClick={onClose} />
      <nav className="fixed right-0 top-0 z-[61] flex h-full w-72 flex-col border-l border-border bg-card p-8 shadow-2xl">
        <button type="button" onClick={onClose} className="mb-8 self-end rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close">
          <X className="h-5 w-5" />
        </button>
        {NAV_LINKS(spotHref).map((link) => (
          <Link
            key={link.href}
            href={link.href}
            onClick={onClose}
            className="rounded-xl px-4 py-3 text-[15px] font-medium text-foreground transition-colors hover:bg-muted"
          >
            {link.label}
          </Link>
        ))}
        <div className="mt-auto flex flex-col gap-3 pt-8">
          <Link href={ROUTES.login} onClick={onClose} className="rounded-xl border border-border px-5 py-3 text-center text-sm font-semibold text-foreground transition-colors hover:bg-muted">
            Log in
          </Link>
          <Link href={ROUTES.signup} onClick={onClose} className="rounded-xl bg-primary px-5 py-3 text-center text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90">
            Sign up
          </Link>
        </div>
      </nav>
    </>
  );
}

/* ─── Main Page ──────────────────────────────────────────────── */

export default function HomePage() {
  const { tickers, loading: tickersLoading, error: tickersError, retry: retryTickers } = useMarketPrices();
  const spotSummary = useHomeSpotSummary();
  const { accessToken, _hasHydrated } = useAuthStore();
  const spotHref = _hasHydrated && accessToken ? SPOT_TRADE_HREF : ROUTES.spotLegacy;
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [renderExtendedContent, setRenderExtendedContent] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setRenderExtendedContent(true), 450);
    return () => window.clearTimeout(t);
  }, []);

  const features = useMemo(() => [
    {
      icon: BarChart3,
      title: 'Spot Trading',
      description: 'Deep liquidity, real-time order books, and tight spreads across 35+ trading pairs. Execute market, limit, and stop orders with sub-second matching.',
      href: spotHref,
      cta: 'Trade Spot',
      gradient: 'from-blue-500/10 to-cyan-500/5',
      featured: true,
    },
    {
      icon: Users,
      title: 'P2P Marketplace',
      description: 'Buy and sell with peers using local payment methods and escrow-backed settlement.',
      href: ROUTES.p2p,
      cta: 'Open P2P',
      gradient: 'from-purple-500/10 to-pink-500/5',
      featured: false,
    },
    {
      icon: Shield,
      title: 'Security First',
      description: 'Cold storage, encryption, and monitoring designed to protect your assets.',
      href: ROUTES.dashboard.security,
      cta: 'Security Center',
      gradient: 'from-emerald-500/10 to-teal-500/5',
      featured: false,
    },
  ] as const, [spotHref]);

  const stats = useMemo(() => [
    { label: 'Active Markets', value: spotSummary.marketCount != null ? String(spotSummary.marketCount) : '—', icon: Globe, large: true },
    {
      label: '24h Volume',
      value: spotSummary.volume24hQuote != null && spotSummary.volume24hQuote > 0
        ? `$${formatCompactNotional(spotSummary.volume24hQuote)}`
        : '—',
      icon: TrendingUp,
      large: true,
    },
    { label: 'Trading Modes', value: 'Spot & P2P', icon: Zap, large: false },
    { label: 'Cold Storage', value: '95%+', icon: Lock, large: false },
  ], [spotSummary.marketCount, spotSummary.volume24hQuote]);

  return (
    <div className="min-h-screen bg-background antialiased" style={{ scrollBehavior: 'smooth' }}>
      {/* ─── Navbar ─── */}
      <header className="fixed top-0 left-0 right-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-xl backdrop-saturate-150">
        <div className="container mx-auto flex h-16 max-w-[1400px] items-center justify-between px-4 lg:px-8">
          <Link href={ROUTES.home} className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary font-display text-sm font-bold text-primary-foreground shadow-sm shadow-primary/20">
              M
            </div>
            <span className="hidden font-display text-lg font-bold tracking-tight text-foreground sm:inline">
              Methereum
            </span>
          </Link>

          <nav className="hidden items-center gap-1 lg:flex">
            {NAV_LINKS(spotHref).map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors duration-150 hover:bg-muted/80 hover:text-foreground"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <ThemeToggle variant="icon" size="sm" />
            <Link
              href={ROUTES.login}
              className="hidden rounded-lg border border-border/70 px-5 py-2 text-sm font-semibold text-foreground transition-all duration-150 hover:border-border hover:bg-muted sm:inline-flex"
            >
              Log in
            </Link>
            <Link
              href={ROUTES.signup}
              className="inline-flex items-center justify-center rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground shadow-sm shadow-primary/20 transition-all duration-150 hover:bg-primary/90 hover:shadow-[0_0_20px_hsl(var(--primary)/0.25)]"
            >
              Sign up
            </Link>
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:hidden"
              aria-label="Menu"
            >
              <Menu className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>
      <MobileNav spotHref={spotHref} open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />

      {/* ─── Promo Banner ─── */}
      <div className="pt-16">
        <PromoBanner spotHref={spotHref} />
      </div>

      {/* ─── Hero ─── */}
      <section className="relative overflow-hidden border-b border-border/60 bg-background px-4 pb-20 pt-12 sm:pb-24 sm:pt-16 lg:px-8 lg:pb-32 lg:pt-20">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          {/* Multi-layer ambient lighting */}
          <div className="absolute -left-40 -top-40 h-[600px] w-[600px] animate-[home-glow-pulse_10s_ease-in-out_infinite] rounded-full bg-primary/[0.06] blur-[140px]" />
          <div className="absolute -right-20 top-1/4 h-[500px] w-[500px] animate-[home-glow-pulse_12s_ease-in-out_infinite_2s] rounded-full bg-blue-500/[0.05] blur-[120px]" />
          <div className="absolute bottom-0 left-1/2 h-[400px] w-[400px] animate-[home-glow-pulse_14s_ease-in-out_infinite_4s] rounded-full bg-purple-500/[0.03] blur-[100px]" />
          {/* Dot grid */}
          <div
            className="absolute inset-0 opacity-[0.025]"
            style={{
              backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.15) 1px, transparent 1px)',
              backgroundSize: '32px 32px',
            }}
          />
          {/* Radial vignette from center */}
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_20%,_transparent_0%,_hsl(var(--background))_80%)]" />
        </div>

        <div className="container relative mx-auto max-w-[1400px]">
          <div className="grid items-start gap-12 lg:grid-cols-[1fr_460px] lg:gap-20">
            {/* Left */}
            <div className="max-w-xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/[0.06] px-4 py-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">Methereum Exchange</span>
              </div>
              <h1 className="mt-7 font-display text-[32px] font-bold leading-[1.15] tracking-tight text-foreground sm:text-[40px] lg:text-[50px]">
                Trade spot &amp; P2P
                <br />
                <span className="bg-gradient-to-r from-primary via-yellow-400 to-primary bg-clip-text text-transparent">
                  with confidence
                </span>
              </h1>
              <p className="mt-6 text-base leading-relaxed text-muted-foreground sm:text-lg lg:text-xl">
                Professional tools, strong security, and a streamlined path from first deposit to live markets.
              </p>
              <div className="mt-10 flex flex-wrap gap-4">
                <Link
                  href={ROUTES.signup}
                  className="group inline-flex items-center justify-center gap-2.5 rounded-xl bg-primary px-8 py-3.5 text-[15px] font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-all duration-200 hover:bg-primary/90 hover:shadow-[0_4px_32px_hsl(var(--primary)/0.35)] active:scale-[0.98]"
                >
                  Start Trading
                  <ArrowRight className="h-4.5 w-4.5 transition-transform duration-200 group-hover:translate-x-0.5" />
                </Link>
                <Link
                  href={ROUTES.markets}
                  className="inline-flex items-center justify-center gap-2.5 rounded-xl border border-border/70 bg-background px-8 py-3.5 text-[15px] font-semibold text-foreground shadow-sm transition-all duration-200 hover:border-border hover:bg-muted hover:shadow-md active:scale-[0.98]"
                >
                  View Markets
                </Link>
              </div>
              <div className="mt-12 flex flex-wrap items-center gap-x-6 gap-y-3 text-[13px] text-muted-foreground">
                {[
                  { icon: Shield, text: 'Cold Storage Protected' },
                  { icon: Lock, text: 'End-to-End Encrypted' },
                  { icon: Zap, text: 'Sub-Second Execution' },
                ].map(({ icon: Icon, text }) => (
                  <span key={text} className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-primary/70" />
                    {text}
                  </span>
                ))}
              </div>
            </div>

            {/* Right: prices — gradient border glow */}
            <div className="relative rounded-2xl p-px shadow-xl shadow-primary/[0.04] lg:mt-4">
              <div className="absolute -inset-px rounded-2xl bg-gradient-to-b from-primary/20 via-border/30 to-border/10 opacity-60 transition-opacity duration-500 hover:opacity-100" />
              <div className="relative rounded-2xl bg-card/80 p-6 backdrop-blur-md sm:p-8">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-base font-semibold text-foreground">Reference Prices</p>
                  <p className="mt-1 text-sm text-muted-foreground">Live data from markets</p>
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 shadow-sm">
                  <TrendingUp className="h-5 w-5 text-primary" />
                </div>
              </div>
              <div className="mt-6">
                {tickersLoading ? (
                  <div className="grid grid-cols-2 gap-3">
                    {Array.from({ length: 6 }).map((_, i) => <HeroTickerSkeleton key={i} />)}
                  </div>
                ) : tickersError ? (
                  <div className="rounded-2xl border border-border/50 bg-muted/20 px-6 py-8 text-center">
                    <p className="text-sm text-muted-foreground">{tickersError}</p>
                    <button
                      type="button"
                      onClick={() => retryTickers()}
                      className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-primary transition-colors hover:underline"
                    >
                      <RefreshCw className="h-4 w-4" />
                      Retry
                    </button>
                  </div>
                ) : tickers.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    No live prices.{' '}
                    <Link href={ROUTES.markets} className="font-medium text-primary hover:underline">Browse markets</Link>
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    {tickers.map((t) => {
                      const change = parseFloat(t.change_24h_percent);
                      const up = change >= 0;
                      return (
                        <Link
                          key={t.base_symbol}
                          href={ROUTES.markets}
                          className="group flex items-center justify-between rounded-2xl border border-border/40 bg-background/40 p-4 transition-all duration-200 hover:border-primary/25 hover:bg-muted/25 hover:shadow-sm"
                        >
                          <div className="flex items-center gap-2.5">
                            <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-xl bg-muted/60 shadow-sm">
                              <Image
                                src={logoUrl(t.base_symbol)}
                                alt=""
                                width={20}
                                height={20}
                                className="object-contain"
                                loading="lazy"
                                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                              />
                            </div>
                            <span className="text-[13px] font-semibold text-foreground">{t.base_symbol}</span>
                          </div>
                          <div className="flex flex-col items-end">
                            <span className="text-[13px] font-semibold tabular-nums text-foreground">${t.price}</span>
                            <span className={`flex items-center gap-px text-[11px] font-semibold tabular-nums ${up ? 'text-buy' : 'text-sell'}`}>
                              {up ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                              {t.change_24h_percent}%
                            </span>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {renderExtendedContent ? (
        <>
      {/* ─── Built for Every Trader ─── */}
      <RevealSection className="border-b border-border/60 bg-card/40 px-4 py-20 sm:py-24 lg:px-8">
        <div className="container mx-auto max-w-[1400px]">
          <div className="max-w-2xl">
            <h2 className="font-display text-[26px] font-bold text-foreground sm:text-[32px]">Built for every trader</h2>
            <p className="mt-3 text-base text-muted-foreground sm:text-lg">
              Spot execution, peer-to-peer flexibility, and institutional-grade safeguards in one platform.
            </p>
          </div>
          {/* Bento grid: asymmetric layout for visual hierarchy */}
          <div className="mt-14 grid gap-6 lg:grid-cols-5 lg:grid-rows-2 lg:gap-7">
            {features.map((item) => (
              <Link
                key={item.title}
                href={item.href}
                className={`group relative flex flex-col overflow-hidden rounded-2xl border border-border/50 bg-background transition-all duration-400 will-change-transform hover:border-primary/30 ${
                  item.featured
                    ? 'lg:col-span-3 lg:row-span-2 min-h-[340px] p-8 sm:p-10 shadow-md hover:shadow-[0_12px_48px_hsl(var(--primary)/0.1)] hover:scale-[1.01]'
                    : 'lg:col-span-2 min-h-[180px] p-8 shadow-sm hover:shadow-[0_8px_36px_hsl(var(--primary)/0.07)] hover:scale-[1.02]'
                }`}
              >
                {/* Gradient overlay */}
                <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${item.gradient} opacity-0 transition-opacity duration-400 group-hover:opacity-100`} />
                {/* Ambient corner glow */}
                <div className={`pointer-events-none absolute rounded-full blur-[60px] transition-all duration-500 ${
                  item.featured
                    ? '-right-20 -top-20 h-40 w-40 bg-primary/[0.06] group-hover:bg-primary/[0.12]'
                    : '-right-12 -top-12 h-24 w-24 bg-primary/[0.04] group-hover:bg-primary/[0.08]'
                }`} />
                <div className="relative flex flex-1 flex-col">
                  <div className={`flex items-center justify-center rounded-xl shadow-sm transition-all duration-300 group-hover:bg-primary/10 group-hover:shadow-[0_0_20px_hsl(var(--primary)/0.1)] ${
                    item.featured ? 'h-14 w-14 bg-muted/80' : 'h-12 w-12 bg-muted/70'
                  }`}>
                    <item.icon className={`text-primary transition-transform duration-300 group-hover:scale-110 ${item.featured ? 'h-6 w-6' : 'h-5 w-5'}`} />
                  </div>
                  <h3 className={`font-bold text-foreground ${item.featured ? 'mt-6 text-xl sm:text-2xl' : 'mt-5 text-lg'}`}>{item.title}</h3>
                  <p className={`flex-1 leading-relaxed text-muted-foreground ${item.featured ? 'mt-3 max-w-lg text-[15px]' : 'mt-2 text-sm'}`}>{item.description}</p>
                  <span className={`inline-flex items-center gap-2 font-semibold text-primary ${item.featured ? 'mt-8 text-[15px]' : 'mt-6 text-sm'}`}>
                    {item.cta}
                    <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1.5" />
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </RevealSection>

      {/* ─── Spot Pairs ─── */}
      <RevealSection className="border-b border-border/60 bg-background px-4 py-20 sm:py-24 lg:px-8" delay={80}>
        <div className="container mx-auto max-w-[1400px]">
          <div className="flex items-baseline justify-between gap-4">
            <div>
              <h2 className="font-display text-[26px] font-bold text-foreground sm:text-[32px]">Spot Pairs</h2>
              <p className="mt-2 text-sm text-muted-foreground sm:text-base">Jump into a market or explore the full list.</p>
            </div>
            <Link href={ROUTES.markets} className="hidden shrink-0 items-center gap-1.5 text-sm font-semibold text-primary transition-colors hover:underline sm:inline-flex">
              View all
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:gap-5">
            {spotSummary.loading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-[88px] animate-pulse rounded-2xl border border-border/50 bg-card/50" />
              ))
            ) : spotSummary.preview.length === 0 ? (
              <div className="col-span-full py-8">
                <p className="text-sm text-muted-foreground">
                  No active spot markets.{' '}
                  <Link href={ROUTES.markets} className="font-medium text-primary hover:underline">Check status</Link>
                </p>
              </div>
            ) : (
              spotSummary.preview.map((m, idx) => {
                const hero = idx < 2;
                return (
                  <Link
                    key={m.symbol}
                    href={tradeSpotWithSymbol(m.symbol)}
                    className={`group relative flex items-center overflow-hidden rounded-2xl border border-border/50 bg-card/60 transition-all duration-300 hover:border-primary/25 hover:shadow-md ${
                      hero ? 'col-span-2 gap-5 px-6 py-5 shadow-sm' : 'gap-4 px-5 py-4 shadow-sm'
                    }`}
                  >
                    {hero && <div className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-primary/[0.04] blur-[40px] transition-all duration-500 group-hover:bg-primary/[0.08]" />}
                    <div className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted/60 shadow-sm transition-all duration-300 group-hover:bg-primary/10 group-hover:shadow-[0_0_12px_hsl(var(--primary)/0.08)] ${
                      hero ? 'h-12 w-12' : 'h-10 w-10'
                    }`}>
                      <Image
                        src={logoUrl(m.base_asset)}
                        alt=""
                        width={hero ? 26 : 22}
                        height={hero ? 26 : 22}
                        className="object-contain"
                        loading="lazy"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                    </div>
                    <div className="min-w-0">
                      <p className={`font-semibold leading-tight text-foreground ${hero ? 'text-base' : 'text-sm'}`}>{m.base_asset}</p>
                      <p className={`leading-tight text-muted-foreground ${hero ? 'mt-1 text-xs' : 'mt-0.5 text-[11px]'}`}>{m.base_asset}/{m.quote_asset}</p>
                    </div>
                    <ArrowRight className={`ml-auto shrink-0 text-muted-foreground/0 transition-all duration-300 group-hover:translate-x-1 group-hover:text-primary ${hero ? 'h-5 w-5' : 'h-4 w-4'}`} />
                  </Link>
                );
              })
            )}
          </div>
          <Link href={ROUTES.markets} className="mt-8 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline sm:hidden">
            View all markets <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </RevealSection>

      {/* ─── Earn ─── */}
      <RevealSection className="border-b border-border/60 bg-card/40 px-4 py-20 sm:py-24 lg:px-8" delay={80}>
        <div className="container mx-auto max-w-[1400px]">
          <div className="max-w-2xl">
            <h2 className="font-display text-[26px] font-bold text-foreground sm:text-[32px]">Earn with Metherium</h2>
            <p className="mt-3 text-base text-muted-foreground sm:text-lg">
              Put your idle assets to work with flexible staking and reward programs.
            </p>
          </div>
          {/* Asymmetric earn grid: APY card dominant */}
          <div className="mt-14 grid gap-7 md:grid-cols-5">
            {/* Primary: APY highlight card — spans 3 cols */}
            <div className="group relative min-h-[320px] overflow-hidden rounded-2xl border border-border/50 bg-background p-8 shadow-md sm:p-10 md:col-span-3 transition-all duration-400 hover:border-primary/30 hover:shadow-[0_12px_48px_hsl(var(--primary)/0.08)]">
              <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-primary/[0.06] blur-[100px] transition-all duration-500 group-hover:bg-primary/[0.12]" />
              <div className="pointer-events-none absolute -bottom-16 -left-16 h-48 w-48 rounded-full bg-yellow-500/[0.04] blur-[80px] transition-all duration-500 group-hover:bg-yellow-500/[0.08]" />
              <div className="relative flex h-full flex-col">
                <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10 shadow-sm transition-all duration-300 group-hover:shadow-[0_0_24px_hsl(var(--primary)/0.15)]">
                  <TrendingUp className="h-6 w-6 text-primary transition-transform duration-300 group-hover:scale-110" />
                </div>
                <div className="mt-6 flex items-baseline gap-3">
                  <span className="font-display text-5xl font-black tracking-tight sm:text-6xl">
                    <span className="bg-gradient-to-r from-primary via-yellow-400 to-primary bg-clip-text text-transparent">12%</span>
                  </span>
                  <span className="text-lg font-semibold text-muted-foreground sm:text-xl">APY</span>
                </div>
                <h3 className="mt-3 text-xl font-bold text-foreground sm:text-2xl">Flexible Staking Rewards</h3>
                <p className="mt-2 max-w-md flex-1 text-[15px] leading-relaxed text-muted-foreground">
                  Stake your crypto with daily compounding rewards. No lock-in periods — withdraw anytime.
                </p>
                <Link
                  href={ROUTES.earn}
                  className="mt-8 inline-flex w-fit items-center gap-2.5 rounded-xl bg-primary px-8 py-3.5 text-[15px] font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-all duration-200 hover:bg-primary/90 hover:shadow-[0_4px_28px_hsl(var(--primary)/0.35)] active:scale-[0.98]"
                >
                  Start Earning
                  <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                </Link>
              </div>
            </div>

            {/* Secondary: Staking card — spans 2 cols */}
            <div className="group relative min-h-[320px] overflow-hidden rounded-2xl border border-border/50 bg-background p-8 shadow-sm sm:p-10 md:col-span-2 transition-all duration-400 hover:border-blue-500/25 hover:shadow-[0_8px_36px_rgba(59,130,246,0.06)]">
              <div className="pointer-events-none absolute -left-16 -bottom-16 h-48 w-48 rounded-full bg-blue-500/[0.04] blur-[80px] transition-all duration-500 group-hover:bg-blue-500/[0.10]" />
              <div className="relative flex h-full flex-col">
                <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-blue-500/10 shadow-sm">
                  <Zap className="h-6 w-6 text-blue-400 transition-transform duration-300 group-hover:scale-110" />
                </div>
                <h3 className="mt-6 text-xl font-bold text-foreground sm:text-2xl">Stake ETH &amp; USDT</h3>
                <p className="mt-2 flex-1 text-[15px] leading-relaxed text-muted-foreground">
                  Secure and flexible staking options. Earn daily rewards on your holdings with zero minimum.
                </p>
                <div className="mt-6 flex items-center gap-3">
                  {['ETH', 'USDT', 'BTC'].map((coin) => (
                    <div key={coin} className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl bg-muted/60 shadow-sm transition-transform duration-200 hover:scale-110">
                      <Image src={logoUrl(coin)} alt={coin} width={22} height={22} className="object-contain" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    </div>
                  ))}
                </div>
                <Link
                  href={ROUTES.earn}
                  className="mt-6 inline-flex w-fit items-center gap-2 rounded-xl border border-border/70 bg-background px-7 py-3 text-sm font-semibold text-foreground shadow-sm transition-all duration-200 hover:border-border hover:bg-muted hover:shadow-md active:scale-[0.98]"
                >
                  Explore Staking
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </RevealSection>

      {/* ─── Platform Activity ─── */}
      <RevealSection className="border-b border-border/60 bg-background px-4 py-20 sm:py-24 lg:px-8" delay={80}>
        <div className="container mx-auto max-w-[1400px]">
          <div className="grid items-start gap-12 lg:grid-cols-[1fr_420px] lg:gap-20">
            <div>
              <h2 className="font-display text-[26px] font-bold text-foreground sm:text-[32px]">Platform Activity</h2>
              <p className="mt-3 text-base text-muted-foreground sm:text-lg">Real-time metrics from our trading infrastructure.</p>

              {spotSummary.loading ? (
                <div className="mt-10 grid grid-cols-2 gap-5">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="h-[140px] animate-pulse rounded-2xl border border-border/50 bg-card/50" />
                  ))}
                </div>
              ) : spotSummary.error ? (
                <div className="mt-8 text-sm text-muted-foreground">
                  {spotSummary.error}
                  <button type="button" onClick={() => spotSummary.retry()} className="ml-2 font-medium text-primary hover:underline">
                    <RefreshCw className="mr-1 inline h-3.5 w-3.5" />Retry
                  </button>
                </div>
              ) : (
                <div className="mt-10 grid grid-cols-2 gap-5">
                  {stats.map((stat, i) => (
                    <div
                      key={stat.label}
                      className="group relative rounded-2xl p-px shadow-sm transition-all duration-300 hover:shadow-lg"
                    >
                      {/* Gradient border that intensifies on hover */}
                      <div className={`absolute inset-0 rounded-2xl transition-opacity duration-300 ${
                        i === 0 ? 'bg-gradient-to-br from-primary/20 via-border/20 to-transparent opacity-60 group-hover:opacity-100'
                        : i === 1 ? 'bg-gradient-to-br from-blue-500/20 via-border/20 to-transparent opacity-60 group-hover:opacity-100'
                        : 'bg-border/40 opacity-100'
                      }`} />
                      <div className={`relative rounded-2xl bg-card/80 backdrop-blur-sm ${
                        stat.large ? 'p-7 sm:p-8' : 'p-6 sm:p-7'
                      }`}>
                        <div className={`flex items-center justify-center rounded-xl shadow-sm transition-all duration-300 group-hover:shadow-[0_0_16px_hsl(var(--primary)/0.1)] ${
                          stat.large ? 'h-12 w-12 bg-primary/10' : 'h-10 w-10 bg-primary/10'
                        }`}>
                          <stat.icon className={`text-primary transition-transform duration-300 group-hover:scale-110 ${stat.large ? 'h-5 w-5' : 'h-4 w-4'}`} />
                        </div>
                        <p className={`tabular-nums font-display font-bold text-foreground ${
                          stat.large ? 'mt-4 text-2xl sm:text-3xl' : 'mt-3 text-xl sm:text-2xl'
                        }`}>{stat.value}</p>
                        <p className={`text-muted-foreground ${stat.large ? 'mt-1 text-sm' : 'mt-0.5 text-xs sm:text-sm'}`}>{stat.label}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <Link
                href={ROUTES.signup}
                className="mt-10 inline-flex items-center justify-center gap-2.5 rounded-xl bg-primary px-8 py-3.5 text-[15px] font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-all duration-200 hover:bg-primary/90 hover:shadow-[0_4px_24px_hsl(var(--primary)/0.3)] active:scale-[0.98]"
              >
                Create Account
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>

            {/* Right: Status card — gradient border treatment */}
            <div className="hidden lg:block">
              <div className="relative rounded-2xl p-px shadow-lg shadow-black/[0.06]">
                <div className="absolute inset-0 rounded-2xl bg-gradient-to-b from-buy/20 via-border/30 to-border/10" />
                <div className="relative overflow-hidden rounded-2xl bg-card/90 p-8 backdrop-blur-sm">
                <div className="pointer-events-none absolute inset-0">
                  <div className="absolute -right-10 -top-10 h-36 w-36 rounded-full bg-primary/[0.06] blur-[50px]" />
                  <div className="absolute -bottom-10 -left-10 h-36 w-36 rounded-full bg-blue-500/[0.06] blur-[50px]" />
                </div>
                <div className="relative space-y-5">
                  <div className="flex items-center justify-between border-b border-border/60 pb-5">
                    <span className="text-sm font-semibold text-foreground">System Status</span>
                    <span className="flex items-center gap-2 text-[12px] font-medium text-buy">
                      <span className="h-2 w-2 rounded-full bg-buy animate-pulse shadow-sm shadow-buy/40" />
                      Operational
                    </span>
                  </div>
                  {[
                    { label: 'Spot Engine', latency: '<1ms' },
                    { label: 'P2P Escrow', latency: 'Instant' },
                    { label: 'Withdrawals', latency: '<5min' },
                  ].map((s) => (
                    <div key={s.label} className="flex items-center justify-between py-1">
                      <span className="text-sm text-muted-foreground">{s.label}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-[12px] tabular-nums text-muted-foreground/70">{s.latency}</span>
                        <span className="rounded-full bg-buy/10 px-2.5 py-1 text-[11px] font-medium text-buy shadow-sm">Active</span>
                      </div>
                    </div>
                  ))}
                  <div className="border-t border-border/60 pt-5">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Uptime (30d)</span>
                      <span className="text-sm font-bold tabular-nums text-foreground">99.98%</span>
                    </div>
                    <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted/60">
                      <div className="h-full w-[99.98%] rounded-full bg-gradient-to-r from-primary to-buy shadow-sm shadow-buy/30 transition-all duration-1000" />
                    </div>
                  </div>
                </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </RevealSection>

      {/* ─── CTA ─── */}
      <RevealSection className="relative overflow-hidden border-b border-border/60 bg-card/40 px-4 py-24 sm:py-32 lg:px-8" delay={80}>
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-1/2 top-1/2 h-[500px] w-[700px] -translate-x-1/2 -translate-y-1/2 animate-[home-glow-pulse_8s_ease-in-out_infinite] rounded-full bg-primary/[0.06] blur-[120px]" />
          <div className="absolute left-1/3 top-1/3 h-[300px] w-[300px] animate-[home-glow-pulse_10s_ease-in-out_infinite_3s] rounded-full bg-blue-500/[0.03] blur-[80px]" />
          <div className="absolute right-1/3 bottom-1/3 h-[250px] w-[250px] animate-[home-glow-pulse_12s_ease-in-out_infinite_5s] rounded-full bg-purple-500/[0.03] blur-[80px]" />
        </div>
        <div className="container relative mx-auto max-w-[1400px] text-center">
          <h2 className="font-display text-[28px] font-bold text-foreground sm:text-[34px] lg:text-[42px]">
            Ready when you are
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-base text-muted-foreground sm:text-lg">
            Open an account in minutes and access spot and P2P trading from one unified dashboard.
          </p>
          <div className="mt-12 flex flex-wrap justify-center gap-4">
            <Link
              href={ROUTES.signup}
              className="group inline-flex items-center justify-center gap-2.5 rounded-xl bg-primary px-10 py-4 text-[15px] font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-all duration-200 hover:bg-primary/90 hover:shadow-[0_4px_36px_hsl(var(--primary)/0.35)] active:scale-[0.98]"
            >
              Get Started
              <ArrowRight className="h-5 w-5 transition-transform duration-200 group-hover:translate-x-0.5" />
            </Link>
            <Link
              href={ROUTES.login}
              className="inline-flex items-center justify-center rounded-xl border border-border/70 bg-background px-10 py-4 text-[15px] font-semibold text-foreground shadow-sm transition-all duration-200 hover:border-border hover:bg-muted hover:shadow-md active:scale-[0.98]"
            >
              Log in
            </Link>
          </div>
        </div>
      </RevealSection>
        </>
      ) : (
        <section className="border-b border-border/60 bg-card/30 px-4 py-16 sm:py-20 lg:px-8">
          <div className="container mx-auto max-w-[1400px]">
            <div className="mb-6 h-7 w-52 animate-pulse rounded-lg bg-muted/60" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-28 animate-pulse rounded-2xl border border-border/50 bg-card/60" />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ─── Footer ─── */}
      <footer className="border-t border-border/60 bg-background px-4 py-14 lg:px-8 lg:py-16">
        <div className="container mx-auto max-w-[1400px]">
          <div className="flex flex-col gap-10 md:flex-row md:items-start md:justify-between md:gap-16">
            <div className="max-w-[300px]">
              <Link href={ROUTES.home} className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary font-display text-sm font-bold text-primary-foreground shadow-sm shadow-primary/20">
                  M
                </div>
                <span className="font-display text-base font-bold text-foreground">Methereum</span>
              </Link>
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                Professional crypto exchange for spot and P2P trading with institutional-grade security.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-10 sm:gap-14">
              {[
                { title: 'Products', links: FOOTER_PRODUCTS(spotHref) },
                { title: 'Support', links: FOOTER_SUPPORT },
                { title: 'Legal', links: FOOTER_LEGAL },
              ].map((col) => (
                <div key={col.title}>
                  <h4 className="mb-4 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">{col.title}</h4>
                  <ul className="space-y-3">
                    {col.links.map((link) => (
                      <li key={link.label}>
                        <Link href={link.href} className="text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground">
                          {link.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-12 border-t border-border/60 pt-8 text-center text-[13px] text-muted-foreground">
            © {new Date().getFullYear()} Methereum. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
