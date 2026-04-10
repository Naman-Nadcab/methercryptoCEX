'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';

export interface SensitiveActionModalProps {
  open: boolean;
  onClose: () => void;
  /** Called with trimmed reason/note; only invoked when min length satisfied */
  onConfirm: (note: string) => void | Promise<void>;
  title: string;
  description?: React.ReactNode;
  /** Label for the required text field */
  reasonLabel?: string;
  placeholder?: string;
  /** Minimum trimmed length (default 8) */
  minReasonLength?: number;
  confirmLabel?: string;
  isLoading?: boolean;
  variant?: 'default' | 'danger';
}

/**
 * Tier-1 pattern: sensitive mutations require an explicit written reason for audit trails.
 */
export function SensitiveActionModal({
  open,
  onClose,
  onConfirm,
  title,
  description,
  reasonLabel = 'Reason / audit note',
  placeholder = 'Describe why you are taking this action (required for audit).',
  minReasonLength = 8,
  confirmLabel = 'Confirm',
  isLoading,
  variant = 'default',
}: SensitiveActionModalProps) {
  const [note, setNote] = useState('');
  const trimmed = note.trim();
  const valid = trimmed.length >= minReasonLength;

  useEffect(() => {
    if (!open) setNote('');
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    await onConfirm(trimmed);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl border border-admin-border bg-admin-card p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sensitive-action-title"
      >
        <h3 id="sensitive-action-title" className="text-lg font-semibold text-admin-text">
          {title}
        </h3>
        {description ? <div className="mt-1 text-sm text-admin-muted">{description}</div> : null}
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label htmlFor="sensitive-action-note" className="block text-sm font-medium text-admin-text">
              {reasonLabel} <span className="text-admin-danger">*</span>
            </label>
            <textarea
              id="sensitive-action-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              required
              minLength={minReasonLength}
              className={cn(
                'mt-1 w-full rounded-lg border border-admin-border px-3 py-2 text-sm text-admin-text',
                'focus:ring-2 focus:ring-admin-primary focus:outline-none'
              )}
              placeholder={placeholder}
            />
            <p className="mt-1 text-[10px] text-admin-muted">
              Minimum {minReasonLength} characters — stored with the audit log.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant={variant === 'danger' ? 'danger' : 'primary'} disabled={!valid || isLoading}>
              {isLoading ? 'Working…' : confirmLabel}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
