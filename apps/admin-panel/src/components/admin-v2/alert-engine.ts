/**
 * Alert Engine — frontend-only threshold evaluator.
 * Consumes existing React Query cache data. NO new API calls.
 * Generates structured alerts for the admin alert system.
 *
 * Thresholds calibrated for production:
 *   Healthy: <200ms | Warning: 200–800ms | Critical: >800ms
 */

export type AlertSeverity = 'critical' | 'warning' | 'predictive';

export interface SystemAlert {
  id: string;
  severity: AlertSeverity;
  message: string;
  timestamp: number;
  source: string;
  navTarget?: string;
  prediction?: {
    confidence: number;
    timeHorizon: string;
    trendType: string;
  };
}

interface AlertRule {
  id: string;
  source: string;
  evaluate: (metrics: ExchangeMetrics) => AlertSeverity | null;
  message: (metrics: ExchangeMetrics) => string;
  navTarget: string;
}

export interface ExchangeMetrics {
  engineLatencyMs: number;
  p99LatencyMs: number;
  apiLatencyMs: number;
  apiErrorRate: number;
  withdrawalQueue: number;
  settlementPending: number;
  amlAlertsOpen: number;
  amlHighSeverity: number;
  failedLogins24h: number;
  lockedAccounts: number;
  tradingHalted: boolean;
  dbLatencyMs: number;
  redisLatencyMs: number;
  memoryMb: number;
  wsConnections: number;
}

const ALERT_RULES: AlertRule[] = [
  {
    id: 'engine-latency',
    source: 'Engine',
    evaluate: (m) => m.engineLatencyMs > 5000 ? 'critical' : m.engineLatencyMs > 3000 ? 'warning' : null,
    message: (m) => `Engine latency ${m.engineLatencyMs > 5000 ? 'critical' : 'elevated'}: ${m.engineLatencyMs}ms`,
    navTarget: '/monitoring',
  },
  {
    id: 'p99-latency',
    source: 'Engine',
    evaluate: (m) => m.p99LatencyMs > 8000 ? 'critical' : m.p99LatencyMs > 5000 ? 'warning' : null,
    message: (m) => `P99 latency ${m.p99LatencyMs > 8000 ? 'critical' : 'elevated'}: ${m.p99LatencyMs}ms`,
    navTarget: '/monitoring',
  },
  {
    id: 'api-latency',
    source: 'API',
    evaluate: (m) => m.apiLatencyMs > 3000 ? 'critical' : m.apiLatencyMs > 1500 ? 'warning' : null,
    message: (m) => `API latency ${m.apiLatencyMs > 3000 ? 'critical' : 'elevated'}: ${m.apiLatencyMs}ms`,
    navTarget: '/monitoring',
  },
  {
    id: 'api-error-rate',
    source: 'API',
    evaluate: (m) => m.apiErrorRate > 10 ? 'critical' : m.apiErrorRate > 5 ? 'warning' : null,
    message: (m) => `API error rate: ${m.apiErrorRate.toFixed(1)}%`,
    navTarget: '/monitoring',
  },
  {
    id: 'withdrawal-queue',
    source: 'Wallets',
    evaluate: (m) => m.withdrawalQueue > 300 ? 'critical' : m.withdrawalQueue > 100 ? 'warning' : null,
    message: (m) => `Withdrawal queue: ${m.withdrawalQueue} pending`,
    navTarget: '/withdrawals',
  },
  {
    id: 'aml-alerts',
    source: 'Risk',
    evaluate: (m) => m.amlHighSeverity > 0 ? 'critical' : m.amlAlertsOpen > 5 ? 'warning' : null,
    message: (m) => `${m.amlAlertsOpen} open AML alert${m.amlAlertsOpen !== 1 ? 's' : ''} (${m.amlHighSeverity} high)`,
    navTarget: '/risk',
  },
  {
    id: 'settlement-backlog',
    source: 'Settlement',
    evaluate: (m) => m.settlementPending > 500 ? 'critical' : m.settlementPending > 200 ? 'warning' : null,
    message: (m) => `Settlement backlog: ${m.settlementPending} pending`,
    navTarget: '/monitoring',
  },
  {
    id: 'trading-halted',
    source: 'Trading',
    evaluate: (m) => m.tradingHalted ? 'critical' : null,
    message: () => 'Trading is currently HALTED',
    navTarget: '/trading',
  },
  {
    id: 'db-latency',
    source: 'Database',
    evaluate: (m) => m.dbLatencyMs > 2000 ? 'critical' : m.dbLatencyMs > 500 ? 'warning' : null,
    message: (m) => `Database latency: ${m.dbLatencyMs}ms`,
    navTarget: '/monitoring',
  },
  {
    id: 'redis-latency',
    source: 'Redis',
    evaluate: (m) => m.redisLatencyMs > 200 ? 'critical' : m.redisLatencyMs > 50 ? 'warning' : null,
    message: (m) => `Redis latency: ${m.redisLatencyMs}ms`,
    navTarget: '/monitoring',
  },
  {
    id: 'memory',
    source: 'System',
    evaluate: (m) => m.memoryMb > 1536 ? 'critical' : m.memoryMb > 1024 ? 'warning' : null,
    message: (m) => `Memory usage: ${m.memoryMb.toFixed(0)}MB`,
    navTarget: '/monitoring',
  },
  {
    id: 'failed-logins',
    source: 'Security',
    evaluate: (m) => m.failedLogins24h > 200 ? 'critical' : m.failedLogins24h > 100 ? 'warning' : null,
    message: (m) => `${m.failedLogins24h} failed logins in 24h`,
    navTarget: '/risk',
  },
];

/**
 * Evaluate all rules and return alerts. Alert IDs are STABLE per rule
 * (no timestamp suffix) so the store can deduplicate properly.
 */
export function evaluateAlerts(metrics: ExchangeMetrics): SystemAlert[] {
  const now = Date.now();
  const alerts: SystemAlert[] = [];

  for (const rule of ALERT_RULES) {
    const severity = rule.evaluate(metrics);
    if (severity) {
      alerts.push({
        id: rule.id,
        severity,
        message: rule.message(metrics),
        timestamp: now,
        source: rule.source,
        navTarget: rule.navTarget,
      });
    }
  }

  return alerts.sort((a, b) => {
    if (a.severity === 'critical' && b.severity !== 'critical') return -1;
    if (a.severity !== 'critical' && b.severity === 'critical') return 1;
    return 0;
  });
}

export function computeHealthScore(metrics: ExchangeMetrics): number {
  let score = 100;

  if (metrics.engineLatencyMs > 5000) score -= 25;
  else if (metrics.engineLatencyMs > 3000) score -= 8;

  if (metrics.apiLatencyMs > 3000) score -= 15;
  else if (metrics.apiLatencyMs > 1500) score -= 5;

  if (metrics.apiErrorRate > 10) score -= 25;
  else if (metrics.apiErrorRate > 5) score -= 10;

  if (metrics.withdrawalQueue > 300) score -= 15;
  else if (metrics.withdrawalQueue > 100) score -= 5;

  if (metrics.amlHighSeverity > 0) score -= 20;
  else if (metrics.amlAlertsOpen > 5) score -= 10;

  if (metrics.tradingHalted) score -= 25;

  if (metrics.dbLatencyMs > 2000) score -= 10;
  else if (metrics.dbLatencyMs > 500) score -= 3;

  if (metrics.settlementPending > 500) score -= 10;
  else if (metrics.settlementPending > 200) score -= 5;

  if (metrics.memoryMb > 1536) score -= 10;
  else if (metrics.memoryMb > 1024) score -= 3;

  return Math.max(0, Math.min(100, score));
}

export interface TrendPredictionInput {
  type: string | null;
  severity: 'warning' | 'critical';
  message: string;
  confidence: number;
  timeHorizon: string;
  metric: string;
}

const NAV_TARGETS_FOR_TREND: Record<string, string> = {
  latency_trend_warning: '/monitoring',
  volume_spike_incoming: '/analytics',
  api_risk: '/monitoring',
  withdrawal_queue_rising: '/withdrawals',
  memory_pressure: '/monitoring',
  error_rate_climbing: '/monitoring',
};

export function trendPredictionsToAlerts(predictions: TrendPredictionInput[]): SystemAlert[] {
  const now = Date.now();
  return predictions
    .filter((p) => p.type !== null)
    .map((p) => ({
      id: `pred-${p.type}`,
      severity: 'predictive' as const,
      message: p.message,
      timestamp: now,
      source: p.metric,
      navTarget: NAV_TARGETS_FOR_TREND[p.type ?? ''] ?? '/monitoring',
      prediction: {
        confidence: p.confidence,
        timeHorizon: p.timeHorizon,
        trendType: p.type ?? 'unknown',
      },
    }));
}
