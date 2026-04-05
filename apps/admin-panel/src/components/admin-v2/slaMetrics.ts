/**
 * SLA Metrics — Production Hardening Layer (STEP 5)
 *
 * Computes SLA metrics for incidents:
 * - Time to Acknowledge (TTA)
 * - Time to Resolve (TTR)
 *
 * Returns human-readable strings + raw milliseconds.
 */

import type { Incident } from '@/store/adminIncidents';

export interface SLAMetrics {
  timeToAcknowledgeMs: number | null;
  timeToAcknowledgeHuman: string;
  timeToResolveMs: number | null;
  timeToResolveHuman: string;
  withinSLA: boolean;
}

const SLA_TARGETS = {
  acknowledgeMs: 120_000,
  resolveMs: 900_000,
};

function formatMs(ms: number | null): string {
  if (ms === null || ms < 0) return '—';
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

export function computeSLA(incident: Incident): SLAMetrics {
  const ttaMs = incident.acknowledgedAt
    ? incident.acknowledgedAt - incident.startedAt
    : null;

  const ttrMs = incident.resolvedAt
    ? incident.resolvedAt - incident.startedAt
    : null;

  const ackWithinSLA = ttaMs !== null ? ttaMs <= SLA_TARGETS.acknowledgeMs : true;
  const resolveWithinSLA = ttrMs !== null ? ttrMs <= SLA_TARGETS.resolveMs : true;

  return {
    timeToAcknowledgeMs: ttaMs,
    timeToAcknowledgeHuman: formatMs(ttaMs),
    timeToResolveMs: ttrMs,
    timeToResolveHuman: formatMs(ttrMs),
    withinSLA: ackWithinSLA && resolveWithinSLA,
  };
}

export interface AggregateSLA {
  avgTTAMs: number;
  avgTTRMs: number;
  avgTTAHuman: string;
  avgTTRHuman: string;
  slaCompliancePercent: number;
  totalResolved: number;
}

export function computeAggregateSLA(incidents: Incident[]): AggregateSLA {
  const resolved = incidents.filter((i) => i.status === 'resolved');
  if (resolved.length === 0) {
    return { avgTTAMs: 0, avgTTRMs: 0, avgTTAHuman: '—', avgTTRHuman: '—', slaCompliancePercent: 100, totalResolved: 0 };
  }

  let totalTTA = 0, ttaCount = 0;
  let totalTTR = 0, ttrCount = 0;
  let withinSLA = 0;

  for (const inc of resolved) {
    const sla = computeSLA(inc);
    if (sla.timeToAcknowledgeMs !== null) {
      totalTTA += sla.timeToAcknowledgeMs;
      ttaCount++;
    }
    if (sla.timeToResolveMs !== null) {
      totalTTR += sla.timeToResolveMs;
      ttrCount++;
    }
    if (sla.withinSLA) withinSLA++;
  }

  const avgTTA = ttaCount > 0 ? totalTTA / ttaCount : 0;
  const avgTTR = ttrCount > 0 ? totalTTR / ttrCount : 0;

  return {
    avgTTAMs: avgTTA,
    avgTTRMs: avgTTR,
    avgTTAHuman: formatMs(avgTTA),
    avgTTRHuman: formatMs(avgTTR),
    slaCompliancePercent: Math.round((withinSLA / resolved.length) * 100),
    totalResolved: resolved.length,
  };
}
