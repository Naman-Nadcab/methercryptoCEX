'use client';

import { cn } from '@/lib/cn';

export type RiskLevel = 'low' | 'medium' | 'high';

export interface RiskBadgeProps {
  level: RiskLevel;
  flags?: string[];
  className?: string;
}

const LEVEL_STYLES: Record<RiskLevel, string> = {
  low: 'bg-gray-100 text-admin-muted',
  medium: 'bg-amber-100 text-admin-warning',
  high: 'bg-red-100 text-admin-danger',
};

export function RiskBadge({ level, flags = [], className }: RiskBadgeProps) {
  const label = level === 'low' ? 'Low' : level === 'medium' ? 'Medium' : 'High';
  return (
    <div className={cn('flex flex-col gap-0.5', className)}>
      <span className={cn('inline-flex w-fit rounded-full px-2.5 py-0.5 text-xs font-medium', LEVEL_STYLES[level])}>
        {label} Risk
      </span>
      {flags.length > 0 && (
        <div className="flex flex-wrap gap-1 text-xs text-admin-muted">
          {flags.slice(0, 3).map((f) => (
            <span key={f} title={f}>
              {f.length > 12 ? `${f.slice(0, 10)}…` : f}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
