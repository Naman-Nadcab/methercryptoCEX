/**
 * Optional Tier-1 release gate: no pending settlement_events.
 * Set TIER1_REQUIRE_ZERO_PENDING_SETTLEMENT=true in CI/staging/prod cutover.
 */
export function assertZeroPendingSettlement(pendingCountStr: string, logPrefix: string): void {
  if (process.env.TIER1_REQUIRE_ZERO_PENDING_SETTLEMENT !== 'true') return;
  if (pendingCountStr === '0') return;
  console.error(
    `${logPrefix} TIER1_FAIL: settlement_events_pending=${pendingCountStr} (required 0). ` +
      'Drain the settlement worker or unset TIER1_REQUIRE_ZERO_PENDING_SETTLEMENT.'
  );
  process.exit(1);
}
