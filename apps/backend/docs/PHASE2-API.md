# Phase 2 — UX & Ledger API (read-only)

All new endpoints are **read-only**; no changes to deposit, withdrawal, or balance logic.

## Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/wallet/ledger` | Unified ledger (deposits, withdrawals, conversions) |
| GET | `/api/v1/wallet/fund-history` | Combined deposit + withdrawal history (Funds tab) |
| GET | `/api/v1/wallet/internal-transfers` | Internal transfers only (funding ↔ trading) |
| GET | `/api/v1/user/risk-status` | KYC, withdrawal limits used, cooldowns, risk flags |

---

## 1. GET /api/v1/wallet/ledger

**Query:** `page`, `limit`, `asset`, `type`, `from`, `to`  
**Auth:** required

**Example response:**

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "type": "deposit",
      "asset": "USDT",
      "amount": "100.5",
      "fee": "0",
      "direction": "in",
      "status": "completed",
      "displayStatus": "Completed",
      "reference_id": "uuid",
      "created_at": "2025-02-10T12:00:00.000Z"
    },
    {
      "id": "uuid",
      "type": "withdrawal",
      "asset": "ETH",
      "amount": "0.5",
      "fee": "0.001",
      "direction": "out",
      "status": "processing",
      "displayStatus": "Processing",
      "reference_id": "uuid",
      "created_at": "2025-02-10T11:00:00.000Z"
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 42, "totalPages": 3 }
}
```

**Types:** `deposit` | `withdrawal` | `internal_transfer` | `convert`  
**Direction:** `in` | `out`

---

## 2. GET /api/v1/wallet/fund-history

**Query:** `page`, `limit`, `kind` (`all` | `deposits` | `withdrawals`)  
**Auth:** required

**Example response:**

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "kind": "deposit",
      "amount": "100",
      "fee": "0",
      "asset": "USDT",
      "status": "completed",
      "displayStatus": "Completed",
      "created_at": "2025-02-10T12:00:00.000Z"
    },
    {
      "id": "uuid",
      "kind": "withdrawal",
      "amount": "50",
      "fee": "0.5",
      "asset": "USDT",
      "status": "completed",
      "displayStatus": "Completed",
      "tx_hash": "0x...",
      "to_address": "0x...",
      "created_at": "2025-02-10T11:00:00.000Z"
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 10, "totalPages": 1 }
}
```

---

## 3. GET /api/v1/user/risk-status

**Auth:** required

**Example response:**

```json
{
  "success": true,
  "data": {
    "kyc_level": 1,
    "kyc_status": "approved",
    "withdrawal_limits": {
      "daily": 1000000,
      "monthly": 10000000,
      "used_today": 5000,
      "used_month": 25000
    },
    "active_cooldowns": [
      {
        "type": "withdrawal",
        "reason": "Password changed",
        "cooldown_until": "2025-02-12T12:00:00.000Z"
      }
    ],
    "risk_flags": []
  }
}
```

---

## 4. GET /api/v1/wallet/internal-transfers

**Query:** `page`, `limit`, `direction` (`funding_to_trading` | `trading_to_funding`)  
**Auth:** required

**Example response:**

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "amount": "100",
      "fee": "0",
      "asset": "USDT",
      "status": "completed",
      "displayStatus": "Completed",
      "direction": "funding_to_trading",
      "account_type": "funding",
      "internal_recipient_email": null,
      "created_at": "2025-02-10T10:00:00.000Z"
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
}
```

---

## 5. Error code map (frontend)

Backend continues to return the same error codes. Frontend should map them via `apps/frontend/src/lib/errorMessages.ts` so users never see raw codes.

| Code | User message (example) |
|------|------------------------|
| RATE_LIMIT_EXCEEDED | Too many requests. Please try again in a few minutes. |
| KYC_REQUIRED | Identity verification is required to continue. |
| WITHDRAWAL_LIMIT_EXCEEDED | You have reached your withdrawal limit. Check your limits in Security settings. |
| COOLDOWN_ACTIVE | This action is temporarily unavailable due to a recent security change. |
| INSUFFICIENT_BALANCE | Insufficient balance to complete this action. |
| INVALID_2FA | Invalid two-factor code. Please try again. |
| FUND_PASSWORD_REQUIRED | Fund password is required for this action. |

Use `getMessageFromApiError(response.error)` when displaying API errors.

---

## 6. UX polish

- All new responses that have a status include a **displayStatus** (Pending / Processing / Completed / Failed / Rejected / Cancelled).
- **Fees** are included on ledger, fund-history, and internal-transfers.
- For blocked actions, existing withdrawal/deposit APIs already return **rejection_reason** / **failed_reason**; show that instead of raw codes.
- **ETA**: include only if the backend provides it (no new ETA fields added in Phase 2).

No new SQL views or indexes were required; existing indexes on `deposits`, `withdrawals`, and `conversions` are used.
