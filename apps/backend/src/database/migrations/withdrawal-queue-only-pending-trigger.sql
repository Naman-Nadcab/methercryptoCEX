-- HARD GUARD: Only withdrawals with status = 'pending' can be inserted into withdrawal_signing_queue.
-- Prevents pending_approval or failed withdrawals from ever being enqueued or signed.
-- Run this if you need to apply only this guard (otherwise run the main migrate script).
-- For PostgreSQL 10 or earlier, use EXECUTE PROCEDURE instead of EXECUTE FUNCTION in the CREATE TRIGGER.

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
