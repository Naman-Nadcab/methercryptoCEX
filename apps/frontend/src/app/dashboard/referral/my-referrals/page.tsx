'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Info,
  Calendar,
  ChevronDown,
  Gift,
  HelpCircle,
  FileText,
} from 'lucide-react';

type SignupTab = 'signups' | 'fiat' | 'card' | 'earn';
type HistoryTab = 'commission' | 'task' | 'lucky';
type SpotTab = 'spot';

export default function MyReferralsPage() {
  const [signupTab, setSignupTab] = useState<SignupTab>('signups');
  const [historyTab, setHistoryTab] = useState<HistoryTab>('commission');
  const [spotTab, setSpotTab] = useState<SpotTab>('spot');
  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false);

  const signupTabs = [
    { id: 'signups' as SignupTab, label: 'Signups' },
    { id: 'fiat' as SignupTab, label: 'Fiat' },
    { id: 'card' as SignupTab, label: 'Card' },
    { id: 'earn' as SignupTab, label: 'Earn' },
  ];

  const historyTabs = [
    { id: 'commission' as HistoryTab, label: 'Commission History' },
    { id: 'task' as HistoryTab, label: 'Task Rewards History' },
    { id: 'lucky' as HistoryTab, label: 'Lucky Draw Prizes' },
  ];

  const spotTabs = [
    { id: 'spot' as SpotTab, label: 'Spot' },
  ];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#0b0e11]">
      <div className="max-w-5xl mx-auto px-4 lg:px-8 py-6">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm mb-6">
          <Link href="/dashboard/referral" className="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white">
            Referral Program
          </Link>
          <span className="text-gray-400 dark:text-gray-600">{'>'}</span>
          <span className="text-blue-500 dark:text-blue-400">My Referrals</span>
        </div>

        {/* Overview */}
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">Overview</h2>
        
        {/* Overview Card */}
        <div className="bg-white dark:bg-[#181a20] rounded-xl p-5 mb-6 border border-gray-200 dark:border-transparent">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex items-center gap-1 text-gray-500 dark:text-gray-400 text-sm mb-2">
                <span>Total Commissions</span>
                <Info className="w-4 h-4" />
              </div>
              <p className="text-3xl font-bold text-gray-900 dark:text-white">0</p>
            </div>
            <div className="flex items-center gap-8 mt-4 lg:mt-0">
              <div className="text-center">
                <p className="text-gray-500 dark:text-gray-400 text-sm mb-1">Sign Up</p>
                <p className="text-gray-900 dark:text-white font-semibold">0</p>
              </div>
              <div className="text-center">
                <p className="text-gray-500 dark:text-gray-400 text-sm mb-1">Fiat Deposit</p>
                <p className="text-gray-900 dark:text-white font-semibold">0</p>
              </div>
              <div className="text-center">
                <p className="text-gray-500 dark:text-gray-400 text-sm mb-1">Methereum Card</p>
                <p className="text-gray-900 dark:text-white font-semibold">0</p>
              </div>
              <div className="text-center">
                <p className="text-gray-500 dark:text-gray-400 text-sm mb-1">Earn</p>
                <p className="text-gray-900 dark:text-white font-semibold">0</p>
              </div>
            </div>
          </div>
        </div>

        {/* Signup Tabs */}
        <div className="flex gap-6 mb-6">
          {signupTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setSignupTab(tab.id)}
              className={`text-sm font-medium pb-2 border-b-2 transition-colors ${
                signupTab === tab.id
                  ? 'text-gray-900 dark:text-white border-blue-500'
                  : 'text-gray-500 dark:text-gray-400 border-transparent hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content - Signups */}
        {signupTab === 'signups' && (
          <>
            {/* Commission Rate Card */}
            <div className="bg-white dark:bg-[#181a20] rounded-xl p-5 mb-4 border border-gray-200 dark:border-transparent">
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="flex items-center gap-1 text-gray-500 dark:text-gray-400 text-sm mb-2">
                    <span>My Commission Rate</span>
                    <Info className="w-4 h-4" />
                  </div>
                  <p className="text-3xl font-bold text-blue-500 dark:text-blue-400">20%</p>
                  <div className="flex items-center gap-1 text-gray-500 dark:text-gray-400 text-sm mt-3">
                    <span>Total Commission</span>
                    <Info className="w-4 h-4" />
                  </div>
                  <p className="text-xl font-semibold text-gray-900 dark:text-white">0 <span className="text-sm text-gray-500 dark:text-gray-400">USDT</span></p>
                </div>
                <div className="mt-4 lg:mt-0">
                  <p className="text-gray-500 dark:text-gray-400 text-sm mb-2">Withdrawable Balance</p>
                  <div className="flex items-center gap-3">
                    <p className="text-xl font-semibold text-gray-900 dark:text-white">0 <span className="text-sm text-gray-500 dark:text-gray-400">USDT</span></p>
                    <button className="px-4 py-1.5 bg-transparent border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-white text-sm rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                      Withdraw
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Bonus Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
              {/* Total Bonus */}
              <div className="bg-white dark:bg-[#181a20] rounded-xl p-5 flex items-center justify-between border border-gray-200 dark:border-transparent">
                <div>
                  <p className="text-gray-500 dark:text-gray-400 text-sm mb-2">Total Bonus</p>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white">0 <span className="text-sm text-gray-500 dark:text-gray-400">USDT</span></p>
                </div>
                <div className="text-4xl">🎁</div>
              </div>

              {/* Mystery Box */}
              <div className="bg-white dark:bg-[#181a20] rounded-xl p-5 flex items-center justify-between border border-gray-200 dark:border-transparent">
                <div>
                  <p className="text-gray-500 dark:text-gray-400 text-sm mb-2">Mystery Box</p>
                  <div className="flex items-center gap-2">
                    <p className="text-2xl font-bold text-gray-900 dark:text-white">0</p>
                    <span className="px-2 py-1 bg-blue-500/20 text-blue-500 dark:text-blue-400 text-xs rounded">Earned rewards</span>
                  </div>
                </div>
                <div className="text-4xl">📦</div>
              </div>
            </div>

            {/* Rewards History */}
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">Rewards History</h2>
            
            {/* History Tabs */}
            <div className="flex flex-wrap gap-2 mb-4">
              {historyTabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setHistoryTab(tab.id)}
                  className={`px-4 py-2 text-sm rounded-lg transition-colors ${
                    historyTab === tab.id
                      ? 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white'
                      : 'bg-gray-100 dark:bg-[#181a20] text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Spot Tabs */}
            <div className="flex flex-wrap gap-4 mb-4 border-b border-gray-200 dark:border-gray-800 pb-2">
              {spotTabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setSpotTab(tab.id)}
                  className={`text-sm pb-2 transition-colors ${
                    spotTab === tab.id
                      ? 'text-gray-900 dark:text-white border-b-2 border-gray-900 dark:border-white -mb-[10px]'
                      : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Date Range Filter */}
            <div className="flex items-center gap-2 mb-6">
              <div className="flex items-center bg-gray-100 dark:bg-[#181a20] rounded-lg px-3 py-2 text-sm text-gray-600 dark:text-gray-300">
                <span>2026-01-01</span>
                <span className="mx-2 text-gray-400 dark:text-gray-500">~</span>
                <span>2026-01-30</span>
                <Calendar className="w-4 h-4 ml-2 text-gray-400" />
              </div>
            </div>

            {/* Empty State */}
            <div className="flex flex-col items-center justify-center py-12">
              <div className="w-16 h-16 mb-4 text-5xl">📄</div>
              <p className="text-gray-500 dark:text-gray-400 mb-4">No records found.</p>
              <Link 
                href="/dashboard/referral"
                className="px-6 py-2 border border-blue-500 text-blue-500 dark:text-blue-400 rounded-full hover:bg-blue-500/10 transition-colors"
              >
                Invite Friends
              </Link>
            </div>
          </>
        )}

        {/* Tab Content - Fiat */}
        {signupTab === 'fiat' && (
          <>
            {/* Fiat Stats Card */}
            <div className="bg-white dark:bg-[#181a20] rounded-xl p-5 mb-8 border border-gray-200 dark:border-transparent">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                  <p className="text-gray-500 dark:text-gray-400 text-sm mb-2">Total Rewards</p>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white">0 <span className="text-sm text-gray-500 dark:text-gray-400">USDT</span></p>
                </div>
                <div>
                  <div className="flex items-center gap-1 text-gray-500 dark:text-gray-400 text-sm mb-2">
                    <span>Tasks Completed by Friends</span>
                    <Info className="w-4 h-4" />
                  </div>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white">0</p>
                </div>
                <div>
                  <div className="flex items-center gap-1 text-gray-500 dark:text-gray-400 text-sm mb-2">
                    <span>Tasks Claimed by Friends</span>
                    <Info className="w-4 h-4" />
                  </div>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white">0</p>
                </div>
              </div>
            </div>

            {/* Rewards History */}
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">Rewards History</h2>

            {/* Empty State */}
            <div className="flex flex-col items-center justify-center py-16">
              <div className="w-20 h-20 mb-4 flex items-center justify-center">
                <div className="text-6xl">📋</div>
              </div>
              <p className="text-gray-500 dark:text-gray-400 mb-4">No records found.</p>
              <Link 
                href="/dashboard/referral"
                className="px-6 py-2 border border-blue-500 text-blue-500 dark:text-blue-400 rounded-full hover:bg-blue-500/10 transition-colors"
              >
                Invite Friends
              </Link>
            </div>
          </>
        )}

        {/* Tab Content - Card */}
        {signupTab === 'card' && (
          <>
            {/* Card Stats */}
            <div className="bg-white dark:bg-[#181a20] rounded-xl p-5 mb-8 border border-gray-200 dark:border-transparent">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <p className="text-gray-500 dark:text-gray-400 text-sm mb-2">Commissions</p>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white">0 <span className="text-sm text-gray-500 dark:text-gray-400">USDT</span></p>
                </div>
                <div>
                  <p className="text-gray-500 dark:text-gray-400 text-sm mb-2">Total Applications</p>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white">0</p>
                </div>
              </div>
            </div>

            {/* Empty State */}
            <div className="flex flex-col items-center justify-center py-16">
              <div className="w-20 h-20 mb-4 flex items-center justify-center">
                <div className="text-6xl">📋</div>
              </div>
              <p className="text-gray-500 dark:text-gray-400 mb-4">No records found.</p>
              <Link 
                href="/dashboard/referral"
                className="px-6 py-2 border border-blue-500 text-blue-500 dark:text-blue-400 rounded-full hover:bg-blue-500/10 transition-colors"
              >
                Invite Friends
              </Link>
            </div>
          </>
        )}

        {/* Tab Content - Earn */}
        {signupTab === 'earn' && (
          <>
            {/* Earn Stats Card */}
            <div className="bg-white dark:bg-[#181a20] rounded-xl p-5 mb-8 border border-gray-200 dark:border-transparent">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <p className="text-gray-500 dark:text-gray-400 text-sm mb-2">Total Rewards</p>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white">0 <span className="text-sm text-gray-500 dark:text-gray-400">USDT</span></p>
                </div>
                <div>
                  <div className="flex items-center gap-1 text-gray-500 dark:text-gray-400 text-sm mb-2">
                    <span>Tasks Completed by Friends</span>
                    <Info className="w-4 h-4" />
                  </div>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white">0</p>
                </div>
              </div>
            </div>

            {/* Rewards History */}
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">Rewards History</h2>

            {/* Empty State */}
            <div className="flex flex-col items-center justify-center py-16">
              <div className="w-20 h-20 mb-4 flex items-center justify-center">
                <div className="text-6xl">📋</div>
              </div>
              <p className="text-gray-500 dark:text-gray-400 mb-4">No records found.</p>
              <Link 
                href="/dashboard/referral"
                className="px-6 py-2 border border-blue-500 text-blue-500 dark:text-blue-400 rounded-full hover:bg-blue-500/10 transition-colors"
              >
                Invite Friends
              </Link>
            </div>
          </>
        )}

        {/* Referral History */}
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4 mt-8">Referral History</h2>
        
        {/* Stats Card */}
        <div className="bg-white dark:bg-[#181a20] rounded-xl p-5 mb-4 border border-gray-200 dark:border-transparent">
          <div className="flex items-center gap-12">
            <div>
              <p className="text-gray-500 dark:text-gray-400 text-sm mb-2">Total Friends</p>
              <p className="text-3xl font-bold text-gray-900 dark:text-white">0</p>
            </div>
            <div>
              <div className="flex items-center gap-1 text-gray-500 dark:text-gray-400 text-sm mb-2">
                <span>Qualified Friends</span>
                <Info className="w-4 h-4" />
              </div>
              <p className="text-3xl font-bold text-gray-900 dark:text-white">0</p>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-6">
          {/* Date Range */}
          <div className="flex items-center bg-gray-100 dark:bg-[#181a20] rounded-lg px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
            <span>Start Date</span>
            <span className="mx-2">→</span>
            <span>End Date</span>
            <Calendar className="w-4 h-4 ml-2" />
          </div>

          {/* Status Dropdown */}
          <div className="relative">
            <button
              onClick={() => setStatusDropdownOpen(!statusDropdownOpen)}
              className="flex items-center gap-2 bg-gray-100 dark:bg-[#181a20] rounded-lg px-4 py-2 text-sm text-gray-500 dark:text-gray-400 min-w-[120px]"
            >
              <span>Status</span>
              <ChevronDown className="w-4 h-4 ml-auto" />
            </button>
            {statusDropdownOpen && (
              <div className="absolute top-full left-0 mt-1 w-full bg-white dark:bg-[#181a20] border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-10">
                <button className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700">All</button>
                <button className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700">Qualified</button>
                <button className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700">Pending</button>
              </div>
            )}
          </div>
        </div>

        {/* Empty State */}
        <div className="flex flex-col items-center justify-center py-12">
          <div className="w-16 h-16 mb-4 text-5xl">📄</div>
          <p className="text-gray-500 dark:text-gray-400 mb-4">No records found.</p>
          <Link 
            href="/dashboard/referral"
            className="px-6 py-2 border border-blue-500 text-blue-500 dark:text-blue-400 rounded-full hover:bg-blue-500/10 transition-colors"
          >
            Invite Friends
          </Link>
        </div>
      </div>

      {/* Help Button */}
      <button className="fixed bottom-6 right-6 w-12 h-12 bg-blue-500 hover:bg-blue-600 text-white rounded-full shadow-lg flex items-center justify-center transition-colors z-40">
        <HelpCircle className="w-6 h-6" />
      </button>

      {/* Footer */}
      <footer className="bg-white dark:bg-[#0b0e11] border-t border-gray-200 dark:border-gray-800 py-12 px-4 lg:px-8 mt-8">
        <div className="max-w-5xl mx-auto">
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
                {['f', 'x', 'ig', 'yt', 'in', 'tg', 'tk', 'rd', 'dc'].map((social, i) => (
                  <div
                    key={i}
                    className="w-8 h-8 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700"
                  >
                    <span className="text-xs text-gray-500 dark:text-gray-400">●</span>
                  </div>
                ))}
              </div>
            </div>

            {/* About */}
            <div>
              <h4 className="font-semibold mb-3 text-gray-900 dark:text-white">About</h4>
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
              <h4 className="font-semibold mb-3 text-gray-900 dark:text-white">Services</h4>
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
              <h4 className="font-semibold mb-3 text-gray-900 dark:text-white">Support</h4>
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
              <h4 className="font-semibold mb-3 text-gray-900 dark:text-white">Products</h4>
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
          <div className="pt-6 border-t border-gray-200 dark:border-gray-800 flex flex-wrap items-center justify-center gap-4 text-sm text-gray-500">
            <span>© 2018-2026 Methereum.com. All rights reserved.</span>
            <Link href="/terms" className="hover:text-gray-900 dark:hover:text-white">Terms of Service</Link>
            <Link href="/privacy" className="hover:text-gray-900 dark:hover:text-white">Privacy Terms</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
