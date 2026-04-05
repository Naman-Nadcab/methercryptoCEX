'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';

export interface ManualCreditModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (payload: { amount: string; currency: string; reason?: string; tx_hash?: string }) => void | Promise<void>;
  userEmail?: string;
  userId?: string;
  defaultAsset?: string;
  defaultAmount?: string;
  txHash?: string | null;
  isDuplicate?: boolean;
  isLoading?: boolean;
  submitError?: string | null;
}

export function ManualCreditModal({
  open,
  onClose,
  onConfirm,
  userEmail,
  userId,
  defaultAsset = '',
  defaultAmount = '',
  txHash,
  isDuplicate,
  isLoading,
  submitError,
}: ManualCreditModalProps) {
  const [amount, setAmount] = useState(defaultAmount);
  const [currency, setCurrency] = useState(defaultAsset);
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!confirmed || isDuplicate) return;
    const user = userEmail ?? (userId ? String(userId) : '');
    if (!user || !currency.trim() || !amount.trim()) return;
    await onConfirm({
      amount: amount.trim(),
      currency: currency.trim(),
      reason: reason.trim() || undefined,
      tx_hash: txHash?.trim() || undefined,
    });
    setAmount('');
    setCurrency(defaultAsset);
    setReason('');
    setConfirmed(false);
    onClose();
  };

  const handleClose = () => {
    setConfirmed(false);
    setAmount(defaultAmount);
    setCurrency(defaultAsset);
    setReason('');
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={handleClose}>
      <div
        className="w-full max-w-md rounded-xl bg-admin-card p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-admin-text">Manual Credit</h3>
        <p className="mt-1 text-sm text-admin-muted">
          Use only when the deposit indexer fails. User: {userEmail ?? (userId ? String(userId) : '—')}
        </p>
        {isDuplicate && (
          <p className="mt-2 text-sm font-medium text-admin-danger">Deposit already credited.</p>
        )}
        {submitError && (
          <p className="mt-2 text-sm font-medium text-admin-danger">{submitError}</p>
        )}
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label htmlFor="mc-amount" className="block text-sm font-medium text-admin-text">
              Amount *
            </label>
            <input
              id="mc-amount"
              type="text"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              required
              className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2 text-sm focus:ring-2 focus:ring-admin-primary"
            />
          </div>
          <div>
            <label htmlFor="mc-asset" className="block text-sm font-medium text-admin-text">
              Asset *
            </label>
            <input
              id="mc-asset"
              type="text"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              placeholder="BTC, ETH, USDT"
              required
              className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2 text-sm focus:ring-2 focus:ring-admin-primary"
            />
          </div>
          <div>
            <label htmlFor="mc-note" className="block text-sm font-medium text-admin-text">
              Admin note (optional)
            </label>
            <textarea
              id="mc-note"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2 text-sm focus:ring-2 focus:ring-admin-primary"
            />
          </div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="rounded border-admin-border text-admin-primary focus:ring-admin-primary"
            />
            <span className="text-sm text-admin-text">
              I confirm this manual credit is authorized (e.g. deposit indexer failed).
            </span>
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!confirmed || isLoading || isDuplicate}>
              {isLoading ? 'Processing…' : 'Confirm'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
