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
  User,
  Copy,
  Wallet,
  CreditCard,
  Gift,
  BookOpen,
  Bell,
  Zap,
  Award,
  BarChart3,
  ArrowRight,
  Sparkles,
  Target,
  Clock,
  CheckCircle2,
  Send,
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
];

const announcements = [
  { title: 'UTA Borrowing : Updates to borrowing limits', isNew: true },
  { title: 'Methereum UTA Function Optimization: Manual Coin Borrowing Will Be Launched Soon', isNew: true },
  { title: 'Methereum to list 21 MNT trading pairs on Spot', isNew: false },
  { title: 'ZetaChain AMA: The Universal Layer for AI and Web3 Explained', isNew: false },
  { title: 'Trade gold & silver on Methereum: Claim up to 2,000 USDT in airdrops!', isNew: false },
];

const helpLinks = [
  { title: 'How to open a trade in Methereum', icon: '📈' },
  { title: 'How to Buy Crypto on Methereum With Zero Fees', icon: '💰' },
  { title: 'How to make a deposit and get $20 worth of BTC', icon: '🎁' },
  { title: 'How to get started with KYC and claim $20 USDT', icon: '✅' },
];

const rewards = [
  { title: '+300%', subtitle: 'APR Booster', icon: '🔥', color: 'from-orange-500 to-red-500' },
  { title: 'Earn 20 USDT', subtitle: 'Complete KYC', icon: '💵', color: 'from-green-500 to-emerald-500' },
  { title: 'Earn 10 USDT', subtitle: 'First Deposit', icon: '💎', color: 'from-blue-500 to-purple-500' },
];

export default function DashboardPage() {
  const { user } = useAuthStore();
  const [activeMarketTab, setActiveMarketTab] = useState('hot');
  const [favorites, setFavorites] = useState<string[]>([]);
  const [uidCopied, setUidCopied] = useState(false);

  const marketTabs = [
    { id: 'favorites', label: 'Favorites', icon: Star },
    { id: 'hot', label: 'Hot', icon: Zap },
    { id: 'gainers', label: 'Gainers', icon: TrendingUp },
    { id: 'losers', label: 'Losers', icon: TrendingDown },
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
    const maskedLocal = local.slice(0, 3) + '***';
    return `${maskedLocal}@${domain}`;
  };

  const copyUID = () => {
    if (user?.id) {
      navigator.clipboard.writeText(user.id);
      setUidCopied(true);
      setTimeout(() => setUidCopied(false), 2000);
    }
  };

  return (
    <div className="p-4 lg:p-8 bg-gray-50 dark:bg-[#0b0e11] min-h-full">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col xl:flex-row gap-6">
          {/* Main Content */}
          <div className="flex-1 space-y-6">
            {/* Welcome Banner */}
            <div className="bg-gradient-to-r from-blue-600 to-blue-700 dark:from-blue-600 dark:to-blue-800 rounded-2xl p-6 lg:p-8 text-white overflow-hidden relative">
              <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl"></div>
              <div className="relative z-10">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                  {/* User Info */}
                  <div className="flex items-center gap-4">
                    <div className="w-16 h-16 bg-white/20 backdrop-blur-sm rounded-2xl flex items-center justify-center">
                      <User className="w-8 h-8 text-white" />
                    </div>
                    <div>
                      <h1 className="text-2xl font-bold">Welcome back!</h1>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-blue-100">{maskEmail(user?.email || '')}</span>
                        <span className="px-2 py-0.5 bg-white/20 rounded-full text-xs">Main Account</span>
                      </div>
                      <div className="flex items-center gap-2 mt-2 text-sm text-blue-200">
                        <span>UID: {user?.id?.slice(0, 8) || '********'}</span>
                        <button onClick={copyUID} className="hover:text-white transition-colors">
                          {uidCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Quick Actions */}
                  <div className="flex flex-wrap gap-3">
                    <Link
                      href="/dashboard/deposit/crypto"
                      className="flex items-center gap-2 px-5 py-2.5 bg-white text-blue-600 font-semibold rounded-xl hover:bg-blue-50 transition-colors"
                    >
                      <Wallet className="w-5 h-5" />
                      Deposit
                    </Link>
                    <Link
                      href="/dashboard/withdraw/crypto"
                      className="flex items-center gap-2 px-5 py-2.5 bg-white/20 backdrop-blur-sm text-white font-semibold rounded-xl hover:bg-white/30 transition-colors"
                    >
                      <Send className="w-5 h-5" />
                      Withdraw
                    </Link>
                    <Link
                      href="/trade/spot"
                      className="flex items-center gap-2 px-5 py-2.5 bg-white/20 backdrop-blur-sm text-white font-semibold rounded-xl hover:bg-white/30 transition-colors"
                    >
                      <BarChart3 className="w-5 h-5" />
                      Trade
                    </Link>
                  </div>
                </div>
              </div>
            </div>

            {/* Progress Steps Card */}
            <div className="bg-white dark:bg-[#181a20] rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center">
                  <Target className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-gray-900 dark:text-white">Get Started</h2>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Complete these steps to unlock full access</p>
                </div>
              </div>

              <div className="p-6">
                <div className="flex items-center justify-between">
                  {/* Step 1: Sign up */}
                  <div className="flex-1 flex flex-col items-center">
                    <div className="w-12 h-12 rounded-full bg-green-500 flex items-center justify-center shadow-lg shadow-green-500/25">
                      <CheckCircle2 className="w-6 h-6 text-white" />
                    </div>
                    <div className="w-full h-1 bg-green-500 mt-4 rounded-full"></div>
                    <p className="mt-3 text-sm font-medium text-green-600 dark:text-green-400">Sign up</p>
                    <p className="text-xs text-gray-400">Completed</p>
                  </div>

                  {/* Connector */}
                  <div className="w-8 h-1 bg-gray-200 dark:bg-gray-700 -mt-8"></div>

                  {/* Step 2: Verify */}
                  <div className="flex-1 flex flex-col items-center">
                    <div className="w-12 h-12 rounded-full bg-blue-500 flex items-center justify-center shadow-lg shadow-blue-500/25 animate-pulse">
                      <Shield className="w-6 h-6 text-white" />
                    </div>
                    <div className="w-full h-1 bg-gray-200 dark:bg-gray-700 mt-4 rounded-full">
                      <div className="w-1/2 h-full bg-blue-500 rounded-full"></div>
                    </div>
                    <p className="mt-3 text-sm font-medium text-blue-600 dark:text-blue-400">Verify Identity</p>
                    <p className="text-xs text-gray-400">In Progress</p>
                  </div>

                  {/* Connector */}
                  <div className="w-8 h-1 bg-gray-200 dark:bg-gray-700 -mt-8"></div>

                  {/* Step 3: Deposit */}
                  <div className="flex-1 flex flex-col items-center">
                    <div className="w-12 h-12 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                      <Wallet className="w-6 h-6 text-gray-400" />
                    </div>
                    <div className="w-full h-1 bg-gray-200 dark:bg-gray-700 mt-4 rounded-full"></div>
                    <p className="mt-3 text-sm font-medium text-gray-400">Make Deposit</p>
                    <p className="text-xs text-gray-400">Locked</p>
                  </div>
                </div>

                {/* KYC Card */}
                <div className="mt-6 p-5 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-xl border border-blue-100 dark:border-blue-800/50">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                      <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
                        Verify your identity to unlock full access
                      </h3>
                      <ul className="space-y-1.5 text-sm text-gray-600 dark:text-gray-400">
                        <li className="flex items-center gap-2">
                          <Clock className="w-4 h-4 text-blue-500" />
                          Takes only 2-5 minutes with a valid ID
                        </li>
                        <li className="flex items-center gap-2">
                          <Shield className="w-4 h-4 text-blue-500" />
                          Encrypted data storage - your info stays private
                        </li>
                        <li className="flex items-center gap-2">
                          <Zap className="w-4 h-4 text-blue-500" />
                          Instant approval for most users
                        </li>
                      </ul>
                    </div>
                    <Link
                      href="/dashboard/identity"
                      className="flex items-center gap-2 px-6 py-3 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-xl transition-colors shadow-lg shadow-blue-500/25 whitespace-nowrap"
                    >
                      Get Verified <ArrowRight className="w-5 h-5" />
                    </Link>
                  </div>
                </div>
              </div>
            </div>

            {/* Markets Section */}
            <div className="bg-white dark:bg-[#181a20] rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-xl flex items-center justify-center">
                    <BarChart3 className="w-5 h-5 text-green-600 dark:text-green-400" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white">Markets</h2>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Real-time cryptocurrency prices</p>
                  </div>
                </div>
                <Link
                  href="/dashboard/markets"
                  className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium flex items-center gap-1"
                >
                  View All Markets <ChevronRight className="w-4 h-4" />
                </Link>
              </div>

              {/* Market Tabs */}
              <div className="px-6 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center gap-2 overflow-x-auto">
                {marketTabs.map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveMarketTab(tab.id)}
                      className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all whitespace-nowrap ${
                        activeMarketTab === tab.id
                          ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/25'
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              {/* Market Table */}
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-50 dark:bg-[#1e2329]">
                      <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Trading Pair</th>
                      <th className="text-right px-6 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Price</th>
                      <th className="text-right px-6 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">24H Change</th>
                      <th className="text-right px-6 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {marketData.map((item) => (
                      <tr
                        key={item.pair}
                        className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                      >
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => toggleFavorite(item.pair)}
                              className="text-gray-300 hover:text-yellow-400 transition-colors"
                            >
                              <Star
                                className={`w-5 h-5 ${
                                  favorites.includes(item.pair)
                                    ? 'fill-yellow-400 text-yellow-400'
                                    : ''
                                }`}
                              />
                            </button>
                            <div
                              className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold shadow-lg"
                              style={{ backgroundColor: item.color }}
                            >
                              {item.icon}
                            </div>
                            <div>
                              <span className="font-semibold text-gray-900 dark:text-white">
                                {item.pair}
                              </span>
                              <span className="text-gray-400">/{item.quote}</span>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <span className="font-mono font-semibold text-gray-900 dark:text-white">
                            ${item.price.toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: item.price < 10 ? 4 : 2,
                            })}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <span
                            className={`inline-flex items-center gap-1 px-3 py-1 rounded-lg text-sm font-semibold ${
                              item.change >= 0
                                ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400'
                                : 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'
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
                        <td className="px-6 py-4 text-right">
                          <Link
                            href={`/trade/spot/${item.pair}${item.quote}`}
                            className="inline-flex items-center gap-1 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium rounded-lg transition-colors"
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
            <div className="bg-white dark:bg-[#181a20] rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-purple-100 dark:bg-purple-900/30 rounded-xl flex items-center justify-center">
                    <Sparkles className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white">Trending Events</h2>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Don't miss out on rewards</p>
                  </div>
                </div>
                <Link
                  href="/dashboard/events"
                  className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium flex items-center gap-1"
                >
                  View All <ChevronRight className="w-4 h-4" />
                </Link>
              </div>

              <div className="p-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {trendingEvents.map((event) => (
                    <div
                      key={event.id}
                      className={`group p-5 rounded-xl bg-gradient-to-r ${event.gradient} cursor-pointer hover:shadow-xl hover:scale-[1.02] transition-all duration-300`}
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-14 h-14 bg-white/20 backdrop-blur-sm rounded-xl flex items-center justify-center text-3xl group-hover:scale-110 transition-transform">
                          {event.image}
                        </div>
                        <div className="flex-1">
                          <p className="text-white font-semibold">{event.title}</p>
                          <p className="text-white/70 text-sm mt-1 flex items-center gap-1">
                            Learn more <ArrowRight className="w-4 h-4" />
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Announcements */}
            <div className="bg-white dark:bg-[#181a20] rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-orange-100 dark:bg-orange-900/30 rounded-xl flex items-center justify-center">
                    <Bell className="w-5 h-5 text-orange-600 dark:text-orange-400" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white">Announcements</h2>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Latest updates from Methereum</p>
                  </div>
                </div>
                <Link
                  href="/dashboard/announcements"
                  className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium flex items-center gap-1"
                >
                  View All <ChevronRight className="w-4 h-4" />
                </Link>
              </div>

              <div className="divide-y divide-gray-100 dark:divide-gray-800">
                {announcements.map((announcement, index) => (
                  <div
                    key={index}
                    className="px-6 py-4 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors cursor-pointer flex items-center justify-between gap-4"
                  >
                    <div className="flex items-center gap-3">
                      {announcement.isNew && (
                        <span className="px-2 py-0.5 bg-red-500 text-white text-xs font-medium rounded">NEW</span>
                      )}
                      <p className="text-sm text-gray-700 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                        {announcement.title}
                      </p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right Sidebar */}
          <div className="w-full xl:w-80 space-y-6">
            {/* My Rewards */}
            <div className="bg-white dark:bg-[#181a20] rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 bg-yellow-100 dark:bg-yellow-900/30 rounded-xl flex items-center justify-center">
                    <Gift className="w-5 h-5 text-yellow-600 dark:text-yellow-400" />
                  </div>
                  <h3 className="font-bold text-gray-900 dark:text-white">My Rewards</h3>
                </div>
                <span className="px-3 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-sm font-semibold rounded-full">
                  0 Available
                </span>
              </div>

              <div className="p-5 space-y-3">
                {rewards.map((reward, index) => (
                  <div
                    key={index}
                    className={`relative p-4 rounded-xl bg-gradient-to-r ${reward.color} cursor-pointer hover:shadow-lg hover:scale-[1.02] transition-all duration-300 overflow-hidden`}
                  >
                    <div className="absolute top-0 right-0 w-20 h-20 bg-white/10 rounded-full -translate-y-1/2 translate-x-1/2"></div>
                    <div className="relative flex items-center gap-3">
                      <div className="w-12 h-12 bg-white/20 backdrop-blur-sm rounded-xl flex items-center justify-center text-2xl">
                        {reward.icon}
                      </div>
                      <div>
                        <p className="font-bold text-white text-lg">{reward.title}</p>
                        <p className="text-white/80 text-sm">{reward.subtitle}</p>
                      </div>
                    </div>
                  </div>
                ))}
                <Link
                  href="/dashboard/referral"
                  className="flex items-center justify-center gap-2 w-full py-3 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 font-medium rounded-xl transition-colors"
                >
                  <Sparkles className="w-4 h-4" />
                  Discover More Rewards
                </Link>
              </div>
            </div>

            {/* New to Crypto */}
            <div className="bg-white dark:bg-[#181a20] rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center gap-3">
                <div className="w-9 h-9 bg-indigo-100 dark:bg-indigo-900/30 rounded-xl flex items-center justify-center">
                  <BookOpen className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                </div>
                <h3 className="font-bold text-gray-900 dark:text-white">New to Crypto?</h3>
              </div>

              <div className="p-5 space-y-3">
                {helpLinks.map((link, index) => (
                  <div
                    key={index}
                    className="flex items-start gap-3 p-3 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer transition-colors group"
                  >
                    <span className="text-xl">{link.icon}</span>
                    <p className="text-sm text-gray-600 dark:text-gray-400 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                      {link.title}
                    </p>
                  </div>
                ))}
                <Link
                  href="/learn"
                  className="flex items-center justify-center gap-2 w-full py-3 text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium transition-colors"
                >
                  Browse Learning Center <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </div>

            {/* Methereum Card Promo */}
            <div className="bg-gradient-to-br from-blue-600 to-indigo-700 rounded-2xl p-5 text-white overflow-hidden relative">
              <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -translate-y-1/2 translate-x-1/2 blur-2xl"></div>
              <div className="relative">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="font-bold text-lg">Methereum Card</h3>
                    <p className="text-blue-200 text-sm mt-1">
                      Live the crypto life with our virtual card
                    </p>
                  </div>
                  <div className="w-16 h-10 bg-white/20 backdrop-blur-sm rounded-lg flex items-center justify-center">
                    <CreditCard className="w-8 h-8" />
                  </div>
                </div>
                <ul className="space-y-2 text-sm text-blue-100 mb-4">
                  <li className="flex items-center gap-2">
                    <Check className="w-4 h-4" /> Spend crypto anywhere
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-4 h-4" /> Up to 5% cashback
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-4 h-4" /> No annual fees
                  </li>
                </ul>
                <button className="w-full py-2.5 bg-white text-blue-600 font-semibold rounded-xl hover:bg-blue-50 transition-colors">
                  Apply Now
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Help Button */}
      <button className="fixed bottom-6 right-6 w-14 h-14 bg-blue-500 hover:bg-blue-600 rounded-full flex items-center justify-center shadow-xl shadow-blue-500/30 transition-all hover:scale-110 z-40">
        <MessageCircle className="w-6 h-6 text-white" />
      </button>
    </div>
  );
}
