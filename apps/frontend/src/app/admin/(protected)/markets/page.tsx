'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { getMessageFromApiError } from '@/lib/errorMessages';
import {
  SectionHeader,
  Panel,
  ActionButton,
} from '@/components/admin/control-plane';
import { Button, message } from 'antd';
import { Loader2, Edit2, Pause, Play, RefreshCw, Plus, X } from 'lucide-react';

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
};

export default function MarketManagementPage() {
  const { accessToken } = useAdminAuthStore();
  const [markets, setMarkets] = useState<SpotMarket[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<SpotMarket | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchMarkets = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/v1/admin/spot/markets`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(getMessageFromApiError(data?.error));
      if (data.success && Array.isArray(data.data)) setMarkets(data.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load markets');
      message.error('Failed to load markets');
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
      const data = await res.json();
      if (!res.ok) throw new Error(getMessageFromApiError(data?.error));
      if (data.success && data.data) {
        setMarkets((prev) => prev.map((m) => (m.symbol === editing.symbol ? { ...m, ...data.data } : m)));
        setEditing(null);
        message.success('Market updated');
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setSaving(false);
    }
  };

  const togglePause = async (m: SpotMarket) => {
    const nextStatus = m.status === 'maintenance' ? 'active' : 'maintenance';
    if (!accessToken) return;
    setSaving(true);
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/v1/admin/spot/markets/${encodeURIComponent(m.symbol)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ status: nextStatus }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(getMessageFromApiError(data?.error));
      if (data.success) {
        setMarkets((prev) => prev.map((x) => (x.symbol === m.symbol ? { ...x, status: nextStatus } : x)));
        message.success(nextStatus === 'maintenance' ? 'Market paused' : 'Market resumed');
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Market Management"
        subtitle="Create trading pairs, enable/disable markets, modify fees, tick size, and minimum order sizes"
        action={
          <div className="flex gap-2">
            <Link href="/admin/settings/trading-pairs">
              <Button type="primary" icon={<Plus className="w-4 h-4" />}>
                Create Pair
              </Button>
            </Link>
            <ActionButton variant="secondary" onClick={fetchMarkets} loading={loading} icon={<RefreshCw className="w-4 h-4" />}>
              Refresh
            </ActionButton>
          </div>
        }
      />

      {error && (
        <div className="flex items-center justify-between px-4 py-2 bg-red-500/10 border border-red-500/30 rounded-lg text-red-600 dark:text-red-400 text-sm">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)}><X className="w-4 h-4" /></button>
        </div>
      )}

      <Panel title="Trading Pairs" subtitle="Edit fees, min size, and tick size. Pause/resume markets.">
        {loading && markets.length === 0 ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                  <th className="p-3">Symbol</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Min Qty</th>
                  <th className="p-3">Min Notional</th>
                  <th className="p-3">Maker / Taker Fee</th>
                  <th className="p-3">Tick (qty)</th>
                  <th className="p-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {markets.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-gray-500">
                      No trading pairs. <Link href="/admin/settings/trading-pairs" className="text-blue-500 hover:underline">Create a pair</Link>
                    </td>
                  </tr>
                ) : (
                  markets.map((m) => (
                    <tr key={m.id} className="border-b border-gray-100 dark:border-gray-800">
                      <td className="p-3 font-medium">{m.symbol}</td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded text-xs ${m.status === 'active' ? 'bg-green-500/20 text-green-600 dark:text-green-400' : 'bg-amber-500/20 text-amber-600 dark:text-amber-400'}`}>
                          {m.status}
                        </span>
                      </td>
                      <td className="p-3">{m.min_qty}</td>
                      <td className="p-3">{m.min_notional}</td>
                      <td className="p-3">{(parseFloat(m.maker_fee) * 100).toFixed(2)}% / {(parseFloat(m.taker_fee) * 100).toFixed(2)}%</td>
                      <td className="p-3">10^-{m.qty_precision}</td>
                      <td className="p-3 flex items-center gap-2">
                        <button type="button" onClick={() => setEditing(m)} className="text-blue-500 hover:underline flex items-center gap-1">
                          <Edit2 className="w-3.5 h-3.5" /> Edit
                        </button>
                        {m.status === 'active' ? (
                          <button type="button" onClick={() => togglePause(m)} className="text-amber-500 hover:underline flex items-center gap-1">
                            <Pause className="w-3.5 h-3.5" /> Pause
                          </button>
                        ) : (
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
        )}
      </Panel>

      {editing && (
        <MarketEditModal market={editing} onClose={() => setEditing(null)} onSave={handleSave} saving={saving} />
      )}
    </div>
  );
}

function MarketEditModal({
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
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Edit: {market.symbol}</h2>
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
              <option value="maintenance">Maintenance</option>
              <option value="disabled">Disabled</option>
            </select>
          </label>
          <label className="block text-sm text-gray-600 dark:text-gray-400">
            Min quantity (tick size)
            <input type="number" step="any" min="0" value={minQty} onChange={(e) => setMinQty(e.target.value)} className="mt-1 w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700" />
          </label>
          <label className="block text-sm text-gray-600 dark:text-gray-400">
            Min notional
            <input type="number" step="any" min="0" value={minNotional} onChange={(e) => setMinNotional(e.target.value)} className="mt-1 w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700" />
          </label>
          <label className="block text-sm text-gray-600 dark:text-gray-400">
            Maker fee (e.g. 0.001 = 0.1%)
            <input type="number" step="0.0001" min="0" max="1" value={makerFee} onChange={(e) => setMakerFee(e.target.value)} className="mt-1 w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700" />
          </label>
          <label className="block text-sm text-gray-600 dark:text-gray-400">
            Taker fee (e.g. 0.001 = 0.1%)
            <input type="number" step="0.0001" min="0" max="1" value={takerFee} onChange={(e) => setTakerFee(e.target.value)} className="mt-1 w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700" />
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button type="primary" htmlType="submit" loading={saving}>
              Save
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
