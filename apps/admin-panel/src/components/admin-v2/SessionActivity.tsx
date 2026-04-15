'use client';

import { memo } from 'react';
import { Users } from 'lucide-react';

function SessionActivityInner() {
  return (
    <div className="rounded-xl border border-admin-border bg-admin-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <Users className="w-4 h-4 text-purple-500" />
        <span className="text-[10px] font-semibold uppercase tracking-widest text-admin-muted">Session Activity</span>
      </div>
      <div className="space-y-2">
        <div>
          <p className="text-[10px] text-admin-muted uppercase tracking-wider">Current Session</p>
          <p className="text-sm font-bold text-admin-text tabular-nums mt-0.5">Active</p>
        </div>
        <div>
          <p className="text-[10px] text-admin-muted uppercase tracking-wider">Last Login</p>
          <p className="text-sm font-bold text-admin-text tabular-nums mt-0.5">{new Date().toLocaleDateString()}</p>
        </div>
      </div>
    </div>
  );
}

export const SessionActivity = memo(SessionActivityInner);
