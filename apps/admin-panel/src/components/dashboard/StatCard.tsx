'use client';

import Link from 'next/link';
import { LucideIcon, TrendingUp, TrendingDown } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface StatCardProps {
  title: string;
  value: string | number;
  change?: number;
  changeLabel?: string;
  icon: LucideIcon;
  iconBg?: string;
  href?: string;
  className?: string;
}

export function StatCard({
  title,
  value,
  change,
  changeLabel,
  icon: Icon,
  iconBg = 'bg-admin-primary/15 text-admin-primary',
  href,
  className,
}: StatCardProps) {
  return (
    <div className={cn(
      'rounded-ds-md border border-admin-border bg-admin-card p-4 transition-all duration-150',
      'hover:border-[#2A3441]',
      className
    )}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-medium uppercase tracking-wider text-admin-muted">{title}</p>
        <div className={cn('flex h-7 w-7 items-center justify-center rounded-lg', iconBg)}>
          <Icon className="h-3.5 w-3.5" />
        </div>
      </div>
      <p className="text-xl font-bold tabular-nums text-admin-text">{value}</p>
      {change != null && (
        <div className="mt-1 flex items-center gap-1 text-[10px]">
          {change >= 0 ? (
            <TrendingUp className="h-3 w-3 text-admin-success" />
          ) : (
            <TrendingDown className="h-3 w-3 text-admin-danger" />
          )}
          <span className={change >= 0 ? 'text-admin-success' : 'text-admin-danger'}>
            {change >= 0 ? '+' : ''}{change}%
          </span>
          {changeLabel && <span className="text-admin-muted">{changeLabel}</span>}
        </div>
      )}
      {href && (
        <Link href={href} className="mt-1.5 inline-block text-[10px] font-medium text-admin-primary hover:text-admin-primary-hover transition-colors">
          View details →
        </Link>
      )}
    </div>
  );
}
