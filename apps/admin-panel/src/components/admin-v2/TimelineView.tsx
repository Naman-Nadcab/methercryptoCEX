'use client';

import { useMemo, memo, useState } from 'react';
import {
  AlertOctagon, AlertTriangle, Siren, Eye, Search, CheckCircle2,
  MessageSquare, Clock, Shield, ChevronDown, ChevronUp, Activity,
  BrainCircuit,
} from 'lucide-react';
import { useAdminAlertStore } from '@/store/adminAlerts';
import { useAdminIncidentStore, type Incident } from '@/store/adminIncidents';
import { useAdminAuditLog, type AuditEntry } from '@/store/adminAuditLog';
import { cn } from '@/lib/cn';

type TimelineEventType =
  | 'alert_critical' | 'alert_warning' | 'alert_predictive'
  | 'incident_started' | 'incident_acknowledged' | 'incident_investigating'
  | 'incident_resolved' | 'incident_note' | 'admin_action';

interface TimelineEvent {
  id: string;
  type: TimelineEventType;
  timestamp: number;
  title: string;
  description: string;
  source?: string;
}

const EVENT_CONFIG: Record<TimelineEventType, { icon: typeof AlertOctagon; color: string; dot: string }> = {
  alert_critical: { icon: AlertOctagon, color: 'text-red-600', dot: 'bg-red-500' },
  alert_warning: { icon: AlertTriangle, color: 'text-amber-600', dot: 'bg-amber-500' },
  alert_predictive: { icon: BrainCircuit, color: 'text-violet-600', dot: 'bg-violet-500' },
  incident_started: { icon: Siren, color: 'text-red-600', dot: 'bg-red-500' },
  incident_acknowledged: { icon: Eye, color: 'text-blue-600', dot: 'bg-blue-500' },
  incident_investigating: { icon: Search, color: 'text-amber-600', dot: 'bg-amber-500' },
  incident_resolved: { icon: CheckCircle2, color: 'text-emerald-600', dot: 'bg-emerald-500' },
  incident_note: { icon: MessageSquare, color: 'text-admin-muted', dot: 'bg-gray-400' },
  admin_action: { icon: Shield, color: 'text-admin-primary', dot: 'bg-admin-primary' },
};

function formatTimelineTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function buildTimeline(
  alerts: { id: string; severity: string; source: string; message: string; timestamp: number }[],
  incidents: Incident[],
  auditEntries: AuditEntry[],
): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  for (const a of alerts.slice(0, 50)) {
    const type: TimelineEventType = a.severity === 'critical' ? 'alert_critical'
      : a.severity === 'predictive' ? 'alert_predictive' : 'alert_warning';
    events.push({ id: `tl-alert-${a.id}`, type, timestamp: a.timestamp, title: `${a.severity.toUpperCase()} Alert`, description: a.message, source: a.source });
  }

  for (const inc of incidents) {
    events.push({ id: `tl-inc-start-${inc.id}`, type: 'incident_started', timestamp: inc.startedAt, title: 'Incident Started', description: inc.title });
    if (inc.acknowledgedAt) events.push({ id: `tl-inc-ack-${inc.id}`, type: 'incident_acknowledged', timestamp: inc.acknowledgedAt, title: 'Incident Acknowledged', description: `Acknowledged by ${inc.acknowledgedBy ?? 'Admin'}` });
    if (inc.resolvedAt) events.push({ id: `tl-inc-res-${inc.id}`, type: 'incident_resolved', timestamp: inc.resolvedAt, title: 'Incident Resolved', description: inc.title });
    for (const note of inc.notes) events.push({ id: `tl-note-${note.id}`, type: 'incident_note', timestamp: note.timestamp, title: 'Note Added', description: `[${note.author}] ${note.text}` });
  }

  const actionTypes = new Set(['pause_trading', 'emergency_mode', 'freeze_withdrawals', 'report_exported']);
  for (const entry of auditEntries.slice(0, 30)) {
    if (actionTypes.has(entry.action)) {
      events.push({ id: `tl-audit-${entry.id}`, type: 'admin_action', timestamp: entry.timestamp, title: entry.action.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), description: `Performed by ${entry.actor}` });
    }
  }

  return events.sort((a, b) => b.timestamp - a.timestamp);
}

interface TimelineViewProps {
  maxEvents?: number;
}

function TimelineViewInner({ maxEvents = 50 }: TimelineViewProps) {
  const alerts = useAdminAlertStore((s) => s.alerts);
  const incidents = useAdminIncidentStore((s) => s.incidents);
  const auditEntries = useAdminAuditLog((s) => s.entries);
  const [expanded, setExpanded] = useState(true);

  const events = useMemo(
    () => buildTimeline(alerts, incidents, auditEntries).slice(0, maxEvents),
    [alerts, incidents, auditEntries, maxEvents]
  );

  return (
    <div className="rounded-xl border border-admin-border bg-admin-card overflow-hidden">
      <button onClick={() => setExpanded((s) => !s)}
        className="w-full px-5 py-3 flex items-center justify-between hover:bg-admin-card/[0.03] transition-colors">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-admin-primary" />
          <span className="text-[10px] font-semibold uppercase tracking-widest text-admin-muted">Activity Timeline</span>
          <span className="text-[10px] tabular-nums text-admin-muted">({events.length} events)</span>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-admin-muted" /> : <ChevronDown className="w-4 h-4 text-admin-muted" />}
      </button>

      {expanded && (
        <div className="px-5 pb-4 max-h-[400px] overflow-y-auto">
          {events.length === 0 ? (
            <div className="text-center py-8 text-xs text-admin-muted">
              <Clock className="w-6 h-6 mx-auto mb-2 text-gray-200" />
              No events recorded yet
            </div>
          ) : (
            <div className="relative ml-3">
              <div className="absolute left-0 top-0 bottom-0 w-px bg-white/5" />
              {events.map((event, i) => (<TimelineEventRow key={event.id} event={event} isFirst={i === 0} />))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export const TimelineView = memo(TimelineViewInner);

const TimelineEventRow = memo(function TimelineEventRow({
  event, isFirst,
}: { event: TimelineEvent; isFirst: boolean }) {
  const cfg = EVENT_CONFIG[event.type];
  const Icon = cfg.icon;

  return (
    <div className={cn('relative pl-6 pb-3', isFirst && 'pt-1')}>
      <div className="absolute left-[-4px] top-2.5 w-[9px] h-[9px] rounded-full border-2 border-white bg-admin-card flex items-center justify-center">
        <div className={cn('w-[5px] h-[5px] rounded-full', cfg.dot)} />
      </div>

      <div className="flex items-start gap-2">
        <span className="text-[10px] tabular-nums text-admin-muted font-mono shrink-0 mt-0.5 w-16">
          {formatTimelineTime(event.timestamp)}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <Icon className={cn('w-3 h-3 shrink-0', cfg.color)} />
            <span className={cn('text-xs font-medium', cfg.color)}>{event.title}</span>
            {event.source && <span className="text-[10px] text-admin-muted">· {event.source}</span>}
          </div>
          <p className="text-[11px] text-admin-muted mt-0.5 leading-relaxed truncate">{event.description}</p>
        </div>
      </div>
    </div>
  );
});
