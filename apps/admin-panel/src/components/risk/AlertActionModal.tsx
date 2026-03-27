'use client';

import { useState } from 'react';
import type { AmlAlertRow } from '@/lib/risk-api';
import { Button } from '@/components/ui/Button';

export type AlertActionType = 'review' | 'close' | 'escalate' | 'freeze';

export interface AlertActionModalProps {
  open: boolean;
  action: AlertActionType;
  alert: AmlAlertRow | null;
  onClose: () => void;
  onConfirm: (payload: { note?: string; reason?: string }) => void;
  isLoading?: boolean;
}

const TITLES: Record<AlertActionType, string> = {
  review: 'Review Alert',
  close: 'Close Alert',
  escalate: 'Escalate to STR',
  freeze: 'Freeze Account',
};

const MESSAGES: Record<AlertActionType, string> = {
  review: 'Set alert status to "Reviewing" and add an optional note.',
  close: 'Close this alert. Add an optional note for the audit trail.',
  escalate: 'Escalate this alert to a Suspicious Transaction Report (STR). This action is logged.',
  freeze: 'Suspend the user account associated with this alert. Optionally provide a reason.',
};

export function AlertActionModal({
  open,
  action,
  alert,
  onClose,
  onConfirm,
  isLoading = false,
}: AlertActionModalProps) {
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (action === 'freeze') onConfirm({ reason: reason.trim() || undefined });
    else onConfirm({ note: note.trim() || undefined });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-gray-900">{TITLES[action]}</h2>
        {alert && (
          <p className="mt-1 text-sm text-admin-muted">
            Alert: {alert.alert_type} — {alert.user_email ?? alert.user_id}
          </p>
        )}
        <p className="mt-2 text-sm text-gray-600">{MESSAGES[action]}</p>
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {(action === 'review' || action === 'close') && (
            <div>
              <label className="block text-sm font-medium text-gray-700">Note (optional)</label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                placeholder="Admin note for audit"
              />
            </div>
          )}
          {action === 'freeze' && (
            <div>
              <label className="block text-sm font-medium text-gray-700">Reason (optional)</label>
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                placeholder="e.g. AML freeze from alert"
              />
            </div>
          )}
          <div className="flex gap-2 pt-2">
            <Button type="submit" disabled={isLoading}>
              {isLoading ? 'Processing…' : 'Confirm'}
            </Button>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
