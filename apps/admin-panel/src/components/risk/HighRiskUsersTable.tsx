'use client';

import Link from 'next/link';
import type { HighRiskUserRow } from '@/lib/risk-api';
import { cn } from '@/lib/cn';
import { ShieldAlert, ExternalLink } from 'lucide-react';

function fmtRelative(s: string | null | undefined): string {
  if (!s) return '—';
  const diff = Date.now() - new Date(s).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}
function fmtFull(s: string | null | undefined): string {
  if (!s) return '';
  try { return new Date(s).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); }
  catch { return ''; }
}
function fmtVol(v: string): string {
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return '—';
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function RiskBar({ score }: { score: number }) {
  const pct = Math.min(100, Math.max(0, score));
  const color = pct >= 70 ? 'bg-red-500' : pct >= 40 ? 'bg-amber-400' : 'bg-emerald-500';
  const textColor = pct >= 70 ? 'text-red-400' : pct >= 40 ? 'text-amber-400' : 'text-emerald-400';
  return (
    <div className="flex items-center gap-2 min-w-[100px]">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-white/[0.08]">
        <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
      </div>
      <span className={cn('text-sm font-bold tabular-nums', textColor)}>{score}</span>
    </div>
  );
}

export interface HighRiskUsersTableProps {
  rows: HighRiskUserRow[];
}

export function HighRiskUsersTable({ rows }: HighRiskUsersTableProps) {
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-14 text-admin-muted">
        <ShieldAlert className="h-9 w-9 opacity-15" />
        <p className="text-sm">No high-risk users detected.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[700px] text-sm">
        <thead>
          <tr className="border-b border-admin-border/50 bg-white/[0.015]">
            {['User', 'Risk Score', 'Flags', 'Total Volume', 'Last Activity', ''].map((h) => (
              <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-admin-muted last:text-right">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-admin-border/30">
          {rows.map((row) => {
            const isHigh = row.risk_score >= 70;
            return (
              <tr key={row.user_id} className={cn(
                'transition-colors hover:bg-white/[0.025]',
                isHigh && 'bg-red-950/[0.05]',
              )}>
                {/* User */}
                <td className="px-4 py-3.5 max-w-[200px]">
                  {row.user_email ? (
                    <Link href={`/users/${row.user_id}`}
                      className="block truncate text-sm text-blue-400 hover:text-blue-300 hover:underline"
                      title={row.user_email}>
                      {row.user_email}
                    </Link>
                  ) : (
                    <span className="font-mono text-sm text-admin-muted">{row.user_id?.slice(0, 10)}…</span>
                  )}
                </td>

                {/* Risk score */}
                <td className="px-4 py-3.5">
                  <RiskBar score={row.risk_score} />
                </td>

                {/* Flags */}
                <td className="px-4 py-3.5">
                  <div className="flex flex-wrap gap-1">
                    {(row.flags ?? []).slice(0, 4).map((f) => (
                      <span key={f} className="inline-flex items-center rounded-md border border-amber-500/25 bg-amber-950/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
                        {f.replace(/_/g, ' ')}
                      </span>
                    ))}
                    {(row.flags?.length ?? 0) > 4 && (
                      <span className="inline-flex items-center rounded-md border border-admin-border/50 bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-admin-muted">
                        +{row.flags!.length - 4} more
                      </span>
                    )}
                    {(row.flags?.length ?? 0) === 0 && <span className="text-sm text-admin-muted">—</span>}
                  </div>
                </td>

                {/* Volume */}
                <td className="px-4 py-3.5 whitespace-nowrap">
                  <span className="font-mono text-sm font-semibold tabular-nums text-admin-text">{fmtVol(row.total_volume)}</span>
                </td>

                {/* Last activity */}
                <td className="px-4 py-3.5 whitespace-nowrap" title={fmtFull(row.last_activity)}>
                  <span className="block text-sm text-admin-text">{fmtRelative(row.last_activity)}</span>
                  <span className="block text-xs text-admin-muted">{fmtFull(row.last_activity)}</span>
                </td>

                {/* Action */}
                <td className="px-4 py-3.5 text-right">
                  <Link href={`/users/${row.user_id}`} onClick={(e) => e.stopPropagation()}>
                    <button type="button"
                      className="flex items-center gap-1 rounded-lg border border-admin-border/50 px-2.5 py-1.5 text-xs font-medium text-admin-muted hover:text-admin-text hover:border-blue-500/30 hover:bg-blue-950/10 transition-colors">
                      <ExternalLink className="h-3.5 w-3.5" /> View
                    </button>
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
