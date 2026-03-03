'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { MessageSquare, Loader2, RefreshCw, Plus, Pencil, Trash2, X } from 'lucide-react';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { toast } from '@/components/ui/toaster';

interface SmsTemplate {
  id: string;
  slug: string;
  name: string;
  body: string;
  variables: string[] | null;
  is_active: boolean;
  created_at: string;
  updated_at?: string;
}

const defaultForm = {
  slug: '',
  name: '',
  body: '',
  is_active: true,
};

export default function SMSPage() {
  const { accessToken } = useAdminAuthStore();
  const [list, setList] = useState<SmsTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<SmsTemplate | null>(null);
  const [form, setForm] = useState(defaultForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const fetchList = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const apiUrl = getApiBaseUrl();
      const res = await fetch(`${apiUrl}/api/v1/admin/notifications/sms-templates`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const result = await res.json();
      if (result.success && result.data) setList(result.data.templates || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  const openCreate = () => {
    setEditing(null);
    setForm(defaultForm);
    setError('');
    setShowModal(true);
  };

  const openEdit = (t: SmsTemplate) => {
    setEditing(t);
    setForm({
      slug: t.slug,
      name: t.name,
      body: t.body || '',
      is_active: t.is_active ?? true,
    });
    setError('');
    setShowModal(true);
  };

  const handleSubmit = async () => {
    if (!accessToken) return;
    setError('');
    if (!form.slug.trim() || !form.name.trim() || !form.body.trim()) {
      setError('Slug, name and body are required.');
      return;
    }
    setSaving(true);
    try {
      const apiUrl = getApiBaseUrl();
      const body = {
        slug: form.slug.trim(),
        name: form.name.trim(),
        body: form.body.trim(),
        is_active: form.is_active,
      };
      if (editing) {
        const res = await fetch(`${apiUrl}/api/v1/admin/notifications/sms-templates/${editing.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify(body),
        });
        const result = await res.json();
        if (result.success) {
          setShowModal(false);
          fetchList();
        } else setError(result.error?.message || 'Update failed');
      } else {
        const res = await fetch(`${apiUrl}/api/v1/admin/notifications/sms-templates`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify(body),
        });
        const result = await res.json();
        if (result.success) {
          setShowModal(false);
          fetchList();
        } else setError(result.error?.message || 'Create failed');
      }
    } catch (e) {
      setError('Request failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!accessToken || !confirm('Delete this template?')) return;
    try {
      const apiUrl = getApiBaseUrl();
      const res = await fetch(`${apiUrl}/api/v1/admin/notifications/sms-templates/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const result = await res.json();
      if (result.success) fetchList();
      else toast({ title: 'Error', description: result.error?.message || 'Delete failed', variant: 'destructive' });
    } catch (e) {
      toast({ title: 'Error', description: 'Request failed', variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">SMS Templates</h1>
          <p className="text-gray-400 text-sm mt-1">Manage SMS templates for OTP, alerts, and notifications (Binance-style 2FA, login codes).</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchList} disabled={loading} className="p-2 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={openCreate} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
            <Plus className="w-4 h-4" /> Add template
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
          </div>
        ) : list.length === 0 ? (
          <div className="p-12 text-center text-gray-500 dark:text-gray-400">No SMS templates. Add one for OTP, login codes, or alerts.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/80">
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Slug</th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Name</th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Body</th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Status</th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody>
                {list.map((t) => (
                  <tr key={t.id} className="border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/20">
                    <td className="px-6 py-4 font-mono text-sm text-gray-900 dark:text-white">{t.slug}</td>
                    <td className="px-6 py-4 text-gray-900 dark:text-white">{t.name}</td>
                    <td className="px-6 py-4 text-gray-500 dark:text-gray-400 truncate max-w-[280px]">{t.body}</td>
                    <td className="px-6 py-4">
                      <span className={t.is_active ? 'text-green-600 dark:text-green-400' : 'text-gray-500'}>{t.is_active ? 'Active' : 'Inactive'}</span>
                    </td>
                    <td className="px-6 py-4 flex gap-2">
                      <button onClick={() => openEdit(t)} className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-600"><Pencil className="w-4 h-4" /></button>
                      <button onClick={() => handleDelete(t.id)} className="p-1.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-red-600"><Trash2 className="w-4 h-4" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => !saving && setShowModal(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{editing ? 'Edit SMS Template' : 'New SMS Template'}</h2>
              <button type="button" onClick={() => !saving && setShowModal(false)} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              {error && <p className="text-sm text-red-500">{error}</p>}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Slug *</label>
                  <input type="text" value={form.slug} onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))} className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white" placeholder="e.g. otp_login" disabled={!!editing} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name *</label>
                  <input type="text" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white" placeholder="Display name" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Body *</label>
                <textarea value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} rows={4} className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white" placeholder="SMS text. Use {{code}} or {{variable}} for placeholders." />
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.is_active} onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))} className="rounded" />
                <span className="text-sm text-gray-700 dark:text-gray-300">Active</span>
              </label>
            </div>
            <div className="p-6 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
              <button type="button" onClick={() => !saving && setShowModal(false)} className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700">Cancel</button>
              <button type="button" onClick={handleSubmit} disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {editing ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
