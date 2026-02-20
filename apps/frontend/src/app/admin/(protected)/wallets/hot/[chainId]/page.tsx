'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useParams, useRouter } from 'next/navigation';
import { useAdminAuthStore } from '@/store/admin-auth';
import {
  ArrowLeft,
  Wallet,
  Loader2,
  RefreshCw,
  Copy,
  Check,
  Shield,
  AlertCircle,
  ArrowUpRight,
  ArrowDownLeft,
  Info,
  Zap,
  Settings,
  Save,
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

function getChainLogo(chainType: string, chainName: string): string {
  const name = (chainName || '').toLowerCase();
  const type = (chainType || '').toLowerCase();
  if (name.includes('arbitrum')) return '/assets/upload/blockchain-logo/arbitrum.svg';
  if (name.includes('ethereum') || name.includes('eth')) return '/assets/upload/blockchain-logo/ethereum.svg';
  if (name.includes('polygon') || name.includes('matic')) return '/assets/upload/blockchain-logo/polygon.svg';
  if (name.includes('bnb') || name.includes('bsc')) return '/assets/upload/blockchain-logo/bnb.svg';
  if (type === 'evm') return '/assets/upload/blockchain-logo/ethereum.svg';
  if (type === 'bitcoin') return '/assets/upload/blockchain-logo/bitcoin.svg';
  if (type === 'solana') return '/assets/upload/blockchain-logo/solana.svg';
  if (type === 'tron') return '/assets/upload/blockchain-logo/tron.svg';
  return '/assets/upload/blockchain-logo/ethereum.svg';
}

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

interface HotWalletDetail {
  supported?: boolean;
  message?: string;
  id?: string;
  chainId?: string;
  chainName: string;
  chainType: string;
  address?: string | null;
  balanceCache?: string;
  minBalanceAlert?: string;
  minHotBalance?: string;
  coldWalletAddress?: string | null;
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
  maxSingleTx?: string | null;
  maxDailyOutflow?: string | null;
  dailyOutflowUsed?: string;
  recentSweeps?: Array<{ id: string; txHash: string | null; amountWei: string | null; createdAt: string }>;
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

export default function HotWalletDetailPage() {
  const params = useParams();
  const router = useRouter();
  const chainId = typeof params?.chainId === 'string' ? params.chainId : '';
  const accessToken = useAdminAuthStore((s) => s.accessToken);
  const hasHydrated = useAdminAuthStore((s) => s._hasHydrated);

  const [detail, setDetail] = useState<HotWalletDetail | null>(null);
  const [withdrawals, setWithdrawals] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshingBalance, setRefreshingBalance] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [runningSweep, setRunningSweep] = useState(false);
  const [sweepResult, setSweepResult] = useState<{ swept: number; errors: string[] } | null>(null);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [editMinBalanceAlert, setEditMinBalanceAlert] = useState('');
  const [editMinHotBalance, setEditMinHotBalance] = useState('');
  const [editColdAddress, setEditColdAddress] = useState('');
  const [editActive, setEditActive] = useState(true);

  const fetchDetail = useCallback(async () => {
    if (!chainId || !accessToken) return;
    try {
      const res = await fetch(
        `${API_URL}/api/v1/admin/hot-wallets/${encodeURIComponent(chainId)}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const json = await res.json();
      if (res.ok && json.success && json.data) {
        const d = json.data;
        setDetail(d);
        setEditMinBalanceAlert(d.minBalanceAlert ?? '');
        setEditMinHotBalance(d.minHotBalance ?? '');
        setEditColdAddress(d.coldWalletAddress ?? '');
        setEditActive(d.isActive !== false);
        setError(null);
      } else {
        setDetail(null);
        setError(json?.error?.message || 'Failed to load hot wallet');
      }
    } catch (e) {
      setDetail(null);
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [chainId, accessToken]);

  const fetchWithdrawals = useCallback(async () => {
    if (!chainId || !accessToken) return;
    try {
      const res = await fetch(
        `${API_URL}/api/v1/admin/hot-wallets/history?chainId=${encodeURIComponent(chainId)}&type=withdrawal&limit=20`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const json = await res.json();
      if (res.ok && json.success && Array.isArray(json.data)) {
        setWithdrawals(json.data);
      } else {
        setWithdrawals([]);
      }
    } catch {
      setWithdrawals([]);
    }
  }, [chainId, accessToken]);

  useEffect(() => {
    if (!hasHydrated || !accessToken) {
      if (hasHydrated && !accessToken) setLoading(false);
      return;
    }
    if (!chainId) {
      setError('Invalid chain');
      setLoading(false);
      return;
    }
    setLoading(true);
    fetchDetail();
    fetchWithdrawals();
  }, [hasHydrated, accessToken, chainId, fetchDetail, fetchWithdrawals]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchDetail();
    fetchWithdrawals();
  };

  const handleRefreshBalance = async () => {
    if (!chainId || !accessToken) return;
    setRefreshingBalance(true);
    try {
      const res = await fetch(
        `${API_URL}/api/v1/admin/hot-wallets/${encodeURIComponent(chainId)}/balance`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const json = await res.json();
      if (res.ok && json.success) {
        await fetchDetail();
      }
    } finally {
      setRefreshingBalance(false);
    }
  };

  const copyAddress = () => {
    if (detail?.address) {
      navigator.clipboard.writeText(detail.address);
      setCopiedAddress(true);
      setTimeout(() => setCopiedAddress(false), 2000);
    }
  };

  const handleSaveSettings = async () => {
    if (!chainId || !accessToken) return;
    setSettingsSaving(true);
    setSettingsError(null);
    try {
      const res = await fetch(
        `${API_URL}/api/v1/admin/hot-wallets/${encodeURIComponent(chainId)}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            minBalanceAlert: editMinBalanceAlert || undefined,
            minHotBalance: editMinHotBalance || undefined,
            coldWalletAddress: editColdAddress.trim() || null,
            isActive: editActive,
          }),
        }
      );
      const json = await res.json();
      if (res.ok && json.success) {
        await fetchDetail();
      } else {
        setSettingsError(json?.error?.message ?? 'Failed to update settings');
      }
    } catch (e) {
      setSettingsError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setSettingsSaving(false);
    }
  };

  const handleRunDepositSweep = async () => {
    if (!accessToken) return;
    setRunningSweep(true);
    setSweepResult(null);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/deposit-sweeps/run`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const json = await res.json();
      if (res.ok && json.success && json.data) {
        setSweepResult({
          swept: json.data.swept_count ?? 0,
          errors: Array.isArray(json.data.errors) ? json.data.errors : [],
        });
        await fetchDetail();
      } else {
        setSweepResult({ swept: 0, errors: [json?.error?.message || 'Run failed'] });
      }
    } catch (e) {
      setSweepResult({ swept: 0, errors: [e instanceof Error ? e.message : 'Network error'] });
    } finally {
      setRunningSweep(false);
    }
  };

  if (!hasHydrated || (hasHydrated && !accessToken)) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  if (loading && !detail) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  if (error && !detail) {
    return (
      <div className="space-y-4">
        <Link
          href="/admin/wallets/hot"
          className="inline-flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Hot Wallets
        </Link>
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 flex items-center gap-4">
          <AlertCircle className="w-10 h-10 text-red-400 shrink-0" />
          <div>
            <p className="font-medium text-red-200">{error}</p>
            <p className="text-sm text-red-300/80 mt-1">The hot wallet may not exist for this chain.</p>
          </div>
        </div>
      </div>
    );
  }

  if (!detail) return null;

  const supported = detail.supported !== false;
  const isEvm = (detail.chainType || '').toLowerCase() === 'evm';
  const dailyLimit = detail.maxDailyOutflow != null ? parseFloat(String(detail.maxDailyOutflow)) : null;
  const dailyUsed = parseFloat(detail.dailyOutflowUsed || '0');
  const dailyPercent = dailyLimit != null && dailyLimit > 0 ? Math.min(100, (dailyUsed / dailyLimit) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link
            href="/admin/wallets/hot"
            className="inline-flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </Link>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full overflow-hidden bg-gray-100 dark:bg-gray-700 flex-shrink-0">
              <Image
                src={getChainLogo(detail.chainType, detail.chainName)}
                alt={detail.chainName}
                width={48}
                height={48}
                className="object-contain w-full h-full"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{detail.chainName}</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {detail.chainType.toUpperCase()} · Hot Wallet
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {supported && (
            <>
              <button
                type="button"
                onClick={handleRefreshBalance}
                disabled={refreshingBalance}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
              >
                {refreshingBalance ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Refresh balance
              </button>
              {isEvm && (
                <button
                  type="button"
                  onClick={handleRunDepositSweep}
                  disabled={runningSweep}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400 text-sm hover:bg-amber-500/20 disabled:opacity-50"
                  title="Run deposit sweep (moves credited deposits from user addresses to hot wallet)"
                >
                  {runningSweep ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                  Run deposit sweep
                </button>
              )}
            </>
          )}
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {refreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Refresh
          </button>
        </div>
      </div>

      {/* Deposit vs hot wallet clarity — all chains */}
      <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 dark:bg-blue-500/10 p-4 flex items-start gap-3">
        <Info className="w-5 h-5 text-blue-500 dark:text-blue-400 shrink-0 mt-0.5" />
        <div className="text-sm text-blue-900 dark:text-blue-100">
          <p className="font-medium">Deposits vs hot wallet balance</p>
          <p className="mt-1 text-blue-800 dark:text-blue-200/90">
            User deposits are credited to user balances first. Funds appear in the hot wallet only after deposit sweep.
          </p>
        </div>
      </div>

      {/* Non-EVM: info panel (no error) */}
      {!supported && (
        <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 dark:bg-sky-500/10 p-5 flex items-start gap-3">
          <Info className="w-6 h-6 text-sky-500 dark:text-sky-400 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-sky-900 dark:text-sky-100">
              This chain currently uses user deposit addresses.
            </p>
            <p className="mt-1 text-sm text-sky-800 dark:text-sky-200/90">
              Hot wallet sweeping and balance tracking will be enabled in a future update.
            </p>
          </div>
        </div>
      )}

      {!supported && (
        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2 mb-4">
            Address
          </h2>
          {detail.address ? (
            <div className="flex items-center gap-2">
              <code className="text-sm text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 px-3 py-2 rounded-lg truncate flex-1">
                {detail.address}
              </code>
              <button
                type="button"
                onClick={copyAddress}
                className="p-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 flex-shrink-0"
                title="Copy address"
              >
                {copiedAddress ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400">No hot wallet address for this chain yet.</p>
          )}
        </div>
      )}

      {supported && (
      <>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2 mb-4">
            <Wallet className="w-5 h-5" />
            Balance & limits
          </h2>
          <dl className="space-y-4">
            <div>
              <dt className="text-sm text-gray-500 dark:text-gray-400">Current balance (cached)</dt>
              <dd className="text-xl font-mono font-semibold text-gray-900 dark:text-white mt-0.5">
                {formatNativeBalance(detail.balanceCache ?? '', detail.chainType)} native
              </dd>
            </div>
            <div>
              <dt className="text-sm text-gray-500 dark:text-gray-400">Min hot balance (sweep threshold)</dt>
              <dd className="font-mono text-gray-900 dark:text-white mt-0.5">
                {detail.minHotBalance ? formatNativeBalance(detail.minHotBalance, detail.chainType) : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-gray-500 dark:text-gray-400">Max single tx</dt>
              <dd className="font-mono text-gray-900 dark:text-white mt-0.5">
                {detail.maxSingleTx != null ? formatNativeBalance(detail.maxSingleTx, detail.chainType) : 'No limit'}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-gray-500 dark:text-gray-400">Max daily outflow (used vs limit)</dt>
              <dd className="mt-0.5">
                {dailyLimit != null ? (
                  <div>
                    <span className="font-mono text-gray-900 dark:text-white">
                      {formatNativeBalance(String(dailyUsed), detail.chainType)} / {formatNativeBalance(String(dailyLimit), detail.chainType)}
                    </span>
                    <div className="mt-1 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${dailyPercent >= 90 ? 'bg-red-500' : dailyPercent >= 70 ? 'bg-amber-500' : 'bg-blue-500'}`}
                        style={{ width: `${dailyPercent}%` }}
                      />
                    </div>
                  </div>
                ) : (
                  <span className="text-gray-500 dark:text-gray-400">No limit</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-gray-500 dark:text-gray-400">Status</dt>
              <dd className="mt-0.5">
                <span
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-sm font-medium ${
                    detail.isActive ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-400'
                  }`}
                >
                  <Shield className="w-4 h-4" />
                  {detail.isActive ? 'Active' : 'Inactive'}
                </span>
              </dd>
            </div>
          </dl>
        </div>

        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2 mb-4">
            Address
          </h2>
          <div className="flex items-center gap-2">
            <code className="text-sm text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 px-3 py-2 rounded-lg truncate flex-1">
              {detail.address ?? '—'}
            </code>
            <button
              type="button"
              onClick={copyAddress}
              className="p-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 flex-shrink-0"
              title="Copy address"
            >
              {copiedAddress ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
          {detail.coldWalletAddress && (
            <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Cold wallet (sweep target)</p>
              <code className="text-xs text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded truncate block">
                {detail.coldWalletAddress}
              </code>
            </div>
          )}
        </div>
      </div>

      {/* Admin: Edit wallet settings (Super Admin) */}
      <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2 mb-4">
          <Settings className="w-5 h-5" />
          Wallet settings (admin)
        </h2>
        {settingsError && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
            {settingsError}
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Min balance alert</label>
            <input
              type="text"
              value={editMinBalanceAlert}
              onChange={(e) => setEditMinBalanceAlert(e.target.value)}
              placeholder="Wei or decimal"
              className="w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Min hot balance (sweep threshold)</label>
            <input
              type="text"
              value={editMinHotBalance}
              onChange={(e) => setEditMinHotBalance(e.target.value)}
              placeholder="Wei or decimal"
              className="w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-3 py-2 text-sm"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Cold wallet address (sweep target)</label>
            <input
              type="text"
              value={editColdAddress}
              onChange={(e) => setEditColdAddress(e.target.value)}
              placeholder="0x... or leave empty"
              className="w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-3 py-2 text-sm font-mono"
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="edit-active"
              checked={editActive}
              onChange={(e) => setEditActive(e.target.checked)}
              className="rounded border-gray-300 dark:border-gray-600 text-blue-500"
            />
            <label htmlFor="edit-active" className="text-sm font-medium text-gray-700 dark:text-gray-300">Wallet active (used for withdrawals)</label>
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={handleSaveSettings}
            disabled={settingsSaving}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium disabled:opacity-50"
          >
            {settingsSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save settings
          </button>
        </div>
      </div>

      {sweepResult && (
        <div className={`rounded-xl border p-4 ${sweepResult.errors.length > 0 ? 'border-amber-500/50 bg-amber-500/10' : 'border-green-500/30 bg-green-500/10'}`}>
          <p className="text-sm font-medium">
            Deposit sweep: {sweepResult.swept} swept.
            {sweepResult.errors.length > 0 && ` ${sweepResult.errors.length} issue(s).`}
          </p>
          {sweepResult.errors.length > 0 && (
            <ul className="mt-2 text-sm list-disc list-inside text-amber-800 dark:text-amber-200">
              {sweepResult.errors.slice(0, 5).map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
            <ArrowUpRight className="w-5 h-5 text-gray-500" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Withdrawals signed</h2>
          </div>
          <div className="overflow-x-auto">
            {withdrawals.length === 0 ? (
              <div className="p-6 text-center text-gray-500 dark:text-gray-400 text-sm">
                No withdrawals for this chain yet.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/80">
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Date</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Symbol</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Amount</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {withdrawals.map((w) => (
                    <tr key={w.id} className="border-b border-gray-100 dark:border-gray-700/50">
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                        {new Date(w.createdAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{w.symbol}</td>
                      <td className="px-4 py-3 text-right font-mono">{w.amount}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-0.5 rounded text-xs ${
                            w.status === 'success' || w.status === 'completed'
                              ? 'bg-green-500/20 text-green-400'
                              : w.status === 'pending' || w.status === 'processing'
                                ? 'bg-amber-500/20 text-amber-400'
                                : 'bg-gray-500/20 text-gray-400'
                          }`}
                        >
                          {w.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
            <ArrowDownLeft className="w-5 h-5 text-gray-500" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Sweeps to cold wallet</h2>
          </div>
          <div className="overflow-x-auto">
            {!detail.recentSweeps?.length ? (
              <div className="p-6 text-center text-gray-500 dark:text-gray-400 text-sm">
                No sweeps recorded yet.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/80">
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Date</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Tx hash</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Amount (wei)</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.recentSweeps.map((s) => (
                    <tr key={s.id} className="border-b border-gray-100 dark:border-gray-700/50">
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                        {new Date(s.createdAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs truncate max-w-[180px]" title={s.txHash ?? ''}>
                        {s.txHash ? `${s.txHash.slice(0, 10)}…${s.txHash.slice(-8)}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-mono">{s.amountWei ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
      </>
      )}
    </div>
  );
}
