'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { toast } from '@/components/ui/toaster';
import { 
  Users, Plus, Edit2, Trash2, Search, Loader2, Save, 
  Check, X, Coins, ArrowLeftRight, AlertCircle
} from 'lucide-react';

interface P2PAsset {
  id: string;
  currency_id: string;
  is_active: boolean;
  min_amount: string;
  max_amount: string;
  price_precision: number;
  amount_precision: number;
  maker_fee: string;
  taker_fee: string;
  display_order: number;
  symbol: string;
  name: string;
  logo_url: string | null;
  currency_type: string;
}

interface Currency {
  id: string;
  symbol: string;
  name: string;
  logo_url: string | null;
  currency_type: string;
}

export default function P2PAssetsPage() {
  const { accessToken } = useAdminAuthStore();
  const [p2pAssets, setP2pAssets] = useState<P2PAsset[]>([]);
  const [availableCurrencies, setAvailableCurrencies] = useState<Currency[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingAsset, setEditingAsset] = useState<P2PAsset | null>(null);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  
  // Delete Confirmation Modal State
  const [deleteModal, setDeleteModal] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  
  // Toast State (inline notifications; use imported toast() for API feedback)
  const [toastState, setToastState] = useState<{ show: boolean; message: string; type: 'success' | 'error' } | null>(null);
  
  // Success Modal State for Add
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [addedAsset, setAddedAsset] = useState<{ symbol: string; name: string; logo_url: string } | null>(null);
  
  // Infinite scroll pagination state
  const [assetsOffset, setAssetsOffset] = useState(0);
  const [assetsHasMore, setAssetsHasMore] = useState(true);
  const [assetsTotal, setAssetsTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const loadingMoreRef = useRef(false);

  const apiUrl = getApiBaseUrl();
  
  // Show toast helper
  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToastState({ show: true, message, type });
    setTimeout(() => setToastState(null), 3000);
  };

  const fetchP2PAssets = async (reset = true) => {
    if (!accessToken) return;
    try {
      const offset = reset ? 0 : assetsOffset;
      const response = await fetch(`${apiUrl}/api/v1/admin/settings/p2p-assets?limit=20&offset=${offset}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const result = await response.json();
      if (result.success) {
        if (reset) {
          setP2pAssets(result.data.p2p_assets);
          setAssetsOffset(result.data.p2p_assets.length);
        } else {
          setP2pAssets(prev => [...prev, ...result.data.p2p_assets]);
          setAssetsOffset(prev => prev + result.data.p2p_assets.length);
        }
        setAssetsTotal(result.data.total);
        setAssetsHasMore(result.data.hasMore);
      }
    } catch (error) {
      console.error('Failed to fetch P2P assets:', error);
    }
  };

  const fetchAvailableCurrencies = async () => {
    if (!accessToken) return;
    try {
      const response = await fetch(`${apiUrl}/api/v1/admin/settings/available-p2p-currencies`, {
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

  // Load more function
  const loadMoreAssets = useCallback(async () => {
    if (loadingMoreRef.current || !assetsHasMore) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    
    try {
      const response = await fetch(`${apiUrl}/api/v1/admin/settings/p2p-assets?limit=20&offset=${assetsOffset}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const result = await response.json();
      if (result.success) {
        setP2pAssets(prev => [...prev, ...result.data.p2p_assets]);
        setAssetsOffset(prev => prev + result.data.p2p_assets.length);
        setAssetsHasMore(result.data.hasMore);
        setAssetsTotal(result.data.total);
      }
    } catch (error) {
      console.error('Failed to load more assets:', error);
    } finally {
      setLoadingMore(false);
      loadingMoreRef.current = false;
    }
  }, [assetsOffset, assetsHasMore, accessToken, apiUrl]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      await fetchP2PAssets(true);
      await fetchAvailableCurrencies();
      setLoading(false);
    };
    load();
  }, [accessToken]);

  // Infinite scroll listener
  useEffect(() => {
    const container = tableContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      if (scrollHeight - scrollTop - clientHeight < 150 && assetsHasMore && !loadingMoreRef.current) {
        loadMoreAssets();
      }
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [loadMoreAssets, assetsHasMore]);

  const toggleAssetStatus = async (id: string) => {
    if (toggling) return;
    setToggling(id);
    try {
      const response = await fetch(`${apiUrl}/api/v1/admin/settings/p2p-assets/${id}/toggle`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const result = await response.json();
      if (result.success) {
        setP2pAssets(prev => prev.map(a => 
          a.id === id ? { ...a, is_active: result.data.p2p_asset.is_active } : a
        ));
      }
    } catch (error) {
      console.error('Failed to toggle asset:', error);
    } finally {
      setToggling(null);
    }
  };

  const deleteAsset = async (id: string) => {
    setDeleting(true);
    try {
      const response = await fetch(`${apiUrl}/api/v1/admin/settings/p2p-assets/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const result = await response.json();
      if (result.success) {
        setP2pAssets(prev => prev.filter(a => a.id !== id));
        await fetchAvailableCurrencies();
        setDeleteModal(null);
        showToast('P2P asset removed successfully!', 'success');
      } else {
        showToast(result.error?.message || 'Failed to remove asset', 'error');
      }
    } catch (error) {
      console.error('Failed to delete asset:', error);
      showToast('Failed to remove P2P asset', 'error');
    } finally {
      setDeleting(false);
    }
  };

  // Toggle Switch Component
  const ToggleSwitch = ({ enabled, onToggle, isLoading }: { enabled: boolean; onToggle: () => void; isLoading: boolean }) => (
    <button
      onClick={onToggle}
      disabled={isLoading}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
        enabled ? 'bg-green-600' : 'bg-gray-600'
      } ${isLoading ? 'opacity-50' : ''}`}
    >
      {isLoading ? (
        <Loader2 className="w-4 h-4 text-gray-900 dark:text-white animate-spin mx-auto" />
      ) : (
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          enabled ? 'translate-x-6' : 'translate-x-1'
        }`} />
      )}
    </button>
  );

  // Get logo URL helper
  const getLogoUrl = (item: { logo_url?: string | null; symbol: string }) => {
    if (item.logo_url) return item.logo_url;
    return `/assets/upload/currency-logo/${item.symbol.toLowerCase()}.svg`;
  };

  const getLogoFallback = (symbol: string) => 
    `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="%23374151"/><text x="20" y="25" text-anchor="middle" fill="white" font-size="12" font-weight="bold">${symbol.slice(0, 2)}</text></svg>`;

  // Add Asset Modal
  const AddAssetModal = ({ onClose }: { onClose: () => void }) => {
    const [search, setSearch] = useState('');
    const [selectedCurrency, setSelectedCurrency] = useState<string | null>(null);
    const [step, setStep] = useState<'select' | 'configure'>('select');
    const [config, setConfig] = useState({
      min_amount: '0',
      max_amount: '999999999',
      price_precision: '2',
      amount_precision: '8',
      maker_fee: '0',
      taker_fee: '0',
    });

    const filteredCurrencies = availableCurrencies.filter(c =>
      c.symbol.toLowerCase().includes(search.toLowerCase()) ||
      c.name.toLowerCase().includes(search.toLowerCase())
    );

    const selectedCurrencyData = availableCurrencies.find(c => c.id === selectedCurrency);

    const handleAdd = async () => {
      if (!selectedCurrency || !selectedCurrencyData) return;
      setSaving(true);
      
      // Capture asset info before closing
      const assetInfo = {
        symbol: selectedCurrencyData.symbol,
        name: selectedCurrencyData.name,
        logo_url: selectedCurrencyData.logo_url || '',
      };
      
      try {
        const response = await fetch(`${apiUrl}/api/v1/admin/settings/p2p-assets`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            currency_id: selectedCurrency,
            ...config,
            price_precision: parseInt(config.price_precision),
            amount_precision: parseInt(config.amount_precision),
          }),
        });
        const result = await response.json();
        if (result.success) {
          // Close this modal
          onClose();
          
          // Show success modal
          setAddedAsset(assetInfo);
          setShowSuccessModal(true);
          
          // Refresh data
          fetchP2PAssets();
          fetchAvailableCurrencies();
        } else {
          toast({ title: 'Error', description: result.error?.message || 'Failed to add', variant: 'destructive' });
        }
      } catch (error) {
        console.error('Error:', error);
        showToast('Failed to add P2P asset', 'error');
      } finally {
        setSaving(false);
      }
    };

    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col">
          <div className="p-6 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">Add P2P Asset</h2>
            <p className="text-sm text-gray-400 mt-1">
              {step === 'select' ? 'Select a currency to enable for P2P trading' : `Configure ${selectedCurrencyData?.symbol} settings`}
            </p>
          </div>

          {step === 'select' ? (
            <>
              <div className="p-4 border-b border-gray-200 dark:border-gray-700">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 dark:text-gray-400" />
                  <input
                    type="text"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search currencies..."
                    className="w-full pl-10 pr-4 py-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-600 rounded-lg text-gray-900 dark:text-white text-sm"
                    autoFocus
                  />
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
                      onError={(e) => { (e.target as HTMLImageElement).src = getLogoFallback(currency.symbol); }}
                    />
                    <div className="flex-1 text-left">
                      <div className="font-semibold">{currency.symbol}</div>
                      <div className="text-sm opacity-70">{currency.name}</div>
                    </div>
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                      currency.currency_type === 'stablecoin' ? 'bg-green-500/20 text-green-400' :
                      currency.currency_type === 'fiat' ? 'bg-yellow-500/20 text-yellow-400' :
                      'bg-blue-500/20 text-blue-400'
                    }`}>
                      {currency.currency_type}
                    </span>
                    {selectedCurrency === currency.id && <Check className="w-5 h-5" />}
                  </button>
                ))}
                {filteredCurrencies.length === 0 && (
                  <div className="text-center py-8 text-gray-500">
                    <Coins className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p>No currencies available</p>
                  </div>
                )}
              </div>

              <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex gap-3">
                <button onClick={onClose} className="flex-1 px-4 py-2.5 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-white rounded-lg hover:bg-gray-600">
                  Cancel
                </button>
                <button
                  onClick={() => setStep('configure')}
                  disabled={!selectedCurrency}
                  className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  Next: Configure
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {/* Selected Currency Preview */}
                <div className="flex items-center gap-3 p-4 bg-gray-100 dark:bg-gray-700/50 rounded-lg">
                  <img 
                    src={getLogoUrl(selectedCurrencyData!)} 
                    alt={selectedCurrencyData?.symbol}
                    className="w-12 h-12 rounded-full"
                    onError={(e) => { (e.target as HTMLImageElement).src = getLogoFallback(selectedCurrencyData?.symbol || ''); }}
                  />
                  <div>
                    <div className="font-bold text-gray-900 dark:text-white text-lg">{selectedCurrencyData?.symbol}</div>
                    <div className="text-sm text-gray-500 dark:text-gray-400">{selectedCurrencyData?.name}</div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Min Amount</label>
                    <input
                      type="text"
                      value={config.min_amount}
                      onChange={e => setConfig(prev => ({ ...prev, min_amount: e.target.value }))}
                      className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-600 rounded-lg text-gray-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Max Amount</label>
                    <input
                      type="text"
                      value={config.max_amount}
                      onChange={e => setConfig(prev => ({ ...prev, max_amount: e.target.value }))}
                      className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-600 rounded-lg text-gray-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Price Precision</label>
                    <input
                      type="number"
                      value={config.price_precision}
                      onChange={e => setConfig(prev => ({ ...prev, price_precision: e.target.value }))}
                      className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-600 rounded-lg text-gray-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Amount Precision</label>
                    <input
                      type="number"
                      value={config.amount_precision}
                      onChange={e => setConfig(prev => ({ ...prev, amount_precision: e.target.value }))}
                      className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-600 rounded-lg text-gray-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Maker Fee (%)</label>
                    <input
                      type="text"
                      value={config.maker_fee}
                      onChange={e => setConfig(prev => ({ ...prev, maker_fee: e.target.value }))}
                      className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-600 rounded-lg text-gray-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Taker Fee (%)</label>
                    <input
                      type="text"
                      value={config.taker_fee}
                      onChange={e => setConfig(prev => ({ ...prev, taker_fee: e.target.value }))}
                      className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-600 rounded-lg text-gray-900 dark:text-white"
                    />
                  </div>
                </div>
              </div>

              <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex gap-3">
                <button onClick={() => setStep('select')} className="flex-1 px-4 py-2.5 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-white rounded-lg hover:bg-gray-600">
                  Back
                </button>
                <button
                  onClick={handleAdd}
                  disabled={saving}
                  className="flex-1 px-4 py-2.5 bg-green-600 text-gray-900 dark:text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  Add to P2P
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  };

  // Edit Asset Modal
  const EditAssetModal = ({ asset, onClose }: { asset: P2PAsset; onClose: () => void }) => {
    const [form, setForm] = useState({
      min_amount: asset.min_amount,
      max_amount: asset.max_amount,
      price_precision: asset.price_precision.toString(),
      amount_precision: asset.amount_precision.toString(),
      maker_fee: asset.maker_fee,
      taker_fee: asset.taker_fee,
    });

    const handleSave = async () => {
      setSaving(true);
      try {
        const response = await fetch(`${apiUrl}/api/v1/admin/settings/p2p-assets/${asset.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            ...form,
            price_precision: parseInt(form.price_precision),
            amount_precision: parseInt(form.amount_precision),
          }),
        });
        const result = await response.json();
        if (result.success) {
          await fetchP2PAssets();
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
            <div className="flex items-center gap-3">
              <img 
                src={getLogoUrl(asset)} 
                alt={asset.symbol}
                className="w-10 h-10 rounded-full"
                onError={(e) => { (e.target as HTMLImageElement).src = getLogoFallback(asset.symbol); }}
              />
              <div>
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">Edit {asset.symbol}</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">{asset.name}</p>
              </div>
            </div>
          </div>

          <div className="p-4 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Min Amount</label>
                <input
                  type="text"
                  value={form.min_amount}
                  onChange={e => setForm(prev => ({ ...prev, min_amount: e.target.value }))}
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-600 rounded-lg text-gray-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Max Amount</label>
                <input
                  type="text"
                  value={form.max_amount}
                  onChange={e => setForm(prev => ({ ...prev, max_amount: e.target.value }))}
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-600 rounded-lg text-gray-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Price Precision</label>
                <input
                  type="number"
                  value={form.price_precision}
                  onChange={e => setForm(prev => ({ ...prev, price_precision: e.target.value }))}
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-600 rounded-lg text-gray-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Amount Precision</label>
                <input
                  type="number"
                  value={form.amount_precision}
                  onChange={e => setForm(prev => ({ ...prev, amount_precision: e.target.value }))}
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-600 rounded-lg text-gray-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Maker Fee (%)</label>
                <input
                  type="text"
                  value={form.maker_fee}
                  onChange={e => setForm(prev => ({ ...prev, maker_fee: e.target.value }))}
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-600 rounded-lg text-gray-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Taker Fee (%)</label>
                <input
                  type="text"
                  value={form.taker_fee}
                  onChange={e => setForm(prev => ({ ...prev, taker_fee: e.target.value }))}
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-600 rounded-lg text-gray-900 dark:text-white"
                />
              </div>
            </div>
          </div>

          <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex gap-3">
            <button onClick={onClose} className="flex-1 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-white rounded-lg hover:bg-gray-600">
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save Changes
            </button>
          </div>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-orange-500/20 rounded-lg">
            <ArrowLeftRight className="w-6 h-6 text-orange-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">P2P Assets</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">Manage which assets can be traded via P2P</p>
          </div>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-orange-600 text-gray-900 dark:text-white rounded-lg hover:bg-orange-700"
        >
          <Plus className="w-4 h-4" />
          Add P2P Asset
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
          <div className="text-sm text-gray-500 dark:text-gray-400">Total P2P Assets</div>
          <div className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{p2pAssets.length}</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
          <div className="text-sm text-gray-500 dark:text-gray-400">Active Assets</div>
          <div className="text-2xl font-bold text-green-400 mt-1">
            {p2pAssets.filter(a => a.is_active).length}
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
          <div className="text-sm text-gray-500 dark:text-gray-400">Inactive Assets</div>
          <div className="text-2xl font-bold text-gray-400 mt-1">
            {p2pAssets.filter(a => !a.is_active).length}
          </div>
        </div>
      </div>

      {/* Assets Table */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col">
        {/* Table Header with count */}
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between flex-shrink-0">
          <span className="text-gray-400 text-sm">
            {p2pAssets.length}{assetsTotal > 0 ? ` of ${assetsTotal}` : ''} assets
          </span>
        </div>
        
        {p2pAssets.length === 0 && !loading ? (
          <div className="text-center py-16">
            <Users className="w-16 h-16 text-gray-600 mx-auto mb-4" />
            <h3 className="text-xl font-medium text-gray-400 mb-2">No P2P Assets</h3>
            <p className="text-gray-500 mb-4">Add assets to enable P2P trading</p>
            <button
              onClick={() => setShowAddModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-gray-900 dark:text-white rounded-lg hover:bg-orange-700"
            >
              <Plus className="w-4 h-4" />
              Add First Asset
            </button>
          </div>
        ) : (
          <div 
            ref={tableContainerRef}
            className="overflow-auto"
          >
            <table className="w-full">
              <thead className="sticky top-0 z-10">
                <tr className="bg-gray-50 dark:bg-gray-50 dark:bg-gray-900">
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Asset</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase">Min Amount</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase">Max Amount</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase">Price Prec.</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase">Maker Fee</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase">Taker Fee</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase">Active</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {p2pAssets.map(asset => (
                  <tr key={asset.id} className="hover:bg-gray-100 dark:hover:bg-gray-100 dark:bg-gray-700/30">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <img 
                          src={getLogoUrl(asset)} 
                          alt={asset.symbol}
                          className="w-8 h-8 rounded-full"
                          onError={(e) => { (e.target as HTMLImageElement).src = getLogoFallback(asset.symbol); }}
                        />
                        <div>
                          <div className="font-medium text-gray-900 dark:text-white">{asset.symbol}</div>
                          <div className="text-xs text-gray-500">{asset.name}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center text-gray-700 dark:text-gray-300">{parseFloat(asset.min_amount).toLocaleString()}</td>
                    <td className="px-4 py-3 text-center text-gray-700 dark:text-gray-300">{parseFloat(asset.max_amount).toLocaleString()}</td>
                    <td className="px-4 py-3 text-center text-gray-700 dark:text-gray-300">{asset.price_precision}</td>
                    <td className="px-4 py-3 text-center text-gray-700 dark:text-gray-300">{parseFloat(asset.maker_fee) * 100}%</td>
                    <td className="px-4 py-3 text-center text-gray-700 dark:text-gray-300">{parseFloat(asset.taker_fee) * 100}%</td>
                    <td className="px-4 py-3 text-center">
                      <ToggleSwitch
                        enabled={asset.is_active}
                        onToggle={() => toggleAssetStatus(asset.id)}
                        isLoading={toggling === asset.id}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => setEditingAsset(asset)}
                          className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-600 rounded text-gray-400 hover:text-gray-900 dark:text-white"
                          title="Edit"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setDeleteModal({ id: asset.id, name: asset.symbol })}
                          className="p-1.5 hover:bg-red-500/20 rounded text-gray-400 hover:text-red-400"
                          title="Delete"
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
            {!assetsHasMore && p2pAssets.length > 0 && (
              <div className="py-4 text-center text-gray-500 text-sm">
                All {assetsTotal} assets loaded
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modals */}
      {showAddModal && <AddAssetModal onClose={() => setShowAddModal(false)} />}
      {editingAsset && <EditAssetModal asset={editingAsset} onClose={() => setEditingAsset(null)} />}
      
      {/* Delete Confirmation Modal */}
      {deleteModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl border border-gray-200 dark:border-gray-700">
            {/* Header */}
            <div className="p-6 text-center">
              <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <Trash2 className="w-8 h-8 text-red-500" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Remove P2P Asset</h3>
              <p className="text-gray-500 dark:text-gray-400">
                Are you sure you want to remove <span className="text-gray-900 dark:text-white font-semibold">{deleteModal.name}</span> from P2P trading?
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
                onClick={() => deleteAsset(deleteModal.id)}
                disabled={deleting}
                className="flex-1 px-4 py-2.5 bg-red-600 text-gray-900 dark:text-white rounded-lg hover:bg-red-700 disabled:opacity-50 font-medium flex items-center justify-center gap-2"
              >
                {deleting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Removing...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    Remove
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Success Modal for Add */}
      {showSuccessModal && addedAsset && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gradient-to-b from-gray-800 to-gray-900 rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl border border-gray-700/50">
            {/* Success Header */}
            <div className="relative bg-gradient-to-r from-green-600 to-emerald-600 p-6 text-center">
              <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-3 backdrop-blur-sm">
                <Check className="w-10 h-10 text-gray-900 dark:text-white" strokeWidth={3} />
              </div>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Asset Added!</h2>
              <p className="text-green-100 mt-1">Successfully added to P2P</p>
            </div>
            
            {/* Asset Info */}
            <div className="p-6">
              <div className="flex items-center gap-4 p-4 bg-gray-800/50 rounded-xl border border-gray-700/50">
                <img 
                  src={addedAsset.logo_url || `/assets/upload/currency-logo/${addedAsset.symbol.toLowerCase()}.svg`}
                  alt={addedAsset.symbol}
                  className="w-14 h-14 rounded-full bg-gray-700 ring-2 ring-gray-600"
                  onError={(e) => { 
                    (e.target as HTMLImageElement).src = `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="%23374151"/><text x="20" y="25" text-anchor="middle" fill="white" font-size="12" font-weight="bold">${addedAsset.symbol.slice(0, 2)}</text></svg>`; 
                  }}
                />
                <div>
                  <div className="text-xl font-bold text-gray-900 dark:text-white">{addedAsset.symbol}</div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">{addedAsset.name}</div>
                  <div className="text-xs text-green-400 mt-1 flex items-center gap-1">
                    <ArrowLeftRight className="w-3 h-3" />
                    Now available for P2P trading
                  </div>
                </div>
              </div>
            </div>
            
            {/* Footer */}
            <div className="p-4 border-t border-gray-700/50 bg-gray-800/30">
              <button
                onClick={() => {
                  setShowSuccessModal(false);
                  setAddedAsset(null);
                }}
                className="w-full py-3 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-gray-900 dark:text-white rounded-xl font-semibold transition-all shadow-lg shadow-green-600/20 flex items-center justify-center gap-2"
              >
                <Check className="w-5 h-5" />
                Done
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Toast Notification */}
      {toastState && (
        <div className="fixed bottom-4 right-4 z-50 animate-in slide-in-from-bottom-4 fade-in duration-300">
          <div className={`flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg ${
            toastState.type === 'success' 
              ? 'bg-green-600 text-white' 
              : 'bg-red-600 text-white'
          }`}>
            {toastState.type === 'success' ? (
              <Check className="w-5 h-5" />
            ) : (
              <AlertCircle className="w-5 h-5" />
            )}
            <span className="font-medium">{toastState.message}</span>
            <button 
              onClick={() => setToastState(null)}
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
