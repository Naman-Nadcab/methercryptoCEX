# AML Rule Configuration

AML (Anti-Money Laundering) rules are driven by **environment variables**. Changing thresholds requires updating `.env` and restarting the backend. An admin **read-only** view of current values is available via `GET /api/v1/admin/aml/config` (see Admin AML API).

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `AML_LARGE_FIAT_INR_THRESHOLD` | Fiat (INR) amount above which a transaction triggers a *large_fiat_txn* alert | `1000000` |
| `AML_LARGE_CRYPTO_WITHDRAWAL_THRESHOLD` | Crypto withdrawal amount (notional) above which a *large_crypto_withdrawal* alert is created | `100000` |
| `AML_VELOCITY_WITHDRAWAL_COUNT` | Number of withdrawals in the time window that triggers a *velocity* alert | `3` |
| `AML_VELOCITY_WINDOW_HOURS` | Time window (hours) for velocity rule | `24` |
| `AML_HIGH_RISK_COUNTRIES` | Comma-separated ISO country codes (e.g. `KP,IR,SY`) for high-risk country rule | `KP,IR,SY` |

---

## Rules (summary)

- **Large fiat (INR):** Transaction with fiat amount ≥ `AML_LARGE_FIAT_INR_THRESHOLD` → alert `large_fiat_txn`.
- **Large crypto withdrawal:** Withdrawal amount ≥ `AML_LARGE_CRYPTO_WITHDRAWAL_THRESHOLD` → alert `large_crypto_withdrawal`.
- **Velocity:** User has ≥ `AML_VELOCITY_WITHDRAWAL_COUNT` withdrawals in last `AML_VELOCITY_WINDOW_HOURS` hours → alert `velocity`.
- **High-risk country:** Transaction with `country_code` in `AML_HIGH_RISK_COUNTRIES` → alert `high_risk_country`.

All alerts are created in `aml_alerts` and are **best-effort** (they do not block the transaction).

---

## Viewing current config (admin)

- **API:** `GET /api/v1/admin/aml/config` returns current thresholds (read-only). Use Admin JWT.
- **Dashboard:** The AML dashboard (`GET /api/v1/admin/aml/dashboard`) includes `largeInrThreshold` in the response.

To **change** thresholds, update the env vars and restart the backend. A future admin UI could support editing and persisting these in the database.
