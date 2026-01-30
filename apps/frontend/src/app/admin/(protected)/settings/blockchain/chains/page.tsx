'use client';

import { useState, useEffect } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { 
  Globe, Plus, Edit2, Trash2, ChevronDown, ChevronRight, 
  Check, X, Loader2, Save, AlertCircle, Coins,
  Link as LinkIcon, Clock, Shield, Settings, Network
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
  native_coin?: NativeCoin;
}

interface NativeCoin {
  id: string;
  symbol: string;
  name: string;
  decimals: number;
  logo_url: string | null;
  is_active: boolean;
  deposit_enabled: boolean;
  withdrawal_enabled: boolean;
  min_withdrawal: string;
  withdrawal_fee: string;
}

export default function ChainsPage() {
  const { accessToken } = useAdminAuthStore();
  const [blockchains, setBlockchains] = useState<Blockchain[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddBlockchain, setShowAddBlockchain] = useState(false);
  const [editingBlockchain, setEditingBlockchain] = useState<Blockchain | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [toggling, setToggling] = useState<string | null>(null);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

  const fetchBlockchains = async () => {
    if (!accessToken) return;
    
    setLoading(true);
    try {
      const response = await fetch(`${apiUrl}/api/v1/admin/settings/blockchains`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const result = await response.json();
      if (result.success) {
        // Extract native coin from currencies for each blockchain
        const blockchainsWithNative = result.data.blockchains.map((b: any) => {
          const nativeCoin = b.currencies?.find((c: any) => 
            !c.contract_address && c.symbol === b.chain_symbol
          );
          return { ...b, native_coin: nativeCoin };
        });
        setBlockchains(blockchainsWithNative);
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

  const toggleBlockchainSetting = async (id: string, field: string) => {
    if (toggling) return;
    if (!accessToken) {
      alert('Not authenticated. Please login again.');
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
        setBlockchains(prev => prev.map(b => 
          b.id === id ? { 
            ...b, 
            ...result.data.blockchain,
            native_coin: b.native_coin
          } : b
        ));
      } else {
        alert('Failed to update: ' + (result.error?.message || 'Unknown error'));
      }
    } catch (error: any) {
      console.error('Failed to toggle setting:', error);
      alert(`Failed to update: ${error.message || 'Network error'}`);
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

      if (!['image/png', 'image/svg+xml'].includes(file.type)) {
        alert('Only PNG and SVG files are allowed');
        return;
      }

      const reader = new FileReader();
      reader.onload = (ev) => setLogoPreview(ev.target?.result as string);
      reader.readAsDataURL(file);

      setUploading(true);
      try {
        const formData = new FormData();
        formData.append('file', file);

        const uploadUrl = blockchain 
          ? `${apiUrl}/api/v1/upload/logo/blockchain/${blockchain.id}`
          : `${apiUrl}/api/v1/upload/logo/blockchain?symbol=${encodeURIComponent(form.chain_symbol || 'temp')}`;

        const response = await fetch(uploadUrl, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${accessToken}` },
          body: formData,
        });

        const result = await response.json();
        if (result.success) {
          setForm({ ...form, logo_url: result.data.logo_url });
          setLogoPreview(result.data.logo_url);
        } else {
          alert(result.error?.message || 'Upload failed');
        }
      } catch (error) {
        console.error('Upload error:', error);
        alert('Failed to upload logo');
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
              {blockchain ? 'Edit Chain' : 'Add New Chain'}
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
                <label className="block text-sm text-gray-400 mb-1">Native Coin Symbol *</label>
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
            <Network className="w-8 h-8 text-blue-500" />
            Chains & Networks
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            Manage blockchain networks and their native coins
          </p>
        </div>
        <button
          onClick={() => setShowAddBlockchain(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Add Chain
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
          <div className="text-gray-400 text-sm">Total Chains</div>
          <div className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{blockchains.length}</div>
        </div>
        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
          <div className="text-gray-400 text-sm">Active Chains</div>
          <div className="text-2xl font-bold text-green-400 mt-1">
            {blockchains.filter(b => b.is_active).length}
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
          <div className="text-gray-400 text-sm">Mainnet</div>
          <div className="text-2xl font-bold text-blue-400 mt-1">
            {blockchains.filter(b => b.network_type === 'mainnet').length}
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
          <div className="text-gray-400 text-sm">Testnet</div>
          <div className="text-2xl font-bold text-yellow-400 mt-1">
            {blockchains.filter(b => b.network_type === 'testnet').length}
          </div>
        </div>
      </div>

      {/* Chains Table */}
      <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Blockchain Networks</h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1400px]">
            <thead className="bg-gray-100 dark:bg-gray-900 sticky top-0 z-10">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Chain</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Native Coin</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider">Chain ID</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider">Network</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider">Confirmations</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider">Block Time</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Explorer</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider">Deposits</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider">Withdrawals</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider">Active</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {blockchains.map(blockchain => (
                <tr key={blockchain.id} className="hover:bg-gray-100 dark:hover:bg-gray-100 dark:bg-gray-700/30 transition-colors">
                  <td className="px-4 py-4">
                    <div className="flex items-center gap-3">
                      {blockchain.logo_url ? (
                        <img 
                          src={blockchain.logo_url} 
                          alt={blockchain.chain_name}
                          className="w-10 h-10 rounded-full"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                            (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
                          }}
                        />
                      ) : null}
                      <div className={`w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center ${blockchain.logo_url ? 'hidden' : ''}`}>
                        <span className="text-sm font-bold text-gray-900 dark:text-white">{blockchain.chain_symbol.slice(0, 2)}</span>
                      </div>
                      <div>
                        <div className="font-medium text-gray-900 dark:text-white">{blockchain.chain_name}</div>
                        <div className="text-xs text-gray-500">ID: {blockchain.id.slice(0, 8)}...</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 bg-gray-700 rounded-full flex items-center justify-center">
                        <span className="text-[10px] font-bold text-gray-900 dark:text-white">{blockchain.chain_symbol.slice(0, 2)}</span>
                      </div>
                      <div>
                        <div className="font-mono text-gray-900 dark:text-white text-sm">{blockchain.chain_symbol}</div>
                        {blockchain.native_coin && (
                          <div className="text-xs text-gray-500">{blockchain.native_coin.name}</div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-4 text-center">
                    <span className="font-mono text-gray-700 dark:text-gray-300">{blockchain.chain_id || '-'}</span>
                  </td>
                  <td className="px-4 py-4 text-center">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                      blockchain.network_type === 'mainnet' 
                        ? 'bg-green-500/20 text-green-400' 
                        : 'bg-yellow-500/20 text-yellow-400'
                    }`}>
                      {blockchain.network_type}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-center">
                    <span className="text-gray-700 dark:text-gray-300">{blockchain.required_confirmations}</span>
                  </td>
                  <td className="px-4 py-4 text-center">
                    <span className="text-gray-700 dark:text-gray-300">{blockchain.avg_block_time}s</span>
                  </td>
                  <td className="px-4 py-4">
                    {blockchain.explorer_url ? (
                      <a 
                        href={blockchain.explorer_url} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-blue-400 hover:text-blue-300 flex items-center gap-1 text-sm"
                      >
                        <LinkIcon className="w-3 h-3" />
                        {new URL(blockchain.explorer_url).hostname}
                      </a>
                    ) : (
                      <span className="text-gray-500">-</span>
                    )}
                  </td>
                  <td className="px-4 py-4 text-center">
                    <ToggleSwitch
                      enabled={blockchain.deposit_enabled}
                      onToggle={() => toggleBlockchainSetting(blockchain.id, 'deposit_enabled')}
                      isLoading={toggling === `${blockchain.id}-deposit_enabled`}
                    />
                  </td>
                  <td className="px-4 py-4 text-center">
                    <ToggleSwitch
                      enabled={blockchain.withdrawal_enabled}
                      onToggle={() => toggleBlockchainSetting(blockchain.id, 'withdrawal_enabled')}
                      isLoading={toggling === `${blockchain.id}-withdrawal_enabled`}
                    />
                  </td>
                  <td className="px-4 py-4 text-center">
                    <ToggleSwitch
                      enabled={blockchain.is_active}
                      onToggle={() => toggleBlockchainSetting(blockchain.id, 'is_active')}
                      isLoading={toggling === `${blockchain.id}-is_active`}
                    />
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={() => setEditingBlockchain(blockchain)}
                        className="p-2 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors text-gray-400 hover:text-gray-900 dark:text-white"
                        title="Edit Chain"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {blockchains.length === 0 && (
          <div className="p-12 text-center">
            <Network className="w-12 h-12 text-gray-600 mx-auto mb-3" />
            <p className="text-gray-500">No chains configured</p>
            <button
              onClick={() => setShowAddBlockchain(true)}
              className="mt-3 text-blue-400 hover:text-blue-300"
            >
              Add your first chain
            </button>
          </div>
        )}
      </div>

      {/* Modal */}
      {(showAddBlockchain || editingBlockchain) && (
        <BlockchainModal
          blockchain={editingBlockchain}
          onClose={() => {
            setShowAddBlockchain(false);
            setEditingBlockchain(null);
          }}
        />
      )}
    </div>
  );
}
