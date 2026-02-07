'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { formatDateTime } from '@/lib/utils';
import type { AuditLogRecord } from '@/lib/securityApi';

function formatJsonValue(value: string | null): string {
  if (value == null || value === '') return '—';
  try {
    const parsed = JSON.parse(value) as unknown;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return value;
  }
}

export interface AuditLogDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  record: AuditLogRecord | null;
}

export function AuditLogDetailDialog({
  open,
  onOpenChange,
  record,
}: AuditLogDetailDialogProps) {
  if (!record) return null;

  const oldFormatted = formatJsonValue(record.old_value);
  const newFormatted = formatJsonValue(record.new_value);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Audit log details</DialogTitle>
        </DialogHeader>
        <div className="space-y-6 text-sm">
          <section>
            <h3 className="mb-2 font-semibold text-slate-900 dark:text-white">
              Metadata
            </h3>
            <dl className="grid grid-cols-[120px_1fr] gap-x-4 gap-y-1.5">
              <dt className="text-slate-500 dark:text-slate-400">Timestamp</dt>
              <dd className="font-mono">{formatDateTime(record.created_at)}</dd>
              <dt className="text-slate-500 dark:text-slate-400">Request ID</dt>
              <dd className="font-mono">{record.request_id ?? '—'}</dd>
              <dt className="text-slate-500 dark:text-slate-400">Actor type</dt>
              <dd>{record.actor_type}</dd>
              <dt className="text-slate-500 dark:text-slate-400">Actor ID</dt>
              <dd className="font-mono break-all">{record.actor_id ?? '—'}</dd>
              <dt className="text-slate-500 dark:text-slate-400">IP address</dt>
              <dd className="font-mono">{record.ip_address ?? '—'}</dd>
              <dt className="text-slate-500 dark:text-slate-400">User agent</dt>
              <dd className="break-words text-slate-700 dark:text-slate-300">
                {record.user_agent ?? '—'}
              </dd>
            </dl>
          </section>

          <section>
            <h3 className="mb-2 font-semibold text-slate-900 dark:text-white">
              Action details
            </h3>
            <dl className="grid grid-cols-[120px_1fr] gap-x-4 gap-y-1.5">
              <dt className="text-slate-500 dark:text-slate-400">Action</dt>
              <dd className="font-medium">{record.action}</dd>
              <dt className="text-slate-500 dark:text-slate-400">Resource type</dt>
              <dd>{record.resource_type ?? '—'}</dd>
              <dt className="text-slate-500 dark:text-slate-400">Resource ID</dt>
              <dd className="font-mono break-all">{record.resource_id ?? '—'}</dd>
            </dl>
          </section>

          <section>
            <h3 className="mb-2 font-semibold text-slate-900 dark:text-white">
              Data changes
            </h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="mb-1 text-xs font-medium uppercase text-slate-500 dark:text-slate-400">
                  Old value
                </p>
                <pre className="max-h-48 overflow-auto rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 p-3 font-mono text-xs whitespace-pre-wrap break-all">
                  {oldFormatted}
                </pre>
              </div>
              <div>
                <p className="mb-1 text-xs font-medium uppercase text-slate-500 dark:text-slate-400">
                  New value
                </p>
                <pre className="max-h-48 overflow-auto rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 p-3 font-mono text-xs whitespace-pre-wrap break-all">
                  {newFormatted}
                </pre>
              </div>
            </div>
          </section>
        </div>
        <div className="mt-4 flex justify-end border-t pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
