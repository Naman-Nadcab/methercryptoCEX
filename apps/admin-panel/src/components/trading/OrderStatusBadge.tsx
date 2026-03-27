'use client';

import { StatusBadge } from '@/components/dashboard/StatusBadge';
import type { StatusVariant } from '@/components/dashboard/StatusBadge';

const LABELS: Record<string, string> = {
  OPEN: 'OPEN',
  open: 'OPEN',
  new: 'OPEN',
  PARTIALLY_FILLED: 'PARTIALLY_FILLED',
  partially_filled: 'PARTIALLY_FILLED',
  FILLED: 'FILLED',
  filled: 'FILLED',
  CANCELLED: 'CANCELLED',
  cancelled: 'CANCELLED',
  REJECTED: 'REJECTED',
  rejected: 'REJECTED',
};

const VARIANTS: Record<string, StatusVariant> = {
  OPEN: 'warning',
  open: 'warning',
  new: 'warning',
  PARTIALLY_FILLED: 'default',
  partially_filled: 'default',
  FILLED: 'success',
  filled: 'success',
  CANCELLED: 'default',
  cancelled: 'default',
  REJECTED: 'danger',
  rejected: 'danger',
};

export function OrderStatusBadge({ status }: { status: string }) {
  const key = (status ?? '').toLowerCase();
  const label = LABELS[status ?? ''] ?? LABELS[key] ?? (status || '—');
  const variant = VARIANTS[status ?? ''] ?? VARIANTS[key];
  return <StatusBadge status={label} variant={variant} />;
}
