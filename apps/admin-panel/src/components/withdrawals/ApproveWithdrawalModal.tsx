'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';

export interface ApproveWithdrawalModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (adminNote: string) => void | Promise<void>;
  withdrawalId: string;
  asset?: string;
  amount?: string;
  isLoading?: boolean;
}

export function ApproveWithdrawalModal({
  open,
  onClose,
  onConfirm,
  withdrawalId,
  asset,
  amount,
  isLoading,
}: ApproveWithdrawalModalProps) {
  const [adminNote, setAdminNote] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onConfirm(adminNote);
    setAdminNote('');
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-gray-900">Approve Withdrawal</h3>
        <p className="mt-1 text-sm text-admin-muted">
          ID: {withdrawalId}
          {asset != null && amount != null && (
            <> · {asset} {amount}</>
          )}
        </p>
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label htmlFor="approve-note" className="block text-sm font-medium text-gray-700">
              Admin note (optional)
            </label>
            <textarea
              id="approve-note"
              value={adminNote}
              onChange={(e) => setAdminNote(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2 text-sm focus:ring-2 focus:ring-admin-primary"
              placeholder="Optional note for audit..."
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? 'Approving…' : 'Confirm approval'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
