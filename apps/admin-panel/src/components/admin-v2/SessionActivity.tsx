'use client';

import { useMemo, memo, useState, useEffect } from 'react';
import { User, Clock, FileText, ChevronDown, ChevronUp, Globe } from 'lucide-react';
import { useAdminAuditLog, type AuditEntry, type AuditActionType } from '@/store/adminAuditLog';
import { cn } from '@/lib/cn';

const ACTION_LABELS: Partial<Record<AuditActionType, { label: string; color: string }>> = {
  pause_trading: { label: 'Paused Trading', color: 'text-amber-600' },
  emergency_mode: { label: 'Emergency Mode', color: 'text-red-600' },
  freeze_withdrawals: { label: 'Froze Withdrawals', color: 'text-amber-600' },
  incident_created: { label: 'Created Incident', color: 'text-red-600' },
  incident_acknowledged: { label: 'Acknowledged Incident', color: 'text-blue-600' },
  incident_investigating: { label: 'Investigating Incident', color: 'text-amber-600' },
  incident_resolved: { label: 'Resolved Incident', color: 'text-emerald-600' },
  incident_note_added: { label: 'Added Note', color: 'text-admin-muted' },
  alert_dismissed: { label: 'Dismissed Alert', color: 'text-admin-muted' },
  alerts_cleared: { label: 'Cleared Alerts', color: 'text-admin-muted' },
  alerts_marked_read: { label: 'Marked All Read', color: 'text-admin-muted' },
  report_exported: { label: 'Exported Report', color: 'text-admin-primary' },
  search_performed: { label: 'Searched', color: 'text-admin-muted' },
  session_started: { label: 'Session Started', color: 'text-emerald-600' },
};

function formatSessionTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatSessionDuration(startMs: number): string {
  const diff = Math.floor((Date.now() - startMs) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  return `${Math.floor(diff / 3600)}h ${Math.floor((diff % 3600) / 60)}m`;
}

function SessionActivityInner() {
  const entries = useAdminAuditLog((s) => s.getSessionActions());
  const pagesVisited = useAdminAuditLog((s) => s.pagesVisited);
  const sessionStartedAt = useAdminAuditLog((s) => s.sessionStartedAt);
  const [expanded, setExpanded] = useState(false);
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const actionEntries = useMemo(
    () => entries.filter((e) => e.action !== 'page_visited').slice(0, 20),
    [entries]
  );

  const uniquePages = useMemo(() => {
    const seen = new Set<string>();
    return pagesVisited.filter((p) => {
      if (seen.has(p)) return false;
      seen.add(p);
      return true;
    }).slice(0, 10);
  }, [pagesVisited]);

  return (
    <div className="rounded-xl border border-admin-border bg-admin-card overflow-hidden">
      <button onClick={() => setExpanded((s) => !s)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-admin-card/[0.03] transition-colors">
        <div className="flex items-center gap-2">
          <User className="w-4 h-4 text-blue-500" />
          <span className="text-[10px] font-semibold uppercase tracking-widest text-admin-muted">Session Activity</span>
          <span className="text-[10px] tabular-nums text-admin-muted">{formatSessionDuration(sessionStartedAt)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-admin-muted">
            {actionEntries.length} action{actionEntries.length !== 1 ? 's' : ''} · {uniquePages.length} page{uniquePages.length !== 1 ? 's' : ''}
          </span>
          {expanded ? <ChevronUp className="w-4 h-4 text-admin-muted" /> : <ChevronDown className="w-4 h-4 text-admin-muted" />}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          {uniquePages.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-[10px] text-admin-muted font-medium uppercase tracking-wider">
                <Globe className="w-3 h-3" /> Pages Visited
              </div>
              <div className="flex flex-wrap gap-1">
                {uniquePages.map((page) => (
                  <span key={page} className="text-[10px] text-admin-muted bg-white/[0.02] border border-admin-border/60 rounded px-2 py-0.5 truncate max-w-[200px]">
                    {page}
                  </span>
                ))}
              </div>
            </div>
          )}

          {actionEntries.length === 0 ? (
            <div className="text-center py-4 text-xs text-admin-muted">
              <FileText className="w-5 h-5 mx-auto mb-1.5 text-gray-200" />
              No actions performed yet
            </div>
          ) : (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-[10px] text-admin-muted font-medium uppercase tracking-wider">
                <Clock className="w-3 h-3" /> Actions
              </div>
              {actionEntries.map((entry) => (<ActionRow key={entry.id} entry={entry} />))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export const SessionActivity = memo(SessionActivityInner);

const ActionRow = memo(function ActionRow({ entry }: { entry: AuditEntry }) {
  const cfg = ACTION_LABELS[entry.action];
  const label = cfg?.label ?? entry.action.replace(/_/g, ' ');
  const color = cfg?.color ?? 'text-admin-muted';

  return (
    <div className="flex items-center gap-2 py-1 px-2 rounded-lg hover:bg-admin-card/5 transition-colors">
      <span className="text-[10px] tabular-nums text-admin-muted font-mono w-14 shrink-0">{formatSessionTime(entry.timestamp)}</span>
      <span className={cn('text-xs font-medium', color)}>{label}</span>
      <span className="text-[10px] text-admin-muted ml-auto">{entry.actor}</span>
    </div>
  );
});
