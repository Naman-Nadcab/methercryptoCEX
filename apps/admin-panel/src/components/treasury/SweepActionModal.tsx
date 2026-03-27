'use client';

import { Button } from '@/components/ui/Button';
import type { SweepRow } from '@/lib/treasury-api';

export type SweepActionType = 'run' | 'retry';

const LABELS: Record<SweepActionType, { title: string; message: string; confirm: string }> = {
  run: {
    title: 'Run Sweep',
    message: 'This will trigger the deposit sweep job to consolidate user deposits into hot wallets. Continue?',
    confirm: 'Run Sweep',
  },
  retry: {
    title: 'Retry Sweep',
    message: 'This will reset the failed sweep to pending and trigger the sweep job. Continue?',
    confirm: 'Retry Sweep',
  },
};

export interface SweepActionModalProps {
  open: boolean;
  action: SweepActionType;
  sweep?: SweepRow | null;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  isLoading?: boolean;
}

export function SweepActionModal({
  open,
  action,
  sweep,
  onClose,
  onConfirm,
  isLoading,
}: SweepActionModalProps) {
  if (!open) return null;
  const { title, message, confirm } = LABELS[action];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        {action === 'retry' && sweep && (
          <p className="mt-1 text-sm text-admin-muted">
            Sweep ID: {String(sweep.id).slice(0, 8)}…
          </p>
        )}
        <p className="mt-2 text-sm text-admin-muted">{message}</p>
        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={isLoading}>
            {isLoading ? 'Processing…' : confirm}
          </Button>
        </div>
      </div>
    </div>
  );
}
