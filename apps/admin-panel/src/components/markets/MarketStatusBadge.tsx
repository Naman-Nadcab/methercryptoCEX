'use client';

import { StatusBadge } from '@/components/dashboard/StatusBadge';

export interface MarketStatusBadgeProps {
  status?: string;
  is_active?: boolean;
  trading_enabled?: boolean;
}

export function MarketStatusBadge({ status, is_active, trading_enabled }: MarketStatusBadgeProps) {
  const s = (status ?? '').toLowerCase();
  const active = s === 'active' || (is_active !== false && trading_enabled !== false);
  const disabled = s === 'disabled';
  const maintenance = s === 'maintenance';
  let label = 'Active';
  let variant: 'success' | 'warning' | 'danger' | 'default' = 'success';
  if (disabled) {
    label = 'Disabled';
    variant = 'danger';
  } else if (maintenance || !active) {
    label = 'Paused';
    variant = 'warning';
  }
  return <StatusBadge status={label} variant={variant} />;
}
