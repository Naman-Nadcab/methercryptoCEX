'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { ActionButton } from './control-plane';

export interface ReasonCaptureModalProps {
  open: boolean;
  title: string;
  bodyCopy: string;
  reasonLabel?: string;
  reasonPlaceholder?: string;
  requireReason?: boolean;
  confirmLabel: string;
  variant?: 'primary' | 'danger' | 'secondary';
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
  loading?: boolean;
  error?: string | null;
  /** Optional context lines shown above reason (e.g. user id, amount) */
  context?: Array<{ label: string; value: string }>;
}

/**
 * Mandatory reason capture for high-impact admin actions.
 * No action without operator justification.
 */
export function ReasonCaptureModal({
  open,
  title,
  bodyCopy,
  reasonLabel = 'Reason (required)',
  reasonPlaceholder = 'Operator justification for this action',
  requireReason = true,
  confirmLabel,
  variant = 'primary',
  onClose,
  onConfirm,
  loading = false,
  error = null,
  context = [],
}: ReasonCaptureModalProps) {
  const [reason, setReason] = useState('');

  if (!open) return null;

  const handleSubmit = () => {
    const trimmed = reason.trim();
    if (requireReason && !trimmed) return;
    onConfirm(trimmed).then(() => {
      setReason('');
      onClose();
    }).catch(() => {});
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reason-modal-title"
    >
      <div className="w-full max-w-md rounded-xl border border-gray-700 bg-gray-900 shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
          <h2 id="reason-modal-title" className="text-lg font-semibold text-white">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-800 hover:text-white"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 space-y-4">
          <p className="text-sm text-gray-400">{bodyCopy}</p>
          {context.length > 0 && (
            <div className="rounded-lg bg-gray-800/80 p-3 space-y-2">
              {context.map(({ label, value }) => (
                <div key={label} className="flex justify-between text-sm">
                  <span className="text-gray-500">{label}</span>
                  <span className="text-gray-200 truncate max-w-[220px]" title={value}>{value}</span>
                </div>
              ))}
            </div>
          )}
          <div>
            <label htmlFor="reason-capture-input" className="block text-sm font-medium text-gray-300 mb-1">
              {reasonLabel}
            </label>
            <textarea
              id="reason-capture-input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={reasonPlaceholder}
              rows={3}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-sm text-white placeholder-gray-500 resize-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
            />
          </div>
          {error && (
            <p className="text-sm text-red-400" role="alert">{error}</p>
          )}
        </div>
        <div className="px-4 py-3 border-t border-gray-700 flex justify-end gap-2">
          <ActionButton variant="secondary" onClick={onClose} disabled={loading}>
            Cancel
          </ActionButton>
          <ActionButton
            variant={variant}
            onClick={handleSubmit}
            loading={loading}
            disabled={(requireReason && !reason.trim()) || loading}
          >
            {confirmLabel}
          </ActionButton>
        </div>
      </div>
    </div>
  );
}
