/**
 * Tier-1 periodic reconciliation:
 * - ledger_coverage: processed settlement_events must have settlement_ledger rows
 * - global_settlement_balance: cumulative settlement_ledger deltas vs replay of processed events (NOT vs user_balances)
 * - spot_balance_ledger: balance_ledger vs user_balances (trading)
 * - settlement_replay_hash: per-event hash integrity
 * Does NOT mutate balances or auto-repair; logs CRITICAL, updates Prometheus, and may fire alert webhook (cooldown).
 */
import { db } from '../lib/database.js';
import { logger } from '../lib/logger.js';
import { sendAlertWebhook } from '../lib/alert-webhook.js';
import { recordOperationalEvent } from './exchange-monitoring.service.js';
import { runGlobalBalanceAudit } from './settlement/global-balance-auditor.js';
import { runSpotIntegrityCheck } from './spot-integrity.service.js';
import { replaySettlementIntegrityCheck } from './settlement/settlement-replay-validator.js';
import {
  tier1ReconciliationRunsTotal,
  tier1ReconciliationMismatchTotal,
  tier1SettlementBalanceInvariantOk,
  tier1SpotBalanceLedgerInvariantOk,
  tier1SettlementReplayOk,
  tier1LedgerOrphanProcessedEvents,
  tier1LastReconciliationTimestampSeconds,
} from '../lib/prometheus-metrics.js';

export type Tier1ReconciliationCheckResult = { ok: boolean; mismatches?: number; error?: string };

export type Tier1ReconciliationRoundResult = {
  ok: boolean;
  details: Record<string, Tier1ReconciliationCheckResult>;
};

const ALERT_COOLDOWN_MS = 20 * 60 * 1000;
let lastTier1AlertAt = 0;

/**
 * Single reconciliation round. Safe to call on a timer; failures are reported, not repaired.
 */
export async function runTier1ReconciliationRound(): Promise<Tier1ReconciliationRoundResult> {
  tier1ReconciliationRunsTotal.inc();
  const details: Record<string, Tier1ReconciliationCheckResult> = {};
  let ok = true;

  try {
    const orphan = await db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n
       FROM settlement_events se
       WHERE se.status = 'processed'
         AND NOT EXISTS (
           SELECT 1 FROM settlement_ledger_entries le WHERE le.settlement_event_id = se.id
         )`
    );
    const orphanN = parseInt(orphan.rows[0]?.n ?? '0', 10) || 0;
    tier1LedgerOrphanProcessedEvents.set(orphanN);
    details.ledger_coverage = { ok: orphanN === 0, mismatches: orphanN };
    if (orphanN > 0) {
      ok = false;
      tier1ReconciliationMismatchTotal.inc({ check: 'ledger_coverage' });
      logger.error('TIER1_RECONCILIATION_CRITICAL', {
        check: 'ledger_coverage',
        orphan_processed_without_ledger: orphanN,
        diagnostic: 'Processed settlement_events must have ledger rows. Do NOT auto-fix; investigate worker and DB.',
      });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    details.ledger_coverage = { ok: false, error: msg };
    ok = false;
    logger.error('TIER1_RECONCILIATION ledger_coverage query failed', { error: msg });
  }

  try {
    const gb = await runGlobalBalanceAudit();
    tier1SettlementBalanceInvariantOk.set(gb.ok ? 1 : 0);
    details.global_settlement_balance = { ok: gb.ok, mismatches: gb.mismatches };
    if (!gb.ok) {
      ok = false;
      tier1ReconciliationMismatchTotal.inc({ check: 'global_settlement_balance' });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    tier1SettlementBalanceInvariantOk.set(0);
    details.global_settlement_balance = { ok: false, error: msg };
    ok = false;
    logger.error('TIER1_RECONCILIATION global_settlement_balance failed', { error: msg });
  }

  try {
    const sp = await runSpotIntegrityCheck();
    tier1SpotBalanceLedgerInvariantOk.set(sp.ok ? 1 : 0);
    details.spot_balance_ledger = { ok: sp.ok, mismatches: sp.mismatches };
    if (!sp.ok) {
      ok = false;
      tier1ReconciliationMismatchTotal.inc({ check: 'spot_balance_ledger' });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    tier1SpotBalanceLedgerInvariantOk.set(0);
    details.spot_balance_ledger = { ok: false, error: msg };
    ok = false;
    logger.error('TIER1_RECONCILIATION spot_balance_ledger failed', { error: msg });
  }

  try {
    const replay = await replaySettlementIntegrityCheck();
    tier1SettlementReplayOk.set(replay.ok ? 1 : 0);
    details.settlement_replay_hash = { ok: replay.ok, mismatches: replay.mismatches };
    if (!replay.ok) {
      ok = false;
      tier1ReconciliationMismatchTotal.inc({ check: 'settlement_replay_hash' });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    tier1SettlementReplayOk.set(0);
    details.settlement_replay_hash = { ok: false, error: msg };
    ok = false;
    logger.error('TIER1_RECONCILIATION settlement_replay_hash failed', { error: msg });
  }

  tier1LastReconciliationTimestampSeconds.set(Math.floor(Date.now() / 1000));

  if (!ok) {
    recordOperationalEvent({
      type: 'tier1_reconciliation_failed',
      error: JSON.stringify(details),
    });
    const now = Date.now();
    if (now - lastTier1AlertAt >= ALERT_COOLDOWN_MS) {
      lastTier1AlertAt = now;
      await sendAlertWebhook({
        type: 'tier1_reconciliation',
        message: 'Tier-1 reconciliation detected mismatches. No automatic repair was applied. See logs TIER1_RECONCILIATION_CRITICAL and existing audit logs.',
        mismatches: Object.values(details).filter((d) => !d.ok).length,
        source: 'tier1_reconciliation_round',
      });
    }
  }

  return { ok, details };
}
