# Internal transfer (transfer to user)

**Internal transfer** lets a user send balance to another user by email, user ID, or phone (no on-chain tx).

---

## Backend

- **Endpoint:** `POST /api/v1/wallet/withdrawals` with body:
  - `type: 'internal'`
  - `internal_user_identifier`: email, user ID, or phone of the recipient
  - `symbol`, `amount`
  - Optional: `twoFactorCode`, `fund_password` (when user has 2FA or fund password enabled)
  - **Idempotency-Key** header required
- **Flow:** Resolve recipient by identifier → validate balance → debit sender / credit recipient in one transaction → create `withdrawals` row with `type = 'internal'` and `internal_user_id`; record in `internal_transfers` and AML.

---

## Frontend

- **Withdraw page:** The withdraw flow already supports “Internal transfer”: user can choose “Transfer to another user” and enter email/ID/phone. See `apps/frontend/src/app/dashboard/withdraw/crypto/page.tsx` (e.g. `internal_user_identifier`).
- **Transfer page:** The main “Transfer” dashboard page is for **funding ↔ trading** (same user). For “transfer to another user”, use **Withdraw → Internal transfer** (or add a dedicated “Transfer to user” tab/link from Transfer page that points to the same flow).

---

## Summary

- Backend and withdraw UI already support internal transfer. No extra backend work required.
- Optional: add a clear “Transfer to user” entry on the Transfer page (link or tab) that opens the internal-withdraw flow or a dedicated sub-page.
