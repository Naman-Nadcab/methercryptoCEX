'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getAdminLogs } from '@/lib/admin/settings';
import { SectionHeader } from '@/components/admin/control-plane';
import { AdminPanel, AdminDataTable } from '@/components/admin/ui';
import { DataTableTh, DataTableRow, DataTableCell } from '@/components/admin/control-plane';
import { Loader2 } from 'lucide-react';

export default function AdminAuditLogsPage() {
  const { accessToken } = useAdminAuthStore();
  const [page, setPage] = useState(0);
  const limit = 50;

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'admin-logs', page, limit],
    queryFn: () => getAdminLogs(accessToken, { limit, offset: page * limit }),
    enabled: !!accessToken,
  });

  const logs = (data?.data as { logs?: Array<Record<string, unknown>> })?.logs ?? [];
  const total = (data?.data as { total?: number })?.total ?? logs.length;

  if (isLoading && logs.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[320px]">
        <Loader2 className="w-8 h-8 text-muted-foreground animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Admin Audit Logs"
        subtitle="Admin name, action, resource, timestamp, IP"
      />

      <AdminPanel title="Filters" subtitle="Date, admin user, action type">
        <p className="text-sm text-muted-foreground">Filtering can be added via query params when the backend supports it. Showing latest logs.</p>
      </AdminPanel>

      <AdminDataTable
        title="Admin activity"
        subtitle={`Showing ${logs.length} log entries`}
        isEmpty={logs.length === 0}
        emptyMessage="No admin logs."
        wrapTable={false}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <DataTableTh>Admin</DataTableTh>
                <DataTableTh>Action</DataTableTh>
                <DataTableTh>Resource</DataTableTh>
                <DataTableTh align="right">Timestamp</DataTableTh>
                <DataTableTh>IP address</DataTableTh>
              </tr>
            </thead>
            <tbody>
              {logs.map((log: Record<string, unknown>, i: number) => (
                <DataTableRow key={String(log.id ?? log.timestamp ?? i)}>
                  <DataTableCell>{String(log.admin_name ?? log.admin_email ?? log.actor_id ?? '—')}</DataTableCell>
                  <DataTableCell>{String(log.action ?? log.activity_type ?? '—')}</DataTableCell>
                  <DataTableCell>{String(log.resource ?? log.resource_type ?? '—')}</DataTableCell>
                  <DataTableCell align="right">
                    {log.timestamp || log.created_at
                      ? new Date(String(log.timestamp ?? log.created_at)).toLocaleString()
                      : '—'}
                  </DataTableCell>
                  <DataTableCell className="font-mono text-xs">{String(log.ip_address ?? log.ip ?? '—')}</DataTableCell>
                </DataTableRow>
              ))}
            </tbody>
          </table>
        </div>
        {total > limit && (
          <div className="flex justify-between items-center px-3 py-2 border-t border-border">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="text-xs text-primary hover:underline disabled:opacity-50"
            >
              Previous
            </button>
            <span className="text-xs text-muted-foreground">Page {page + 1}</span>
            <button
              type="button"
              onClick={() => setPage((p) => p + 1)}
              disabled={logs.length < limit}
              className="text-xs text-primary hover:underline disabled:opacity-50"
            >
              Next
            </button>
          </div>
        )}
      </AdminDataTable>
    </div>
  );
}
