'use client';

import { memo, useMemo } from 'react';
import { Clock } from 'lucide-react';
import { useAdminAuditLog } from '@/store/adminAuditLog';
import { cn } from '@/lib/cn';

function TimelineViewInner({ maxEvents = 20 }: { maxEvents?: number }) {
  const entries = useAdminAuditLog((s) => s.entries);
  const recent = useMemo(() => entries.slice(0, maxEvents), [entries, maxEvents]);

  if (recent.length === 0) {
    return (
      <div className="rounded-xl border border-admin-border bg-admin-card p-6 text-center text-xs text-admin-muted">
        No audit events yet.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-admin-border bg-admin-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <Clock className="w-4 h-4 text-blue-500" />
        <span className="text-[10px] font-semibold uppercase tracking-widest text-admin-muted">Recent Timeline</span>
      </div>
      <div className="relative space-y-0">
        {recent.map((entry, i) => (
          <div key={entry.id ?? i} className="flex gap-3 pb-3 last:pb-0">
            <div className="flex flex-col items-center">
              <div className={cn('h-2 w-2 rounded-full mt-1.5 shrink-0', i === 0 ? 'bg-blue-400 ring-2 ring-blue-400/30' : 'bg-admin-border')} />
              {i < recent.length - 1 && <div className="w-px flex-1 bg-admin-border" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-admin-text truncate">{entry.action ?? 'Unknown action'}</p>
              <p className="text-[10px] text-admin-muted mt-0.5">
                {entry.actor ?? 'system'} &middot; {entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : '—'}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export const TimelineView = memo(TimelineViewInner);
