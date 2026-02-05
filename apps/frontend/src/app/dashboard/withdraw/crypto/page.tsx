'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth';
import Link from 'next/link';
import Image from 'next/image';
import {
  ChevronDown,
  Copy,
  Check,
  HelpCircle,
  Search,
  RefreshCw,
  Wallet,
  Send,
  ArrowLeftRight,
  TrendingUp,
  Clock,
  ChevronRight,
  ExternalLink,
  AlertCircle,
  QrCode,
  CreditCard,
  LayoutGrid,
} from 'lucide-react';

interface Chain {
  id: string;
  id_text?: string;
  name: string;
  type: string;
  native_currency: string;
  confirmations_required?: number;
  explorer_url?: string;
  icon?: string;
}

interface Token {
  id: string;
  symbol: string;
  name: string;
  decimals: number;
  is_native: boolean;
  icon?: string;
}

interface Balance {
  symbol: string;
  name: string;
  funding: string;
  trading: string;
  total: string;
}

interface WithdrawalLimits {
  daily: {
    limit: number;
    used: number;
    remaining: number;
    percentage: number;
  };
  monthly: {
    limit: number;
    used: number;
    remaining: number;
    percentage: number;
  };
  vipLevel: number;
}

interface WithdrawalFee {
  fee: string;
  minWithdrawal: string;
  decimals: number;
  chainName: string;
}

interface WithdrawPreview {
  fee: string;
  net_amount: string;
  min_withdrawal: string;
  fee_exceeds_amount: boolean;
}

interface Withdrawal {
  id: string;
  coin?: string;
  symbol?: string;
  chain_name?: string;
  chain_type?: string;
  amount?: string;
  quantity?: string;
  fee?: string;
  to_address?: string;
  address?: string;
  tx_hash?: string;
  txid?: string;
  status: string;
  displayStatus?: string;
  created_at?: string;
  date_time?: string;
  withdrawal_type?: string;
  internal_recipient_email?: string | null;
}

const FAQ_LINKS = [
  { title: 'Crypto Withdrawal FAQs', href: '#' },
  { title: 'How to Withdraw Through Internal Transfer', href: '#' },
  { title: 'View the Deposit/Withdrawal Status of All Coins', href: '#' },
  { title: 'How to Change Your Withdrawal Limit', href: '#' },
  { title: 'How to Manage Your Withdrawal Address Book', href: '#' },
];

const SIDEBAR_LINKS = [
  { label: 'Asset Dashboard', href: '/dashboard/assets/overview', icon: LayoutGrid },
  { label: 'Deposit', href: '/dashboard/deposit/crypto', icon: TrendingUp },
  { label: 'Withdraw', href: '/dashboard/withdraw/crypto', icon: Send, active: true },
  { label: 'Transfer', href: '/dashboard/transfer', icon: ArrowLeftRight },
  { label: 'Convert', href: '/dashboard/assets/convert', icon: RefreshCw },
  { label: 'History', href: '/dashboard/assets/history', icon: Clock },
];

export default function WithdrawCryptoPage() {
  const router = useRouter();
  const { accessToken } = useAuthStore();

  // State
  const [tokens, setTokens] = useState<Token[]>([]);
  const [selectedToken, setSelectedToken] = useState<Token | null>(null);
  const [availableChains, setAvailableChains] = useState<Chain[]>([]);
  const [selectedChain, setSelectedChain] = useState<Chain | null>(null);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [withdrawalLimits, setWithdrawalLimits] = useState<WithdrawalLimits | null>(null);
  const [withdrawalFee, setWithdrawalFee] = useState<WithdrawalFee | null>(null);
  const [previewData, setPreviewData] = useState<WithdrawPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [recentWithdrawals, setRecentWithdrawals] = useState<Withdrawal[]>([]);

  // Form state
  const [withdrawType, setWithdrawType] = useState<'on-chain' | 'internal'>('on-chain');
  const [toAddress, setToAddress] = useState('');
  const [internalRecipient, setInternalRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [selectedAccounts, setSelectedAccounts] = useState({
    funding: true,
    trading: false,
  });
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // UI state
  const [loading, setLoading] = useState(true);
  const [chainsLoading, setChainsLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showTokenDropdown, setShowTokenDropdown] = useState(false);
  const [showChainDropdown, setShowChainDropdown] = useState(false);
  const [tokenSearch, setTokenSearch] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState('');

  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

  const getTokenIcon = (symbol: string) => {
    return `/assets/upload/currency-logo/${symbol.toLowerCase()}.svg`;
  };

  const getChainIcon = (chain: Chain) => {
    const iconName = chain.icon || chain.name.toLowerCase().replace(/\s+/g, '');
    const iconMapping: Record<string, string> = {
      'ethereum': 'ethereum',
      'eth': 'ethereum',
      'bnb smart chain': 'bnb',
      'bsc': 'bnb',
      'polygon': 'polygon',
      'matic': 'polygon',
      'arbitrum one': 'arbitrum',
      'arbitrum': 'arbitrum',
      'solana': 'solana',
      'sol': 'solana',
      'tron': 'tron',
      'trx': 'tron',
      'bitcoin': 'bitcoin',
      'btc': 'bitcoin',
    };
    const icon = iconMapping[iconName] || iconMapping[chain.id_text?.toLowerCase() || ''] || 'ethereum';
    return `/assets/upload/blockchain-logo/${icon}.svg`;
  };

  useEffect(() => {
    fetchTokens();
    if (accessToken) {
      fetchBalances();
      fetchWithdrawalLimits();
      fetchRecentWithdrawals();
    }
  }, [accessToken]);

  useEffect(() => {
    if (selectedToken) {
      fetchChainsForToken(selectedToken.symbol);
    }
  }, [selectedToken]);

  useEffect(() => {
    if (selectedToken && selectedChain) {
      fetchWithdrawalFee(selectedToken.symbol, selectedChain.id);
    }
  }, [selectedToken, selectedChain]);

  // Debounced withdrawal preview when amount changes (fee + net amount)
  useEffect(() => {
    if (!accessToken || !selectedToken || !amount || parseFloat(amount) <= 0) {
      setPreviewData(null);
      return;
    }
    const isInternal = withdrawType === 'internal';
    if (isInternal) {
      setPreviewData({ fee: '0', net_amount: amount, min_withdrawal: '0', fee_exceeds_amount: false });
      return;
    }
    if (!selectedChain) {
      setPreviewData(null);
      return;
    }
    const timer = setTimeout(async () => {
      setPreviewLoading(true);
      try {
        const params = new URLSearchParams({
          symbol: selectedToken.symbol,
          chainId: selectedChain.id,
          amount,
          type: 'onchain',
        });
        const res = await fetch(`${API_URL}/api/v1/wallet/withdraw/preview?${params}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const data = await res.json();
        if (data.success && data.data) {
          setPreviewData(data.data);
        } else {
          setPreviewData(null);
        }
      } catch {
        setPreviewData(null);
      } finally {
        setPreviewLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [accessToken, selectedToken, selectedChain, amount, withdrawType]);

  const fetchTokens = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_URL}/api/v1/wallet/tokens`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.data) {
          setTokens(data.data);
        }
      }
    } catch (error) {
      console.error('Failed to fetch tokens:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchBalances = async () => {
    if (!accessToken) return;
    try {
      const res = await fetch(`${API_URL}/api/v1/wallet/balances/by-account`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setBalances(data.data || []);
        }
      }
    } catch (error) {
      console.error('Failed to fetch balances:', error);
    }
  };

  const fetchWithdrawalLimits = async () => {
    if (!accessToken) return;
    try {
      const res = await fetch(`${API_URL}/api/v1/wallet/withdrawal-limits`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setWithdrawalLimits(data.data);
        }
      }
    } catch (error) {
      console.error('Failed to fetch withdrawal limits:', error);
    }
  };

  const fetchChainsForToken = async (symbol: string) => {
    try {
      setChainsLoading(true);
      setSelectedChain(null);
      setWithdrawalFee(null);
      const res = await fetch(`${API_URL}/api/v1/wallet/tokens/${symbol}/chains`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.data) {
          setAvailableChains(data.data);
        }
      }
    } catch (error) {
      console.error('Failed to fetch chains:', error);
    } finally {
      setChainsLoading(false);
    }
  };

  const fetchWithdrawalFee = async (symbol: string, chainId: string) => {
    try {
      const res = await fetch(`${API_URL}/api/v1/wallet/withdrawal-fee/${symbol}/${chainId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setWithdrawalFee(data.data);
        }
      }
    } catch (error) {
      console.error('Failed to fetch withdrawal fee:', error);
    }
  };

  const fetchRecentWithdrawals = async () => {
    if (!accessToken) return;
    try {
      const res = await fetch(`${API_URL}/api/v1/wallet/withdrawals?limit=10`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setRecentWithdrawals(data.data || []);
        }
      }
    } catch (error) {
      console.error('Failed to fetch withdrawals:', error);
    }
  };

  const selectToken = (token: Token) => {
    setSelectedToken(token);
    setShowTokenDropdown(false);
    setTokenSearch('');
    setAmount('');
    setToAddress('');
  };

  const selectChain = (chain: Chain) => {
    setSelectedChain(chain);
    setShowChainDropdown(false);
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const getAvailableBalance = () => {
    if (!selectedToken) return 0;
    const tokenBalance = balances.find(b => b.symbol.toUpperCase() === selectedToken.symbol.toUpperCase());
    if (!tokenBalance) return 0;
    let total = 0;
    if (selectedAccounts.funding) total += parseFloat(tokenBalance.funding || '0');
    if (selectedAccounts.trading) total += parseFloat(tokenBalance.trading || '0');
    return total;
  };

  const getWithdrawFee = (): number => {
    if (withdrawType === 'internal') return 0;
    if (previewData) return parseFloat(previewData.fee);
    if (withdrawalFee) return parseFloat(withdrawalFee.fee);
    return 0;
  };

  const getReceivedAmount = (): number => {
    if (!amount) return 0;
    const amountNum = parseFloat(amount);
    if (withdrawType === 'internal') return amountNum;
    if (previewData) return parseFloat(previewData.net_amount);
    if (withdrawalFee) return Math.max(0, amountNum - parseFloat(withdrawalFee.fee));
    return 0;
  };

  const setMaxAmount = () => {
    const available = getAvailableBalance();
    const fee = getWithdrawFee();
    if (withdrawType === 'internal') {
      setAmount(available.toString());
    } else {
      const maxSend = Math.max(0, available - fee);
      setAmount(maxSend.toString());
    }
  };

  const handleSubmit = async () => {
    const isInternal = withdrawType === 'internal';
    if (!selectedToken || !amount) {
      setError('Please select a coin and enter amount');
      return;
    }
    if (isInternal) {
      if (!internalRecipient.trim()) {
        setError('Please enter recipient (email, UID, or phone)');
        return;
      }
    } else {
      if (!selectedChain || !toAddress.trim()) {
        setError('Please select chain and enter wallet address');
        return;
      }
    }
    if (!accessToken) {
      router.push('/login');
      return;
    }
    setError('');
    setSuccessMessage(null);
    setSubmitting(true);
    try {
      const body: Record<string, string> = {
        symbol: selectedToken.symbol,
        amount,
        type: isInternal ? 'internal' : 'onchain',
        accountType: selectedAccounts.funding ? 'funding' : 'trading',
      };
      if (isInternal) {
        body.internal_user_identifier = internalRecipient.trim();
      } else {
        body.chainId = selectedChain!.id;
        body.toAddress = toAddress.trim();
      }
      const res = await fetch(`${API_URL}/api/v1/wallet/withdrawals`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        setAmount('');
        setToAddress('');
        setInternalRecipient('');
        fetchBalances();
        fetchWithdrawalLimits();
        fetchRecentWithdrawals();
        const status = data.data?.status;
        const type = data.data?.type;
        if (type === 'internal' && status === 'completed') {
          setSuccessMessage('Transfer completed.');
        } else if (status === 'pending_approval') {
          setSuccessMessage('Withdrawal submitted for approval.');
        } else {
          setSuccessMessage('Withdrawal submitted.');
        }
        setTimeout(() => setSuccessMessage(null), 5000);
      } else {
        setError(data.error?.message || 'Failed to submit withdrawal');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const cancelWithdrawal = async (id: string) => {
    if (!accessToken) return;
    if (!confirm('Are you sure you want to cancel this withdrawal?')) return;
    try {
      const res = await fetch(`${API_URL}/api/v1/wallet/withdrawals/${id}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      if (data.success) {
        fetchRecentWithdrawals();
        fetchBalances();
      } else {
        alert(data.error?.message || 'Failed to cancel withdrawal');
      }
    } catch (error) {
      console.error('Failed to cancel withdrawal:', error);
    }
  };

  const filteredTokens = tokens.filter(t =>
    t.symbol.toLowerCase().includes(tokenSearch.toLowerCase()) ||
    t.name.toLowerCase().includes(tokenSearch.toLowerCase())
  );

  const getStatusBadge = (status: string) => {
    const s = (status || '').toLowerCase();
    const styles: Record<string, string> = {
      completed: 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400',
      processing: 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400',
      pending: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400',
      pending_approval: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400',
      queued: 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400',
      signed: 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400',
      broadcasted: 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400',
      failed: 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400',
      rejected: 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400',
      cancelled: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400',
    };
    return styles[s] || styles.cancelled;
  };

  const formatAddress = (address: string) => {
    if (address.length <= 16) return address;
    return `${address.slice(0, 8)}...${address.slice(-6)}`;
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#0b0e11]">
      <div className="flex">
        {/* Sidebar */}
        <aside className="w-60 min-h-screen bg-white dark:bg-[#181a20] border-r border-gray-200 dark:border-gray-800">
          <nav className="p-4 space-y-1">
            {SIDEBAR_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`flex items-center gap-3 px-4 py-3 text-sm font-medium rounded-xl transition-colors ${
                  link.active
                    ? 'bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 text-blue-600 dark:text-blue-400 border border-blue-100 dark:border-blue-800/30'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/50'
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
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Withdraw</h1>
            <Link
              href="/dashboard/withdraw/fiat"
              className="flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-[#1e2329] text-gray-700 dark:text-gray-300 font-medium text-sm rounded-xl border border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600 transition-colors"
            >
              <CreditCard className="w-4 h-4" />
              Fiat Withdrawal
            </Link>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Withdrawal Form */}
            <div className="lg:col-span-2">
              <div className="bg-white dark:bg-[#1e2329] rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden">
                {/* Form Content */}
                <div className="p-6">
                  {/* Select Coin */}
                  <div className="mb-6">
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Select Coin</label>
                      <span className="text-xs text-gray-400">Coin</span>
                    </div>
                    <div className="relative">
                      <button
                        onClick={() => setShowTokenDropdown(!showTokenDropdown)}
                        className="w-full flex items-center justify-between px-4 py-3.5 bg-gray-50 dark:bg-[#2b2f36] border border-gray-200 dark:border-gray-700 rounded-xl text-left hover:border-blue-400 dark:hover:border-blue-500 transition-colors"
                      >
                        {selectedToken ? (
                          <div className="flex items-center gap-3">
                            <Image
                              src={getTokenIcon(selectedToken.symbol)}
                              alt={selectedToken.symbol}
                              width={28}
                              height={28}
                              className="rounded-full"
                              unoptimized
                            />
                            <div>
                              <span className="font-semibold text-gray-900 dark:text-white">{selectedToken.symbol}</span>
                              <span className="text-sm text-gray-500 ml-2">{selectedToken.name}</span>
                            </div>
                          </div>
                        ) : (
                          <span className="text-gray-400">Please Select</span>
                        )}
                        <ChevronDown className={`w-5 h-5 text-gray-400 transition-transform ${showTokenDropdown ? 'rotate-180' : ''}`} />
                      </button>

                      {showTokenDropdown && (
                        <div className="absolute z-30 top-full left-0 right-0 mt-2 bg-white dark:bg-[#1e2329] border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl overflow-hidden">
                          <div className="p-3 border-b border-gray-100 dark:border-gray-800">
                            <div className="relative">
                              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                              <input
                                type="text"
                                value={tokenSearch}
                                onChange={(e) => setTokenSearch(e.target.value)}
                                placeholder="Search coin..."
                                className="w-full pl-10 pr-4 py-2.5 bg-gray-50 dark:bg-[#2b2f36] border-0 rounded-lg text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 outline-none"
                                autoFocus
                              />
                            </div>
                          </div>
                          <div className="max-h-64 overflow-y-auto">
                            {loading ? (
                              <div className="flex justify-center py-8">
                                <RefreshCw className="w-5 h-5 text-blue-500 animate-spin" />
                              </div>
                            ) : filteredTokens.length > 0 ? (
                              filteredTokens.slice(0, 50).map((token) => (
                                <button
                                  key={token.id}
                                  onClick={() => selectToken(token)}
                                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                                >
                                  <Image
                                    src={getTokenIcon(token.symbol)}
                                    alt={token.symbol}
                                    width={28}
                                    height={28}
                                    className="rounded-full"
                                    unoptimized
                                  />
                                  <div className="text-left">
                                    <p className="font-medium text-gray-900 dark:text-white">{token.symbol}</p>
                                    <p className="text-xs text-gray-500">{token.name}</p>
                                  </div>
                                </button>
                              ))
                            ) : (
                              <div className="py-8 text-center text-gray-400 text-sm">No tokens found</div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Withdraw To Tabs */}
                  <div className="mb-6">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3 block">Withdraw to</label>
                    <div className="flex gap-1 p-1 bg-gray-100 dark:bg-[#2b2f36] rounded-xl w-fit">
                      <button
                        onClick={() => setWithdrawType('on-chain')}
                        className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
                          withdrawType === 'on-chain'
                            ? 'bg-white dark:bg-[#1e2329] text-blue-600 dark:text-blue-400 shadow-sm'
                            : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                        }`}
                      >
                        On-chain Withdrawal
                      </button>
                      <button
                        onClick={() => setWithdrawType('internal')}
                        className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
                          withdrawType === 'internal'
                            ? 'bg-white dark:bg-[#1e2329] text-blue-600 dark:text-blue-400 shadow-sm'
                            : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                        }`}
                      >
                        Internal Transfer
                      </button>
                    </div>
                  </div>

                  {withdrawType === 'on-chain' ? (
                    <>
                      {/* Wallet Address */}
                      <div className="mb-6">
                        <label className="text-sm text-gray-500 mb-2 block">Wallet Address</label>
                        <div className="relative">
                          <input
                            type="text"
                            value={toAddress}
                            onChange={(e) => setToAddress(e.target.value)}
                            placeholder="Please enter"
                            className="w-full px-4 py-3.5 pr-12 bg-gray-50 dark:bg-[#2b2f36] border border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-white placeholder-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20 outline-none transition-all"
                          />
                          <button className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors">
                            <QrCode className="w-5 h-5 text-gray-400" />
                          </button>
                        </div>
                      </div>

                      {/* Chain Type */}
                      <div className="mb-6">
                        <label className="text-sm text-gray-500 mb-2 block">Chain Type</label>
                        <div className="relative">
                          <button
                            onClick={() => selectedToken && setShowChainDropdown(!showChainDropdown)}
                            disabled={!selectedToken}
                            className={`w-full flex items-center justify-between px-4 py-3.5 bg-gray-50 dark:bg-[#2b2f36] border border-gray-200 dark:border-gray-700 rounded-xl text-left ${
                              !selectedToken ? 'opacity-50 cursor-not-allowed' : 'hover:border-blue-400 dark:hover:border-blue-500'
                            } transition-colors`}
                          >
                            {selectedChain ? (
                              <div className="flex items-center gap-3">
                                <Image
                                  src={getChainIcon(selectedChain)}
                                  alt={selectedChain.name}
                                  width={24}
                                  height={24}
                                  className="rounded-full"
                                  unoptimized
                                />
                                <span className="font-medium text-gray-900 dark:text-white">{selectedChain.name}</span>
                                {selectedChain.type === 'evm' && (
                                  <span className="text-xs px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-full">EVM</span>
                                )}
                              </div>
                            ) : (
                              <span className="text-gray-400">Select chain</span>
                            )}
                            <ChevronDown className={`w-5 h-5 text-gray-400 transition-transform ${showChainDropdown ? 'rotate-180' : ''}`} />
                          </button>

                          {showChainDropdown && (
                            <div className="absolute z-30 top-full left-0 right-0 mt-2 bg-white dark:bg-[#1e2329] border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl overflow-hidden">
                              {chainsLoading ? (
                                <div className="flex justify-center py-6">
                                  <RefreshCw className="w-5 h-5 text-blue-500 animate-spin" />
                                </div>
                              ) : availableChains.length > 0 ? (
                                availableChains.map((chain) => (
                                  <button
                                    key={chain.id}
                                    onClick={() => selectChain(chain)}
                                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                                  >
                                    <div className="flex items-center gap-3">
                                      <Image
                                        src={getChainIcon(chain)}
                                        alt={chain.name}
                                        width={24}
                                        height={24}
                                        className="rounded-full"
                                        unoptimized
                                      />
                                      <span className="font-medium text-gray-900 dark:text-white">{chain.name}</span>
                                    </div>
                                  </button>
                                ))
                              ) : (
                                <div className="py-6 text-center text-gray-400 text-sm">No chains available</div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="mb-6">
                      <label className="text-sm text-gray-500 mb-2 block">Recipient (UID / Email / Phone)</label>
                      <input
                        type="text"
                        value={internalRecipient}
                        onChange={(e) => setInternalRecipient(e.target.value)}
                        placeholder="Enter UID, email, or phone number"
                        className="w-full px-4 py-3.5 bg-gray-50 dark:bg-[#2b2f36] border border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-white placeholder-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20 outline-none transition-all"
                      />
                    </div>
                  )}

                  {/* Amount */}
                  <div className="mb-6">
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-sm text-gray-500">Withdrawable Amount</label>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-400">Amount</span>
                        <button className="text-xs text-blue-500 hover:text-blue-600 font-medium">Raise Amount</button>
                      </div>
                    </div>
                    <div className="relative">
                      <input
                        type="number"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder="0"
                        className="w-full px-4 py-3.5 pr-16 bg-gray-50 dark:bg-[#2b2f36] border border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-white placeholder-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20 outline-none transition-all"
                      />
                      <button
                        onClick={setMaxAmount}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-blue-500 hover:text-blue-600 font-medium"
                      >
                        All
                      </button>
                    </div>

                    {/* Account Selection */}
                    <div className="mt-4 p-4 bg-gray-50 dark:bg-[#2b2f36] rounded-xl">
                      <div className="flex items-center justify-between text-sm text-gray-500 mb-3">
                        <span>Select account ({selectedAccounts.funding || selectedAccounts.trading ? 1 : 0})</span>
                        <span className="font-medium text-gray-900 dark:text-white">0</span>
                      </div>
                      <div className="space-y-2">
                        <label className="flex items-center justify-between p-3 bg-white dark:bg-[#1e2329] rounded-xl cursor-pointer border border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600 transition-colors">
                          <div className="flex items-center gap-3">
                            <input
                              type="checkbox"
                              checked={selectedAccounts.funding}
                              onChange={(e) => setSelectedAccounts({ ...selectedAccounts, funding: e.target.checked })}
                              className="w-4 h-4 rounded border-gray-300 text-blue-500 focus:ring-blue-500"
                            />
                            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center">
                              <Wallet className="w-4 h-4 text-white" />
                            </div>
                            <span className="text-gray-700 dark:text-gray-300 font-medium">Funding</span>
                          </div>
                          <span className="text-gray-500">
                            {selectedToken && balances.find(b => b.symbol.toUpperCase() === selectedToken.symbol.toUpperCase())?.funding || '0'}
                          </span>
                        </label>
                        <label className="flex items-center justify-between p-3 bg-white dark:bg-[#1e2329] rounded-xl cursor-pointer border border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600 transition-colors">
                          <div className="flex items-center gap-3">
                            <input
                              type="checkbox"
                              checked={selectedAccounts.trading}
                              onChange={(e) => setSelectedAccounts({ ...selectedAccounts, trading: e.target.checked })}
                              className="w-4 h-4 rounded border-gray-300 text-blue-500 focus:ring-blue-500"
                            />
                            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center">
                              <TrendingUp className="w-4 h-4 text-white" />
                            </div>
                            <span className="text-gray-700 dark:text-gray-300 font-medium">Unified Trading</span>
                          </div>
                          <span className="text-gray-500">
                            {selectedToken && balances.find(b => b.symbol.toUpperCase() === selectedToken.symbol.toUpperCase())?.trading || '0'}
                          </span>
                        </label>
                      </div>
                    </div>
                  </div>

                  {/* Fee & Received (from preview when amount entered) */}
                  <div className="bg-blue-50 dark:bg-blue-900/10 rounded-xl p-4 border border-blue-100 dark:border-blue-800/30 mb-6">
                    <div className="flex items-center justify-between text-sm mb-2">
                      <span className="text-gray-600 dark:text-gray-400">Transaction Fee</span>
                      <span className="font-medium text-gray-900 dark:text-white">
                        {withdrawType === 'internal'
                          ? `0 ${selectedToken?.symbol || ''}`
                          : previewLoading
                            ? '...'
                            : (previewData ? `${previewData.fee} ${selectedToken?.symbol || ''}` : withdrawalFee ? `${withdrawalFee.fee} ${selectedToken?.symbol || ''}` : '--')}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-600 dark:text-gray-400">Amount Received</span>
                      <span className="font-semibold text-gray-900 dark:text-white">
                        {withdrawType === 'internal'
                          ? (amount ? `${amount} ${selectedToken?.symbol || ''}` : '--')
                          : previewLoading
                            ? '...'
                            : (amount ? `${getReceivedAmount().toFixed(8)} ${selectedToken?.symbol || ''}` : '--')}
                      </span>
                    </div>
                    {previewData?.fee_exceeds_amount && (
                      <p className="text-amber-600 dark:text-amber-400 text-sm mt-2">Fee exceeds amount. Increase amount or choose another option.</p>
                    )}
                  </div>

                  {/* Success */}
                  {successMessage && (
                    <div className="flex items-center gap-2 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl mb-6">
                      <p className="text-sm text-green-700 dark:text-green-300">{successMessage}</p>
                    </div>
                  )}

                  {/* Error */}
                  {error && (
                    <div className="flex items-center gap-2 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl mb-6">
                      <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
                      <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
                    </div>
                  )}

                  {/* Submit Button */}
                  {(() => {
                    const isInternal = withdrawType === 'internal';
                    const amountNum = parseFloat(amount || '0');
                    const amountInvalid = !amount || isNaN(amountNum) || amountNum <= 0;
                    const fee = getWithdrawFee();
                    const totalRequired = isInternal ? amountNum : amountNum + fee;
                    const balanceInsufficient = totalRequired > getAvailableBalance();
                    const feeExceedsAmount = !!previewData?.fee_exceeds_amount;
                    const validInternal = selectedToken && amount && internalRecipient.trim() && !amountInvalid && !balanceInsufficient;
                    const validOnChain = selectedToken && selectedChain && amount && toAddress.trim() && !amountInvalid && !balanceInsufficient && !feeExceedsAmount;
                    const isValid = isInternal ? validInternal : validOnChain;
                    return (
                  <button
                    onClick={handleSubmit}
                    disabled={!isValid || submitting}
                    className={`w-full py-3.5 rounded-xl font-semibold transition-all ${
                      isValid && !submitting
                        ? 'bg-blue-500 hover:bg-blue-600 text-white shadow-lg shadow-blue-500/25'
                        : 'bg-gray-200 dark:bg-gray-700 text-gray-400 cursor-not-allowed'
                    }`}
                  >
                    {submitting ? (
                      <RefreshCw className="w-5 h-5 animate-spin mx-auto" />
                    ) : (
                      'Confirm'
                    )}
                  </button>
                    );
                  })()}
                </div>
              </div>
            </div>

            {/* Right Side - FAQ */}
            <div className="space-y-6">
              {/* FAQ */}
              <div className="bg-white dark:bg-[#1e2329] rounded-2xl border border-gray-100 dark:border-gray-800 p-6">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">FAQ</h3>
                <ul className="space-y-3">
                  {FAQ_LINKS.map((link, index) => (
                    <li key={index}>
                      <Link href={link.href} className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 transition-colors">
                        <span className="text-blue-500 mt-0.5">•</span>
                        <span>{link.title}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Withdrawal Limits */}
              {withdrawalLimits && (
                <div className="bg-white dark:bg-[#1e2329] rounded-2xl border border-gray-100 dark:border-gray-800 p-6">
                  <div className="flex items-center justify-between mb-4">
                    <p className="text-sm text-gray-500">Daily Remaining Limit</p>
                    <span className="text-xs px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-full font-medium">
                      VIP {withdrawalLimits.vipLevel}
                    </span>
                  </div>
                  <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden mb-3">
                    <div
                      className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full transition-all"
                      style={{ width: `${100 - Math.min(withdrawalLimits.daily.percentage, 100)}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-sm mb-4">
                    <span className="font-semibold text-blue-500">
                      {((1 - withdrawalLimits.daily.percentage / 100) * 100).toFixed(0)}% remaining
                    </span>
                    <span className="text-gray-600 dark:text-gray-400">
                      <span className="font-semibold text-gray-900 dark:text-white">
                        {withdrawalLimits.daily.remaining.toLocaleString()}
                      </span>
                      /{withdrawalLimits.daily.limit.toLocaleString()} USDT
                    </span>
                  </div>
                  <Link
                    href="/dashboard/security/withdrawal-limits"
                    className="flex items-center gap-1 text-sm text-blue-500 hover:text-blue-600 font-medium"
                  >
                    Manage Limit
                    <ChevronRight className="w-4 h-4" />
                  </Link>
                </div>
              )}
            </div>
          </div>

          {/* Recent Withdrawals */}
          <div className="mt-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Recent Withdrawal Records</h2>
              <Link
                href="/dashboard/assets/history?tab=withdraw"
                className="text-sm text-blue-500 hover:text-blue-600 font-medium flex items-center gap-1"
              >
                View All
                <ChevronRight className="w-4 h-4" />
              </Link>
            </div>

            <div className="bg-white dark:bg-[#1e2329] rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden">
              {/* Table Header */}
              <div className="grid grid-cols-8 gap-4 px-6 py-4 bg-gray-50 dark:bg-[#0b0e11] border-b border-gray-100 dark:border-gray-800 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                <span>Coin</span>
                <span>Chain Type</span>
                <span>Qty</span>
                <span>Fee</span>
                <span>Address</span>
                <span>Txid</span>
                <span>Status</span>
                <span>Date & Time</span>
              </div>

              {/* Table Body */}
              {recentWithdrawals.length > 0 ? (
                <div className="divide-y divide-gray-100 dark:divide-gray-800">
                  {recentWithdrawals.map((withdrawal) => {
                    const coin = withdrawal.coin ?? withdrawal.symbol ?? '—';
                    const chainLabel = withdrawal.chain_type ?? withdrawal.chain_name ?? '—';
                    const qty = withdrawal.quantity ?? withdrawal.amount ?? '0';
                    const toLabel = withdrawal.withdrawal_type === 'internal'
                      ? (withdrawal.internal_recipient_email ?? 'Internal')
                      : (withdrawal.address ?? withdrawal.to_address ?? '—');
                    const txHash = withdrawal.txid ?? withdrawal.tx_hash;
                    const dateStr = withdrawal.date_time ?? withdrawal.created_at ?? '';
                    const displayStatus = withdrawal.displayStatus ?? (withdrawal.status ? withdrawal.status.charAt(0).toUpperCase() + withdrawal.status.slice(1).replace(/_/g, ' ') : '—');
                    return (
                    <div key={withdrawal.id} className="grid grid-cols-8 gap-4 px-6 py-4 text-sm items-center hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                      <div className="flex items-center gap-2">
                        <Image
                          src={getTokenIcon(coin)}
                          alt={coin}
                          width={24}
                          height={24}
                          className="rounded-full"
                          unoptimized
                        />
                        <span className="font-medium text-gray-900 dark:text-white">{coin}</span>
                      </div>
                      <span className="text-gray-600 dark:text-gray-400">{chainLabel}</span>
                      <span className="font-medium text-gray-900 dark:text-white">{parseFloat(String(qty)).toFixed(6)}</span>
                      <span className="text-gray-500">{withdrawal.fee ?? '0'}</span>
                      <div className="flex items-center gap-1">
                        <span className="text-gray-600 dark:text-gray-400 font-mono text-xs" title={toLabel}>{withdrawal.withdrawal_type === 'internal' ? toLabel : formatAddress(toLabel)}</span>
                        {withdrawal.withdrawal_type !== 'internal' && (
                          <button
                            onClick={() => copyToClipboard(toLabel, `addr-${withdrawal.id}`)}
                            className="text-gray-400 hover:text-blue-500 transition-colors"
                          >
                            {copied === `addr-${withdrawal.id}` ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                          </button>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        {txHash ? (
                          <>
                            <span className="text-blue-500 font-mono text-xs">{formatAddress(txHash)}</span>
                            <button className="text-gray-400 hover:text-blue-500 transition-colors">
                              <ExternalLink className="w-3.5 h-3.5" />
                            </button>
                          </>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </div>
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusBadge(withdrawal.status)}`}>
                        {displayStatus}
                      </span>
                      <div className="flex items-center justify-between">
                        <span className="text-gray-500 text-xs">
                          {dateStr ? `${new Date(dateStr).toLocaleDateString()} ${new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '—'}
                        </span>
                        {withdrawal.status === 'pending' && withdrawal.withdrawal_type !== 'internal' && (
                          <button
                            onClick={() => cancelWithdrawal(withdrawal.id)}
                            className="text-xs text-red-500 hover:text-red-600 font-medium"
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    </div>
                  );
                  })}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-16">
                  <div className="w-20 h-20 bg-gray-100 dark:bg-gray-800 rounded-2xl flex items-center justify-center mb-4">
                    <Clock className="w-10 h-10 text-gray-300 dark:text-gray-600" />
                  </div>
                  <p className="text-gray-500 font-medium">No withdrawal records found</p>
                  <p className="text-sm text-gray-400 mt-1">Your recent withdrawals will appear here</p>
                </div>
              )}
            </div>
          </div>
        </main>
      </div>

      {/* Help Button */}
      <button className="fixed bottom-6 right-6 w-12 h-12 bg-blue-500 hover:bg-blue-600 text-white rounded-full shadow-lg shadow-blue-500/25 flex items-center justify-center transition-colors z-40">
        <HelpCircle className="w-6 h-6" />
      </button>
    </div>
  );
}
