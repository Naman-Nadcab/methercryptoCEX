'use client';

import Link from 'next/link';
import type { SanctionRow } from '@/lib/risk-api';
import { StatusBadge } from '@/components/dashboard/StatusBadge';

export interface SanctionsTableProps {
  rows: SanctionRow[];
}

function formatTimeAgo(iso: string): string {
  try {
    const d = new Date(iso);
    const now = Date.now();
    const diff = (now - d.getTime()) / 60000;
    if (diff < 1) return 'Just now';
    if (diff < 60) return `${Math.floor(diff)} minutes ago`;
    if (diff < 1440) return `${Math.floor(diff / 60)} hours ago`;
    return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return iso ?? '—';
  }
}

export function SanctionsTable({ rows }: SanctionsTableProps) {
  return (
    <div className="overflow-x-auto rounded-xl border border-admin-border bg-white">
      <table className="w-full min-w-[700px] text-left text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 font-medium text-admin-muted">Address</th>
            <th className="px-4 py-3 font-medium text-admin-muted">User</th>
            <th className="px-4 py-3 font-medium text-admin-muted">Chain</th>
            <th className="px-4 py-3 font-medium text-admin-muted">Risk Level</th>
            <th className="px-4 py-3 font-medium text-admin-muted">Last Activity</th>
            <th className="px-4 py-3 font-medium text-admin-muted">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-4 py-8 text-center text-admin-muted">
                No sanction activity.
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.id} className="border-t border-admin-border hover:bg-gray-50/50">
                <td className="px-4 py-3 font-mono text-xs" title={row.address_full ?? row.address}>
                  {row.address}
                </td>
                <td className="px-4 py-3">
                  {row.user_email && row.user_email !== '—' ? (
                    <Link href={`/users/${row.user_id}`} className="text-admin-primary hover:underline">
                      {row.user_email}
                    </Link>
                  ) : (
                    <span className="text-gray-500">{row.user_id?.slice(0, 8)}…</span>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-900">{row.chain}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={row.risk_level} variant={row.risk_level === 'High' ? 'danger' : 'warning'} />
                </td>
                <td className="px-4 py-3 text-gray-600">{formatTimeAgo(row.last_activity)}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={row.status} />
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
