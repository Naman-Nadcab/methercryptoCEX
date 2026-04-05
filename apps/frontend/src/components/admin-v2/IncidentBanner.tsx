'use client';

import { useState, useEffect, useMemo, memo, useCallback } from 'react';
import {
  Siren, Clock, User, CheckCircle2, ChevronDown, ChevronUp,
  MessageSquare, Search, AlertOctagon, AlertTriangle, Send,
  Eye, Shield, BookOpen,
} from 'lucide-react';
import { useAdminIncidentStore, type Incident, type IncidentNote } from '@/store/adminIncidents';
import { useAdminAlertStore } from '@/store/adminAlerts';
import { PlaybookPanel } from './PlaybookPanel';
import type { SystemAlert } from './alert-engine';

// --- STEP 6: Live timer that updates every second ---
function useElapsedTimer(startedAt: number | undefined) {
  const [elapsed, setElapsed] = useState('0s');

  useEffect(() => {
    if (!startedAt) return;
    const tick = () => setElapsed(formatElapsed(startedAt));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  return elapsed;
}

function formatElapsed(startedAt: number): string {
  const diff = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) {
    const m = Math.floor(diff / 60);
    const s = diff % 60;
    return s > 0 ? `${m}m ${s}s ago` : `${m}m ago`;
  }
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  return m > 0 ? `${h}h ${m}m ago` : `${h}h ago`;
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// --- Status badge config ---
const STATUS_LABEL: Record<Incident['status'], { text: string; class: string }> = {
  active: { text: 'ACTIVE', class: 'bg-red-500/20 text-red-400 border-red-500/30' },
  acknowledged: { text: 'ACKNOWLEDGED', class: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  investigating: { text: 'INVESTIGATING', class: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
  resolved: { text: 'RESOLVED', class: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
};

// --- STEP 8: Filter alerts within 30s of incident start ---
const ALERT_LINK_WINDOW_MS = 30_000;

function useLinkedAlerts(incident: Incident | null): SystemAlert[] {
  const allAlerts = useAdminAlertStore((s) => s.alerts);

  return useMemo(() => {
    if (!incident) return [];
    const windowStart = incident.startedAt - ALERT_LINK_WINDOW_MS;
    const windowEnd = incident.startedAt + ALERT_LINK_WINDOW_MS;

    const byId = allAlerts.filter((a) => incident.triggeringAlertIds.includes(a.id));
    const byTime = allAlerts.filter(
      (a) => a.timestamp >= windowStart && a.timestamp <= windowEnd && !incident.triggeringAlertIds.includes(a.id)
    );
    return [...byId, ...byTime];
  }, [incident, allAlerts]);
}

function IncidentBannerInner() {
  const activeIncident = useAdminIncidentStore((s) => s.activeIncident);
  const acknowledgeIncident = useAdminIncidentStore((s) => s.acknowledgeIncident);
  const markInvestigating = useAdminIncidentStore((s) => s.markInvestigating);
  const resolveIncident = useAdminIncidentStore((s) => s.resolveIncident);
  const addNote = useAdminIncidentStore((s) => s.addNote);

  const elapsed = useElapsedTimer(activeIncident?.startedAt);
  const linkedAlerts = useLinkedAlerts(activeIncident);

  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<'details' | 'notes' | 'alerts' | 'playbook'>('details');
  const [noteInput, setNoteInput] = useState('');

  const handleAcknowledge = useCallback(() => {
    if (!activeIncident) return;
    acknowledgeIncident(activeIncident.id, 'Admin');
  }, [activeIncident, acknowledgeIncident]);

  const handleInvestigating = useCallback(() => {
    if (!activeIncident) return;
    markInvestigating(activeIncident.id);
  }, [activeIncident, markInvestigating]);

  const handleResolve = useCallback(() => {
    if (!activeIncident) return;
    resolveIncident(activeIncident.id);
  }, [activeIncident, resolveIncident]);

  const handleAddNote = useCallback(() => {
    if (!activeIncident || !noteInput.trim()) return;
    addNote(activeIncident.id, noteInput.trim());
    setNoteInput('');
  }, [activeIncident, noteInput, addNote]);

  const alertSources = useMemo(() => {
    if (!activeIncident) return [];
    return linkedAlerts.map((a) => a.source).filter((v, i, arr) => arr.indexOf(v) === i);
  }, [activeIncident, linkedAlerts]);

  if (!activeIncident) return null;

  const statusCfg = STATUS_LABEL[activeIncident.status];
  const isUnresolved = activeIncident.status !== 'resolved';

  return (
    <div className="rounded-xl overflow-hidden border border-red-500/30 animate-admin-fade-in">
      {/* === Main banner row === */}
      <div className={`px-4 py-3 ${
        activeIncident.status === 'active'
          ? 'bg-gradient-to-r from-red-950/60 via-red-900/40 to-red-950/60'
          : activeIncident.status === 'acknowledged'
            ? 'bg-gradient-to-r from-blue-950/40 via-blue-900/30 to-blue-950/40'
            : 'bg-gradient-to-r from-amber-950/40 via-amber-900/30 to-amber-950/40'
      }`}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          {/* Left: Icon + Title */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="relative shrink-0">
              <Siren className="w-5 h-5 text-red-400" />
              {activeIncident.status === 'active' && (
                <>
                  <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-red-500 animate-ping" />
                  <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-red-500" />
                </>
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-bold text-red-400 uppercase tracking-wider">Incident</span>
                <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border ${statusCfg.class}`}>
                  {statusCfg.text}
                </span>
                {linkedAlerts.length > 0 && (
                  <span className="text-[10px] text-zinc-500">
                    {linkedAlerts.length} linked alert{linkedAlerts.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <p className="text-sm text-[#E5E7EB] font-medium mt-0.5 truncate">{activeIncident.title}</p>
            </div>
          </div>

          {/* Right: Timer + Actions */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* STEP 6: "Started 2m ago" timer */}
            <div className="flex items-center gap-1.5 text-xs text-zinc-400 bg-[#0F1117]/50 rounded-lg px-2.5 py-1">
              <Clock className="w-3.5 h-3.5" />
              <span className="tabular-nums font-mono">Started {elapsed}</span>
            </div>

            {activeIncident.acknowledgedBy && (
              <div className="flex items-center gap-1.5 text-xs text-zinc-400 bg-[#0F1117]/50 rounded-lg px-2.5 py-1">
                <User className="w-3.5 h-3.5" />
                <span>{activeIncident.acknowledgedBy}</span>
              </div>
            )}

            {/* STEP 5: Three lifecycle buttons */}
            {activeIncident.status === 'active' && (
              <button onClick={handleAcknowledge}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-blue-400 border border-blue-500/30 rounded-lg hover:bg-blue-500/10 transition-all duration-200 active:scale-95">
                <Eye className="w-3 h-3" />
                Acknowledge
              </button>
            )}

            {(activeIncident.status === 'active' || activeIncident.status === 'acknowledged') && (
              <button onClick={handleInvestigating}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-amber-400 border border-amber-500/30 rounded-lg hover:bg-amber-500/10 transition-all duration-200 active:scale-95">
                <Search className="w-3 h-3" />
                Investigating
              </button>
            )}

            {isUnresolved && (
              <button onClick={handleResolve}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-emerald-400 border border-emerald-500/30 rounded-lg hover:bg-emerald-500/10 transition-all duration-200 active:scale-95">
                <CheckCircle2 className="w-3 h-3" />
                Resolve
              </button>
            )}

            <button onClick={() => setExpanded((s) => !s)}
              className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-white/5 transition-colors">
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>

      {/* === Expanded panel with tabs === */}
      {expanded && (
        <div className="bg-[#151922] border-t border-red-500/10 animate-admin-slide-up">
          {/* Tab bar */}
          <div className="flex items-center gap-1 px-4 pt-3 pb-0">
            {(['details', 'notes', 'alerts', 'playbook'] as const).map((tab) => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                className={`px-3 py-1.5 text-[11px] font-medium rounded-t-lg transition-colors ${
                  activeTab === tab
                    ? 'bg-[#0F1117] text-[#E5E7EB] border border-b-0 border-[#1F2937]'
                    : 'text-zinc-500 hover:text-zinc-400 hover:bg-white/[0.02]'
                }`}>
                {tab === 'details' && 'Details'}
                {tab === 'notes' && `Notes (${activeIncident.notes.length})`}
                {tab === 'alerts' && `Alerts (${linkedAlerts.length})`}
                {tab === 'playbook' && 'Playbook'}
              </button>
            ))}
          </div>

          <div className="px-4 py-3 min-h-[120px]">
            {/* --- Details Tab --- */}
            {activeTab === 'details' && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <DetailCell label="Incident ID" value={activeIncident.id.slice(0, 18)} mono />
                <DetailCell label="Severity"
                  value={activeIncident.severity.toUpperCase()}
                  valueClass={activeIncident.severity === 'critical' ? 'text-red-400' : 'text-amber-400'}
                />
                <DetailCell label="Started" value={formatTimestamp(activeIncident.startedAt)} />
                <DetailCell label="Duration" value={elapsed} />
                <DetailCell label="Status" value={statusCfg.text} />
                <DetailCell label="Acknowledged By" value={activeIncident.acknowledgedBy ?? '—'} />
                <DetailCell label="Acknowledged At"
                  value={activeIncident.acknowledgedAt ? formatTimestamp(activeIncident.acknowledgedAt) : '—'}
                />
                <DetailCell label="Triggering Alerts" value={String(activeIncident.triggeringAlertIds.length)} />
              </div>
            )}

            {/* --- STEP 7: Notes Tab --- */}
            {activeTab === 'notes' && (
              <div className="space-y-3">
                {/* Note list */}
                {activeIncident.notes.length === 0 ? (
                  <div className="text-center py-6 text-xs text-zinc-600">
                    <MessageSquare className="w-5 h-5 mx-auto mb-2 text-zinc-700" />
                    No notes yet. Add context for your team.
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[200px] overflow-y-auto pr-1">
                    {activeIncident.notes.map((note) => (
                      <NoteEntry key={note.id} note={note} />
                    ))}
                  </div>
                )}

                {/* Add note input */}
                {isUnresolved && (
                  <div className="flex items-center gap-2 pt-2 border-t border-[#1F2937]">
                    <input
                      type="text"
                      value={noteInput}
                      onChange={(e) => setNoteInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleAddNote()}
                      placeholder="Add incident note — e.g. &quot;High latency due to DB spike&quot;"
                      className="flex-1 bg-[#0F1117] border border-[#1F2937] rounded-lg px-3 py-2 text-xs text-[#E5E7EB] placeholder:text-zinc-700 focus:outline-none focus:ring-1 focus:ring-red-500/30 transition-colors"
                    />
                    <button onClick={handleAddNote} disabled={!noteInput.trim()}
                      className="flex items-center gap-1.5 px-3 py-2 text-[11px] font-medium text-zinc-400 border border-[#1F2937] rounded-lg hover:bg-white/5 hover:text-zinc-300 transition-colors disabled:opacity-30 disabled:cursor-not-allowed active:scale-95">
                      <Send className="w-3 h-3" />
                      Add
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* --- STEP 8: Linked Alerts Tab --- */}
            {activeTab === 'alerts' && (
              <div>
                {linkedAlerts.length === 0 ? (
                  <div className="text-center py-6 text-xs text-zinc-600">
                    <Shield className="w-5 h-5 mx-auto mb-2 text-zinc-700" />
                    No alerts found within 30s of incident start.
                  </div>
                ) : (
                  <div className="space-y-1 max-h-[240px] overflow-y-auto pr-1">
                    {linkedAlerts.map((alert) => (
                      <LinkedAlertRow key={alert.id} alert={alert} incidentStart={activeIncident.startedAt} />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* --- Playbook Tab --- */}
            {activeTab === 'playbook' && (
              <div className="max-h-[320px] overflow-y-auto pr-1">
                <PlaybookPanel alertSources={alertSources} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export const IncidentBanner = memo(IncidentBannerInner);

// --- Sub-components ---

const DetailCell = memo(function DetailCell({ label, value, mono, valueClass }: {
  label: string; value: string; mono?: boolean; valueClass?: string;
}) {
  return (
    <div>
      <span className="text-zinc-600 uppercase tracking-wider text-[10px]">{label}</span>
      <p className={`mt-0.5 text-xs font-medium ${valueClass ?? 'text-zinc-300'} ${mono ? 'font-mono' : ''}`}>
        {value}
      </p>
    </div>
  );
});

const NoteEntry = memo(function NoteEntry({ note }: { note: IncidentNote }) {
  return (
    <div className="flex gap-2.5 py-2 px-2.5 rounded-lg bg-[#0F1117]/60 border border-[#1F2937]/50">
      <MessageSquare className="w-3.5 h-3.5 text-zinc-600 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-xs text-[#E5E7EB] leading-relaxed">{note.text}</p>
        <div className="flex items-center gap-2 mt-1 text-[10px] text-zinc-600">
          <span className="font-medium text-zinc-500">{note.author}</span>
          <span>·</span>
          <span>{formatTimestamp(note.timestamp)}</span>
        </div>
      </div>
    </div>
  );
});

const LinkedAlertRow = memo(function LinkedAlertRow({ alert, incidentStart }: {
  alert: SystemAlert; incidentStart: number;
}) {
  const isCritical = alert.severity === 'critical';
  const relativeMs = alert.timestamp - incidentStart;
  const relativeLabel = relativeMs >= 0
    ? `+${Math.floor(relativeMs / 1000)}s`
    : `${Math.floor(relativeMs / 1000)}s`;

  return (
    <div className={`flex items-start gap-2.5 py-2 px-2.5 rounded-lg transition-colors ${
      isCritical ? 'bg-red-500/[0.04] border border-red-500/10' : 'bg-[#0F1117]/40 border border-[#1F2937]/40'
    }`}>
      {isCritical
        ? <AlertOctagon className="w-3.5 h-3.5 mt-0.5 text-red-400 shrink-0" />
        : <AlertTriangle className="w-3.5 h-3.5 mt-0.5 text-amber-400 shrink-0" />
      }
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className={`text-[10px] font-semibold uppercase tracking-wider ${
            isCritical ? 'text-red-400' : 'text-amber-400'
          }`}>
            {alert.severity}
          </span>
          <span className="text-[10px] text-zinc-600">·</span>
          <span className="text-[10px] text-zinc-500">{alert.source}</span>
          <span className="text-[10px] text-zinc-600 ml-auto tabular-nums font-mono">{relativeLabel}</span>
        </div>
        <p className="text-xs text-[#E5E7EB] leading-relaxed truncate">{alert.message}</p>
        <div className="flex items-center gap-1 mt-0.5 text-[10px] text-zinc-600">
          <Clock className="w-2.5 h-2.5" />
          {formatTimestamp(alert.timestamp)}
        </div>
      </div>
    </div>
  );
});
