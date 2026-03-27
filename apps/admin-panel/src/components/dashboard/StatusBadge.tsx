'use client';

import { Badge } from '@/components/ui/Badge';

export type StatusVariant = 'success' | 'warning' | 'danger' | 'default' | 'info';

export interface StatusBadgeProps {
  status: string;
  variant?: StatusVariant;
}

const STATUS_MAP: Record<string, StatusVariant> = {
  live: 'success',
  active: 'success',
  running: 'success',
  ok: 'success',
  suspended: 'warning',
  banned: 'danger',
  locked: 'danger',
  Banned: 'danger',
  Suspended: 'warning',
  Active: 'success',
  halted: 'danger',
  paused: 'warning',
  pending: 'warning',
  pending_approval: 'warning',
  approved: 'success',
  rejected: 'danger',
  completed: 'info',
  success: 'success',
  processing: 'default',
  cancelled: 'default',
  error: 'danger',
  failed: 'danger',
  confirming: 'default',
  confirmed: 'success',
  disabled: 'danger',
  maintenance: 'warning',
  healthy: 'success',
  warning: 'warning',
  down: 'danger',
  'low balance': 'warning',
  rpc_error: 'danger',
  'sync lag': 'warning',
};

export function StatusBadge({ status, variant }: StatusBadgeProps) {
  const v = variant ?? STATUS_MAP[status?.toLowerCase()] ?? 'default';
  return <Badge variant={v}>{status}</Badge>;
}
