'use client';

import { StatusBadge, type StatusVariant } from '@/components/dashboard/StatusBadge';

const LABELS: Record<string, string> = {
  pending: 'Pending',
  pending_approval: 'Pending Approval',
  approved: 'Approved',
  rejected: 'Rejected',
  completed: 'Completed',
  failed: 'Failed',
  processing: 'Processing',
  cancelled: 'Cancelled',
};

const VARIANTS: Record<string, StatusVariant> = {
  pending: 'warning',
  pending_approval: 'warning',
  approved: 'success',
  rejected: 'danger',
  completed: 'success',
  failed: 'danger',
  processing: 'default',
  cancelled: 'default',
};

export function WithdrawalStatusBadge({ status }: { status: string }) {
  const key = status?.toLowerCase() ?? '';
  const label = LABELS[key] ?? (status ? status.replace(/_/g, ' ') : '—');
  return <StatusBadge status={label} variant={VARIANTS[key]} />;
}
