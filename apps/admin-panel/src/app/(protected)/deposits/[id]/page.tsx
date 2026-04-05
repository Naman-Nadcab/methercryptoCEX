'use client';

import { useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminAuthStore, hasAdminPermission } from '@/store/auth';
import { getDepositById, manualCredit, checkDuplicateDeposit } from '@/lib/deposits-api';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { DetailSkeleton } from '@/components/ui';
import { DepositStatusBadge } from '@/components/deposits/DepositStatusBadge';
import { ConfirmationProgress } from '@/components/deposits/ConfirmationProgress';
import { LargeDepositBadge, StuckDepositBadge, isDepositStuck } from '@/components/deposits/DepositIndicators';
import { ManualCreditModal } from '@/components/deposits/ManualCreditModal';
import { User, CreditCard } from 'lucide-react';

export default function DepositDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = typeof params?.id === 'string' ? params.id : '';
  const token = useAdminAuthStore((s) => s.accessToken);
  const admin = useAdminAuthStore((s) => s.admin);
  const queryClient = useQueryClient();
  const [manualCreditOpen, setManualCreditOpen] = useState(false);
  const [manualCreditError, setManualCreditError] = useState<string | null>(null);
  const canManualCredit = hasAdminPermission(admin, 'deposits:credit');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin', 'deposit', id, token],
    queryFn: () => getDepositById(token, id),
    enabled: !!token && !!id,
  });

  const deposit = data?.data?.deposit;
  const { data: duplicateData } = useQuery({
    queryKey: ['admin', 'deposit-duplicate', deposit?.tx_hash],
    queryFn: () => checkDuplicateDeposit(token, (deposit?.tx_hash as string) ?? ''),
    enabled: !!token && !!deposit?.tx_hash?.trim() && manualCreditOpen,
  });
  const isDuplicate = duplicateData?.data?.duplicate ?? false;

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
      queryClient.invalidateQueries({ queryKey: ['admin', 'deposit', id] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'deposits'] });
      setManualCreditOpen(false);
      setManualCreditError(null);
    },
    onError: (err: { message?: string }) => {
      setManualCreditError(err?.message ?? 'Manual credit failed.');
    },
  });

  const handleManualCredit = useCallback(
    (payload: { amount: string; currency: string; reason?: string; tx_hash?: string }) => {
      if (!deposit) return;
      const user = (deposit.user_email ?? deposit.user_id) as string;
      const idempotencyKey = `manual-credit-${Date.now()}-${deposit.user_id}`;
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
    [deposit, manualCreditMutation]
  );

  const created = deposit?.created_at
    ? new Date(deposit.created_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : '—';
  const conf = Number(deposit?.confirmations ?? 0);
  const required = Number(deposit?.required_confirmations ?? 0);
  const stuck = deposit ? isDepositStuck(deposit.status as string, deposit.created_at as string) : false;

  if (!id) {
    return (
      <div className="rounded-xl bg-admin-card p-6 shadow-sm">
        <p className="text-admin-muted">Invalid deposit ID.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="rounded-xl bg-admin-card p-6 shadow-sm">
        <DetailSkeleton rows={10} />
      </div>
    );
  }

  if (isError || !deposit) {
    return (
      <div className="rounded-xl bg-admin-card p-6 shadow-sm">
        <p className="text-admin-danger">Deposit not found.</p>
        <Button variant="secondary" className="mt-4" onClick={() => router.push('/deposits')}>
          Back to list
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-admin-text">Deposit {String(deposit.deposit_id).slice(0, 8)}…</h1>
          <p className="text-xs text-admin-muted mt-0.5">Deposit details and actions</p>
        </div>
        <Button variant="secondary" onClick={() => router.push('/deposits')}>
          Back to list
        </Button>
      </div>

      <Card>
        <CardContent className="p-6">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {deposit.is_large_deposit && <LargeDepositBadge />}
            {stuck && <StuckDepositBadge />}
          </div>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-sm font-medium text-admin-muted">User</dt>
              <dd className="mt-1">
                <Link
                  href={`/users/${deposit.user_id}`}
                  className="text-admin-primary hover:underline"
                >
                  {deposit.user_email ?? deposit.user_id}
                </Link>
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-admin-muted">Asset</dt>
              <dd className="mt-1 text-admin-text">{deposit.token_symbol ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-admin-muted">Amount</dt>
              <dd className="mt-1 font-mono text-admin-text">{deposit.amount ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-admin-muted">Chain</dt>
              <dd className="mt-1 text-admin-text">{deposit.chain_name ?? deposit.chain_symbol ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-admin-muted">Network</dt>
              <dd className="mt-1 text-admin-text">{deposit.token_name ?? deposit.chain_symbol ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-admin-muted">Deposit Address</dt>
              <dd className="mt-1 break-all font-mono text-sm text-admin-text">
                {deposit.to_address ?? '—'}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-admin-muted">TX Hash</dt>
              <dd className="mt-1 break-all font-mono text-sm text-admin-text">
                {deposit.tx_hash ?? '—'}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-admin-muted">Confirmations</dt>
              <dd className="mt-1">
                <ConfirmationProgress confirmations={conf} required={required} />
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-admin-muted">Block Height</dt>
              <dd className="mt-1 text-admin-text">{deposit.block_number ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-admin-muted">Status</dt>
              <dd className="mt-1 flex flex-wrap items-center gap-1.5">
                <DepositStatusBadge status={(deposit.status as string) ?? ''} />
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-admin-muted">Created</dt>
              <dd className="mt-1 text-admin-text">{created}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Link href={`/users/${deposit.user_id}`}>
          <Button variant="secondary">
            <User className="mr-2 h-4 w-4" />
            View User
          </Button>
        </Link>
        {canManualCredit && (
          <Button variant="secondary" onClick={() => setManualCreditOpen(true)}>
            <CreditCard className="mr-2 h-4 w-4" />
            Manual Credit
          </Button>
        )}
      </div>

      <ManualCreditModal
        open={manualCreditOpen}
        onClose={() => {
          setManualCreditOpen(false);
          setManualCreditError(null);
        }}
        onConfirm={handleManualCredit}
        userEmail={deposit.user_email as string | undefined}
        userId={deposit.user_id as string}
        defaultAsset={(deposit.token_symbol as string) ?? ''}
        defaultAmount={(deposit.amount as string) ?? ''}
        txHash={(deposit.tx_hash as string) ?? undefined}
        isDuplicate={isDuplicate}
        isLoading={manualCreditMutation.isPending}
        submitError={manualCreditError}
      />
    </div>
  );
}
