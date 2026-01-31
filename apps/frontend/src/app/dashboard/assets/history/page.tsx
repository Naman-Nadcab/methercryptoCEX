'use client';

import { useState, useEffect } from 'react';
import { useAuthStore } from '@/store/auth';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import {
  ChevronRight,
  ChevronDown,
  Wallet,
  LayoutGrid,
  TrendingUp,
  Clock,
  RefreshCw,
  Download,
  Upload,
  ArrowLeftRight,
  FileText,
  Calendar,
  Search,
  Filter,
  ExternalLink,
  Copy,
  Check,
  HelpCircle,
} from 'lucide-react';

interface Transaction {
  id: string;
  type: 'deposit' | 'withdraw' | 'transfer';
  coin: string;
  coin_logo: string;
  chain_type: string;
  quantity: string;
  address: string;
  txid: string;
  status: 'completed' | 'pending' | 'failed' | 'processing';
  date_time: string;
  description?: string;
  available_balance?: string;
}

const HISTORY_TABS = [
  { id: 'deposit', label: 'Deposit', icon: Download },
  { id: 'withdraw', label: 'Withdraw', icon: Upload },
  { id: 'transfer', label: 'Transfer', icon: ArrowLeftRight },
  { id: 'one-click-buy', label: 'One-Click Buy', external: true },
  { id: 'p2p', label: 'P2P' },
  { id: 'deposit-fiat', label: 'Deposit Fiat' },
  { id: 'fiat-withdrawal', label: 'Fiat Withdrawal' },
];

export default function AssetHistoryPage() {
  const { accessToken } = useAuthStore();
  const searchParams = useSearchParams();
  
  const [mainTab, setMainTab] = useState<'transactions' | 'history'>('history');
  const [historyTab, setHistoryTab] = useState(searchParams.get('tab') || 'deposit');
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [ordersExpanded, setOrdersExpanded] = useState(false);
  
  // Filters
  const [coinFilter, setCoinFilter] = useState('all');
  const [methodFilter, setMethodFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [showCoinDropdown, setShowCoinDropdown] = useState(false);
  const [showMethodDropdown, setShowMethodDropdown] = useState(false);
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const [copiedTxid, setCopiedTxid] = useState<string | null>(null);

  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

  const coins = ['All', 'BTC', 'ETH', 'USDT', 'USDC', 'SOL', 'XRP'];
  const methods = ['All', 'On-chain', 'Internal'];
  const statuses = ['All', 'Completed', 'Pending', 'Processing', 'Failed'];

  useEffect(() => {
    if (accessToken) {
      fetchTransactions();
    }
  }, [accessToken, historyTab, coinFilter, methodFilter, statusFilter, startDate, endDate]);

  const fetchTransactions = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        type: historyTab,
        ...(coinFilter !== 'all' && { coin: coinFilter }),
        ...(methodFilter !== 'all' && { method: methodFilter }),
        ...(statusFilter !== 'all' && { status: statusFilter }),
        ...(startDate && { startDate }),
        ...(endDate && { endDate }),
      });

      const res = await fetch(`${API_URL}/api/v1/wallet/history?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setTransactions(data.data || []);
        }
      }
    } catch (error) {
      console.error('Failed to fetch transactions:', error);
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedTxid(id);
    setTimeout(() => setCopiedTxid(null), 2000);
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString();
  };

  const truncateAddress = (addr: string) => {
    if (!addr) return '-';
    if (addr.length <= 16) return addr;
    return `${addr.slice(0, 8)}...${addr.slice(-8)}`;
  };

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      completed: 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400',
      pending: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400',
      processing: 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400',
      failed: 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400',
    };
    return styles[status] || styles.pending;
  };

  // Set default dates (current month)
  useEffect(() => {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    setStartDate(firstDay.toISOString().split('T')[0]);
    setEndDate(lastDay.toISOString().split('T')[0]);
  }, []);

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
              className="flex items-center gap-3 px-4 py-3 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded-xl transition-colors"
            >
              <div className="w-5 h-5 rounded-full border-2 border-gray-400 dark:border-gray-500 flex items-center justify-center">
                <div className="w-2 h-2 rounded-full bg-gray-400 dark:bg-gray-500" />
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
              className="flex items-center gap-3 px-4 py-3 text-sm font-medium bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 text-blue-600 dark:text-blue-400 rounded-xl border border-blue-100 dark:border-blue-800/30"
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
                  <FileText className="w-5 h-5" />
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
          {/* Breadcrumb */}
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
            <Link href="/dashboard/assets/funding" className="hover:text-blue-500 transition-colors">Funding</Link>
            <ChevronRight className="w-4 h-4" />
            <span className="text-gray-900 dark:text-white font-medium">Funding Account History</span>
          </div>

          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Funding Account History</h1>
            <button className="flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-[#1e2329] text-gray-700 dark:text-gray-300 font-medium text-sm rounded-xl border border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600 transition-colors">
              <Download className="w-4 h-4" />
              Export
            </button>
          </div>

          {/* Main Tabs Card */}
          <div className="bg-white dark:bg-[#1e2329] rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden">
            {/* Main Tab Selector */}
            <div className="flex border-b border-gray-100 dark:border-gray-800">
              <button
                onClick={() => setMainTab('transactions')}
                className={`flex items-center gap-2 px-6 py-4 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  mainTab === 'transactions'
                    ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                All Transactions
                <HelpCircle className="w-4 h-4 text-gray-400" />
              </button>
              <button
                onClick={() => setMainTab('history')}
                className={`flex items-center gap-2 px-6 py-4 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  mainTab === 'history'
                    ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                History
                <HelpCircle className="w-4 h-4 text-gray-400" />
              </button>
            </div>

            {mainTab === 'transactions' ? (
              /* All Transactions View */
              <div className="p-6">
                {/* Filters */}
                <div className="grid grid-cols-3 gap-4 mb-6">
                  {/* Coin Filter */}
                  <div>
                    <p className="text-xs font-semibold text-gray-400 uppercase mb-2">Coin</p>
                    <div className="relative">
                      <button
                        onClick={() => setShowCoinDropdown(!showCoinDropdown)}
                        className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-50 dark:bg-[#2b2f36] rounded-xl text-sm text-gray-900 dark:text-white border border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600 transition-colors"
                      >
                        <span>{coinFilter === 'all' ? 'All' : coinFilter}</span>
                        <ChevronDown className={`w-4 h-4 transition-transform ${showCoinDropdown ? 'rotate-180' : ''}`} />
                      </button>
                      {showCoinDropdown && (
                        <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-[#1e2329] border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl z-10 overflow-hidden">
                          {coins.map((coin) => (
                            <button
                              key={coin}
                              onClick={() => { setCoinFilter(coin === 'All' ? 'all' : coin); setShowCoinDropdown(false); }}
                              className={`w-full px-4 py-3 text-left text-sm transition-colors ${
                                (coin === 'All' && coinFilter === 'all') || coin === coinFilter
                                  ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
                                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                              }`}
                            >
                              {coin}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Type Filter */}
                  <div>
                    <p className="text-xs font-semibold text-gray-400 uppercase mb-2">Type</p>
                    <div className="relative">
                      <button
                        onClick={() => setShowMethodDropdown(!showMethodDropdown)}
                        className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-50 dark:bg-[#2b2f36] rounded-xl text-sm text-gray-900 dark:text-white border border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600 transition-colors"
                      >
                        <span>{methodFilter === 'all' ? 'All' : methodFilter}</span>
                        <ChevronDown className={`w-4 h-4 transition-transform ${showMethodDropdown ? 'rotate-180' : ''}`} />
                      </button>
                      {showMethodDropdown && (
                        <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-[#1e2329] border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl z-10 overflow-hidden">
                          {['All', 'Deposit', 'Withdraw', 'Transfer'].map((type) => (
                            <button
                              key={type}
                              onClick={() => { setMethodFilter(type === 'All' ? 'all' : type.toLowerCase()); setShowMethodDropdown(false); }}
                              className={`w-full px-4 py-3 text-left text-sm transition-colors ${
                                (type === 'All' && methodFilter === 'all') || type.toLowerCase() === methodFilter
                                  ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
                                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                              }`}
                            >
                              {type}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Date Filter */}
                  <div>
                    <p className="text-xs font-semibold text-gray-400 uppercase mb-2">Date</p>
                    <div className="flex items-center gap-2 px-4 py-2.5 bg-gray-50 dark:bg-[#2b2f36] rounded-xl border border-gray-200 dark:border-gray-700">
                      <input
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="bg-transparent text-sm text-gray-900 dark:text-white focus:outline-none"
                      />
                      <span className="text-gray-400">→</span>
                      <input
                        type="date"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        className="bg-transparent text-sm text-gray-900 dark:text-white focus:outline-none"
                      />
                      <Calendar className="w-4 h-4 text-gray-400" />
                    </div>
                  </div>
                </div>

                {/* Table */}
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-100 dark:border-gray-800">
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Date & Time</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Coin</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Qty</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Type</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Available Balance (Excludes Bonuses)</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={6} className="py-20 text-center">
                          <RefreshCw className="w-8 h-8 text-blue-500 animate-spin mx-auto mb-3" />
                          <p className="text-sm text-gray-500">Loading transactions...</p>
                        </td>
                      </tr>
                    ) : transactions.length > 0 ? (
                      transactions.map((tx) => (
                        <tr key={tx.id} className="border-b border-gray-50 dark:border-gray-800/50 hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors">
                          <td className="px-4 py-4 text-sm text-gray-600 dark:text-gray-400">{formatDate(tx.date_time)}</td>
                          <td className="px-4 py-4">
                            <div className="flex items-center gap-2">
                              {tx.coin_logo && (
                                <Image src={tx.coin_logo} alt={tx.coin} width={24} height={24} className="rounded-full" unoptimized />
                              )}
                              <span className="font-medium text-gray-900 dark:text-white">{tx.coin}</span>
                            </div>
                          </td>
                          <td className="px-4 py-4 text-right font-mono text-sm text-gray-900 dark:text-white">{tx.quantity}</td>
                          <td className="px-4 py-4 text-sm capitalize text-gray-600 dark:text-gray-400">{tx.type}</td>
                          <td className="px-4 py-4 text-right font-mono text-sm text-gray-900 dark:text-white">{tx.available_balance || '-'}</td>
                          <td className="px-4 py-4 text-sm text-gray-500">{tx.description || '-'}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={6} className="py-20 text-center">
                          <div className="flex flex-col items-center">
                            <div className="w-24 h-24 bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-2xl flex items-center justify-center mb-4">
                              <FileText className="w-12 h-12 text-blue-300 dark:text-blue-600" />
                            </div>
                            <p className="text-gray-500 font-medium">No Data</p>
                            <p className="text-sm text-gray-400 mt-1">No transactions found for the selected filters</p>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            ) : (
              /* History View */
              <div>
                {/* History Sub-tabs */}
                <div className="flex items-center gap-1 px-4 pt-4 pb-2 border-b border-gray-100 dark:border-gray-800 overflow-x-auto">
                  {HISTORY_TABS.map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setHistoryTab(tab.id)}
                      className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium whitespace-nowrap rounded-lg transition-all ${
                        historyTab === tab.id
                          ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 border border-blue-100 dark:border-blue-800/30'
                          : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/50'
                      }`}
                    >
                      {tab.label}
                      {tab.external && <ExternalLink className="w-3 h-3" />}
                    </button>
                  ))}
                </div>

                <div className="p-6">
                  {/* Filters */}
                  <div className="grid grid-cols-4 gap-4 mb-6">
                    {/* Coin Filter */}
                    <div>
                      <p className="text-xs font-semibold text-gray-400 uppercase mb-2">Coin</p>
                      <div className="relative">
                        <button
                          onClick={() => setShowCoinDropdown(!showCoinDropdown)}
                          className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-50 dark:bg-[#2b2f36] rounded-xl text-sm text-gray-900 dark:text-white border border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600 transition-colors"
                        >
                          <span>{coinFilter === 'all' ? 'All' : coinFilter}</span>
                          <ChevronDown className={`w-4 h-4 transition-transform ${showCoinDropdown ? 'rotate-180' : ''}`} />
                        </button>
                        {showCoinDropdown && (
                          <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-[#1e2329] border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl z-10 overflow-hidden">
                            {coins.map((coin) => (
                              <button
                                key={coin}
                                onClick={() => { setCoinFilter(coin === 'All' ? 'all' : coin); setShowCoinDropdown(false); }}
                                className={`w-full px-4 py-3 text-left text-sm transition-colors ${
                                  (coin === 'All' && coinFilter === 'all') || coin === coinFilter
                                    ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
                                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                                }`}
                              >
                                {coin}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Method Filter */}
                    <div>
                      <p className="text-xs font-semibold text-gray-400 uppercase mb-2">
                        {historyTab === 'deposit' ? 'Deposit Method' : historyTab === 'withdraw' ? 'Withdraw Method' : 'Method'}
                      </p>
                      <div className="relative">
                        <button
                          onClick={() => setShowMethodDropdown(!showMethodDropdown)}
                          className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-50 dark:bg-[#2b2f36] rounded-xl text-sm text-gray-900 dark:text-white border border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600 transition-colors"
                        >
                          <span>{methodFilter === 'all' ? 'All' : methodFilter}</span>
                          <ChevronDown className={`w-4 h-4 transition-transform ${showMethodDropdown ? 'rotate-180' : ''}`} />
                        </button>
                        {showMethodDropdown && (
                          <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-[#1e2329] border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl z-10 overflow-hidden">
                            {methods.map((method) => (
                              <button
                                key={method}
                                onClick={() => { setMethodFilter(method === 'All' ? 'all' : method); setShowMethodDropdown(false); }}
                                className={`w-full px-4 py-3 text-left text-sm transition-colors ${
                                  (method === 'All' && methodFilter === 'all') || method === methodFilter
                                    ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
                                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                                }`}
                              >
                                {method}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Status Filter */}
                    <div>
                      <p className="text-xs font-semibold text-gray-400 uppercase mb-2">Status</p>
                      <div className="relative">
                        <button
                          onClick={() => setShowStatusDropdown(!showStatusDropdown)}
                          className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-50 dark:bg-[#2b2f36] rounded-xl text-sm text-gray-900 dark:text-white border border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600 transition-colors"
                        >
                          <span>{statusFilter === 'all' ? 'All' : statusFilter}</span>
                          <ChevronDown className={`w-4 h-4 transition-transform ${showStatusDropdown ? 'rotate-180' : ''}`} />
                        </button>
                        {showStatusDropdown && (
                          <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-[#1e2329] border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl z-10 overflow-hidden">
                            {statuses.map((status) => (
                              <button
                                key={status}
                                onClick={() => { setStatusFilter(status === 'All' ? 'all' : status.toLowerCase()); setShowStatusDropdown(false); }}
                                className={`w-full px-4 py-3 text-left text-sm transition-colors ${
                                  (status === 'All' && statusFilter === 'all') || status.toLowerCase() === statusFilter
                                    ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
                                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                                }`}
                              >
                                {status}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Date Filter */}
                    <div>
                      <p className="text-xs font-semibold text-gray-400 uppercase mb-2">Date</p>
                      <div className="flex items-center gap-2 px-4 py-2.5 bg-gray-50 dark:bg-[#2b2f36] rounded-xl border border-gray-200 dark:border-gray-700">
                        <input
                          type="date"
                          value={startDate}
                          onChange={(e) => setStartDate(e.target.value)}
                          className="bg-transparent text-sm text-gray-900 dark:text-white focus:outline-none flex-1 min-w-0"
                        />
                        <span className="text-gray-400">→</span>
                        <input
                          type="date"
                          value={endDate}
                          onChange={(e) => setEndDate(e.target.value)}
                          className="bg-transparent text-sm text-gray-900 dark:text-white focus:outline-none flex-1 min-w-0"
                        />
                        <Calendar className="w-4 h-4 text-gray-400 flex-shrink-0" />
                      </div>
                    </div>
                  </div>

                  {/* Self-Service Link */}
                  {historyTab === 'deposit' && (
                    <div className="flex items-center gap-2 mb-6">
                      <span className="text-sm text-gray-500">Deposits yet to be credited?</span>
                      <Link href="#" className="text-sm text-blue-500 hover:text-blue-600 font-medium flex items-center gap-1">
                        Self-Service <ChevronRight className="w-4 h-4" />
                      </Link>
                    </div>
                  )}

                  {/* Table */}
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-gray-100 dark:border-gray-800">
                        <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Coin</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Chain Type</th>
                        <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Qty</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Address</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Txid</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase">
                          <div className="flex items-center gap-1">
                            Status
                            <HelpCircle className="w-3 h-3 text-gray-400" />
                          </div>
                        </th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Date & Time</th>
                        <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loading ? (
                        <tr>
                          <td colSpan={8} className="py-20 text-center">
                            <RefreshCw className="w-8 h-8 text-blue-500 animate-spin mx-auto mb-3" />
                            <p className="text-sm text-gray-500">Loading history...</p>
                          </td>
                        </tr>
                      ) : transactions.length > 0 ? (
                        transactions.map((tx) => (
                          <tr key={tx.id} className="border-b border-gray-50 dark:border-gray-800/50 hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors">
                            <td className="px-4 py-4">
                              <div className="flex items-center gap-2">
                                {tx.coin_logo && (
                                  <Image src={tx.coin_logo} alt={tx.coin} width={24} height={24} className="rounded-full" unoptimized />
                                )}
                                <span className="font-medium text-gray-900 dark:text-white">{tx.coin}</span>
                              </div>
                            </td>
                            <td className="px-4 py-4 text-sm text-gray-600 dark:text-gray-400">{tx.chain_type || '-'}</td>
                            <td className="px-4 py-4 text-right font-mono text-sm text-gray-900 dark:text-white">{tx.quantity}</td>
                            <td className="px-4 py-4">
                              <div className="flex items-center gap-2">
                                <span className="text-sm text-gray-600 dark:text-gray-400 font-mono">{truncateAddress(tx.address)}</span>
                                {tx.address && (
                                  <button 
                                    onClick={() => copyToClipboard(tx.address, `addr-${tx.id}`)}
                                    className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                                  >
                                    {copiedTxid === `addr-${tx.id}` ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3 text-gray-400" />}
                                  </button>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-4">
                              <div className="flex items-center gap-2">
                                <span className="text-sm text-gray-600 dark:text-gray-400 font-mono">{truncateAddress(tx.txid)}</span>
                                {tx.txid && (
                                  <>
                                    <button 
                                      onClick={() => copyToClipboard(tx.txid, `txid-${tx.id}`)}
                                      className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                                    >
                                      {copiedTxid === `txid-${tx.id}` ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3 text-gray-400" />}
                                    </button>
                                    <a href={`https://etherscan.io/tx/${tx.txid}`} target="_blank" rel="noopener noreferrer" className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded">
                                      <ExternalLink className="w-3 h-3 text-gray-400" />
                                    </a>
                                  </>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-4">
                              <span className={`px-2.5 py-1 rounded-lg text-xs font-medium capitalize ${getStatusBadge(tx.status)}`}>
                                {tx.status}
                              </span>
                            </td>
                            <td className="px-4 py-4 text-sm text-gray-600 dark:text-gray-400">{formatDate(tx.date_time)}</td>
                            <td className="px-4 py-4 text-right">
                              <button className="text-sm text-blue-500 hover:text-blue-600 font-medium">
                                Details
                              </button>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={8} className="py-20 text-center">
                            <div className="flex flex-col items-center">
                              <div className="w-24 h-24 bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-2xl flex items-center justify-center mb-4">
                                <FileText className="w-12 h-12 text-blue-300 dark:text-blue-600" />
                              </div>
                              <p className="text-gray-500 font-medium">No Data</p>
                              <p className="text-sm text-gray-400 mt-1">No {historyTab} records found</p>
                            </div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
