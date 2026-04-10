'use client';

import { SensitiveActionModal } from '@/components/ops/SensitiveActionModal';

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
    <SensitiveActionModal
      open={open}
      onClose={onClose}
      onConfirm={onConfirm}
      title="Approve withdrawal"
      description={
        <>
          <span className="font-mono text-xs text-admin-text">ID: {withdrawalId}</span>
          {asset != null && amount != null && (
            <span className="block mt-1">
              {asset} · {amount}
            </span>
          )}
        </>
      }
      reasonLabel="Approval note (audit)"
      placeholder="e.g. Verified KYC, matched risk checks, proceeding to signing queue."
      minReasonLength={8}
      confirmLabel="Confirm approval"
      isLoading={isLoading}
      variant="default"
    />
  );
}
