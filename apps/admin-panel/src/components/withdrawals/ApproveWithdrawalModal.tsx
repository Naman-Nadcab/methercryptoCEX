'use client';

import { ActionAuthModal, type ActionAuthPayload } from '@/components/ops/ActionAuthModal';

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
  return (
    <ActionAuthModal
      open={open}
      onClose={onClose}
      onConfirm={(payload: ActionAuthPayload) => onConfirm(payload.reason)}
      title="Approve withdrawal"
      actionLabel={`Approve withdrawal ${withdrawalId}`}
      description={
        asset != null && amount != null
          ? `${asset} · ${amount}. Add approval note for audit trail.`
          : 'Add approval note for audit trail.'
      }
      requireReason
      twofaRequired
      confirmationPhrase="CONFIRM APPROVE_WITHDRAWAL"
      confirmVariant="primary"
      confirmLabel="Confirm approval"
      isPending={isLoading}
    />
  );
}
