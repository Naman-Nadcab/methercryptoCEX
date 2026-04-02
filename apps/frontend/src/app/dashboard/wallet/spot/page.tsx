'use client';

import { useAuthStore } from '@/store/auth';
import Link from 'next/link';
import { RefreshCw, Loader2, AlertCircle, HelpCircle, Wallet } from 'lucide-react';
import { useBalancesSpot } from '@/lib/balances';
import { EmptyState } from '@/components/ui/EmptyState';

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
          <h1 className="text-xl font-semibold text-foreground tracking-tight">Spot Wallet</h1>
          <p className="text-sm text-muted-foreground mt-1">Read-only view of your Spot (trading) account balances.</p>
        </div>
        <Link
          href="/wallet"
          className="text-sm text-primary hover:underline transition-opacity hover:opacity-80"
        >
          Assets overview
        </Link>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-destructive text-sm transition-opacity duration-200">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
          <span className="text-sm font-medium text-foreground">Balances</span>
          <button
            type="button"
            onClick={() => refetch()}
            disabled={loading}
            aria-busy={loading}
            className="p-2 rounded-lg hover:bg-accent text-muted-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-150"
            aria-label="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground border-b border-border">
              <th className="py-3 px-4 font-medium">Asset</th>
              <th className="py-3 px-4 font-medium">Total Balance</th>
              <th className="py-3 px-4 font-medium">Available Balance</th>
              <th className="py-3 px-4 font-medium">
                <span className="inline-flex items-center gap-1">
                  Locked Balance
                  <span
                    className="inline-block align-middle text-muted-foreground cursor-help"
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
                <tr key={i} className="border-b border-border">
                  <td className="py-3 px-4"><div className="h-4 w-16 rounded bg-accent animate-pulse" /></td>
                  <td className="py-3 px-4"><div className="h-4 w-20 rounded bg-accent animate-pulse" /></td>
                  <td className="py-3 px-4"><div className="h-4 w-20 rounded bg-accent animate-pulse" /></td>
                  <td className="py-3 px-4"><div className="h-4 w-14 rounded bg-accent animate-pulse" /></td>
                  <td className="py-3 px-4"><div className="h-4 w-12 rounded bg-accent animate-pulse" /></td>
                </tr>
              ))
            ) : balances.length === 0 && !error ? (
              <tr>
                <td colSpan={5} className="p-0 align-top">
                  <EmptyState
                    icon={Wallet}
                    title="No spot balances yet"
                    description="Transfer from Funding to Spot when you're ready to trade, or deposit first."
                    actionLabel="Assets overview"
                    actionHref="/wallet"
                  />
                </td>
              </tr>
            ) : (
              balances.map((row) => (
                <tr key={row.asset} className="border-b border-border hover:bg-muted dark:hover:bg-card/5 transition-colors duration-100">
                  <td className="py-3 px-4 font-medium text-foreground">{row.asset}</td>
                  <td className="py-3 px-4 font-mono tabular-nums text-foreground">{formatBalance(row.balance)}</td>
                  <td className="py-3 px-4 font-mono tabular-nums text-foreground/80">{formatBalance(row.available_balance)}</td>
                  <td className="py-3 px-4 font-mono tabular-nums text-amber-600 dark:text-amber-400" title="Locked in open orders or pending actions">
                    {formatBalance(row.locked_balance ?? '0')}
                  </td>
                  <td className="py-3 px-4">
                    <span className="px-2 py-1 rounded text-xs font-medium bg-blue-500/20 text-primary">
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
