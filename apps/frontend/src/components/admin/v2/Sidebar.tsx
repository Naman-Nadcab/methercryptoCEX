'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Users,
  ShieldCheck,
  Wallet,
  TrendingUp,
  Repeat,
  BarChart2,
  Activity,
  BarChart3,
  ShieldAlert,
  Settings,
  UserCog,
  ChevronDown,
  ChevronRight,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getWithdrawals } from '@/lib/admin/wallets';
import { getTradingHalt } from '@/lib/admin/trading';
import { canAccessNavPermission } from '@/lib/admin/permissions';
import { useQuery } from '@tanstack/react-query';

const SIDEBAR_W = 260;

interface NavChild {
  label: string;
  href: string;
}

interface NavItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  href?: string;
  children?: NavChild[];
  /** Required permission to show this section (e.g. view_users). Omit = visible to all. */
  permission?: string;
}

const SIDEBAR_NAV: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="w-4 h-4 shrink-0" />, href: '/admin/dashboard' },
  { id: 'dashboard-v2', label: 'Dashboard V2', icon: <LayoutDashboard className="w-4 h-4 shrink-0" />, href: '/admin/dashboard-v2' },
  { id: 'incidents-v2', label: 'Incidents V2', icon: <ShieldAlert className="w-4 h-4 shrink-0" />, href: '/admin/incidents-v2' },
  {
    id: 'users',
    label: 'Users',
    permission: 'view_users',
    icon: <Users className="w-4 h-4 shrink-0" />,
    children: [
      { label: 'All Users', href: '/admin/users' },
      { label: 'User Detail', href: '/admin/users/detail' },
      { label: 'Suspended', href: '/admin/users/suspended' },
      { label: 'Banned', href: '/admin/users/banned' },
    ],
  },
  {
    id: 'kyc',
    label: 'KYC & Compliance',
    icon: <ShieldCheck className="w-4 h-4 shrink-0" />,
    children: [
      { label: 'KYC Overview', href: '/admin/kyc' },
      { label: 'Pending Review', href: '/admin/kyc/pending' },
      { label: 'Approved', href: '/admin/kyc/approved' },
      { label: 'Rejected', href: '/admin/kyc/rejected' },
      { label: 'Compliance Alerts', href: '/admin/compliance/alerts' },
      { label: 'STR/CTR Reports', href: '/admin/compliance/reports' },
    ],
  },
  {
    id: 'wallets',
    label: 'Wallets & Treasury',
    permission: 'view_withdrawals',
    icon: <Wallet className="w-4 h-4 shrink-0" />,
    children: [
      { label: 'Wallet Monitor', href: '/admin/wallets/monitor' },
      { label: 'Treasury', href: '/admin/wallets/treasury' },
      { label: 'Hot Wallets', href: '/admin/wallets/hot' },
      { label: 'Cold Wallets', href: '/admin/wallets/cold-reserves' },
      { label: 'Funds Summary', href: '/admin/wallets/funds-summary' },
      { label: 'Deposits', href: '/admin/deposits' },
      { label: 'Withdrawals', href: '/admin/withdrawals' },
      { label: 'Blockchain Nodes', href: '/admin/wallets/blockchain' },
    ],
  },
  {
    id: 'spot',
    label: 'Spot Trading',
    permission: 'manage_trading',
    icon: <TrendingUp className="w-4 h-4 shrink-0" />,
    children: [
      { label: 'Liquidity', href: '/admin/liquidity' },
      { label: 'Engine Monitor', href: '/admin/trading/engine' },
      { label: 'Liquidity Monitor', href: '/admin/trading/liquidity' },
      { label: 'Orderbook Surveillance', href: '/admin/trading/surveillance' },
      { label: 'Trade History', href: '/admin/trading/trade-history' },
      { label: 'Market Management', href: '/admin/trading/pairs' },
      { label: 'Spot Markets', href: '/admin/trading/spot-markets' },
      { label: 'Trading Pairs', href: '/admin/settings/trading-pairs' },
      { label: 'Trading Fees', href: '/admin/fees/trading' },
      { label: 'Circuit Breakers', href: '/admin/trading/circuit-breakers' },
    ],
  },
  {
    id: 'p2p',
    label: 'P2P Trading',
    icon: <Repeat className="w-4 h-4 shrink-0" />,
    children: [
      { label: 'P2P Orders', href: '/admin/p2p/orders' },
      { label: 'Disputes', href: '/admin/p2p/disputes' },
      { label: 'Escrow Wallet', href: '/admin/p2p/escrows' },
      { label: 'Payment Methods', href: '/admin/p2p/payment-methods' },
      { label: 'P2P Overview', href: '/admin/p2p' },
    ],
  },
  {
    id: 'mm',
    label: 'Market Making',
    icon: <BarChart2 className="w-4 h-4 shrink-0" />,
    children: [
      { label: 'MM Performance', href: '/admin/market-making' },
      { label: 'Liquidity Depth', href: '/admin/trading/liquidity' },
      { label: 'MM Risk Alerts', href: '/admin/monitoring/mm-risk' },
    ],
  },
  {
    id: 'risk',
    label: 'Risk Control',
    permission: 'view_risk',
    icon: <Activity className="w-4 h-4 shrink-0" />,
    children: [
      { label: 'Risk Dashboard', href: '/admin/risk' },
      { label: 'Risk Intelligence', href: '/admin/risk/intelligence' },
      { label: 'Withdrawal Risk', href: '/admin/risk/withdrawals' },
      { label: 'AML Alerts', href: '/admin/compliance/alerts' },
      { label: 'Compliance', href: '/admin/security/compliance' },
    ],
  },
  {
    id: 'reports',
    label: 'Reports & Analytics',
    icon: <BarChart3 className="w-4 h-4 shrink-0" />,
    children: [
      { label: 'Trading Volume', href: '/admin/reports' },
      { label: 'Revenue', href: '/admin/reports/financial' },
      { label: 'User Growth', href: '/admin/reports/users' },
      { label: 'P2P Stats', href: '/admin/reports/p2p' },
    ],
  },
  {
    id: 'security',
    label: 'Security',
    icon: <ShieldAlert className="w-4 h-4 shrink-0" />,
    children: [
      { label: 'Security Dashboard', href: '/admin/security' },
      { label: 'Withdrawal Approvals', href: '/admin/security/withdrawals' },
      { label: 'Audit Logs', href: '/admin/security/audit-logs' },
      { label: 'IP Whitelisting', href: '/admin/security/ip-rules' },
      { label: 'Risk Rules', href: '/admin/security/risk-rules' },
    ],
  },
  {
    id: 'system',
    label: 'System Settings',
    permission: 'manage_settings',
    icon: <Settings className="w-4 h-4 shrink-0" />,
    children: [
      { label: 'System Health', href: '/admin/system-health' },
      { label: 'Settings', href: '/admin/settings' },
      { label: 'Feature Flags', href: '/admin/settings/features' },
      { label: 'Operations', href: '/admin/settings/operations' },
      { label: 'Blockchain Config', href: '/admin/settings/blockchain' },
      { label: 'API Monitoring', href: '/admin/api-monitoring' },
      { label: 'Notifications', href: '/admin/notifications' },
      { label: 'OTP Delivery', href: '/admin/notifications/delivery' },
      { label: 'Alert Center', href: '/admin/alerts' },
    ],
  },
  {
    id: 'admins',
    label: 'Admin Management',
    permission: 'manage_settings',
    icon: <UserCog className="w-4 h-4 shrink-0" />,
    children: [
      { label: 'Admin Users', href: '/admin/admins' },
      { label: 'Roles & Permissions', href: '/admin/admins/roles' },
      { label: 'Activity Logs', href: '/admin/security/admin-audit' },
    ],
  },
];

export const SIDEBAR_WIDTH = SIDEBAR_W;

interface SidebarProps {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
}

export default function AdminV2Sidebar({ isOpen, setIsOpen }: SidebarProps) {
  const pathname = usePathname();
  const token = useAdminAuthStore((s) => s.accessToken);
  const admin = useAdminAuthStore((s) => s.admin);
  const [expanded, setExpanded] = useState<string[]>(['dashboard', 'users', 'wallets', 'spot']);

  const visibleNav = useMemo(
    () => SIDEBAR_NAV.filter((item) => canAccessNavPermission(item.permission)),
    [admin]
  );

  const { data: withdrawData } = useQuery({
    queryKey: ['admin', 'withdrawals', 'stats', token],
    queryFn: () => getWithdrawals(token ?? null, { limit: 1 }),
    enabled: !!token,
  });
  const { data: haltData } = useQuery({
    queryKey: ['admin', 'trading-halt', token],
    queryFn: () => getTradingHalt(token ?? null),
    enabled: !!token,
  });

  const pendingWithdrawals = withdrawData?.data?.stats && typeof (withdrawData.data.stats as { pending_approval?: number }).pending_approval === 'number'
    ? (withdrawData.data.stats as { pending_approval: number }).pending_approval
    : 0;
  const tradingHalted = haltData?.data?.halted ?? false;

  const toggle = (id: string) => {
    setExpanded((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  };

  const isActive = (href: string) => pathname === href || (href !== '/admin/dashboard' && pathname.startsWith(href + '/'));
  const isParentActive = (item: NavItem) =>
    item.href ? isActive(item.href) : (item.children?.some((c) => isActive(c.href)) ?? false);

  return (
    <>
      {isOpen && (
        <div className="fixed inset-0 bg-black/40 z-40 lg:hidden" onClick={() => setIsOpen(false)} aria-hidden />
      )}
      <aside
        className={cn(
          'fixed top-0 left-0 z-50 h-full w-[260px] flex flex-col bg-[var(--admin-sidebar-bg)] border-r border-[var(--admin-card-border)] transition-transform duration-200 lg:translate-x-0 shadow-sm',
          isOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="h-14 flex items-center justify-between px-4 border-b border-[var(--admin-card-border)] shrink-0">
          <Link href="/admin/dashboard" className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-[var(--admin-primary)] flex items-center justify-center shrink-0">
              <span className="text-sm font-bold text-white">EX</span>
            </div>
            <span className="font-semibold text-[var(--admin-text)] truncate">Exchange Admin</span>
          </Link>
          <button type="button" onClick={() => setIsOpen(false)} className="lg:hidden p-2 text-[var(--admin-text-muted)] hover:text-[var(--admin-text)]" aria-label="Close menu">
            <X className="w-4 h-4" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-3 px-2">
          {visibleNav.map((item) => (
            <div key={item.id} className="mb-1">
              {item.href ? (
                <Link
                  href={item.href}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2.5 rounded-[var(--admin-radius)] text-sm font-medium transition-colors',
                    isActive(item.href)
                      ? 'bg-[var(--admin-active-bg)] text-[var(--admin-primary)] border-l-[3px] border-l-[var(--admin-primary)] -ml-[2px] pl-[11px]'
                      : 'text-[var(--admin-text-muted)] hover:text-[var(--admin-text)] hover:bg-[var(--admin-hover-bg)]'
                  )}
                >
                  {item.icon}
                  <span className="truncate">{item.label}</span>
                </Link>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => toggle(item.id)}
                    className={cn(
                      'w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-[var(--admin-radius)] text-sm text-left transition-colors',
                      isParentActive(item) ? 'text-[var(--admin-text)] font-medium' : 'text-[var(--admin-text-muted)] hover:text-[var(--admin-text)] hover:bg-[var(--admin-hover-bg)]'
                    )}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {item.icon}
                      <span className="truncate">{item.label}</span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {item.id === 'wallets' && pendingWithdrawals > 0 && (
                        <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-[var(--admin-danger)]/15 text-[var(--admin-danger)]">
                          {pendingWithdrawals}
                        </span>
                      )}
                      {expanded.includes(item.id) ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </div>
                  </button>
                  {expanded.includes(item.id) && item.children && (
                    <ul className="mt-0.5 ml-2 pl-3 border-l border-[var(--admin-card-border)] space-y-0.5">
                      {item.children.map((child) => (
                        <li key={child.href}>
                          <Link
                            href={child.href}
                            className={cn(
                              'block py-2 px-2.5 rounded-lg text-[13px] transition-colors',
                              isActive(child.href)
                                ? 'text-[var(--admin-primary)] font-medium bg-[var(--admin-active-bg)]'
                                : 'text-[var(--admin-text-muted)] hover:text-[var(--admin-text)] hover:bg-[var(--admin-hover-bg)]'
                            )}
                          >
                            {child.label}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          ))}
        </nav>

        <div className="p-2 border-t border-[var(--admin-card-border)] shrink-0">
          <div className="flex items-center justify-between px-3 py-2 rounded-[var(--admin-radius)] bg-[var(--admin-hover-bg)]">
            <span className="text-[11px] font-medium text-[var(--admin-text-muted)] uppercase tracking-wide">Trading</span>
            <span
              className={cn(
                'text-[11px] font-semibold',
                tradingHalted ? 'text-[var(--admin-danger)]' : 'text-[var(--admin-success)]'
              )}
            >
              {tradingHalted ? 'Halted' : 'Live'}
            </span>
          </div>
        </div>
      </aside>
    </>
  );
}
