-- Phase-7 Step-1: Balance safety — total balance CHECK + balance_locks
-- Run after user_balances and balance_account_type exist.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'user_balances') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'user_balances'::regclass AND conname = 'user_balances_total_non_negative') THEN
      ALTER TABLE user_balances ADD CONSTRAINT user_balances_total_non_negative
        CHECK (COALESCE(available_balance, 0) + COALESCE(locked_balance, 0) >= 0);
    END IF;
  END IF;
END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'balance_lock_reason') THEN CREATE TYPE balance_lock_reason AS ENUM ('order', 'withdrawal', 'escrow'); END IF; END $$;

CREATE TABLE IF NOT EXISTS balance_locks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  currency_id UUID NOT NULL REFERENCES currencies(id) ON DELETE CASCADE,
  account_type balance_account_type NOT NULL,
  amount DECIMAL(30,8) NOT NULL CHECK (amount > 0),
  reason balance_lock_reason NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_balance_locks_user_currency_account ON balance_locks(user_id, currency_id, account_type);
CREATE INDEX IF NOT EXISTS idx_balance_locks_expires_at ON balance_locks(expires_at);
