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
import { computeSLA, computeAggregateSLA, type SLAMetrics } from './slaMetrics';
import { generateIncidentReport, downloadIncidentReport } from './incidentExport';
import { ADMIN_FEATURE_FLAGS } from '@/lib/admin/featureFlags';

type FilterStatus = IncidentStatus | 'all';

const STATUS_CONFIGS: Record<IncidentStatus, { label: string; icon: typeof Siren; class: string; dotClass: string }> = {
  active: { label: 'Active', icon: Siren, class: 'text-red-400 bg-red-500/10 border-red-500/20', dotClass: 'bg-red-500' },
  acknowledged: { label: 'Acknowledged', icon: Eye, class: 'text-blue-400 bg-blue-500/10 border-blue-500/20', dotClass: 'bg-blue-500' },
  investigating: { label: 'Investigating', icon: Search, class: 'text-amber-400 bg-amber-500/10 border-amber-500/20', dotClass: 'bg-amber-500' },
  resolved: { label: 'Resolved', icon: CheckCircle2, class: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', dotClass: 'bg-emerald-500' },
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
    <div className="min-h-screen bg-[#0F1117] text-[#E5E7EB]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/20">
                <Siren className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-[#E5E7EB]">Incident History</h1>
                <p className="text-xs text-zinc-500 mt-0.5">
                  {incidents.length} incident{incidents.length !== 1 ? 's' : ''} tracked
                </p>
              </div>
            </div>
          </div>
          <ActiveAdminsIndicator />
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {(['active', 'acknowledged', 'investigating', 'resolved'] as IncidentStatus[]).map((status) => {
            const cfg = STATUS_CONFIGS[status];
            const Icon = cfg.icon;
            const count = counts[status] ?? 0;
            return (
              <button
                key={status}
                onClick={() => setFilter(status)}
                className={`flex items-center gap-3 p-3 rounded-xl border transition-all duration-200 hover:scale-[1.02] ${
                  filter === status
                    ? cfg.class + ' ring-1 ring-current'
                    : 'border-[#1F2937] bg-[#151922] hover:border-zinc-700'
                }`}
              >
                <Icon className={`w-4 h-4 ${filter === status ? '' : 'text-zinc-500'}`} />
                <div className="text-left">
                  <div className={`text-lg font-bold tabular-nums ${filter === status ? '' : 'text-[#E5E7EB]'}`}>
                    {count}
                  </div>
                  <div className="text-[10px] uppercase tracking-wider text-zinc-500">{cfg.label}</div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Production Hardening — Reliability + SLA + Timeline + Session */}
        {ADMIN_FEATURE_FLAGS.ADMIN_PRODUCTION_HARDENING && (
          <ProductionHardeningSection incidents={incidents} />
        )}

        {/* Filter tabs */}
        <div className="flex items-center gap-1 border-b border-[#1F2937] pb-0">
          {FILTER_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setFilter(tab.value)}
              className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                filter === tab.value
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {tab.label}
              {(counts[tab.value] ?? 0) > 0 && (
                <span className="ml-1.5 text-[10px] tabular-nums text-zinc-600">
                  ({counts[tab.value]})
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Incident list */}
        {filtered.length === 0 ? (
          <div className="text-center py-16">
            <Shield className="w-10 h-10 mx-auto mb-3 text-zinc-700" />
            <p className="text-sm text-zinc-500">No incidents found</p>
            <p className="text-xs text-zinc-700 mt-1">
              {filter === 'all'
                ? 'Incidents will appear here when critical alert bursts are detected.'
                : `No ${filter} incidents at the moment.`}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((inc) => (
              <IncidentRow
                key={inc.id}
                incident={inc}
                isExpanded={expandedId === inc.id}
                onToggle={toggleExpand}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export const IncidentHistoryPage = memo(IncidentHistoryPageInner);

// --- Production Hardening Section ---

const ProductionHardeningSection = memo(function ProductionHardeningSection({
  incidents,
}: { incidents: Incident[] }) {
  const aggSLA = useMemo(() => computeAggregateSLA(incidents), [incidents]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Reliability Score */}
        <ReliabilityScore />

        {/* SLA Summary */}
        <div className="rounded-xl border border-[#1F2937] bg-[#151922] p-4">
          <div className="flex items-center gap-2 mb-3">
            <Timer className="w-4 h-4 text-blue-400" />
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">SLA Metrics</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className="text-[10px] text-zinc-600 uppercase tracking-wider">Avg. Time to Ack</span>
              <p className="text-sm font-bold text-[#E5E7EB] tabular-nums mt-0.5">{aggSLA.avgTTAHuman}</p>
            </div>
            <div>
              <span className="text-[10px] text-zinc-600 uppercase tracking-wider">Avg. Time to Resolve</span>
              <p className="text-sm font-bold text-[#E5E7EB] tabular-nums mt-0.5">{aggSLA.avgTTRHuman}</p>
            </div>
            <div>
              <span className="text-[10px] text-zinc-600 uppercase tracking-wider">SLA Compliance</span>
              <p className={`text-sm font-bold tabular-nums mt-0.5 ${aggSLA.slaCompliancePercent >= 90 ? 'text-emerald-400' : aggSLA.slaCompliancePercent >= 70 ? 'text-amber-400' : 'text-red-400'}`}>
                {aggSLA.slaCompliancePercent}%
              </p>
            </div>
            <div>
              <span className="text-[10px] text-zinc-600 uppercase tracking-wider">Resolved</span>
              <p className="text-sm font-bold text-[#E5E7EB] tabular-nums mt-0.5">{aggSLA.totalResolved}</p>
            </div>
          </div>
        </div>

        {/* Session Activity */}
        <SessionActivity />
      </div>

      {/* Timeline */}
      <TimelineView maxEvents={30} />
    </div>
  );
});

// --- Incident Row ---

const IncidentRow = memo(function IncidentRow({
  incident,
  isExpanded,
  onToggle,
}: {
  incident: Incident;
  isExpanded: boolean;
  onToggle: (id: string) => void;
}) {
  const cfg = STATUS_CONFIGS[incident.status];
  const Icon = cfg.icon;
  const duration = formatDuration(incident.startedAt, incident.resolvedAt);

  const alertSources = useMemo(() => {
    const parts = incident.title.split(/[:\-–]/);
    if (parts.length > 1) return parts.slice(1).map((s) => s.trim()).filter(Boolean);
    return ['System'];
  }, [incident.title]);

  return (
    <div className={`rounded-xl border transition-all duration-200 overflow-hidden ${
      incident.status === 'active'
        ? 'border-red-500/30 bg-[#151922] shadow-[0_0_12px_-4px_rgba(239,68,68,0.15)]'
        : 'border-[#1F2937] bg-[#151922] hover:border-zinc-700'
    }`}>
      {/* Main row */}
      <button
        onClick={() => onToggle(incident.id)}
        className="w-full px-4 py-3 flex items-center gap-3 text-left"
      >
        {isExpanded
          ? <ChevronDown className="w-4 h-4 text-zinc-500 shrink-0" />
          : <ChevronRight className="w-4 h-4 text-zinc-500 shrink-0" />
        }

        <div className={`w-2 h-2 rounded-full shrink-0 ${cfg.dotClass} ${
          incident.status === 'active' ? 'animate-pulse' : ''
        }`} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-[#E5E7EB] truncate">{incident.title}</span>
            <span className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border ${cfg.class}`}>
              <Icon className="w-2.5 h-2.5" />
              {cfg.label}
            </span>
            <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded ${
              incident.severity === 'critical'
                ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
            }`}>
              {incident.severity}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-1 text-[10px] text-zinc-600">
            <span>{formatTime(incident.startedAt)}</span>
            <span>·</span>
            <span className="flex items-center gap-1">
              <Clock className="w-2.5 h-2.5" />
              {duration}
            </span>
            {incident.notes.length > 0 && (
              <>
                <span>·</span>
                <span className="flex items-center gap-1">
                  <MessageSquare className="w-2.5 h-2.5" />
                  {incident.notes.length} note{incident.notes.length !== 1 ? 's' : ''}
                </span>
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

        <div className="flex items-center gap-1 text-[10px] text-zinc-600 shrink-0">
          <AlertOctagon className="w-3 h-3" />
          {incident.triggeringAlertIds.length}
        </div>
      </button>

      {/* Expanded details */}
      {isExpanded && (
        <IncidentExpandedDetails incident={incident} duration={duration} alertSources={alertSources} />
      )}
    </div>
  );
});

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
    <div className="px-4 pb-4 pt-1 border-t border-[#1F2937]/50 space-y-4 animate-admin-slide-up">
      {/* Details grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <DetailCell label="Incident ID" value={incident.id.slice(0, 18)} mono />
        <DetailCell label="Started" value={formatTime(incident.startedAt)} />
        <DetailCell label="Duration" value={duration} />
        <DetailCell label="Acknowledged By" value={incident.acknowledgedBy ?? '—'} />
        {incident.acknowledgedAt && (
          <DetailCell label="Acknowledged At" value={formatTime(incident.acknowledgedAt)} />
        )}
        {incident.resolvedAt && (
          <DetailCell label="Resolved At" value={formatTime(incident.resolvedAt)} />
        )}
        <DetailCell label="Triggering Alerts" value={String(incident.triggeringAlertIds.length)} />
        <DetailCell label="Notes" value={String(incident.notes.length)} />
      </div>

      {/* SLA Metrics */}
      {ADMIN_FEATURE_FLAGS.ADMIN_PRODUCTION_HARDENING && (
        <div className="flex items-center gap-4 py-2 px-3 rounded-lg border border-[#1F2937] bg-[#0F1117]/40">
          <Timer className="w-3.5 h-3.5 text-blue-400 shrink-0" />
          <div className="flex items-center gap-4 text-xs flex-wrap">
            <div>
              <span className="text-zinc-600">Acknowledged in </span>
              <span className={`font-medium tabular-nums ${sla.timeToAcknowledgeMs !== null && sla.timeToAcknowledgeMs <= 120_000 ? 'text-emerald-400' : 'text-amber-400'}`}>
                {sla.timeToAcknowledgeHuman}
              </span>
            </div>
            <div>
              <span className="text-zinc-600">Resolved in </span>
              <span className={`font-medium tabular-nums ${sla.timeToResolveMs !== null && sla.timeToResolveMs <= 900_000 ? 'text-emerald-400' : 'text-amber-400'}`}>
                {sla.timeToResolveHuman}
              </span>
            </div>
            {sla.withinSLA ? (
              <span className="flex items-center gap-1 text-emerald-400 text-[10px] font-semibold">
                <ShieldCheck className="w-3 h-3" /> Within SLA
              </span>
            ) : (
              <span className="flex items-center gap-1 text-red-400 text-[10px] font-semibold">
                <AlertTriangle className="w-3 h-3" /> SLA Breached
              </span>
            )}
          </div>
          <button
            onClick={handleExport}
            className="ml-auto flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-medium text-cyan-400 border border-cyan-500/20 rounded-lg hover:bg-cyan-500/10 transition-colors shrink-0"
          >
            <Download className="w-3 h-3" />
            Export Report
          </button>
        </div>
      )}

      {/* Notes */}
      {incident.notes.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-zinc-400">
            <MessageSquare className="w-3 h-3" />
            <span className="font-medium">Notes</span>
          </div>
          <div className="space-y-1.5 max-h-[200px] overflow-y-auto pr-1">
            {incident.notes.map((note) => (
              <NoteRow key={note.id} note={note} />
            ))}
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
      <span className="text-zinc-600 uppercase tracking-wider text-[10px]">{label}</span>
      <p className={`mt-0.5 text-xs font-medium text-zinc-300 ${mono ? 'font-mono' : ''}`}>
        {value}
      </p>
    </div>
  );
});

const NoteRow = memo(function NoteRow({ note }: { note: IncidentNote }) {
  return (
    <div className="flex gap-2 py-1.5 px-2.5 rounded-lg bg-[#0F1117]/60 border border-[#1F2937]/40">
      <FileText className="w-3 h-3 text-zinc-600 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-xs text-[#E5E7EB] leading-relaxed">{note.text}</p>
        <div className="flex items-center gap-2 mt-0.5 text-[10px] text-zinc-600">
          <span className="font-medium text-zinc-500">{note.author}</span>
          <span>·</span>
          <span>{formatTime(note.timestamp)}</span>
        </div>
      </div>
    </div>
  );
});
