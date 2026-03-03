# Runbook: Circuit Breaker (Settlement / Global Balance Invariant)

When the settlement circuit opens, trading continues but settlement stops. Use this runbook to safely recover.

---

## 1. When Circuit Opens

The circuit opens on:

- **GLOBAL_BALANCE_INVARIANT_VIOLATION** — `balance_ledger` sums don't match `user_balances` for the trading account
- **Settlement integrity failure** — replay or audit detects mismatches

---

## 2. Immediate Actions

1. **Halt trading**  
   - Go to Admin → Monitoring → Operator Controls  
   - Set **Trading Halted** = ON  
   - This stops new orders and prevents further divergence

2. **Identify root cause**  
   - Check logs for `SPOT_INTEGRITY_CHECK_CRITICAL`, `Settlement replay integrity`, or `GLOBAL_BALANCE_INVARIANT_VIOLATION`  
   - Note affected `user_id`, `currency_id`, and the mismatch values

3. **Do NOT auto-repair**  
   - Ledger/balance repair must be manual and audited  
   - Do not run ad-hoc SQL to “fix” balances without understanding the cause

---

## 3. Recovery Steps

1. **Verify trading is halted**  
   - `getTradingHalted()` must return true before reconcile runs

2. **Run balance-to-ledger reconcile**  
   - Operator Controls → Reconcile Balance to Ledger  
   - This uses `user_balances` as source of truth and rewrites `balance_ledger` entries where needed  
   - Reconcile runs only when trading is halted

3. **Re-run integrity checks**  
   - Spot integrity check  
   - Settlement replay integrity check  
   - Confirm mismatches = 0

4. **Reset the circuit**  
   - Admin → Operator Controls → Circuit Reset  
   - Requires `super_admin` permission

5. **Resume trading**  
   - Set **Trading Halted** = OFF  
   - Monitor logs and metrics for a short period

---

## 4. Prevention

- Ensure only one instance runs `reconcileBalanceToLedger` at a time
- Always halt trading before reconcile
- Review and fix any code paths that update balances without corresponding ledger entries

---

## 5. References

- `settlement-circuit.ts` — `triggerCircuitIfViolation`, `getSettlementCircuitOpen`
- `operator-controls.service.ts` — `reconcileBalanceToLedger` (requires halt)
- `spot-integrity.service.ts` — periodic balance vs ledger check
