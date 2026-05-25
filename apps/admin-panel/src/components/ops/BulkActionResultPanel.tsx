'use client';

import { cn } from '@/lib/cn';

type FailureItem = {
  id: string;
  code: string;
  message: string;
};

type KycBulkResult = {
  kind: 'kyc';
  action: 'approve' | 'reject';
  updated: number;
  ids: string[];
};

type GenericBulkResult = {
  kind: 'generic';
  actionLabel: string;
  successCount: number;
  failed: FailureItem[];
};

export type BulkActionResult = KycBulkResult | GenericBulkResult;

export function BulkActionResultPanel({
  result,
  onDismiss,
}: {
  result: BulkActionResult | null;
  onDismiss: () => void;
}) {
  if (!result) return null;

  const isDanger = result.kind === 'kyc'
    ? result.action === 'reject'
    : result.actionLabel.toLowerCase().includes('reject');

  return (
    <div
      className={cn(
        'w-full rounded-xl border px-3 py-2 text-xs',
        isDanger
          ? 'border-red-500/30 bg-red-950/10 text-red-300'
          : 'border-emerald-500/30 bg-emerald-950/10 text-emerald-300'
      )}
    >
      <div className="flex items-center justify-between gap-2">
        {result.kind === 'kyc' ? (
          <span>
            Bulk {result.action === 'reject' ? 'rejection' : 'approval'} completed: {result.updated} submission(s) updated.
          </span>
        ) : (
          <span>
            {result.actionLabel} completed: {result.successCount} success, {result.failed.length} failed.
          </span>
        )}
        <button
          type="button"
          onClick={onDismiss}
          className="rounded border border-admin-border/40 px-1.5 py-0.5 text-[10px] text-admin-muted hover:text-admin-text"
        >
          Dismiss
        </button>
      </div>

      {result.kind === 'kyc' && result.ids.length > 0 && (
        <p className="mt-1 text-[11px] text-admin-muted">
          Updated IDs: {result.ids.slice(0, 8).join(', ')}{result.ids.length > 8 ? ` +${result.ids.length - 8} more` : ''}
        </p>
      )}

      {result.kind === 'generic' && result.failed.length > 0 && (
        <div className="mt-1 max-h-24 overflow-y-auto rounded border border-admin-border/30 bg-black/10 p-1.5 text-[11px] text-admin-muted">
          {result.failed.slice(0, 8).map((f) => (
            <p key={f.id}>
              {f.id}: {f.code} - {f.message}
            </p>
          ))}
          {result.failed.length > 8 && (
            <p>+{result.failed.length - 8} more failures</p>
          )}
        </div>
      )}
    </div>
  );
}
