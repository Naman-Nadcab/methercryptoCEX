'use client';

import { useState, useEffect } from 'react';
import { useAuthStore } from '@/store/auth';
import { api } from '@/lib/api';
import Link from 'next/link';
import Image from 'next/image';
import {
  Eye,
  EyeOff,
  Download,
  Upload,
  ArrowLeftRight,
  RefreshCw,
  ChevronRight,
  Wallet,
  LayoutGrid,
  TrendingUp,
  Clock,
  Search,
  MoreHorizontal,
  HelpCircle,
  Sparkles,
  ArrowUpRight,
} from 'lucide-react';
interface TokenBalance {
  token_id: string;
  symbol: string;
  name: string;
  total_balance: string;
  available_balance: string;
  locked_balance: string;
  btc_value: string;
  usd_value: string;
  is_delisted?: boolean;
}

export default function FundingAccountPage() {
  const { accessToken, _hasHydrated } = useAuthStore();
  
  const [showBalance, setShowBalance] = useState(true);
  const [activeTab, setActiveTab] = useState<'crypto' | 'fiat'>('crypto');
  const [hideSmallBalances, setHideSmallBalances] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [balances, setBalances] = useState<TokenBalance[]>([]);
  const [totalEquity, setTotalEquity] = useState({ usd: 0, btc: 0 });
  const [availableBalance, setAvailableBalance] = useState({ usd: 0, btc: 0 });
  const [inUse, setInUse] = useState({ usd: 0, btc: 0 });
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<string>('symbol');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [ordersExpanded, setOrdersExpanded] = useState(false);

  // Wait for hydration before fetching
  useEffect(() => {
    if (_hasHydrated && accessToken) {
      fetchBalances();
    } else if (_hasHydrated && !accessToken) {
      setLoading(false);
    }
  }, [_hasHydrated, accessToken]);

  const fetchBalances = async () => {
    try {
      setLoading(true);
      const response = await api.get<{
        balances: TokenBalance[];
        totalEquity: { usd: number; btc: number };
        availableBalance: { usd: number; btc: number };
        inUse: { usd: number; btc: number };
      }>('/api/v1/wallet/balances/funding');

      if (response.success && response.data) {
        setBalances(response.data.balances || []);
        setTotalEquity(response.data.totalEquity || { usd: 0, btc: 0 });
        setAvailableBalance(response.data.availableBalance || { usd: 0, btc: 0 });
        setInUse(response.data.inUse || { usd: 0, btc: 0 });
      }
    } catch (error) {
      console.error('Failed to fetch balances:', error);
    } finally {
      setLoading(false);
    }
  };

  const getTokenIcon = (symbol: string) => {
    return `/assets/upload/currency-logo/${symbol.toLowerCase()}.svg`;
  };

  const formatNumber = (num: number | string, decimals = 8) => {
    const n = typeof num === 'string' ? parseFloat(num) : num;
    return n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  };

  const filteredBalances = balances
    .filter(b => {
      if (hideSmallBalances && parseFloat(b.usd_value) < 1) return false;
      if (searchQuery) {
        return b.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
               b.name.toLowerCase().includes(searchQuery.toLowerCase());
      }
      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'symbol') {
        return sortOrder === 'asc' 
          ? a.symbol.localeCompare(b.symbol)
          : b.symbol.localeCompare(a.symbol);
      }
      return 0;
    });

  const handleSort = (column: string) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(column);
      setSortOrder('asc');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#0b0e11]">
      <div className="flex">
        {/* Sidebar */}
        <aside className="w-60 min-h-screen bg-white dark:bg-[#181a20] border-r border-gray-200 dark:border-gray-800">
          <nav className="p-4 space-y-1">
            <Link
              href="/dashboard/assets/overview"
              className="flex items-center gap-3 px-4 py-3 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded-xl transition-colors"
            >
              <LayoutGrid className="w-5 h-5" />
              Overview
            </Link>
            <Link
              href="/dashboard/assets/funding"
              className="flex items-center gap-3 px-4 py-3 text-sm font-medium bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 text-blue-600 dark:text-blue-400 rounded-xl border border-blue-100 dark:border-blue-800/30"
            >
              <div className="w-5 h-5 rounded-full border-2 border-blue-500 flex items-center justify-center">
                <div className="w-2 h-2 rounded-full bg-blue-500" />
              </div>
              Funding
            </Link>
            <Link
              href="/dashboard/assets/unified"
              className="flex items-center gap-3 px-4 py-3 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded-xl transition-colors"
            >
              <Wallet className="w-5 h-5" />
              Unified Trading
            </Link>
            <Link
              href="/dashboard/assets/convert"
              className="flex items-center gap-3 px-4 py-3 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded-xl transition-colors"
            >
              <RefreshCw className="w-5 h-5" />
              Convert
            </Link>
            <Link
              href="/dashboard/assets/history"
              className="flex items-center gap-3 px-4 py-3 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded-xl transition-colors"
            >
              <Clock className="w-5 h-5" />
              History
            </Link>
            
            <div className="pt-6">
              <p className="px-4 pb-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">Analysis</p>
              <Link
                href="/dashboard/assets/pnl"
                className="flex items-center gap-3 px-4 py-3 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded-xl transition-colors"
              >
                <TrendingUp className="w-5 h-5" />
                P&L Analysis
              </Link>
            </div>
            
            <div className="pt-4">
              <button
                onClick={() => setOrdersExpanded(!ordersExpanded)}
                className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded-xl transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Clock className="w-5 h-5" />
                  Orders
                </div>
                <ChevronRight className={`w-4 h-4 transition-transform ${ordersExpanded ? 'rotate-90' : ''}`} />
              </button>
              {ordersExpanded && (
                <div className="mt-1 ml-4 pl-4 border-l border-gray-200 dark:border-gray-700 space-y-1">
                  <Link href="/dashboard/orders/spot" className="block px-3 py-2 text-sm text-gray-500 hover:text-gray-900 dark:hover:text-white">Spot Orders</Link>
                  <Link href="/dashboard/orders/convert" className="block px-3 py-2 text-sm text-gray-500 hover:text-gray-900 dark:hover:text-white">Convert Orders</Link>
                </div>
              )}
            </div>
          </nav>
        </aside>

        {/* Main Content */}
        <main className="flex-1 p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-4">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Funding Account</h1>
              <button
                onClick={() => setShowBalance(!showBalance)}
                className="p-2 text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
              >
                {showBalance ? <Eye className="w-5 h-5" /> : <EyeOff className="w-5 h-5" />}
              </button>
            </div>

            <div className="flex items-center gap-3">
              <Link
                href="/dashboard/deposit/crypto"
                className="flex items-center gap-2 px-5 py-2.5 bg-blue-500 hover:bg-blue-600 text-white font-medium text-sm rounded-xl shadow-lg shadow-blue-500/25 transition-all hover:shadow-blue-500/40"
              >
                <Download className="w-4 h-4" />
                Deposit
              </Link>
              <Link
                href="/dashboard/withdraw/crypto"
                className="flex items-center gap-2 px-5 py-2.5 bg-white dark:bg-[#1e2329] text-gray-700 dark:text-gray-300 font-medium text-sm rounded-xl border border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600 transition-colors"
              >
                <Upload className="w-4 h-4" />
                Withdraw
              </Link>
              <Link
                href="/dashboard/transfer"
                className="flex items-center gap-2 px-5 py-2.5 bg-white dark:bg-[#1e2329] text-gray-700 dark:text-gray-300 font-medium text-sm rounded-xl border border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600 transition-colors"
              >
                <ArrowLeftRight className="w-4 h-4" />
                Transfer
              </Link>
              <Link
                href="/dashboard/assets/convert"
                className="flex items-center gap-2 px-5 py-2.5 bg-white dark:bg-[#1e2329] text-gray-700 dark:text-gray-300 font-medium text-sm rounded-xl border border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600 transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                Convert
              </Link>
              <Link
                href="/dashboard/assets/history"
                className="flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-[#1e2329] text-gray-700 dark:text-gray-300 font-medium text-sm rounded-xl border border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600 transition-colors"
              >
                <Clock className="w-4 h-4" />
                History
              </Link>
            </div>
          </div>

          {/* Balance Summary */}
          <div className="bg-white dark:bg-[#1e2329] rounded-2xl p-6 mb-8 border border-gray-100 dark:border-gray-800">
            <div className="grid grid-cols-3 gap-8">
              <div className="relative">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center">
                    <Wallet className="w-5 h-5 text-white" />
                  </div>
                  <p className="text-sm font-medium text-gray-500">Total Equity</p>
                </div>
                <p className="text-3xl font-bold text-gray-900 dark:text-white">
                  {showBalance ? formatNumber(totalEquity.usd, 2) : '******'} <span className="text-sm font-normal text-gray-500">USD</span>
                </p>
                <p className="text-sm text-gray-500 mt-1">
                  ≈ {showBalance ? formatNumber(totalEquity.btc, 8) : '********'} BTC
                </p>
              </div>
              <div className="border-l border-gray-100 dark:border-gray-700 pl-8">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center">
                    <ArrowUpRight className="w-5 h-5 text-white" />
                  </div>
                  <p className="text-sm font-medium text-gray-500">Available Balance</p>
                </div>
                <p className="text-3xl font-bold text-gray-900 dark:text-white">
                  {showBalance ? formatNumber(availableBalance.usd, 2) : '******'} <span className="text-sm font-normal text-gray-500">USD</span>
                </p>
                <p className="text-sm text-gray-500 mt-1">
                  ≈ {showBalance ? formatNumber(availableBalance.btc, 8) : '********'} BTC
                </p>
              </div>
              <div className="border-l border-gray-100 dark:border-gray-700 pl-8">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center">
                    <Clock className="w-5 h-5 text-white" />
                  </div>
                  <p className="text-sm font-medium text-gray-500">In Use</p>
                </div>
                <p className="text-3xl font-bold text-gray-900 dark:text-white">
                  {showBalance ? formatNumber(inUse.usd, 2) : '******'} <span className="text-sm font-normal text-gray-500">USD</span>
                </p>
                <p className="text-sm text-gray-500 mt-1">
                  ≈ {showBalance ? formatNumber(inUse.btc, 8) : '********'} BTC
                </p>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="bg-white dark:bg-[#1e2329] rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden">
            <div className="flex gap-1 p-1.5 bg-gray-100 dark:bg-[#2b2f36] m-4 rounded-xl w-fit">
              <button
                onClick={() => setActiveTab('crypto')}
                className={`px-6 py-2.5 text-sm font-medium rounded-lg transition-all ${
                  activeTab === 'crypto'
                    ? 'bg-white dark:bg-[#1e2329] text-blue-600 dark:text-blue-400 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                Crypto
              </button>
              <button
                onClick={() => setActiveTab('fiat')}
                className={`px-6 py-2.5 text-sm font-medium rounded-lg transition-all ${
                  activeTab === 'fiat'
                    ? 'bg-white dark:bg-[#1e2329] text-blue-600 dark:text-blue-400 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                Fiat
              </button>
            </div>

            {/* Filters */}
            <div className="flex items-center justify-between px-6 pb-4">
              <div className="flex items-center gap-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search coin..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10 pr-4 py-2.5 bg-gray-50 dark:bg-[#2b2f36] border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent w-64"
                  />
                </div>
                <label className="flex items-center gap-2.5 cursor-pointer px-3 py-2 bg-gray-50 dark:bg-[#2b2f36] rounded-xl border border-gray-200 dark:border-gray-700">
                  <input
                    type="checkbox"
                    checked={hideSmallBalances}
                    onChange={(e) => setHideSmallBalances(e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300 text-blue-500 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-600 dark:text-gray-400">Hide assets &lt; $1</span>
                </label>
                <Link 
                  href="/dashboard/assets/convert"
                  className="text-sm text-blue-500 hover:text-blue-600 flex items-center gap-1 font-medium"
                >
                  <Sparkles className="w-4 h-4" />
                  Convert Small Balances
                </Link>
              </div>

              {/* Promo Banner */}
              <div className="flex items-center gap-3 px-4 py-2.5 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-xl border border-blue-100 dark:border-blue-800/30">
                <div className="w-8 h-8 rounded-lg bg-blue-500 flex items-center justify-center">
                  <Sparkles className="w-4 h-4 text-white" />
                </div>
                <div className="text-sm">
                  <span className="text-gray-700 dark:text-gray-300">HODL USDe to Enjoy Up to </span>
                  <span className="text-blue-600 dark:text-blue-400 font-semibold">4.50% APR!</span>
                </div>
                <ChevronRight className="w-4 h-4 text-blue-500" />
              </div>
            </div>

            {/* Table */}
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 dark:bg-[#0b0e11] border-y border-gray-100 dark:border-gray-800">
                  <th 
                    className="text-left px-6 py-4 text-xs font-semibold text-gray-500 uppercase cursor-pointer hover:text-blue-500 transition-colors"
                    onClick={() => handleSort('symbol')}
                  >
                    <div className="flex items-center gap-1">
                      Coin {sortBy === 'symbol' && (sortOrder === 'asc' ? '↑' : '↓')}
                    </div>
                  </th>
                  <th className="text-right px-6 py-4 text-xs font-semibold text-gray-500 uppercase">All</th>
                  <th className="text-right px-6 py-4 text-xs font-semibold text-gray-500 uppercase">Available Balance</th>
                  <th className="text-right px-6 py-4 text-xs font-semibold text-gray-500 uppercase">In Use</th>
                  <th className="text-right px-6 py-4 text-xs font-semibold text-gray-500 uppercase">Equivalent</th>
                  <th className="text-right px-6 py-4 text-xs font-semibold text-gray-500 uppercase">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="py-16 text-center">
                      <div className="flex flex-col items-center">
                        <RefreshCw className="w-8 h-8 text-blue-500 animate-spin mb-3" />
                        <p className="text-sm text-gray-500">Loading balances...</p>
                      </div>
                    </td>
                  </tr>
                ) : filteredBalances.length > 0 ? (
                  filteredBalances.map((balance) => (
                    <tr key={balance.token_id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl overflow-hidden bg-gray-100 dark:bg-gray-800 flex items-center justify-center flex-shrink-0">
                            <Image
                              src={getTokenIcon(balance.symbol)}
                              alt={balance.symbol}
                              width={40}
                              height={40}
                              className="object-contain"
                              unoptimized
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = 'none';
                              }}
                            />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-gray-900 dark:text-white">{balance.symbol}</span>
                              {balance.is_delisted && (
                                <span className="px-2 py-0.5 text-xs bg-gray-100 dark:bg-gray-800 text-gray-500 rounded-lg flex items-center gap-1">
                                  Delisted <HelpCircle className="w-3 h-3" />
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-gray-500 mt-0.5">{balance.name}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right font-mono text-sm text-gray-900 dark:text-white">
                        {showBalance ? formatNumber(balance.total_balance) : '********'}
                      </td>
                      <td className="px-6 py-4 text-right font-mono text-sm text-gray-900 dark:text-white">
                        {showBalance ? formatNumber(balance.available_balance) : '********'}
                      </td>
                      <td className="px-6 py-4 text-right font-mono text-sm text-gray-900 dark:text-white">
                        {showBalance ? formatNumber(balance.locked_balance) : '********'}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <p className="font-mono text-sm text-gray-900 dark:text-white">
                          {showBalance ? formatNumber(balance.btc_value) : '********'} BTC
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          ≈ {showBalance ? formatNumber(parseFloat(balance.usd_value), 2) : '****'} USD
                        </p>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Link
                            href={`/dashboard/deposit/crypto?coin=${balance.symbol}`}
                            className="px-3 py-1.5 text-sm text-blue-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors font-medium"
                          >
                            Deposit
                          </Link>
                          <Link
                            href="/dashboard/transfer"
                            className="px-3 py-1.5 text-sm text-blue-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors font-medium"
                          >
                            Transfer
                          </Link>
                          <button className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors">
                            <MoreHorizontal className="w-4 h-4 text-gray-400" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="py-20 text-center">
                      <div className="flex flex-col items-center">
                        <div className="w-20 h-20 bg-gray-100 dark:bg-gray-800 rounded-2xl flex items-center justify-center mb-4">
                          <Wallet className="w-10 h-10 text-gray-300 dark:text-gray-600" />
                        </div>
                        <p className="text-gray-500 font-medium">No assets found</p>
                        <p className="text-sm text-gray-400 mt-1">Deposit funds to get started</p>
                        <Link
                          href="/dashboard/deposit/crypto"
                          className="mt-4 px-6 py-2.5 bg-blue-500 hover:bg-blue-600 text-white font-medium text-sm rounded-xl transition-colors"
                        >
                          Deposit Now
                        </Link>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </main>
      </div>

    </div>
  );
}
