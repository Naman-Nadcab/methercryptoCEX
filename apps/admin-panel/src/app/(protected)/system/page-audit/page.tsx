'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/auth';
import { getPageAuditReport } from '@/lib/api';
import { AdminPageFrame } from '@/components/admin-shell/AdminPageFrame';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { TableSkeleton } from '@/components/ui';
import { CheckCircle2, XCircle, AlertTriangle, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/cn';

type AuditStatus = 'all' | 'WORKING' | 'PARTIAL' | 'FAIL';

export default function PageAuditRoute() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const [filter, setFilter] = useState<AuditStatus>('all');
  const [autoRefresh, setAutoRefresh] = useState(false);

  const q = useQuery({
    queryKey: ['admin', 'page-audit', token],
    queryFn: () => getPageAuditReport(token),
    enabled: !!token,
    refetchInterval: autoRefresh ? 30_000 : false,
  });

  const summary = q.data?.data?.summary ?? '';
  const status: 'active' | 'warning' | 'risk' =
    summary === 'WORKING' ? 'active' : summary === 'PARTIAL' ? 'warning' : q.isError ? 'risk' : 'warning';

  const allResults: Record<string, unknown>[] = q.data?.data?.results ?? [];
  const results = filter === 'all' ? allResults : allResults.filter((r) => r.status === filter);

  const working = allResults.filter((r) => r.status === 'WORKING').length;
  const partial = allResults.filter((r) => r.status === 'PARTIAL').length;
  const failed = allResults.filter((r) => r.status !== 'WORKING' && r.status !== 'PARTIAL').length;

  return (
    <AdminPageFrame
      title="Page & API Audit"
      description="Probes primary admin read APIs via the API process (loopback). Expand coverage in backend /system/page-audit."
      status={status}
      error={q.isError ? (q.error as Error)?.message || 'Audit failed' : null}
      onRetry={() => void q.refetch()}
      quickActions={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setAutoRefresh((v) => !v)}
            className={cn(
              'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
              autoRefresh
                ? 'border-emerald-500/30 bg-emerald-950/20 text-emerald-400'
                : 'border-admin-border bg-admin-surface text-admin-muted hover:text-admin-text'
            )}
          >
            <span className={cn('h-1.5 w-1.5 rounded-full', autoRefresh ? 'bg-emerald-400 animate-pulse' : 'bg-admin-muted')} />
            {autoRefresh ? 'Auto 30s' : 'Auto-refresh off'}
          </button>
          <Button type="button" variant="secondary" size="sm" onClick={() => void q.refetch()} disabled={q.isFetching}>
            <RefreshCw className={cn('mr-1 h-3.5 w-3.5', q.isFetching && 'animate-spin')} />
            Run again
          </Button>
        </div>
      }
    >
      {/* KPI strip */}
      {!q.isLoading && allResults.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Working', value: working, icon: <CheckCircle2 className="h-4 w-4 text-emerald-400" />, color: 'text-emerald-400' },
            { label: 'Partial', value: partial, icon: <AlertTriangle className="h-4 w-4 text-amber-400" />, color: 'text-amber-400' },
            { label: 'Failed', value: failed, icon: <XCircle className="h-4 w-4 text-red-400" />, color: failed > 0 ? 'text-red-400' : 'text-admin-muted' },
          ].map((k) => (
            <button
              key={k.label}
              type="button"
              onClick={() => setFilter((prev) => prev === k.label.toUpperCase() ? 'all' : k.label.toUpperCase() as AuditStatus)}
              className={cn(
                'flex items-center gap-3 rounded-xl border bg-admin-card px-4 py-3 text-left transition-colors hover:bg-white/[0.04]',
                filter === k.label.toUpperCase() ? 'border-admin-accent/40' : 'border-admin-border'
              )}
            >
              {k.icon}
              <div>
                <p className="text-xs text-admin-muted">{k.label}</p>
                <p className={cn('text-xl font-semibold tabular-nums', k.color)}>{k.value}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Filter tabs */}
      {allResults.length > 0 && (
        <div className="flex items-center gap-1 rounded-lg border border-admin-border bg-admin-surface p-1 w-fit">
          {(['all', 'WORKING', 'PARTIAL', 'FAIL'] as AuditStatus[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setFilter(s)}
              className={cn(
                'rounded-md px-3 py-1 text-xs font-medium transition-colors',
                filter === s
                  ? 'bg-admin-card text-admin-text shadow-sm'
                  : 'text-admin-muted hover:text-admin-text'
              )}
            >
              {s === 'all' ? 'All' : s}
              {s !== 'all' && (
                <span className="ml-1 tabular-nums text-admin-muted/60">
                  ({allResults.filter((r) => r.status === s).length})
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {q.isLoading ? (
        <TableSkeleton rows={6} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-admin-border">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-admin-border bg-admin-surface text-admin-muted">
              <tr>
                <th className="p-3 font-medium">Page</th>
                <th className="p-3 font-medium">API path</th>
                <th className="p-3 font-medium">Status</th>
                <th className="p-3 font-medium">HTTP</th>
                <th className="p-3 font-medium">Response</th>
                <th className="p-3 font-medium">Detail</th>
              </tr>
            </thead>
            <tbody>
              {results.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-admin-muted">
                    {filter === 'all' ? 'No audit results. Click "Run again" to start.' : `No ${filter} results.`}
                  </td>
                </tr>
              ) : (
                results.map((row) => {
                  const ms = Number(row.responseTimeMs ?? 0);
                  const timeColor = ms > 3000 ? 'text-admin-danger' : ms > 1000 ? 'text-admin-warning' : 'text-admin-success';
                  const rowKey = `${String(row.page)}-${String(row.path)}-${String(row.httpStatus)}`;
                  const isWorking = row.status === 'WORKING';
                  const isFail = row.status !== 'WORKING' && row.status !== 'PARTIAL';
                  return (
                    <tr
                      key={rowKey}
                      className={cn(
                        'border-b border-admin-border/60 transition-colors',
                        isFail ? 'bg-red-950/10' : ''
                      )}
                    >
                      <td className="p-3 text-admin-text">{row.page as string}</td>
                      <td className="p-3 font-mono text-xs text-admin-muted">{row.path as string}</td>
                      <td className="p-3">
                        <Badge
                          variant={isWorking ? 'success' : row.status === 'PARTIAL' ? 'warning' : 'danger'}
                        >
                          {row.status as string}
                        </Badge>
                      </td>
                      <td className="p-3 tabular-nums text-admin-text">{row.httpStatus as number}</td>
                      <td className={cn('p-3 tabular-nums', timeColor)}>{ms ? `${ms}ms` : '—'}</td>
                      <td className="p-3 text-admin-muted max-w-[260px] truncate" title={(row.detail as string) ?? ''}>
                        {(row.detail as string) ?? '—'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-admin-muted">
        {q.data?.data?.note && <p>{q.data.data.note}</p>}
        {q.data?.data?.generated_at && (
          <p>Generated: {q.data.data.generated_at}</p>
        )}
      </div>
    </AdminPageFrame>
  );
}
