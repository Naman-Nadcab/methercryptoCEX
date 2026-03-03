# FIU-IND & PMLA Compliance — India

This document outlines the exchange’s approach to **FIU-IND** (Financial Intelligence Unit - India) and **PMLA** (Prevention of Money Laundering Act) requirements for crypto asset service providers.

---

## 1. Regulatory Context

- **PMLA, 2002** (as amended): Applies to Virtual Digital Asset (VDA) service providers.
- **FIU-IND**: Central agency for receiving, processing, and disseminating financial intelligence.
- **SEBI/RBI**: Crypto exchanges may need to align with evolving guidelines.

---

## 2. Implementation Status

### 2.1 KYC (Know Your Customer)

- **PAN + Aadhaar** (front/back, selfie) and optional DigiLocker flow.
- KYC enforcement: Deposit address, withdrawal, P2P sell, and fiat withdrawal require **approved KYC**.
- Pending KYC: P2P buy and spot trade allowed; withdrawal and P2P sell blocked.

### 2.2 AML (Anti-Money Laundering)

- Transaction monitoring (`aml-transaction-monitor.service`):
  - Large fiat (INR ≥ ₹10,00,000)
  - Large crypto withdrawal (≥ 100,000 USDT equivalent)
  - Velocity (≥ 3 withdrawals in 24h)
  - High-risk countries (configurable)
- Alerts stored in `aml_alerts`; admin can escalate to STR.
- STR/CTR logs: `aml_str_ctr_logs` for report lifecycle.

### 2.3 P2P Limits (FIU India)

- Per-trade limit: ₹5,00,000 INR (config: `P2P_MAX_FIAT_PER_ORDER_INR`).
- Per-trade crypto: $50,000 USDT equivalent (config: `P2P_MAX_CRYPTO_PER_ORDER_USDT`).
- Daily per-user limit: ₹10,00,000 INR (config: `P2P_MAX_FIAT_PER_USER_DAILY_INR`).

### 2.4 Audit Trail

- Admin user status change: `status_reason` persisted on `users` table.
- Audit logs: `audit_logs`, `audit_logs_immutable` for critical actions.
- KYC, withdrawals, P2P disputes, and compliance actions are logged.

---

## 3. FIU-IND Registration & Reporting

- **Registration**: VDA service providers must register with FIU-IND as reporting entities.
- **Reporting**: STR (Suspicious Transaction Report) and CTR (Cash Transaction Report) as required.
- **Internal process**: AML alerts → Admin review → Escalate to STR → Submit to FIU-IND via designated channel.

**Action**: Confirm FIU-IND registration status and use official reporting channels for STR/CTR submission.

---

## 4. User-Facing Compliance Notices

- **Terms of Service** (`/terms`): Risk warning, regulatory compliance, and user obligations.
- **P2P**: Limits and compliance info shown where relevant.
- **Deposit/Withdraw**: KYC requirement communicated before access.

---

## 5. Config Reference

| Env Variable | Default | Description |
|--------------|---------|-------------|
| `P2P_MAX_FIAT_PER_ORDER_INR` | 500000 | Max INR per P2P order |
| `P2P_MAX_CRYPTO_PER_ORDER_USDT` | 50000 | Max USDT equivalent per P2P order |
| `P2P_MAX_FIAT_PER_USER_DAILY_INR` | 1000000 | Max INR per user per 24h |
| `AML_LARGE_FIAT_INR_THRESHOLD` | 1000000 | Large fiat threshold for AML alert |
| `AML_LARGE_CRYPTO_WITHDRAWAL_THRESHOLD` | 100000 | Large crypto withdrawal threshold |

---

## 6. References

- PMLA, 2002 (as amended)
- FIU-IND guidelines for VDA service providers
- RBI circulars on virtual assets (as applicable)
