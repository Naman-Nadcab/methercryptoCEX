# Circuit Breaker Runbook

**Purpose:** Steps to follow when the settlement circuit opens or integrity checks fail.

---

## 1. When Circuit Opens

The circuit breaker can open when:
- Settlement integrity check fails
- Ledger mismatch detected
- Spot integrity check finds mismatches
- Global balance audit reports mismatches

---

## 2. Immediate Actions

| Step | Action |
|------|--------|
| 1 | **Halt trading** — Admin → Trading → Trading Halt (or set `MAINTENANCE_MODE=true`) |
| 2 | **Check logs** — Look for `mismatches`, `CRITICAL`, `integrity` in backend logs |
| 3 | **Do NOT reset circuit** until root cause is understood |

---

## 3. Integrity Check Flow

```
1. Run global balance audit
   → Check CRITICAL logs for user_id, asset, expected vs actual

2. Run settlement replay integrity
   → Compare ledger vs settlement events

3. Run spot integrity check
   → Compare user_balances vs sum(spot trades)

4. Review wallet reconciliation
   → Admin → Wallets → Ledger / Reconciliation
```

---

## 4. Resolution Paths

### A. Ledger Mismatch (user_balances ≠ ledger sum)

1. Identify affected user(s) and asset(s)
2. Run reconciliation: Admin → Ledger → Reconcile (or `reconcileBalanceToLedger`)
3. Re-verify after reconcile
4. If discrepancy remains: manual adjustment with audit trail

### B. Settlement Event Mismatch

1. Check `settlement_events` and `balance_ledger` for gaps
2. Review match poller and settlement worker logs
3. Replay failed settlements if safe
4. Contact ops/DevOps if data corruption suspected

### C. Spot Balance Mismatch

1. Check `spot_trades` vs `user_balances` (trading account)
2. Spot integrity job logs which user/asset mismatches
3. Reconcile trading balance to ledger
4. Re-run spot integrity until clean

---

## 5. Circuit Reset (Only After Resolution)

| Step | Action |
|------|--------|
| 1 | Confirm all integrity checks pass |
| 2 | Admin → Settlement / Circuit → Reset (requires `super_admin`) |
| 3 | Resume trading only after reset succeeds |
| 4 | Monitor for 15–30 min after resume |

---

## 6. Prevention

- Ensure only one settlement worker instance
- Do not run reconciliation during active trading
- Halt trading before manual balance adjustments
- Keep Redis and DB in sync; avoid Redis flush during ops
