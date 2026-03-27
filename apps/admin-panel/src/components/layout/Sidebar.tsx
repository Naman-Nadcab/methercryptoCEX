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
} from 'lucide-react';
import { cn } from '@/lib/cn';

const NAV = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Users', href: '/users', icon: Users },
  { label: 'KYC', href: '/kyc', icon: ShieldCheck },
  { label: 'Wallets', href: '/wallets', icon: Wallet },
  { label: 'Treasury', href: '/treasury', icon: Landmark },
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
  { label: 'Notifications', href: '/notifications', icon: Bell },
  { label: 'Security', href: '/security', icon: Shield },
  { label: 'Audit Logs', href: '/audit/config', icon: FileText },
  { label: 'Integrations', href: '/integrations', icon: Cable },
  { label: 'Settings', href: '/settings', icon: Settings },
  { label: 'Operations', href: '/operations', icon: Cog },
  { label: 'Monitoring', href: '/monitoring', icon: Activity },
  { label: 'Admin control', href: '/admin-control', icon: Gauge },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed left-0 top-0 z-40 h-screen w-64 border-r border-admin-border bg-white">
      <div className="flex h-full flex-col">
        <div className="flex h-16 items-center border-b border-admin-border px-6">
          <span className="text-lg font-semibold text-gray-900">Exchange Admin</span>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto p-4">
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
                    : 'text-admin-muted hover:bg-gray-100 hover:text-gray-900'
                )}
              >
                <item.icon className="h-5 w-5 shrink-0" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}
