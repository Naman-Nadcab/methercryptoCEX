'use client';

import { ReactNode } from 'react';

export interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  className?: string;
}

export function SectionHeader({
  title,
  subtitle,
  action,
  className = '',
}: SectionHeaderProps) {
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 ${className}`}
    >
      <div>
        <h1 className="text-lg font-semibold text-[#111827] tracking-tight">
          {title}
        </h1>
        {subtitle != null && subtitle !== '' && (
          <p className="text-[14px] text-[#6B7280] mt-0.5">
            {subtitle}
          </p>
        )}
      </div>
      {action != null && <div className="shrink-0">{action}</div>}
    </div>
  );
}
