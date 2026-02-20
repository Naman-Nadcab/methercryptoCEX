'use client';

import { useAuthStore } from '@/store/auth';
import Link from 'next/link';
import { Wallet, RefreshCw, Loader2, AlertCircle, HelpCircle } from 'lucide-react';
import { useBalancesSpot } from '@/lib/balances';

export default function SpotWalletPage() {
  const { accessToken, _hasHydrated } = useAuthStore();
  const { data: balances = [], isLoading: loading, isError, error: queryError, refetch } = useBalancesSpot(!!_hasHydrated && !!accessToken);
  const isCancelled = queryError instanceof Error && (queryError.name === 'AbortError' || String(queryError.message).toLowerCase().includes('abort'));
  const error = isError && !isCancelled ? (queryError instanceof Error ? queryError.message : 'Failed to load spot balances') : null;

  const formatBalance = (val: string) => {
    const n = parseFloat(val);
    if (Number.isNaN(n)) return '0.00000000';
    return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 8 });
  };

  return (
    <div className="max-w-4xl mx-auto p-5 sm:p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-white tracking-tight">Spot Wallet</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Read-only view of your Spot (trading) account balances.</p>
        </div>
        <Link
          href="/dashboard/assets/overview"
          className="text-sm text-blue-500 dark:text-blue-400 hover:underline transition-opacity hover:opacity-80"
        >
          Assets overview
        </Link>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-sm transition-opacity duration-200">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="bg-white dark:bg-[#1e2026] border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <span className="text-sm font-medium text-gray-900 dark:text-white">Balances</span>
          <button
            type="button"
            onClick={() => refetch()}
            disabled={loading}
            aria-busy={loading}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-150"
            aria-label="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
              <th className="py-3 px-4 font-medium">Asset</th>
              <th className="py-3 px-4 font-medium">Total Balance</th>
              <th className="py-3 px-4 font-medium">Available Balance</th>
              <th className="py-3 px-4 font-medium">
                <span className="inline-flex items-center gap-1">
                  Locked Balance
                  <span
                    className="inline-block align-middle text-gray-400 dark:text-gray-500 cursor-help"
                    title="Locked in open orders or pending actions"
                  >
                    <HelpCircle className="w-3.5 h-3.5" />
                  </span>
                </span>
              </th>
              <th className="py-3 px-4 font-medium">Account Type</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [1, 2, 3, 4, 5].map((i) => (
                <tr key={i} className="border-b border-gray-100 dark:border-gray-800">
                  <td className="py-3 px-4"><div className="h-4 w-16 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" /></td>
                  <td className="py-3 px-4"><div className="h-4 w-20 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" /></td>
                  <td className="py-3 px-4"><div className="h-4 w-20 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" /></td>
                  <td className="py-3 px-4"><div className="h-4 w-14 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" /></td>
                  <td className="py-3 px-4"><div className="h-4 w-12 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" /></td>
                </tr>
              ))
            ) : balances.length === 0 && !error ? (
              <tr>
                <td colSpan={5} className="py-20 text-center text-gray-500 dark:text-gray-400">
                  <Wallet className="w-12 h-12 mx-auto mb-4 opacity-40" />
                  <p className="font-medium text-gray-700 dark:text-gray-300">No spot balances yet.</p>
                  <p className="text-sm mt-1.5">Transfer from Funding to Spot when you are ready to trade.</p>
                </td>
              </tr>
            ) : (
              balances.map((row) => (
                <tr key={row.asset} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors duration-100">
                  <td className="py-3 px-4 font-medium text-gray-900 dark:text-white">{row.asset}</td>
                  <td className="py-3 px-4 font-mono tabular-nums text-gray-900 dark:text-white">{formatBalance(row.balance)}</td>
                  <td className="py-3 px-4 font-mono tabular-nums text-gray-700 dark:text-gray-300">{formatBalance(row.available_balance)}</td>
                  <td className="py-3 px-4 font-mono tabular-nums text-amber-600 dark:text-amber-400" title="Locked in open orders or pending actions">
                    {formatBalance(row.locked_balance ?? '0')}
                  </td>
                  <td className="py-3 px-4">
                    <span className="px-2 py-1 rounded text-xs font-medium bg-blue-500/20 text-blue-600 dark:text-blue-400">
                      {row.account_type === 'spot' ? 'Spot' : row.account_type}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
