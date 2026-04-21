'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/auth';
import {
  getTreasuryStats,
  getTreasuryHealth,
  getTreasuryHotWallets,
  getTreasurySweeps,
  getTreasuryTransactions,
  runTreasurySweep,
  retryTreasurySweep,
  getHotWallets,
  getTreasuryReconciliation,
  type SweepRow,
} from '@/lib/treasury-api';
import { StatCard } from '@/components/dashboard/StatCard';
import { StatusBadge } from '@/components/dashboard/StatusBadge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { HotWalletsTable } from '@/components/treasury/HotWalletsTable';
import { ColdWalletsTable } from '@/components/treasury/ColdWalletsTable';
import { SweepsTable } from '@/components/treasury/SweepsTable';
import { WalletTransactionsTable } from '@/components/treasury/WalletTransactionsTable';
import { SweepActionModal, type SweepActionType } from '@/components/treasury/SweepActionModal';
import { Button } from '@/components/ui/Button';
import { TableSkeleton } from '@/components/ui';
import { ProtectedAction } from '@/components/rbac/ProtectedAction';
import { useAdminWs } from '@/hooks/useAdminWs';
import { Wallet, Flame, Snowflake, Clock, Play, Settings, Activity, Server, Zap, AlertTriangle } from 'lucide-react';
import { AdminPageFrame, type AdminPageStatus } from '@/components/admin-shell/AdminPageFrame';

function formatReserves(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}

type TreasuryTab = 'overview' | 'transactions';

export default function TreasuryPage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  const [sweepModal, setSweepModal] = useState<{ action: SweepActionType; sweep?: SweepRow | null } | null>(null);
  const [sweepsPage, setSweepsPage] = useState(1);
  const [activeTab, setActiveTab] = useState<TreasuryTab>('overview');
  const [txPage, setTxPage] = useState(1);
  const [txType, setTxType] = useState<string>('all');
  /** Defer heavy /hot-wallets (families metadata) until after first paint so treasury shell + tables load first. */
  const [deferHotWalletMeta, setDeferHotWalletMeta] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setDeferHotWalletMeta(true), 400);
    return () => window.clearTimeout(t);
  }, []);

  const { data: statsData, isLoading: statsLoading, isError: statsError } = useQuery({
    queryKey: ['admin', 'treasury', 'stats', token],
    queryFn: () => getTreasuryStats(token),
    enabled: !!token,
    refetchInterval: 60_000,
    staleTime: 60_000,
    retry: 1,
    retryDelay: 1200,
  });

  const { data: healthData, isLoading: healthLoading, isError: healthError } = useQuery({
    queryKey: ['admin', 'treasury', 'health', token],
    queryFn: () => getTreasuryHealth(token),
    enabled: !!token,
    refetchInterval: 60_000,
    staleTime: 60_000,
    retry: 1,
    retryDelay: 1200,
  });

  const { data: hotData, isLoading: hotLoading } = useQuery({
    queryKey: ['admin', 'treasury', 'hot-wallets', token],
    queryFn: () => getTreasuryHotWallets(token),
    enabled: !!token,
    refetchInterval: 30_000,
    staleTime: 30_000,
    retry: 1,
  });

  const { data: hotWalletsCrud } = useQuery({
    queryKey: ['admin', 'hot-wallets-crud', token],
    queryFn: () => getHotWallets(token),
    enabled: !!token && deferHotWalletMeta,
    staleTime: 300_000,
    refetchOnWindowFocus: false,
  });

  const { data: sweepsData, isLoading: sweepsLoading } = useQuery({
    queryKey: ['admin', 'treasury', 'sweeps', token, sweepsPage],
    queryFn: () =>
      getTreasurySweeps(token, { page: sweepsPage, limit: 20 }),
    enabled: !!token,
    refetchInterval: 30_000,
    staleTime: 30_000,
    retry: 1,
  });

  const { data: txData, isLoading: txLoading } = useQuery({
    queryKey: ['admin', 'treasury', 'transactions', token, txPage, txType],
    queryFn: () =>
      getTreasuryTransactions(token, { page: txPage, limit: 50, type: txType === 'all' ? undefined : txType }),
    enabled: !!token && activeTab === 'transactions',
    refetchInterval: 30_000,
    staleTime: 30_000,
    retry: 1,
  });

  const runSweepMutation = useMutation({
    mutationFn: () => runTreasurySweep(token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'treasury'] });
      setSweepModal(null);
    },
  });

  const retrySweepMutation = useMutation({
    mutationFn: (sweepId: string) => retryTreasurySweep(token, sweepId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'treasury'] });
      setSweepModal(null);
    },
  });

  useAdminWs({
    onEvent: (ev) => {
      const t = (ev?.type as string) ?? '';
      if (
        t === 'wallet_balance_updated' ||
        t === 'sweep_completed' ||
        t === 'sweep_failed'
      ) {
        queryClient.invalidateQueries({ queryKey: ['admin', 'treasury'] });
      }
    },
  });

  const { data: reconData } = useQuery({
    queryKey: ['admin', 'treasury', 'reconciliation', token],
    queryFn: () => getTreasuryReconciliation(token),
    enabled: !!token,
    staleTime: 120_000,
    refetchInterval: 120_000,
    retry: 1,
  });
  const reconResult = reconData?.data;
  const reconMismatch = reconResult && reconResult.matched === false;

  const stats = statsData?.data;
  const health = healthData?.data;
  const txPayload = txData?.data;
  const transactions = (txPayload?.transactions ?? []) as Array<{
    tx_hash: string | null;
    wallet_address: string;
    asset: string;
    amount: string;
    transaction_type: string;
    time: string;
  }>;
  const txPagination = txPayload?.pagination;
  const failedSweeps24h = stats?.failed_sweeps_24h ?? 0;
  const sweepError = failedSweeps24h > 3;
  const hotWallets = (hotData?.data ?? []) as Array<{
    id: string;
    chain_id: string;
    chain_name: string;
    address: string;
    balance: string;
    last_sweep_at: string | null;
    status: string;
  }>;
  const sweepsPayload = sweepsData?.data;
  const sweeps = (sweepsPayload?.sweeps ?? []) as SweepRow[];
  const pagination = sweepsPayload?.pagination;
  const hasApiError = statsError && healthError;
  const treasuryStatus: AdminPageStatus = (statsError && healthError) || reconMismatch ? 'risk' : (statsError || healthError || (failedSweeps24h > 3)) ? 'warning' : 'active';

  const handleSweepConfirm = () => {
    const action = sweepModal?.action;
    if (action === 'run') {
      runSweepMutation.mutate();
    } else if (action === 'retry' && sweepModal?.sweep?.id) {
      retrySweepMutation.mutate(sweepModal.sweep.id);
    }
  };

  return (
    <AdminPageFrame
      title="Treasury"
      description="Monitor exchange wallet infrastructure and sweep operations."
      status={treasuryStatus}
      error={hasApiError ? 'Treasury stats and health APIs failed to load.' : null}
      onRetry={() => { queryClient.invalidateQueries({ queryKey: ['admin', 'treasury'] }); }}
      quickActions={
        <Link href="/treasury/settings">
          <Button variant="secondary" size="sm">
            <Settings className="mr-1 h-4 w-4" />
            Sweep settings
          </Button>
        </Link>
      }
      className="!p-0"
    >

      <div className="flex items-start gap-3 rounded-lg border border-admin-border bg-admin-card/80 px-3 py-2.5 text-[11px] text-admin-muted">
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500 mt-0.5" />
        <p>
          <span className="font-medium text-admin-text">Data quality:</span> balances and health come from live APIs and chain/indexer state. After any error or
          partial response, figures may be incomplete — confirm against{' '}
          <Link href="/reconciliation" className="text-admin-primary hover:underline">
            Reconciliation
          </Link>{' '}
          before custody or sweep decisions.
        </p>
      </div>

      {hasApiError && (
        <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
          <AlertTriangle className="h-5 w-5 shrink-0 text-red-600" />
          <div>
            <p className="text-sm font-semibold text-red-800">Data Unavailable</p>
            <p className="text-xs text-admin-muted">
              {statsError && healthError
                ? 'Treasury stats and health APIs failed to load.'
                : statsError
                  ? 'Treasury stats API failed to load.'
                  : 'Treasury health API failed to load.'}
              {' '}Some values may show placeholders.
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Exchange Reserves"
          value={statsLoading ? '...' : stats ? formatReserves(stats.total_reserves) : 'N/A'}
          icon={Wallet}
          iconBg="bg-admin-primary/10 text-admin-primary"
          className={statsLoading ? 'animate-pulse' : undefined}
        />
        <StatCard
          title="Hot Wallet Balance"
          value={statsLoading ? '...' : stats ? formatReserves(stats.hot_balance) : 'N/A'}
          icon={Flame}
          iconBg="bg-amber-100 text-admin-warning"
          className={statsLoading ? 'animate-pulse' : undefined}
        />
        <StatCard
          title="Cold Balance (Ledger Est.)"
          value={statsLoading ? '...' : stats ? formatReserves(stats.cold_balance) : 'N/A'}
          icon={Snowflake}
          iconBg="bg-blue-100 text-blue-700"
          className={statsLoading ? 'animate-pulse' : undefined}
          tooltip="Estimated as total user ledger minus hot wallet balance. Verify against cold wallet addresses on-chain."
        />
        <StatCard
          title="Pending Sweeps"
          value={statsLoading ? '...' : stats?.pending_sweeps ?? 0}
          icon={Clock}
          iconBg="bg-white/5 text-admin-muted"
          className={statsLoading ? 'animate-pulse' : undefined}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Hot Wallet Health"
          value={healthLoading ? '...' : health?.hot_wallet_health ?? 'N/A'}
          icon={Activity}
          iconBg="bg-green-100 text-green-700"
          className={healthLoading ? 'animate-pulse' : undefined}
        />
        <StatCard
          title="RPC Node Status"
          value={healthLoading ? '...' : health?.rpc_node_status ?? 'N/A'}
          icon={Server}
          iconBg="bg-slate-100 text-slate-700"
          className={healthLoading ? 'animate-pulse' : undefined}
        />
        <StatCard
          title="Sweep Engine Status"
          value={healthLoading ? '...' : health?.sweep_engine_status ?? 'N/A'}
          icon={Zap}
          iconBg="bg-amber-100 text-amber-700"
          className={healthLoading ? 'animate-pulse' : undefined}
        />
        <div className="rounded-xl border border-admin-border bg-admin-card p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/5 text-admin-muted">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-medium text-admin-text">Failed Sweeps (24h)</p>
                <p className="text-2xl font-semibold text-admin-text">{failedSweeps24h}</p>
              </div>
            </div>
            {sweepError && (
              <Badge variant="danger">Sweep Error</Badge>
            )}
          </div>
        </div>
      </div>

      {reconMismatch && (
        <div role="alert" className="flex items-center gap-3 rounded-lg border border-admin-danger/40 bg-admin-danger/10 p-4">
          <AlertTriangle className="h-5 w-5 shrink-0 text-admin-danger" />
          <div>
            <p className="text-sm font-semibold text-admin-danger">Balance Mismatch Detected</p>
            <p className="text-xs text-admin-muted">
              On-chain balances do not match database records. {reconResult?.mismatches?.length ?? 0} chain(s) affected.
              Last checked: {reconResult?.lastCheckedAt ? new Date(reconResult.lastCheckedAt).toLocaleString() : 'unknown'}.
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-xl border border-admin-border bg-admin-card p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-admin-text">Cold Storage Ratio (Est.)</p>
              <p className="text-2xl font-semibold text-admin-text">{stats?.cold_storage_ratio ?? 0}%</p>
            </div>
            {(stats?.cold_storage_ratio ?? 0) >= 90 && (
              <Badge variant="success">Best practice</Badge>
            )}
          </div>
        </div>
        <div className="rounded-xl border border-admin-border bg-admin-card p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-admin-text">Hot Wallet Liquidity</p>
              <div className="mt-1">
                {statsLoading ? (
                  <Badge variant="default">Loading...</Badge>
                ) : stats?.liquidity_warning ? (
                  <Badge variant="warning">Low Liquidity</Badge>
                ) : (
                  <Badge variant="success">OK</Badge>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {stats?.chain_balances && stats.chain_balances.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Chain Balances</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
              {stats.chain_balances.map((c) => (
                <div
                  key={c.chain_name}
                  className="rounded-lg border border-admin-border bg-white/[0.02] p-3"
                >
                  <p className="text-sm font-medium text-admin-text">{c.chain_name}</p>
                  <p className="text-lg font-semibold text-admin-text">{formatReserves(c.balance)}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex gap-2 border-b border-admin-border">
        <button
          type="button"
          onClick={() => setActiveTab('overview')}
          className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'overview'
              ? 'border-admin-primary text-admin-primary'
              : 'border-transparent text-admin-muted hover:text-admin-text'
          }`}
        >
          Overview
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('transactions')}
          className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'transactions'
              ? 'border-admin-primary text-admin-primary'
              : 'border-transparent text-admin-muted hover:text-admin-text'
          }`}
        >
          Wallet Transactions
        </button>
      </div>

      {activeTab === 'overview' && (
        <>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Hot Wallets</CardTitle>
        </CardHeader>
        <CardContent>
          {hotLoading ? (
            <TableSkeleton rows={3} cols={5} />
          ) : (
            <HotWalletsTable
              rows={hotWallets}
              availableFamilies={(hotWalletsCrud as any)?.availableFamilies}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cold Wallets</CardTitle>
        </CardHeader>
        <CardContent>
          <ColdWalletsTable />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Deposit Sweep Monitor</CardTitle>
          <div className="flex gap-2">
            <ProtectedAction permission="treasury:sweep" fallback="disabled">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setSweepModal({ action: 'run' })}
              >
                <Play className="mr-1 h-4 w-4" />
                Run Sweep
              </Button>
            </ProtectedAction>
          </div>
        </CardHeader>
        <CardContent>
          {sweepsLoading ? (
            <TableSkeleton rows={3} cols={5} />
          ) : (
            <>
              <SweepsTable
                rows={sweeps}
                onRetry={(row) => setSweepModal({ action: 'retry', sweep: row })}
              />
              {pagination && pagination.totalPages > 1 && (
                <div className="mt-4 flex items-center justify-between text-sm text-admin-muted">
                  <span>
                    Page {pagination.page} of {pagination.totalPages} ({pagination.total} sweeps)
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={pagination.page <= 1}
                      onClick={() => setSweepsPage((p) => Math.max(1, p - 1))}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={pagination.page >= pagination.totalPages}
                      onClick={() => setSweepsPage((p) => p + 1)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

        </>
      )}

      {activeTab === 'transactions' && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Wallet Transactions</CardTitle>
            <div className="flex gap-2">
              <select
                value={txType}
                onChange={(e) => { setTxType(e.target.value); setTxPage(1); }}
                className="rounded border border-admin-border bg-admin-card px-2 py-1 text-sm"
              >
                <option value="all">All types</option>
                <option value="sweep">Sweep</option>
                <option value="withdrawal">Withdrawal</option>
                <option value="deposit">Deposit</option>
                <option value="cold_transfer">Cold Transfer</option>
              </select>
            </div>
          </CardHeader>
          <CardContent>
            {txLoading ? (
              <TableSkeleton rows={3} cols={5} />
            ) : (
              <>
                <WalletTransactionsTable rows={transactions} />
                {txPagination && txPagination.totalPages > 1 && (
                  <div className="mt-4 flex items-center justify-between text-sm text-admin-muted">
                    <span>
                      Page {txPagination.page} of {txPagination.totalPages} ({txPagination.total} transactions)
                    </span>
                    <div className="flex gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={txPagination.page <= 1}
                        onClick={() => setTxPage((p) => Math.max(1, p - 1))}
                      >
                        Previous
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={txPagination.page >= txPagination.totalPages}
                        onClick={() => setTxPage((p) => p + 1)}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      <SweepActionModal
        open={!!sweepModal}
        action={sweepModal?.action ?? 'run'}
        sweep={sweepModal?.sweep ?? null}
        onClose={() => setSweepModal(null)}
        onConfirm={handleSweepConfirm}
        isLoading={runSweepMutation.isPending || retrySweepMutation.isPending}
      />
    </AdminPageFrame>
  );
}
