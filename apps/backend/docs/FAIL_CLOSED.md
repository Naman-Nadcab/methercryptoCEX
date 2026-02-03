# Hot Wallet System: Fail-Closed Confirmation

## Summary

**The hot wallet system is designed to FAIL CLOSED, NOT OPEN.**

When any critical safety check fails, the system **refuses to proceed** rather than proceeding with reduced security. No silent fallbacks, no default-to-allow.

---

## 1. Startup (Process Does Not Start)

| Check | Behavior |
|-------|----------|
| `ENCRYPTION_KEY` missing or &lt; 32 characters | Config validation fails → `process.exit(1)`. Server does not start. |
| `DATABASE_URL` missing or invalid | Config validation fails → `process.exit(1)`. Server does not start. |
| `validateHotWalletEnv()` after DB connect | If critical env invalid → `process.exit(1)`. Server does not start. |

**Code:** `apps/backend/src/config/index.ts` (zod schema), `apps/backend/src/lib/hot-wallet-env.ts`, `apps/backend/src/server.ts` (validateHotWalletEnv() before buildServer).

---

## 2. Runtime (Request Rejected or Operation Thrown)

| Check | Behavior |
|-------|----------|
| Encryption fails (e.g. ENCRYPTION_KEY wrong) | `HotWalletServiceError(ENCRYPTION_FAILED, ...)` thrown. No plaintext key returned or logged. |
| Decryption fails | Same. No fallback to plaintext. |
| Hot wallets table missing (PostgreSQL 42P01) | API returns 500 with message: "Hot wallets table missing. Run: npm run migrate (in apps/backend)." No silent empty list for create. |
| Chain not found (FK 23503) | API returns 500 with explicit message. Create does not proceed. |
| Admin not Super Admin for create/patch | `getAdminFromRequest(..., true)` returns 403. Action not performed. |
| Admin IP not on allowlist (when configured) | 403. Action not performed. |
| Duplicate hot wallet for chain | `HOT_WALLET_ALREADY_EXISTS` thrown. Insert not performed. |

**Code:** `apps/backend/src/services/hot-wallet.service.ts`, `apps/backend/src/routes/admin.fastify.ts` (getAdminFromRequest, error mapping).

---

## 3. Audit (No Silent Path)

Every sensitive action is logged in `hot_wallet_audit_log` with:

- `actor_id`
- `action` (e.g. hot_wallet_created, hot_wallet_key_decrypted)
- `payload_hash` (hash of payload; no plaintext secrets)
- `created_at`

There is no code path that performs create/activate/deactivate/decrypt **without** going through the audit logger. Failures (e.g. decryption failed) are logged or thrown; they are not silently ignored.

---

## 4. Conclusion

- **Startup:** Invalid or missing critical env → process exits. No server.
- **Runtime:** Invalid state or unauthorized caller → request rejected with explicit error. No key material exposed, no privileged action performed.
- **Audit:** Sensitive actions are always logged; no silent bypass.

**The system does not proceed when safety checks fail. It fails closed.**
