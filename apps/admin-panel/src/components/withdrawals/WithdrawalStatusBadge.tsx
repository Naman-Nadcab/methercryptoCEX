'use client';

import { StatusBadge } from '@/components/dashboard/StatusBadge';

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

export function WithdrawalStatusBadge({ status }: { status: string }) {
  const label = LABELS[status?.toLowerCase()] ?? (status ? status.replace(/_/g, ' ') : '—');
  return <StatusBadge status={label} />;
}
