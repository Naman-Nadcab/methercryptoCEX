'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { TrendingUp, Loader2, RefreshCw, Pencil, X, Check, Search } from 'lucide-react';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { toast } from '@/components/ui/toaster';

interface PairRow {
  id: string;
  symbol: string;
  base_symbol: string;
  quote_symbol: string;
  maker_fee: string;
  taker_fee: string;
  status?: string;
  trading_enabled?: boolean;
}

export default function TradingFeesConfigPage() {
  const { accessToken } = useAdminAuthStore();
  const [pairs, setPairs] = useState<PairRow[]>([]);
  const [defaultMakerFee, setDefaultMakerFee] = useState('0.001');
  const [defaultTakerFee, setDefaultTakerFee] = useState('0.001');
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editMaker, setEditMaker] = useState('');
  const [editTaker, setEditTaker] = useState('');
  const [saving, setSaving] = useState(false);

  const filteredPairs = pairs.filter((row) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.trim().toUpperCase();
    return (
      row.symbol.toUpperCase().includes(q) ||
      row.base_symbol?.toUpperCase().includes(q) ||
      row.quote_symbol?.toUpperCase().includes(q)
    );
  });

  const fetchData = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const apiUrl = getApiBaseUrl();
      const res = await fetch(`${apiUrl}/api/v1/admin/fees/trading`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const result = await res.json();
      if (result.success && result.data) {
        setPairs(result.data.pairs || []);
        setDefaultMakerFee(result.data.defaultMakerFee ?? '0.001');
        setDefaultTakerFee(result.data.defaultTakerFee ?? '0.001');
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const startEdit = (row: PairRow) => {
    setEditingId(row.id);
    setEditMaker(row.maker_fee);
    setEditTaker(row.taker_fee);
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  const savePair = async () => {
    if (!accessToken || !editingId) return;
    setSaving(true);
    try {
      const apiUrl = getApiBaseUrl();
      const res = await fetch(`${apiUrl}/api/v1/admin/fees/trading/pair/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          maker_fee: parseFloat(editMaker),
          taker_fee: parseFloat(editTaker),
        }),
      });
      const result = await res.json();
      if (result.success) {
        setPairs((prev) => prev.map((p) => (p.id === editingId ? { ...p, maker_fee: editMaker, taker_fee: editTaker } : p)));
        setEditingId(null);
      } else {
        toast({ title: 'Error', description: result.error?.message || 'Failed to update', variant: 'destructive' });
      }
    } catch (e) {
      console.error(e);
      toast({ title: 'Error', description: 'Request failed', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Trading Fees (Spot)</h1>
        <p className="text-gray-400 text-sm mt-1">Configure maker and taker fees per trading pair. Default is from Fee Tier 0.</p>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search by pair or currency (e.g. BTC, ETH, USDT)"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              aria-label="Clear search"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <button onClick={fetchData} disabled={loading} className="p-2.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800">
          <RefreshCw className={`w-4 h-4 text-gray-600 dark:text-gray-400 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">Default maker fee (Tier 0)</p>
          <p className="text-xl font-bold text-green-600 dark:text-green-400">{(parseFloat(defaultMakerFee) * 100).toFixed(2)}%</p>
        </div>
        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">Default taker fee (Tier 0)</p>
          <p className="text-xl font-bold text-amber-600 dark:text-amber-400">{(parseFloat(defaultTakerFee) * 100).toFixed(2)}%</p>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
          </div>
        ) : pairs.length === 0 ? (
          <div className="p-12 text-center text-gray-500 dark:text-gray-400">No trading pairs found. Add pairs in Settings → Trading Pairs.</div>
        ) : (
          <>
            {searchQuery && (
              <div className="px-6 py-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 text-sm text-gray-500 dark:text-gray-400">
                Showing {filteredPairs.length} of {pairs.length} pair{pairs.length !== 1 ? 's' : ''}
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/80">
                    <th className="text-left px-6 py-4 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Pair</th>
                    <th className="text-left px-6 py-4 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Maker fee</th>
                    <th className="text-left px-6 py-4 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Taker fee</th>
                    <th className="text-left px-6 py-4 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPairs.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">
                        No pairs match &quot;{searchQuery}&quot;. Try another currency or pair symbol.
                      </td>
                    </tr>
                  ) : (
                    filteredPairs.map((row) => (
                  <tr key={row.id} className="border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/20">
                    <td className="px-6 py-4 font-medium text-gray-900 dark:text-white">{row.symbol}</td>
                    {editingId === row.id ? (
                      <>
                        <td className="px-6 py-4">
                          <input
                            type="number"
                            step="0.0001"
                            min="0"
                            max="1"
                            value={editMaker}
                            onChange={(e) => setEditMaker(e.target.value)}
                            className="w-24 px-2 py-1 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded text-gray-900 dark:text-white"
                          />
                        </td>
                        <td className="px-6 py-4">
                          <input
                            type="number"
                            step="0.0001"
                            min="0"
                            max="1"
                            value={editTaker}
                            onChange={(e) => setEditTaker(e.target.value)}
                            className="w-24 px-2 py-1 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded text-gray-900 dark:text-white"
                          />
                        </td>
                        <td className="px-6 py-4 flex gap-2">
                          <button onClick={savePair} disabled={saving} className="p-1.5 rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50">
                            <Check className="w-4 h-4" />
                          </button>
                          <button onClick={cancelEdit} className="p-1.5 rounded bg-gray-500 text-white hover:bg-gray-600">
                            <X className="w-4 h-4" />
                          </button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-6 py-4 text-green-600 dark:text-green-400">{(parseFloat(row.maker_fee) * 100).toFixed(2)}%</td>
                        <td className="px-6 py-4 text-amber-600 dark:text-amber-400">{(parseFloat(row.taker_fee) * 100).toFixed(2)}%</td>
                        <td className="px-6 py-4">
                          <button onClick={() => startEdit(row)} className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400">
                            <Pencil className="w-4 h-4" />
                          </button>
                        </td>
                      </>
                    )}
                  </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
