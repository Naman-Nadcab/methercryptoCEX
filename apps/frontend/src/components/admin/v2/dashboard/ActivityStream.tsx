'use client';

import Link from 'next/link';
import { useWithdrawalsList, useDepositsList } from '@/hooks/admin/useAdminDashboard';
import { ArrowUpFromLine, ArrowDownToLine, Loader2 } from 'lucide-react';
import { formatDateTime, cn } from '@/lib/utils';

export function ActivityStream() {
  const { data: withdrawalsData, isLoading: wLoading } = useWithdrawalsList({ limit: 5 });
  const { data: depositsData, isLoading: dLoading } = useDepositsList({ limit: 5 });
  const withdrawals = (withdrawalsData?.data?.withdrawals ?? []) as Array<Record<string, unknown>>;
  const deposits = (depositsData?.data?.deposits ?? []) as Array<Record<string, unknown>>;

  const combined = [
    ...withdrawals.slice(0, 3).map((w) => ({
      type: 'withdrawal' as const,
      id: w.id,
      amount: Number(w.amount ?? 0),
      created: w.created_at,
      status: w.status,
    })),
    ...deposits.slice(0, 3).map((d) => ({
      type: 'deposit' as const,
      id: d.id,
      amount: Number((d as Record<string, unknown>).amount ?? 0),
      created: (d as Record<string, unknown>).created_at,
      status: (d as Record<string, unknown>).status,
    })),
  ].sort((a, b) => new Date(String(b.created ?? 0)).getTime() - new Date(String(a.created ?? 0)).getTime()).slice(0, 6);

  if (wLoading && dLoading) {
    return (
      <div className="rounded-[var(--admin-radius)] border border-[var(--admin-card-border)] bg-white p-4 shadow-[var(--admin-shadow)]">
        <h3 className="text-sm font-semibold text-[var(--admin-text)] mb-3">Recent Activity</h3>
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-[var(--admin-primary)]" />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-[var(--admin-radius)] border border-[var(--admin-card-border)] bg-white p-4 shadow-[var(--admin-shadow)]">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-[var(--admin-text)]">Recent Activity</h3>
        <Link href="/admin/withdrawals" className="text-xs font-medium text-[var(--admin-primary)] hover:underline">
          View all →
        </Link>
      </div>
      <ul className="space-y-2 max-h-[280px] overflow-y-auto">
        {combined.length === 0 ? (
          <li className="py-4 text-center text-sm text-[var(--admin-text-muted)]">No recent activity</li>
        ) : (
          combined.map((item, i) => (
            <li
              key={`${item.type}-${item.id}-${i}`}
              className="flex items-center justify-between gap-2 py-2 px-3 rounded-lg bg-[var(--admin-hover-bg)] border border-[var(--admin-card-border)]"
            >
              <div className="flex items-center gap-2 min-w-0">
                <div
                  className={cn(
                    'w-8 h-8 rounded-lg flex items-center justify-center shrink-0',
                    item.type === 'deposit' ? 'bg-[var(--admin-success)]/15 text-[var(--admin-success)]' : 'bg-[var(--admin-danger)]/15 text-[var(--admin-danger)]'
                  )}
                >
                  {item.type === 'deposit' ? <ArrowDownToLine className="w-4 h-4" /> : <ArrowUpFromLine className="w-4 h-4" />}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--admin-text)] capitalize">{item.type}</p>
                  <p className="text-xs text-[var(--admin-text-muted)] truncate">{item.created ? formatDateTime(String(item.created)) : '—'}</p>
                </div>
              </div>
              <span
                className={cn(
                  'text-sm font-semibold tabular-nums shrink-0',
                  item.type === 'deposit' ? 'text-[var(--admin-success)]' : 'text-[var(--admin-danger)]'
                )}
              >
                {item.type === 'deposit' ? '+' : '-'}{item.amount.toLocaleString(undefined, { maximumFractionDigits: 4 })}
              </span>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
