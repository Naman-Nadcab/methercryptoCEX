'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useAdminAuthStore } from '@/store/admin-auth';
import {
  LayoutDashboard,
  Users,
  Shield,
  Wallet,
  ArrowDownToLine,
  ArrowUpFromLine,
  TrendingUp,
  Repeat,
  Receipt,
  Lock,
  BarChart3,
  Settings,
  FileText,
  HeadphonesIcon,
  ChevronDown,
  ChevronRight,
  X,
  AlertTriangle,
  Banknote,
} from 'lucide-react';
import { StatusBadge } from '@/components/admin/control-plane';
import { getApiBaseUrl } from '@/lib/getApiUrl';

interface MenuItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  href?: string;
  badge?: number | string;
  badgeColor?: string;
  children?: {
    label: string;
    href: string;
    badge?: number | string;
    badgeKey?: string;
  }[];
}

/**
 * Mandatory Binance-grade admin sidebar hierarchy.
 * Do not remove or restructure — only extend.
 */
const menuItems: MenuItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="w-4 h-4" />, href: '/admin/dashboard' },
  {
    id: 'users',
    label: 'Users',
    icon: <Users className="w-4 h-4" />,
    children: [
      { label: 'User List', href: '/admin/users' },
      { label: 'User Detail', href: '/admin/users/detail' },
      { label: 'User Risk Profile', href: '/admin/users/risk' },
      { label: 'User Activity / Sessions', href: '/admin/security/sessions' },
    ],
  },
  {
    id: 'kyc',
    label: 'KYC / Identity',
    icon: <Shield className="w-4 h-4" />,
    children: [
      { label: 'Pending Verifications', href: '/admin/kyc/pending' },
      { label: 'Approved / Rejected', href: '/admin/kyc/approved' },
      { label: 'KYC Audit Trail', href: '/admin/kyc/audit' },
      { label: 'KYC Settings', href: '/admin/kyc/settings' },
    ],
  },
  {
    id: 'wallets',
    label: 'Wallet & Funds',
    icon: <Wallet className="w-4 h-4" />,
    children: [
      { label: 'Deposits', href: '/admin/wallets/deposits' },
      { label: 'Withdrawals', href: '/admin/wallets/withdrawals' },
      { label: 'Manual Adjustments', href: '/admin/wallets/adjust' },
      { label: 'Balance Summary', href: '/admin/wallets/funds-summary' },
      { label: 'Hot / Cold Wallet Monitor', href: '/admin/wallets/hot' },
      { label: 'Reconciliation (Super Admin)', href: '/admin/wallets/reconciliation' },
      { label: 'Balance Ledger', href: '/admin/wallets/ledger/balance' },
      { label: 'Settlement Ledger', href: '/admin/wallets/ledger/settlement' },
    ],
  },
  {
    id: 'spot',
    label: 'Spot Markets',
    icon: <TrendingUp className="w-4 h-4" />,
    children: [
      { label: 'Market Pairs', href: '/admin/trading/spot-markets' },
      { label: 'Order Monitoring', href: '/admin/trading/orders' },
      { label: 'Trade History', href: '/admin/trading/trade-history' },
      { label: 'MM Risk Monitor', href: '/admin/monitoring/mm-risk' },
      { label: 'Circuit Breakers', href: '/admin/trading/circuit-breakers' },
      { label: 'Fee Controls', href: '/admin/trading/fees' },
      { label: 'Market Halt Controls', href: '/admin/trading/market-control' },
    ],
  },
  {
    id: 'p2p',
    label: 'P2P System',
    icon: <Repeat className="w-4 h-4" />,
    children: [
      { label: 'P2P Overview', href: '/admin/p2p' },
      { label: 'Active Trades', href: '/admin/p2p/trades' },
      { label: 'Orders / Ads', href: '/admin/p2p/orders' },
      { label: 'Escrow Monitor', href: '/admin/p2p/escrows' },
      { label: 'Disputes', href: '/admin/p2p/disputes' },
      { label: 'Merchants', href: '/admin/p2p/merchants' },
      { label: 'Payment Methods', href: '/admin/p2p/payment-methods' },
      { label: 'P2P Settings', href: '/admin/p2p/settings' },
    ],
  },
  {
    id: 'compliance',
    label: 'Compliance / AML',
    icon: <AlertTriangle className="w-4 h-4" />,
    children: [
      { label: 'AML Alerts', href: '/admin/compliance/alerts' },
      { label: 'Alert Detail', href: '/admin/compliance/alert' },
      { label: 'STR / CTR Reports', href: '/admin/compliance/reports' },
      { label: 'Case Management', href: '/admin/compliance/cases' },
      { label: 'AML Dashboard', href: '/admin/security/compliance' },
    ],
  },
  {
    id: 'security',
    label: 'Security & Risk',
    icon: <Lock className="w-4 h-4" />,
    children: [
      { label: 'Audit Logs (Immutable)', href: '/admin/security/audit-logs' },
      { label: 'Active Sessions', href: '/admin/security/sessions' },
      { label: 'IP / Device Risk Rules', href: '/admin/security/ip-rules' },
      { label: 'Withdrawal Risk Monitor', href: '/admin/security/withdrawals' },
      { label: 'Risk Rules', href: '/admin/security/risk-rules' },
      { label: 'Security Dashboard', href: '/admin/security/dashboard' },
    ],
  },
  {
    id: 'system',
    label: 'System Controls',
    icon: <Settings className="w-4 h-4" />,
    children: [
      { label: 'System Settings', href: '/admin/settings' },
      { label: 'API Settings', href: '/admin/system/api-settings' },
      { label: 'Feature Flags', href: '/admin/settings/features' },
      { label: 'Blockchain / Token Config', href: '/admin/settings/blockchain' },
      { label: 'Counters / Limits', href: '/admin/monitoring/counters' },
    ],
  },
  {
    id: 'finance',
    label: 'Finance & Fees',
    icon: <Banknote className="w-4 h-4" />,
    children: [
      { label: 'Fee Configuration', href: '/admin/fees/trading' },
      { label: 'Revenue Metrics', href: '/admin/reports/financial' },
      { label: 'Referral System', href: '/admin/referrals/campaigns' },
    ],
  },
  {
    id: 'support',
    label: 'Support & Reports',
    icon: <HeadphonesIcon className="w-4 h-4" />,
    children: [
      { label: 'Support Tickets', href: '/admin/support' },
      { label: 'Reports / Exports', href: '/admin/reports' },
      { label: 'Notifications', href: '/admin/notifications' },
    ],
  },
  {
    id: 'admins',
    label: 'Admin Users',
    icon: <FileText className="w-4 h-4" />,
    children: [
      { label: 'Roles & Permissions', href: '/admin/admins/roles' },
      { label: 'Admin List', href: '/admin/admins' },
    ],
  },
];

interface SidebarProps {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
}

export default function Sidebar({ isOpen, setIsOpen }: SidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { accessToken } = useAdminAuthStore();
  const [expandedMenus, setExpandedMenus] = useState<string[]>(['dashboard']);
  const [withdrawalStats, setWithdrawalStats] = useState<{ pending_approval?: number } | null>(null);
  const [tradingHalted, setTradingHalted] = useState<boolean | null>(null);

  // Defer non-critical badge fetches so admin shell paints immediately
  useEffect(() => {
    if (!accessToken) return;
    const apiUrl = getApiBaseUrl();
    const t = setTimeout(() => {
      fetch(`${apiUrl}/api/v1/admin/trading-halt`, { headers: { Authorization: `Bearer ${accessToken}` } })
        .then((r) => r.json())
        .then((d) => setTradingHalted(d?.success && d?.data ? !!d.data.halted : null))
        .catch(() => setTradingHalted(null));
    }, 300);
    return () => clearTimeout(t);
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken) return;
    const apiUrl = getApiBaseUrl();
    const t = setTimeout(() => {
      fetch(`${apiUrl}/api/v1/admin/withdrawals?limit=1`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
        .then((r) => r.json())
        .then((data) => {
          if (data?.success && data?.data?.stats) setWithdrawalStats(data.data.stats);
        })
        .catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [accessToken]);

  const toggleMenu = (menuId: string) => {
    setExpandedMenus((prev) =>
      prev.includes(menuId)
        ? prev.filter((id) => id !== menuId)
        : [...prev, menuId]
    );
  };

  const isActive = (href: string) => {
    const [p, q] = href.split('?');
    const path = p || href;
    if (pathname === path) return true;
    if (path === '/admin/users/detail' && pathname.startsWith('/admin/users/') && pathname !== '/admin/users' && pathname !== '/admin/users/suspended' && pathname !== '/admin/users/banned' && pathname !== '/admin/users/verification' && pathname !== '/admin/users/tiers' && pathname !== '/admin/users/risk') return false;
    if (path === '/admin/compliance/alert' && pathname.startsWith('/admin/compliance/alerts/')) return true;
    if (!q) return searchParams.get('type') !== 'internal';
    const want = new URLSearchParams(q);
    return Array.from(want.entries()).every(([k, v]) => searchParams.get(k) === v);
  };
  const isParentActive = (children?: { href: string }[]) =>
    children?.some((child) => {
      const [p, q] = child.href.split('?');
      const path = p || child.href;
      if (pathname === path) return true;
      if (path === '/admin/users/detail' && pathname.startsWith('/admin/users/') && pathname !== '/admin/users') return true;
      if (path === '/admin/compliance/alert' && pathname.startsWith('/admin/compliance/alerts/')) return true;
      if (!q) return true;
      const want = new URLSearchParams(q);
      return Array.from(want.entries()).every(([k, v]) => searchParams.get(k) === v);
    });

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden animate-admin-fade-in"
          onClick={() => setIsOpen(false)}
          aria-hidden
        />
      )}

      <aside
        className={`fixed top-0 left-0 z-50 h-full w-[220px] flex flex-col text-[13px] transition-transform duration-200 lg:translate-x-0 bg-card border-r border-border ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="h-11 flex items-center justify-between px-2.5 border-b border-border shrink-0">
          <Link
            href="/admin/dashboard"
            className="flex items-center gap-2 min-w-0"
          >
            <div className="w-6 h-6 rounded bg-muted flex items-center justify-center shrink-0">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-tight">CE</span>
            </div>
            <span className="font-semibold text-foreground truncate text-xs">Admin</span>
          </Link>
          <button
            onClick={() => setIsOpen(false)}
            className="lg:hidden p-1.5 text-muted-foreground hover:text-foreground"
            aria-label="Close menu"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-2 px-1.5">
          <ul className="space-y-0.5">
            {menuItems.map((item) => (
              <li key={item.id}>
                {item.href ? (
                  <Link
                    href={item.href}
                    className={`flex items-center gap-2 px-2.5 py-1.5 rounded-[4px] text-[12px] ${
                      isActive(item.href)
                        ? 'bg-muted text-foreground border-l-2 border-primary pl-2'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                    }`}
                  >
                    <span className="opacity-80">{item.icon}</span>
                    <span className="truncate">{item.label}</span>
                  </Link>
                ) : (
                  <>
                    <button
                      onClick={() => toggleMenu(item.id)}
                      className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-[4px] text-[12px] text-left ${
                        isParentActive(item.children)
                          ? 'text-foreground bg-muted/60'
                          : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="opacity-80 shrink-0">{item.icon}</span>
                        <span className="truncate">{item.label}</span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {item.badge != null && (
                          <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-destructive text-destructive-foreground">
                            {item.badge}
                          </span>
                        )}
                        {item.id === 'wallets' && withdrawalStats && Number(withdrawalStats.pending_approval ?? 0) > 0 && (
                          <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-warning text-black">
                            {withdrawalStats.pending_approval}
                          </span>
                        )}
                        {expandedMenus.includes(item.id) ? (
                          <ChevronDown className="w-3.5 h-3.5 opacity-70" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 opacity-70" />
                        )}
                      </div>
                    </button>
                    {expandedMenus.includes(item.id) && item.children && (
                      <ul className="mt-0.5 ml-4 pl-2 border-l border-border space-y-0.5 overflow-hidden">
                        {item.children.map((child) => (
                          <li key={child.href}>
                            <Link
                              href={child.href}
                              className={`block py-1 px-1.5 text-[11px] rounded-[4px] ${
                                isActive(child.href)
                                  ? 'text-foreground font-medium'
                                  : 'text-muted-foreground hover:text-foreground'
                              }`}
                            >
                              {child.label}
                              {child.badge != null && (
                                <span className="ml-1.5 px-1.5 py-0.5 text-[10px] font-medium rounded bg-destructive text-destructive-foreground">
                                  {child.badge}
                                </span>
                              )}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        </nav>

        <div className="p-2 border-t border-border shrink-0">
          <div className="flex items-center justify-between px-2 py-1.5 rounded-[4px] bg-muted/50">
            <span className="text-[11px] text-muted-foreground">Trading</span>
            {tradingHalted === null ? (
              <span className="text-[11px] text-muted-foreground">—</span>
            ) : (
              <StatusBadge variant={tradingHalted ? 'HALTED' : 'LIVE'} showDot />
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
