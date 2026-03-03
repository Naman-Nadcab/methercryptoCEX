'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { ArrowUpFromLine, Loader2, RefreshCw, Pencil, X, Check, Search } from 'lucide-react';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { toast } from '@/components/ui/toaster';

interface CurrencyRow {
  id: string;
  symbol: string;
  name: string;
  withdrawal_fee: string | null;
  withdrawal_fee_type: string;
  min_withdrawal: string | null;
  withdrawal_enabled: boolean;
  chain_symbol?: string;
}

export default function WithdrawalFeesPage() {
  const { accessToken } = useAdminAuthStore();
  const [currencies, setCurrencies] = useState<CurrencyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [chainFilter, setChainFilter] = useState<string>('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFee, setEditFee] = useState('');
  const [editType, setEditType] = useState<'fixed' | 'percentage'>('fixed');
  const [saving, setSaving] = useState(false);

  // Filter by search first; chain dropdown options come from this list only
  const searchFiltered = currencies.filter((row) => {
    if (!searchQuery.trim()) return true;
    return (
      row.symbol.toUpperCase().includes(searchQuery.trim().toUpperCase()) ||
      row.name.toUpperCase().includes(searchQuery.trim().toUpperCase())
    );
  });

  // Chain dropdown shows only chains that exist for the searched currency/currencies
  const chainOptions = Array.from(
    new Set(searchFiltered.map((c) => c.chain_symbol).filter(Boolean) as string[])
  ).sort();

  // Final list: search + selected chain
  const filteredCurrencies = searchFiltered.filter((row) => {
    return !chainFilter || (row.chain_symbol || '') === chainFilter;
  });

  const fetchData = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const apiUrl = getApiBaseUrl();
      const res = await fetch(`${apiUrl}/api/v1/admin/fees/withdrawal`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const result = await res.json();
      if (result.success && result.data) {
        setCurrencies(result.data.currencies || []);
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

  // Clear chain filter when it's no longer in options (e.g. after changing search)
  useEffect(() => {
    if (chainFilter && !chainOptions.includes(chainFilter)) {
      setChainFilter('');
    }
  }, [chainFilter, chainOptions]);

  const startEdit = (row: CurrencyRow) => {
    setEditingId(row.id);
    setEditFee(row.withdrawal_fee ?? '0');
    setEditType((row.withdrawal_fee_type as 'fixed' | 'percentage') || 'fixed');
  };

  const cancelEdit = () => setEditingId(null);

  const saveCurrency = async () => {
    if (!accessToken || !editingId) return;
    setSaving(true);
    try {
      const apiUrl = getApiBaseUrl();
      const res = await fetch(`${apiUrl}/api/v1/admin/fees/withdrawal/currency/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          withdrawal_fee: parseFloat(editFee),
          withdrawal_fee_type: editType,
        }),
      });
      const result = await res.json();
      if (result.success) {
        setCurrencies((prev) =>
          prev.map((c) =>
            c.id === editingId ? { ...c, withdrawal_fee: editFee, withdrawal_fee_type: editType } : c
          )
        );
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
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Withdrawal Fees</h1>
        <p className="text-gray-400 text-sm mt-1">Set withdrawal fee per currency (fixed amount or percentage).</p>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search by currency (e.g. BTC, ETH, USDT)"
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
        <div className="flex items-center gap-2">
          <label htmlFor="chain-filter" className="text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">Chain:</label>
          <select
            id="chain-filter"
            value={chainFilter}
            onChange={(e) => setChainFilter(e.target.value)}
            className="px-3 py-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white min-w-[140px]"
          >
            <option value="">All chains</option>
            {chainOptions.map((chain) => (
              <option key={chain} value={chain}>
                {chain}
              </option>
            ))}
          </select>
        </div>
        <button onClick={fetchData} disabled={loading} className="p-2.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800">
          <RefreshCw className={`w-4 h-4 text-gray-600 dark:text-gray-400 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
          </div>
        ) : currencies.length === 0 ? (
          <div className="p-12 text-center text-gray-500 dark:text-gray-400">No currencies found.</div>
        ) : (
          <>
            {(searchQuery || chainFilter) && (
              <div className="px-6 py-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 text-sm text-gray-500 dark:text-gray-400">
                Showing {filteredCurrencies.length} of {currencies.length} currenc{filteredCurrencies.length !== 1 ? 'ies' : 'y'}
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/80">
                    <th className="text-left px-6 py-4 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Currency</th>
                    <th className="text-left px-6 py-4 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Network</th>
                    <th className="text-left px-6 py-4 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Fee type</th>
                    <th className="text-left px-6 py-4 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Fee</th>
                    <th className="text-left px-6 py-4 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCurrencies.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">
                        No currencies match your filters. Try a different search or chain.
                      </td>
                    </tr>
                  ) : (
                    filteredCurrencies.map((row) => (
                  <tr key={row.id} className="border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/20">
                    <td className="px-6 py-4">
                      <p className="font-medium text-gray-900 dark:text-white">{row.symbol}</p>
                      <p className="text-xs text-gray-500">{row.name}</p>
                    </td>
                    <td className="px-6 py-4 text-gray-500 dark:text-gray-400">{row.chain_symbol || '—'}</td>
                    {editingId === row.id ? (
                      <>
                        <td className="px-6 py-4">
                          <select
                            value={editType}
                            onChange={(e) => setEditType(e.target.value as 'fixed' | 'percentage')}
                            className="px-2 py-1 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded text-gray-900 dark:text-white"
                          >
                            <option value="fixed">Fixed</option>
                            <option value="percentage">Percentage</option>
                          </select>
                        </td>
                        <td className="px-6 py-4">
                          <input
                            type="number"
                            step="0.00000001"
                            min="0"
                            value={editFee}
                            onChange={(e) => setEditFee(e.target.value)}
                            className="w-28 px-2 py-1 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded text-gray-900 dark:text-white"
                          />
                        </td>
                        <td className="px-6 py-4 flex gap-2">
                          <button onClick={saveCurrency} disabled={saving} className="p-1.5 rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50">
                            <Check className="w-4 h-4" />
                          </button>
                          <button onClick={cancelEdit} className="p-1.5 rounded bg-gray-500 text-white hover:bg-gray-600">
                            <X className="w-4 h-4" />
                          </button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-6 py-4 text-gray-500 dark:text-gray-400">{row.withdrawal_fee_type || 'fixed'}</td>
                        <td className="px-6 py-4 text-gray-900 dark:text-white">
                          {row.withdrawal_fee ?? '0'}
                          {row.withdrawal_fee_type === 'percentage' ? '%' : ''}
                        </td>
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
