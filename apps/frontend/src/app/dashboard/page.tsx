'use client';

import { useEffect, useState } from 'react';
import { useAuthStore } from '@/store/auth';
import Link from 'next/link';
import {
  Star,
  ChevronRight,
  ChevronDown,
  Check,
  Shield,
  Lock,
  HelpCircle,
  MessageCircle,
  ArrowUpRight,
  TrendingUp,
  TrendingDown,
  X,
} from 'lucide-react';

// Mock market data
const marketData = [
  { pair: 'BTC', quote: 'USDT', price: 82771.8, change: 5.97, icon: '₿', color: '#F7931A' },
  { pair: 'ETH', quote: 'USDT', price: 2740.32, change: 7.16, icon: 'Ξ', color: '#627EEA' },
  { pair: 'USDC', quote: 'USDT', price: 1.0015, change: 0.02, icon: '$', color: '#2775CA' },
  { pair: 'SOL', quote: 'USDT', price: 115.53, change: 6.23, icon: '◎', color: '#9945FF' },
  { pair: 'XAUT', quote: 'USDT', price: 5131.5, change: 7.14, icon: '🪙', color: '#D4AF37' },
  { pair: 'XRP', quote: 'USDT', price: 1.7504, change: 6.84, icon: '✕', color: '#23292F' },
];

const trendingEvents = [
  {
    id: 1,
    title: 'Create Bots and share the 200,000 USDT prize pool!',
    image: '🤖',
    gradient: 'from-purple-500 to-blue-500',
  },
  {
    id: 2,
    title: 'VIP Exclusive Airdrop',
    image: '🎁',
    gradient: 'from-blue-500 to-cyan-500',
  },
  {
    id: 3,
    title: 'Existing followers exclusive',
    image: '👥',
    gradient: 'from-green-500 to-emerald-500',
  },
  {
    id: 4,
    title: 'VIP New Year Trading Boost',
    image: '🚀',
    gradient: 'from-orange-500 to-red-500',
  },
  {
    id: 5,
    title: 'Wednesday Airdrop: Trade to share over $120,000',
    image: '💰',
    gradient: 'from-yellow-500 to-orange-500',
  },
];

const announcements = [
  'UTA Borrowing : Updates to borrowing limits',
  'Methereum UTA Function Optimization: Manual Coin Borrowing Will Be Launched Soon',
  'Methereum to list 21 MNT trading pairs on Spot',
  'ZetaChain AMA: The Universal Layer for AI and Web3 Explained',
  'Trade gold & silver on Methereum: Claim up to 2,000 USDT in airdrops!',
];

const helpLinks = [
  'How to open a trade in Methereum',
  'How to Buy Crypto on Methereum With Zero Fees (A Complete Guide)',
  'How to make a deposit in Methereum and get $20 worth of BTC',
  'How to get started with KYC in Methereum and claim $20 USDT in rewards',
  'Crypto User Protection Guide: Best Practices to Safeguard Your Assets',
];

const rewards = [
  { title: '+300%', subtitle: 'APR Booster', icon: '🔥' },
  { title: 'Earn 20 USDT', subtitle: 'Choose your reward', icon: '💵' },
  { title: 'Earn 20 USDT', subtitle: 'Choose your reward', icon: '💵' },
  { title: 'Earn 20 USDT', subtitle: 'Choose your reward', icon: '💵' },
];

export default function DashboardPage() {
  const { user } = useAuthStore();
  const [activeMarketTab, setActiveMarketTab] = useState('hot');
  const [favorites, setFavorites] = useState<string[]>([]);

  const marketTabs = [
    { id: 'favorites', label: 'Favorites' },
    { id: 'hot', label: 'Hot' },
    { id: 'new', label: 'New' },
    { id: 'gainers', label: 'Gainers' },
    { id: 'losers', label: 'Losers' },
    { id: 'turnover', label: 'Turnover' },
  ];

  const toggleFavorite = (pair: string) => {
    setFavorites((prev) =>
      prev.includes(pair) ? prev.filter((p) => p !== pair) : [...prev, pair]
    );
  };

  const maskEmail = (email: string) => {
    if (!email) return '***@****';
    const [local, domain] = email.split('@');
    if (!domain) return '***@****';
    const maskedLocal = local.slice(0, 3) + '**' + (local.length > 5 ? local.slice(-1) : '');
    return `${maskedLocal}@****`;
  };

  return (
    <div className="p-4 lg:p-6">
      <div className="flex flex-col xl:flex-row gap-6">
        {/* Main Content */}
        <div className="flex-1 space-y-6">
          {/* User Profile Section */}
          <div className="bg-white dark:bg-[#181a20] rounded-xl p-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              {/* User Info */}
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 bg-gray-200 dark:bg-gray-700 rounded-full flex items-center justify-center">
                  <svg className="w-8 h-8 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                  </svg>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-semibold text-gray-900 dark:text-white">
                      {maskEmail(user?.email || '')}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400">
                    <span>UID: {user?.id?.slice(0, 8) || '********'}</span>
                    <button className="text-gray-400 hover:text-gray-600">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>

              {/* Status Badges */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-400"></span>
                  Non-VIP
                </span>
                <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                  Main Account
                </span>
                <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-orange-500"></span>
                  Not Verified
                </span>
              </div>
            </div>

            {/* Progress Steps */}
            <div className="mt-6">
              <div className="flex items-center">
                {/* Step 1: Sign up */}
                <div className="flex-1">
                  <div className="flex items-center">
                    <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center">
                      <Check className="w-5 h-5 text-white" />
                    </div>
                    <div className="flex-1 h-0.5 bg-gray-200 dark:bg-gray-700"></div>
                  </div>
                  <p className="mt-2 text-sm text-gray-500 dark:text-gray-400 flex items-center gap-1">
                    <Check className="w-4 h-4 text-green-500" />
                    Sign up
                  </p>
                </div>

                {/* Step 2: Verify */}
                <div className="flex-1">
                  <div className="flex items-center">
                    <div className="w-8 h-8 rounded-full border-2 border-gray-300 dark:border-gray-600 flex items-center justify-center text-sm font-medium text-gray-500">
                      2
                    </div>
                    <div className="flex-1 h-0.5 bg-gray-200 dark:bg-gray-700"></div>
                  </div>
                  <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                    Verify identity
                  </p>
                </div>

                {/* Step 3: Deposit */}
                <div className="flex-shrink-0">
                  <div className="flex items-center">
                    <div className="w-8 h-8 rounded-full border-2 border-gray-300 dark:border-gray-600 flex items-center justify-center text-sm font-medium text-gray-500">
                      3
                    </div>
                  </div>
                  <p className="mt-2 text-sm text-gray-500 dark:text-gray-400 flex items-center gap-1">
                    <Lock className="w-4 h-4" />
                    Deposit
                  </p>
                </div>
              </div>
            </div>

            {/* KYC Card */}
            <div className="mt-6 p-4 bg-gray-50 dark:bg-[#1e2026] rounded-xl">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                Verify identity to unlock full platform access
              </h3>
              <ul className="space-y-1 text-sm text-gray-500 dark:text-gray-400 mb-4">
                <li className="flex items-center gap-2">
                  <span className="w-1 h-1 rounded-full bg-gray-400"></span>
                  Takes 2-5 minutes with a valid ID
                </li>
                <li className="flex items-center gap-2">
                  <span className="w-1 h-1 rounded-full bg-gray-400"></span>
                  Encrypted data storage - your info stays private
                </li>
                <li className="flex items-center gap-2">
                  <span className="w-1 h-1 rounded-full bg-gray-400"></span>
                  Estimated approval within 5 minutes
                </li>
              </ul>
              <div className="flex items-center gap-4">
                <Link
                  href="/dashboard/identity"
                  className="px-6 py-2 bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-lg transition-colors"
                >
                  Get Verified Now
                </Link>
                <button className="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
                  Why is it important?
                </button>
              </div>
              <p className="mt-3 text-sm text-green-500 flex items-center gap-1">
                <Check className="w-4 h-4" />
                Completed
              </p>
            </div>
          </div>

          {/* Markets Section */}
          <div className="bg-white dark:bg-[#181a20] rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Markets</h2>
              <Link
                href="/dashboard/markets"
                className="text-sm text-blue-500 hover:text-blue-600 flex items-center gap-1"
              >
                Market Overview
                <ChevronRight className="w-4 h-4" />
              </Link>
            </div>

            {/* Market Tabs */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-1">
                {marketTabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveMarketTab(tab.id)}
                    className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                      activeMarketTab === tab.id
                        ? 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white font-medium'
                        : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <button className="flex items-center gap-1 px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-800 rounded-lg text-gray-600 dark:text-gray-300">
                  Spot
                  <ChevronDown className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Market Table */}
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-sm text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-800">
                    <th className="text-left py-3 font-normal">Trading Pairs</th>
                    <th className="text-right py-3 font-normal">Price</th>
                    <th className="text-right py-3 font-normal">24H Change</th>
                    <th className="text-right py-3 font-normal">Trade</th>
                  </tr>
                </thead>
                <tbody>
                  {marketData.map((item) => (
                    <tr
                      key={item.pair}
                      className="border-b border-gray-50 dark:border-gray-800/50 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                    >
                      <td className="py-3">
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => toggleFavorite(item.pair)}
                            className="text-gray-300 hover:text-yellow-400"
                          >
                            <Star
                              className={`w-4 h-4 ${
                                favorites.includes(item.pair)
                                  ? 'fill-yellow-400 text-yellow-400'
                                  : ''
                              }`}
                            />
                          </button>
                          <div
                            className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-sm"
                            style={{ backgroundColor: item.color }}
                          >
                            {item.icon}
                          </div>
                          <div>
                            <span className="font-medium text-gray-900 dark:text-white">
                              {item.pair}
                            </span>
                            <span className="text-gray-400">/{item.quote}</span>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 text-right font-mono text-gray-900 dark:text-white">
                        {item.price.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: item.price < 10 ? 4 : 2,
                        })}
                      </td>
                      <td className="py-3 text-right">
                        <span
                          className={`flex items-center justify-end gap-1 ${
                            item.change >= 0 ? 'text-green-500' : 'text-red-500'
                          }`}
                        >
                          {item.change >= 0 ? (
                            <TrendingUp className="w-4 h-4" />
                          ) : (
                            <TrendingDown className="w-4 h-4" />
                          )}
                          {item.change >= 0 ? '+' : ''}{item.change.toFixed(2)}%
                        </span>
                      </td>
                      <td className="py-3 text-right">
                        <Link
                          href={`/dashboard/trade/${item.pair}${item.quote}`}
                          className="text-blue-500 hover:text-blue-600 font-medium"
                        >
                          Trade
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Trending Events */}
          <div className="bg-white dark:bg-[#181a20] rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                Trending Events
              </h2>
              <Link
                href="/dashboard/events"
                className="text-sm text-blue-500 hover:text-blue-600 flex items-center gap-1"
              >
                My Events
                <ChevronRight className="w-4 h-4" />
              </Link>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {trendingEvents.slice(0, 4).map((event) => (
                <div
                  key={event.id}
                  className={`p-4 rounded-xl bg-gradient-to-r ${event.gradient} cursor-pointer hover:shadow-lg transition-shadow`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-white/20 rounded-lg flex items-center justify-center text-2xl">
                      {event.image}
                    </div>
                    <p className="text-white font-medium text-sm">{event.title}</p>
                  </div>
                </div>
              ))}
              {trendingEvents[4] && (
                <div
                  className={`p-4 rounded-xl bg-gradient-to-r ${trendingEvents[4].gradient} cursor-pointer hover:shadow-lg transition-shadow sm:col-span-2`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-white/20 rounded-lg flex items-center justify-center text-2xl">
                      {trendingEvents[4].image}
                    </div>
                    <p className="text-white font-medium text-sm">{trendingEvents[4].title}</p>
                  </div>
                </div>
              )}
            </div>

            <Link
              href="/dashboard/events"
              className="mt-4 text-sm text-blue-500 hover:text-blue-600 flex items-center gap-1"
            >
              View More Events
              <ChevronRight className="w-4 h-4" />
            </Link>
          </div>

          {/* Announcements */}
          <div className="bg-white dark:bg-[#181a20] rounded-xl p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Announcements
            </h2>
            <div className="space-y-3">
              {announcements.map((announcement, index) => (
                <p
                  key={index}
                  className="text-sm text-gray-600 dark:text-gray-400 hover:text-blue-500 cursor-pointer transition-colors"
                >
                  {announcement}
                </p>
              ))}
            </div>
            <Link
              href="/dashboard/announcements"
              className="mt-4 text-sm text-blue-500 hover:text-blue-600 flex items-center gap-1"
            >
              More Announcements
              <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
        </div>

        {/* Right Sidebar */}
        <div className="w-full xl:w-80 space-y-6">
          {/* New to Crypto */}
          <div className="bg-white dark:bg-[#181a20] rounded-xl p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              New to Crypto?
            </h3>
            <div className="space-y-3">
              {helpLinks.map((link, index) => (
                <p
                  key={index}
                  className="text-sm text-gray-600 dark:text-gray-400 hover:text-blue-500 cursor-pointer transition-colors"
                >
                  {link}
                </p>
              ))}
            </div>
            <button className="mt-4 text-sm text-blue-500 hover:text-blue-600 flex items-center gap-1">
              Learn More
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* My Rewards */}
          <div className="bg-white dark:bg-[#181a20] rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">My Rewards</h3>
              <span className="text-sm text-gray-500">
                <span className="font-medium text-gray-900 dark:text-white">0</span> Available
                <ChevronRight className="w-4 h-4 inline ml-1" />
              </span>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              Win the rewards below by completing simple tasks!
            </p>
            <div className="space-y-3">
              {rewards.map((reward, index) => (
                <div
                  key={index}
                  className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-[#1e2026] rounded-lg cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                >
                  <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center text-lg">
                    {reward.icon}
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900 dark:text-white">{reward.title}</p>
                    <p className="text-xs text-gray-500">{reward.subtitle}</p>
                  </div>
                </div>
              ))}
            </div>
            <Link
              href="/dashboard/rewards"
              className="mt-4 text-sm text-blue-500 hover:text-blue-600 flex items-center gap-1"
            >
              Discover Rewards
              <ChevronRight className="w-4 h-4" />
            </Link>
          </div>

          {/* Methereum Card */}
          <div className="bg-white dark:bg-[#181a20] rounded-xl p-6">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Methereum Card
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  Live the crypto life with Methereum Card
                </p>
                <button className="mt-3 text-sm text-blue-500 hover:text-blue-600 flex items-center gap-1">
                  Check It Out
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
              <div className="w-20 h-14 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg flex items-center justify-center">
                <span className="text-white text-2xl">💳</span>
              </div>
            </div>
            <button className="absolute top-2 right-2 text-gray-400 hover:text-gray-600">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Help Button */}
          <button className="fixed bottom-6 right-6 w-12 h-12 bg-blue-500 hover:bg-blue-600 rounded-full flex items-center justify-center shadow-lg transition-colors z-40">
            <MessageCircle className="w-6 h-6 text-white" />
          </button>
        </div>
      </div>
    </div>
  );
}
