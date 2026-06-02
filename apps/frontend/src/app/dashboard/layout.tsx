'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuthStore } from '@/store/auth';
import { useAuth } from '@/context/AuthContext';
import RequireAuth from '@/components/RequireAuth';
import Link from 'next/link';
import {
  LayoutDashboard,
  User,
  Gift,
  Users,
  Key,
  Receipt,
  ChevronDown,
  Bell,
  Menu,
  X,
  LogOut,
  Wallet,
  ArrowDownUp,
  Copy,
  ChevronRight,
  TrendingUp,
  CreditCard,
  Shield,
  Download,
  Settings,
  FileText,
  HelpCircle,
} from 'lucide-react';
import SessionManager from '@/components/SessionManager';
import ThemeToggle from '@/components/ThemeToggle';
import { toast } from '@/components/ui/toaster';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { useBalancesSummary, useBalancesByAccount } from '@/lib/balances';
import { MobileBottomNav } from '@/components/layout/MobileBottomNav';
import { SPOT_TRADE_HREF } from '@/lib/tier1-canonical-routes';
import {
  MARKETS_HREF,
  ORDERS_HREF,
  WALLET_HREF,
  P2P_HREF,
  walletPath,
  ROUTES,
  LEGACY_PATH_PREFIXES,
} from '@/lib/routes';
import { useDisplayCurrency } from '@/context/DisplayCurrencyProvider';

const MOBILE_NAV_PAD = 'pb-[calc(3.75rem+env(safe-area-inset-bottom,0px))] md:pb-0';

const navItems = [
  { label: 'Markets', href: MARKETS_HREF },
  { label: 'Trade', href: SPOT_TRADE_HREF },
  { label: 'P2P', href: P2P_HREF },
  { label: 'Earn', href: ROUTES.earn },
];

function isNavItemActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  if (pathname === href) return true;
  if (href === ROUTES.dashboard.root) return false;
  if (
    href === MARKETS_HREF &&
    (pathname.startsWith(MARKETS_HREF) || pathname.startsWith('/dashboard/markets'))
  ) return true;
  if (href === SPOT_TRADE_HREF) {
    return pathname === SPOT_TRADE_HREF || pathname === '/dashboard/spot';
  }
  if (
    href === ORDERS_HREF &&
    (pathname.startsWith('/orders') || pathname.startsWith('/dashboard/orders'))
  ) return true;
  if (
    href === WALLET_HREF &&
    (pathname.startsWith('/wallet') ||
      pathname.startsWith('/dashboard/assets') ||
      pathname.startsWith('/dashboard/deposit') ||
      pathname.startsWith('/dashboard/withdraw') ||
      pathname.startsWith('/dashboard/transfer'))
  ) return true;
  if (
    href === ROUTES.earn &&
    (pathname.startsWith(ROUTES.earn) || pathname.startsWith(LEGACY_PATH_PREFIXES.dashboardEarn))
  ) return true;
  if (href === P2P_HREF && (pathname.startsWith(P2P_HREF) || pathname.startsWith(LEGACY_PATH_PREFIXES.p2pV2))) return true;
  return pathname.startsWith(`${href}/`);
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, accessToken, _hasHydrated } = useAuthStore();
  const { displayCurrency, formatFromUsdt } = useDisplayCurrency();
  const { setUnauthenticated } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<{ id: string; title: string; message: string; is_read: boolean; created_at: string; notification_type: string }[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationsError, setNotificationsError] = useState<string | null>(null);
  const [markingNotificationsRead, setMarkingNotificationsRead] = useState(false);
  const [uidCopied, setUidCopied] = useState(false);
  const [kycVerified, setKycVerified] = useState(false);
  const [kycLoading, setKycLoading] = useState(true);
  const [kycBannerDismissed, setKycBannerDismissed] = useState(false);

  const { data: balanceSummary } = useBalancesSummary(!!_hasHydrated && !!accessToken);
  const { data: balancesByAccount } = useBalancesByAccount(!!_hasHydrated && !!accessToken);
  const totalEquityUsd = (balanceSummary?.fundingBalance?.totalUsd ?? 0) + (balanceSummary?.tradingBalance?.totalUsd ?? 0);
  const totalEquityBtc = (balanceSummary?.fundingBalance?.totalBtc ?? 0) + (balanceSummary?.tradingBalance?.totalBtc ?? 0);
  const previewBalances = Array.isArray(balancesByAccount) ? balancesByAccount.slice(0, 6) : [];

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setKycBannerDismissed(window.sessionStorage.getItem('kyc_banner_dismissed') === '1');
  }, []);

  useEffect(() => {
    if (!_hasHydrated || !accessToken) {
      setKycVerified(false);
      setKycLoading(false);
      return;
    }
    (async () => {
      setKycLoading(true);
      try {
        const res = await fetch(`${getApiBaseUrl()}/api/v1/wallet/kyc-status`, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (res.ok) {
          const data = await res.json();
          if (data.success) setKycVerified(Boolean(data.data.verified));
        }
      } catch {
        setKycVerified(false);
      } finally { setKycLoading(false); }
    })();
  }, [_hasHydrated, accessToken]);

  const toggleDropdown = (name: string) => setActiveDropdown((d) => (d === name ? null : name));

  const fetchNotifications = async () => {
    if (!accessToken) return;
    setNotificationsLoading(true);
    setNotificationsError(null);
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/v1/user/notifications?limit=20`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!res.ok) {
        throw new Error(`Notifications request failed (${res.status})`);
      }
      const data = await res.json();
      if (data?.success && data?.data) {
        setNotifications(data.data.notifications || []);
        setUnreadCount(data.data.unreadCount ?? 0);
        return;
      }
      throw new Error(data?.error?.message || 'Unable to fetch notifications.');
    } catch {
      setNotificationsError('Unable to fetch notifications right now.');
      toast({ title: 'Notifications unavailable', description: 'Unable to fetch notifications. Try again.', variant: 'destructive' });
    } finally {
      setNotificationsLoading(false);
    }
  };

  const markAllRead = async () => {
    if (!accessToken) return;
    setMarkingNotificationsRead(true);
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/v1/user/notifications/read-all`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } });
      if (!res.ok) {
        throw new Error(`Mark read failed (${res.status})`);
      }
      const result = await res.json();
      if (!result?.success) {
        throw new Error(result?.error?.message || 'Could not mark notifications as read.');
      }
      setUnreadCount(0);
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    } catch {
      toast({ title: 'Action failed', description: 'Could not mark notifications as read.', variant: 'destructive' });
    } finally {
      setMarkingNotificationsRead(false);
    }
  };

  const handleLogout = async () => {
    const token = useAuthStore.getState().accessToken;
    const apiUrl = getApiBaseUrl();
    if (token && apiUrl !== undefined) {
      try { await fetch(`${apiUrl}/api/v1/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }); } catch { /* best effort */ }
    }
    setUnauthenticated();
    router.replace('/login');
  };

  const maskEmail = (email: string) => {
    if (!email) return '***@****';
    const [local, domain] = email.split('@');
    if (!domain) return '***@****';
    return `${local.slice(0, 3)}**${local.length > 5 ? local.slice(-1) : ''}@****`;
  };

  const copyUID = () => {
    if (user?.id) {
      navigator.clipboard.writeText(user.id);
      setUidCopied(true);
      toast({ title: 'Copied', description: 'User ID copied to clipboard', variant: 'default' });
      setTimeout(() => setUidCopied(false), 2000);
    }
  };

  useEffect(() => {
    if (!activeDropdown) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.hdr-dropdown') && !target.closest('.hdr-trigger')) setActiveDropdown(null);
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [activeDropdown]);

  const isExchangeFullScreen = pathname === '/dashboard/spot' || pathname?.startsWith('/dashboard/p2p');
  const isDashboardSpot = pathname === '/dashboard/spot';

  if (isExchangeFullScreen) {
    return (
      <RequireAuth>
        <SessionManager redirectPath="/login" />
        <div className="min-h-screen bg-background">
          <main
            id="main-content"
            tabIndex={-1}
            className={
              isDashboardSpot
                ? `flex min-h-screen w-full flex-col overflow-y-auto overflow-x-hidden ${MOBILE_NAV_PAD}`
                : `flex h-screen w-full flex-col overflow-hidden ${MOBILE_NAV_PAD}`
            }
          >
            {children}
          </main>
          <MobileBottomNav />
        </div>
      </RequireAuth>
    );
  }

  return (
    <RequireAuth>
      <SessionManager redirectPath="/login" />
      <div className="min-h-screen bg-background">
        <a
          href="#main-content"
          className="fixed left-4 top-4 z-[200] px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg -translate-y-16 focus:translate-y-0 outline-none transition-transform duration-200"
        >
          Skip to main content
        </a>

        {/* Binance-style top header */}
        <header className="sticky top-0 z-50 border-b border-border bg-card/95 backdrop-blur-md supports-[backdrop-filter]:bg-card/80">
          <div className="flex items-center justify-between h-14 px-4">
            {/* Left: Logo + Nav */}
            <div className="flex items-center gap-4">
              <button className="lg:hidden p-1.5 hover:bg-accent rounded-lg" onClick={() => setMobileMenuOpen(!mobileMenuOpen)} aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}>
                {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>

              <Link href={ROUTES.home} className="flex items-center gap-2">
                <div className="w-7 h-7 bg-primary rounded-lg flex items-center justify-center">
                  <span className="text-primary-foreground font-bold text-sm">M</span>
                </div>
                <span className="text-lg font-bold text-foreground hidden sm:block">Methereum</span>
              </Link>

              <nav className="hidden lg:flex items-center gap-1" aria-label="Primary">
                {navItems.map((item) => {
                  const active = isNavItemActive(pathname ?? null, item.href);
                  return (
                    <Link
                      key={item.label}
                      href={item.href}
                      className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${active ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </nav>
            </div>

            {/* Right: Action buttons */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => toggleDropdown('deposit')}
                className="hdr-trigger hidden sm:flex items-center gap-1 px-3 py-1.5 bg-primary text-primary-foreground text-xs font-semibold rounded-lg hover:bg-primary/85 transition-colors"
              >
                Deposit
                <ChevronDown className={`w-3 h-3 transition-transform ${activeDropdown === 'deposit' ? 'rotate-180' : ''}`} />
              </button>

              <button onClick={() => toggleDropdown('wallet')} className="hdr-trigger hidden sm:flex items-center gap-1 px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors">
                <Wallet className="w-4 h-4" /> <span className="hidden md:inline">Wallet</span>
                <ChevronDown className={`w-3 h-3 transition-transform ${activeDropdown === 'wallet' ? 'rotate-180' : ''}`} />
              </button>

              <button onClick={() => toggleDropdown('orders')} className="hdr-trigger hidden sm:flex items-center gap-1 px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors">
                <FileText className="w-4 h-4" /> <span className="hidden md:inline">Orders</span>
                <ChevronDown className={`w-3 h-3 transition-transform ${activeDropdown === 'orders' ? 'rotate-180' : ''}`} />
              </button>

              <button
                aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
                onClick={() => { toggleDropdown('notifications'); if (activeDropdown !== 'notifications') fetchNotifications(); }}
                className="hdr-trigger relative p-2 hover:bg-accent rounded-lg"
              >
                <Bell className="w-[18px] h-[18px] text-muted-foreground" />
                {unreadCount > 0 && (
                  <span className="absolute top-1 right-1 min-w-[16px] h-[16px] px-1 flex items-center justify-center bg-destructive text-white text-[9px] font-medium rounded-full">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </button>

              <ThemeToggle variant="icon" size="sm" />

              <button
                aria-label="Open user menu"
                onClick={() => toggleDropdown('user')}
                className="hdr-trigger p-2 hover:bg-accent rounded-lg"
              >
                <User className="w-[18px] h-[18px] text-muted-foreground" />
              </button>
            </div>

            {/* Dropdowns */}
            {activeDropdown === 'deposit' && (
              <div className="hdr-dropdown fixed right-4 top-14 w-72 bg-card border border-border rounded-xl shadow-xl z-[100] overflow-hidden animate-fade-in">
                <div className="p-3 border-b border-border">
                  <p className="text-sm font-semibold">Select Payment Method</p>
                </div>
                <div className="p-2 space-y-0.5">
                  <p className="px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Already have crypto</p>
                  <Link href={walletPath.depositCrypto} className="flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-accent rounded-lg" onClick={() => setActiveDropdown(null)}>
                    <div className="w-8 h-8 bg-primary/10 rounded-lg flex items-center justify-center"><Wallet className="w-4 h-4 text-primary" /></div>
                    <div><p className="font-medium text-foreground">Deposit Crypto</p><p className="text-xs text-muted-foreground">One-click from a verified address</p></div>
                  </Link>
                  <Link href={P2P_HREF} className="flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-accent rounded-lg" onClick={() => setActiveDropdown(null)}>
                    <div className="w-8 h-8 bg-buy/10 rounded-lg flex items-center justify-center"><Users className="w-4 h-4 text-buy" /></div>
                    <div><p className="font-medium text-foreground">P2P Trading</p><p className="text-xs text-muted-foreground">Zero Fees</p></div>
                  </Link>
                  <p className="px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mt-1">Don&apos;t have crypto</p>
                  <Link href={walletPath.convert} className="flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-accent rounded-lg" onClick={() => setActiveDropdown(null)}>
                    <div className="w-8 h-8 bg-blue-500/10 rounded-lg flex items-center justify-center"><CreditCard className="w-4 h-4 text-primary" /></div>
                    <div><p className="font-medium text-foreground">Buy with INR</p><p className="text-xs text-muted-foreground">Buy with card or bank transfer</p></div>
                  </Link>
                </div>
              </div>
            )}

            {activeDropdown === 'wallet' && (
              <div className="hdr-dropdown fixed right-4 top-14 w-80 bg-card border border-border rounded-xl shadow-xl z-[100] overflow-hidden animate-fade-in">
                <Link href={WALLET_HREF} onClick={() => setActiveDropdown(null)} className="block p-4 hover:bg-accent/50 transition-colors">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-muted-foreground">Estimated Balance</span>
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <p className="text-2xl font-bold font-mono tabular-nums">
                    {Number.isFinite(totalEquityUsd) ? formatFromUsdt(totalEquityUsd, 2) : '—'}{' '}
                    <span className="text-sm font-normal text-muted-foreground">{displayCurrency}</span>
                  </p>
                  <p className="text-sm text-muted-foreground mt-0.5 font-mono tabular-nums">≈ {Number.isFinite(totalEquityBtc) ? totalEquityBtc.toFixed(8) : '—'} BTC</p>
                  {previewBalances.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-border space-y-1">
                      {previewBalances.map((row) => (
                        <div key={row.symbol} className="flex justify-between text-xs">
                          <span className="text-muted-foreground">{row.symbol}</span>
                          <span className="font-mono tabular-nums font-medium">{row.total}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </Link>
                <div className="p-3 border-t border-border">
                  <div className="grid grid-cols-3 gap-2">
                    <Link href={walletPath.depositCrypto} onClick={() => setActiveDropdown(null)} className="flex flex-col items-center gap-1 px-2 py-2 bg-primary text-primary-foreground text-xs font-medium rounded-lg hover:bg-primary/85 transition-colors">
                      <Download className="w-4 h-4" /> Deposit
                    </Link>
                    <Link href={walletPath.withdrawCrypto} onClick={() => setActiveDropdown(null)} className="flex flex-col items-center gap-1 px-2 py-2 bg-accent text-foreground text-xs font-medium rounded-lg hover:bg-accent/80 transition-colors">
                      <ArrowDownUp className="w-4 h-4" /> Withdraw
                    </Link>
                    <Link href={walletPath.transfer} onClick={() => setActiveDropdown(null)} className="flex flex-col items-center gap-1 px-2 py-2 bg-accent text-foreground text-xs font-medium rounded-lg hover:bg-accent/80 transition-colors">
                      <ArrowDownUp className="w-4 h-4 rotate-90" /> Transfer
                    </Link>
                  </div>
                </div>
              </div>
            )}

            {activeDropdown === 'orders' && (
              <div className="hdr-dropdown fixed right-4 top-14 w-56 bg-card border border-border rounded-xl shadow-xl z-[100] overflow-hidden animate-fade-in">
                <div className="p-1.5">
                  {[
                    { href: ORDERS_HREF, label: 'All Orders', icon: FileText },
                    { href: `${ORDERS_HREF}/spot`, label: 'Spot Orders', icon: TrendingUp },
                    { href: `${ORDERS_HREF}/p2p`, label: 'P2P Orders', icon: Users },
                    { href: `${ORDERS_HREF}/history`, label: 'Order History', icon: FileText },
                  ].map((item) => (
                    <Link key={item.href} href={item.href} onClick={() => setActiveDropdown(null)} className="flex items-center gap-3 px-3 py-2 text-sm text-foreground hover:bg-accent rounded-lg">
                      <item.icon className="w-4 h-4 text-muted-foreground" /> {item.label}
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {activeDropdown === 'notifications' && (
              <div className="hdr-dropdown fixed right-4 top-14 w-80 bg-card border border-border rounded-xl shadow-xl z-[100] overflow-hidden animate-fade-in">
                <div className="p-3 border-b border-border flex items-center justify-between">
                  <p className="text-sm font-semibold">Notifications</p>
                  {unreadCount > 0 && (
                    <button
                      type="button"
                      disabled={markingNotificationsRead}
                      onClick={markAllRead}
                      className="text-xs text-primary hover:underline disabled:opacity-50"
                    >
                      {markingNotificationsRead ? 'Marking…' : 'Mark all read'}
                    </button>
                  )}
                </div>
                <div className="max-h-80 overflow-y-auto">
                  {notificationsLoading ? (
                    <div className="p-6 text-center text-sm text-muted-foreground">Loading notifications…</div>
                  ) : notificationsError ? (
                    <div className="p-6 text-center">
                      <p className="text-sm text-muted-foreground">{notificationsError}</p>
                      <button
                        type="button"
                        onClick={() => void fetchNotifications()}
                        className="mt-2 text-xs font-medium text-primary hover:underline"
                      >
                        Retry
                      </button>
                    </div>
                  ) : notifications.length === 0 ? (
                    <div className="p-6 text-center text-sm text-muted-foreground">No notifications yet.</div>
                  ) : notifications.map((n) => (
                    <div key={n.id} className={`p-4 border-b border-border last:border-0 ${!n.is_read ? 'bg-primary/5' : ''}`}>
                      <p className="text-sm font-medium">{n.title}</p>
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{n.message}</p>
                      <p className="text-[10px] text-muted-foreground mt-2">{new Date(n.created_at).toLocaleString()}</p>
                    </div>
                  ))}
                </div>
                <div className="p-2 border-t border-border">
                  <Link href={ROUTES.dashboard.announcements} onClick={() => setActiveDropdown(null)} className="block text-center text-sm text-primary hover:underline py-2">View all</Link>
                </div>
              </div>
            )}

            {activeDropdown === 'user' && (
              <div className="hdr-dropdown fixed right-4 top-14 w-72 bg-card border border-border rounded-xl shadow-xl z-[100] overflow-hidden animate-fade-in">
                <div className="p-4 border-b border-border">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-accent rounded-full flex items-center justify-center">
                      <User className="w-5 h-5 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">{maskEmail(user?.email || '')}</span>
                      </div>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <span>UID: {user?.id?.slice(0, 8) || '******'}</span>
                        <button onClick={copyUID} className="p-0.5 hover:text-primary" aria-label={uidCopied ? 'Copied' : 'Copy user ID'}>
                          {uidCopied ? <span className="text-buy">✓</span> : <Copy className="w-3 h-3" />}
                        </button>
                      </div>
                    </div>
                  </div>
                  {!kycLoading && !kycVerified && (
                    <Link href={ROUTES.dashboard.identity} onClick={() => setActiveDropdown(null)} className="flex items-center justify-between mt-3 px-3 py-2 bg-primary text-primary-foreground text-sm rounded-lg hover:bg-primary/85 transition-colors">
                      <span>Complete Verification</span><ChevronRight className="w-4 h-4" />
                    </Link>
                  )}
                </div>
                <div className="p-1.5 max-h-64 overflow-y-auto">
                  {[
                    { href: ROUTES.dashboard.root, label: 'Overview', icon: LayoutDashboard },
                    { href: ROUTES.dashboard.account, label: 'Account', icon: User },
                    { href: ROUTES.dashboard.security, label: 'Security', icon: Shield },
                  { href: '/dashboard/support', label: 'Support', icon: HelpCircle },
                    { href: ROUTES.dashboard.referral, label: 'Referral', icon: Gift },
                    { href: ROUTES.dashboard.api, label: 'API Management', icon: Key },
                    { href: ROUTES.dashboard.feeRates, label: 'Fee Tier', icon: Receipt },
                    { href: ROUTES.dashboard.preferences, label: 'Preferences', icon: Settings },
                  ].map((item) => (
                    <Link key={item.href} href={item.href} onClick={() => setActiveDropdown(null)} className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-accent rounded-lg">
                      <item.icon className="w-4 h-4 text-muted-foreground" /> {item.label}
                    </Link>
                  ))}
                </div>
                <div className="p-1.5 border-t border-border">
                  <button onClick={handleLogout} className="w-full flex items-center gap-3 px-3 py-2 text-sm text-destructive hover:bg-destructive/10 rounded-lg">
                    <LogOut className="w-4 h-4" /> Logout
                  </button>
                </div>
              </div>
            )}
          </div>

          {!kycLoading && !kycVerified && !kycBannerDismissed && (
            <div className="flex items-center justify-between px-4 py-2 bg-primary/5 border-t border-border">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Complete Identity Verification to continue using platform services.</span>
                <Link href={ROUTES.dashboard.identity} className="text-primary font-medium hover:underline">Verify Now</Link>
              </div>
              <button
                onClick={() => {
                  setKycBannerDismissed(true);
                  if (typeof window !== 'undefined') window.sessionStorage.setItem('kyc_banner_dismissed', '1');
                }}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Dismiss"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
        </header>

        {/* Mobile menu overlay */}
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div className="absolute inset-0 bg-black/60" onClick={() => setMobileMenuOpen(false)} />
            <aside className="absolute left-0 top-0 bottom-0 w-64 bg-card border-r border-border overflow-y-auto animate-slide-up">
              <div className="p-4 border-b border-border flex items-center gap-3">
                <div className="w-8 h-8 bg-accent rounded-full flex items-center justify-center"><User className="w-4 h-4 text-muted-foreground" /></div>
                <div>
                  <p className="text-sm font-medium">{maskEmail(user?.email || '')}</p>
                  <p className="text-[10px] text-muted-foreground">UID: {user?.id?.slice(0, 8)}</p>
                </div>
              </div>
              <nav className="py-2">
                {navItems.map((item) => {
                  const active = isNavItemActive(pathname ?? null, item.href);
                  return (
                    <Link key={item.label} href={item.href} onClick={() => setMobileMenuOpen(false)} className={`block px-4 py-3 text-sm font-medium ${active ? 'text-primary bg-primary/5' : 'text-foreground hover:bg-accent'}`}>
                      {item.label}
                    </Link>
                  );
                })}
                <div className="my-2 mx-4 border-t border-border" />
                {[
                  { href: ROUTES.dashboard.root, label: 'Dashboard', icon: LayoutDashboard },
                  { href: WALLET_HREF, label: 'Wallet', icon: Wallet },
                  { href: ORDERS_HREF, label: 'Orders', icon: FileText },
                  { href: ROUTES.dashboard.account, label: 'Account', icon: User },
                  { href: ROUTES.dashboard.security, label: 'Security', icon: Shield },
                  { href: '/dashboard/support', label: 'Support', icon: HelpCircle },
                  { href: ROUTES.dashboard.referral, label: 'Referral', icon: Gift },
                  { href: ROUTES.dashboard.feeRates, label: 'Fees', icon: Receipt },
                ].map((item) => (
                  <Link key={item.href} href={item.href} onClick={() => setMobileMenuOpen(false)} className="flex items-center gap-3 px-4 py-2.5 text-sm text-muted-foreground hover:text-foreground hover:bg-accent">
                    <item.icon className="w-4 h-4" /> {item.label}
                  </Link>
                ))}
                <div className="my-2 mx-4 border-t border-border" />
                <button onClick={handleLogout} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-destructive hover:bg-destructive/10">
                  <LogOut className="w-4 h-4" /> Logout
                </button>
              </nav>
            </aside>
          </div>
        )}

        {/* Main content — no sidebar, full width */}
        <main id="main-content" tabIndex={-1} className={`min-h-[calc(100vh-3.5rem)] ${MOBILE_NAV_PAD}`}>
          <div className="dashboard-page-wrap mx-auto max-w-[1200px]">
            {children}
          </div>
        </main>

        <MobileBottomNav />
      </div>
    </RequireAuth>
  );
}
