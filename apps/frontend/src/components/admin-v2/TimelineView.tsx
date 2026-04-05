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

type TimelineEventType =
  | 'alert_critical'
  | 'alert_warning'
  | 'alert_predictive'
  | 'incident_started'
  | 'incident_acknowledged'
  | 'incident_investigating'
  | 'incident_resolved'
  | 'incident_note'
  | 'admin_action';

interface TimelineEvent {
  id: string;
  type: TimelineEventType;
  timestamp: number;
  title: string;
  description: string;
  source?: string;
}

const EVENT_CONFIG: Record<TimelineEventType, { icon: typeof AlertOctagon; color: string; bg: string }> = {
  alert_critical: { icon: AlertOctagon, color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/20' },
  alert_warning: { icon: AlertTriangle, color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20' },
  alert_predictive: { icon: BrainCircuit, color: 'text-violet-400', bg: 'bg-violet-500/10 border-violet-500/20' },
  incident_started: { icon: Siren, color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/20' },
  incident_acknowledged: { icon: Eye, color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/20' },
  incident_investigating: { icon: Search, color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20' },
  incident_resolved: { icon: CheckCircle2, color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20' },
  incident_note: { icon: MessageSquare, color: 'text-zinc-400', bg: 'bg-zinc-500/10 border-zinc-500/20' },
  admin_action: { icon: Shield, color: 'text-cyan-400', bg: 'bg-cyan-500/10 border-cyan-500/20' },
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
    events.push({
      id: `tl-alert-${a.id}`,
      type,
      timestamp: a.timestamp,
      title: `${a.severity.toUpperCase()} Alert`,
      description: a.message,
      source: a.source,
    });
  }

  for (const inc of incidents) {
    events.push({
      id: `tl-inc-start-${inc.id}`,
      type: 'incident_started',
      timestamp: inc.startedAt,
      title: 'Incident Started',
      description: inc.title,
    });
    if (inc.acknowledgedAt) {
      events.push({
        id: `tl-inc-ack-${inc.id}`,
        type: 'incident_acknowledged',
        timestamp: inc.acknowledgedAt,
        title: 'Incident Acknowledged',
        description: `Acknowledged by ${inc.acknowledgedBy ?? 'Admin'}`,
      });
    }
    if (inc.resolvedAt) {
      events.push({
        id: `tl-inc-res-${inc.id}`,
        type: 'incident_resolved',
        timestamp: inc.resolvedAt,
        title: 'Incident Resolved',
        description: inc.title,
      });
    }
    for (const note of inc.notes) {
      events.push({
        id: `tl-note-${note.id}`,
        type: 'incident_note',
        timestamp: note.timestamp,
        title: 'Note Added',
        description: `[${note.author}] ${note.text}`,
      });
    }
  }

  const actionTypes = new Set([
    'pause_trading', 'emergency_mode', 'freeze_withdrawals', 'report_exported',
  ]);
  for (const entry of auditEntries.slice(0, 30)) {
    if (actionTypes.has(entry.action)) {
      events.push({
        id: `tl-audit-${entry.id}`,
        type: 'admin_action',
        timestamp: entry.timestamp,
        title: entry.action.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        description: `Performed by ${entry.actor}`,
      });
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
    <div className="rounded-xl border border-[#1F2937] bg-[#151922] overflow-hidden">
      <button
        onClick={() => setExpanded((s) => !s)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-cyan-400" />
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Activity Timeline</span>
          <span className="text-[10px] tabular-nums text-zinc-600">({events.length} events)</span>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-zinc-500" /> : <ChevronDown className="w-4 h-4 text-zinc-500" />}
      </button>

      {expanded && (
        <div className="px-4 pb-4 max-h-[400px] overflow-y-auto">
          {events.length === 0 ? (
            <div className="text-center py-8 text-xs text-zinc-600">
              <Clock className="w-6 h-6 mx-auto mb-2 text-zinc-700" />
              No events recorded yet
            </div>
          ) : (
            <div className="relative ml-3">
              <div className="absolute left-0 top-0 bottom-0 w-px bg-[#1F2937]" />
              {events.map((event, i) => (
                <TimelineEventRow key={event.id} event={event} isFirst={i === 0} />
              ))}
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
    <div className={`relative pl-6 pb-3 ${isFirst ? 'pt-1' : ''}`}>
      <div className={`absolute left-[-5px] top-2 w-[10px] h-[10px] rounded-full border ${cfg.bg} flex items-center justify-center`}>
        <div className={`w-1.5 h-1.5 rounded-full ${cfg.color.replace('text-', 'bg-')}`} />
      </div>

      <div className="flex items-start gap-2">
        <span className="text-[10px] tabular-nums text-zinc-600 font-mono shrink-0 mt-0.5 w-16">
          {formatTimelineTime(event.timestamp)}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <Icon className={`w-3 h-3 ${cfg.color} shrink-0`} />
            <span className={`text-xs font-medium ${cfg.color}`}>{event.title}</span>
            {event.source && (
              <span className="text-[10px] text-zinc-600">· {event.source}</span>
            )}
          </div>
          <p className="text-[11px] text-zinc-400 mt-0.5 leading-relaxed truncate">{event.description}</p>
        </div>
      </div>
    </div>
  );
});
