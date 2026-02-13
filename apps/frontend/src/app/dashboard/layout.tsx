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
  Settings,
  Layers,
  Key,
  Receipt,
  ClipboardList,
  ChevronDown,
  Bell,
  ChevronUp,
  Menu,
  X,
  LogOut,
  Wallet,
  ArrowDownUp,
  Copy,
  ChevronRight,
  Sparkles,
  TrendingUp,
  CreditCard,
  PiggyBank,
  LineChart,
  ShoppingCart,
  Percent,
  Shield,
  FileText,
  Download,
} from 'lucide-react';
import SessionManager from '@/components/SessionManager';
import ThemeToggle from '@/components/ThemeToggle';
import ThemeProvider from '@/components/ThemeProvider';
import { getApiBaseUrl } from '@/lib/getApiUrl';

interface MenuItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  href?: string;
  children?: { id: string; label: string; href: string }[];
}

const menuItems: MenuItem[] = [
  {
    id: 'overview',
    label: 'Overview',
    icon: <LayoutDashboard className="w-5 h-5" />,
    href: '/dashboard',
  },
  {
    id: 'account',
    label: 'Account',
    icon: <User className="w-5 h-5" />,
    children: [
      { id: 'account-info', label: 'Account Info', href: '/dashboard/account' },
      { id: 'identity', label: 'Identity Verification', href: '/dashboard/identity' },
      { id: 'security', label: 'Security', href: '/dashboard/security' },
      { id: 'data-export', label: 'Data Export', href: '/dashboard/data-export' },
    ],
  },
  // {
  //   id: 'rewards',
  //   label: 'Rewards Hub',
  //   icon: <Gift className="w-5 h-5" />,
  //   href: '/dashboard/rewards',
  // },
  {
    id: 'referral',
    label: 'Referral Program',
    icon: <Users className="w-5 h-5" />,
    href: '/dashboard/referral',
  },
  {
    id: 'preferences',
    label: 'Preference Settings',
    icon: <Settings className="w-5 h-5" />,
    href: '/dashboard/preferences',
  },
  // {
  //   id: 'subaccount',
  //   label: 'Subaccount',
  //   icon: <Layers className="w-5 h-5" />,
  //   href: '/dashboard/subaccount',
  // },
  {
    id: 'api',
    label: 'API',
    icon: <Key className="w-5 h-5" />,
    href: '/dashboard/api',
  },
  {
    id: 'fee-rates',
    label: 'My Fee Rates',
    icon: <Receipt className="w-5 h-5" />,
    href: '/dashboard/fee-rates',
  },
  {
    id: 'spot-wallet',
    label: 'Spot Wallet',
    icon: <TrendingUp className="w-5 h-5" />,
    href: '/dashboard/wallet/spot',
  },
  // {
  //   id: 'audit',
  //   label: 'Audit',
  //   icon: <ClipboardList className="w-5 h-5" />,
  //   href: '/dashboard/audit',
  // },
];

const navItems = [
  { label: 'Buy Crypto', href: '/dashboard/assets/convert' },
  { label: 'Markets', href: '/dashboard/markets' },
  { label: 'Trade', href: '/dashboard/trade' },
  { label: 'Finance', href: '/dashboard/finance' },
  { label: 'More', href: '#' },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, accessToken, _hasHydrated } = useAuthStore();
  const { setUnauthenticated } = useAuth();
  const [expandedMenus, setExpandedMenus] = useState<string[]>(['account']);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [assetsMenuOpen, setAssetsMenuOpen] = useState(false);
  const [ordersMenuOpen, setOrdersMenuOpen] = useState(false);
  const [depositMenuOpen, setDepositMenuOpen] = useState(false);
  const [notificationMenuOpen, setNotificationMenuOpen] = useState(false);
  const [notifications, setNotifications] = useState<{ id: string; title: string; message: string; is_read: boolean; created_at: string; notification_type: string }[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [uidCopied, setUidCopied] = useState(false);
  const [kycVerified, setKycVerified] = useState(true); // Default true to hide banner initially
  const [showKycBanner, setShowKycBanner] = useState(true);

  // Fetch KYC status
  useEffect(() => {
    if (!_hasHydrated || !accessToken) return;
    const checkKycStatus = async () => {
      
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/v1/wallet/kyc-status`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        
        if (res.ok) {
          const data = await res.json();
          if (data.success) {
            setKycVerified(data.data.verified);
          }
        }
      } catch (error) {
        console.error('Failed to fetch KYC status:', error);
      }
    };
    checkKycStatus();
  }, [_hasHydrated, accessToken]);

  const toggleMenu = (menuId: string) => {
    setExpandedMenus((prev) =>
      prev.includes(menuId)
        ? prev.filter((id) => id !== menuId)
        : [...prev, menuId]
    );
  };

  const fetchNotifications = async () => {
    if (!accessToken) return;
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/v1/user/notifications?limit=20`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      if (data?.success && data?.data) {
        setNotifications(data.data.notifications || []);
        setUnreadCount(data.data.unreadCount ?? 0);
      }
    } catch (_) {}
  };

  const markAllRead = async () => {
    if (!accessToken) return;
    try {
      await fetch(`${getApiBaseUrl()}/api/v1/user/notifications/read-all`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      setUnreadCount(0);
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    } catch (_) {}
  };

  const handleLogout = () => {
    setUnauthenticated();
    router.replace('/login');
  };

  const maskEmail = (email: string) => {
    if (!email) return '***@****';
    const [local, domain] = email.split('@');
    if (!domain) return '***@****';
    const maskedLocal = local.slice(0, 3) + '**' + (local.length > 5 ? local.slice(-1) : '');
    return `${maskedLocal}@****`;
  };

  const copyUID = () => {
    if (user?.id) {
      navigator.clipboard.writeText(user.id);
      setUidCopied(true);
      setTimeout(() => setUidCopied(false), 2000);
    }
  };

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.user-dropdown') && !target.closest('.user-menu-btn')) {
        setUserMenuOpen(false);
      }
      if (!target.closest('.assets-dropdown') && !target.closest('.assets-menu-btn')) {
        setAssetsMenuOpen(false);
      }
      if (!target.closest('.orders-dropdown') && !target.closest('.orders-menu-btn')) {
        setOrdersMenuOpen(false);
      }
      if (!target.closest('.deposit-dropdown') && !target.closest('.deposit-menu-btn')) {
        setDepositMenuOpen(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  return (
    <RequireAuth>
      <ThemeProvider>
        <SessionManager redirectPath="/login" />
        <div className="min-h-screen bg-gray-50 dark:bg-[#0b0e11]">
      {/* Top Header */}
      <header className="bg-white dark:bg-[#181a20] border-b border-gray-200 dark:border-gray-800 sticky top-0 z-50">
        {/* Main Nav */}
        <div className="flex items-center justify-between px-3 h-12">
          {/* Left: Logo + Nav */}
          <div className="flex items-center gap-3">
            {/* Mobile Menu Toggle */}
            <button
              className="lg:hidden p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>

            {/* Logo */}
            <Link href="/dashboard" className="flex items-center gap-1.5">
              <div className="w-7 h-7 bg-blue-500 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-sm">M</span>
              </div>
              <span className="text-lg font-bold text-gray-900 dark:text-white hidden sm:block">
                Methereum
              </span>
            </Link>

            {/* Desktop Nav */}
            <nav className="hidden lg:flex items-center">
              {navItems.map((item) => (
                <Link
                  key={item.label}
                  href={item.href}
                  className="px-2 py-1.5 text-xs text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-1">
            {/* Deposit Button */}
            <button
              onClick={() => {
                setDepositMenuOpen(!depositMenuOpen);
                setAssetsMenuOpen(false);
                setOrdersMenuOpen(false);
                setNotificationMenuOpen(false);
                setUserMenuOpen(false);
              }}
              className="deposit-menu-btn flex items-center gap-1 px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white text-xs font-medium rounded-lg transition-colors"
            >
              <span>Deposit</span>
              <ChevronDown className={`w-3 h-3 transition-transform ${depositMenuOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* Assets Button */}
            <button 
              onClick={() => {
                setAssetsMenuOpen(!assetsMenuOpen);
                setDepositMenuOpen(false);
                setOrdersMenuOpen(false);
                setNotificationMenuOpen(false);
                setUserMenuOpen(false);
              }}
              className="assets-menu-btn flex items-center gap-1 px-2 py-1.5 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
            >
              <span>Assets</span>
              <ChevronDown className={`w-3 h-3 transition-transform ${assetsMenuOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* Orders Button */}
            <button 
              onClick={() => {
                setOrdersMenuOpen(!ordersMenuOpen);
                setDepositMenuOpen(false);
                setAssetsMenuOpen(false);
                setNotificationMenuOpen(false);
                setUserMenuOpen(false);
              }}
              className="orders-menu-btn flex items-center gap-1 px-2 py-1.5 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
            >
              <span>Orders</span>
              <ChevronDown className={`w-3 h-3 transition-transform ${ordersMenuOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* Notification */}
            <button
              onClick={() => {
                setNotificationMenuOpen(!notificationMenuOpen);
                setDepositMenuOpen(false);
                setAssetsMenuOpen(false);
                setOrdersMenuOpen(false);
                setUserMenuOpen(false);
                if (!notificationMenuOpen) fetchNotifications();
              }}
              className="relative p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
            >
              <Bell className="w-5 h-5 text-gray-600 dark:text-gray-300" />
              {unreadCount > 0 && (
                <span className="absolute top-0.5 right-0.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center bg-red-500 text-white text-[10px] font-medium rounded-full">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </button>

            {/* Theme Toggle */}
            <ThemeToggle variant="icon" size="sm" />

            {/* User Menu Button */}
            <button
              onClick={() => {
                setUserMenuOpen(!userMenuOpen);
                setDepositMenuOpen(false);
                setAssetsMenuOpen(false);
                setOrdersMenuOpen(false);
                setNotificationMenuOpen(false);
              }}
              className="user-menu-btn p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
            >
              <User className="w-5 h-5 text-gray-600 dark:text-gray-300" />
            </button>
          </div>

          {/* All Dropdowns - Fixed Position at Top Right */}
          {/* Notifications Dropdown */}
          {notificationMenuOpen && (
            <div className="notification-dropdown fixed right-4 top-14 w-80 bg-white dark:bg-[#1e2026] border border-gray-200 dark:border-gray-700 rounded-2xl shadow-2xl z-[100] overflow-hidden">
              <div className="p-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-900 dark:text-white">Notifications</p>
                {unreadCount > 0 && (
                  <button type="button" onClick={markAllRead} className="text-xs text-blue-500 dark:text-blue-400 hover:underline">
                    Mark all read
                  </button>
                )}
              </div>
              <div className="max-h-80 overflow-y-auto">
                {notifications.length === 0 ? (
                  <div className="p-6 text-center text-sm text-gray-500 dark:text-gray-400">No notifications yet.</div>
                ) : (
                  notifications.map((n) => (
                    <div
                      key={n.id}
                      className={`p-4 border-b border-gray-100 dark:border-gray-800 last:border-0 ${!n.is_read ? 'bg-blue-50/50 dark:bg-blue-900/10' : ''}`}
                    >
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{n.title}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">{n.message}</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
                        {new Date(n.created_at).toLocaleString()}
                      </p>
                    </div>
                  ))
                )}
              </div>
              <div className="p-2 border-t border-gray-200 dark:border-gray-700">
                <Link
                  href="/dashboard/announcements"
                  onClick={() => setNotificationMenuOpen(false)}
                  className="block text-center text-sm text-blue-500 dark:text-blue-400 hover:underline py-2"
                >
                  View announcements
                </Link>
              </div>
            </div>
          )}

          {/* Deposit Dropdown */}
          {depositMenuOpen && (
            <div className="deposit-dropdown fixed right-4 top-14 w-72 bg-white dark:bg-[#1e2026] border border-gray-200 dark:border-gray-700 rounded-2xl shadow-2xl z-[100] overflow-hidden">
              <div className="p-3 border-b border-gray-200 dark:border-gray-700">
                <p className="text-sm font-semibold text-gray-900 dark:text-white">Select Payment Method</p>
              </div>
              <div className="p-2">
                <p className="px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">Already have crypto</p>
                <Link 
                  href="/dashboard/deposit/crypto" 
                  className="flex items-center gap-3 px-3 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-xl"
                  onClick={() => setDepositMenuOpen(false)}
                >
                  <div className="w-8 h-8 bg-yellow-100 dark:bg-yellow-900/30 rounded-lg flex items-center justify-center">
                    <Wallet className="w-4 h-4 text-yellow-600 dark:text-yellow-400" />
                  </div>
                  <div>
                    <p className="font-medium">Deposit Crypto</p>
                    <p className="text-xs text-gray-500">One-click from a verified address</p>
                  </div>
                </Link>
                <Link 
                  href="/p2p" 
                  className="flex items-center gap-3 px-3 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-xl"
                  onClick={() => setDepositMenuOpen(false)}
                >
                  <div className="w-8 h-8 bg-green-100 dark:bg-green-900/30 rounded-lg flex items-center justify-center">
                    <Users className="w-4 h-4 text-green-600 dark:text-green-400" />
                  </div>
                  <div>
                    <p className="font-medium">P2P Trading</p>
                    <p className="text-xs text-gray-500">Zero Fees</p>
                  </div>
                </Link>
                <p className="px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider mt-2">Don&apos;t have crypto</p>
                <Link 
                  href="/dashboard/buy-crypto" 
                  className="flex items-center gap-3 px-3 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-xl"
                  onClick={() => setDepositMenuOpen(false)}
                >
                  <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
                    <CreditCard className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <p className="font-medium">Buy with INR</p>
                    <p className="text-xs text-gray-500">Buy with card or bank transfer</p>
                  </div>
                </Link>
              </div>
            </div>
          )}

          {/* Assets Dropdown */}
          {assetsMenuOpen && (
            <div className="assets-dropdown fixed right-4 top-14 w-80 bg-white dark:bg-[#1e2026] border border-gray-200 dark:border-gray-700 rounded-2xl shadow-2xl z-[100] overflow-hidden">
              <Link 
                href="/dashboard/assets/overview"
                onClick={() => setAssetsMenuOpen(false)}
                className="block p-4 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 hover:from-blue-100 hover:to-indigo-100 dark:hover:from-blue-900/30 dark:hover:to-indigo-900/30 transition-colors"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Assets Overview</span>
                    <Shield className="w-4 h-4 text-blue-500" />
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-400" />
                </div>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">****** <span className="text-sm font-normal text-gray-500">USD</span></p>
                <p className="text-sm text-gray-500 mt-1">≈ ****** BTC</p>
                <p className="text-xs text-gray-400 mt-2">*Data may be delayed.</p>
              </Link>
              <div className="p-3 bg-white dark:bg-[#1e2026] border-t border-gray-100 dark:border-gray-800">
                <div className="grid grid-cols-3 gap-2">
                  <Link href="/dashboard/deposit/crypto" onClick={() => setAssetsMenuOpen(false)} className="flex flex-col items-center gap-1.5 px-3 py-2.5 bg-blue-500 text-white text-xs font-medium rounded-xl hover:bg-blue-600 transition-colors">
                    <Download className="w-4 h-4" />
                    Deposit
                  </Link>
                  <Link href="/dashboard/withdraw/crypto" onClick={() => setAssetsMenuOpen(false)} className="flex flex-col items-center gap-1.5 px-3 py-2.5 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-xs font-medium rounded-xl hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">
                    <ArrowDownUp className="w-4 h-4" />
                    Withdraw
                  </Link>
                  <Link href="/dashboard/transfer" onClick={() => setAssetsMenuOpen(false)} className="flex flex-col items-center gap-1.5 px-3 py-2.5 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-xs font-medium rounded-xl hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">
                    <ArrowDownUp className="w-4 h-4 rotate-90" />
                    Transfer
                  </Link>
                </div>
              </div>
              <div className="p-2 bg-white dark:bg-[#1e2026]">
                <p className="px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">Account</p>
                <Link href="/dashboard/assets/unified" onClick={() => setAssetsMenuOpen(false)} className="flex items-center gap-3 px-3 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-xl">
                  <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center"><Wallet className="w-4 h-4 text-blue-500" /></div>
                  <span className="font-medium">Unified Trading Account</span>
                </Link>
                <Link href="/dashboard/assets/funding" onClick={() => setAssetsMenuOpen(false)} className="flex items-center gap-3 px-3 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-xl">
                  <div className="w-8 h-8 rounded-lg bg-green-100 dark:bg-green-900/30 flex items-center justify-center"><CreditCard className="w-4 h-4 text-green-500" /></div>
                  <span className="font-medium">Funding Account</span>
                </Link>
                <Link href="/dashboard/wallet/spot" onClick={() => setAssetsMenuOpen(false)} className="flex items-center gap-3 px-3 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-xl">
                  <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center"><TrendingUp className="w-4 h-4 text-amber-600 dark:text-amber-400" /></div>
                  <span className="font-medium">Spot Wallet</span>
                </Link>
              </div>
              <div className="p-2 bg-gray-50 dark:bg-[#181a20] border-t border-gray-100 dark:border-gray-800">
                <p className="px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">Invested Products</p>
                <Link href="/dashboard/earn" onClick={() => setAssetsMenuOpen(false)} className="flex items-center gap-3 px-3 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl">
                  <div className="w-8 h-8 rounded-lg bg-yellow-100 dark:bg-yellow-900/30 flex items-center justify-center"><PiggyBank className="w-4 h-4 text-yellow-600" /></div>
                  <span className="font-medium">Earn</span>
                </Link>
                <Link href="/dashboard/copy-trading" onClick={() => setAssetsMenuOpen(false)} className="flex items-center gap-3 px-3 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl">
                  <div className="w-8 h-8 rounded-lg bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center"><TrendingUp className="w-4 h-4 text-purple-500" /></div>
                  <span className="font-medium">Copy Trading</span>
                </Link>
              </div>
            </div>
          )}

          {/* Orders Dropdown */}
          {ordersMenuOpen && (
            <div className="orders-dropdown fixed right-4 top-14 w-64 bg-white dark:bg-[#1e2026] border border-gray-200 dark:border-gray-700 rounded-2xl shadow-2xl z-[100] overflow-hidden">
              <div className="p-2">
                <Link href="/dashboard/orders/unified" onClick={() => setOrdersMenuOpen(false)} className="flex items-center gap-3 px-3 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-xl">
                  <LineChart className="w-4 h-4" />
                  Unified Trading Order
                </Link>
                <Link href="/dashboard/orders/buy-crypto" onClick={() => setOrdersMenuOpen(false)} className="flex items-center gap-3 px-3 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-xl">
                  <ShoppingCart className="w-4 h-4" />
                  Buy Crypto Order
                </Link>
                <Link href="/dashboard/orders/tradfi" onClick={() => setOrdersMenuOpen(false)} className="flex items-center gap-3 px-3 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-xl">
                  <TrendingUp className="w-4 h-4" />
                  TradFi Order
                </Link>
                <Link href="/dashboard/orders/earn" onClick={() => setOrdersMenuOpen(false)} className="flex items-center gap-3 px-3 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-xl">
                  <PiggyBank className="w-4 h-4" />
                  Earn Order
                </Link>
                <Link href="/dashboard/orders/loan" onClick={() => setOrdersMenuOpen(false)} className="flex items-center gap-3 px-3 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-xl">
                  <Percent className="w-4 h-4" />
                  Loan Order
                </Link>
                <Link href="/dashboard/orders/margin-staked" onClick={() => setOrdersMenuOpen(false)} className="flex items-center gap-3 px-3 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-xl">
                  <Layers className="w-4 h-4" />
                  Margin Staked SOL Orders
                </Link>
              </div>
              <div className="p-2 border-t border-gray-200 dark:border-gray-700">
                <Link href="/dashboard/deposit" onClick={() => setOrdersMenuOpen(false)} className="flex items-center gap-3 px-3 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-xl">
                  <Download className="w-4 h-4" />
                  Deposit
                </Link>
              </div>
            </div>
          )}

          {/* User Dropdown */}
          {userMenuOpen && (
            <div className="user-dropdown fixed right-4 top-14 w-72 bg-white dark:bg-[#1e2026] border border-gray-200 dark:border-gray-700 rounded-2xl shadow-2xl z-[100] overflow-hidden">
              {/* User Info Header */}
              <div className="p-4 border-b border-gray-200 dark:border-gray-700">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gray-200 dark:bg-gray-700 rounded-full flex items-center justify-center">
                    <User className="w-5 h-5 text-gray-500" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900 dark:text-white">{maskEmail(user?.email || '')}</span>
                      <span className="px-2 py-0.5 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded">Main Account</span>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-gray-500">
                      <span>UID: {user?.id?.slice(0, 8) || '******'}</span>
                      <button onClick={copyUID} className="p-0.5 hover:text-blue-500">
                        {uidCopied ? <span className="text-green-500">✓</span> : <Copy className="w-3 h-3" />}
                      </button>
                    </div>
                  </div>
                </div>
                <Link 
                  href="/dashboard/identity"
                  onClick={() => setUserMenuOpen(false)}
                  className="flex items-center justify-between mt-3 px-3 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm rounded-lg transition-colors"
                >
                  <span>Complete Identity Verification Now</span>
                  <ChevronRight className="w-4 h-4" />
                </Link>
              </div>
              {/* Switch/Create Account */}
              <div className="p-2 border-b border-gray-200 dark:border-gray-700">
                <button className="w-full flex items-center justify-between px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg">
                  <span>Switch/Create Account</span>
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
              {/* Menu Items */}
              <div className="p-2 max-h-64 overflow-y-auto">
                <Link href="/dashboard" onClick={() => setUserMenuOpen(false)} className="flex items-center gap-3 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg">
                  <LayoutDashboard className="w-4 h-4" />
                  Overview
                </Link>
                <Link href="/dashboard/account" onClick={() => setUserMenuOpen(false)} className="flex items-center gap-3 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg">
                  <User className="w-4 h-4" />
                  Account
                </Link>
                <Link href="/dashboard/events" onClick={() => setUserMenuOpen(false)} className="flex items-center gap-3 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg">
                  <Sparkles className="w-4 h-4" />
                  My Events
                </Link>
                <Link href="/dashboard/referral" onClick={() => setUserMenuOpen(false)} className="flex items-center gap-3 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg">
                  <Users className="w-4 h-4" />
                  Referral Program
                </Link>
                <Link href="/dashboard/preferences" onClick={() => setUserMenuOpen(false)} className="flex items-center gap-3 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg">
                  <Settings className="w-4 h-4" />
                  Preference Settings
                </Link>
                <Link href="/dashboard/api" onClick={() => setUserMenuOpen(false)} className="flex items-center gap-3 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg">
                  <Key className="w-4 h-4" />
                  API
                </Link>
                <Link href="/dashboard/fee-rates" onClick={() => setUserMenuOpen(false)} className="flex items-center gap-3 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg">
                  <Receipt className="w-4 h-4" />
                  My Fee Rates
                </Link>
                <Link href="/dashboard/demo-trading" onClick={() => setUserMenuOpen(false)} className="flex items-center gap-3 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg">
                  <LineChart className="w-4 h-4" />
                  Demo Trading
                  <Sparkles className="w-3 h-3 text-yellow-500" />
                </Link>
              </div>
              {/* Logout */}
              <div className="p-2 border-t border-gray-200 dark:border-gray-700">
                <button 
                  onClick={handleLogout}
                  className="w-full flex items-center gap-3 px-3 py-2 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg"
                >
                  <LogOut className="w-4 h-4" />
                  Logout
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Verification Banner */}
        {!kycVerified && showKycBanner && (
          <div className="flex items-center justify-between px-4 py-2 bg-gray-50 dark:bg-[#1e2026] border-t border-gray-200 dark:border-gray-800">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-gray-600 dark:text-gray-400">
                Complete Identity Verification to continue using platform services.
              </span>
              <Link href="/dashboard/identity" className="text-blue-500 cursor-pointer hover:underline">
                Verify Now
              </Link>
            </div>
            <button 
              onClick={() => setShowKycBanner(false)}
              className="text-gray-400 hover:text-gray-600"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </header>

      <div className="flex">
        {/* Fixed Sidebar - Hidden on assets/deposit/withdraw/transfer pages */}
        {!pathname?.startsWith('/dashboard/assets') && 
         !pathname?.startsWith('/dashboard/deposit') && 
         !pathname?.startsWith('/dashboard/withdraw') && 
         !pathname?.startsWith('/dashboard/transfer') && (
        <aside
          className={`${
            sidebarOpen ? 'w-48' : 'w-14'
          } hidden lg:flex flex-col fixed left-0 top-12 bottom-0 bg-white dark:bg-[#181a20] border-r border-gray-200 dark:border-gray-800 transition-all duration-300 z-30`}
        >
          {/* Sidebar Toggle - Hamburger at extreme left */}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="w-full p-3 flex items-start justify-start hover:bg-gray-50 dark:hover:bg-gray-800 border-b border-gray-200 dark:border-gray-800 flex-shrink-0"
          >
            <Menu className="w-5 h-5 text-gray-600 dark:text-gray-300" />
          </button>

          {/* Menu Items - Scrollable */}
          <nav className="py-2 flex-1 overflow-y-auto">
            {menuItems.map((item) => (
              <div key={item.id}>
                {item.children ? (
                  <>
                    <button
                      onClick={() => toggleMenu(item.id)}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors ${
                        !sidebarOpen ? 'justify-center' : ''
                      }`}
                    >
                      {item.icon}
                      {sidebarOpen && (
                        <>
                          <span className="flex-1 text-left text-xs">{item.label}</span>
                          {expandedMenus.includes(item.id) ? (
                            <ChevronUp className="w-3 h-3" />
                          ) : (
                            <ChevronDown className="w-3 h-3" />
                          )}
                        </>
                      )}
                    </button>
                    {sidebarOpen && expandedMenus.includes(item.id) && (
                      <div className="ml-6 border-l border-gray-200 dark:border-gray-700">
                        {item.children.map((child) => (
                          <Link
                            key={child.id}
                            href={child.href}
                            className={`block px-3 py-1.5 text-xs transition-colors ${
                              pathname === child.href
                                ? 'text-blue-500'
                                : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                            }`}
                          >
                            {child.label}
                          </Link>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <Link
                    href={item.href || '#'}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
                      pathname === item.href
                        ? 'text-blue-500 bg-blue-50 dark:bg-blue-900/20'
                        : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                    } ${!sidebarOpen ? 'justify-center' : ''}`}
                  >
                    {item.icon}
                    {sidebarOpen && <span className="text-xs">{item.label}</span>}
                  </Link>
                )}
              </div>
            ))}
          </nav>
        </aside>
        )}

        {/* Mobile Sidebar Overlay - Hidden on assets/deposit/withdraw/transfer pages */}
        {!pathname?.startsWith('/dashboard/assets') && 
         !pathname?.startsWith('/dashboard/deposit') && 
         !pathname?.startsWith('/dashboard/withdraw') && 
         !pathname?.startsWith('/dashboard/transfer') && 
         mobileMenuOpen && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div
              className="absolute inset-0 bg-black/50"
              onClick={() => setMobileMenuOpen(false)}
            />
            <aside className="absolute left-0 top-0 bottom-0 w-52 bg-white dark:bg-[#181a20] overflow-y-auto">
              {/* Close button at top left */}
              <div className="p-3 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
                <button
                  onClick={() => setMobileMenuOpen(false)}
                  className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                >
                  <Menu className="w-5 h-5 text-gray-600 dark:text-gray-300" />
                </button>
              </div>
              <div className="p-3 border-b border-gray-200 dark:border-gray-800">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-gray-200 dark:bg-gray-700 rounded-full flex items-center justify-center">
                    <User className="w-4 h-4 text-gray-500" />
                  </div>
                  <div>
                    <p className="text-xs font-medium text-gray-900 dark:text-white">
                      {maskEmail(user?.email || '')}
                    </p>
                    <p className="text-[10px] text-gray-500">UID: {user?.id?.slice(0, 8)}</p>
                  </div>
                </div>
              </div>
              <nav className="py-2">
                {menuItems.map((item) => (
                  <div key={item.id}>
                    {item.children ? (
                      <>
                        <button
                          onClick={() => toggleMenu(item.id)}
                          className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                        >
                          {item.icon}
                          <span className="flex-1 text-left">{item.label}</span>
                          {expandedMenus.includes(item.id) ? (
                            <ChevronUp className="w-3 h-3" />
                          ) : (
                            <ChevronDown className="w-3 h-3" />
                          )}
                        </button>
                        {expandedMenus.includes(item.id) && (
                          <div className="ml-6 border-l border-gray-200 dark:border-gray-700">
                            {item.children.map((child) => (
                              <Link
                                key={child.id}
                                href={child.href}
                                onClick={() => setMobileMenuOpen(false)}
                                className="block px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                              >
                                {child.label}
                              </Link>
                            ))}
                          </div>
                        )}
                      </>
                    ) : (
                      <Link
                        href={item.href || '#'}
                        onClick={() => setMobileMenuOpen(false)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                      >
                        {item.icon}
                        <span>{item.label}</span>
                      </Link>
                    )}
                  </div>
                ))}
                <div className="border-t border-gray-200 dark:border-gray-800 mt-2 pt-2">
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>Logout</span>
                  </button>
                </div>
              </nav>
            </aside>
          </div>
        )}

        {/* Main Content - with left margin for fixed sidebar (except on assets/deposit/withdraw/transfer pages) */}
        <main className={`flex-1 min-h-[calc(100vh-48px)] overflow-x-hidden transition-all duration-300 ${
          (pathname?.startsWith('/dashboard/assets') || 
           pathname?.startsWith('/dashboard/deposit') || 
           pathname?.startsWith('/dashboard/withdraw') || 
           pathname?.startsWith('/dashboard/transfer')) ? '' : (sidebarOpen ? 'lg:ml-48' : 'lg:ml-14')
        }`}>
          {children}
        </main>
      </div>

      {/* Footer - with left margin for fixed sidebar (except on assets/deposit/withdraw/transfer pages) */}
      {!pathname?.startsWith('/dashboard/assets') && 
       !pathname?.startsWith('/dashboard/deposit') && 
       !pathname?.startsWith('/dashboard/withdraw') && 
       !pathname?.startsWith('/dashboard/transfer') && (
      <footer className={`bg-white dark:bg-[#181a20] border-t border-gray-200 dark:border-gray-800 py-4 transition-all duration-300 ${
        sidebarOpen ? 'lg:ml-48' : 'lg:ml-14'
      }`}>
        <div className="container mx-auto px-4">
          <div className="flex flex-wrap items-center justify-center gap-6 text-sm text-gray-500 dark:text-gray-400">
            <Link href="#" className="hover:text-gray-900 dark:hover:text-white">
              Market Overview
            </Link>
            <Link href="#" className="hover:text-gray-900 dark:hover:text-white">
              Trading Fee
            </Link>
            <Link href="#" className="hover:text-gray-900 dark:hover:text-white">
              API
            </Link>
            <Link href="#" className="hover:text-gray-900 dark:hover:text-white">
              Help Center
            </Link>
            <span>© 2024 Methereum</span>
          </div>
        </div>
      </footer>
      )}

      {/* Transfer Modal */}
        </div>
      </ThemeProvider>
    </RequireAuth>
  );
}
