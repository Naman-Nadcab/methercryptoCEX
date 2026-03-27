'use client';

import { cn } from '@/lib/cn';

export type RiskScore = 'low' | 'medium' | 'high';

const STYLES: Record<RiskScore, string> = {
  low: 'bg-gray-100 text-admin-muted',
  medium: 'bg-amber-100 text-admin-warning',
  high: 'bg-red-100 text-admin-danger',
};

export function WithdrawalRiskBadge({ score, flags = [] }: { score?: RiskScore | string; flags?: string[] }) {
  const s = (score ?? 'low') as RiskScore;
  const label = s === 'high' ? 'HIGH' : s === 'medium' ? 'MEDIUM' : 'LOW';
  return (
    <div className="flex flex-col gap-0.5">
      <span className={cn('inline-flex w-fit rounded-full px-2 py-0.5 text-xs font-medium', STYLES[s] || STYLES.low)}>
        {label}
      </span>
      {flags.length > 0 && (
        <div className="flex flex-wrap gap-1 text-xs text-admin-muted">
          {flags.slice(0, 2).map((f) => (
            <span key={f}>{f}</span>
          ))}
        </div>
      )}
    </div>
  );
}
