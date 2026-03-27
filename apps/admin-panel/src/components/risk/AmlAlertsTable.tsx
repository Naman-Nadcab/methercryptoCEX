'use client';

import Link from 'next/link';
import type { AmlAlertRow } from '@/lib/risk-api';
import { StatusBadge } from '@/components/dashboard/StatusBadge';
import { Button } from '@/components/ui/Button';
import { Eye, XCircle, ArrowUpCircle, Lock } from 'lucide-react';

export interface AmlAlertsTableProps {
  rows: AmlAlertRow[];
  onReview: (row: AmlAlertRow) => void;
  onClose: (row: AmlAlertRow) => void;
  onEscalate: (row: AmlAlertRow) => void;
  onFreeze: (row: AmlAlertRow) => void;
}

function formatDate(s: string | undefined): string {
  if (!s) return '—';
  try {
    return new Date(s).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return s;
  }
}

function severityVariant(s: string): 'success' | 'warning' | 'danger' | 'default' {
  const lower = (s || '').toLowerCase();
  if (lower === 'high') return 'danger';
  if (lower === 'medium') return 'warning';
  return 'default';
}

export function AmlAlertsTable({ rows, onReview, onClose, onEscalate, onFreeze }: AmlAlertsTableProps) {
  return (
    <div className="overflow-x-auto rounded-xl border border-admin-border bg-white">
      <table className="w-full min-w-[800px] text-left text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 font-medium text-admin-muted">Alert ID</th>
            <th className="px-4 py-3 font-medium text-admin-muted">User</th>
            <th className="px-4 py-3 font-medium text-admin-muted">Alert Type</th>
            <th className="px-4 py-3 font-medium text-admin-muted">Severity</th>
            <th className="px-4 py-3 font-medium text-admin-muted">Status</th>
            <th className="px-4 py-3 font-medium text-admin-muted">Created</th>
            <th className="px-4 py-3 font-medium text-admin-muted">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-4 py-8 text-center text-admin-muted">
                No AML alerts.
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.id} className="border-t border-admin-border hover:bg-gray-50/50">
                <td className="px-4 py-3 font-mono text-xs text-gray-600">
                  {row.id.slice(0, 8)}…
                </td>
                <td className="px-4 py-3">
                  {row.user_email ? (
                    <Link href={`/users/${row.user_id}`} className="text-admin-primary hover:underline">
                      {row.user_email}
                    </Link>
                  ) : (
                    <span className="text-gray-500">{row.user_id?.slice(0, 8)}…</span>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-900">{row.alert_type?.replace(/_/g, ' ') ?? '—'}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={row.severity} variant={severityVariant(row.severity)} />
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={row.status} />
                </td>
                <td className="px-4 py-3 text-gray-600">{formatDate(row.created_at)}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {(row.status === 'open' || row.status === 'reviewing') && (
                      <>
                        <Button variant="ghost" size="sm" onClick={() => onReview(row)} title="Review">
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => onClose(row)} title="Close">
                          <XCircle className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => onEscalate(row)} title="Escalate STR">
                          <ArrowUpCircle className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => onFreeze(row)} title="Freeze Account">
                          <Lock className="h-4 w-4" />
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
