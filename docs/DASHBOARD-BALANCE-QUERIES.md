# Dashboard balance read queries (STEP 2 — verification)

All dashboard balance reads use **only** `user_balances`. No fallback to `balances` table.

**Canonical account type:** `DEFAULT_ACCOUNT_TYPE = 'funding'` (schema enum: `funding` | `trading` | `unified`).  
**user_balances** has no `chain_id` column; unique key is `(user_id, currency_id, account_type)`.

---

## 1. GET `/api/v1/wallet/balances/summary` (Assets overview)

**Purpose:** Funding total + trading total for dashboard overview.

**Funding total:**
```sql
SELECT COALESCE(SUM(COALESCE(ub.available_balance, 0) + COALESCE(ub.locked_balance, 0)), 0)::text as total
FROM user_balances ub
WHERE ub.user_id = $1 AND COALESCE(ub.account_type::text, 'funding') = 'funding'
```
- **Filters:** `user_id`, `account_type = 'funding'`.
- **No** `chain_id` filter.

**Trading total:**
```sql
SELECT COALESCE(SUM(COALESCE(ub.available_balance, 0) + COALESCE(ub.locked_balance, 0)), 0)::text as total
FROM user_balances ub
WHERE ub.user_id = $1 AND COALESCE(ub.account_type::text, 'funding') IN ('trading', 'unified')
```
- **Filters:** `user_id`, `account_type IN ('trading','unified')`.

**If balance shows 0:** Ensure rows exist with `account_type = 'funding'` (deposits/credits use this). No silent WHERE excludes rows other than account_type.

---

## 2. GET `/api/v1/wallet/balances/by-account` (By-account breakdown)

**Purpose:** Per-currency funding/trading/total for withdraw and funding UI.

```sql
SELECT
  c.symbol,
  REGEXP_REPLACE(COALESCE(c.name, c.symbol), ...) as token_name,
  COALESCE(ub.account_type::text, 'funding') as account_type,
  (COALESCE(ub.available_balance, 0) + COALESCE(ub.locked_balance, 0))::text as balance
FROM user_balances ub
JOIN currencies c ON c.id = ub.currency_id
WHERE ub.user_id = $1 AND (COALESCE(ub.available_balance, 0) > 0 OR COALESCE(ub.locked_balance, 0) > 0)
ORDER BY c.symbol, ub.account_type
```
- **Filters:** `user_id` only. No account_type filter in WHERE (all account types included).
- **Sum:** Per row = `available_balance + locked_balance`. Grouped by symbol and account_type in app code.

---

## 3. GET `/api/v1/wallet/balances/funding` (Funding account page)

**Purpose:** List of funding balances (symbol, available, locked, total).

```sql
SELECT DISTINCT ON (UPPER(c.symbol))
  c.id as token_id, c.symbol, ... name,
  ub.available_balance::text, ub.locked_balance::text,
  (COALESCE(ub.available_balance, 0) + COALESCE(ub.locked_balance, 0))::text as total_balance
FROM user_balances ub
JOIN currencies c ON c.id = ub.currency_id
WHERE ub.user_id = $1
  AND COALESCE(ub.account_type::text, 'funding') = 'funding'
  AND (COALESCE(ub.available_balance, 0) > 0 OR COALESCE(ub.locked_balance, 0) > 0 OR COALESCE(ub.pending_balance, 0) > 0)
  AND COALESCE(c.is_active, TRUE) = TRUE
ORDER BY UPPER(c.symbol), ...
```
- **Filters:** `user_id`, `account_type = 'funding'`.
- **Sum:** `available_balance + locked_balance` as total_balance.

---

## 4. GET `/api/v1/wallet/balances/trading` (Unified / Trading page)

**Purpose:** Trading account balances for unified view.

```sql
SELECT c.id as token_id, c.symbol, ... name,
  (COALESCE(ub.available_balance, 0) + COALESCE(ub.locked_balance, 0))::text as equity
FROM user_balances ub
JOIN currencies c ON c.id = ub.currency_id
WHERE ub.user_id = $1 AND COALESCE(ub.account_type::text, 'funding') IN ('trading', 'unified')
  AND (COALESCE(ub.available_balance, 0) > 0 OR COALESCE(ub.locked_balance, 0) > 0)
  AND COALESCE(c.is_active, TRUE) = TRUE
ORDER BY ...
```
- **Filters:** `user_id`, `account_type IN ('trading','unified')`.

---

## 5. GET `/api/v1/wallet/transfer/balances` (Internal transfer)

**Purpose:** Currencies with balance for transfer UI.

```sql
SELECT c.id as token_id, c.symbol, ... name, c.decimals, b.id as chain_id, b.chain_name,
  (COALESCE(ub.available_balance, 0) + COALESCE(ub.locked_balance, 0))::text as available_balance
FROM user_balances ub
JOIN currencies c ON c.id = ub.currency_id
LEFT JOIN blockchains b ON c.blockchain_id = b.id
WHERE ub.user_id = $1
  AND (COALESCE(ub.available_balance, 0) > 0 OR COALESCE(ub.locked_balance, 0) > 0)
  AND COALESCE(c.is_active, TRUE) = TRUE
```
- **Filters:** `user_id` only. No account_type filter (all balances for transfer).
- **Sum:** `available_balance + locked_balance`.

---

## 6. GET `/api/v1/wallet/balance-debug` (Data truth check)

**Purpose:** Resolve user by email, return full `user_balances` rows and dashboard summary.

- **Query param:** `?email=nmnsingh02@gmail.com` (must be current user’s email).
- **Returns:** `user_id`, `user_balances_rows` (full), `user_balances_row_count`, `dashboard_summary` (funding_total, trading_total, total), `reason_if_zero`.
- **If ZERO rows:** `reason_if_zero` = "BUG: ZERO rows in user_balances for this user".
- **If rows exist but total 0:** `reason_if_zero` = "Rows exist but SUM(available_balance + locked_balance) is 0... Check account_type matches (canonical: funding)."

---

## Checklist

- [x] All reads only from `user_balances` (no fallback to `balances`).
- [x] All totals use `SUM(available_balance + locked_balance)` (or per-row sum).
- [x] `account_type` filter: summary/funding use `'funding'`; trading uses `'trading'|'unified'`; by-account and transfer include all types.
- [x] No `chain_id` in WHERE (table has no chain_id).
- [x] Canonical type for main wallet = `funding` (`DEFAULT_ACCOUNT_TYPE`).
