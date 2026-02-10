-- FIX #2: Prevent double deposit credit — database-level uniqueness.
-- Same on-chain tx (chain + tx_hash + to_address) can never be inserted twice.
-- Idempotent: safe to run multiple times; no existing data dropped.

-- Add unique constraint. Support both chain_id (string) and blockchain_id (UUID) column names.
DO $$
BEGIN
  -- If constraint already exists, do nothing (idempotent).
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'deposits_unique_chain_tx_to'
    AND conrelid = 'deposits'::regclass
  ) THEN
    RETURN;
  END IF;

  -- Table must exist.
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'deposits') THEN
    RETURN;
  END IF;

  -- Prefer chain_id (e.g. migrate/backend schema); fallback to blockchain_id (e.g. full-schema / indexer).
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'deposits' AND column_name = 'chain_id') THEN
    ALTER TABLE deposits ADD CONSTRAINT deposits_unique_chain_tx_to UNIQUE (chain_id, tx_hash, to_address);
  ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'deposits' AND column_name = 'blockchain_id') THEN
    ALTER TABLE deposits ADD CONSTRAINT deposits_unique_chain_tx_to UNIQUE (blockchain_id, tx_hash, to_address);
  END IF;
EXCEPTION
  WHEN unique_violation THEN
    -- Duplicate rows exist; admin must resolve before constraint can be added. Do not drop data.
    RAISE NOTICE 'deposits_unique_chain_tx_to: cannot add constraint until duplicate (chain_id/blockchain_id, tx_hash, to_address) rows are resolved.';
  WHEN duplicate_object THEN
    NULL; -- Constraint already exists under another name or race.
END $$;
