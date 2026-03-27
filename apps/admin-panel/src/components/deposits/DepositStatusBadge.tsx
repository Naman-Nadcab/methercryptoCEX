'use client';

import type { StatusVariant } from '@/components/dashboard/StatusBadge';
import { StatusBadge } from '@/components/dashboard/StatusBadge';

const LABELS: Record<string, string> = {
  pending: 'Pending',
  confirming: 'Processing',
  completed: 'Confirmed',
  confirmed: 'Confirmed',
  failed: 'Failed',
};

const VARIANTS: Record<string, StatusVariant> = {
  pending: 'warning',
  confirming: 'default',
  completed: 'success',
  confirmed: 'success',
  failed: 'danger',
};

export function DepositStatusBadge({ status }: { status: string }) {
  const key = status?.toLowerCase() ?? '';
  const label = LABELS[key] ?? (status ? status.replace(/_/g, ' ') : '—');
  const variant = VARIANTS[key];
  return <StatusBadge status={label} variant={variant} />;
}
