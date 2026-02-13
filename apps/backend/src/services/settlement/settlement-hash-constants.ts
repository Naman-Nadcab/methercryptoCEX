/**
 * Domain constants for settlement and ledger hashing.
 * Ensures identical construction across worker and validators; no legacy concatenation.
 */
export const LEDGER_ENTRY_DOMAIN = 'ledger_entry_v1';
export const SETTLEMENT_EVENT_DOMAIN = 'settlement_event_v1';
