'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { DepositRow } from '@/lib/deposits-api';
import { DepositStatusBadge } from './DepositStatusBadge';
import { ConfirmationProgress } from './ConfirmationProgress';
import { LargeDepositBadge, StuckDepositBadge, isDepositStuck } from './DepositIndicators';
import { cn } from '@/lib/cn';
import { Copy, Check, ExternalLink, CreditCard } from 'lucide-react';
import { ArrowDownToLine } from 'lucide-react';

/* ── helpers ─────────────────────────────────────────────── */
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
  try {
    return new Date(s).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return '';
  }
}

function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  function copy(e: React.MouseEvent) {
    e.stopPropagation();
    void navigator.clipboard.writeText(text).then(() => {
      setOk(true);
      setTimeout(() => setOk(false), 1500);
    });
  }
  return (
    <button
      type="button"
      onClick={copy}
      title="Copy"
      className="inline-flex items-center justify-center rounded p-0.5 text-admin-muted opacity-0 group-hover:opacity-100 transition-opacity hover:text-admin-text"
    >
      {ok
        ? <Check className="h-3 w-3 text-emerald-400" />
        : <Copy className="h-3 w-3" />}
    </button>
  );
}

/* ── props ───────────────────────────────────────────────── */
export interface DepositsTableProps {
  rows: DepositRow[];
  onManualCredit: (d: DepositRow) => void;
  canManualCredit?: boolean;
}

/* ── component ───────────────────────────────────────────── */
export function DepositsTable({ rows, onManualCredit, canManualCredit = true }: DepositsTableProps) {
  const router = useRouter();

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-admin-muted">
        <ArrowDownToLine className="h-9 w-9 opacity-15" />
        <p className="text-sm">No deposits match your filters.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] text-sm">

        {/* Head */}
        <thead>
          <tr className="border-b border-admin-border/50 bg-white/[0.015]">
            {['Deposit ID', 'User', 'Asset', 'Amount', 'TX Hash', 'Confirmations', 'Status', 'Time', ''].map((h) => (
              <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-admin-muted">
                {h}
              </th>
            ))}
          </tr>
        </thead>

        {/* Body */}
        <tbody className="divide-y divide-admin-border/30">
          {rows.map((row) => {
            const depositId = String(row.deposit_id ?? '');
            const txHash    = String(row.tx_hash ?? '');
            const status    = String(row.status ?? '');
            const stuck     = isDepositStuck(status, row.created_at as string);
            const isLarge   = !!row.is_large_deposit;
            const conf      = Number(row.confirmations ?? 0);
            const req       = Number(row.required_confirmations ?? 0);
            const confirmed = req > 0 && conf >= req;

            return (
              <tr
                key={depositId}
                onClick={() => router.push(`/deposits/${depositId}`)}
                className={cn(
                  'cursor-pointer transition-colors hover:bg-white/[0.025]',
                  stuck && 'bg-amber-950/[0.08]',
                  status === 'failed' && 'bg-red-950/[0.06]',
                )}
              >
                {/* Deposit ID */}
                <td className="group px-4 py-3.5 whitespace-nowrap">
                  <div className="flex items-center gap-1">
                    <span className="font-mono text-sm text-admin-muted">{depositId.slice(0, 8)}…</span>
                    <CopyBtn text={depositId} />
                  </div>
                </td>

                {/* User */}
                <td className="px-4 py-3.5 max-w-[180px]">
                  <span className="block truncate text-sm text-admin-text" title={String(row.user_email ?? row.user_id ?? '')}>
                    {String(row.user_email ?? row.user_id ?? '—')}
                  </span>
                </td>

                {/* Asset */}
                <td className="px-4 py-3.5 whitespace-nowrap">
                  <span className="inline-flex items-center rounded-md border border-admin-border/50 bg-white/[0.05] px-2.5 py-0.5 text-xs font-bold tracking-wide text-admin-text">
                    {String(row.token_symbol ?? '—')}
                  </span>
                </td>

                {/* Amount */}
                <td className="px-4 py-3.5 whitespace-nowrap">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={cn('font-mono text-sm font-semibold tabular-nums', isLarge ? 'text-amber-300' : 'text-admin-text')}>
                      {String(row.amount ?? '—')}
                    </span>
                    {isLarge && <LargeDepositBadge />}
                  </div>
                </td>

                {/* TX Hash */}
                <td className="group px-4 py-3.5 whitespace-nowrap">
                  {txHash ? (
                    <div className="flex items-center gap-1">
                      <span className="font-mono text-sm text-admin-muted">{txHash.slice(0, 6)}…{txHash.slice(-4)}</span>
                      <CopyBtn text={txHash} />
                    </div>
                  ) : (
                    <span className="text-sm text-admin-muted">—</span>
                  )}
                </td>

                {/* Confirmations */}
                <td className="px-4 py-3.5">
                  <ConfirmationProgress confirmations={conf} required={req} />
                </td>

                {/* Status */}
                <td className="px-4 py-3.5 whitespace-nowrap">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <DepositStatusBadge status={status} />
                    {stuck && <StuckDepositBadge />}
                  </div>
                </td>

                {/* Time */}
                <td className="px-4 py-3.5 whitespace-nowrap">
                  <span className="block text-sm text-admin-text">{fmtRelative(row.created_at as string)}</span>
                  <span className="block text-xs text-admin-muted">{fmtFull(row.created_at as string)}</span>
                </td>

                {/* Actions */}
                <td className="px-4 py-3.5" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => router.push(`/deposits/${depositId}`)}
                      className="flex items-center gap-1 rounded-lg border border-admin-border/50 px-2.5 py-1.5 text-xs font-medium text-admin-muted hover:text-admin-text hover:border-blue-500/30 hover:bg-blue-950/10 transition-colors"
                    >
                      <ExternalLink className="h-3.5 w-3.5" /> View
                    </button>
                    {row.user_id && (
                      <Link href={`/users/${String(row.user_id)}`} onClick={(e) => e.stopPropagation()}>
                        <span className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-admin-border/50 text-admin-muted hover:text-admin-text hover:border-blue-500/30 hover:bg-blue-950/10 transition-colors">
                          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                            <circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
                          </svg>
                        </span>
                      </Link>
                    )}
                    {canManualCredit && !confirmed && (
                      <button
                        type="button"
                        title="Manual credit"
                        onClick={() => onManualCredit(row)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-admin-border/50 text-admin-muted hover:text-emerald-400 hover:border-emerald-500/30 hover:bg-emerald-950/10 transition-colors"
                      >
                        <CreditCard className="h-4 w-4" />
                      </button>
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
