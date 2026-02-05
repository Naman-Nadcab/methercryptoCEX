# Admin Withdrawal Approval API – Contract

Base path: **`/api/v1/admin`** (or your admin API prefix). All endpoints require **admin authentication** (session or Bearer). Withdrawal-approve/reject require **withdrawal_approver** or **super_admin** (or permission `withdrawals:approve` / `all`).

---

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| **GET** | `/admin/withdrawals` | List withdrawals with filters and pagination |
| **POST** | `/admin/withdrawals/:id/approve` | Approve a pending_approval withdrawal |
| **POST** | `/admin/withdrawals/:id/reject` | Reject a pending_approval withdrawal |

---

## 1. GET /admin/withdrawals

List withdrawals for the approval UI. Supports filters and pagination.

### Request

**Query parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `page` | number (query) | No | Page number, 1-based. Default: `1` |
| `limit` | number (query) | No | Page size (1–100). Default: `20` |
| `status` | string | No | Filter by status. See **Status filter** below |
| `chain_id` | string (UUID or chain id) | No | Filter by chain |
| `token_id` | string (UUID) | No | Filter by token |

**Status filter**

- `pending_approval` – Awaiting admin approval
- `pending` – Approved, queued for signing
- `processing` – In signing/broadcast
- `completed` – Successfully broadcast
- `failed` – Failed or rejected
- `cancelled` – Cancelled by user
- `all` – No status filter (default if omitted)

**Example**

```http
GET /admin/withdrawals?page=1&limit=20&status=pending_approval&chain_id=ethereum-mainnet
```

### Response (200 OK)

```json
{
  "success": true,
  "data": {
    "stats": {
      "total": "150",
      "pending_approval": "12",
      "pending": "3",
      "processing": "1",
      "completed": "120",
      "failed": "10",
      "cancelled": "4"
    },
    "withdrawals": [
      {
        "id": "uuid",
        "user_id": "uuid",
        "token_id": "uuid",
        "chain_id": "string",
        "amount": "1.5",
        "fee": "0.001",
        "net_amount": "1.499",
        "to_address": "0x...",
        "memo": null,
        "status": "pending_approval",
        "account_type": "funding",
        "tx_hash": null,
        "completed_at": null,
        "failed_reason": null,
        "processed_at": null,
        "approved_by": null,
        "approved_at": null,
        "rejected_by": null,
        "rejected_at": null,
        "rejection_reason": null,
        "created_at": "2025-02-03T10:00:00.000Z",
        "updated_at": "2025-02-03T10:00:00.000Z",
        "email": "user@example.com",
        "username": "user1",
        "currency_symbol": "ETH",
        "token_name": "Ethereum",
        "chain_name": "Ethereum Mainnet"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 12,
      "totalPages": 1
    }
  }
}
```

**Schema summary**

- **stats** – Global counts (all withdrawals), for UI badges. All numeric fields are strings.
- **withdrawals** – Array of withdrawal rows with joined `email`, `username`, `currency_symbol`, `token_name`, `chain_name`. All decimal/numeric fields as strings.
- **pagination.total** – Count of rows matching the **current filters** (used for “total pages”).
- **pagination.totalPages** – `ceil(total / limit)`.

### Error responses

| Status | Code | When |
|--------|------|------|
| **401** | (auth) | Not authenticated or not admin |
| **500** | `FETCH_FAILED` | Server/database error |

**Error body (e.g. 500)**

```json
{
  "success": false,
  "error": {
    "code": "FETCH_FAILED",
    "message": "Failed to fetch withdrawals"
  }
}
```

---

## 2. POST /admin/withdrawals/:id/approve

Approve a withdrawal that is in `pending_approval`. Sets status to `pending` and enqueues it for signing. Only one of **withdrawal_approver** / **super_admin** (or permission) may call this.

### Request

**Path**

- `id` – Withdrawal UUID.

**Body**

- None required (optional `{}`).

**Example**

```http
POST /admin/withdrawals/550e8400-e29b-41d4-a716-446655440000/approve
Content-Type: application/json
```

### Response (200 OK)

```json
{
  "success": true,
  "data": {
    "approved": true,
    "withdrawalId": "550e8400-e29b-41d4-a716-446655440000"
  }
}
```

### Error responses

| Status | Code | When |
|--------|------|------|
| **400** | `INVALID_INPUT` | Missing or invalid path `id` |
| **400** | `INVALID_STATE` | Withdrawal is not `pending_approval` |
| **400** | `HOT_WALLET_CAP_EXCEEDED` | Enqueue failed due to hot wallet single-tx or daily cap |
| **401/403** | (auth) | Not authenticated or not allowed to approve |
| **404** | `NOT_FOUND` | Withdrawal not found |
| **500** | `APPROVE_FAILED` | Unexpected error during approve/enqueue |

**Example (400 – invalid state)**

```json
{
  "success": false,
  "error": {
    "code": "INVALID_STATE",
    "message": "Withdrawal is not pending approval (status: completed)"
  }
}
```

**Example (400 – cap exceeded)**

```json
{
  "success": false,
  "error": {
    "code": "HOT_WALLET_CAP_EXCEEDED",
    "message": "Daily outflow limit exceeded for this chain (used 95, limit 100)"
  }
}
```

**Example (404)**

```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Withdrawal not found"
  }
}
```

---

## 3. POST /admin/withdrawals/:id/reject

Reject a withdrawal that is in `pending_approval`. Sets status to `failed`, records rejector and reason, and releases locked balance.

### Request

**Path**

- `id` – Withdrawal UUID.

**Body**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `reason` | string | No | Rejection reason shown to user and in logs. Default: `"Rejected by admin"` |

**Example**

```http
POST /admin/withdrawals/550e8400-e29b-41d4-a716-446655440000/reject
Content-Type: application/json

{
  "reason": "KYC not verified for this amount"
}
```

### Response (200 OK)

```json
{
  "success": true,
  "data": {
    "rejected": true,
    "withdrawalId": "550e8400-e29b-41d4-a716-446655440000"
  }
}
```

### Error responses

| Status | Code | When |
|--------|------|------|
| **400** | `INVALID_INPUT` | Missing or invalid path `id` |
| **400** | `INVALID_STATE` | Withdrawal is not `pending_approval` |
| **401/403** | (auth) | Not authenticated or not allowed to reject |
| **404** | `NOT_FOUND` | Withdrawal not found |
| **500** | `RELEASE_FAILED` | Could not release locked balance (e.g. row not found / inconsistent state) |
| **500** | `REJECT_FAILED` | Unexpected error during reject |

**Example (500 – release failed)**

```json
{
  "success": false,
  "error": {
    "code": "RELEASE_FAILED",
    "message": "Could not release locked balance (row not found or insufficient locked balance)"
  }
}
```

---

## Pagination

- **page**: 1-based index.
- **limit**: Clamped to 1–100; typical default 20.
- **total**: Number of withdrawals matching the **current filters** (status, chain_id, token_id).
- **totalPages**: `ceil(total / limit)`.

Frontend can derive:

- `hasNextPage = page < totalPages`
- `hasPrevPage = page > 1`

---

## Filters (GET /admin/withdrawals)

| Filter | Query key | Type | Behaviour |
|--------|------------|------|-----------|
| **Status** | `status` | enum | One of: `pending_approval`, `pending`, `processing`, `completed`, `failed`, `cancelled`, `all`. Omit or `all` = no status filter. |
| **Chain** | `chain_id` | string | Exact match on `withdrawals.chain_id` (e.g. `ethereum-mainnet` or chain UUID). |
| **Token** | `token_id` | string | Exact match on `withdrawals.token_id` (token UUID). |

All filters are optional and combine with **AND**. Pagination is applied after filtering.

---

## Error response shape (all endpoints)

All error responses use:

```ts
{
  success: false,
  error: {
    code: string;   // machine-readable
    message: string; // human-readable
  }
}
```

Common codes used in this API:

- `INVALID_INPUT` – Bad or missing path/query/body.
- `INVALID_STATE` – Withdrawal not in the right status for the action.
- `NOT_FOUND` – Withdrawal id does not exist.
- `HOT_WALLET_CAP_EXCEEDED` – Approve rejected due to hot wallet caps.
- `RELEASE_FAILED` – Reject could not release balance.
- `FETCH_FAILED`, `APPROVE_FAILED`, `REJECT_FAILED` – Generic server/DB failure.

---

## Summary table

| Endpoint | Auth | Filters / Params | Pagination | Main errors |
|----------|------|------------------|------------|-------------|
| GET /admin/withdrawals | Admin | status, chain_id, token_id | page, limit, total, totalPages | 401, 500 FETCH_FAILED |
| POST .../approve | Withdrawal approver | path :id | – | 400 INVALID_STATE / HOT_WALLET_CAP_EXCEEDED, 404, 500 |
| POST .../reject | Withdrawal approver | path :id, body reason | – | 400 INVALID_STATE, 404, 500 RELEASE_FAILED / REJECT_FAILED |
