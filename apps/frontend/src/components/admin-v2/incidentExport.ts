/**
 * Incident Report Export — Production Hardening Layer (STEP 3)
 *
 * Generates structured incident reports for compliance and post-mortem.
 * Exports as downloadable JSON. 100% frontend — no backend calls.
 */

import type { Incident } from '@/store/adminIncidents';
import type { SystemAlert } from './alert-engine';

export interface IncidentReport {
  exportedAt: string;
  generator: string;
  incident: {
    id: string;
    title: string;
    severity: string;
    status: string;
    startedAt: string;
    acknowledgedAt: string | null;
    acknowledgedBy: string | null;
    resolvedAt: string | null;
    durationMs: number | null;
    durationHuman: string;
    sla: {
      timeToAcknowledgeMs: number | null;
      timeToAcknowledgeHuman: string;
      timeToResolveMs: number | null;
      timeToResolveHuman: string;
    };
  };
  timeline: Array<{
    timestamp: string;
    type: string;
    description: string;
  }>;
  notes: Array<{
    timestamp: string;
    author: string;
    text: string;
  }>;
  triggeringAlertIds: string[];
  linkedAlerts: Array<{
    id: string;
    severity: string;
    source: string;
    message: string;
    timestamp: string;
  }>;
}

function formatDurationMs(ms: number | null): string {
  if (ms === null || ms <= 0) return '—';
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function generateIncidentReport(incident: Incident, linkedAlerts: SystemAlert[] = []): IncidentReport {
  const durationMs = incident.resolvedAt
    ? incident.resolvedAt - incident.startedAt
    : Date.now() - incident.startedAt;

  const ttaMs = incident.acknowledgedAt
    ? incident.acknowledgedAt - incident.startedAt
    : null;

  const ttrMs = incident.resolvedAt
    ? incident.resolvedAt - incident.startedAt
    : null;

  const timeline: IncidentReport['timeline'] = [];
  timeline.push({
    timestamp: new Date(incident.startedAt).toISOString(),
    type: 'incident_started',
    description: `Incident created: ${incident.title}`,
  });

  if (incident.acknowledgedAt && incident.acknowledgedBy) {
    timeline.push({
      timestamp: new Date(incident.acknowledgedAt).toISOString(),
      type: 'incident_acknowledged',
      description: `Acknowledged by ${incident.acknowledgedBy}`,
    });
  }

  for (const note of incident.notes) {
    timeline.push({
      timestamp: new Date(note.timestamp).toISOString(),
      type: 'note_added',
      description: `[${note.author}] ${note.text}`,
    });
  }

  if (incident.resolvedAt) {
    timeline.push({
      timestamp: new Date(incident.resolvedAt).toISOString(),
      type: 'incident_resolved',
      description: 'Incident resolved',
    });
  }

  for (const alert of linkedAlerts) {
    timeline.push({
      timestamp: new Date(alert.timestamp).toISOString(),
      type: 'alert',
      description: `[${alert.severity.toUpperCase()}] ${alert.source}: ${alert.message}`,
    });
  }

  timeline.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  return {
    exportedAt: new Date().toISOString(),
    generator: 'Exchange Admin Panel v2 — Incident Report Generator',
    incident: {
      id: incident.id,
      title: incident.title,
      severity: incident.severity,
      status: incident.status,
      startedAt: new Date(incident.startedAt).toISOString(),
      acknowledgedAt: incident.acknowledgedAt ? new Date(incident.acknowledgedAt).toISOString() : null,
      acknowledgedBy: incident.acknowledgedBy ?? null,
      resolvedAt: incident.resolvedAt ? new Date(incident.resolvedAt).toISOString() : null,
      durationMs,
      durationHuman: formatDurationMs(durationMs),
      sla: {
        timeToAcknowledgeMs: ttaMs,
        timeToAcknowledgeHuman: formatDurationMs(ttaMs),
        timeToResolveMs: ttrMs,
        timeToResolveHuman: formatDurationMs(ttrMs),
      },
    },
    timeline,
    notes: incident.notes.map((n) => ({
      timestamp: new Date(n.timestamp).toISOString(),
      author: n.author,
      text: n.text,
    })),
    triggeringAlertIds: incident.triggeringAlertIds,
    linkedAlerts: linkedAlerts.map((a) => ({
      id: a.id,
      severity: a.severity,
      source: a.source,
      message: a.message,
      timestamp: new Date(a.timestamp).toISOString(),
    })),
  };
}

export function downloadIncidentReport(report: IncidentReport) {
  const json = JSON.stringify(report, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `incident-report-${report.incident.id.slice(0, 18)}-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
