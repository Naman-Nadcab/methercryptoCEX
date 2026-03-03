'use client';

import { useEffect, useState } from 'react';
import { useAuthStore } from '@/store/auth';
import Link from 'next/link';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import {
  Star,
  ChevronRight,
  Check,
  Shield,
  HelpCircle,
  TrendingUp,
  TrendingDown,
  User,
  Copy,
  Wallet,
  Gift,
  Bell,
  Zap,
  BarChart3,
  ArrowRight,
  Target,
  Clock,
  CheckCircle2,
  Send,
  ClipboardList,
} from 'lucide-react';
import { useBalancesSummary } from '@/lib/balances';
import { EXCHANGE_PROGRESS_STEPS } from '@/data/exchangeProgressSteps';

const PAIR_ICONS: Record<string, { icon: string; color: string }> = {
  BTC: { icon: '₿', color: '#F7931A' },
  ETH: { icon: 'Ξ', color: '#627EEA' },
  USDC: { icon: '$', color: '#2775CA' },
  USDT: { icon: '$', color: '#26A17B' },
  SOL: { icon: '◎', color: '#9945FF' },
  XAUT: { icon: '🪙', color: '#D4AF37' },
  XRP: { icon: '✕', color: '#23292F' },
};

interface AnnouncementItem {
  id: string;
  title: string;
  summary: string | null;
  type: string;
  is_pinned: boolean;
  published_at: string | null;
  created_at: string;
}

type TickerRow = { pair: string; quote: string; price: number; change: number; icon: string; color: string };

export default function DashboardPage() {
  const { user, accessToken, _hasHydrated } = useAuthStore();
  const { data: balanceData } = useBalancesSummary(!!_hasHydrated && !!accessToken);
  const totalUsd = (balanceData?.fundingBalance?.totalUsd ?? 0) + (balanceData?.tradingBalance?.totalUsd ?? 0);
  const [activeMarketTab, setActiveMarketTab] = useState('hot');
  const [favorites, setFavorites] = useState<string[]>([]);
  const [uidCopied, setUidCopied] = useState(false);
  const [announcements, setAnnouncements] = useState<AnnouncementItem[]>([]);
  const [announcementsLoading, setAnnouncementsLoading] = useState(true);
  const [announcementsError, setAnnouncementsError] = useState<string | null>(null);
  const [marketData, setMarketData] = useState<TickerRow[]>([]);
  const [marketsLoading, setMarketsLoading] = useState(true);
  const [kycVerified, setKycVerified] = useState<boolean | null>(null);

  useEffect(() => {
    setAnnouncementsLoading(true);
    setAnnouncementsError(null);
    const url = getApiBaseUrl();
    if (!url) {
      setAnnouncementsLoading(false);
      return;
    }
    fetch(`${url}/api/v1/user/announcements?limit=5`, {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    })
      .then((res) => {
        if (res.status === 401) {
          setAnnouncements([]);
          return null;
        }
        return res.json();
      })
      .then((data) => {
        if (data?.success && data?.data?.announcements) setAnnouncements(data.data.announcements);
        else if (data && !data.success) setAnnouncements([]);
      })
      .catch(() => setAnnouncementsError('Could not load announcements'))
      .finally(() => setAnnouncementsLoading(false));
  }, [accessToken]);

  useEffect(() => {
    const url = getApiBaseUrl();
    setMarketsLoading(true);
    if (!url) {
      setMarketsLoading(false);
      return;
    }
    fetch(`${url}/api/v1/spot/tickers`)
      .then((res) => {
        if (res.status === 401) {
          setMarketData([]);
          return null;
        }
        return res.json();
      })
      .then((data) => {
        if (data?.success && Array.isArray(data?.data)) {
          const rows: TickerRow[] = data.data.slice(0, 12).map((t: { symbol: string; base_asset: string; quote_asset: string; last_price: string | null; change_pct?: number }) => {
            const info = PAIR_ICONS[t.base_asset] ?? { icon: t.base_asset.slice(0, 1), color: '#6B7280' };
            const price = parseFloat(t.last_price || '0') || 0;
            const change = typeof t.change_pct === 'number' ? t.change_pct : 0;
            return { pair: t.base_asset, quote: t.quote_asset, price, change, icon: info.icon, color: info.color };
          });
          setMarketData(rows);
        }
      })
      .catch(() => setMarketData([]))
      .finally(() => setMarketsLoading(false));
  }, []);

  useEffect(() => {
    if (!accessToken) return;
    fetch(`${getApiBaseUrl()}/api/v1/wallet/kyc-status`, { headers: { Authorization: `Bearer ${accessToken}` } })
      .then((res) => res.json())
      .then((data) => { if (data?.success) setKycVerified(!!data.data?.verified); })
      .catch(() => setKycVerified(false));
  }, [accessToken]);

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
            {/* Welcome + Balance + Quick Actions */}
            <div className="bg-white dark:bg-[#181a20] rounded-2xl border border-gray-100 dark:border-gray-800 p-5 lg:p-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center">
                    <User className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <h1 className="text-lg font-bold text-gray-900 dark:text-white">Welcome back</h1>
                    <p className="text-sm text-gray-500 dark:text-gray-400">{maskEmail(user?.email || '')}</p>
                    <div className="flex items-center gap-2 mt-1 text-xs text-gray-400">
                      <span>UID: {user?.id?.slice(0, 8) || '********'}</span>
                      <button onClick={copyUID} className="hover:text-blue-500 transition-colors">
                        {uidCopied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      </button>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-6">
                  <div className="text-right">
                    <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">Total Balance</p>
                    <p className="text-xl font-bold text-gray-900 dark:text-white tabular-nums">
                      {Number.isFinite(totalUsd) ? totalUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'} USD
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link
                      href="/dashboard/deposit/crypto"
                      className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white text-sm font-medium rounded-lg hover:bg-blue-600 transition-colors"
                    >
                      <Wallet className="w-4 h-4" />
                      Deposit
                    </Link>
                    <Link
                      href="/dashboard/withdraw/crypto"
                      className="flex items-center gap-2 px-4 py-2 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                    >
                      <Send className="w-4 h-4" />
                      Withdraw
                    </Link>
                    <Link
                      href="/dashboard/spot"
                      className="flex items-center gap-2 px-4 py-2 bg-green-500 text-white text-sm font-medium rounded-lg hover:bg-green-600 transition-colors"
                    >
                      <BarChart3 className="w-4 h-4" />
                      Trade
                    </Link>
                  </div>
                </div>
              </div>
            </div>

            {/* Build Progress Tracker — kya karna hai / kya ho chuka */}
            <Link
              href="/dashboard/progress"
              className="block bg-white dark:bg-[#181a20] rounded-2xl border border-gray-100 dark:border-gray-800 p-4 hover:border-blue-200 dark:hover:border-blue-800 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center">
                    <ClipboardList className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <h2 className="font-semibold text-gray-900 dark:text-white">Build Progress</h2>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {EXCHANGE_PROGRESS_STEPS.filter((s) => s.status === 'done').length} / {EXCHANGE_PROGRESS_STEPS.length} steps done · Kya karna hai · Kya ho chuka hai
                    </p>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-gray-400" />
              </div>
            </Link>

            {/* Progress Steps Card - only when KYC not verified */}
            {kycVerified === false && (
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
            )}

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
                  href="/dashboard/spot"
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
                {marketsLoading ? (
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
                      {[1, 2, 3, 4, 5, 6].map((i) => (
                        <tr key={i} className="animate-pulse">
                          <td className="px-6 py-4"><div className="h-5 w-32 bg-gray-200 dark:bg-gray-700 rounded" /></td>
                          <td className="px-6 py-4 text-right"><div className="h-5 w-20 bg-gray-200 dark:bg-gray-700 rounded ml-auto" /></td>
                          <td className="px-6 py-4 text-right"><div className="h-5 w-16 bg-gray-200 dark:bg-gray-700 rounded ml-auto" /></td>
                          <td className="px-6 py-4 text-right"><div className="h-8 w-16 bg-gray-200 dark:bg-gray-700 rounded ml-auto" /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
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
                            href={`/dashboard/spot?symbol=${item.pair}_${item.quote}`}
                            className="inline-flex items-center gap-1 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium rounded-lg transition-colors"
                          >
                            Trade
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                )}
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
                {announcementsLoading ? (
                  <div className="px-6 py-6 text-center text-sm text-gray-500 dark:text-gray-400">Loading announcements…</div>
                ) : announcementsError ? (
                  <div className="px-6 py-6 text-center text-sm text-amber-600 dark:text-amber-400">{announcementsError}</div>
                ) : announcements.length === 0 ? (
                  <div className="px-6 py-6 text-center text-sm text-gray-500 dark:text-gray-400">No announcements right now.</div>
                ) : (
                  announcements.map((announcement) => {
                    const isNew = announcement.is_pinned || (announcement.published_at && (Date.now() - new Date(announcement.published_at).getTime() < 7 * 24 * 60 * 60 * 1000));
                    return (
                      <Link
                        key={announcement.id}
                        href={`/dashboard/announcements/${announcement.id}`}
                        className="px-6 py-4 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors flex items-center justify-between gap-4"
                      >
                        <div className="flex items-center gap-3">
                          {isNew && (
                            <span className="px-2 py-0.5 bg-red-500 text-white text-xs font-medium rounded">NEW</span>
                          )}
                          <p className="text-sm text-gray-700 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                            {announcement.title}
                          </p>
                        </div>
                        <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
                      </Link>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* Right Sidebar - compact */}
          <div className="w-full xl:w-72 space-y-4">
            <Link
              href="/dashboard/help"
              className="block bg-white dark:bg-[#181a20] rounded-2xl border border-gray-100 dark:border-gray-800 p-4 hover:border-blue-200 dark:hover:border-blue-800 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-900/30 rounded-xl flex items-center justify-center">
                  <HelpCircle className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900 dark:text-white">Help Center</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400">FAQs, guides, and support</p>
                </div>
                <ChevronRight className="w-5 h-5 text-gray-400 ml-auto" />
              </div>
            </Link>
            <Link
              href="/dashboard/referral"
              className="block bg-white dark:bg-[#181a20] rounded-2xl border border-gray-100 dark:border-gray-800 p-4 hover:border-blue-200 dark:hover:border-blue-800 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-xl flex items-center justify-center">
                  <Gift className="w-5 h-5 text-green-600 dark:text-green-400" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900 dark:text-white">Referral Program</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Invite friends, earn rewards</p>
                </div>
                <ChevronRight className="w-5 h-5 text-gray-400 ml-auto" />
              </div>
            </Link>
          </div>
        </div>
      </div>

      {/* Help FAB */}
      <Link
        href="/dashboard/help"
        className="fixed bottom-6 right-6 w-14 h-14 bg-blue-500 hover:bg-blue-600 rounded-full flex items-center justify-center shadow-xl shadow-blue-500/30 transition-all hover:scale-105 z-40"
        aria-label="Help"
      >
        <HelpCircle className="w-6 h-6 text-white" />
      </Link>
    </div>
  );
}
