'use client';

import { useState, useEffect } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { toast } from '@/components/ui/toaster';
import { 
  Globe, Plus, Edit2, Trash2, ChevronDown, ChevronRight, 
  Check, X, Loader2, Save, AlertCircle, Coins,
  ArrowUpDown, Link, Clock, Shield, Settings
} from 'lucide-react';

interface Blockchain {
  id: string;
  chain_name: string;
  chain_symbol: string;
  chain_id: number | null;
  network_type: string;
  rpc_endpoints: any;
  explorer_url: string | null;
  derivation_path: string | null;
  address_format: string | null;
  required_confirmations: number;
  is_active: boolean;
  deposit_enabled: boolean;
  withdrawal_enabled: boolean;
  avg_block_time: number;
  gas_limit_default: string | null;
  logo_url: string | null;
  created_at: string;
  currencies: Currency[];
  currency_count: string;
}

interface Currency {
  id: string;
  symbol: string;
  name: string;
  currency_type: string;
  blockchain_id: string | null;
  contract_address: string | null;
  decimals: number;
  display_decimals: number;
  logo_url: string | null;
  is_active: boolean;
  is_listed: boolean;
  deposit_enabled: boolean;
  withdrawal_enabled: boolean;
  min_deposit: string;
  min_withdrawal: string;
  withdrawal_fee: string;
  withdrawal_fee_type: string;
  max_daily_withdrawal: string | null;
  chain_name?: string;
  chain_symbol?: string;
}

export default function BlockchainSettingsPage() {
  const { accessToken } = useAdminAuthStore();
  const [blockchains, setBlockchains] = useState<Blockchain[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedChain, setExpandedChain] = useState<string | null>(null);
  const [showAddBlockchain, setShowAddBlockchain] = useState(false);
  const [showAddCurrency, setShowAddCurrency] = useState(false);
  const [editingBlockchain, setEditingBlockchain] = useState<Blockchain | null>(null);
  const [editingCurrency, setEditingCurrency] = useState<Currency | null>(null);
  const [selectedBlockchainId, setSelectedBlockchainId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const apiUrl = getApiBaseUrl();

  const fetchBlockchains = async () => {
    if (!accessToken) return;
    
    setLoading(true);
    try {
      const response = await fetch(`${apiUrl}/api/v1/admin/settings/blockchains`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const result = await response.json();
      if (result.success) {
        setBlockchains(result.data.blockchains);
      }
    } catch (error) {
      console.error('Failed to fetch blockchains:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBlockchains();
  }, [accessToken]);

  const [toggling, setToggling] = useState<string | null>(null);

  const toggleBlockchainSetting = async (id: string, field: string) => {
    if (toggling) return; // Prevent multiple clicks
    if (!accessToken) {
      toast({ title: 'Error', description: 'Not authenticated. Please login again.', variant: 'destructive' });
      return;
    }
    
    setToggling(`${id}-${field}`);
    
    try {
      const url = `${apiUrl}/api/v1/admin/settings/blockchains/${id}/toggle`;
      
      const response = await fetch(url, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ field }),
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }
      
      const result = await response.json();
      
      if (result.success) {
        // Preserve currencies when updating blockchain
        setBlockchains(prev => prev.map(b => 
          b.id === id ? { 
            ...b, 
            ...result.data.blockchain,
            currencies: b.currencies // Keep existing currencies
          } : b
        ));
      } else {
        toast({ title: 'Error', description: result.error?.message || 'Failed to update', variant: 'destructive' });
      }
    } catch (error: any) {
      toast({ title: 'Error', description: error.message || 'Network error', variant: 'destructive' });
    } finally {
      setToggling(null);
    }
  };

  const toggleCurrencySetting = async (id: string, field: string, blockchainId: string) => {
    if (toggling) return;
    setToggling(`${id}-${field}`);
    
    try {
      const response = await fetch(`${apiUrl}/api/v1/admin/settings/currencies/${id}/toggle`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ field }),
      });
      const result = await response.json();
      
      if (result.success) {
        // Update currency in the blockchain's currencies array
        setBlockchains(prev => prev.map(b => {
          if (b.id === blockchainId && b.currencies) {
            return {
              ...b,
              currencies: b.currencies.map(c => 
                c.id === id ? { ...c, ...result.data.currency } : c
              )
            };
          }
          return b;
        }));
      } else {
        console.error('Toggle failed:', result.error);
        toast({ title: 'Error', description: result.error?.message || 'Failed to update', variant: 'destructive' });
      }
    } catch (error) {
      console.error('Failed to toggle currency setting:', error);
      toast({ title: 'Error', description: 'Failed to update setting. Check console for details.', variant: 'destructive' });
    } finally {
      setToggling(null);
    }
  };

  const ToggleSwitch = ({ 
    enabled, 
    onToggle, 
    label,
    isLoading = false 
  }: { 
    enabled: boolean; 
    onToggle: () => void; 
    label?: string;
    isLoading?: boolean;
  }) => (
    <button
      onClick={onToggle}
      disabled={isLoading}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
        isLoading ? 'bg-gray-500 cursor-wait' : enabled ? 'bg-green-500' : 'bg-gray-600'
      }`}
      title={label}
    >
      {isLoading ? (
        <span className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="w-3 h-3 text-gray-900 dark:text-white animate-spin" />
        </span>
      ) : (
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
            enabled ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      )}
    </button>
  );

  const StatusBadge = ({ active }: { active: boolean }) => (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
      active ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
    }`}>
      {active ? 'Active' : 'Inactive'}
    </span>
  );

  // Add/Edit Blockchain Modal
  const BlockchainModal = ({ blockchain, onClose }: { blockchain?: Blockchain | null; onClose: () => void }) => {
    const [form, setForm] = useState({
      chain_name: blockchain?.chain_name || '',
      chain_symbol: blockchain?.chain_symbol || '',
      chain_id: blockchain?.chain_id?.toString() || '',
      network_type: blockchain?.network_type || 'mainnet',
      explorer_url: blockchain?.explorer_url || '',
      derivation_path: blockchain?.derivation_path || '',
      required_confirmations: blockchain?.required_confirmations?.toString() || '12',
      avg_block_time: blockchain?.avg_block_time?.toString() || '12',
      gas_limit_default: blockchain?.gas_limit_default?.toString() || '',
      logo_url: blockchain?.logo_url || '',
      is_active: blockchain?.is_active ?? true,
      deposit_enabled: blockchain?.deposit_enabled ?? true,
      withdrawal_enabled: blockchain?.withdrawal_enabled ?? true,
    });
    const [logoPreview, setLogoPreview] = useState<string | null>(blockchain?.logo_url || null);
    const [uploading, setUploading] = useState(false);

    const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      // Validate file type
      if (!['image/png', 'image/svg+xml'].includes(file.type)) {
        toast({ title: 'Validation', description: 'Only PNG and SVG files are allowed', variant: 'destructive' });
        return;
      }

      // Preview
      const reader = new FileReader();
      reader.onload = (ev) => setLogoPreview(ev.target?.result as string);
      reader.readAsDataURL(file);

      setUploading(true);
      try {
        const formData = new FormData();
        formData.append('file', file);

        // If blockchain exists, upload directly to its ID, else upload with symbol
        const uploadUrl = blockchain 
          ? `${apiUrl}/api/v1/upload/logo/blockchain/${blockchain.id}`
          : `${apiUrl}/api/v1/upload/logo/blockchain?symbol=${encodeURIComponent(form.chain_symbol || 'temp')}`;

        const response = await fetch(uploadUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
          },
          body: formData,
        });

        const result = await response.json();
        if (result.success) {
          setForm({ ...form, logo_url: result.data.logo_url });
          setLogoPreview(result.data.logo_url);
        } else {
          toast({ title: 'Error', description: result.error?.message || 'Upload failed', variant: 'destructive' });
        }
      } catch (error) {
        console.error('Upload error:', error);
        toast({ title: 'Error', description: 'Failed to upload logo', variant: 'destructive' });
      } finally {
        setUploading(false);
      }
    };

    const handleSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      setSaving(true);
      setError('');

      try {
        const url = blockchain 
          ? `${apiUrl}/api/v1/admin/settings/blockchains/${blockchain.id}`
          : `${apiUrl}/api/v1/admin/settings/blockchains`;
        
        const response = await fetch(url, {
          method: blockchain ? 'PUT' : 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            ...form,
            chain_id: form.chain_id ? parseInt(form.chain_id) : null,
            required_confirmations: parseInt(form.required_confirmations) || 12,
            avg_block_time: parseInt(form.avg_block_time) || 12,
            gas_limit_default: form.gas_limit_default ? parseInt(form.gas_limit_default) : null,
          }),
        });

        const result = await response.json();
        if (result.success) {
          fetchBlockchains();
          onClose();
        } else {
          setError(result.error?.message || 'Failed to save');
        }
      } catch (error) {
        setError('Failed to save blockchain');
      } finally {
        setSaving(false);
      }
    };

    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
          <div className="p-6 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">
              {blockchain ? 'Edit Blockchain' : 'Add New Blockchain'}
            </h2>
          </div>
          
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            {error && (
              <div className="p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-400 text-sm flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                {error}
              </div>
            )}

            {/* Logo Upload */}
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0">
                <label className="block text-sm text-gray-400 mb-1">Logo</label>
                <div className="relative w-20 h-20 bg-gray-700 rounded-xl border-2 border-dashed border-gray-600 flex items-center justify-center overflow-hidden group cursor-pointer">
                  {logoPreview ? (
                    <img src={logoPreview} alt="Logo preview" className="w-full h-full object-contain" />
                  ) : (
                    <span className="text-gray-500 text-2xl font-bold">
                      {form.chain_symbol.slice(0, 2) || '?'}
                    </span>
                  )}
                  {uploading && (
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-10">
                      <Loader2 className="w-6 h-6 text-gray-900 dark:text-white animate-spin" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity pointer-events-none">
                    <span className="text-gray-900 dark:text-white text-xs">Upload</span>
                  </div>
                  <input
                    type="file"
                    accept=".png,.svg,image/png,image/svg+xml"
                    onChange={handleLogoUpload}
                    className="absolute inset-0 opacity-0 cursor-pointer z-20"
                    disabled={uploading}
                  />
                </div>
                <p className="text-[10px] text-gray-500 mt-1 text-center">PNG/SVG</p>
              </div>
              <div className="flex-1">
                <label className="block text-sm text-gray-400 mb-1">Logo URL</label>
                <input
                  type="text"
                  value={form.logo_url}
                  onChange={e => {
                    setForm({ ...form, logo_url: e.target.value });
                    setLogoPreview(e.target.value || null);
                  }}
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-600 rounded-lg text-gray-900 dark:text-white text-sm"
                  placeholder="/assets/upload/blockchain-logo/example.svg"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Click logo to upload or enter URL manually
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Chain Name *</label>
                <input
                  type="text"
                  value={form.chain_name}
                  onChange={e => setForm({ ...form, chain_name: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-600 rounded-lg text-gray-900 dark:text-white"
                  placeholder="Ethereum"
                  required
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Chain Symbol *</label>
                <input
                  type="text"
                  value={form.chain_symbol}
                  onChange={e => setForm({ ...form, chain_symbol: e.target.value.toUpperCase() })}
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-600 rounded-lg text-gray-900 dark:text-white"
                  placeholder="ETH"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Chain ID</label>
                <input
                  type="number"
                  value={form.chain_id}
                  onChange={e => setForm({ ...form, chain_id: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-600 rounded-lg text-gray-900 dark:text-white"
                  placeholder="1"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Network Type</label>
                <select
                  value={form.network_type}
                  onChange={e => setForm({ ...form, network_type: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-600 rounded-lg text-gray-900 dark:text-white"
                >
                  <option value="mainnet">Mainnet</option>
                  <option value="testnet">Testnet</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">Explorer URL</label>
              <input
                type="url"
                value={form.explorer_url}
                onChange={e => setForm({ ...form, explorer_url: e.target.value })}
                className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-600 rounded-lg text-gray-900 dark:text-white"
                placeholder="https://etherscan.io"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">Derivation Path</label>
              <input
                type="text"
                value={form.derivation_path}
                onChange={e => setForm({ ...form, derivation_path: e.target.value })}
                className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-600 rounded-lg text-gray-900 dark:text-white"
                placeholder="m/44'/60'/0'/0"
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Confirmations</label>
                <input
                  type="number"
                  value={form.required_confirmations}
                  onChange={e => setForm({ ...form, required_confirmations: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-600 rounded-lg text-gray-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Block Time (sec)</label>
                <input
                  type="number"
                  value={form.avg_block_time}
                  onChange={e => setForm({ ...form, avg_block_time: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-600 rounded-lg text-gray-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Gas Limit</label>
                <input
                  type="number"
                  value={form.gas_limit_default}
                  onChange={e => setForm({ ...form, gas_limit_default: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-600 rounded-lg text-gray-900 dark:text-white"
                  placeholder="21000"
                />
              </div>
            </div>

            <div className="flex gap-6 pt-2">
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={e => setForm({ ...form, is_active: e.target.checked })}
                  className="w-4 h-4 rounded bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600"
                />
                Active
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={form.deposit_enabled}
                  onChange={e => setForm({ ...form, deposit_enabled: e.target.checked })}
                  className="w-4 h-4 rounded bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600"
                />
                Deposits
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={form.withdrawal_enabled}
                  onChange={e => setForm({ ...form, withdrawal_enabled: e.target.checked })}
                  className="w-4 h-4 rounded bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600"
                />
                Withdrawals
              </label>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-white rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {blockchain ? 'Update' : 'Create'}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  };

  // Add/Edit Currency Modal
  const CurrencyModal = ({ currency, blockchainId, onClose }: { currency?: Currency | null; blockchainId?: string | null; onClose: () => void }) => {
    const [form, setForm] = useState({
      symbol: currency?.symbol || '',
      name: currency?.name || '',
      currency_type: currency?.currency_type || 'crypto',
      blockchain_id: currency?.blockchain_id || blockchainId || '',
      contract_address: currency?.contract_address || '',
      decimals: currency?.decimals?.toString() || '18',
      display_decimals: currency?.display_decimals?.toString() || '8',
      logo_url: currency?.logo_url || '',
      min_deposit: currency?.min_deposit || '0',
      min_withdrawal: currency?.min_withdrawal || '0',
      withdrawal_fee: currency?.withdrawal_fee || '0',
      withdrawal_fee_type: currency?.withdrawal_fee_type || 'fixed',
      max_daily_withdrawal: currency?.max_daily_withdrawal || '',
      is_active: currency?.is_active ?? true,
      is_listed: currency?.is_listed ?? true,
      deposit_enabled: currency?.deposit_enabled ?? true,
      withdrawal_enabled: currency?.withdrawal_enabled ?? true,
    });
    const [logoPreview, setLogoPreview] = useState<string | null>(currency?.logo_url || null);
    const [uploading, setUploading] = useState(false);

    const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      // Validate file type
      if (!['image/png', 'image/svg+xml'].includes(file.type)) {
        toast({ title: 'Validation', description: 'Only PNG and SVG files are allowed', variant: 'destructive' });
        return;
      }

      // Preview
      const reader = new FileReader();
      reader.onload = (ev) => setLogoPreview(ev.target?.result as string);
      reader.readAsDataURL(file);

      setUploading(true);
      try {
        const formData = new FormData();
        formData.append('file', file);

        // If currency exists, upload directly to its ID, else upload with symbol
        const uploadUrl = currency 
          ? `${apiUrl}/api/v1/upload/logo/currency/${currency.id}`
          : `${apiUrl}/api/v1/upload/logo/currency?symbol=${encodeURIComponent(form.symbol || 'temp')}`;

        const response = await fetch(uploadUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
          },
          body: formData,
        });

        const result = await response.json();
        if (result.success) {
          setForm({ ...form, logo_url: result.data.logo_url });
          setLogoPreview(result.data.logo_url);
        } else {
          toast({ title: 'Error', description: result.error?.message || 'Upload failed', variant: 'destructive' });
        }
      } catch (error) {
        console.error('Upload error:', error);
        toast({ title: 'Error', description: 'Failed to upload logo', variant: 'destructive' });
      } finally {
        setUploading(false);
      }
    };

    const handleSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      setSaving(true);
      setError('');

      try {
        const url = currency
          ? `${apiUrl}/api/v1/admin/settings/currencies/${currency.id}`
          : `${apiUrl}/api/v1/admin/settings/currencies`;

        const response = await fetch(url, {
          method: currency ? 'PUT' : 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            ...form,
            decimals: parseInt(form.decimals) || 18,
            display_decimals: parseInt(form.display_decimals) || 8,
            blockchain_id: form.blockchain_id || null,
            max_daily_withdrawal: form.max_daily_withdrawal || null,
            logo_url: form.logo_url || `/assets/upload/currency-logo/${form.symbol.toLowerCase()}.svg`,
          }),
        });

        const result = await response.json();
        if (result.success) {
          fetchBlockchains();
          onClose();
        } else {
          setError(result.error?.message || 'Failed to save');
        }
      } catch (error) {
        setError('Failed to save currency');
      } finally {
        setSaving(false);
      }
    };

    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
          <div className="p-6 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">
              {currency ? 'Edit Currency' : 'Add New Currency'}
            </h2>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            {error && (
              <div className="p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-400 text-sm flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                {error}
              </div>
            )}

            {/* Logo Upload */}
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0">
                <label className="block text-sm text-gray-400 mb-1">Logo</label>
                <div className="relative w-16 h-16 bg-gray-700 rounded-xl border-2 border-dashed border-gray-600 flex items-center justify-center overflow-hidden group cursor-pointer">
                  {logoPreview || form.symbol ? (
                    <img 
                      src={logoPreview || `/assets/upload/currency-logo/${form.symbol.toLowerCase()}.svg`} 
                      alt="Logo" 
                      className="w-full h-full object-contain"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  ) : (
                    <span className="text-gray-500 text-lg font-bold">?</span>
                  )}
                  {uploading && (
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-10">
                      <Loader2 className="w-5 h-5 text-gray-900 dark:text-white animate-spin" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity pointer-events-none">
                    <span className="text-gray-900 dark:text-white text-xs">Upload</span>
                  </div>
                  <input
                    type="file"
                    accept=".png,.svg,image/png,image/svg+xml"
                    onChange={handleLogoUpload}
                    className="absolute inset-0 opacity-0 cursor-pointer z-20"
                    disabled={uploading}
                  />
                </div>
                <p className="text-[10px] text-gray-500 mt-1 text-center">PNG/SVG</p>
              </div>
              <div className="flex-1 space-y-3">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Logo URL</label>
                  <input
                    type="text"
                    value={form.logo_url}
                    onChange={e => {
                      setForm({ ...form, logo_url: e.target.value });
                      setLogoPreview(e.target.value || null);
                    }}
                    className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-600 rounded-lg text-gray-900 dark:text-white text-sm"
                    placeholder={`/assets/upload/currency-logo/${form.symbol.toLowerCase() || 'token'}.svg`}
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Symbol *</label>
                <input
                  type="text"
                  value={form.symbol}
                  onChange={e => setForm({ ...form, symbol: e.target.value.toUpperCase() })}
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-600 rounded-lg text-gray-900 dark:text-white"
                  placeholder="ETH"
                  required
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Name *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-600 rounded-lg text-gray-900 dark:text-white"
                  placeholder="Ethereum"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Type *</label>
                <select
                  value={form.currency_type}
                  onChange={e => setForm({ ...form, currency_type: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-600 rounded-lg text-gray-900 dark:text-white"
                >
                  <option value="crypto">Crypto</option>
                  <option value="stablecoin">Stablecoin</option>
                  <option value="fiat">Fiat</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Blockchain</label>
                <select
                  value={form.blockchain_id}
                  onChange={e => setForm({ ...form, blockchain_id: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-600 rounded-lg text-gray-900 dark:text-white"
                >
                  <option value="">None (Fiat)</option>
                  {blockchains.map(b => (
                    <option key={b.id} value={b.id}>{b.chain_name} ({b.chain_symbol})</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">Contract Address</label>
              <input
                type="text"
                value={form.contract_address}
                onChange={e => setForm({ ...form, contract_address: e.target.value })}
                className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-600 rounded-lg text-gray-900 dark:text-white font-mono text-sm"
                placeholder="0x..."
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Decimals</label>
                <input
                  type="number"
                  value={form.decimals}
                  onChange={e => setForm({ ...form, decimals: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-600 rounded-lg text-gray-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Display Decimals</label>
                <input
                  type="number"
                  value={form.display_decimals}
                  onChange={e => setForm({ ...form, display_decimals: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-600 rounded-lg text-gray-900 dark:text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Min Deposit</label>
                <input
                  type="text"
                  value={form.min_deposit}
                  onChange={e => setForm({ ...form, min_deposit: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-600 rounded-lg text-gray-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Min Withdrawal</label>
                <input
                  type="text"
                  value={form.min_withdrawal}
                  onChange={e => setForm({ ...form, min_withdrawal: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-600 rounded-lg text-gray-900 dark:text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Withdrawal Fee</label>
                <input
                  type="text"
                  value={form.withdrawal_fee}
                  onChange={e => setForm({ ...form, withdrawal_fee: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-600 rounded-lg text-gray-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Fee Type</label>
                <select
                  value={form.withdrawal_fee_type}
                  onChange={e => setForm({ ...form, withdrawal_fee_type: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-600 rounded-lg text-gray-900 dark:text-white"
                >
                  <option value="fixed">Fixed</option>
                  <option value="percentage">Percentage</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Max Daily Withdrawal</label>
                <input
                  type="text"
                  value={form.max_daily_withdrawal}
                  onChange={e => setForm({ ...form, max_daily_withdrawal: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-600 rounded-lg text-gray-900 dark:text-white"
                  placeholder="Unlimited"
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-4 pt-2">
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={e => setForm({ ...form, is_active: e.target.checked })}
                  className="w-4 h-4 rounded bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600"
                />
                Active
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={form.is_listed}
                  onChange={e => setForm({ ...form, is_listed: e.target.checked })}
                  className="w-4 h-4 rounded bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600"
                />
                Listed
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={form.deposit_enabled}
                  onChange={e => setForm({ ...form, deposit_enabled: e.target.checked })}
                  className="w-4 h-4 rounded bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600"
                />
                Deposits
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={form.withdrawal_enabled}
                  onChange={e => setForm({ ...form, withdrawal_enabled: e.target.checked })}
                  className="w-4 h-4 rounded bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600"
                />
                Withdrawals
              </label>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-white rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {currency ? 'Update' : 'Create'}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  };

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
            <Globe className="w-8 h-8 text-blue-500" />
            Blockchain Settings
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            Manage blockchains and their currencies
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => setShowAddCurrency(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
          >
            <Coins className="w-4 h-4" />
            Add Currency
          </button>
          <button
            onClick={() => setShowAddBlockchain(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Add Blockchain
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
          <div className="text-gray-400 text-sm">Total Blockchains</div>
          <div className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{blockchains.length}</div>
        </div>
        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
          <div className="text-gray-400 text-sm">Active Chains</div>
          <div className="text-2xl font-bold text-green-400 mt-1">
            {blockchains.filter(b => b.is_active).length}
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
          <div className="text-gray-400 text-sm">Total Currencies</div>
          <div className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
            {blockchains.reduce((sum, b) => sum + (b.currencies?.length || 0), 0)}
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
          <div className="text-gray-400 text-sm">Deposits Enabled</div>
          <div className="text-2xl font-bold text-blue-400 mt-1">
            {blockchains.filter(b => b.deposit_enabled).length}
          </div>
        </div>
      </div>

      {/* Blockchain Table */}
      <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Blockchains</h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1200px]">
            <thead className="bg-gray-100 dark:bg-gray-900 sticky top-0 z-10">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider w-10"></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Blockchain</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Symbol</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Chain ID</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Network</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider">Confirmations</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider">Block Time</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider">Currencies</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider">Deposits</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider">Withdrawals</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {blockchains.map(blockchain => (
                <>
                  <tr key={blockchain.id} className="hover:bg-gray-100 dark:hover:bg-gray-100 dark:bg-gray-700/30 transition-colors">
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setExpandedChain(expandedChain === blockchain.id ? null : blockchain.id)}
                        className="p-1 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
                      >
                        {expandedChain === blockchain.id ? (
                          <ChevronDown className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                        )}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {blockchain.logo_url ? (
                          <img 
                            src={blockchain.logo_url} 
                            alt={blockchain.chain_name}
                            className="w-8 h-8 rounded-full flex-shrink-0"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                              (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
                            }}
                          />
                        ) : null}
                        <div className={`w-8 h-8 bg-gray-700 rounded-full flex items-center justify-center flex-shrink-0 ${blockchain.logo_url ? 'hidden' : ''}`}>
                          <span className="text-xs font-bold text-gray-900 dark:text-white">{blockchain.chain_symbol.slice(0, 2)}</span>
                        </div>
                        <span className="font-medium text-gray-900 dark:text-white whitespace-nowrap">{blockchain.chain_name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-gray-600 dark:text-gray-300 font-mono">{blockchain.chain_symbol}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-gray-600 dark:text-gray-300 font-mono">{blockchain.chain_id || '-'}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded text-xs ${
                        blockchain.network_type === 'mainnet' ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'
                      }`}>
                        {blockchain.network_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="text-gray-700 dark:text-gray-300">{blockchain.required_confirmations}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="text-gray-700 dark:text-gray-300">{blockchain.avg_block_time}s</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="px-2 py-1 bg-blue-500/20 text-blue-400 rounded text-xs">
                        {blockchain.currency_count}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <ToggleSwitch
                        enabled={blockchain.deposit_enabled}
                        onToggle={() => toggleBlockchainSetting(blockchain.id, 'deposit_enabled')}
                        isLoading={toggling === `${blockchain.id}-deposit_enabled`}
                      />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <ToggleSwitch
                        enabled={blockchain.withdrawal_enabled}
                        onToggle={() => toggleBlockchainSetting(blockchain.id, 'withdrawal_enabled')}
                        isLoading={toggling === `${blockchain.id}-withdrawal_enabled`}
                      />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <ToggleSwitch
                        enabled={blockchain.is_active}
                        onToggle={() => toggleBlockchainSetting(blockchain.id, 'is_active')}
                        isLoading={toggling === `${blockchain.id}-is_active`}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => setEditingBlockchain(blockchain)}
                          className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors text-gray-400 hover:text-gray-900 dark:text-white"
                          title="Edit"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => {
                            setSelectedBlockchainId(blockchain.id);
                            setShowAddCurrency(true);
                          }}
                          className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors text-gray-400 hover:text-green-400"
                          title="Add Currency"
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                  
                  {/* Expanded Currencies */}
                  {expandedChain === blockchain.id && (
                    <tr key={`${blockchain.id}-currencies`}>
                      <td colSpan={12} className="bg-gray-900/30 px-4 py-4">
                        <div className="ml-8">
                          <div className="text-sm font-medium text-gray-400 mb-3">
                            Currencies on {blockchain.chain_name}
                          </div>
                          
                          {blockchain.currencies && blockchain.currencies.length > 0 ? (
                            <div className="overflow-x-auto">
                              <table className="w-full min-w-[900px]">
                                <thead className="bg-gray-100 dark:bg-gray-800">
                                  <tr>
                                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Currency</th>
                                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                                    <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">Decimals</th>
                                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Min Withdrawal</th>
                                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Withdrawal Fee</th>
                                    <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">Active</th>
                                    <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">Deposit</th>
                                    <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">Withdraw</th>
                                    <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">Actions</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-700/50">
                                  {blockchain.currencies.map(currency => (
                                    <tr key={currency.id} className="hover:bg-gray-800/30">
                                      <td className="px-3 py-2">
                                        <div className="flex items-center gap-2">
                                          {currency.logo_url ? (
                                            <img 
                                              src={currency.logo_url} 
                                              alt={currency.symbol}
                                              className="w-6 h-6 rounded-full"
                                              onError={(e) => {
                                                (e.target as HTMLImageElement).style.display = 'none';
                                                (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
                                              }}
                                            />
                                          ) : null}
                                          <div className={`w-6 h-6 bg-gray-700 rounded-full flex items-center justify-center ${currency.logo_url ? 'hidden' : ''}`}>
                                            <span className="text-[10px] font-bold text-gray-900 dark:text-white">{currency.symbol.slice(0, 2)}</span>
                                          </div>
                                          <span className="font-medium text-gray-900 dark:text-white font-mono">{currency.symbol}</span>
                                        </div>
                                      </td>
                                      <td className="px-3 py-2 text-gray-300 text-sm">{currency.name}</td>
                                      <td className="px-3 py-2">
                                        <span className={`px-2 py-0.5 rounded text-xs ${
                                          currency.currency_type === 'crypto' ? 'bg-blue-500/20 text-blue-400' :
                                          currency.currency_type === 'stablecoin' ? 'bg-green-500/20 text-green-400' :
                                          'bg-yellow-500/20 text-yellow-400'
                                        }`}>
                                          {currency.currency_type}
                                        </span>
                                      </td>
                                      <td className="px-3 py-2 text-center text-gray-300 text-sm">{currency.decimals}</td>
                                      <td className="px-3 py-2 text-right text-gray-300 text-sm font-mono">
                                        {parseFloat(currency.min_withdrawal).toFixed(4)}
                                      </td>
                                      <td className="px-3 py-2 text-right text-gray-300 text-sm font-mono">
                                        {parseFloat(currency.withdrawal_fee).toFixed(4)}
                                      </td>
                                      <td className="px-3 py-2 text-center">
                                        <ToggleSwitch
                                          enabled={currency.is_active}
                                          onToggle={() => toggleCurrencySetting(currency.id, 'is_active', blockchain.id)}
                                          isLoading={toggling === `${currency.id}-is_active`}
                                        />
                                      </td>
                                      <td className="px-3 py-2 text-center">
                                        <ToggleSwitch
                                          enabled={currency.deposit_enabled}
                                          onToggle={() => toggleCurrencySetting(currency.id, 'deposit_enabled', blockchain.id)}
                                          isLoading={toggling === `${currency.id}-deposit_enabled`}
                                        />
                                      </td>
                                      <td className="px-3 py-2 text-center">
                                        <ToggleSwitch
                                          enabled={currency.withdrawal_enabled}
                                          onToggle={() => toggleCurrencySetting(currency.id, 'withdrawal_enabled', blockchain.id)}
                                          isLoading={toggling === `${currency.id}-withdrawal_enabled`}
                                        />
                                      </td>
                                      <td className="px-3 py-2 text-center">
                                        <button
                                          onClick={() => setEditingCurrency(currency)}
                                          className="p-1 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors text-gray-400 hover:text-gray-900 dark:text-white"
                                        >
                                          <Edit2 className="w-3.5 h-3.5" />
                                        </button>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <div className="text-center py-6 text-gray-500 text-sm">
                              No currencies configured for this blockchain
                              <button
                                onClick={() => {
                                  setSelectedBlockchainId(blockchain.id);
                                  setShowAddCurrency(true);
                                }}
                                className="ml-2 text-blue-400 hover:text-blue-300"
                              >
                                + Add Currency
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>

        {blockchains.length === 0 && (
          <div className="p-12 text-center">
            <Globe className="w-12 h-12 text-gray-600 mx-auto mb-3" />
            <p className="text-gray-500">No blockchains configured</p>
            <button
              onClick={() => setShowAddBlockchain(true)}
              className="mt-3 text-blue-400 hover:text-blue-300"
            >
              Add your first blockchain
            </button>
          </div>
        )}
      </div>

      {/* Modals */}
      {(showAddBlockchain || editingBlockchain) && (
        <BlockchainModal
          blockchain={editingBlockchain}
          onClose={() => {
            setShowAddBlockchain(false);
            setEditingBlockchain(null);
          }}
        />
      )}

      {(showAddCurrency || editingCurrency) && (
        <CurrencyModal
          currency={editingCurrency}
          blockchainId={selectedBlockchainId}
          onClose={() => {
            setShowAddCurrency(false);
            setEditingCurrency(null);
            setSelectedBlockchainId(null);
          }}
        />
      )}
    </div>
  );
}
