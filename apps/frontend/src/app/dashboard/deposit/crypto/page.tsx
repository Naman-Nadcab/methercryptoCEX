'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore } from '@/store/auth';
import { api } from '@/lib/api';
import Link from 'next/link';
import Image from 'next/image';
import { QRCodeSVG } from 'qrcode.react';
import {
  ChevronDown,
  Copy,
  Check,
  HelpCircle,
  ExternalLink,
  Info,
  Search,
  RefreshCw,
  AlertTriangle,
  X,
  Shield,
  Upload,
  Camera,
  LayoutGrid,
  Send,
  ArrowLeftRight,
  TrendingUp,
  Clock,
} from 'lucide-react';

const SIDEBAR_LINKS = [
  { label: 'Asset Dashboard', href: '/dashboard/assets/overview', icon: LayoutGrid },
  { label: 'Deposit', href: '/dashboard/deposit/crypto', icon: TrendingUp, active: true },
  { label: 'Withdraw', href: '/dashboard/withdraw/crypto', icon: Send },
  { label: 'Transfer', href: '/dashboard/transfer', icon: ArrowLeftRight },
  { label: 'Convert', href: '/dashboard/assets/convert', icon: RefreshCw },
  { label: 'History', href: '/dashboard/assets/history', icon: Clock },
];

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

interface DepositAddress {
  address: string;
  chain: {
    id: string;
    name: string;
    type: string;
    confirmationsRequired: number;
    explorerUrl: string;
  };
  qrCodeData: string;
  notice: string;
}

interface Deposit {
  id: string;
  symbol: string;
  chain_name: string;
  amount: string;
  tx_hash?: string;
  explorer_url?: string;
  to_address: string;
  confirmations: number;
  required_confirmations: number;
  status: string;
  created_at: string;
}

interface KycStatus {
  verified: boolean;
  status: string;
  level: number;
}

// Popular tokens for quick selection (BTC, ETH, USDT, USDC, BNB, SOL, TRX)
const POPULAR_TOKENS = ['BTC', 'ETH', 'USDT', 'USDC', 'BNB', 'SOL', 'TRX'];

export default function DepositCryptoPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const coinParam = searchParams.get('coin');
  const { accessToken, _hasHydrated } = useAuthStore();
  const [tokens, setTokens] = useState<Token[]>([]);
  const [selectedToken, setSelectedToken] = useState<Token | null>(null);
  const [initialCoinSet, setInitialCoinSet] = useState(false);
  const [availableChains, setAvailableChains] = useState<Chain[]>([]);
  const [selectedChain, setSelectedChain] = useState<Chain | null>(null);
  const [depositAddress, setDepositAddress] = useState<DepositAddress | null>(null);
  const [recentDeposits, setRecentDeposits] = useState<Deposit[]>([]);
  const [recentDepositsLoading, setRecentDepositsLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [addressLoading, setAddressLoading] = useState(false);
  const [chainsLoading, setChainsLoading] = useState(false);
  const [chainsError, setChainsError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showTokenDropdown, setShowTokenDropdown] = useState(false);
  const [showChainDropdown, setShowChainDropdown] = useState(false);
  const [tokenSearch, setTokenSearch] = useState('');
  const [kycStatus, setKycStatus] = useState<KycStatus | null>(null);
  const [showKycModal, setShowKycModal] = useState(false);
  const [addressError, setAddressError] = useState<string | null>(null);

  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

  // Get token image path
  const getTokenIcon = (symbol: string) => {
    return `/assets/upload/currency-logo/${symbol.toLowerCase()}.svg`;
  };

  // Get chain image path
  const getChainIcon = (chain: Chain) => {
    const iconName = chain.icon || chain.name.toLowerCase().replace(/\s+/g, '');
    // Map common chain names to icon files
    const iconMapping: Record<string, string> = {
      'ethereum': 'ethereum',
      'eth': 'ethereum',
      'bnb smart chain': 'bnb',
      'bsc': 'bnb',
      'polygon': 'polygon',
      'matic': 'polygon',
      'arbitrum one': 'arbitrum',
      'arbitrum': 'arbitrum',
      'arb': 'arbitrum',
      'solana': 'solana',
      'sol': 'solana',
      'tron': 'tron',
      'trx': 'tron',
      'bitcoin': 'bitcoin',
      'btc': 'bitcoin',
      'polkadot': 'polkadot',
      'dot': 'polkadot',
      'avalanche c-chain': 'avalanche',
      'avalanche': 'avalanche',
      'avax': 'avalanche',
    };
    const icon = iconMapping[iconName] || iconMapping[chain.id_text?.toLowerCase() || ''] || 'ethereum';
    return `/assets/upload/blockchain-logo/${icon}.svg`;
  };

  // 1) Load assets (tokens) on mount
  useEffect(() => {
    fetchTokens();
    if (_hasHydrated && accessToken) {
      fetchKycStatus();
      fetchRecentDeposits();
    }
  }, [_hasHydrated, accessToken]);

  // Auto-select coin from URL parameter
  useEffect(() => {
    if (coinParam && tokens.length > 0 && !initialCoinSet) {
      const matchedToken = tokens.find(
        t => t.symbol.toUpperCase() === coinParam.toUpperCase()
      );
      if (matchedToken) {
        setSelectedToken(matchedToken);
        setInitialCoinSet(true);
      }
    }
  }, [coinParam, tokens, initialCoinSet]);

  // 2) When asset (token) is selected: fetch chains that support this asset only
  useEffect(() => {
    if (selectedToken) {
      setSelectedChain(null);
      setDepositAddress(null);
      setAddressError(null);
      fetchChainsForAsset(selectedToken.symbol);
    } else {
      setAvailableChains([]);
      setSelectedChain(null);
      setDepositAddress(null);
    }
  }, [selectedToken?.id]);

  // When chains for asset are loaded, auto-select first chain if none selected
  useEffect(() => {
    if (selectedToken && availableChains.length > 0 && !selectedChain) {
      setSelectedChain(availableChains[0]);
    }
  }, [availableChains.length, selectedToken?.id]);

  // Fetch deposit address when chain is selected
  useEffect(() => {
    console.log('Chain selection useEffect triggered:', { selectedChain: selectedChain?.id, hasAccessToken: !!accessToken });
    if (selectedChain && accessToken) {
      console.log('Fetching deposit address for chain:', selectedChain.id);
      fetchDepositAddress(selectedChain.id);
    }
  }, [selectedChain, accessToken]);

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

  const fetchKycStatus = async () => {
    if (!accessToken) return;
    try {
      const result = await api.get<{ verified: boolean; status: string; level: number }>('/api/v1/wallet/kyc-status');
      if (result.success && result.data) {
        setKycStatus(result.data);
      }
    } catch (error) {
      console.error('Failed to fetch KYC status:', error);
    }
  };

  // Fetch chains that support the selected asset (token). Asset must be related to chain.
  const fetchChainsForAsset = async (symbol: string) => {
    try {
      setChainsLoading(true);
      setChainsError(null);
      const result = await api.get<Chain[]>(`/api/v1/wallet/tokens/${encodeURIComponent(symbol)}/chains`);
      if (result.success && Array.isArray(result.data)) {
        setAvailableChains(result.data);
        setChainsError(null);
        if (result.data.length === 0) {
          setChainsError(`No chains support ${symbol}. Add ${symbol} on a chain in admin.`);
        }
      } else {
        setAvailableChains([]);
        setChainsError(result.error?.message || 'Could not load chains for this asset.');
      }
    } catch (error) {
      console.error('Failed to fetch chains for asset:', error);
      setAvailableChains([]);
      setChainsError('Network error. Try again.');
    } finally {
      setChainsLoading(false);
    }
  };

  const fetchDepositAddress = async (chainId: string) => {
    if (!accessToken) {
      setAddressError('Please sign in to see your deposit address.');
      return;
    }
    try {
      setAddressLoading(true);
      setDepositAddress(null);
      setAddressError(null);
      setShowKycModal(false);
      // Use centralized api client: 401 triggers token refresh and retry automatically
      const result = await api.get<DepositAddress>(`/api/v1/wallet/deposit-address/${chainId}`);
      if (result.success && result.data?.address) {
        setDepositAddress(result.data);
        setAddressError(null);
        setShowKycModal(false);
      } else if (result.error?.code === 'KYC_REQUIRED') {
        setDepositAddress(null);
        setAddressError('Complete identity verification (KYC) to view your deposit address.');
        setShowKycModal(true);
      } else if (result.error?.code === 'SESSION_EXPIRED' || result.error?.code === 'INVALID_TOKEN') {
        setDepositAddress(null);
        setAddressError('Session expired. Please sign in again.');
        router.push('/login');
      } else {
        setDepositAddress(null);
        const detail = (result.error as { detail?: string } | undefined)?.detail;
        setAddressError(detail || result.error?.message || 'Could not load address. Try again.');
      }
    } catch (error) {
      setDepositAddress(null);
      setAddressError('Network error. Check backend and try again.');
      console.error('Failed to fetch deposit address:', error);
    } finally {
      setAddressLoading(false);
    }
  };

  const fetchRecentDeposits = async () => {
    if (!accessToken) return;
    setRecentDepositsLoading(true);
    try {
      const result = await api.get<Array<{
        id: string;
        symbol?: string;
        chainName?: string;
        amount?: string;
        txHash?: string;
        explorerUrl?: string;
        fromAddress?: string;
        toAddress?: string;
        confirmations?: number;
        requiredConfirmations?: number;
        status?: string;
        createdAt?: string;
        created_at?: string;
      }>>('/api/v1/wallet/deposit-history?limit=10');
      if (result.success && Array.isArray(result.data)) {
        const mapped: Deposit[] = result.data.map((d) => ({
          id: d.id,
          symbol: d.symbol || 'Unknown',
          chain_name: d.chainName || 'Unknown',
          amount: d.amount || '0',
          tx_hash: d.txHash,
          explorer_url: d.explorerUrl,
          to_address: d.fromAddress || d.toAddress || '', // show sender address
          confirmations: d.confirmations ?? 0,
          required_confirmations: d.requiredConfirmations ?? 25,
          status: d.status || 'pending',
          created_at: d.createdAt || d.created_at || '',
        }));
        setRecentDeposits(mapped);
      } else {
        setRecentDeposits([]);
      }
    } catch (error) {
      console.error('Failed to fetch deposits:', error);
      setRecentDeposits([]);
    } finally {
      setRecentDepositsLoading(false);
    }
  };

  const copyAddress = () => {
    if (depositAddress?.address) {
      navigator.clipboard.writeText(depositAddress.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const selectToken = (token: Token) => {
    setSelectedToken(token);
    setShowTokenDropdown(false);
    setTokenSearch('');
  };

  const selectChain = (chain: Chain) => {
    setSelectedChain(chain);
    setShowChainDropdown(false);
    setDepositAddress(null);
    // useEffect will handle fetching deposit address
  };

  const filteredTokens = tokens.filter(t => 
    t.symbol.toLowerCase().includes(tokenSearch.toLowerCase()) ||
    t.name.toLowerCase().includes(tokenSearch.toLowerCase())
  );

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'text-green-500';
      case 'confirming': return 'text-yellow-500';
      case 'pending': return 'text-blue-500';
      case 'failed': return 'text-red-500';
      default: return 'text-gray-500';
    }
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
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Deposit Crypto</h1>
            <Link
              href="/dashboard/deposit/fiat"
              className="flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-[#1e2329] border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 rounded-xl hover:border-blue-300 dark:hover:border-blue-600 transition-colors text-sm font-medium"
            >
              <span className="text-yellow-500">💰</span>
              Fiat Deposit
            </Link>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Section - Deposit Form */}
            <div className="lg:col-span-2">
              <div className="bg-white dark:bg-[#1e2329] rounded-2xl p-6 border border-gray-100 dark:border-gray-800">
              {/* Step 1: Choose Coin */}
              <div className="mb-6">
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-6 h-6 rounded-full bg-blue-500 text-white text-sm flex items-center justify-center font-medium">1</span>
                  <span className="font-medium text-gray-900 dark:text-white">Choose coin to deposit</span>
                </div>

                {/* Token Dropdown */}
                <div className="relative mb-4">
                  <button
                    onClick={() => setShowTokenDropdown(!showTokenDropdown)}
                    className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-[#0b0e11] border border-gray-200 dark:border-gray-700 rounded-lg text-left hover:border-blue-500 dark:hover:border-blue-500 transition-colors"
                  >
                    {selectedToken ? (
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full overflow-hidden bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                          <Image
                            src={getTokenIcon(selectedToken.symbol)}
                            alt={selectedToken.symbol}
                            width={32}
                            height={32}
                            className="object-contain"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                            }}
                          />
                        </div>
                        <div>
                          <span className="font-medium text-gray-900 dark:text-white">{selectedToken.symbol}</span>
                          <span className="text-sm text-gray-500 ml-2">{selectedToken.name}</span>
                        </div>
                      </div>
                    ) : (
                      <span className="text-gray-400">Please Select</span>
                    )}
                    <ChevronDown className={`w-5 h-5 text-gray-400 transition-transform ${showTokenDropdown ? 'rotate-180' : ''}`} />
                  </button>

                  {showTokenDropdown && (
                    <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white dark:bg-[#1e2026] border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl max-h-96 overflow-hidden">
                      {/* Search */}
                      <div className="p-3 border-b border-gray-200 dark:border-gray-700">
                        <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-[#0b0e11] rounded-lg">
                          <Search className="w-4 h-4 text-gray-400" />
                          <input
                            type="text"
                            value={tokenSearch}
                            onChange={(e) => setTokenSearch(e.target.value)}
                            placeholder="Search coin"
                            className="flex-1 bg-transparent text-sm text-gray-900 dark:text-white placeholder-gray-400 outline-none"
                            autoFocus
                          />
                        </div>
                      </div>
                      
                      {/* Token List */}
                      <div className="max-h-72 overflow-y-auto">
                        {loading ? (
                          <div className="flex justify-center py-8">
                            <RefreshCw className="w-6 h-6 text-blue-500 animate-spin" />
                          </div>
                        ) : filteredTokens.length > 0 ? (
                          filteredTokens.map((token) => (
                            <button
                              key={token.id}
                              onClick={() => selectToken(token)}
                              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                            >
                              <div className="w-8 h-8 rounded-full overflow-hidden bg-gray-200 dark:bg-gray-700 flex items-center justify-center flex-shrink-0">
                                <Image
                                  src={getTokenIcon(token.symbol)}
                                  alt={token.symbol}
                                  width={32}
                                  height={32}
                                  className="object-contain"
                                  onError={(e) => {
                                    (e.target as HTMLImageElement).style.display = 'none';
                                  }}
                                />
                              </div>
                              <div className="flex-1 text-left">
                                <p className="font-medium text-gray-900 dark:text-white">{token.symbol}</p>
                                <p className="text-xs text-gray-500">{token.name}</p>
                              </div>
                            </button>
                          ))
                        ) : (
                          <div className="py-8 text-center text-gray-400">No tokens found</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Popular Tokens */}
                <div className="flex flex-wrap gap-2">
                  {POPULAR_TOKENS.map((symbol) => {
                    const token = tokens.find(t => t.symbol.toUpperCase() === symbol);
                    if (!token) return null;
                    return (
                      <button
                        key={symbol}
                        onClick={() => selectToken(token)}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-full border transition-colors ${
                          selectedToken?.symbol.toUpperCase() === symbol
                            ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-500 text-blue-600 dark:text-blue-400'
                            : 'bg-white dark:bg-[#0b0e11] border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-blue-500 dark:hover:border-blue-500'
                        }`}
                      >
                        <div className="w-5 h-5 rounded-full overflow-hidden bg-gray-200 dark:bg-gray-700">
                          <Image
                            src={getTokenIcon(symbol)}
                            alt={symbol}
                            width={20}
                            height={20}
                            className="object-contain"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                            }}
                          />
                        </div>
                        <span className="text-sm font-medium">{symbol}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Step 2: Choose Chain (filtered by selected asset) */}
              <div className="mb-6">
                <div className="flex items-center gap-2 mb-3">
                  <span className={`w-6 h-6 rounded-full text-white text-sm flex items-center justify-center font-medium ${selectedToken ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}>2</span>
                  <span className={`font-medium ${selectedToken ? 'text-gray-900 dark:text-white' : 'text-gray-400'}`}>Choose a Chain</span>
                </div>
                {selectedToken && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Chains that support {selectedToken.symbol}</p>
                )}

                <div className="relative">
                  <button
                    onClick={() => selectedToken && setShowChainDropdown(!showChainDropdown)}
                    disabled={!selectedToken}
                    className={`w-full flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-[#0b0e11] border border-gray-200 dark:border-gray-700 rounded-lg text-left ${
                      !selectedToken ? 'opacity-50 cursor-not-allowed' : 'hover:border-blue-500 dark:hover:border-blue-500'
                    } transition-colors`}
                  >
                    {selectedChain ? (
                      <div className="flex items-center gap-3">
                        <div className="w-6 h-6 rounded-full overflow-hidden bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                          <Image
                            src={getChainIcon(selectedChain)}
                            alt={selectedChain.name}
                            width={24}
                            height={24}
                            className="object-contain"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                            }}
                          />
                        </div>
                        <span className="font-medium text-gray-900 dark:text-white">{selectedChain.name}</span>
                      </div>
                    ) : (
                      <span className="text-gray-400">Select chain</span>
                    )}
                    <ChevronDown className={`w-5 h-5 text-gray-400 transition-transform ${showChainDropdown ? 'rotate-180' : ''}`} />
                  </button>

                  {showChainDropdown && (
                    <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white dark:bg-[#1e2026] border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl overflow-hidden">
                      {chainsLoading ? (
                        <div className="flex justify-center py-6">
                          <RefreshCw className="w-5 h-5 text-blue-500 animate-spin" />
                        </div>
                      ) : chainsError ? (
                        <div className="py-6 px-4 text-center">
                          <p className="text-amber-600 dark:text-amber-400 text-sm mb-1">No chains available</p>
                          <p className="text-gray-500 dark:text-gray-400 text-xs">{chainsError}</p>
                        </div>
                      ) : availableChains.length > 0 ? (
                        availableChains.map((chain) => (
                          <button
                            key={chain.id}
                            onClick={() => selectChain(chain)}
                            className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-6 h-6 rounded-full overflow-hidden bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                                <Image
                                  src={getChainIcon(chain)}
                                  alt={chain.name}
                                  width={24}
                                  height={24}
                                  className="object-contain"
                                  onError={(e) => {
                                    (e.target as HTMLImageElement).style.display = 'none';
                                  }}
                                />
                              </div>
                              <span className="font-medium text-gray-900 dark:text-white">{chain.name}</span>
                              {chain.type === 'evm' && (
                                <span className="text-xs px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded">EVM</span>
                              )}
                            </div>
                            <span className="text-xs text-gray-500">{chain.confirmations_required} block confirms</span>
                          </button>
                        ))
                      ) : (
                        <div className="py-6 text-center text-gray-400">No chains available. Run backend migrations if the database is empty.</div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Step 3: Confirm Deposit Details */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className={`w-6 h-6 rounded-full text-white text-sm flex items-center justify-center font-medium ${selectedChain ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}>3</span>
                  <span className={`font-medium ${selectedChain ? 'text-gray-900 dark:text-white' : 'text-gray-400'}`}>Confirm deposit details</span>
                </div>

                {addressLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <RefreshCw className="w-6 h-6 text-blue-500 animate-spin" />
                  </div>
                ) : addressError ? (
                  <div className="rounded-lg p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                    <p className="text-amber-800 dark:text-amber-200 text-sm">{addressError}</p>
                    <button
                      type="button"
                      onClick={() => selectedChain && fetchDepositAddress(selectedChain.id)}
                      className="mt-3 text-sm font-medium text-amber-600 dark:text-amber-400 hover:underline"
                    >
                      Retry
                    </button>
                  </div>
                ) : depositAddress ? (
                  <div className="bg-gray-50 dark:bg-[#0b0e11] rounded-lg p-4">
                    {/* QR Code */}
                    <div className="flex justify-center mb-4">
                      <div className="w-40 h-40 bg-white p-3 rounded-lg flex items-center justify-center">
                        <QRCodeSVG 
                          value={depositAddress.address}
                          size={130}
                          level="H"
                          includeMargin={false}
                          bgColor="#FFFFFF"
                          fgColor="#000000"
                        />
                      </div>
                    </div>

                    {/* Address */}
                    <div className="mb-4">
                      <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">Deposit Address</p>
                      <div className="flex items-center gap-2 bg-white dark:bg-[#181a20] rounded-lg p-3 border border-gray-200 dark:border-gray-700">
                        <span className="flex-1 text-sm font-mono text-gray-900 dark:text-white break-all">
                          {depositAddress.address}
                        </span>
                        <button
                          onClick={copyAddress}
                          className="flex-shrink-0 p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                        >
                          {copied ? (
                            <Check className="w-5 h-5 text-green-500" />
                          ) : (
                            <Copy className="w-5 h-5 text-gray-400" />
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Notice */}
                    <div className="flex items-start gap-2 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                      <AlertTriangle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
                      <div className="text-sm text-yellow-800 dark:text-yellow-200">
                        <p className="font-medium mb-1">Important</p>
                        <p>{depositAddress.notice}</p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-400">
                    {selectedChain ? 'Loading deposit address…' : 'Select a coin and chain to see the deposit address'}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right Section - FAQ */}
          <div className="lg:col-span-1">
            <div className="bg-white dark:bg-[#181a20] rounded-xl p-6 border border-gray-200 dark:border-transparent">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">FAQ</h3>
              
              <ul className="space-y-3">
                <li>
                  <Link href="#" className="text-sm text-gray-600 dark:text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 flex items-start gap-1">
                    <span className="mt-1">•</span>
                    <span>How to Make a Deposit</span>
                  </Link>
                </li>
                <li>
                  <Link href="#" className="text-sm text-gray-600 dark:text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 flex items-start gap-1">
                    <span className="mt-1">•</span>
                    <span>Unsupported Deposit Recovery Procedure Rules</span>
                  </Link>
                </li>
                <li>
                  <Link href="#" className="text-sm text-gray-600 dark:text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 flex items-start gap-1">
                    <span className="mt-1">•</span>
                    <span>FAQ — Crypto Deposit</span>
                  </Link>
                </li>
                <li>
                  <Link href="#" className="text-sm text-gray-600 dark:text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 flex items-start gap-1">
                    <span className="mt-1">•</span>
                    <span>How to Recover a Deposit with Wrong or Missing Tag/Memo</span>
                  </Link>
                </li>
                <li>
                  <Link href="#" className="text-sm text-blue-500 hover:text-blue-600 flex items-start gap-1">
                    <span className="mt-1">•</span>
                    <span>Deposits yet to be credited? <span className="text-yellow-500">Self-Service →</span></span>
                  </Link>
                </li>
                <li>
                  <Link href="#" className="text-sm text-blue-500 hover:text-blue-600 flex items-start gap-1">
                    <span className="mt-1">•</span>
                    <span>Deposit/Withdrawal Status of All Coins <span className="text-yellow-500">Find Out →</span></span>
                  </Link>
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* Recent Deposits */}
        <div className="mt-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Recent Deposits</h2>
            <button
              onClick={fetchRecentDeposits}
              disabled={recentDepositsLoading}
              className="text-sm text-blue-500 hover:text-blue-600 flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCw className={`w-4 h-4 ${recentDepositsLoading ? 'animate-spin' : ''}`} />
              {recentDepositsLoading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>

          <div className="bg-white dark:bg-[#181a20] rounded-xl border border-gray-200 dark:border-transparent overflow-hidden">
            {/* Table Header */}
            <div className="grid grid-cols-7 gap-4 px-4 py-3 bg-gray-50 dark:bg-[#0b0e11] border-b border-gray-200 dark:border-gray-800 text-sm text-gray-500 dark:text-gray-400">
              <span>Coin</span>
              <span>Chain Type</span>
              <span>Qty</span>
              <span>Address</span>
              <span>Txid</span>
              <span className="flex items-center gap-1">
                Status <Info className="w-3 h-3" />
              </span>
              <span>Date & Time</span>
            </div>

            {/* Table Body */}
            {recentDeposits.length > 0 ? (
              <div className="divide-y divide-gray-200 dark:divide-gray-800">
                {recentDeposits.map((deposit) => (
                  <div key={deposit.id} className="grid grid-cols-7 gap-4 px-4 py-3 text-sm">
                    <span className="text-gray-900 dark:text-white font-medium">{deposit.symbol}</span>
                    <span className="text-gray-600 dark:text-gray-400">{deposit.chain_name}</span>
                    <span className="text-gray-900 dark:text-white">{deposit.amount}</span>
                    <span className="text-gray-600 dark:text-gray-400 truncate">
                      {deposit.to_address.slice(0, 8)}...{deposit.to_address.slice(-6)}
                    </span>
                    <span className="text-gray-600 dark:text-gray-400">
                      {deposit.tx_hash ? (
                        deposit.explorer_url ? (
                          <a href={deposit.explorer_url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline truncate block">
                            {deposit.tx_hash.slice(0, 8)}...
                          </a>
                        ) : (
                          <span className="truncate block">{deposit.tx_hash.slice(0, 8)}...</span>
                        )
                      ) : '-'}
                    </span>
                    <span className={getStatusColor(deposit.status)}>
                      {(deposit.status === 'confirming' || deposit.status === 'pending') && deposit.required_confirmations
                        ? `${deposit.confirmations}/${deposit.required_confirmations} Confirmations`
                        : deposit.status}
                    </span>
                    <span className="text-gray-600 dark:text-gray-400">
                      {new Date(deposit.created_at).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-16">
                <div className="w-20 h-20 mb-4 flex items-center justify-center">
                  <div className="text-6xl">📋</div>
                </div>
                <p className="text-gray-400">No records found</p>
              </div>
            )}
          </div>

          {recentDeposits.length > 0 && (
            <Link
              href="/dashboard/assets/history?tab=deposit"
              className="inline-flex items-center gap-1 mt-4 text-sm text-yellow-500 hover:text-yellow-600"
            >
              View More <ExternalLink className="w-4 h-4" />
            </Link>
          )}
        </div>
        </main>
      </div>

      {/* Help Button */}
      <button className="fixed bottom-6 right-6 w-12 h-12 bg-blue-500 hover:bg-blue-600 text-white rounded-full shadow-lg flex items-center justify-center transition-colors z-40">
        <HelpCircle className="w-6 h-6" />
      </button>

      {/* KYC Verification Modal */}
      {showKycModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-[#1e2026] rounded-2xl w-full max-w-md mx-4 overflow-hidden shadow-2xl">
            {/* Modal Header */}
            <div className="flex justify-end p-4">
              <button
                onClick={() => setShowKycModal(false)}
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="px-8 pb-8 text-center">
              {/* Icon */}
              <div className="w-20 h-20 mx-auto mb-6 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center">
                <Shield className="w-10 h-10 text-blue-500" />
              </div>

              {/* Title */}
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
                Identity Verification Required
              </h2>

              {/* Description */}
              <p className="text-gray-500 dark:text-gray-400 mb-2">
                To comply with regulatory requirements, please take three (3) minutes to complete your identity verification.
              </p>
              <Link href="/dashboard/identity" className="text-blue-500 hover:text-blue-600 text-sm">
                Why does this matter?
              </Link>

              {/* Requirements */}
              <div className="mt-6 mb-6 text-left bg-gray-50 dark:bg-[#0b0e11] rounded-lg p-4">
                <ul className="space-y-3">
                  <li className="flex items-center gap-3 text-gray-700 dark:text-gray-300">
                    <Upload className="w-5 h-5 text-blue-500" />
                    <span>Upload ID card</span>
                  </li>
                  <li className="flex items-center gap-3 text-gray-700 dark:text-gray-300">
                    <Camera className="w-5 h-5 text-blue-500" />
                    <span>Upload a Selfie</span>
                  </li>
                </ul>
              </div>

              {/* CTA Button */}
              <Link
                href="/dashboard/identity"
                className="block w-full py-3 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-lg transition-colors"
                onClick={() => setShowKycModal(false)}
              >
                Verify Identity
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
