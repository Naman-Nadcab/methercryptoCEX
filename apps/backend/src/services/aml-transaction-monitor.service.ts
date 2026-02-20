/**
 * AML transaction monitoring (Step 6C). Records transactions to aml_transaction_logs
 * and evaluates rules to create aml_alerts. India-oriented thresholds; config-driven.
 * All alert creation is best-effort (does not block the transaction).
 */

import { Decimal } from '../lib/decimal.js';
import { db } from '../lib/database.js';
import { logger } from '../lib/logger.js';
import { config } from '../config/index.js';

export type TxnType = 'deposit' | 'withdrawal' | 'trade' | 'p2p' | 'internal_transfer';

export interface RecordTransactionParams {
  userId: string;
  txnType: TxnType;
  asset?: string | null;
  amount?: number | string | null;
  fiatAmount?: number | string | null;
  fiatCurrency?: string | null;
  countryCode?: string | null;
}

export interface EvaluateTransactionParams extends RecordTransactionParams {
  /** Optional: log id just inserted by recordTransaction (for correlation). */
  transactionLogId?: string | null;
}

// ---------------------------------------------------------------------------
// recordTransaction — insert into aml_transaction_logs
// ---------------------------------------------------------------------------

export async function recordTransaction(params: RecordTransactionParams): Promise<string | null> {
  const {
    userId,
    txnType,
    asset = null,
    amount = null,
    fiatAmount = null,
    fiatCurrency = null,
    countryCode = null,
  } = params;

  const amountStr = amount != null ? (typeof amount === 'string' ? amount : new Decimal(amount).toString()) : null;
  const fiatAmountStr = fiatAmount != null ? (typeof fiatAmount === 'string' ? fiatAmount : new Decimal(fiatAmount).toString()) : null;

  try {
    const result = await db.query<{ id: string }>(
      `INSERT INTO aml_transaction_logs (user_id, txn_type, asset, amount, fiat_amount, fiat_currency, country_code)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [userId, txnType, asset ?? null, amountStr, fiatAmountStr, fiatCurrency ?? null, countryCode?.trim().toUpperCase() ?? null]
    );
    return result.rows[0]?.id ?? null;
  } catch (e) {
    logger.warn('AML transaction log insert failed (best-effort)', {
      userId,
      txnType,
      error: e instanceof Error ? e.message : 'Unknown',
    });
    return null;
  }
}

// ---------------------------------------------------------------------------
// createAlert — insert into aml_alerts (best-effort)
// ---------------------------------------------------------------------------

async function createAlert(params: {
  userId: string;
  alertType: string;
  severity: string;
  details: Record<string, unknown>;
}): Promise<void> {
  try {
    await db.query(
      `INSERT INTO aml_alerts (user_id, alert_type, severity, status, details)
       VALUES ($1, $2, $3, 'open', $4::jsonb)`,
      [params.userId, params.alertType, params.severity, JSON.stringify(params.details)]
    );
  } catch (e) {
    logger.warn('AML alert insert failed (best-effort)', {
      userId: params.userId,
      alertType: params.alertType,
      error: e instanceof Error ? e.message : 'Unknown',
    });
  }
}

// ---------------------------------------------------------------------------
// evaluateTransactionForAlerts — run rules, create alerts when triggered
// Uses config.aml for thresholds and high-risk country list.
// ---------------------------------------------------------------------------

export async function evaluateTransactionForAlerts(params: EvaluateTransactionParams): Promise<void> {
  const { userId, txnType, asset, amount, fiatAmount, fiatCurrency, countryCode } = params;
  const cfg = config.aml;

  const amountDec = amount != null ? new Decimal(typeof amount === 'string' ? amount : amount) : null;
  const fiatAmountDec = fiatAmount != null ? new Decimal(typeof fiatAmount === 'string' ? fiatAmount : fiatAmount) : null;
  const country = countryCode?.trim().toUpperCase() ?? null;
  const largeFiatThreshold = new Decimal(cfg.largeFiatInrThreshold);

  // Rule: large fiat transaction (INR threshold)
  const isInr = !fiatCurrency || fiatCurrency.toUpperCase() === 'INR';
  if (isInr && fiatAmountDec != null && fiatAmountDec.gte(largeFiatThreshold)) {
    await createAlert({
      userId,
      alertType: 'large_fiat_txn',
      severity: 'high',
      details: {
        rule: 'large_fiat_txn',
        fiatAmount: fiatAmountDec.toString(),
        fiatCurrency: fiatCurrency ?? 'INR',
        threshold: cfg.largeFiatInrThreshold,
      },
    });
  }

  // Rule: large crypto withdrawal
  const largeCryptoThreshold = new Decimal(cfg.largeCryptoWithdrawalThreshold);
  if (txnType === 'withdrawal' && amountDec != null && amountDec.gte(largeCryptoThreshold)) {
    await createAlert({
      userId,
      alertType: 'large_crypto_withdrawal',
      severity: 'high',
      details: {
        rule: 'large_crypto_withdrawal',
        asset: asset ?? null,
        amount: amountDec.toString(),
        threshold: cfg.largeCryptoWithdrawalThreshold,
      },
    });
  }

  // Rule: velocity — >= N withdrawals in last 24h (query aml_transaction_logs)
  if (txnType === 'withdrawal') {
    try {
      const windowHours = cfg.velocityWindowHours;
      const countResult = await db.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM aml_transaction_logs
         WHERE user_id = $1 AND txn_type = 'withdrawal' AND created_at > NOW() - ($2 || ' hours')::interval`,
        [userId, windowHours]
      );
      const count = parseInt(countResult.rows[0]?.count ?? '0', 10);
      if (count >= cfg.velocityWithdrawalCount) {
        await createAlert({
          userId,
          alertType: 'velocity',
          severity: 'medium',
          details: {
            rule: 'velocity',
            withdrawalCount: count,
            windowHours,
            threshold: cfg.velocityWithdrawalCount,
          },
        });
      }
    } catch (e) {
      logger.warn('AML velocity check failed (best-effort)', {
        userId,
        error: e instanceof Error ? e.message : 'Unknown',
      });
    }
  }

  // Rule: high-risk country
  if (country && cfg.highRiskCountries.length > 0 && cfg.highRiskCountries.includes(country)) {
    await createAlert({
      userId,
      alertType: 'high_risk_country',
      severity: 'high',
      details: {
        rule: 'high_risk_country',
        countryCode: country,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// recordAndEvaluate — convenience: record then evaluate (both best-effort)
// ---------------------------------------------------------------------------

export async function recordAndEvaluate(params: RecordTransactionParams): Promise<void> {
  const logId = await recordTransaction(params);
  await evaluateTransactionForAlerts({ ...params, transactionLogId: logId   });
}

// ---------------------------------------------------------------------------
// recordAndEvaluateForDeposit — fetch deposit by id, then record + evaluate (best-effort).
// Call after creditDepositIfConfirmed or applyBalanceForOneCompletedDeposit when credited.
// ---------------------------------------------------------------------------
export async function recordAndEvaluateForDeposit(depositId: string): Promise<void> {
  try {
    const row = await db.query<{ user_id: string; currency_id: string; amount: string; symbol: string | null }>(
      `SELECT d.user_id, d.currency_id, d.amount::text AS amount, c.symbol
       FROM deposits d
       LEFT JOIN currencies c ON c.id = d.currency_id
       WHERE d.id = $1`,
      [depositId]
    );
    if (row.rows.length === 0) return;
    const r = row.rows[0]!;
    await recordAndEvaluate({
      userId: r.user_id,
      txnType: 'deposit',
      asset: r.symbol ?? undefined,
      amount: r.amount,
      fiatAmount: null,
      fiatCurrency: 'INR',
      countryCode: null,
    });
  } catch (e) {
    logger.warn('AML recordAndEvaluateForDeposit failed (best-effort)', {
      depositId,
      error: e instanceof Error ? e.message : 'Unknown',
    });
  }
}

/*
  Config example (.env):

  AML_LARGE_FIAT_INR_THRESHOLD=1000000
  AML_LARGE_CRYPTO_WITHDRAWAL_THRESHOLD=100000
  AML_VELOCITY_WITHDRAWAL_COUNT=3
  AML_VELOCITY_WINDOW_HOURS=24
  AML_HIGH_RISK_COUNTRIES=KP,IR,SY

  Integration examples (call after the transaction is committed):

  --- 1) After withdrawal created (in withdrawal route, after INSERT withdrawals): ---

  import { recordAndEvaluate } from '../services/aml-transaction-monitor.service.js';

  await recordAndEvaluate({
    userId,
    txnType: 'withdrawal',
    asset: token.symbol,
    amount: withdrawAmount,
    fiatAmount: null,  // or estimated INR if available
    fiatCurrency: 'INR',
    countryCode: request.countryCode ?? null,
  });

  --- 2) After fiat deposit confirmed: ---

  await recordAndEvaluate({
    userId: deposit.user_id,
    txnType: 'deposit',
    asset: token.symbol,
    amount: deposit.amount,
    fiatAmount: depositFiatValue,
    fiatCurrency: 'INR',
    countryCode: null,
  });
*/
