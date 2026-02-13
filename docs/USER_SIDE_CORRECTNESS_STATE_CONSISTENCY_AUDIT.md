# User-Side Correctness and State-Consistency Verification

**Scope:** Production-grade centralized crypto exchange — ledger-authoritative accounting, Decimal.js only, no UI-side balance calculations, spot + P2P escrow.

**Focus:** Correctness risks, state inconsistencies, race conditions, replay hazards. No refactors, style, features, or performance suggestions.

---

## 1. USER SIGNUP FLOW

### 1.1 Account creation (auth.service.ts — email/password signup)

- **Duplicate creation:** DB enforces `UNIQUE` on `users.email` and `auth_providers(provider, provider_user_id)`. The “check then insert” (SELECT then INSERT in transaction) is a TOCTOU; the second of two concurrent signups with the same email will hit a unique violation and fail. Outcome: one success, one error — no duplicate accounts. **Verdict: Safe.**

- **Session initialization:** After the transaction, `createSession(result.id, '127.0.0.1')` is called with a **hardcoded IP** (`'127.0.0.1'`). Session is created and tokens issued, but IP in sessions table is wrong. **Risk: Incorrect audit trail / geo; no direct balance or auth correctness impact.**

- **Post-signup wallet creation:** Wallets are created **twice** for the same user:
  1. Inside the signup transaction: `await walletService.createWalletsForUser(user.id, client)` (correct).
  2. After commit: `walletService.createWalletsForUser(result.id).catch(...)` (async, no client).
  `createWalletsForUser` uses `ON CONFLICT (user_id, chain_id) DO NOTHING`, so the second call does not create duplicate wallets. **Risk: Redundant work and possible confusion; no double-wallet or ledger inconsistency.**

### 1.2 OTP signup/verify path (auth.fastify.ts — POST /verify-otp)

- **New user creation (login purpose, existingUser.rows.length === 0):** User is created with a single `db.query` INSERT; then `referral_codes` and `p2p_merchant_stats` are inserted in separate queries. **Not in a single transaction.** If `referral_codes` or `p2p_merchant_stats` fails after the user INSERT, the user exists without referral row or P2P stats. **Risk: State inconsistency (user without all auxiliary rows).**

- **Critical: No wallet creation for OTP-created users.** New users created via verify-otp (login path when identifier not found) do **not** get `createWalletsForUser`. So they have no wallets and no `user_balances` rows until something else triggers wallet creation (e.g. first GET deposit address or GET /addresses). **Risk: User exists but cannot receive deposits or see correct deposit addresses; ledger/wallet binding missing until first wallet creation.**

- **Duplicate user:** Two concurrent verify-otp requests for the same new identifier could both see `existingUser.rows.length === 0` and attempt INSERT; the second fails on email/phone UNIQUE. **Verdict: Safe from duplicate accounts.**

### 1.3 Post-signup auth state

- Tokens and session are created and returned; frontend stores them. No inconsistency identified in the returned auth state itself.

---

## 2. USER LOGIN FLOW

### 2.1 Token/session creation and storage

- **verify-otp:** Creates session via `createSession(...)`, then `generateTokens(app, { userId, ... })`. Tokens are returned in the response; frontend persists in localStorage (auth-storage). **No SSR/client mismatch identified** in token storage (client-only persist).

- **Refresh (POST /auth/refresh):** Validates refresh JWT, checks Redis `session:${sessionId}`, then **rotates** session: new session created, old one revoked via `revokeSession(decoded.sessionId)`, new tokens issued. **Replay of old refresh token** is rejected after rotation. **Verdict: Refresh replay protected.**

### 2.2 Auth resolution and redirects (frontend)

- **AuthContext** calls `/api/v1/auth/me` once on load; sets `authResolved` and either `setAuthenticated` or `setUnauthenticated`. **RequireAuth** (dashboard layout) waits for `authResolved` then, if `!isAuthenticated`, runs `router.replace('/login')` once (guarded by `redirectDone` ref). **Verdict: No redirect loop; single redirect when unauthenticated.**

- **SessionManager** only reacts to `storage` (cross-tab). Logout in another tab clears auth-storage; this tab sees missing token and redirects to `redirectPath`. No automatic idle logout; no loop.

### 2.3 Possible SSR/client auth mismatch

- Auth is resolved client-side via `/auth/me` and persisted tokens. If the app has SSR routes that depend on auth, they would not have access to the same token unless it is passed (e.g. cookie or header). Dashboard is wrapped in `RequireAuth` and uses client-side resolution; no SSR auth path was audited. **No SSR/client mismatch identified in the dashboard flow.**

---

## 3. WALLET CREATION & MAPPING

### 3.1 Lifecycle and existence guarantees

- **Email/password signup:** Wallets created inside signup transaction; user is guaranteed to have wallets after signup (plus redundant async call with ON CONFLICT DO NOTHING).
- **OTP-created users:** No wallet creation; **no guarantee** until user hits a flow that calls `createWalletsForUser` (e.g. GET deposit address, GET /addresses).
- **GET /wallet/deposit-address and GET /addresses:** If `getWallet` returns null, they call `createWalletsForUser(userId)` then fetch again. So **first request for address(es) creates wallets**. After that, wallet existence is guaranteed for that user.

### 3.2 Duplicate wallet risks

- **DB:** `wallets` has `UNIQUE(user_id, chain_id)` (migrate.ts). Inserts use `ON CONFLICT (user_id, chain_id) DO NOTHING`. **Verdict: No duplicate wallets; safe under concurrency.**

- **getMasterSeed:** Uses `INSERT INTO user_master_keys ... ON CONFLICT (user_id) DO NOTHING`; seed is created once per user. Safe.

### 3.3 Ledger ↔ wallet bindings

- Deposits are tied to `user_id`, `wallet_id` (address); indexer/backend credit `user_balances` by `user_id` and `currency_id`. Wallet is the deposit target; ledger is `user_balances`. No logic found that credits the wrong user. **Verdict: Bindings consistent.**

---

## 4. DEPOSIT FLOW

### 4.1 States (initiation → pending → confirmed / failed)

- Indexer/ConfirmationTracker: pending deposits are updated with confirmation count; when `confirmations >= required_confirmations`, `confirmDeposit` runs. It verifies receipt on chain (status !== 0 for fail). Then in a **single DB client transaction**: UPDATE deposit `status = 'completed', credited_at = NOW()` **WHERE credited_at IS NULL**, then credit `user_balances`, then `balance_applied_at = NOW()`. **Verdict: Single-transaction transition; no half-updated state.**

- Backend `creditDepositIfConfirmed`: Uses `status = 'pending'` and `balance_applied_at IS NULL` and sets `balance_applied_at` in the same transaction as the balance credit. Idempotent; only one caller wins the UPDATE. **Verdict: Safe.**

- Indexer sets `balance_applied_at` after crediting (in same transaction). Backend repair `applyBalanceForOneCompletedDeposit` only applies when `status = 'completed' AND balance_applied_at IS NULL`. So after indexer runs, repair does not double-credit. **Verdict: No double-credit between indexer and backend.**

### 4.2 Double-credit vectors

- **Indexer:** Single client, BEGIN → UPDATE deposit (WHERE credited_at IS NULL) → credit user_balances → SET balance_applied_at → COMMIT. Only one process can win the UPDATE. **Verdict: Safe.**

- **Backend creditDepositIfConfirmed:** Atomic UPDATE with `balance_applied_at IS NULL` then credit; single transaction. **Verdict: Safe.**

- **Deposits table:** Unique constraint `deposits_unique_chain_tx_to` on `(chain_id, tx_hash, to_address)` (or blockchain_id variant) prevents duplicate deposit rows for the same on-chain tx. **Verdict: DB-level idempotency.**

### 4.3 UI vs backend state consistency

- Deposit list and status come from backend APIs; UI does not derive deposit state locally. Staleness is possible (e.g. tab not refreshed); backend remains source of truth. **No UI-side deposit state derivation risk.**

---

## 5. INTERNAL TRANSFER FLOW

### 5.1 Lock/debit/credit correctness (user-to-user via POST /withdrawals type=internal)

- **Balance check:** Sum of `available_balance` across `user_balances` rows for (user, currency, CHAIN_ID_GLOBAL, account_type in funding/spot). Correct for “total available.”
- **Debit (sender):** In the same transaction, sender is updated with:
  `UPDATE user_balances SET available_balance = available_balance - $1 WHERE id = (SELECT id FROM user_balances WHERE user_id = $2 AND currency_id = $3 AND ... AND available_balance >= $1 ORDER BY available_balance DESC LIMIT 1)`.
  So **exactly one row** is debited, and that row must have `available_balance >= amount`.
- **Credit (recipient):** Single UPDATE that adds amount to recipient’s funding row. Correct.

### 5.2 Race conditions and double-spend

- Two concurrent internal transfers for the same user/currency: balance check is **outside** the transaction. Both can pass the check; in the transaction the first UPDATE locks the row and decrements it; the second either blocks and then fails the `available_balance >= $1` condition or gets no row and `assertUserBalanceUpdated` throws. **Verdict: No double-spend; one succeeds, one fails.**

### 5.3 Correctness bug: balance split across rows

- **Available balance** is computed as the **sum** of funding + spot rows. The **debit** UPDATE affects only **one** row (the one with max `available_balance` that is >= amount). So if the user has e.g. funding = 80 and spot = 80 (total 160) and requests 120, no single row has >= 120; the subquery returns no row, 0 rows updated, `assertUserBalanceUpdated` throws and the request fails. **Risk: Valid internal transfers are rejected when balance is split across funding and spot.** Ledger remains consistent, but UX and correctness of “can send” are wrong.

### 5.4 Ledger-authoritative updates

- All balance changes are in one transaction (withdrawal row, sender debit, recipient credit, internal_transfers insert). **Verdict: Ledger-authoritative.**

---

## 6. RPC / CHAIN INTERACTION

### 6.1 Failure handling (indexer ConfirmationTracker)

- **Receipt not found:** Deposit is left pending; not marked failed. Retry later. **Fail-closed for “mark failed”; safe.**
- **Receipt status === 0:** Deposit marked `status = 'failed'`. Correct.
- **RPC error during receipt fetch:** Logged, return without updating deposit; retry on next run. **Verdict: No unsafe state change on RPC failure.**

### 6.2 Retry and partial state

- ConfirmationTracker uses a single DB client and BEGIN/COMMIT; on error it ROLLBACK and releases. No partial commit. **Verdict: No partial-state commit on failure.**

### 6.3 Wallet service (multi-chain derivation)

- On derivation failure (e.g. TronWeb), the code logs and `continue`s to the next chain; no wallet row inserted for that chain. User can retry later via GET deposit-address. **Verdict: Fail-closed; no corrupt wallet state.**

---

## 7. BALANCE VISIBILITY & UI STATE

### 7.1 UI-side balance derivations

- **Funding page (fallback when /balances/funding fails):** When using `/balances/by-account`, the frontend sets `available_balance = parseFloat(row.funding || '0') + parseFloat(row.trading || '0')`. So “available” is **derived on the client** as funding + trading. Backend by-account returns funding, trading, total per token; it does not expose a separate “available” vs “locked” in that response. So this derivation is **client-side**. If backend’s definition of “available” for display ever differed (e.g. total − locked), UI could show a different number. **Risk: UI could diverge from backend’s intended “available” if backend semantics change or if by-account does not match funding API semantics.**

- **Withdraw crypto page:** `getAvailableBalance()` sums `tokenBalance.funding` and `tokenBalance.trading` from the **by-account API** based on selected accounts. Used for “Max” and for disabling submit when `totalRequired > available + epsilon`. So the **same** backend-provided fields are summed on the client for validation. Backend still enforces balance on submit. **Risk: Stale client data can show “Can withdraw” then backend rejects; no double-spend. Client-side sum is consistent with backend by-account semantics for that response.**

- **auth store `updateBalance(tokenId, available, locked)`:** Used to update local cache after an action; not used to derive balance from scratch. Display should still rely on API data; if UI ever showed only this cache without refetch, it could be stale. **No evidence of UI treating this as sole source of truth for display.**

### 7.2 Cache vs live divergence

- Backend `getBalance` (wallet.service) uses Redis cache (30s TTL) then DB. So UI can see up to 30s stale balance. **Risk: Stale balance display; backend still enforces on write. Acceptable if documented.**

### 7.3 Stale state propagation

- No global invalidation of balance cache on every write in the audited paths; some writes call `redis.del(`balance:${userId}:${tokenId}`)`. If some code paths forget to invalidate, UI could see stale data until TTL. **Known cache-invalidation concern; not a correctness bug in ledger itself.**

---

## 8. PAGE / ROUTE PROTECTION LOGIC

### 8.1 Middleware / guards / redirects

- **Dashboard:** Wrapped in `RequireAuth` and `SessionManager`. `RequireAuth` uses `useAuth()` (`authResolved`, `isAuthenticated`). Until `authResolved`, it shows loading; when resolved and not authenticated, it calls `router.replace('/login')` once. **Verdict: No redirect loop.**

- **AuthProvider:** Calls `/auth/me` once; until then it shows loading and does not render children. So dashboard layout (and RequireAuth) only mount after auth is resolved. **Verdict: Auth timing is well-ordered.**

### 8.2 Invalid session assumptions

- If the access token is expired or invalid, `/auth/me` returns 401; frontend sets unauthenticated and redirects to login. No assumption that “we have a token” means “we are valid”; server is trusted. **Verdict: No invalid session assumption.**

### 8.3 Redirect loop vectors

- None identified: redirect is conditional on `authResolved && !isAuthenticated` and guarded by a ref so it runs only once.

---

## Summary of findings

| Area | Severity | Issue |
|------|----------|--------|
| **Signup** | Low | Session created with hardcoded IP `127.0.0.1`; audit trail inaccurate. |
| **Signup** | Low | Redundant second call to `createWalletsForUser` after signup (safe due to ON CONFLICT). |
| **OTP signup** | Medium | New user creation in verify-otp not in a single transaction with referral_codes / p2p_merchant_stats; partial state possible. |
| **OTP signup** | **High** | **No wallet creation for OTP-created users; they have no wallets until another flow creates them.** |
| **Internal transfer** | **High** | **Valid transfers rejected when total available is sufficient but no single row has >= amount (balance split across funding/spot).** |
| **Balance UI** | Low | Funding fallback derives “available” as funding+trading on client; could diverge if backend semantics change. |
| **Balance UI** | Low | Withdraw page uses client-summed balance for button state; backend still enforces; stale data can cause “reject on submit.” |

All other audited areas (login tokens/sessions, refresh rotation, wallet uniqueness, deposit idempotency and double-credit protections, internal transfer races and double-spend, RPC fail-closed behavior, route protection and redirect logic) show no correctness or state-consistency defects within the scope of this audit.
