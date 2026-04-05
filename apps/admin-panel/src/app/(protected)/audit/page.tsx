'use client';

import { useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/auth';
import { getAuditActivityLogs, getImmutableAuditLogs, type AuditActivityLog, type ImmutableAuditLog } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Tabs, type TabItem } from '@/components/ui/Tabs';
import { RoleBadge } from '@/components/rbac/ProtectedAction';
import {
  Search, Download, ChevronDown, ChevronRight, Clock,
  Shield, FileText, Activity, AlertTriangle, Filter,
  User, Globe, Monitor, RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/cn';

type AuditTab = 'activity' | 'immutable';

const TABS: TabItem<AuditTab>[] = [
  { id: 'activity', label: 'Admin Activity', icon: <Activity className="h-3.5 w-3.5" /> },
  { id: 'immutable', label: 'Immutable Audit Log', icon: <Shield className="h-3.5 w-3.5" /> },
];

export default function AuditPage() {
  const [activeTab, setActiveTab] = useState<AuditTab>('activity');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-admin-text">Audit Logs</h1>
          <p className="text-xs text-admin-muted mt-0.5">Track every admin action for compliance and accountability.</p>
        </div>
      </div>

      <Tabs items={TABS} active={activeTab} onChange={setActiveTab} />

      {activeTab === 'activity' ? <ActivityLogSection /> : <ImmutableLogSection />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Admin Activity Logs                                                */
/* ------------------------------------------------------------------ */

function ActivityLogSection() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const [search, setSearch] = useState('');
  const [filterAction, setFilterAction] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [page, setPage] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const limit = 50;

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin', 'audit', 'activity', token, search, filterAction, filterDateFrom, filterDateTo, page],
    queryFn: () => getAuditActivityLogs(token, {
      search: search || undefined,
      action: filterAction || undefined,
      dateFrom: filterDateFrom || undefined,
      dateTo: filterDateTo || undefined,
      limit,
      offset: page * limit,
    }),
    enabled: !!token,
    staleTime: 30_000,
  });

  const logs = data?.data?.logs ?? [];
  const total = data?.data?.total ?? 0;
  const totalPages = Math.ceil(total / limit);

  const handleExport = useCallback(() => {
    const header = 'Timestamp,Admin,Role,Action,IP Address,Details';
    const rows = logs.map((r) =>
      [
        r.createdAt,
        csvEscape(r.adminName),
        csvEscape(r.adminRole),
        csvEscape(r.action),
        r.ipAddress ?? '',
        csvEscape(JSON.stringify(r.details ?? {})),
      ].join(',')
    );
    downloadCsv([header, ...rows].join('\n'), 'admin-activity-audit');
  }, [logs]);

  return (
    <Card>
      <CardHeader actions={
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => refetch()} icon={<RefreshCw className="h-3.5 w-3.5" />}>
            Refresh
          </Button>
          <Button variant="secondary" size="sm" onClick={handleExport} icon={<Download className="h-3.5 w-3.5" />}>
            Export CSV
          </Button>
        </div>
      }>
        <CardTitle>Admin Activity</CardTitle>
      </CardHeader>
      <CardContent>
        {/* Filters */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
          <Input
            placeholder="Search actions, details…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            iconLeft={<Search className="h-3.5 w-3.5" />}
          />
          <Input
            placeholder="Filter by action"
            value={filterAction}
            onChange={(e) => { setFilterAction(e.target.value); setPage(0); }}
            iconLeft={<Filter className="h-3.5 w-3.5" />}
          />
          <Input
            type="date"
            value={filterDateFrom}
            onChange={(e) => { setFilterDateFrom(e.target.value); setPage(0); }}
            label="From"
          />
          <Input
            type="date"
            value={filterDateTo}
            onChange={(e) => { setFilterDateTo(e.target.value); setPage(0); }}
            label="To"
          />
        </div>

        {/* Table */}
        <div className="overflow-x-auto rounded-ds-md border border-admin-border">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-white/[0.02]">
              <tr>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-admin-muted uppercase tracking-wider w-8" />
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-admin-muted uppercase tracking-wider">Timestamp</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-admin-muted uppercase tracking-wider">Admin</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-admin-muted uppercase tracking-wider">Action</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-admin-muted uppercase tracking-wider">IP Address</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-admin-border">
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={5} className="px-4 py-3"><div className="h-4 bg-white/5 rounded animate-pulse" /></td>
                  </tr>
                ))
              ) : isError ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-admin-danger text-xs">Failed to load audit logs</td></tr>
              ) : logs.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-admin-muted text-xs">No activity logs found</td></tr>
              ) : (
                logs.map((log) => (
                  <ActivityRow key={log.id} log={log} expanded={expandedId === log.id} onToggle={() => setExpandedId((id) => id === log.id ? null : log.id)} />
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-3 text-xs text-admin-muted">
            <span>Showing {page * limit + 1}–{Math.min((page + 1) * limit, total)} of {total}</span>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="xs" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Prev</Button>
              <span className="px-2">Page {page + 1} of {totalPages}</span>
              <Button variant="ghost" size="xs" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ActivityRow({ log, expanded, onToggle }: { log: AuditActivityLog; expanded: boolean; onToggle: () => void }) {
  const actionColor = getActionColor(log.action);

  return (
    <>
      <tr className={cn('hover:bg-white/5 transition-colors cursor-pointer', expanded && 'bg-white/[0.02]')} onClick={onToggle}>
        <td className="px-4 py-2.5">
          {expanded ? <ChevronDown className="h-3.5 w-3.5 text-admin-muted" /> : <ChevronRight className="h-3.5 w-3.5 text-admin-muted" />}
        </td>
        <td className="px-4 py-2.5 text-xs text-admin-muted whitespace-nowrap">
          <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{formatTimestamp(log.createdAt)}</span>
        </td>
        <td className="px-4 py-2.5">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-admin-primary/10 text-admin-primary shrink-0">
              <User className="h-3 w-3" />
            </div>
            <div>
              <p className="text-xs font-medium text-admin-text">{log.adminName}</p>
              <RoleBadge role={log.adminRole} className="mt-0.5" />
            </div>
          </div>
        </td>
        <td className="px-4 py-2.5">
          <Badge variant={actionColor} size="sm">{log.action.replace(/_/g, ' ')}</Badge>
        </td>
        <td className="px-4 py-2.5 text-xs text-admin-muted font-mono">
          {log.ipAddress ? (
            <span className="flex items-center gap-1"><Globe className="h-3 w-3" />{log.ipAddress}</span>
          ) : '—'}
        </td>
      </tr>
      {expanded && (
        <tr className="bg-white/[0.02]">
          <td colSpan={5} className="px-8 py-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div>
                <p className="font-semibold text-admin-text mb-1 flex items-center gap-1"><Monitor className="h-3 w-3" /> User Agent</p>
                <p className="text-admin-muted font-mono text-[10px] break-all">{log.userAgent ?? '—'}</p>
              </div>
              <div>
                <p className="font-semibold text-admin-text mb-1 flex items-center gap-1"><FileText className="h-3 w-3" /> Details</p>
                {log.details && Object.keys(log.details).length > 0 ? (
                  <pre className="bg-admin-card border border-admin-border rounded-md p-2 text-[10px] text-admin-text font-mono overflow-x-auto max-h-40">
                    {JSON.stringify(log.details, null, 2)}
                  </pre>
                ) : (
                  <p className="text-admin-muted">No additional details</p>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Immutable Audit Logs                                               */
/* ------------------------------------------------------------------ */

function ImmutableLogSection() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const [filterActorType, setFilterActorType] = useState('');
  const [filterAction, setFilterAction] = useState('');
  const [page, setPage] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const limit = 50;

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin', 'audit', 'immutable', token, filterActorType, filterAction, page],
    queryFn: () => getImmutableAuditLogs(token, {
      actorType: filterActorType || undefined,
      action: filterAction || undefined,
      limit,
      offset: page * limit,
    }),
    enabled: !!token,
    staleTime: 30_000,
  });

  const logs = data?.data?.audit_logs ?? [];
  const total = data?.data?.total ?? 0;
  const totalPages = Math.ceil(total / limit);

  const handleExport = useCallback(() => {
    const header = 'Timestamp,Actor Type,Actor ID,Action,Resource Type,Resource ID,Old Value,New Value,IP';
    const rows = logs.map((r) =>
      [
        r.created_at,
        r.actor_type,
        r.actor_id ?? '',
        csvEscape(r.action),
        r.resource_type ?? '',
        r.resource_id ?? '',
        csvEscape(r.old_value ?? ''),
        csvEscape(r.new_value ?? ''),
        r.ip_address ?? '',
      ].join(',')
    );
    downloadCsv([header, ...rows].join('\n'), 'immutable-audit');
  }, [logs]);

  return (
    <Card>
      <CardHeader actions={
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => refetch()} icon={<RefreshCw className="h-3.5 w-3.5" />}>
            Refresh
          </Button>
          <Button variant="secondary" size="sm" onClick={handleExport} icon={<Download className="h-3.5 w-3.5" />}>
            Export CSV
          </Button>
        </div>
      }>
        <CardTitle>Immutable Audit Trail</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex gap-3 mb-4">
          <select
            value={filterActorType}
            onChange={(e) => { setFilterActorType(e.target.value); setPage(0); }}
            className="rounded-ds-md border border-admin-border px-3 py-2 text-sm bg-admin-card text-admin-text"
          >
            <option value="">All Actor Types</option>
            <option value="admin">Admin</option>
            <option value="user">User</option>
            <option value="system">System</option>
          </select>
          <Input
            placeholder="Filter by action"
            value={filterAction}
            onChange={(e) => { setFilterAction(e.target.value); setPage(0); }}
            iconLeft={<Filter className="h-3.5 w-3.5" />}
          />
        </div>

        <div className="overflow-x-auto rounded-ds-md border border-admin-border">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-white/[0.02]">
              <tr>
                <th className="text-left px-3 py-2.5 text-xs font-semibold text-admin-muted uppercase tracking-wider w-8" />
                <th className="text-left px-3 py-2.5 text-xs font-semibold text-admin-muted uppercase tracking-wider">Timestamp</th>
                <th className="text-left px-3 py-2.5 text-xs font-semibold text-admin-muted uppercase tracking-wider">Actor</th>
                <th className="text-left px-3 py-2.5 text-xs font-semibold text-admin-muted uppercase tracking-wider">Action</th>
                <th className="text-left px-3 py-2.5 text-xs font-semibold text-admin-muted uppercase tracking-wider">Resource</th>
                <th className="text-left px-3 py-2.5 text-xs font-semibold text-admin-muted uppercase tracking-wider">IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-admin-border">
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}><td colSpan={6} className="px-3 py-3"><div className="h-4 bg-white/5 rounded animate-pulse" /></td></tr>
                ))
              ) : isError ? (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-admin-danger text-xs">Failed to load audit logs</td></tr>
              ) : logs.length === 0 ? (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-admin-muted text-xs">No audit logs found</td></tr>
              ) : (
                logs.map((log) => (
                  <ImmutableRow key={log.id} log={log} expanded={expandedId === log.id} onToggle={() => setExpandedId((id) => id === log.id ? null : log.id)} />
                ))
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-3 text-xs text-admin-muted">
            <span>Showing {page * limit + 1}–{Math.min((page + 1) * limit, total)} of {total}</span>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="xs" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Prev</Button>
              <span className="px-2">Page {page + 1} of {totalPages}</span>
              <Button variant="ghost" size="xs" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ImmutableRow({ log, expanded, onToggle }: { log: ImmutableAuditLog; expanded: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className={cn('hover:bg-white/5 transition-colors cursor-pointer', expanded && 'bg-white/[0.02]')} onClick={onToggle}>
        <td className="px-3 py-2.5">
          {expanded ? <ChevronDown className="h-3.5 w-3.5 text-admin-muted" /> : <ChevronRight className="h-3.5 w-3.5 text-admin-muted" />}
        </td>
        <td className="px-3 py-2.5 text-xs text-admin-muted whitespace-nowrap">{formatTimestamp(log.created_at)}</td>
        <td className="px-3 py-2.5">
          <Badge variant={log.actor_type === 'admin' ? 'primary' : log.actor_type === 'system' ? 'info' : 'default'} size="sm">
            {log.actor_type}
          </Badge>
        </td>
        <td className="px-3 py-2.5">
          <Badge variant={getActionColor(log.action)} size="sm">{log.action.replace(/_/g, ' ')}</Badge>
        </td>
        <td className="px-3 py-2.5 text-xs text-admin-muted font-mono">{log.resource_type ? `${log.resource_type}/${log.resource_id ?? ''}` : '—'}</td>
        <td className="px-3 py-2.5 text-xs text-admin-muted font-mono">{log.ip_address ?? '—'}</td>
      </tr>
      {expanded && (
        <tr className="bg-white/[0.02]">
          <td colSpan={6} className="px-8 py-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div>
                <p className="font-semibold text-admin-text mb-1">Before State</p>
                {log.old_value ? (
                  <pre className="bg-admin-card border border-admin-border rounded-md p-2 text-[10px] text-admin-text font-mono overflow-x-auto max-h-40">
                    {tryFormatJson(log.old_value)}
                  </pre>
                ) : (
                  <p className="text-admin-muted italic">No before state recorded</p>
                )}
              </div>
              <div>
                <p className="font-semibold text-admin-text mb-1">After State</p>
                {log.new_value ? (
                  <pre className="bg-admin-card border border-admin-border rounded-md p-2 text-[10px] text-admin-text font-mono overflow-x-auto max-h-40">
                    {tryFormatJson(log.new_value)}
                  </pre>
                ) : (
                  <p className="text-admin-muted italic">No after state recorded</p>
                )}
              </div>
            </div>
            <div className="mt-3 flex items-center gap-4 text-[10px] text-admin-muted">
              <span>Request ID: <span className="font-mono">{log.request_id ?? '—'}</span></span>
              <span>Actor ID: <span className="font-mono">{log.actor_id ?? '—'}</span></span>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Utilities                                                          */
/* ------------------------------------------------------------------ */

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleString('en-US', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  } catch {
    return ts;
  }
}

function getActionColor(action: string): 'danger' | 'warning' | 'success' | 'info' | 'default' {
  const a = action.toLowerCase();
  if (a.includes('emergency') || a.includes('halt') || a.includes('freeze') || a.includes('block') || a.includes('delete') || a.includes('reject')) return 'danger';
  if (a.includes('approve') || a.includes('resolve') || a.includes('create') || a.includes('activate')) return 'success';
  if (a.includes('update') || a.includes('edit') || a.includes('change') || a.includes('pause')) return 'warning';
  if (a.includes('login') || a.includes('view') || a.includes('search') || a.includes('export')) return 'info';
  return 'default';
}

function tryFormatJson(val: string): string {
  try {
    return JSON.stringify(JSON.parse(val), null, 2);
  } catch {
    return val;
  }
}

function csvEscape(s: string): string {
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadCsv(csv: string, name: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
