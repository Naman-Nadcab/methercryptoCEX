'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { WithdrawalRow } from '@/lib/withdrawals-api';
import { WithdrawalStatusBadge } from './WithdrawalStatusBadge';
import { WithdrawalRiskBadge } from './WithdrawalRiskBadge';
import { Button } from '@/components/ui/Button';
import { Check, X, User } from 'lucide-react';

function formatDate(s: string | undefined): string {
  if (!s) return '—';
  try {
    return new Date(s).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return '—';
  }
}

function truncateAddress(addr: string | null | undefined): string {
  if (!addr) return '—';
  if (addr.length <= 16) return addr;
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

export interface WithdrawalsTableProps {
  rows: WithdrawalRow[];
  onApprove: (w: WithdrawalRow) => void;
  onReject: (w: WithdrawalRow) => void;
  canApproveReject?: boolean;
}

export function WithdrawalsTable({ rows, onApprove, onReject, canApproveReject = true }: WithdrawalsTableProps) {
  const router = useRouter();
  const pending = (s: string) => s === 'pending_approval' || s === 'pending';

  return (
    <div className="overflow-x-auto rounded-xl border border-admin-border bg-white">
      <table className="w-full min-w-[900px] border-collapse">
        <thead className="sticky top-0 z-10 bg-gray-50">
          <tr>
            <th className="border-b border-admin-border px-4 py-3 text-left text-xs font-semibold uppercase text-admin-muted">Withdrawal ID</th>
            <th className="border-b border-admin-border px-4 py-3 text-left text-xs font-semibold uppercase text-admin-muted">User</th>
            <th className="border-b border-admin-border px-4 py-3 text-left text-xs font-semibold uppercase text-admin-muted">Asset</th>
            <th className="border-b border-admin-border px-4 py-3 text-right text-xs font-semibold uppercase text-admin-muted">Amount</th>
            <th className="border-b border-admin-border px-4 py-3 text-left text-xs font-semibold uppercase text-admin-muted">Address</th>
            <th className="border-b border-admin-border px-4 py-3 text-left text-xs font-semibold uppercase text-admin-muted">Risk Score</th>
            <th className="border-b border-admin-border px-4 py-3 text-left text-xs font-semibold uppercase text-admin-muted">Status</th>
            <th className="border-b border-admin-border px-4 py-3 text-left text-xs font-semibold uppercase text-admin-muted">Created</th>
            <th className="border-b border-admin-border px-4 py-3 text-right text-xs font-semibold uppercase text-admin-muted">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={9} className="px-4 py-8 text-center text-admin-muted">
                No withdrawals found.
              </td>
            </tr>
          ) : (
            rows.map((w) => (
              <tr
                key={w.id}
                className="border-b border-admin-border/60 hover:bg-gray-50 cursor-pointer"
                onClick={() => router.push(`/withdrawals/${w.id}`)}
              >
                <td className="px-4 py-3 font-mono text-sm">{String(w.id).slice(0, 8)}…</td>
                <td className="px-4 py-3">
                  <span className="text-gray-900">{w.email ?? w.username ?? (w.user_id ? String(w.user_id).slice(0, 8) : null) ?? '—'}</span>
                </td>
                <td className="px-4 py-3">{w.currency_symbol ?? '—'}</td>
                <td className="px-4 py-3 text-right tabular-nums">{w.amount ?? '—'}</td>
                <td className="px-4 py-3 font-mono text-sm">{truncateAddress(w.to_address)}</td>
                <td className="px-4 py-3">
                  <WithdrawalRiskBadge score={w.risk_score} flags={w.risk_flags} />
                </td>
                <td className="px-4 py-3">
                  <WithdrawalStatusBadge status={w.status} />
                </td>
                <td className="px-4 py-3 text-admin-muted text-sm">{formatDate(w.created_at)}</td>
                <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-end gap-1">
                    <Link href={`/users/${w.user_id}`}>
                      <Button variant="ghost" size="sm" className="h-8 px-2" title="View User">
                        <User className="h-4 w-4" />
                      </Button>
                    </Link>
                    {canApproveReject && pending(w.status) && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2 text-admin-success"
                          title="Approve"
                          onClick={() => onApprove(w)}
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2 text-admin-danger"
                          title="Reject"
                          onClick={() => onReject(w)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
