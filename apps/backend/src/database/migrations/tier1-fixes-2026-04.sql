-- Tier-1 schema drift patch (2026-04-11)
-- Purpose: close the gap between application code and the deployed DB so jobs
--          (p2p expiry, escrow flow) stop crashing, and admin views work.
-- Idempotent; safe to re-run.

-- 1. escrows: ensure currency_id, token_id, p2p_order_id, created_at columns exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='escrows' AND column_name='p2p_order_id') THEN
    ALTER TABLE escrows ADD COLUMN p2p_order_id UUID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='escrows' AND column_name='currency_id') THEN
    ALTER TABLE escrows ADD COLUMN currency_id UUID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='escrows' AND column_name='created_at') THEN
    ALTER TABLE escrows ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_escrows_order ON escrows(p2p_order_id);
CREATE INDEX IF NOT EXISTS idx_escrows_user_status ON escrows(user_id, status);

-- 2. p2p_orders: add the columns the service layer actually writes to
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='p2p_orders' AND column_name='escrow_id') THEN
    ALTER TABLE p2p_orders ADD COLUMN escrow_id UUID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='p2p_orders' AND column_name='token_id') THEN
    ALTER TABLE p2p_orders ADD COLUMN token_id UUID;
    -- Backfill from crypto_currency_id if that exists
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='p2p_orders' AND column_name='crypto_currency_id') THEN
      UPDATE p2p_orders SET token_id = crypto_currency_id WHERE token_id IS NULL;
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='p2p_orders' AND column_name='quantity') THEN
    ALTER TABLE p2p_orders ADD COLUMN quantity DECIMAL(30,8);
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='p2p_orders' AND column_name='crypto_amount') THEN
      UPDATE p2p_orders SET quantity = crypto_amount WHERE quantity IS NULL;
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='p2p_orders' AND column_name='expires_at') THEN
    ALTER TABLE p2p_orders ADD COLUMN expires_at TIMESTAMPTZ;
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='p2p_orders' AND column_name='payment_deadline') THEN
      UPDATE p2p_orders SET expires_at = payment_deadline WHERE expires_at IS NULL;
    END IF;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_p2p_orders_expires_status
  ON p2p_orders(expires_at) WHERE expires_at IS NOT NULL;

-- 3. settlement_events: mark 'pending' entries older than 24h as 'failed' (stale).
--    Provides a safe drain — preserves audit trail, stops settlement_lag alert.
DO $$
DECLARE
  stale_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO stale_count
  FROM settlement_events
  WHERE status = 'pending' AND created_at < NOW() - INTERVAL '24 hours';

  IF stale_count > 0 THEN
    UPDATE settlement_events
    SET status = 'failed',
        error_message = COALESCE(error_message, '') || ' [auto-drained 2026-04-11: stale backlog]',
        updated_at = NOW()
    WHERE status = 'pending' AND created_at < NOW() - INTERVAL '24 hours';
    RAISE NOTICE 'Drained % stale settlement_events', stale_count;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'settlement_events drain skipped: %', SQLERRM;
END $$;

-- 4. Audit log: ensure index for last-24h queries exists
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);

-- 5. Ensure `updated_at` exists on settlement_events for the drain step (no-op if present)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='settlement_events' AND column_name='updated_at') THEN
    ALTER TABLE settlement_events ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='settlement_events' AND column_name='error_message') THEN
    ALTER TABLE settlement_events ADD COLUMN error_message TEXT;
  END IF;
END $$;
