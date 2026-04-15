'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { WithdrawalRow } from '@/lib/withdrawals-api';
import { WithdrawalStatusBadge } from './WithdrawalStatusBadge';
import { WithdrawalRiskBadge } from './WithdrawalRiskBadge';
import { ProtectedAction } from '@/components/rbac/ProtectedAction';
import { cn } from '@/lib/cn';
import { Check, X, Copy, ArrowUpFromLine, ExternalLink } from 'lucide-react';

function fmtRelative(s: string | undefined): string {
  if (!s) return '—';
  const diff = Date.now() - new Date(s).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function fmtFull(s: string | undefined): string {
  if (!s) return '';
  try { return new Date(s).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); }
  catch { return ''; }
}

function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  function copy(e: React.MouseEvent) {
    e.stopPropagation();
    void navigator.clipboard.writeText(text).then(() => { setOk(true); setTimeout(() => setOk(false), 1500); });
  }
  return (
    <button type="button" onClick={copy} title="Copy"
      className="inline-flex items-center justify-center rounded p-0.5 text-admin-muted opacity-0 group-hover:opacity-100 transition-opacity hover:text-admin-text">
      {ok ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

export interface WithdrawalsTableProps {
  rows: WithdrawalRow[];
  onApprove: (w: WithdrawalRow) => void;
  onReject: (w: WithdrawalRow) => void;
}

export function WithdrawalsTable({ rows, onApprove, onReject }: WithdrawalsTableProps) {
  const router = useRouter();
  const needsAction = (s: string) => s === 'pending_approval' || s === 'pending';

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-admin-muted">
        <ArrowUpFromLine className="h-9 w-9 opacity-15" />
        <p className="text-sm">No withdrawals match your filters.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[960px] text-sm">
        <thead>
          <tr className="border-b border-admin-border/50 bg-white/[0.015]">
            {['ID', 'User', 'Asset', 'Amount', 'Destination', 'Risk', 'Status', 'Time', ''].map((h) => (
              <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-admin-muted last:text-right">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-admin-border/30">
          {rows.map((w) => {
            const status  = String(w.status ?? '');
            const canAct  = needsAction(status);
            const addr    = String(w.to_address ?? '');
            const isHighRisk = Number(w.risk_score ?? 0) >= 70;

            return (
              <tr
                key={w.id}
                onClick={() => router.push(`/withdrawals/${w.id}`)}
                className={cn(
                  'cursor-pointer transition-colors hover:bg-white/[0.025]',
                  canAct && 'bg-amber-950/[0.06]',
                  isHighRisk && 'bg-red-950/[0.05]',
                )}
              >
                {/* ID */}
                <td className="group px-4 py-3.5 whitespace-nowrap">
                  <div className="flex items-center gap-1">
                    <span className="font-mono text-sm text-admin-muted">{String(w.id).slice(0, 8)}…</span>
                    <CopyBtn text={String(w.id)} />
                  </div>
                </td>

                {/* User */}
                <td className="px-4 py-3.5 max-w-[180px]">
                  <span className="block truncate text-sm text-admin-text"
                    title={w.email ?? w.username ?? String(w.user_id ?? '')}>
                    {w.email ?? w.username ?? (w.user_id ? String(w.user_id).slice(0, 10) : '—')}
                  </span>
                </td>

                {/* Asset */}
                <td className="px-4 py-3.5 whitespace-nowrap">
                  <span className="inline-flex items-center rounded-md border border-admin-border/50 bg-white/[0.05] px-2.5 py-0.5 text-xs font-bold tracking-wide text-admin-text">
                    {w.currency_symbol ?? '—'}
                  </span>
                </td>

                {/* Amount */}
                <td className="px-4 py-3.5 whitespace-nowrap">
                  <span className="font-mono text-sm font-semibold tabular-nums text-admin-text">
                    {w.amount ?? '—'}
                  </span>
                </td>

                {/* Destination address */}
                <td className="group px-4 py-3.5 whitespace-nowrap">
                  {addr ? (
                    <div className="flex items-center gap-1">
                      <span className="font-mono text-sm text-admin-muted">
                        {addr.slice(0, 6)}…{addr.slice(-4)}
                      </span>
                      <CopyBtn text={addr} />
                    </div>
                  ) : <span className="text-sm text-admin-muted">—</span>}
                </td>

                {/* Risk */}
                <td className="px-4 py-3.5 whitespace-nowrap">
                  <WithdrawalRiskBadge score={w.risk_score} flags={w.risk_flags} />
                </td>

                {/* Status */}
                <td className="px-4 py-3.5 whitespace-nowrap">
                  <WithdrawalStatusBadge status={status} />
                </td>

                {/* Time */}
                <td className="px-4 py-3.5 whitespace-nowrap">
                  <span className="block text-sm text-admin-text">{fmtRelative(w.created_at)}</span>
                  <span className="block text-xs text-admin-muted">{fmtFull(w.created_at)}</span>
                </td>

                {/* Actions */}
                <td className="px-4 py-3.5" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-end gap-1.5">
                    {/* View */}
                    <button
                      type="button"
                      onClick={() => router.push(`/withdrawals/${w.id}`)}
                      className="flex items-center gap-1 rounded-lg border border-admin-border/50 px-2.5 py-1.5 text-xs font-medium text-admin-muted hover:text-admin-text hover:border-blue-500/30 hover:bg-blue-950/10 transition-colors"
                    >
                      <ExternalLink className="h-3.5 w-3.5" /> View
                    </button>

                    {/* User link */}
                    {w.user_id && (
                      <Link href={`/users/${String(w.user_id)}`} onClick={(e) => e.stopPropagation()}>
                        <span className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-admin-border/50 text-admin-muted hover:text-admin-text hover:border-blue-500/30 hover:bg-blue-950/10 transition-colors">
                          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                            <circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
                          </svg>
                        </span>
                      </Link>
                    )}

                    {/* Approve / Reject — only for pending */}
                    {canAct && (
                      <ProtectedAction permission="withdrawals:approve" fallback="disabled">
                        <>
                          <button
                            type="button"
                            onClick={() => onApprove(w)}
                            title="Approve"
                            className="flex items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-950/20 px-2.5 py-1.5 text-xs font-semibold text-emerald-400 hover:bg-emerald-950/40 transition-colors"
                          >
                            <Check className="h-3.5 w-3.5" /> Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => onReject(w)}
                            title="Reject"
                            className="flex items-center gap-1 rounded-lg border border-red-500/30 bg-red-950/20 px-2.5 py-1.5 text-xs font-semibold text-red-400 hover:bg-red-950/40 transition-colors"
                          >
                            <X className="h-3.5 w-3.5" /> Reject
                          </button>
                        </>
                      </ProtectedAction>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
