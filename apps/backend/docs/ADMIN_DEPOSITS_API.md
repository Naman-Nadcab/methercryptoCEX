# Admin Deposits API

API contract for listing and filtering deposits in the admin panel. Deposits are created by the indexer; user balances are credited after confirmations. This API lets admins view all deposits and see which have been credited to `user_balances`.

---

## Authentication

All admin deposit endpoints require admin authentication (session or API key). Unauthorized requests receive `401 Unauthorized`.

---

## GET /admin/deposits

List deposits with optional filters and pagination.

### Request

- **Method:** `GET`
- **Path:** `/admin/deposits`
- **Query parameters:**

| Parameter   | Type   | Required | Description |
|------------|--------|----------|-------------|
| `page`     | number | No       | Page number (default: `1`) |
| `limit`    | number | No       | Items per page (default: `20`, max: `100`) |
| `user`     | string | No       | Filter by user: UUID (exact) or email/username substring (case-insensitive) |
| `chain`    | string | No       | Filter by blockchain ID (UUID) |
| `token`    | string | No       | Filter by currency ID (UUID) |
| `status`   | string | No       | One of: `pending`, `confirming`, `completed`, `failed`. Omit or `all` for no filter |
| `date_from`| string | No       | ISO timestamp; deposits with `created_at >= date_from` |
| `date_to`  | string | No       | ISO timestamp; deposits with `created_at <= date_to` |

### Response (200 OK)

```json
{
  "success": true,
  "data": {
    "stats": {
      "total": "string (count)",
      "pending": "string (count)",
      "confirming": "string (count)",
      "completed": "string (count)",
      "failed": "string (count)",
      "flagged": "string (count)"
    },
    "deposits": [
      {
        "deposit_id": "uuid",
        "user_id": "uuid",
        "user_email": "string",
        "chain_id": "uuid",
        "chain_name": "string",
        "chain_symbol": "string",
        "token_id": "uuid",
        "token_symbol": "string",
        "token_name": "string",
        "amount": "string (numeric)",
        "tx_hash": "string | null",
        "from_address": "string | null",
        "to_address": "string | null",
        "confirmations": "number",
        "required_confirmations": "number",
        "status": "pending | confirming | completed | failed",
        "credited": true | false,
        "credited_at": "ISO timestamp | null",
        "block_number": "string | null",
        "block_timestamp": "string | null",
        "created_at": "ISO timestamp",
        "updated_at": "ISO timestamp",
        "is_flagged": true | false
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 100,
      "totalPages": 5
    }
  }
}
```

### Field semantics

- **`status`**: Indexer/chain state — `pending` (not yet seen), `confirming` (seen, not enough confirmations), `completed` (enough confirmations), `failed` (e.g. reorg).
- **`credited`**: `true` when this deposit has been applied to the user’s balance (i.e. `credited_at` is set). Use this in the UI to highlight “already credited” deposits.
- **`credited_at`**: When the deposit was credited to `user_balances`; `null` if not yet credited.
- **`stats`**: Global (unfiltered) counts for badges/summary; `deposits` and `pagination` respect filters.

### Errors

| Status | Body | When |
|--------|------|------|
| 401    | `{ "success": false, "error": { "code": "UNAUTHORIZED", ... } }` | Not authenticated as admin |
| 500    | `{ "success": false, "error": { "code": "FETCH_FAILED", "message": "Failed to fetch deposits" } }` | Server/DB error |

---

## Admin UI: How to render deposits and highlight credited ones

### 1. Page structure

- **Summary bar:** Use `data.stats` to show total, pending, confirming, completed, failed, and flagged counts (e.g. small badges or summary cards). These are global counts, not filtered.
- **Filters:** Form or query params for `user`, `chain`, `token`, `status`, `date_from`, `date_to`. Submit as GET query params to the same `GET /admin/deposits` endpoint.
- **Table:** One row per item in `data.deposits`.
- **Pagination:** Use `data.pagination` (`page`, `limit`, `total`, `totalPages`) for page controls and “Page X of Y” / “Showing X–Y of Z”.

### 2. Table columns (suggested)

| Column              | Source           | Notes |
|---------------------|------------------|--------|
| Credited            | `credited`       | Badge or icon when `true`; see below |
| Status              | `status`         | Badge color: pending (gray), confirming (yellow), completed (green), failed (red) |
| Date                | `created_at`     | Format in user’s locale |
| User                | `user_email`     | Optional: link to user detail |
| Chain               | `chain_name` or `chain_symbol` | |
| Token               | `token_symbol`   | |
| Amount              | `amount`         | Format with token decimals if available |
| Confirmations       | `confirmations` / `required_confirmations` | e.g. “12 / 12” |
| Tx hash             | `tx_hash`        | Link to block explorer; truncate with copy |
| Credited at         | `credited_at`    | Only relevant when `credited === true` |
| Flagged             | `is_flagged`     | Show icon or badge if `true` |

### 3. Highlighting “already credited” deposits

- **Primary signal:** Use the **`credited`** boolean. When `credited === true`, the deposit has already been applied to `user_balances`.
- **Ways to highlight:**
  - **Row style:** Light background (e.g. subtle green or neutral “processed” tint) for rows with `credited === true`; no tint for not-yet-credited.
  - **Badge:** “Credited” badge or checkmark icon in a dedicated “Credited” column when `credited === true`.
  - **Secondary:** Show `credited_at` in a “Credited at” column so admins can see when it was applied.
- **Recommended:** Combine (1) a clear “Credited” badge/icon and (2) optional row background so credited deposits are easy to scan. Non-credited deposits (pending/confirming or completed but not yet credited) should look visually distinct so support can quickly see what has already hit user balances.

### 4. Filters and pagination

- **user:** Free-text; backend treats UUID as exact match, otherwise substring on email/username (case-insensitive).
- **chain / token:** Typically dropdowns populated from chains and currencies APIs; value = UUID.
- **status:** Dropdown: All, Pending, Confirming, Completed, Failed.
- **date_from / date_to:** Date or datetime picker; send ISO strings.
- **Pagination:** `page` and `limit` as query params; update URL or state so refreshing keeps the same view.

### 5. Error and empty states

- On **401**: Redirect to admin login.
- On **500**: Show “Failed to fetch deposits” (or `error.message`) and retry option.
- When `data.deposits.length === 0`: Show “No deposits match your filters” and suggest clearing filters.

This structure gives a clear, filterable list of deposits and makes it obvious which deposits are already credited to user balances.
