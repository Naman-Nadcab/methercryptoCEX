/**
 * Admin AML review and escalation (Step 6E). List alerts, update status with history,
 * escalate alert to STR. All admin actions are logged to audit_logs_immutable.
 * Does not auto-submit to FIU-IND; review and escalation only.
 */

import { db } from '../lib/database.js';
import { logger } from '../lib/logger.js';
import { logAudit } from './audit-log.service.js';

export type AlertStatus = 'open' | 'reviewing' | 'closed';

export interface ListAlertsParams {
  status?: AlertStatus | string | null;
  severity?: string | null;
  userId?: string | null;
  limit?: number;
  offset?: number;
}

export interface ListAlertsResult {
  alerts: {
    id: string;
    user_id: string;
    alert_type: string;
    severity: string;
    status: string;
    details: unknown;
    created_at: string;
  }[];
  total: number;
}

export interface UpdateAlertStatusParams {
  alertId: string;
  status: AlertStatus;
  adminId: string;
  note?: string | null;
}

export interface EscalateAlertToSTRParams {
  alertId: string;
  adminId: string;
}

// ---------------------------------------------------------------------------
// listAlerts — paginated list with optional filters
// ---------------------------------------------------------------------------

export async function listAlerts(params: ListAlertsParams = {}): Promise<ListAlertsResult> {
  const {
    status = null,
    severity = null,
    userId = null,
    limit = 50,
    offset = 0,
  } = params;

  const conditions: string[] = ['1=1'];
  const queryParams: unknown[] = [];
  let i = 1;
  if (status != null && status !== '') {
    conditions.push(`status = $${i++}`);
    queryParams.push(status);
  }
  if (severity != null && severity !== '') {
    conditions.push(`severity = $${i++}`);
    queryParams.push(severity);
  }
  if (userId != null && userId !== '') {
    conditions.push(`user_id = $${i++}`);
    queryParams.push(userId);
  }
  const where = conditions.join(' AND ');

  const countResult = await db.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM aml_alerts WHERE ${where}`,
    queryParams
  );
  const total = parseInt(countResult.rows[0]?.count ?? '0', 10);

  queryParams.push(Math.min(100, Math.max(1, limit)), Math.max(0, offset));
  const listResult = await db.query<{
    id: string;
    user_id: string;
    alert_type: string;
    severity: string;
    status: string;
    details: unknown;
    created_at: string;
  }>(
    `SELECT id, user_id, alert_type, severity, status, details, created_at
     FROM aml_alerts WHERE ${where}
     ORDER BY created_at DESC
     LIMIT $${i} OFFSET $${i + 1}`,
    queryParams
  );

  return { alerts: listResult.rows, total };
}

// ---------------------------------------------------------------------------
// updateAlertStatus — set status and append admin action to details.history[]
// ---------------------------------------------------------------------------

export async function updateAlertStatus(params: UpdateAlertStatusParams): Promise<boolean> {
  const { alertId, status, adminId, note = null } = params;

  const existing = await db.query<{ user_id: string; status: string; details: unknown }>(
    `SELECT user_id, status, details FROM aml_alerts WHERE id = $1`,
    [alertId]
  );
  if (existing.rows.length === 0) return false;

  const row = existing.rows[0]!;
  const oldStatus = row.status;
  const detailsObj = (row.details && typeof row.details === 'object' && !Array.isArray(row.details))
    ? (row.details as Record<string, unknown>)
    : {};
  const history = Array.isArray(detailsObj.history) ? [...detailsObj.history] : [];
  history.push({
    action: 'status_update',
    fromStatus: oldStatus,
    toStatus: status,
    adminId,
    note: note ?? undefined,
    timestamp: new Date().toISOString(),
  });
  const newDetails = { ...detailsObj, history };

  await db.query(
    `UPDATE aml_alerts SET status = $2, details = $3::jsonb WHERE id = $1`,
    [alertId, status, JSON.stringify(newDetails)]
  );

  try {
    await logAudit({
      actorType: 'admin',
      actorId: adminId,
      action: 'alert_status_update',
      resourceType: 'aml_alert',
      resourceId: alertId,
      oldValue: { status: oldStatus },
      newValue: { status, note: note ?? undefined },
    });
  } catch (e) {
    logger.warn('Audit log for alert_status_update failed (best-effort)', {
      alertId,
      adminId,
      error: e instanceof Error ? e.message : 'Unknown',
    });
  }
  return true;
}

// ---------------------------------------------------------------------------
// escalateAlertToSTR — create a STR record for this alert and mark alert as reported
// ---------------------------------------------------------------------------

export async function escalateAlertToSTR(params: EscalateAlertToSTRParams): Promise<{ strLogId: string | null }> {
  const { alertId, adminId } = params;

  const alertRow = await db.query<{
    id: string;
    user_id: string;
    alert_type: string;
    severity: string;
    status: string;
    details: unknown;
    created_at: string;
  }>(
    `SELECT id, user_id, alert_type, severity, status, details, created_at FROM aml_alerts WHERE id = $1`,
    [alertId]
  );
  if (alertRow.rows.length === 0) {
    return { strLogId: null };
  }

  const alert = alertRow.rows[0]!;
  const periodDate = alert.created_at.slice(0, 10);

  const payload = {
    reportType: 'STR',
    source: 'admin_escalation',
    escalatedAlertId: alert.id,
    userId: alert.user_id,
    alertType: alert.alert_type,
    severity: alert.severity,
    details: alert.details ?? null,
    alertCreatedAt: alert.created_at,
    escalatedAt: new Date().toISOString(),
    escalatedByAdminId: adminId,
  };

  let strLogId: string | null = null;
  try {
    const ins = await db.query<{ id: string }>(
      `INSERT INTO aml_str_ctr_logs (report_type, user_id, period_start, period_end, total_amount, status, payload)
       VALUES ('STR', $1, $2::date, $2::date, NULL, 'pending', $3::jsonb)
       RETURNING id`,
      [alert.user_id, periodDate, JSON.stringify(payload)]
    );
    strLogId = ins.rows[0]?.id ?? null;
  } catch (e) {
    logger.warn('STR log insert on escalate failed (best-effort)', {
      alertId,
      adminId,
      error: e instanceof Error ? e.message : 'Unknown',
    });
    return { strLogId: null };
  }

  await db.query(
    `UPDATE aml_alerts SET status = 'reported' WHERE id = $1`,
    [alertId]
  );

  try {
    await logAudit({
      actorType: 'admin',
      actorId: adminId,
      action: 'alert_escalated_to_str',
      resourceType: 'aml_alert',
      resourceId: alertId,
      newValue: { strLogId, alertType: alert.alert_type },
    });
  } catch (e) {
    logger.warn('Audit log for alert_escalated_to_str failed (best-effort)', {
      alertId,
      adminId,
      error: e instanceof Error ? e.message : 'Unknown',
    });
  }
  return { strLogId };
}

/*
  Example admin usage (commented):

  // List open high-severity alerts for review
  const { alerts, total } = await listAlerts({
    status: 'open',
    severity: 'high',
    limit: 20,
    offset: 0,
  });

  // Mark alert as under review
  await updateAlertStatus({
    alertId: alert.id,
    status: 'reviewing',
    adminId: admin.adminId,
    note: 'Assigned for review',
  });

  // Close alert after review (no STR needed)
  await updateAlertStatus({
    alertId: alert.id,
    status: 'closed',
    adminId: admin.adminId,
    note: 'False positive after review',
  });

  // Escalate alert to STR for FIU-IND reporting
  const { strLogId } = await escalateAlertToSTR({
    alertId: alert.id,
    adminId: admin.adminId,
  });
  // strLogId can be used with markReportSubmitted / markReportAcknowledged after manual upload.
*/
