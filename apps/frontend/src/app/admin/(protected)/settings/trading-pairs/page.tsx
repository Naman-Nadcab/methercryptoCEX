'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { toast as toastNotify } from '@/components/ui/toaster';
import { 
  TrendingUp, Plus, Edit2, Trash2, Search, Loader2, Save, 
  AlertCircle, Check, X, ChevronDown, Link2, Coins, ArrowRightLeft
} from 'lucide-react';

interface QuoteAsset {
  id: string;
  currency_id: string;
  display_order: number;
  is_active: boolean;
  min_price_increment: string;
  symbol: string;
  name: string;
  logo_url: string | null;
  currency_type: string;
  pair_count: string;
}

interface TradingPair {
  id: string;
  base_currency_id: string;
  quote_currency_id: string;
  symbol: string;
  is_active: boolean;
  min_quantity: string;
  max_quantity: string;
  min_price: string;
  max_price: string;
  price_precision: number;
  quantity_precision: number;
  maker_fee: string;
  taker_fee: string;
  sort_order: number;
  base_symbol: string;
  base_name: string;
  base_logo: string | null;
  quote_symbol: string;
  quote_name: string;
  quote_logo: string | null;
}

interface Currency {
  id: string;
  symbol: string;
  name: string;
  logo_url: string | null;
  currency_type: string;
  chain_name?: string;
  chain_symbol?: string;
}

// Success Modal Info interface
interface CreatedPairInfo {
  symbol: string;
  baseSymbol: string;
  quoteSymbol: string;
  baseLogo: string;
  quoteLogo: string;
}

export default function TradingPairsPage() {
  const { accessToken } = useAdminAuthStore();
  const [quoteAssets, setQuoteAssets] = useState<QuoteAsset[]>([]);
  const [tradingPairs, setTradingPairs] = useState<TradingPair[]>([]);
  const [availableCurrencies, setAvailableCurrencies] = useState<Currency[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedQuote, setSelectedQuote] = useState<string | null>(null);
  const [showAddQuote, setShowAddQuote] = useState(false);
  const [showAddPairs, setShowAddPairs] = useState(false);
  const [editingPair, setEditingPair] = useState<TradingPair | null>(null);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  
  // Infinite scroll pagination state
  const [pairsOffset, setPairsOffset] = useState(0);
  const [pairsHasMore, setPairsHasMore] = useState(true);
  const [pairsTotal, setPairsTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const loadingMoreRef = useRef(false);
  
  // Success Modal State (at parent level to persist across re-renders)
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [successPairs, setSuccessPairs] = useState<CreatedPairInfo[]>([]);
  const [successSkipped, setSuccessSkipped] = useState(0);
  
  // Delete Confirmation Modal State
  const [deleteModal, setDeleteModal] = useState<{
    show: boolean;
    type: 'pair' | 'quote';
    id: string;
    name: string;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);
  
  // Success Toast State
  const [toast, setToast] = useState<{ show: boolean; message: string; type: 'success' | 'error' } | null>(null);

  const apiUrl = getApiBaseUrl();
  
  // Show toast helper
  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ show: true, message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchQuoteAssets = async () => {
    if (!accessToken) return;
    try {
      const response = await fetch(`${apiUrl}/api/v1/admin/settings/quote-assets`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const result = await response.json();
      if (result.success) {
        setQuoteAssets(result.data.quote_assets);
        // Auto-select first quote asset
        if (result.data.quote_assets.length > 0 && !selectedQuote) {
          setSelectedQuote(result.data.quote_assets[0].currency_id);
        }
      }
    } catch (error) {
      console.error('Failed to fetch quote assets:', error);
    }
  };

  const fetchTradingPairs = async (quoteSymbol?: string, reset = true) => {
    if (!accessToken) return;
    try {
      const offset = reset ? 0 : pairsOffset;
      const url = quoteSymbol 
        ? `${apiUrl}/api/v1/admin/settings/trading-pairs?quote_symbol=${quoteSymbol}&limit=20&offset=${offset}`
        : `${apiUrl}/api/v1/admin/settings/trading-pairs?limit=20&offset=${offset}`;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const result = await response.json();
      if (result.success) {
        if (reset) {
          setTradingPairs(result.data.trading_pairs);
          setPairsOffset(result.data.trading_pairs.length);
        } else {
          setTradingPairs(prev => [...prev, ...result.data.trading_pairs]);
          setPairsOffset(prev => prev + result.data.trading_pairs.length);
        }
        setPairsTotal(result.data.total);
        setPairsHasMore(result.data.hasMore);
      }
    } catch (error) {
      console.error('Failed to fetch trading pairs:', error);
    }
  };

  const fetchAvailableCurrencies = async (quoteCurrencyId?: string) => {
    if (!accessToken) return;
    try {
      const url = quoteCurrencyId
        ? `${apiUrl}/api/v1/admin/settings/available-base-currencies?quote_currency_id=${quoteCurrencyId}`
        : `${apiUrl}/api/v1/admin/settings/available-base-currencies`;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const result = await response.json();
      if (result.success) {
        setAvailableCurrencies(result.data.currencies);
      }
    } catch (error) {
      console.error('Failed to fetch currencies:', error);
    }
  };

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      await fetchQuoteAssets();
      await fetchAvailableCurrencies();
      setLoading(false);
    };
    load();
  }, [accessToken]);

  const selectedQuoteAsset = quoteAssets.find(qa => qa.currency_id === selectedQuote);

  useEffect(() => {
    if (selectedQuote && selectedQuoteAsset) {
      // Reset pagination when quote changes
      setPairsOffset(0);
      setPairsHasMore(true);
      fetchTradingPairs(selectedQuoteAsset.symbol, true);
      fetchAvailableCurrencies(selectedQuote);
    }
  }, [selectedQuote, selectedQuoteAsset?.symbol]);

  // Load more pairs function
  const loadMorePairs = useCallback(async () => {
    if (loadingMoreRef.current || !pairsHasMore || !selectedQuoteAsset) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    
    try {
      const url = `${apiUrl}/api/v1/admin/settings/trading-pairs?quote_symbol=${selectedQuoteAsset.symbol}&limit=20&offset=${pairsOffset}`;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const result = await response.json();
      if (result.success) {
        setTradingPairs(prev => [...prev, ...result.data.trading_pairs]);
        setPairsOffset(prev => prev + result.data.trading_pairs.length);
        setPairsHasMore(result.data.hasMore);
        setPairsTotal(result.data.total);
      }
    } catch (error) {
      console.error('Failed to load more pairs:', error);
    } finally {
      setLoadingMore(false);
      loadingMoreRef.current = false;
    }
  }, [pairsOffset, pairsHasMore, selectedQuoteAsset, accessToken, apiUrl]);

  // Infinite scroll listener
  useEffect(() => {
    const container = tableContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      // Load more when user scrolls within 150px of bottom
      if (scrollHeight - scrollTop - clientHeight < 150 && pairsHasMore && !loadingMoreRef.current) {
        loadMorePairs();
      }
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [loadMorePairs, pairsHasMore]);

  // Filter pairs by selected quote symbol (for display, pagination handles the data)
  const filteredPairs = tradingPairs;

  const togglePairStatus = async (id: string) => {
    if (toggling) return;
    setToggling(id);
    try {
      const response = await fetch(`${apiUrl}/api/v1/admin/settings/trading-pairs/${id}/toggle`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const result = await response.json();
      if (result.success) {
        setTradingPairs(prev => prev.map(p => 
          p.id === id ? { ...p, is_active: result.data.trading_pair.is_active } : p
        ));
      }
    } catch (error) {
      console.error('Failed to toggle pair:', error);
    } finally {
      setToggling(null);
    }
  };

  const deletePair = async (id: string) => {
    setDeleting(true);
    try {
      const response = await fetch(`${apiUrl}/api/v1/admin/settings/trading-pairs/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const result = await response.json();
      if (result.success) {
        setTradingPairs(prev => prev.filter(p => p.id !== id));
        fetchQuoteAssets();
        setDeleteModal(null);
        showToast('Trading pair deleted successfully!', 'success');
      } else {
        showToast(result.error?.message || 'Failed to delete', 'error');
      }
    } catch (error) {
      console.error('Failed to delete pair:', error);
      showToast('Failed to delete trading pair', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const deleteQuoteAsset = async (id: string) => {
    setDeleting(true);
    try {
      const response = await fetch(`${apiUrl}/api/v1/admin/settings/quote-assets/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const result = await response.json();
      if (result.success) {
        setQuoteAssets(prev => prev.filter(qa => qa.id !== id));
        if (quoteAssets.length > 1) {
          setSelectedQuote(quoteAssets.find(qa => qa.id !== id)?.currency_id || null);
        } else {
          setSelectedQuote(null);
        }
        setDeleteModal(null);
        showToast('Quote asset removed successfully!', 'success');
      } else {
        showToast(result.error?.message || 'Failed to remove', 'error');
      }
    } catch (error) {
      console.error('Failed to delete quote asset:', error);
      showToast('Failed to remove quote asset', 'error');
    } finally {
      setDeleting(false);
    }
  };

  // Add Quote Asset Modal
  const AddQuoteModal = ({ onClose }: { onClose: () => void }) => {
    const [search, setSearch] = useState('');
    const [selectedCurrency, setSelectedCurrency] = useState<string | null>(null);
    const [filterType, setFilterType] = useState<'all' | 'crypto' | 'stablecoin' | 'fiat'>('all');

    // Filter and deduplicate currencies by symbol (unique symbols only)
    const uniqueCurrencies = useMemo(() => {
      const symbolMap = new Map<string, Currency>();
      
      availableCurrencies.forEach(c => {
        // Skip if already added as quote asset (by symbol)
        if (quoteAssets.some(qa => qa.symbol === c.symbol)) return;
        
        // Keep only one entry per symbol (prefer one with logo)
        const existing = symbolMap.get(c.symbol);
        if (!existing || (c.logo_url && !existing.logo_url)) {
          symbolMap.set(c.symbol, c);
        }
      });
      
      return Array.from(symbolMap.values());
    }, [availableCurrencies, quoteAssets]);

    // Filter by search and type
    const filteredCurrencies = useMemo(() => {
      return uniqueCurrencies.filter(c => {
        // Type filter
        if (filterType !== 'all' && c.currency_type !== filterType) return false;
        
        // Search filter
        if (search) {
          const query = search.toLowerCase();
          return c.symbol.toLowerCase().includes(query) || 
                 c.name.toLowerCase().includes(query);
        }
        return true;
      }).sort((a, b) => {
        // Sort: exact match first, then by symbol
        if (search) {
          const aExact = a.symbol.toLowerCase() === search.toLowerCase();
          const bExact = b.symbol.toLowerCase() === search.toLowerCase();
          if (aExact && !bExact) return -1;
          if (!aExact && bExact) return 1;
        }
        return a.symbol.localeCompare(b.symbol);
      });
    }, [uniqueCurrencies, search, filterType]);

    const handleAdd = async () => {
      if (!selectedCurrency) return;
      setSaving(true);
      try {
        const response = await fetch(`${apiUrl}/api/v1/admin/settings/quote-assets`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ currency_id: selectedCurrency }),
        });
        const result = await response.json();
        if (result.success) {
          await fetchQuoteAssets();
          setSelectedQuote(selectedCurrency);
          onClose();
        } else {
          toastNotify({ title: 'Error', description: result.error?.message || 'Failed to add', variant: 'destructive' });
        }
      } catch (error) {
        console.error('Error:', error);
      } finally {
        setSaving(false);
      }
    };

    // Get logo URL helper
    const getLogoUrl = (currency: Currency) => {
      if (currency.logo_url) return currency.logo_url;
      return `/assets/upload/currency-logo/${currency.symbol.toLowerCase()}.svg`;
    };

    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col">
          <div className="p-6 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">Add Quote Asset</h2>
            <p className="text-sm text-gray-400 mt-1">
              Select a currency to use as a quote asset (e.g., USDT, BTC, INR)
            </p>
          </div>

          <div className="p-4 border-b border-gray-200 dark:border-gray-700 space-y-3">
            {/* Search Input */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 dark:text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Type to search... (USDT, BTC, INR, ETH)"
                className="w-full pl-10 pr-4 py-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-600 rounded-lg text-gray-900 dark:text-white text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                autoFocus
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-900 dark:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            
            {/* Type Filter Tabs */}
            <div className="flex gap-2">
              {[
                { key: 'all', label: 'All' },
                { key: 'crypto', label: 'Crypto' },
                { key: 'stablecoin', label: 'Stablecoin' },
                { key: 'fiat', label: 'Fiat' },
              ].map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setFilterType(tab.key as any)}
                  className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                    filterType === tab.key
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-gray-900 dark:hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-2 max-h-[350px]">
            {filteredCurrencies.map(currency => (
              <button
                key={currency.id}
                onClick={() => setSelectedCurrency(currency.id)}
                className={`w-full flex items-center gap-3 p-3 rounded-lg transition-all ${
                  selectedCurrency === currency.id 
                    ? 'bg-blue-600 text-white ring-2 ring-blue-400' 
                    : 'bg-gray-100 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-300'
                }`}
              >
                <img 
                  src={getLogoUrl(currency)} 
                  alt={currency.symbol}
                  className="w-10 h-10 rounded-full bg-gray-600"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="%23374151"/><text x="20" y="25" text-anchor="middle" fill="white" font-size="14" font-weight="bold">${currency.symbol.slice(0, 2)}</text></svg>`;
                  }}
                />
                <div className="flex-1 text-left">
                  <div className="font-semibold text-lg">{currency.symbol}</div>
                  <div className="text-sm opacity-70">{currency.name}</div>
                </div>
                <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                  currency.currency_type === 'stablecoin' ? 'bg-green-500/20 text-green-400' :
                  currency.currency_type === 'fiat' ? 'bg-yellow-500/20 text-yellow-400' :
                  'bg-blue-500/20 text-blue-400'
                }`}>
                  {currency.currency_type}
                </span>
                {selectedCurrency === currency.id && <Check className="w-6 h-6" />}
              </button>
            ))}
            {filteredCurrencies.length === 0 && (
              <div className="text-center py-12 text-gray-500">
                <Coins className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>No currencies found</p>
                {search && <p className="text-sm mt-1">Try a different search term</p>}
              </div>
            )}
          </div>

          <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2.5 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-white rounded-lg hover:bg-gray-600"
            >
              Cancel
            </button>
            <button
              onClick={handleAdd}
              disabled={!selectedCurrency || saving}
              className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2 font-medium"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Add Quote Asset
            </button>
          </div>
        </div>
      </div>
    );
  };

  // Success Modal for showing created pairs
  const SuccessModal = ({ 
    createdPairs, 
    skippedCount, 
    onClose 
  }: { 
    createdPairs: CreatedPairInfo[]; 
    skippedCount: number; 
    onClose: () => void;
  }) => {
    const getLogoFallback = (symbol: string) => 
      `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="%23374151"/><text x="20" y="25" text-anchor="middle" fill="white" font-size="12" font-weight="bold">${symbol.slice(0, 2)}</text></svg>`;

    return (
      <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
        <div className="bg-gradient-to-b from-gray-800 to-gray-900 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl border border-gray-700/50">
          {/* Success Header */}
          <div className="relative bg-gradient-to-r from-green-600 to-emerald-600 p-6 text-center">
            <div className="absolute inset-0 bg-[url('data:image/svg+xml,%3Csvg width=%2220%22 height=%2220%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Cpath d=%22M0 0h20v20H0z%22 fill=%22none%22/%3E%3Cpath d=%22M10 0v20M0 10h20%22 stroke=%22rgba(255,255,255,0.1)%22 stroke-width=%220.5%22/%3E%3C/svg%3E')] opacity-30"></div>
            <div className="relative">
              <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-3 backdrop-blur-sm">
                <Check className="w-10 h-10 text-gray-900 dark:text-white" strokeWidth={3} />
              </div>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Trading Pairs Created!</h2>
              <p className="text-green-100 mt-1">
                {createdPairs.length} pair{createdPairs.length !== 1 ? 's' : ''} successfully added
                {skippedCount > 0 && <span className="text-green-200/70"> • {skippedCount} skipped</span>}
              </p>
            </div>
          </div>

          {/* Created Pairs List */}
          <div className="p-4 max-h-[300px] overflow-y-auto">
            <div className="space-y-2">
              {createdPairs.map((pair, idx) => (
                <div 
                  key={idx}
                  className="flex items-center gap-3 p-3 bg-gray-800/50 rounded-xl border border-gray-700/50 hover:bg-gray-800 transition-colors"
                >
                  {/* Base Asset */}
                  <div className="flex items-center gap-2 flex-1">
                    <img 
                      src={pair.baseLogo || `/assets/upload/currency-logo/${pair.baseSymbol.toLowerCase()}.svg`}
                      alt={pair.baseSymbol}
                      className="w-10 h-10 rounded-full bg-gray-700 ring-2 ring-gray-600"
                      onError={(e) => { (e.target as HTMLImageElement).src = getLogoFallback(pair.baseSymbol); }}
                    />
                    <div>
                      <div className="font-bold text-gray-900 dark:text-white">{pair.baseSymbol}</div>
                      <div className="text-xs text-gray-500">Base</div>
                    </div>
                  </div>

                  {/* Arrow */}
                  <div className="flex flex-col items-center px-2">
                    <ArrowRightLeft className="w-5 h-5 text-gray-500" />
                    <div className="text-[10px] text-gray-600 font-medium mt-0.5">PAIR</div>
                  </div>

                  {/* Quote Asset */}
                  <div className="flex items-center gap-2 flex-1 justify-end">
                    <div className="text-right">
                      <div className="font-bold text-gray-900 dark:text-white">{pair.quoteSymbol}</div>
                      <div className="text-xs text-gray-500">Quote</div>
                    </div>
                    <img 
                      src={pair.quoteLogo || `/assets/upload/currency-logo/${pair.quoteSymbol.toLowerCase()}.svg`}
                      alt={pair.quoteSymbol}
                      className="w-10 h-10 rounded-full bg-gray-700 ring-2 ring-gray-600"
                      onError={(e) => { (e.target as HTMLImageElement).src = getLogoFallback(pair.quoteSymbol); }}
                    />
                  </div>
                </div>
              ))}
            </div>

            {skippedCount > 0 && (
              <div className="mt-3 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-yellow-500 flex-shrink-0" />
                <span className="text-sm text-yellow-400">
                  {skippedCount} pair{skippedCount !== 1 ? 's' : ''} skipped (already exist)
                </span>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-gray-700/50 bg-gray-800/30">
            <button
              onClick={onClose}
              className="w-full py-3 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-gray-900 dark:text-white rounded-xl font-semibold transition-all shadow-lg shadow-green-600/20 flex items-center justify-center gap-2"
            >
              <Check className="w-5 h-5" />
              Done
            </button>
          </div>
        </div>
      </div>
    );
  };

  // Add Trading Pairs Modal (Bulk)
  const AddPairsModal = ({ onClose }: { onClose: () => void }) => {
    const [search, setSearch] = useState('');
    const [selectedSymbols, setSelectedSymbols] = useState<string[]>([]);

    // Get existing pair base symbols (not IDs)
    const existingBaseSymbols = tradingPairs
      .filter(p => p.quote_currency_id === selectedQuote)
      .map(p => p.base_symbol);

    // Deduplicate currencies by symbol and exclude existing pairs
    const uniqueCurrencies = useMemo(() => {
      const symbolMap = new Map<string, Currency>();
      
      availableCurrencies.forEach(c => {
        // Skip if same symbol as selected quote
        if (c.symbol === selectedQuoteAsset?.symbol) return;
        // Skip if already paired
        if (existingBaseSymbols.includes(c.symbol)) return;
        
        // Keep only one entry per symbol (prefer one with logo)
        const existing = symbolMap.get(c.symbol);
        if (!existing || (c.logo_url && !existing.logo_url)) {
          symbolMap.set(c.symbol, c);
        }
      });
      
      return Array.from(symbolMap.values());
    }, [availableCurrencies, selectedQuoteAsset, existingBaseSymbols]);

    // Filter by search
    const filteredCurrencies = uniqueCurrencies.filter(c =>
      c.symbol.toLowerCase().includes(search.toLowerCase()) ||
      c.name.toLowerCase().includes(search.toLowerCase())
    );

    const toggleBase = (symbol: string) => {
      setSelectedSymbols(prev => 
        prev.includes(symbol) ? prev.filter(s => s !== symbol) : [...prev, symbol]
      );
    };

    const selectAll = () => {
      setSelectedSymbols(filteredCurrencies.map(c => c.symbol));
    };

    const handleCreate = async () => {
      if (selectedSymbols.length === 0) return;
      setSaving(true);
      
      // Capture currency data BEFORE creating pairs (before they get filtered out)
      const selectedCurrencyData = selectedSymbols.map(sym => {
        const currency = uniqueCurrencies.find(c => c.symbol === sym);
        return {
          symbol: sym,
          logo_url: currency?.logo_url || '',
          name: currency?.name || sym,
        };
      });
      
      try {
        const response = await fetch(`${apiUrl}/api/v1/admin/settings/trading-pairs/bulk`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            quote_symbol: selectedQuoteAsset?.symbol,
            base_symbols: selectedSymbols,
          }),
        });
        const result = await response.json();
        if (result.success) {
          // Prepare created pairs info BEFORE refreshing data
          const skippedSymbols = result.data.skipped?.map((s: any) => s.symbol) || [];
          const createdInfo: CreatedPairInfo[] = selectedCurrencyData
            .filter(c => !skippedSymbols.includes(c.symbol))
            .map(c => ({
              symbol: `${c.symbol}/${selectedQuoteAsset?.symbol}`,
              baseSymbol: c.symbol,
              quoteSymbol: selectedQuoteAsset?.symbol || '',
              baseLogo: c.logo_url,
              quoteLogo: selectedQuoteAsset?.logo_url || '',
            }));
          
          // Close this modal and show success modal at parent level
          onClose();
          
          // Set parent's success state
          setSuccessPairs(createdInfo);
          setSuccessSkipped(result.data.skipped_count || 0);
          setShowSuccessModal(true);
          
          // Refresh data in background
          fetchTradingPairs(selectedQuoteAsset?.symbol);
          fetchQuoteAssets();
        } else {
          toastNotify({ title: 'Error', description: result.error?.message || 'Failed to create pairs', variant: 'destructive' });
        }
      } catch (error) {
        console.error('Error:', error);
        toastNotify({ title: 'Error', description: 'Error creating pairs', variant: 'destructive' });
      } finally {
        setSaving(false);
      }
    };

    // Get logo URL helper
    const getLogoUrl = (currency: Currency) => {
      if (currency.logo_url) return currency.logo_url;
      return `/assets/upload/currency-logo/${currency.symbol.toLowerCase()}.svg`;
    };

    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col">
          <div className="p-6 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">Add Trading Pairs</h2>
            <p className="text-sm text-gray-400 mt-1">
              Select base currencies to pair with <span className="text-blue-400 font-medium">{selectedQuoteAsset?.symbol}</span>
            </p>
          </div>

          <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 dark:text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search currencies..."
                className="w-full pl-10 pr-4 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-600 rounded-lg text-gray-900 dark:text-white text-sm"
                autoFocus
              />
            </div>
            <button
              onClick={selectAll}
              className="px-3 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 text-sm"
            >
              Select All
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-1 max-h-[300px]">
            {filteredCurrencies.map(currency => (
              <button
                key={currency.symbol}
                onClick={() => toggleBase(currency.symbol)}
                className={`w-full flex items-center gap-3 p-2.5 rounded-lg transition-colors ${
                  selectedSymbols.includes(currency.symbol)
                    ? 'bg-blue-600/20 border border-blue-500 text-white'
                    : 'bg-gray-100 dark:bg-gray-700/30 hover:bg-gray-100 dark:hover:bg-gray-100 dark:bg-gray-700/50 text-gray-300 border border-transparent'
                }`}
              >
                <div className={`w-5 h-5 rounded border flex items-center justify-center ${
                  selectedSymbols.includes(currency.symbol) ? 'bg-blue-600 border-blue-600' : 'border-gray-500'
                }`}>
                  {selectedSymbols.includes(currency.symbol) && <Check className="w-3 h-3 text-gray-900 dark:text-white" />}
                </div>
                <img 
                  src={getLogoUrl(currency)} 
                  alt={currency.symbol}
                  className="w-8 h-8 rounded-full bg-gray-600"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="%23374151"/><text x="20" y="25" text-anchor="middle" fill="white" font-size="12" font-weight="bold">${currency.symbol.slice(0, 2)}</text></svg>`;
                  }}
                />
                <span className="font-medium">{currency.symbol}</span>
                <span className="text-xs text-gray-500">/{selectedQuoteAsset?.symbol}</span>
              </button>
            ))}
            {filteredCurrencies.length === 0 && (
              <div className="text-center py-8 text-gray-500">
                <Coins className="w-10 h-10 mx-auto mb-2 opacity-50" />
                All available currencies are already paired
              </div>
            )}
          </div>

          <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-white rounded-lg hover:bg-gray-600"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={selectedSymbols.length === 0 || saving}
              className="flex-1 px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-gray-900 dark:text-white rounded-lg hover:from-blue-500 hover:to-indigo-500 disabled:opacity-50 flex items-center justify-center gap-2 font-medium shadow-lg shadow-blue-600/20"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Create {selectedSymbols.length} Pairs
            </button>
          </div>
        </div>
      </div>
    );
  };

  // Edit Pair Modal
  const EditPairModal = ({ pair, onClose }: { pair: TradingPair; onClose: () => void }) => {
    const [form, setForm] = useState({
      min_quantity: pair.min_quantity,
      max_quantity: pair.max_quantity,
      min_price: pair.min_price,
      max_price: pair.max_price,
      price_precision: pair.price_precision.toString(),
      quantity_precision: pair.quantity_precision.toString(),
      maker_fee: pair.maker_fee,
      taker_fee: pair.taker_fee,
    });

    const handleSave = async () => {
      setSaving(true);
      try {
        const response = await fetch(`${apiUrl}/api/v1/admin/settings/trading-pairs/${pair.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            ...form,
            price_precision: parseInt(form.price_precision),
            quantity_precision: parseInt(form.quantity_precision),
          }),
        });
        const result = await response.json();
        if (result.success) {
          await fetchTradingPairs(selectedQuoteAsset?.symbol);
          onClose();
        }
      } catch (error) {
        console.error('Error:', error);
      } finally {
        setSaving(false);
      }
    };

    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl w-full max-w-md">
          <div className="p-6 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">Edit {pair.symbol}</h2>
          </div>

          <div className="p-6 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Min Quantity</label>
                <input
                  type="text"
                  value={form.min_quantity}
                  onChange={e => setForm({ ...form, min_quantity: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-600 rounded-lg text-gray-900 dark:text-white text-sm"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Max Quantity</label>
                <input
                  type="text"
                  value={form.max_quantity}
                  onChange={e => setForm({ ...form, max_quantity: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-600 rounded-lg text-gray-900 dark:text-white text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Min Price</label>
                <input
                  type="text"
                  value={form.min_price}
                  onChange={e => setForm({ ...form, min_price: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-600 rounded-lg text-gray-900 dark:text-white text-sm"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Max Price</label>
                <input
                  type="text"
                  value={form.max_price}
                  onChange={e => setForm({ ...form, max_price: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-600 rounded-lg text-gray-900 dark:text-white text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Price Precision</label>
                <input
                  type="number"
                  value={form.price_precision}
                  onChange={e => setForm({ ...form, price_precision: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-600 rounded-lg text-gray-900 dark:text-white text-sm"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Quantity Precision</label>
                <input
                  type="number"
                  value={form.quantity_precision}
                  onChange={e => setForm({ ...form, quantity_precision: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-600 rounded-lg text-gray-900 dark:text-white text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Maker Fee (%)</label>
                <input
                  type="text"
                  value={form.maker_fee}
                  onChange={e => setForm({ ...form, maker_fee: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-600 rounded-lg text-gray-900 dark:text-white text-sm"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Taker Fee (%)</label>
                <input
                  type="text"
                  value={form.taker_fee}
                  onChange={e => setForm({ ...form, taker_fee: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-600 rounded-lg text-gray-900 dark:text-white text-sm"
                />
              </div>
            </div>
          </div>

          <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-white rounded-lg hover:bg-gray-600"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save
            </button>
          </div>
        </div>
      </div>
    );
  };

  const ToggleSwitch = ({ enabled, onToggle, isLoading }: { enabled: boolean; onToggle: () => void; isLoading: boolean }) => (
    <button
      onClick={onToggle}
      disabled={isLoading}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
        isLoading ? 'bg-gray-500' : enabled ? 'bg-green-500' : 'bg-gray-600'
      }`}
    >
      {isLoading ? (
        <Loader2 className="w-3 h-3 text-gray-900 dark:text-white animate-spin mx-auto" />
      ) : (
        <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
          enabled ? 'translate-x-5' : 'translate-x-0.5'
        }`} />
      )}
    </button>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
            <ArrowRightLeft className="w-8 h-8 text-green-500" />
            Trading Pairs
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            Configure quote assets and trading pairs for spot orderbook
          </p>
        </div>
      </div>

      {/* Quote Assets Section */}
      <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Quote Assets</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              These currencies will be available as quote (base) pairs like ETH/USDT, BTC/USDT
            </p>
          </div>
          <button
            onClick={() => setShowAddQuote(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Add Quote Asset
          </button>
        </div>

        <div className="flex flex-wrap gap-3">
          {quoteAssets.map(qa => (
            <div
              key={qa.id}
              onClick={() => setSelectedQuote(qa.currency_id)}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer transition-all ${
                selectedQuote === qa.currency_id
                  ? 'bg-blue-600 ring-2 ring-blue-400'
                  : 'bg-gray-100 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              {qa.logo_url ? (
                <img src={qa.logo_url} alt="" className="w-10 h-10 rounded-full" />
              ) : (
                <div className="w-10 h-10 bg-gray-600 rounded-full flex items-center justify-center">
                  <span className="font-bold">{qa.symbol.slice(0, 2)}</span>
                </div>
              )}
              <div>
                <div className="font-semibold text-gray-900 dark:text-white">{qa.symbol}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">{qa.pair_count} pairs</div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  deleteQuoteAsset(qa.id);
                }}
                className="ml-2 p-1 hover:bg-red-500/20 rounded text-gray-400 hover:text-red-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
          
          {quoteAssets.length === 0 && (
            <div className="text-gray-500 text-center py-8 w-full">
              No quote assets configured. Add USDT, BTC, or INR to get started.
            </div>
          )}
        </div>
      </div>

      {/* Trading Pairs Section */}
      {selectedQuote && (
        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden flex flex-col">
          <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                Trading Pairs
              </h2>
              <span className="px-2 py-1 bg-blue-500/20 text-blue-400 rounded text-sm">
                {selectedQuoteAsset?.symbol}
              </span>
              <span className="text-gray-500 text-sm">
                {filteredPairs.length}{pairsTotal > 0 ? ` of ${pairsTotal}` : ''} pairs
              </span>
            </div>
            <button
              onClick={() => setShowAddPairs(true)}
              className="px-4 py-2 bg-green-600 text-gray-900 dark:text-white rounded-lg hover:bg-green-700 flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Add Pairs
            </button>
          </div>

          {/* Scrollable Table Container */}
          <div 
            ref={tableContainerRef}
            className="overflow-auto"
          >
            <table className="w-full min-w-[800px]">
              <thead className="bg-gray-100 dark:bg-gray-900 sticky top-0 z-10">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Pair</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase">Price Precision</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase">Qty Precision</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase">Maker Fee</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase">Taker Fee</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase">Active</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {filteredPairs.map(pair => (
                  <tr key={pair.id} className="hover:bg-gray-100 dark:hover:bg-gray-100 dark:bg-gray-700/30">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex -space-x-2">
                          {pair.base_logo ? (
                            <img src={pair.base_logo} alt="" className="w-6 h-6 rounded-full border-2 border-gray-800" />
                          ) : (
                            <div className="w-6 h-6 bg-gray-600 rounded-full border-2 border-gray-800 flex items-center justify-center">
                              <span className="text-[8px]">{pair.base_symbol.slice(0, 2)}</span>
                            </div>
                          )}
                          {pair.quote_logo ? (
                            <img src={pair.quote_logo} alt="" className="w-6 h-6 rounded-full border-2 border-gray-800" />
                          ) : (
                            <div className="w-6 h-6 bg-gray-600 rounded-full border-2 border-gray-800 flex items-center justify-center">
                              <span className="text-[8px]">{pair.quote_symbol.slice(0, 2)}</span>
                            </div>
                          )}
                        </div>
                        <span className="font-medium text-gray-900 dark:text-white">{pair.symbol}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center text-gray-700 dark:text-gray-300">{pair.price_precision}</td>
                    <td className="px-4 py-3 text-center text-gray-700 dark:text-gray-300">{pair.quantity_precision}</td>
                    <td className="px-4 py-3 text-center text-gray-700 dark:text-gray-300">{parseFloat(pair.maker_fee) * 100}%</td>
                    <td className="px-4 py-3 text-center text-gray-700 dark:text-gray-300">{parseFloat(pair.taker_fee) * 100}%</td>
                    <td className="px-4 py-3 text-center">
                      <ToggleSwitch
                        enabled={pair.is_active}
                        onToggle={() => togglePairStatus(pair.id)}
                        isLoading={toggling === pair.id}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => setEditingPair(pair)}
                          className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-600 rounded text-gray-400 hover:text-gray-900 dark:text-white"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setDeleteModal({ show: true, type: 'pair', id: pair.id, name: pair.symbol })}
                          className="p-1.5 hover:bg-red-500/20 rounded text-gray-400 hover:text-red-400"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            
            {/* Loading more indicator */}
            {loadingMore && (
              <div className="py-4 flex items-center justify-center gap-2 text-gray-500 dark:text-gray-400">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Loading more...</span>
              </div>
            )}
            
            {/* End of list indicator */}
            {!pairsHasMore && filteredPairs.length > 0 && (
              <div className="py-4 text-center text-gray-500 text-sm">
                All {pairsTotal} pairs loaded
              </div>
            )}
          </div>

          {filteredPairs.length === 0 && !loading && (
            <div className="p-12 text-center">
              <Link2 className="w-12 h-12 text-gray-600 mx-auto mb-3" />
              <p className="text-gray-500">No trading pairs for {selectedQuoteAsset?.symbol}</p>
              <button
                onClick={() => setShowAddPairs(true)}
                className="mt-3 text-green-400 hover:text-green-300"
              >
                + Add trading pairs
              </button>
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      {showAddQuote && <AddQuoteModal onClose={() => setShowAddQuote(false)} />}
      {showAddPairs && selectedQuote && <AddPairsModal onClose={() => setShowAddPairs(false)} />}
      {editingPair && <EditPairModal pair={editingPair} onClose={() => setEditingPair(null)} />}
      
      {/* Success Modal - rendered at parent level to persist across re-renders */}
      {showSuccessModal && (
        <SuccessModal 
          createdPairs={successPairs}
          skippedCount={successSkipped}
          onClose={() => setShowSuccessModal(false)}
        />
      )}
      
      {/* Delete Confirmation Modal */}
      {deleteModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl border border-gray-200 dark:border-gray-700">
            {/* Header */}
            <div className="p-6 text-center">
              <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <Trash2 className="w-8 h-8 text-red-500" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Delete {deleteModal.type === 'pair' ? 'Trading Pair' : 'Quote Asset'}</h3>
              <p className="text-gray-500 dark:text-gray-400">
                Are you sure you want to delete <span className="text-gray-900 dark:text-white font-semibold">{deleteModal.name}</span>?
              </p>
              <p className="text-sm text-red-400 mt-2">This action cannot be undone.</p>
            </div>
            
            {/* Actions */}
            <div className="p-4 bg-gray-900/50 flex gap-3">
              <button
                onClick={() => setDeleteModal(null)}
                disabled={deleting}
                className="flex-1 px-4 py-2.5 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-white rounded-lg hover:bg-gray-600 disabled:opacity-50 font-medium"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (deleteModal.type === 'pair') {
                    deletePair(deleteModal.id);
                  } else {
                    deleteQuoteAsset(deleteModal.id);
                  }
                }}
                disabled={deleting}
                className="flex-1 px-4 py-2.5 bg-red-600 text-gray-900 dark:text-white rounded-lg hover:bg-red-700 disabled:opacity-50 font-medium flex items-center justify-center gap-2"
              >
                {deleting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    Delete
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Toast Notification */}
      {toast && (
        <div className={`fixed bottom-4 right-4 z-50 animate-in slide-in-from-bottom-4 fade-in duration-300`}>
          <div className={`flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg ${
            toast.type === 'success' 
              ? 'bg-green-600 text-white' 
              : 'bg-red-600 text-white'
          }`}>
            {toast.type === 'success' ? (
              <Check className="w-5 h-5" />
            ) : (
              <AlertCircle className="w-5 h-5" />
            )}
            <span className="font-medium">{toast.message}</span>
            <button 
              onClick={() => setToast(null)}
              className="ml-2 hover:opacity-70"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
