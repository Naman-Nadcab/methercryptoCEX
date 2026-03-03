# FIU/AML Logs Verification Checklist

**Purpose:** Verify `aml_transaction_logs` and `recordAndEvaluate` are wired for all fund-moving flows. Required for FIU-IND compliance and STR/CTR reporting.

---

## 1. recordAndEvaluate — Current Wiring

| Flow | Location | txnType | Status | Notes |
|------|----------|---------|--------|-------|
| **Deposit** | deposit-credit.service.ts | `deposit` | ✅ | `recordAndEvaluateForDeposit(depositId)` after credit |
| **Withdrawal (internal)** | wallet.fastify.ts | `internal_transfer` | ✅ | Buyer + seller on user-to-user transfer |
| **Withdrawal (on-chain)** | wallet.fastify.ts | — | ✅ | `recordAndEvaluate` with `withdrawal` (line ~2470) |
| **Spot trade** | spot.fastify.ts | `trade` | ✅ | Per fill: buyer + seller |
| **Spot stop-order** | spot-trigger.service.ts | `trade` | ✅ | Per fill: buyer + seller |
| **P2P order release** | p2p.fastify.ts | `p2p` | ✅ | Buyer + seller after `releaseCrypto` success |

---

## 2. aml_transaction_logs — Populated By

- `recordTransaction()` / `recordAndEvaluate()` inserts into `aml_transaction_logs`
- Columns: `user_id`, `txn_type`, `asset`, `amount`, `fiat_amount`, `fiat_currency`, `country_code`, `created_at`

---

## 3. AML Rules Evaluated (evaluateTransactionForAlerts)

| Rule | Threshold | Config |
|------|-----------|--------|
| Large fiat (INR) | ≥ ₹10,00,000 | `AML_LARGE_FIAT_INR_THRESHOLD` |
| Large crypto withdrawal | ≥ 100,000 USDT equiv | `AML_LARGE_CRYPTO_WITHDRAWAL_THRESHOLD` |
| Velocity (withdrawals) | ≥ 3 in 24h | `AML_VELOCITY_WINDOW_HOURS`, `AML_VELOCITY_WITHDRAWAL_COUNT` |
| High-risk country | Config list | `AML_HIGH_RISK_COUNTRIES` |

---

## 4. Audit Logs (audit_logs_immutable)

| Action | Status |
|--------|--------|
| Manual credit | ✅ |
| User suspend/activate | ✅ |
| KYC approve/reject | ✅ |
| Escrow freeze/unfreeze | ✅ |
| Withdrawal approve/reject | ✅ |

---

## 6. Config Reference

| Env | Default | Purpose |
|-----|---------|---------|
| `AML_LARGE_FIAT_INR_THRESHOLD` | 1000000 | Large fiat alert |
| `AML_LARGE_CRYPTO_WITHDRAWAL_THRESHOLD` | 100000 | Large crypto withdrawal alert |
| `AML_VELOCITY_WINDOW_HOURS` | 24 | Velocity window |
| `AML_VELOCITY_WITHDRAWAL_COUNT` | 3 | Velocity threshold |
| `AML_HIGH_RISK_COUNTRIES` | (empty) | Comma-separated country codes |
