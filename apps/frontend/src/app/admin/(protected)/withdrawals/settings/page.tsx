'use client';

import { useState, useEffect } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { Loader2, Save, AlertCircle } from 'lucide-react';

interface TokenRow {
  id: string;
  symbol: string;
  name: string;
  chain_id: string;
  min_withdrawal: string | null;
  max_withdrawal: string | null;
  withdrawal_fee: string | null;
}

export default function WithdrawalSettingsPage() {
  const { accessToken } = useAdminAuthStore();
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [edits, setEdits] = useState<Record<string, { min: string; max: string }>>({});

  const apiUrl = getApiBaseUrl();

  useEffect(() => {
    if (!accessToken) return;
    setLoading(true);
    fetch(`${apiUrl}/api/v1/admin/tokens`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((r) => r.json())
      .then((data) => {
        if (data?.success && Array.isArray(data?.data?.tokens)) {
          setTokens(data.data.tokens);
          const initial: Record<string, { min: string; max: string }> = {};
          data.data.tokens.forEach((t: TokenRow) => {
            initial[t.id] = {
              min: t.min_withdrawal ?? '0',
              max: t.max_withdrawal ?? '',
            };
          });
          setEdits(initial);
        }
      })
      .catch(() => setMessage({ type: 'error', text: 'Failed to load tokens' }))
      .finally(() => setLoading(false));
  }, [accessToken]);

  const handleSave = async (tokenId: string) => {
    const e = edits[tokenId];
    if (!e) return;
    const min = parseFloat(e.min);
    const max = e.max.trim() === '' ? null : parseFloat(e.max);
    if (Number.isNaN(min) || min < 0) {
      setMessage({ type: 'error', text: 'Min must be a number >= 0' });
      return;
    }
    if (max !== null && (Number.isNaN(max) || max < min)) {
      setMessage({ type: 'error', text: 'Max must be >= min or empty for unlimited' });
      return;
    }
    setSavingId(tokenId);
    setMessage(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/admin/tokens/${tokenId}/withdrawal-limits`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          min_withdrawal: min,
          max_withdrawal: max,
        }),
      });
      const data = await res.json();
      if (data?.success) {
        setMessage({ type: 'success', text: `Updated ${data.data?.symbol ?? 'token'} limits` });
        setTokens((prev) =>
          prev.map((t) =>
            t.id === tokenId
              ? {
                  ...t,
                  min_withdrawal: String(min),
                  max_withdrawal: max == null ? null : String(max),
                }
              : t
          )
        );
      } else {
        setMessage({ type: 'error', text: data?.error?.message ?? 'Update failed' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Update failed' });
    } finally {
      setSavingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Withdrawal Settings</h1>
        <p className="text-gray-400 text-sm mt-1">Configure per-token min/max withdrawal limits. Leave max empty for unlimited.</p>
      </div>

      {message && (
        <div
          className={`flex items-center gap-2 px-4 py-3 rounded-lg ${
            message.type === 'success' ? 'bg-green-500/10 text-green-600 dark:text-green-400' : 'bg-red-500/10 text-red-600 dark:text-red-400'
          }`}
        >
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span className="text-sm">{message.text}</span>
        </div>
      )}

      <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
        {tokens.length === 0 ? (
          <div className="p-8 text-center text-gray-500 dark:text-gray-400">No tokens found. Add tokens in blockchain settings.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-400 uppercase">Token</th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-400 uppercase">Chain</th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-400 uppercase">Min withdrawal</th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-400 uppercase">Max withdrawal</th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-400 uppercase">Fee</th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-400 uppercase">Action</th>
                </tr>
              </thead>
              <tbody>
                {tokens.map((t) => (
                  <tr key={t.id} className="border-b border-gray-200 dark:border-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700/20">
                    <td className="px-6 py-4">
                      <span className="font-medium text-gray-900 dark:text-white">{t.symbol}</span>
                      {t.name && t.name !== t.symbol && (
                        <span className="text-gray-500 text-sm ml-1">{t.name}</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-gray-500 dark:text-gray-400">{t.chain_id}</td>
                    <td className="px-6 py-4">
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={edits[t.id]?.min ?? t.min_withdrawal ?? '0'}
                        onChange={(e) =>
                          setEdits((prev) => ({
                            ...prev,
                            [t.id]: { ...prev[t.id], min: e.target.value, max: prev[t.id]?.max ?? (t.max_withdrawal ?? '') },
                          }))
                        }
                        className="w-28 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 text-sm text-gray-900 dark:text-white"
                      />
                    </td>
                    <td className="px-6 py-4">
                      <input
                        type="number"
                        min={0}
                        step="any"
                        placeholder="Unlimited"
                        value={edits[t.id]?.max ?? t.max_withdrawal ?? ''}
                        onChange={(e) =>
                          setEdits((prev) => ({
                            ...prev,
                            [t.id]: { ...prev[t.id], min: prev[t.id]?.min ?? (t.min_withdrawal ?? '0'), max: e.target.value },
                          }))
                        }
                        className="w-28 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 text-sm text-gray-900 dark:text-white"
                      />
                    </td>
                    <td className="px-6 py-4 text-gray-500 dark:text-gray-400">{t.withdrawal_fee ?? '—'}</td>
                    <td className="px-6 py-4">
                      <button
                        type="button"
                        disabled={savingId === t.id}
                        onClick={() => handleSave(t.id)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                      >
                        {savingId === t.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        Save
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-xs text-gray-500 dark:text-gray-400">
        Chain-level withdrawal on/off can be configured under Settings → Blockchain / Chains.
      </p>
    </div>
  );
}
