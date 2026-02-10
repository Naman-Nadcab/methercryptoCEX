'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { getMessageFromApiError } from '@/lib/errorMessages';
import { Loader2, Edit2, Pause, Play, X } from 'lucide-react';

type SpotMarket = {
  id: string;
  symbol: string;
  base_asset: string;
  quote_asset: string;
  status: string;
  min_qty: string;
  min_notional: string;
  price_precision: number;
  qty_precision: number;
  maker_fee: string;
  taker_fee: string;
  created_at: string;
  updated_at: string;
};

export default function SpotMarketsAdminPage() {
  const { accessToken } = useAdminAuthStore();
  const [markets, setMarkets] = useState<SpotMarket[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<SpotMarket | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchMarkets = useCallback(async () => {
    if (!accessToken) {
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/v1/admin/spot/markets`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      let data: { success?: boolean; data?: SpotMarket[]; error?: { code?: string; message?: string } };
      try {
        data = await res.json();
      } catch {
        setError('Could not load spot markets. Please try again.');
        setLoading(false);
        return;
      }
      if (!res.ok) {
        setError(getMessageFromApiError(data?.error));
        setLoading(false);
        return;
      }
      if (data.success && Array.isArray(data.data)) {
        setMarkets(data.data);
      } else {
        setError(getMessageFromApiError(data?.error) || 'Failed to load markets');
      }
    } catch (e) {
      setError('Could not load spot markets. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    fetchMarkets();
  }, [fetchMarkets]);

  const handleSave = async (payload: Partial<{ status: string; min_qty: number; min_notional: number; maker_fee: number; taker_fee: number }>) => {
    if (!editing || !accessToken) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/v1/admin/spot/markets/${encodeURIComponent(editing.symbol)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(payload),
      });
      let data: { success?: boolean; data?: SpotMarket; error?: { code?: string; message?: string } };
      try {
        data = await res.json();
      } catch {
        setError('Update failed. Please try again.');
        setSaving(false);
        return;
      }
      if (!res.ok) {
        setError(getMessageFromApiError(data?.error));
        setSaving(false);
        return;
      }
      if (data.success && data.data) {
        setMarkets((prev) => prev.map((m) => (m.symbol === editing.symbol ? { ...m, ...data.data } : m)));
        setEditing(null);
      } else {
        setError(getMessageFromApiError(data?.error) || 'Update failed');
      }
    } catch (e) {
      setError('Could not save. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  const togglePause = async (m: SpotMarket) => {
    const nextStatus = m.status === 'maintenance' ? 'active' : 'maintenance';
    if (!accessToken) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/v1/admin/spot/markets/${encodeURIComponent(m.symbol)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ status: nextStatus }),
      });
      let data: { success?: boolean; data?: SpotMarket; error?: { code?: string; message?: string } };
      try {
        data = await res.json();
      } catch {
        setError('Update failed. Please try again.');
        setSaving(false);
        return;
      }
      if (!res.ok) {
        setError(getMessageFromApiError(data?.error));
        setSaving(false);
        return;
      }
      if (data.success) {
        setMarkets((prev) => prev.map((x) => (x.symbol === m.symbol ? { ...x, status: nextStatus } : x)));
      } else {
        setError(getMessageFromApiError(data?.error) || 'Update failed');
      }
    } catch (e) {
      setError('Could not update status. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Spot Markets</h1>
        <p className="text-gray-400 text-sm mt-1">Enable/disable markets, set min size, and maker/taker fees</p>
      </div>

      {error && (
        <div className="flex items-center justify-between px-4 py-2 bg-red-500/10 border border-red-500/30 rounded-lg text-red-600 dark:text-red-400 text-sm">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)}><X className="w-4 h-4" /></button>
        </div>
      )}

      <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
              <th className="p-3">Symbol</th>
              <th className="p-3">Status</th>
              <th className="p-3">Min Qty</th>
              <th className="p-3">Min Notional</th>
              <th className="p-3">Maker / Taker Fee</th>
              <th className="p-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {markets.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-8 text-center text-gray-500 dark:text-gray-400">
                  No spot markets configured
                </td>
              </tr>
            ) : (
              markets.map((m) => (
                <tr key={m.id} className="border-b border-gray-100 dark:border-gray-800">
                  <td className="p-3 font-medium">{m.symbol}</td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded text-xs ${m.status === 'active' ? 'bg-green-500/20 text-green-600 dark:text-green-400' : m.status === 'maintenance' ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400' : 'bg-gray-500/20 text-gray-600 dark:text-gray-400'}`}>
                      {m.status}
                    </span>
                  </td>
                  <td className="p-3">{m.min_qty}</td>
                  <td className="p-3">{m.min_notional}</td>
                  <td className="p-3">{(parseFloat(m.maker_fee) * 100).toFixed(2)}% / {(parseFloat(m.taker_fee) * 100).toFixed(2)}%</td>
                  <td className="p-3 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setEditing(m)}
                      className="text-blue-500 hover:underline flex items-center gap-1"
                    >
                      <Edit2 className="w-3.5 h-3.5" /> Edit
                    </button>
                    {m.status === 'active' && (
                      <button type="button" onClick={() => togglePause(m)} className="text-amber-500 hover:underline flex items-center gap-1">
                        <Pause className="w-3.5 h-3.5" /> Pause
                      </button>
                    )}
                    {m.status === 'maintenance' && (
                      <button type="button" onClick={() => togglePause(m)} className="text-green-500 hover:underline flex items-center gap-1">
                        <Play className="w-3.5 h-3.5" /> Resume
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <SpotMarketEditModal
          market={editing}
          onClose={() => setEditing(null)}
          onSave={handleSave}
          saving={saving}
        />
      )}
    </div>
  );
}

function SpotMarketEditModal({
  market,
  onClose,
  onSave,
  saving,
}: {
  market: SpotMarket;
  onClose: () => void;
  onSave: (p: Partial<{ status: string; min_qty: number; min_notional: number; maker_fee: number; taker_fee: number }>) => void;
  saving: boolean;
}) {
  const [status, setStatus] = useState(market.status);
  const [minQty, setMinQty] = useState(market.min_qty);
  const [minNotional, setMinNotional] = useState(market.min_notional);
  const [makerFee, setMakerFee] = useState(market.maker_fee);
  const [takerFee, setTakerFee] = useState(market.taker_fee);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      status,
      min_qty: parseFloat(minQty) || 0,
      min_notional: parseFloat(minNotional) || 0,
      maker_fee: parseFloat(makerFee) ?? 0.001,
      taker_fee: parseFloat(takerFee) ?? 0.001,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Edit market: {market.symbol}</h2>
          <button type="button" onClick={onClose} className="text-gray-500 hover:text-gray-700"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <label className="block text-sm text-gray-600 dark:text-gray-400">
            Status
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="mt-1 w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              <option value="active">Active</option>
              <option value="maintenance">Maintenance (pause trading)</option>
              <option value="disabled">Disabled</option>
            </select>
          </label>
          <label className="block text-sm text-gray-600 dark:text-gray-400">
            Min quantity
            <input type="number" step="any" min="0" value={minQty} onChange={(e) => setMinQty(e.target.value)} className="mt-1 w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
          </label>
          <label className="block text-sm text-gray-600 dark:text-gray-400">
            Min notional
            <input type="number" step="any" min="0" value={minNotional} onChange={(e) => setMinNotional(e.target.value)} className="mt-1 w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
          </label>
          <label className="block text-sm text-gray-600 dark:text-gray-400">
            Maker fee (e.g. 0.001 = 0.1%)
            <input type="number" step="0.0001" min="0" max="1" value={makerFee} onChange={(e) => setMakerFee(e.target.value)} className="mt-1 w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
          </label>
          <label className="block text-sm text-gray-600 dark:text-gray-400">
            Taker fee (e.g. 0.001 = 0.1%)
            <input type="number" step="0.0001" min="0" max="1" value={takerFee} onChange={(e) => setTakerFee(e.target.value)} className="mt-1 w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">Cancel</button>
            <button type="submit" disabled={saving} className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 flex items-center gap-2">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
