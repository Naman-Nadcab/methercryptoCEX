'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { Megaphone, Loader2, RefreshCw, Plus, Pencil, Trash2, X } from 'lucide-react';
import { getApiBaseUrl } from '@/lib/getApiUrl';

interface Promotion {
  id: string;
  name: string;
  description: string | null;
  promotion_type: string;
  discount_type: string;
  discount_value: string;
  min_volume_30d: string;
  start_date: string;
  end_date: string;
  is_active: boolean;
}

const PROMO_TYPES = [
  { value: 'spot_maker', label: 'Spot Maker' },
  { value: 'spot_taker', label: 'Spot Taker' },
  { value: 'spot_both', label: 'Spot Both' },
  { value: 'withdrawal', label: 'Withdrawal' },
  { value: 'p2p_maker', label: 'P2P Maker' },
  { value: 'p2p_taker', label: 'P2P Taker' },
];

const defaultForm = {
  name: '',
  description: '',
  promotion_type: 'spot_both',
  discount_type: 'percentage',
  discount_value: '0',
  min_volume_30d: '0',
  start_date: new Date().toISOString().slice(0, 10),
  end_date: '',
  is_active: true,
};

export default function PromotionsPage() {
  const { accessToken } = useAdminAuthStore();
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingPromo, setEditingPromo] = useState<Promotion | null>(null);
  const [form, setForm] = useState(defaultForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const fetchPromos = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const apiUrl = getApiBaseUrl();
      const res = await fetch(`${apiUrl}/api/v1/admin/fees/promotions`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const result = await res.json();
      if (result.success && result.data) setPromotions(result.data.promotions || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    fetchPromos();
  }, [fetchPromos]);

  const openCreate = () => {
    setEditingPromo(null);
    setForm({ ...defaultForm, start_date: new Date().toISOString().slice(0, 10), end_date: '' });
    setError('');
    setShowModal(true);
  };

  const openEdit = (p: Promotion) => {
    setEditingPromo(p);
    setForm({
      name: p.name,
      description: p.description || '',
      promotion_type: p.promotion_type,
      discount_type: p.discount_type || 'percentage',
      discount_value: p.discount_value ?? '0',
      min_volume_30d: p.min_volume_30d ?? '0',
      start_date: p.start_date?.slice(0, 10) ?? '',
      end_date: p.end_date?.slice(0, 10) ?? '',
      is_active: p.is_active,
    });
    setError('');
    setShowModal(true);
  };

  const handleSubmit = async () => {
    if (!accessToken) return;
    setError('');
    if (!form.name.trim() || !form.start_date || !form.end_date) {
      setError('Name, start date and end date are required.');
      return;
    }
    setSaving(true);
    try {
      const apiUrl = getApiBaseUrl();
      const body = {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        promotion_type: form.promotion_type,
        discount_type: form.discount_type,
        discount_value: parseFloat(form.discount_value) || 0,
        min_volume_30d: parseFloat(form.min_volume_30d) || 0,
        start_date: form.start_date,
        end_date: form.end_date,
        is_active: form.is_active,
      };
      if (editingPromo) {
        const res = await fetch(`${apiUrl}/api/v1/admin/fees/promotions/${editingPromo.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify(body),
        });
        const result = await res.json();
        if (result.success) {
          setPromotions((prev) => prev.map((x) => (x.id === editingPromo.id ? result.data.promotion : x)));
          setShowModal(false);
        } else setError(result.error?.message || 'Update failed');
      } else {
        const res = await fetch(`${apiUrl}/api/v1/admin/fees/promotions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify(body),
        });
        const result = await res.json();
        if (result.success) {
          setPromotions((prev) => [result.data.promotion, ...prev]);
          setShowModal(false);
        } else setError(result.error?.message || 'Create failed');
      }
    } catch (e) {
      setError('Request failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!accessToken || !confirm('Delete this promotion?')) return;
    try {
      const apiUrl = getApiBaseUrl();
      const res = await fetch(`${apiUrl}/api/v1/admin/fees/promotions/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const result = await res.json();
      if (result.success) setPromotions((prev) => prev.filter((x) => x.id !== id));
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Fee Promotions</h1>
          <p className="text-gray-400 text-sm mt-1">Time-bound fee discounts for spot, P2P, or withdrawal.</p>
        </div>
        <button onClick={openCreate} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
          <Plus className="w-4 h-4" /> New Promotion
        </button>
      </div>

      <div className="flex items-center gap-4">
        <button onClick={fetchPromos} disabled={loading} className="p-2 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800">
          <RefreshCw className={`w-4 h-4 text-gray-600 dark:text-gray-400 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
          </div>
        ) : promotions.length === 0 ? (
          <div className="p-12 text-center">
            <Megaphone className="w-12 h-12 text-gray-500 mx-auto mb-4" />
            <p className="text-gray-500 dark:text-gray-400">No promotions. Create one to run a fee campaign.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/80">
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Name</th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Type</th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Discount</th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Period</th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Status</th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody>
                {promotions.map((p) => (
                  <tr key={p.id} className="border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/20">
                    <td className="px-6 py-4">
                      <p className="font-medium text-gray-900 dark:text-white">{p.name}</p>
                      {p.description && <p className="text-xs text-gray-500 truncate max-w-[200px]">{p.description}</p>}
                    </td>
                    <td className="px-6 py-4 text-gray-500 dark:text-gray-400">{PROMO_TYPES.find((t) => t.value === p.promotion_type)?.label || p.promotion_type}</td>
                    <td className="px-6 py-4 text-green-600 dark:text-green-400">
                      {p.discount_type === 'percentage' ? `${(parseFloat(p.discount_value) * 100).toFixed(2)}%` : parseFloat(p.discount_value).toFixed(4)}
                    </td>
                    <td className="px-6 py-4 text-gray-500 text-sm">
                      {p.start_date?.slice(0, 10)} → {p.end_date?.slice(0, 10)}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`text-xs px-2 py-1 rounded ${p.is_active ? 'bg-green-500/20 text-green-500' : 'bg-gray-500/20 text-gray-500'}`}>{p.is_active ? 'Active' : 'Inactive'}</span>
                    </td>
                    <td className="px-6 py-4 flex gap-2">
                      <button onClick={() => openEdit(p)} className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400">
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button onClick={() => handleDelete(p.id)} className="p-1.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-red-500">
                        <Trash2 className="w-4 h-4" />
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
          <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">{editingPromo ? 'Edit Promotion' : 'New Promotion'}</h2>
              <button onClick={() => setShowModal(false)} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
                <X className="w-5 h-5" />
              </button>
            </div>
            {error && <p className="text-red-500 text-sm mb-4">{error}</p>}
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name *</label>
                <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
                <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={2} className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Promotion type</label>
                <select value={form.promotion_type} onChange={(e) => setForm((f) => ({ ...f, promotion_type: e.target.value }))} className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
                  {PROMO_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Discount type</label>
                  <select value={form.discount_type} onChange={(e) => setForm((f) => ({ ...f, discount_type: e.target.value }))} className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
                    <option value="percentage">Percentage</option>
                    <option value="fixed_rate">Fixed rate</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Discount value</label>
                  <input type="number" step="0.0001" value={form.discount_value} onChange={(e) => setForm((f) => ({ ...f, discount_value: e.target.value }))} className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Start date *</label>
                  <input type="date" value={form.start_date} onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))} className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">End date *</label>
                  <input type="date" value={form.end_date} onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))} className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="promo-active" checked={form.is_active} onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))} />
                <label htmlFor="promo-active" className="text-sm text-gray-700 dark:text-gray-300">Active</label>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300">Cancel</button>
              <button onClick={handleSubmit} disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">{saving ? 'Saving...' : editingPromo ? 'Save' : 'Create'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
