import { useRef, useCallback } from 'react';
import type { SystemAlert } from './alert-engine';

const CRITICAL_BURST_WINDOW_MS = 10_000;
const CRITICAL_BURST_THRESHOLD = 2;
const COOLDOWN_MS = 60_000;

export interface IncidentSuggestion {
  shouldTriggerIncident: boolean;
  title: string;
  triggeringAlertIds: string[];
}

/**
 * Tracks critical alerts within a rolling window.
 * If 2+ CRITICAL alerts arrive within 10 seconds, returns a suggestion
 * to create an incident. Includes a 60s cooldown to avoid spam.
 *
 * Does NOT auto-create — only suggests.
 */
export function useIncidentDetector() {
  const recentCriticalsRef = useRef<{ id: string; ts: number }[]>([]);
  const lastSuggestionRef = useRef<number>(0);

  const evaluate = useCallback((alerts: SystemAlert[]): IncidentSuggestion => {
    const now = Date.now();
    const noSuggestion: IncidentSuggestion = {
      shouldTriggerIncident: false,
      title: '',
      triggeringAlertIds: [],
    };

    if (now - lastSuggestionRef.current < COOLDOWN_MS) return noSuggestion;

    const newCriticals = alerts.filter((a) => a.severity === 'critical');
    if (newCriticals.length === 0) return noSuggestion;

    for (const alert of newCriticals) {
      const existing = recentCriticalsRef.current;
      if (!existing.some((e) => e.id === alert.id)) {
        existing.push({ id: alert.id, ts: alert.timestamp });
      }
    }

    recentCriticalsRef.current = recentCriticalsRef.current.filter(
      (e) => now - e.ts < CRITICAL_BURST_WINDOW_MS
    );

    if (recentCriticalsRef.current.length >= CRITICAL_BURST_THRESHOLD) {
      lastSuggestionRef.current = now;
      const ids = recentCriticalsRef.current.map((e) => e.id);
      const sourceSet = new Set(
        alerts.filter((a) => ids.includes(a.id)).map((a) => a.source)
      );
      const sources = Array.from(sourceSet);
      const title = sources.length > 0
        ? `Critical incident — ${sources.join(', ')} systems affected`
        : 'Multiple critical alerts detected';

      recentCriticalsRef.current = [];

      return {
        shouldTriggerIncident: true,
        title,
        triggeringAlertIds: ids,
      };
    }

    return noSuggestion;
  }, []);

  return evaluate;
}
