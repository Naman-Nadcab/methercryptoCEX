'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';

export type ControlAction =
  | 'pause_trading'
  | 'resume_trading'
  | 'open_circuit'
  | 'close_circuit';

const LABELS: Record<ControlAction, { title: string; message: string; confirm: string }> = {
  pause_trading: {
    title: 'Pause Trading',
    message: 'This will halt all trading across the exchange. Users will not be able to place or cancel orders. Select a reason (required) and optionally add an admin note.',
    confirm: 'Pause Trading',
  },
  resume_trading: {
    title: 'Resume Trading',
    message: 'This will resume trading across the exchange. Confirm to re-enable order placement.',
    confirm: 'Resume Trading',
  },
  open_circuit: {
    title: 'Open Circuit Breaker',
    message: 'This will open the settlement circuit breaker. Confirm only if required by operations.',
    confirm: 'Open Circuit Breaker',
  },
  close_circuit: {
    title: 'Close Circuit Breaker',
    message: 'This will close the settlement circuit breaker and restore normal settlement flow.',
    confirm: 'Close Circuit Breaker',
  },
};

const HALT_REASONS = [
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'liquidity issue', label: 'Liquidity issue' },
  { value: 'risk event', label: 'Risk event' },
];

export interface TradingControlModalProps {
  open: boolean;
  action: ControlAction;
  onClose: () => void;
  onConfirm: (payload?: { reason: string; admin_note?: string }) => void | Promise<void>;
  isLoading?: boolean;
}

export function TradingControlModal({
  open,
  action,
  onClose,
  onConfirm,
  isLoading,
}: TradingControlModalProps) {
  const [reason, setReason] = useState('');
  const [adminNote, setAdminNote] = useState('');

  const isPause = action === 'pause_trading';
  const canConfirm = !isPause || reason.trim().length > 0;

  const handleConfirm = () => {
    if (isPause && !reason.trim()) return;
    if (isPause) {
      onConfirm({ reason: reason.trim(), admin_note: adminNote.trim() || undefined });
    } else {
      onConfirm();
    }
    setReason('');
    setAdminNote('');
  };

  const handleClose = () => {
    setReason('');
    setAdminNote('');
    onClose();
  };

  if (!open) return null;
  const { title, message, confirm } = LABELS[action];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={handleClose}>
      <div
        className="w-full max-w-md rounded-xl bg-admin-card p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-admin-text">{title}</h3>
        <p className="mt-2 text-sm text-admin-muted">{message}</p>
        {isPause && (
          <div className="mt-4 space-y-4">
            <div>
              <label htmlFor="halt-reason" className="block text-sm font-medium text-admin-text">
                Reason *
              </label>
              <select
                id="halt-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="mt-1 w-full rounded-lg border border-admin-border bg-admin-card px-3 py-2 text-sm focus:ring-2 focus:ring-admin-primary"
              >
                <option value="">Select reason</option>
                {HALT_REASONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="halt-note" className="block text-sm font-medium text-admin-text">
                Admin note (optional)
              </label>
              <textarea
                id="halt-note"
                value={adminNote}
                onChange={(e) => setAdminNote(e.target.value)}
                rows={2}
                className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2 text-sm focus:ring-2 focus:ring-admin-primary"
                placeholder="Optional note for audit"
              />
            </div>
          </div>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={handleClose}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={isLoading || !canConfirm}>
            {isLoading ? 'Processing…' : confirm}
          </Button>
        </div>
      </div>
    </div>
  );
}
