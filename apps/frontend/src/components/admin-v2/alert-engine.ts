/**
 * Alert Engine — frontend-only threshold evaluator.
 * Consumes existing React Query cache data. NO new API calls.
 * Generates structured alerts for the admin alert system.
 */

export type AlertSeverity = 'critical' | 'warning' | 'predictive';

export interface SystemAlert {
  id: string;
  severity: AlertSeverity;
  message: string;
  timestamp: number;
  source: string;
  navTarget?: string;
  /** Present only for predictive alerts */
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
    id: 'engine-latency-critical',
    source: 'Engine',
    evaluate: (m) => m.engineLatencyMs > 100 ? 'critical' : null,
    message: (m) => `Engine latency critical: ${m.engineLatencyMs}ms (threshold: 100ms)`,
    navTarget: '/admin/system-health',
  },
  {
    id: 'engine-latency-warning',
    source: 'Engine',
    evaluate: (m) => m.engineLatencyMs > 50 && m.engineLatencyMs <= 100 ? 'warning' : null,
    message: (m) => `Engine latency elevated: ${m.engineLatencyMs}ms (threshold: 50ms)`,
    navTarget: '/admin/system-health',
  },
  {
    id: 'p99-latency-critical',
    source: 'Engine',
    evaluate: (m) => m.p99LatencyMs > 1000 ? 'critical' : null,
    message: (m) => `P99 latency critical: ${m.p99LatencyMs}ms`,
    navTarget: '/admin/system-health',
  },
  {
    id: 'api-latency-critical',
    source: 'API',
    evaluate: (m) => m.apiLatencyMs > 500 ? 'critical' : null,
    message: (m) => `API latency critical: ${m.apiLatencyMs}ms`,
    navTarget: '/admin/api-monitoring',
  },
  {
    id: 'api-latency-warning',
    source: 'API',
    evaluate: (m) => m.apiLatencyMs > 100 && m.apiLatencyMs <= 500 ? 'warning' : null,
    message: (m) => `API latency elevated: ${m.apiLatencyMs}ms`,
    navTarget: '/admin/api-monitoring',
  },
  {
    id: 'api-error-rate-critical',
    source: 'API',
    evaluate: (m) => m.apiErrorRate > 10 ? 'critical' : null,
    message: (m) => `API error rate critical: ${m.apiErrorRate.toFixed(1)}%`,
    navTarget: '/admin/api-monitoring',
  },
  {
    id: 'api-error-rate-warning',
    source: 'API',
    evaluate: (m) => m.apiErrorRate > 5 && m.apiErrorRate <= 10 ? 'warning' : null,
    message: (m) => `API error rate elevated: ${m.apiErrorRate.toFixed(1)}% (threshold: 5%)`,
    navTarget: '/admin/api-monitoring',
  },
  {
    id: 'withdrawal-queue-critical',
    source: 'Wallets',
    evaluate: (m) => m.withdrawalQueue > 300 ? 'critical' : null,
    message: (m) => `Withdrawal queue critical: ${m.withdrawalQueue} pending`,
    navTarget: '/admin/withdrawals',
  },
  {
    id: 'withdrawal-queue-warning',
    source: 'Wallets',
    evaluate: (m) => m.withdrawalQueue > 100 && m.withdrawalQueue <= 300 ? 'warning' : null,
    message: (m) => `Withdrawal queue elevated: ${m.withdrawalQueue} pending`,
    navTarget: '/admin/withdrawals',
  },
  {
    id: 'aml-alerts-critical',
    source: 'Risk',
    evaluate: (m) => m.amlAlertsOpen > 0 ? 'critical' : null,
    message: (m) => `${m.amlAlertsOpen} open AML alert${m.amlAlertsOpen > 1 ? 's' : ''} (${m.amlHighSeverity} high severity)`,
    navTarget: '/admin/compliance/alerts',
  },
  {
    id: 'settlement-backlog',
    source: 'Settlement',
    evaluate: (m) => m.settlementPending > 200 ? 'critical' : m.settlementPending > 50 ? 'warning' : null,
    message: (m) => `Settlement backlog: ${m.settlementPending} pending`,
    navTarget: '/admin/system-health',
  },
  {
    id: 'trading-halted',
    source: 'Trading',
    evaluate: (m) => m.tradingHalted ? 'critical' : null,
    message: () => 'Trading is currently HALTED',
    navTarget: '/admin/trading/engine',
  },
  {
    id: 'db-latency-critical',
    source: 'Database',
    evaluate: (m) => m.dbLatencyMs > 200 ? 'critical' : m.dbLatencyMs > 50 ? 'warning' : null,
    message: (m) => `Database latency: ${m.dbLatencyMs}ms`,
    navTarget: '/admin/system-health',
  },
  {
    id: 'redis-latency-warning',
    source: 'Redis',
    evaluate: (m) => m.redisLatencyMs > 50 ? 'warning' : null,
    message: (m) => `Redis latency elevated: ${m.redisLatencyMs}ms`,
    navTarget: '/admin/system-health',
  },
  {
    id: 'memory-critical',
    source: 'System',
    evaluate: (m) => m.memoryMb > 1024 ? 'critical' : m.memoryMb > 768 ? 'warning' : null,
    message: (m) => `Memory usage: ${m.memoryMb.toFixed(0)}MB`,
    navTarget: '/admin/system-health',
  },
  {
    id: 'failed-logins-warning',
    source: 'Security',
    evaluate: (m) => m.failedLogins24h > 100 ? 'critical' : m.failedLogins24h > 50 ? 'warning' : null,
    message: (m) => `${m.failedLogins24h} failed logins in 24h`,
    navTarget: '/admin/security',
  },
];

export function evaluateAlerts(metrics: ExchangeMetrics): SystemAlert[] {
  const now = Date.now();
  const alerts: SystemAlert[] = [];

  for (const rule of ALERT_RULES) {
    const severity = rule.evaluate(metrics);
    if (severity) {
      alerts.push({
        id: `${rule.id}-${now}`,
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
    return b.timestamp - a.timestamp;
  });
}

export function computeHealthScore(metrics: ExchangeMetrics): number {
  let score = 100;

  if (metrics.engineLatencyMs > 100) score -= 30;
  else if (metrics.engineLatencyMs > 50) score -= 10;

  if (metrics.apiLatencyMs > 500) score -= 20;
  else if (metrics.apiLatencyMs > 100) score -= 5;

  if (metrics.apiErrorRate > 10) score -= 25;
  else if (metrics.apiErrorRate > 5) score -= 10;

  if (metrics.withdrawalQueue > 300) score -= 20;
  else if (metrics.withdrawalQueue > 100) score -= 10;

  if (metrics.amlAlertsOpen > 0) score -= 30;

  if (metrics.tradingHalted) score -= 30;

  if (metrics.dbLatencyMs > 200) score -= 15;
  else if (metrics.dbLatencyMs > 50) score -= 5;

  if (metrics.settlementPending > 200) score -= 15;
  else if (metrics.settlementPending > 50) score -= 5;

  if (metrics.memoryMb > 1024) score -= 10;

  return Math.max(0, Math.min(100, score));
}

/**
 * Convert TrendPredictions into predictive SystemAlerts.
 * These are kept SEPARATE from critical/warning alerts —
 * they use severity='predictive' and carry prediction metadata.
 */
export interface TrendPredictionInput {
  type: string | null;
  severity: 'warning' | 'critical';
  message: string;
  confidence: number;
  timeHorizon: string;
  metric: string;
}

const NAV_TARGETS_FOR_TREND: Record<string, string> = {
  latency_trend_warning: '/admin/system-health',
  volume_spike_incoming: '/admin/reports',
  api_risk: '/admin/api-monitoring',
  withdrawal_queue_rising: '/admin/withdrawals',
  memory_pressure: '/admin/system-health',
  error_rate_climbing: '/admin/api-monitoring',
};

export function trendPredictionsToAlerts(predictions: TrendPredictionInput[]): SystemAlert[] {
  const now = Date.now();
  return predictions
    .filter((p) => p.type !== null)
    .map((p) => ({
      id: `pred-${p.type}-${now}`,
      severity: 'predictive' as const,
      message: p.message,
      timestamp: now,
      source: p.metric,
      navTarget: NAV_TARGETS_FOR_TREND[p.type ?? ''] ?? '/admin/system-health',
      prediction: {
        confidence: p.confidence,
        timeHorizon: p.timeHorizon,
        trendType: p.type ?? 'unknown',
      },
    }));
}
