# System Audit & Go-Live Checklist
## Backend, User Panel, Admin Panel — Functional Status & Remaining for Tier-1 Exchange

**Audit date:** February 2025  
**Purpose:** Yeh document batata hai ki kya-kya **functional** hai, kya **Tier-1 exchange** level par kaam kar raha hai, aur **live launch** ke liye kya **remaining** hai.

---

# Part 1: Kya Functional Hai (What’s Working)

## 1. Backend (Fastify — `apps/backend`, `npm run dev` → `server.ts`)

| Module | Status | Details |
|--------|--------|---------|
| **Auth** | ✅ Functional | Login (OTP, email/phone, password), signup, JWT + refresh, session (Redis), logout, 2FA (TOTP), passkey, OAuth (Google/Apple). Admin auth alag JWT type. |
| **User APIs** | ✅ Functional | GET /user/me, profile, sessions, KYC status. |
| **Wallet** | ✅ Functional | Chains, tokens, balances (funding/trading), deposit address per chain, deposit history, withdrawal create (validations, risk, 2FA, whitelist), internal transfer, idempotency (withdrawal/transfer). |
| **Deposit flow** | ✅ Backend ready | Deposit address API, `deposits` table, atomic credit (`deposit-credit.service`), repair for overdue. **Actual crediting depends on Indexer** (see below). |
| **Withdrawal flow** | ✅ Functional | Create → pending_approval/pending, admin approve/reject, signing queue (`processSigningQueue` every 5s), hot wallet sign & broadcast, status → completed/failed. |
| **Spot trading** | ✅ Functional | Markets, orderbook (DB + Redis cache), place/cancel order, matching engine, balance lock/credit, fees, WebSocket (orderbook/ticker/trades), circuit breaker. |
| **KYC** | ✅ Functional | Status, initiate, submit (documents), admin review (approve/reject with reason). |
| **P2P** | ✅ Functional | Ads (create/list), create order, escrow lock, confirm payment, release crypto, disputes (admin resolve). |
| **Admin APIs** | ✅ Functional | Dashboard, users, KYC, wallets, deposits, withdrawals, manual credit, hot/cold wallets, reconciliation, ledger, settings, features, blockchains, trading pairs, P2P assets, fees, referrals, notifications, AML/compliance, security (audit, sessions, IP/risk rules, withdrawal review), spot (markets, orders, trades), monitoring. |

**Note:** Backend **Express** app (`index.ts`) legacy hai; **live stack Fastify** (`server.ts`) hai.

---

## 2. User Panel (Next.js — `apps/frontend`)

| Feature | Status | Notes |
|---------|--------|--------|
| **Auth** | ✅ | Login, signup, OTP, session persist (Zustand), logout. |
| **Dashboard / Home** | ✅ | Dashboard page, nav, theme. |
| **Spot trading** | ✅ | Trade page: markets, orderbook, place/cancel order, order history — **API**: `/api/v1/spot/*`. |
| **Wallet** | ✅ | Balances, deposit (crypto): chains/tokens, deposit address, QR, deposit history — **API**: `/api/v1/wallet/*`. |
| **Withdraw** | ✅ | Withdraw crypto: limits, fee preview, create withdrawal, history — **API**: `/api/v1/wallet/*`. |
| **Transfer** | ✅ | Internal transfer (funding ↔ trading, etc.) — **API**: `/api/v1/wallet/*`. |
| **KYC / Identity** | ✅ | Status, initiate, upload docs — **API**: `/api/v1/kyc/*`. |
| **P2P** | ✅ | P2P list, create order, order detail, payment confirm, release — **API**: `/api/v1/p2p/*`. |
| **Referral** | ✅ | Referral page, links — backend referral APIs connected. |
| **Security** | ✅ | Sessions, 2FA, passkeys, withdrawal limits — user + wallet APIs. |
| **Convert / Buy** | ✅ | Convert UI — **API**: `/api/v1/convert/*`. |

User panel **backend se connected** hai; jitna backend expose karta hai (spot, wallet, KYC, P2P) utna user panel use karta hai.

---

## 3. Admin Panel (Next.js — `apps/frontend`, `/admin`)

| Area | Status | Notes |
|------|--------|--------|
| **Login & layout** | ✅ | Admin JWT, sidebar, topbar, theme (dark/light). |
| **Dashboard** | ✅ | Stats, trading halt — GET `/admin/dashboard/stats`, `/admin/trading-halt`. |
| **Users** | ✅ | List, detail, freeze/unfreeze — `/admin/users`, `/admin/users/:id`. |
| **KYC** | ✅ | Pending/approved/rejected, review with reason — `/admin/kyc/*`. |
| **Wallets & funds** | ✅ | Deposits, withdrawals, manual credit, funds summary, hot/cold, reconciliation, ledger, deposit sweeps — `/admin/*`. |
| **Spot** | ✅ | Markets, circuit breakers, orders, trade history, fees — `/admin/spot/*`, `/admin/fees/*`. |
| **P2P** | ✅ | Orders, escrows, disputes, resolve — `/admin/p2p/*`, `/admin/escrows`. |
| **Compliance / AML** | ✅ | Dashboard, alerts, reports, submit/acknowledge — `/admin/aml/*`. |
| **Security** | ✅ | Audit logs, sessions, IP/risk rules, withdrawal review — `/admin/security/*`. |
| **Settings** | ✅ | Key-value, features, blockchains, trading pairs, P2P assets — `/admin/settings/*`. |
| **Fees, referrals, notifications, admins** | ✅ | Connected to backend. |

Admin panel **Tier-1 style** (dense, data-first, dark/light) implement ho chuka hai; **backend connectivity** audit doc (`ADMIN_PANEL_BACKEND_CONNECTIVITY_AUDIT.md`) ke hisaab se connected hai.

---

# Part 2: Tier-1 Exchange Jaisa Behaviour (Where It Matches)

- **Spot:** Order placement, matching, balance lock/credit, fees, orderbook/ticker/trades, WebSocket — **Tier-1 style**.
- **Withdrawals:** Approval workflow, signing queue, hot wallet, audit — **institutional**.
- **Deposits:** Address generation, atomic credit, sweep to hot — **backend ready**; **chain par credit** ke liye **indexer** zaroori hai.
- **Admin:** Full control (users, KYC, wallets, spot, P2P, compliance, security, settings) — **backoffice grade**.
- **Risk / KYC:** Risk engine, KYC gate, 2FA on withdrawal, cooldown — **production-style**.

---

# Part 3: Remaining / Gaps (Live Launch Se Pehle)

## 3.1 Critical (Must Have for Live)

| Item | Description | Owner |
|------|-------------|--------|
| **1. Deposit indexer chalu hona** | Backend deposit **credit** tabhi hota hai jab **deposits** table mein row aa jati hai (on-chain tx detect). Ye **indexer** karta hai (`apps/indexer` — ChainIndexer + confirmation). **Indexer run nahi** to user deposit address pe paisa aane par bhi balance update nahi hoga. | Indexer service run karo (same DB), RPC URLs configure karo. |
| **2. Environment & secrets** | Production env: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `NEXT_PUBLIC_API_URL`, CORS, KMS/HSM (hot wallet keys), RPC URLs for chains. | DevOps / backend |
| **3. Database migrations** | Production DB par `migrate` run karna; schema (deposits unique constraint, spot_orders, etc.) verified. | Backend |
| **4. Hot wallet setup** | Live pe withdrawal ke liye **hot wallet** per chain create + fund karna; cold wallet address set karna. | Admin + ops |
| **5. Trading halt / circuit breaker** | Admin trading halt use kare; circuit breaker already backend mein hai. | Admin panel already has UI |

## 3.2 Important (Should Have)

| Item | Description |
|------|-------------|
| **Withdrawal idempotency (user-facing)** | Backend mein replay se double withdrawal avoid karne ke liye **request-level idempotency** (e.g. `Idempotency-Key` header on POST /withdraw) optional hai; document kiya gaya hai. |
| **Rate limiting** | Global rate limit already hai; production par limits tune karo (per-user, per-route). |
| **Admin IP whitelist** | Production admin ke liye IP whitelist enforce karo (Fastify middleware). |
| **Monitoring & alerts** | Health checks, logs, metrics (e.g. withdrawal queue depth, failed signing, deposit credit failures). |
| **Backup & DR** | DB backup, Redis persistence, recovery plan. |

## 3.3 Optional / Later

| Item | Description |
|------|-------------|
| **RabbitMQ** | P2P/other queues; agar use ho raha hai to production par configure karo. |
| **Support tickets API** | Admin support pages agar ticket API expect karti hain to backend endpoint verify karo. |
| **Reports (financial/users/trading)** | Agar koi specific report API chahiye to backend check karo. |
| **KYC provider integration** | Agar third-party KYC (e.g. face liveness) use karna hai to integrate karo. |

---

# Part 4: Quick Verification Checklist

- [ ] Backend: `npm run dev` (Fastify) — health `/health` 200.
- [ ] Frontend: `NEXT_PUBLIC_API_URL` backend ko point kare — login, dashboard load.
- [ ] User: Login → Deposit page (address dikhe) → Withdraw (preview + create) → Spot trade (order place/cancel).
- [ ] Admin: Admin login → Dashboard → Users, KYC, Withdrawals (approve), Hot Wallets, Settings.
- [ ] Indexer: Same DB + RPC → deposit tx detect → `deposits` row → credit (manual repair bhi test kar sakte ho).

---

# Part 5: Summary (Short)

| Layer | Functional? | Tier-1 style? | Live ke liye critical remaining |
|-------|-------------|----------------|----------------------------------|
| **Backend** | ✅ Haan | ✅ Haan | Indexer run, env, migrations, hot wallet |
| **User panel** | ✅ Haan | ✅ Haan | — |
| **Admin panel** | ✅ Haan | ✅ Haan | IP whitelist, monitoring |

**Conclusion:**  
**Backend, user panel aur admin panel functional hain** aur **Tier-1 exchange** jaisi features (spot, wallet, KYC, P2P, admin control) cover karte hain. **Live ke liye zaroori cheez:** **deposit indexer** chalana, **env/migrations/hot wallet** fix karna, aur **monitoring/security** (IP whitelist, alerts) add karna.

---

# Part 6: UI Remaining (Kya UI Baki Hai)

Detail list: **`docs/UI_REMAINING.md`**

**Short:**

| Area | Item | Status |
|------|------|--------|
| User | Spot price chart (`/dashboard/spot`) | Wired to real chart + candles API. Empty if `ohlcv_candles` not populated. |
| User | PnL chart (`/dashboard/assets/pnl`) | Mock data fallback when API fails. |
| User | Assets overview chart | Placeholder data. |
| User | Convert page price chart | "Coming soon". |
| User | Withdraw fiat (`/dashboard/withdraw/fiat`) | **Done** — "Coming soon" page added; no 404. |
| Admin | Reports / Support / KYC settings | Verify backend endpoints; may be hub-only or placeholder. |

**Indexer run:** **`docs/INDEXER_RUN.md`** — how to run deposit indexer (same DB, RPC).
