# Withdrawal lifecycle audit logs

Structured audit events for the withdrawal lifecycle are stored in the **`audit_logs`** table. Private keys and secrets are never logged.

## DB schema (audit_logs)

Base table (existing):

- `id` UUID PRIMARY KEY
- `user_id` UUID (references users)
- `action` VARCHAR(50) NOT NULL
- `resource_type` VARCHAR(50)
- `resource_id` UUID
- `ip_address` INET (nullable for system events)
- `user_agent` TEXT
- `details` JSONB
- `created_at` TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP

**Withdrawal-lifecycle columns** (added by migration):

- `withdrawal_id` UUID
- `admin_id` UUID
- `token_id` UUID
- `chain_id` VARCHAR(50)
- `amount` NUMERIC(36,18)

Index: `idx_audit_logs_withdrawal_id` on `(withdrawal_id)` WHERE `withdrawal_id IS NOT NULL`.

## Events

| Event                 | Meaning |
|-----------------------|--------|
| `withdrawal_created`  | User requested a withdrawal (record created, balance locked). |
| `withdrawal_approved` | Admin approved a pending_approval withdrawal. |
| `withdrawal_rejected` | Admin rejected a pending_approval withdrawal. |
| `withdrawal_signed`   | Withdrawal was signed and broadcast (queue processor). |
| `hot_wallet_sweep`    | Hot wallet sweep completed (excess balance sent to cold). |

Each row includes, when applicable: `withdrawal_id`, `user_id`, `admin_id`, `token_id`, `chain_id`, `amount`, `ip_address`, `user_agent`, `created_at`.

## Service-level API

**File:** `apps/backend/src/lib/withdrawal-audit.ts`

- **`logWithdrawalLifecycle(event, payload)`**  
  Inserts one row into `audit_logs` with the given event and payload.  
  Payload: `withdrawal_id`, `user_id`, `admin_id`, `token_id`, `chain_id`, `amount`, `ip`, `user_agent` (all optional/nullable as appropriate).  
  No private keys or secrets are ever passed or stored.

## Where each event is written

| Event                 | File | Location |
|-----------------------|------|----------|
| **withdrawal_created** | `apps/backend/src/routes/wallet.fastify.ts` | After creating the withdrawal and locking balance; uses `request.ip` and `request.headers['user-agent']`. |
| **withdrawal_approved** | `apps/backend/src/services/withdrawal-approval.service.ts` | Inside `approveWithdrawal()`, after updating status to `pending`; `ip`/`user_agent` from optional `auditContext` passed by the admin route. |
| **withdrawal_rejected** | `apps/backend/src/services/withdrawal-approval.service.ts` | Inside `rejectWithdrawal()`, after updating status to `failed`; `ip`/`user_agent` from optional `auditContext` passed by the admin route. |
| **withdrawal_signed** | `apps/backend/src/services/withdrawal-signing.service.ts` | In `processSigningQueue()`, after marking the withdrawal and queue as completed; `ip`/`user_agent` are null (system). |
| **hot_wallet_sweep** | `apps/backend/src/services/hot-wallet-sweep.service.ts` | In `sweepOneChain()`, after a successful sweep; `withdrawal_id`/`user_id`/`admin_id`/`token_id` are null, `chain_id` and `amount` (sweep amount) set. |

Admin route (`apps/backend/src/routes/admin.fastify.ts`) passes `{ ip: request.ip, userAgent: request.headers['user-agent'] }` into `approveWithdrawal` and `rejectWithdrawal` so approved/rejected events include request context.

## Running migrations

From `apps/backend`:

```bash
npm run migrate
```

This adds the new columns and index to `audit_logs` and makes `ip_address` nullable for system-generated events.
