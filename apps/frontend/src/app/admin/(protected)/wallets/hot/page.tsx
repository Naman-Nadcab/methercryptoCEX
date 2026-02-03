'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import {
  Wallet,
  Loader2,
  Plus,
  RefreshCw,
  Copy,
  Check,
  Shield,
  AlertCircle,
  RotateCw,
  Trash2,
} from 'lucide-react';

interface HotWalletItem {
  id: string;
  chainId: string;
  chainName: string;
  chainType: string;
  address: string;
  balanceCache: string;
  minBalanceAlert: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ChainFamilyOption {
  type: string;
  label: string;
  representativeChainId: string;
  chainName: string;
  creationSupported: boolean;
  hasWallet?: boolean;
}

const POLL_INTERVAL_MS = 30_000; // Real-time tracking: refresh from DB every 30s

function formatNativeBalance(balanceWei: string, chainType: string): string {
  if (!balanceWei) return '—';
  try {
    if (chainType === 'evm') {
      const wei = BigInt(balanceWei);
      const eth = Number(wei) / 1e18;
      if (eth === 0) return '0';
      if (eth >= 1e6) return `${(eth / 1e6).toFixed(2)}M`;
      if (eth >= 1e3) return `${(eth / 1e3).toFixed(2)}K`;
      if (eth >= 1) return eth.toFixed(4);
      if (eth >= 0.0001) return eth.toFixed(6);
      return eth.toExponential(2);
    }
    return Number(balanceWei).toLocaleString();
  } catch {
    return '—';
  }
}

function formatTokenBalance(raw: string, decimals: number): string {
  if (!raw) return '0';
  try {
    const n = Number(BigInt(raw) / 10n ** BigInt(decimals));
    const rest = BigInt(raw) % 10n ** BigInt(decimals);
    const frac = Number(rest) / Number(10n ** BigInt(decimals));
    const val = n + frac;
    if (val === 0) return '0';
    if (val >= 1e6) return `${(val / 1e6).toFixed(2)}M`;
    if (val >= 1e3) return `${(val / 1e3).toFixed(2)}K`;
    if (val >= 1) return val.toFixed(4);
    if (val >= 0.0001) return val.toFixed(6);
    return val.toExponential(2);
  } catch {
    return '—';
  }
}

interface ChainBalancesRes {
  chainId: string;
  chainName: string;
  chainType: string;
  balances: Array<{ symbol: string; name: string; balance: string; decimals: number; isNative: boolean }>;
}

interface HistoryItem {
  id: string;
  type: 'deposit' | 'withdrawal';
  chainId: string;
  chainName: string;
  symbol: string;
  amount: string;
  status: string;
  txHash: string | null;
  createdAt: string;
  toAddress?: string;
}

export default function HotWalletsPage() {
  const accessToken = useAdminAuthStore((s) => s.accessToken);
  const hasHydrated = useAdminAuthStore((s) => s._hasHydrated);

  const [list, setList] = useState<HotWalletItem[]>([]);
  const [allFamilies, setAllFamilies] = useState<ChainFamilyOption[]>([]);
  const [availableFamilies, setAvailableFamilies] = useState<ChainFamilyOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [refreshingChain, setRefreshingChain] = useState<string | null>(null);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [createFamilyType, setCreateFamilyType] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [confirmCreate, setConfirmCreate] = useState(false);
  const [refreshingList, setRefreshingList] = useState(false);
  const [replaceChain, setReplaceChain] = useState<HotWalletItem | null>(null);
  const [removeChain, setRemoveChain] = useState<HotWalletItem | null>(null);
  const [actioning, setActioning] = useState(false);
  const [chainBalances, setChainBalances] = useState<ChainBalancesRes[]>([]);
  const [loadingBalances, setLoadingBalances] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyChain, setHistoryChain] = useState('');
  const [historyType, setHistoryType] = useState('');
  const [historyStatus, setHistoryStatus] = useState('');

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

  const fetchHotWallets = useCallback(async (clearError = false) => {
    if (!accessToken) return;
    if (clearError) setError('');
    try {
      const res = await fetch(`${apiUrl}/api/v1/admin/hot-wallets`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      let result: {
        success?: boolean;
        data?: unknown[];
        availableFamilies?: ChainFamilyOption[];
        allFamilies?: ChainFamilyOption[];
        error?: { message?: string };
      } = {};
      try {
        const text = await res.text();
        if (text) result = JSON.parse(text) as typeof result;
      } catch {
        setError('Invalid response from server. Is the backend running?');
        setLoading(false);
        return;
      }
      if (result.success) {
        const data = Array.isArray(result.data) ? result.data : [];
        setList(data);
        const all = Array.isArray(result.allFamilies) && result.allFamilies.length > 0 ? result.allFamilies : [];
        const avail = Array.isArray(result.availableFamilies) && result.availableFamilies.length > 0 ? result.availableFamilies : [];
        setAllFamilies(all.length > 0 ? all : []);
        setAvailableFamilies(avail.length > 0 ? avail : []);
        setLastUpdated(new Date());
        if (clearError) setError('');
      } else {
        setError(result.error?.message || 'Failed to load hot wallets');
      }
    } catch (e) {
      setError('Network error. Is the backend running and NEXT_PUBLIC_API_URL correct?');
    } finally {
      setLoading(false);
    }
  }, [accessToken, apiUrl]);

  const handleRefreshList = useCallback(async () => {
    if (!accessToken) return;
    setRefreshingList(true);
    setError('');
    try {
      await fetchHotWallets(true);
    } finally {
      setRefreshingList(false);
    }
  }, [accessToken, fetchHotWallets]);

  // Initial fetch after hydration
  useEffect(() => {
    if (!hasHydrated || !accessToken) {
      if (hasHydrated && !accessToken) setLoading(false);
      return;
    }
    setLoading(true);
    fetchHotWallets(true);
  }, [hasHydrated, accessToken, fetchHotWallets]);

  // Real-time tracking: poll DB periodically (does not clear error)
  useEffect(() => {
    if (!hasHydrated || !accessToken || list.length === 0) return;
    const interval = setInterval(() => fetchHotWallets(false), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [hasHydrated, accessToken, list.length, fetchHotWallets]);

  // Auto-dismiss success after 5s
  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => setSuccess(''), 5000);
    return () => clearTimeout(t);
  }, [success]);

  const handleCreateClick = () => {
    if (createFamilyType) setConfirmCreate(true);
  };

  const handleCreate = async () => {
    if (!createFamilyType || !accessToken) return;
    setConfirmCreate(false);
    setCreating(true);
    setError('');
    setSuccess('');
    try {
      const res = await fetch(`${apiUrl}/api/v1/admin/hot-wallets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ chainFamily: createFamilyType }),
      });
      let result: { success?: boolean; data?: { chainId?: string; address?: string }; error?: { message?: string } } = {};
      try {
        result = await res.json();
      } catch {
        setError('Invalid response from server.');
        setCreating(false);
        return;
      }
      if (result.success) {
        setError('');
        setSuccess(`Hot wallet created for ${createFamilyType}. Deposit funds to: ${result.data?.address ?? ''}`);
        setCreateFamilyType('');
        await fetchHotWallets(true);
      } else {
        setError(result.error?.message ?? 'Failed to create hot wallet');
      }
    } catch (e) {
      setError('Network error. Is the backend running and NEXT_PUBLIC_API_URL correct?');
    } finally {
      setCreating(false);
    }
  };

  const handleRefreshBalance = async (chainId: string) => {
    if (!accessToken) return;
    setRefreshingChain(chainId);
    setSuccess('');
    setError('');
    try {
      const res = await fetch(`${apiUrl}/api/v1/admin/hot-wallets/${encodeURIComponent(chainId)}/balance`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      let result: { success?: boolean; error?: { message?: string; code?: string } } = {};
      try {
        result = await res.json();
      } catch {
        setError('Invalid response from server.');
        setRefreshingChain(null);
        return;
      }
      if (result.success) {
        setError('');
        setSuccess('Balance refreshed.');
        await fetchHotWallets(false);
      } else {
        const msg = result.error?.message || result.error?.code || 'Refresh failed';
        setError(msg);
        await fetchHotWallets(false);
      }
    } catch (e) {
      setError('Network error. Check backend and NEXT_PUBLIC_API_URL.');
      await fetchHotWallets(false);
    } finally {
      setRefreshingChain(null);
    }
  };

  const handleRefreshAll = async () => {
    if (!accessToken || list.length === 0) return;
    setRefreshingAll(true);
    setSuccess('');
    setError('');
    try {
      const results = await Promise.allSettled(
        list.map((w) =>
          fetch(`${apiUrl}/api/v1/admin/hot-wallets/${encodeURIComponent(w.chainId)}/balance`, {
            headers: { Authorization: `Bearer ${accessToken}` },
          }).then(async (res) => {
            let data: { success?: boolean; error?: { message?: string; code?: string } } = {};
            try {
              const text = await res.text();
              if (text) data = JSON.parse(text) as typeof data;
            } catch {
              return { chainName: w.chainName, chainId: w.chainId, ok: false, data: { error: { message: 'Invalid response' } } };
            }
            return { chainName: w.chainName, chainId: w.chainId, ok: res.ok && data.success, data };
          })
        )
      );
      await fetchHotWallets(false);
      const failures: string[] = [];
      results.forEach((r, i) => {
        if (r.status === 'rejected') {
          failures.push(`${list[i]?.chainName ?? list[i]?.chainId ?? 'Unknown'}: ${r.reason?.message ?? 'Network error'}`);
        } else if (r.value && !r.value.ok) {
          const msg = r.value.data?.error?.message || r.value.data?.error?.code || 'Refresh failed';
          failures.push(`${r.value.chainName}: ${msg}`);
        }
      });
      if (failures.length > 0) {
        setError(failures.length === list.length
          ? failures[0] ?? 'All refreshes failed'
          : `${failures.length} of ${list.length} failed: ${failures.join('; ')}`);
      } else {
        setSuccess('All balances refreshed.');
      }
    } catch (e) {
      setError('Network error. Check backend and NEXT_PUBLIC_API_URL.');
      await fetchHotWallets(false);
    } finally {
      setRefreshingAll(false);
    }
  };

  const copyAddress = (address: string) => {
    navigator.clipboard.writeText(address);
    setCopiedAddress(address);
    setTimeout(() => setCopiedAddress(null), 2000);
  };

  const handleReplace = async () => {
    if (!replaceChain || !accessToken) return;
    setActioning(true);
    setError('');
    setSuccess('');
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/admin/hot-wallets/${encodeURIComponent(replaceChain.chainId)}/replace`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );
      let result: { success?: boolean; data?: { address?: string }; error?: { message?: string } } = {};
      try {
        result = await res.json();
      } catch {
        setError('Invalid response from server.');
        setReplaceChain(null);
        setActioning(false);
        return;
      }
      if (result.success) {
        setSuccess(`Hot wallet replaced for ${replaceChain.chainName}. New address: ${result.data?.address ?? ''}`);
        setReplaceChain(null);
        await fetchHotWallets(true);
      } else {
        setError(result.error?.message ?? 'Replace failed');
      }
    } catch (e) {
      setError('Network error.');
    } finally {
      setActioning(false);
    }
  };

  const handleRemove = async () => {
    if (!removeChain || !accessToken) return;
    setActioning(true);
    setError('');
    setSuccess('');
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/admin/hot-wallets/${encodeURIComponent(removeChain.chainId)}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );
      let result: { success?: boolean; error?: { message?: string } } = {};
      try {
        result = await res.json();
      } catch {
        setError('Invalid response from server.');
        setRemoveChain(null);
        setActioning(false);
        return;
      }
      if (result.success) {
        setSuccess(`Hot wallet removed for ${removeChain.chainName}. You can create a new one for this chain.`);
        setRemoveChain(null);
        await fetchHotWallets(true);
      } else {
        setError(result.error?.message ?? 'Remove failed');
      }
    } catch (e) {
      setError('Network error.');
    } finally {
      setActioning(false);
    }
  };

  const fetchBalances = useCallback(async () => {
    if (!accessToken || list.length === 0) return;
    setLoadingBalances(true);
    try {
      const chainId = list[0]?.chainId ?? '';
      const res = await fetch(
        `${apiUrl}/api/v1/admin/hot-wallets/balances?chainId=${encodeURIComponent(chainId)}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const result = await res.json();
      if (result.success && Array.isArray(result.data)) {
        setChainBalances(result.data);
      } else {
        setChainBalances([]);
      }
    } catch {
      setChainBalances([]);
    } finally {
      setLoadingBalances(false);
    }
  }, [accessToken, apiUrl, list.length, list[0]?.chainId]);

  const fetchHistory = useCallback(async () => {
    if (!accessToken) return;
    setHistoryLoading(true);
    try {
      const params = new URLSearchParams();
      if (historyChain) params.set('chainId', historyChain);
      if (historyType) params.set('type', historyType);
      if (historyStatus) params.set('status', historyStatus);
      params.set('limit', '50');
      const res = await fetch(
        `${apiUrl}/api/v1/admin/hot-wallets/history?${params.toString()}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const result = await res.json();
      if (result.success && Array.isArray(result.data)) {
        setHistory(result.data);
      } else {
        setHistory([]);
      }
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [accessToken, apiUrl, historyChain, historyType, historyStatus]);

  useEffect(() => {
    if (list.length > 0) fetchBalances();
    else setChainBalances([]);
  }, [list.length, list[0]?.chainId, fetchBalances]);

  useEffect(() => {
    if (accessToken) fetchHistory();
  }, [accessToken, historyChain, historyType, historyStatus, fetchHistory]);

  const familiesForCreate =
    availableFamilies.length > 0 ? availableFamilies : allFamilies.filter((f) => !list.some((w) => w.chainType === f.type));

  if (!hasHydrated || (hasHydrated && !accessToken)) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  if (loading && list.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Hot Wallet Settings</h1>
          <p className="text-gray-400 text-sm mt-1">
            One hot wallet per chain family (EVM, Bitcoin, Solana, Tron). Same address used for all chains in that family. Only families present in DB are shown.
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {lastUpdated && (
            <span className="text-xs text-gray-500 dark:text-gray-400">
              Last updated: {lastUpdated.toLocaleTimeString()}
            </span>
          )}
          <button
            type="button"
            onClick={handleRefreshList}
            disabled={refreshingList}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
            title="Reload list from server"
          >
            {refreshingList ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Refresh list
          </button>
          {list.length > 0 && (
            <button
              type="button"
              onClick={handleRefreshAll}
              disabled={refreshingAll}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
              title="Fetch live balance from chain RPC for each wallet"
            >
              {refreshingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Refresh all balances
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 rounded-lg bg-green-500/10 border border-green-500/30 text-green-400 px-4 py-3">
          <Check className="w-5 h-5 shrink-0" />
          <span>{success}</span>
        </div>
      )}

      {replaceChain && (
        <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-4 flex flex-wrap items-center gap-3">
          <span className="text-amber-600 dark:text-amber-400 text-sm">
            Replace hot wallet for <strong>{replaceChain.chainName}</strong>? A new keypair will be generated. Withdraw any funds from the current address first. This cannot be undone.
          </span>
          <div className="flex gap-2">
            <button
              onClick={handleReplace}
              disabled={actioning}
              className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {actioning ? <Loader2 className="w-4 h-4 animate-spin inline" /> : null}
              Replace
            </button>
            <button
              onClick={() => setReplaceChain(null)}
              disabled={actioning}
              className="px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {removeChain && (
        <div className="rounded-lg border border-red-500/50 bg-red-500/10 p-4 flex flex-wrap items-center gap-3">
          <span className="text-red-400 text-sm">
            Remove hot wallet for <strong>{removeChain.chainName}</strong>? The wallet will be deleted. Withdraw any funds first. You can create a new wallet for this chain afterward.
          </span>
          <div className="flex gap-2">
            <button
              onClick={handleRemove}
              disabled={actioning}
              className="px-3 py-1.5 rounded bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50"
            >
              {actioning ? <Loader2 className="w-4 h-4 animate-spin inline" /> : null}
              Remove
            </button>
            <button
              onClick={() => setRemoveChain(null)}
              disabled={actioning}
              className="px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {(allFamilies.length > 0 || familiesForCreate.length > 0) && (
        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <Plus className="w-5 h-5" />
            Create hot wallet
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            One wallet per chain family (only families that exist in DB). EVM creation supported; other families show when configured.
          </p>
          <div className="flex flex-wrap items-center gap-3 mt-4">
            <select
              value={createFamilyType}
              onChange={(e) => setCreateFamilyType(e.target.value)}
              className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white min-w-[180px]"
            >
              <option value="">Select chain family</option>
              {(allFamilies.length > 0 ? allFamilies : familiesForCreate).map((f) => {
                const hasWallet = list.some((w) => w.chainType === f.type);
                return (
                  <option
                    key={f.type}
                    value={hasWallet ? '' : f.type}
                    disabled={hasWallet || !f.creationSupported}
                  >
                    {f.label} ({f.chainName}){hasWallet ? ' — already has wallet' : !f.creationSupported ? ' — creation not yet supported' : ''}
                  </option>
                );
              })}
            </select>
            <button
              onClick={handleCreateClick}
              disabled={!createFamilyType || creating}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:pointer-events-none"
            >
              {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
              Create hot wallet
            </button>
            {confirmCreate && createFamilyType && (
              <div className="mt-4 p-4 rounded-lg border border-amber-500/50 bg-amber-500/10 flex flex-wrap items-center gap-3">
                <span className="text-amber-600 dark:text-amber-400 text-sm">
                  This will generate a new keypair and store the encrypted key in the database. Only Super Admin can create hot wallets. Continue?
                </span>
                <button
                  onClick={() => handleCreate()}
                  className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
                >
                  Confirm
                </button>
                <button
                  onClick={() => setConfirmCreate(false)}
                  className="px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 text-sm"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="space-y-6">
        {list.length === 0 ? (
          <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-8 text-center">
            <Wallet className="w-12 h-12 text-gray-500 mx-auto mb-4" />
            <p className="text-gray-500 dark:text-gray-400">No hot wallets yet</p>
            <p className="text-sm text-gray-400 mt-1">Create one per chain family above. Same address is used for all chains in that family.</p>
          </div>
        ) : (
          (() => {
            const byFamily = list.reduce<Record<string, HotWalletItem[]>>((acc, w) => {
              const t = w.chainType || 'other';
              if (!acc[t]) acc[t] = [];
              acc[t].push(w);
              return acc;
            }, {});
            const familyOrder = ['evm', 'bitcoin', 'solana', 'tron', 'polkadot', 'other'];
            const sortedFamilies = [...new Set([...familyOrder.filter((f) => byFamily[f]), ...Object.keys(byFamily).filter((f) => !familyOrder.includes(f))])];
            return sortedFamilies.map((familyType) => (
              <div key={familyType}>
                <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2 capitalize">
                  {familyType === 'evm' ? 'EVM' : familyType}
                </h3>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {(byFamily[familyType] ?? []).map((w) => (
            <div
              key={w.id}
              className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{w.chainName}</p>
                  <p className="text-lg font-bold text-gray-900 dark:text-white mt-1">
                    {formatNativeBalance(w.balanceCache, w.chainType)} native
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <code className="text-xs text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded truncate max-w-[220px]">
                      {w.address}
                    </code>
                    <button
                      type="button"
                      onClick={() => copyAddress(w.address)}
                      className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500"
                      title="Copy address"
                    >
                      {copiedAddress === w.address ? (
                        <Check className="w-4 h-4 text-green-500" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Deposit funds to this address. Withdrawals are signed from this wallet. Balance cached from DB.
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span
                    className={`px-2 py-1 rounded-full text-xs font-medium ${
                      w.isActive ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-400'
                    }`}
                  >
                    {w.isActive ? 'Active' : 'Inactive'}
                  </span>
                  <div className="flex flex-wrap items-center gap-1 justify-end">
                    <button
                      type="button"
                      onClick={() => handleRefreshBalance(w.chainId)}
                      disabled={refreshingChain === w.chainId}
                      className="inline-flex items-center gap-1 text-sm text-blue-500 hover:text-blue-400 disabled:opacity-50"
                    >
                      {refreshingChain === w.chainId ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <RefreshCw className="w-4 h-4" />
                      )}
                      Refresh
                    </button>
                    <button
                      type="button"
                      onClick={() => setReplaceChain(w)}
                      className="inline-flex items-center gap-1 text-sm text-amber-500 hover:text-amber-400"
                      title="Replace with new keypair"
                    >
                      <RotateCw className="w-4 h-4" />
                      Replace
                    </button>
                    <button
                      type="button"
                      onClick={() => setRemoveChain(w)}
                      className="inline-flex items-center gap-1 text-sm text-red-500 hover:text-red-400"
                      title="Remove wallet (withdraw funds first)"
                    >
                      <Trash2 className="w-4 h-4" />
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            </div>
                  ))}
                </div>
              </div>
            ));
          })()
        )}
      </div>

      {list.length > 0 && (
        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <Wallet className="w-5 h-5" />
            Balances (Web3)
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Native and token balances per chain. Only currencies that exist in DB are shown; each currency once per chain.
          </p>
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={() => fetchBalances()}
              disabled={loadingBalances}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
            >
              {loadingBalances ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Refresh balances
            </button>
          </div>
          {loadingBalances && chainBalances.length === 0 ? (
            <div className="mt-4 flex items-center justify-center py-8 text-gray-500">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          ) : chainBalances.length === 0 ? (
            <p className="mt-4 text-sm text-gray-500">No balance data. Add tokens for chains in DB and refresh.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-600">
                    <th className="text-left py-2 px-2 text-gray-500 dark:text-gray-400 font-medium">Chain</th>
                    <th className="text-left py-2 px-2 text-gray-500 dark:text-gray-400 font-medium">Currency</th>
                    <th className="text-right py-2 px-2 text-gray-500 dark:text-gray-400 font-medium">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {chainBalances.map((chain) =>
                    chain.balances.map((b) => (
                      <tr key={`${chain.chainId}-${b.symbol}`} className="border-b border-gray-100 dark:border-gray-700/50">
                        <td className="py-2 px-2 text-gray-700 dark:text-gray-300">{chain.chainName}</td>
                        <td className="py-2 px-2 text-gray-700 dark:text-gray-300">{b.symbol}</td>
                        <td className="py-2 px-2 text-right font-mono text-gray-900 dark:text-white">
                          {formatTokenBalance(b.balance, b.decimals)} {b.symbol}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Deposit & Withdrawal History</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          Filter by chain and status. Status: pending, success, reverted, aborted.
        </p>
        <div className="flex flex-wrap gap-3 mb-4">
          <select
            value={historyChain}
            onChange={(e) => setHistoryChain(e.target.value)}
            className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white min-w-[140px]"
          >
            <option value="">All chains</option>
            {list.map((w) => (
              <option key={w.chainId} value={w.chainId}>
                {w.chainName}
              </option>
            ))}
          </select>
          <select
            value={historyType}
            onChange={(e) => setHistoryType(e.target.value)}
            className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white min-w-[120px]"
          >
            <option value="">All types</option>
            <option value="deposit">Deposit</option>
            <option value="withdrawal">Withdrawal</option>
          </select>
          <select
            value={historyStatus}
            onChange={(e) => setHistoryStatus(e.target.value)}
            className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white min-w-[120px]"
          >
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="success">Success</option>
            <option value="reverted">Reverted</option>
            <option value="aborted">Aborted</option>
          </select>
          <button
            type="button"
            onClick={() => fetchHistory()}
            disabled={historyLoading}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
          >
            {historyLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Refresh
          </button>
        </div>
        {historyLoading && history.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-gray-500">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : history.length === 0 ? (
          <p className="text-sm text-gray-500 py-4">No history for the selected filters.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-600">
                  <th className="text-left py-2 px-2 text-gray-500 dark:text-gray-400 font-medium">Date</th>
                  <th className="text-left py-2 px-2 text-gray-500 dark:text-gray-400 font-medium">Type</th>
                  <th className="text-left py-2 px-2 text-gray-500 dark:text-gray-400 font-medium">Chain</th>
                  <th className="text-left py-2 px-2 text-gray-500 dark:text-gray-400 font-medium">Currency</th>
                  <th className="text-right py-2 px-2 text-gray-500 dark:text-gray-400 font-medium">Amount</th>
                  <th className="text-left py-2 px-2 text-gray-500 dark:text-gray-400 font-medium">Status</th>
                  <th className="text-left py-2 px-2 text-gray-500 dark:text-gray-400 font-medium">TxHash</th>
                </tr>
              </thead>
              <tbody>
                {history.map((row) => (
                  <tr key={row.id} className="border-b border-gray-100 dark:border-gray-700/50">
                    <td className="py-2 px-2 text-gray-700 dark:text-gray-300">
                      {new Date(row.createdAt).toLocaleString()}
                    </td>
                    <td className="py-2 px-2 capitalize text-gray-700 dark:text-gray-300">{row.type}</td>
                    <td className="py-2 px-2 text-gray-700 dark:text-gray-300">{row.chainName}</td>
                    <td className="py-2 px-2 text-gray-700 dark:text-gray-300">{row.symbol}</td>
                    <td className="py-2 px-2 text-right font-mono text-gray-900 dark:text-white">{row.amount}</td>
                    <td className="py-2 px-2">
                      <span
                        className={`px-2 py-0.5 rounded text-xs ${
                          row.status === 'success'
                            ? 'bg-green-500/20 text-green-400'
                            : row.status === 'pending'
                              ? 'bg-amber-500/20 text-amber-400'
                              : row.status === 'reverted' || row.status === 'aborted'
                                ? 'bg-red-500/20 text-red-400'
                                : 'bg-gray-500/20 text-gray-400'
                        }`}
                      >
                        {row.status}
                      </span>
                    </td>
                    <td className="py-2 px-2 font-mono text-xs text-gray-500 truncate max-w-[120px]" title={row.txHash ?? ''}>
                      {row.txHash ? `${row.txHash.slice(0, 10)}...` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
