'use client';

import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { X, ArrowLeftRight, ChevronDown, AlertCircle, CheckCircle2, Loader2, Search, Wallet, ArrowRight } from 'lucide-react';
import Image from 'next/image';
import { useAuthStore } from '@/store/auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';

interface Token {
  tokenId: string;
  symbol: string;
  name: string;
  iconUrl: string | null;
  decimals: number;
  availableBalance: string;
}

interface TransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  accessToken?: string;
  defaultFromAccount?: 'funding' | 'trading';
  defaultToAccount?: 'funding' | 'trading';
  /** Called after successful transfer. Balances are invalidated by the modal; use for any extra side effects. */
  onSuccess?: () => void;
}

export default function TransferModal({
  isOpen,
  onClose,
  accessToken: propAccessToken,
  defaultFromAccount = 'funding',
  defaultToAccount = 'trading',
  onSuccess,
}: TransferModalProps) {
  const queryClient = useQueryClient();
  const { accessToken: storeAccessToken } = useAuthStore();
  const accessToken = propAccessToken || storeAccessToken;
  
  const [fromAccount, setFromAccount] = useState<'funding' | 'trading'>(defaultFromAccount);
  const [toAccount, setToAccount] = useState<'funding' | 'trading'>(defaultToAccount);
  const [selectedToken, setSelectedToken] = useState<Token | null>(null);
  const [amount, setAmount] = useState('');
  const [tokens, setTokens] = useState<Token[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [showFromDropdown, setShowFromDropdown] = useState(false);
  const [showToDropdown, setShowToDropdown] = useState(false);
  const [showCoinDropdown, setShowCoinDropdown] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const API_URL = getApiBaseUrl();

  useEffect(() => {
    if (isOpen && accessToken) {
      fetchTransferableBalances();
    }
  }, [isOpen, accessToken, fromAccount]);

  useEffect(() => {
    if (isOpen) {
      setAmount('');
      setError('');
      setSuccess(false);
      setSelectedToken(null);
      setFromAccount(defaultFromAccount);
      setToAccount(defaultToAccount);
    }
  }, [isOpen, defaultFromAccount, defaultToAccount]);

  const fetchTransferableBalances = async () => {
    try {
      setLoading(true);
      setError('');
      
      const res = await fetch(`${API_URL}/api/v1/wallet/transfer/balances?from=${fromAccount}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      
      const data = await res.json();
      
      if (res.ok && data.success) {
        setTokens(data.data || []);
        // Don't auto-select a token - let user choose
      } else {
        setError(data.error?.message || 'Failed to load balances. Please try again.');
      }
    } catch (err) {
      setError('Failed to load balances. Please try again.');
    } finally {
      setLoading(false);
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
    
    if (!amount || parseFloat(amount) <= 0) {
      setError('Enter a positive amount.');
      return;
    }

    const transferAmount = parseFloat(amount);
    const availableBalance = parseFloat(selectedToken.availableBalance);
    if (transferAmount > availableBalance) {
      setError('Insufficient balance. Reduce the amount or check the source account.');
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
        queryClient.invalidateQueries({ queryKey: ['balances'] });
        setTimeout(() => {
          onSuccess?.();
          onClose();
        }, 1500);
      } else {
        setError(data.error?.message || 'Transfer could not be completed. Check balance and try again.');
      }
    } catch {
      setError('Connection issue. Your request may not have reached the server. Safe to try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSetMax = () => {
    if (selectedToken) {
      setAmount(selectedToken.availableBalance);
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
        return 'Funding';
      case 'trading':
        return 'Unified Trading';
      default:
        return account;
    }
  };

  const getAccountIcon = (account: string) => {
    if (account === 'funding') {
      return (
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center">
          <Wallet className="w-3.5 h-3.5 text-white" />
        </div>
      );
    }
    return (
      <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center">
        <ArrowRight className="w-3.5 h-3.5 text-white" />
      </div>
    );
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal - Compact size */}
      <div className="relative w-full max-w-md mx-4 bg-white dark:bg-[#1e2329] rounded-2xl shadow-2xl overflow-hidden border border-gray-200 dark:border-gray-800">
        {/* Header - Compact */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Transfer</h2>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* Content - Compact spacing */}
        <div className="p-5 space-y-4">
          {/* From/To Selection */}
          <div className="flex items-center gap-3">
            {/* From Account */}
            <div className="flex-1">
              <label className="block text-xs text-gray-500 mb-1.5">From</label>
              <div className="relative">
                <button
                  onClick={() => {
                    setShowFromDropdown(!showFromDropdown);
                    setShowToDropdown(false);
                    setShowCoinDropdown(false);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2.5 bg-gray-50 dark:bg-[#2b2f36] border border-gray-200 dark:border-gray-700 rounded-xl hover:border-blue-400 transition-colors"
                >
                  {getAccountIcon(fromAccount)}
                  <span className="text-gray-900 dark:text-white font-medium text-sm flex-1 text-left truncate">
                    {getAccountLabel(fromAccount)}
                  </span>
                  <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform flex-shrink-0 ${showFromDropdown ? 'rotate-180' : ''}`} />
                </button>
                {showFromDropdown && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-[#1e2329] border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl z-20 overflow-hidden">
                    {['funding', 'trading'].map((account) => (
                      <button
                        key={account}
                        onClick={() => {
                          if (account !== toAccount) {
                            setFromAccount(account as 'funding' | 'trading');
                          }
                          setShowFromDropdown(false);
                        }}
                        disabled={account === toAccount}
                        className={`w-full flex items-center gap-2 px-3 py-2.5 text-left text-sm transition-colors ${
                          account === fromAccount
                            ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600'
                            : account === toAccount
                            ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
                            : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
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
              className="mt-5 p-2 text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
            >
              <ArrowLeftRight className="w-5 h-5" />
            </button>

            {/* To Account */}
            <div className="flex-1">
              <label className="block text-xs text-gray-500 mb-1.5">To</label>
              <div className="relative">
                <button
                  onClick={() => {
                    setShowToDropdown(!showToDropdown);
                    setShowFromDropdown(false);
                    setShowCoinDropdown(false);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2.5 bg-gray-50 dark:bg-[#2b2f36] border border-gray-200 dark:border-gray-700 rounded-xl hover:border-blue-400 transition-colors"
                >
                  {getAccountIcon(toAccount)}
                  <span className="text-gray-900 dark:text-white font-medium text-sm flex-1 text-left truncate">
                    {getAccountLabel(toAccount)}
                  </span>
                  <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform flex-shrink-0 ${showToDropdown ? 'rotate-180' : ''}`} />
                </button>
                {showToDropdown && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-[#1e2329] border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl z-20 overflow-hidden">
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
                        className={`w-full flex items-center gap-2 px-3 py-2.5 text-left text-sm transition-colors ${
                          account === toAccount
                            ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600'
                            : account === fromAccount
                            ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
                            : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
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

          {/* Coin Selection */}
          <div>
            <label className="block text-xs text-gray-500 mb-1.5">Coin</label>
            <div className="relative">
              <button
                onClick={() => {
                  setShowCoinDropdown(!showCoinDropdown);
                  setShowFromDropdown(false);
                  setShowToDropdown(false);
                }}
                className="w-full flex items-center justify-between px-3 py-2.5 bg-gray-50 dark:bg-[#2b2f36] border border-gray-200 dark:border-gray-700 rounded-xl hover:border-blue-400 transition-colors"
              >
                <div className="flex items-center gap-2">
                  {selectedToken ? (
                    <>
                      {selectedToken.iconUrl ? (
                        <Image
                          src={selectedToken.iconUrl}
                          alt={selectedToken.symbol}
                          width={24}
                          height={24}
                          className="rounded-full"
                          unoptimized
                        />
                      ) : (
                        <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center">
                          <span className="text-white text-xs font-bold">
                            {selectedToken.symbol.charAt(0)}
                          </span>
                        </div>
                      )}
                      <span className="text-gray-900 dark:text-white font-medium text-sm">{selectedToken.symbol}</span>
                    </>
                  ) : (
                    <span className="text-gray-400 text-sm">Select coin</span>
                  )}
                </div>
                <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${showCoinDropdown ? 'rotate-180' : ''}`} />
              </button>

              {showCoinDropdown && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-[#1e2329] border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl z-20 overflow-hidden">
                  {/* Search */}
                  <div className="p-2 border-b border-gray-100 dark:border-gray-800">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input
                        type="text"
                        placeholder="Search coin..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-8 pr-3 py-2 bg-gray-50 dark:bg-[#2b2f36] border-0 rounded-lg text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 outline-none"
                      />
                    </div>
                  </div>
                  {/* Token List */}
                  <div className="max-h-48 overflow-y-auto">
                    {loading ? (
                      <div className="flex items-center justify-center gap-2 p-6">
                        <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                        <span className="text-sm text-gray-500">Loading...</span>
                      </div>
                    ) : filteredTokens.length === 0 ? (
                      <div className="p-6 text-center text-sm text-gray-500">No coins found</div>
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
                          className={`w-full flex items-center justify-between px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors ${
                            selectedToken?.tokenId === token.tokenId ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            {token.iconUrl ? (
                              <Image
                                src={token.iconUrl}
                                alt={token.symbol}
                                width={28}
                                height={28}
                                className="rounded-full"
                                unoptimized
                              />
                            ) : (
                              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center">
                                <span className="text-white text-xs font-bold">
                                  {token.symbol.charAt(0)}
                                </span>
                              </div>
                            )}
                            <div className="text-left">
                              <p className="text-sm font-medium text-gray-900 dark:text-white">{token.symbol}</p>
                              <p className="text-xs text-gray-500 truncate max-w-[120px]">{token.name}</p>
                            </div>
                          </div>
                          <span className="text-xs text-gray-500">
                            {parseFloat(token.availableBalance).toFixed(4)}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Transferable Amount Info */}
          <div className="flex items-center justify-between text-sm py-1">
            <span className="text-gray-500">Transferable Amount</span>
            <span className="text-gray-900 dark:text-white font-medium">
              {selectedToken ? `${parseFloat(selectedToken.availableBalance).toFixed(4)} ${selectedToken.symbol}` : '0.0000 USDT'}
            </span>
          </div>

          {/* Amount Input - Only show when coin is selected */}
          {selectedToken && (
            <div>
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
                  className="w-full px-3 py-3 pr-24 bg-gray-50 dark:bg-[#2b2f36] border border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-white placeholder-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20 outline-none transition-all"
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                  <button
                    onClick={handleSetMax}
                    className="text-xs font-medium text-blue-500 hover:text-blue-600"
                  >
                    All
                  </button>
                  <span className="text-sm text-gray-500">{selectedToken.symbol}</span>
                </div>
              </div>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            </div>
          )}

          {/* Success Message */}
          {success && (
            <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
              <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
              <p className="text-sm text-green-600 dark:text-green-400">Transfer successful!</p>
            </div>
          )}

          {/* Confirm Button */}
          <button
            onClick={handleTransfer}
            disabled={!selectedToken || !amount || submitting || success}
            className={`w-full py-3 rounded-lg font-medium text-sm transition-all active:scale-[0.98] ${
              !selectedToken || !amount || submitting || success
                ? 'bg-gray-200 dark:bg-gray-700 text-gray-400 cursor-not-allowed'
                : 'bg-blue-500 hover:bg-blue-600 text-white'
            }`}
          >
            {submitting ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Processing...
              </span>
            ) : success ? (
              <span className="flex items-center justify-center gap-2">
                <CheckCircle2 className="w-4 h-4" />
                Completed
              </span>
            ) : (
              'Confirm'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
