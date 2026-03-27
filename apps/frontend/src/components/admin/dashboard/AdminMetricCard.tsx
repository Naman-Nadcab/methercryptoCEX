'use client';

import Link from 'next/link';
import { ReactNode } from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';

interface AdminMetricCardProps {
  label: string;
  value: string | number;
  sublabel?: string;
  icon?: ReactNode;
  href?: string;
  variant?: 'default' | 'positive' | 'warning' | 'danger';
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
  children?: ReactNode;
}

const variantColors = {
  default: 'text-[var(--admin-text)]',
  positive: 'text-[var(--admin-success)]',
  warning: 'text-[var(--admin-warning)]',
  danger: 'text-[var(--admin-danger)]',
};

const iconBgColors = {
  default: 'bg-[var(--admin-primary)]/10 text-[var(--admin-primary)]',
  positive: 'bg-[var(--admin-success)]/10 text-[var(--admin-success)]',
  warning: 'bg-[var(--admin-warning)]/10 text-[var(--admin-warning)]',
  danger: 'bg-[var(--admin-danger)]/10 text-[var(--admin-danger)]',
};

export function AdminMetricCard({
  label,
  value,
  sublabel,
  icon,
  href,
  variant = 'default',
  trend,
  trendValue,
  children,
}: AdminMetricCardProps) {
  const valueClass = variantColors[variant];
  const iconBg = iconBgColors[variant];
  const content = (
    <div className="flex flex-col h-full">
      <div className="flex items-start justify-between gap-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${iconBg}`}>
          {icon}
        </div>
        {trend && trend !== 'neutral' && (
          <span className={`flex items-center gap-0.5 text-xs ${trend === 'up' ? 'text-[var(--admin-success)]' : 'text-[var(--admin-danger)]'}`}>
            {trend === 'up' ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
            {trendValue}
          </span>
        )}
      </div>
      <p className="text-xs text-[var(--admin-muted)] mt-3 truncate">{label}</p>
      <p className={`text-xl font-semibold mt-0.5 truncate ${valueClass}`}>{value}</p>
      {sublabel && <p className="text-xs text-[var(--admin-muted)] mt-0.5">{sublabel}</p>}
      {children && <div className="mt-3 flex-1 min-h-[32px]">{children}</div>}
    </div>
  );

  const className =
    'admin-card p-5 flex flex-col transition-all duration-200 ' +
    (href ? 'cursor-pointer hover:shadow-md' : '');

  if (href) {
    return (
      <Link href={href} className={className}>
        {content}
      </Link>
    );
  }
  return <div className={className}>{content}</div>;
}
