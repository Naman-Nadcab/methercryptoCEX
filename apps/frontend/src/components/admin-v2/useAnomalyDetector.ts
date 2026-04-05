import { useRef, useCallback } from 'react';

export type AnomalyType = 'spike' | 'drop' | null;

export interface AnomalyResult {
  type: AnomalyType;
  deltaPercent: number;
  previousValue: number;
  label: string;
}

const HISTORY_SIZE = 5;
const SPIKE_THRESHOLD = 1.0;
const DROP_THRESHOLD = -0.4;

/**
 * Hook that tracks value history via useRef and detects anomalies
 * based on delta % change from rolling average.
 * No state — no re-render storms.
 */
export function useAnomalyDetector() {
  const historyMap = useRef<Map<string, number[]>>(new Map());

  const detect = useCallback((key: string, currentValue: number): AnomalyResult => {
    const map = historyMap.current;
    if (!map.has(key)) map.set(key, []);
    const history = map.get(key)!;

    const noResult: AnomalyResult = { type: null, deltaPercent: 0, previousValue: currentValue, label: '' };

    if (history.length < 2) {
      history.push(currentValue);
      if (history.length > HISTORY_SIZE) history.shift();
      return noResult;
    }

    const avg = history.reduce((a, b) => a + b, 0) / history.length;
    const delta = avg !== 0 ? (currentValue - avg) / avg : 0;

    history.push(currentValue);
    if (history.length > HISTORY_SIZE) history.shift();

    if (delta >= SPIKE_THRESHOLD) {
      return {
        type: 'spike',
        deltaPercent: delta * 100,
        previousValue: avg,
        label: `Spike +${(delta * 100).toFixed(0)}%`,
      };
    }
    if (delta <= DROP_THRESHOLD) {
      return {
        type: 'drop',
        deltaPercent: delta * 100,
        previousValue: avg,
        label: `Drop ${(delta * 100).toFixed(0)}%`,
      };
    }

    return {
      type: null,
      deltaPercent: delta * 100,
      previousValue: avg,
      label: '',
    };
  }, []);

  return detect;
}
