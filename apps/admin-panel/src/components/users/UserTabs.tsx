'use client';

import { useState } from 'react';
import { cn } from '@/lib/cn';

export type UserTabId = 'overview' | 'wallets' | 'orders' | 'trades' | 'deposits' | 'withdrawals' | 'p2p' | 'activity' | 'security' | 'api-keys' | 'risk-timeline';

const TABS: { id: UserTabId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'wallets', label: 'Wallets' },
  { id: 'orders', label: 'Orders' },
  { id: 'trades', label: 'Trades' },
  { id: 'deposits', label: 'Deposits' },
  { id: 'withdrawals', label: 'Withdrawals' },
  { id: 'p2p', label: 'P2P' },
  { id: 'activity', label: 'Activity Logs' },
  { id: 'security', label: 'Security' },
  { id: 'api-keys', label: 'API Keys' },
  { id: 'risk-timeline', label: 'Risk Timeline' },
];

export interface UserTabsProps {
  activeTab: UserTabId;
  onTabChange: (tab: UserTabId) => void;
  children: React.ReactNode;
}

export function UserTabs({ activeTab, onTabChange, children }: UserTabsProps) {
  return (
    <div className="rounded-[12px] bg-admin-card shadow-[0_1px_3px_0_rgba(0,0,0,0.08)]">
      <div className="border-b border-admin-border">
        <nav className="flex gap-1 overflow-x-auto px-4" aria-label="User detail tabs">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              className={cn(
                'whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition-colors',
                activeTab === tab.id
                  ? 'border-admin-primary text-admin-primary'
                  : 'border-transparent text-admin-muted hover:border-admin-border hover:text-admin-text'
              )}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}

export { TABS as USER_TABS };
