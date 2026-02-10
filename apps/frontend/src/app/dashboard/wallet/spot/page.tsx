'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '@/store/auth';
import Link from 'next/link';
import { Wallet, RefreshCw, Loader2, AlertCircle, HelpCircle } from 'lucide-react';
import { getApiBaseUrl } from '@/lib/getApiUrl';

interface SpotBalanceRow {
  asset: string;
  balance: string;
  available_balance: string;
  locked_balance: string;
  account_type: string;
}

export default function SpotWalletPage() {
  const { accessToken } = useAuthStore();
  const [balances, setBalances] = useState<SpotBalanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBalances = useCallback(async () => {
    if (!accessToken) {
      setLoading(false);
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/v1/wallet/balances/spot`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error?.message || 'Failed to load spot balances');
        setBalances([]);
        setLoading(false);
        return;
      }
      if (json.success && Array.isArray(json.data)) {
        setBalances(json.data);
      } else {
        setBalances([]);
      }
    } catch {
      setError('Failed to load spot balances');
      setBalances([]);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    fetchBalances();
  }, [fetchBalances]);

  const formatBalance = (val: string) => {
    const n = parseFloat(val);
    if (Number.isNaN(n)) return '0.00000000';
    return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 8 });
  };

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Spot Wallet</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Read-only view of your Spot (trading) account balances.</p>
        </div>
        <Link
          href="/dashboard/assets/overview"
          className="text-sm text-blue-500 dark:text-blue-400 hover:underline"
        >
          Assets overview
        </Link>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
          </div>
        ) : balances.length === 0 && !error ? (
          <div className="py-16 text-center text-gray-500 dark:text-gray-400">
            <Wallet className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>No spot balances yet.</p>
            <p className="text-sm mt-1">Transfer from Funding to Spot when you are ready to trade.</p>
          </div>
        ) : (
          <>
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Balances</span>
              <button
                type="button"
                onClick={() => fetchBalances()}
                disabled={loading}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 disabled:opacity-50"
                aria-label="Refresh"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                  <th className="p-3 font-medium">Asset</th>
                  <th className="p-3 font-medium">Total Balance</th>
                  <th className="p-3 font-medium">Available Balance</th>
                  <th className="p-3 font-medium">
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
                  <th className="p-3 font-medium">Account Type</th>
                </tr>
              </thead>
              <tbody>
                {balances.map((row) => (
                  <tr key={row.asset} className="border-b border-gray-100 dark:border-gray-800">
                    <td className="p-3 font-medium text-gray-900 dark:text-white">{row.asset}</td>
                    <td className="p-3 font-mono text-gray-700 dark:text-gray-300">{formatBalance(row.balance)}</td>
                    <td className="p-3 font-mono text-gray-700 dark:text-gray-300">{formatBalance(row.available_balance)}</td>
                    <td className="p-3 font-mono text-amber-600 dark:text-amber-400" title="Locked in open orders or pending actions">
                      {formatBalance(row.locked_balance ?? '0')}
                    </td>
                    <td className="p-3">
                      <span className="px-2 py-0.5 rounded text-xs bg-blue-500/20 text-blue-600 dark:text-blue-400">
                        {row.account_type === 'spot' ? 'Spot' : row.account_type}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}
