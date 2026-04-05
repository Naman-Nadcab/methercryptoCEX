'use client';

import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminAuthStore, hasAdminPermission } from '@/store/auth';
import {
  getDepositsList,
  manualCredit,
  checkDuplicateDeposit,
  type DepositRow,
} from '@/lib/deposits-api';
import { StatCard } from '@/components/dashboard/StatCard';
import { DepositsTable } from '@/components/deposits/DepositsTable';
import { DepositFilters } from '@/components/deposits/DepositFilters';
import { ManualCreditModal } from '@/components/deposits/ManualCreditModal';
import { useAdminWs } from '@/hooks/useAdminWs';
import { ArrowDownToLine, Clock, XCircle, DollarSign } from 'lucide-react';
import { TableSkeleton } from '@/components/ui';

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
  const canManualCredit = hasAdminPermission(admin, 'deposits:credit');

  const { data: duplicateData } = useQuery({
    queryKey: ['admin', 'deposit-duplicate', manualCreditDeposit?.tx_hash],
    staleTime: 30_000,
    queryFn: () => checkDuplicateDeposit(token, (manualCreditDeposit?.tx_hash as string) ?? ''),
    enabled: !!token && !!manualCreditDeposit?.tx_hash?.trim() && !!manualCreditDeposit,
  });
  const isDuplicate = duplicateData?.data?.duplicate ?? false;

  const queryParams = {
    page,
    limit: 20,
    ...(search.trim() && { search: search.trim() }),
    ...(asset && { token: asset }),
    ...(status && status !== 'all' && { status }),
    ...(dateFrom && { date_from: dateFrom }),
    ...(dateTo && { date_to: dateTo }),
  };

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['admin', 'deposits', token, page, search, asset, status, dateFrom, dateTo],
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
      }
    },
  });

  const manualCreditMutation = useMutation({
    mutationFn: async ({
      user,
      currency,
      amount,
      reason,
      tx_hash,
      idempotencyKey,
    }: {
      user: string;
      currency: string;
      amount: string;
      reason?: string;
      tx_hash?: string;
      idempotencyKey: string;
    }) => {
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
      manualCreditMutation.mutate({
        user,
        currency: payload.currency,
        amount: payload.amount,
        reason: payload.reason,
        tx_hash: payload.tx_hash,
        idempotencyKey,
      });
    },
    [manualCreditDeposit, manualCreditMutation]
  );

  const deposits = (data?.data?.deposits ?? []) as DepositRow[];
  const stats = data?.data?.stats;
  const pagination = data?.data?.pagination;
  const total = pagination?.total ?? 0;
  const totalPages = pagination?.totalPages ?? 1;

  const formatVolume = (v: string | undefined) => {
    if (v == null || v === '') return '$0';
    const n = parseFloat(v);
    if (Number.isNaN(n)) return v;
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-admin-text">Deposits</h1>
        <p className="text-xs text-admin-muted mt-0.5">Monitor incoming deposits and blockchain confirmations.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Deposits (24h)"
          value={stats?.total_24h ?? '0'}
          icon={ArrowDownToLine}
        />
        <StatCard
          title="Pending Deposits"
          value={stats?.pending ?? '0'}
          icon={Clock}
          iconBg="bg-admin-warning/10 text-admin-warning"
        />
        <StatCard
          title="Failed Deposits"
          value={stats?.failed ?? '0'}
          icon={XCircle}
          iconBg="bg-admin-danger/10 text-admin-danger"
        />
        <StatCard
          title="Deposit Volume"
          value={formatVolume(stats?.volume_24h)}
          icon={DollarSign}
          iconBg="bg-admin-success/10 text-admin-success"
        />
      </div>

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
        onClear={() => {
          setSearch('');
          setAsset('');
          setStatus('');
          setDateFrom('');
          setDateTo('');
        }}
      />

      <div className="rounded-xl border border-admin-border bg-admin-card">
        {isError && (
          <p className="mb-4 text-sm text-admin-danger">
            {(error as { message?: string })?.message ?? 'Failed to load deposits'}
          </p>
        )}
        {isLoading ? (
          <TableSkeleton rows={6} cols={6} />
        ) : (
          <>
            <DepositsTable
              rows={deposits}
              onManualCredit={(d) => setManualCreditDeposit(d)}
              canManualCredit={canManualCredit}
            />
            {totalPages > 1 && (
              <div className="mt-4 flex items-center justify-between border-t border-admin-border pt-4">
                <p className="text-sm text-admin-muted">
                  Page {page} of {totalPages} · {total} total
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="rounded-lg border border-admin-border bg-admin-card px-3 py-1.5 text-sm font-medium text-admin-text disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    className="rounded-lg border border-admin-border bg-admin-card px-3 py-1.5 text-sm font-medium text-admin-text disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <ManualCreditModal
        open={!!manualCreditDeposit}
        onClose={() => {
          setManualCreditDeposit(null);
          setManualCreditError(null);
        }}
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
    </div>
  );
}
