'use client';

import Link from 'next/link';
import { ReactNode } from 'react';

export type StatCardVariant = 'default' | 'warning' | 'danger';

const variantStyles: Record<StatCardVariant, string> = {
  default:
    'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900',
  warning:
    'border-amber-300 dark:border-amber-600 bg-amber-50/50 dark:bg-amber-950/30',
  danger:
    'border-red-300 dark:border-red-600 bg-red-50/50 dark:bg-red-950/30',
};

const variantValueStyles: Record<StatCardVariant, string> = {
  default: 'text-slate-900 dark:text-slate-100',
  warning: 'text-amber-700 dark:text-amber-300',
  danger: 'text-red-700 dark:text-red-300',
};

export interface StatCardProps {
  label: string;
  value: number | string;
  variant?: StatCardVariant;
  href?: string;
  children?: ReactNode;
}

export function StatCard({
  label,
  value,
  variant = 'default',
  href,
  children,
}: StatCardProps) {
  const base =
    'block w-full rounded-lg border p-4 text-left transition-colors';
  const styles = variantStyles[variant];
  const valueStyle = variantValueStyles[variant];

  const content = (
    <>
      <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
        {label}
      </p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${valueStyle}`}>
        {value}
      </p>
      {children}
    </>
  );

  const className = `${base} ${styles} ${href ? 'hover:opacity-90' : ''}`;

  if (href) {
    return (
      <Link href={href} className={className}>
        {content}
      </Link>
    );
  }

  return <div className={className}>{content}</div>;
}
