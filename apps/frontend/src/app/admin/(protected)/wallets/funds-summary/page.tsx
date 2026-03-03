'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import {
  Wallet,
  Loader2,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
} from 'lucide-react';

const API_URL = getApiBaseUrl();

interface LedgerRow {
  chain_id: string;
  chain_name: string;
  chain_symbol: string;
  token_id: string;
  token_symbol: string;
  amount: string;
}

interface HotWalletRow {
  chain_id: string;
  chain_name: string;
  balance: string;
}

interface ColdWalletRow {
  chain_id: string;
  chain_name: string;
  address: string | null;
  balance: string | null;
}

interface MismatchRow {
  chain_id: string;
  chain_name: string;
  token_symbol: string;
  ledger_amount: string;
  on_chain_amount: string;
  difference: string;
}

interface FundsSummaryData {
  ledger_totals: LedgerRow[];
  on_chain_totals: {
    user_deposit_addresses: LedgerRow[] | null;
    hot_wallets: HotWalletRow[];
    cold_wallets: ColdWalletRow[];
  };
  reconciliation: {
    status: 'MATCH' | 'MISMATCH';
    mismatches?: MismatchRow[];
  };
}

export default function FundsSummaryPage() {
  const { accessToken } = useAdminAuthStore();
  const [data, setData] = useState<FundsSummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  const fetchSummary = useCallback(async (isRefresh = false) => {
    if (!accessToken) return;
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/funds/summary`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const json = await res.json();
      if (res.ok && json.success && json.data) {
        setData(json.data);
        if (isRefresh) setRefreshedAt(new Date());
      } else {
        setError(json?.error?.message || 'Failed to load funds summary');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [accessToken]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  const ledgerTotalEntries = data?.ledger_totals?.length ?? 0;
  const ledgerSumDisplay = data?.ledger_totals?.length
    ? data.ledger_totals.reduce((acc, r) => acc + parseFloat(r.amount || '0'), 0).toFixed(4)
    : '0';
  const status = data?.reconciliation?.status ?? null;
  const mismatches = data?.reconciliation?.mismatches ?? [];
  const mismatchCount = mismatches.length;

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center min-h-[320px]">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Funds Summary</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
            Ledger vs on-chain reconciliation (solvency view)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowHelp(!showHelp)}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 border border-gray-200 dark:border-gray-600 rounded-lg"
          >
            <HelpCircle className="w-4 h-4" />
            How to interpret
          </button>
          <button
            type="button"
            onClick={() => fetchSummary(true)}
            disabled={refreshing}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {showHelp && (
        <div className="bg-gray-100 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 rounded-xl p-4 text-sm text-gray-700 dark:text-gray-300">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-2">How to interpret this page</h3>
          <ul className="list-disc list-inside space-y-1">
            <li><strong>Ledger totals</strong> = What we owe users (sum of user_balances by chain and token).</li>
            <li><strong>On-chain totals</strong> = Hot wallet cached balances (native token per chain). Cold and user deposit addresses are not aggregated here.</li>
            <li><strong>MATCH</strong> = For each chain with a hot wallet, ledger native token and hot wallet balance agree (within rounding).</li>
            <li><strong>MISMATCH</strong> = Difference between ledger and on-chain for at least one chain. <strong>Positive difference</strong> (ledger &gt; on-chain): users are owed more than the hot wallet shows — check deposits not yet swept, pending withdrawals, or refresh hot wallet balance. <strong>Negative difference</strong>: hot wallet holds more than ledger — e.g. sweep not yet credited or timing. Use Admin Deposits and Hot Wallets balance refresh to reconcile.</li>
            <li>Reconciliation is <strong>native token only</strong> per chain (e.g. ETH, BNB). ERC20/other tokens are not compared. Keep hot wallet balance cache refreshed for meaningful comparison.</li>
          </ul>
        </div>
      )}

      {error && !data && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-6 flex items-center gap-4">
          <AlertCircle className="w-10 h-10 text-red-400 shrink-0" />
          <div>
            <p className="font-medium text-red-200">Failed to load funds summary</p>
            <p className="text-sm text-red-300/80 mt-1">{error}</p>
            <button
              type="button"
              onClick={() => fetchSummary()}
              className="mt-3 px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-200 rounded-lg text-sm font-medium"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {data && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4 shadow-sm">
              <p className="text-sm text-gray-500 dark:text-gray-400">Ledger entries</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{ledgerTotalEntries}</p>
              <p className="text-xs text-gray-400 mt-1">Sum (mixed tokens): {ledgerSumDisplay}</p>
            </div>
            <div className={`rounded-xl p-4 border ${
              status === 'MATCH'
                ? 'bg-green-500/10 border-green-500/30'
                : status === 'MISMATCH'
                  ? 'bg-amber-500/10 border-amber-500/30'
                  : 'bg-white dark:bg-gray-800/50 border-gray-200 dark:border-gray-700'
            }`}>
              <p className="text-sm text-gray-500 dark:text-gray-400">Reconciliation status</p>
              <div className="mt-1 flex items-center gap-2">
                {status === 'MATCH' ? (
                  <>
                    <CheckCircle2 className="w-6 h-6 text-green-500" />
                    <span className="text-xl font-bold text-green-600 dark:text-green-400">MATCH</span>
                  </>
                ) : status === 'MISMATCH' ? (
                  <>
                    <AlertTriangle className="w-6 h-6 text-amber-500" />
                    <span className="text-xl font-bold text-amber-600 dark:text-amber-400">MISMATCH</span>
                    {mismatchCount > 0 && (
                      <span className="text-sm text-amber-600/80 dark:text-amber-400/80">({mismatchCount} chain{mismatchCount !== 1 ? 's' : ''})</span>
                    )}
                  </>
                ) : (
                  <span className="text-gray-500">—</span>
                )}
              </div>
            </div>
            <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4 shadow-sm">
              <p className="text-sm text-gray-500 dark:text-gray-400">Last refreshed</p>
              <p className="text-gray-900 dark:text-white mt-1">
                {refreshedAt ? refreshedAt.toLocaleString() : 'On load'}
              </p>
            </div>
          </div>

          {/* Mismatch details */}
          {status === 'MISMATCH' && mismatches.length > 0 && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-amber-500/20">
                <h2 className="text-lg font-semibold text-amber-800 dark:text-amber-200">Mismatch details</h2>
                <p className="text-sm text-amber-700/90 dark:text-amber-300/90 mt-0.5">Ledger vs hot wallet (native token). Difference = ledger − on-chain.</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-amber-500/20 bg-amber-500/5">
                      <th className="text-left px-4 py-3 text-xs font-medium text-amber-800 dark:text-amber-200 uppercase">Chain</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-amber-800 dark:text-amber-200 uppercase">Token</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-amber-800 dark:text-amber-200 uppercase">Ledger amount</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-amber-800 dark:text-amber-200 uppercase">On-chain amount</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-amber-800 dark:text-amber-200 uppercase">Difference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mismatches.map((m, i) => (
                      <tr key={`${m.chain_id}-${i}`} className="border-b border-amber-500/10">
                        <td className="px-4 py-3 text-amber-900 dark:text-amber-100">{m.chain_name}</td>
                        <td className="px-4 py-3 text-amber-900 dark:text-amber-100">{m.token_symbol}</td>
                        <td className="px-4 py-3 font-mono text-sm">{m.ledger_amount}</td>
                        <td className="px-4 py-3 font-mono text-sm">{m.on_chain_amount}</td>
                        <td className="px-4 py-3 font-mono text-sm font-semibold">{m.difference}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Ledger totals table */}
          <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Ledger totals</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">User balances by chain and token (available + locked)</p>
            </div>
            {!data.ledger_totals?.length ? (
              <div className="p-8 text-center text-gray-500 dark:text-gray-400">No ledger entries (no user balances)</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/80">
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Chain</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Token</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.ledger_totals.map((r) => (
                      <tr key={`${r.chain_id}-${r.token_id}`} className="border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/20">
                        <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{r.chain_name} ({r.chain_symbol})</td>
                        <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{r.token_symbol}</td>
                        <td className="px-4 py-3 font-mono text-sm text-gray-900 dark:text-white">{parseFloat(r.amount).toFixed(8)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* On-chain totals */}
          <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">On-chain totals</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">Hot wallet balance_cache; cold and user deposits not aggregated</p>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 p-4">
              {/* User deposit addresses */}
              <div>
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">User deposit addresses</h3>
                {data.on_chain_totals.user_deposit_addresses == null ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">Not aggregated (requires indexer)</p>
                ) : data.on_chain_totals.user_deposit_addresses.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">No data</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200 dark:border-gray-600">
                          <th className="text-left py-2 text-gray-500">Chain</th>
                          <th className="text-left py-2 text-gray-500">Token</th>
                          <th className="text-left py-2 text-gray-500">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.on_chain_totals.user_deposit_addresses.map((r, i) => (
                          <tr key={i} className="border-b border-gray-100 dark:border-gray-700/50">
                            <td className="py-2 text-gray-700 dark:text-gray-300">{r.chain_name}</td>
                            <td className="py-2 text-gray-700 dark:text-gray-300">{r.token_symbol}</td>
                            <td className="py-2 font-mono">{parseFloat(r.amount).toFixed(8)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              {/* Hot wallets */}
              <div>
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Hot wallets
                  <Link href="/admin/wallets/hot" className="ml-2 text-blue-500 hover:underline text-xs">View</Link>
                </h3>
                {!data.on_chain_totals.hot_wallets?.length ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">No hot wallets</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200 dark:border-gray-600">
                          <th className="text-left py-2 text-gray-500">Chain</th>
                          <th className="text-left py-2 text-gray-500">Balance (raw)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.on_chain_totals.hot_wallets.map((r) => (
                          <tr key={r.chain_id} className="border-b border-gray-100 dark:border-gray-700/50">
                            <td className="py-2 text-gray-700 dark:text-gray-300">{r.chain_name}</td>
                            <td className="py-2 font-mono text-gray-900 dark:text-white">{r.balance || '0'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              {/* Cold wallets */}
              <div>
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Cold wallets</h3>
                {!data.on_chain_totals.cold_wallets?.length ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">No cold wallet addresses</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200 dark:border-gray-600">
                          <th className="text-left py-2 text-gray-500">Chain</th>
                          <th className="text-left py-2 text-gray-500">Address</th>
                          <th className="text-left py-2 text-gray-500">Balance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.on_chain_totals.cold_wallets.map((r) => (
                          <tr key={r.chain_id} className="border-b border-gray-100 dark:border-gray-700/50">
                            <td className="py-2 text-gray-700 dark:text-gray-300">{r.chain_name}</td>
                            <td className="py-2 font-mono text-xs text-gray-600 dark:text-gray-400 truncate max-w-[140px]" title={r.address ?? ''}>
                              {r.address ? `${r.address.slice(0, 6)}…${r.address.slice(-4)}` : '—'}
                            </td>
                            <td className="py-2 text-gray-500">{r.balance != null ? r.balance : 'N/A'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {error && data && (
        <div className="flex items-center gap-2 text-amber-500 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
          <button type="button" onClick={() => fetchSummary(true)} className="underline">Retry</button>
        </div>
      )}
    </div>
  );
}
