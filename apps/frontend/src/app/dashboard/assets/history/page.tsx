'use client';

import { useState, useEffect } from 'react';
import { useAuthStore } from '@/store/auth';
import { api } from '@/lib/api';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import type { LucideIcon } from 'lucide-react';
import { notifyError } from '@/lib/notifyError';
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
  status: 'completed' | 'pending' | 'failed' | 'processing' | 'confirming';
  date_time: string;
  description?: string;
  available_balance?: string;
  confirmations?: number;
  requiredConfirmations?: number;
  confirmationProgress?: number;
  explorerUrl?: string;
}

const HISTORY_TABS: { id: string; label: string; icon: LucideIcon; external?: boolean }[] = [
  { id: 'all', label: 'All Transactions', icon: Clock },
  { id: 'deposit', label: 'Deposit', icon: Download },
  { id: 'withdraw', label: 'Withdraw', icon: Upload },
  { id: 'transfer', label: 'Transfer', icon: ArrowLeftRight },
];

export default function AssetHistoryPage() {
  const { accessToken, _hasHydrated } = useAuthStore();
  const searchParams = useSearchParams();
  
  const [mainTab, setMainTab] = useState<'transactions' | 'history'>('history');
  const [historyTab, setHistoryTab] = useState(searchParams.get('tab') || 'all');
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

  const coins = ['All', 'BTC', 'ETH', 'USDT', 'USDC', 'SOL', 'XRP'];
  const methods = ['All', 'On-chain', 'Internal'];
  const statuses = ['All', 'Completed', 'Pending', 'Processing', 'Failed'];

  // Initial fetch and when tab/filters change
  useEffect(() => {
    if (_hasHydrated && accessToken) {
      fetchTransactions(false);
    } else if (_hasHydrated && !accessToken) {
      setLoading(false);
    }
  }, [_hasHydrated, accessToken, historyTab, coinFilter, methodFilter, statusFilter, startDate, endDate]);

  // Real-time polling for deposit history (and All when it includes deposits)
  useEffect(() => {
    if (!_hasHydrated || !accessToken) return;
    const isDepositView = historyTab === 'deposit' || historyTab === 'all';
    if (!isDepositView) return;

    const hasPending = transactions.some(
      (tx) => tx.status === 'pending' || tx.status === 'confirming' || tx.status === 'processing'
    );
    // Pending items: poll every 3s. Otherwise: poll every 5s for real-time new deposits
    const intervalMs = hasPending ? 3000 : 5000;

    const interval = setInterval(() => {
      fetchTransactions(true); // silent refresh - no loading spinner
    }, intervalMs);

    return () => clearInterval(interval);
  }, [_hasHydrated, accessToken, historyTab, transactions, coinFilter, methodFilter, statusFilter]);

  const fetchTransactions = async (silentRefresh = false) => {
    try {
      if (!silentRefresh) setLoading(true);

      let endpoint = '/api/v1/wallet/';
      const params = new URLSearchParams();
      
      // Different endpoints for different tabs
      if (historyTab === 'all') {
        endpoint += 'transactions/all';
        if (statusFilter !== 'all') params.append('status', statusFilter);
        if (coinFilter !== 'all') params.append('coin', coinFilter);
      } else if (historyTab === 'deposit') {
        endpoint += 'deposit-history';
        if (statusFilter !== 'all') params.append('status', statusFilter);
      } else if (historyTab === 'withdraw') {
        endpoint += 'withdrawals';
        if (statusFilter !== 'all') params.append('status', statusFilter);
        if (coinFilter !== 'all') params.append('coin', coinFilter);
      } else if (historyTab === 'transfer') {
        endpoint += 'transfer/history';
      }

      const response = await api.get<any>(`${endpoint}?${params}`);

      if (response.success) {
        let mappedData: Transaction[] = [];
        
        if (historyTab === 'deposit') {
          // Deposits only - from deposit-history endpoint
          mappedData = (response.data || []).map((d: any) => ({
            id: d.id,
            type: 'deposit' as const,
            coin: d.symbol || 'Unknown',
            coin_logo: d.logoUrl || `/assets/upload/currency-logo/${(d.symbol || 'btc').toLowerCase()}.svg`,
            chain_type: d.chainName || 'Unknown',
            quantity: d.amount || '0',
            address: d.fromAddress || '',  // sender address
            txid: d.txHash || '',
            status: d.status || 'pending',
            date_time: d.createdAt,
            confirmations: d.confirmations || 0,
            requiredConfirmations: d.requiredConfirmations || 25,
            confirmationProgress: d.confirmationProgress || 0,
            explorerUrl: d.explorerUrl,
          }));
        } else if (historyTab === 'withdraw') {
          // Withdrawals only - already mapped by backend
          mappedData = (response.data || []).map((w: any) => ({
            id: w.id,
            type: 'withdraw' as const,
            coin: w.coin || w.symbol || 'Unknown',
            coin_logo: w.coin_logo || `/assets/upload/currency-logo/${(w.coin || w.symbol || 'btc').toLowerCase()}.svg`,
            chain_type: w.chain_type || 'Unknown',
            quantity: w.quantity || w.amount || '0',
            address: w.address || '',
            txid: w.txid || '',
            status: w.status || 'pending',
            date_time: w.date_time || w.created_at,
          }));
        } else if (historyTab === 'transfer') {
          // Internal transfers: use backend description (e.g. "Sent to dev@byom.de" / "Received from nmnsingh02@gmail.com")
          mappedData = (response.data || []).map((t: any) => ({
            id: t.id,
            type: 'transfer' as const,
            coin: t.symbol || 'Unknown',
            coin_logo: t.iconUrl || `/assets/upload/currency-logo/${(t.symbol || 'btc').toLowerCase()}.svg`,
            chain_type: t.description || `${t.fromAccount || 'Funding'} → ${t.toAccount || 'Funding'}`,
            quantity: t.amount || '0',
            address: t.direction === 'sent' ? (t.toAccount || '') : (t.fromAccount || ''),
            txid: '',
            status: t.status || 'completed',
            date_time: t.createdAt,
          }));
        } else if (historyTab === 'all') {
          // All transactions - already formatted by backend
          mappedData = response.data || [];
        }
        
        setTransactions(mappedData);
      } else {
        // API returned error, show empty
        setTransactions([]);
      }
    } catch (error) {
      notifyError('Failed to load transaction history. Please try again.');
      setTransactions([]);
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
      confirming: 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400',
      failed: 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400',
    };
    return styles[status] || styles.pending;
  };

  const renderConfirmationStatus = (tx: Transaction) => {
    if (tx.status === 'completed') {
      return (
        <span className={`px-2.5 py-1 rounded-lg text-xs font-medium ${getStatusBadge('completed')}`}>
          Completed
        </span>
      );
    }
    
    if (tx.status === 'pending' || tx.status === 'confirming') {
      const confirmations = tx.confirmations || 0;
      const required = tx.requiredConfirmations || 25;
      const progress = Math.min(100, (confirmations / required) * 100);
      
      return (
        <div className="flex flex-col gap-1">
          <span className={`px-2.5 py-1 rounded-lg text-xs font-medium inline-flex items-center gap-1 ${getStatusBadge('pending')}`}>
            <RefreshCw className="w-3 h-3 animate-spin" />
            {confirmations}/{required} Confirmations
          </span>
          <div className="w-24 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div 
              className="h-full bg-yellow-500 dark:bg-yellow-400 rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      );
    }
    
    return (
      <span className={`px-2.5 py-1 rounded-lg text-xs font-medium capitalize ${getStatusBadge(tx.status)}`}>
        {tx.status}
      </span>
    );
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
    <div className="p-6">
          {/* Breadcrumb */}
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
            <Link href="/dashboard/assets/funding" className="hover:text-blue-500 transition-colors">Funding</Link>
            <ChevronRight className="w-4 h-4" />
            <span className="text-gray-900 dark:text-white font-medium">Funding Account History</span>
          </div>

          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Funding Account History</h1>
              {(historyTab === 'deposit' || historyTab === 'all') && (
                <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20">
                  Live
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => fetchTransactions(false)}
                disabled={loading}
                className="flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-[#1e2329] text-gray-700 dark:text-gray-300 font-medium text-sm rounded-xl border border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600 transition-colors disabled:opacity-50"
                title="Refresh now"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
              <button className="flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-[#1e2329] text-gray-700 dark:text-gray-300 font-medium text-sm rounded-xl border border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600 transition-colors">
                <Download className="w-4 h-4" />
                Export
              </button>
            </div>
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
                      Array.from({ length: 8 }).map((_, i) => (
                        <tr key={i} className="border-b border-gray-50 dark:border-gray-800/50">
                          <td className="px-4 py-4"><div className="h-4 w-24 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" /></td>
                          <td className="px-4 py-4"><div className="h-4 w-16 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" /></td>
                          <td className="px-4 py-4 text-right"><div className="h-4 w-20 bg-gray-200 dark:bg-gray-700 rounded animate-pulse ml-auto" /></td>
                          <td className="px-4 py-4"><div className="h-4 w-14 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" /></td>
                          <td className="px-4 py-4 text-right"><div className="h-4 w-24 bg-gray-200 dark:bg-gray-700 rounded animate-pulse ml-auto" /></td>
                          <td className="px-4 py-4"><div className="h-4 w-32 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" /></td>
                        </tr>
                      ))
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
                      <Link href="/dashboard/help#self-service" className="text-sm text-blue-500 hover:text-blue-600 font-medium flex items-center gap-1">
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
                              {renderConfirmationStatus(tx)}
                            </td>
                            <td className="px-4 py-4 text-sm text-gray-600 dark:text-gray-400">{formatDate(tx.date_time)}</td>
                            <td className="px-4 py-4 text-right">
                              {tx.explorerUrl ? (
                                <a 
                                  href={tx.explorerUrl} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="text-sm text-blue-500 hover:text-blue-600 font-medium inline-flex items-center gap-1"
                                >
                                  View <ExternalLink className="w-3 h-3" />
                                </a>
                              ) : (
                                <button className="text-sm text-blue-500 hover:text-blue-600 font-medium">
                                  Details
                                </button>
                              )}
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
    </div>
  );
}
