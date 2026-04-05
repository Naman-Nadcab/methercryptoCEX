/**
 * Playbook suggestions mapped to alert source/type.
 * Purely frontend — gives operators immediate action steps
 * when an incident is triggered.
 */

export interface PlaybookStep {
  action: string;
  priority: 'immediate' | 'follow-up';
}

export interface Playbook {
  id: string;
  title: string;
  steps: PlaybookStep[];
}

const PLAYBOOKS: Record<string, Playbook> = {
  Engine: {
    id: 'engine',
    title: 'Engine Latency Runbook',
    steps: [
      { action: 'Check matching engine health at /admin/trading/engine', priority: 'immediate' },
      { action: 'Verify database connection pool — look for saturated connections', priority: 'immediate' },
      { action: 'Check Redis latency and memory usage', priority: 'immediate' },
      { action: 'Review recent deployments for regressions', priority: 'follow-up' },
      { action: 'Consider pausing trading if P99 > 2s', priority: 'follow-up' },
    ],
  },
  API: {
    id: 'api',
    title: 'API Performance Runbook',
    steps: [
      { action: 'Check API error rate at /admin/api-monitoring', priority: 'immediate' },
      { action: 'Verify database query latency — look for slow queries', priority: 'immediate' },
      { action: 'Check rate limiter — possible DDoS or bot spike', priority: 'immediate' },
      { action: 'Review Node.js event loop lag and memory', priority: 'follow-up' },
      { action: 'Scale horizontally if single instance is saturated', priority: 'follow-up' },
    ],
  },
  Wallets: {
    id: 'wallets',
    title: 'Withdrawal Queue Runbook',
    steps: [
      { action: 'Check pending withdrawals at /admin/withdrawals?status=pending_approval', priority: 'immediate' },
      { action: 'Verify hot wallet balances — may need replenishment', priority: 'immediate' },
      { action: 'Check blockchain node connectivity and gas prices', priority: 'immediate' },
      { action: 'Review if withdrawal freeze is accidentally active', priority: 'follow-up' },
      { action: 'Escalate to treasury team if cold-to-hot transfer needed', priority: 'follow-up' },
    ],
  },
  Risk: {
    id: 'risk',
    title: 'AML / Compliance Runbook',
    steps: [
      { action: 'Review open AML alerts at /admin/compliance/alerts', priority: 'immediate' },
      { action: 'Check for large/suspicious transactions in last hour', priority: 'immediate' },
      { action: 'Verify KYC status of flagged accounts', priority: 'immediate' },
      { action: 'File STR if required by regulatory timeline', priority: 'follow-up' },
      { action: 'Freeze associated accounts if severity is high', priority: 'follow-up' },
    ],
  },
  Database: {
    id: 'database',
    title: 'Database Health Runbook',
    steps: [
      { action: 'Check active connections and pool saturation', priority: 'immediate' },
      { action: 'Review pg_stat_activity for long-running queries', priority: 'immediate' },
      { action: 'Verify disk I/O and available storage', priority: 'immediate' },
      { action: 'Check for lock contention or deadlocks', priority: 'follow-up' },
      { action: 'Consider read replica failover if primary is degraded', priority: 'follow-up' },
    ],
  },
  Trading: {
    id: 'trading',
    title: 'Trading Halt Runbook',
    steps: [
      { action: 'Verify halt reason — intentional or circuit breaker?', priority: 'immediate' },
      { action: 'Check settlement circuit state in Redis', priority: 'immediate' },
      { action: 'Review matching engine logs for errors', priority: 'immediate' },
      { action: 'Clear settlement circuit if false positive', priority: 'follow-up' },
      { action: 'Communicate status to users via announcements', priority: 'follow-up' },
    ],
  },
  System: {
    id: 'system',
    title: 'System Resources Runbook',
    steps: [
      { action: 'Check memory usage — possible memory leak', priority: 'immediate' },
      { action: 'Review CPU utilization across all processes', priority: 'immediate' },
      { action: 'Check for OOM kills in system logs', priority: 'immediate' },
      { action: 'Restart process if memory exceeds safe threshold', priority: 'follow-up' },
      { action: 'Schedule heap dump analysis for root cause', priority: 'follow-up' },
    ],
  },
  Security: {
    id: 'security',
    title: 'Security Incident Runbook',
    steps: [
      { action: 'Check failed login patterns at /admin/security', priority: 'immediate' },
      { action: 'Review IP addresses for brute-force attempts', priority: 'immediate' },
      { action: 'Verify no unauthorized admin access in audit logs', priority: 'immediate' },
      { action: 'Enable additional rate limiting if under attack', priority: 'follow-up' },
      { action: 'Notify security team and consider IP blocklisting', priority: 'follow-up' },
    ],
  },
  Settlement: {
    id: 'settlement',
    title: 'Settlement Backlog Runbook',
    steps: [
      { action: 'Check settlement queue depth at /admin/system-health', priority: 'immediate' },
      { action: 'Verify settlement worker is running and processing', priority: 'immediate' },
      { action: 'Check for NATS/Redis connectivity issues', priority: 'immediate' },
      { action: 'Review balance ledger reconciliation status', priority: 'follow-up' },
      { action: 'Clear settlement circuit breaker if stuck', priority: 'follow-up' },
    ],
  },
};

const GENERIC_PLAYBOOK: Playbook = {
  id: 'generic',
  title: 'General Incident Runbook',
  steps: [
    { action: 'Identify affected systems and scope of impact', priority: 'immediate' },
    { action: 'Check /admin/system-health for overall status', priority: 'immediate' },
    { action: 'Review recent alerts for root cause signals', priority: 'immediate' },
    { action: 'Communicate with team and assign investigation owner', priority: 'follow-up' },
    { action: 'Document findings in incident notes', priority: 'follow-up' },
  ],
};

/**
 * Given a list of alert source names, returns the most relevant playbooks.
 * Returns up to 3 playbooks, prioritized by specificity.
 */
export function getPlaybooksForSources(sources: string[]): Playbook[] {
  const seen = new Set<string>();
  const result: Playbook[] = [];

  for (const source of sources) {
    const key = source.charAt(0).toUpperCase() + source.slice(1);
    const pb = PLAYBOOKS[key];
    if (pb && !seen.has(pb.id)) {
      seen.add(pb.id);
      result.push(pb);
    }
  }

  if (result.length === 0) {
    result.push(GENERIC_PLAYBOOK);
  }

  return result.slice(0, 3);
}
