'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { AmlAlertRow } from '@/lib/risk-api';
import { ProtectedAction } from '@/components/rbac/ProtectedAction';
import { cn } from '@/lib/cn';
import { Eye, XCircle, ArrowUpCircle, Lock, Copy, Check, ShieldAlert } from 'lucide-react';

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

function SeverityPill({ s }: { s: string }) {
  const lvl = (s ?? '').toLowerCase();
  return (
    <span className={cn(
      'inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide',
      lvl === 'high'   && 'bg-red-950/30 border border-red-500/30 text-red-400',
      lvl === 'medium' && 'bg-amber-950/30 border border-amber-500/30 text-amber-400',
      lvl === 'low'    && 'bg-blue-950/30 border border-blue-500/30 text-blue-400',
      !['high','medium','low'].includes(lvl) && 'bg-white/[0.05] border border-admin-border/50 text-admin-muted',
    )}>
      {s || '—'}
    </span>
  );
}

function StatusPill({ s }: { s: string }) {
  const lvl = (s ?? '').toLowerCase();
  return (
    <span className={cn(
      'inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold capitalize',
      lvl === 'open'       && 'bg-amber-950/25 border border-amber-500/25 text-amber-300',
      lvl === 'reviewing'  && 'bg-blue-950/25 border border-blue-500/25 text-blue-300',
      lvl === 'closed'     && 'bg-white/[0.04] border border-admin-border/50 text-admin-muted',
      lvl === 'reported'   && 'bg-purple-950/25 border border-purple-500/25 text-purple-300',
      !['open','reviewing','closed','reported'].includes(lvl) && 'bg-white/[0.04] border border-admin-border/50 text-admin-muted',
    )}>
      {s?.replace(/_/g, ' ') || '—'}
    </span>
  );
}

function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  function copy(e: React.MouseEvent) {
    e.stopPropagation();
    void navigator.clipboard.writeText(text).then(() => { setOk(true); setTimeout(() => setOk(false), 1500); });
  }
  return (
    <button type="button" onClick={copy} className="ml-1 inline-flex items-center rounded p-0.5 text-admin-muted opacity-0 group-hover:opacity-100 hover:text-admin-text transition-opacity">
      {ok ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

export interface AmlAlertsTableProps {
  rows: AmlAlertRow[];
  onReview:   (row: AmlAlertRow) => void;
  onClose:    (row: AmlAlertRow) => void;
  onEscalate: (row: AmlAlertRow) => void;
  onFreeze:   (row: AmlAlertRow) => void;
}

export function AmlAlertsTable({ rows, onReview, onClose, onEscalate, onFreeze }: AmlAlertsTableProps) {
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-14 text-admin-muted">
        <ShieldAlert className="h-9 w-9 opacity-15" />
        <p className="text-sm">No AML alerts match the selected filter.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] text-sm">
        <thead>
          <tr className="border-b border-admin-border/50 bg-white/[0.015]">
            {['Alert ID', 'User', 'Type', 'Severity', 'Status', 'Time', 'Actions'].map((h) => (
              <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-admin-muted last:text-right">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-admin-border/30">
          {rows.map((row) => {
            const isOpen   = row.status === 'open' || row.status === 'reviewing';
            const isHigh   = row.severity?.toLowerCase() === 'high';

            return (
              <tr key={row.id} className={cn(
                'transition-colors hover:bg-white/[0.025]',
                isHigh && isOpen && 'bg-red-950/[0.06]',
              )}>
                {/* ID */}
                <td className="group px-4 py-3.5 whitespace-nowrap">
                  <div className="flex items-center gap-0.5">
                    <span className="font-mono text-sm text-admin-muted">{row.id.slice(0, 8)}…</span>
                    <CopyBtn text={row.id} />
                  </div>
                </td>

                {/* User */}
                <td className="px-4 py-3.5 max-w-[180px]">
                  {row.user_email ? (
                    <Link href={`/users/${row.user_id}`} className="block truncate text-sm text-blue-400 hover:text-blue-300 hover:underline" title={row.user_email}>
                      {row.user_email}
                    </Link>
                  ) : (
                    <span className="font-mono text-sm text-admin-muted">{row.user_id?.slice(0, 8)}…</span>
                  )}
                </td>

                {/* Type */}
                <td className="px-4 py-3.5 whitespace-nowrap">
                  <span className="text-sm text-admin-text capitalize">{row.alert_type?.replace(/_/g, ' ') ?? '—'}</span>
                </td>

                {/* Severity */}
                <td className="px-4 py-3.5 whitespace-nowrap">
                  <SeverityPill s={row.severity} />
                </td>

                {/* Status */}
                <td className="px-4 py-3.5 whitespace-nowrap">
                  <StatusPill s={row.status} />
                </td>

                {/* Time */}
                <td className="px-4 py-3.5 whitespace-nowrap">
                  <span className="block text-sm text-admin-text">{fmtRelative(row.created_at)}</span>
                  <span className="block text-xs text-admin-muted">{fmtFull(row.created_at)}</span>
                </td>

                {/* Actions */}
                <td className="px-4 py-3.5">
                  <div className="flex items-center justify-end gap-1.5">
                    {isOpen ? (
                      <>
                        <ProtectedAction permission="aml:view" fallback="disabled">
                          <button type="button" onClick={() => onReview(row)}
                            className="flex items-center gap-1 rounded-lg border border-blue-500/25 bg-blue-950/15 px-2.5 py-1.5 text-xs font-medium text-blue-400 hover:bg-blue-950/30 transition-colors">
                            <Eye className="h-3.5 w-3.5" /> Review
                          </button>
                        </ProtectedAction>
                        <ProtectedAction permission="aml:escalate" fallback="disabled">
                          <button type="button" onClick={() => onEscalate(row)}
                            className="flex items-center gap-1 rounded-lg border border-amber-500/25 bg-amber-950/15 px-2.5 py-1.5 text-xs font-medium text-amber-400 hover:bg-amber-950/30 transition-colors">
                            <ArrowUpCircle className="h-3.5 w-3.5" /> STR
                          </button>
                        </ProtectedAction>
                        <ProtectedAction permission="users:edit" fallback="disabled">
                          <button type="button" onClick={() => onFreeze(row)}
                            className="flex items-center gap-1 rounded-lg border border-red-500/25 bg-red-950/15 px-2.5 py-1.5 text-xs font-medium text-red-400 hover:bg-red-950/30 transition-colors">
                            <Lock className="h-3.5 w-3.5" /> Freeze
                          </button>
                        </ProtectedAction>
                        <ProtectedAction permission="aml:view" fallback="disabled">
                          <button type="button" onClick={() => onClose(row)}
                            className="flex h-8 w-8 items-center justify-center rounded-lg border border-admin-border/50 text-admin-muted hover:text-admin-text hover:bg-white/[0.04] transition-colors">
                            <XCircle className="h-4 w-4" />
                          </button>
                        </ProtectedAction>
                      </>
                    ) : (
                      <span className="text-xs text-admin-muted italic">resolved</span>
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
