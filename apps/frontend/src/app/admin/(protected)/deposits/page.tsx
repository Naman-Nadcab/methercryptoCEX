'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import {
  ArrowDownToLine,
  Loader2,
  Search,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  CheckCircle2,
  Copy,
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface DepositStats {
  total: string;
  pending: string;
  confirming: string;
  completed: string;
  failed: string;
  flagged: string;
}

interface Deposit {
  deposit_id: string;
  user_id: string;
  user_email: string;
  chain_id: string;
  chain_name: string;
  chain_symbol: string;
  token_id: string;
  token_symbol: string;
  token_name: string;
  amount: string;
  tx_hash: string | null;
  from_address: string | null;
  to_address: string | null;
  confirmations: number;
  required_confirmations: number;
  status: string;
  credited: boolean;
  credited_at: string | null;
  created_at: string;
  updated_at: string;
  is_flagged: boolean;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface BlockchainOption {
  id: string;
  chain_name: string;
  chain_symbol: string;
  currencies?: { id: string; symbol: string; name: string }[];
}

export default function DepositsPage() {
  const { accessToken } = useAdminAuthStore();
  const [stats, setStats] = useState<DepositStats | null>(null);
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [userSearch, setUserSearch] = useState('');
  const [chainId, setChainId] = useState('');
  const [tokenId, setTokenId] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [chainOptions, setChainOptions] = useState<BlockchainOption[]>([]);
  const [tokenOptions, setTokenOptions] = useState<{ id: string; symbol: string; name: string; chain_name?: string }[]>([]);

  const fetchBlockchains = useCallback(async () => {
    if (!accessToken) return;
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/settings/blockchains`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      if (data.success && data.data?.blockchains) {
        setChainOptions(data.data.blockchains);
        const tokens: { id: string; symbol: string; name: string; chain_name?: string }[] = [];
        data.data.blockchains.forEach((b: BlockchainOption) => {
          (b.currencies || []).forEach((c: { id: string; symbol: string; name: string }) => {
            tokens.push({ id: c.id, symbol: c.symbol, name: c.name, chain_name: b.chain_name });
          });
        });
        setTokenOptions(tokens);
      }
    } catch {
      // Non-blocking; filters still work with raw UUIDs
    }
  }, [accessToken]);

  const fetchDeposits = useCallback(async (pageOverride?: number) => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    const page = pageOverride ?? pagination.page;
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', String(pagination.limit));
      if (userSearch.trim()) params.set('user', userSearch.trim());
      if (chainId) params.set('chain', chainId);
      if (tokenId) params.set('token', tokenId);
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (dateFrom) params.set('date_from', dateFrom);
      if (dateTo) params.set('date_to', dateTo);

      const response = await fetch(`${API_URL}/api/v1/admin/deposits?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const result = await response.json();

      if (!response.ok) {
        setError(result?.error?.message || 'Failed to fetch deposits');
        return;
      }
      if (result.success) {
        setStats(result.data.stats ?? null);
        setDeposits(result.data.deposits ?? []);
        if (result.data.pagination) {
          setPagination((prev) => ({
            ...prev,
            page: result.data.pagination.page ?? prev.page,
            limit: result.data.pagination.limit ?? prev.limit,
            total: result.data.pagination.total ?? 0,
            totalPages: result.data.pagination.totalPages ?? 1,
          }));
        }
      } else {
        setError(result?.error?.message || 'Failed to fetch deposits');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }, [accessToken, pagination.page, pagination.limit, userSearch, chainId, tokenId, statusFilter, dateFrom, dateTo]);

  useEffect(() => {
    fetchBlockchains();
  }, [fetchBlockchains]);

  useEffect(() => {
    fetchDeposits();
  }, [fetchDeposits]);

  const applyFilters = () => {
    setPagination((p) => ({ ...p, page: 1 }));
    fetchDeposits(1);
  };

  const copyTxHash = (tx: string) => {
    navigator.clipboard.writeText(tx);
  };

  const getStatusBadge = (status: string, credited: boolean) => {
    if (credited) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-green-500/20 text-green-400 border border-green-500/30">
          <CheckCircle2 className="w-3.5 h-3.5" />
          Credited
        </span>
      );
    }
    const colors: Record<string, string> = {
      pending: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
      confirming: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
      completed: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
      failed: 'bg-red-500/20 text-red-400 border-red-500/30',
    };
    const style = colors[status] || 'bg-gray-500/20 text-gray-400 border-gray-500/30';
    return (
      <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium border ${style}`}>
        {status}
      </span>
    );
  };

  const shortenHash = (hash: string | null) => {
    if (!hash) return '—';
    if (hash.length <= 14) return hash;
    return `${hash.slice(0, 6)}…${hash.slice(-6)}`;
  };

  if (error && !deposits.length && !loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Deposits</h1>
          <p className="text-gray-400 text-sm mt-1">Manage user deposits</p>
        </div>
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-6 flex items-center gap-4">
          <AlertCircle className="w-10 h-10 text-red-400 shrink-0" />
          <div>
            <p className="font-medium text-red-200">Failed to load deposits</p>
            <p className="text-sm text-red-300/80 mt-1">{error}</p>
            <button
              onClick={() => { setError(null); fetchDeposits(); }}
              className="mt-3 px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-200 rounded-lg text-sm font-medium"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Deposits</h1>
        <p className="text-gray-400 text-sm mt-1">View and filter user deposits. Credited rows are highlighted.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4 shadow-sm">
          <p className="text-sm text-gray-500 dark:text-gray-400">Total</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{stats?.total ?? 0}</p>
        </div>
        <div className="bg-yellow-50 dark:bg-yellow-500/10 border border-yellow-200 dark:border-yellow-500/30 rounded-xl p-4">
          <p className="text-sm text-yellow-600 dark:text-yellow-400">Pending</p>
          <p className="text-2xl font-bold text-yellow-700 dark:text-yellow-300 mt-1">{stats?.pending ?? 0}</p>
        </div>
        <div className="bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30 rounded-xl p-4">
          <p className="text-sm text-blue-600 dark:text-blue-400">Confirming</p>
          <p className="text-2xl font-bold text-blue-700 dark:text-blue-300 mt-1">{stats?.confirming ?? 0}</p>
        </div>
        <div className="bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/30 rounded-xl p-4">
          <p className="text-sm text-green-600 dark:text-green-400">Completed</p>
          <p className="text-2xl font-bold text-green-700 dark:text-green-300 mt-1">{stats?.completed ?? 0}</p>
        </div>
        <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl p-4">
          <p className="text-sm text-red-600 dark:text-red-400">Failed</p>
          <p className="text-2xl font-bold text-red-700 dark:text-red-300 mt-1">{stats?.failed ?? 0}</p>
        </div>
        <div className="bg-orange-50 dark:bg-orange-500/10 border border-orange-200 dark:border-orange-500/30 rounded-xl p-4">
          <p className="text-sm text-orange-600 dark:text-orange-400">Flagged</p>
          <p className="text-2xl font-bold text-orange-700 dark:text-orange-300 mt-1">{stats?.flagged ?? 0}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Filters</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="User (email)"
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
              className="w-full pl-9 pr-3 py-2 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-white placeholder-gray-500"
            />
          </div>
          <select
            value={chainId}
            onChange={(e) => setChainId(e.target.value)}
            className="px-3 py-2 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-white"
          >
            <option value="">All chains</option>
            {chainOptions.map((c) => (
              <option key={c.id} value={c.id}>{c.chain_name} ({c.chain_symbol})</option>
            ))}
          </select>
          <select
            value={tokenId}
            onChange={(e) => setTokenId(e.target.value)}
            className="px-3 py-2 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-white"
          >
            <option value="">All tokens</option>
            {tokenOptions.map((t) => (
              <option key={t.id} value={t.id}>
                {t.symbol}{t.chain_name ? ` (${t.chain_name})` : ''}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-white"
          >
            <option value="all">All statuses</option>
            <option value="pending">Pending</option>
            <option value="confirming">Confirming</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
          </select>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="px-3 py-2 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-white"
            placeholder="From"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="px-3 py-2 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-white"
            placeholder="To"
          />
        </div>
        <div className="mt-3 flex justify-end">
          <button
            onClick={applyFilters}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium"
          >
            Apply filters
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
        {loading && !deposits.length ? (
          <div className="flex items-center justify-center min-h-[320px]">
            <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
          </div>
        ) : deposits.length === 0 ? (
          <div className="p-12 text-center">
            <ArrowDownToLine className="w-12 h-12 text-gray-500 dark:text-gray-500 mx-auto mb-4 opacity-60" />
            <p className="text-gray-500 dark:text-gray-400 font-medium">No deposits found</p>
            <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">Try adjusting filters or date range.</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/80">
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">User</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Chain</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Token</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Amount</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Tx Hash</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Confirmations</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Credited at</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Created at</th>
                  </tr>
                </thead>
                <tbody>
                  {deposits.map((d) => (
                    <tr
                      key={d.deposit_id}
                      className={`border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/20 ${
                        d.credited ? 'bg-green-500/5 dark:bg-green-500/10' : ''
                      }`}
                    >
                      <td className="px-4 py-3">
                        <p className="text-gray-900 dark:text-white font-medium">{d.user_email}</p>
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{d.chain_name || d.chain_symbol}</td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{d.token_symbol}</td>
                      <td className="px-4 py-3">
                        <span className="text-gray-900 dark:text-white font-medium">
                          {typeof d.amount === 'string' ? parseFloat(d.amount).toFixed(8) : Number(d.amount).toFixed(8)}
                        </span>
                        <span className="text-gray-400 ml-1">{d.token_symbol}</span>
                      </td>
                      <td className="px-4 py-3">
                        {d.tx_hash ? (
                          <button
                            type="button"
                            onClick={() => copyTxHash(d.tx_hash!)}
                            className="inline-flex items-center gap-1 text-blue-500 hover:text-blue-400 font-mono text-xs"
                            title={d.tx_hash}
                          >
                            {shortenHash(d.tx_hash)}
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <span className="text-gray-500">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                        {d.confirmations} / {d.required_confirmations}
                      </td>
                      <td className="px-4 py-3">{getStatusBadge(d.status, d.credited)}</td>
                      <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                        {d.credited_at ? new Date(d.credited_at).toLocaleString() : '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                        {new Date(d.created_at).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {pagination.totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-700">
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Page {pagination.page} of {pagination.totalPages} ({pagination.total} total)
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPagination((p) => ({ ...p, page: Math.max(1, p.page - 1) }))}
                    disabled={pagination.page <= 1 || loading}
                    className="p-2 rounded-lg border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 disabled:opacity-50 hover:bg-gray-100 dark:hover:bg-gray-700"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setPagination((p) => ({ ...p, page: Math.min(p.totalPages, p.page + 1) }))}
                    disabled={pagination.page >= pagination.totalPages || loading}
                    className="p-2 rounded-lg border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 disabled:opacity-50 hover:bg-gray-100 dark:hover:bg-gray-700"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {error && deposits.length > 0 && (
        <div className="flex items-center gap-2 text-amber-500 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
          <button onClick={() => fetchDeposits()} className="underline">Retry</button>
        </div>
      )}
    </div>
  );
}
