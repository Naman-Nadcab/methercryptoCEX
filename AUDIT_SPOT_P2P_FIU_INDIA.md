# Comprehensive Audit — Spot & P2P Exchange + FIU India Compliance

**Date:** Feb 2025  
**Scope:** User-side Spot, P2P, aur FIU India compliance (Binance-grade reference)

---

## 1. SPOT EXCHANGE — Status

### ✅ Ho chuka (working)

| Feature | Status |
|---------|--------|
| Spot grid (chart, orderbook, order form) | ✅ |
| Limit / Market / Stop / Stop Limit orders | ✅ |
| Orderbook WebSocket, real-time ticker | ✅ |
| Open orders + cancel | ✅ |
| Order history, trade history | ✅ |
| Deposit crypto (KYC gate, QR, copy) | ✅ |
| Withdraw crypto (limits, preview, confirm) | ✅ |
| Balances (spot, funding), internal transfer | ✅ |
| Markets list, favorites | ✅ |
| Dashboard Markets → Trade with `?symbol=` | ✅ (fixed) |

### ⚠️ Optional / Polish (Binance-grade extras)

| Item | Note |
|------|------|
| Time-in-force (GTC/IOC/FOK) | Schema hai, UI expose nahi karta |
| Quantity shortcuts (25/50/75/100%) | Nahin |
| Post-Only, Reduce-Only | Nahin |
| Min notional / fee breakdown | UI me nahin |
| Chart indicators, drawing | Basic LightweightCharts only |

**Verdict:** Spot core **properly working** hai — Binance-grade basics cover ho gaye.

---

## 2. P2P EXCHANGE — Status

### ✅ Ho chuka (working)

| Feature | Status |
|---------|--------|
| Ads list, filters, sort | ✅ |
| Create order (quantity, payment method, idempotency) | ✅ |
| Order detail (status, buyer, seller, amounts) | ✅ |
| Chat | ✅ |
| "I have paid" (confirm payment) | ✅ |
| "Release crypto" (seller release) | ✅ |
| Cancel order (with reason) | ✅ |
| Admin dispute resolve + escrow release | ✅ (`p2pService.resolveDispute` call ho raha hai) |

### ❌ Remaining (Binance-grade must-have)

| # | Item | Impact | Details |
|---|------|--------|---------|
| 1 | **User dispute open** | **P0** | `POST /p2p/orders/:orderId/dispute` **Fastify me nahin** hai — sirf Express `p2p.routes.ts` me hai jo **live API nahin**. User **"Open dispute" button** bhi nahin dikh raha. |
| 2 | **Payment instructions for buyer** | **P0** | Order detail pe buyer ko **seller ka UPI/bank detail** nahin dikh raha. Binance me "Pay to this account" block hota hai. API order return karta hai lekin `seller_payment_details` / `payment_instructions` nahin. |
| 3 | **Payment timer** | P1 | "X min left" countdown nahin — `expires_at` / `payment_time_limit` backend me ho sakta hai, UI me show karo. |
| 4 | **P2P limits (INR / crypto)** | P2 | FIU compliance ke liye P2P per-trade / per-user limits add karo. |

**Verdict:** P2P flow **end-to-end chal raha hai** (create → pay → release) lekin **dispute open** aur **payment instructions** binance-grade ke liye **zaroori** hain.

---

## 3. FIU INDIA COMPLIANCE — Status

### ✅ Jo hai

| Area | Implementation |
|------|----------------|
| KYC | `kyc_applications`, PAN, Aadhaar, selfie, DigiLocker (demo) |
| KYC enforcement | `kyc-enforcement.service`: withdrawal, p2p_sell, fiat_withdrawal require approved KYC |
| Deposit KYC gate | Deposit address sirf KYC-approved users ko milta hai |
| AML monitoring | `aml-transaction-monitor.service`, `aml_transaction_logs`, `aml_alerts` |
| AML rules | Large fiat (INR 1M+), large crypto (100K+), velocity (3+ in 24h), high-risk countries |
| STR/CTR | `aml_str_ctr_logs`; admin escalate to STR |
| Withdrawal limits | Daily/monthly from `users`; API `/wallet/withdrawal-limits` |
| Admin compliance UI | Alerts, reports, escalate flow |

### ⚠️ Gaps (FIU / RBI expectations)

| # | Gap | Expectation |
|---|-----|-------------|
| 1 | **FIU-IND registration** | FIU-IND me reporting entity registration + reporting flow document/implement karo |
| 2 | **PMLA / RBI references** | UI / flows me PMLA / RBI compliance mention nahin |
| 3 | **P2P limits** | P2P per-trade / per-user INR aur crypto limits enforce nahin |
| 4 | **Bank verification** | P2P ke liye bank account / UPI verification flow weak hai |
| 5 | **User freeze reason persistence** | Admin user freeze kare to `reason` DB me store nahin hota — audit trail weak |
| 6 | **Transaction reporting (user-facing)** | Large / cash transactions ke liye user ko koi reporting/notice nahin |

**Verdict:** KYC, AML, withdrawal limits, STR/CTR **implemented** hain. FIU-IND registration, P2P limits, aur audit trail polish **remaining**.

---

## 4. Properly Working? — Quick Checklist

| Flow | Working? |
|------|----------|
| Signup → KYC → Deposit | ✅ |
| KYC → Withdraw | ✅ |
| Spot trade (limit/market/stop) | ✅ |
| P2P: Browse → Create → Pay → Release | ✅ |
| P2P: Open dispute (user) | ❌ — Route Fastify me nahin, UI button nahin |
| P2P: Admin resolve dispute | ✅ — Escrow release ho raha hai |
| Deposit KYC gate | ✅ |
| Withdrawal limits | ✅ |
| Dashboard Markets → Trade with symbol | ✅ |
| Redirect after login | ✅ |

---

## 5. Priority Fix List (Spot + P2P + FIU)

### P0 — Critical

1. **P2P user dispute**
   - Backend: `POST /api/v1/p2p/orders/:orderId/dispute` in `p2p.fastify.ts` add karo; `p2pService.openDispute` call karo.
   - Frontend: Order detail pe "Open dispute" button add karo (status `payment_confirmed` ke baad, disputed se pehle).

2. **P2P payment instructions**
   - Backend: GET order me buyer ke liye seller ka selected payment method detail return karo (UPI ID, bank account, IFSC etc.) — sirf `payment_pending` me, sirf buyer ko.
   - Frontend: Order detail pe "Pay to: [Bank/UPI details]" block dikhao.

### P1 — High

3. **P2P payment timer**  
   - Order me `expires_at` / `payment_time_limit` return karo; UI me "X min left" countdown dikhao.

4. **User freeze reason**  
   - Admin user status change kare to `reason` persist karo (DB column + admin UI).

### P2 — Compliance

5. **P2P limits**  
   - Per-trade / per-user INR aur crypto limits config + enforce karo.

6. **FIU-IND / PMLA**  
   - Documentation me FIU-IND reporting flow add karo; UI me PMLA / compliance notices jahan zaroori ho.

---

## 6. Summary

| Area | Status | Remaining |
|------|--------|-----------|
| **Spot** | ✅ Working | Optional polish (TIF, qty shortcuts) |
| **P2P core** | ✅ Working | Dispute open (P0), Payment instructions (P0), Timer (P1) |
| **FIU India** | ✅ KYC, AML, limits | FIU-IND reg, P2P limits, audit trail |

**Sab kuch properly work kar raha?**  
- Spot: **Haan.**  
- P2P: **Flow haan, lekin dispute + payment instructions P0 hai.**  
- FIU: **Base compliance haan; FIU-IND + P2P limits pending.**
