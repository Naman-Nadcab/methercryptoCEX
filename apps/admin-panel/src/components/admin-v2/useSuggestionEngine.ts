/**
 * Suggestion Engine — Predictive Ops Layer (STEP 3)
 *
 * Maps trend predictions and current conditions to actionable suggestions.
 * Returns navigable action items that operators can execute immediately.
 *
 * SAFETY: Suggestions only — no automated actions.
 */

import { useMemo } from 'react';
import type { TrendPrediction } from './useTrendAnalyzer';

export interface Suggestion {
  id: string;
  label: string;
  description: string;
  action: string;
  priority: 'high' | 'medium' | 'low';
  category: string;
}

interface SuggestionRule {
  trendTypes: string[];
  suggestions: Omit<Suggestion, 'id'>[];
}

const SUGGESTION_RULES: SuggestionRule[] = [
  {
    trendTypes: ['latency_trend_warning'],
    suggestions: [
      { label: 'Check DB Performance', description: 'Review connection pool and slow queries', action: '/monitoring', priority: 'high', category: 'Infrastructure' },
      { label: 'Review Engine Health', description: 'Check matching engine status and queue depth', action: '/trading', priority: 'high', category: 'Trading' },
      { label: 'Scale Infrastructure', description: 'Consider horizontal scaling if single instance is saturated', action: '/monitoring', priority: 'medium', category: 'Infrastructure' },
      { label: 'Check Redis Latency', description: 'Redis slowdown can cascade to engine latency', action: '/monitoring', priority: 'medium', category: 'Infrastructure' },
    ],
  },
  {
    trendTypes: ['volume_spike_incoming'],
    suggestions: [
      { label: 'Monitor Orderbook Depth', description: 'Ensure sufficient liquidity for incoming volume', action: '/trading', priority: 'high', category: 'Trading' },
      { label: 'Check Market Making', description: 'Verify MM bots are active and responding', action: '/trading', priority: 'high', category: 'Trading' },
      { label: 'Review Circuit Breakers', description: 'Ensure price protection limits are appropriate', action: '/trading', priority: 'medium', category: 'Risk' },
      { label: 'Watch Wash Trading', description: 'Volume spikes may indicate manipulation', action: '/trading', priority: 'medium', category: 'Compliance' },
    ],
  },
  {
    trendTypes: ['api_risk', 'error_rate_climbing'],
    suggestions: [
      { label: 'Check API Monitoring', description: 'Review error patterns and failing endpoints', action: '/monitoring', priority: 'high', category: 'Infrastructure' },
      { label: 'Review Rate Limiter', description: 'Possible DDoS or aggressive bot activity', action: '/monitoring', priority: 'high', category: 'Security' },
      { label: 'Check DB Connections', description: 'Pool exhaustion causes cascading 500 errors', action: '/monitoring', priority: 'medium', category: 'Infrastructure' },
      { label: 'Review Recent Deploys', description: 'Regression from recent deployment may be the cause', action: '/audit/config', priority: 'low', category: 'Operations' },
    ],
  },
  {
    trendTypes: ['withdrawal_queue_rising'],
    suggestions: [
      { label: 'Check Hot Wallet Balance', description: 'Insufficient funds may be blocking withdrawals', action: '/treasury', priority: 'high', category: 'Wallets' },
      { label: 'Monitor Suspicious Activity', description: 'Large withdrawal bursts may indicate compromise', action: '/risk', priority: 'high', category: 'Security' },
      { label: 'Verify Blockchain Nodes', description: 'Node connectivity issues delay processing', action: '/treasury', priority: 'medium', category: 'Infrastructure' },
      { label: 'Check Gas Prices', description: 'High gas may be causing transaction failures', action: '/treasury', priority: 'medium', category: 'Wallets' },
    ],
  },
  {
    trendTypes: ['memory_pressure'],
    suggestions: [
      { label: 'Check Memory Usage', description: 'Review heap memory and GC pressure', action: '/monitoring', priority: 'high', category: 'Infrastructure' },
      { label: 'Review Active Connections', description: 'WebSocket or DB connection leaks consume memory', action: '/monitoring', priority: 'medium', category: 'Infrastructure' },
      { label: 'Consider Process Restart', description: 'Scheduled restart may relieve memory pressure', action: '/monitoring', priority: 'low', category: 'Operations' },
    ],
  },
];

export function useSuggestionEngine(predictions: TrendPrediction[]): Suggestion[] {
  return useMemo(() => {
    if (predictions.length === 0) return [];

    const activeTypes = new Set<string>();
    for (const p of predictions) {
      if (p.type) activeTypes.add(p.type);
    }
    const suggestions: Suggestion[] = [];
    let counter = 0;

    for (const rule of SUGGESTION_RULES) {
      const matches = rule.trendTypes.some((t) => activeTypes.has(t));
      if (matches) {
        for (const s of rule.suggestions) {
          suggestions.push({ ...s, id: `sug-${counter++}` });
        }
      }
    }

    return suggestions
      .sort((a, b) => {
        const pri = { high: 3, medium: 2, low: 1 };
        return pri[b.priority] - pri[a.priority];
      })
      .slice(0, 8);
  }, [predictions]);
}
