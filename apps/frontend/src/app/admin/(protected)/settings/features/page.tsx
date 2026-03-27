'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { getSettings, patchSettings } from '@/lib/admin/settings';
import { 
  ToggleLeft, Search, Loader2, Check, X, AlertTriangle, 
  ChevronDown, Filter, RefreshCw, Upload,
  Shield, Users, ArrowDownToLine, ArrowUpFromLine,
  TrendingUp, Lock, Settings
} from 'lucide-react';

interface Feature {
  id: string;
  category: string;
  feature_key: string;
  feature_name: string;
  description: string | null;
  is_enabled: boolean;
  is_critical: boolean;
  depends_on: string[];
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
}

interface CategoryStats {
  category: string;
  total: string;
  enabled: string;
}

// Basic exchange features only
const defaultFeatures = [
  // Signup
  { category: 'signup', feature_key: 'signup.enabled', feature_name: 'User Signup', description: 'Allow new user registrations', is_critical: true },
  { category: 'signup', feature_key: 'signup.email', feature_name: 'Email Signup', description: 'Signup with email address' },
  { category: 'signup', feature_key: 'signup.phone', feature_name: 'Phone Signup', description: 'Signup with phone number' },

  // Login
  { category: 'login', feature_key: 'login.enabled', feature_name: 'User Login', description: 'Allow users to login', is_critical: true },
  { category: 'login', feature_key: 'login.email', feature_name: 'Email Login', description: 'Login with email' },
  { category: 'login', feature_key: 'login.phone', feature_name: 'Phone Login', description: 'Login with phone' },

  // KYC
  { category: 'kyc', feature_key: 'kyc.enabled', feature_name: 'KYC Verification', description: 'Enable KYC system', is_critical: true },
  { category: 'kyc', feature_key: 'kyc.required', feature_name: 'KYC Required', description: 'Require KYC for trading' },

  // Deposit
  { category: 'deposit', feature_key: 'deposit.enabled', feature_name: 'Deposits', description: 'Enable all deposits', is_critical: true },
  { category: 'deposit', feature_key: 'deposit.crypto', feature_name: 'Crypto Deposit', description: 'Cryptocurrency deposits' },
  { category: 'deposit', feature_key: 'deposit.fiat', feature_name: 'Fiat Deposit', description: 'Fiat currency deposits' },

  // Withdrawal
  { category: 'withdrawal', feature_key: 'withdrawal.enabled', feature_name: 'Withdrawals', description: 'Enable all withdrawals', is_critical: true },
  { category: 'withdrawal', feature_key: 'withdrawal.crypto', feature_name: 'Crypto Withdrawal', description: 'Cryptocurrency withdrawals' },
  { category: 'withdrawal', feature_key: 'withdrawal.fiat', feature_name: 'Fiat Withdrawal', description: 'Fiat currency withdrawals' },

  // Trade
  { category: 'trade', feature_key: 'trade.enabled', feature_name: 'Trading', description: 'Enable trading system', is_critical: true },
  { category: 'trade', feature_key: 'trade.spot', feature_name: 'Spot Trading', description: 'Spot market trading' },
  { category: 'trade', feature_key: 'trade.p2p', feature_name: 'P2P Trading', description: 'Peer-to-peer trading' },
];

const categoryIcons: Record<string, React.ReactNode> = {
  signup: <Users className="w-4 h-4" />,
  login: <Lock className="w-4 h-4" />,
  kyc: <Shield className="w-4 h-4" />,
  deposit: <ArrowDownToLine className="w-4 h-4" />,
  withdrawal: <ArrowUpFromLine className="w-4 h-4" />,
  trade: <TrendingUp className="w-4 h-4" />,
};

const categoryLabels: Record<string, string> = {
  signup: 'Signup',
  login: 'Login',
  kyc: 'KYC Verification',
  deposit: 'Deposit',
  withdrawal: 'Withdrawal',
  trade: 'Trade',
};

export default function FeatureTogglesPage() {
  const { accessToken } = useAdminAuthStore();
  const [features, setFeatures] = useState<Feature[]>([]);
  const [categories, setCategories] = useState<CategoryStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [toggling, setToggling] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(false);
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  
  // Pagination
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const tableRef = useRef<HTMLDivElement>(null);
  const loadingMoreRef = useRef(false);
  
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const apiUrl = getApiBaseUrl();

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchFeatures = async (reset = true) => {
    if (!accessToken) return;
    
    const currentOffset = reset ? 0 : offset;
    if (reset) setLoading(true);
    
    try {
      const params = new URLSearchParams({
        limit: '50',
        offset: currentOffset.toString(),
      });
      if (selectedCategory !== 'all') params.append('category', selectedCategory);
      if (searchQuery) params.append('search', searchQuery);
      
      const response = await fetch(`${apiUrl}/api/v1/admin/settings/features?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const result = await response.json();
      
      if (result.success) {
        if (reset) {
          setFeatures(result.data.features);
          setOffset(result.data.features.length);
        } else {
          setFeatures(prev => [...prev, ...result.data.features]);
          setOffset(prev => prev + result.data.features.length);
        }
        setCategories(result.data.categories);
        setTotal(result.data.total);
        setHasMore(result.data.hasMore);
      }
    } catch (error) {
      console.error('Failed to fetch features:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || !hasMore) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    
    try {
      const params = new URLSearchParams({
        limit: '50',
        offset: offset.toString(),
      });
      if (selectedCategory !== 'all') params.append('category', selectedCategory);
      if (searchQuery) params.append('search', searchQuery);
      
      const response = await fetch(`${apiUrl}/api/v1/admin/settings/features?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const result = await response.json();
      
      if (result.success) {
        setFeatures(prev => [...prev, ...result.data.features]);
        setOffset(prev => prev + result.data.features.length);
        setHasMore(result.data.hasMore);
      }
    } catch (error) {
      console.error('Failed to load more:', error);
    } finally {
      setLoadingMore(false);
      loadingMoreRef.current = false;
    }
  }, [offset, hasMore, selectedCategory, searchQuery, accessToken, apiUrl]);

  useEffect(() => {
    fetchFeatures(true);
  }, [accessToken]);

  useEffect(() => {
    const debounce = setTimeout(() => {
      fetchFeatures(true);
    }, 300);
    return () => clearTimeout(debounce);
  }, [selectedCategory, searchQuery]);

  // Infinite scroll
  useEffect(() => {
    const container = tableRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      if (scrollHeight - scrollTop - clientHeight < 200 && hasMore && !loadingMoreRef.current) {
        loadMore();
      }
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [loadMore, hasMore]);

  const initializeFeatures = async () => {
    setInitializing(true);
    try {
      const response = await fetch(`${apiUrl}/api/v1/admin/settings/features/bulk`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ features: defaultFeatures }),
      });
      const result = await response.json();
      if (result.success) {
        showToast(`Initialized ${result.data.created} features!`);
        fetchFeatures(true);
      }
    } catch (error) {
      showToast('Failed to initialize features', 'error');
    } finally {
      setInitializing(false);
    }
  };

  const toggleFeature = async (id: string) => {
    if (toggling) return;
    setToggling(id);
    
    try {
      const response = await fetch(`${apiUrl}/api/v1/admin/settings/features/${id}/toggle`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const result = await response.json();
      if (result.success) {
        setFeatures(prev => prev.map(f => 
          f.id === id ? { ...f, is_enabled: result.data.feature.is_enabled } : f
        ));
      }
    } catch (error) {
      showToast('Failed to toggle feature', 'error');
    } finally {
      setToggling(null);
    }
  };

  const toggleCategory = async (category: string, enabled: boolean) => {
    try {
      const response = await fetch(`${apiUrl}/api/v1/admin/settings/features/category/${category}/toggle`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ enabled }),
      });
      const result = await response.json();
      if (result.success) {
        showToast(`${enabled ? 'Enabled' : 'Disabled'} ${result.data.updated} features`);
        fetchFeatures(true);
      }
    } catch (error) {
      showToast('Failed to toggle category', 'error');
    }
  };

  const ToggleSwitch = ({ enabled, onToggle, isLoading = false, size = 'normal' }: { 
    enabled: boolean; 
    onToggle: () => void; 
    isLoading?: boolean;
    size?: 'small' | 'normal';
  }) => {
    const sizeClass = size === 'small' ? 'h-4 w-7' : 'h-5 w-9';
    const dotClass = size === 'small' ? 'h-2.5 w-2.5' : 'h-3.5 w-3.5';
    const translateClass = size === 'small' ? 'translate-x-3.5' : 'translate-x-5';
    
    return (
      <button
        onClick={onToggle}
        disabled={isLoading}
        className={`relative inline-flex ${sizeClass} items-center rounded-full transition-colors ${
          isLoading ? 'bg-gray-500 cursor-wait' : enabled ? 'bg-green-500' : 'bg-gray-600'
        }`}
      >
        {isLoading ? (
          <Loader2 className="w-3 h-3 text-gray-900 dark:text-white animate-spin mx-auto" />
        ) : (
          <span className={`inline-block ${dotClass} transform rounded-full bg-white transition-transform ${
            enabled ? translateClass : 'translate-x-0.5'
          }`} />
        )}
      </button>
    );
  };

  // Group features by category for display
  const groupedFeatures = features.reduce((acc, f) => {
    if (!acc[f.category]) acc[f.category] = [];
    acc[f.category].push(f);
    return acc;
  }, {} as Record<string, Feature[]>);

  const totalEnabled = categories.reduce((sum, c) => sum + parseInt(c.enabled || '0'), 0);
  const totalFeatures = categories.reduce((sum, c) => sum + parseInt(c.total || '0'), 0);

  const queryClient = useQueryClient();
  const { data: settingsData } = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: () => getSettings(accessToken),
    enabled: !!accessToken,
  });
  const settings = (settingsData?.data ?? {}) as Record<string, unknown>;
  const [systemTogglingKey, setSystemTogglingKey] = useState<string | null>(null);
  const patchMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => patchSettings(accessToken, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'settings'] }),
    onSettled: () => setSystemTogglingKey(null),
  });
  const systemToggles = [
    { key: 'spot_trading_enabled', label: 'Spot trading' },
    { key: 'p2p_trading_enabled', label: 'P2P trading' },
    { key: 'margin_trading_enabled', label: 'Margin trading' },
    { key: 'maintenance_mode', label: 'Maintenance mode' },
    { key: 'user_registration_enabled', label: 'User registration' },
    { key: 'deposits_enabled', label: 'Deposits' },
    { key: 'withdrawals_enabled', label: 'Withdrawals' },
  ];

  if (loading && features.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* System toggles via patchSettings */}
      <div className="admin-card rounded-xl border border-gray-200 dark:border-gray-700 p-4 sm:p-6">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">System toggles</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">Updated via GET/PATCH /admin/settings. Keys may vary by backend.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {systemToggles.map(({ key, label }) => {
            const value = settings[key];
            const enabled = value === true || value === 'true' || value === '1';
            const isToggling = systemTogglingKey === key;
            return (
              <div key={key} className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2">
                <span className="text-sm text-gray-900 dark:text-white">{label}</span>
                <button
                  type="button"
                  onClick={() => {
                    setSystemTogglingKey(key);
                    patchMutation.mutate({ [key]: !enabled });
                  }}
                  disabled={!!systemTogglingKey}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                    isToggling ? 'bg-gray-500 cursor-wait' : enabled ? 'bg-green-500' : 'bg-gray-600'
                  }`}
                >
                  {isToggling ? (
                    <Loader2 className="w-3 h-3 text-gray-900 dark:text-white animate-spin mx-auto" />
                  ) : (
                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
            <ToggleLeft className="w-8 h-8 text-green-500" />
            Feature Toggles
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            Enable or disable exchange features
          </p>
        </div>
        <div className="flex items-center gap-3">
          {features.length === 0 && (
            <button
              onClick={initializeFeatures}
              disabled={initializing}
              className="px-4 py-2 bg-green-600 text-gray-900 dark:text-white rounded-lg hover:bg-green-700 flex items-center gap-2"
            >
              {initializing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              Initialize All Features
            </button>
          )}
          <button
            onClick={() => fetchFeatures(true)}
            className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-white rounded-lg hover:bg-gray-600 flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
          <div className="text-gray-400 text-sm">Total Features</div>
          <div className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{totalFeatures}</div>
        </div>
        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
          <div className="text-gray-400 text-sm">Enabled</div>
          <div className="text-2xl font-bold text-green-400 mt-1">{totalEnabled}</div>
        </div>
        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
          <div className="text-gray-400 text-sm">Disabled</div>
          <div className="text-2xl font-bold text-red-400 mt-1">{totalFeatures - totalEnabled}</div>
        </div>
        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
          <div className="text-gray-400 text-sm">Categories</div>
          <div className="text-2xl font-bold text-blue-400 mt-1">{categories.length}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
        <div className="flex items-center gap-4 flex-wrap">
          {/* Search */}
          <div className="relative flex-1 min-w-[250px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 dark:text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search features..."
              className="w-full pl-10 pr-4 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-600 rounded-lg text-gray-900 dark:text-white text-sm"
            />
          </div>

          {/* Category Filter */}
          <div className="relative">
            <button
              onClick={() => setShowCategoryDropdown(!showCategoryDropdown)}
              className="flex items-center gap-2 px-4 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-600 rounded-lg text-gray-900 dark:text-white hover:bg-gray-600 min-w-[200px]"
            >
              <Filter className="w-4 h-4 text-gray-500 dark:text-gray-400" />
              <span className="flex-1 text-left">
                {selectedCategory === 'all' ? 'All Categories' : categoryLabels[selectedCategory] || selectedCategory}
              </span>
              <ChevronDown className={`w-4 h-4 transition-transform ${showCategoryDropdown ? 'rotate-180' : ''}`} />
            </button>

            {showCategoryDropdown && (
              <div className="absolute top-full left-0 mt-1 w-64 bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl z-50 max-h-96 overflow-y-auto">
                <button
                  onClick={() => { setSelectedCategory('all'); setShowCategoryDropdown(false); }}
                  className={`w-full px-4 py-2.5 text-left hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center justify-between ${
                    selectedCategory === 'all' ? 'bg-gray-100 dark:bg-gray-700/50 text-white' : 'text-gray-300'
                  }`}
                >
                  <span>All Categories</span>
                  <span className="text-xs text-gray-500">{totalFeatures}</span>
                </button>
                <div className="border-t border-gray-200 dark:border-gray-700" />
                {categories.map(cat => (
                  <button
                    key={cat.category}
                    onClick={() => { setSelectedCategory(cat.category); setShowCategoryDropdown(false); }}
                    className={`w-full px-4 py-2.5 text-left hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center justify-between ${
                      selectedCategory === cat.category ? 'bg-gray-100 dark:bg-gray-700/50 text-white' : 'text-gray-300'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {categoryIcons[cat.category]}
                      <span>{categoryLabels[cat.category] || cat.category}</span>
                    </div>
                    <span className="text-xs text-gray-500">{cat.enabled}/{cat.total}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {(selectedCategory !== 'all' || searchQuery) && (
            <button
              onClick={() => { setSelectedCategory('all'); setSearchQuery(''); }}
              className="px-3 py-2 text-gray-400 hover:text-gray-900 dark:hover:text-white text-sm"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Features List */}
      <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Features</h2>
          <span className="text-sm text-gray-500 dark:text-gray-400">{features.length} of {total} loaded</span>
        </div>

        <div ref={tableRef} className="overflow-auto" style={{ maxHeight: 'calc(100vh - 450px)' }}>
          {Object.entries(groupedFeatures).map(([category, categoryFeatures]) => (
            <div key={category} className="border-b border-gray-200 dark:border-gray-700 last:border-0">
              {/* Category Header */}
              <div className="px-5 py-3 bg-gray-900/50 flex items-center justify-between sticky top-0 z-10">
                <div className="flex items-center gap-3">
                  {categoryIcons[category] || <Settings className="w-4 h-4" />}
                  <span className="font-medium text-gray-900 dark:text-white">{categoryLabels[category] || category}</span>
                  <span className="text-xs text-gray-500">
                    ({categoryFeatures.filter(f => f.is_enabled).length}/{categoryFeatures.length})
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => toggleCategory(category, true)}
                    className="px-2 py-1 text-xs bg-green-500/20 text-green-400 rounded hover:bg-green-500/30"
                  >
                    Enable All
                  </button>
                  <button
                    onClick={() => toggleCategory(category, false)}
                    className="px-2 py-1 text-xs bg-red-500/20 text-red-400 rounded hover:bg-red-500/30"
                  >
                    Disable All
                  </button>
                </div>
              </div>

              {/* Features in Category */}
              <div className="divide-y divide-gray-700/50">
                {categoryFeatures.map(feature => (
                  <div 
                    key={feature.id} 
                    className={`px-5 py-3 flex items-center justify-between hover:bg-gray-100 dark:hover:bg-gray-700/20 ${
                      !feature.is_enabled ? 'opacity-60' : ''
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900 dark:text-white">{feature.feature_name}</span>
                        {feature.is_critical && (
                          <span title="Critical Feature"><AlertTriangle className="w-3.5 h-3.5 text-yellow-500" /></span>
                        )}
                      </div>
                      {feature.description && (
                        <p className="text-xs text-gray-500 mt-0.5">{feature.description}</p>
                      )}
                      <p className="text-[10px] text-gray-600 mt-0.5 font-mono">{feature.feature_key}</p>
                    </div>
                    <ToggleSwitch
                      enabled={feature.is_enabled}
                      onToggle={() => toggleFeature(feature.id)}
                      isLoading={toggling === feature.id}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* Loading more */}
          {loadingMore && (
            <div className="py-4 flex items-center justify-center gap-2 text-gray-500 dark:text-gray-400">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>Loading more...</span>
            </div>
          )}

          {/* End of list */}
          {!hasMore && features.length > 0 && (
            <div className="py-4 text-center text-gray-500 text-sm">
              All {total} features loaded
            </div>
          )}

          {/* Empty state */}
          {features.length === 0 && !loading && (
            <div className="py-12 text-center">
              <ToggleLeft className="w-12 h-12 text-gray-600 mx-auto mb-3" />
              <p className="text-gray-500 mb-4">No features configured</p>
              <button
                onClick={initializeFeatures}
                disabled={initializing}
                className="px-4 py-2 bg-green-600 text-gray-900 dark:text-white rounded-lg hover:bg-green-700"
              >
                {initializing ? 'Initializing...' : 'Initialize Default Features'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Click outside to close dropdown */}
      {showCategoryDropdown && (
        <div className="fixed inset-0 z-40" onClick={() => setShowCategoryDropdown(false)} />
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-4 right-4 px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 z-50 ${
          toast.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
        }`}>
          {toast.type === 'success' ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
          {toast.message}
        </div>
      )}
    </div>
  );
}
