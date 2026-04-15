'use client';

import { useState, useMemo, useCallback, memo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/auth';
import {
  getMonitoringIncidents,
  getMonitoringHealth,
  getMonitoringTimeline,
  type IncidentRow,
  type TimelineEventRow,
} from '@/lib/monitoring-api';
import { getControlEvents, type ControlEventRow } from '@/lib/control-api';
import { MonitoringIncidentsPanel } from '@/components/incidents/MonitoringIncidentsPanel';
import { AdminPageFrame } from '@/components/admin-shell/AdminPageFrame';
import { ADMIN_FEATURE_FLAGS } from '@/lib/admin/featureFlags';
import { useAdminIncidentStore, type Incident, type IncidentStatus, type IncidentNote } from '@/store/adminIncidents';
import { useAdminAuditLog } from '@/store/adminAuditLog';
import { useAdminAlertStore } from '@/store/adminAlerts';
import { PlaybookPanel } from '@/components/admin-v2/PlaybookPanel';
import { computeSLA, computeAggregateSLA } from '@/components/admin-v2/slaMetrics';
import { generateIncidentReport, downloadIncidentReport } from '@/components/admin-v2/incidentExport';
import { cn } from '@/lib/cn';
import {
  Siren, Eye, CheckCircle2, Search, Clock, AlertTriangle, AlertOctagon,
  Shield, ShieldCheck, Timer, ChevronDown, ChevronRight, MessageSquare,
  FileText, Download, BookOpen, Users, Activity, Zap,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function IncidentsPage() {
  const token = useAdminAuthStore((s) => s.accessToken);

  const { data: allIncData } = useQuery({
    queryKey: ['admin', 'monitoring-incidents-all', token],
    queryFn: () => getMonitoringIncidents(token, { limit: 200, offset: 0 }),
    enabled: !!token,
    staleTime: 10_000,
    refetchInterval: 15_000,
  });

  const { data: healthData } = useQuery({
    queryKey: ['admin', 'monitoring-health-incidents', token],
    queryFn: () => getMonitoringHealth(token),
    enabled: !!token,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const { data: timelineData } = useQuery({
    queryKey: ['admin', 'monitoring-timeline', token],
    queryFn: () => getMonitoringTimeline(token, 20),
    enabled: !!token,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const { data: eventsData } = useQuery({
    queryKey: ['admin', 'control-events-incidents', token],
    queryFn: () => getControlEvents(token, 15),
    enabled: !!token,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const allDbIncidents = (allIncData?.data?.incidents ?? []) as IncidentRow[];
  const openCount = allDbIncidents.filter((i) => i.status === 'open').length;
  const ackedCount = allDbIncidents.filter((i) => i.status === 'acknowledged').length;
  const resolvedCount = allDbIncidents.filter((i) => i.status === 'resolved').length;
  const criticalCount = allDbIncidents.filter((i) => i.severity === 'critical' && i.status !== 'resolved').length;

  const health = healthData?.data;
  const timeline = timelineData?.data?.events ?? [];
  const events = eventsData?.data?.events ?? [];

  const pageStatus = criticalCount > 0 ? 'risk' as const : openCount > 0 ? 'warning' as const : 'active' as const;

  return (
    <AdminPageFrame
      title="Incident Workspace"
      description="Monitor, create, acknowledge, and resolve incidents across all exchange services."
      status={pageStatus}
      metrics={
        <>
          <KpiCard label="Open" value={openCount} icon={<Siren className="h-3.5 w-3.5" />}
            color={openCount > 0 ? 'text-red-400' : 'text-admin-muted'} pulse={openCount > 0} />
          <KpiCard label="Acknowledged" value={ackedCount} icon={<Eye className="h-3.5 w-3.5" />}
            color={ackedCount > 0 ? 'text-amber-400' : 'text-admin-muted'} />
          <KpiCard label="Critical Active" value={criticalCount} icon={<AlertOctagon className="h-3.5 w-3.5" />}
            color={criticalCount > 0 ? 'text-red-400' : 'text-admin-muted'} pulse={criticalCount > 0} />
          <KpiCard label="Resolved" value={resolvedCount} icon={<CheckCircle2 className="h-3.5 w-3.5" />}
            color="text-emerald-400" />
        </>
      }
    >
      {/* Live status strip */}
      <StatusStrip health={health} openCount={openCount} criticalCount={criticalCount} />

      {/* Main DB incidents panel (with create, acknowledge, resolve) */}
      <MonitoringIncidentsPanel />

      {/* Session-based incident tools (Zustand powered) */}
      {ADMIN_FEATURE_FLAGS.ADMIN_INCIDENT_SYSTEM && (
        <SessionWorkspaceSection />
      )}

      {/* Activity timeline + event log side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TimelinePanel timeline={timeline} />
        <EventLogPanel events={events} />
      </div>
    </AdminPageFrame>
  );
}

/* ------------------------------------------------------------------ */
/*  KPI Card                                                           */
/* ------------------------------------------------------------------ */

function KpiCard({ label, value, icon, color, pulse }: {
  label: string; value: number; icon: React.ReactNode; color: string; pulse?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-admin-border bg-admin-card p-3.5">
      <div className={cn('flex h-9 w-9 items-center justify-center rounded-lg bg-white/[0.04]', color)}>
        {icon}
      </div>
      <div>
        <p className={cn('text-2xl font-bold tabular-nums text-admin-text', pulse && 'animate-pulse')}>{value}</p>
        <p className="text-[10px] font-medium uppercase tracking-wider text-admin-muted">{label}</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Status Strip                                                       */
/* ------------------------------------------------------------------ */

function StatusStrip({ health, openCount, criticalCount }: {
  health?: { api_latency_ms: number; db_health: string; redis_health: string; ws_connections: number } | null;
  openCount: number;
  criticalCount: number;
}) {
  const items = [
    {
      label: 'API',
      ok: health ? health.api_latency_ms < 500 : true,
      value: health ? `${health.api_latency_ms}ms` : '—',
    },
    { label: 'DB', ok: health?.db_health === 'ok', value: health?.db_health ?? '—' },
    { label: 'Redis', ok: health?.redis_health === 'ok', value: health?.redis_health ?? '—' },
    { label: 'WS', ok: true, value: health ? `${health.ws_connections}` : '—' },
    { label: 'Open', ok: openCount === 0, value: String(openCount) },
    { label: 'Critical', ok: criticalCount === 0, value: String(criticalCount) },
  ];

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-admin-border bg-admin-card px-4 py-2.5">
      <Activity className="h-3.5 w-3.5 text-admin-muted" />
      <span className="text-[10px] font-semibold uppercase tracking-wider text-admin-muted mr-2">System Health</span>
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-1.5">
          <div className={cn('h-1.5 w-1.5 rounded-full', item.ok ? 'bg-emerald-400' : 'bg-red-400 animate-pulse')} />
          <span className="text-[10px] text-admin-muted">{item.label}</span>
          <span className={cn('text-[10px] font-bold tabular-nums', item.ok ? 'text-admin-text' : 'text-red-400')}>
            {item.value}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Session Workspace (Zustand-based local incidents)                  */
/* ------------------------------------------------------------------ */

const SessionWorkspaceSection = memo(function SessionWorkspaceSection() {
  const incidents = useAdminIncidentStore((s) => s.incidents);
  const [filter, setFilter] = useState<IncidentStatus | 'all'>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (filter === 'all') return incidents;
    return incidents.filter((inc) => inc.status === filter);
  }, [incidents, filter]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: incidents.length };
    for (const inc of incidents) c[inc.status] = (c[inc.status] ?? 0) + 1;
    return c;
  }, [incidents]);

  const aggSLA = useMemo(() => computeAggregateSLA(incidents), [incidents]);

  const FILTER_TABS: { value: IncidentStatus | 'all'; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'active', label: 'Active' },
    { value: 'acknowledged', label: 'Acked' },
    { value: 'investigating', label: 'Investigating' },
    { value: 'resolved', label: 'Resolved' },
  ];

  return (
    <div className="rounded-xl border border-admin-border bg-admin-card overflow-hidden">
      <div className="border-b border-admin-border px-4 py-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-purple-400" />
          <span className="text-xs font-semibold text-admin-text">Session Workspace</span>
          <span className="text-[10px] text-admin-muted">Local playbooks &amp; session incidents</span>
        </div>
        <SessionAdminsOnline />
      </div>

      {/* SLA summary row */}
      {ADMIN_FEATURE_FLAGS.ADMIN_PRODUCTION_HARDENING && incidents.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-px bg-admin-border/40">
          <SlaCell label="Avg. TTA" value={aggSLA.avgTTAHuman} />
          <SlaCell label="Avg. TTR" value={aggSLA.avgTTRHuman} />
          <SlaCell label="SLA Compliance" value={`${aggSLA.slaCompliancePercent}%`}
            color={aggSLA.slaCompliancePercent >= 90 ? 'text-emerald-400' : aggSLA.slaCompliancePercent >= 70 ? 'text-amber-400' : 'text-red-400'} />
          <SlaCell label="Resolved" value={String(aggSLA.totalResolved)} />
          <SlaCell label="Total" value={String(incidents.length)} />
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-0 border-b border-admin-border bg-white/[0.01]">
        {FILTER_TABS.map((tab) => (
          <button key={tab.value} onClick={() => setFilter(tab.value)}
            className={cn('border-b-2 px-3 py-2 text-[11px] font-medium transition-colors',
              filter === tab.value ? 'border-admin-primary text-admin-primary' : 'border-transparent text-admin-muted hover:text-admin-text')}>
            {tab.label}
            {(counts[tab.value] ?? 0) > 0 && (
              <span className="ml-1 text-[10px] tabular-nums opacity-70">({counts[tab.value]})</span>
            )}
          </button>
        ))}
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="text-center py-12">
          <Shield className="h-6 w-6 mx-auto mb-2 text-admin-muted/40" />
          <p className="text-xs text-admin-muted">
            {filter === 'all'
              ? 'No session incidents. These are created automatically when critical alert bursts are detected.'
              : `No ${filter} incidents.`}
          </p>
        </div>
      ) : (
        <div className="divide-y divide-admin-border/50">
          {filtered.map((inc) => (
            <SessionIncidentRow key={inc.id} incident={inc}
              isExpanded={expandedId === inc.id}
              onToggle={() => setExpandedId(expandedId === inc.id ? null : inc.id)} />
          ))}
        </div>
      )}
    </div>
  );
});

/* ------------------------------------------------------------------ */
/*  Session Incident Row                                               */
/* ------------------------------------------------------------------ */

const STATUS_CONFIGS: Record<IncidentStatus, { icon: typeof Siren; dot: string; color: string }> = {
  active: { icon: Siren, dot: 'bg-red-500', color: 'text-red-400' },
  acknowledged: { icon: Eye, dot: 'bg-amber-500', color: 'text-amber-400' },
  investigating: { icon: Search, dot: 'bg-blue-500', color: 'text-blue-400' },
  resolved: { icon: CheckCircle2, dot: 'bg-emerald-500', color: 'text-emerald-400' },
};

function formatDuration(startedAt: number, resolvedAt?: number): string {
  const end = resolvedAt ?? Date.now();
  const diff = Math.max(0, Math.floor((end - startedAt) / 1000));
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) {
    const m = Math.floor(diff / 60);
    const s = diff % 60;
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString([], {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

const SessionIncidentRow = memo(function SessionIncidentRow({
  incident, isExpanded, onToggle,
}: { incident: Incident; isExpanded: boolean; onToggle: () => void }) {
  const cfg = STATUS_CONFIGS[incident.status];
  const duration = formatDuration(incident.startedAt, incident.resolvedAt);
  const logAudit = useAdminAuditLog((s) => s.logAction);
  const allAlerts = useAdminAlertStore((s) => s.alerts);
  const ackIncident = useAdminIncidentStore((s) => s.acknowledgeIncident);
  const markInvestigating = useAdminIncidentStore((s) => s.markInvestigating);
  const resolveIncident = useAdminIncidentStore((s) => s.resolveIncident);
  const addNote = useAdminIncidentStore((s) => s.addNote);
  const [noteText, setNoteText] = useState('');

  const sla = useMemo(() => computeSLA(incident), [incident]);

  const alertSources = useMemo(() => {
    const parts = incident.title.split(/[:\-–]/);
    if (parts.length > 1) return parts.slice(1).map((s) => s.trim()).filter(Boolean);
    return ['System'];
  }, [incident.title]);

  const linkedAlerts = useMemo(() => {
    const windowMs = 30_000;
    const start = incident.startedAt - windowMs;
    const end = incident.startedAt + windowMs;
    const byId = allAlerts.filter((a) => incident.triggeringAlertIds.includes(a.id));
    const byTime = allAlerts.filter(
      (a) => a.timestamp >= start && a.timestamp <= end && !incident.triggeringAlertIds.includes(a.id)
    );
    return [...byId, ...byTime];
  }, [incident, allAlerts]);

  const handleExport = useCallback(() => {
    const report = generateIncidentReport(incident, linkedAlerts);
    downloadIncidentReport(report);
    logAudit('report_exported', { incidentId: incident.id });
  }, [incident, linkedAlerts, logAudit]);

  const handleAddNote = () => {
    if (!noteText.trim()) return;
    addNote(incident.id, noteText.trim());
    setNoteText('');
  };

  return (
    <div className={cn(incident.status === 'active' && 'bg-red-500/[0.03]')}>
      <button onClick={onToggle} className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-white/[0.015] transition-colors">
        {isExpanded
          ? <ChevronDown className="h-3.5 w-3.5 text-admin-muted shrink-0" />
          : <ChevronRight className="h-3.5 w-3.5 text-admin-muted shrink-0" />}
        <div className={cn('h-2 w-2 rounded-full shrink-0', cfg.dot, incident.status === 'active' && 'animate-pulse')} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-admin-text truncate">{incident.title}</span>
            <span className={cn('text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded', cfg.color, 'bg-current/10')}
              style={{ backgroundColor: undefined }}>
              <span className={cn('inline-flex items-center gap-1', cfg.color)}>
                {incident.status}
              </span>
            </span>
            <span className={cn('text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded border',
              incident.severity === 'critical' ? 'bg-red-500/10 text-red-400 border-red-500/30' : 'bg-amber-500/10 text-amber-400 border-amber-500/30')}>
              {incident.severity}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-1 text-[10px] text-admin-muted">
            <span>{formatTime(incident.startedAt)}</span>
            <span>&middot;</span>
            <span className="flex items-center gap-1"><Clock className="h-2.5 w-2.5" />{duration}</span>
            {incident.notes.length > 0 && (
              <>
                <span>&middot;</span>
                <span className="flex items-center gap-1"><MessageSquare className="h-2.5 w-2.5" />{incident.notes.length} note{incident.notes.length !== 1 ? 's' : ''}</span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-admin-muted shrink-0">
          <AlertOctagon className="h-3 w-3" />
          {incident.triggeringAlertIds.length}
        </div>
      </button>

      {isExpanded && (
        <div className="px-4 pb-4 pt-1 border-t border-admin-border/40 space-y-4">
          {/* Details grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <DetailCell label="Incident ID" value={incident.id.slice(0, 18)} mono />
            <DetailCell label="Started" value={formatTime(incident.startedAt)} />
            <DetailCell label="Duration" value={duration} />
            <DetailCell label="Acknowledged By" value={incident.acknowledgedBy ?? '—'} />
          </div>

          {/* SLA bar */}
          {ADMIN_FEATURE_FLAGS.ADMIN_PRODUCTION_HARDENING && (
            <div className="flex items-center gap-4 py-2.5 px-3 rounded-lg border border-admin-border bg-white/[0.02]">
              <Timer className="h-3.5 w-3.5 text-blue-400 shrink-0" />
              <div className="flex items-center gap-4 text-xs flex-wrap">
                <div>
                  <span className="text-admin-muted">Ack in </span>
                  <span className={cn('font-medium tabular-nums', sla.timeToAcknowledgeMs !== null && sla.timeToAcknowledgeMs <= 120_000 ? 'text-emerald-400' : 'text-amber-400')}>
                    {sla.timeToAcknowledgeHuman}
                  </span>
                </div>
                <div>
                  <span className="text-admin-muted">Resolved in </span>
                  <span className={cn('font-medium tabular-nums', sla.timeToResolveMs !== null && sla.timeToResolveMs <= 900_000 ? 'text-emerald-400' : 'text-amber-400')}>
                    {sla.timeToResolveHuman}
                  </span>
                </div>
                {sla.withinSLA ? (
                  <span className="flex items-center gap-1 text-emerald-400 text-[10px] font-semibold">
                    <ShieldCheck className="h-3 w-3" /> Within SLA
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-red-400 text-[10px] font-semibold">
                    <AlertTriangle className="h-3 w-3" /> SLA Breached
                  </span>
                )}
              </div>
              <button onClick={handleExport}
                className="ml-auto flex items-center gap-1 rounded-lg border border-admin-border px-2.5 py-1 text-[10px] font-medium text-admin-muted hover:bg-white/5 hover:text-admin-text transition-colors shrink-0">
                <Download className="h-3 w-3" /> Export
              </button>
            </div>
          )}

          {/* Quick actions */}
          {incident.status !== 'resolved' && (
            <div className="flex items-center gap-2">
              {incident.status === 'active' && (
                <button onClick={() => { ackIncident(incident.id, 'Admin'); logAudit('incident_acknowledged', { id: incident.id }); }}
                  className="flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[11px] font-semibold text-amber-400 hover:bg-amber-500/20 transition-colors">
                  <Eye className="h-3 w-3" /> Acknowledge
                </button>
              )}
              {(incident.status === 'active' || incident.status === 'acknowledged') && (
                <button onClick={() => { markInvestigating(incident.id); logAudit('incident_investigating', { id: incident.id }); }}
                  className="flex items-center gap-1.5 rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 text-[11px] font-semibold text-blue-400 hover:bg-blue-500/20 transition-colors">
                  <Search className="h-3 w-3" /> Investigate
                </button>
              )}
              <button onClick={() => { resolveIncident(incident.id); logAudit('incident_resolved', { id: incident.id }); }}
                className="flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-semibold text-emerald-400 hover:bg-emerald-500/20 transition-colors">
                <CheckCircle2 className="h-3 w-3" /> Resolve
              </button>
            </div>
          )}

          {/* Notes */}
          {incident.notes.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-xs text-admin-muted">
                <MessageSquare className="h-3 w-3" />
                <span className="font-medium">Notes ({incident.notes.length})</span>
              </div>
              <div className="space-y-1 max-h-[180px] overflow-y-auto pr-1">
                {incident.notes.map((note) => (
                  <div key={note.id} className="flex gap-2 py-1.5 px-2.5 rounded-lg bg-white/[0.02] border border-admin-border/50">
                    <FileText className="h-3 w-3 text-admin-muted mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-admin-text leading-relaxed">{note.text}</p>
                      <p className="text-[10px] text-admin-muted mt-0.5">{note.author} &middot; {formatTime(note.timestamp)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Add note */}
          {incident.status !== 'resolved' && (
            <div className="flex gap-2">
              <input
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddNote()}
                placeholder="Add a note..."
                className="flex-1 rounded-lg border border-admin-border bg-white/5 px-3 py-1.5 text-xs text-admin-text placeholder:text-admin-muted/50 focus:border-admin-primary focus:outline-none focus:ring-1 focus:ring-admin-primary/30"
              />
              <button onClick={handleAddNote} disabled={!noteText.trim()}
                className="rounded-lg border border-admin-border px-3 py-1.5 text-xs font-medium text-admin-muted hover:bg-white/5 hover:text-admin-text transition-colors disabled:opacity-30">
                Add
              </button>
            </div>
          )}

          {/* Playbook */}
          <PlaybookPanel alertSources={alertSources} />
        </div>
      )}
    </div>
  );
});

/* ------------------------------------------------------------------ */
/*  Helper components                                                  */
/* ------------------------------------------------------------------ */

function DetailCell({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[10px] text-admin-muted uppercase tracking-wider">{label}</p>
      <p className={cn('mt-0.5 text-xs font-medium text-admin-text', mono && 'font-mono')}>{value}</p>
    </div>
  );
}

function SlaCell({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-admin-card px-3 py-2.5">
      <p className="text-[10px] text-admin-muted uppercase tracking-wider">{label}</p>
      <p className={cn('text-sm font-bold tabular-nums mt-0.5', color ?? 'text-admin-text')}>{value}</p>
    </div>
  );
}

function SessionAdminsOnline() {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-admin-border bg-white/[0.02] px-3 py-1.5">
      <Users className="h-3.5 w-3.5 text-admin-muted" />
      <span className="text-[10px] text-admin-muted">Admins online</span>
      <span className="flex items-center gap-1">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
        <span className="text-[10px] font-bold text-admin-text tabular-nums">1</span>
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Timeline Panel                                                     */
/* ------------------------------------------------------------------ */

function TimelinePanel({ timeline }: { timeline: TimelineEventRow[] }) {
  if (timeline.length === 0) {
    return (
      <div className="rounded-xl border border-admin-border bg-admin-card p-6 text-center text-xs text-admin-muted">
        <Clock className="h-5 w-5 mx-auto mb-2 text-admin-muted/40" />
        No timeline events yet.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-admin-border bg-admin-card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-admin-border px-4 py-3">
        <Clock className="h-4 w-4 text-blue-400" />
        <span className="text-xs font-semibold text-admin-text">Monitoring Timeline</span>
        <span className="text-[10px] text-admin-muted ml-auto">{timeline.length} events</span>
      </div>
      <div className="p-4 space-y-0 max-h-[360px] overflow-y-auto">
        {timeline.map((ev, i) => (
          <div key={ev.id ?? i} className="flex gap-3 pb-3 last:pb-0">
            <div className="flex flex-col items-center">
              <div className={cn('h-2 w-2 rounded-full mt-1.5 shrink-0',
                i === 0 ? 'bg-blue-400 ring-2 ring-blue-400/20' : 'bg-admin-border')} />
              {i < timeline.length - 1 && <div className="w-px flex-1 bg-admin-border/60" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-admin-text">{ev.event_type}{ev.message ? `: ${ev.message}` : ''}</p>
              <p className="text-[10px] text-admin-muted mt-0.5 tabular-nums">
                {new Date(ev.created_at).toLocaleString()}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Event Log Panel                                                    */
/* ------------------------------------------------------------------ */

function EventLogPanel({ events }: { events: ControlEventRow[] }) {
  if (events.length === 0) {
    return (
      <div className="rounded-xl border border-admin-border bg-admin-card p-6 text-center text-xs text-admin-muted">
        <Zap className="h-5 w-5 mx-auto mb-2 text-admin-muted/40" />
        No control events yet.
      </div>
    );
  }

  const severityDot: Record<string, string> = {
    critical: 'bg-red-400',
    high: 'bg-orange-400',
    warning: 'bg-amber-400',
    info: 'bg-blue-400',
  };

  return (
    <div className="rounded-xl border border-admin-border bg-admin-card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-admin-border px-4 py-3">
        <Zap className="h-4 w-4 text-amber-400" />
        <span className="text-xs font-semibold text-admin-text">Control Events</span>
        <span className="text-[10px] text-admin-muted ml-auto">{events.length} events</span>
      </div>
      <div className="divide-y divide-admin-border/50 max-h-[360px] overflow-y-auto">
        {events.map((ev, i) => (
          <div key={i} className="flex items-start gap-3 px-4 py-2.5 hover:bg-white/[0.015] transition-colors">
            <div className={cn('h-1.5 w-1.5 rounded-full mt-1.5 shrink-0', severityDot[ev.severity] ?? 'bg-admin-border')} />
            <div className="min-w-0 flex-1">
              <p className="text-xs text-admin-text truncate">{ev.event}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[10px] text-admin-muted">{ev.service}</span>
                <span className="text-[10px] text-admin-muted tabular-nums">
                  {new Date(ev.timestamp).toLocaleTimeString()}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
