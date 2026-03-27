/**
 * Phase 1 — Critical Safety & Compliance: sanctions config, withdrawal tier limits,
 * STR/CTR workflow, alert channel configuration.
 * All require admin auth.
 */

import type { FastifyInstance } from 'fastify';
import { db } from '../lib/database.js';
import { getAdminFromRequest } from './admin.fastify.js';
import { getTierLimitsFromSettings, updateTierLimits } from '../services/withdrawal-tier-limits.service.js';
import { generateSTR, generateCTR, markReportSubmitted } from '../services/aml-reporting.service.js';
import { checkSanctions } from '../services/sanctions-screening.service.js';
import { logger } from '../lib/logger.js';

const SANCTIONS_KEYS = ['SANCTIONS_PROVIDER', 'SANCTIONS_API_URL', 'SANCTIONS_API_KEY'] as const;
const ALERT_KEYS = ['alert_webhook_url', 'alert_slack_webhook_url', 'alert_pagerduty_key'] as const;

export default async function adminPhase1ComplianceRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
  });

  // ----- Sanctions provider configuration -----
  app.get('/compliance/sanctions/config', async (request, reply) => {
    try {
      const rows = await db.query<{ key: string; value: unknown }>(
        `SELECT key, value FROM system_settings WHERE key = ANY($1::text[])`,
        [SANCTIONS_KEYS as unknown as string[]]
      );
      const map = Object.fromEntries(
        (rows.rows ?? []).map((r) => [r.key, r.value != null && typeof r.value === 'string' ? r.value : (typeof r.value === 'object' ? JSON.stringify(r.value) : String(r.value ?? ''))])
      );
      const provider = map.SANCTIONS_PROVIDER ?? process.env.SANCTIONS_PROVIDER ?? '';
      const apiUrl = map.SANCTIONS_API_URL ?? process.env.SANCTIONS_API_URL ?? '';
      const apiKey = map.SANCTIONS_API_KEY ?? process.env.SANCTIONS_API_KEY ?? '';
      return reply.send({
        success: true,
        data: {
          provider,
          apiUrl,
          apiKeySet: Boolean(apiKey),
        },
      });
    } catch (e) {
      logger.warn('Sanctions config fetch error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch' } });
    }
  });

  app.patch<{ Body: { provider?: string; apiUrl?: string; apiKey?: string } }>('/compliance/sanctions/config', async (request, reply) => {
    try {
      const body = request.body ?? {};
      if (body.provider != null) {
        await db.query(
          `INSERT INTO system_settings (key, value, updated_at) VALUES ('SANCTIONS_PROVIDER', $1::jsonb, NOW())
           ON CONFLICT (key) DO UPDATE SET value = $1::jsonb, updated_at = NOW()`,
          [JSON.stringify(String(body.provider))]
        );
      }
      if (body.apiUrl != null) {
        await db.query(
          `INSERT INTO system_settings (key, value, updated_at) VALUES ('SANCTIONS_API_URL', $1::jsonb, NOW())
           ON CONFLICT (key) DO UPDATE SET value = $1::jsonb, updated_at = NOW()`,
          [JSON.stringify(String(body.apiUrl))]
        );
      }
      if (body.apiKey != null && body.apiKey !== '') {
        await db.query(
          `INSERT INTO system_settings (key, value, updated_at) VALUES ('SANCTIONS_API_KEY', $1::jsonb, NOW())
           ON CONFLICT (key) DO UPDATE SET value = $1::jsonb, updated_at = NOW()`,
          [JSON.stringify(String(body.apiKey))]
        );
      }
      return reply.send({ success: true, data: { message: 'Sanctions config updated' } });
    } catch (e) {
      logger.warn('Sanctions config update error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'UPDATE_FAILED', message: 'Failed to update' } });
    }
  });

  app.post<{ Body: { address?: string; amount?: string; asset?: string } }>('/compliance/sanctions/test', async (request, reply) => {
    try {
      const body = request.body ?? {};
      const result = await checkSanctions({
        address: body.address ?? '0x0000000000000000000000000000000000000001',
        amount: body.amount ?? '0',
        asset: body.asset ?? 'USDT',
        userId: 'admin-test',
      });
      return reply.send({ success: true, data: result });
    } catch (e) {
      logger.warn('Sanctions test error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'TEST_FAILED', message: 'Test failed' } });
    }
  });

  // ----- Withdrawal limits by KYC tier -----
  app.get('/settings/withdrawal-tier-limits', async (request, reply) => {
    try {
      const data = await getTierLimitsFromSettings();
      return reply.send({ success: true, data });
    } catch (e) {
      logger.warn('Tier limits fetch error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch' } });
    }
  });

  app.patch<{ Body: { tiers: Array<{ tier: number; dailyLimit: string; monthlyLimit: string }> } }>('/settings/withdrawal-tier-limits', async (request, reply) => {
    try {
      const tiers = request.body?.tiers ?? [];
      await updateTierLimits(tiers);
      return reply.send({ success: true, data: { message: 'Tier limits updated' } });
    } catch (e) {
      logger.warn('Tier limits update error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'UPDATE_FAILED', message: 'Failed to update' } });
    }
  });

  // ----- STR / CTR reporting workflow -----
  app.get('/compliance/str-ctr/reports', async (request, reply) => {
    try {
      const q = request.query as { status?: string; type?: string; limit?: string };
      const status = q.status ?? '';
      const type = q.type ?? '';
      const limit = Math.min(100, parseInt(q.limit ?? '50', 10) || 50);
      let sql = `SELECT id, report_type, user_id, period_start, period_end, total_amount, status, payload, created_at
                 FROM aml_str_ctr_logs WHERE 1=1`;
      const params: unknown[] = [];
      let i = 1;
      if (status) {
        sql += ` AND status = $${i}`;
        params.push(status);
        i++;
      }
      if (type) {
        sql += ` AND report_type = $${i}`;
        params.push(type);
        i++;
      }
      sql += ` ORDER BY created_at DESC LIMIT $${i}`;
      params.push(limit);
      const result = await db.query(sql, params);
      return reply.send({
        success: true,
        data: {
          reports: (result.rows ?? []).map((r: { period_start?: string; period_end?: string; created_at?: string }) => ({
            ...r,
            period_start: r.period_start,
            period_end: r.period_end,
            created_at: r.created_at,
          })),
        },
      });
    } catch (e) {
      logger.warn('STR/CTR reports list error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch' } });
    }
  });

  app.post<{ Body: { periodStart: string; periodEnd: string; markAlertsReported?: boolean } }>('/compliance/str-ctr/generate-str', async (request, reply) => {
    try {
      const body = request.body ?? {};
      const periodStart = body.periodStart ?? new Date().toISOString().slice(0, 10);
      const periodEnd = body.periodEnd ?? new Date().toISOString().slice(0, 10);
      const { reportIds } = await generateSTR({
        periodStart,
        periodEnd,
        markAlertsReported: body.markAlertsReported !== false,
      });
      return reply.send({ success: true, data: { reportIds } });
    } catch (e) {
      logger.warn('Generate STR error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'GENERATE_FAILED', message: 'Failed to generate STR' } });
    }
  });

  app.post<{ Body: { periodStart: string; periodEnd: string } }>('/compliance/str-ctr/generate-ctr', async (request, reply) => {
    try {
      const body = request.body ?? {};
      const periodStart = body.periodStart ?? new Date().toISOString().slice(0, 10);
      const periodEnd = body.periodEnd ?? new Date().toISOString().slice(0, 10);
      const { reportIds } = await generateCTR({ periodStart, periodEnd });
      return reply.send({ success: true, data: { reportIds } });
    } catch (e) {
      logger.warn('Generate CTR error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'GENERATE_FAILED', message: 'Failed to generate CTR' } });
    }
  });

  app.post<{ Params: { reportId: string } }>('/compliance/str-ctr/reports/:reportId/mark-submitted', async (request, reply) => {
    try {
      const { reportId } = request.params;
      const ok = await markReportSubmitted(reportId);
      return reply.send({ success: true, data: { updated: ok } });
    } catch (e) {
      logger.warn('Mark report submitted error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'UPDATE_FAILED', message: 'Failed to update' } });
    }
  });

  // Escalate single alert to STR (create one report for that alert)
  app.post<{ Body: { alertId: string } }>('/compliance/str-ctr/escalate-alert-to-str', async (request, reply) => {
    try {
      const alertId = (request.body as { alertId?: string })?.alertId;
      if (!alertId) {
        return reply.status(400).send({ success: false, error: { code: 'MISSING_ALERT_ID', message: 'alertId required' } });
      }
      const alertRow = await db.query<{ id: string; user_id: string; alert_type: string; severity: string; status: string; details: unknown; created_at: string }>(
        `SELECT id, user_id, alert_type, severity, status, details, created_at FROM aml_alerts WHERE id = $1`,
        [alertId]
      );
      if (alertRow.rows.length === 0) {
        return reply.status(404).send({ success: false, error: { code: 'ALERT_NOT_FOUND', message: 'Alert not found' } });
      }
      const a = alertRow.rows[0]!;
      const periodStart = a.created_at.slice(0, 10);
      const periodEnd = periodStart;
      const payload = {
        reportType: 'STR',
        periodStart,
        periodEnd,
        userId: a.user_id,
        alertCount: 1,
        alerts: [{ alertId: a.id, alertType: a.alert_type, severity: a.severity, details: a.details ?? null, createdAt: a.created_at }],
        generatedAt: new Date().toISOString(),
      };
      const ins = await db.query<{ id: string }>(
        `INSERT INTO aml_str_ctr_logs (report_type, user_id, period_start, period_end, total_amount, status, payload)
         VALUES ('STR', $1, $2::date, $3::date, NULL, 'pending', $4::jsonb)
         RETURNING id`,
        [a.user_id, periodStart, periodEnd, JSON.stringify(payload)]
      );
      await db.query(`UPDATE aml_alerts SET status = 'reported' WHERE id = $1`, [alertId]);
      const reportId = ins.rows[0]?.id;
      return reply.send({ success: true, data: { reportId } });
    } catch (e) {
      logger.warn('Escalate to STR error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'ESCALATE_FAILED', message: 'Failed to escalate' } });
    }
  });

  // ----- Alert channel configuration -----
  app.get('/settings/alert-channels', async (request, reply) => {
    try {
      const rows = await db.query<{ key: string; value: unknown }>(
        `SELECT key, value FROM system_settings WHERE key = ANY($1::text[])`,
        [ALERT_KEYS as unknown as string[]]
      );
      const map: Record<string, string> = {};
      (rows.rows ?? []).forEach((r) => {
        const v = r.value;
        map[r.key] = typeof v === 'string' ? v : (v != null ? JSON.stringify(v) : '');
      });
      const alertWebhookUrl = map.alert_webhook_url ?? process.env.ALERT_WEBHOOK_URL ?? '';
      const alertSlackWebhookUrl = map.alert_slack_webhook_url ?? '';
      const alertPagerdutyKey = map.alert_pagerduty_key ?? '';
      return reply.send({
        success: true,
        data: {
          webhookUrl: alertWebhookUrl,
          slackWebhookUrl: alertSlackWebhookUrl,
          pagerdutyKeySet: Boolean(alertPagerdutyKey),
        },
      });
    } catch (e) {
      logger.warn('Alert channels fetch error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch' } });
    }
  });

  app.patch<{ Body: { webhookUrl?: string; slackWebhookUrl?: string; pagerdutyKey?: string } }>('/settings/alert-channels', async (request, reply) => {
    try {
      const body = request.body ?? {};
      if (body.webhookUrl !== undefined) {
        await db.query(
          `INSERT INTO system_settings (key, value, updated_at) VALUES ('alert_webhook_url', $1::jsonb, NOW())
           ON CONFLICT (key) DO UPDATE SET value = $1::jsonb, updated_at = NOW()`,
          [JSON.stringify(String(body.webhookUrl ?? ''))]
        );
      }
      if (body.slackWebhookUrl !== undefined) {
        await db.query(
          `INSERT INTO system_settings (key, value, updated_at) VALUES ('alert_slack_webhook_url', $1::jsonb, NOW())
           ON CONFLICT (key) DO UPDATE SET value = $1::jsonb, updated_at = NOW()`,
          [JSON.stringify(String(body.slackWebhookUrl ?? ''))]
        );
      }
      if (body.pagerdutyKey !== undefined && body.pagerdutyKey !== '') {
        await db.query(
          `INSERT INTO system_settings (key, value, updated_at) VALUES ('alert_pagerduty_key', $1::jsonb, NOW())
           ON CONFLICT (key) DO UPDATE SET value = $1::jsonb, updated_at = NOW()`,
          [JSON.stringify(String(body.pagerdutyKey))]
        );
      }
      return reply.send({ success: true, data: { message: 'Alert channels updated' } });
    } catch (e) {
      logger.warn('Alert channels update error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'UPDATE_FAILED', message: 'Failed to update' } });
    }
  });
}
