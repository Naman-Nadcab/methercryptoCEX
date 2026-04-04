'use client';

import { useState, useEffect, useMemo } from 'react';
import { useAuthStore } from '@/store/auth';
import { api } from '@/lib/api';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { notifyError } from '@/lib/notifyError';
import { SkeletonTableBody } from '@/components/ui/Skeleton';
import { CoinIcon } from '@/components/ui/CoinIcon';
import { useBalancesByAccount } from '@/lib/balances';
import {
  ChevronRight,
  ChevronDown,
  Clock,
  RefreshCw,
  Download,
  Upload,
  ArrowLeftRight,
  FileText,
  Calendar,
  ExternalLink,
  Copy,
  Check,
  HelpCircle,
} from 'lucide-react';

function getExplorerUrl(txHash: string, chain?: string): string {
  const c = (chain || '').toLowerCase();
  if (c.includes('btc') || c.includes('bitcoin')) return `https://mempool.space/tx/${txHash}`;
  if (c.includes('sol') || c.includes('solana')) return `https://solscan.io/tx/${txHash}`;
  if (c.includes('bsc') || c.includes('bnb')) return `https://bscscan.com/tx/${txHash}`;
  if (c.includes('polygon') || c.includes('matic')) return `https://polygonscan.com/tx/${txHash}`;
  if (c.includes('avax') || c.includes('avalanche')) return `https://snowtrace.io/tx/${txHash}`;
  if (c.includes('arb') || c.includes('arbitrum')) return `https://arbiscan.io/tx/${txHash}`;
  if (c.includes('op') || c.includes('optimism')) return `https://optimistic.etherscan.io/tx/${txHash}`;
  if (c.includes('tron') || c.includes('trx')) return `https://tronscan.org/#/transaction/${txHash}`;
  return `https://etherscan.io/tx/${txHash}`;
}

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
  const [showExportDropdown, setShowExportDropdown] = useState(false);
  const [copiedTxid, setCopiedTxid] = useState<string | null>(null);

  const { data: balanceRows } = useBalancesByAccount(!!(_hasHydrated && accessToken));
  const coins = useMemo(() => {
    if (!balanceRows || balanceRows.length === 0) return ['All'];
    const symbols = balanceRows
      .filter((r) => parseFloat(r.total) > 0)
      .map((r) => r.symbol.toUpperCase());
    return ['All', ...symbols.sort()];
  }, [balanceRows]);
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

  // Client-side filtered transactions (date range, type, status, asset)
  const filteredTransactions = (() => {
    let list = [...transactions];
    if (mainTab === 'transactions') {
      if (methodFilter !== 'all') {
        const typeMap: Record<string, Transaction['type']> = { deposit: 'deposit', withdraw: 'withdraw', transfer: 'transfer' };
        const targetType = typeMap[methodFilter];
        if (targetType) list = list.filter((tx) => tx.type === targetType);
      }
    }
    if (coinFilter !== 'all') list = list.filter((tx) => tx.coin.toUpperCase() === coinFilter.toUpperCase());
    if (statusFilter !== 'all') list = list.filter((tx) => tx.status.toLowerCase() === statusFilter.toLowerCase());
    if (startDate) list = list.filter((tx) => new Date(tx.date_time) >= new Date(startDate));
    if (endDate) list = list.filter((tx) => new Date(tx.date_time) <= new Date(endDate + 'T23:59:59'));
    return list;
  })();

  const exportCSV = () => {
    const headers = mainTab === 'transactions'
      ? ['Date & Time', 'Coin', 'Qty', 'Type', 'Available Balance', 'Description']
      : ['Coin', 'Chain Type', 'Qty', 'Address', 'Txid', 'Status', 'Date & Time'];
    const rows = filteredTransactions.map((tx) =>
      mainTab === 'transactions'
        ? [formatDate(tx.date_time), tx.coin, tx.quantity, tx.type, tx.available_balance || '-', (tx.description ?? '-')]
        : [tx.coin, tx.chain_type || '-', tx.quantity, tx.address || '-', tx.txid || '-', tx.status, formatDate(tx.date_time)]
    );
    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `transaction-history-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    setShowExportDropdown(false);
  };

  const exportExcel = () => {
    const headers = mainTab === 'transactions'
      ? ['Date & Time', 'Coin', 'Qty', 'Type', 'Available Balance', 'Description']
      : ['Coin', 'Chain Type', 'Qty', 'Address', 'Txid', 'Status', 'Date & Time'];
    const rows = filteredTransactions.map((tx) =>
      mainTab === 'transactions'
        ? [formatDate(tx.date_time), tx.coin, tx.quantity, tx.type, tx.available_balance || '-', (tx.description ?? '-')]
        : [tx.coin, tx.chain_type || '-', tx.quantity, tx.address || '-', tx.txid || '-', tx.status, formatDate(tx.date_time)]
    );
    const csvContent = '\uFEFF' + [headers.join('\t'), ...rows.map((r) => r.map((c) => String(c).replace(/\t/g, ' ')).join('\t'))].join('\n');
    const blob = new Blob([csvContent], { type: 'application/vnd.ms-excel' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `transaction-history-${new Date().toISOString().slice(0, 10)}.xls`;
    link.click();
    URL.revokeObjectURL(link.href);
    setShowExportDropdown(false);
  };

  const getStatusBadge = (status: string) => {
    const s = status.toLowerCase();
    if (s === 'completed' || s === 'confirmed') return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
    if (s === 'pending' || s === 'processing' || s === 'confirming') return 'bg-amber-500/10 text-amber-600 dark:text-amber-400';
    if (s === 'failed' || s === 'rejected') return 'bg-red-500/10 text-red-600 dark:text-red-400';
    return 'bg-muted text-muted-foreground';
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
          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
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
    <div className="mx-auto max-w-7xl p-4 sm:p-6">
          <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Link href="/wallet/funding" className="transition-colors hover:text-primary">
              Funding
            </Link>
            <ChevronRight className="h-4 w-4 shrink-0" />
            <span className="font-medium text-foreground">Funding Account History</span>
          </div>

          <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-xl font-semibold tracking-tight text-foreground">Funding Account History</h1>
              {(historyTab === 'deposit' || historyTab === 'all') && (
                <span className="rounded-full border border-border bg-buy-light px-2.5 py-1 text-xs font-medium text-buy">
                  Live
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => fetchTransactions(false)}
                disabled={loading}
                className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:border-primary/40 disabled:opacity-50"
                title="Refresh now"
                type="button"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowExportDropdown(!showExportDropdown)}
                  className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:border-primary/40"
                >
                  <Download className="h-4 w-4" />
                  Export <ChevronDown className={`h-4 w-4 ${showExportDropdown ? 'rotate-180' : ''}`} />
                </button>
                {showExportDropdown && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setShowExportDropdown(false)} aria-hidden />
                    <div className="absolute right-0 top-full z-20 mt-2 min-w-[140px] rounded-xl border border-border bg-card py-1 shadow-lg">
                      <button
                        type="button"
                        onClick={exportCSV}
                        className="w-full px-4 py-2.5 text-left text-sm text-foreground transition-colors hover:bg-muted"
                      >
                        CSV
                      </button>
                      <button
                        type="button"
                        onClick={exportExcel}
                        className="w-full px-4 py-2.5 text-left text-sm text-foreground transition-colors hover:bg-muted"
                      >
                        Excel
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <div className="flex border-b border-border">
              <button
                type="button"
                onClick={() => setMainTab('transactions')}
                className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-3.5 text-sm font-medium transition-colors sm:px-6 sm:py-4 ${
                  mainTab === 'transactions'
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                All Transactions
                <HelpCircle className="h-4 w-4 text-muted-foreground" />
              </button>
              <button
                type="button"
                onClick={() => setMainTab('history')}
                className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-3.5 text-sm font-medium transition-colors sm:px-6 sm:py-4 ${
                  mainTab === 'history'
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                History
                <HelpCircle className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>

            {mainTab === 'transactions' ? (
              <div className="p-4 sm:p-6">
                <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Date Range</p>
                    <div className="flex items-center gap-2 rounded-xl border border-border bg-muted px-4 py-2.5">
                      <input
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="min-w-0 flex-1 bg-transparent text-sm text-foreground focus:outline-none"
                      />
                      <span className="text-muted-foreground">→</span>
                      <input
                        type="date"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        className="min-w-0 flex-1 bg-transparent text-sm text-foreground focus:outline-none"
                      />
                      <Calendar className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </div>
                  </div>
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Asset</p>
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setShowCoinDropdown(!showCoinDropdown)}
                        className="flex w-full items-center justify-between rounded-xl border border-border bg-muted px-4 py-2.5 text-sm text-foreground transition-colors hover:border-primary/40"
                      >
                        <span>{coinFilter === 'all' ? 'All' : coinFilter}</span>
                        <ChevronDown className={`h-4 w-4 transition-transform ${showCoinDropdown ? 'rotate-180' : ''}`} />
                      </button>
                      {showCoinDropdown && (
                        <div className="absolute left-0 right-0 top-full z-10 mt-2 max-h-60 overflow-auto rounded-xl border border-border bg-card shadow-lg">
                          {coins.map((coin) => (
                            <button
                              type="button"
                              key={coin}
                              onClick={() => {
                                setCoinFilter(coin === 'All' ? 'all' : coin);
                                setShowCoinDropdown(false);
                              }}
                              className={`w-full px-4 py-3 text-left text-sm transition-colors ${
                                (coin === 'All' && coinFilter === 'all') || coin === coinFilter
                                  ? 'bg-primary/10 text-primary'
                                  : 'text-foreground hover:bg-muted'
                              }`}
                            >
                              {coin}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Transaction Type</p>
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setShowMethodDropdown(!showMethodDropdown)}
                        className="flex w-full items-center justify-between rounded-xl border border-border bg-muted px-4 py-2.5 text-sm text-foreground transition-colors hover:border-primary/40"
                      >
                        <span>{methodFilter === 'all' ? 'All' : methodFilter}</span>
                        <ChevronDown className={`h-4 w-4 transition-transform ${showMethodDropdown ? 'rotate-180' : ''}`} />
                      </button>
                      {showMethodDropdown && (
                        <div className="absolute left-0 right-0 top-full z-10 mt-2 overflow-hidden rounded-xl border border-border bg-card shadow-lg">
                          {['All', 'Deposit', 'Withdraw', 'Transfer'].map((type) => (
                            <button
                              type="button"
                              key={type}
                              onClick={() => {
                                setMethodFilter(type === 'All' ? 'all' : type.toLowerCase());
                                setShowMethodDropdown(false);
                              }}
                              className={`w-full px-4 py-3 text-left text-sm transition-colors ${
                                (type === 'All' && methodFilter === 'all') || type.toLowerCase() === methodFilter
                                  ? 'bg-primary/10 text-primary'
                                  : 'text-foreground hover:bg-muted'
                              }`}
                            >
                              {type}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Status</p>
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setShowStatusDropdown(!showStatusDropdown)}
                        className="flex w-full items-center justify-between rounded-xl border border-border bg-muted px-4 py-2.5 text-sm text-foreground transition-colors hover:border-primary/40"
                      >
                        <span>{statusFilter === 'all' ? 'All' : statusFilter}</span>
                        <ChevronDown className={`h-4 w-4 transition-transform ${showStatusDropdown ? 'rotate-180' : ''}`} />
                      </button>
                      {showStatusDropdown && (
                        <div className="absolute left-0 right-0 top-full z-10 mt-2 max-h-60 overflow-auto rounded-xl border border-border bg-card shadow-lg">
                          {statuses.map((status) => (
                            <button
                              type="button"
                              key={status}
                              onClick={() => {
                                setStatusFilter(status === 'All' ? 'all' : status.toLowerCase());
                                setShowStatusDropdown(false);
                              }}
                              className={`w-full px-4 py-3 text-left text-sm transition-colors ${
                                (status === 'All' && statusFilter === 'all') || status.toLowerCase() === statusFilter
                                  ? 'bg-primary/10 text-primary'
                                  : 'text-foreground hover:bg-muted'
                              }`}
                            >
                              {status}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[720px]">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-muted-foreground">Date & Time</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Coin</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Qty</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Type</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Available Balance (Excludes Bonuses)</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <SkeletonTableBody rows={8} columns={6} />
                    ) : filteredTransactions.length > 0 ? (
                      filteredTransactions.map((tx) => (
                        <tr key={tx.id} className="border-b border-border transition-colors hover:bg-muted/40">
                          <td className="px-4 py-4 text-sm text-muted-foreground">{formatDate(tx.date_time)}</td>
                          <td className="px-4 py-4">
                            <div className="flex items-center gap-2">
                              <CoinIcon symbol={tx.coin} size={24} />
                              <span className="font-medium text-foreground">{tx.coin}</span>
                            </div>
                          </td>
                          <td className="px-4 py-4 text-right font-mono text-sm text-foreground">{tx.quantity}</td>
                          <td className="px-4 py-4 text-sm capitalize text-muted-foreground">{tx.type}</td>
                          <td className="px-4 py-4 text-right font-mono text-sm text-foreground">{tx.available_balance || '-'}</td>
                          <td className="px-4 py-4 text-sm text-muted-foreground">{tx.description || '-'}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={6} className="py-20 text-center">
                          <div className="flex flex-col items-center">
                            <div className="mb-4 flex h-24 w-24 items-center justify-center rounded-xl bg-muted">
                              <FileText className="h-12 w-12 text-primary" />
                            </div>
                            <p className="font-medium text-muted-foreground">No Data</p>
                            <p className="mt-1 text-sm text-muted-foreground">No transactions found for the selected filters</p>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
                </div>
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-1 overflow-x-auto border-b border-border px-3 pb-2 pt-4 sm:px-4">
                  {HISTORY_TABS.map((tab) => (
                    <button
                      type="button"
                      key={tab.id}
                      onClick={() => setHistoryTab(tab.id)}
                      className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-4 py-2.5 text-sm font-medium transition-all ${
                        historyTab === tab.id
                          ? 'border border-border bg-primary/10 text-primary'
                          : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                      }`}
                    >
                      {tab.label}
                      {tab.external && <ExternalLink className="h-3 w-3" />}
                    </button>
                  ))}
                </div>

                <div className="p-4 sm:p-6">
                  <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Date Range</p>
                      <div className="flex items-center gap-2 rounded-xl border border-border bg-muted px-4 py-2.5">
                        <input
                          type="date"
                          value={startDate}
                          onChange={(e) => setStartDate(e.target.value)}
                          className="min-w-0 flex-1 bg-transparent text-sm text-foreground focus:outline-none"
                        />
                        <span className="text-muted-foreground">→</span>
                        <input
                          type="date"
                          value={endDate}
                          onChange={(e) => setEndDate(e.target.value)}
                          className="min-w-0 flex-1 bg-transparent text-sm text-foreground focus:outline-none"
                        />
                        <Calendar className="h-4 w-4 shrink-0 text-muted-foreground" />
                      </div>
                    </div>
                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Asset</p>
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setShowCoinDropdown(!showCoinDropdown)}
                          className="flex w-full items-center justify-between rounded-xl border border-border bg-muted px-4 py-2.5 text-sm text-foreground transition-colors hover:border-primary/40"
                        >
                          <span>{coinFilter === 'all' ? 'All' : coinFilter}</span>
                          <ChevronDown className={`h-4 w-4 transition-transform ${showCoinDropdown ? 'rotate-180' : ''}`} />
                        </button>
                        {showCoinDropdown && (
                          <div className="absolute left-0 right-0 top-full z-10 mt-2 max-h-60 overflow-auto rounded-xl border border-border bg-card shadow-lg">
                            {coins.map((coin) => (
                              <button
                                type="button"
                                key={coin}
                                onClick={() => {
                                  setCoinFilter(coin === 'All' ? 'all' : coin);
                                  setShowCoinDropdown(false);
                                }}
                                className={`w-full px-4 py-3 text-left text-sm transition-colors ${
                                  (coin === 'All' && coinFilter === 'all') || coin === coinFilter
                                    ? 'bg-primary/10 text-primary'
                                    : 'text-foreground hover:bg-muted'
                                }`}
                              >
                                {coin}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                        {historyTab === 'deposit'
                          ? 'Deposit Method'
                          : historyTab === 'withdraw'
                            ? 'Withdraw Method'
                            : 'Method'}
                      </p>
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setShowMethodDropdown(!showMethodDropdown)}
                          className="flex w-full items-center justify-between rounded-xl border border-border bg-muted px-4 py-2.5 text-sm text-foreground transition-colors hover:border-primary/40"
                        >
                          <span>{methodFilter === 'all' ? 'All' : methodFilter}</span>
                          <ChevronDown className={`h-4 w-4 transition-transform ${showMethodDropdown ? 'rotate-180' : ''}`} />
                        </button>
                        {showMethodDropdown && (
                          <div className="absolute left-0 right-0 top-full z-10 mt-2 overflow-hidden rounded-xl border border-border bg-card shadow-lg">
                            {methods.map((method) => (
                              <button
                                type="button"
                                key={method}
                                onClick={() => {
                                  setMethodFilter(method === 'All' ? 'all' : method.toLowerCase());
                                  setShowMethodDropdown(false);
                                }}
                                className={`w-full px-4 py-3 text-left text-sm transition-colors ${
                                  (method === 'All' && methodFilter === 'all') || method.toLowerCase() === methodFilter
                                    ? 'bg-primary/10 text-primary'
                                    : 'text-foreground hover:bg-muted'
                                }`}
                              >
                                {method}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Status</p>
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setShowStatusDropdown(!showStatusDropdown)}
                          className="flex w-full items-center justify-between rounded-xl border border-border bg-muted px-4 py-2.5 text-sm text-foreground transition-colors hover:border-primary/40"
                        >
                          <span>{statusFilter === 'all' ? 'All' : statusFilter}</span>
                          <ChevronDown className={`h-4 w-4 transition-transform ${showStatusDropdown ? 'rotate-180' : ''}`} />
                        </button>
                        {showStatusDropdown && (
                          <div className="absolute left-0 right-0 top-full z-10 mt-2 max-h-60 overflow-auto rounded-xl border border-border bg-card shadow-lg">
                            {statuses.map((status) => (
                              <button
                                type="button"
                                key={status}
                                onClick={() => {
                                  setStatusFilter(status === 'All' ? 'all' : status.toLowerCase());
                                  setShowStatusDropdown(false);
                                }}
                                className={`w-full px-4 py-3 text-left text-sm transition-colors ${
                                  (status === 'All' && statusFilter === 'all') || status.toLowerCase() === statusFilter
                                    ? 'bg-primary/10 text-primary'
                                    : 'text-foreground hover:bg-muted'
                                }`}
                              >
                                {status}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {historyTab === 'deposit' && (
                    <div className="mb-6 flex flex-wrap items-center gap-2">
                      <span className="text-sm text-muted-foreground">Deposits yet to be credited?</span>
                      <Link
                        href="/dashboard/help#self-service"
                        className="flex items-center gap-1 text-sm font-medium text-primary hover:text-primary/85"
                      >
                        Self-Service <ChevronRight className="h-4 w-4" />
                      </Link>
                    </div>
                  )}

                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full min-w-[900px]">
                      <thead>
                        <tr className="border-b border-border bg-muted/30">
                          <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-muted-foreground">Coin</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-muted-foreground">Chain Type</th>
                          <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-muted-foreground">Qty</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-muted-foreground">Address</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-muted-foreground">Txid</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-muted-foreground">
                            <div className="flex items-center gap-1">
                              Status
                              <HelpCircle className="h-3 w-3 text-muted-foreground" />
                            </div>
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-muted-foreground">Date & Time</th>
                          <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-muted-foreground">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {loading ? (
                          <tr>
                            <td colSpan={8} className="py-20 text-center">
                              <RefreshCw className="mx-auto mb-3 h-8 w-8 animate-spin text-primary" />
                              <p className="text-sm text-muted-foreground">Loading history...</p>
                            </td>
                          </tr>
                        ) : filteredTransactions.length > 0 ? (
                          filteredTransactions.map((tx) => (
                            <tr key={tx.id} className="border-b border-border transition-colors hover:bg-muted/40">
                              <td className="px-4 py-4">
                                <div className="flex items-center gap-2">
                                  <CoinIcon symbol={tx.coin} size={24} />
                                  <span className="font-medium text-foreground">{tx.coin}</span>
                                </div>
                              </td>
                              <td className="px-4 py-4 text-sm text-muted-foreground">{tx.chain_type || '-'}</td>
                              <td className="px-4 py-4 text-right font-mono text-sm text-foreground">{tx.quantity}</td>
                              <td className="px-4 py-4">
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-sm text-muted-foreground">{truncateAddress(tx.address)}</span>
                                  {tx.address && (
                                    <button
                                      type="button"
                                      onClick={() => copyToClipboard(tx.address, `addr-${tx.id}`)}
                                      className="rounded p-1 transition-colors hover:bg-muted"
                                    >
                                      {copiedTxid === `addr-${tx.id}` ? (
                                        <Check className="h-3 w-3 text-buy" />
                                      ) : (
                                        <Copy className="h-3 w-3 text-muted-foreground" />
                                      )}
                                    </button>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-4">
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-sm text-muted-foreground">{truncateAddress(tx.txid)}</span>
                                  {tx.txid && (
                                    <>
                                      <button
                                        type="button"
                                        onClick={() => copyToClipboard(tx.txid, `txid-${tx.id}`)}
                                        className="rounded p-1 transition-colors hover:bg-muted"
                                      >
                                        {copiedTxid === `txid-${tx.id}` ? (
                                          <Check className="h-3 w-3 text-buy" />
                                        ) : (
                                          <Copy className="h-3 w-3 text-muted-foreground" />
                                        )}
                                      </button>
                                      <a
                                        href={getExplorerUrl(tx.txid, tx.chain_type)}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="rounded p-1 transition-colors hover:bg-muted"
                                      >
                                        <ExternalLink className="h-3 w-3 text-muted-foreground" />
                                      </a>
                                    </>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-4">{renderConfirmationStatus(tx)}</td>
                              <td className="px-4 py-4 text-sm text-muted-foreground">{formatDate(tx.date_time)}</td>
                              <td className="px-4 py-4 text-right">
                                {tx.explorerUrl ? (
                                  <a
                                    href={tx.explorerUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:text-primary/85"
                                  >
                                    View <ExternalLink className="h-3 w-3" />
                                  </a>
                                ) : (
                                  <button
                                    type="button"
                                    className="text-sm font-medium text-primary hover:text-primary/85"
                                  >
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
                                <div className="mb-4 flex h-24 w-24 items-center justify-center rounded-xl bg-muted">
                                  <FileText className="h-12 w-12 text-primary" />
                                </div>
                                <p className="font-medium text-muted-foreground">No Data</p>
                                <p className="mt-1 text-sm text-muted-foreground">No {historyTab} records found</p>
                              </div>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
    </div>
  );
}
