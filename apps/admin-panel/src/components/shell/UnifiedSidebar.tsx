'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback } from 'react';
import {
  LayoutDashboard, Users, ShieldCheck, Wallet, Landmark,
  ArrowDownToLine, ArrowUpFromLine, TrendingUp, BarChart3,
  ShoppingCart, LineChart, Repeat, Droplets, AlertTriangle,
  PieChart, CreditCard, Bell, Shield, Settings, Cog,
  Activity, Cable, Gauge, FileText, Zap, Siren,
  ChevronRight, PanelLeftClose, Scale, Coins, Terminal,
  Headphones,
  CheckSquare, Database,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { ADMIN_FEATURE_FLAGS } from '@/lib/admin/featureFlags';
import { useSidebarState } from './SidebarContext';

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
}

interface NavSection {
  title: string;
  items: NavItem[];
  featureFlag?: boolean;
}

const SECTIONS: NavSection[] = [
  {
    title: 'Overview',
    items: [
      { label: 'Dashboard', href: '/dashboard', icon: Zap },
      { label: 'Control Center', href: '/control-center', icon: Gauge },
      { label: 'Monitoring', href: '/monitoring', icon: Activity },
      { label: 'Analytics', href: '/analytics', icon: PieChart },
      ...(ADMIN_FEATURE_FLAGS.ADMIN_INCIDENT_SYSTEM ? [{ label: 'Incidents', href: '/incidents', icon: Siren }] : []),
    ],
  },
  {
    title: 'User Management',
    items: [
      { label: 'Users', href: '/users', icon: Users },
      { label: 'KYC', href: '/kyc', icon: ShieldCheck },
      { label: 'Security', href: '/security', icon: Shield },
      { label: 'Support Tickets', href: '/support', icon: Headphones },
    ],
  },
  {
    title: 'Finance',
    items: [
      { label: 'Wallets', href: '/wallets', icon: Wallet },
      { label: 'Treasury', href: '/treasury', icon: Landmark },
      { label: 'Reconciliation', href: '/reconciliation', icon: Scale },
      { label: 'Deposits', href: '/deposits', icon: ArrowDownToLine },
      { label: 'Withdrawals', href: '/withdrawals', icon: ArrowUpFromLine },
      { label: 'Fees', href: '/fees', icon: CreditCard },
      { label: 'Staking & Earn', href: '/staking', icon: Coins },
    ],
  },
  {
    title: 'Trading',
    items: [
      { label: 'Trading', href: '/trading', icon: TrendingUp },
      { label: 'Markets', href: '/markets', icon: BarChart3 },
      { label: 'Orders', href: '/orders', icon: ShoppingCart },
      { label: 'Trades', href: '/trades', icon: LineChart },
      { label: 'P2P', href: '/p2p', icon: Repeat },
      { label: 'Liquidity', href: '/liquidity', icon: Droplets },
    ],
  },
  {
    title: 'Compliance',
    items: [
      { label: 'Risk & AML', href: '/risk', icon: AlertTriangle },
      { label: 'Approvals', href: '/approvals', icon: CheckSquare },
      { label: 'Compliance', href: '/compliance', icon: FileText },
      { label: 'Audit Logs', href: '/audit', icon: FileText },
    ],
  },
  {
    title: 'System',
    items: [
      { label: 'Admin Users', href: '/admin-users', icon: ShieldCheck },
      { label: 'Announcements', href: '/announcements', icon: Bell },
      { label: 'Notifications', href: '/notifications', icon: Bell },
      { label: 'Integrations', href: '/integrations', icon: Cable },
      { label: 'System Logs', href: '/logs', icon: Terminal },
      { label: 'Settings', href: '/settings', icon: Settings },
      { label: 'Operations', href: '/operations', icon: Cog },
      { label: 'Backups', href: '/backups', icon: Database },
      { label: 'Admin Control', href: '/admin-control', icon: Gauge },
    ],
  },
];

export function UnifiedSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { collapsed, toggle } = useSidebarState();
  const prefetch = useCallback((href: string) => { router.prefetch(href); }, [router]);

  const w = collapsed ? 'w-[72px]' : 'w-60';

  return (
    <aside
      className={cn(
        'fixed left-0 top-0 z-40 h-screen border-r border-admin-border bg-admin-surface flex flex-col transition-all duration-200',
        w
      )}
    >
      {/* Header */}
      <div className={cn(
        'flex h-14 items-center border-b border-admin-border shrink-0',
        collapsed ? 'justify-center px-2' : 'justify-between px-4'
      )}>
        {!collapsed && (
          <span className="text-sm font-bold text-admin-text truncate">Exchange Admin</span>
        )}
        <button
          onClick={toggle}
          className="rounded-md p-1.5 text-admin-muted hover:bg-white/5 hover:text-admin-text transition-colors"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-4">
        {SECTIONS.map((section) => {
          if (section.featureFlag === false) return null;

          return (
            <div key={section.title}>
              {!collapsed && (
                <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-admin-muted/50">
                  {section.title}
                </p>
              )}
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const isActive = pathname === item.href ||
                    (item.href !== '/dashboard' && pathname?.startsWith(item.href + '/'));

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      title={collapsed ? item.label : undefined}
                      onMouseEnter={() => prefetch(item.href)}
                      className={cn(
                        'flex items-center gap-2.5 rounded-lg text-[13px] font-medium transition-all duration-150',
                        collapsed ? 'justify-center px-2 py-2.5' : 'px-2.5 py-2',
                        isActive
                          ? 'bg-admin-primary/15 text-admin-primary border border-admin-primary/20'
                          : 'text-admin-muted hover:bg-white/5 hover:text-admin-text border border-transparent'
                      )}
                    >
                      <item.icon className="h-[18px] w-[18px] shrink-0" />
                      {!collapsed && <span className="truncate">{item.label}</span>}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      {/* Footer */}
      {!collapsed && (
        <div className="shrink-0 border-t border-admin-border px-4 py-2.5">
          <p className="text-[10px] text-admin-muted/40 font-medium">Admin Panel v2.0</p>
        </div>
      )}
    </aside>
  );
}
