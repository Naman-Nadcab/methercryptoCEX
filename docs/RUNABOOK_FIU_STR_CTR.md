# Runbook: FIU-INDIA STR / CTR Reporting

When AML rules detect large fiat transactions or suspicious patterns, alerts are created. This runbook covers STR (Suspicious Transaction Report) and CTR (Cash Transaction Report) for FIU-INDIA compliance.

---

## 1. When Alerts Are Generated

- **Large fiat (INR)** — Single transaction ≥ `AML_LARGE_FIAT_INR_THRESHOLD` (default 10 lakh)
- **Large crypto withdrawal** — ≥ `AML_LARGE_CRYPTO_WITHDRAWAL_THRESHOLD`
- **Velocity** — Multiple withdrawals in `AML_VELOCITY_WINDOW_HOURS` ≥ `AML_VELOCITY_WITHDRAWAL_COUNT`
- **High-risk country** — User / counterparty in `AML_HIGH_RISK_COUNTRIES`

---

## 2. Escalation Path

1. AML alerts appear in Admin → Compliance → Alerts  
2. Analyst reviews and marks as **escalated** (or dismisses if false positive)  
3. `aml:escalate` permission required to escalate  
4. Escalated alerts feed into STR/CTR generation

---

## 3. STR / CTR Generation

- STR and CTR reports are generated from escalated AML alerts and transaction data  
- Reports follow FIU-INDIA prescribed format  
- Generation is done via Admin Compliance UI or internal tools

---

## 4. Upload to FIU-INDIA

- STR/CTR must be uploaded manually to the FIU portal  
- Process: Download report → Log into FIU-INDIA portal → Upload file → Note acknowledgment/reference ID  
- Store acknowledgment in your records for audit

---

## 5. Timeline

- STR: Within 7 days of determining a transaction is suspicious  
- CTR: As per FIU-INDIA rules (typically monthly or threshold-based)  
- Maintain logs of when reports were generated and when they were submitted

---

## 6. References

- `docs/FIU_INDIA_COMPLIANCE.md` — FIU-INDIA compliance overview
- `aml-transaction-monitor.service.ts` — `recordAndEvaluate`
- Admin Compliance routes — `/api/v1/admin/compliance/*`
