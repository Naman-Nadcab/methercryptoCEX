-- PHASE-11: Dedicated P2P escrow accounting.
-- Escrow funds are NOT spot locked_balance; they live in escrow_balance and are non-withdrawable, non-tradable.
-- Ensures: escrow_balance >= 0, release/refund only debit escrow.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'escrow_status') THEN
    CREATE TYPE escrow_status AS ENUM ('locked', 'released', 'refunded');
  END IF;
END $$;

-- Add escrow_balance to user_balances (dedicated bucket; NOT mixed with locked_balance).
ALTER TABLE user_balances
  ADD COLUMN IF NOT EXISTS escrow_balance DECIMAL(30,8) DEFAULT 0 NOT NULL;

ALTER TABLE user_balances
  DROP CONSTRAINT IF EXISTS chk_escrow_balance;

ALTER TABLE user_balances
  ADD CONSTRAINT chk_escrow_balance CHECK (escrow_balance >= 0);

-- Optional: total (available + locked + escrow) non-negative
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'user_balances'::regclass AND conname = 'chk_user_balances_total_non_negative') THEN
    ALTER TABLE user_balances ADD CONSTRAINT chk_user_balances_total_non_negative
      CHECK (COALESCE(available_balance, 0) + COALESCE(locked_balance, 0) + COALESCE(escrow_balance, 0) >= 0);
  END IF;
END $$;

-- Escrows table: one row per P2P order escrow; status guards release/refund idempotency.
CREATE TABLE IF NOT EXISTS escrows (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  p2p_order_id UUID,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  currency_id UUID NOT NULL REFERENCES currencies(id) ON DELETE RESTRICT,
  token_id UUID,
  amount DECIMAL(30,8) NOT NULL CHECK (amount > 0),
  status escrow_status NOT NULL DEFAULT 'locked',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  released_at TIMESTAMP WITH TIME ZONE,
  refunded_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_escrows_order ON escrows(p2p_order_id);
CREATE INDEX IF NOT EXISTS idx_escrows_user_status ON escrows(user_id, status);

-- PHASE-14: Operator escrow freeze (admin hold blocks release/refund until unfreeze)
ALTER TABLE escrows ADD COLUMN IF NOT EXISTS admin_frozen_at TIMESTAMPTZ NULL;
ALTER TABLE escrows ADD COLUMN IF NOT EXISTS admin_frozen_reason TEXT NULL;

-- p2p_orders: add escrow_id if missing (for schemas that have p2p_orders without it).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'p2p_orders' AND column_name = 'escrow_id'
  ) THEN
    ALTER TABLE p2p_orders ADD COLUMN escrow_id UUID REFERENCES escrows(id);
  END IF;
END $$;

-- Support token_id / quantity on p2p_orders for service compatibility (if schema uses crypto_currency_id/crypto_amount).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'p2p_orders' AND column_name = 'token_id'
  ) THEN
    ALTER TABLE p2p_orders ADD COLUMN token_id UUID REFERENCES currencies(id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'p2p_orders' AND column_name = 'quantity'
  ) THEN
    ALTER TABLE p2p_orders ADD COLUMN quantity DECIMAL(30,8);
  END IF;
END $$;
