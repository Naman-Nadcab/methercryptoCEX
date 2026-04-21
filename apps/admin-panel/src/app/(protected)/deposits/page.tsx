'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminAuthStore, hasAdminPermission } from '@/store/auth';
import {
  getDepositsList,
  manualCredit,
  checkDuplicateDeposit,
  type DepositRow,
} from '@/lib/deposits-api';
import { DepositsTable } from '@/components/deposits/DepositsTable';
import { DepositFilters } from '@/components/deposits/DepositFilters';
import { ManualCreditModal } from '@/components/deposits/ManualCreditModal';
import { useAdminWs } from '@/hooks/useAdminWs';
import {
  ArrowDownToLine,
  Clock,
  XCircle,
  DollarSign,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  Wifi,
} from 'lucide-react';
import { AdminPageFrame } from '@/components/admin-shell/AdminPageFrame';
import { cn } from '@/lib/cn';

function fmtVolume(v: string | number | undefined): string {
  if (v == null || v === '') return '$0';
  const n = typeof v === 'string' ? parseFloat(v) : Number(v);
  if (!Number.isFinite(n)) return '$0';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

interface KpiConfig {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ReactNode;
  accent: string;
  ring: string;
  alert?: boolean;
}

function KpiCard({ label, value, sub, icon, accent, ring, alert, loading }: KpiConfig & { loading: boolean }) {
  return (
    <div className={cn('relative overflow-hidden rounded-2xl border bg-admin-card p-5', alert ? 'border-red-500/25' : 'border-admin-border/60')}>
      <div className={cn('absolute inset-x-0 top-0 h-0.5 rounded-t-2xl', accent)} />
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-admin-muted">{label}</p>
          {loading ? (
            <div className="mt-2 h-7 w-20 animate-pulse rounded-lg bg-white/[0.06]" />
          ) : (
            <p className={cn('mt-2 text-2xl font-bold tabular-nums', alert ? 'text-red-400' : 'text-admin-text')}>
              {value}
            </p>
          )}
          {sub && !loading && <p className="mt-0.5 text-[10px] text-admin-muted">{sub}</p>}
        </div>
        <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border', ring)}>
          {icon}
        </div>
      </div>
    </div>
  );
}

export default function DepositsPage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const admin = useAdminAuthStore((s) => s.admin);
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [asset, setAsset] = useState('');
  const [status, setStatus] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [manualCreditDeposit, setManualCreditDeposit] = useState<DepositRow | null>(null);
  const [manualCreditError, setManualCreditError] = useState<string | null>(null);
  const [liveFlash, setLiveFlash] = useState(false);
  const canManualCredit = hasAdminPermission(admin, 'deposits:credit');

  const { data: duplicateData } = useQuery({
    queryKey: ['admin', 'deposit-duplicate', manualCreditDeposit?.tx_hash],
    staleTime: 30_000,
    queryFn: () => checkDuplicateDeposit(token, (manualCreditDeposit?.tx_hash as string) ?? ''),
    enabled: !!token && !!manualCreditDeposit?.tx_hash?.trim() && !!manualCreditDeposit,
  });
  const isDuplicate = duplicateData?.data?.duplicate ?? false;

  // Reset to page 1 when any filter changes
  useEffect(() => { setPage(1); }, [search, asset, status, dateFrom, dateTo]);

  const queryParams = useMemo(() => ({
    page,
    limit: 25,
    ...(search.trim() && { search: search.trim() }),
    ...(asset && { token: asset }),
    ...(status && status !== 'all' && { status }),
    ...(dateFrom && { date_from: dateFrom }),
    ...(dateTo && { date_to: dateTo }),
  }), [page, search, asset, status, dateFrom, dateTo]);

  const { data, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: ['admin', 'deposits', token, queryParams],
    staleTime: 30_000,
    queryFn: () => getDepositsList(token, queryParams),
    enabled: !!token,
    refetchInterval: 30_000,
  });

  useAdminWs({
    onEvent: (event) => {
      const type = (event?.type as string) ?? '';
      if (['deposit_detected', 'deposit_confirmed', 'deposit_failed'].includes(type)) {
        queryClient.invalidateQueries({ queryKey: ['admin', 'deposits'] });
        setLiveFlash(true);
        setTimeout(() => setLiveFlash(false), 800);
      }
    },
  });

  const manualCreditMutation = useMutation({
    mutationFn: async ({
      user, currency, amount, reason, tx_hash, idempotencyKey,
    }: { user: string; currency: string; amount: string; reason?: string; tx_hash?: string; idempotencyKey: string }) => {
      const res = await manualCredit(token, { user, currency, amount, reason, tx_hash }, idempotencyKey);
      if (!res.success) throw new Error(res.error?.message ?? 'Manual credit failed.');
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'deposits'] });
      setManualCreditDeposit(null);
      setManualCreditError(null);
    },
    onError: (err: { message?: string }) => {
      setManualCreditError(err?.message ?? 'Manual credit failed.');
    },
  });

  const handleManualCredit = useCallback(
    (payload: { amount: string; currency: string; reason?: string; tx_hash?: string }) => {
      if (!manualCreditDeposit) return;
      const user = (manualCreditDeposit.user_email ?? manualCreditDeposit.user_id) as string;
      const idempotencyKey = `manual-credit-${Date.now()}-${manualCreditDeposit.user_id}`;
      setManualCreditError(null);
      manualCreditMutation.mutate({ user, currency: payload.currency, amount: payload.amount, reason: payload.reason, tx_hash: payload.tx_hash, idempotencyKey });
    },
    [manualCreditDeposit, manualCreditMutation]
  );

  const deposits = (data?.data?.deposits ?? []) as DepositRow[];
  const stats = data?.data?.stats as Record<string, unknown> | undefined;
  const pagination = data?.data?.pagination as { page?: number; total?: number; totalPages?: number } | undefined;
  const total = pagination?.total ?? 0;
  const totalPages = pagination?.totalPages ?? 1;

  const pendingCount = Number(stats?.pending ?? 0);
  /** Use 24h bucket for the "Failed (24h)" tile; fall back to all-time if backend hasn't caught up yet. */
  const failedCount = Number(stats?.failed_24h ?? stats?.failed ?? 0);

  const kpis: KpiConfig[] = [
    {
      label: 'Total Deposits (24h)',
      value: String(stats?.total_24h ?? '0'),
      sub: 'blockchain-confirmed',
      icon: <ArrowDownToLine className="h-4 w-4 text-blue-400" />,
      accent: 'bg-gradient-to-r from-blue-500/60 to-transparent',
      ring: 'border-blue-500/20 bg-blue-950/20',
    },
    {
      label: 'Pending',
      value: String(pendingCount),
      sub: pendingCount > 0 ? 'awaiting confirmations' : 'all clear',
      icon: <Clock className="h-4 w-4 text-amber-400" />,
      accent: pendingCount > 10 ? 'bg-gradient-to-r from-amber-500/60 to-transparent' : 'bg-gradient-to-r from-amber-500/30 to-transparent',
      ring: 'border-amber-500/20 bg-amber-950/20',
    },
    {
      label: 'Failed (24h)',
      value: String(failedCount),
      sub: failedCount > 0 ? 'need attention' : 'none',
      icon: <XCircle className="h-4 w-4 text-red-400" />,
      accent: failedCount > 0 ? 'bg-gradient-to-r from-red-500/60 to-transparent' : 'bg-gradient-to-r from-red-500/20 to-transparent',
      ring: 'border-red-500/20 bg-red-950/20',
      alert: failedCount > 5,
    },
    {
      label: 'Volume (24h)',
      value: fmtVolume(stats?.volume_24h as string | number | undefined),
      sub: 'USD equivalent',
      icon: <DollarSign className="h-4 w-4 text-emerald-400" />,
      accent: 'bg-gradient-to-r from-emerald-500/60 to-transparent',
      ring: 'border-emerald-500/20 bg-emerald-950/20',
    },
  ];

  return (
    <AdminPageFrame
      title="Deposits"
      description="Monitor incoming deposits and blockchain confirmations in real time."
      status={failedCount > 5 ? 'warning' : 'active'}
      quickActions={
        <div className="flex items-center gap-2">
          {/* Live indicator */}
          <div className={cn(
            'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold transition-all',
            liveFlash
              ? 'border-emerald-400/50 bg-emerald-950/30 text-emerald-300'
              : 'border-admin-border/50 text-admin-muted'
          )}>
            <Wifi className="h-3 w-3" />
            LIVE
          </div>
          <button
            type="button"
            onClick={() => void refetch()}
            className="flex items-center gap-1.5 rounded-xl border border-admin-border/60 px-3 py-1.5 text-xs text-admin-muted hover:text-admin-text hover:bg-white/[0.04] transition-colors"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} />
            Refresh
          </button>
        </div>
      }
    >

      {/* ── KPI strip ── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((k) => (
          <KpiCard key={k.label} {...k} loading={isLoading} />
        ))}
      </div>

      {/* ── Filters ── */}
      <DepositFilters
        search={search}
        onSearchChange={setSearch}
        asset={asset}
        onAssetChange={setAsset}
        status={status}
        onStatusChange={setStatus}
        dateFrom={dateFrom}
        onDateFromChange={setDateFrom}
        dateTo={dateTo}
        onDateToChange={setDateTo}
        onApply={() => queryClient.invalidateQueries({ queryKey: ['admin', 'deposits'] })}
        onClear={() => { setSearch(''); setAsset(''); setStatus(''); setDateFrom(''); setDateTo(''); }}
      />

      {/* ── Table card ── */}
      <div className="rounded-2xl border border-admin-border/60 bg-admin-card">

        {/* Table header bar */}
        <div className="flex items-center justify-between border-b border-admin-border/50 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-admin-text">
              {isLoading ? 'Loading deposits…' : `${total.toLocaleString()} deposit${total !== 1 ? 's' : ''}`}
            </p>
            {isFetching && !isLoading && (
              <RefreshCw className="h-3.5 w-3.5 animate-spin text-admin-muted" />
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-admin-muted">
            <span>Showing page {page} of {Math.max(1, totalPages)}</span>
          </div>
        </div>

        {/* Error state */}
        {isError && (
          <div className="flex items-center gap-3 border-b border-admin-border/50 bg-red-950/15 px-5 py-3">
            <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
            <p className="text-sm text-red-300">
              {(error as { message?: string })?.message ?? 'Failed to load deposits'}
            </p>
          </div>
        )}

        {/* Loading skeleton */}
        {isLoading ? (
          <div className="p-5 space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <div className="h-4 w-20 animate-pulse rounded bg-white/[0.05]" />
                <div className="h-4 flex-1 animate-pulse rounded bg-white/[0.04]" />
                <div className="h-4 w-12 animate-pulse rounded bg-white/[0.03]" />
                <div className="h-4 w-16 animate-pulse rounded bg-white/[0.05]" />
                <div className="h-4 w-24 animate-pulse rounded bg-white/[0.04]" />
              </div>
            ))}
          </div>
        ) : (
          <DepositsTable
            rows={deposits}
            onManualCredit={(d) => setManualCreditDeposit(d)}
            canManualCredit={canManualCredit}
          />
        )}

        {/* ── Pagination ── */}
        {!isLoading && totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-admin-border/50 px-5 py-3.5">
            <p className="text-xs text-admin-muted">
              {total > 0 ? `${((page - 1) * 25) + 1}–${Math.min(page * 25, total)} of ${total.toLocaleString()}` : '0 results'}
            </p>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-admin-border/60 text-admin-muted hover:text-admin-text hover:bg-white/[0.04] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>

              {/* Page numbers */}
              {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                const pg = totalPages <= 5 ? i + 1
                  : page <= 3 ? i + 1
                  : page >= totalPages - 2 ? totalPages - 4 + i
                  : page - 2 + i;
                return (
                  <button
                    key={pg}
                    type="button"
                    onClick={() => setPage(pg)}
                    className={cn(
                      'flex h-8 w-8 items-center justify-center rounded-lg border text-xs font-medium transition-colors',
                      pg === page
                        ? 'border-blue-500/40 bg-blue-950/30 text-blue-300'
                        : 'border-admin-border/60 text-admin-muted hover:text-admin-text hover:bg-white/[0.04]'
                    )}
                  >
                    {pg}
                  </button>
                );
              })}

              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-admin-border/60 text-admin-muted hover:text-admin-text hover:bg-white/[0.04] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      <ManualCreditModal
        open={!!manualCreditDeposit}
        onClose={() => { setManualCreditDeposit(null); setManualCreditError(null); }}
        onConfirm={handleManualCredit}
        userEmail={manualCreditDeposit?.user_email as string | undefined}
        userId={manualCreditDeposit?.user_id}
        defaultAsset={manualCreditDeposit?.token_symbol as string ?? ''}
        defaultAmount={manualCreditDeposit?.amount as string ?? ''}
        txHash={manualCreditDeposit?.tx_hash as string | undefined}
        isDuplicate={isDuplicate}
        isLoading={manualCreditMutation.isPending}
        submitError={manualCreditError}
      />
    </AdminPageFrame>
  );
}
