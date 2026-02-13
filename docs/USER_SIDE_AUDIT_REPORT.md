# Complete User-Side Audit Report — Centralized Crypto Exchange

**Scope:** Backend (Fastify + PostgreSQL), database schema, user APIs, user dashboard/panel, wallet & security.  
**Date:** 2025-02-10.  
**Rule:** Verify via actual code; do not assume features exist.

---

## SECTION 1: USER IDENTITY & ACCOUNT MODEL

| Check | Result | Evidence |
|-------|--------|----------|
| users table primary key type | **UUID** | `migrate.ts` 23–24: `CREATE TABLE IF NOT EXISTS users ( id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), ... )`. |
| One immutable internal user ID per user | **SAFE** | `users.id` is UUID, not reused. All child tables reference `users(id)`. |
| userId used consistently: balances | **SAFE** | `user_balances.user_id` REFERENCES users(id) — migrate 1613–1636; wallet routes use `request.user!.id`. |
| userId: wallets, deposits, withdrawals, transfers | **SAFE** | `user_wallets`, `deposits`, `withdrawals` have `user_id` FK; internal transfer uses authenticated userId. |
| userId: sessions, KYC, audit logs | **SAFE** | `user_sessions.user_id`, `user_activity_logs.user_id`; KYC uses `kyc_applications`/`kyc_records` with `user_id`. wallet.fastify, user.fastify, kyc.ts use `request.user!.id`. |
| Email/phone NOT primary identifiers | **SAFE** | All APIs resolve user from JWT/session; no API uses email/phone as primary key for balance or wallet ops. |
| No API trusts client-supplied userId | **SAFE** | Authenticated routes use `request.user!.id` from JWT (server.ts 164–204); no route uses `request.body.userId` or `request.query.userId` for scoping. |

**Verdict: SAFE**

---

## SECTION 2: AUTHENTICATION & SESSIONS

| Item | Status | Evidence |
|------|--------|----------|
| OTP login | **WORKING** | auth.fastify: POST /send-otp, POST /verify-otp, POST /login; rate-limited; session + tokens returned. |
| Passkey login | **WORKING** | auth.fastify: POST /login/check-passkeys, /passkey/authenticate/options, /passkey/authenticate/verify; tokens returned. |
| Session persistence | **WORKING** | createSession writes to user_sessions + Redis; JWT validated against session. |
| Token refresh | **WORKING** | auth.fastify POST /refresh (527–607); rotates refresh, returns new accessToken. |
| /me endpoint | **WORKING** | auth.fastify GET /me (680–736); uses request.user.id; returns user + referralCode. |
| Logout (single device) | **WORKING** | auth.fastify POST /logout (616–643); revokeSession(sessionId). |
| Logout all devices | **WORKING** | auth.fastify POST /logout-all-other (649–673); revokeAllExceptCurrent(userId, sessionId). |
| Session & device listing | **PARTIAL** | user.fastify GET /user/sessions (155–182) selects `device_name, browser, os, location_country, location_city, last_activity_at`. **These columns do not exist in migrate.ts user_sessions** (only id, user_id, session_token, device_type, ip_address, user_agent, is_active, created_at, expires_at, revoked_at, device_id). Query will fail at runtime on DB created with migrate only. |

**Verdict:** Auth flows **WORKING**; session/device listing **PARTIAL** (backend expects columns that migrate does not create).

---

## SECTION 3: USER PROFILE & SETTINGS

| Item | Status | Evidence |
|------|--------|----------|
| View profile details | **WORKING** | GET /api/v1/user/profile (user.fastify 11–56), GET /api/v1/auth/profile (auth.fastify 2971–3085). Frontend account page uses /api/v1/auth/profile. |
| Update name | **WORKING** | user.fastify PATCH /profile (62–148): firstName, lastName, username, timezone, language, defaultFiatCurrency. |
| Update email / phone | **PARTIAL** | Backend: auth.fastify has /add-identifier, /change-email, /change-phone flows (OTP/verify). Need frontend wiring check. |
| Security settings UI | **WORKING** | dashboard/security/page.tsx; change password, 2FA, passkeys, withdrawal limits, etc. |
| Anti-phishing code | **WORKING** | auth.fastify reads/sets anti_phishing_code; profile returns it. |
| Notification preferences | **PARTIAL** | Backend: user_notifications table exists; no dedicated “notification preferences” API found for user (e.g. email/SMS on/off). |

**Verdict:** Profile view/update and security UI **WORKING**; email/phone change and notification prefs **PARTIAL** (backend exists for email/phone; notification prefs API may be missing).

---

## SECTION 4: KYC (USER VIEW)

| Item | Status | Evidence |
|------|--------|----------|
| KYC submission flow | **WORKING** | kyc.ts GET /status, POST /initiate (uses request.user.id); supports DigiLocker auto-approve and pending. |
| Document upload | **PARTIAL** | kyc.ts initiates KYC; upload may be in upload.fastify or separate KYC upload endpoint — not fully traced. |
| KYC status visibility | **WORKING** | GET /kyc/status returns status, kycLevel, verified, submittedAt, reviewedAt, rejectionReason. wallet.fastify GET /kyc-status same. |
| KYC rejection reason | **WORKING** | kyc.ts and wallet /kyc-status return rejection_reason. |
| KYC enforcement on withdrawals | **WORKING** | wallet.fastify 1630–1638: checks system_settings kyc_required_for_withdrawal; risk-engine and deposit-address also check KYC. |

**Schema risk:** migrate.ts creates **kyc_records** only; kyc.ts and wallet/risk/kyc-enforcement use **kyc_applications**. full-schema.sql has kyc_applications. If DB is built from migrate only, KYC routes will fail (table kyc_applications does not exist).

**Verdict:** **PARTIAL** — Logic and APIs present; **schema split (kyc_records vs kyc_applications)** can break KYC on migrate-only DBs.

---

## SECTION 5: WALLET SYSTEM (CRITICAL)

| Item | Status | Evidence |
|------|--------|----------|
| Wallet auto-generation on signup | **PARTIAL** | wallet.service getOrCreateWallet creates user_wallets via master seed; deposit-address flow (wallet.fastify 286–402) gets/creates wallet per chain. No single “on signup” hook found that creates wallets for all chains; creation is on first deposit-address request. |
| Multi-chain support | **WORKING** | user_wallets per (user_id, blockchain_id); GET /wallet/deposit-address/:chainId; GET /wallet/wallets. |
| Funding vs trading balances | **WORKING** | user_balances has account_type (funding, trading, spot); UNIQUE(user_id, currency_id, chain_id, account_type). wallet.fastify balances/by-account and withdrawal use accountType. |
| Internal wallet identifiers | **WORKING** | user_wallets.id, address; deposits/withdrawals reference wallet_id or chain/address. |
| Wallet address regeneration rules | **WORKING** | migrate 380–385: trigger prevents UPDATE on wallets.address (immutable). No regeneration; one address per user per chain. |

**Verdict:** **WORKING** (multi-chain, funding/trading, immutable address). Auto-creation is **on first use** (deposit-address), not at signup.

---

## SECTION 6: DEPOSITS

| Item | Status | Evidence |
|------|--------|----------|
| Deposit address generation | **WORKING** | GET /wallet/deposit-address/:chainId (wallet.fastify 287–402); KYC check, chain lookup, getOrCreateWallet. |
| Per-chain correctness | **WORKING** | Chain resolved by chainId; EVM shared address logic; returns chain name, confirmations, explorer. |
| Deposit history | **WORKING** | GET /wallet/deposits (466), GET /wallet/deposit-history (2717); tx_hash, confirmations, status. |
| Reindex/repair safety | **WORKING** | FIX #2: UNIQUE(blockchain_id, tx_hash, to_address); ON CONFLICT DO NOTHING; ConfirmationTracker credits only when credited_at IS NULL. |
| Duplicate deposit prevention | **WORKING** | deposits_unique_chain_tx_to; indexer ON CONFLICT DO NOTHING; single credit per row. |

**Verdict:** **WORKING**

---

## SECTION 7: WITHDRAWALS

| Item | Status | Evidence |
|------|--------|----------|
| Withdrawal creation | **WORKING** | POST /wallet/withdrawals (1106+); idempotency, internal/on-chain, balance lock. |
| Address validation | **WORKING** | toAddress validated; internal_user_identifier for internal; isAddressAllowed (whitelist). |
| Withdrawal limits | **WORKING** | GET /wallet/withdrawal-limits (917); daily/monthly from users; check before create (1545–1565). |
| Fee visibility | **WORKING** | Fee in withdrawal response and token-level max_withdrawal. |
| Withdrawal history | **WORKING** | GET /wallet/withdrawals (715+) with status mapping. |
| Withdrawal cancel (pending) | **WORKING** | POST /wallet/withdrawals/:id/cancel (1941); only status = 'pending'. |
| Cooldown enforcement | **WORKING** | hasActiveCooldown used in wallet.fastify; security-cooldown.service. |
| 2FA enforcement | **PARTIAL** | twoFactorCode in body; backend may validate TOTP — not fully traced; fund_password and 2FA exist in schema. |
| Idempotency enforcement | **WORKING** | Idempotency-Key required; Redis cache + NX lock; same key+body → cached response. |

**Verdict:** **WORKING** (creation, limits, history, cancel, cooldown, idempotency). 2FA/fund password enforcement is **PARTIAL** (present in schema/body; full validation path not verified).

---

## SECTION 8: INTERNAL TRANSFERS

| Item | Status | Evidence |
|------|--------|----------|
| Funding → trading transfer | **WORKING** | POST /wallet/withdrawals with type internal and internal_user_identifier; same-currency internal transfer. |
| Trading → funding transfer | **WORKING** | accountType in withdrawal; debit from funding or spot/trading per allowedWithdrawalAccounts. |
| Balance locking correctness | **WORKING** | Transactions with ensureUserBalanceRow; assertUserBalanceUpdated; balance invariants. |
| Transfer history | **PARTIAL** | Internal transfer inserts withdrawal rows (type internal); no dedicated GET /internal-transfers found; history may be under withdrawals with type filter. |
| No balance desync possible | **WORKING** | DB transactions; atomic debit/credit; assertions. |

**Verdict:** **WORKING** (transfers and locking). Dedicated internal-transfer history API is **PARTIAL**.

---

## SECTION 9: CONVERT / SWAP

| Item | Status | Evidence |
|------|--------|----------|
| Convert UI/API presence | **WORKING** | convert.fastify.ts: /market-prices, create conversion, confirm; dashboard/assets/convert. |
| Rate source | **WORKING** | market_prices; conversion uses rate from API. |
| Slippage handling | **PARTIAL** | convert.fastify has target_rate; slippage UX not fully traced. |
| Balance settlement correctness | **WORKING** | ensureUserBalanceRow; debit/credit in same transaction. |

**Verdict:** **WORKING** (convert exists; rate and settlement). Slippage is **PARTIAL**.

---

## SECTION 10: FUND DETAILS & HISTORY

| Item | Status | Evidence |
|------|--------|----------|
| Balance history | **WORKING** | GET /wallet/balances/by-account; deposit-history, withdrawals. |
| Ledger visibility | **PARTIAL** | full-schema has balance_ledger; migrate may not; no GET /wallet/ledger found in wallet.fastify. |
| Deposit + withdrawal combined history | **PARTIAL** | Separate GET /deposit-history and GET /withdrawals; no single combined “fund history” endpoint. |
| Clear timestamps and references | **WORKING** | created_at, updated_at, tx_hash, confirmations in responses. |

**Verdict:** **PARTIAL** (no unified ledger API; combined history is two endpoints).

---

## SECTION 11: USER LIMITS & RISK VISIBILITY

| Item | Status | Evidence |
|------|--------|----------|
| User can see withdrawal limits | **WORKING** | GET /wallet/withdrawal-limits (917); daily/monthly used and remaining. |
| User can see risk blocks | **PARTIAL** | Risk engine returns BLOCK/CHALLENGE; frontend must show message; error code/message in reply. |
| User can see cooldown timers | **PARTIAL** | hasActiveCooldown blocks; no dedicated “cooldown status” endpoint found for user. |
| Error messages user-friendly | **PARTIAL** | Backend returns codes (LIMIT_EXCEEDED, KYC_REQUIRED, etc.); frontend should map to messages. |

**Verdict:** **PARTIAL** (limits visible; risk/cooldown visibility and UX depend on frontend mapping).

---

## SECTION 12: TRANSPARENCY & AUDIT (USER VIEW)

| Item | Status | Evidence |
|------|--------|----------|
| Login history | **WORKING** | user_activity_logs; GET /user/activity (188–215) returns activity_type, ip_address, created_at. |
| Security activity logs | **WORKING** | Same /user/activity; logUserActivity used on login, logout, 2FA, etc. |
| Device activity | **PARTIAL** | GET /user/sessions exists but selects non-existent columns (device_name, browser, os, last_activity_at, etc.) in migrate schema — will 500. |
| Wallet activity logs | **PARTIAL** | Deposit/withdrawal history; no single “wallet activity log” endpoint. |

**Verdict:** **PARTIAL** (activity log working; sessions/devices broken on migrate DB; wallet activity is deposits/withdrawals).

---

## SECTION 13: ERROR HANDLING & UX

| Item | Status | Evidence |
|------|--------|----------|
| Errors mapped to user-readable messages | **PARTIAL** | Backend returns error.code + message; frontend api.ts passes through; no central error-code → message map found. |
| No raw error codes exposed | **PARTIAL** | Codes like RATE_LIMIT_EXCEEDED, KYC_REQUIRED are exposed; acceptable if frontend maps them. |
| Frontend handles blocked states | **PARTIAL** | Login/deposit pages handle errors; full coverage of blocked states not verified. |

**Verdict:** **PARTIAL** (backend returns structured errors; frontend mapping and blocked-state handling not fully audited).

---

## SECTION 14: FINAL GAP ANALYSIS

### 1) FULL LIST OF WORKING FEATURES

- User identity: UUID, consistent userId, no client-supplied userId.
- OTP login, passkey login, session persistence, token refresh.
- GET /auth/me, POST /auth/logout, POST /auth/logout-all-other.
- GET/PATCH /user/profile, GET /auth/profile (with KYC/passkeys/devices count).
- Security settings UI (password, 2FA, passkeys, limits).
- Anti-phishing code.
- KYC status, rejection reason, submission flow (subject to kyc_applications vs kyc_records).
- KYC enforcement on withdrawals and deposit address.
- Multi-chain wallets, funding vs trading balances, immutable deposit addresses.
- Deposit address generation, deposit history, reindex/repair and duplicate-deposit safety.
- Withdrawal create, limits, fee visibility, history, cancel pending, cooldown, idempotency.
- Internal transfers (funding/trading), balance locking.
- Convert/swap API and UI, rate from market_prices, balance settlement.
- Withdrawal limits visibility.
- GET /user/activity (login/security activity).

### 2) FULL LIST OF PARTIAL FEATURES

- **Session/device listing:** GET /user/sessions selects columns (device_name, browser, os, location_country, location_city, last_activity_at) that **do not exist** in migrate.ts user_sessions → 500 on migrate-only DB. **Fix:** Add these columns in migrate or change SELECT to existing columns only.
- **KYC table mismatch:** Code uses **kyc_applications**; migrate creates **kyc_records** only → KYC routes fail on migrate-only DB. **Fix:** Add kyc_applications (or equivalent) to migrate, or make KYC code use kyc_records consistently.
- **Auth profile referral_codes:** GET /auth/profile queries **referral_codes**; table exists in full-schema.sql but **not in migrate.ts** → 500 on migrate-only DB. **Fix:** Create referral_codes in migrate or guard SELECT.
- **Email/phone update:** Backend flows exist; frontend wiring not fully verified.
- **Notification preferences:** No dedicated user API for email/SMS on/off.
- **Wallet auto-creation:** On first deposit-address request, not at signup (acceptable but not “on signup”).
- **2FA/fund password enforcement:** In schema and request body; full validation path not verified.
- **Internal transfer history:** Via withdrawals with type=internal; no dedicated endpoint.
- **Ledger API:** balance_ledger in full-schema; no GET /wallet/ledger in wallet.fastify.
- **Combined fund history:** Separate deposit and withdrawal endpoints only.
- **Risk/cooldown visibility:** Backend returns blocks; no dedicated cooldown-status endpoint.
- **Error mapping and blocked states:** Backend OK; frontend mapping and handling partial.

### 3) FULL LIST OF MISSING FEATURES

- **referral_codes table in migrate** (if using migrate as single source of schema).
- **kyc_applications table in migrate** (if using migrate only).
- **user_sessions columns** in migrate: device_name, browser, os, location_country, location_city, last_activity_at (or backend SELECT must be reduced to existing columns).
- **GET /wallet/ledger** (if product requires a single ledger view).
- **GET /user/cooldown-status** (if product requires cooldown timer in UI).
- **User notification preferences API** (if product requires toggles for email/SMS).

### 4) CRITICAL BLOCKERS FOR CLOSED BETA

1. **Schema consistency:** On a DB created only with migrate.ts:
   - GET /user/sessions fails (missing columns).
   - GET /auth/profile fails (referral_codes missing).
   - KYC flows fail (kyc_applications missing).
   **Action:** Either add to migrate: user_sessions columns (or narrow sessions query), referral_codes table, kyc_applications table (or unify on kyc_records and update code).

2. **auth/profile JWT shape:** GET /auth/profile uses `request.jwtVerify()` and `request.user as { userId: string }`. If the JWT payload uses `id` instead of `userId`, profile will break. **Action:** Confirm JWT payload and use the same key (e.g. request.user.id) after jwtVerify.

### 5) NON-CRITICAL (CAN BE POSTPONED)

- Ledger API; combined fund-history endpoint; internal-transfer-only history.
- Cooldown-status endpoint (if cooldown is rare).
- Notification preferences API.
- Slippage UX for convert.
- Central frontend error-code → message map and full blocked-state handling.

### 6) IMPLEMENTATION GUIDANCE FOR MISSING/PARTIAL ITEMS

| Item | Where to add | Tables / logic | Frontend vs backend |
|------|--------------|----------------|---------------------|
| user_sessions columns | migrate.ts | ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS device_name VARCHAR(255); same for browser, os, location_country, location_city, last_activity_at. | Backend: fix query or add columns. |
| referral_codes table | migrate.ts | CREATE TABLE referral_codes (id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id), code VARCHAR UNIQUE NOT NULL, is_active BOOLEAN, ...). | Backend. |
| kyc_applications | migrate.ts | Create kyc_applications with same shape as full-schema (or migrate kyc_records → kyc_applications). Alternatively change all code to kyc_records. | Backend. |
| GET /wallet/ledger | wallet.fastify.ts | New route GET /ledger; query balance_ledger (if table exists) filtered by request.user.id. | Backend + frontend history/ledger page. |
| GET /user/cooldown-status | user.fastify or wallet.fastify | New route; query security_cooldowns for user_id, return active cooldowns and cooldown_until. | Backend + frontend security/withdraw. |
| Notification preferences | user.fastify.ts | New GET/PATCH /user/notification-preferences; table or columns on users (e.g. email_notifications, sms_notifications). | Backend + frontend preferences. |
| Sessions query fix | user.fastify.ts | Replace SELECT with only columns that exist in migrate: id, device_type, ip_address, user_agent, created_at, expires_at, device_id, and CASE for is_current. | Backend. |

---

**Summary:** Core user identity, auth, wallet, deposits, withdrawals, and internal transfer are in place and consistent with a single internal user ID. The main risks are **schema gaps when using migrate-only** (user_sessions columns, referral_codes, kyc_applications) and the **GET /user/sessions** query assuming columns that do not exist there. Resolving these and confirming JWT shape for /auth/profile will remove the critical blockers for closed beta from a user-side perspective.
