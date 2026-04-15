'use client';

import { memo } from 'react';
import { Users } from 'lucide-react';

function ActiveAdminsIndicatorInner() {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-admin-border bg-white/[0.02] px-3 py-1.5">
      <Users className="h-3.5 w-3.5 text-admin-muted" />
      <span className="text-xs text-admin-muted">Admins online</span>
      <span className="flex items-center gap-1">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
        <span className="text-xs font-bold text-admin-text tabular-nums">1</span>
      </span>
    </div>
  );
}

export const ActiveAdminsIndicator = memo(ActiveAdminsIndicatorInner);
