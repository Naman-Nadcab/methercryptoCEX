'use client';

import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/auth';
import { getWithdrawalById } from '@/lib/withdrawals-api';
import { WithdrawalStatusBadge } from '@/components/withdrawals/WithdrawalStatusBadge';
import { WithdrawalRiskBadge } from '@/components/withdrawals/WithdrawalRiskBadge';
import { Button } from '@/components/ui/Button';
import { DetailSkeleton } from '@/components/ui';
import { User } from 'lucide-react';
import { AdminPageFrame } from '@/components/admin-shell/AdminPageFrame';

function formatDate(s: string | undefined): string {
  if (!s) return '—';
  try {
    return new Date(s).toLocaleString();
  } catch {
    return '—';
  }
}

export default function WithdrawalDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = typeof params?.id === 'string' ? params.id : '';
  const token = useAdminAuthStore((s) => s.accessToken);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin', 'withdrawal', id, token],
    queryFn: () => getWithdrawalById(token, id),
    enabled: !!token && !!id,
  });

  const w = data?.data?.withdrawal;

  if (!id) {
    return (
      <div>
        <p className="text-admin-danger">Invalid withdrawal ID</p>
      </div>
    );
  }

  if (isLoading || !w) {
    return (
      <div>
        {isError ? (
          <p className="text-admin-danger">Failed to load withdrawal.</p>
        ) : (
          <DetailSkeleton rows={10} />
        )}
      </div>
    );
  }

  const isLargeWithdrawal = w.risk_flags?.includes('Large Withdrawal');

  return (
    <AdminPageFrame title={`Withdrawal ${String(w.id).slice(0, 8)}…`} description="Status, risk, and payout details">
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => router.push('/withdrawals')}
          className="text-sm text-admin-primary hover:underline"
        >
          ← Withdrawals
        </button>
      </div>

      <div className="rounded-[12px] bg-admin-card p-6 shadow-[0_1px_3px_0_rgba(0,0,0,0.08)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-admin-text">Withdrawal {String(w.id).slice(0, 8)}…</h1>
            <p className="text-xs text-admin-muted mt-0.5">Status, risk, and payout details</p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <WithdrawalStatusBadge status={w.status} />
              <WithdrawalRiskBadge score={w.risk_score} flags={w.risk_flags} />
              {isLargeWithdrawal && (
                <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-admin-warning">
                  Large Withdrawal
                </span>
              )}
            </div>
          </div>
          <Link href={`/users/${w.user_id}`}>
            <Button variant="secondary" size="sm" className="gap-1">
              <User className="h-4 w-4" />
              View User
            </Button>
          </Link>
        </div>

        <dl className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-sm font-medium text-admin-muted">User</dt>
            <dd className="mt-1">
              <Link href={`/users/${w.user_id}`} className="text-admin-primary hover:underline">
                {(w as any).email ?? (w as any).username ?? w.user_id}
              </Link>
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-admin-muted">Asset</dt>
            <dd className="mt-1">{w.currency_symbol ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-admin-muted">Amount</dt>
            <dd className="mt-1 font-mono">{w.amount ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-admin-muted">Address</dt>
            <dd className="mt-1 break-all font-mono text-sm">{w.to_address ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-admin-muted">Transaction hash</dt>
            <dd className="mt-1 break-all font-mono text-sm">{w.tx_hash ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-admin-muted">Risk score</dt>
            <dd className="mt-1">
              <WithdrawalRiskBadge score={w.risk_score} flags={w.risk_flags} />
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-admin-muted">Created</dt>
            <dd className="mt-1 text-sm">{formatDate(w.created_at)}</dd>
          </div>
          {(w as any).approved_at && (
            <div>
              <dt className="text-sm font-medium text-admin-muted">Approved at</dt>
              <dd className="mt-1 text-sm">{formatDate((w as any).approved_at)}</dd>
            </div>
          )}
          {(w as any).rejected_at && (
            <div>
              <dt className="text-sm font-medium text-admin-muted">Rejected at</dt>
              <dd className="mt-1 text-sm">{formatDate((w as any).rejected_at)}</dd>
            </div>
          )}
        </dl>

        {w.rejection_reason && (
          <div className="mt-4 rounded-lg border border-admin-border bg-white/[0.02] p-4">
            <dt className="text-sm font-medium text-admin-muted">Rejection reason</dt>
            <dd className="mt-1 text-sm">{w.rejection_reason}</dd>
          </div>
        )}

        <div className="mt-4 text-sm text-admin-muted">
          Withdrawal history and admin notes are stored in audit logs (audit_logs_immutable).
        </div>
      </div>
    </div>
    </AdminPageFrame>
  );
}
