/**
 * Ops alerts: CRITICAL / WARNING / INFO (Slack-style), per-type rate limit + dedupe window.
 */
import { createHash } from 'node:crypto';
import { config } from '../config/index.js';
import { logger, securityLog } from '../lib/logger.js';
import { redis } from '../lib/redis.js';

const recent = new Map<string, number>();

export type OpsAlertSeverity = 'critical' | 'warning' | 'info';

export type OpsAlertType = 'security' | 'treasury' | 'signing' | 'trading' | 'general';

export interface OpsAlertPayload {
  severity: OpsAlertSeverity;
  title: string;
  body: string;
  /** Deduplication key; same key suppressed within dedupe window. */
  dedupeKey?: string;
  /** Rate-bucket key (defaults by severity mapping). */
  alertType?: OpsAlertType;
  context?: Record<string, unknown>;
}

function severityRank(s: OpsAlertSeverity): number {
  return s === 'critical' ? 3 : s === 'warning' ? 2 : 1;
}

async function postJson(url: string, payload: Record<string, unknown>): Promise<void> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    if (!r.ok) {
      logger.warn('ops_alert: webhook non-OK', { status: r.status, url: url.slice(0, 48) });
    }
  } finally {
    clearTimeout(t);
  }
}

const LEVEL_LABEL: Record<OpsAlertSeverity, string> = {
  critical: 'CRITICAL',
  warning: 'WARNING',
  info: 'INFO',
};

export async function sendOpsAlert(p: OpsAlertPayload): Promise<void> {
  const dedupeMs = config.monitoring.opsAlertDedupeMs;
  const type = p.alertType ?? 'general';
  const key = p.dedupeKey ?? createHash('sha256').update(`${p.title}|${p.body}`).digest('hex').slice(0, 32);
  const now = Date.now();
  const last = recent.get(key);
  if (last != null && now - last < dedupeMs) return;
  recent.set(key, now);
  if (recent.size > 2000) {
    for (const [k, t0] of recent) {
      if (now - t0 > dedupeMs * 4) recent.delete(k);
    }
  }

  try {
    const rl = await redis.rateLimit(
      `ops:alert:rl:${type}`,
      config.monitoring.opsAlertRateLimitPerTypePerMin,
      60
    );
    if (!rl.allowed) {
      logger.warn('ops_alert: rate_limited (type)', { type, title: p.title });
      return;
    }
  } catch (e) {
    logger.warn('ops_alert: redis rate limit skipped', { error: e instanceof Error ? e.message : String(e) });
  }

  if (p.context && Object.keys(p.context).length > 0) {
    const sev =
      p.severity === 'critical' ? 'critical' : p.severity === 'warning' ? 'high' : 'medium';
    securityLog('ops_alert', sev, { level: LEVEL_LABEL[p.severity], alertType: type, title: p.title, ...p.context });
  }
  logger.warn('ops_alert', {
    level: LEVEL_LABEL[p.severity],
    alertType: type,
    title: p.title,
    body: p.body.slice(0, 500),
    ...p.context,
  });

  const text = `*[${LEVEL_LABEL[p.severity]}]* [${type}] ${p.title}\n${p.body}`;
  const slackPayload = {
    text,
    attachments: p.context
      ? [
          {
            color:
              p.severity === 'critical' ? 'danger' : p.severity === 'warning' ? 'warning' : '#36a64f',
            text: '```' + JSON.stringify(p.context, null, 2).slice(0, 3500) + '```',
          },
        ]
      : undefined,
  };

  const urls = [config.monitoring.alertWebhookUrl, config.monitoring.opsAlertWebhookUrl].filter(Boolean) as string[];
  for (const u of urls) {
    try {
      await postJson(u, slackPayload);
    } catch (e) {
      logger.warn('ops_alert: webhook failed', { error: e instanceof Error ? e.message : String(e) });
    }
  }

  if (config.monitoring.opsAlertEmailWebhookUrl) {
    try {
      await postJson(config.monitoring.opsAlertEmailWebhookUrl, {
        severity: LEVEL_LABEL[p.severity],
        alert_type: type,
        subject: p.title,
        text: p.body,
        meta: p.context ?? {},
      });
    } catch (e) {
      logger.warn('ops_alert: email webhook failed', { error: e instanceof Error ? e.message : String(e) });
    }
  }
}

/** Compare severities for tests / policies. */
export function opsSeverityAtLeast(a: OpsAlertSeverity, min: OpsAlertSeverity): boolean {
  return severityRank(a) >= severityRank(min);
}
