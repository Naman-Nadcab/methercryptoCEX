'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {
  ArrowRight,
  Shield,
  Users,
  Headphones,
  Award,
  ChevronUp,
  ChevronDown,
  RefreshCw,
} from 'lucide-react';
import ThemeToggle from '@/components/ThemeToggle';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { useAuthStore } from '@/store/auth';
import { ROUTES, walletPath, SPOT_TRADE_HREF, tradeSpotWithSymbol } from '@/lib/routes';

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
        if (!res.ok) {
          throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
        }
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

  useEffect(() => {
    load();
  }, [load]);

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
          setPreview(
            mJson.data.slice(0, 8).map((row) => ({
              symbol: row.symbol,
              base_asset: row.base_asset,
              quote_asset: row.quote_asset,
            }))
          );
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

  useEffect(() => {
    load();
  }, [load]);

  return { preview, marketCount, volume24hQuote, loading, error, retry: load };
}

function logoUrl(symbol: string) {
  return `/assets/upload/currency-logo/${symbol.toLowerCase()}.svg`;
}

function HeroTickerSkeleton() {
  return (
    <div className="flex items-center justify-between rounded-xl bg-card border border-border p-4 animate-pulse">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-accent" />
        <div className="h-4 w-16 bg-accent rounded" />
      </div>
      <div className="text-right space-y-2">
        <div className="h-4 w-14 bg-accent rounded ml-auto" />
        <div className="h-3 w-10 bg-accent rounded ml-auto" />
      </div>
    </div>
  );
}

export default function HomePage() {
  const { tickers, loading: tickersLoading, error: tickersError, retry: retryTickers } = useMarketPrices();
  const spotSummary = useHomeSpotSummary();
  const { accessToken, _hasHydrated } = useAuthStore();
  const spotHref = _hasHydrated && accessToken ? SPOT_TRADE_HREF : ROUTES.spotLegacy;

  return (
    <div className="min-h-screen bg-background">
      {/* Header - same style as dashboard */}
      <header className="fixed top-0 left-0 right-0 z-50 border-b border-border bg-card/80 dark:bg-background/90 backdrop-blur-md">
        <div className="container mx-auto flex h-14 items-center justify-between px-4 lg:px-6">
          <Link href={ROUTES.home} className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-blue-500 flex items-center justify-center">
              <span className="text-white font-bold text-sm">M</span>
            </div>
            <span className="text-lg font-bold text-foreground hidden sm:inline">Methereum</span>
          </Link>

          <nav className="hidden lg:flex items-center gap-1">
            {NAV_LINKS(spotHref).map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="px-3 py-2 text-sm font-medium text-muted-foreground hover:text-gray-900 dark:hover:text-white rounded-lg hover:bg-gray-100 dark:hover:bg-[#181a20] transition-colors"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <ThemeToggle variant="icon" size="sm" />
            <Link
              href={ROUTES.login}
              className="text-sm font-medium text-foreground/80 hover:text-foreground px-3 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-[#181a20] transition-colors"
            >
              Log In
            </Link>
            <Link
              href={ROUTES.signup}
              className="text-sm font-medium text-white bg-primary hover:bg-primary/85 px-4 py-2 rounded-lg transition-colors"
            >
              Sign Up
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="pt-24 pb-16 px-4 lg:px-6">
        <div className="container mx-auto">
          <div className="max-w-2xl">
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-foreground tracking-tight">
              Your crypto journey, simplified.
            </h1>
            <p className="mt-4 text-lg text-muted-foreground">
              Trade spot and P2P with ease. Secure, fast, and built for everyone.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href={ROUTES.signup}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium text-white bg-primary hover:bg-primary/85 transition-colors"
              >
                Start Trading <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href={ROUTES.markets}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium text-foreground/80 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-[#181a20] transition-colors"
              >
                View Markets
              </Link>
            </div>
          </div>

          {/* Live reference prices from backend (convert/market-prices) */}
          <div className="mt-12 max-w-2xl">
            {tickersLoading ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <HeroTickerSkeleton key={i} />
                ))}
              </div>
            ) : tickersError ? (
              <div className="rounded-xl border border-amber-200 dark:border-amber-900/40 bg-amber-50/80 dark:bg-amber-950/20 p-4 text-sm text-gray-800 dark:text-gray-200">
                <p>{tickersError}</p>
                <button
                  type="button"
                  onClick={() => retryTickers()}
                  className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
                >
                  <RefreshCw className="h-4 w-4" aria-hidden />
                  Retry
                </button>
              </div>
            ) : tickers.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No live prices available.{' '}
                <Link href={ROUTES.markets} className="text-blue-500 hover:underline">
                  Browse markets
                </Link>
              </p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {tickers.map((t) => {
                  const change = parseFloat(t.change_24h_percent);
                  const up = change >= 0;
                  return (
                    <Link
                      key={t.base_symbol}
                      href={ROUTES.markets}
                      className="flex items-center justify-between rounded-xl bg-card border border-border p-4 hover:border-blue-500/30 dark:hover:border-blue-500/30 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-background flex items-center justify-center overflow-hidden">
                          <Image
                            src={logoUrl(t.base_symbol)}
                            alt=""
                            width={20}
                            height={20}
                            className="object-contain"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                            }}
                          />
                        </div>
                        <span className="text-sm font-medium text-foreground">{t.base_symbol}/USDT</span>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium text-foreground">${t.price}</p>
                        <span
                          className={`text-xs font-medium flex items-center justify-end gap-0.5 ${
                            up ? 'text-emerald-500' : 'text-red-500'
                          }`}
                        >
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
      </section>

      {/* Spot Listings - light/dark section */}
      <section className="py-16 px-4 lg:px-6 bg-card border-y border-border">
        <div className="container mx-auto">
          <h2 className="text-2xl font-bold text-foreground">
            Never miss a Spot listing
          </h2>
          <p className="mt-1 text-muted-foreground">
            New pairs and launches. Follow our channels to be the first to know.
          </p>
          <div className="mt-6 flex flex-wrap gap-3 min-h-[5rem]">
            {spotSummary.loading ? (
              <div className="flex flex-wrap gap-3 w-full">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div
                    key={i}
                    className="w-28 h-20 rounded-xl bg-accent border border-border animate-pulse"
                  />
                ))}
              </div>
            ) : spotSummary.preview.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No active spot markets.{' '}
                <Link href={ROUTES.markets} className="text-blue-500 hover:underline">
                  Check status
                </Link>
              </p>
            ) : (
              spotSummary.preview.map((m) => (
                <Link
                  key={m.symbol}
                  href={tradeSpotWithSymbol(m.symbol)}
                  className="w-28 h-20 rounded-xl bg-background border border-border flex items-center justify-center text-sm font-semibold text-gray-800 dark:text-gray-200 hover:border-blue-500/50 hover:bg-blue-50/50 dark:hover:bg-blue-500/10 transition-colors"
                >
                  {m.base_asset}/{m.quote_asset}
                </Link>
              ))
            )}
          </div>
          <Link
                      href={ROUTES.markets}
            className="mt-6 inline-flex items-center gap-1 text-sm font-medium text-primary hover:text-primary/85 dark:text-blue-400"
          >
            View all markets <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      {/* P2P */}
      <section className="py-16 px-4 lg:px-6">
        <div className="container mx-auto flex flex-col lg:flex-row items-center gap-12">
          <div className="flex-1">
            <h2 className="text-2xl font-bold text-foreground">
              Buy & sell crypto with P2P
            </h2>
            <p className="mt-3 text-muted-foreground max-w-lg">
              Trade directly with other users. Multiple payment methods, escrow protection, and fast settlement.
            </p>
            <ul className="mt-6 space-y-3 text-foreground/80">
              <li className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">1</span>
                Bank transfer, UPI, and more
              </li>
              <li className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">2</span>
                Escrow protection on every trade
              </li>
              <li className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">3</span>
                24/7 dispute resolution
              </li>
            </ul>
            <Link
              href={ROUTES.p2p}
              className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium text-white bg-primary hover:bg-primary/85 transition-colors"
            >
              Go to P2P <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="flex-1 flex justify-center">
            <div className="w-full max-w-sm aspect-video rounded-xl bg-gradient-to-br from-blue-500/10 to-indigo-500/10 dark:from-blue-500/20 dark:to-indigo-500/20 border border-border flex items-center justify-center">
              <Users className="w-16 h-16 text-blue-500/60" />
            </div>
          </div>
        </div>
      </section>

      {/* Trust metrics */}
      <section className="py-16 px-4 lg:px-6 bg-card border-y border-border">
        <div className="container mx-auto">
          <h2 className="text-2xl font-bold text-foreground">
            Robust and reliable, trusted by traders
          </h2>
          {spotSummary.loading ? (
            <div className="mt-6 space-y-3">
              <div className="h-10 w-56 bg-accent rounded animate-pulse" />
              <div className="h-4 w-72 bg-gray-100 dark:bg-gray-900 rounded animate-pulse" />
            </div>
          ) : spotSummary.error ? (
            <div className="mt-6 text-sm text-muted-foreground">
              {spotSummary.error}
              <button
                type="button"
                onClick={() => spotSummary.retry()}
                className="ml-3 text-blue-500 hover:underline inline-flex items-center gap-1"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                Retry
              </button>
            </div>
          ) : (
            <>
              <div className="mt-6 flex flex-wrap items-baseline gap-x-8 gap-y-2">
                <p className="text-3xl sm:text-4xl font-bold text-foreground tabular-nums">
                  {spotSummary.volume24hQuote != null && spotSummary.volume24hQuote > 0
                    ? formatCompactNotional(spotSummary.volume24hQuote)
                    : '—'}
                </p>
                <p className="text-muted-foreground">24h quote volume (spot, all markets)</p>
              </div>
              <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-lg">
                <div className="rounded-xl bg-background border border-border p-5">
                  <p className="text-xl font-bold text-foreground tabular-nums">
                    {spotSummary.marketCount != null ? spotSummary.marketCount : '—'}
                  </p>
                  <p className="text-sm text-muted-foreground">Active spot markets</p>
                </div>
                <div className="rounded-xl bg-background border border-border p-5">
                  <p className="text-sm font-semibold text-foreground">Spot &amp; P2P</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Live order books and escrow-backed P2P trades.
                  </p>
                  <Link
                    href={spotHref}
                    className="mt-3 inline-flex text-sm font-medium text-primary hover:text-primary/85 dark:text-blue-400"
                  >
                    Open trading →
                  </Link>
                </div>
              </div>
            </>
          )}
          <Link
                href={ROUTES.signup}
            className="mt-8 inline-flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium text-white bg-primary hover:bg-primary/85 transition-colors"
          >
            Join now <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      {/* Safety */}
      <section className="py-16 px-4 lg:px-6">
        <div className="container mx-auto">
          <h2 className="text-2xl font-bold text-foreground">
            You&apos;re safe to grow with us
          </h2>
          <div className="mt-8 grid md:grid-cols-3 gap-6">
            {[
              { icon: Headphones, title: '24/7 support', desc: 'Multi-lingual customer support when you need it.' },
              { icon: Shield, title: 'Robust security', desc: 'Cold storage, encryption, and industry best practices.' },
              { icon: Award, title: 'Proven track record', desc: 'Built for reliability and compliance.' },
            ].map((item) => (
              <div
                key={item.title}
                className="rounded-xl bg-card border border-border p-6"
              >
                <div className="w-10 h-10 rounded-lg bg-blue-500/10 dark:bg-blue-500/20 flex items-center justify-center">
                  <item.icon className="w-5 h-5 text-blue-500" />
                </div>
                <h3 className="mt-3 font-semibold text-foreground">{item.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 px-4 lg:px-6 bg-gray-100 dark:bg-card border-t border-border">
        <div className="container mx-auto text-center">
          <h2 className="text-2xl font-bold text-foreground">
            Ready to start trading?
          </h2>
          <p className="mt-2 text-muted-foreground max-w-md mx-auto">
            Join thousands of traders. Spot and P2P in one place.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link
              href={ROUTES.signup}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium text-white bg-primary hover:bg-primary/85 transition-colors"
            >
              Create account <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href={ROUTES.login}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium text-foreground/80 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-[#0b0e11] transition-colors"
            >
              Log In
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-4 lg:px-6 border-t border-border bg-white dark:bg-background">
        <div className="container mx-auto">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-8">
            <div>
              <Link href={ROUTES.home} className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-blue-500 flex items-center justify-center">
                  <span className="text-white font-bold text-sm">M</span>
                </div>
                <span className="text-lg font-bold text-foreground">Methereum</span>
              </Link>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
              <div>
                <h4 className="text-sm font-semibold text-foreground mb-3">Products</h4>
                <ul className="space-y-2">
                  {FOOTER_PRODUCTS(spotHref).map((link) => (
                    <li key={link.href}>
                      <Link href={link.href} className="text-sm text-muted-foreground hover:text-gray-900 dark:hover:text-white transition-colors">
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h4 className="text-sm font-semibold text-foreground mb-3">Support</h4>
                <ul className="space-y-2">
                  {FOOTER_SUPPORT.map((link) => (
                    <li key={link.href}>
                      <Link href={link.href} className="text-sm text-muted-foreground hover:text-gray-900 dark:hover:text-white transition-colors">
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h4 className="text-sm font-semibold text-foreground mb-3">Legal</h4>
                <ul className="space-y-2">
                  {FOOTER_LEGAL.map((link) => (
                    <li key={link.label}>
                      <Link href={link.href} className="text-sm text-muted-foreground hover:text-gray-900 dark:hover:text-white transition-colors">
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
          <div className="mt-10 pt-8 border-t border-border text-center text-sm text-muted-foreground">
            © {new Date().getFullYear()} Methereum. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
