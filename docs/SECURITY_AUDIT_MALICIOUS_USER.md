# Security Audit — Malicious User Perspective

**Scope:** Simulate real trader flows, attempt to break the system. Real money assumed.  
**Date:** February 2026

---

## PHASE 1 — AUTH

### 1.1 Signup Flow (OTP → verify → password)

| Test | Result | Notes |
|------|--------|-------|
| OTP required before signup | ✅ | POST /signup checks `otp:verified` (Redis) or DB `verified_at` within 10 min |
| Wrong OTP on verify-otp | ✅ | Returns `INVALID_OTP`; increments attempts; max 3 attempts (Redis) |
| Expired OTP | ✅ | verifyOTP checks `cached.expiresAt`; returns `valid: false, message: 'OTP has expired'` |
| Signup without verify-otp | ❌ Blocked | Returns `OTP_NOT_VERIFIED` |

### 1.2 Login with OTP

| Test | Result | Notes |
|------|--------|-------|
| Wrong OTP | ✅ | verifyOTP returns invalid; recordFailedLogin called |
| Expired OTP | ✅ | Same expiry check |
| Rapid login attempts | ✅ | rateLimitByIp('auth:login', 5, 60) — 5/min per IP |
| Login without OTP | ❌ Blocked | POST /login requires OTP in body; verifyOTP runs first |
| Additional 2FA/SMS step when enabled | ✅ | stepsRequired built; returns verificationToken; verify-step required |

### 1.3 JWT & Session

| Test | Result | Notes |
|------|--------|-------|
| JWT issued correctly | ✅ | Payload has userId, sessionId; type not 'admin' for user |
| Refresh token rotation | ✅ | revokeSession(oldSessionId); create new session; issue new tokens |
| Logout invalidates session | ❌ **Broken** | revokeSession deletes Redis key; server falls back to JWT-only when session is null |
| Replay old JWT after logout | 🚨 **Exploitable** | See below |
| Replay refresh token | ✅ | Refresh rotates token; old refresh invalidated |

### 🚨 CRITICAL: Token Replay After Logout

**Vulnerability:** In `server.ts`, when Redis returns no session (`session` is null), the code falls back to JWT-only auth:

```ts
// Redis session validation: enforce only when session exists; fall back to JWT-only when missing (e.g. Redis restart)
const session = await redis.getJson(`session:${decoded.sessionId}`);
if (session) {
  if (!session.isActive) return 401;
  // ...
} else {
  request.log.warn('Redis session missing, falling back to JWT-only auth');
}
request.user = { ... }; // Request is accepted
```

**revokeSession** in `session.service.ts` calls `redis.del(`session:${sessionId}`)` (and DB `is_active = FALSE`). After logout, the Redis key no longer exists, so `session` is null, and the fallback accepts the JWT.

**Impact:** A stolen JWT can be replayed indefinitely after the victim logs out. Revocation is ineffective.

**Fix:**

1. **Preferred:** When `session` is null, query DB: `SELECT is_active FROM user_sessions WHERE id = $sessionId`. If row not found or `is_active = FALSE`, return 401. If `is_active = TRUE`, allow (and optionally repopulate Redis for performance).
2. **Alternative:** Change revokeSession to set Redis `session:${sessionId}` = `{ isActive: false }` with short TTL (e.g. 24h) instead of deleting. Then Redis miss = reject (no fallback). This avoids DB hit on every request but requires Redis to be reliable.

### Auth Weaknesses

- **🚨 Token replay after logout** — See above. **Critical.**
- **✅ No critical bypass:** Cannot login without valid OTP. Cannot signup without OTP verify.

---

## PHASE 2 — WALLET

### 2.1 Deposit Address

| Test | Result | Notes |
|------|--------|-------|
| Generation | ✅ | getWallet or createWalletsForUser; deterministic per user+chain |
| Multiple requests | ✅ | Same address returned (no new wallet per request) |
| KYC required | ✅ | 403 KYC_REQUIRED if not approved |
| User isolation | ✅ | userId from request.user!.id; walletService uses userId |

### 2.2 Balance Endpoints

| Test | Result | Notes |
|------|--------|-------|
| balances, balances/spot, summary | ✅ | All filter by user_id from request.user |
| balance-debug with ?email=other | ✅ | Returns 403 if userId !== currentUserId |

### 2.3 Internal Transfer (funding ↔ trading)

| Test | Result | Notes |
|------|--------|-------|
| Positive transfer | ✅ | Atomic transaction; SELECT FOR UPDATE; debit/credit |
| Negative amount | ✅ | Rejected: `INVALID_AMOUNT` |
| Same account | ✅ | Rejected: `SAME_ACCOUNT` |
| Double submit (idempotency) | ✅ | Idempotency-Key required; Redis cache + lock; same body → 200 cached response; different body → 409 |
| Insufficient balance | ✅ | Check before debit; 400 INSUFFICIENT_BALANCE |
| Locked balance respected | ✅ | Uses available_balance; transfer does not touch locked |

### Wallet Weaknesses

- **✅ No critical flaw** — Transfer is atomic, idempotent, and validates amount/balance.

---

## PHASE 3 — SPOT TRADING

### 3.1 Order Placement

| Test | Result | Notes |
|------|--------|-------|
| Limit, market, stop, trailing stop | ✅ | All validated; balance locked in transaction |
| Insufficient balance | ✅ | lockTradingBalance returns false → INSUFFICIENT_BALANCE |
| Duplicate client_order_id | ✅ | Returns existing order (idempotent); no double execution |
| Min qty, min notional | ✅ | Enforced |
| User isolation | ✅ | userId from request.user; orders filtered by user_id |

### 3.2 Cancel Order

| Test | Result | Notes |
|------|--------|-------|
| Cancel own order | ✅ | WHERE id=$1 AND user_id=$2 |
| Cancel other user's order | ❌ Blocked | 404 NOT_FOUND (order not in result set) |
| Cancel same order twice | ✅ | First: CANCELLED + unlock. Second: 400 ORDER_NOT_CANCELLABLE (status not OPEN/PARTIALLY_FILLED/PENDING_TRIGGER) |

### 3.3 Balance & Ledger

| Test | Result | Notes |
|------|--------|-------|
| Balance deduction on place | ✅ | lockTradingBalance in transaction |
| Locked balance release on cancel | ✅ | unlockTradingBalance in same transaction as status update |
| Fee deduction | ✅ | runMatching applies maker/taker fees |
| Trade history | ✅ | spot_trades populated |
| Ledger entry | ✅ | Settlement/ledger flow exists |
| Race condition (concurrent place) | ✅ | db.transaction + lockTradingBalance (SELECT FOR UPDATE) |
| Double execution | ✅ | client_order_id idempotency; order insert in transaction |

### Spot Weaknesses

- **✅ No critical exploit** — Balance lock, user isolation, idempotency, and cancel guard are correct.

---

## PHASE 4 — P2P

### 4.1 Order Lifecycle

| Test | Result | Notes |
|------|--------|-------|
| Create order | ✅ | Idempotency-Key required; balance lock in createOrder |
| Confirm payment (buyer) | ✅ | confirmPayment checks order.buyerId === userId |
| Release (seller) | ✅ | releaseCrypto checks order.sellerId === userId |
| Cancel before confirm | ✅ | Allowed when status payment_pending |
| Dispute | ✅ | openDispute; rate limited |

### 4.2 Idempotency & Escrow

| Test | Result | Notes |
|------|--------|-------|
| Confirm idempotency | ✅ | Redis idempotency cache; cooldown per orderId |
| Release idempotency | ✅ | releaseFromEscrow returns alreadyReleased; returns cached order |
| Escrow locking | ✅ | moveToEscrow on create; escrow status checked on release |
| Funds release logic | ✅ | releaseFromEscrow credits buyer; debits escrow |
| Expiry job | ✅ | processExpiredP2POrders; refundFromEscrow for expired |

### 4.3 User Isolation

| Test | Result | Notes |
|------|--------|-------|
| GET order by id | ✅ | Query filters buyer_id OR seller_id = userId |
| Confirm as non-buyer | ❌ Blocked | `Only buyer can confirm payment` |
| Release as non-seller | ❌ Blocked | `Only seller can release crypto` |

### P2P Weaknesses

- **✅ No critical flaw** — Role checks, idempotency, and escrow flow are correct.

---

## PHASE 5 — WITHDRAWAL

### 5.1 Flow

| Test | Result | Notes |
|------|--------|-------|
| Preview | ✅ | Authenticated |
| Withdraw with 2FA enabled | ✅ | twoFactorCode required; verifyUser2FA |
| Withdraw with fund password | ✅ | fund_password required; verifyFundPassword |
| API key no_withdraw | ✅ | allowWithdraw=false → 403 API_KEY_NO_WITHDRAW |
| Double submit | ✅ | Idempotency-Key required; Redis cache + lock |
| Cancel withdrawal | ✅ | POST withdrawals/:id/cancel; user-scoped |
| Internal transfer (self) | ❌ Blocked | internal_user_identifier !== userId check |

### 5.2 Signing & Admin

| Test | Result | Notes |
|------|--------|-------|
| Balance freeze on submit | ✅ | Deducted in transaction before insert |
| Ledger write | ✅ | balance_ledger entries |
| Admin approval flow | ✅ | pending_approval status; admin approve/reject with RBAC |

### Withdrawal Weaknesses

- **✅ No bypass** — 2FA and fund password enforced when enabled. API key withdraw scope enforced.

---

## PHASE 6 — SECURITY TESTS

### 6.1 Admin Route as User

| Test | Result | Notes |
|------|--------|-------|
| User JWT on /admin/* | ❌ Blocked | getAdminFromRequest checks decoded.type === 'admin'; user JWT has no type or type !== 'admin' → 401 INVALID_TOKEN |

### 6.2 Modify Another User's Order

| Test | Result | Notes |
|------|--------|-------|
| Cancel order | ❌ Blocked | WHERE id=$1 AND user_id=$2 → 404 |
| P2P confirm as seller | ❌ Blocked | buyerId !== userId → throw |
| P2P release as buyer | ❌ Blocked | sellerId !== userId → throw |

### 6.3 Withdraw from Another User

| Test | Result | Notes |
|------|--------|-------|
| Withdrawal uses request.user.id | ✅ | userId from authenticate; all balance queries use it |
| No user_id in body for withdrawal | ✅ | Backend never reads target user from body |

### 6.4 Replay Token

| Test | Result | Notes |
|------|--------|-------|
| Replay access token after logout | ⚠️ Depends | Session stored in Redis; revokeSession sets isActive=false. If Redis is authoritative, replay fails. If Redis fails/evicts and fallback logic exists, edge case possible |
| Replay refresh token | ✅ | Refresh rotates; old session revoked |

### 6.5 Bypass 2FA

| Test | Result | Notes |
|------|--------|-------|
| Withdraw without 2FA when enabled | ❌ Blocked | userHas2FA check; 2FA_REQUIRED if missing |
| Withdraw with wrong 2FA | ❌ Blocked | verifyUser2FA → INVALID_2FA |
| Withdraw without fund password when set | ❌ Blocked | FUND_PASSWORD_REQUIRED |

### Security Summary

- **✅ User/admin isolation** — Admin routes require admin JWT; user JWT rejected.
- **✅ User-to-user isolation** — Orders, P2P, withdrawals all scoped to request.user.id.
- **⚠️ Replay** — Session revocation relies on Redis; ensure Redis is persistent and not evicted under load.
- **✅ 2FA/fund password** — No bypass path found.

---

## OUTPUT SUMMARY

### 1. ✅ Working Flows

- Signup: OTP → verify → password; OTP required
- Login: OTP required; wrong/expired OTP rejected; rate limited
- JWT: Correct issuance; refresh rotation (logout does *not* revoke JWT — see Critical)
- Wallet: Deposit address, balances, transfer; idempotency; atomic tx; negative/same-account rejected
- Spot: Order placement with balance lock; idempotency (client_order_id); cancel own only; insufficient balance rejected
- P2P: Create, confirm, release with role checks; idempotency; escrow
- Withdrawal: 2FA/fund password enforced; API key no_withdraw; idempotency
- Admin: User JWT rejected on admin routes
- User isolation: Orders, P2P, withdrawals scoped to authenticated user

### 2. ⚠ Partial Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| OTP brute-force via VPN/proxy rotation | Medium | 3 wrong attempts invalidate OTP; consider longer OTP or rate limit per identifier |
| Session revocation depends on Redis | Low | Ensure Redis persistence; consider DB-backed session revocation for critical paths |
| Login redirect not used (minor UX) | Low | N/A |

### 3. ❌ Critical Broken Flows

| Flow | Issue |
|------|-------|
| **Logout / session revocation** | After logout, Redis session key is deleted. Auth middleware treats missing session as "fall back to JWT-only" and accepts the token. Logout does not invalidate the JWT for subsequent requests. |

### 4. 🚨 Exploitable Vulnerabilities

| Vuln | Impact | Severity |
|------|--------|----------|
| **Token replay after logout** | Stolen JWT remains valid after victim logs out. Attacker can continue to access account (balances, trade, withdraw) until JWT expiry. | **Critical** |

**No other direct path found** to:

- Bypass OTP for login/signup
- Bypass 2FA/fund password on withdrawal
- Access another user's orders, balances, or withdrawals
- Access admin routes with user credentials
- Double-spend or duplicate withdrawal via idempotency

### 5. 💰 Financial Risk Level

**High** (due to token replay)

- **Without fix:** Logout does not revoke access. Stolen JWT = full account access until expiry. Financial actions (trade, withdraw, transfer) remain possible.
- **With fix (DB fallback on Redis miss):** Risk drops to **Low–Medium** — core flows are sound; OTP brute-force remains a medium residual risk.

**Conclusion:** A critical session revocation flaw must be fixed before production. After fix, the system is otherwise robust for production use.
