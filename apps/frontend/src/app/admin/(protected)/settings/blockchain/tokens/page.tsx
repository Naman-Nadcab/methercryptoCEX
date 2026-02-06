'use client';

import { useState, useEffect, useMemo } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { Coins, Edit2, Loader2, Save, Link2, Search, ChevronDown } from 'lucide-react';
import { getApiBaseUrl } from '@/lib/getApiUrl';

interface Token {
  id: string;
  symbol: string;
  name: string;
  chain_id: string;
  min_withdrawal: string | null;
  max_withdrawal: string | null;
  withdrawal_fee: string | null;
}

/** One currency row: symbol + name + all token rows (per chain) */
interface CurrencyGroup {
  symbol: string;
  name: string;
  tokens: Token[];
}

function formatLimit(value: string | null): string {
  if (value == null || value === '') return '—';
  const n = parseFloat(value);
  if (isNaN(n)) return value;
  if (n === 0) return '0';
  if (n >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: 8, minimumFractionDigits: 0 });
  const s = n.toFixed(18).replace(/\.?0+$/, '');
  return s.length > 12 ? n.toExponential(4) : s;
}

/** Display min limit; default "0" when not set */
function formatMin(value: string | null): string {
  if (value == null || value === '') return '0';
  return formatLimit(value);
}

/** Display max limit; default "—" when not set (unlimited) */
function formatMax(value: string | null): string {
  if (value == null || value === '') return '—';
  return formatLimit(value);
}

function groupTokensByCurrency(tokens: Token[]): CurrencyGroup[] {
  const bySymbol = new Map<string, Token[]>();
  for (const t of tokens) {
    const key = t.symbol;
    if (!bySymbol.has(key)) bySymbol.set(key, []);
    bySymbol.get(key)!.push(t);
  }
  return Array.from(bySymbol.entries()).map(([symbol, list]) => ({
    symbol,
    name: list[0]?.name ?? symbol,
    tokens: list.sort((a, b) => (a.chain_id || '').localeCompare(b.chain_id || '')),
  }));
}

export default function TokensPage() {
  const { accessToken } = useAdminAuthStore();
  const [tokens, setTokens] = useState<Token[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingGroup, setEditingGroup] = useState<CurrencyGroup | null>(null);
  const [saving, setSaving] = useState(false);
  /** Per-token-id state: { id: { min, max } } */
  const [limitsByTokenId, setLimitsByTokenId] = useState<Record<string, { min: string; max: string }>>({});
  /** In table CHAINS column: selected chain (token id) per currency symbol */
  const [selectedChainBySymbol, setSelectedChainBySymbol] = useState<Record<string, string>>({});
  /** In edit modal: which chain is being edited (set from table selection when opening) */
  const [selectedTokenId, setSelectedTokenId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const apiUrl = getApiBaseUrl();

  const fetchTokens = async () => {
    if (!accessToken) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${apiUrl}/api/v1/admin/tokens`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      if (data.success) setTokens(data.data.tokens ?? []);
      else setError(data.error?.message ?? 'Failed to load tokens');
    } catch (e) {
      setError('Failed to load tokens');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTokens();
  }, [accessToken]);

  const groups = useMemo(() => groupTokensByCurrency(tokens), [tokens]);

  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) return groups;
    const q = searchQuery.toLowerCase().trim();
    return groups.filter(
      (g) =>
        g.symbol.toLowerCase().includes(q) ||
        g.name.toLowerCase().includes(q) ||
        g.tokens.some((t) => (t.chain_id || '').toLowerCase().includes(q))
    );
  }, [groups, searchQuery]);

  const openEdit = (group: CurrencyGroup) => {
    setEditingGroup(group);
    const next: Record<string, { min: string; max: string }> = {};
    group.tokens.forEach((t) => {
      next[t.id] = {
        min: t.min_withdrawal ?? '0',
        max: t.max_withdrawal ?? '',
      };
    });
    setLimitsByTokenId(next);
    const tokenId = selectedChainBySymbol[group.symbol] ?? group.tokens[0]?.id ?? null;
    setSelectedTokenId(tokenId);
  };

  const closeEdit = () => {
    setEditingGroup(null);
    setLimitsByTokenId({});
  };

  const setLimitForToken = (tokenId: string, field: 'min' | 'max', value: string) => {
    setLimitsByTokenId((prev) => ({
      ...prev,
      [tokenId]: {
        ...prev[tokenId],
        [field]: value,
      },
    }));
  };

  /** Save only the currently selected chain in the modal */
  const handleSaveCurrentChain = async () => {
    if (!editingGroup || !accessToken || !selectedTokenId) return;
    const t = editingGroup.tokens.find((x) => x.id === selectedTokenId);
    if (!t) return;
    const state = limitsByTokenId[t.id];
    if (!state) return;
    const minNum = state.min === '' ? 0 : parseFloat(state.min);
    const maxNum = state.max.trim() === '' ? null : parseFloat(state.max);
    if (minNum < 0 || (maxNum != null && (isNaN(maxNum) || maxNum < 0))) {
      setError(`Min and max must be >= 0. Leave max empty for unlimited.`);
      return;
    }
    if (maxNum != null && maxNum < minNum) {
      setError('Max must be >= min.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`${apiUrl}/api/v1/admin/tokens/${t.id}/withdrawal-limits`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          min_withdrawal: minNum,
          max_withdrawal: maxNum,
        }),
      });
      const data = await res.json();
      if (data.success) {
        await fetchTokens();
        closeEdit();
        setSuccessMessage('Saved successfully');
        setTimeout(() => setSuccessMessage(null), 1000);
      } else {
        setError(data.error?.message ?? 'Failed to update');
      }
    } catch (e) {
      setError('Failed to update');
    } finally {
      setSaving(false);
    }
  };

  const withMaxSet = tokens.filter((t) => t.max_withdrawal != null && t.max_withdrawal !== '').length;
  const unlimitedCount = tokens.filter((t) => t.max_withdrawal == null || t.max_withdrawal === '').length;

  if (loading && tokens.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[320px]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading tokens…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
          <span className="flex items-center justify-center w-10 h-10 rounded-xl bg-blue-500/10 text-blue-500">
            <Coins className="w-6 h-6" />
          </span>
          <span className="flex items-center gap-2">
            Tokens (Withdrawal Limits)
            <Link2 className="w-5 h-5 text-gray-400 dark:text-gray-500" aria-hidden />
          </span>
        </h1>
        <p className="text-gray-500 dark:text-gray-400 text-sm mt-1.5 max-w-2xl">
          Manage per-token min/max withdrawal amounts per chain. Used at withdrawal time. Leave max empty for unlimited (e.g. testing).
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4 shadow-sm">
          <div className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider">Currencies</div>
          <div className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{groups.length}</div>
        </div>
        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4 shadow-sm">
          <div className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider">With max limit</div>
          <div className="text-2xl font-bold text-blue-500 dark:text-blue-400 mt-1">{withMaxSet}</div>
        </div>
        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4 shadow-sm">
          <div className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider">Unlimited max</div>
          <div className="text-2xl font-bold text-emerald-500 dark:text-emerald-400 mt-1">{unlimitedCount}</div>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </div>
      )}

      {successMessage && (
        <div
          className="rounded-xl border border-emerald-500/30 bg-emerald-500/15 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-400 font-medium text-center"
          role="status"
          aria-live="polite"
        >
          {successMessage}
        </div>
      )}

      {/* Search */}
      <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4 shadow-sm">
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by symbol, name or chain…"
            className="w-full pl-10 pr-4 py-2.5 bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white text-sm placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 outline-none transition-shadow"
          />
        </div>
      </div>

      {/* Table card — one row per currency */}
      <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden shadow-sm">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Withdrawal limits by currency</h2>
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {filteredGroups.length === groups.length
              ? `${groups.length} currencies`
              : `${filteredGroups.length} of ${groups.length} currencies`}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead className="bg-gray-50 dark:bg-gray-900/80 sticky top-0 z-10">
              <tr>
                <th className="px-4 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Symbol
                </th>
                <th className="px-4 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Name
                </th>
                <th className="px-4 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Chains
                </th>
                <th className="px-4 py-3.5 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Min
                </th>
                <th className="px-4 py-3.5 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Max
                </th>
                <th className="px-4 py-3.5 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {filteredGroups.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-gray-500 dark:text-gray-400 text-sm">
                    {groups.length === 0 ? 'No currencies with tokens found.' : 'No currencies match your search.'}
                  </td>
                </tr>
              ) : (
                filteredGroups.map((group) => (
                  <tr key={group.symbol} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                    <td className="px-4 py-3">
                      <span className="font-mono font-semibold text-gray-900 dark:text-white">{group.symbol}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300 text-sm max-w-[200px] truncate" title={group.name}>
                      {group.name}
                    </td>
                    <td className="px-4 py-3">
                      <div className="relative min-w-[140px] max-w-[200px]">
                        <select
                          value={selectedChainBySymbol[group.symbol] ?? group.tokens[0]?.id ?? ''}
                          onChange={(e) =>
                            setSelectedChainBySymbol((prev) => ({
                              ...prev,
                              [group.symbol]: e.target.value,
                            }))
                          }
                          className="w-full appearance-none pl-3 pr-8 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white text-sm font-mono focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 outline-none"
                          aria-label={`Select chain for ${group.symbol}`}
                        >
                          {group.tokens.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.chain_id || 'Global'}
                            </option>
                          ))}
                        </select>
                        <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500 pointer-events-none" aria-hidden />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm text-gray-700 dark:text-gray-300 tabular-nums">
                      {(() => {
                        const tokenId = selectedChainBySymbol[group.symbol] ?? group.tokens[0]?.id;
                        const t = tokenId ? group.tokens.find((x) => x.id === tokenId) : null;
                        return t ? formatMin(t.min_withdrawal) : '0';
                      })()}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm text-gray-700 dark:text-gray-300 tabular-nums">
                      {(() => {
                        const tokenId = selectedChainBySymbol[group.symbol] ?? group.tokens[0]?.id;
                        const t = tokenId ? group.tokens.find((x) => x.id === tokenId) : null;
                        return t ? formatMax(t.max_withdrawal) : '—';
                      })()}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        type="button"
                        onClick={() => openEdit(group)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600/15 text-blue-600 dark:text-blue-400 hover:bg-blue-600/25 dark:hover:bg-blue-500/20 text-sm font-medium transition-colors"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                        Edit limits
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit modal — min/max only (chain chosen in table CHAINS column) */}
      {editingGroup && selectedTokenId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm overflow-y-auto"
          onClick={closeEdit}
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-modal-title"
        >
          <div
            className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl w-full max-w-lg shadow-2xl my-8"
            onClick={(e) => e.stopPropagation()}
          >
            {(() => {
              const t = editingGroup.tokens.find((x) => x.id === selectedTokenId);
              if (!t) return null;
              return (
                <>
                  <div className="p-6 border-b border-gray-200 dark:border-gray-700">
                    <h3 id="edit-modal-title" className="text-lg font-semibold text-gray-900 dark:text-white">
                      Edit withdrawal limits — {editingGroup.symbol}
                    </h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                      Chain: <span className="font-mono text-gray-700 dark:text-gray-300">{t.chain_id || 'Global'}</span>. Leave max empty for unlimited.
                    </p>
                  </div>
                  <div className="p-6 space-y-4">
                    <div className="rounded-xl border border-gray-200 dark:border-gray-600 p-4 bg-gray-50/50 dark:bg-gray-700/20 space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Min withdrawal</label>
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={limitsByTokenId[t.id]?.min ?? ''}
                            onChange={(e) => setLimitForToken(t.id, 'min', e.target.value)}
                            className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Max (empty = unlimited)</label>
                          <input
                            type="number"
                            min="0"
                            step="any"
                            placeholder="Unlimited"
                            value={limitsByTokenId[t.id]?.max ?? ''}
                            onChange={(e) => setLimitForToken(t.id, 'max', e.target.value)}
                            className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white text-sm placeholder-gray-400 focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 outline-none"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="p-6 pt-0 flex justify-end gap-3">
                    <button
                      type="button"
                      onClick={closeEdit}
                      className="px-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 text-sm font-medium transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveCurrentChain}
                      disabled={saving}
                      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 text-sm font-medium transition-colors"
                    >
                      {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      Save
                    </button>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
