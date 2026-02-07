'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { Megaphone, Loader2, RefreshCw, Plus, Pencil, X } from 'lucide-react';
import { getApiBaseUrl } from '@/lib/getApiUrl';

interface Campaign {
  id: string;
  campaign_name: string;
  campaign_code: string;
  description: string | null;
  referrer_commission_rate: string;
  referee_discount_rate: string;
  bonus_amount: string;
  bonus_currency: string | null;
  min_trade_volume: string;
  min_deposit_amount: string;
  max_participants: number | null;
  current_participants: number;
  total_budget: string | null;
  spent_budget: string;
  is_active: boolean;
  start_date: string;
  end_date: string | null;
  created_at: string;
}

const defaultCampaignForm = {
  campaign_name: '',
  campaign_code: '',
  description: '',
  referrer_commission_rate: '0.2',
  referee_discount_rate: '0.1',
  bonus_amount: '0',
  bonus_currency: 'USDT',
  min_trade_volume: '0',
  min_deposit_amount: '0',
  max_participants: '' as string | number,
  total_budget: '' as string | number,
  is_active: true,
  start_date: new Date().toISOString().slice(0, 10),
  end_date: '',
};

export default function ReferralCampaignsPage() {
  const { accessToken } = useAdminAuthStore();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);
  const [form, setForm] = useState(defaultCampaignForm);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchCampaigns = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const apiUrl = getApiBaseUrl();
      const response = await fetch(`${apiUrl}/api/v1/admin/referrals/campaigns`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const result = await response.json();
      if (result.success) setCampaigns(result.data.campaigns || []);
    } catch (err) {
      console.error('Failed to fetch campaigns:', err);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    fetchCampaigns();
  }, [fetchCampaigns]);

  const openCreate = () => {
    setForm({ ...defaultCampaignForm, start_date: new Date().toISOString().slice(0, 10) });
    setError('');
    setShowCreateModal(true);
  };

  const openEdit = (c: Campaign) => {
    setForm({
      campaign_name: c.campaign_name,
      campaign_code: c.campaign_code,
      description: c.description || '',
      referrer_commission_rate: c.referrer_commission_rate,
      referee_discount_rate: c.referee_discount_rate,
      bonus_amount: c.bonus_amount,
      bonus_currency: c.bonus_currency || 'USDT',
      min_trade_volume: c.min_trade_volume,
      min_deposit_amount: c.min_deposit_amount,
      max_participants: c.max_participants ?? '',
      total_budget: c.total_budget ?? '',
      is_active: c.is_active,
      start_date: c.start_date.slice(0, 10),
      end_date: c.end_date ? c.end_date.slice(0, 10) : '',
    });
    setEditingCampaign(c);
    setError('');
  };

  const closeModals = () => {
    setShowCreateModal(false);
    setEditingCampaign(null);
    setError('');
  };

  const handleCreate = async () => {
    if (!accessToken) return;
    setError('');
    if (!form.campaign_name.trim() || !form.campaign_code.trim()) {
      setError('Campaign name and code are required.');
      return;
    }
    setSubmitLoading(true);
    try {
      const apiUrl = getApiBaseUrl();
      const response = await fetch(`${apiUrl}/api/v1/admin/referrals/campaigns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          campaign_name: form.campaign_name.trim(),
          campaign_code: form.campaign_code.trim().toUpperCase(),
          description: form.description.trim() || undefined,
          referrer_commission_rate: parseFloat(form.referrer_commission_rate),
          referee_discount_rate: parseFloat(form.referee_discount_rate),
          bonus_amount: parseFloat(form.bonus_amount) || 0,
          bonus_currency: form.bonus_currency || undefined,
          min_trade_volume: parseFloat(form.min_trade_volume) || 0,
          min_deposit_amount: parseFloat(form.min_deposit_amount) || 0,
          max_participants: form.max_participants === '' ? undefined : Number(form.max_participants),
          total_budget: form.total_budget === '' ? undefined : parseFloat(String(form.total_budget)),
          is_active: form.is_active,
          start_date: form.start_date,
          end_date: form.end_date || undefined,
        }),
      });
      const result = await response.json();
      if (result.success) {
        setCampaigns((prev) => [result.data.campaign, ...prev]);
        closeModals();
      } else {
        setError(result.error?.message || 'Failed to create campaign');
      }
    } catch (err) {
      setError('Request failed');
    } finally {
      setSubmitLoading(false);
    }
  };

  const handleUpdate = async () => {
    if (!accessToken || !editingCampaign) return;
    setError('');
    setSubmitLoading(true);
    try {
      const apiUrl = getApiBaseUrl();
      const body: Record<string, unknown> = {
        campaign_name: form.campaign_name.trim(),
        description: form.description.trim() || null,
        referrer_commission_rate: parseFloat(form.referrer_commission_rate),
        referee_discount_rate: parseFloat(form.referee_discount_rate),
        bonus_amount: parseFloat(form.bonus_amount) || 0,
        bonus_currency: form.bonus_currency || null,
        min_trade_volume: parseFloat(form.min_trade_volume) || 0,
        min_deposit_amount: parseFloat(form.min_deposit_amount) || 0,
        max_participants: form.max_participants === '' ? null : Number(form.max_participants),
        total_budget: form.total_budget === '' ? null : parseFloat(String(form.total_budget)),
        is_active: form.is_active,
        start_date: form.start_date,
        end_date: form.end_date || null,
      };
      const response = await fetch(`${apiUrl}/api/v1/admin/referrals/campaigns/${editingCampaign.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (result.success) {
        setCampaigns((prev) => prev.map((c) => (c.id === editingCampaign.id ? result.data.campaign : c)));
        closeModals();
      } else {
        setError(result.error?.message || 'Failed to update campaign');
      }
    } catch (err) {
      setError('Request failed');
    } finally {
      setSubmitLoading(false);
    }
  };

  const formatDate = (d: string | null) => (d ? new Date(d).toLocaleDateString() : '—');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Referral Campaigns</h1>
          <p className="text-gray-400 text-sm mt-1">Create and manage referral campaigns with custom commission rates and bonuses.</p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <Plus className="w-4 h-4" /> New Campaign
        </button>
      </div>

      <div className="flex items-center gap-4">
        <button onClick={fetchCampaigns} disabled={loading} className="p-2 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800">
          <RefreshCw className={`w-4 h-4 text-gray-600 dark:text-gray-400 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
          </div>
        ) : campaigns.length === 0 ? (
          <div className="p-12 text-center">
            <Megaphone className="w-12 h-12 text-gray-500 mx-auto mb-4" />
            <p className="text-gray-500 dark:text-gray-400 mb-4">No campaigns yet</p>
            <button onClick={openCreate} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Create first campaign</button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/80">
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Name</th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Code</th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Referrer %</th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Referee %</th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Participants</th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Start / End</th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Status</th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => (
                  <tr key={c.id} className="border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/20">
                    <td className="px-6 py-4">
                      <p className="text-gray-900 dark:text-white font-medium">{c.campaign_name}</p>
                      {c.description && <p className="text-xs text-gray-500 truncate max-w-[200px]">{c.description}</p>}
                    </td>
                    <td className="px-6 py-4 font-mono text-sm">{c.campaign_code}</td>
                    <td className="px-6 py-4 text-gray-700 dark:text-gray-300">{(parseFloat(c.referrer_commission_rate) * 100).toFixed(1)}%</td>
                    <td className="px-6 py-4 text-gray-700 dark:text-gray-300">{(parseFloat(c.referee_discount_rate) * 100).toFixed(1)}%</td>
                    <td className="px-6 py-4">{c.current_participants}{c.max_participants != null ? ` / ${c.max_participants}` : ''}</td>
                    <td className="px-6 py-4 text-sm text-gray-500">{formatDate(c.start_date)} → {formatDate(c.end_date)}</td>
                    <td className="px-6 py-4">
                      <span className={`text-xs px-2 py-1 rounded ${c.is_active ? 'bg-green-500/20 text-green-500' : 'bg-gray-500/20 text-gray-500'}`}>{c.is_active ? 'Active' : 'Inactive'}</span>
                    </td>
                    <td className="px-6 py-4">
                      <button onClick={() => openEdit(c)} className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400">
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

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={closeModals} />
          <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">New Campaign</h2>
              <button onClick={closeModals} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"><X className="w-5 h-5" /></button>
            </div>
            {error && <p className="text-red-500 text-sm mb-4">{error}</p>}
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Campaign name *</label>
                <input value={form.campaign_name} onChange={(e) => setForm((f) => ({ ...f, campaign_name: e.target.value }))} className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Campaign code *</label>
                <input value={form.campaign_code} onChange={(e) => setForm((f) => ({ ...f, campaign_code: e.target.value.toUpperCase() }))} placeholder="e.g. WINTER2025" className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
                <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={2} className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Referrer commission (0–1)</label>
                  <input type="number" step="0.01" min="0" max="1" value={form.referrer_commission_rate} onChange={(e) => setForm((f) => ({ ...f, referrer_commission_rate: e.target.value }))} className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Referee discount (0–1)</label>
                  <input type="number" step="0.01" min="0" max="1" value={form.referee_discount_rate} onChange={(e) => setForm((f) => ({ ...f, referee_discount_rate: e.target.value }))} className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Start date</label>
                  <input type="date" value={form.start_date} onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))} className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">End date</label>
                  <input type="date" value={form.end_date} onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))} className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="create-active" checked={form.is_active} onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))} />
                <label htmlFor="create-active" className="text-sm text-gray-700 dark:text-gray-300">Active</label>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={closeModals} className="px-4 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300">Cancel</button>
              <button onClick={handleCreate} disabled={submitLoading} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">{submitLoading ? 'Creating...' : 'Create'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editingCampaign && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={closeModals} />
          <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">Edit Campaign</h2>
              <button onClick={closeModals} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"><X className="w-5 h-5" /></button>
            </div>
            {error && <p className="text-red-500 text-sm mb-4">{error}</p>}
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Campaign name</label>
                <input value={form.campaign_name} onChange={(e) => setForm((f) => ({ ...f, campaign_name: e.target.value }))} className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
              </div>
              <div>
                <label className="block text-sm text-gray-500">Code (read-only)</label>
                <p className="font-mono text-gray-900 dark:text-white">{editingCampaign.campaign_code}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
                <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={2} className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Referrer commission (0–1)</label>
                  <input type="number" step="0.01" min="0" max="1" value={form.referrer_commission_rate} onChange={(e) => setForm((f) => ({ ...f, referrer_commission_rate: e.target.value }))} className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Referee discount (0–1)</label>
                  <input type="number" step="0.01" min="0" max="1" value={form.referee_discount_rate} onChange={(e) => setForm((f) => ({ ...f, referee_discount_rate: e.target.value }))} className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Start date</label>
                  <input type="date" value={form.start_date} onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))} className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">End date</label>
                  <input type="date" value={form.end_date} onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))} className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="edit-active" checked={form.is_active} onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))} />
                <label htmlFor="edit-active" className="text-sm text-gray-700 dark:text-gray-300">Active</label>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={closeModals} className="px-4 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300">Cancel</button>
              <button onClick={handleUpdate} disabled={submitLoading} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">{submitLoading ? 'Saving...' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
