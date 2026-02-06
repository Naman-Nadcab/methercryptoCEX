'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth';
import { api } from '@/lib/api';
import Link from 'next/link';
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
  MoreHorizontal,
  ArrowRight,
  FileText,
  ChevronDown,
} from 'lucide-react';
interface AccountBalance {
  type: string;
  totalUsd: number;
  totalBtc: number;
}

interface Transaction {
  id: string;
  type: 'deposit' | 'withdrawal';
  symbol: string;
  amount: string;
  status: string;
  created_at: string;
}

export default function AssetsOverviewPage() {
  const router = useRouter();
  const { accessToken, _hasHydrated } = useAuthStore();

  const [showBalance, setShowBalance] = useState(true);
  const [activeTab, setActiveTab] = useState<'account' | 'asset'>('account');
  const [timePeriod, setTimePeriod] = useState('7D');
  const [fundingBalance, setFundingBalance] = useState<AccountBalance>({ type: 'funding', totalUsd: 0, totalBtc: 0 });
  const [tradingBalance, setTradingBalance] = useState<AccountBalance>({ type: 'trading', totalUsd: 0, totalBtc: 0 });
  const [recentTransactions, setRecentTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string>('');
  const [ordersExpanded, setOrdersExpanded] = useState(false);
  const [showWhyZero, setShowWhyZero] = useState(false);
  const [whyZeroReason, setWhyZeroReason] = useState<{ funds: string; history: string } | null>(null);
  const [whyZeroLoading, setWhyZeroLoading] = useState(false);
  const [balanceError, setBalanceError] = useState<string | null>(null);

  const fetchWhyZero = async () => {
    if (!accessToken) return;
    setWhyZeroLoading(true);
    setWhyZeroReason(null);
    try {
      const data = await api.get<{ reason_funds_zero?: string; reason_history_empty?: string }>('/api/v1/wallet/balance-diagnostic');
      if (data.success && data.data) {
        const d = data.data as { reason_funds_zero?: string; reason_history_empty?: string };
        setWhyZeroReason({
          funds: d.reason_funds_zero || 'Unknown',
          history: d.reason_history_empty || 'Unknown',
        });
      }
    } catch {
      setWhyZeroReason({ funds: 'Could not load reason.', history: 'Could not load reason.' });
    } finally {
      setWhyZeroLoading(false);
    }
  };

  useEffect(() => {
    if (_hasHydrated && accessToken) {
      fetchBalances();
      fetchRecentTransactions();
    }
  }, [_hasHydrated, accessToken]);

  const fetchBalances = async () => {
    if (!accessToken) return;
    try {
      setLoading(true);
      setBalanceError(null);
      const data = await api.get<{
        funding?: { totalUsd?: number }; trading?: { totalUsd?: number };
      }>('/api/v1/wallet/balances/summary');
      if (!data.success) {
        const msg = data.error?.message || data.error?.code || 'Could not load balance.';
        setBalanceError(
          data.error?.code === 'UNAUTHORIZED' || data.error?.code === 'SESSION_EXPIRED' || data.error?.code === 'INVALID_TOKEN'
            ? 'Session expired. Please log in again.'
            : msg
        );
        return;
      }
      if (data.data) {
        const funding = (data.data as { funding?: { totalUsd?: number }; trading?: { totalUsd?: number } }).funding || { type: 'funding', totalUsd: 0, totalBtc: 0 };
        const trading = (data.data as { trading?: { totalUsd?: number } }).trading || { type: 'trading', totalUsd: 0, totalBtc: 0 };
        let fundingUsd = Number(funding.totalUsd) || 0;
        let tradingUsd = Number(trading.totalUsd) || 0;
        if (fundingUsd === 0 && tradingUsd === 0) {
          const byData = await api.get<{ funding?: string; trading?: string; total?: string }[]>('/api/v1/wallet/balances/by-account');
          if (byData.success && Array.isArray(byData.data)) {
            let sumFunding = 0;
            let sumTrading = 0;
            byData.data.forEach((row: { funding?: string; trading?: string; total?: string }) => {
              sumFunding += parseFloat(row.funding || '0');
              sumTrading += parseFloat(row.trading || '0');
            });
            if (sumFunding > 0 || sumTrading > 0) {
              fundingUsd = sumFunding;
              tradingUsd = sumTrading;
            }
          } else if (!byData.success && byData.error) {
            setBalanceError(
              byData.error.code === 'UNAUTHORIZED' || byData.error.code === 'SESSION_EXPIRED'
                ? 'Session expired. Please log in again.'
                : byData.error.message || 'Could not load balance breakdown.'
            );
          }
        }
        setFundingBalance({ type: 'funding', totalUsd: fundingUsd, totalBtc: fundingUsd / 82000 });
        setTradingBalance({ type: 'trading', totalUsd: tradingUsd, totalBtc: tradingUsd / 82000 });
        setLastUpdated(new Date().toISOString());
      }
    } catch (error) {
      console.error('Failed to fetch balances:', error);
      setBalanceError('Network error. Check backend is running and try again.');
    } finally {
      setLoading(false);
    }
  };

  const fetchRecentTransactions = async () => {
    if (!accessToken) return;
    try {
      const [depositsData, withdrawalsData] = await Promise.all([
        api.get<unknown[]>('/api/v1/wallet/deposit-history?limit=5'),
        api.get<unknown[]>('/api/v1/wallet/withdrawals?limit=5'),
      ]);

      const deposits = (depositsData.success && depositsData.data) ? (Array.isArray(depositsData.data) ? depositsData.data : []) : [];
      const withdrawals = (withdrawalsData.success && withdrawalsData.data) ? (Array.isArray(withdrawalsData.data) ? withdrawalsData.data : []) : [];

      const combined: Transaction[] = [
        ...deposits.map((d: any) => ({
          id: d.id,
          type: 'deposit' as const,
          symbol: d.symbol || 'Unknown',
          amount: d.amount || '0',
          status: d.status || 'pending',
          created_at: d.created_at || d.createdAt,
        })),
        ...withdrawals.map((w: any) => ({
          id: w.id,
          type: 'withdrawal' as const,
          symbol: w.symbol || w.coin || 'Unknown',
          amount: w.amount || w.quantity || '0',
          status: w.status || 'pending',
          created_at: w.created_at || w.date_time || w.createdAt,
        })),
      ]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 10);

      setRecentTransactions(combined);
    } catch (error) {
      console.error('Failed to fetch transactions:', error);
    }
  };

  const totalUsd = fundingBalance.totalUsd + tradingBalance.totalUsd;
  const totalBtc = fundingBalance.totalBtc + tradingBalance.totalBtc;

  const formatNumber = (num: number, decimals = 2) => {
    return num.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  };

  const timePeriods = ['7D', '30D', '90D', '180D'];

  // Generate chart data points (placeholder)
  const chartDates = [];
  const today = new Date();
  for (let i = 5; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(today.getDate() - i);
    chartDates.push(`${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`);
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#0b0e11]">
      <div className="flex">
        {/* Sidebar */}
        <aside className="w-60 min-h-screen bg-white dark:bg-[#181a20] border-r border-gray-200 dark:border-gray-800">
          <nav className="p-4 space-y-1">
            {/* Overview */}
            <Link
              href="/dashboard/assets/overview"
              className="flex items-center gap-3 px-4 py-3 text-sm font-medium bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 text-blue-600 dark:text-blue-400 rounded-xl border border-blue-100 dark:border-blue-800/30"
            >
              <LayoutGrid className="w-5 h-5" />
              Overview
            </Link>
            
            {/* Funding */}
            <Link
              href="/dashboard/assets/funding"
              className="flex items-center gap-3 px-4 py-3 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded-xl transition-colors"
            >
              <div className="w-5 h-5 rounded-full border-2 border-gray-400 dark:border-gray-500 flex items-center justify-center">
                <div className="w-2 h-2 rounded-full bg-gray-400 dark:bg-gray-500" />
              </div>
              Funding
            </Link>
            
            {/* Unified Trading */}
            <Link
              href="/dashboard/assets/unified"
              className="flex items-center gap-3 px-4 py-3 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded-xl transition-colors"
            >
              <Wallet className="w-5 h-5" />
              Unified Trading
            </Link>
            
            {/* Convert */}
            <Link
              href="/dashboard/assets/convert"
              className="flex items-center gap-3 px-4 py-3 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded-xl transition-colors"
            >
              <RefreshCw className="w-5 h-5" />
              Convert
            </Link>
            
            {/* History */}
            <Link
              href="/dashboard/assets/history"
              className="flex items-center gap-3 px-4 py-3 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded-xl transition-colors"
            >
              <Clock className="w-5 h-5" />
              History
            </Link>
            
            {/* Analysis Section */}
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
            
            {/* Orders Section */}
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
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Assets Overview</h1>
              <button
                onClick={() => setShowBalance(!showBalance)}
                className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
              >
                {showBalance ? <Eye className="w-5 h-5" /> : <EyeOff className="w-5 h-5" />}
              </button>
            </div>

            {/* Action Buttons */}
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
                className="flex items-center gap-2 px-5 py-2.5 bg-white dark:bg-[#1e2329] text-gray-700 dark:text-gray-300 font-medium text-sm rounded-xl border border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 transition-colors"
              >
                <Upload className="w-4 h-4" />
                Withdraw
              </Link>
              <Link
                href="/dashboard/transfer"
                className="flex items-center gap-2 px-5 py-2.5 bg-white dark:bg-[#1e2329] text-gray-700 dark:text-gray-300 font-medium text-sm rounded-xl border border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 transition-colors"
              >
                <ArrowLeftRight className="w-4 h-4" />
                Transfer
              </Link>
              <Link
                href="/dashboard/assets/convert"
                className="flex items-center gap-2 px-5 py-2.5 bg-white dark:bg-[#1e2329] text-gray-700 dark:text-gray-300 font-medium text-sm rounded-xl border border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                Convert
              </Link>
            </div>
          </div>

          {/* Balance load error */}
          {balanceError && (
            <div className="mb-6 p-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 flex flex-wrap items-center justify-between gap-4">
              <p className="text-sm text-amber-800 dark:text-amber-200">{balanceError}</p>
              <div className="flex items-center gap-2">
                {balanceError.includes('Session expired') && (
                  <Link
                    href="/login"
                    className="px-4 py-2 text-sm font-medium rounded-lg bg-amber-600 text-white hover:bg-amber-700"
                  >
                    Log in again
                  </Link>
                )}
                <button
                  type="button"
                  onClick={() => fetchBalances()}
                  className="px-4 py-2 text-sm font-medium rounded-lg bg-amber-500 text-white hover:bg-amber-600"
                >
                  Retry
                </button>
              </div>
            </div>
          )}

          {/* Total Balance Card */}
          <div className="bg-white dark:bg-[#1e2329] rounded-2xl p-6 mb-8 border border-gray-100 dark:border-gray-800">
            <h2 className="text-4xl font-bold text-gray-900 dark:text-white">
              {showBalance ? formatNumber(totalUsd) : '******'} <span className="text-xl font-normal text-gray-500">USD</span>
            </h2>
            <p className="text-base text-gray-500 mt-2">
              ≈ {showBalance ? formatNumber(totalBtc, 8) : '********'} BTC
            </p>
            <div className="flex items-center gap-2 mt-4 pt-4 border-t border-gray-100 dark:border-gray-800">
              <span className="text-sm text-gray-500">Today's P&L</span>
              <span className="text-sm font-medium text-gray-900 dark:text-white">{showBalance ? '0.00' : '****'}</span>
              <ChevronRight className="w-4 h-4 text-gray-400" />
            </div>
            {showBalance && totalUsd === 0 && totalBtc === 0 && (
              <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800">
                <button
                  type="button"
                  onClick={() => { setShowWhyZero(!showWhyZero); if (!whyZeroReason && !whyZeroLoading) fetchWhyZero(); }}
                  className="text-sm text-blue-500 hover:text-blue-600 dark:text-blue-400 font-medium"
                >
                  {showWhyZero ? 'Hide' : 'Why is my balance 0? Why no history?'}
                </button>
                {showWhyZero && (
                  <div className="mt-3 p-4 bg-gray-50 dark:bg-gray-800/50 rounded-xl text-sm text-gray-700 dark:text-gray-300 space-y-2">
                    {whyZeroLoading && <p>Checking...</p>}
                    {whyZeroReason && !whyZeroLoading && (
                      <>
                        <p><strong>Funds:</strong> {whyZeroReason.funds}</p>
                        <p><strong>History:</strong> {whyZeroReason.history}</p>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Tabs and Time Period */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex">
              <button
                onClick={() => setActiveTab('account')}
                className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'account'
                    ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                Account
              </button>
              <button
                onClick={() => setActiveTab('asset')}
                className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'asset'
                    ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                Asset
              </button>
            </div>

            <div className="flex items-center gap-1 bg-gray-100 dark:bg-[#2b2f36] rounded-xl p-1">
              {timePeriods.map((period) => (
                <button
                  key={period}
                  onClick={() => setTimePeriod(period)}
                  className={`px-4 py-2 text-xs font-medium rounded-lg transition-all ${
                    timePeriod === period
                      ? 'bg-white dark:bg-[#1e2329] text-gray-900 dark:text-white shadow-sm'
                      : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                  }`}
                >
                  {period}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {/* My Assets Section */}
            <div>
              <h3 className="text-sm font-medium text-gray-500 mb-4">My Assets</h3>
              <div className="space-y-4">
                {/* Funding Account Card */}
                <div className="bg-white dark:bg-[#1e2329] rounded-2xl p-5 border border-gray-100 dark:border-gray-800 hover:border-gray-200 dark:hover:border-gray-700 transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-full border-3 border-yellow-400 flex items-center justify-center bg-yellow-50 dark:bg-yellow-900/20">
                        <div className="w-3 h-3 rounded-full bg-yellow-400" />
                      </div>
                      <span className="font-semibold text-gray-900 dark:text-white">Funding</span>
                    </div>
                    <div className="flex items-center gap-8">
                      <div className="text-right">
                        <p className="font-semibold text-gray-900 dark:text-white">
                          {showBalance ? formatNumber(fundingBalance.totalUsd) : '******'} USD
                        </p>
                        <p className="text-xs text-gray-500">
                          ≈ {showBalance ? formatNumber(fundingBalance.totalBtc, 8) : '********'} BTC
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Link href="/dashboard/deposit/crypto" className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors" title="Deposit">
                          <Download className="w-4 h-4 text-gray-400 hover:text-blue-500" />
                        </Link>
                        <Link href="/dashboard/withdraw/crypto" className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors" title="Withdraw">
                          <Upload className="w-4 h-4 text-gray-400 hover:text-blue-500" />
                        </Link>
                        <Link href="/dashboard/transfer" className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors" title="Transfer">
                          <ArrowLeftRight className="w-4 h-4 text-gray-400 hover:text-blue-500" />
                        </Link>
                        <Link href="/dashboard/assets/convert" className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors" title="Convert">
                          <RefreshCw className="w-4 h-4 text-gray-400 hover:text-blue-500" />
                        </Link>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Unified Trading Account Card */}
                <div className="bg-white dark:bg-[#1e2329] rounded-2xl p-5 border border-gray-100 dark:border-gray-800 hover:border-gray-200 dark:hover:border-gray-700 transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                        <Wallet className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                      </div>
                      <div>
                        <span className="font-semibold text-gray-900 dark:text-white">Unified Trading</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-8">
                      <div className="text-right">
                        <p className="font-semibold text-gray-900 dark:text-white">
                          {showBalance ? formatNumber(tradingBalance.totalUsd) : '******'} USD
                        </p>
                        <p className="text-xs text-gray-500">
                          ≈ {showBalance ? formatNumber(tradingBalance.totalBtc, 8) : '********'} BTC
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Link href="/dashboard/deposit/crypto" className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors" title="Deposit">
                          <Download className="w-4 h-4 text-gray-400 hover:text-blue-500" />
                        </Link>
                        <Link href="/dashboard/transfer" className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors" title="Transfer">
                          <ArrowLeftRight className="w-4 h-4 text-gray-400 hover:text-blue-500" />
                        </Link>
                        <Link href="/dashboard/assets/convert" className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors" title="Convert">
                          <RefreshCw className="w-4 h-4 text-gray-400 hover:text-blue-500" />
                        </Link>
                        <button className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors" title="More">
                          <MoreHorizontal className="w-4 h-4 text-gray-400" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Chart & History Section */}
            <div className="space-y-6">
              {/* Balance Chart */}
              <div className="bg-white dark:bg-[#1e2329] rounded-2xl p-5 border border-gray-100 dark:border-gray-800">
                <div className="h-40 flex items-end justify-between gap-4 px-4">
                  {chartDates.map((date, index) => (
                    <div key={date} className="flex flex-col items-center gap-2">
                      <div 
                        className="w-4 bg-yellow-400 rounded-t-sm" 
                        style={{ height: `${30 + Math.random() * 70}px` }}
                      />
                      <span className="text-xs text-gray-500">{date}</span>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-gray-400 text-right mt-4">
                  Last Updated: {lastUpdated ? new Date(lastUpdated).toLocaleString() : '--'}
                </p>
              </div>

              {/* Recent Deposit & Withdrawal History */}
              <div className="bg-white dark:bg-[#1e2329] rounded-2xl p-5 border border-gray-100 dark:border-gray-800">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <div className="w-1 h-5 bg-yellow-400 rounded-full" />
                    <h3 className="font-semibold text-gray-900 dark:text-white">Recent Deposit & Withdrawal History</h3>
                  </div>
                  <Link href="/dashboard/assets/history" className="flex items-center gap-1 text-sm text-blue-500 hover:text-blue-600 font-medium">
                    All
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                </div>

                {recentTransactions.length > 0 ? (
                  <div className="space-y-3">
                    {recentTransactions.slice(0, 5).map((tx) => (
                      <div key={tx.id} className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-800 last:border-0">
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                            tx.type === 'deposit' 
                              ? 'bg-green-100 dark:bg-green-900/20' 
                              : 'bg-red-100 dark:bg-red-900/20'
                          }`}>
                            {tx.type === 'deposit' ? (
                              <Download className="w-4 h-4 text-green-600" />
                            ) : (
                              <Upload className="w-4 h-4 text-red-600" />
                            )}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-gray-900 dark:text-white capitalize">{tx.type}</p>
                            <p className="text-xs text-gray-500">{tx.symbol}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className={`text-sm font-medium ${
                            tx.type === 'deposit' ? 'text-green-600' : 'text-red-600'
                          }`}>
                            {tx.type === 'deposit' ? '+' : '-'}{tx.amount}
                          </p>
                          <p className="text-xs text-gray-500">{new Date(tx.created_at).toLocaleDateString()}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <div className="w-16 h-16 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mb-4">
                      <FileText className="w-8 h-8 text-gray-400" />
                    </div>
                    <p className="text-gray-500">No recent history found.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </main>
      </div>

    </div>
  );
}
