'use client';

import { useCallback, useEffect, useState } from 'react';
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
    <div className="flex items-center justify-between rounded-xl border border-border bg-card p-4 animate-pulse">
      <div className="flex items-center gap-2">
        <div className="h-8 w-8 rounded-lg bg-muted" />
        <div className="h-4 w-16 rounded bg-muted" />
      </div>
      <div className="space-y-2 text-right">
        <div className="ml-auto h-4 w-14 rounded bg-muted" />
        <div className="ml-auto h-3 w-10 rounded bg-muted" />
      </div>
    </div>
  );
}

const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90';
const btnSecondary =
  'inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-background px-5 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted';

export default function HomePage() {
  const { tickers, loading: tickersLoading, error: tickersError, retry: retryTickers } = useMarketPrices();
  const spotSummary = useHomeSpotSummary();
  const { accessToken, _hasHydrated } = useAuthStore();
  const spotHref = _hasHydrated && accessToken ? SPOT_TRADE_HREF : ROUTES.spotLegacy;

  const features = [
    {
      icon: BarChart3,
      title: 'Spot trading',
      description: 'Deep liquidity, real-time order books, and tight spreads across major pairs.',
      href: spotHref,
      cta: 'Trade spot',
    },
    {
      icon: Users,
      title: 'P2P marketplace',
      description: 'Buy and sell with peers using local payment methods and escrow-backed settlement.',
      href: ROUTES.p2p,
      cta: 'Open P2P',
    },
    {
      icon: Shield,
      title: 'Security first',
      description: 'Cold storage, encryption, and monitoring designed to protect your assets.',
      href: ROUTES.dashboard.security,
      cta: 'Security center',
    },
  ] as const;

  return (
    <div className="min-h-screen bg-background">
      <header className="fixed top-0 left-0 right-0 z-50 border-b border-border bg-card/90 backdrop-blur-md">
        <div className="container mx-auto flex h-14 max-w-[1400px] items-center justify-between px-4 lg:px-6">
          <Link href={ROUTES.home} className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary font-display text-sm font-bold text-primary-foreground">
              M
            </div>
            <span className="hidden font-display text-lg font-bold tracking-tight text-foreground sm:inline">
              Methereum
            </span>
          </Link>

          <nav className="hidden items-center gap-0.5 lg:flex">
            {NAV_LINKS(spotHref).map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <ThemeToggle variant="icon" size="sm" />
            <Link href={ROUTES.login} className={`${btnSecondary} hidden px-3 py-2 sm:inline-flex`}>
              Log in
            </Link>
            <Link href={ROUTES.signup} className={btnPrimary}>
              Sign up
            </Link>
          </div>
        </div>
      </header>

      <section className="border-b border-border bg-background px-4 pb-20 pt-24 lg:px-6">
        <div className="container mx-auto max-w-[1400px]">
          <div className="grid gap-12 lg:grid-cols-[1fr_minmax(0,420px)] lg:items-start lg:gap-16">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Methereum Exchange</p>
              <h1 className="mt-4 font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl lg:text-5xl">
                Trade spot &amp; P2P with confidence
              </h1>
              <p className="mt-4 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
                Professional tools, strong security, and a streamlined path from first deposit to live markets.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href={ROUTES.signup} className={btnPrimary}>
                  Start trading
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
                <Link href={ROUTES.markets} className={btnSecondary}>
                  View markets
                </Link>
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <p className="text-sm font-semibold text-foreground">Reference prices</p>
              <p className="mt-1 text-xs text-muted-foreground">Live data from convert markets</p>
              <div className="mt-4">
                {tickersLoading ? (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-2">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <HeroTickerSkeleton key={i} />
                    ))}
                  </div>
                ) : tickersError ? (
                  <div className="rounded-xl border border-border bg-muted/50 p-4 text-sm text-foreground">
                    <p className="text-muted-foreground">{tickersError}</p>
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
                    <Link href={ROUTES.markets} className="font-medium text-primary hover:underline">
                      Browse markets
                    </Link>
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
                          className="flex items-center justify-between rounded-xl border border-border bg-background p-4 transition-colors hover:border-primary/35 hover:bg-muted/30"
                        >
                          <div className="flex items-center gap-2">
                            <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-lg bg-muted">
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
                            <p className="text-sm font-medium tabular-nums text-foreground">${t.price}</p>
                            <span
                              className={`flex items-center justify-end gap-0.5 text-xs font-medium ${
                                up ? 'text-buy' : 'text-sell'
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
          </div>
        </div>
      </section>

      <section className="border-b border-border bg-card px-4 py-16 lg:px-6">
        <div className="container mx-auto max-w-[1400px]">
          <div className="max-w-2xl">
            <h2 className="font-display text-2xl font-bold text-foreground sm:text-3xl">Built for every trader</h2>
            <p className="mt-2 text-muted-foreground">
              Spot execution, peer-to-peer flexibility, and institutional-grade safeguards in one platform.
            </p>
          </div>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {features.map((item) => (
              <div
                key={item.title}
                className="flex flex-col rounded-2xl border border-border bg-background p-6 transition-colors hover:border-primary/25"
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-muted">
                  <item.icon className="h-5 w-5 text-primary" aria-hidden />
                </div>
                <h3 className="mt-4 font-semibold text-foreground">{item.title}</h3>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">{item.description}</p>
                <Link
                  href={item.href}
                  className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
                >
                  {item.cta}
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-border bg-background px-4 py-16 lg:px-6">
        <div className="container mx-auto max-w-[1400px]">
          <h2 className="font-display text-2xl font-bold text-foreground">Spot pairs</h2>
          <p className="mt-1 text-sm text-muted-foreground">Jump into a market or explore the full list.</p>
          <div className="mt-6 flex min-h-[5rem] flex-wrap gap-3">
            {spotSummary.loading ? (
              <>
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="h-20 w-28 animate-pulse rounded-xl border border-border bg-card" />
                ))}
              </>
            ) : spotSummary.preview.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No active spot markets.{' '}
                <Link href={ROUTES.markets} className="font-medium text-primary hover:underline">
                  Check status
                </Link>
              </p>
            ) : (
              spotSummary.preview.map((m) => (
                <Link
                  key={m.symbol}
                  href={tradeSpotWithSymbol(m.symbol)}
                  className="flex h-20 w-28 items-center justify-center rounded-xl border border-border bg-card text-sm font-semibold text-foreground transition-colors hover:border-primary/40 hover:bg-muted/40"
                >
                  {m.base_asset}/{m.quote_asset}
                </Link>
              ))
            )}
          </div>
          <Link
            href={ROUTES.markets}
            className="mt-6 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
          >
            View all markets
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      </section>

      <section className="border-b border-border bg-card px-4 py-16 lg:px-6">
        <div className="container mx-auto max-w-[1400px]">
          <h2 className="font-display text-2xl font-bold text-foreground">Platform activity</h2>
          {spotSummary.loading ? (
            <div className="mt-6 space-y-3">
              <div className="h-10 w-56 animate-pulse rounded bg-muted" />
              <div className="h-4 w-72 animate-pulse rounded bg-muted" />
            </div>
          ) : spotSummary.error ? (
            <div className="mt-6 text-sm text-muted-foreground">
              {spotSummary.error}
              <button
                type="button"
                onClick={() => spotSummary.retry()}
                className="ml-3 inline-flex items-center gap-1 font-medium text-primary hover:underline"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                Retry
              </button>
            </div>
          ) : (
            <>
              <div className="mt-6 flex flex-wrap items-baseline gap-x-8 gap-y-2">
                <p className="font-display text-3xl font-bold tabular-nums text-foreground sm:text-4xl">
                  {spotSummary.volume24hQuote != null && spotSummary.volume24hQuote > 0
                    ? formatCompactNotional(spotSummary.volume24hQuote)
                    : '—'}
                </p>
                <p className="text-sm text-muted-foreground">24h quote volume (spot, all markets)</p>
              </div>
              <div className="mt-8 grid max-w-lg grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="rounded-2xl border border-border bg-background p-5">
                  <p className="font-display text-xl font-bold tabular-nums text-foreground">
                    {spotSummary.marketCount != null ? spotSummary.marketCount : '—'}
                  </p>
                  <p className="text-sm text-muted-foreground">Active spot markets</p>
                </div>
                <div className="rounded-2xl border border-border bg-background p-5">
                  <p className="text-sm font-semibold text-foreground">Spot &amp; P2P</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Live order books and escrow-backed peer trades.
                  </p>
                  <Link href={spotHref} className="mt-3 inline-flex text-sm font-semibold text-primary hover:underline">
                    Open trading →
                  </Link>
                </div>
              </div>
            </>
          )}
          <Link href={ROUTES.signup} className={`${btnPrimary} mt-8`}>
            Create account
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      </section>

      <section className="border-b border-border bg-background px-4 py-16 lg:px-6">
        <div className="container mx-auto max-w-[1400px] text-center">
          <h2 className="font-display text-2xl font-bold text-foreground sm:text-3xl">Ready when you are</h2>
          <p className="mx-auto mt-2 max-w-md text-muted-foreground">
            Open an account in minutes and access spot and P2P from one dashboard.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href={ROUTES.signup} className={btnPrimary}>
              Get started
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
            <Link href={ROUTES.login} className={btnSecondary}>
              Log in
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-border bg-card px-4 py-12 lg:px-6">
        <div className="container mx-auto max-w-[1400px]">
          <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
            <Link href={ROUTES.home} className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary font-display text-sm font-bold text-primary-foreground">
                M
              </div>
              <span className="font-display text-lg font-bold text-foreground">Methereum</span>
            </Link>
            <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
              <div>
                <h4 className="mb-3 text-sm font-semibold text-foreground">Products</h4>
                <ul className="space-y-2">
                  {FOOTER_PRODUCTS(spotHref).map((link) => (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h4 className="mb-3 text-sm font-semibold text-foreground">Support</h4>
                <ul className="space-y-2">
                  {FOOTER_SUPPORT.map((link) => (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h4 className="mb-3 text-sm font-semibold text-foreground">Legal</h4>
                <ul className="space-y-2">
                  {FOOTER_LEGAL.map((link) => (
                    <li key={link.label}>
                      <Link
                        href={link.href}
                        className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
          <div className="mt-10 border-t border-border pt-8 text-center text-sm text-muted-foreground">
            © {new Date().getFullYear()} Methereum. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
