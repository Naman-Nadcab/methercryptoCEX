# Hot Wallet System – Security Documentation

## 0. Why "Hot wallets table missing" Appeared (and How It’s Fixed)

**What happened:** The admin saw *"Hot wallets table missing. Run: npm run migrate (in apps/backend)."* when clicking "Create hot wallet". That message is returned when the backend tries to use the `hot_wallets` table and PostgreSQL raises error code **42P01** (undefined_table). So at runtime the table did not exist.

**Likely causes:**
1. **Migrations were never run** – `npm run migrate` had not been executed from `apps/backend`, so `chains`, `hot_wallets`, and `hot_wallet_audit_log` were never created.
2. **Migrations failed partway** – An earlier step in the migration script failed (e.g. a missing column on `users` or `kyc_documents`), so the script exited before reaching the `hot_wallets` CREATE TABLE step.
3. **Wrong database** – The app was pointed at a different DB (e.g. empty or old copy) that didn’t have these tables.

**Fixes applied:**
- **Startup check:** The backend now checks that `chains` and `hot_wallets` exist before starting. If either is missing, it **refuses to start** and prints: *"Database not migrated. Run: npm run migrate (apps/backend)."* So you never get a running server with an unmigrated DB.
- **Migrations:** The migration file is idempotent (CREATE TABLE IF NOT EXISTS, INSERT … ON CONFLICT DO NOTHING). Chains are seeded with at least `eth`, `ethereum`, `bsc`, `polygon`. Running `cd apps/backend && npm run migrate` creates or updates the schema.
- **Error mapping:** All backend errors (missing ENCRYPTION_KEY, 42P01, chain FK, etc.) are mapped to exact, actionable messages; the admin UI shows them in a red alert. No generic "Failed to create hot wallet" when a specific cause is known.

**Admin action:** Run `cd apps/backend && npm run migrate`, then restart the backend. After that, creating a hot wallet should succeed (assuming ENCRYPTION_KEY is set and you’re Super Admin).

---

## 1. Threat Model (Attacks Blocked)

| Threat | Mitigation | Status |
|--------|------------|--------|
| **Plaintext private key exposure** | Keys encrypted at rest (AES-256-GCM via ENCRYPTION_KEY). Decrypted only in memory; never returned to API/frontend. Zeroize after use. | Blocked |
| **Single point of failure** | One hot wallet per chain; key material never logged. Future MPC/HSM can replace envelope encryption without DB schema change. | Designed for |
| **Unlimited withdrawals** | Withdrawal pipeline: balance check, risk hook, daily limit, admin policy. Signing queue: async, rate-limited, idempotent. | Enforced in pipeline |
| **Blind signing** | Withdrawal payload (to, value, chain) validated before enqueue. Signing service signs only after checks. | Blocked |
| **Admin action without audit** | Every hot wallet action logged in `hot_wallet_audit_log` with actor_id, timestamp, action, payload_hash. No secrets in logs. | Enforced |
| **Silent failures** | Explicit error codes (CHAIN_NOT_FOUND, ENCRYPTION_FAILED, 42P01, etc.). Exact messages returned to admin UI. Server refuses to start if ENCRYPTION_KEY or DATABASE_URL invalid. | Fail closed |
| **Non–Super Admin creating wallets** | Hot wallet create/patch require role `super_admin` (or `Super Admin`). Enforced in `getAdminFromRequest(..., true)`. | Enforced |
| **Admin IP abuse** | ADMIN_IP_WHITELIST checked for hot wallet actions. Request IP must be in allowlist (or allowlist empty/* for dev). | Enforced |
| **DB / table missing** | Migrations idempotent. Clear error on 42P01: "Hot wallets table missing. Run: npm run migrate." | Actionable errors |
| **Wrong ENCRYPTION_KEY** | Decryption fails with explicit message. No fallback to plaintext. | Fail closed |
| **Duplicate hot wallet per chain** | UNIQUE(chain_id) and HOT_WALLET_ALREADY_EXISTS check before insert. | Blocked |
| **Key exfiltrated via log** | Audit log stores payload_hash only; never private key or plaintext secrets. | Blocked |

---

## 2. Admin Setup Checklist

- [ ] **Environment**
  - Set `ENCRYPTION_KEY` in `.env` (min 32 characters). Server will not start if missing or too short.
  - Set `DATABASE_URL`. Server will not start if invalid.
  - (Production) Set `ADMIN_IP_WHITELIST` to comma-separated IPs (e.g. `1.2.3.4,5.6.7.8`). Use `*` only for dev.

- [ ] **Database**
  - Run migrations: `cd apps/backend && npm run migrate`.
  - Confirm tables exist: `hot_wallets`, `hot_wallet_audit_log`, `withdrawal_signing_queue`, `chains`.
  - **Backend will not start** if `chains` or `hot_wallets` are missing; you will see: "Database not migrated. Run: npm run migrate (apps/backend)."

- [ ] **Admin role**
  - Ensure at least one admin has role `super_admin` (or `Super Admin`) in `admin_users`. Only that role can create or disable hot wallets.

- [ ] **Create hot wallet**
  - Log in as Super Admin.
  - Open Admin → Wallets → Hot Wallets.
  - Select chain (EVM only), click "Create hot wallet", confirm in the confirmation step.
  - Copy the displayed address; deposit funds here. Private key is never shown.

- [ ] **Operational**
  - Configure `min_hot_balance` and `cold_wallet_address` per chain when auto-sweep is implemented.
  - Monitor `hot_wallet_audit_log` for all hot wallet actions.
  - Treat any "Decryption failed" or "Encryption failed" as critical; do not ignore.

---

## 3. Fail-Closed Confirmation

The system is designed to **fail closed**:

1. **Startup**
   - If `ENCRYPTION_KEY` is missing or &lt; 32 chars, config validation fails and the process exits (no server start).
   - If `DATABASE_URL` is invalid, config validation fails and the process exits.
   - `validateHotWalletEnv()` runs after DB connect and exits the process if critical env is invalid.
   - `validateRequiredTables()` checks that `chains` and `hot_wallets` exist; if either is missing, the process exits with "Database not migrated. Run: npm run migrate (apps/backend)."

2. **Runtime**
   - If encryption/decryption fails, the operation throws; no plaintext key is returned or logged.
   - If a hot wallet table is missing (42P01), the API returns an explicit error; no silent fallback.
   - If the admin is not Super Admin for create/patch, the API returns 403; the action is not performed.
   - If the request IP is not on the allowlist (when configured), the API returns 403; the action is not performed.

3. **Audit**
   - Every hot wallet create, activate/deactivate, balance refresh, and key decryption event is logged with actor_id and payload_hash. There is no "silent" path for sensitive actions.

**Conclusion:** The hot wallet system does not proceed with sensitive operations when safety checks fail; it refuses to start or returns explicit errors and does not expose keys or perform privileged actions for unauthorized callers.
