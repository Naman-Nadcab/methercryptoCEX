'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Search, User, Menu, X, FileText, Wallet } from 'lucide-react';
import ThemeToggle from '@/components/ThemeToggle';
import { NotificationCenter } from '@/components/layout/NotificationCenter';
import { GlobalSearch } from '@/components/layout/GlobalSearch';
import { useAuthStore } from '@/store/auth';
import { SPOT_TRADE_HREF, isSpotTradePath } from '@/lib/tier1-canonical-routes';
import { MARKETS_HREF, ORDERS_HREF, WALLET_HREF, P2P_HREF, ROUTES, LEGACY_PATH_PREFIXES } from '@/lib/routes';

const MAIN_NAV = [
  { label: 'Markets', href: MARKETS_HREF },
  { label: 'Trade', href: SPOT_TRADE_HREF },
  { label: 'P2P', href: P2P_HREF },
  { label: 'Earn', href: ROUTES.earn },
];

function isMainNavActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  if (href === SPOT_TRADE_HREF) return isSpotTradePath(pathname);
  if (href === MARKETS_HREF) {
    return (
      pathname === MARKETS_HREF ||
      pathname.startsWith(`${MARKETS_HREF}/`) ||
      pathname.startsWith('/dashboard/markets')
    );
  }
  if (href === P2P_HREF) {
    return pathname.startsWith(P2P_HREF) || pathname.startsWith(LEGACY_PATH_PREFIXES.p2pV2);
  }
  if (href === ROUTES.earn) {
    return pathname.startsWith(ROUTES.earn) || pathname.startsWith(LEGACY_PATH_PREFIXES.dashboardEarn);
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

interface ExchangeHeaderProps {
  currentSymbol?: string;
  symbols?: string[];
  onSymbolSelect?: (symbol: string) => void;
  showPairSearch?: boolean;
}

export function ExchangeHeader({
  currentSymbol = '',
  symbols = [],
  onSymbolSelect,
  showPairSearch = false,
}: ExchangeHeaderProps) {
  const pathname = usePathname();
  const { accessToken } = useAuthStore();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const displaySymbol = currentSymbol ? currentSymbol.replace(/_/g, '/') : '';
  const filteredPairs = useMemo(() => {
    if (!searchQuery.trim()) return symbols.slice(0, 8);
    const q = searchQuery.toUpperCase().replace(/\//g, '_');
    return symbols.filter((s) => s.toUpperCase().includes(q)).slice(0, 10);
  }, [symbols, searchQuery]);

  useEffect(() => {
    if (searchOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [searchOpen]);

  return (
    <header className="sticky top-0 z-40 flex h-14 flex-shrink-0 items-center justify-between gap-3 border-b border-gray-200/80 bg-white/95 px-3 backdrop-blur-md supports-[backdrop-filter]:bg-white/80 dark:border-gray-800/80 dark:bg-[#181a20]/95 dark:supports-[backdrop-filter]:bg-[#181a20]/80">
      <div className="flex min-w-0 items-center gap-3 sm:gap-4">
        <button
          type="button"
          className="rounded-lg p-1.5 text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
          onClick={() => setMobileMenuOpen((o) => !o)}
          aria-label="Menu"
        >
          {mobileMenuOpen ? <X className="h-[18px] w-[18px]" /> : <Menu className="h-[18px] w-[18px]" />}
        </button>
        <Link href={ROUTES.home} className="flex flex-shrink-0 items-center gap-1.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-500">
            <span className="text-sm font-bold text-white">M</span>
          </div>
          <span className="hidden text-lg font-bold text-gray-900 dark:text-white sm:block">Methereum</span>
        </Link>

        <nav className="hidden items-center gap-0.5 lg:flex" aria-label="Trading">
          {MAIN_NAV.map((item) => {
            const isActive = isMainNavActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800/80 dark:hover:text-white'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>

      {showPairSearch && (
        <div className="flex-1 max-w-[420px] hidden md:block">
          <div className="relative">
            <div
              className="flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-gray-200 bg-gray-50/90 px-3 transition-colors hover:border-blue-400/60 dark:border-gray-700 dark:bg-gray-900/50 dark:hover:border-blue-500/40"
              onClick={() => setSearchOpen(true)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && setSearchOpen(true)}
            >
              <Search className="h-[18px] w-[18px] flex-shrink-0 text-gray-500 dark:text-gray-400" />
              <span className="truncate text-xs text-gray-900 dark:text-gray-100">
                {displaySymbol || 'Search pair (e.g. BTC/USDT)'}
              </span>
            </div>
            {searchOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  aria-hidden
                  onClick={() => setSearchOpen(false)}
                />
                <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-[#181a20]">
                  <div className="border-b border-gray-200 p-2 dark:border-gray-700">
                    <input
                      ref={searchInputRef}
                      type="text"
                      placeholder="Search BTC/USDT, ETH/USDT..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="h-9 w-full rounded-md border border-gray-200 bg-gray-50 px-3 text-xs text-gray-900 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-500"
                    />
                  </div>
                  <ul className="max-h-64 overflow-y-auto">
                    {filteredPairs.length === 0 ? (
                      <li className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">No pairs found</li>
                    ) : (
                      filteredPairs.map((sym) => (
                        <li key={sym}>
                          <button
                            type="button"
                            className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-xs text-gray-900 hover:bg-gray-50 dark:text-gray-100 dark:hover:bg-gray-800/80"
                            onClick={() => {
                              onSymbolSelect?.(sym);
                              setSearchOpen(false);
                              setSearchQuery('');
                            }}
                          >
                            <span className="font-mono">{sym.replace(/_/g, '/')}</span>
                          </button>
                        </li>
                      ))
                    )}
                  </ul>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-shrink-0 items-center gap-0.5 sm:gap-1">
        {!showPairSearch && (
          <div className="hidden sm:block">
            <GlobalSearch accessToken={accessToken} />
          </div>
        )}
        <Link
          href={ORDERS_HREF}
          className="rounded-lg p-2 text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white"
          aria-label="Orders"
          title="Orders"
        >
          <FileText className="h-[18px] w-[18px]" />
        </Link>
        <Link
          href={WALLET_HREF}
          className="rounded-lg p-2 text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white"
          aria-label="Wallet"
          title="Wallet"
        >
          <Wallet className="h-[18px] w-[18px]" />
        </Link>
        <ThemeToggle variant="icon" size="sm" />
        <NotificationCenter accessToken={accessToken} />
        <Link
          href={ROUTES.dashboard.account}
          className="rounded-lg p-2 text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white"
          aria-label="Profile"
        >
          <User className="h-[18px] w-[18px]" />
        </Link>
      </div>

      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/60 dark:bg-black/70"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="absolute bottom-0 left-0 top-0 flex w-64 flex-col gap-1 border-r border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-[#181a20]">
            {MAIN_NAV.map((item) => {
              const isActive = isMainNavActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-lg px-3 py-2.5 text-sm font-medium ${
                    isActive
                      ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400'
                      : 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800'
                  }`}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </header>
  );
}
