'use client';

import * as React from 'react';
import { cn } from '@/lib/cn';

export interface TabItem<T extends string = string> {
  id: T;
  label: string;
  icon?: React.ReactNode;
  badge?: number | string;
}

export interface TabsProps<T extends string = string> {
  items: TabItem<T>[];
  active: T;
  onChange: (id: T) => void;
  variant?: 'underline' | 'pills';
  size?: 'sm' | 'md';
  className?: string;
}

export function Tabs<T extends string = string>({
  items,
  active,
  onChange,
  variant = 'underline',
  size = 'md',
  className,
}: TabsProps<T>) {
  if (variant === 'pills') {
    return (
      <div className={cn('flex gap-1 rounded-ds-md bg-white/5 p-1', className)} role="tablist">
        {items.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={active === tab.id}
            onClick={() => onChange(tab.id)}
            className={cn(
              'flex items-center gap-1.5 rounded-ds-sm px-3 font-medium transition-colors duration-150',
              size === 'sm' ? 'py-1 text-xs' : 'py-1.5 text-sm',
              active === tab.id
                ? 'bg-admin-card text-admin-text shadow-sm'
                : 'text-admin-muted hover:text-admin-text'
            )}
          >
            {tab.icon}
            {tab.label}
            {tab.badge != null && (
              <span className={cn(
                'ml-0.5 rounded-full px-1.5 text-[10px] font-bold',
                active === tab.id ? 'bg-admin-primary/10 text-admin-primary' : 'bg-white/10 text-admin-muted'
              )}>
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className={cn('border-b border-admin-border', className)} role="tablist">
      <nav className="flex gap-1 overflow-x-auto">
        {items.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={active === tab.id}
            onClick={() => onChange(tab.id)}
            className={cn(
              'flex items-center gap-1.5 whitespace-nowrap border-b-2 font-medium transition-colors duration-150',
              size === 'sm' ? 'px-3 py-2 text-xs' : 'px-4 py-3 text-sm',
              active === tab.id
                ? 'border-admin-primary text-admin-primary'
                : 'border-transparent text-admin-muted hover:border-admin-border hover:text-admin-text'
            )}
          >
            {tab.icon}
            {tab.label}
            {tab.badge != null && (
              <span className={cn(
                'ml-0.5 rounded-full px-1.5 text-[10px] font-bold',
                active === tab.id ? 'bg-admin-primary/10 text-admin-primary' : 'bg-white/5 text-admin-muted'
              )}>
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </nav>
    </div>
  );
}
