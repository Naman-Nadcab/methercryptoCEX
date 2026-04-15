'use client';

import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth';
import { useTransferBalances } from '@/lib/balances';
import Link from 'next/link';
import { CoinIcon } from '@/components/ui/CoinIcon';
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
  ChevronRight,
  HelpCircle,
  ArrowRight,
  RefreshCw,
  Send,
} from 'lucide-react';
import { WalletOperationsShell } from '@/components/wallet/WalletOperationsShell';
import { api } from '@/lib/api';

interface TransferHistory {
  id: string;
  from_account: string;
  to_account: string;
  symbol: string;
  amount: string;
  status: string;
  created_at: string;
}

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

  const { data: tokensData = [], isLoading: loading } = useTransferBalances(fromAccount, !!_hasHydrated && !!accessToken);
  const tokens = tokensData;

  useEffect(() => {
    if (_hasHydrated && accessToken) {
      fetchTransferHistory();
    }
  }, [_hasHydrated, accessToken, fromAccount]);

  const fetchTransferHistory = async () => {
    try {
      const data = await api.get<TransferHistory[]>('/api/v1/wallet/transfer/history?limit=10');
      if (data.success && data.data) {
        setTransferHistory(data.data);
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

      const data = await api.post('/api/v1/wallet/transfer', {
        fromAccount,
        toAccount,
        tokenId: selectedToken.tokenId,
        amount: amount,
      }, {
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        notifyOnError: false,
      });

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
          <Wallet className="w-5 h-5 text-primary-foreground" />
        </div>
      );
    }
    return (
      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center">
        <TrendingUp className="w-5 h-5 text-primary-foreground" />
      </div>
    );
  };

  return (
    <>
    <WalletOperationsShell
      title="Internal transfer"
      description="Move assets between your funding and trading wallets instantly. No network fees."
      headerRight={
        <Link
          href="/wallet/history?tab=transfer"
          className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:border-primary/35 hover:bg-accent"
        >
          <Clock className="h-4 w-4 shrink-0" />
          Transfer history
        </Link>
      }
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* Transfer Form */}
            <div className="lg:col-span-2">
              <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
                {/* From/To Selection */}
                <div className="mb-6">
                  <div className="flex items-center gap-4">
                    {/* From Account */}
                    <div className="flex-1">
                      <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">From</label>
                      <div className="relative">
                        <button
                          onClick={() => {
                            setShowFromDropdown(!showFromDropdown);
                            setShowToDropdown(false);
                            setShowCoinDropdown(false);
                          }}
                          className="w-full flex items-center gap-3 px-4 py-4 bg-muted border border-border rounded-xl hover:border-primary/50 transition-colors"
                        >
                          {getAccountIcon(fromAccount)}
                          <div className="flex-1 text-left">
                            <p className="text-foreground font-semibold">{getAccountLabel(fromAccount)}</p>
                            <p className="text-xs text-muted-foreground">Available for transfer</p>
                          </div>
                          <ChevronDown className={`w-5 h-5 text-muted-foreground transition-transform ${showFromDropdown ? 'rotate-180' : ''}`} />
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
                                    ? 'text-muted-foreground cursor-not-allowed'
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
                      <ArrowLeftRight className="w-5 h-5 text-primary" />
                    </button>

                    {/* To Account */}
                    <div className="flex-1">
                      <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">To</label>
                      <div className="relative">
                        <button
                          onClick={() => {
                            setShowToDropdown(!showToDropdown);
                            setShowFromDropdown(false);
                            setShowCoinDropdown(false);
                          }}
                          className="w-full flex items-center gap-3 px-4 py-4 bg-muted border border-border rounded-xl hover:border-primary/50 transition-colors"
                        >
                          {getAccountIcon(toAccount)}
                          <div className="flex-1 text-left">
                            <p className="text-foreground font-semibold">{getAccountLabel(toAccount)}</p>
                            <p className="text-xs text-muted-foreground">Receive assets</p>
                          </div>
                          <ChevronDown className={`w-5 h-5 text-muted-foreground transition-transform ${showToDropdown ? 'rotate-180' : ''}`} />
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
                                    ? 'text-muted-foreground cursor-not-allowed'
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
                  <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Coin</label>
                  <div className="relative">
                    <button
                      onClick={() => {
                        setShowCoinDropdown(!showCoinDropdown);
                        setShowFromDropdown(false);
                        setShowToDropdown(false);
                      }}
                      className="w-full flex items-center justify-between px-4 py-4 bg-muted border border-border rounded-xl hover:border-primary/50 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        {selectedToken ? (
                          <>
                            <CoinIcon symbol={selectedToken.symbol} size={32} />
                            <div className="text-left">
                              <p className="text-foreground font-semibold">{selectedToken.symbol}</p>
                              <p className="text-xs text-muted-foreground">{selectedToken.name}</p>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center">
                              <Search className="w-4 h-4 text-muted-foreground" />
                            </div>
                            <span className="text-muted-foreground">Select coin</span>
                          </>
                        )}
                      </div>
                      <ChevronDown className={`w-5 h-5 text-muted-foreground transition-transform ${showCoinDropdown ? 'rotate-180' : ''}`} />
                    </button>

                    {showCoinDropdown && (
                      <div className="absolute top-full left-0 right-0 mt-2 bg-card border border-border rounded-xl shadow-2xl z-20 overflow-hidden">
                        <div className="p-3 border-b border-border">
                          <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                            <input
                              type="text"
                              placeholder="Search coins..."
                              value={searchQuery}
                              onChange={(e) => setSearchQuery(e.target.value)}
                              className="w-full pl-10 pr-4 py-2.5 bg-muted border-0 rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:ring-2 focus:ring-primary outline-none"
                            />
                          </div>
                        </div>
                        <div className="max-h-64 overflow-y-auto">
                          {loading ? (
                            <div className="flex items-center justify-center gap-2 p-8">
                              <Loader2 className="w-5 h-5 animate-spin text-primary" />
                              <span className="text-sm text-muted-foreground">Loading...</span>
                            </div>
                          ) : filteredTokens.length === 0 ? (
                            <div className="p-8 text-center text-sm text-muted-foreground">No coins found</div>
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
                                  <CoinIcon symbol={token.symbol} size={32} />
                                  <div className="text-left">
                                    <p className="font-medium text-foreground">{token.symbol}</p>
                                    <p className="text-xs text-muted-foreground">{token.name}</p>
                                  </div>
                                </div>
                                <span className="text-sm text-muted-foreground">{parseFloat(token.availableBalance ?? '0').toFixed(6)}</span>
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Transferable Amount */}
                <div className="flex items-center justify-between text-sm py-3 px-4 bg-muted rounded-xl mb-6">
                  <span className="text-muted-foreground">Transferable Amount</span>
                  <span className="font-semibold text-foreground">
                    {selectedToken
                      ? `${parseFloat(selectedToken.availableBalance ?? '0').toFixed(6)} ${selectedToken.symbol}`
                      : '0.000000'}
                  </span>
                </div>

                {/* Amount Input */}
                {selectedToken && (
                  <div className="mb-6">
                    <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Amount</label>
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
                        className="w-full px-4 py-4 pr-24 bg-muted border border-border rounded-xl text-lg font-semibold text-foreground placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary/20 outline-none transition-all"
                      />
                      <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                        <button
                          onClick={handleSetMax}
                          className="text-sm font-semibold text-primary hover:text-primary/85"
                        >
                          MAX
                        </button>
                        <span className="text-sm font-medium text-muted-foreground border-l border-border pl-2">
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
                    <span className="font-semibold text-buy">Free</span>
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
                  <div className="flex items-center gap-2 p-4 bg-sell-light border border-sell/20 rounded-xl mb-6">
                    <AlertCircle className="w-5 h-5 text-sell flex-shrink-0" />
                    <p className="text-sm text-destructive">{error}</p>
                  </div>
                )}

                {/* Success Message */}
                {success && (
                  <div className="flex items-center gap-2 p-4 bg-buy-light border border-buy/20 rounded-xl mb-6">
                    <CheckCircle2 className="w-5 h-5 text-buy flex-shrink-0" />
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
                      ? 'bg-primary hover:bg-primary/85 text-primary-foreground shadow-lg shadow-blue-500/25'
                      : 'bg-accent text-muted-foreground cursor-not-allowed'
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
                    <ArrowLeftRight className="w-5 h-5 text-primary-foreground" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground">Internal Transfer</h3>
                    <p className="text-xs text-muted-foreground">Quick & Free</p>
                  </div>
                </div>
                <ul className="space-y-3 text-sm">
                  <li className="flex items-start gap-2 text-muted-foreground">
                    <CheckCircle2 className="w-4 h-4 text-buy mt-0.5 flex-shrink-0" />
                    <span>Instant transfers between accounts</span>
                  </li>
                  <li className="flex items-start gap-2 text-muted-foreground">
                    <CheckCircle2 className="w-4 h-4 text-buy mt-0.5 flex-shrink-0" />
                    <span>No transaction fees</span>
                  </li>
                  <li className="flex items-start gap-2 text-muted-foreground">
                    <CheckCircle2 className="w-4 h-4 text-buy mt-0.5 flex-shrink-0" />
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
                    className="flex items-center justify-between p-3 bg-muted rounded-xl hover:bg-accent transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <TrendingUp className="w-5 h-5 text-primary" />
                      <span className="text-sm font-medium text-foreground/80">Deposit Crypto</span>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  </Link>
                  <Link
                    href="/wallet/withdraw/crypto"
                    className="flex items-center justify-between p-3 bg-muted rounded-xl hover:bg-accent transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <Send className="w-5 h-5 text-primary" />
                      <span className="text-sm font-medium text-foreground/80">Withdraw Crypto</span>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  </Link>
                  <Link
                    href="/wallet/convert"
                    className="flex items-center justify-between p-3 bg-muted rounded-xl hover:bg-accent transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <ArrowRight className="w-5 h-5 text-primary" />
                      <span className="text-sm font-medium text-foreground/80">Convert Assets</span>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
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
                <div className="grid grid-cols-6 gap-4 px-6 py-4 bg-background border-b border-border text-xs font-semibold text-muted-foreground uppercase tracking-wider">
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
                      <div className="flex items-center gap-2">
                        <CoinIcon symbol={transfer.symbol} size={24} />
                        <span className="font-medium text-foreground">{transfer.symbol}</span>
                      </div>
                      <span className="text-muted-foreground">{transfer.from_account}</span>
                      <span className="text-muted-foreground">{transfer.to_account}</span>
                      <span className="font-medium text-foreground">{parseFloat(transfer.amount).toFixed(6)}</span>
                      <span className="px-2 py-1 rounded-full text-xs font-medium bg-buy-light text-buy w-fit">
                        {transfer.status}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {new Date(transfer.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
    </WalletOperationsShell>

      <button
        type="button"
        className="fixed bottom-6 right-6 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/20 transition-colors hover:bg-primary/90"
      >
        <HelpCircle className="h-6 w-6" />
      </button>
    </>
  );
}
