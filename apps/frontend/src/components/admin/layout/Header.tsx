'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Menu,
  Bell,
  Search,
  User,
  Settings,
  LogOut,
  ChevronDown,
  AlertTriangle,
  CheckCircle,
  Clock,
} from 'lucide-react';
import { useAdminAuthStore } from '@/store/admin-auth';
import ThemeToggle from '@/components/ThemeToggle';

interface HeaderProps {
  onMenuClick: () => void;
}

const notifications = [
  {
    id: 1,
    type: 'warning',
    title: 'Large withdrawal pending',
    message: '50 BTC withdrawal requires approval',
    time: '2 min ago',
  },
  {
    id: 2,
    type: 'info',
    title: 'New KYC submission',
    message: '5 new KYC applications pending review',
    time: '10 min ago',
  },
  {
    id: 3,
    type: 'success',
    title: 'System backup complete',
    message: 'Daily backup completed successfully',
    time: '1 hour ago',
  },
  {
    id: 4,
    type: 'warning',
    title: 'P2P Dispute opened',
    message: 'New dispute requires attention',
    time: '2 hours ago',
  },
];

export default function Header({ onMenuClick }: HeaderProps) {
  const router = useRouter();
  const { admin, logout } = useAdminAuthStore();
  const [showNotifications, setShowNotifications] = useState(false);
  const [showProfile, setShowProfile] = useState(false);

  const handleLogout = () => {
    logout();
    router.push('/admin/login');
  };

  return (
    <header className="h-14 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between px-3 lg:px-4 text-[10px]">
      {/* Left side */}
      <div className="flex items-center gap-4">
        <button
          onClick={onMenuClick}
          className="lg:hidden p-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* Search */}
        <div className="hidden md:flex items-center gap-2 bg-gray-100 dark:bg-gray-800 rounded-lg px-2.5 py-1.5 w-56">
          <Search className="w-3.5 h-3.5 text-gray-600 dark:text-gray-400" />
          <input
            type="text"
            placeholder="Search users, orders..."
            className="bg-transparent border-none outline-none text-[10px] text-gray-900 dark:text-white placeholder-gray-500 w-full"
          />
          <kbd className="hidden lg:inline-flex items-center px-1.5 py-0.5 text-[9px] text-gray-500 bg-gray-200 dark:bg-gray-700 rounded">
            ⌘K
          </kbd>
        </div>
      </div>

      {/* Right side */}
      <div className="flex items-center gap-2">
        {/* Quick Stats */}
        <div className="hidden lg:flex items-center gap-3 mr-3">
          <div className="text-right">
            <p className="text-[9px] text-gray-500">24h Volume</p>
            <p className="text-[11px] font-semibold text-gray-900 dark:text-white">$2.4M</p>
          </div>
          <div className="w-px h-6 bg-gray-200 dark:bg-gray-700" />
          <div className="text-right">
            <p className="text-[9px] text-gray-500">Active Users</p>
            <p className="text-[11px] font-semibold text-green-500 dark:text-green-400">1,245</p>
          </div>
        </div>

        {/* Theme Toggle */}
        <ThemeToggle variant="icon" />

        {/* Notifications */}
        <div className="relative">
          <button
            onClick={() => {
              setShowNotifications(!showNotifications);
              setShowProfile(false);
            }}
            className="relative p-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
          >
            <Bell className="w-5 h-5" />
            <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
          </button>

          {showNotifications && (
            <div className="absolute right-0 mt-2 w-80 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl z-50">
              <div className="p-4 border-b border-gray-200 dark:border-gray-700">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Notifications</h3>
                  <span className="text-xs text-blue-500 dark:text-blue-400 hover:underline cursor-pointer">
                    Mark all read
                  </span>
                </div>
              </div>
              <div className="max-h-80 overflow-y-auto">
                {notifications.map((notif) => (
                  <div
                    key={notif.id}
                    className="p-4 border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-100 dark:hover:bg-gray-700/50 cursor-pointer"
                  >
                    <div className="flex gap-3">
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center ${
                          notif.type === 'warning'
                            ? 'bg-yellow-500/20 text-yellow-500'
                            : notif.type === 'success'
                            ? 'bg-green-500/20 text-green-500'
                            : 'bg-blue-500/20 text-blue-500'
                        }`}
                      >
                        {notif.type === 'warning' ? (
                          <AlertTriangle className="w-4 h-4" />
                        ) : notif.type === 'success' ? (
                          <CheckCircle className="w-4 h-4" />
                        ) : (
                          <Bell className="w-4 h-4" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 dark:text-white">{notif.title}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{notif.message}</p>
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {notif.time}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="p-3 border-t border-gray-200 dark:border-gray-700">
                <Link
                  href="/admin/notifications"
                  className="block text-center text-sm text-blue-500 dark:text-blue-400 hover:text-blue-600 dark:hover:text-blue-300"
                >
                  View all notifications
                </Link>
              </div>
            </div>
          )}
        </div>

        {/* Profile */}
        <div className="relative">
          <button
            onClick={() => {
              setShowProfile(!showProfile);
              setShowNotifications(false);
            }}
            className="flex items-center gap-2 p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
          >
            <div className="w-7 h-7 bg-gradient-to-br from-blue-500 to-blue-500 rounded-full flex items-center justify-center">
              <span className="text-gray-900 dark:text-white text-[10px] font-medium">
                {admin?.name?.split(' ').map(n => n[0]).join('').toUpperCase() || 'AD'}
              </span>
            </div>
            <div className="hidden md:block text-left">
              <p className="text-[11px] font-medium text-gray-900 dark:text-white">{admin?.name || 'Admin'}</p>
              <p className="text-[9px] text-gray-500">{admin?.email || ''}</p>
            </div>
            <ChevronDown className="w-3.5 h-3.5 text-gray-400 hidden md:block" />
          </button>

          {showProfile && (
            <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl z-50">
              <div className="p-3 border-b border-gray-200 dark:border-gray-700">
                <p className="text-[11px] font-medium text-gray-900 dark:text-white">{admin?.name || 'Admin'}</p>
                <p className="text-[9px] text-gray-500">{admin?.email || ''}</p>
                <p className="text-[9px] text-blue-500 dark:text-blue-400 mt-1 capitalize">{admin?.role?.replace('_', ' ') || 'Admin'}</p>
              </div>
              <div className="p-1.5">
                <Link
                  href="/admin/settings"
                  className="flex items-center gap-2 px-2.5 py-1.5 text-[10px] text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                >
                  <Settings className="w-3.5 h-3.5" />
                  Settings
                </Link>
              </div>
              <div className="p-1.5 border-t border-gray-200 dark:border-gray-700">
                <button 
                  onClick={handleLogout}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 text-[10px] text-red-500 dark:text-red-400 hover:text-red-600 dark:hover:text-red-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Sign Out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
