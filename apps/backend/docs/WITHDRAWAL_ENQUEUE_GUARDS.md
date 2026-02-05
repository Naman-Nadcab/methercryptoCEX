# Withdrawal enqueue/sign guards

Only withdrawals with **status = 'pending'** may be enqueued or signed. These guards make it impossible for `pending_approval` or `failed` withdrawals to be signed or broadcast.

## 1. Service-level guard: `enqueueWithdrawal()`

**File:** `apps/backend/src/services/withdrawal-signing.service.ts`

- Uses a **transaction** with `SELECT ... FOR UPDATE` on the withdrawal row.
- If `withdrawal.status !== 'pending'`, **throws** (no silent return).
- Insert into `withdrawal_signing_queue` uses **ON CONFLICT (idempotency_key) DO NOTHING** to prevent double enqueue.
- Constant `ENQUEUEABLE_STATUS = 'pending'` used for both enqueue and signing checks.

## 2. DB-level guard: trigger on `withdrawal_signing_queue`

**File:** `apps/backend/src/database/migrate.ts` (in the migrations array)

- **Function:** `check_withdrawal_pending_before_queue_insert()`
  - Before any INSERT into `withdrawal_signing_queue`, checks `withdrawals.status` for the given `withdrawal_id`.
  - If status is not `'pending'`, **RAISE EXCEPTION** and the insert is aborted.
- **Trigger:** `trg_withdrawal_queue_only_pending`
  - `BEFORE INSERT ON withdrawal_signing_queue FOR EACH ROW EXECUTE FUNCTION check_withdrawal_pending_before_queue_insert();`

Standalone SQL (same logic) is in:

**File:** `apps/backend/src/database/migrations/withdrawal-queue-only-pending-trigger.sql`

## 3. Signing guard: `processSigningQueue()`

**File:** `apps/backend/src/services/withdrawal-signing.service.ts`

- After loading the withdrawal row, checks `w.status === ENQUEUEABLE_STATUS`.
- If not, calls `markQueueFailed(queueId, ...)` and returns without signing or broadcasting.

## Migration SQL (trigger only)

```sql
CREATE OR REPLACE FUNCTION check_withdrawal_pending_before_queue_insert()
RETURNS TRIGGER AS $$
DECLARE
  w_status TEXT;
BEGIN
  SELECT status INTO w_status FROM withdrawals WHERE id = NEW.withdrawal_id;
  IF w_status IS NULL THEN
    RAISE EXCEPTION 'withdrawal_signing_queue: withdrawal_id % not found in withdrawals', NEW.withdrawal_id;
  END IF;
  IF w_status != 'pending' THEN
    RAISE EXCEPTION 'withdrawal_signing_queue: only withdrawals with status pending can be enqueued; withdrawal % has status %', NEW.withdrawal_id, w_status;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_withdrawal_queue_only_pending ON withdrawal_signing_queue;

CREATE TRIGGER trg_withdrawal_queue_only_pending
BEFORE INSERT ON withdrawal_signing_queue
FOR EACH ROW
EXECUTE FUNCTION check_withdrawal_pending_before_queue_insert();
```

On PostgreSQL 10 or earlier, use `EXECUTE PROCEDURE` instead of `EXECUTE FUNCTION`.

## How to run migrations

From the **backend app root** (`apps/backend`):

```bash
# Apply all migrations (includes the trigger)
npm run migrate
```

To apply **only** the trigger (e.g. if you already ran migrations earlier):

```bash
psql "$DATABASE_URL" -f src/database/migrations/withdrawal-queue-only-pending-trigger.sql
```

Or from the repo root:

```bash
cd apps/backend && npm run migrate
```

Down migration: the main `migrate down` drops tables with CASCADE, so the trigger is removed with `withdrawal_signing_queue`. The function `check_withdrawal_pending_before_queue_insert` remains until you drop it manually if needed.
