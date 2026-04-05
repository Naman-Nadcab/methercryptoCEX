'use client';

import { useState, useMemo, memo, useCallback } from 'react';
import {
  Clock, AlertOctagon, AlertTriangle, CheckCircle2, Eye, Search,
  ChevronDown, ChevronRight, MessageSquare, BookOpen, Shield,
  Siren, FileText, Users, Download, Timer, ShieldCheck,
} from 'lucide-react';
import { useAdminIncidentStore, type Incident, type IncidentStatus, type IncidentNote } from '@/store/adminIncidents';
import { useAdminAlertStore } from '@/store/adminAlerts';
import { useAdminAuditLog } from '@/store/adminAuditLog';
import { PlaybookPanel } from './PlaybookPanel';
import { ActiveAdminsIndicator } from './ActiveAdminsIndicator';
import { ReliabilityScore } from './ReliabilityScore';
import { TimelineView } from './TimelineView';
import { SessionActivity } from './SessionActivity';
import { computeSLA, computeAggregateSLA } from './slaMetrics';
import { generateIncidentReport, downloadIncidentReport } from './incidentExport';
import { ADMIN_FEATURE_FLAGS } from '@/lib/admin/featureFlags';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';

type FilterStatus = IncidentStatus | 'all';

const STATUS_CONFIGS: Record<IncidentStatus, { label: string; icon: typeof Siren; dot: string; badge: string; activeBg: string }> = {
  active: { label: 'Active', icon: Siren, dot: 'bg-red-500', badge: 'text-red-700 bg-red-50 border-red-200', activeBg: 'border-red-200 bg-red-50 ring-1 ring-red-500/20' },
  acknowledged: { label: 'Acknowledged', icon: Eye, dot: 'bg-blue-500', badge: 'text-blue-700 bg-blue-50 border-blue-200', activeBg: 'border-blue-200 bg-blue-50 ring-1 ring-blue-500/20' },
  investigating: { label: 'Investigating', icon: Search, dot: 'bg-amber-500', badge: 'text-amber-700 bg-amber-50 border-amber-200', activeBg: 'border-amber-200 bg-amber-50 ring-1 ring-amber-500/20' },
  resolved: { label: 'Resolved', icon: CheckCircle2, dot: 'bg-emerald-500', badge: 'text-emerald-700 bg-emerald-50 border-emerald-200', activeBg: 'border-emerald-200 bg-emerald-50 ring-1 ring-emerald-500/20' },
};

const FILTER_TABS: { value: FilterStatus; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'acknowledged', label: 'Acknowledged' },
  { value: 'investigating', label: 'Investigating' },
  { value: 'resolved', label: 'Resolved' },
];

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

function IncidentHistoryPageInner() {
  const incidents = useAdminIncidentStore((s) => s.incidents);
  const [filter, setFilter] = useState<FilterStatus>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (filter === 'all') return incidents;
    return incidents.filter((inc) => inc.status === filter);
  }, [incidents, filter]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: incidents.length };
    for (const inc of incidents) {
      c[inc.status] = (c[inc.status] ?? 0) + 1;
    }
    return c;
  }, [incidents]);

  const toggleExpand = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-admin-text">Incident History</h1>
          <p className="text-xs text-admin-muted mt-0.5">
            {incidents.length} incident{incidents.length !== 1 ? 's' : ''} tracked
          </p>
        </div>
        <ActiveAdminsIndicator />
      </div>

      {/* Summary cards */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {(['active', 'acknowledged', 'investigating', 'resolved'] as IncidentStatus[]).map((status) => {
          const cfg = STATUS_CONFIGS[status];
          const Icon = cfg.icon;
          const count = counts[status] ?? 0;
          const isActive = filter === status;
          return (
            <button key={status} onClick={() => setFilter(status)}
              className={cn('flex items-center gap-3 rounded-xl border p-3.5 transition-all',
                isActive ? cfg.activeBg : 'border-admin-border bg-admin-card hover:border-admin-border')}>
              <div className={cn('flex h-8 w-8 items-center justify-center rounded-lg shrink-0',
                isActive ? cfg.badge : 'bg-white/[0.02] text-admin-muted')}>
                <Icon className="h-4 w-4" />
              </div>
              <div className="text-left">
                <p className="text-xl font-bold tabular-nums text-admin-text">{count}</p>
                <p className="text-[10px] font-medium uppercase tracking-wider text-admin-muted">{cfg.label}</p>
              </div>
            </button>
          );
        })}
      </section>

      {/* Production Hardening — Reliability + SLA + Timeline + Session */}
      {ADMIN_FEATURE_FLAGS.ADMIN_PRODUCTION_HARDENING && (
        <ProductionHardeningSection incidents={incidents} />
      )}

      {/* Filter tabs */}
      <div className="border-b border-admin-border">
        <nav className="flex gap-0">
          {FILTER_TABS.map((tab) => (
            <button key={tab.value} onClick={() => setFilter(tab.value)}
              className={cn('border-b-2 px-3.5 py-2 text-xs font-medium transition-colors',
                filter === tab.value ? 'border-admin-primary text-admin-primary' : 'border-transparent text-admin-muted hover:text-admin-text')}>
              {tab.label}
              {(counts[tab.value] ?? 0) > 0 && (
                <span className="ml-1.5 text-[10px] tabular-nums text-admin-muted">({counts[tab.value]})</span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Incident list */}
      {filtered.length === 0 ? (
        <div className="text-center py-16">
          <Shield className="w-8 h-8 mx-auto mb-2 text-gray-200" />
          <p className="text-sm text-admin-muted font-medium">No incidents found</p>
          <p className="text-xs text-admin-muted mt-1">
            {filter === 'all'
              ? 'Incidents will appear here when critical alert bursts are detected.'
              : `No ${filter} incidents at the moment.`}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((inc) => (
            <IncidentRow key={inc.id} incident={inc} isExpanded={expandedId === inc.id} onToggle={toggleExpand} />
          ))}
        </div>
      )}
    </div>
  );
}

export const IncidentHistoryPage = memo(IncidentHistoryPageInner);

/* ------------------------------------------------------------------ */
/*  Production Hardening Section                                      */
/* ------------------------------------------------------------------ */

const ProductionHardeningSection = memo(function ProductionHardeningSection({
  incidents,
}: { incidents: Incident[] }) {
  const aggSLA = useMemo(() => computeAggregateSLA(incidents), [incidents]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <ReliabilityScore />

        {/* SLA Summary */}
        <div className="rounded-xl border border-admin-border bg-admin-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <Timer className="w-4 h-4 text-blue-500" />
            <span className="text-[10px] font-semibold uppercase tracking-widest text-admin-muted">SLA Metrics</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[10px] text-admin-muted uppercase tracking-wider">Avg. Time to Ack</p>
              <p className="text-sm font-bold text-admin-text tabular-nums mt-0.5">{aggSLA.avgTTAHuman}</p>
            </div>
            <div>
              <p className="text-[10px] text-admin-muted uppercase tracking-wider">Avg. Time to Resolve</p>
              <p className="text-sm font-bold text-admin-text tabular-nums mt-0.5">{aggSLA.avgTTRHuman}</p>
            </div>
            <div>
              <p className="text-[10px] text-admin-muted uppercase tracking-wider">SLA Compliance</p>
              <p className={cn('text-sm font-bold tabular-nums mt-0.5',
                aggSLA.slaCompliancePercent >= 90 ? 'text-emerald-600' : aggSLA.slaCompliancePercent >= 70 ? 'text-amber-600' : 'text-red-600')}>
                {aggSLA.slaCompliancePercent}%
              </p>
            </div>
            <div>
              <p className="text-[10px] text-admin-muted uppercase tracking-wider">Resolved</p>
              <p className="text-sm font-bold text-admin-text tabular-nums mt-0.5">{aggSLA.totalResolved}</p>
            </div>
          </div>
        </div>

        <SessionActivity />
      </div>

      <TimelineView maxEvents={30} />
    </div>
  );
});

/* ------------------------------------------------------------------ */
/*  Incident Row                                                      */
/* ------------------------------------------------------------------ */

const IncidentRow = memo(function IncidentRow({
  incident, isExpanded, onToggle,
}: { incident: Incident; isExpanded: boolean; onToggle: (id: string) => void }) {
  const cfg = STATUS_CONFIGS[incident.status];
  const duration = formatDuration(incident.startedAt, incident.resolvedAt);

  const alertSources = useMemo(() => {
    const parts = incident.title.split(/[:\-–]/);
    if (parts.length > 1) return parts.slice(1).map((s) => s.trim()).filter(Boolean);
    return ['System'];
  }, [incident.title]);

  return (
    <div className={cn('rounded-xl border transition-all overflow-hidden',
      incident.status === 'active' ? 'border-red-200 bg-red-50/30' : 'border-admin-border bg-admin-card hover:border-admin-border')}>
      <button onClick={() => onToggle(incident.id)} className="w-full px-4 py-3 flex items-center gap-3 text-left">
        {isExpanded
          ? <ChevronDown className="w-4 h-4 text-admin-muted shrink-0" />
          : <ChevronRight className="w-4 h-4 text-admin-muted shrink-0" />}

        <div className={cn('w-2 h-2 rounded-full shrink-0', cfg.dot, incident.status === 'active' && 'animate-pulse')} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-admin-text truncate">{incident.title}</span>
            <span className={cn('inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border', cfg.badge)}>
              {cfg.label}
            </span>
            <span className={cn('text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded border',
              incident.severity === 'critical' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-amber-50 text-amber-700 border-amber-200')}>
              {incident.severity}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-1 text-[10px] text-admin-muted">
            <span>{formatTime(incident.startedAt)}</span>
            <span>·</span>
            <span className="flex items-center gap-1"><Clock className="w-2.5 h-2.5" />{duration}</span>
            {incident.notes.length > 0 && (
              <>
                <span>·</span>
                <span className="flex items-center gap-1"><MessageSquare className="w-2.5 h-2.5" />{incident.notes.length} note{incident.notes.length !== 1 ? 's' : ''}</span>
              </>
            )}
            {incident.acknowledgedBy && (
              <>
                <span>·</span>
                <span>Acked by {incident.acknowledgedBy}</span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 text-[10px] text-admin-muted shrink-0">
          <AlertOctagon className="w-3 h-3" />
          {incident.triggeringAlertIds.length}
        </div>
      </button>

      {isExpanded && (
        <IncidentExpandedDetails incident={incident} duration={duration} alertSources={alertSources} />
      )}
    </div>
  );
});

/* ------------------------------------------------------------------ */
/*  Incident Expanded Details                                         */
/* ------------------------------------------------------------------ */

const IncidentExpandedDetails = memo(function IncidentExpandedDetails({
  incident, duration, alertSources,
}: { incident: Incident; duration: string; alertSources: string[] }) {
  const logAudit = useAdminAuditLog((s) => s.logAction);
  const allAlerts = useAdminAlertStore((s) => s.alerts);

  const sla = useMemo(() => computeSLA(incident), [incident]);
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
    if (ADMIN_FEATURE_FLAGS.ADMIN_PRODUCTION_HARDENING) {
      logAudit('report_exported', { incidentId: incident.id });
    }
  }, [incident, linkedAlerts, logAudit]);

  return (
    <div className="px-4 pb-4 pt-1 border-t border-admin-border/50 space-y-4">
      {/* Details grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <DetailCell label="Incident ID" value={incident.id.slice(0, 18)} mono />
        <DetailCell label="Started" value={formatTime(incident.startedAt)} />
        <DetailCell label="Duration" value={duration} />
        <DetailCell label="Acknowledged By" value={incident.acknowledgedBy ?? '—'} />
        {incident.acknowledgedAt && <DetailCell label="Acknowledged At" value={formatTime(incident.acknowledgedAt)} />}
        {incident.resolvedAt && <DetailCell label="Resolved At" value={formatTime(incident.resolvedAt)} />}
        <DetailCell label="Triggering Alerts" value={String(incident.triggeringAlertIds.length)} />
        <DetailCell label="Notes" value={String(incident.notes.length)} />
      </div>

      {/* SLA Metrics */}
      {ADMIN_FEATURE_FLAGS.ADMIN_PRODUCTION_HARDENING && (
        <div className="flex items-center gap-4 py-2.5 px-3 rounded-lg border border-admin-border bg-white/[0.02]">
          <Timer className="w-3.5 h-3.5 text-blue-500 shrink-0" />
          <div className="flex items-center gap-4 text-xs flex-wrap">
            <div>
              <span className="text-admin-muted">Acknowledged in </span>
              <span className={cn('font-medium tabular-nums', sla.timeToAcknowledgeMs !== null && sla.timeToAcknowledgeMs <= 120_000 ? 'text-emerald-600' : 'text-amber-600')}>
                {sla.timeToAcknowledgeHuman}
              </span>
            </div>
            <div>
              <span className="text-admin-muted">Resolved in </span>
              <span className={cn('font-medium tabular-nums', sla.timeToResolveMs !== null && sla.timeToResolveMs <= 900_000 ? 'text-emerald-600' : 'text-amber-600')}>
                {sla.timeToResolveHuman}
              </span>
            </div>
            {sla.withinSLA ? (
              <span className="flex items-center gap-1 text-emerald-600 text-[10px] font-semibold">
                <ShieldCheck className="w-3 h-3" /> Within SLA
              </span>
            ) : (
              <span className="flex items-center gap-1 text-red-600 text-[10px] font-semibold">
                <AlertTriangle className="w-3 h-3" /> SLA Breached
              </span>
            )}
          </div>
          <Button variant="secondary" size="sm" onClick={handleExport} className="ml-auto shrink-0"
            icon={<Download className="h-3 w-3" />}>
            Export
          </Button>
        </div>
      )}

      {/* Notes */}
      {incident.notes.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-admin-muted">
            <MessageSquare className="w-3 h-3" />
            <span className="font-medium">Notes</span>
          </div>
          <div className="space-y-1.5 max-h-[200px] overflow-y-auto pr-1">
            {incident.notes.map((note) => (<NoteRow key={note.id} note={note} />))}
          </div>
        </div>
      )}

      {/* Playbook */}
      <PlaybookPanel alertSources={alertSources} />
    </div>
  );
});

const DetailCell = memo(function DetailCell({ label, value, mono }: {
  label: string; value: string; mono?: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] text-admin-muted uppercase tracking-wider">{label}</p>
      <p className={cn('mt-0.5 text-xs font-medium text-admin-text', mono && 'font-mono')}>{value}</p>
    </div>
  );
});

const NoteRow = memo(function NoteRow({ note }: { note: IncidentNote }) {
  return (
    <div className="flex gap-2 py-1.5 px-2.5 rounded-lg bg-white/[0.02] border border-admin-border/60">
      <FileText className="w-3 h-3 text-admin-muted mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-xs text-admin-text leading-relaxed">{note.text}</p>
        <div className="flex items-center gap-2 mt-0.5 text-[10px] text-admin-muted">
          <span className="font-medium text-admin-muted">{note.author}</span>
          <span>·</span>
          <span>{formatTime(note.timestamp)}</span>
        </div>
      </div>
    </div>
  );
});
