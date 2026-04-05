'use client';

import { useState } from 'react';
import { Search, Bell, User, ChevronDown, Activity, PauseCircle, CheckCircle } from 'lucide-react';
import { useAdminAuthStore } from '@/store/auth';
import { useQuery } from '@tanstack/react-query';
import { getTradingHalt, getControlOverview } from '@/lib/api';
import { StatusBadge } from '@/components/dashboard/StatusBadge';
import { cn } from '@/lib/cn';

export function Topbar() {
  const [searchOpen, setSearchOpen] = useState(false);
  const { admin, logout } = useAdminAuthStore();
  const token = useAdminAuthStore((s) => s.accessToken);

  const { data: haltData } = useQuery({
    queryKey: ['admin', 'trading-halt', token],
    queryFn: () => getTradingHalt(token),
    enabled: !!token,
  });

  const { data: controlData } = useQuery({
    queryKey: ['admin', 'control', token],
    queryFn: () => getControlOverview(token),
    enabled: !!token,
  });

  const halted = haltData?.data?.halted ?? false;
  const settlement = (controlData?.data?.settlement as { status?: string })?.status;

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-admin-border bg-admin-card px-6">
      <div className="flex flex-1 items-center gap-6">
        <div className="relative w-full max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-admin-muted" />
          <input
            type="search"
            placeholder="Search in Exchange Admin..."
            className="w-full rounded-lg border border-admin-border bg-white/[0.02] py-2 pl-10 pr-4 text-sm placeholder:text-admin-muted focus:border-admin-primary focus:outline-none focus:ring-1 focus:ring-admin-primary"
            onFocus={() => setSearchOpen(true)}
            onBlur={() => setTimeout(() => setSearchOpen(false), 200)}
          />
        </div>
      </div>

      <div className="flex items-center gap-4">
        {/* System status indicators */}
        <div className="flex items-center gap-3 rounded-lg border border-admin-border bg-white/[0.02]/80 px-3 py-1.5">
          <span className="flex items-center gap-1.5 text-xs text-admin-muted">
            <Activity className="h-3.5 w-3.5" />
            Engine
          </span>
          <StatusBadge status={halted ? 'Halted' : 'Running'} variant={halted ? 'danger' : 'success'} />
          <span className="text-admin-muted">|</span>
          <span className="flex items-center gap-1.5 text-xs text-admin-muted">
            {halted ? <PauseCircle className="h-3.5 w-3.5" /> : <CheckCircle className="h-3.5 w-3.5" />}
            Trading
          </span>
          <StatusBadge status={halted ? 'Paused' : 'Live'} variant={halted ? 'danger' : 'success'} />
          <span className="text-admin-muted">|</span>
          <span className="text-xs text-admin-muted">Settlement</span>
          <StatusBadge status={settlement ?? 'Active'} />
        </div>

        <button
          type="button"
          className="rounded-lg p-2 text-admin-muted hover:bg-admin-card/5 hover:text-admin-text"
          aria-label="Notifications"
        >
          <Bell className="h-5 w-5" />
        </button>

        <div className="flex items-center gap-2 rounded-lg border border-admin-border bg-white/[0.02]/80 px-3 py-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-admin-primary/10 text-admin-primary">
            <User className="h-4 w-4" />
          </div>
          <div className="text-left">
            <p className="text-sm font-medium text-admin-text">{admin?.name ?? 'Admin'}</p>
            <p className="text-xs text-admin-muted">{admin?.email ?? ''}</p>
          </div>
          <ChevronDown className="h-4 w-4 text-admin-muted" />
        </div>
      </div>
    </header>
  );
}
