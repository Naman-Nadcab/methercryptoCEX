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
  Bell,
  Lock,
  BarChart3,
  Settings,
  UserCog,
  HeadphonesIcon,
  ChevronDown,
  ChevronRight,
  AlertCircle,
  X,
  Menu as MenuIcon,
} from 'lucide-react';

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

const menuItems: MenuItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="w-4 h-4" />, href: '/admin/dashboard' },
  {
    id: 'users',
    label: 'User Management',
    icon: <Users className="w-4 h-4" />,
    children: [
      { label: 'Users', href: '/admin/users' },
      { label: 'Suspended Users', href: '/admin/users/suspended' },
      { label: 'Login Activity', href: '/admin/security/sessions' },
    ],
  },
  {
    id: 'kyc',
    label: 'KYC Management',
    icon: <Shield className="w-4 h-4" />,
    children: [
      { label: 'Pending KYC', href: '/admin/kyc/pending' },
      { label: 'Approved KYC', href: '/admin/kyc/approved' },
      { label: 'Rejected KYC', href: '/admin/kyc/rejected' },
      { label: 'KYC Settings', href: '/admin/kyc/settings' },
    ],
  },
  {
    id: 'wallets',
    label: 'Wallets',
    icon: <Wallet className="w-4 h-4" />,
    children: [
      { label: 'Asset Balances', href: '/admin/wallets/funds-summary' },
      { label: 'Hot Wallets', href: '/admin/wallets/hot' },
      { label: 'Cold Wallets', href: '/admin/wallets/cold' },
      { label: 'Wallet Health', href: '/admin/wallets/blockchain' },
    ],
  },
  {
    id: 'trading',
    label: 'Spot Trading',
    icon: <TrendingUp className="w-4 h-4" />,
    children: [
      { label: 'Market List', href: '/admin/trading/spot-markets' },
      { label: 'Market Control', href: '/admin/trading/market-control' },
      { label: 'Fees & Limits', href: '/admin/trading/fees' },
      { label: 'Circuit Breakers', href: '/admin/trading/circuit-breakers' },
      { label: 'Live Orders', href: '/admin/trading/orders' },
      { label: 'Failed Orders', href: '/admin/trading/orders?status=failed' },
      { label: 'Cancel Orders', href: '/admin/trading/orders' },
      { label: 'Live Trades', href: '/admin/trading/trade-history' },
      { label: 'Trade Audit', href: '/admin/trading/trade-history' },
    ],
  },
  {
    id: 'p2p',
    label: 'P2P Trading',
    icon: <Repeat className="w-4 h-4" />,
    children: [
      { label: 'Orders', href: '/admin/p2p/orders' },
      { label: 'Disputes', href: '/admin/p2p/disputes' },
    ],
  },
  {
    id: 'deposits',
    label: 'Deposits',
    icon: <ArrowDownToLine className="w-4 h-4" />,
    children: [
      { label: 'Pending Deposits', href: '/admin/deposits/pending' },
      { label: 'Failed Deposits', href: '/admin/deposits/flagged' },
    ],
  },
  {
    id: 'withdrawals',
    label: 'Withdrawals',
    icon: <ArrowUpFromLine className="w-4 h-4" />,
    children: [
      { label: 'Pending Withdrawals', href: '/admin/withdrawals/pending-approval', badgeKey: 'pending_approval' },
      { label: 'Risk Holds', href: '/admin/withdrawals/pending' },
      { label: 'Manual Review', href: '/admin/withdrawals/pending-approval' },
    ],
  },
  {
    id: 'fees',
    label: 'Fee Management',
    icon: <Receipt className="w-4 h-4" />,
    children: [
      { label: 'Spot Fees', href: '/admin/fees/trading' },
      { label: 'Withdrawal Fees', href: '/admin/fees/withdrawal' },
    ],
  },
  {
    id: 'security',
    label: 'Security',
    icon: <Lock className="w-4 h-4" />,
    children: [
      { label: 'Risk Flags', href: '/admin/security/risk-rules' },
      { label: 'Circuit Breakers', href: '/admin/trading/circuit-breakers' },
      { label: 'Admin IP Whitelist', href: '/admin/security/ip-rules' },
      { label: 'Audit Logs', href: '/admin/security/audit-logs' },
    ],
  },
  {
    id: 'reports',
    label: 'Reports',
    icon: <BarChart3 className="w-4 h-4" />,
    children: [
      { label: 'Volume', href: '/admin/reports/trading' },
      { label: 'Revenue', href: '/admin/reports/financial' },
      { label: 'User Growth', href: '/admin/reports/users' },
    ],
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: <Settings className="w-4 h-4" />,
    children: [
      { label: 'System Settings', href: '/admin/settings' },
      { label: 'Feature Toggles', href: '/admin/settings/features' },
    ],
  },
  {
    id: 'admins',
    label: 'Admin Users',
    icon: <UserCog className="w-4 h-4" />,
    children: [
      { label: 'Roles & Permissions', href: '/admin/admins/roles' },
      { label: 'Activity Logs', href: '/admin/security/audit-logs' },
    ],
  },
  {
    id: 'support',
    label: 'Support',
    icon: <HeadphonesIcon className="w-4 h-4" />,
    children: [
      { label: 'Tickets', href: '/admin/support' },
      { label: 'User Messages', href: '/admin/support' },
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

  useEffect(() => {
    if (!accessToken || !expandedMenus.includes('withdrawals')) return;
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
    fetch(`${apiUrl}/api/v1/admin/withdrawals?limit=1`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((r) => r.json())
      .then((data) => {
        if (data?.success && data?.data?.stats) setWithdrawalStats(data.data.stats);
      })
      .catch(() => {});
  }, [accessToken, expandedMenus]);

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
    if (pathname !== path) return false;
    if (!q) return searchParams.get('type') !== 'internal';
    const want = new URLSearchParams(q);
    return Array.from(want.entries()).every(([k, v]) => searchParams.get(k) === v);
  };
  const isParentActive = (children?: { href: string }[]) =>
    children?.some((child) => {
      const [p, q] = child.href.split('?');
      if (pathname !== (p || child.href)) return false;
      if (!q) return true;
      const want = new URLSearchParams(q);
      return Array.from(want.entries()).every(([k, v]) => searchParams.get(k) === v);
    });

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}

      <aside
        className={`fixed top-0 left-0 z-50 h-full bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 transition-transform duration-300 lg:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        } w-60 flex flex-col text-[10px]`}
      >
        <div className="h-14 flex items-center justify-between px-3 border-b border-gray-200 dark:border-gray-800">
          <Link href="/admin/dashboard" className="flex items-center gap-2">
            <div className="w-7 h-7 bg-gradient-to-br from-blue-500 to-blue-500 rounded-lg flex items-center justify-center">
              <span className="text-gray-900 dark:text-white font-bold text-[10px]">CE</span>
            </div>
            <span className="text-gray-900 dark:text-white font-semibold text-xs">Admin Panel</span>
          </Link>
          <button
            onClick={() => setIsOpen(false)}
            className="lg:hidden text-gray-400 hover:text-gray-900 dark:hover:text-gray-900 dark:hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-3 px-2">
          <ul className="space-y-0.5">
            {menuItems.map((item) => (
              <li key={item.id}>
                {item.href ? (
                  <Link
                    href={item.href}
                    className={`flex items-center gap-2 px-2.5 py-2 rounded-lg transition-colors ${
                      isActive(item.href)
                        ? 'bg-blue-600 text-white'
                        : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-900 dark:hover:text-white'
                    }`}
                  >
                    {item.icon}
                    <span className="text-[10px] font-medium">{item.label}</span>
                  </Link>
                ) : (
                  <>
                    <button
                      onClick={() => toggleMenu(item.id)}
                      className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg transition-colors ${
                        isParentActive(item.children)
                          ? 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white'
                          : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-900 dark:hover:text-white'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {item.icon}
                        <span className="text-[10px] font-medium">{item.label}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {item.badge && (
                          <span
                            className={`px-2 py-0.5 text-xs font-medium text-white rounded-full ${
                              item.badgeColor || 'bg-blue-500'
                            }`}
                          >
                            {item.badge}
                          </span>
                        )}
                        {expandedMenus.includes(item.id) ? (
                          <ChevronDown className="w-4 h-4" />
                        ) : (
                          <ChevronRight className="w-4 h-4" />
                        )}
                      </div>
                    </button>
                    {expandedMenus.includes(item.id) && item.children && (
                      <ul className="mt-1 ml-4 pl-4 border-l border-gray-200 dark:border-gray-700 space-y-1">
                        {item.children.map((child) => (
                          <li key={child.href}>
                            <Link
                              href={child.href}
                              className={`flex items-center justify-between px-3 py-1.5 rounded-lg text-[10px] transition-colors ${
                                isActive(child.href)
                                  ? 'bg-blue-100 dark:bg-blue-600/20 text-blue-600 dark:text-blue-400'
                                  : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-900 dark:hover:text-white'
                              }`}
                            >
                              <span>{child.label}</span>
                              {(child.badgeKey && item.id === 'withdrawals' && withdrawalStats && Number(withdrawalStats[child.badgeKey as keyof typeof withdrawalStats] ?? 0) > 0) ? (
                                <span className="px-2 py-0.5 text-xs font-medium text-white bg-amber-500 rounded-full">
                                  {withdrawalStats[child.badgeKey as keyof typeof withdrawalStats]}
                                </span>
                              ) : child.badge ? (
                                <span className="px-2 py-0.5 text-xs font-medium text-white bg-red-500 rounded-full">
                                  {child.badge}
                                </span>
                              ) : null}
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

        <div className="p-3 border-t border-gray-200 dark:border-gray-800">
          <div className="flex items-center gap-2 px-2 py-2 rounded-lg bg-gray-100 dark:bg-gray-800/50">
            <AlertCircle className="w-4 h-4 text-yellow-500" />
            <div className="flex-1 min-w-0">
              <p className="text-[10px] text-gray-500 dark:text-gray-600 dark:text-gray-400">System Status</p>
              <p className="text-[10px] text-green-500 dark:text-green-400 font-medium">All Systems Normal</p>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
