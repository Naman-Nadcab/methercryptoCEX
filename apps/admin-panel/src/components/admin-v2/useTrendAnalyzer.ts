/**
 * Trend Analyzer — Predictive Ops Layer (STEP 1)
 *
 * Tracks rolling history (last 10 values) for each metric.
 * Computes slope (direction of change) and velocity (rate of change).
 * Detects gradual trends before they become critical alerts.
 *
 * SAFETY: This is 100% frontend-only. Suggestions only — no automation.
 */

import { useRef, useCallback } from 'react';

export type TrendType =
  | 'latency_trend_warning'
  | 'volume_spike_incoming'
  | 'api_risk'
  | 'withdrawal_queue_rising'
  | 'memory_pressure'
  | 'error_rate_climbing'
  | null;

export type PredictiveSeverity = 'warning' | 'critical';

export interface TrendPrediction {
  type: TrendType;
  severity: PredictiveSeverity;
  message: string;
  confidence: number;
  timeHorizon: string;
  metric: string;
  slope: number;
  velocity: number;
}

const HISTORY_SIZE = 10;
const MIN_POINTS_FOR_TREND = 5;

interface MetricHistory {
  values: number[];
  timestamps: number[];
}

function computeSlope(values: number[]): number {
  if (values.length < 2) return 0;
  const n = values.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += values[i]!;
    sumXY += i * values[i]!;
    sumX2 += i * i;
  }
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

function computeVelocity(values: number[]): number {
  if (values.length < 3) return 0;
  const recent = values.slice(-3);
  const older = values.slice(-6, -3);
  if (older.length === 0) return 0;
  const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
  const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
  if (olderAvg === 0) return 0;
  return (recentAvg - olderAvg) / olderAvg;
}

function isConsistentlyIncreasing(values: number[], lastN: number): boolean {
  if (values.length < lastN) return false;
  const slice = values.slice(-lastN);
  let increases = 0;
  for (let i = 1; i < slice.length; i++) {
    if (slice[i]! > slice[i - 1]!) increases++;
  }
  return increases >= lastN - 2;
}

function confidenceFromConsistency(values: number[], lastN: number): number {
  if (values.length < lastN) return 0.3;
  const slice = values.slice(-lastN);
  let increases = 0;
  for (let i = 1; i < slice.length; i++) {
    if (slice[i]! > slice[i - 1]!) increases++;
  }
  return Math.min(0.95, 0.4 + (increases / (lastN - 1)) * 0.55);
}

export function useTrendAnalyzer() {
  const historyRef = useRef<Map<string, MetricHistory>>(new Map());

  const record = useCallback((key: string, value: number) => {
    const map = historyRef.current;
    if (!map.has(key)) map.set(key, { values: [], timestamps: [] });
    const h = map.get(key)!;
    h.values.push(value);
    h.timestamps.push(Date.now());
    if (h.values.length > HISTORY_SIZE) {
      h.values.shift();
      h.timestamps.shift();
    }
  }, []);

  const analyze = useCallback((): TrendPrediction[] => {
    const predictions: TrendPrediction[] = [];
    const map = historyRef.current;

    const latencyH = map.get('latency');
    if (latencyH && latencyH.values.length >= MIN_POINTS_FOR_TREND) {
      const slope = computeSlope(latencyH.values);
      const velocity = computeVelocity(latencyH.values);
      const consistent = isConsistentlyIncreasing(latencyH.values, 5);

      if (consistent && slope > 0) {
        const confidence = confidenceFromConsistency(latencyH.values, 5);
        const current = latencyH.values[latencyH.values.length - 1]!;
        const isCritical = current > 60 || velocity > 0.5;
        predictions.push({
          type: 'latency_trend_warning',
          severity: isCritical ? 'critical' : 'warning',
          message: `Latency trending upward — ${current.toFixed(0)}ms and rising. Possible degradation in ~${isCritical ? '1–2' : '2–3'} minutes.`,
          confidence,
          timeHorizon: isCritical ? '1–2 min' : '2–3 min',
          metric: 'Engine Latency',
          slope,
          velocity,
        });
      }
    }

    const volumeH = map.get('volume');
    if (volumeH && volumeH.values.length >= MIN_POINTS_FOR_TREND) {
      const slope = computeSlope(volumeH.values);
      const velocity = computeVelocity(volumeH.values);

      if (velocity > 0.5 && slope > 0) {
        const confidence = confidenceFromConsistency(volumeH.values, 5);
        predictions.push({
          type: 'volume_spike_incoming',
          severity: velocity > 1.0 ? 'critical' : 'warning',
          message: `Trading volume increasing rapidly (+${(velocity * 100).toFixed(0)}%). Potential spike incoming.`,
          confidence,
          timeHorizon: '3–5 min',
          metric: 'Trading Volume',
          slope,
          velocity,
        });
      }
    }

    const errorH = map.get('errorRate');
    if (errorH && errorH.values.length >= MIN_POINTS_FOR_TREND) {
      const slope = computeSlope(errorH.values);
      const velocity = computeVelocity(errorH.values);
      const consistent = isConsistentlyIncreasing(errorH.values, 4);

      if (consistent && slope > 0) {
        const confidence = confidenceFromConsistency(errorH.values, 4);
        const current = errorH.values[errorH.values.length - 1]!;
        predictions.push({
          type: current > 3 ? 'error_rate_climbing' : 'api_risk',
          severity: current > 3 ? 'critical' : 'warning',
          message: `API error rate climbing — currently ${current.toFixed(1)}% and rising.`,
          confidence,
          timeHorizon: '2–4 min',
          metric: 'API Error Rate',
          slope,
          velocity,
        });
      }
    }

    const wdH = map.get('withdrawalQueue');
    if (wdH && wdH.values.length >= MIN_POINTS_FOR_TREND) {
      const slope = computeSlope(wdH.values);
      const velocity = computeVelocity(wdH.values);
      const consistent = isConsistentlyIncreasing(wdH.values, 4);

      if (consistent && slope > 0) {
        const confidence = confidenceFromConsistency(wdH.values, 4);
        const current = wdH.values[wdH.values.length - 1]!;
        predictions.push({
          type: 'withdrawal_queue_rising',
          severity: current > 150 ? 'critical' : 'warning',
          message: `Withdrawal queue growing steadily — ${current.toFixed(0)} pending and increasing.`,
          confidence,
          timeHorizon: '3–5 min',
          metric: 'Withdrawal Queue',
          slope,
          velocity,
        });
      }
    }

    const memH = map.get('memory');
    if (memH && memH.values.length >= MIN_POINTS_FOR_TREND) {
      const slope = computeSlope(memH.values);
      const velocity = computeVelocity(memH.values);
      const consistent = isConsistentlyIncreasing(memH.values, 5);

      if (consistent && slope > 0) {
        const confidence = confidenceFromConsistency(memH.values, 5);
        const current = memH.values[memH.values.length - 1]!;
        predictions.push({
          type: 'memory_pressure',
          severity: current > 700 ? 'critical' : 'warning',
          message: `Memory usage trending up — ${current.toFixed(0)}MB. Possible memory leak.`,
          confidence,
          timeHorizon: '5–10 min',
          metric: 'Memory',
          slope,
          velocity,
        });
      }
    }

    return predictions.sort((a, b) => {
      if (a.severity === 'critical' && b.severity !== 'critical') return -1;
      if (a.severity !== 'critical' && b.severity === 'critical') return 1;
      return b.confidence - a.confidence;
    });
  }, []);

  return { record, analyze };
}
