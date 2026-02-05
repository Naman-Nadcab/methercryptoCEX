# Admin User Balances API

API for viewing a user’s actual balances (from `user_balances`). Used in the admin “User detail → Balances” flow and for reconciling deposits/withdrawals.

---

## Authentication

All endpoints require admin authentication. Unauthorized requests receive `401 Unauthorized`.

---

## GET /admin/users/:id/balances

Return balances for one user. Data comes from `user_balances` joined with `currencies` and `blockchains` (chain is derived from the token’s `blockchain_id`).

### Request

- **Method:** `GET`
- **Path:** `/admin/users/:id/balances`
- **Params:** `id` — user UUID.

### Response (200 OK)

```json
{
  "success": true,
  "data": {
    "user_id": "uuid",
    "balances": [
      {
        "token_id": "uuid",
        "token_symbol": "string",
        "token_name": "string",
        "chain_id": "uuid | null",
        "chain_name": "string | null",
        "available_balance": "string (numeric)",
        "locked_balance": "string (numeric)",
        "total_balance": "string (numeric, available + locked)",
        "updated_at": "ISO timestamp string"
      }
    ]
  }
}
```

- **Zero balances:** If the user has no rows in `user_balances`, `balances` is `[]`. No 404; the user exists but has no balances.
- **Ordering:** Balances are ordered by total balance (desc), then by token symbol. Zero balances still appear if a row exists.

### Errors

| Status | When |
|--------|------|
| 401 | Not authenticated as admin |
| 404 | User not found (invalid or deleted user `id`) |
| 500 | `FETCH_FAILED` — server/DB error |

---

## Admin UI: Table layout and navigation

### Navigation flow

1. **Users list** — Admin goes to the existing “Users” (or “User management”) screen (e.g. `GET /admin/users`).
2. **Click user** — Open that user’s detail page (e.g. `/admin/users/[id]` or `/admin/users/:id`).
3. **Balances tab** — On the user detail page, show a “Balances” tab (or “Balance” section). When selected, call `GET /admin/users/:id/balances` and render the table below.

So: **Users list → click user → User detail → Balances tab.**

### Suggested table layout

| Column | Source | Notes |
|--------|--------|------|
| Token | `token_symbol` (+ `token_name` tooltip or subtitle) | e.g. USDT, ETH |
| Chain | `chain_name` or “—” if `chain_id` is null | e.g. Ethereum, BSC |
| Available | `available_balance` | Formatted with token decimals if available |
| Locked | `locked_balance` | Same formatting |
| Total | `total_balance` | available + locked |
| Updated | `updated_at` | Formatted date/time |

Optional: add **Token name** column from `token_name`, or show it on hover. Optional: link token/chain to admin currency/blockchain settings using `token_id` / `chain_id`.

### Empty state

- When `data.balances.length === 0`: show a single message like “No balances yet” or “This user has no balance rows.” No table needed.
- When loading or 404/500: show loading spinner or error message and retry if appropriate.

---

## Reconciling deposits and withdrawals

This view helps admins reconcile on-chain and internal state:

1. **Deposits → Balances**  
   - **Admin Deposits** lists deposits and marks which are **credited** (already applied to `user_balances`).  
   - **User Balances** shows the current **actual** balances for that user.  
   - Check: for a given user, sum of credited deposits (per token/chain) should be consistent with balance increases over time. User Balances is the source of truth for “what the user has now.”

2. **Withdrawals → Balances**  
   - Withdrawals decrease the user’s balance when processed.  
   - User Balances shows **available** and **locked** (e.g. locked for pending withdrawals).  
   - Check: after a withdrawal is completed, the user’s balance for that token should reflect the deduction.

3. **Practical reconciliation**  
   - From **Admin Deposits**: filter by user, see credited deposits (and optionally date range).  
   - From **User Balances**: see current `available_balance` and `locked_balance` per token/chain.  
   - Compare: “Credited deposits minus completed withdrawals (and other debits)” should align with current balances. Discrepancies can be investigated (missing credit, duplicate credit, failed withdrawal, etc.).

Keeping **Deposits** (with credited flag) and **User Balances** in the same admin flow (Users → User → Deposits + Balances) makes this reconciliation straightforward.
