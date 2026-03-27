'use client';

import { ReactNode } from 'react';

interface AdminChartCardProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
}

export function AdminChartCard({ title, subtitle, children, className = '' }: AdminChartCardProps) {
  return (
    <div className={`admin-card p-4 lg:p-5 ${className}`}>
      <div className="mb-4">
        <h3 className="text-sm font-semibold admin-metric-value">{title}</h3>
        {subtitle && <p className="text-xs admin-metric-label mt-0.5">{subtitle}</p>}
      </div>
      <div className="min-h-[240px]">{children}</div>
    </div>
  );
}
