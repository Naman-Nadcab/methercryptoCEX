'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '@/store/auth';
import Image from 'next/image';
import Link from 'next/link';
import { 
  ArrowUpDown, 
  ChevronDown, 
  RefreshCw, 
  History, 
  TrendingUp, 
  HelpCircle,
  Search,
  X,
  Clock,
  Check,
  AlertCircle,
  Loader2,
  LayoutGrid,
  Wallet,
  ChevronRight,
  Download,
  Upload,
  ArrowLeftRight,
  Send,
} from 'lucide-react';
interface Currency {
  id: string;
  symbol: string;
  name: string;
  logo_url: string;
  decimals: number;
}

interface MarketPrice {
  base_symbol: string;
  base_name: string;
  base_logo: string;
  quote_symbol: string;
  price: string;
  change_24h_percent: string;
}

interface Balance {
  currency_id: string;
  symbol: string;
  name: string;
  logo_url: string;
  available_balance: string;
}

interface ActiveOrder {
  id: string;
  from_symbol: string;
  from_logo: string;
  from_amount: string;
  to_symbol: string;
  to_logo: string;
  to_amount: string;
  conversion_rate: string;
  target_rate: string;
  expires_at: string;
  created_at: string;
  account_type: string;
  status: string;
}

interface ConversionHistory {
  id: string;
  conversion_type: string;
  from_symbol: string;
  from_logo: string;
  from_amount: string;
  to_symbol: string;
  to_logo: string;
  to_amount: string;
  conversion_rate: string;
  status: string;
  created_at: string;
  completed_at: string;
}

const FAQ_ITEMS = [
  {
    question: "What is Methereum Convert and how does it work?",
    answer: "Methereum Convert allows you to instantly swap one cryptocurrency for another at the current market rate, or set a limit order to convert when your target rate is reached."
  },
  {
    question: "How is Methereum Convert different from Spot trading?",
    answer: "Convert provides a simpler one-click swap experience without complex order books. Spot trading offers more control with limit orders, market orders, and advanced trading features."
  },
  {
    question: "Does Methereum Convert charge any fees?",
    answer: "Methereum Convert offers zero trading fees on all conversions. The rate you see is the rate you get."
  },
  {
    question: "Where do my converted assets go?",
    answer: "Converted assets are deposited into the same account type (Funding or Trading) that you selected for the conversion."
  },
  {
    question: "Why is the rate different from the Spot market price?",
    answer: "The Convert rate is derived from real-time market data and may include a small spread to ensure instant execution."
  },
  {
    question: "What are the minimum and maximum amounts I can convert?",
    answer: "Minimum amounts vary by cryptocurrency. There are no maximum limits for most coins, subject to your available balance."
  },
  {
    question: "What if my conversion doesn't go through?",
    answer: "If an instant conversion fails, your funds remain in your account. For limit orders, you can cancel at any time to retrieve your locked funds."
  },
  {
    question: "Can I use Convert on the Methereum App?",
    answer: "Yes, Convert is available on both the web platform and mobile app with the same features and rates."
  }
];

export default function ConvertPage() {
  const { accessToken, _hasHydrated } = useAuthStore();
  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

  // Tab state
  const [activeTab, setActiveTab] = useState<'instant' | 'limit'>('instant');
  
  // Data states
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [marketPrices, setMarketPrices] = useState<MarketPrice[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [activeOrders, setActiveOrders] = useState<ActiveOrder[]>([]);
  
  // Form states
  const [fromCurrency, setFromCurrency] = useState<Currency | null>(null);
  const [toCurrency, setToCurrency] = useState<Currency | null>(null);
  const [fromAmount, setFromAmount] = useState('');
  const [toAmount, setToAmount] = useState('');
  const [conversionRate, setConversionRate] = useState<number | null>(null);
  const [targetRate, setTargetRate] = useState('');
  const [accountType, setAccountType] = useState<'funding' | 'trading'>('funding');
  
  // UI states
  const [showFromDropdown, setShowFromDropdown] = useState(false);
  const [showToDropdown, setShowToDropdown] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [converting, setConverting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<ConversionHistory[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Fetch initial data
  useEffect(() => {
    fetchCurrencies();
    fetchMarketPrices();
  }, []);

  useEffect(() => {
    if (_hasHydrated && accessToken) {
      fetchBalances();
      fetchActiveOrders();
    }
  }, [_hasHydrated, accessToken, accountType]);

  // Fetch quote when currencies or amount changes
  useEffect(() => {
    if (fromCurrency && toCurrency && fromAmount && parseFloat(fromAmount) > 0) {
      fetchQuote();
    } else {
      setToAmount('');
      setConversionRate(null);
    }
  }, [fromCurrency, toCurrency, fromAmount]);

  const fetchCurrencies = async () => {
    try {
      const response = await fetch(`${API_URL}/api/v1/convert/currencies`);
      const data = await response.json();
      if (data.success) {
        setCurrencies(data.data);
        const btc = data.data.find((c: Currency) => c.symbol.toUpperCase() === 'BTC');
        const usdt = data.data.find((c: Currency) => c.symbol.toUpperCase() === 'USDT');
        if (btc) setFromCurrency(btc);
        if (usdt) setToCurrency(usdt);
      }
    } catch (err) {
      console.error('Error fetching currencies:', err);
    }
  };

  const fetchMarketPrices = async () => {
    try {
      const response = await fetch(`${API_URL}/api/v1/convert/market-prices`);
      const data = await response.json();
      if (data.success) {
        setMarketPrices(data.data);
      }
    } catch (err) {
      console.error('Error fetching market prices:', err);
    }
  };

  const fetchBalances = async () => {
    try {
      const response = await fetch(`${API_URL}/api/v1/convert/balances?accountType=${accountType}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const data = await response.json();
      if (data.success) {
        setBalances(Array.isArray(data.data) ? data.data : []);
      }
    } catch (err) {
      console.error('Error fetching balances:', err);
    }
  };

  const fetchActiveOrders = async () => {
    try {
      const response = await fetch(`${API_URL}/api/v1/convert/orders/active`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const data = await response.json();
      if (data.success) {
        setActiveOrders(data.data);
      }
    } catch (err) {
      console.error('Error fetching active orders:', err);
    }
  };

  const fetchQuote = useCallback(async () => {
    if (!fromCurrency || !toCurrency) return;
    
    setQuoteLoading(true);
    try {
      const response = await fetch(
        `${API_URL}/api/v1/convert/quote?from=${fromCurrency.symbol}&to=${toCurrency.symbol}&amount=${fromAmount}`
      );
      const data = await response.json();
      if (data.success) {
        setToAmount(parseFloat(data.data.to.amount).toFixed(6));
        setConversionRate(parseFloat(data.data.rate));
        if (activeTab === 'limit' && !targetRate) {
          setTargetRate(parseFloat(data.data.rate).toFixed(2));
        }
      }
    } catch (err) {
      console.error('Error fetching quote:', err);
    } finally {
      setQuoteLoading(false);
    }
  }, [fromCurrency, toCurrency, fromAmount, API_URL, activeTab, targetRate]);

  const fetchHistory = async () => {
    setHistoryLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/v1/convert/history?limit=20`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const data = await response.json();
      if (data.success) {
        setHistory(data.data);
      }
    } catch (err) {
      console.error('Error fetching history:', err);
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleSwapCurrencies = () => {
    const temp = fromCurrency;
    setFromCurrency(toCurrency);
    setToCurrency(temp);
    setFromAmount(toAmount);
    setToAmount('');
  };

  const handleSetMax = () => {
    if (fromCurrency) {
      const bal = getAvailableBalance();
      setFromAmount(bal);
    }
  };

  const handleConvert = async () => {
    if (!fromCurrency || !toCurrency || !fromAmount) {
      setError('Please fill in all fields');
      return;
    }

    if (!accessToken) {
      setError('Please login to convert');
      return;
    }

    setConverting(true);
    setError('');
    setSuccess('');

    try {
      const endpoint = activeTab === 'instant' ? '/api/v1/convert/instant' : '/api/v1/convert/limit';
      const body: any = {
        fromCurrencyId: fromCurrency.id,
        toCurrencyId: toCurrency.id,
        fromAmount,
        accountType
      };

      if (activeTab === 'limit') {
        body.targetRate = targetRate;
        body.expiresInDays = 30;
      }

      const response = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify(body)
      });

      const data = await response.json();

      if (data.success) {
        setSuccess(
          activeTab === 'instant'
            ? `Successfully converted ${fromAmount} ${fromCurrency.symbol} to ${data.data.to.amount} ${toCurrency.symbol}`
            : `Limit order placed successfully. Your order will execute when the rate reaches ${targetRate}`
        );
        setFromAmount('');
        setToAmount('');
        fetchBalances();
        if (activeTab === 'limit') {
          fetchActiveOrders();
        }
      } else {
        setError(data.error || 'Conversion failed');
      }
    } catch (err) {
      setError('Failed to process conversion');
    } finally {
      setConverting(false);
    }
  };

  const handleCancelOrder = async (orderId: string) => {
    try {
      const response = await fetch(`${API_URL}/api/v1/convert/limit/${orderId}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      const data = await response.json();
      if (data.success) {
        fetchActiveOrders();
        fetchBalances();
      }
    } catch (err) {
      console.error('Error cancelling order:', err);
    }
  };

  const getAvailableBalance = (): string => {
    if (!fromCurrency || !Array.isArray(balances)) return '0';
    const balance = balances.find(b => b?.currency_id === fromCurrency.id);
    return balance?.available_balance ?? '0';
  };

  const filteredCurrencies = currencies.filter(c => 
    c.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const trendingPrices = marketPrices.slice(0, 6);
  const newlyListedPrices = marketPrices.slice(6, 12);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#0b0e11]">
      <div className="flex">
        {/* Sidebar */}
        <aside className="w-60 min-h-screen bg-white dark:bg-[#181a20] border-r border-gray-200 dark:border-gray-800">
          <nav className="p-4 space-y-1">
            <Link
              href="/dashboard/assets/overview"
              className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded-xl transition-colors"
            >
              <LayoutGrid className="w-5 h-5" />
              Asset Dashboard
            </Link>
            <Link
              href="/dashboard/deposit/crypto"
              className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded-xl transition-colors"
            >
              <TrendingUp className="w-5 h-5" />
              Deposit
            </Link>
            <Link
              href="/dashboard/withdraw/crypto"
              className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded-xl transition-colors"
            >
              <Send className="w-5 h-5" />
              Withdraw
            </Link>
            <Link
              href="/dashboard/transfer"
              className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded-xl transition-colors"
            >
              <ArrowLeftRight className="w-5 h-5" />
              Transfer
            </Link>
            <Link
              href="/dashboard/assets/convert"
              className="flex items-center gap-3 px-4 py-3 text-sm font-medium bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 text-blue-600 dark:text-blue-400 rounded-xl border border-blue-100 dark:border-blue-800/30"
            >
              <RefreshCw className="w-5 h-5" />
              Convert
            </Link>
            <Link
              href="/dashboard/assets/history"
              className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded-xl transition-colors"
            >
              <Clock className="w-5 h-5" />
              History
            </Link>
          </nav>
        </aside>

        {/* Main Content */}
        <main className="flex-1 p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Convert</h1>
              <p className="text-sm text-gray-500 mt-1">Zero fees | Real-time swap | Multi-asset support</p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => { setShowHistory(true); fetchHistory(); }}
                className="flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-[#1e2329] text-gray-700 dark:text-gray-300 font-medium text-sm rounded-xl border border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600 transition-colors"
              >
                <History className="w-4 h-4" />
                History
              </button>
              <Link
                href="/dashboard/deposit/crypto"
                className="flex items-center gap-2 px-5 py-2.5 bg-blue-500 hover:bg-blue-600 text-white font-medium text-sm rounded-xl shadow-lg shadow-blue-500/25 transition-all hover:shadow-blue-500/40"
              >
                <Download className="w-4 h-4" />
                Deposit
              </Link>
              <Link
                href="/dashboard/transfer"
                className="flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-[#1e2329] text-gray-700 dark:text-gray-300 font-medium text-sm rounded-xl border border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 transition-colors"
              >
                <ArrowLeftRight className="w-4 h-4" />
                Transfer
              </Link>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {/* Left Side - Market Highlights / Chart */}
            <div>
              {activeTab === 'instant' ? (
                <div className="bg-white dark:bg-[#1e2329] rounded-2xl p-6 border border-gray-100 dark:border-gray-800">
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-6">Market highlights</h2>
                  
                  <div className="grid grid-cols-2 gap-8">
                    <div>
                      <p className="text-sm text-gray-500 mb-4">Trending</p>
                      <div className="space-y-3">
                        {trendingPrices.map((item, index) => (
                          <div key={index} className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              {item.base_logo && (
                                <Image src={item.base_logo} alt={item.base_symbol} width={20} height={20} className="rounded-full" unoptimized />
                              )}
                              <span className="text-sm font-medium text-gray-900 dark:text-white">
                                {item.base_symbol}{item.quote_symbol}
                              </span>
                            </div>
                            <span className="text-sm text-gray-600 dark:text-gray-400">
                              {parseFloat(item.price).toLocaleString()}
                            </span>
                            <span className={`text-sm ${parseFloat(item.change_24h_percent) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                              {parseFloat(item.change_24h_percent) >= 0 ? '+' : ''}{parseFloat(item.change_24h_percent).toFixed(2)}%
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div>
                      <p className="text-sm text-gray-500 mb-4">Newly listed</p>
                      <div className="space-y-3">
                        {newlyListedPrices.map((item, index) => (
                          <div key={index} className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              {item.base_logo && (
                                <Image src={item.base_logo} alt={item.base_symbol} width={20} height={20} className="rounded-full" unoptimized />
                              )}
                              <span className="text-sm font-medium text-gray-900 dark:text-white">
                                {item.base_symbol}{item.quote_symbol}
                              </span>
                            </div>
                            <span className="text-sm text-gray-600 dark:text-gray-400">
                              {parseFloat(item.price).toLocaleString()}
                            </span>
                            <span className={`text-sm ${parseFloat(item.change_24h_percent) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                              {parseFloat(item.change_24h_percent) >= 0 ? '+' : ''}{parseFloat(item.change_24h_percent).toFixed(2)}%
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <p className="text-xs text-gray-400 mt-6">
                    ⓘ The market data is for reference only. Final price is based on the executed quote.
                  </p>
                </div>
              ) : (
                <div className="bg-white dark:bg-[#1e2329] rounded-2xl p-6 border border-gray-100 dark:border-gray-800">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      {fromCurrency?.logo_url && toCurrency?.logo_url && (
                        <div className="flex -space-x-2">
                          <Image src={fromCurrency.logo_url} alt={fromCurrency.symbol} width={32} height={32} className="rounded-full border-2 border-white dark:border-[#1e2329]" unoptimized />
                          <Image src={toCurrency.logo_url} alt={toCurrency.symbol} width={32} height={32} className="rounded-full border-2 border-white dark:border-[#1e2329]" unoptimized />
                        </div>
                      )}
                      <span className="text-lg font-semibold text-gray-900 dark:text-white">
                        {fromCurrency?.symbol}/{toCurrency?.symbol}
                      </span>
                    </div>
                    <div className="text-right">
                      <p className="text-xl font-bold text-gray-900 dark:text-white">
                        {conversionRate?.toLocaleString() || '--'}
                      </p>
                      {conversionRate && (
                        <p className="text-sm text-green-500">+0.33%</p>
                      )}
                    </div>
                  </div>

                  <div className="flex gap-2 mb-4">
                    {['24H', '1W', '1M'].map((period) => (
                      <button
                        key={period}
                        className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                          period === '24H' 
                            ? 'bg-blue-500 text-white' 
                            : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'
                        }`}
                      >
                        {period}
                      </button>
                    ))}
                  </div>

                  <div className="h-64 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/10 dark:to-indigo-900/10 rounded-xl flex items-center justify-center">
                    <div className="text-center text-gray-500">
                      <TrendingUp className="w-12 h-12 mx-auto mb-2 opacity-30" />
                      <p className="text-sm">Price chart coming soon</p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Right Side - Conversion Form */}
            <div className="bg-white dark:bg-[#1e2329] rounded-2xl p-6 border border-gray-100 dark:border-gray-800">
              {/* Tab Selector */}
              <div className="flex mb-6 bg-gray-100 dark:bg-[#2b2f36] rounded-xl p-1">
                <button
                  onClick={() => setActiveTab('instant')}
                  className={`flex-1 py-3 text-center font-medium rounded-lg transition-all ${
                    activeTab === 'instant'
                      ? 'bg-white dark:bg-[#1e2329] text-blue-600 dark:text-blue-400 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                  }`}
                >
                  Instant
                </button>
                <button
                  onClick={() => setActiveTab('limit')}
                  className={`flex-1 py-3 text-center font-medium rounded-lg transition-all ${
                    activeTab === 'limit'
                      ? 'bg-white dark:bg-[#1e2329] text-blue-600 dark:text-blue-400 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                  }`}
                >
                  Limit
                </button>
              </div>

              {/* Account Type Selector */}
              <div className="flex items-center gap-2 mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-100 dark:border-blue-800/30">
                <Wallet className="w-4 h-4 text-blue-500" />
                <select
                  value={accountType}
                  onChange={(e) => setAccountType(e.target.value as 'funding' | 'trading')}
                  className="bg-transparent text-sm text-blue-600 dark:text-blue-400 font-medium focus:outline-none cursor-pointer"
                >
                  <option value="funding">Funding</option>
                  <option value="trading">Trading</option>
                </select>
              </div>

              {/* From Currency */}
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">From</span>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-gray-500">Available: {parseFloat(getAvailableBalance()).toFixed(6)} {fromCurrency?.symbol ?? ''}</span>
                    <Link href="/dashboard/deposit/crypto" className="text-blue-500 hover:text-blue-600 font-medium">Deposit</Link>
                    <Link href="/dashboard/transfer" className="text-blue-500 hover:text-blue-600 font-medium">
                      Transfer
                    </Link>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-4 bg-gray-50 dark:bg-[#2b2f36] rounded-xl border border-gray-200 dark:border-gray-700">
                  <div className="relative">
                    <button
                      onClick={() => { setShowFromDropdown(!showFromDropdown); setShowToDropdown(false); }}
                      className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-[#1e2329] rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors border border-gray-200 dark:border-gray-700"
                    >
                      {fromCurrency?.logo_url && (
                        <Image src={fromCurrency.logo_url} alt={fromCurrency.symbol} width={24} height={24} className="rounded-full" unoptimized />
                      )}
                      <span className="font-medium text-gray-900 dark:text-white">{fromCurrency?.symbol || 'Select'}</span>
                      <ChevronDown className="w-4 h-4 text-gray-400" />
                    </button>
                    {fromCurrency && (
                      <p className="text-xs text-gray-500 mt-1 ml-1">{fromCurrency.name}</p>
                    )}

                    {showFromDropdown && (
                      <div className="absolute top-full left-0 mt-2 w-64 bg-white dark:bg-[#1e2329] rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 z-50 overflow-hidden">
                        <div className="p-3 border-b border-gray-200 dark:border-gray-700">
                          <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <input
                              type="text"
                              placeholder="Search coin..."
                              value={searchQuery}
                              onChange={(e) => setSearchQuery(e.target.value)}
                              className="w-full pl-10 pr-4 py-2 bg-gray-50 dark:bg-[#2b2f36] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          </div>
                        </div>
                        <div className="max-h-64 overflow-y-auto">
                          {filteredCurrencies.map((currency) => (
                            <button
                              key={currency.id}
                              onClick={() => {
                                setFromCurrency(currency);
                                setShowFromDropdown(false);
                                setSearchQuery('');
                              }}
                              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                            >
                              {currency.logo_url && (
                                <Image src={currency.logo_url} alt={currency.symbol} width={24} height={24} className="rounded-full" unoptimized />
                              )}
                              <div className="text-left">
                                <p className="font-medium text-gray-900 dark:text-white">{currency.symbol}</p>
                                <p className="text-xs text-gray-500">{currency.name}</p>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  <input
                    type="number"
                    value={fromAmount}
                    onChange={(e) => setFromAmount(e.target.value)}
                    placeholder="0.00"
                    className="flex-1 bg-transparent text-right text-lg font-medium text-gray-900 dark:text-white focus:outline-none"
                  />
                  <button
                    onClick={handleSetMax}
                    className="text-sm text-blue-500 hover:text-blue-600 font-medium"
                  >
                    All
                  </button>
                </div>
              </div>

              {/* Swap Button */}
              <div className="flex justify-center my-3">
                <button
                  onClick={handleSwapCurrencies}
                  className="p-3 rounded-full bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-800/30 transition-colors border border-blue-200 dark:border-blue-700"
                >
                  <ArrowUpDown className="w-5 h-5 text-blue-500" />
                </button>
              </div>

              {/* To Currency */}
              <div className="mb-6">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">To</span>
                </div>
                <div className="flex items-center gap-3 p-4 bg-gray-50 dark:bg-[#2b2f36] rounded-xl border border-gray-200 dark:border-gray-700">
                  <div className="relative">
                    <button
                      onClick={() => { setShowToDropdown(!showToDropdown); setShowFromDropdown(false); }}
                      className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-[#1e2329] rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors border border-gray-200 dark:border-gray-700"
                    >
                      {toCurrency?.logo_url && (
                        <Image src={toCurrency.logo_url} alt={toCurrency.symbol} width={24} height={24} className="rounded-full" unoptimized />
                      )}
                      <span className="font-medium text-gray-900 dark:text-white">{toCurrency?.symbol || 'Select'}</span>
                      <ChevronDown className="w-4 h-4 text-gray-400" />
                    </button>
                    {toCurrency && (
                      <p className="text-xs text-gray-500 mt-1 ml-1">{toCurrency.name}</p>
                    )}

                    {showToDropdown && (
                      <div className="absolute top-full left-0 mt-2 w-64 bg-white dark:bg-[#1e2329] rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 z-50 overflow-hidden">
                        <div className="p-3 border-b border-gray-200 dark:border-gray-700">
                          <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <input
                              type="text"
                              placeholder="Search coin..."
                              value={searchQuery}
                              onChange={(e) => setSearchQuery(e.target.value)}
                              className="w-full pl-10 pr-4 py-2 bg-gray-50 dark:bg-[#2b2f36] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          </div>
                        </div>
                        <div className="max-h-64 overflow-y-auto">
                          {filteredCurrencies.map((currency) => (
                            <button
                              key={currency.id}
                              onClick={() => {
                                setToCurrency(currency);
                                setShowToDropdown(false);
                                setSearchQuery('');
                              }}
                              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                            >
                              {currency.logo_url && (
                                <Image src={currency.logo_url} alt={currency.symbol} width={24} height={24} className="rounded-full" unoptimized />
                              )}
                              <div className="text-left">
                                <p className="font-medium text-gray-900 dark:text-white">{currency.symbol}</p>
                                <p className="text-xs text-gray-500">{currency.name}</p>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  <input
                    type="text"
                    value={quoteLoading ? 'Loading...' : toAmount || '--'}
                    readOnly
                    className="flex-1 bg-transparent text-right text-lg font-medium text-gray-900 dark:text-white focus:outline-none"
                  />
                </div>
              </div>

              {/* Limit Order Price Settings */}
              {activeTab === 'limit' && (
                <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/10 rounded-xl border border-blue-100 dark:border-blue-800/30">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm text-gray-600 dark:text-gray-400">When 1 {fromCurrency?.symbol} is worth</span>
                    <span className="text-xs px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-lg">Expired in 30D</span>
                  </div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm text-gray-600 dark:text-gray-400">{toCurrency?.symbol}</span>
                    <input
                      type="number"
                      value={targetRate}
                      onChange={(e) => setTargetRate(e.target.value)}
                      className="text-right text-xl font-bold text-gray-900 dark:text-white bg-transparent focus:outline-none w-32"
                    />
                  </div>
                  <div className="flex items-center justify-between text-xs text-gray-500 mb-4">
                    <span>Market price {conversionRate?.toLocaleString()}</span>
                  </div>
                  <div className="flex gap-2">
                    {['+1%', '+5%', '+10%', 'Market price'].map((option) => (
                      <button
                        key={option}
                        onClick={() => {
                          if (conversionRate) {
                            if (option === 'Market price') {
                              setTargetRate(conversionRate.toFixed(2));
                            } else {
                              const percent = parseFloat(option) / 100;
                              setTargetRate((conversionRate * (1 + percent)).toFixed(2));
                            }
                          }
                        }}
                        className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                          option === 'Market price' 
                            ? 'bg-blue-500 text-white'
                            : 'bg-white dark:bg-[#1e2329] text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600'
                        }`}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Transaction Info */}
              <div className="space-y-3 mb-6 p-4 bg-gray-50 dark:bg-[#2b2f36] rounded-xl">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">Transaction Fees</span>
                  <span className="text-green-500 font-semibold">0 Fee</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">{activeTab === 'limit' ? 'Receivables' : 'You get'}</span>
                  <span className="text-gray-900 dark:text-white font-semibold">
                    {toAmount ? `${parseFloat(toAmount).toFixed(6)}` : '--'} {toCurrency?.symbol}
                  </span>
                </div>
              </div>

              {/* Error/Success Messages */}
              {error && (
                <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl flex items-center gap-3">
                  <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
                  <span className="text-sm text-red-600 dark:text-red-400">{error}</span>
                </div>
              )}

              {success && (
                <div className="mb-4 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl flex items-center gap-3">
                  <Check className="w-5 h-5 text-green-500 flex-shrink-0" />
                  <span className="text-sm text-green-600 dark:text-green-400">{success}</span>
                </div>
              )}

              {/* Convert Button */}
              <button
                onClick={handleConvert}
                disabled={converting || !fromAmount || !fromCurrency || !toCurrency}
                className="w-full py-4 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-200 dark:disabled:bg-gray-800 disabled:text-gray-400 text-white font-semibold rounded-xl transition-all shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40 disabled:shadow-none flex items-center justify-center gap-2"
              >
                {converting ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Processing...
                  </>
                ) : (
                  activeTab === 'instant' ? 'Get a Quote' : 'Place order'
                )}
              </button>
            </div>
          </div>

          {/* Active Orders (for Limit tab) */}
          {activeTab === 'limit' && (
            <div className="mt-8 bg-white dark:bg-[#1e2329] rounded-2xl p-6 border border-gray-100 dark:border-gray-800">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-6">Active orders</h2>
              
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="text-left text-sm text-gray-500 border-b border-gray-200 dark:border-gray-700">
                      <th className="pb-4 font-medium">From</th>
                      <th className="pb-4 font-medium">Quantity</th>
                      <th className="pb-4 font-medium">To</th>
                      <th className="pb-4 font-medium">Converted to</th>
                      <th className="pb-4 font-medium">Account</th>
                      <th className="pb-4 font-medium">Conversion Rate</th>
                      <th className="pb-4 font-medium">Expired in</th>
                      <th className="pb-4 font-medium">Time</th>
                      <th className="pb-4 font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeOrders.length > 0 ? (
                      activeOrders.map((order) => (
                        <tr key={order.id} className="border-b border-gray-100 dark:border-gray-800">
                          <td className="py-4">
                            <div className="flex items-center gap-2">
                              {order.from_logo && (
                                <Image src={order.from_logo} alt={order.from_symbol} width={20} height={20} className="rounded-full" unoptimized />
                              )}
                              {order.from_symbol}
                            </div>
                          </td>
                          <td className="py-4">{parseFloat(order.from_amount).toFixed(6)}</td>
                          <td className="py-4">
                            <div className="flex items-center gap-2">
                              {order.to_logo && (
                                <Image src={order.to_logo} alt={order.to_symbol} width={20} height={20} className="rounded-full" unoptimized />
                              )}
                              {order.to_symbol}
                            </div>
                          </td>
                          <td className="py-4">{parseFloat(order.to_amount).toFixed(6)}</td>
                          <td className="py-4 capitalize">{order.account_type}</td>
                          <td className="py-4">{parseFloat(order.target_rate).toFixed(2)}</td>
                          <td className="py-4">
                            {Math.ceil((new Date(order.expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24))}D
                          </td>
                          <td className="py-4 text-sm text-gray-500">{new Date(order.created_at).toLocaleString()}</td>
                          <td className="py-4">
                            <button
                              onClick={() => handleCancelOrder(order.id)}
                              className="text-red-500 hover:text-red-600 text-sm font-medium"
                            >
                              Cancel
                            </button>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={9} className="py-16 text-center">
                          <div className="flex flex-col items-center">
                            <div className="w-16 h-16 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mb-4">
                              <History className="w-8 h-8 text-gray-400" />
                            </div>
                            <p className="text-gray-500">No active orders yet</p>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* FAQ Section */}
          <div className="mt-8 bg-white dark:bg-[#1e2329] rounded-2xl p-6 border border-gray-100 dark:border-gray-800">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-6">FAQ</h2>
            
            <div className="space-y-4">
              {FAQ_ITEMS.map((item, index) => (
                <div key={index} className="border-b border-gray-100 dark:border-gray-800 pb-4">
                  <button
                    onClick={() => setExpandedFaq(expandedFaq === index ? null : index)}
                    className="w-full flex items-center justify-between text-left"
                  >
                    <span className="text-gray-900 dark:text-white font-medium">
                      {index + 1}. {item.question}
                    </span>
                    <ChevronDown className={`w-5 h-5 text-gray-400 transition-transform ${expandedFaq === index ? 'rotate-180' : ''}`} />
                  </button>
                  {expandedFaq === index && (
                    <p className="mt-3 text-gray-600 dark:text-gray-400 text-sm pl-4">
                      {item.answer}
                    </p>
                  )}
                </div>
              ))}
            </div>

            <button className="mt-6 text-blue-500 hover:text-blue-600 font-medium flex items-center gap-1">
              View more
              <ChevronDown className="w-4 h-4" />
            </button>
          </div>
        </main>
      </div>

      {/* Conversion History Modal */}
      {showHistory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowHistory(false)} />
          <div className="relative w-full max-w-4xl mx-4 bg-white dark:bg-[#1e2329] rounded-2xl shadow-2xl overflow-hidden max-h-[80vh]">
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Conversion History</h2>
              <button onClick={() => setShowHistory(false)} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto max-h-[60vh]">
              {historyLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
                </div>
              ) : history.length > 0 ? (
                <table className="w-full">
                  <thead>
                    <tr className="text-left text-sm text-gray-500 border-b border-gray-200 dark:border-gray-700">
                      <th className="pb-4">Type</th>
                      <th className="pb-4">From</th>
                      <th className="pb-4">To</th>
                      <th className="pb-4">Rate</th>
                      <th className="pb-4">Status</th>
                      <th className="pb-4">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((item) => (
                      <tr key={item.id} className="border-b border-gray-100 dark:border-gray-800">
                        <td className="py-4 capitalize">{item.conversion_type}</td>
                        <td className="py-4">
                          <div className="flex items-center gap-2">
                            {item.from_logo && (
                              <Image src={item.from_logo} alt={item.from_symbol} width={20} height={20} className="rounded-full" unoptimized />
                            )}
                            {parseFloat(item.from_amount).toFixed(6)} {item.from_symbol}
                          </div>
                        </td>
                        <td className="py-4">
                          <div className="flex items-center gap-2">
                            {item.to_logo && (
                              <Image src={item.to_logo} alt={item.to_symbol} width={20} height={20} className="rounded-full" unoptimized />
                            )}
                            {parseFloat(item.to_amount || '0').toFixed(6)} {item.to_symbol}
                          </div>
                        </td>
                        <td className="py-4">{parseFloat(item.conversion_rate).toFixed(2)}</td>
                        <td className="py-4">
                          <span className={`px-2 py-1 rounded text-xs font-medium ${
                            item.status === 'completed' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                            item.status === 'pending' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' :
                            item.status === 'cancelled' ? 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400' :
                            'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                          }`}>
                            {item.status}
                          </span>
                        </td>
                        <td className="py-4 text-sm text-gray-500">
                          {new Date(item.created_at).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="text-center py-12">
                  <History className="w-12 h-12 mx-auto text-gray-300 mb-4" />
                  <p className="text-gray-500">No conversion history yet</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
