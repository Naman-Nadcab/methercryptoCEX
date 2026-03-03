'use client';

import { useEffect, useState } from 'react';
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
} from 'lucide-react';
import ThemeToggle from '@/components/ThemeToggle';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { useAuthStore } from '@/store/auth';

const NAV_LINKS = (spotHref: string) => [
  { label: 'Buy Crypto', href: '/dashboard/assets/convert' },
  { label: 'Markets', href: '/dashboard/markets' },
  { label: 'Trade', href: spotHref },
  { label: 'P2P', href: '/dashboard/p2p' },
];

const FALLBACK_TICKERS = [
  { base_symbol: 'BTC', price: '97,250', change_24h_percent: '0.27', pair: 'BTC/USDT' },
  { base_symbol: 'ETH', price: '3,450', change_24h_percent: '-0.12', pair: 'ETH/USDT' },
  { base_symbol: 'BNB', price: '615', change_24h_percent: '0.45', pair: 'BNB/USDT' },
  { base_symbol: 'SOL', price: '225', change_24h_percent: '1.22', pair: 'SOL/USDT' },
  { base_symbol: 'XRP', price: '2.45', change_24h_percent: '-0.08', pair: 'XRP/USDT' },
  { base_symbol: 'DOGE', price: '0.38', change_24h_percent: '0.91', pair: 'DOGE/USDT' },
];

const FOOTER_PRODUCTS = (spotHref: string) => [
  { label: 'Spot Trading', href: spotHref },
  { label: 'P2P Trading', href: '/dashboard/p2p' },
  { label: 'Markets', href: '/dashboard/markets' },
  { label: 'Buy Crypto', href: '/dashboard/assets/convert' },
];

const FOOTER_SUPPORT = [
  { label: 'Help Center', href: '/dashboard/help' },
  { label: 'Fees', href: '/dashboard/fee-rates' },
  { label: 'API', href: '/dashboard/api' },
];

const FOOTER_LEGAL = [
  { label: 'Terms of Use', href: '/terms' },
  { label: 'Privacy Policy', href: '/privacy' },
  { label: 'Risk Warning', href: '/terms' },
];

interface MarketPrice {
  base_symbol: string;
  price: string;
  change_24h_percent: string;
  base_logo?: string;
}

function useMarketPrices() {
  const [tickers, setTickers] = useState<MarketPrice[]>(FALLBACK_TICKERS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const apiUrl = getApiBaseUrl();
    fetch(`${apiUrl}/api/v1/convert/market-prices`)
      .then((res) => res.json())
      .then((json) => {
        if (json?.success && Array.isArray(json?.data) && json.data.length > 0) {
          const list = json.data
            .slice(0, 6)
            .map((row: { base_symbol: string; price: string; change_24h_percent: string; base_logo?: string }) => ({
              base_symbol: row.base_symbol,
              price: Number(row.price).toLocaleString('en-US', { maximumFractionDigits: 2 }),
              change_24h_percent: row.change_24h_percent,
              base_logo: row.base_logo,
            }));
          setTickers(list);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return { tickers, loading };
}

function logoUrl(symbol: string) {
  return `/assets/upload/currency-logo/${symbol.toLowerCase()}.svg`;
}

export default function HomePage() {
  const { tickers, loading } = useMarketPrices();
  const { accessToken, _hasHydrated } = useAuthStore();
  const spotHref = _hasHydrated && accessToken ? '/dashboard/spot' : '/spot';

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#0b0e11]">
      {/* Header - same style as dashboard */}
      <header className="fixed top-0 left-0 right-0 z-50 border-b border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-[#0b0e11]/90 backdrop-blur-md">
        <div className="container mx-auto flex h-14 items-center justify-between px-4 lg:px-6">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-blue-500 flex items-center justify-center">
              <span className="text-white font-bold text-sm">M</span>
            </div>
            <span className="text-lg font-bold text-gray-900 dark:text-white hidden sm:inline">Methereum</span>
          </Link>

          <nav className="hidden lg:flex items-center gap-1">
            {NAV_LINKS(spotHref).map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white rounded-lg hover:bg-gray-100 dark:hover:bg-[#181a20] transition-colors"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <ThemeToggle variant="icon" size="sm" />
            <Link
              href="/login"
              className="text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:text-white px-3 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-[#181a20] transition-colors"
            >
              Log In
            </Link>
            <Link
              href="/signup"
              className="text-sm font-medium text-white bg-blue-500 hover:bg-blue-600 px-4 py-2 rounded-lg transition-colors"
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
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-gray-900 dark:text-white tracking-tight">
              Your crypto journey, simplified.
            </h1>
            <p className="mt-4 text-lg text-gray-600 dark:text-gray-400">
              Trade spot and P2P with ease. Secure, fast, and built for everyone.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/signup"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium text-white bg-blue-500 hover:bg-blue-600 transition-colors"
              >
                Start Trading <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/dashboard/markets"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-[#181a20] transition-colors"
              >
                View Markets
              </Link>
            </div>
          </div>

          {/* Market tickers - from API or fallback */}
          <div className="mt-12 grid grid-cols-2 sm:grid-cols-3 gap-3 max-w-2xl">
            {(loading ? FALLBACK_TICKERS : tickers).map((t) => {
              const change = parseFloat(t.change_24h_percent);
              const up = change >= 0;
              return (
                <Link
                  key={t.base_symbol}
                  href="/dashboard/markets"
                  className="flex items-center justify-between rounded-xl bg-white dark:bg-[#181a20] border border-gray-200 dark:border-gray-800 p-4 hover:border-blue-500/30 dark:hover:border-blue-500/30 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-[#0b0e11] flex items-center justify-center overflow-hidden">
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
                    <span className="text-sm font-medium text-gray-900 dark:text-white">{t.base_symbol}/USDT</span>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium text-gray-900 dark:text-white">${t.price}</p>
                    <span
                      className={`text-xs font-medium flex items-center justify-end gap-0.5 ${
                        up ? 'text-emerald-500' : 'text-red-500'
                      }`}
                    >
                      {up ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      {up ? '' : ''}{t.change_24h_percent}%
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      {/* Spot Listings - light/dark section */}
      <section className="py-16 px-4 lg:px-6 bg-white dark:bg-[#181a20] border-y border-gray-200 dark:border-gray-800">
        <div className="container mx-auto">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
            Never miss a Spot listing
          </h2>
          <p className="mt-1 text-gray-600 dark:text-gray-400">
            New pairs and launches. Follow our channels to be the first to know.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            {['BTC', 'ETH', 'SOL', 'BNB', 'XRP'].map((symbol) => (
              <Link
                key={symbol}
                href="/dashboard/markets"
                className="w-28 h-20 rounded-xl bg-gray-50 dark:bg-[#0b0e11] border border-gray-200 dark:border-gray-800 flex items-center justify-center text-sm font-semibold text-gray-800 dark:text-gray-200 hover:border-blue-500/50 hover:bg-blue-50/50 dark:hover:bg-blue-500/10 transition-colors"
              >
                {symbol}/USDT
              </Link>
            ))}
          </div>
          <Link
            href="/dashboard/markets"
            className="mt-6 inline-flex items-center gap-1 text-sm font-medium text-blue-500 hover:text-blue-600 dark:text-blue-400"
          >
            View all markets <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      {/* P2P */}
      <section className="py-16 px-4 lg:px-6">
        <div className="container mx-auto flex flex-col lg:flex-row items-center gap-12">
          <div className="flex-1">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
              Buy & sell crypto with P2P
            </h2>
            <p className="mt-3 text-gray-600 dark:text-gray-400 max-w-lg">
              Trade directly with other users. Multiple payment methods, escrow protection, and fast settlement.
            </p>
            <ul className="mt-6 space-y-3 text-gray-700 dark:text-gray-300">
              <li className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-blue-500 text-white text-xs font-bold flex items-center justify-center">1</span>
                Bank transfer, UPI, and more
              </li>
              <li className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-blue-500 text-white text-xs font-bold flex items-center justify-center">2</span>
                Escrow protection on every trade
              </li>
              <li className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-blue-500 text-white text-xs font-bold flex items-center justify-center">3</span>
                24/7 dispute resolution
              </li>
            </ul>
            <Link
              href="/dashboard/p2p"
              className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium text-white bg-blue-500 hover:bg-blue-600 transition-colors"
            >
              Go to P2P <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="flex-1 flex justify-center">
            <div className="w-full max-w-sm aspect-video rounded-2xl bg-gradient-to-br from-blue-500/10 to-indigo-500/10 dark:from-blue-500/20 dark:to-indigo-500/20 border border-gray-200 dark:border-gray-700 flex items-center justify-center">
              <Users className="w-16 h-16 text-blue-500/60" />
            </div>
          </div>
        </div>
      </section>

      {/* Trust metrics */}
      <section className="py-16 px-4 lg:px-6 bg-white dark:bg-[#181a20] border-y border-gray-200 dark:border-gray-800">
        <div className="container mx-auto">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
            Robust and reliable, trusted by traders
          </h2>
          <div className="mt-6 flex flex-wrap items-baseline gap-x-8 gap-y-2">
            <p className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white">$2.45B+</p>
            <p className="text-gray-600 dark:text-gray-400">Total trading volume</p>
          </div>
          <div className="mt-8 grid grid-cols-2 gap-4 max-w-md">
            <div className="rounded-xl bg-gray-50 dark:bg-[#0b0e11] border border-gray-200 dark:border-gray-800 p-5">
              <p className="text-xl font-bold text-gray-900 dark:text-white">500K+</p>
              <p className="text-sm text-gray-600 dark:text-gray-400">Active users</p>
            </div>
            <div className="rounded-xl bg-gray-50 dark:bg-[#0b0e11] border border-gray-200 dark:border-gray-800 p-5">
              <p className="text-xl font-bold text-gray-900 dark:text-white">150+</p>
              <p className="text-sm text-gray-600 dark:text-gray-400">Spot pairs</p>
            </div>
          </div>
          <Link
            href="/signup"
            className="mt-8 inline-flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium text-white bg-blue-500 hover:bg-blue-600 transition-colors"
          >
            Join now <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      {/* Safety */}
      <section className="py-16 px-4 lg:px-6">
        <div className="container mx-auto">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
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
                className="rounded-xl bg-white dark:bg-[#181a20] border border-gray-200 dark:border-gray-800 p-6"
              >
                <div className="w-10 h-10 rounded-lg bg-blue-500/10 dark:bg-blue-500/20 flex items-center justify-center">
                  <item.icon className="w-5 h-5 text-blue-500" />
                </div>
                <h3 className="mt-3 font-semibold text-gray-900 dark:text-white">{item.title}</h3>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 px-4 lg:px-6 bg-gray-100 dark:bg-[#181a20] border-t border-gray-200 dark:border-gray-800">
        <div className="container mx-auto text-center">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
            Ready to start trading?
          </h2>
          <p className="mt-2 text-gray-600 dark:text-gray-400 max-w-md mx-auto">
            Join thousands of traders. Spot and P2P in one place.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link
              href="/signup"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium text-white bg-blue-500 hover:bg-blue-600 transition-colors"
            >
              Create account <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-[#0b0e11] transition-colors"
            >
              Log In
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-4 lg:px-6 border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-[#0b0e11]">
        <div className="container mx-auto">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-8">
            <div>
              <Link href="/" className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-blue-500 flex items-center justify-center">
                  <span className="text-white font-bold text-sm">M</span>
                </div>
                <span className="text-lg font-bold text-gray-900 dark:text-white">Methereum</span>
              </Link>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
              <div>
                <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Products</h4>
                <ul className="space-y-2">
                  {FOOTER_PRODUCTS(spotHref).map((link) => (
                    <li key={link.href}>
                      <Link href={link.href} className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors">
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Support</h4>
                <ul className="space-y-2">
                  {FOOTER_SUPPORT.map((link) => (
                    <li key={link.href}>
                      <Link href={link.href} className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors">
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Legal</h4>
                <ul className="space-y-2">
                  {FOOTER_LEGAL.map((link) => (
                    <li key={link.label}>
                      <Link href={link.href} className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors">
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
          <div className="mt-10 pt-8 border-t border-gray-200 dark:border-gray-800 text-center text-sm text-gray-500 dark:text-gray-500">
            © {new Date().getFullYear()} Methereum. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
