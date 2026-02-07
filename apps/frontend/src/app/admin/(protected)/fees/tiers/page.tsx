'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { Receipt, Loader2, RefreshCw, Plus, Pencil, X } from 'lucide-react';
import { getApiBaseUrl } from '@/lib/getApiUrl';

interface FeeTier {
  id: string;
  tier_name: string;
  tier_level: number;
  min_trading_volume: string;
  min_token_holding: string;
  spot_maker_fee: string;
  spot_taker_fee: string;
  withdrawal_fee_discount: string;
}

const defaultForm = {
  tier_name: '',
  tier_level: 0,
  min_trading_volume: '0',
  min_token_holding: '0',
  spot_maker_fee: '0.001',
  spot_taker_fee: '0.001',
  withdrawal_fee_discount: '0',
};

export default function FeeTiersPage() {
  const { accessToken } = useAdminAuthStore();
  const [tiers, setTiers] = useState<FeeTier[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingTier, setEditingTier] = useState<FeeTier | null>(null);
  const [form, setForm] = useState(defaultForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const fetchTiers = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const apiUrl = getApiBaseUrl();
      const res = await fetch(`${apiUrl}/api/v1/admin/fees`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const result = await res.json();
      if (result.success && result.data) setTiers(result.data.tiers || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    fetchTiers();
  }, [fetchTiers]);

  const openCreate = () => {
    setEditingTier(null);
    setForm(defaultForm);
    setError('');
    setShowModal(true);
  };

  const openEdit = (t: FeeTier) => {
    setEditingTier(t);
    setForm({
      tier_name: t.tier_name,
      tier_level: t.tier_level,
      min_trading_volume: t.min_trading_volume ?? '0',
      min_token_holding: t.min_token_holding ?? '0',
      spot_maker_fee: t.spot_maker_fee ?? '0.001',
      spot_taker_fee: t.spot_taker_fee ?? '0.001',
      withdrawal_fee_discount: t.withdrawal_fee_discount ?? '0',
    });
    setError('');
    setShowModal(true);
  };

  const handleSubmit = async () => {
    if (!accessToken) return;
    setError('');
    const maker = parseFloat(form.spot_maker_fee);
    const taker = parseFloat(form.spot_taker_fee);
    if (isNaN(maker) || isNaN(taker) || maker < 0 || maker > 1 || taker < 0 || taker > 1) {
      setError('Maker and taker fees must be between 0 and 1 (e.g. 0.001 = 0.1%)');
      return;
    }
    setSaving(true);
    try {
      const apiUrl = getApiBaseUrl();
      if (editingTier) {
        const res = await fetch(`${apiUrl}/api/v1/admin/fees/tiers/${editingTier.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({
            tier_name: form.tier_name,
            tier_level: form.tier_level,
            min_trading_volume: parseFloat(form.min_trading_volume) || 0,
            min_token_holding: parseFloat(form.min_token_holding) || 0,
            spot_maker_fee: maker,
            spot_taker_fee: taker,
            withdrawal_fee_discount: parseFloat(form.withdrawal_fee_discount) || 0,
          }),
        });
        const result = await res.json();
        if (result.success) {
          setTiers((prev) => prev.map((x) => (x.id === editingTier.id ? result.data.tier : x)));
          setShowModal(false);
        } else setError(result.error?.message || 'Update failed');
      } else {
        const res = await fetch(`${apiUrl}/api/v1/admin/fees/tiers`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({
            tier_name: form.tier_name,
            tier_level: form.tier_level,
            min_trading_volume: parseFloat(form.min_trading_volume) || 0,
            min_token_holding: parseFloat(form.min_token_holding) || 0,
            spot_maker_fee: maker,
            spot_taker_fee: taker,
            withdrawal_fee_discount: parseFloat(form.withdrawal_fee_discount) || 0,
          }),
        });
        const result = await res.json();
        if (result.success) {
          setTiers((prev) => [...prev, result.data.tier].sort((a, b) => a.tier_level - b.tier_level));
          setShowModal(false);
        } else setError(result.error?.message || 'Create failed');
      }
    } catch (e) {
      setError('Request failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Fee Tiers</h1>
          <p className="text-gray-400 text-sm mt-1">Tiers define spot maker/taker and withdrawal discount by 30d volume.</p>
        </div>
        <button onClick={openCreate} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
          <Plus className="w-4 h-4" /> Add Tier
        </button>
      </div>

      <div className="flex items-center gap-4">
        <button onClick={fetchTiers} disabled={loading} className="p-2 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800">
          <RefreshCw className={`w-4 h-4 text-gray-600 dark:text-gray-400 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
          </div>
        ) : tiers.length === 0 ? (
          <div className="p-12 text-center">
            <Receipt className="w-12 h-12 text-gray-500 mx-auto mb-4" />
            <p className="text-gray-500 dark:text-gray-400">No fee tiers. Add one to get started.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/80">
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Tier</th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Min volume (30d)</th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Maker</th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Taker</th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Withdrawal discount</th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody>
                {tiers.map((t) => (
                  <tr key={t.id} className="border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/20">
                    <td className="px-6 py-4">
                      <p className="font-medium text-gray-900 dark:text-white">{t.tier_name}</p>
                      <p className="text-xs text-gray-500">Level {t.tier_level}</p>
                    </td>
                    <td className="px-6 py-4 text-gray-500 dark:text-gray-400">${parseFloat(t.min_trading_volume || '0').toLocaleString()}</td>
                    <td className="px-6 py-4 text-green-600 dark:text-green-400">{(parseFloat(t.spot_maker_fee) * 100).toFixed(2)}%</td>
                    <td className="px-6 py-4 text-amber-600 dark:text-amber-400">{(parseFloat(t.spot_taker_fee) * 100).toFixed(2)}%</td>
                    <td className="px-6 py-4 text-gray-500 dark:text-gray-400">{(parseFloat(t.withdrawal_fee_discount || '0') * 100).toFixed(0)}%</td>
                    <td className="px-6 py-4">
                      <button onClick={() => openEdit(t)} className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400">
                        <Pencil className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowModal(false)} />
          <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">{editingTier ? 'Edit Tier' : 'New Tier'}</h2>
              <button onClick={() => setShowModal(false)} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
                <X className="w-5 h-5" />
              </button>
            </div>
            {error && <p className="text-red-500 text-sm mb-4">{error}</p>}
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tier name</label>
                <input value={form.tier_name} onChange={(e) => setForm((f) => ({ ...f, tier_name: e.target.value }))} className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tier level (integer, unique)</label>
                <input type="number" value={form.tier_level} onChange={(e) => setForm((f) => ({ ...f, tier_level: parseInt(e.target.value, 10) || 0 }))} className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Min trading volume (30d)</label>
                <input type="number" value={form.min_trading_volume} onChange={(e) => setForm((f) => ({ ...f, min_trading_volume: e.target.value }))} className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Maker fee (0–1)</label>
                  <input type="number" step="0.0001" min="0" max="1" value={form.spot_maker_fee} onChange={(e) => setForm((f) => ({ ...f, spot_maker_fee: e.target.value }))} className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Taker fee (0–1)</label>
                  <input type="number" step="0.0001" min="0" max="1" value={form.spot_taker_fee} onChange={(e) => setForm((f) => ({ ...f, spot_taker_fee: e.target.value }))} className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Withdrawal fee discount (0–1)</label>
                <input type="number" step="0.01" min="0" max="1" value={form.withdrawal_fee_discount} onChange={(e) => setForm((f) => ({ ...f, withdrawal_fee_discount: e.target.value }))} className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300">Cancel</button>
              <button onClick={handleSubmit} disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">{saving ? 'Saving...' : editingTier ? 'Save' : 'Create'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
