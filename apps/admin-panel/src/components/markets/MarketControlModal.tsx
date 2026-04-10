'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import type { MarketRow } from '@/lib/markets-api';

export type MarketControlAction = 'enable' | 'disable' | 'pause' | 'resume';

const LABELS: Record<MarketControlAction, { title: string; message: string; confirm: string }> = {
  enable: {
    title: 'Enable Market',
    message: 'This market will be enabled for trading. Users will be able to place and cancel orders.',
    confirm: 'Enable Market',
  },
  disable: {
    title: 'Disable Market',
    message: 'This market will be disabled. Users will not be able to place new orders.',
    confirm: 'Disable Market',
  },
  pause: {
    title: 'Pause Trading',
    message: 'Trading for this market will be paused temporarily. Open orders remain; new orders are blocked. Select a reason (required) and optionally add an admin note.',
    confirm: 'Pause Trading',
  },
  resume: {
    title: 'Resume Trading',
    message: 'Trading for this market will resume. Users can place and cancel orders again.',
    confirm: 'Resume Trading',
  },
};

const PAUSE_REASONS = [
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'liquidity issue', label: 'Liquidity issue' },
  { value: 'security event', label: 'Security event' },
  { value: 'system upgrade', label: 'System upgrade' },
];

export interface MarketControlModalProps {
  open: boolean;
  action: MarketControlAction;
  market: MarketRow | null;
  onClose: () => void;
  onConfirm: (payload?: { reason: string; admin_note?: string }) => void | Promise<void>;
  isLoading?: boolean;
}

export function MarketControlModal({
  open,
  action,
  market,
  onClose,
  onConfirm,
  isLoading,
}: MarketControlModalProps) {
  const [reason, setReason] = useState('');
  const [adminNote, setAdminNote] = useState('');

  const MIN_PAUSE_REASON = 8;
  const isPause = action === 'pause';
  const canConfirm = !isPause || reason.trim().length >= MIN_PAUSE_REASON;

  const handleConfirm = () => {
    if (isPause && reason.trim().length < MIN_PAUSE_REASON) return;
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
  const symbol = market?.base_asset && market?.quote_asset
    ? `${market.base_asset}/${market.quote_asset}`
    : (market?.symbol ?? '').replace(/_/g, '/');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={handleClose}>
      <div
        className="w-full max-w-md rounded-xl bg-admin-card p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-admin-text">{title}</h3>
        {symbol && (
          <p className="mt-1 text-sm font-medium text-admin-muted">Market: {symbol}</p>
        )}
        <p className="mt-2 text-sm text-admin-muted">{message}</p>
        {isPause && (
          <div className="mt-4 space-y-4">
            <div>
              <label htmlFor="market-halt-reason" className="block text-sm font-medium text-admin-text">
                Reason *
              </label>
              <select
                id="market-halt-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="mt-1 w-full rounded-lg border border-admin-border bg-admin-card px-3 py-2 text-sm focus:ring-2 focus:ring-admin-primary"
              >
                <option value="">Select reason</option>
                {PAUSE_REASONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="market-halt-note" className="block text-sm font-medium text-admin-text">
                Admin note (optional)
              </label>
              <textarea
                id="market-halt-note"
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
