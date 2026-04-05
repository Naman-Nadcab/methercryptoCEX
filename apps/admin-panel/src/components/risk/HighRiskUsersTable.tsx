'use client';

import Link from 'next/link';
import type { HighRiskUserRow } from '@/lib/risk-api';
import { Badge } from '@/components/ui/Badge';

export interface HighRiskUsersTableProps {
  rows: HighRiskUserRow[];
}

function formatDate(s: string | null | undefined): string {
  if (!s) return '—';
  try {
    return new Date(s).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return s;
  }
}

function formatVolume(v: string): string {
  const n = parseFloat(v);
  if (Number.isNaN(n)) return '—';
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}

export function HighRiskUsersTable({ rows }: HighRiskUsersTableProps) {
  return (
    <div className="overflow-x-auto rounded-xl border border-admin-border bg-admin-card">
      <table className="w-full min-w-[700px] text-left text-sm">
        <thead className="bg-white/[0.02]">
          <tr>
            <th className="px-4 py-3 font-medium text-admin-muted">User</th>
            <th className="px-4 py-3 font-medium text-admin-muted">Risk Score</th>
            <th className="px-4 py-3 font-medium text-admin-muted">Flags</th>
            <th className="px-4 py-3 font-medium text-admin-muted">Total Volume</th>
            <th className="px-4 py-3 font-medium text-admin-muted">Last Activity</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-4 py-8 text-center text-admin-muted">
                No high-risk users.
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.user_id} className="border-t border-admin-border hover:bg-admin-card/[0.03]">
                <td className="px-4 py-3">
                  {row.user_email ? (
                    <Link href={`/users/${row.user_id}`} className="text-admin-primary hover:underline">
                      {row.user_email}
                    </Link>
                  ) : (
                    <span className="font-mono text-admin-muted">{row.user_id?.slice(0, 8)}…</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className={row.risk_score > 2 ? 'font-semibold text-red-600' : 'text-admin-text'}>
                    {row.risk_score}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {(row.flags ?? []).slice(0, 5).map((f) => (
                      <Badge key={f} variant="warning">
                        {f.replace(/_/g, ' ')}
                      </Badge>
                    ))}
                    {(row.flags?.length ?? 0) > 5 && (
                      <Badge variant="default">+{row.flags!.length - 5}</Badge>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 tabular-nums text-admin-text">{formatVolume(row.total_volume)}</td>
                <td className="px-4 py-3 text-admin-muted">{formatDate(row.last_activity)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
