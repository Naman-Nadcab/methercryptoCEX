'use client';

import { ReactNode, useState } from 'react';

export interface AdminTabItem {
  key: string;
  label: string;
  children: ReactNode;
}

export interface AdminTabsProps {
  items: AdminTabItem[];
  defaultActiveKey?: string;
  className?: string;
}

export function AdminTabs({ items, defaultActiveKey, className = '' }: AdminTabsProps) {
  const firstKey = items[0]?.key ?? '';
  const [active, setActive] = useState(defaultActiveKey ?? firstKey);
  const current = items.find((t) => t.key === active) ?? items[0];

  return (
    <div className={className}>
      <div className="border-b border-border mb-4">
        <nav className="flex gap-1 overflow-x-auto" aria-label="Tabs">
          {items.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActive(tab.key)}
              className={`px-4 py-2.5 text-sm font-medium rounded-t-lg whitespace-nowrap transition-colors ${
                active === tab.key
                  ? 'bg-muted text-foreground border-b-2 border-primary -mb-px'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>
      <div className="min-h-[200px]">{current?.children}</div>
    </div>
  );
}
