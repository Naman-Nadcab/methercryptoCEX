'use client';

import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth';
import { useTransferBalances } from '@/lib/balances';
import Link from 'next/link';
import Image from 'next/image';
import {
  ArrowLeftRight,
  ChevronDown,
  Search,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Wallet,
  TrendingUp,
  Clock,
  LayoutGrid,
  Send,
  ChevronRight,
  HelpCircle,
  ArrowRight,
  RefreshCw,
} from 'lucide-react';
import { getApiBaseUrl } from '@/lib/getApiUrl';

interface TransferHistory {
  id: string;
  from_account: string;
  to_account: string;
  symbol: string;
  amount: string;
  status: string;
  created_at: string;
}

const SIDEBAR_LINKS = [
  { label: 'Asset Dashboard', href: '/wallet', icon: LayoutGrid },
  { label: 'Deposit', href: '/wallet/deposit/crypto', icon: TrendingUp },
  { label: 'Withdraw', href: '/wallet/withdraw/crypto', icon: Send },
  { label: 'Transfer', href: '/wallet/transfer', icon: ArrowLeftRight, active: true },
  { label: 'Convert', href: '/wallet/convert', icon: RefreshCw },
  { label: 'History', href: '/wallet/history', icon: Clock },
];

export default function TransferPage() {
  const queryClient = useQueryClient();
  const { accessToken, _hasHydrated } = useAuthStore();

  const [fromAccount, setFromAccount] = useState<'funding' | 'trading'>('funding');
  const [toAccount, setToAccount] = useState<'funding' | 'trading'>('trading');
  const [selectedToken, setSelectedToken] = useState<{ tokenId: string; symbol: string; name: string; iconUrl: string | null; decimals: number; availableBalance: string } | null>(null);
  const [amount, setAmount] = useState('');
  const [transferHistory, setTransferHistory] = useState<TransferHistory[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [showFromDropdown, setShowFromDropdown] = useState(false);
  const [showToDropdown, setShowToDropdown] = useState(false);
  const [showCoinDropdown, setShowCoinDropdown] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const API_URL = getApiBaseUrl();

  const { data: tokensData = [], isLoading: loading } = useTransferBalances(fromAccount, !!_hasHydrated && !!accessToken);
  const tokens = tokensData;

  useEffect(() => {
    if (_hasHydrated && accessToken) {
      fetchTransferHistory();
    }
  }, [_hasHydrated, accessToken, fromAccount]);

  const fetchTransferHistory = async () => {
    try {
      const res = await fetch(`${API_URL}/api/v1/wallet/transfer/history?limit=10`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setTransferHistory(data.data || []);
      }
    } catch (err) {
      console.error('Failed to fetch history:', err);
    }
  };

  const handleSwapAccounts = () => {
    const temp = fromAccount;
    setFromAccount(toAccount);
    setToAccount(temp);
    setAmount('');
    setError('');
  };

  const handleTransfer = async () => {
    if (submitting) return;
    if (!selectedToken) {
      setError('Please select a coin');
      return;
    }
    const transferAmount = parseFloat(amount);
    const availableNum = parseFloat(selectedToken.availableBalance ?? '0');
    if (!Number.isFinite(transferAmount) || transferAmount <= 0) {
      setError('Please enter a valid amount');
      return;
    }
    if (!Number.isFinite(availableNum) || transferAmount > availableNum) {
      setError('Insufficient balance');
      return;
    }

    try {
      setSubmitting(true);
      setError('');

      const res = await fetch(`${API_URL}/api/v1/wallet/transfer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          fromAccount,
          toAccount,
          tokenId: selectedToken.tokenId,
          amount: amount,
        }),
      });

      const data = await res.json();

      if (data.success) {
        setSuccess(true);
        setAmount('');
        queryClient.invalidateQueries({ queryKey: ['balances'] });
        fetchTransferHistory();
        setTimeout(() => setSuccess(false), 3000);
      } else {
        setError(data.error?.message || 'Transfer failed');
      }
    } catch {
      setError('Connection issue. Your request may not have reached the server. Safe to try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSetMax = () => {
    if (selectedToken) {
      setAmount(selectedToken.availableBalance ?? '0');
    }
  };

  const filteredTokens = tokens.filter(
    (t) =>
      t.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getAccountLabel = (account: string) => {
    switch (account) {
      case 'funding':
        return 'Funding Account';
      case 'trading':
        return 'Trading Account';
      default:
        return account;
    }
  };

  const getAccountIcon = (account: string) => {
    if (account === 'funding') {
      return (
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center">
          <Wallet className="w-5 h-5 text-white" />
        </div>
      );
    }
    return (
      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center">
        <TrendingUp className="w-5 h-5 text-white" />
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="flex">
        {/* Sidebar */}
        <aside className="w-60 min-h-screen bg-card border-r border-border">
          <nav className="p-4 space-y-1">
            {SIDEBAR_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`flex items-center gap-3 px-4 py-3 text-sm font-medium rounded-xl transition-colors ${
                  link.active
                    ? 'bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 text-primary border border-blue-100 dark:border-blue-800/30'
                    : 'text-muted-foreground hover:bg-accent/50'
                }`}
              >
                <link.icon className="w-5 h-5" />
                {link.label}
              </Link>
            ))}
          </nav>
        </aside>

        {/* Main Content */}
        <main className="flex-1 p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-foreground">Internal Transfer</h1>
              <p className="text-sm text-gray-500 mt-1">Transfer assets between your accounts instantly and free</p>
            </div>
            <Link
              href="/wallet/history?tab=transfer"
              className="flex items-center gap-2 px-4 py-2.5 bg-card text-foreground/80 font-medium text-sm rounded-xl border border-border hover:border-blue-300 dark:hover:border-blue-600 transition-colors"
            >
              <Clock className="w-4 h-4" />
              Transfer History
            </Link>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Transfer Form */}
            <div className="lg:col-span-2">
              <div className="bg-card rounded-xl border border-border p-6">
                {/* From/To Selection */}
                <div className="mb-6">
                  <div className="flex items-center gap-4">
                    {/* From Account */}
                    <div className="flex-1">
                      <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">From</label>
                      <div className="relative">
                        <button
                          onClick={() => {
                            setShowFromDropdown(!showFromDropdown);
                            setShowToDropdown(false);
                            setShowCoinDropdown(false);
                          }}
                          className="w-full flex items-center gap-3 px-4 py-4 bg-gray-50 dark:bg-[#2b2f36] border border-border rounded-xl hover:border-blue-400 dark:hover:border-blue-500 transition-colors"
                        >
                          {getAccountIcon(fromAccount)}
                          <div className="flex-1 text-left">
                            <p className="text-foreground font-semibold">{getAccountLabel(fromAccount)}</p>
                            <p className="text-xs text-gray-500">Available for transfer</p>
                          </div>
                          <ChevronDown className={`w-5 h-5 text-gray-400 transition-transform ${showFromDropdown ? 'rotate-180' : ''}`} />
                        </button>
                        {showFromDropdown && (
                          <div className="absolute top-full left-0 right-0 mt-2 bg-card border border-border rounded-xl shadow-2xl z-20 overflow-hidden">
                            {['funding', 'trading'].map((account) => (
                              <button
                                key={account}
                                onClick={() => {
                                  if (account !== toAccount) {
                                    setFromAccount(account as 'funding' | 'trading');
                                    setSelectedToken(null);
                                  }
                                  setShowFromDropdown(false);
                                }}
                                disabled={account === toAccount}
                                className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                                  account === fromAccount
                                    ? 'bg-blue-50 dark:bg-blue-900/30 text-primary'
                                    : account === toAccount
                                    ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
                                    : 'text-foreground/80 hover:bg-accent'
                                }`}
                              >
                                {getAccountIcon(account)}
                                <span className="font-medium">{getAccountLabel(account)}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Swap Button */}
                    <button
                      onClick={handleSwapAccounts}
                      className="mt-6 p-3 bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-800/30 rounded-xl transition-colors border border-blue-200 dark:border-blue-700"
                    >
                      <ArrowLeftRight className="w-5 h-5 text-blue-500" />
                    </button>

                    {/* To Account */}
                    <div className="flex-1">
                      <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">To</label>
                      <div className="relative">
                        <button
                          onClick={() => {
                            setShowToDropdown(!showToDropdown);
                            setShowFromDropdown(false);
                            setShowCoinDropdown(false);
                          }}
                          className="w-full flex items-center gap-3 px-4 py-4 bg-gray-50 dark:bg-[#2b2f36] border border-border rounded-xl hover:border-blue-400 dark:hover:border-blue-500 transition-colors"
                        >
                          {getAccountIcon(toAccount)}
                          <div className="flex-1 text-left">
                            <p className="text-foreground font-semibold">{getAccountLabel(toAccount)}</p>
                            <p className="text-xs text-gray-500">Receive assets</p>
                          </div>
                          <ChevronDown className={`w-5 h-5 text-gray-400 transition-transform ${showToDropdown ? 'rotate-180' : ''}`} />
                        </button>
                        {showToDropdown && (
                          <div className="absolute top-full left-0 right-0 mt-2 bg-card border border-border rounded-xl shadow-2xl z-20 overflow-hidden">
                            {['funding', 'trading'].map((account) => (
                              <button
                                key={account}
                                onClick={() => {
                                  if (account !== fromAccount) {
                                    setToAccount(account as 'funding' | 'trading');
                                  }
                                  setShowToDropdown(false);
                                }}
                                disabled={account === fromAccount}
                                className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                                  account === toAccount
                                    ? 'bg-blue-50 dark:bg-blue-900/30 text-primary'
                                    : account === fromAccount
                                    ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
                                    : 'text-foreground/80 hover:bg-accent'
                                }`}
                              >
                                {getAccountIcon(account)}
                                <span className="font-medium">{getAccountLabel(account)}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Coin Selection */}
                <div className="mb-6">
                  <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Coin</label>
                  <div className="relative">
                    <button
                      onClick={() => {
                        setShowCoinDropdown(!showCoinDropdown);
                        setShowFromDropdown(false);
                        setShowToDropdown(false);
                      }}
                      className="w-full flex items-center justify-between px-4 py-4 bg-gray-50 dark:bg-[#2b2f36] border border-border rounded-xl hover:border-blue-400 dark:hover:border-blue-500 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        {selectedToken ? (
                          <>
                            {selectedToken.iconUrl ? (
                              <Image
                                src={selectedToken.iconUrl}
                                alt={selectedToken.symbol}
                                width={32}
                                height={32}
                                className="rounded-full"
                                unoptimized
                              />
                            ) : (
                              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center">
                                <span className="text-white text-sm font-bold">{selectedToken.symbol.charAt(0)}</span>
                              </div>
                            )}
                            <div className="text-left">
                              <p className="text-foreground font-semibold">{selectedToken.symbol}</p>
                              <p className="text-xs text-gray-500">{selectedToken.name}</p>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center">
                              <Search className="w-4 h-4 text-gray-400" />
                            </div>
                            <span className="text-gray-400">Select coin</span>
                          </>
                        )}
                      </div>
                      <ChevronDown className={`w-5 h-5 text-gray-400 transition-transform ${showCoinDropdown ? 'rotate-180' : ''}`} />
                    </button>

                    {showCoinDropdown && (
                      <div className="absolute top-full left-0 right-0 mt-2 bg-card border border-border rounded-xl shadow-2xl z-20 overflow-hidden">
                        <div className="p-3 border-b border-border">
                          <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <input
                              type="text"
                              placeholder="Search coins..."
                              value={searchQuery}
                              onChange={(e) => setSearchQuery(e.target.value)}
                              className="w-full pl-10 pr-4 py-2.5 bg-gray-50 dark:bg-[#2b2f36] border-0 rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:ring-2 focus:ring-primary outline-none"
                            />
                          </div>
                        </div>
                        <div className="max-h-64 overflow-y-auto">
                          {loading ? (
                            <div className="flex items-center justify-center gap-2 p-8">
                              <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
                              <span className="text-sm text-gray-500">Loading...</span>
                            </div>
                          ) : filteredTokens.length === 0 ? (
                            <div className="p-8 text-center text-sm text-gray-500">No coins found</div>
                          ) : (
                            filteredTokens.slice(0, 50).map((token) => (
                              <button
                                key={token.tokenId}
                                onClick={() => {
                                  setSelectedToken(token);
                                  setShowCoinDropdown(false);
                                  setSearchQuery('');
                                  setAmount('');
                                  setError('');
                                }}
                                className={`w-full flex items-center justify-between px-4 py-3 hover:bg-accent transition-colors ${
                                  selectedToken?.tokenId === token.tokenId ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                                }`}
                              >
                                <div className="flex items-center gap-3">
                                  {token.iconUrl ? (
                                    <Image
                                      src={token.iconUrl}
                                      alt={token.symbol}
                                      width={32}
                                      height={32}
                                      className="rounded-full"
                                      unoptimized
                                    />
                                  ) : (
                                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center">
                                      <span className="text-white text-sm font-bold">{token.symbol.charAt(0)}</span>
                                    </div>
                                  )}
                                  <div className="text-left">
                                    <p className="font-medium text-foreground">{token.symbol}</p>
                                    <p className="text-xs text-gray-500">{token.name}</p>
                                  </div>
                                </div>
                                <span className="text-sm text-gray-500">{parseFloat(token.availableBalance ?? '0').toFixed(6)}</span>
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Transferable Amount */}
                <div className="flex items-center justify-between text-sm py-3 px-4 bg-gray-50 dark:bg-[#2b2f36] rounded-xl mb-6">
                  <span className="text-gray-500">Transferable Amount</span>
                  <span className="font-semibold text-foreground">
                    {selectedToken
                      ? `${parseFloat(selectedToken.availableBalance ?? '0').toFixed(6)} ${selectedToken.symbol}`
                      : '0.000000'}
                  </span>
                </div>

                {/* Amount Input */}
                {selectedToken && (
                  <div className="mb-6">
                    <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Amount</label>
                    <div className="relative">
                      <input
                        type="text"
                        value={amount}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (/^\d*\.?\d*$/.test(val)) {
                            setAmount(val);
                            setError('');
                          }
                        }}
                        placeholder="Enter amount"
                        className="w-full px-4 py-4 pr-24 bg-gray-50 dark:bg-[#2b2f36] border border-border rounded-xl text-lg font-semibold text-foreground placeholder:text-muted-foreground focus:border-blue-500 focus:ring-1 focus:ring-primary/20 outline-none transition-all"
                      />
                      <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                        <button
                          onClick={handleSetMax}
                          className="text-sm font-semibold text-primary hover:text-primary/85"
                        >
                          MAX
                        </button>
                        <span className="text-sm font-medium text-gray-500 border-l border-gray-300 dark:border-gray-600 pl-2">
                          {selectedToken.symbol}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Transfer Info */}
                <div className="bg-blue-50 dark:bg-blue-900/10 rounded-xl p-4 border border-blue-100 dark:border-blue-800/30 mb-6">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Transfer Fee</span>
                    <span className="font-semibold text-green-500">Free</span>
                  </div>
                  <div className="flex items-center justify-between text-sm mt-2">
                    <span className="text-muted-foreground">You will receive</span>
                    <span className="font-semibold text-foreground">
                      {amount ? `${parseFloat(amount).toFixed(6)} ${selectedToken?.symbol || ''}` : '0.00'}
                    </span>
                  </div>
                </div>

                {/* Error Message */}
                {error && (
                  <div className="flex items-center gap-2 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl mb-6">
                    <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
                    <p className="text-sm text-destructive">{error}</p>
                  </div>
                )}

                {/* Success Message */}
                {success && (
                  <div className="flex items-center gap-2 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl mb-6">
                    <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
                    <p className="text-sm text-buy">Transfer completed successfully!</p>
                  </div>
                )}

                {/* Submit Button */}
                <button
                  onClick={handleTransfer}
                  disabled={!selectedToken || !amount || submitting}
                  aria-busy={submitting}
                  className={`w-full py-4 rounded-xl font-semibold transition-all ${
                    selectedToken && amount && !submitting
                      ? 'bg-primary hover:bg-primary/85 text-white shadow-lg shadow-blue-500/25'
                      : 'bg-accent text-gray-400 cursor-not-allowed'
                  }`}
                >
                  {submitting ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Processing...
                    </span>
                  ) : (
                    'Confirm Transfer'
                  )}
                </button>
              </div>
            </div>

            {/* Right Side - Info */}
            <div className="space-y-6">
              {/* Transfer Info Card */}
              <div className="bg-card rounded-xl border border-border p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center">
                    <ArrowLeftRight className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground">Internal Transfer</h3>
                    <p className="text-xs text-gray-500">Quick & Free</p>
                  </div>
                </div>
                <ul className="space-y-3 text-sm">
                  <li className="flex items-start gap-2 text-muted-foreground">
                    <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                    <span>Instant transfers between accounts</span>
                  </li>
                  <li className="flex items-start gap-2 text-muted-foreground">
                    <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                    <span>No transaction fees</span>
                  </li>
                  <li className="flex items-start gap-2 text-muted-foreground">
                    <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                    <span>Available 24/7</span>
                  </li>
                </ul>
              </div>

              {/* Quick Links */}
              <div className="bg-card rounded-xl border border-border p-6">
                <h3 className="font-semibold text-foreground mb-4">Quick Links</h3>
                <div className="space-y-2">
                  <Link
                    href="/wallet/deposit/crypto"
                    className="flex items-center justify-between p-3 bg-gray-50 dark:bg-[#2b2f36] rounded-xl hover:bg-accent transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <TrendingUp className="w-5 h-5 text-blue-500" />
                      <span className="text-sm font-medium text-foreground/80">Deposit Crypto</span>
                    </div>
                    <ChevronRight className="w-4 h-4 text-gray-400" />
                  </Link>
                  <Link
                    href="/wallet/withdraw/crypto"
                    className="flex items-center justify-between p-3 bg-gray-50 dark:bg-[#2b2f36] rounded-xl hover:bg-accent transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <Send className="w-5 h-5 text-blue-500" />
                      <span className="text-sm font-medium text-foreground/80">Withdraw Crypto</span>
                    </div>
                    <ChevronRight className="w-4 h-4 text-gray-400" />
                  </Link>
                  <Link
                    href="/wallet/convert"
                    className="flex items-center justify-between p-3 bg-gray-50 dark:bg-[#2b2f36] rounded-xl hover:bg-accent transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <ArrowRight className="w-5 h-5 text-blue-500" />
                      <span className="text-sm font-medium text-foreground/80">Convert Assets</span>
                    </div>
                    <ChevronRight className="w-4 h-4 text-gray-400" />
                  </Link>
                </div>
              </div>
            </div>
          </div>

          {/* Recent Transfers */}
          {transferHistory.length > 0 && (
            <div className="mt-8">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-foreground">Recent Transfers</h2>
                <Link
                  href="/wallet/history?tab=transfer"
                  className="text-sm text-primary hover:text-primary/85 font-medium flex items-center gap-1"
                >
                  View All
                  <ChevronRight className="w-4 h-4" />
                </Link>
              </div>

              <div className="bg-card rounded-xl border border-border overflow-hidden">
                <div className="grid grid-cols-6 gap-4 px-6 py-4 bg-background border-b border-border text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  <span>Coin</span>
                  <span>From</span>
                  <span>To</span>
                  <span>Amount</span>
                  <span>Status</span>
                  <span>Date</span>
                </div>
                <div className="divide-y divide-border">
                  {transferHistory.map((transfer) => (
                    <div key={transfer.id} className="grid grid-cols-6 gap-4 px-6 py-4 text-sm items-center">
                      <span className="font-medium text-foreground">{transfer.symbol}</span>
                      <span className="text-muted-foreground">{transfer.from_account}</span>
                      <span className="text-muted-foreground">{transfer.to_account}</span>
                      <span className="font-medium text-foreground">{parseFloat(transfer.amount).toFixed(6)}</span>
                      <span className="px-2 py-1 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900/30 text-buy w-fit">
                        {transfer.status}
                      </span>
                      <span className="text-gray-500 text-xs">
                        {new Date(transfer.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Help Button */}
      <button className="fixed bottom-6 right-6 w-12 h-12 bg-primary hover:bg-primary/85 text-white rounded-full shadow-lg shadow-blue-500/25 flex items-center justify-center transition-colors z-40">
        <HelpCircle className="w-6 h-6" />
      </button>
    </div>
  );
}
