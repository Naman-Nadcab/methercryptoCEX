'use client';

import { useState } from 'react';
import { useAuthStore } from '@/store/auth';
import Link from 'next/link';
import {
  Copy,
  Check,
  Edit3,
  User,
  Users,
  Shield,
  Link2,
  LineChart,
  Monitor,
  Activity,
  Trash2,
  ChevronRight,
  ShieldAlert,
  Camera,
} from 'lucide-react';

export default function AccountInfoPage() {
  const { user } = useAuthStore();
  const [copiedUID, setCopiedUID] = useState(false);

  const maskEmail = (email: string) => {
    if (!email) return '***@****';
    const [local, domain] = email.split('@');
    if (!domain) return '***@****';
    const maskedLocal = local.slice(0, 3) + '***';
    const maskedDomain = '****';
    return `${maskedLocal}@${maskedDomain}`;
  };

  const copyUID = () => {
    if (user?.id) {
      navigator.clipboard.writeText(user.id.slice(0, 9));
      setCopiedUID(true);
      setTimeout(() => setCopiedUID(false), 2000);
    }
  };

  const formatDate = (date?: string | null) => {
    if (!date) return '-';
    const d = new Date(date);
    return d.toISOString().slice(0, 16).replace('T', ' ');
  };

  return (
    <div className="p-4 lg:p-6 max-w-5xl">
      {/* Page Title */}
      <h1 className="text-xl font-semibold text-gray-900 dark:text-white mb-6">
        Account Info
      </h1>

      {/* User Profile Section */}
      <div className="bg-white dark:bg-[#181a20] rounded-xl p-6 mb-6">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
          {/* Left: Avatar and Info */}
          <div className="flex items-start gap-4">
            {/* Avatar */}
            <div className="relative">
              <div className="w-16 h-16 bg-gray-200 dark:bg-gray-700 rounded-full flex items-center justify-center">
                {user?.avatarUrl ? (
                  <img 
                    src={user.avatarUrl} 
                    alt="Avatar" 
                    className="w-full h-full rounded-full object-cover"
                  />
                ) : (
                  <User className="w-8 h-8 text-gray-400" />
                )}
              </div>
              <button className="absolute -bottom-1 -right-1 w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center hover:bg-blue-600 transition-colors">
                <Camera className="w-3 h-3 text-white" />
              </button>
            </div>

            {/* User Details */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-lg font-semibold text-gray-900 dark:text-white">
                  {maskEmail(user?.email || '')}
                </span>
                <button className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                  <Edit3 className="w-4 h-4" />
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-6 text-sm">
                {/* UID */}
                <div>
                  <span className="text-gray-500 dark:text-gray-400">UID:</span>
                  <div className="flex items-center gap-1 mt-0.5">
                    <span className="text-gray-900 dark:text-white font-medium">
                      {user?.id?.slice(0, 9) || '********'}
                    </span>
                    <button
                      onClick={copyUID}
                      className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                    >
                      {copiedUID ? (
                        <Check className="w-4 h-4 text-green-500" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Last Login Time */}
                <div>
                  <span className="text-gray-500 dark:text-gray-400">Last login time:</span>
                  <div className="flex items-center gap-1 mt-0.5">
                    <Monitor className="w-4 h-4 text-gray-400" />
                    <span className="text-gray-600 dark:text-gray-300">pc</span>
                    <span className="text-gray-900 dark:text-white">
                      {formatDate(user?.lastLoginAt)}
                    </span>
                  </div>
                </div>

                {/* Security Level */}
                <div>
                  <span className="text-gray-500 dark:text-gray-400">Security Level:</span>
                  <div className="mt-0.5">
                    <span className="text-orange-500 font-medium">Low</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right: Security Alert Card */}
          <div className="flex items-start gap-3 p-4 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-xl max-w-sm">
            <div className="w-12 h-12 bg-orange-100 dark:bg-orange-900/40 rounded-full flex items-center justify-center flex-shrink-0">
              <ShieldAlert className="w-6 h-6 text-orange-500" />
            </div>
            <div>
              <p className="text-sm text-gray-700 dark:text-gray-300 mb-2">
                Your account security level is low. Please set up the following as soon as possible.
              </p>
              <Link 
                href="/dashboard/security"
                className="text-sm text-green-600 dark:text-green-400 hover:underline flex items-center gap-1"
              >
                <Check className="w-4 h-4" />
                Google 2FA Authentication
                <ChevronRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Settings Cards */}
      <div className="bg-white dark:bg-[#181a20] rounded-xl divide-y divide-gray-100 dark:divide-gray-800 mb-6">
        {/* Profile Picture */}
        <div className="flex items-center justify-between p-4">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center">
              <Camera className="w-5 h-5 text-gray-500" />
            </div>
            <div>
              <h3 className="font-medium text-gray-900 dark:text-white">Profile Picture</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Select an avatar to enhance your account's personalization.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1 text-sm text-green-500">
              <span className="w-2 h-2 bg-green-500 rounded-full"></span>
              Set up
            </span>
            <button className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors">
              Settings
            </button>
          </div>
        </div>

        {/* Join Affiliate's Community */}
        <div className="flex items-center justify-between p-4">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center">
              <Users className="w-5 h-5 text-gray-500" />
            </div>
            <div>
              <h3 className="font-medium text-gray-900 dark:text-white">Join an Affiliate's community</h3>
            </div>
          </div>
          <button className="px-4 py-2 text-sm font-medium text-white bg-green-500 hover:bg-green-600 rounded-lg transition-colors">
            Join
          </button>
        </div>

        {/* Identity Verification */}
        <div className="flex items-center justify-between p-4">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center">
              <Shield className="w-5 h-5 text-gray-500" />
            </div>
            <div>
              <h3 className="font-medium text-gray-900 dark:text-white">Identity Verification</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Complete verification to increase daily withdrawal limit
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1 text-sm text-gray-400">
              <span className="w-2 h-2 bg-gray-400 rounded-full"></span>
              Unverified
            </span>
            <Link 
              href="/dashboard/identity"
              className="px-4 py-2 text-sm font-medium text-white bg-green-500 hover:bg-green-600 rounded-lg transition-colors"
            >
              Verify Now
            </Link>
          </div>
        </div>
      </div>

      {/* Account Integrations */}
      <div className="bg-white dark:bg-[#181a20] rounded-xl mb-6">
        <div className="p-4 border-b border-gray-100 dark:border-gray-800">
          <h2 className="font-semibold text-gray-900 dark:text-white">Account Integrations</h2>
        </div>
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {/* Link Account */}
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center">
                <svg className="w-5 h-5 text-gray-500" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" strokeWidth="2" fill="none" />
                </svg>
              </div>
              <div>
                <h3 className="font-medium text-gray-900 dark:text-white">Link Account</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Connect a third-party account for quick Methereum login{' '}
                  <span className="text-blue-500 hover:underline cursor-pointer">How to Unlink</span>
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1 text-sm text-gray-400">
                <span className="w-2 h-2 bg-gray-400 rounded-full"></span>
                Not Yet Configured
              </span>
              <button className="px-4 py-2 text-sm font-medium text-white bg-blue-500 hover:bg-blue-600 rounded-lg transition-colors">
                Settings
              </button>
            </div>
          </div>

          {/* TradingView Alerts */}
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center">
                <LineChart className="w-5 h-5 text-gray-500" />
              </div>
              <div>
                <h3 className="font-medium text-gray-900 dark:text-white">TradingView Alerts</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Link TradingView to your Methereum account
                </p>
              </div>
            </div>
            <button className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors flex items-center gap-2">
              <div className="w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center">
                <span className="text-white text-xs">?</span>
              </div>
              View
            </button>
          </div>
        </div>
      </div>

      {/* Account Activities */}
      <div className="bg-white dark:bg-[#181a20] rounded-xl mb-6">
        <div className="p-4 border-b border-gray-100 dark:border-gray-800">
          <h2 className="font-semibold text-gray-900 dark:text-white">Account Activities</h2>
        </div>
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {/* Trusted Devices Management */}
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center">
                <Monitor className="w-5 h-5 text-gray-500" />
              </div>
              <div>
                <h3 className="font-medium text-gray-900 dark:text-white">Trusted Devices Management</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  You have <span className="text-gray-900 dark:text-white font-medium">1</span> trusted devices logged in
                </p>
              </div>
            </div>
            <button className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors">
              Management
            </button>
          </div>

          {/* Account Activities */}
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center">
                <Activity className="w-5 h-5 text-gray-500" />
              </div>
              <div>
                <h3 className="font-medium text-gray-900 dark:text-white">Account Activities</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Account abnormal?{' '}
                  <span className="text-red-500 hover:underline cursor-pointer">Deactivate an Account</span>
                </p>
              </div>
            </div>
            <button className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors">
              View
            </button>
          </div>

          {/* Delete Account */}
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center">
                <Trash2 className="w-5 h-5 text-gray-500" />
              </div>
              <div>
                <h3 className="font-medium text-gray-900 dark:text-white">Delete account</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Permanently delete the current Main Account and all associated Subaccounts
                </p>
              </div>
            </div>
            <button className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors">
              Delete
            </button>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="mt-12 pt-8 border-t border-gray-200 dark:border-gray-800">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8 mb-8">
          {/* Logo and Social */}
          <div className="col-span-2 md:col-span-1">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold">M</span>
              </div>
              <span className="text-xl font-bold text-gray-900 dark:text-white">Methereum</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {['facebook', 'twitter', 'instagram', 'youtube', 'linkedin', 'telegram', 'tiktok', 'reddit', 'discord'].map((social) => (
                <div
                  key={social}
                  className="w-8 h-8 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700"
                >
                  <span className="text-xs text-gray-500">●</span>
                </div>
              ))}
            </div>
          </div>

          {/* About */}
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white mb-3">About</h3>
            <ul className="space-y-2 text-sm text-gray-500 dark:text-gray-400">
              <li className="hover:text-gray-900 dark:hover:text-white cursor-pointer">About Methereum</li>
              <li className="hover:text-gray-900 dark:hover:text-white cursor-pointer">Meet Mantle</li>
              <li className="hover:text-gray-900 dark:hover:text-white cursor-pointer">Press Room</li>
              <li className="hover:text-gray-900 dark:hover:text-white cursor-pointer">Communities</li>
              <li className="hover:text-gray-900 dark:hover:text-white cursor-pointer">Announcements</li>
              <li className="hover:text-gray-900 dark:hover:text-white cursor-pointer">Risk Disclosure</li>
              <li className="hover:text-gray-900 dark:hover:text-white cursor-pointer">Whistleblower Channel</li>
              <li className="hover:text-gray-900 dark:hover:text-white cursor-pointer">Careers</li>
              <li className="hover:text-gray-900 dark:hover:text-white cursor-pointer">Islamic Account</li>
              <li className="hover:text-gray-900 dark:hover:text-white cursor-pointer">Fees & Transactions Overview</li>
            </ul>
          </div>

          {/* Services */}
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white mb-3">Services</h3>
            <ul className="space-y-2 text-sm text-gray-500 dark:text-gray-400">
              <li className="hover:text-gray-900 dark:hover:text-white cursor-pointer">One-Click Buy</li>
              <li className="hover:text-gray-900 dark:hover:text-white cursor-pointer">P2P Trading (0 Fees)</li>
              <li className="hover:text-gray-900 dark:hover:text-white cursor-pointer">VIP Program</li>
              <li className="hover:text-gray-900 dark:hover:text-white cursor-pointer">Referral Program</li>
              <li className="hover:text-gray-900 dark:hover:text-white cursor-pointer">Institutional Services</li>
              <li className="hover:text-gray-900 dark:hover:text-white cursor-pointer">Listing Application</li>
              <li className="hover:text-gray-900 dark:hover:text-white cursor-pointer">Tax API</li>
              <li className="hover:text-gray-900 dark:hover:text-white cursor-pointer">Audit</li>
            </ul>
          </div>

          {/* Support */}
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white mb-3">Support</h3>
            <ul className="space-y-2 text-sm text-gray-500 dark:text-gray-400">
              <li className="hover:text-gray-900 dark:hover:text-white cursor-pointer">Submit a Request</li>
              <li className="hover:text-gray-900 dark:hover:text-white cursor-pointer">Help Center</li>
              <li className="hover:text-gray-900 dark:hover:text-white cursor-pointer">Support Hub</li>
              <li className="hover:text-gray-900 dark:hover:text-white cursor-pointer">User Feedback</li>
              <li className="hover:text-gray-900 dark:hover:text-white cursor-pointer">Methereum Learn</li>
              <li className="hover:text-gray-900 dark:hover:text-white cursor-pointer">Trading Fee</li>
              <li className="hover:text-gray-900 dark:hover:text-white cursor-pointer">API</li>
              <li className="hover:text-gray-900 dark:hover:text-white cursor-pointer">Authenticity Check</li>
            </ul>
          </div>

          {/* Products */}
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white mb-3">Products</h3>
            <ul className="space-y-2 text-sm text-gray-500 dark:text-gray-400">
              <li className="hover:text-gray-900 dark:hover:text-white cursor-pointer">Trade</li>
              <li className="hover:text-gray-900 dark:hover:text-white cursor-pointer">Derivatives</li>
              <li className="hover:text-gray-900 dark:hover:text-white cursor-pointer">Earn</li>
              <li className="hover:text-gray-900 dark:hover:text-white cursor-pointer">Launchpad</li>
              <li className="hover:text-gray-900 dark:hover:text-white cursor-pointer">Methereum Card</li>
              <li className="hover:text-gray-900 dark:hover:text-white cursor-pointer">TradingView</li>
            </ul>
          </div>
        </div>

        {/* Copyright */}
        <div className="pt-6 border-t border-gray-200 dark:border-gray-800 flex flex-wrap items-center justify-center gap-4 text-sm text-gray-500 dark:text-gray-400">
          <span>© 2018-2026 Methereum.com. All rights reserved.</span>
          <Link href="/terms" className="hover:text-gray-900 dark:hover:text-white">Terms of Service</Link>
          <Link href="/privacy" className="hover:text-gray-900 dark:hover:text-white">Privacy Terms</Link>
        </div>
      </footer>
    </div>
  );
}
