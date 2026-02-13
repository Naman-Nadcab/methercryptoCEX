# USER PANEL COMPLETENESS AUDIT

**Project:** Centralized crypto exchange (Fastify + TypeScript backend)  
**Date:** 2025-02-11  
**Scope:** User-visible UI features, backend wiring, flows, UX consistency, history visibility  
**Rules:** Analysis only — no code modifications

---

## PART 1 — UI FEATURE INVENTORY

### User-Visible Features (from layout, nav, routes)

| Category | Feature | Route | Page Exists |
|----------|---------|-------|-------------|
| **Wallet / Balances** | Asset Overview | `/dashboard/assets/overview` | ✅ |
| | Funding Account | `/dashboard/assets/funding` | ✅ |
| | Unified Trading Account | `/dashboard/assets/unified` | ✅ |
| | Spot Wallet | `/dashboard/wallet/spot` | ✅ |
| **Deposit** | Deposit Crypto | `/dashboard/deposit/crypto` | ✅ |
| | Deposit Fiat | `/dashboard/deposit/fiat` | ❌ (link only) |
| **Withdraw** | Withdraw Crypto | `/dashboard/withdraw/crypto` | ✅ |
| **Transfer** | Internal Transfer | `/dashboard/transfer` | ✅ |
| **Convert / Swap** | Convert (instant + limit) | `/dashboard/assets/convert` | ✅ |
| **Spot Trading** | Trade (main) | `/dashboard/trade` | ✅ |
| | Trade Spot | `/dashboard/trade/spot` | ✅ |
| **P2P** | P2P (redirects to /p2p) | `/dashboard/p2p` | ✅ (redirect) |
| | P2P Buy/Sell | `/p2p/[type]/[crypto]/[fiat]` | ✅ |
| **History** | Asset History | `/dashboard/assets/history` | ✅ |
| | PnL | `/dashboard/assets/pnl` | ✅ |
| **Profile / Security** | Account Info | `/dashboard/account` | ✅ |
| | Identity Verification (KYC) | `/dashboard/identity` | ✅ |
| | KYC Upload | `/dashboard/identity/upload` | ✅ |
| | KYC Success | `/dashboard/identity/success` | ✅ |
| | Security | `/dashboard/security` | ✅ |
| | Passkeys | `/dashboard/security/passkeys` | ✅ |
| | Change Password | `/dashboard/security/change-password` | ✅ |
| | Withdrawal Limits | `/dashboard/security/withdrawal-limits` | ✅ |
| **2FA / Sessions / Devices** | Via Security page | `/dashboard/security` | ✅ |
| **Other** | Address Book | `/dashboard/address-book` | ✅ |
| | Address Book Add Batches | `/dashboard/address-book/add-batches` | ✅ |
| | API Keys | `/dashboard/api` | ✅ |
| | API Create | `/dashboard/api/create` | ✅ |
| | Preferences | `/dashboard/preferences` | ✅ |
| | Referral | `/dashboard/referral` | ✅ |
| | My Referrals | `/dashboard/referral/my-referrals` | ✅ |
| | Fee Rates | `/dashboard/fee-rates` | ✅ |
| | Announcements | `/dashboard/announcements` | ✅ |
| | Data Export | `/dashboard/data-export` | ✅ |

### Features Linked in Nav but NO PAGE (404)

| Nav Item | Route | Status |
|----------|-------|--------|
| Buy Crypto | `/dashboard/buy-crypto` | ❌ No page |
| Markets | `/dashboard/markets` | ❌ No page |
| Finance | `/dashboard/finance` | ❌ No page |
| Earn | `/dashboard/earn` | ❌ No page |
| Copy Trading | `/dashboard/copy-trading` | ❌ No page |
| Events | `/dashboard/events` | ❌ No page |
| Demo Trading | `/dashboard/demo-trading` | ❌ No page |
| Unified Order | `/dashboard/orders/unified` | ❌ No page |
| Buy Crypto Order | `/dashboard/orders/buy-crypto` | ❌ No page |
| TradFi Order | `/dashboard/orders/tradfi` | ❌ No page |
| Earn Order | `/dashboard/orders/earn` | ❌ No page |
| Loan Order | `/dashboard/orders/loan` | ❌ No page |
| Margin Staked SOL Orders | `/dashboard/orders/margin-staked` | ❌ No page |
| Spot Orders (from assets pages) | `/dashboard/orders/spot` | ❌ No page |
| Convert Orders | `/dashboard/orders/convert` | ❌ No page |

---

## PART 2 — BACKEND WIRING VERIFICATION

### Fully Wired (Endpoint Exists, UI Calls Match)

| Feature | API Endpoints | Status |
|---------|---------------|--------|
| Deposit | `GET /wallet/tokens`, `GET /wallet/tokens/:symbol/chains`, `GET /wallet/deposit-address/:chainId`, `GET /wallet/deposit-history`, `GET /wallet/kyc-status` | ✅ |
| Wallet Balances | `GET /wallet/balances/funding`, `GET /wallet/balances/trading`, `GET /wallet/balances/by-account`, `GET /wallet/balances/summary`, `GET /wallet/balances/spot` | ✅ |
| Asset Overview | `GET /wallet/balance-diagnostic`, `GET /wallet/balances/summary`, `GET /wallet/balances/by-account`, `GET /wallet/deposit-history`, `GET /wallet/withdrawals` | ✅ |
| Spot Trading (main) | `GET /spot/markets`, `GET /spot/ticker/:symbol`, `GET /spot/orderbook/:symbol`, `GET /spot/open-orders`, `GET /spot/order-history`, `GET /spot/trade-history`, `POST /spot/order`, `POST /spot/order/:id/cancel`, `POST /spot/orders/cancel-all` | ✅ |
| Spot Trading (spot page) | `GET /spot/orders`, `POST /spot/orders`, `POST /spot/orders/:id/cancel` | ✅ |
| Convert (read) | `GET /convert/currencies`, `GET /convert/market-prices`, `GET /convert/balances`, `GET /convert/quote`, `GET /convert/orders/active`, `GET /convert/history` | ✅ |
| KYC | `GET /wallet/kyc-status`, `POST /kyc/initiate`, `POST /kyc/upload-document` | ✅ |
| Announcements | `GET /user/announcements`, `GET /user/announcements/:id` | ✅ |
| Referral | `GET /user/referrals` | ✅ |
| Account / Profile | `GET /auth/profile` | ✅ |
| Preferences | `GET /auth/preferences`, `POST /auth/preferences` | ✅ |
| Fee Rates | `GET /auth/fee-rates`, `POST /auth/fee-rates/mnt-discount` | ✅ |
| API Keys | `GET /auth/api-keys` | ✅ |
| Address Book | `GET /auth/withdrawal-addresses`, `POST /auth/withdrawal-addresses`, `DELETE /auth/withdrawal-addresses/:id`, `GET /auth/address-book/status`, `GET /auth/withdrawal-whitelist/status`, `GET /auth/new-address-lock/status` | ✅ (except 2FA status) |

### Backend Wiring Issues

| Issue | Feature | Severity |
|-------|---------|----------|
| **Withdraw requires Idempotency-Key** | Withdraw page does NOT send `Idempotency-Key` header. Backend returns `400 IDEMPOTENCY_KEY_REQUIRED` | **CRITICAL** |
| **Transfer requires Idempotency-Key** | Transfer page does NOT send `Idempotency-Key` header. Backend returns `400 IDEMPOTENCY_KEY_REQUIRED` | **CRITICAL** |
| **Convert requires Idempotency-Key** | Convert (instant + limit) pages do NOT send `Idempotency-Key` header. Backend returns `400 IDEMPOTENCY_KEY_REQUIRED` | **CRITICAL** |
| **2FA status endpoint missing** | Address Book calls `GET /auth/2fa/status` — endpoint does not exist. Only `POST /auth/2fa/setup`, `enable`, `verify`, `disable` exist | **HIGH** |
| **P2P not wired** | P2P page (`/p2p/[type]/[crypto]/[fiat]`) uses hardcoded `PLACEHOLDER_ADS`; no API call to `GET /p2p/ads`. Backend has `/p2p/ads`, `/p2p/payment-methods`, `/p2p/my-ads` | **CRITICAL** |
| **Data Export is stub** | Data Export `handleExport()` uses `setTimeout` to simulate; no API call. No backend endpoint for user data export | **HIGH** |
| **KYC upload mock** | KYC upload-document returns success without persisting files; `catch` block simulates success and redirects | **MEDIUM** |

### Response Shape Verification

| Endpoint | UI Expectation | Notes |
|----------|----------------|------|
| `GET /wallet/transactions/all` | `Transaction[]` with id, type, coin, chain_type, quantity, status, date_time, etc. | Backend returns mixed types (deposits, withdrawals, transfers); UI maps per tab — verify "all" tab shape |
| `GET /wallet/transfer/history` | `{ fromAccount, toAccount, symbol, amount, status, created_at }` | Backend returns `description`, `direction`, `fromAccount`, `toAccount` — UI maps correctly |
| `GET /wallet/deposit-history` | `id, symbol, chain_name, amount, tx_hash, status, confirmations, required_confirmations` | Backend schema may use different field names — verify `fromAddress`, `explorerUrl` |
| Withdraw response | `data.status`, `data.type` | Backend returns these — OK |

---

## PART 3 — FUNCTIONAL FLOW VALIDATION

### Deposit

| Step | Status | Notes |
|------|--------|-------|
| UI → address | ✅ | Token + chain selection, `GET /wallet/deposit-address/:chainId` |
| Detection | ✅ | Indexer + backend; deposit-history polling |
| Confirmation | ✅ | UI shows confirmations progress |
| Credit | ✅ | Backend credits on confirmation |
| History | ✅ | Asset History deposit tab |

**Flow:** Complete. No broken transitions identified.

### Withdraw

| Step | Status | Notes |
|------|--------|-------|
| UI → validation | ✅ | Preview, limits, fee fetch |
| Lock | ✅ | Backend locks balance atomically |
| Processing | ✅ | Withdrawal signing service |
| Completion | ✅ | Status updates |
| History | ✅ | Asset History withdraw tab |

**Blockers:** Withdraw will **fail at submission** due to missing `Idempotency-Key` → 400. User cannot complete any withdrawal.

### Transfer

| Step | Status | Notes |
|------|--------|-------|
| UI → debit/credit | ✅ | `POST /wallet/transfer` |
| Ledger | ✅ | Backend records internal transfer |
| Balance refresh | ✅ | UI refetches after success |

**Blockers:** Transfer will **fail at submission** due to missing `Idempotency-Key` → 400. User cannot complete any transfer.

### Convert

| Step | Status | Notes |
|------|--------|-------|
| UI → rate display | ✅ | Quote API |
| Debit | ✅ | Backend deducts from balance |
| Credit | ✅ | Backend credits to balance |
| Cancel (limit) | ✅ | `POST /convert/limit/:orderId/cancel` |
| History | ✅ | Convert page history tab |

**Blockers:** Both instant and limit convert will **fail at submission** due to missing `Idempotency-Key` → 400. User cannot complete any conversion.

### Spot Trading

| Step | Status | Notes |
|------|--------|-------|
| UI → order | ✅ | `POST /spot/order` or `POST /spot/orders` |
| Lock | ✅ | Balance lock in backend |
| Match | ✅ | Matching engine |
| Settlement | ✅ | Trade + fee recording |
| History | ✅ | Order history, trade history tabs |

**Flow:** Complete. Trade page and spot page both wired.

### P2P

| Step | Status | Notes |
|------|--------|-------|
| UI → ads list | ❌ | **Static mock data** — no `GET /p2p/ads` |
| Escrow / order | ❌ | No order creation flow wired |
| Release / refund | ❌ | N/A |
| Balances / history | ❌ | N/A |

**Flow:** Incomplete. P2P UI is a mock; no real P2P trading possible.

---

## PART 4 — UX / UI CONSISTENCY

### Missing or Weak Patterns

| Issue | Severity | Description |
|-------|----------|-------------|
| No confirmation on withdraw | **HIGH** | Withdraw has no explicit "Confirm withdrawal" step; user can submit directly. Best practice: two-step confirmation for high-value actions. |
| KYC catch simulates success | **MEDIUM** | `catch` in identity/upload redirects to success page — network errors can appear as success. |
| Asset overview masked totals | **MEDIUM** | Layout dropdown shows `******` for totals — no real balance in nav. |
| Data Export fake progress | **LOW** | Export button shows loading but does nothing real — misleading. |
| Dead nav links | **LOW** | Earn, Copy Trading, Markets, Events, Demo Trading, Orders/*, Buy Crypto, Finance → 404. |
| P2P fake ads | **HIGH** | User sees ads that look real but are placeholders; no way to actually trade. |

### Stale Balance Risks

| Location | Risk |
|----------|------|
| After withdraw/transfer/convert | UI refetches balances on success — OK. |
| After deposit | Asset History polls every 3–5s when deposits pending — OK. |
| Multi-tab | No shared balance invalidation; second tab can show stale balances. |

### Dangerous UX Patterns

| Pattern | Severity |
|---------|----------|
| Idempotency failures return 400 with no retry hint | **MEDIUM** — User sees "Failed" without knowing to retry with same request. |
| KYC "simulate success" on error | **MEDIUM** — User may believe KYC passed when it did not. |

---

## PART 5 — HISTORY & ACCOUNTING VISIBILITY

| Transaction Type | Visible in UI | Location |
|------------------|---------------|----------|
| Deposits | ✅ | Asset History → Deposit tab |
| Withdrawals | ✅ | Asset History → Withdraw tab |
| Transfers | ✅ | Asset History → Transfer tab |
| Spot Trades | ✅ | Trade page → Trades tab; Order history |
| Convert (instant + limit) | ✅ | Convert page → History |
| P2P | ❌ | Not implemented |

**Convert history:** Shown in Convert page only. Asset History has All / Deposit / Withdraw / Transfer — no dedicated Convert tab, but "All" may include convert entries if backend `transactions/all` returns them.

**Silent balance changes:** None identified for implemented flows. Unimplemented P2P would be silent by design (no execution).

---

## SUMMARY

### 1. Fully Working Features

- Deposit (crypto)
- Wallet / Balances (overview, funding, unified, spot)
- Asset History (deposit, withdraw, transfer, all)
- Spot Trading (main trade page + spot page)
- KYC initiate + upload (backend accepts; upload is stub)
- Profile, Preferences, Security (2FA, passkeys, etc.)
- Address Book (CRUD; 2FA status endpoint missing)
- API Keys, Fee Rates, Announcements, Referral

### 2. Partially Implemented Features

| Feature | Working | Broken |
|---------|---------|--------|
| Withdraw | Preview, history, cancel | Submit fails (no Idempotency-Key) |
| Transfer | Balances, history | Submit fails (no Idempotency-Key) |
| Convert | Quote, active orders, history, cancel | Submit fails (no Idempotency-Key) |
| P2P | UI and layout | Ads static; no order flow |
| Address Book | CRUD, settings | 2FA status 404 |

### 3. Missing Features

- Buy Crypto (`/dashboard/buy-crypto`)
- Markets (`/dashboard/markets`)
- Finance (`/dashboard/finance`)
- Earn (`/dashboard/earn`)
- Copy Trading (`/dashboard/copy-trading`)
- Events (`/dashboard/events`)
- Demo Trading (`/dashboard/demo-trading`)
- Order pages (`/dashboard/orders/*`)
- Deposit Fiat
- Real Data Export
- P2P order creation and escrow

### 4. Backend Wiring Issues

| Issue | Severity |
|-------|----------|
| Withdraw/Transfer/Convert missing Idempotency-Key | **CRITICAL** |
| P2P UI uses mock data, no `/p2p/ads` | **CRITICAL** |
| `GET /auth/2fa/status` does not exist | **HIGH** |
| Data Export has no backend | **HIGH** |
| KYC upload stub + catch redirect | **MEDIUM** |

### 5. UX / UI Risks

| Risk | Severity |
|------|----------|
| Withdraw/transfer/convert always fail → poor UX | **CRITICAL** |
| P2P shows fake ads → misleading | **HIGH** |
| KYC simulates success on error | **MEDIUM** |
| Dead nav links (404) | **LOW** |

### 6. Severity Classification

| Severity | Items |
|----------|-------|
| **CRITICAL** | Withdraw, Transfer, Convert broken (missing Idempotency-Key); P2P not wired |
| **HIGH** | 2FA status 404; Data Export stub; P2P mock |
| **MEDIUM** | KYC upload stub; some confirmations missing; balance staleness in multi-tab |
| **LOW** | Dead nav links; Data Export fake progress; Asset overview masked totals |

---

*Audit complete. No code modifications were made.*
