'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/auth';
import { adminFetch } from '@/lib/api';
import { Badge } from '@/components/ui/Badge';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { Button } from '@/components/ui/Button';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { ProtectedAction } from '@/components/rbac/ProtectedAction';
import { usePermission } from '@/hooks/usePermission';
import { AdminPageFrame } from '@/components/admin-shell/AdminPageFrame';
import { ActionAuthModal, type ActionAuthPayload } from '@/components/ops/ActionAuthModal';
import {
  Database, Download, RotateCcw, Plus, AlertTriangle, ShieldAlert,
} from 'lucide-react';

interface BackupRow {
  id: string;
  type: string;
  sizeBytes: number | null;
  status: string;
  createdAt: string;
  path?: string;
}

function formatBytes(bytes: number | null): string {
  if (bytes == null || bytes === 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

const STATUS_MAP: Record<string, { variant: 'success' | 'warning' | 'danger' | 'default' | 'info'; label: string }> = {
  completed: { variant: 'success', label: 'Completed' },
  pending:   { variant: 'warning', label: 'In Progress' },
  failed:    { variant: 'danger',  label: 'Failed' },
  restoring: { variant: 'info',    label: 'Restoring' },
};

export default function BackupsPage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  const { isSuper } = usePermission();

  const [restoreTarget, setRestoreTarget] = useState<BackupRow | null>(null);
  const [createAuthOpen, setCreateAuthOpen] = useState(false);
  const [restoreAuthOpen, setRestoreAuthOpen] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin', 'backups', token],
    staleTime: 30_000,
    queryFn: () =>
      adminFetch<{ backups: BackupRow[] }>('/operational/backups', { token }),
    enabled: !!token,
    refetchInterval: 30_000,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      adminFetch<{ id: string; status: string; message: string }>('/operational/backups/create', {
        method: 'POST',
        token,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'backups'] });
    },
  });

  const restoreMutation = useMutation({
    mutationFn: (id: string) =>
      adminFetch<{ message: string }>(`/operational/backups/${id}/restore`, {
        method: 'POST',
        token,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'backups'] });
      setRestoreTarget(null);
    },
  });

  const backups = data?.data?.backups ?? [];

  if (!isSuper) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-lg font-semibold text-admin-text">Database Backups</h1>
          <p className="text-xs text-admin-muted mt-0.5">Manage database snapshots and restores.</p>
        </div>
        <div className="rounded-xl border border-admin-border bg-admin-card flex flex-col items-center justify-center py-16 text-admin-muted">
          <ShieldAlert className="h-8 w-8 mb-2 opacity-40" />
          <p className="text-sm font-medium">Access Denied</p>
          <p className="text-xs mt-0.5 opacity-70">Only Super Admins can access database backup management.</p>
        </div>
      </div>
    );
  }

  return (
    <AdminPageFrame
      title="Database Backups"
      description="Manage database snapshots and restores. Super admin only."
      error={isError ? 'Failed to load backup history.' : null}
      onRetry={isError ? () => { void refetch(); } : undefined}
      quickActions={
        <ProtectedAction permission="all" fallback="disabled">
          <Button
            size="sm"
            icon={<Plus className="h-3.5 w-3.5" />}
            loading={createMutation.isPending}
            onClick={() => setCreateAuthOpen(true)}
          >
            Create Backup
          </Button>
        </ProtectedAction>
      }
    >
      {/* KPI strip */}
      {backups.length > 0 && (() => {
        const completed = backups.filter((b) => b.status === 'completed');
        const failed = backups.filter((b) => b.status === 'failed');
        const totalBytes = completed.reduce((sum, b) => sum + (b.sizeBytes ?? 0), 0);
        const latest = completed[0];
        return (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: 'Total Backups', value: String(backups.length), color: 'text-admin-text' },
              { label: 'Completed', value: String(completed.length), color: 'text-emerald-400' },
              { label: 'Failed', value: String(failed.length), color: failed.length > 0 ? 'text-red-400' : 'text-admin-muted' },
              { label: 'Latest', value: latest ? formatDate(latest.createdAt) : '—', color: 'text-admin-text' },
              { label: 'Storage Used', value: formatBytes(totalBytes), color: 'text-blue-400' },
            ].slice(0, 4).map((k) => (
              <div key={k.label} className="rounded-xl border border-admin-border bg-admin-card px-4 py-3">
                <p className="text-xs text-admin-muted">{k.label}</p>
                <p className={`mt-1 text-lg font-semibold tabular-nums ${k.color}`}>{k.value}</p>
              </div>
            ))}
          </div>
        );
      })()}

      {createMutation.isSuccess && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/20 px-4 py-2.5 text-xs text-emerald-400 flex items-center gap-2">
          <Download className="h-3.5 w-3.5" />
          Backup initiated successfully. It will appear in the list below once complete.
        </div>
      )}

      {createMutation.isError && (
        <div className="rounded-lg border border-red-500/30 bg-red-950/20 px-4 py-2.5 text-xs text-red-400 flex items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5" />
          Failed to create backup. Please try again.
        </div>
      )}

      <div className="rounded-xl border border-admin-border bg-admin-card">
        {isError && (
          <div className="px-4 py-3 text-sm text-admin-danger flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" /> Failed to load backup history.
          </div>
        )}

        {isLoading ? (
          <TableSkeleton rows={4} cols={5} />
        ) : backups.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-admin-muted">
            <Database className="h-8 w-8 mb-2 opacity-40" />
            <p className="text-sm font-medium">No backups yet</p>
            <p className="text-xs mt-0.5 opacity-70">
              Create your first database backup using the button above.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-admin-border text-[11px] font-semibold uppercase tracking-wider text-admin-muted">
                  <th className="px-4 py-3">ID</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Size</th>
                  <th className="px-4 py-3">Created</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-admin-border">
                {backups.map((b) => {
                  const status = STATUS_MAP[b.status] ?? { variant: 'default' as const, label: b.status };
                  return (
                    <tr key={b.id} className="hover:bg-white/5 transition-colors">
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs text-admin-text">{b.id.slice(0, 8)}</span>
                      </td>
                      <td className="px-4 py-3 text-xs text-admin-text capitalize">{b.type}</td>
                      <td className="px-4 py-3">
                        <Badge variant={status.variant}>{status.label}</Badge>
                      </td>
                      <td className="px-4 py-3 text-xs text-admin-muted">{formatBytes(b.sizeBytes)}</td>
                      <td className="px-4 py-3 text-xs text-admin-muted whitespace-nowrap">
                        {formatDate(b.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <ProtectedAction permission="all" fallback="disabled">
                          <Button
                            size="xs"
                            variant="outline"
                            icon={<RotateCcw className="h-3 w-3" />}
                            disabled={b.status !== 'completed'}
                            onClick={() => setRestoreTarget(b)}
                          >
                            Restore
                          </Button>
                        </ProtectedAction>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Restore Confirmation Modal */}
      <Modal
        open={!!restoreTarget}
        onClose={() => setRestoreTarget(null)}
        size="sm"
        title="Request Database Restore"
        description={`Restore from backup ${restoreTarget?.id.slice(0, 8) ?? ''} created on ${restoreTarget ? formatDate(restoreTarget.createdAt) : ''}.`}
      >
        <div className="rounded-lg border border-amber-500/30 bg-amber-950/20 px-3 py-2.5 text-xs text-amber-400 mb-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              This will submit a restore request that requires manual intervention from the infrastructure team.
              The database will not be restored automatically.
            </span>
          </div>
        </div>

        {restoreMutation.isError && (
          <div className="rounded-lg border border-red-500/30 bg-red-950/20 p-2 text-xs text-red-400 mb-4">
            Failed to submit restore request. Please try again.
          </div>
        )}

        <ModalFooter className="px-0 border-0 mt-2 pt-0">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setRestoreTarget(null)}
            disabled={restoreMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            size="sm"
            loading={restoreMutation.isPending}
            icon={<RotateCcw className="h-3.5 w-3.5" />}
            onClick={() => setRestoreAuthOpen(true)}
          >
            Request Restore
          </Button>
        </ModalFooter>
      </Modal>
      <ActionAuthModal
        open={createAuthOpen}
        onClose={() => setCreateAuthOpen(false)}
        onConfirm={(payload: ActionAuthPayload) => {
          void payload;
          createMutation.mutate();
          setCreateAuthOpen(false);
        }}
        title="Authorize backup creation"
        actionLabel="Create new database backup snapshot"
        description="Backup operations are sensitive and are audited for compliance."
        requireReason
        twofaRequired
        confirmationPhrase="CONFIRM BACKUP_CREATE"
        externalError={createMutation.error instanceof Error ? createMutation.error.message : null}
        isPending={createMutation.isPending}
        confirmLabel={createMutation.isPending ? 'Creating…' : 'Create backup'}
        confirmVariant="primary"
      />
      <ActionAuthModal
        open={restoreAuthOpen}
        onClose={() => setRestoreAuthOpen(false)}
        onConfirm={(payload: ActionAuthPayload) => {
          void payload;
          if (restoreTarget) {
            restoreMutation.mutate(restoreTarget.id);
          }
          setRestoreAuthOpen(false);
        }}
        title="Authorize restore request"
        actionLabel={restoreTarget ? `Request restore from backup ${restoreTarget.id.slice(0, 8)}` : 'Request database restore'}
        description="Restore requests are high-impact and require explicit approval."
        requireReason
        twofaRequired
        confirmationPhrase="CONFIRM BACKUP_RESTORE"
        externalError={restoreMutation.error instanceof Error ? restoreMutation.error.message : null}
        isPending={restoreMutation.isPending}
        confirmLabel={restoreMutation.isPending ? 'Submitting…' : 'Submit restore request'}
        confirmVariant="danger"
      />
    </AdminPageFrame>
  );
}
