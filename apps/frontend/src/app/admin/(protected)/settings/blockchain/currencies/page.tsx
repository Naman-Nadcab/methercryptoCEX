'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { 
  Coins, Plus, Edit2, Search, Filter,
  Loader2, Save, AlertCircle, ChevronDown, Check
} from 'lucide-react';

interface ChainDeployment {
  id: string;
  blockchain_id: string;
  chain_name: string;
  chain_symbol: string;
  chain_logo: string | null;
  contract_address: string | null;
  decimals: number;
  is_active: boolean;
  deposit_enabled: boolean;
  withdrawal_enabled: boolean;
}

interface Currency {
  id: string;
  symbol: string;
  name: string;
  currency_type: string;
  logo_url: string | null;
  is_active: boolean;
  deposit_enabled: boolean;
  withdrawal_enabled: boolean;
  trade_enabled: boolean;
  min_deposit: string;
  min_withdrawal: string;
  withdrawal_fee: string;
  withdrawal_fee_type: string;
  decimals: number;
  display_decimals: number;
  chains: ChainDeployment[];
}

export default function CurrenciesPage() {
  const { accessToken } = useAdminAuthStore();
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddCurrency, setShowAddCurrency] = useState(false);
  const [editingCurrency, setEditingCurrency] = useState<Currency | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [toggling, setToggling] = useState<string | null>(null);
  
  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [showTypeDropdown, setShowTypeDropdown] = useState(false);
  
  // Pagination state
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const loadingMoreRef = useRef(false);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

  const fetchCurrencies = async (reset = true) => {
    if (!accessToken) return;
    
    const currentOffset = reset ? 0 : offset;
    
    if (reset) {
      setLoading(true);
    }
    
    try {
      const params = new URLSearchParams({
        limit: '20',
        offset: currentOffset.toString(),
      });
      
      if (searchQuery) params.append('search', searchQuery);
      if (typeFilter !== 'all') params.append('currency_type', typeFilter);
      
      const response = await fetch(`${apiUrl}/api/v1/admin/settings/currencies?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const result = await response.json();
      
      if (result.success) {
        if (reset) {
          setCurrencies(result.data.currencies);
          setOffset(result.data.currencies.length);
        } else {
          setCurrencies(prev => [...prev, ...result.data.currencies]);
          setOffset(prev => prev + result.data.currencies.length);
        }
        setTotal(result.data.total);
        setHasMore(result.data.hasMore);
      }
    } catch (error) {
      console.error('Failed to fetch currencies:', error);
    } finally {
      setLoading(false);
    }
  };

  // Load more function
  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || !hasMore) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    
    try {
      const params = new URLSearchParams({
        limit: '20',
        offset: offset.toString(),
      });
      
      if (searchQuery) params.append('search', searchQuery);
      if (typeFilter !== 'all') params.append('currency_type', typeFilter);
      
      const response = await fetch(`${apiUrl}/api/v1/admin/settings/currencies?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const result = await response.json();
      
      if (result.success) {
        setCurrencies(prev => [...prev, ...result.data.currencies]);
        setOffset(prev => prev + result.data.currencies.length);
        setHasMore(result.data.hasMore);
        setTotal(result.data.total);
      }
    } catch (error) {
      console.error('Failed to load more:', error);
    } finally {
      setLoadingMore(false);
      loadingMoreRef.current = false;
    }
  }, [offset, hasMore, searchQuery, typeFilter, accessToken, apiUrl]);

  useEffect(() => {
    fetchCurrencies(true);
  }, [accessToken]);

  // Fetch when filters change
  useEffect(() => {
    const debounce = setTimeout(() => {
      fetchCurrencies(true);
    }, 300);
    return () => clearTimeout(debounce);
  }, [searchQuery, typeFilter]);

  // Infinite scroll listener
  useEffect(() => {
    const container = tableContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      if (scrollHeight - scrollTop - clientHeight < 150 && hasMore && !loadingMoreRef.current) {
        loadMore();
      }
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [loadMore, hasMore]);

  // Toggle currency setting (applies to all chains with same symbol)
  const toggleCurrencySetting = async (symbol: string, field: string, currentValue: boolean) => {
    if (toggling) return;
    setToggling(`${symbol}-${field}`);
    
    try {
      const response = await fetch(`${apiUrl}/api/v1/admin/settings/currencies/symbol/${symbol}/toggle`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ field, value: !currentValue }),
      });
      const result = await response.json();
      
      if (result.success) {
        // Update local state
        setCurrencies(prev => prev.map(c => 
          c.symbol === symbol ? { ...c, [field]: !currentValue } : c
        ));
      } else {
        alert('Failed to update: ' + (result.error?.message || 'Unknown error'));
      }
    } catch (error) {
      console.error('Failed to toggle currency setting:', error);
      alert('Failed to update setting.');
    } finally {
      setToggling(null);
    }
  };

  const ToggleSwitch = ({ 
    enabled, 
    onToggle, 
    isLoading = false,
    size = 'normal'
  }: { 
    enabled: boolean; 
    onToggle: () => void; 
    isLoading?: boolean;
    size?: 'small' | 'normal';
  }) => {
    const sizeClasses = size === 'small' 
      ? 'h-4 w-7' 
      : 'h-5 w-9';
    const dotSize = size === 'small'
      ? 'h-2.5 w-2.5'
      : 'h-3.5 w-3.5';
    const translateOn = size === 'small' ? 'translate-x-4' : 'translate-x-5';
    
    return (
      <button
        onClick={onToggle}
        disabled={isLoading}
        className={`relative inline-flex ${sizeClasses} items-center rounded-full transition-colors ${
          isLoading ? 'bg-gray-500 cursor-wait' : enabled ? 'bg-green-500' : 'bg-gray-600'
        }`}
      >
        {isLoading ? (
          <span className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="w-2 h-2 text-gray-900 dark:text-white animate-spin" />
          </span>
        ) : (
          <span
            className={`inline-block ${dotSize} transform rounded-full bg-white transition-transform ${
              enabled ? translateOn : 'translate-x-0.5'
            }`}
          />
        )}
      </button>
    );
  };

  // Get logo URL with fallback
  const getLogoUrl = (currency: Currency) => {
    if (currency.logo_url) return currency.logo_url;
    return `/assets/upload/currency-logo/${currency.symbol.toLowerCase()}.svg`;
  };

  if (loading && currencies.length === 0) {
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
            <Coins className="w-8 h-8 text-blue-500" />
            Currencies
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            Manage currencies and their settings across all chains
          </p>
        </div>
        <button
          onClick={() => setShowAddCurrency(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Add Currency
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
          <div className="text-gray-400 text-sm">Total Currencies</div>
          <div className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{total}</div>
        </div>
        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
          <div className="text-gray-400 text-sm">Trade Enabled</div>
          <div className="text-2xl font-bold text-green-400 mt-1">
            {currencies.filter(c => c.trade_enabled).length}
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
          <div className="text-gray-400 text-sm">Stablecoins</div>
          <div className="text-2xl font-bold text-blue-400 mt-1">
            {currencies.filter(c => c.currency_type === 'stablecoin').length}
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
          <div className="text-gray-400 text-sm">Loaded</div>
          <div className="text-2xl font-bold text-blue-400 mt-1">
            {currencies.length} / {total}
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
        <div className="flex items-center gap-4">
          {/* Search */}
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 dark:text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search by name or symbol..."
              className="w-full pl-10 pr-4 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-600 rounded-lg text-gray-900 dark:text-white text-sm placeholder-gray-500"
            />
          </div>

          {/* Type Filter Dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowTypeDropdown(!showTypeDropdown)}
              className="flex items-center gap-2 px-4 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-600 rounded-lg text-gray-900 dark:text-white hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors min-w-[150px]"
            >
              <Filter className="w-4 h-4 text-gray-500 dark:text-gray-400" />
              <span className="flex-1 text-left capitalize">
                {typeFilter === 'all' ? 'All Types' : typeFilter}
              </span>
              <ChevronDown className={`w-4 h-4 transition-transform ${showTypeDropdown ? 'rotate-180' : ''}`} />
            </button>

            {showTypeDropdown && (
              <div className="absolute top-full left-0 mt-1 w-full bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl z-50">
                {['all', 'crypto', 'stablecoin', 'fiat'].map(type => (
                  <button
                    key={type}
                    onClick={() => {
                      setTypeFilter(type);
                      setShowTypeDropdown(false);
                    }}
                    className={`w-full px-4 py-2.5 text-left hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center justify-between capitalize ${
                      typeFilter === type ? 'bg-gray-100 dark:bg-gray-700/50 text-white' : 'text-gray-300'
                    }`}
                  >
                    <span>{type === 'all' ? 'All Types' : type}</span>
                    {typeFilter === type && <Check className="w-4 h-4 text-green-400" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Clear Filters */}
          {(typeFilter !== 'all' || searchQuery) && (
            <button
              onClick={() => {
                setTypeFilter('all');
                setSearchQuery('');
              }}
              className="px-3 py-2 text-gray-400 hover:text-gray-900 dark:hover:text-white text-sm"
            >
              Clear Filters
            </button>
          )}
        </div>
      </div>

      {/* Currencies Table */}
      <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden flex flex-col">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between flex-shrink-0">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Currencies
          </h2>
          <span className="text-sm text-gray-500 dark:text-gray-400">{currencies.length} of {total} loaded</span>
        </div>

        {/* Scrollable Table Container */}
        <div 
          ref={tableContainerRef}
          className="overflow-auto"
        >
          <table className="w-full min-w-[1100px]">
            <thead className="bg-gray-100 dark:bg-gray-900 sticky top-0 z-10">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Currency</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Name</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Chains</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider">Type</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider">Trade</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider">Deposit</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider">Withdraw</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {currencies.map(currency => (
                <tr key={currency.symbol} className="hover:bg-gray-100 dark:hover:bg-gray-100 dark:bg-gray-700/30 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <img 
                        src={getLogoUrl(currency)} 
                        alt={currency.symbol}
                        className="w-8 h-8 rounded-full"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                          (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
                        }}
                      />
                      <div className="w-8 h-8 bg-gray-700 rounded-full items-center justify-center hidden">
                        <span className="text-[10px] font-bold text-gray-900 dark:text-white">{currency.symbol.slice(0, 2)}</span>
                      </div>
                      <span className="font-mono font-semibold text-gray-900 dark:text-white">{currency.symbol}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-300 text-sm max-w-[180px] truncate">
                    {currency.name}
                  </td>
                  <td className="px-4 py-3">
                    {/* Chain logos */}
                    <div className="flex items-center gap-1">
                      {currency.chains && currency.chains.length > 0 ? (
                        <>
                          {currency.chains.slice(0, 5).map((chain, idx) => (
                            <div 
                              key={chain.id}
                              className="relative group"
                              title={chain.chain_name}
                            >
                              {chain.chain_logo ? (
                                <img 
                                  src={chain.chain_logo} 
                                  alt={chain.chain_symbol}
                                  className="w-6 h-6 rounded-full border-2 border-gray-800 bg-gray-700"
                                />
                              ) : (
                                <div className="w-6 h-6 bg-gray-600 rounded-full border-2 border-gray-800 flex items-center justify-center">
                                  <span className="text-[8px] font-bold">{chain.chain_symbol?.slice(0, 2)}</span>
                                </div>
                              )}
                              {/* Tooltip */}
                              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 bg-gray-900 text-gray-900 dark:text-white text-xs rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-20">
                                {chain.chain_name}
                              </div>
                            </div>
                          ))}
                          {currency.chains.length > 5 && (
                            <div className="w-6 h-6 bg-gray-600 rounded-full border-2 border-gray-800 flex items-center justify-center text-[9px] text-gray-700 dark:text-gray-300">
                              +{currency.chains.length - 5}
                            </div>
                          )}
                        </>
                      ) : (
                        <span className="text-gray-500 text-xs">No chain</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      currency.currency_type === 'crypto' ? 'bg-blue-500/20 text-blue-400' :
                      currency.currency_type === 'stablecoin' ? 'bg-green-500/20 text-green-400' :
                      'bg-yellow-500/20 text-yellow-400'
                    }`}>
                      {currency.currency_type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <ToggleSwitch
                      enabled={currency.trade_enabled}
                      onToggle={() => toggleCurrencySetting(currency.symbol, 'trade_enabled', currency.trade_enabled)}
                      isLoading={toggling === `${currency.symbol}-trade_enabled`}
                    />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <ToggleSwitch
                      enabled={currency.deposit_enabled}
                      onToggle={() => toggleCurrencySetting(currency.symbol, 'deposit_enabled', currency.deposit_enabled)}
                      isLoading={toggling === `${currency.symbol}-deposit_enabled`}
                    />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <ToggleSwitch
                      enabled={currency.withdrawal_enabled}
                      onToggle={() => toggleCurrencySetting(currency.symbol, 'withdrawal_enabled', currency.withdrawal_enabled)}
                      isLoading={toggling === `${currency.symbol}-withdrawal_enabled`}
                    />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => setEditingCurrency(currency)}
                      className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors text-gray-400 hover:text-gray-900 dark:text-white"
                      title="Edit Currency"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
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
          {!hasMore && currencies.length > 0 && (
            <div className="py-4 text-center text-gray-500 text-sm">
              All {total} currencies loaded
            </div>
          )}
        </div>

        {currencies.length === 0 && !loading && (
          <div className="p-12 text-center">
            <Coins className="w-12 h-12 text-gray-600 mx-auto mb-3" />
            <p className="text-gray-500">
              {searchQuery || typeFilter !== 'all' 
                ? 'No currencies match your filters' 
                : 'No currencies configured'}
            </p>
            {!searchQuery && typeFilter === 'all' && (
              <button
                onClick={() => setShowAddCurrency(true)}
                className="mt-3 text-blue-400 hover:text-blue-300"
              >
                Add your first currency
              </button>
            )}
          </div>
        )}
      </div>

      {/* Click outside to close dropdown */}
      {showTypeDropdown && (
        <div 
          className="fixed inset-0 z-40" 
          onClick={() => setShowTypeDropdown(false)}
        />
      )}
    </div>
  );
}
