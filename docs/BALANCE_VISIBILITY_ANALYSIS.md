# Balance visibility – system analysis (Spot + P2P exchange)

This document explains **why user balances were not showing** in the UI after removing “unified”, and lists **every issue** in the read path and related flows. The product is a **Binance-like exchange with Spot and P2P only**; account types are **funding**, **spot**, and **trading**. **user_balances** is the only balance source of truth.

---

## 1. High-level flow (where balances come from)

- **Frontend** (e.g. Assets → Funding, Overview, Withdraw) calls:
  - `GET /api/v1/wallet/balances/funding` – main funding wallet list
  - `GET /api/v1/wallet/balances/by-account` – funding + trading per token (used as fallback and on withdraw)
  - `GET /api/v1/wallet/balances/summary` – totals for assets overview
  - `GET /api/v1/wallet/balances` – raw balances (used by some flows)
  - `GET /api/v1/wallet/transfer/balances?from=...` – for internal transfer
  - `GET /api/v1/convert/balances?accountType=...` – for convert
- **Backend** balance reads go through:
  - **readUserBalances(userId, accountType)** – ensures a row per active currency, then SELECTs from **user_balances** (JOIN **currencies**).
  - **ensureUserBalanceRow(userId, currencyId, chainId, accountType)** – INSERT into **user_balances** with `ON CONFLICT … DO NOTHING`.
- **Database**: **user_balances** has unique key on `(user_id, currency_id, chain_id, account_type)` **after** migration; some DBs still have an **older** unique on `(user_id, currency_id)` only.

If any step in this chain fails (INSERT throws, or SELECT returns 0 rows and the code throws), the API returns **500** and the UI shows **no balances**.

---

## 2. Root cause #1 – INSERT fails due to old unique constraint (FIXED)

**What goes wrong**

- **Code** (`user-balance-helper.ts`) uses:
  - `ON CONFLICT (user_id, currency_id, chain_id, account_type) DO NOTHING`
- **Your DB** still has the constraint **`user_balances_user_id_currency_id_key`** (only **user_id + currency_id**).
- So when the app tries to **insert** a new row (e.g. for `funding` or `spot`), it can hit a **duplicate key** on that **2-column** unique even though the 4-column conflict target doesn’t match. The INSERT **throws**, so **ensureUserBalanceRow** throws and **readUserBalances** never runs the SELECT. The request returns **500** and the UI shows no balances.

**Why it happens**

- **full-schema.sql** defines `UNIQUE(user_id, currency_id, account_type)` (3 columns). The migration drops **`user_balances_user_id_currency_id_account_type_key`** and adds **`user_balances_user_currency_chain_account_key`** on `(user_id, currency_id, chain_id, account_type)`.
- If the DB was created from an older schema or another migration that added **`user_balances_user_id_currency_id_key`** (2 columns), that constraint was **never** dropped by the current migration, so the INSERT still fails.

**Fix applied**

- In **ensureUserBalanceRow**: catch PostgreSQL unique violation (**23505**) for constraint **`user_balances_user_id_currency_id_key`** and treat it as “row already exists” (return without throwing). The read path then proceeds and the SELECT can return existing rows.

---

## 3. Root cause #2 – CRITICAL throw when SELECT returns 0 rows (partially FIXED)

**What goes wrong**

- **readUserBalances** ensures one row per **active currency** for the given **accountType**, then SELECTs with `WHERE user_id = $1 AND account_type::text = $2`.
- If the DB has the **old 2-column unique**, there is **at most one row per (user_id, currency_id)**. So you might have rows only for **account_type = 'funding'**, and **none** for **spot** or **trading**.
- For **spot** or **trading**, the SELECT returns **0 rows**. The code then throws **CRITICAL** and the handler returns **500**.

**Where it breaks which UI**

- **GET /balances/funding** – Calls `readUserBalances(funding)` and `readUserBalances(spot)`. If **spot** throws (0 rows), the whole route 500s. **Fix applied**: catch spot failure and use `spotRows = []`.
- **GET /balances** – Uses `Promise.all([ funding, spot, trading ])`. If **spot** or **trading** throws → **500**. **Needs same resilience.**
- **GET /balances/by-account** – Same `Promise.all`; withdraw page and funding fallback use this. **Needs same resilience.**
- **GET /balances/summary** – Same `Promise.all`; assets overview uses this. **Needs same resilience.**
- **GET /transfer/balances?from=spot** or **from=trading** – Single `readUserBalances(userId, account)`. If that account has no rows → **500**. Acceptable to 500 if user really has no balance for that account, but with old schema “spot”/“trading” often have 0 rows so this can look broken.
- **POST /transfer** – Uses **readUserBalances(userId, fromAccount)** for balance check. If fromAccount is spot/trading and there are no rows → throws → **500**.

So: **funding**-only reads can be fixed by catching spot/trading and using `[]` where the product treats “no separate spot/trading row” as 0 balance for that bucket.

---

## 4. Root cause #3 – Currency list source (currencies vs tokens)

**What could go wrong**

- **readUserBalances** gets “active currencies” from **currencies** (`WHERE is_active = TRUE`), then ensures a **user_balances** row per currency and reads from **user_balances** JOIN **currencies**.
- If **currencies** is empty or has no active rows (e.g. you use **tokens** for listing tradeable assets and **currencies** was never backfilled), then:
  - **currencyIds** is empty → no ensures → SELECT returns **0 rows** → **CRITICAL** throw → **500** → no balances in UI.

**Design note**

- Migrations backfill **currencies** from **tokens**. So in a fully migrated DB, currencies and tokens are aligned. If the app is deployed without running migrations or with a different schema, **currencies** can be empty and this becomes the failure mode.

---

## 5. Other issues (no fix in this pass, but good to know)

**5.1 Convert GET /balances**

- **Route**: `GET /api/v1/convert/balances?accountType=...`
- **Issue**: Does **not** use **readUserBalances**. It runs a direct query on **user_balances** with `account_type = $2`. So it does **not** ensure rows first. If the user has no row for that account type (e.g. only funding in an old 2-column-unique DB), the result is **[]** and convert page shows no balances. Also the query uses **`ub.total_balance`**; in **full-schema** **user_balances** has no **total_balance** column (only available_balance, locked_balance, etc.). If your table doesn’t have that column, the query can fail with “column total_balance does not exist”.

**5.2 Chain_id consistency (read vs write)**

- **Read path**: **readUserBalances** ensures and reads with **chain_id = CHAIN_ID_GLOBAL ('')**. The SELECT does **not** filter by **chain_id**, so it returns all rows for (user_id, account_type) regardless of chain.
- **Write path**: Deposits/withdrawals/internal transfer sometimes use **token.chain_id** or **withdrawal.chain_id** when updating **user_balances** (so rows can exist with non-empty **chain_id**). For a “funding wallet” view you usually want to show **one** balance per currency (e.g. global); the current read path already aggregates by currency in the handler, so this is consistent as long as you don’t add a **chain_id** filter to the read without aligning it with how you write.

**5.3 Admin user balances**

- Admin **GET /admin/users/:id/balances** queries **user_balances** directly (no **readUserBalances**), with no **account_type** filter. So it shows all rows for that user. No change needed for visibility; it will show balances if any rows exist.

---

## 6. Summary table

| # | Issue | Where | Why balances don’t show | Status |
|---|--------|------|--------------------------|--------|
| 1 | INSERT hits old 2-col unique `user_balances_user_id_currency_id_key` | ensureUserBalanceRow | INSERT throws → read path never runs → 500 | **Fixed** (catch 23505 + constraint name) |
| 2 | readUserBalances throws CRITICAL when SELECT returns 0 rows for spot/trading | GET /balances/funding | Promise.all or sequential spot read throws → 500 | **Fixed** (catch spot; use []) |
| 3 | No rows for spot/trading when DB has only (user_id, currency_id) unique | GET /balances, /by-account, /summary | Same as #2 for other routes | **Fixed** (catch spot/trading and use [] on all three routes) |
| 4 | Active currency list from **currencies** empty | readUserBalances | 0 ensures → 0 rows → CRITICAL → 500 | Documented; ensure migrations/backfill |
| 5 | Convert balances: no ensure, wrong column | GET /convert/balances | Empty list or query error if total_balance missing | **Fixed** (use readUserBalances; compute total_balance from available+locked) |
| 6 | Transfer balances/trading 500 on 0 rows | GET /transfer/balances, GET /balances/trading | readUserBalances throws → 500 | **Fixed** (catch and return []) |
| 7 | POST /transfer 500 when account has no rows | POST /transfer | readUserBalances throws → 500 | **Fixed** (catch and return 400 NO_BALANCE_FOR_ACCOUNT) |

---

## 7. What to do next

1. **Done**: ensureUserBalanceRow handles old constraint; GET /balances/funding tolerates spot failure.
2. **Done**: Same “catch spot/trading and use []” applied to GET /balances, GET /balances/by-account, GET /balances/summary.
3. **Done**: Convert GET /balances uses **readUserBalances** and correct columns (available_balance + locked_balance; no total_balance column).
4. **Done**: GET /transfer/balances and GET /balances/trading tolerate 0 rows. POST /transfer returns 400 when source account has no rows.
5. **Migration**: The migration now drops **user_balances_user_id_currency_id_key** if present. Run migrations so the DB has the 4-column unique.

After these fixes, user balances should show on Funding, Overview, Withdraw, Convert, and Transfer without changing the frontend.
