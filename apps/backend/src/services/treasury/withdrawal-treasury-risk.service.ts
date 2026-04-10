/**
 * Supplemental treasury checks: new destination, velocity, abnormal size → manual review (pending_approval).
 */
import { Decimal } from '../../lib/decimal.js';
import { db } from '../../lib/database.js';
import { config } from '../../config/index.js';
import { logger } from '../../lib/logger.js';
import { sendOpsAlert } from '../ops-alert.service.js';

export interface TreasuryRiskResult {
  requiresManualReview: boolean;
  signals: string[];
}

export async function assessWithdrawalTreasuryRisk(params: {
  userId: string;
  toAddress: string;
  amount: string;
  symbol: string;
}): Promise<TreasuryRiskResult> {
  const signals: string[] = [];
  const windowMin = config.treasury.velocityWindowMin;
  const maxVel = config.treasury.velocityMax;
  const multWarn = new Decimal(config.treasury.amountMultiplierWarn || '10');

  const vel = await db.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM withdrawals
     WHERE user_id = $1::uuid
       AND created_at > NOW() - ($2::text || ' minutes')::interval
       AND status NOT IN ('failed', 'cancelled')`,
    [params.userId, String(windowMin)]
  );
  const n = parseInt(vel.rows[0]?.n ?? '0', 10) || 0;
  if (n >= maxVel) {
    signals.push('withdrawal_velocity');
  }

  const addrNorm = params.toAddress.trim().toLowerCase();
  const seen = await db.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM withdrawals
     WHERE user_id = $1::uuid AND LOWER(TRIM(to_address)) = $2
       AND status IN ('completed', 'pending', 'pending_approval', 'processing')`,
    [params.userId, addrNorm]
  );
  if ((parseInt(seen.rows[0]?.n ?? '0', 10) || 0) === 0) {
    signals.push('new_withdrawal_address');
  }

  const hist = await db.query<{ avg_amt: string }>(
    `SELECT COALESCE(AVG(amount::numeric), 0)::text AS avg_amt FROM withdrawals
     WHERE user_id = $1::uuid AND status = 'completed' AND created_at > NOW() - INTERVAL '90 days'`,
    [params.userId]
  );
  const avg = new Decimal(hist.rows[0]?.avg_amt ?? '0');
  const amt = new Decimal(params.amount);
  if (avg.gt(0) && amt.gt(avg.times(multWarn))) {
    signals.push('abnormal_amount_vs_history');
  }

  if (signals.length > 0) {
    logger.warn('withdrawal_treasury_risk: manual review signals', { userId: params.userId, signals });
    void sendOpsAlert({
      severity: 'warning',
      alertType: 'treasury',
      title: 'Withdrawal anomaly (treasury risk)',
      body: `User ${params.userId} signals: ${signals.join(', ')}`,
      dedupeKey: `wd-anom:${params.userId}:${signals.sort().join(',')}`,
      context: { userId: params.userId, signals, symbol: params.symbol },
    });
  }

  return {
    requiresManualReview: signals.length > 0,
    signals,
  };
}
