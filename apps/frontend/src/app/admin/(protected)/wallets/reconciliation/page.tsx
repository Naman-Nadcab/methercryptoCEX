'use client';

import { useState } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { SectionHeader, Panel, ActionButton } from '@/components/admin/control-plane';
import { Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export default function WalletsReconciliationPage() {
  const { accessToken } = useAdminAuthStore();
  const [userId, setUserId] = useState('');
  const [asset, setAsset] = useState('');
  const [reason, setReason] = useState('');
  const [targetAvailable, setTargetAvailable] = useState('');
  const [targetLocked, setTargetLocked] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message?: string; ledger_sum?: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResult(null);
    const reasonTrimmed = reason.trim();
    if (!userId.trim() || !asset.trim() || !reasonTrimmed) {
      setError('User ID, asset, and reason are required.');
      return;
    }
    setLoading(true);
    try {
      const body: { user_id: string; asset: string; reason: string; target_available?: string; target_locked?: string } = {
        user_id: userId.trim(),
        asset: asset.trim(),
        reason: reasonTrimmed,
      };
      if (targetAvailable.trim()) body.target_available = targetAvailable.trim();
      if (targetLocked.trim()) body.target_locked = targetLocked.trim();
      const res = await fetch(`${API_URL}/api/v1/admin/settlement/balance-reconcile`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? data?.error?.code ?? 'Reconciliation failed');
        setResult(data?.error?.ledger_sum != null ? { ok: false, message: data?.error?.message, ledger_sum: data.error.ledger_sum } : null);
        return;
      }
      setResult(data?.data ?? { ok: true });
      if (data?.success && data?.data?.ok) {
        setUserId('');
        setAsset('');
        setReason('');
        setTargetAvailable('');
        setTargetLocked('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Balance Reconciliation"
        subtitle="Super Admin only. Reconcile user balance to ledger sum. Use with caution."
      />
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
        <div className="text-sm text-amber-200">
          <p className="font-medium">Super Admin only</p>
          <p className="mt-1">This action sets user_balances to match the ledger sum. Only Super Admin can call this. Provide a clear reason for audit.</p>
        </div>
      </div>

      <Panel title="Reconcile form" subtitle="user_id, asset (currency symbol or id), reason required">
        <form onSubmit={handleSubmit} className="max-w-lg space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">User ID *</label>
            <input
              type="text"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder="UUID"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:ring-2 focus:ring-amber-500"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Asset (currency symbol or id) *</label>
            <input
              type="text"
              value={asset}
              onChange={(e) => setAsset(e.target.value)}
              placeholder="e.g. USDT or currency id"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:ring-2 focus:ring-amber-500"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Reason *</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Operator reason for reconciliation"
              rows={3}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:ring-2 focus:ring-amber-500 resize-none"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Target available (optional)</label>
              <input
                type="text"
                value={targetAvailable}
                onChange={(e) => setTargetAvailable(e.target.value)}
                placeholder="Leave empty for ledger sum"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Target locked (optional)</label>
              <input
                type="text"
                value={targetLocked}
                onChange={(e) => setTargetLocked(e.target.value)}
                placeholder="Leave empty for ledger sum"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-500"
              />
            </div>
          </div>
          {error && (
            <div className="flex items-center gap-2 text-red-400 text-sm">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}
          {result && (
            <div className={`flex items-center gap-2 text-sm ${result.ok ? 'text-emerald-400' : 'text-amber-400'}`}>
              {result.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
              <span>{result.ok ? 'Reconciliation completed.' : (result.message ?? 'Reconciliation failed.')}</span>
              {result.ledger_sum != null && <span className="text-gray-400">Ledger sum: {result.ledger_sum}</span>}
            </div>
          )}
          <ActionButton type="submit" variant="primary" loading={loading} disabled={loading}>
            Run reconciliation
          </ActionButton>
        </form>
      </Panel>
    </div>
  );
}
