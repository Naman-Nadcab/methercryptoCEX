# Balance & Deposit Rules (Single Source of Truth)

**Important:** All balance display and deposit crediting must follow this flow so user balance always shows correctly in both User and Admin panels.

---

## 1. Balance storage: only `user_balances`

- **Single source of truth:** `user_balances` table only. No other table (e.g. legacy `balances`) must be used for reading or writing user balance.
- **Key columns:** `user_id`, `currency_id`, `chain_id`, `account_type` (e.g. `funding`, `spot`, `trading`). Use `chain_id = ''` for global/funding balance.
- **Unique constraint:** `(user_id, currency_id, chain_id, account_type)`.

---

## 2. Balance read: only `readUserBalances`

- **Canonical read:** Use `readUserBalances(userId, accountType)` from `services/balance/readUserBalances.ts` for any user balance display.
- **Do not:** Query `user_balances` directly for balance display; do not sum raw amounts without converting to USD (use market price per currency).
- **APIs that must use this:**  
  `GET /balances`, `GET /balances/summary`, `GET /balances/funding`, `GET /balances/trading`, `GET /balances/by-account`, and any admin balance views that show user balance.
- **Summary total:** When computing "total USD", convert each currency balance to USD (via `market_prices` or fallback 1 for stablecoins) then sum. Never sum raw token amounts as if they were USD.

---

## 3. Deposit flow: one place to credit, same history for User & Admin

### 3.1 Deposit record

- Every on-chain deposit is stored in **`deposits`** with: `user_id`, `currency_id`, `amount`, `status`, `credited_at`, `balance_applied_at`.
- **User panel** deposit history: `GET /api/v1/wallet/deposit-history` → reads from `deposits` for that user.
- **Admin panel** deposit list: `GET /api/v1/admin/deposits` → reads from same `deposits` table (with filters). Same data, same source.

### 3.2 Crediting balance (who writes to `user_balances`)

- **Primary:** Indexer (`ConfirmationTracker`) when confirmations reach required count:
  1. Update `deposits`: `status = 'completed'`, `credited_at = NOW()`.
  2. Ensure a `user_balances` row exists for `(user_id, currency_id, '', 'funding')` (INSERT ... ON CONFLICT DO NOTHING if needed).
  3. UPDATE `user_balances` SET `available_balance = available_balance + amount`, etc. for that row.
  4. Set `deposits.balance_applied_at = NOW()` only after a successful credit (so repair can retry if something failed).
- **Fallback:** Backend repair when user hits `GET /balances/funding` or `GET /deposit-history`: for deposits with `status = 'completed'`, `credited_at IS NOT NULL`, `balance_applied_at IS NULL`, credit `user_balances` (ensure row then UPDATE) and set `balance_applied_at`. Only set `balance_applied_at` when the UPDATE affected at least one row.

### 3.3 Rules for new code

- Any new “deposit confirmed” or “credit user” logic must:
  - Write only to `user_balances` (funding account, `chain_id = ''`).
  - Use `currency_id` that exists in `currencies`.
  - Set `deposits.balance_applied_at` only after the credit UPDATE has actually run (e.g. rowCount >= 1).
- Do not add another table or API that stores “balance” separately; do not read balance from anywhere other than `user_balances` via `readUserBalances` (or the same SQL pattern) for display.

---

## 4. Quick checklist for new features

- [ ] Balance **read** goes through `readUserBalances` (or same pattern: read from `user_balances` only).
- [ ] Total USD is computed by converting each currency to USD then summing (not raw sum).
- [ ] Deposit **history** (user and admin) reads from `deposits` only.
- [ ] Deposit **credit** updates `user_balances` and sets `balance_applied_at` only when the credit succeeded.
- [ ] No use of legacy `balances` table.

Following these rules avoids “deposit history shows but balance is zero” and keeps User and Admin panels in sync.

---

## 5. Real funds only – no dummy/seed

- **Displayed balance must equal real movements only:** deposits (credited) + internal transfers (in) − internal transfers (out) − withdrawals (completed). No test/seed/dummy balances in production.
- **Do not run in production:** Scripts that insert fake `user_balances` (e.g. `setup-withdrawals.ts` test balances, full-schema seed). Use `scripts/clear-seed-balances.js` to remove seed user_balances for known seed users. Use `scripts/cleanup-dummy-financial-data.js` to wipe dummy financial data while keeping one protected user.
- **Verification:** Run `npx tsx scripts/verify-real-balance.ts [email]` to check that each user's funding balance matches expected from deposit history + internal transfers − withdrawals. Use this to ensure no dummy fund is present and that data is consistent for all users.

---

## 6. Internal transfer history (Binance-style)

- **Every internal transfer must create history.** The `internal_transfers` row is inserted in the **same database transaction** as the withdrawal record and balance debit/credit. If the history insert fails, the whole transfer is rolled back (no balance update without history).
- **Where history appears (user panel):**
  - **Dashboard → Assets → History** (sidebar: "History" under Funding/Convert).
  - **"All" tab:** All transactions (deposits, withdrawals, internal transfers). Internal transfers show as **"Sent to &lt;email&gt;"** (sender) or **"Received from &lt;email&gt;"** (receiver).
  - **"Transfer" tab:** Only internal transfers. Same labels: **"Sent to &lt;email&gt;"** / **"Received from &lt;email&gt;"**.
  - **"Withdraw" tab:** On-chain withdrawals and internal transfers; internal ones show as **"Internal transfer to &lt;email&gt;"**.
- **APIs:** `GET /api/v1/wallet/transfer/history` (Transfer tab), `GET /api/v1/wallet/transactions/all` (All tab). Both use `internal_transfers` with `from_user_id` / `to_user_id` and join `users` for sender/recipient email.
