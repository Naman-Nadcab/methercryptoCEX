# Admin Safety Audit Report — Production CEX

**Scope:** Admin routes and admin-triggered financial flows. No schema/architectural changes suggested.

---

## SECTION A — Admin Routes Coverage

| Route | Method | Auth | Notes |
|-------|--------|------|--------|
| `/auth/login` | POST | N/A | Intentional (unauthenticated) |
| `/auth/logout` | POST | Token only | Intentional (invalidates session) |
| `/auth/me` | GET | JWT + session | Intentional (self) |
| `/dashboard/stats` | GET | **MISSING** | Returns sensitive counts (users, KYC, P2P, referrals) |
| `/matches` | GET | ✔ getAdminFromRequest | |
| `/trading-halt` | GET | ✔ getAdminFromRequest | |
| `/monitoring/counters` | GET | ✔ getAdminFromRequest | |
| `/settlement/*` | GET/POST | ✔ getAdminFromRequest | |
| `/escrows`, `/escrows/:id`, freeze, unfreeze | GET/POST | ✔ getAdminFromRequest | |
| `/users` | GET | **MISSING** | Returns user list + aggregate balances |
| `/users/:id` | GET | **MISSING** | Returns user detail + balances |
| `/users/:id/balances` | GET | ✔ getAdminFromRequest | |
| `/users/:id/status` | PATCH | **MISSING** | **MUTATES** `users` |
| `/kyc/pending` | GET | **MISSING** | Returns pending KYC + PII |
| `/kyc/:id/review` | PATCH | **MISSING** | **MUTATES** `kyc_applications` + `users` |
| `/kyc` | GET | **MISSING** | Returns all KYC applications + PII |
| `/p2p/disputes` | GET | **MISSING** | Returns disputes + user emails |
| `/p2p/disputes/:id/resolve` | PATCH | ✔ getAdminFromRequest | Delegates to p2pService.resolveDispute |
| `/settings` | GET | **MISSING** | Returns system_settings |
| `/settings` | PATCH | **MISSING** | **MUTATES** system_settings |
| `/wallets` | GET | ✔ getAdminFromRequest | |
| `/deposits/manual-credit` | POST | ✔ getAdminFromRequest | Idempotency + FOR UPDATE |
| `/funds/summary` | GET | ✔ getAdminFromRequest | |
| `/withdrawals/*` (approve/reject) | POST | ✔ getAdminForWithdrawalApproval | |
| `/deposit-sweeps/*`, `/hot-wallets` | GET/POST | ✔ getAdminFromRequest | |
| `/trading`, `/p2p`, `/p2p/ads`, `/p2p/orders` | GET | ✔ getAdminFromRequest | |
| `/referrals/*`, `/fees/*` | GET/POST/PATCH/DELETE | ✔ getAdminFromRequest | |
| `/notifications/*` | GET/POST/PATCH/DELETE | ✔ getAdminFromRequest | |
| `/admins` | GET | **MISSING** | Returns admin list |
| `/admins/logs` | GET | **MISSING** | Returns admin activity logs |
| `/settings/blockchains` | GET | **MISSING** | |
| `/settings/blockchains/:id` | GET | **MISSING** | |
| `/settings/blockchains` | POST | **MISSING** | **MUTATES** blockchains |
| `/settings/blockchains/:id` | PUT | **MISSING** | **MUTATES** |
| `/settings/blockchains/:id` | DELETE | **MISSING** | **MUTATES** |
| `/settings/currencies` | GET/POST/PUT/DELETE | **MISSING** (except GET /tokens) | Multiple **MUTATES** |
| `/settings/currencies/:id/toggle`, symbol toggle | PATCH | **MISSING** | **MUTATES** |
| `/tokens` | GET | ✔ getAdminFromRequest | |
| `/settings/quote-assets` | GET/POST/PUT/DELETE | **MISSING** | **MUTATES** |
| `/settings/trading-pairs` | GET/POST/PUT/PATCH/DELETE | **MISSING** | **MUTATES** |
| `/settings/p2p-assets` | GET/POST/PUT/PATCH/DELETE | **MISSING** | **MUTATES** |
| `/settings/features` | GET/POST/PATCH/DELETE + bulk | **MISSING** | **MUTATES** |
| `/settings/api` | GET/POST/PUT/PATCH/DELETE/test | **MISSING** | **MUTATES** |

All routes are mounted under prefix `/api/v1/admin` with **no global preHandler**; auth is per-route via `getAdminFromRequest` / `getAdminForWithdrawalApproval`.

---

## SECTION B — Auth Safety Issues

**BROKEN (mutate state without admin auth)**

- `PATCH /users/:id/status` — Updates `users.status`; no admin check. Any caller can suspend/activate users.
- `PATCH /kyc/:id/review` — Updates `kyc_applications` and `users.tier_level`; no admin check. Any caller can approve/reject KYC.
- `PATCH /settings` — Upserts `system_settings`; no admin check. Any caller can change system config.
- `POST/PUT/DELETE /settings/blockchains` — Mutate blockchains; no admin check.
- `POST/PUT/DELETE /settings/currencies`, toggles — Mutate currencies; no admin check.
- `POST/PUT/DELETE /settings/quote-assets` — No admin check.
- `POST/PUT/PATCH/DELETE /settings/trading-pairs` (including bulk) — No admin check.
- `POST/PUT/PATCH/DELETE /settings/p2p-assets` — No admin check.
- `POST/PATCH/DELETE /settings/features` (including bulk-toggle, category toggle) — No admin check.
- `POST/PUT/PATCH/DELETE /settings/api`, test — No admin check.

**RISKY (sensitive data without admin auth)**

- `GET /dashboard/stats` — User/KYC/P2P/referral counts.
- `GET /users`, `GET /users/:id` — User list and detail with balances.
- `GET /kyc/pending`, `GET /kyc` — KYC applications and PII.
- `GET /p2p/disputes` — Disputes and user emails.
- `GET /settings` — System settings.
- `GET /admins`, `GET /admins/logs` — Admin list and activity logs.
- All `GET /settings/blockchains`, `GET /settings/currencies`, `GET /settings/quote-assets`, `GET /settings/trading-pairs`, `GET /settings/p2p-assets`, `GET /settings/features`, `GET /settings/api` — Config and operational data.

**SAFE (auth enforced, no direct balance/escrow mutation in route)**

- `PATCH /p2p/disputes/:id/resolve` — Uses `getAdminFromRequest`; delegates to `p2pService.resolveDispute(...)`; route does not touch escrow or `user_balances`.
- Escrow freeze/unfreeze — Auth present; delegate to `freezeEscrow` / `unfreezeEscrow` (no balance mutation).
- Manual credit, withdrawal approve/reject, settlement/reconcile — Auth present; balance changes in services with proper locking/ledger.

---

## SECTION C — Financial / Balance Risks

**Admin dispute resolution flow (verified)**

- Route: `getAdminFromRequest` → reject `resolution === 'split'` with 400 → `p2pService.resolveDispute(disputeId, adminId, resolution, notes)`.
- Service: Single `db.transaction`; `p2p_disputes` and `p2p_orders` selected **FOR UPDATE**; escrow release/refund via `releaseFromEscrow` / `refundFromEscrow`; dispute updated last. No partial state; route does not mutate escrow or balances.

**Admin manual credit**

- Idempotency: `Idempotency-Key` required; Redis cache by `adminId:idempotencyKey`; same key + same body → 200 with cached response; same key + different body → 409. Redis lock (`setNxEx`) prevents concurrent execution for same key.
- In transaction: `ensureUserBalanceRow` → `SELECT ... FOR UPDATE` on `user_balances` → `UPDATE` available_balance → `assertUserBalanceUpdated` + `assertBalanceInvariant` → `insertBalanceLedger` (one entry, referenceType `adjustment`). No double credit: idempotency + single UPDATE + ledger.

**Escrow freeze / unfreeze**

- No balance mutation; only `escrows.admin_frozen_at` / `admin_frozen_reason`. Freeze: `UPDATE ... WHERE id = $1 AND status = 'locked'` (idempotent). Unfreeze: `UPDATE ... WHERE id = $1`. No ledger or `user_balances` change; no double-credit/desync risk.

**Settlement balance-reconcile**

- `reconcileBalanceToLedger`: Trading must be halted; single transaction; `user_balances` row selected **FOR UPDATE**; UPDATE to target available/locked; ledger entries for both available and locked deltas; `assertBalanceInvariant`; audit log. No missing ledger entry for the adjustment; no double credit.

**Withdrawal approve/reject**

- Approve: Service uses `SELECT ... FOR UPDATE` on withdrawal; status transition `pending_approval` → `pending`; no balance change in approve. Reject: Service releases locked balance and writes ledger (not re-verified here; per constraint only safety of admin route and dispute flow were in scope).

**Defects identified**

- None in the **admin-triggered** balance/escrow flows above that would cause double credit, balance desync, missing ledger entry, or locking inconsistency, **given** the route is only called by authenticated admins. The critical defect is **missing auth on many routes** (Section B), which can allow non-admin callers to trigger mutations.

---

## SECTION D — Concurrency / Race Risks

**Admin dispute resolve**

- `p2pService.resolveDispute`: Single transaction; `p2p_disputes` and `p2p_orders` locked with **FOR UPDATE**; dispute status check (`resolved`/`closed` → throw); then escrow release/refund and dispute update. No missing FOR UPDATE; no partial state.

**Admin manual credit**

- Redis lock prevents concurrent execution for same idempotency key. Inside transaction, **FOR UPDATE** on `user_balances` row. Invariant asserted after UPDATE. Safe.

**Escrow freeze/unfreeze**

- No **FOR UPDATE** on escrow row; direct `UPDATE ... WHERE id = $1 [AND status = 'locked']`. Freeze/unfreeze are metadata-only and idempotent; no balance or ledger change. Acceptable for current design.

**Withdrawal approve**

- Service uses **FOR UPDATE** on withdrawal row; status check then UPDATE. No race with concurrent reject in same service.

**Missing protections**

- Routes that mutate state **without admin auth** (Section B) are open to any client; concurrency is irrelevant until auth is fixed. No additional missing FOR UPDATE or invariant assertions were identified in the **admin-protected** financial paths.

---

## SECTION E — Missing Protections (Summary)

1. **Admin auth**
   - **Critical:** Add `getAdminFromRequest(app, request, reply, false)` (or appropriate role) to every route that returns sensitive data or mutates state, except `/auth/login`, `/auth/logout`, `/auth/me`.
   - Explicitly broken until fixed: `PATCH /users/:id/status`, `PATCH /kyc/:id/review`, `PATCH /settings`, and all mutating `POST/PUT/PATCH/DELETE` under `/settings/*` (blockchains, currencies, quote-assets, trading-pairs, p2p-assets, features, api).

2. **Dispute resolution**
   - No further protections needed: admin auth, delegation to `p2pService.resolveDispute`, and rejection of `split` are in place; route does not touch escrow or balances.

3. **Financial flows**
   - No missing ledger, double-credit, or locking defects identified in the admin manual credit, escrow freeze/unfreeze, balance reconcile, or dispute resolve flows, assuming callers are authenticated admins.

4. **Idempotency**
   - Manual credit is protected by `Idempotency-Key` + Redis cache and lock. No other admin financial actions were found to require idempotency in the current design.

---

*End of report. No schema changes, refactors, or architectural redesign recommended; only concrete auth and existing flow verification.*
