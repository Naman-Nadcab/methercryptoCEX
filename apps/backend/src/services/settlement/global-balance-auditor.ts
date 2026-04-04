/**
 * Settlement ledger aggregate audit (corruption detection).
 *
 * Invariant: SUM(settlement_ledger_entries.delta) per (user_id, asset) MUST equal the
 * cumulative net deltas implied by all processed settlement_events (match replay).
 *
 * This intentionally does NOT compare settlement ledger to user_balances: trading balances
 * include funding, transfers, opening_balance backfills, etc. That separation is enforced by
 * runSpotIntegrityCheck (balance_ledger vs user_balances).
 *
 * On aggregate mismatch: SETTLEMENT_LEDGER_AGGREGATE_MISMATCH (circuit), not GLOBAL_BALANCE_INVARIANT_VIOLATION.
 */
import { Decimal, type DecimalInstance } from '../../lib/decimal.js';
import { db } from '../../lib/database.js';
import { logger } from '../../lib/logger.js';
import { triggerCircuitIfViolation } from './settlement-circuit.js';
import { recordSettlementEvent } from '../exchange-monitoring.service.js';
import { config } from '../../config/index.js';
import { resolveMarketAssets, normalizeSettlementPayload } from './settlement-worker.js';
import { computeSettlementLedgerDeltasFromPayload } from './settlement-ledger-deltas.js';

function aggKey(userId: string, asset: string): string {
  return `${String(userId).toLowerCase()}|${String(asset).trim()}`;
}

export async function runGlobalBalanceAudit(): Promise<{ ok: boolean; mismatches: number }> {
  const client = await db.getSettlementClient();
  let mismatches = 0;
  try {
    const expected = new Map<string, DecimalInstance>();

    const events = await client.query<{ id: number; payload: unknown }>(
      `SELECT id, payload FROM settlement_events WHERE status = 'processed' ORDER BY id ASC`
    );

    const makerRebatesEnabled = config.features.makerRebatesEnabled;
    let replayFailureCount = 0;

    for (const row of events.rows) {
      try {
        const p = normalizeSettlementPayload(row.payload);
        const market = await resolveMarketAssets(client, p.symbol);
        const deltas = computeSettlementLedgerDeltasFromPayload(
          p,
          {
            base: market.base,
            quote: market.quote,
            price_precision: market.price_precision,
            qty_precision: market.qty_precision,
            quote_precision: market.quote_precision,
          },
          makerRebatesEnabled
        );
        for (const d of deltas) {
          const k = aggKey(d.user_id, d.asset);
          expected.set(k, (expected.get(k) ?? new Decimal(0)).plus(d.delta));
        }
      } catch (e) {
        replayFailureCount++;
        const msg = e instanceof Error ? e.message : String(e);
        triggerCircuitIfViolation('SETTLEMENT_LEDGER_AGGREGATE_MISMATCH');
        logger.error('GLOBAL_SETTLEMENT_LEDGER_AUDIT_CRITICAL', {
          message: 'Failed to replay processed settlement_event for aggregate audit',
          settlement_event_id: row.id,
          error: msg,
          diagnostic: 'Investigate payload, market config, or enum migration.',
        });
      }
    }

    if (replayFailureCount > 0) {
      return { ok: false, mismatches: replayFailureCount };
    }

    const actualRows = await client.query<{ user_id: string; asset: string; sum: string }>(
      `SELECT user_id::text AS user_id, asset, COALESCE(SUM(delta), 0)::text AS sum
       FROM settlement_ledger_entries GROUP BY user_id, asset`
    );

    const actual = new Map<string, DecimalInstance>();
    for (const r of actualRows.rows) {
      actual.set(aggKey(r.user_id, r.asset), new Decimal(r.sum ?? '0'));
    }

    const allKeys = new Set<string>([...expected.keys(), ...actual.keys()]);
    const CIRCUIT_ABS_THRESHOLD = new Decimal(process.env.AUDIT_CIRCUIT_ABS_THRESHOLD || '1000');
    let criticalMismatches = 0;

    for (const k of allKeys) {
      const exp = expected.get(k) ?? new Decimal(0);
      const act = actual.get(k) ?? new Decimal(0);
      if (!exp.eq(act)) {
        mismatches++;
        const drift = exp.minus(act).abs();
        const pipeIdx = k.indexOf('|');
        const userId = pipeIdx === -1 ? k : k.slice(0, pipeIdx);
        const asset = pipeIdx === -1 ? '' : k.slice(pipeIdx + 1);

        if (drift.gte(CIRCUIT_ABS_THRESHOLD)) {
          criticalMismatches++;
          triggerCircuitIfViolation('SETTLEMENT_LEDGER_AGGREGATE_MISMATCH');
          recordSettlementEvent({
            type: 'failure_fatal',
            error: `settlement_ledger aggregate mismatch: expected=${exp.toString()} actual=${act.toString()}`,
            userId,
            asset: asset || undefined,
          });
          logger.error('GLOBAL_SETTLEMENT_LEDGER_AUDIT_CRITICAL', {
            message: 'Settlement ledger cumulative delta does not match replay — exceeds circuit threshold',
            user_id: userId,
            asset,
            expected_cumulative_delta: exp.toString(),
            actual_cumulative_delta: act.toString(),
            drift: drift.toString(),
            threshold: CIRCUIT_ABS_THRESHOLD.toString(),
          });
        } else {
          logger.warn('GLOBAL_SETTLEMENT_LEDGER_AUDIT_DRIFT', {
            message: 'Small settlement ledger drift (below circuit threshold)',
            user_id: userId,
            asset,
            drift: drift.toString(),
            threshold: CIRCUIT_ABS_THRESHOLD.toString(),
          });
        }
      }
    }

    return { ok: criticalMismatches === 0, mismatches };
  } finally {
    client.release();
  }
}
