'use client';

import { ReactNode } from 'react';
import Link from 'next/link';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';
import { cn } from '@/lib/utils';

export interface KPICardProps {
  title: string;
  value: string | number;
  change?: number;
  changeLabel?: string;
  sparklineData?: Array<Record<string, number>>;
  sparklineKey?: string;
  icon?: ReactNode;
  href?: string;
  accent?: 'primary' | 'success' | 'warning' | 'danger' | 'neutral';
  className?: string;
}

const accentColors = {
  primary: 'border-l-[var(--admin-primary)] bg-[var(--admin-primary)]/5',
  success: 'border-l-[var(--admin-success)] bg-[var(--admin-success)]/5',
  warning: 'border-l-[var(--admin-warning)] bg-[var(--admin-warning)]/5',
  danger: 'border-l-[var(--admin-danger)] bg-[var(--admin-danger)]/5',
  neutral: 'border-l-[var(--admin-card-border)]',
};

const sparklineColor: Record<string, string> = {
  primary: 'var(--admin-primary)',
  success: 'var(--admin-success)',
  warning: 'var(--admin-warning)',
  danger: 'var(--admin-danger)',
  neutral: 'var(--admin-primary)',
};

export function KPICard({
  title,
  value,
  change,
  changeLabel,
  sparklineData,
  sparklineKey = 'value',
  icon,
  href,
  accent = 'primary',
  className,
}: KPICardProps) {
  const card = (
    <div
      className={cn(
        'rounded-[var(--admin-radius)] border border-[var(--admin-card-border)] bg-[var(--admin-card-bg)] p-4 shadow-[var(--admin-shadow)] hover:shadow-[var(--admin-shadow-hover)] transition-shadow border-l-4 min-h-[100px] flex flex-col',
        accentColors[accent],
        href && 'cursor-pointer',
        className
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-[var(--admin-text-muted)] uppercase tracking-wide truncate">{title}</p>
          <p className="mt-1 text-xl font-bold tabular-nums text-[var(--admin-text)] truncate">{value}</p>
          {(change !== undefined || changeLabel) && (
            <p className="mt-0.5 text-xs text-[var(--admin-text-muted)]">
              {change !== undefined && (
                <span className={cn('font-medium', change >= 0 ? 'text-[var(--admin-success)]' : 'text-[var(--admin-danger)]')}>
                  {change >= 0 ? '+' : ''}{change}%
                </span>
              )}
              {changeLabel && <span className="ml-1">{changeLabel}</span>}
            </p>
          )}
        </div>
        {icon && (
          <div className="w-10 h-10 rounded-[var(--admin-radius)] bg-[var(--admin-primary)]/10 flex items-center justify-center shrink-0 text-[var(--admin-primary)]">
            {icon}
          </div>
        )}
      </div>
      {sparklineData && sparklineData.length > 0 && (
        <div className="mt-3 h-9 w-full -mb-1">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={sparklineData} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={`spark-${accent}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={sparklineColor[accent]} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={sparklineColor[accent]} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey={sparklineKey} stroke="none" fill={`url(#spark-${accent})`} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
  if (href) return <Link href={href}>{card}</Link>;
  return card;
}
