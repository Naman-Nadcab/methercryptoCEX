'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Eye, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DataTable } from '@/components/admin/security/DataTable';
import { AuditLogDetailDialog } from './audit-log-detail-dialog';
import { formatDateTime } from '@/lib/utils';
import {
  securityApi,
  type AuditLogRecord,
} from '@/lib/securityApi';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 50;
const TRUNCATE_ID = 12;
const TRUNCATE_UA = 36;

const ACTOR_TYPE_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'user', label: 'User' },
  { value: 'admin', label: 'Admin' },
  { value: 'system', label: 'System' },
];

function truncate(str: string | null, max: number): string {
  if (!str) return '—';
  if (str.length <= max) return str;
  return `${str.slice(0, max)}…`;
}

function ActorTypeBadge({ type }: { type: string }) {
  const styles = {
    user: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
    admin: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
    system: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300',
  };
  return (
    <span
      className={cn(
        'inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize',
        styles[type as keyof typeof styles] ?? 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400'
      )}
    >
      {type}
    </span>
  );
}

export default function AuditLogsPage() {
  const [actorType, setActorType] = useState<string>('all');
  const [actorId, setActorId] = useState('');
  const [action, setAction] = useState('');
  const [resourceType, setResourceType] = useState('');
  const [offset, setOffset] = useState(0);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<AuditLogRecord | null>(null);

  const actorTypeParam =
    actorType === 'all' ? undefined : (actorType as 'user' | 'admin' | 'system');

  const hasFilters =
    actorType !== 'all' ||
    actorId.trim() !== '' ||
    action.trim() !== '' ||
    resourceType.trim() !== '';

  const { data, isLoading, isError, error } = useQuery({
    queryKey: [
      'admin',
      'security',
      'audit-logs',
      actorTypeParam ?? null,
      actorId.trim() || null,
      action.trim() || null,
      resourceType.trim() || null,
      offset,
    ],
    queryFn: () =>
      securityApi.auditLogs({
        actorType: actorTypeParam,
        actorId: actorId.trim() || undefined,
        action: action.trim() || undefined,
        resourceType: resourceType.trim() || undefined,
        limit: PAGE_SIZE,
        offset,
      }),
  });

  const clearFilters = () => {
    setActorType('all');
    setActorId('');
    setAction('');
    setResourceType('');
    setOffset(0);
  };

  const logs = data?.audit_logs ?? [];
  const total = data?.total ?? 0;

  const columns = useMemo(
    () => [
      {
        id: 'created_at',
        header: 'Timestamp',
        cell: (row: AuditLogRecord) => (
          <span className="text-slate-700 dark:text-slate-300 whitespace-nowrap">
            {formatDateTime(row.created_at)}
          </span>
        ),
      },
      {
        id: 'actor_type',
        header: 'Actor type',
        cell: (row: AuditLogRecord) => (
          <ActorTypeBadge type={row.actor_type} />
        ),
      },
      {
        id: 'actor_id',
        header: 'Actor ID',
        cell: (row: AuditLogRecord) => (
          <span className="font-mono text-xs" title={row.actor_id ?? ''}>
            {truncate(row.actor_id, TRUNCATE_ID)}
          </span>
        ),
      },
      {
        id: 'action',
        header: 'Action',
        cell: (row: AuditLogRecord) => (
          <span className="font-medium">{row.action}</span>
        ),
      },
      {
        id: 'resource_type',
        header: 'Resource type',
        cell: (row: AuditLogRecord) => (
          <span>{row.resource_type ?? '—'}</span>
        ),
      },
      {
        id: 'ip_address',
        header: 'IP address',
        cell: (row: AuditLogRecord) => (
          <span className="font-mono text-xs">{row.ip_address ?? '—'}</span>
        ),
      },
      {
        id: 'user_agent',
        header: 'User agent',
        cell: (row: AuditLogRecord) => (
          <span
            className="block max-w-[160px] truncate text-slate-600 dark:text-slate-400"
            title={row.user_agent ?? ''}
          >
            {truncate(row.user_agent, TRUNCATE_UA)}
          </span>
        ),
      },
      {
        id: 'actions',
        header: 'Actions',
        className: 'text-right',
        cell: (row: AuditLogRecord) => (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={(e) => {
              e.stopPropagation();
              setSelectedRecord(row);
              setDetailOpen(true);
            }}
            title="View details"
          >
            <Eye className="h-4 w-4" />
          </Button>
        ),
      },
    ],
    []
  );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">
          Audit Logs
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Immutable security and system activity records
        </p>
      </header>

      <div className="flex flex-wrap items-end gap-4">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
            Actor type
          </label>
          <Select value={actorType} onValueChange={(v) => { setActorType(v); setOffset(0); }}>
            <SelectTrigger className="w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ACTOR_TYPE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
            Actor ID
          </label>
          <Input
            placeholder="UUID"
            className="w-48 font-mono text-sm"
            value={actorId}
            onChange={(e) => { setActorId(e.target.value); setOffset(0); }}
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
            Action
          </label>
          <Input
            placeholder="e.g. admin_login"
            className="w-40 text-sm"
            value={action}
            onChange={(e) => { setAction(e.target.value); setOffset(0); }}
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
            Resource type
          </label>
          <Input
            placeholder="e.g. withdrawal"
            className="w-36 text-sm"
            value={resourceType}
            onChange={(e) => { setResourceType(e.target.value); setOffset(0); }}
          />
        </div>
        {hasFilters && (
          <Button variant="outline" size="sm" onClick={clearFilters}>
            <X className="mr-1.5 h-4 w-4" />
            Clear filters
          </Button>
        )}
      </div>

      {isError && (
        <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-800 dark:text-red-200">
          {error instanceof Error ? error.message : 'Failed to load audit logs'}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 py-12">
          <Loader2 className="h-5 w-5 animate-spin text-slate-500" />
          <span className="text-sm text-slate-500">Loading audit logs…</span>
        </div>
      ) : (
        <>
          <DataTable<AuditLogRecord>
            columns={columns}
            data={logs}
            keyExtractor={(row) => row.id}
            emptyMessage="No audit logs found"
          />
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Showing {logs.length} of {total} log{total !== 1 ? 's' : ''}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
                disabled={offset === 0}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setOffset((o) => o + PAGE_SIZE)}
                disabled={offset + logs.length >= total}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}

      <AuditLogDetailDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        record={selectedRecord}
      />
    </div>
  );
}
