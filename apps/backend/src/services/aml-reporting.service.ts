/**
 * AML STR/CTR reporting for FIU-IND (Step 6D). Generates report records from
 * aml_transaction_logs and aml_alerts; inserts into aml_str_ctr_logs.
 * Submission to FIU-IND is assumed manual (upload); this service only creates
 * and updates report rows with audit-friendly payloads.
 */

import { Decimal } from '../lib/decimal.js';
import { db } from '../lib/database.js';
import { logger } from '../lib/logger.js';

const CTR_INR_THRESHOLD = 1_000_000;

export interface GenerateCTRParams {
  periodStart: Date | string;
  periodEnd: Date | string;
}

export interface GenerateSTRParams {
  periodStart: Date | string;
  periodEnd: Date | string;
  /** If true, set aml_alerts included in the STR to status = 'reported'. */
  markAlertsReported?: boolean;
}

function toDateString(d: Date | string): string {
  if (typeof d === 'string') return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// generateCTR
// Aggregates INR transactions >= 1M in the period; one aml_str_ctr_logs row per user.
// ---------------------------------------------------------------------------

export async function generateCTR(params: GenerateCTRParams): Promise<{ reportIds: string[] }> {
  const periodStart = toDateString(params.periodStart);
  const periodEnd = toDateString(params.periodEnd);

  const aggregated = await db.query<{
    user_id: string;
    total_amount: string;
    txn_count: string;
  }>(
    `SELECT user_id,
            COALESCE(SUM(fiat_amount), 0) AS total_amount,
            COUNT(*) AS txn_count
     FROM aml_transaction_logs
     WHERE created_at >= $1::date
       AND created_at < ($2::date + INTERVAL '1 day')
       AND fiat_currency = 'INR'
       AND fiat_amount >= $3
     GROUP BY user_id`,
    [periodStart, periodEnd, CTR_INR_THRESHOLD]
  );

  const reportIds: string[] = [];

  const ROUND_DOWN = 1;
  const PREC = 8;
  for (const row of aggregated.rows) {
    const userId = row.user_id;
    const totalAmount = new Decimal(row.total_amount ?? '0').toDecimalPlaces(PREC, ROUND_DOWN).toString();
    const txnCount = parseInt(row.txn_count, 10);

    const txns = await db.query<{
      id: string;
      txn_type: string;
      asset: string | null;
      amount: string | null;
      fiat_amount: string | null;
      created_at: string;
    }>(
      `SELECT id, txn_type, asset, amount, fiat_amount, created_at
       FROM aml_transaction_logs
       WHERE user_id = $1
         AND created_at >= $2::date
         AND created_at < ($3::date + INTERVAL '1 day')
         AND fiat_currency = 'INR'
         AND fiat_amount >= $4
       ORDER BY created_at`,
      [userId, periodStart, periodEnd, CTR_INR_THRESHOLD]
    );

    const payload = {
      reportType: 'CTR',
      periodStart,
      periodEnd,
      userId,
      totalFiatAmountINR: totalAmount,
      transactionCount: txnCount,
      thresholdINR: String(CTR_INR_THRESHOLD),
      transactions: txns.rows.map((t) => ({
        transactionLogId: t.id,
        txnType: t.txn_type,
        asset: t.asset,
        amount: t.amount != null ? new Decimal(t.amount).toDecimalPlaces(PREC, ROUND_DOWN).toString() : null,
        fiatAmountINR: t.fiat_amount != null ? new Decimal(t.fiat_amount).toDecimalPlaces(PREC, ROUND_DOWN).toString() : null,
        createdAt: t.created_at,
      })),
      generatedAt: new Date().toISOString(),
    };

    try {
      const ins = await db.query<{ id: string }>(
        `INSERT INTO aml_str_ctr_logs (report_type, user_id, period_start, period_end, total_amount, status, payload)
         VALUES ('CTR', $1, $2::date, $3::date, $4, 'pending', $5::jsonb)
         RETURNING id`,
        [userId, periodStart, periodEnd, totalAmount, JSON.stringify(payload)]
      );
      if (ins.rows[0]?.id) reportIds.push(ins.rows[0].id);
    } catch (e) {
      logger.warn('CTR report insert failed (best-effort)', {
        userId,
        periodStart,
        periodEnd,
        error: e instanceof Error ? e.message : 'Unknown',
      });
    }
  }

  return { reportIds };
}

// ---------------------------------------------------------------------------
// generateSTR
// Groups open aml_alerts in the period by user; one aml_str_ctr_logs row per user.
// Optionally marks those alerts as status = 'reported'.
// ---------------------------------------------------------------------------

export async function generateSTR(params: GenerateSTRParams): Promise<{ reportIds: string[] }> {
  const periodStart = toDateString(params.periodStart);
  const periodEnd = toDateString(params.periodEnd);
  const markAlertsReported = params.markAlertsReported ?? true;

  const alerts = await db.query<{
    id: string;
    user_id: string;
    alert_type: string;
    severity: string;
    status: string;
    details: unknown;
    created_at: string;
  }>(
    `SELECT id, user_id, alert_type, severity, status, details, created_at
     FROM aml_alerts
     WHERE created_at >= $1::date
       AND created_at < ($2::date + INTERVAL '1 day')
       AND status = 'open'
     ORDER BY user_id, created_at`,
    [periodStart, periodEnd]
  );

  const byUser = new Map<
    string,
    { id: string; alert_type: string; severity: string; status: string; details: unknown; created_at: string }[]
  >();
  for (const a of alerts.rows) {
    const list = byUser.get(a.user_id) ?? [];
    list.push({
      id: a.id,
      alert_type: a.alert_type,
      severity: a.severity,
      status: a.status,
      details: a.details,
      created_at: a.created_at,
    });
    byUser.set(a.user_id, list);
  }

  const reportIds: string[] = [];
  const alertIdsToMark: string[] = [];

  for (const [userId, userAlerts] of byUser) {
    const payload = {
      reportType: 'STR',
      periodStart,
      periodEnd,
      userId,
      alertCount: userAlerts.length,
      alerts: userAlerts.map((a) => ({
        alertId: a.id,
        alertType: a.alert_type,
        severity: a.severity,
        details: a.details ?? null,
        createdAt: a.created_at,
      })),
      generatedAt: new Date().toISOString(),
    };

    userAlerts.forEach((a) => alertIdsToMark.push(a.id));

    try {
      const ins = await db.query<{ id: string }>(
        `INSERT INTO aml_str_ctr_logs (report_type, user_id, period_start, period_end, total_amount, status, payload)
         VALUES ('STR', $1, $2::date, $3::date, NULL, 'pending', $4::jsonb)
         RETURNING id`,
        [userId, periodStart, periodEnd, JSON.stringify(payload)]
      );
      if (ins.rows[0]?.id) reportIds.push(ins.rows[0].id);
    } catch (e) {
      logger.warn('STR report insert failed (best-effort)', {
        userId,
        periodStart,
        periodEnd,
        error: e instanceof Error ? e.message : 'Unknown',
      });
    }
  }

  if (markAlertsReported && alertIdsToMark.length > 0) {
    try {
      await db.query(
        `UPDATE aml_alerts SET status = 'reported' WHERE id = ANY($1::uuid[])`,
        [alertIdsToMark]
      );
    } catch (e) {
      logger.warn('AML alerts mark reported failed (best-effort)', {
        error: e instanceof Error ? e.message : 'Unknown',
      });
    }
  }

  return { reportIds };
}

// ---------------------------------------------------------------------------
// Admin lifecycle: mark report as submitted / acknowledged
// ---------------------------------------------------------------------------

export async function markReportSubmitted(reportId: string): Promise<boolean> {
  const result = await db.query(
    `UPDATE aml_str_ctr_logs SET status = 'submitted' WHERE id = $1 AND status = 'pending'`,
    [reportId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function markReportAcknowledged(reportId: string): Promise<boolean> {
  const result = await db.query(
    `UPDATE aml_str_ctr_logs SET status = 'acknowledged' WHERE id = $1 AND status = 'submitted'`,
    [reportId]
  );
  return (result.rowCount ?? 0) > 0;
}

/*
  Example payload structures (human-readable JSON in payload column):

  CTR payload:
  {
    "reportType": "CTR",
    "periodStart": "2025-01-01",
    "periodEnd": "2025-01-31",
    "userId": "uuid",
    "totalFiatAmountINR": 2500000,
    "transactionCount": 3,
    "thresholdINR": 1000000,
    "transactions": [
      {
        "transactionLogId": "uuid",
        "txnType": "deposit",
        "asset": "USDT",
        "amount": 50000,
        "fiatAmountINR": 1000000,
        "createdAt": "2025-01-15T10:00:00Z"
      }
    ],
    "generatedAt": "2025-02-01T12:00:00Z"
  }

  STR payload:
  {
    "reportType": "STR",
    "periodStart": "2025-01-01",
    "periodEnd": "2025-01-31",
    "userId": "uuid",
    "alertCount": 2,
    "alerts": [
      {
        "alertId": "uuid",
        "alertType": "large_fiat_txn",
        "severity": "high",
        "details": { "rule": "large_fiat_txn", "fiatAmount": 1500000 },
        "createdAt": "2025-01-10T09:00:00Z"
      }
    ],
    "generatedAt": "2025-02-01T12:00:00Z"
  }

  FIU-IND submission flow (manual assumption):
  1. Run generateCTR / generateSTR for the reporting period (e.g. monthly).
  2. Export or query aml_str_ctr_logs for status = 'pending' (or 'submitted').
  3. Convert payload (or join with users/KYC data) into FIU-IND prescribed format.
  4. Upload via FIU-IND portal or API as per their process.
  5. Call markReportSubmitted(reportId) when upload is confirmed.
  6. When FIU-IND acknowledges receipt, call markReportAcknowledged(reportId).
*/
