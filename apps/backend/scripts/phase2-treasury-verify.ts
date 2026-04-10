/**
 * Phase-2 treasury + polish smoke checks (no live chain / DB required for core assertions).
 * Run: npm run test:phase2-treasury  (from apps/backend)
 */
import { auditImmutableEntryHashMatches, expectedAuditEntryHashFromImmutableRow } from '../src/services/audit-log.service.js';

function fail(msg: string): never {
  console.error('FAIL:', msg);
  process.exit(1);
}

async function main() {
  const row = {
    prev_hash: 'genesis',
    request_id: null as string | null,
    actor_type: 'system',
    actor_id: null as string | null,
    action: 'phase2_verify',
    resource_type: 'test',
    resource_id: null as string | null,
    old_value: null as string | null,
    new_value: null as string | null,
    ip_address: null as string | null,
    user_agent: null as string | null,
    entry_hash: null as string | null,
  };
  row.entry_hash = expectedAuditEntryHashFromImmutableRow(row);
  if (!auditImmutableEntryHashMatches(row)) {
    fail('audit immutable entry_hash chain verify');
  }
  const tampered = { ...row, entry_hash: 'deadbeef' };
  if (auditImmutableEntryHashMatches(tampered)) {
    fail('tampered entry_hash must not verify');
  }

  const { config } = await import('../src/config/index.js');
  if (typeof config.balanceConsistency.tolerance !== 'string') {
    fail('balanceConsistency.tolerance must be configured');
  }
  if (typeof config.orderbook.maxAgeMs !== 'number') {
    fail('orderbook.maxAgeMs must be configured');
  }
  if (typeof config.treasury.velocityMax !== 'number') {
    fail('treasury.velocityMax must be configured');
  }

  const { isOrderbookStaleForSymbol } = await import('../src/services/spot-orderbook-public.service.js');
  if (typeof isOrderbookStaleForSymbol('BTC_USDT') !== 'boolean') {
    fail('isOrderbookStaleForSymbol must return boolean');
  }

  console.log('OK phase2-treasury-verify');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
