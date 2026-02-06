# System Snapshot Report — Centralized Crypto Exchange (Read-Only)

**Scope:** SPOT trading and P2P only. No futures, no margin, no unified account in product scope.  
**Purpose:** Exact, verifiable snapshot of how the system currently works. No proposals, no code changes.

---

## 1. ACCOUNT & BALANCE MODEL

### 1.1 Account types in code and DB

- **balance_account_type enum (DB):** Created by migration as `('funding', 'trading')`; migration adds `'spot'`. Verified in DB: **funding, trading, spot** (no `unified`).
- **full-schema.sql:** Defines `balance_account_type AS ENUM ('funding', 'trading', 'unified')`; schema file is not necessarily what the live DB has.
- **Code usage:**
  - **funding:** Used for deposits, withdrawals, internal transfers (debit/credit), P2P (lock/unlock/credit/debit locked), wallet.service (lockBalance, unlockBalance, creditBalance, debitLockedBalance), repair deposit credit, withdrawal lock/refund/cancel.
  - **spot:** Used in wallet routes as part of “funding + spot” aggregation for funding view and by-account; user-balance-helper DEFAULT_ACCOUNT_TYPE is `'spot'`; withdrawal cancel uses `withdrawal.account_type || 'spot'`.
  - **trading:** Used in wallet routes for “trading” bucket (GET /balances, /balances/by-account, /balances/summary, /balances/trading), internal transfer (fromAccount/toAccount), convert (accountType), withdrawal (accountType).
  - **unified:** Referenced in wallet routes (readUserBalances(userId, 'unified'), balances/summary, by-account, GET /balances, GET /balances/trading). **Not present in current DB enum** — calls that pass `'unified'` to the balance service or DB will throw at runtime.

### 1.2 Balance tables and roles

- **user_balances:** Single source of truth for user balances. Columns (from full-schema and migration): id, user_id, currency_id, chain_id (migration), account_type (balance_account_type), available_balance, locked_balance, pending_balance, total_deposited, total_withdrawn, updated_at. Unique: (user_id, currency_id, chain_id, account_type).
- **balances (legacy):** Deprecated. Runtime guard in `lib/database.ts` blocks any query that references the `balances` table (FROM/JOIN/INTO/UPDATE). Migrations may still touch it via raw pool. Not used by application code for reads or writes.

### 1.3 Single source of truth

- **user_balances** is the only source of truth. Comments and guard in code state that the legacy `balances` table must never be used.

### 1.4 Balance mutation flows

- **Deposit:** Indexer ChainIndexer records deposit (status `pending`), updates user_balances **pending_balance** (INSERT/ON CONFLICT). Indexer ConfirmationTracker on sufficient confirmations: sets deposit to `completed`, **credits user_balances** (available_balance += amount, pending_balance -= amount, total_deposited += amount, account_type = 'funding'); if no row exists, INSERTs. Backend wallet route “repair” logic: for overdue pending deposits, marks deposit completed and UPDATEs user_balances available_balance (account_type = 'funding', CHAIN_ID_GLOBAL).
- **Internal transfer (email/identifier):** Debit from sender user_balances (funding/spot aggregated, chain-aware then CHAIN_ID_GLOBAL), credit receiver user_balances (funding, CHAIN_ID_GLOBAL). INSERT withdrawal (type internal, status completed). Uses ensureUserBalanceRow and assertUserBalanceUpdated.
- **Internal transfer (funding/trading/unified):** debitAvailableBalance(fromAccount), creditBalanceForAccount(toAccount). Valid fromAccount/toAccount: funding, trading, unified (same list for both). Uses readUserBalances for source check.
- **Withdrawal (on-chain):** ensureUserBalanceRow then UPDATE user_balances SET locked_balance = locked_balance + (amount+fee), available_balance = available_balance - (amount+fee) for chosen accountType and chain. Withdrawal record created with status pending_approval or pending. On reject: unlock (locked -=, available +=). On complete: withdrawal-signing.service debits locked_balance. On cancel: unlock.
- **Withdrawal (internal):** See “Internal transfer (email/identifier)”.
- **Spot trade (matching-engine):** walletService.creditBalance (buyer receives base, seller receives quote) — creditBalance uses **funding** account_type and chain from token.
- **P2P:** Sell ad: walletService.lockBalance (funding: available → locked). Buy ad order: walletService.lockBalance (seller). On release: debitLockedBalance(seller), creditBalance(buyer). On cancel: unlockBalance. All via wallet.service with **funding**.
- **Convert (instant/limit):** ensureUserBalanceRow then UPDATE user_balances (debit fromAccount, credit toAccount); accountType from request (default 'funding'). Uses CHAIN_ID_GLOBAL.

### 1.5 Balance READ paths and endpoints

- **Canonical service:** `readUserBalances(userId, accountType)` in `services/balance/readUserBalances.ts`. Ensures a row per active currency, then SELECT from user_balances JOIN currencies (user_id, account_type::text = $2, is_active). Returns currency_id, symbol, account_type, available_balance, locked_balance (strings). Throws if zero rows. **Called with accountType in { funding, spot, trading, unified }.** Calling with `unified` fails if enum has no `unified`.
- **Wallet routes using readUserBalances:**
  - GET /api/v1/wallet/balances — reads funding, spot, trading, unified; merges by currency.
  - GET /api/v1/wallet/balances/by-account — same four; aggregates into funding/trading buckets by symbol.
  - GET /api/v1/wallet/balances/summary — same four; returns funding total (funding+spot), trading total (trading+unified).
  - GET /api/v1/wallet/balances/funding — funding + spot from service; builds token list with prices/names.
  - GET /api/v1/wallet/balances/trading — trading + unified from service.
  - GET /api/v1/wallet/transfer/balances — readUserBalances(userId, fromAccount) with fromAccount from query (default funding).
  - POST /api/v1/wallet/transfer — balance check via readUserBalances(userId, fromAccount), then debit/credit.
  - Withdrawal creation balance check — readUserBalances(userId, accountType), then find row by currency_id.
  - Internal (email) withdrawal balance check — readUserBalances funding + spot, sum by currency.
- **Wallet routes with direct SQL (not readUserBalances):**
  - GET /api/v1/wallet/balance-diagnostic — direct SUM from user_balances (funding+spot) for diagnostic.
  - GET /api/v1/wallet/balance-debug — direct SELECT user_balances rows and SUMs (funding+spot, trading+unified) for debug.
- **Trading route:** GET /api/v1/trading/balances — direct SELECT from user_balances JOIN currencies (no account_type filter), no ensure; returns all rows for user.
- **Convert route:** GET /api/v1/convert/balances?accountType= — direct SELECT user_balances WHERE user_id, account_type = $2 AND available_balance > 0; selects **ub.total_balance** (user_balances has no total_balance in full-schema — UNKNOWN whether migration adds it or query fails).
- **Admin:** GET /api/v1/admin/users/:id/balances — direct SELECT user_balances JOIN currencies LEFT JOIN blockchains. GET /api/v1/admin/wallets — SUM(available_balance), SUM(locked_balance) from user_balances per currency.

---

## 2. SUPPORTED FEATURES (AS IMPLEMENTED)

### 2.1 Spot trading

- **Order types (schema):** full-schema order_type enum: market, limit, stop_loss, stop_loss_limit, take_profit, take_profit_limit, stop_limit, trailing_stop, iceberg, fok, ioc, gtc, gtd. Which of these are actually used in spot order creation/execution in code — **not verified in this pass.**
- **Matching engine:** Exists; on fill calls walletService.creditBalance (funding) for buyer and seller.

### 2.2 P2P

- **Escrow:** p2p.service creates row in **escrows** table (user_id, token_id, amount, status). Balance movement: lock in user_balances (funding) for sell ad or on buy-order creation; on release: debitLockedBalance(seller), creditBalance(buyer); on cancel: unlockBalance and update escrow status refunded.
- **Balance locking:** walletService.lockBalance (funding), unlockBalance, debitLockedBalance. P2P uses token_id; wallet resolves currency via getCurrencyIdForToken.
- **Release:** Seller calls release; escrow status → released; then debitLockedBalance(seller), creditBalance(buyer).

### 2.3 Deposits

- **How credited:** Indexer records deposit (pending), updates user_balances pending_balance. ConfirmationTracker when confirmations >= required: deposit status → completed, then UPDATE user_balances (available_balance += amount, pending_balance -= amount, total_deposited += amount, account_type = 'funding'); or INSERT if no row. Backend repair in GET deposit-history / get-all-transactions: for overdue pending deposits, marks completed and credits user_balances (funding, CHAIN_ID_GLOBAL).

### 2.4 Withdrawals

- **Lifecycle:** Create → status pending_approval or pending; balance locked (available -=, locked +=) in user_balances. Approval service: on reject, unlock. Signing service: on complete, debit locked; on fail, refund (unlock). Cancel: unlock.
- **Approval:** withdrawal-approval.service approves or rejects; reject unlocks balance.
- **Locking:** At creation, UPDATE user_balances (locked += amount+fee, available -=). Chain: try chain-specific row then CHAIN_ID_GLOBAL.
- **Settlement:** withdrawal-signing.service deducts locked_balance on completion.

### 2.5 Internal transfers

- **Directions:** Valid account names: funding, trading, unified. Same list for fromAccount and toAccount. Same account not allowed. debitAvailableBalance(fromAccount), creditBalanceForAccount(toAccount). So allowed: funding ↔ trading, funding ↔ unified, trading ↔ unified.
- **Internal (by email/identifier):** Always debit from funding/spot aggregated balance, credit to recipient funding; single withdrawal record (internal, completed).

---

## 3. API SURFACE (FACTUAL)

### 3.1 Wallet / balance-related endpoints

| Route | Purpose | Account type read | Service / SQL |
|-------|---------|-------------------|---------------|
| GET /api/v1/wallet/balance-diagnostic | Diagnostic (counts, sums) | funding+spot (direct SQL) | Direct db.query |
| GET /api/v1/wallet/balance-debug | Debug (full ub rows, sums) | funding+spot, trading+unified (direct SQL) | Direct db.query |
| GET /api/v1/wallet/balances | All balances per currency | funding, spot, trading, unified | readUserBalances ×4, merge |
| GET /api/v1/wallet/balances/by-account | By-account (funding/trading per symbol) | funding, spot, trading, unified | readUserBalances ×4 |
| GET /api/v1/wallet/balances/summary | Funding vs trading totals | funding, spot, trading, unified | readUserBalances ×4 |
| GET /api/v1/wallet/balances/funding | Funding page list | funding, spot | readUserBalances ×2 |
| GET /api/v1/wallet/balances/trading | Trading/unified page list | trading, unified | readUserBalances ×2 |
| GET /api/v1/wallet/transfer/balances | Transfer source balances | from query (default funding) | readUserBalances(userId, fromAccount) |
| GET /api/v1/trading/balances | Trading UI balances | (all account types, no filter) | Direct SQL user_balances |
| GET /api/v1/convert/balances | Convert UI balances | query accountType (default funding) | Direct SQL user_balances (and total_balance) |
| GET /api/v1/admin/users/:id/balances | Admin user balances | (all) | Direct SQL user_balances |
| GET /api/v1/admin/wallets | Admin wallets overview | (aggregate) | Direct SQL SUM user_balances |

### 3.2 Overlap / duplication

- **Multiple balance reads for same concept:** GET /wallet/balances, /wallet/balances/funding, /wallet/balances/by-account, /wallet/balances/summary all use readUserBalances; by-account and summary also call with **unified**, which is not in the current DB enum.
- **Trading balances:** GET /api/v1/wallet/balances/trading and GET /api/v1/trading/balances both serve “trading” context; wallet one uses readUserBalances (trading + unified); trading one uses direct SQL with no account_type filter.
- **Convert balances:** GET /api/v1/convert/balances is separate from wallet balance endpoints; direct SQL; filters available_balance > 0; references ub.total_balance.

---

## 4. DATABASE STATE

### 4.1 Relevant tables (referred to in code or migrations)

- **users** — validated at startup.
- **user_balances** — validated; single source of truth.
- **currencies** — used by wallet, convert, admin; JOIN for symbol/name.
- **tokens** — used by wallet.service (getCurrencyIdForToken, chain_id), withdrawals, convert (token lookup), P2P; validated at startup.
- **chains** — created by migration; validated at startup. (full-schema uses **blockchains**; indexer ConfirmationTracker uses **blockchains**; admin wallets and some admin routes use **blockchains** — UNKNOWN whether runtime DB has chains, blockchains, or both.)
- **deposits** — indexer and backend; status, credited_at, currency_id.
- **withdrawals** — wallet routes, approval, signing services; token_id, chain_id, account_type, status.
- **internal_transfers** — wallet route POST /transfer.
- **spot_orders** — full-schema; order_type, etc.
- **p2p_ads, p2p_orders, p2p_payment_methods, p2p_merchant_stats** — P2P routes; p2p.service also uses **escrows** and **payment_methods** (table names in p2p.service may differ from p2p_payment_methods — UNKNOWN).
- **hot_wallets** — validated at startup.
- **Legacy balances** — exists in migration; runtime must not use it.

### 4.2 Enums (from full-schema and migration)

- **balance_account_type:** Migration creates ('funding', 'trading'), adds 'spot'. **Live DB:** funding, trading, spot. **No 'unified' in DB.**
- **account_type (user):** individual, corporate, institutional (user profile).
- **withdrawal_status:** pending_approval, pending_email_verify, pending_2fa, processing, pending_blockchain, completed, failed, cancelled, rejected.
- **order_type (spot):** market, limit, stop_loss, stop_loss_limit, take_profit, take_profit_limit, stop_limit, trailing_stop, iceberg, fok, ioc, gtc, gtd.
- **p2p_order_status, p2p_ad_type, etc.** — present in full-schema.

### 4.3 Enum usage

- **balance_account_type:** funding, spot, trading used. **unified** used in code but not in current DB enum — runtime error if readUserBalances(..., 'unified') or ensureUserBalanceRow(..., 'unified') is used.
- **transfer_type (full-schema):** user_to_user, spot_to_p2p, p2p_to_spot, spot_to_futures — not verified in wallet internal-transfer code paths.

---

## 5. FRONTEND DEPENDENCY MAP

### 5.1 Balance endpoints used by frontend

- **Dashboard assets funding** (`/dashboard/assets/funding/page.tsx`): GET /api/v1/wallet/balances/funding; fallback GET /api/v1/wallet/balances/by-account.
- **Dashboard assets overview** (`/dashboard/assets/overview/page.tsx`): GET /api/v1/wallet/balance-diagnostic, GET /api/v1/wallet/balances/summary, GET /api/v1/wallet/balances/by-account (fallback), deposit-history, withdrawals.
- **Dashboard assets unified** (`/dashboard/assets/unified/page.tsx`): GET /api/v1/wallet/balances/trading.
- **Dashboard withdraw** (`/dashboard/withdraw/crypto/page.tsx`): GET /api/v1/wallet/balances/by-account, plus tokens, chains, withdrawal-limits, withdrawals, etc.
- **Dashboard transfer** (`/dashboard/transfer/page.tsx`): GET /api/v1/wallet/transfer/balances?from=, GET /api/v1/wallet/transfer/history, POST /api/v1/wallet/transfer.
- **TransferModal:** GET /api/v1/wallet/transfer/balances?from=, POST /api/v1/wallet/transfer.
- **Dashboard assets convert** (`/dashboard/assets/convert/page.tsx`): GET /api/v1/convert/balances?accountType=, convert/currencies, market-prices, quote, instant/limit, history, cancel.
- **Dashboard assets history:** Uses `/api/v1/wallet/` (path truncated in grep — exact endpoint UNKNOWN).
- **Dashboard layout:** GET /api/v1/wallet/kyc-status.
- **Dashboard deposit:** GET /api/v1/wallet/tokens, kyc-status, chains, deposit-address, deposit-history.
- **Dashboard address-book (add-batches, page):** GET /api/v1/wallet/tokens, chains.

### 5.2 Fallback / duplicate calls

- **Funding page:** Primary GET /wallet/balances/funding; if no balances returned, fallback to GET /wallet/balances/by-account and map to funding-style list.
- **Overview:** Fetches summary and by-account (by-account as part of loading or fallback).

---

## 6. INVARIANTS & ASSUMPTIONS IN CODE

### 6.1 Invariants

- **user_balances is the only balance source:** Guard in database.ts blocks access to legacy `balances` table.
- **Balance updates:** Pattern ensureUserBalanceRow → UPDATE user_balances → assertUserBalanceUpdated (or equivalent) in wallet, convert, withdrawal approval/signing; indexer ConfirmationTracker and repair paths UPDATE or INSERT user_balances.
- **Unique key:** (user_id, currency_id, chain_id, account_type) in user_balances. ensureUserBalanceRow and ON CONFLICT use this.
- **Startup:** validateRequiredTables requires users, user_balances, tokens, withdrawals, chains, hot_wallets to exist as tables (not views). Legacy balances not validated.

### 6.2 What breaks if violated

- **Using legacy balances table:** Any runtime query touching it throws (guard).
- **Missing user_balances row before UPDATE:** assertUserBalanceUpdated throws if rowCount === 0; code assumes ensureUserBalanceRow was called first.
- **Calling readUserBalances with 'unified':** Fails if enum has no 'unified' (current DB state).
- **Convert GET /balances:** If user_balances has no total_balance column, query fails.

### 6.3 Possible silent or inconsistent behavior

- **Trading GET /balances:** No account_type filter; returns all rows. No ensureUserBalanceRow; user with no rows gets empty list (no CRITICAL throw).
- **Convert GET /balances:** Filters available_balance > 0; currencies with zero balance are omitted (by design).
- **Indexer confirmDeposit:** UPDATE user_balances by (user_id, currency_id, account_type = 'funding') without chain_id; if unique constraint includes chain_id, conflict handling depends on schema (INSERT may fail or use default chain_id — UNKNOWN).
- **Admin GET /users/:id/balances:** JOINs blockchains; if DB only has **chains** table, query may fail or schema mismatch — UNKNOWN.

---

**End of report.** No code changes; no suggestions. Next steps to be decided after review.
