'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button, Input, Modal, ModalFooter, Textarea } from '@/components/ui';

export type ActionAuthPayload = {
  reason: string;
  twofa_code?: string;
};

export interface ActionAuthModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (payload: ActionAuthPayload) => void | Promise<void>;
  title: string;
  actionLabel: string;
  description?: string;
  externalError?: string | null;
  isPending?: boolean;
  requireReason?: boolean;
  twofaRequired?: boolean;
  confirmationPhrase?: string;
  confirmLabel?: string;
  confirmVariant?: 'primary' | 'danger';
}

export function ActionAuthModal({
  open,
  onClose,
  onConfirm,
  title,
  actionLabel,
  description,
  externalError,
  isPending = false,
  requireReason = true,
  twofaRequired = true,
  confirmationPhrase,
  confirmLabel = 'Confirm',
  confirmVariant = 'primary',
}: ActionAuthModalProps) {
  const [reason, setReason] = useState('');
  const [twofaCode, setTwofaCode] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setReason('');
    setTwofaCode('');
    setConfirmText('');
    setLocalError(null);
  }, [open]);

  const canSubmit = useMemo(() => !isPending, [isPending]);

  const submit = async () => {
    const trimmedReason = reason.trim();
    const trimmedTwofa = twofaCode.trim();
    const normalizedConfirm = confirmText.trim().toUpperCase();

    if (requireReason && trimmedReason.length < 8) {
      setLocalError('Reason must be at least 8 characters.');
      return;
    }
    if (confirmationPhrase && normalizedConfirm !== confirmationPhrase.toUpperCase()) {
      setLocalError(`Type "${confirmationPhrase}" to continue.`);
      return;
    }
    if (twofaRequired) {
      if (!/^\d{6}$/.test(trimmedTwofa)) {
        setLocalError('Valid 6-digit 2FA code is required.');
        return;
      }
    } else if (trimmedTwofa.length > 0 && !/^\d{6}$/.test(trimmedTwofa)) {
      setLocalError('2FA code must be a valid 6-digit value.');
      return;
    }

    setLocalError(null);
    await onConfirm({
      reason: trimmedReason,
      twofa_code: trimmedTwofa.length ? trimmedTwofa : undefined,
    });
  };

  return (
    <Modal open={open} onClose={onClose} title={title} size="sm">
      <div className="space-y-4">
        <p className="text-sm text-admin-muted">
          Action:
          <span className="block mt-1 text-admin-text font-medium">{actionLabel || '—'}</span>
        </p>
        {description ? <p className="text-xs text-admin-muted">{description}</p> : null}
        {requireReason ? (
          <Textarea
            label="Reason (minimum 8 characters)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Why this change is necessary"
          />
        ) : null}
        {confirmationPhrase ? (
          <Input
            label="Typed confirmation phrase"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={confirmationPhrase}
          />
        ) : null}
        <Input
          label={twofaRequired ? '2FA Code (required)' : '2FA Code (optional)'}
          value={twofaCode}
          onChange={(e) => setTwofaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="000000"
          className="text-center font-mono tracking-widest"
          autoComplete="one-time-code"
        />
        {localError ? <p className="text-sm text-admin-danger">{localError}</p> : null}
        {externalError ? <p className="text-sm text-admin-danger">{externalError}</p> : null}
      </div>
      <ModalFooter className="mt-4 border-0 px-0 pb-0 pt-4">
        <Button type="button" variant="secondary" onClick={onClose} disabled={isPending}>
          Cancel
        </Button>
        <Button type="button" variant={confirmVariant} onClick={submit} disabled={!canSubmit}>
          {confirmLabel}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
