/**
 * Predictive → Incident Linker (STEP 6)
 *
 * Tracks which trend types were predicted. If a REAL critical/warning alert
 * fires for a metric that was predicted, auto-links the prediction to
 * the incident by adding a note documenting the foresight.
 *
 * This is informational only — does NOT auto-create incidents or trigger
 * any automated actions.
 */

import { useRef, useCallback } from 'react';
import type { TrendPrediction } from './useTrendAnalyzer';
import type { SystemAlert } from './alert-engine';
import { useAdminIncidentStore } from '@/store/adminIncidents';

const TREND_TO_ALERT_SOURCE: Record<string, string[]> = {
  latency_trend_warning: ['Engine', 'Database'],
  volume_spike_incoming: ['Trading'],
  api_risk: ['API'],
  error_rate_climbing: ['API'],
  withdrawal_queue_rising: ['Wallets'],
  memory_pressure: ['System'],
};

export function usePredictiveIncidentLinker() {
  const activePredictions = useRef<Map<string, { prediction: TrendPrediction; timestamp: number }>>(new Map());
  const linkedSet = useRef<Set<string>>(new Set());
  const addNote = useAdminIncidentStore((s) => s.addNote);

  const trackPredictions = useCallback((predictions: TrendPrediction[]) => {
    const now = Date.now();
    for (const pred of predictions) {
      if (pred.type) {
        activePredictions.current.set(pred.type, { prediction: pred, timestamp: now });
      }
    }

    const expired: string[] = [];
    activePredictions.current.forEach((v, k) => {
      if (now - v.timestamp > 600_000) expired.push(k);
    });
    for (const k of expired) activePredictions.current.delete(k);
  }, []);

  const checkRealAlerts = useCallback((realAlerts: SystemAlert[], activeIncidentId: string | null) => {
    if (!activeIncidentId) return;

    for (const alert of realAlerts) {
      if (alert.severity === 'predictive') continue;

      activePredictions.current.forEach((tracked, trendType) => {
        const matchingSources = TREND_TO_ALERT_SOURCE[trendType] ?? [];
        if (!matchingSources.includes(alert.source)) return;

        const linkKey = `${trendType}:${alert.id}`;
        if (linkedSet.current.has(linkKey)) return;
        linkedSet.current.add(linkKey);

        const elapsed = Math.floor((Date.now() - tracked.timestamp) / 1000);
        addNote(
          activeIncidentId,
          `[AI Ops] This incident was predicted ${elapsed}s ago: "${tracked.prediction.message}" (confidence: ${Math.round(tracked.prediction.confidence * 100)}%)`,
          'Predictive Ops',
        );
      });
    }
  }, [addNote]);

  return { trackPredictions, checkRealAlerts };
}
