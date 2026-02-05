'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Users,
  Shield,
  Wallet,
  ArrowDownToLine,
  ArrowUpFromLine,
  TrendingUp,
  Repeat,
  Gift,
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
  }[];
}

const menuItems: MenuItem[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: <LayoutDashboard className="w-4 h-4" />,
    href: '/admin/dashboard',
  },
  {
    id: 'users',
    label: 'User Management',
    icon: <Users className="w-4 h-4" />,
    children: [
      { label: 'All Users', href: '/admin/users' },
      { label: 'User Tiers', href: '/admin/users/tiers' },
      { label: 'Verification Queue', href: '/admin/users/verification' },
      { label: 'Suspended Users', href: '/admin/users/suspended' },
      { label: 'Banned Users', href: '/admin/users/banned' },
    ],
  },
  {
    id: 'kyc',
    label: 'KYC Management',
    icon: <Shield className="w-4 h-4" />,
    badge: 12,
    badgeColor: 'bg-yellow-500',
    children: [
      { label: 'KYC Dashboard', href: '/admin/kyc' },
      { label: 'Pending KYC', href: '/admin/kyc/pending', badge: 8 },
      { label: 'Under Review', href: '/admin/kyc/review', badge: 4 },
      { label: 'Approved', href: '/admin/kyc/approved' },
      { label: 'Rejected', href: '/admin/kyc/rejected' },
      { label: 'Settings', href: '/admin/kyc/settings' },
    ],
  },
  {
    id: 'wallets',
    label: 'Wallets',
    icon: <Wallet className="w-4 h-4" />,
    children: [
      { label: 'Overview', href: '/admin/wallets' },
      { label: 'Funds Summary', href: '/admin/wallets/funds-summary' },
      { label: 'Deposit Sweeps', href: '/admin/wallets/deposit-sweeps' },
      { label: 'Hot Wallets', href: '/admin/wallets/hot' },
      { label: 'Cold Wallets', href: '/admin/wallets/cold' },
      { label: 'Currencies', href: '/admin/wallets/currencies' },
      { label: 'Blockchain Status', href: '/admin/wallets/blockchain' },
    ],
  },
  {
    id: 'deposits',
    label: 'Deposits',
    icon: <ArrowDownToLine className="w-4 h-4" />,
    children: [
      { label: 'All Deposits', href: '/admin/deposits' },
      { label: 'Pending', href: '/admin/deposits/pending' },
      { label: 'Flagged', href: '/admin/deposits/flagged' },
      { label: 'Reports', href: '/admin/deposits/reports' },
    ],
  },
  {
    id: 'withdrawals',
    label: 'Withdrawals',
    icon: <ArrowUpFromLine className="w-4 h-4" />,
    children: [
      { label: 'Pending Approval', href: '/admin/withdrawals/pending-approval' },
      { label: 'Pending', href: '/admin/withdrawals/pending' },
      { label: 'Processing', href: '/admin/withdrawals/processing' },
      { label: 'Completed', href: '/admin/withdrawals/completed' },
      { label: 'All Withdrawals', href: '/admin/withdrawals' },
      { label: 'Failed', href: '/admin/withdrawals/failed' },
      { label: 'Settings', href: '/admin/withdrawals/settings' },
    ],
  },
  {
    id: 'trading',
    label: 'Spot Trading',
    icon: <TrendingUp className="w-4 h-4" />,
    children: [
      { label: 'Trading Pairs', href: '/admin/trading/pairs' },
      { label: 'Order Book', href: '/admin/trading/orderbook' },
      { label: 'Active Orders', href: '/admin/trading/orders' },
      { label: 'Order History', href: '/admin/trading/order-history' },
      { label: 'Trade History', href: '/admin/trading/trade-history' },
      { label: 'Fee Config', href: '/admin/trading/fees' },
    ],
  },
  {
    id: 'p2p',
    label: 'P2P Trading',
    icon: <Repeat className="w-4 h-4" />,
    badge: 2,
    badgeColor: 'bg-orange-500',
    children: [
      { label: 'Advertisements', href: '/admin/p2p/ads' },
      { label: 'Orders', href: '/admin/p2p/orders' },
      { label: 'Disputes', href: '/admin/p2p/disputes', badge: 2 },
      { label: 'Merchants', href: '/admin/p2p/merchants' },
      { label: 'Payment Methods', href: '/admin/p2p/payment-methods' },
      { label: 'Settings', href: '/admin/p2p/settings' },
    ],
  },
  {
    id: 'referrals',
    label: 'Referrals',
    icon: <Gift className="w-4 h-4" />,
    children: [
      { label: 'Referral Codes', href: '/admin/referrals/codes' },
      { label: 'Relationships', href: '/admin/referrals/relationships' },
      { label: 'Commissions', href: '/admin/referrals/commissions' },
      { label: 'Campaigns', href: '/admin/referrals/campaigns' },
    ],
  },
  {
    id: 'fees',
    label: 'Fee Management',
    icon: <Receipt className="w-4 h-4" />,
    children: [
      { label: 'Trading Fees', href: '/admin/fees/trading' },
      { label: 'Withdrawal Fees', href: '/admin/fees/withdrawal' },
      { label: 'Fee Tiers', href: '/admin/fees/tiers' },
      { label: 'Promotions', href: '/admin/fees/promotions' },
    ],
  },
  {
    id: 'notifications',
    label: 'Notifications',
    icon: <Bell className="w-4 h-4" />,
    children: [
      { label: 'Announcements', href: '/admin/notifications/announcements' },
      { label: 'Push Notifications', href: '/admin/notifications/push' },
      { label: 'Email Templates', href: '/admin/notifications/email' },
      { label: 'SMS', href: '/admin/notifications/sms' },
    ],
  },
  {
    id: 'security',
    label: 'Security',
    icon: <Lock className="w-4 h-4" />,
    children: [
      { label: 'Activity Monitor', href: '/admin/security/activity' },
      { label: 'IP Management', href: '/admin/security/ip' },
      { label: 'Fraud Detection', href: '/admin/security/fraud' },
      { label: 'AML/Compliance', href: '/admin/security/compliance' },
      { label: 'Audit Logs', href: '/admin/security/audit' },
    ],
  },
  {
    id: 'reports',
    label: 'Reports',
    icon: <BarChart3 className="w-4 h-4" />,
    children: [
      { label: 'Financial', href: '/admin/reports/financial' },
      { label: 'Users', href: '/admin/reports/users' },
      { label: 'Trading', href: '/admin/reports/trading' },
      { label: 'P2P', href: '/admin/reports/p2p' },
      { label: 'Custom Reports', href: '/admin/reports/custom' },
    ],
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: <Settings className="w-4 h-4" />,
    children: [
      { label: 'General', href: '/admin/settings' },
      { label: 'Maintenance', href: '/admin/settings/maintenance' },
      { label: 'Feature Toggles', href: '/admin/settings/features' },
      { label: 'API Settings', href: '/admin/settings/api' },
      { label: 'Blockchain', href: '/admin/settings/blockchain' },
      { label: 'Chains', href: '/admin/settings/blockchain/chains' },
      { label: 'Currencies', href: '/admin/settings/blockchain/currencies' },
      { label: 'Trading Pairs', href: '/admin/settings/trading-pairs' },
      { label: 'P2P Assets', href: '/admin/settings/p2p-assets' },
    ],
  },
  {
    id: 'admins',
    label: 'Admin Users',
    icon: <UserCog className="w-4 h-4" />,
    children: [
      { label: 'All Admins', href: '/admin/admins' },
      { label: 'Roles & Permissions', href: '/admin/admins/roles' },
      { label: 'Activity Logs', href: '/admin/admins/logs' },
    ],
  },
  {
    id: 'support',
    label: 'Support',
    icon: <HeadphonesIcon className="w-4 h-4" />,
    children: [
      { label: 'All Tickets', href: '/admin/support' },
      { label: 'My Tickets', href: '/admin/support/my-tickets' },
      { label: 'Canned Responses', href: '/admin/support/responses' },
    ],
  },
];

interface SidebarProps {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
}

export default function Sidebar({ isOpen, setIsOpen }: SidebarProps) {
  const pathname = usePathname();
  const [expandedMenus, setExpandedMenus] = useState<string[]>(['dashboard']);

  const toggleMenu = (menuId: string) => {
    setExpandedMenus((prev) =>
      prev.includes(menuId)
        ? prev.filter((id) => id !== menuId)
        : [...prev, menuId]
    );
  };

  const isActive = (href: string) => pathname === href;
  const isParentActive = (children?: { href: string }[]) =>
    children?.some((child) => pathname === child.href);

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed top-0 left-0 z-50 h-full bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 transition-transform duration-300 lg:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        } w-60 flex flex-col text-[10px]`}
      >
        {/* Logo */}
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

        {/* Menu */}
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
                              {child.badge && (
                                <span className="px-2 py-0.5 text-xs font-medium text-white bg-red-500 rounded-full">
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

        {/* Footer */}
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
