'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/auth';
import { getMonitoringIncidents, type IncidentRow } from '@/lib/monitoring-api';
import { Badge } from '@/components/ui/Badge';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { ExternalLink, Database } from 'lucide-react';
import { cn } from '@/lib/cn';

const STATUS_FILTER = [
  { id: 'all', label: 'All' },
  { id: 'open', label: 'Open' },
  { id: 'acknowledged', label: 'Acknowledged' },
  { id: 'resolved', label: 'Resolved' },
] as const;

function severityVariant(s: string): 'danger' | 'warning' | 'info' | 'default' {
  const x = s.toLowerCase();
  if (x === 'critical' || x === 'high') return 'danger';
  if (x === 'medium') return 'warning';
  if (x === 'low') return 'info';
  return 'default';
}

export function MonitoringIncidentsPanel() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const [status, setStatus] = useState<string>('all');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin', 'monitoring-incidents', token, status],
    queryFn: () =>
      getMonitoringIncidents(token, {
        limit: 50,
        offset: 0,
        status: status === 'all' ? undefined : status,
      }),
    enabled: !!token,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const incidents = (data?.data?.incidents ?? []) as IncidentRow[];
  const total = data?.data?.total ?? 0;

  return (
    <section className="rounded-xl border border-admin-border bg-admin-card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-admin-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-admin-primary shrink-0" />
          <div>
            <h2 className="text-sm font-semibold text-admin-text">Recorded incidents</h2>
            <p className="text-[10px] text-admin-muted">
              Source: <code className="rounded bg-white/5 px-1">monitoring_incidents</code> (same list as Admin Control). Create or resolve from{' '}
              <Link href="/admin-control" className="text-admin-primary hover:underline">
                Admin control
              </Link>
              .
            </p>
          </div>
        </div>
        <Link
          href="/admin-control"
          className="inline-flex items-center gap-1.5 rounded-lg border border-admin-border bg-white/5 px-3 py-1.5 text-xs font-medium text-admin-text hover:bg-white/10"
        >
          Open Admin control
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      </div>

      <div className="flex flex-wrap gap-1 px-4 py-2 border-b border-admin-border bg-white/[0.02]">
        {STATUS_FILTER.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setStatus(f.id)}
            className={cn(
              'rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors',
              status === f.id ? 'bg-admin-primary/15 text-admin-primary' : 'text-admin-muted hover:bg-white/5 hover:text-admin-text'
            )}
          >
            {f.label}
          </button>
        ))}
        <span className="ml-auto text-[10px] text-admin-muted self-center tabular-nums">{total} total</span>
      </div>

      <div className="overflow-x-auto">
        {isLoading ? (
          <div className="p-4">
            <TableSkeleton rows={4} cols={5} />
          </div>
        ) : isError ? (
          <p className="px-4 py-8 text-center text-xs text-admin-danger">Failed to load incidents.</p>
        ) : incidents.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs text-admin-muted">No incidents for this filter.</p>
        ) : (
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-admin-border bg-white/[0.02]">
                <th className="px-4 py-2 font-medium text-admin-muted">Service</th>
                <th className="px-3 py-2 font-medium text-admin-muted">Severity</th>
                <th className="px-3 py-2 font-medium text-admin-muted">Status</th>
                <th className="px-3 py-2 font-medium text-admin-muted">Created</th>
                <th className="px-3 py-2 font-medium text-admin-muted">Resolved</th>
              </tr>
            </thead>
            <tbody>
              {incidents.map((row) => (
                <tr key={row.id} className="border-b border-admin-border/80 hover:bg-white/[0.02]">
                  <td className="px-4 py-2.5 font-medium text-admin-text">{row.service}</td>
                  <td className="px-3 py-2.5">
                    <Badge variant={severityVariant(row.severity)} size="sm">
                      {row.severity}
                    </Badge>
                  </td>
                  <td className="px-3 py-2.5 capitalize text-admin-text">{row.status}</td>
                  <td className="px-3 py-2.5 text-admin-muted tabular-nums">{row.created_at ? new Date(row.created_at).toLocaleString() : '—'}</td>
                  <td className="px-3 py-2.5 text-admin-muted tabular-nums">{row.resolved_at ? new Date(row.resolved_at).toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
