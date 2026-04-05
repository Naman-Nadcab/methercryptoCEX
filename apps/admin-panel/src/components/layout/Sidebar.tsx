'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Users,
  ShieldCheck,
  Wallet,
  Landmark,
  ArrowDownToLine,
  ArrowUpFromLine,
  TrendingUp,
  BarChart3,
  ShoppingCart,
  LineChart,
  Repeat,
  Droplets,
  AlertTriangle,
  PieChart,
  CreditCard,
  Bell,
  Shield,
  Settings,
  Cog,
  Activity,
  Cable,
  Gauge,
  FileText,
  Zap,
  Siren,
  Scale,
  Coins,
  Terminal,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { ADMIN_FEATURE_FLAGS } from '@/lib/admin/featureFlags';

interface NavSection {
  title?: string;
  items: { label: string; href: string; icon: React.ElementType }[];
}

const CONTROL_CENTER_SECTION: NavSection = {
  title: 'Operations',
  items: [
    ...(ADMIN_FEATURE_FLAGS.ADMIN_INCIDENT_SYSTEM ? [{ label: 'Incidents', href: '/incidents', icon: Siren }] : []),
    { label: 'Monitoring', href: '/monitoring', icon: Activity },
  ],
};

const NAV = [
  { label: 'Dashboard', href: '/dashboard', icon: Zap },
  { label: 'Users', href: '/users', icon: Users },
  { label: 'KYC', href: '/kyc', icon: ShieldCheck },
  { label: 'Wallets', href: '/wallets', icon: Wallet },
  { label: 'Treasury', href: '/treasury', icon: Landmark },
  { label: 'Reconciliation', href: '/reconciliation', icon: Scale },
  { label: 'Deposits', href: '/deposits', icon: ArrowDownToLine },
  { label: 'Withdrawals', href: '/withdrawals', icon: ArrowUpFromLine },
  { label: 'Trading', href: '/trading', icon: TrendingUp },
  { label: 'Markets', href: '/markets', icon: BarChart3 },
  { label: 'Orders', href: '/orders', icon: ShoppingCart },
  { label: 'Trades', href: '/trades', icon: LineChart },
  { label: 'P2P', href: '/p2p', icon: Repeat },
  { label: 'Liquidity', href: '/liquidity', icon: Droplets },
  { label: 'Risk & AML', href: '/risk', icon: AlertTriangle },
  { label: 'Analytics', href: '/analytics', icon: PieChart },
  { label: 'Fees', href: '/fees', icon: CreditCard },
  { label: 'Staking & Earn', href: '/staking', icon: Coins },
  { label: 'Notifications', href: '/notifications', icon: Bell },
  { label: 'Security', href: '/security', icon: Shield },
  { label: 'Audit Logs', href: '/audit/config', icon: FileText },
  { label: 'Integrations', href: '/integrations', icon: Cable },
  { label: 'System Logs', href: '/logs', icon: Terminal },
  { label: 'Settings', href: '/settings', icon: Settings },
  { label: 'Operations', href: '/operations', icon: Cog },
  { label: 'Monitoring', href: '/monitoring', icon: Activity },
  { label: 'Admin control', href: '/admin-control', icon: Gauge },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed left-0 top-0 z-40 h-screen w-64 border-r border-admin-border bg-admin-card">
      <div className="flex h-full flex-col">
        <div className="flex h-16 items-center border-b border-admin-border px-6">
          <span className="text-lg font-semibold text-admin-text">Exchange Admin</span>
        </div>
        <nav className="flex-1 overflow-y-auto p-4">
          {/* Control Center section (feature-flagged) */}
          {ADMIN_FEATURE_FLAGS.ADMIN_NEW_DASHBOARD && (
            <div className="mb-4">
              <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-wider text-admin-primary">
                {CONTROL_CENTER_SECTION.title}
              </p>
              <div className="space-y-0.5">
                {CONTROL_CENTER_SECTION.items.map((item) => {
                  const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                        isActive
                          ? 'bg-admin-primary text-white'
                          : 'text-admin-primary/70 hover:bg-admin-primary/10 hover:text-admin-primary'
                      )}
                    >
                      <item.icon className="h-5 w-5 shrink-0" />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
              <div className="my-3 border-t border-admin-border" />
            </div>
          )}

          {/* Existing navigation */}
          <div className="space-y-0.5">
            {NAV.map((item) => {
              const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-admin-primary text-white'
                      : 'text-admin-muted hover:bg-white/5 hover:text-admin-text'
                  )}
                >
                  <item.icon className="h-5 w-5 shrink-0" />
                  {item.label}
                </Link>
              );
            })}
          </div>
        </nav>
      </div>
    </aside>
  );
}
