'use client';

import { Badge } from '@/components/ui/Badge';

const STUCK_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

export function isDepositStuck(status: string, createdAt: string | undefined): boolean {
  if (!createdAt || (status !== 'pending' && status !== 'confirming')) return false;
  const created = new Date(createdAt).getTime();
  return Date.now() - created > STUCK_THRESHOLD_MS;
}

export function LargeDepositBadge() {
  return (
    <Badge variant="warning" className="shrink-0">
      Large Deposit
    </Badge>
  );
}

export function StuckDepositBadge() {
  return (
    <Badge variant="warning" className="shrink-0">
      Stuck Deposit
    </Badge>
  );
}
