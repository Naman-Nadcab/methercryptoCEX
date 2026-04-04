'use client';

import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Search, User, Menu, X, FileText, Wallet,
  LayoutDashboard, Shield, Gift, Key, Receipt, Settings, LogOut, Copy, ChevronRight,
} from 'lucide-react';
import ThemeToggle from '@/components/ThemeToggle';
import { NotificationCenter } from '@/components/layout/NotificationCenter';
import { GlobalSearch } from '@/components/layout/GlobalSearch';
import { useAuthStore } from '@/store/auth';
import { useAuth } from '@/context/AuthContext';
import { SPOT_TRADE_HREF, isSpotTradePath } from '@/lib/tier1-canonical-routes';
import { MARKETS_HREF, ORDERS_HREF, WALLET_HREF, P2P_HREF, ROUTES, LEGACY_PATH_PREFIXES } from '@/lib/routes';
import { getApiBaseUrl } from '@/lib/getApiUrl';

const MAIN_NAV = [
  { label: 'Markets', href: MARKETS_HREF },
  { label: 'Trade', href: SPOT_TRADE_HREF },
  { label: 'P2P', href: P2P_HREF },
  { label: 'Earn', href: ROUTES.earn },
];

const USER_MENU = [
  { href: ROUTES.dashboard.root, label: 'Overview', icon: LayoutDashboard },
  { href: ROUTES.dashboard.account, label: 'Account', icon: User },
  { href: ROUTES.dashboard.security, label: 'Security', icon: Shield },
  { href: ROUTES.dashboard.referral, label: 'Referral', icon: Gift },
  { href: ROUTES.dashboard.api, label: 'API Management', icon: Key },
  { href: ROUTES.dashboard.feeRates, label: 'Fee Tier', icon: Receipt },
  { href: ROUTES.dashboard.preferences, label: 'Preferences', icon: Settings },
];

function isMainNavActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  if (href === SPOT_TRADE_HREF) return isSpotTradePath(pathname);
  if (href === MARKETS_HREF) {
    return pathname === MARKETS_HREF || pathname.startsWith(`${MARKETS_HREF}/`) || pathname.startsWith('/dashboard/markets');
  }
  if (href === P2P_HREF) return pathname.startsWith(P2P_HREF) || pathname.startsWith(LEGACY_PATH_PREFIXES.p2pV2);
  if (href === ROUTES.earn) return pathname.startsWith(ROUTES.earn) || pathname.startsWith(LEGACY_PATH_PREFIXES.dashboardEarn);
  return pathname === href || pathname.startsWith(`${href}/`);
}

function maskEmail(email: string): string {
  if (!email) return '***@****';
  const [local, domain] = email.split('@');
  if (!domain) return '***@****';
  return `${local.slice(0, 3)}**${local.length > 5 ? local.slice(-1) : ''}@****`;
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
  const router = useRouter();
  const { accessToken, user } = useAuthStore();
  const { setUnauthenticated } = useAuth();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [uidCopied, setUidCopied] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const displaySymbol = currentSymbol ? currentSymbol.replace(/_/g, '/') : '';
  const filteredPairs = useMemo(() => {
    if (!searchQuery.trim()) return symbols.slice(0, 8);
    const q = searchQuery.toUpperCase().replace(/\//g, '_');
    return symbols.filter((s) => s.toUpperCase().includes(q)).slice(0, 10);
  }, [symbols, searchQuery]);

  useEffect(() => {
    if (searchOpen && searchInputRef.current) searchInputRef.current.focus();
  }, [searchOpen]);

  useEffect(() => {
    if (!userMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [userMenuOpen]);

  const handleLogout = useCallback(async () => {
    setUserMenuOpen(false);
    const token = useAuthStore.getState().accessToken;
    const apiUrl = getApiBaseUrl();
    if (token && apiUrl !== undefined) {
      try { await fetch(`${apiUrl}/api/v1/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }); } catch { /* best effort */ }
    }
    setUnauthenticated();
    router.replace('/login');
  }, [setUnauthenticated, router]);

  const copyUID = useCallback(() => {
    if (user?.id) {
      navigator.clipboard.writeText(user.id);
      setUidCopied(true);
      setTimeout(() => setUidCopied(false), 2000);
    }
  }, [user?.id]);

  return (
    <header className="sticky top-0 z-40 flex h-14 flex-shrink-0 items-center justify-between gap-3 border-b border-[#2b2f36] bg-[#181a20] px-3">
      <div className="flex min-w-0 items-center gap-3 sm:gap-4">
        <button
          type="button"
          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:hidden"
          onClick={() => setMobileMenuOpen((o) => !o)}
          aria-label="Menu"
        >
          {mobileMenuOpen ? <X className="h-[18px] w-[18px]" /> : <Menu className="h-[18px] w-[18px]" />}
        </button>
        <Link href={ROUTES.home} className="flex flex-shrink-0 items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary">
            <span className="text-sm font-bold text-primary-foreground">M</span>
          </div>
          <span className="hidden text-lg font-bold sm:block">Methereum</span>
        </Link>

        <nav className="hidden items-center gap-1 lg:flex" aria-label="Trading">
          {MAIN_NAV.map((item) => {
            const isActive = isMainNavActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>

      {showPairSearch && (
        <div className="hidden max-w-[420px] flex-1 md:block">
          <div className="relative">
            <div
              className="flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-[#2b2f36] bg-[#2b2f36]/50 px-3 transition-colors hover:border-[#f0b90b]/40"
              onClick={() => setSearchOpen(true)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && setSearchOpen(true)}
            >
              <Search className="h-[18px] w-[18px] flex-shrink-0 text-muted-foreground" />
              <span className="truncate text-xs">{displaySymbol || 'Search pair (e.g. BTC/USDT)'}</span>
            </div>
            {searchOpen && (
              <>
                <div className="fixed inset-0 z-40" aria-hidden onClick={() => setSearchOpen(false)} />
                <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-xl border border-border bg-card shadow-xl">
                  <div className="border-b border-border p-2">
                    <input
                      ref={searchInputRef}
                      type="text"
                      placeholder="Search BTC/USDT, ETH/USDT..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="h-9 w-full rounded-lg border border-border bg-accent px-3 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>
                  <ul className="max-h-64 overflow-y-auto">
                    {filteredPairs.length === 0 ? (
                      <li className="px-4 py-3 text-xs text-muted-foreground">No pairs found</li>
                    ) : (
                      filteredPairs.map((sym) => (
                        <li key={sym}>
                          <button
                            type="button"
                            className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-xs hover:bg-accent"
                            onClick={() => { onSymbolSelect?.(sym); setSearchOpen(false); setSearchQuery(''); }}
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
          <div className="hidden sm:block"><GlobalSearch accessToken={accessToken} /></div>
        )}
        <ThemeToggle variant="icon" size="sm" />
        {accessToken ? (
          <>
            <Link href={ORDERS_HREF} className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" aria-label="Orders" title="Orders">
              <FileText className="h-[18px] w-[18px]" />
            </Link>
            <Link href={WALLET_HREF} className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" aria-label="Wallet" title="Wallet">
              <Wallet className="h-[18px] w-[18px]" />
            </Link>
            <NotificationCenter accessToken={accessToken} />

            {/* User profile dropdown */}
            <div className="relative" ref={userMenuRef}>
              <button
                type="button"
                onClick={() => setUserMenuOpen((o) => !o)}
                className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                aria-label="User menu"
              >
                <User className="h-[18px] w-[18px]" />
              </button>

              {userMenuOpen && (
                <div className="absolute right-0 top-full z-50 mt-1.5 w-72 overflow-hidden rounded-xl border border-border bg-card shadow-xl animate-in fade-in slide-in-from-top-2 duration-150">
                  {/* User info */}
                  <div className="p-4 border-b border-border">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent">
                        <User className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{maskEmail(user?.email || '')}</p>
                        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <span>UID: {user?.id?.slice(0, 8) || '******'}</span>
                          <button
                            type="button"
                            onClick={copyUID}
                            className="p-0.5 hover:text-primary"
                            aria-label={uidCopied ? 'Copied' : 'Copy user ID'}
                          >
                            {uidCopied ? <span className="text-[#0ecb81] text-[10px]">✓</span> : <Copy className="h-3 w-3" />}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Menu items */}
                  <div className="p-1.5 max-h-64 overflow-y-auto">
                    {USER_MENU.map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setUserMenuOpen(false)}
                        className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent"
                      >
                        <item.icon className="h-4 w-4 text-muted-foreground" />
                        {item.label}
                      </Link>
                    ))}
                  </div>

                  {/* Logout */}
                  <div className="p-1.5 border-t border-border">
                    <button
                      type="button"
                      onClick={handleLogout}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-destructive transition-colors hover:bg-destructive/10"
                    >
                      <LogOut className="h-4 w-4" />
                      Logout
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex items-center gap-1.5">
            <Link href="/login" className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
              Log In
            </Link>
            <Link href={ROUTES.signup} className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">
              Register
            </Link>
          </div>
        )}
      </div>

      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileMenuOpen(false)} />
          <div className="absolute bottom-0 left-0 top-0 flex w-64 flex-col gap-1 border-r border-border bg-card p-4">
            {MAIN_NAV.map((item) => {
              const isActive = isMainNavActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-lg px-3 py-2.5 text-sm font-medium ${isActive ? 'text-primary bg-primary/5' : 'text-foreground hover:bg-accent'}`}
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
