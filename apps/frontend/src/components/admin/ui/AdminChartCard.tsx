'use client';

import { ReactNode } from 'react';

export interface AdminChartCardProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
}

export function AdminChartCard({ title, subtitle, children, className = '' }: AdminChartCardProps) {
  return (
    <div className={`admin-card rounded-[12px] border-[#E5E7EB] overflow-hidden ${className}`}>
      <div className="px-5 py-4 border-b border-[#E5E7EB]">
        <h3 className="text-[15px] font-semibold text-[#111827]">{title}</h3>
        {subtitle != null && subtitle !== '' && (
          <p className="text-[12px] text-[#6B7280] mt-0.5">{subtitle}</p>
        )}
      </div>
      <div className="p-5 min-h-[200px]">{children}</div>
    </div>
  );
}
