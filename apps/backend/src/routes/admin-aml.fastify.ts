/**
 * Admin AML API (Step 7A + 7B + 7C). Dashboard, alerts, STR/CTR reports.
 * Admin JWT required.
 */

import { Decimal } from '../lib/decimal.js';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../lib/database.js';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';
import { getAdminFromRequest, getAdminWithPermission } from './admin.fastify.js';
import {
  listAlerts,
  updateAlertStatus,
  escalateAlertToSTR,
  type AlertStatus,
} from '../services/aml-admin.service.js';
import {
  markReportSubmitted,
  markReportAcknowledged,
} from '../services/aml-reporting.service.js';

export default async function adminAmlRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /admin/aml/config
   * Returns current AML rule thresholds (read-only; values come from env/config).
   */
  app.get('/aml/config', async (request: FastifyRequest, reply: FastifyReply) => {
    const admin = await getAdminWithPermission(app, request, reply, 'aml:view');
    if (!admin) return;
    const cfg = config.aml;
    return reply.send({
      success: true,
      data: {
        largeFiatInrThreshold: cfg.largeFiatInrThreshold,
        largeCryptoWithdrawalThreshold: cfg.largeCryptoWithdrawalThreshold,
        velocityWithdrawalCount: cfg.velocityWithdrawalCount,
        velocityWindowHours: cfg.velocityWindowHours,
        highRiskCountries: cfg.highRiskCountries,
      },
    });
  });

  /**
   * GET /admin/aml/dashboard
   * Returns aggregated counts and totals for the AML dashboard.
   */
  app.get('/aml/dashboard', async (request: FastifyRequest, reply: FastifyReply) => {
    const admin = await getAdminWithPermission(app, request, reply, 'aml:view');
    if (!admin) return;

    try {
      const threshold = config.aml.largeFiatInrThreshold;

      const [
        openAlerts,
        openHighSeverityAlerts,
        pendingSTR,
        pendingCTR,
        totalInrToday,
        largeInrTxnsToday,
        kycViolationLast7d,
      ] = await Promise.all([
        db.query<{ count: string }>(
          `SELECT COUNT(*) AS count FROM aml_alerts WHERE status = 'open'`
        ),
        db.query<{ count: string }>(
          `SELECT COUNT(*) AS count FROM aml_alerts WHERE severity = 'high' AND status = 'open'`
        ),
        db.query<{ count: string }>(
          `SELECT COUNT(*) AS count FROM aml_str_ctr_logs WHERE status = 'pending' AND report_type = 'STR'`
        ),
        db.query<{ count: string }>(
          `SELECT COUNT(*) AS count FROM aml_str_ctr_logs WHERE status = 'pending' AND report_type = 'CTR'`
        ),
        db.query<{ total: string }>(
          `SELECT COALESCE(SUM(fiat_amount), 0) AS total
           FROM aml_transaction_logs
           WHERE fiat_currency = 'INR'
             AND created_at >= CURRENT_DATE
             AND created_at < CURRENT_DATE + INTERVAL '1 day'`
        ),
        db.query<{ count: string }>(
          `SELECT COUNT(*) AS count
           FROM aml_transaction_logs
           WHERE fiat_currency = 'INR'
             AND fiat_amount >= $1
             AND created_at >= CURRENT_DATE
             AND created_at < CURRENT_DATE + INTERVAL '1 day'`,
          [threshold]
        ),
        db.query<{ count: string }>(
          `SELECT COUNT(*) AS count
           FROM aml_alerts
           WHERE alert_type = 'kyc_violation'
             AND created_at > NOW() - INTERVAL '7 days'`
        ),
      ]);

      const data = {
        alertsOpen: parseInt(openAlerts.rows[0]?.count ?? '0', 10),
        alertsOpenHighSeverity: parseInt(openHighSeverityAlerts.rows[0]?.count ?? '0', 10),
        strPending: parseInt(pendingSTR.rows[0]?.count ?? '0', 10),
        ctrPending: parseInt(pendingCTR.rows[0]?.count ?? '0', 10),
        totalInrToday: new Decimal(totalInrToday.rows[0]?.total ?? '0').toString(),
        largeInrTxnsToday: parseInt(largeInrTxnsToday.rows[0]?.count ?? '0', 10),
        largeInrThreshold: threshold,
        kycViolationLast7Days: parseInt(kycViolationLast7d.rows[0]?.count ?? '0', 10),
      };

      return reply.send({
        success: true,
        data,
      });
    } catch (error) {
      logger.error('AML dashboard error', {
        error: error instanceof Error ? error.message : 'Unknown',
      });
      return reply.status(500).send({
        success: false,
        error: {
          code: 'DASHBOARD_ERROR',
          message: 'Failed to load AML dashboard data',
        },
      });
    }
  });

  // -------------------------------------------------------------------------
  // GET /admin/aml/alerts — paginated list with optional filters (Step 7B)
  // -------------------------------------------------------------------------
  app.get<{
    Querystring: { status?: string; severity?: string; userId?: string; limit?: string; offset?: string };
  }>('/aml/alerts', async (request, reply) => {
    const admin = await getAdminWithPermission(app, request, reply, 'aml:view');
    if (!admin) return;

    try {
      const q = request.query;
      const limit = q.limit != null ? parseInt(q.limit, 10) : 50;
      const offset = q.offset != null ? parseInt(q.offset, 10) : 0;
      const result = await listAlerts({
        status: (q.status as AlertStatus) ?? undefined,
        severity: q.severity ?? undefined,
        userId: q.userId ?? undefined,
        limit: Number.isNaN(limit) ? 50 : Math.min(100, Math.max(1, limit)),
        offset: Number.isNaN(offset) ? 0 : Math.max(0, offset),
      });
      return reply.send({
        success: true,
        data: { alerts: result.alerts, total: result.total },
      });
    } catch (error) {
      logger.error('AML list alerts error', {
        error: error instanceof Error ? error.message : 'Unknown',
      });
      return reply.status(500).send({
        success: false,
        error: { code: 'LIST_ALERTS_ERROR', message: 'Failed to list AML alerts' },
      });
    }
  });

  // -------------------------------------------------------------------------
  // GET /admin/aml/alerts/:id — full alert details (Step 7B)
  // -------------------------------------------------------------------------
  app.get<{ Params: { id: string } }>('/aml/alerts/:id', async (request, reply) => {
    const admin = await getAdminWithPermission(app, request, reply, 'aml:view');
    if (!admin) return;

    try {
      const row = await db.query<{
        id: string;
        user_id: string;
        alert_type: string;
        severity: string;
        status: string;
        details: unknown;
        created_at: string;
      }>(
        `SELECT id, user_id, alert_type, severity, status, details, created_at
         FROM aml_alerts WHERE id = $1`,
        [request.params.id]
      );
      if (row.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'AML alert not found' },
        });
      }
      return reply.send({ success: true, data: row.rows[0] });
    } catch (error) {
      logger.error('AML get alert error', {
        id: request.params.id,
        error: error instanceof Error ? error.message : 'Unknown',
      });
      return reply.status(500).send({
        success: false,
        error: { code: 'GET_ALERT_ERROR', message: 'Failed to fetch AML alert' },
      });
    }
  });

  // -------------------------------------------------------------------------
  // PATCH /admin/aml/alerts/:id/status — update status (Step 7B)
  // -------------------------------------------------------------------------
  app.patch<{
    Params: { id: string };
    Body: { status: string; note?: string };
  }>('/aml/alerts/:id/status', async (request, reply) => {
    const admin = await getAdminWithPermission(app, request, reply, 'aml:view');
    if (!admin) return;

    const status = request.body?.status;
    const validStatuses: AlertStatus[] = ['open', 'reviewing', 'closed'];
    if (!status || !validStatuses.includes(status as AlertStatus)) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'INVALID_STATUS',
          message: 'status must be one of: open, reviewing, closed',
        },
      });
    }

    try {
      const updated = await updateAlertStatus({
        alertId: request.params.id,
        status: status as AlertStatus,
        adminId: admin.adminId,
        note: request.body?.note ?? undefined,
      });
      if (!updated) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'AML alert not found' },
        });
      }
      return reply.send({ success: true });
    } catch (error) {
      logger.error('AML update alert status error', {
        id: request.params.id,
        error: error instanceof Error ? error.message : 'Unknown',
      });
      return reply.status(500).send({
        success: false,
        error: { code: 'UPDATE_STATUS_ERROR', message: 'Failed to update alert status' },
      });
    }
  });

  // -------------------------------------------------------------------------
  // POST /admin/aml/alerts/:id/escalate — escalate alert to STR (Step 7B)
  // -------------------------------------------------------------------------
  app.post<{ Params: { id: string } }>('/aml/alerts/:id/escalate', async (request, reply) => {
    const admin = await getAdminWithPermission(app, request, reply, 'aml:escalate');
    if (!admin) return;

    try {
      const { strLogId } = await escalateAlertToSTR({
        alertId: request.params.id,
        adminId: admin.adminId,
      });
      if (strLogId == null) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'AML alert not found or escalation failed',
          },
        });
      }
      return reply.send({ success: true, strLogId });
    } catch (error) {
      logger.error('AML escalate alert error', {
        id: request.params.id,
        error: error instanceof Error ? error.message : 'Unknown',
      });
      return reply.status(500).send({
        success: false,
        error: { code: 'ESCALATE_ERROR', message: 'Failed to escalate alert to STR' },
      });
    }
  });

  // -------------------------------------------------------------------------
  // GET /admin/aml/reports — list STR/CTR reports with pagination (Step 7C)
  // -------------------------------------------------------------------------
  app.get<{
    Querystring: { reportType?: string; status?: string; limit?: string; offset?: string };
  }>('/aml/reports', async (request, reply) => {
    const admin = await getAdminWithPermission(app, request, reply, 'aml:view');
    if (!admin) return;

    try {
      const q = request.query;
      const conditions: string[] = ['1=1'];
      const params: unknown[] = [];
      let i = 1;
      if (q.reportType === 'STR' || q.reportType === 'CTR') {
        conditions.push(`report_type = $${i++}`);
        params.push(q.reportType);
      }
      if (q.status === 'pending' || q.status === 'submitted' || q.status === 'acknowledged') {
        conditions.push(`status = $${i++}`);
        params.push(q.status);
      }
      const where = conditions.join(' AND ');

      const countResult = await db.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM aml_str_ctr_logs WHERE ${where}`,
        params
      );
      const total = parseInt(countResult.rows[0]?.count ?? '0', 10);

      const limit = q.limit != null ? parseInt(q.limit, 10) : 50;
      const offset = q.offset != null ? parseInt(q.offset, 10) : 0;
      const safeLimit = Number.isNaN(limit) ? 50 : Math.min(100, Math.max(1, limit));
      const safeOffset = Number.isNaN(offset) ? 0 : Math.max(0, offset);
      params.push(safeLimit, safeOffset);

      const listResult = await db.query<{
        id: string;
        report_type: string;
        user_id: string | null;
        period_start: string | null;
        period_end: string | null;
        total_amount: string | null;
        status: string;
        created_at: string;
      }>(
        `SELECT id, report_type, user_id, period_start, period_end, total_amount, status, created_at
         FROM aml_str_ctr_logs WHERE ${where}
         ORDER BY created_at DESC
         LIMIT $${i} OFFSET $${i + 1}`,
        params
      );

      return reply.send({
        success: true,
        data: { reports: listResult.rows, total },
      });
    } catch (error) {
      logger.error('AML list reports error', {
        error: error instanceof Error ? error.message : 'Unknown',
      });
      return reply.status(500).send({
        success: false,
        error: { code: 'LIST_REPORTS_ERROR', message: 'Failed to list STR/CTR reports' },
      });
    }
  });

  // -------------------------------------------------------------------------
  // GET /admin/aml/reports/:id — full report details including payload (Step 7C)
  // -------------------------------------------------------------------------
  app.get<{ Params: { id: string } }>('/aml/reports/:id', async (request, reply) => {
    const admin = await getAdminWithPermission(app, request, reply, 'aml:view');
    if (!admin) return;

    try {
      const row = await db.query<{
        id: string;
        report_type: string;
        user_id: string | null;
        period_start: string | null;
        period_end: string | null;
        total_amount: string | null;
        status: string;
        payload: unknown;
        created_at: string;
      }>(
        `SELECT id, report_type, user_id, period_start, period_end, total_amount, status, payload, created_at
         FROM aml_str_ctr_logs WHERE id = $1`,
        [request.params.id]
      );
      if (row.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'STR/CTR report not found' },
        });
      }
      return reply.send({ success: true, data: row.rows[0] });
    } catch (error) {
      logger.error('AML get report error', {
        id: request.params.id,
        error: error instanceof Error ? error.message : 'Unknown',
      });
      return reply.status(500).send({
        success: false,
        error: { code: 'GET_REPORT_ERROR', message: 'Failed to fetch report' },
      });
    }
  });

  // -------------------------------------------------------------------------
  // POST /admin/aml/reports/:id/submit — mark as submitted (Step 7C). Allowed only if status = 'pending'.
  // -------------------------------------------------------------------------
  app.post<{ Params: { id: string } }>('/aml/reports/:id/submit', async (request, reply) => {
    const admin = await getAdminWithPermission(app, request, reply, 'aml:view');
    if (!admin) return;

    try {
      const existing = await db.query<{ id: string; status: string }>(
        `SELECT id, status FROM aml_str_ctr_logs WHERE id = $1`,
        [request.params.id]
      );
      if (existing.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'STR/CTR report not found' },
        });
      }
      if (existing.rows[0]!.status !== 'pending') {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_TRANSITION',
            message: 'Submit is allowed only when report status is pending',
          },
        });
      }
      await markReportSubmitted(request.params.id);
      return reply.send({ success: true });
    } catch (error) {
      logger.error('AML report submit error', {
        id: request.params.id,
        error: error instanceof Error ? error.message : 'Unknown',
      });
      return reply.status(500).send({
        success: false,
        error: { code: 'SUBMIT_REPORT_ERROR', message: 'Failed to mark report as submitted' },
      });
    }
  });

  // -------------------------------------------------------------------------
  // POST /admin/aml/reports/:id/acknowledge — mark as acknowledged (Step 7C). Allowed only if status = 'submitted'.
  // -------------------------------------------------------------------------
  app.post<{ Params: { id: string } }>('/aml/reports/:id/acknowledge', async (request, reply) => {
    const admin = await getAdminWithPermission(app, request, reply, 'aml:view');
    if (!admin) return;

    try {
      const existing = await db.query<{ id: string; status: string }>(
        `SELECT id, status FROM aml_str_ctr_logs WHERE id = $1`,
        [request.params.id]
      );
      if (existing.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'STR/CTR report not found' },
        });
      }
      if (existing.rows[0]!.status !== 'submitted') {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_TRANSITION',
            message: 'Acknowledge is allowed only when report status is submitted',
          },
        });
      }
      await markReportAcknowledged(request.params.id);
      return reply.send({ success: true });
    } catch (error) {
      logger.error('AML report acknowledge error', {
        id: request.params.id,
        error: error instanceof Error ? error.message : 'Unknown',
      });
      return reply.status(500).send({
        success: false,
        error: { code: 'ACKNOWLEDGE_REPORT_ERROR', message: 'Failed to mark report as acknowledged' },
      });
    }
  });
}

/*
  Dashboard example response JSON:

  {
    "success": true,
    "data": {
      "alertsOpen": 12,
      "alertsOpenHighSeverity": 3,
      "strPending": 2,
      "ctrPending": 1,
      "totalInrToday": 4500000.50,
      "largeInrTxnsToday": 4,
      "largeInrThreshold": 1000000,
      "kycViolationLast7Days": 5
    }
  }

  --- Step 7B: Alerts API examples ---

  GET /api/v1/admin/aml/alerts?status=open&severity=high&limit=20&offset=0
  Response:
  {
    "success": true,
    "data": {
      "alerts": [
        {
          "id": "uuid",
          "user_id": "uuid",
          "alert_type": "large_fiat",
          "severity": "high",
          "status": "open",
          "details": {},
          "created_at": "2025-02-07T10:00:00.000Z"
        }
      ],
      "total": 1
    }
  }

  GET /api/v1/admin/aml/alerts/:id
  Response:
  {
    "success": true,
    "data": {
      "id": "uuid",
      "user_id": "uuid",
      "alert_type": "large_fiat",
      "severity": "high",
      "status": "open",
      "details": { "history": [] },
      "created_at": "2025-02-07T10:00:00.000Z"
    }
  }

  PATCH /api/v1/admin/aml/alerts/:id/status
  Body: { "status": "reviewing", "note": "Assigned for review" }
  Response: { "success": true }

  POST /api/v1/admin/aml/alerts/:id/escalate
  Response: { "success": true, "strLogId": "uuid" }

  --- Error handling ---
  - 401: No/invalid admin JWT or session expired → UNAUTHORIZED / INVALID_TOKEN / SESSION_EXPIRED
  - 403: IP not allowlisted (if configured)
  - 404: Alert not found (GET :id, PATCH status, POST escalate)
  - 400: PATCH status with invalid/missing status → INVALID_STATUS
  - 500: DB or service errors → LIST_ALERTS_ERROR, GET_ALERT_ERROR, UPDATE_STATUS_ERROR, ESCALATE_ERROR
  - Auditing: updateAlertStatus and escalateAlertToSTR log to audit_logs_immutable (best-effort).

  --- Step 7C: STR/CTR Reports API examples ---

  GET /api/v1/admin/aml/reports?reportType=STR&status=pending&limit=20&offset=0
  Response:
  {
    "success": true,
    "data": {
      "reports": [
        {
          "id": "uuid",
          "report_type": "STR",
          "user_id": "uuid",
          "period_start": "2025-01-01",
          "period_end": "2025-01-31",
          "total_amount": null,
          "status": "pending",
          "created_at": "2025-02-07T10:00:00.000Z"
        }
      ],
      "total": 1
    }
  }

  GET /api/v1/admin/aml/reports/:id
  Response:
  {
    "success": true,
    "data": {
      "id": "uuid",
      "report_type": "STR",
      "user_id": "uuid",
      "period_start": "2025-01-01",
      "period_end": "2025-01-31",
      "total_amount": null,
      "status": "pending",
      "payload": { "reportType": "STR", "userId": "uuid", "alerts": [], "generatedAt": "..." },
      "created_at": "2025-02-07T10:00:00.000Z"
    }
  }

  POST /api/v1/admin/aml/reports/:id/submit   → { "success": true }
  POST /api/v1/admin/aml/reports/:id/acknowledge → { "success": true }

  --- Step 7C: Lifecycle rules ---
  - status flow: pending → submitted → acknowledged (one-way).
  - submit: allowed only when status = 'pending' (after manual upload to FIU-IND).
  - acknowledge: allowed only when status = 'submitted' (after FIU-IND confirms receipt).
  - 400 INVALID_TRANSITION when submit/acknowledge called from wrong status.
  - 404 when report id not found (GET :id, POST submit, POST acknowledge).
*/
