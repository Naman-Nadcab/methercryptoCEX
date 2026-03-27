'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/auth';
import { getConfigAuditLogs, type ConfigAuditLogRow } from '@/lib/audit-api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ArrowLeft, Download, FileText } from 'lucide-react';

function escapeCsvField(s: string): string {
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export default function AuditConfigPage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const [filterAdmin, setFilterAdmin] = useState('');
  const [filterAction, setFilterAction] = useState('');
  const [filterSettingKey, setFilterSettingKey] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['admin', 'audit', 'config', token],
    queryFn: () => getConfigAuditLogs(token, 500),
    enabled: !!token,
  });

  const logs = (data?.data?.logs ?? []) as ConfigAuditLogRow[];

  const filteredLogs = useMemo(() => {
    return logs.filter((row) => {
      if (filterAdmin && !row.admin.toLowerCase().includes(filterAdmin.toLowerCase())) return false;
      if (filterAction && row.action !== filterAction) return false;
      if (filterSettingKey && !(row.setting_key || '').toLowerCase().includes(filterSettingKey.toLowerCase())) return false;
      if (filterDateFrom || filterDateTo) {
        const t = row.timestamp ? new Date(row.timestamp).getTime() : 0;
        if (filterDateFrom) {
          const start = new Date(filterDateFrom);
          start.setHours(0, 0, 0, 0);
          if (t < start.getTime()) return false;
        }
        if (filterDateTo) {
          const end = new Date(filterDateTo);
          end.setHours(23, 59, 59, 999);
          if (t > end.getTime()) return false;
        }
      }
      return true;
    });
  }, [logs, filterAdmin, filterAction, filterSettingKey, filterDateFrom, filterDateTo]);

  const actionTypes = useMemo(() => {
    const set = new Set(logs.map((r) => r.action).filter(Boolean));
    return Array.from(set).sort();
  }, [logs]);

  const handleExportCsv = () => {
    const header = 'Timestamp,Admin,Action,Setting Key,Old Value,New Value';
    const rows = filteredLogs.map((r) =>
      [
        r.timestamp ?? '',
        escapeCsvField(r.admin ?? ''),
        escapeCsvField(r.action ?? ''),
        escapeCsvField(r.setting_key ?? ''),
        escapeCsvField(r.old_value ?? ''),
        escapeCsvField(r.new_value ?? ''),
      ].join(',')
    );
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit_config_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link href="/settings/system">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Config changes</h1>
            <p className="mt-1 text-sm text-admin-muted">
              Configuration change history from audit log (system settings, feature flags, profiles, safe mode).
            </p>
          </div>
        </div>
        <Button variant="secondary" size="sm" onClick={handleExportCsv} disabled={filteredLogs.length === 0}>
          <Download className="mr-1 h-4 w-4" />
          Export CSV
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Configuration change history
          </CardTitle>
          <p className="text-sm text-admin-muted">Filter by admin, action type, setting key, or date range. Filtering is client-side.</p>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <input
              type="text"
              placeholder="Admin"
              value={filterAdmin}
              onChange={(e) => setFilterAdmin(e.target.value)}
              className="rounded-lg border border-admin-border px-3 py-2 text-sm text-gray-900 placeholder:text-admin-muted focus:border-admin-primary focus:outline-none focus:ring-1 focus:ring-admin-primary"
            />
            <select
              value={filterAction}
              onChange={(e) => setFilterAction(e.target.value)}
              className="rounded-lg border border-admin-border bg-white px-3 py-2 text-sm text-gray-900"
            >
              <option value="">All actions</option>
              {actionTypes.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
            <input
              type="text"
              placeholder="Setting key"
              value={filterSettingKey}
              onChange={(e) => setFilterSettingKey(e.target.value)}
              className="rounded-lg border border-admin-border px-3 py-2 text-sm text-gray-900 placeholder:text-admin-muted focus:border-admin-primary focus:outline-none focus:ring-1 focus:ring-admin-primary"
            />
            <input
              type="date"
              value={filterDateFrom}
              onChange={(e) => setFilterDateFrom(e.target.value)}
              className="rounded-lg border border-admin-border px-3 py-2 text-sm text-gray-900"
              title="From date"
            />
            <input
              type="date"
              value={filterDateTo}
              onChange={(e) => setFilterDateTo(e.target.value)}
              className="rounded-lg border border-admin-border px-3 py-2 text-sm text-gray-900"
              title="To date"
            />
          </div>

          {isError && (
            <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">
              {error instanceof Error ? error.message : 'Failed to load config audit log'}
            </div>
          )}

          {isLoading && (
            <div className="py-12 text-center text-admin-muted">Loading…</div>
          )}

          {!isLoading && !isError && (
            <div className="overflow-x-auto rounded-xl border border-admin-border">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 font-medium text-admin-muted">Timestamp</th>
                    <th className="px-4 py-3 font-medium text-admin-muted">Admin</th>
                    <th className="px-4 py-3 font-medium text-admin-muted">Action</th>
                    <th className="px-4 py-3 font-medium text-admin-muted">Setting Key</th>
                    <th className="px-4 py-3 font-medium text-admin-muted">Old Value</th>
                    <th className="px-4 py-3 font-medium text-admin-muted">New Value</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLogs.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-admin-muted">
                        {logs.length === 0 ? 'No config audit entries.' : 'No entries match the selected filters.'}
                      </td>
                    </tr>
                  ) : (
                    filteredLogs.map((row, i) => (
                      <tr key={i} className="border-t border-admin-border">
                        <td className="px-4 py-3 text-admin-muted text-xs">{row.timestamp ? new Date(row.timestamp).toLocaleString() : '—'}</td>
                        <td className="px-4 py-3 font-medium">{row.admin || '—'}</td>
                        <td className="px-4 py-3">{row.action || '—'}</td>
                        <td className="px-4 py-3 font-mono text-xs">{row.setting_key || '—'}</td>
                        <td className="px-4 py-3 text-admin-muted max-w-[200px] truncate" title={row.old_value}>{row.old_value || '—'}</td>
                        <td className="px-4 py-3 text-admin-muted max-w-[200px] truncate" title={row.new_value}>{row.new_value || '—'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
