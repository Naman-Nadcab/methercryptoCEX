-- Fix: "invalid input syntax for type uuid: 'bsc'"
-- wallets.chain_id must be VARCHAR (values like 'bsc', 'ethereum'), not UUID.
-- Run once: psql $DATABASE_URL -f scripts/fix-wallets-chain-id-type.sql

DO $$
DECLARE
  col_type text;
  conname text;
BEGIN
  SELECT data_type INTO col_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'wallets' AND column_name = 'chain_id';

  IF col_type = 'uuid' THEN
    -- Drop FK so we can change column type
    FOR conname IN
      SELECT c.conname FROM pg_constraint c
      JOIN pg_class t ON c.conrelid = t.oid
      WHERE t.relname = 'wallets' AND c.contype = 'f'
      AND EXISTS (
        SELECT 1 FROM pg_attribute a
        WHERE a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey) AND a.attname = 'chain_id' AND NOT a.attisdropped
      )
    LOOP
      EXECUTE format('ALTER TABLE wallets DROP CONSTRAINT IF EXISTS %I', conname);
    END LOOP;

    ALTER TABLE wallets ALTER COLUMN chain_id TYPE VARCHAR(20) USING chain_id::text;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'chains')
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'chains' AND column_name = 'id' AND data_type = 'character varying') THEN
      ALTER TABLE wallets ADD CONSTRAINT wallets_chain_id_fkey FOREIGN KEY (chain_id) REFERENCES chains(id);
    END IF;

    RAISE NOTICE 'wallets.chain_id changed from UUID to VARCHAR(20)';
  ELSE
    RAISE NOTICE 'wallets.chain_id already VARCHAR or missing, no change';
  END IF;
END $$;
