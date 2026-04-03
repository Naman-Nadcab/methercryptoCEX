import { db } from '../lib/database.js';
import { logger } from '../lib/logger.js';

const migrations = [
  // ============================================
  // EXTENSIONS AND FUNCTIONS
  // ============================================
  `CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`,
  `CREATE EXTENSION IF NOT EXISTS "pgcrypto";`,

  // Updated_at trigger function
  `CREATE OR REPLACE FUNCTION update_updated_at_column()
   RETURNS TRIGGER AS $$
   BEGIN
     NEW.updated_at = CURRENT_TIMESTAMP;
     RETURN NEW;
   END;
   $$ language 'plpgsql';`,

  // ============================================
  // USERS TABLE
  // ============================================
  `CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) NOT NULL UNIQUE,
    phone VARCHAR(20) UNIQUE,
    password_hash VARCHAR(255),
    role VARCHAR(20) NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin', 'super_admin')),
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'suspended', 'banned')),
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    phone_verified BOOLEAN NOT NULL DEFAULT FALSE,
    two_factor_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    two_factor_secret VARCHAR(255),
    referral_code VARCHAR(10) NOT NULL UNIQUE,
    referred_by UUID REFERENCES users(id),
    last_login_at TIMESTAMP WITH TIME ZONE,
    last_login_ip INET,
    failed_login_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP WITH TIME ZONE
  );`,

  `CREATE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE deleted_at IS NULL;`,
  `CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone) WHERE deleted_at IS NULL;`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code VARCHAR(10);`,
  `UPDATE users SET referral_code = 'R' || substr(replace(id::text, '-', ''), 1, 9) WHERE referral_code IS NULL OR referral_code = '';`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code) WHERE referral_code IS NOT NULL;`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by UUID REFERENCES users(id);`,
  `CREATE INDEX IF NOT EXISTS idx_users_referred_by ON users(referred_by);`,
  `CREATE INDEX IF NOT EXISTS idx_users_status ON users(status) WHERE deleted_at IS NULL;`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS status_reason TEXT;`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS salt VARCHAR(64);`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS username VARCHAR(50);`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS tier_level INT DEFAULT 0;`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER NOT NULL DEFAULT 0;`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP WITH TIME ZONE;`,

  `DROP TRIGGER IF EXISTS update_users_updated_at ON users;
   CREATE TRIGGER update_users_updated_at
   BEFORE UPDATE ON users
   FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();`,

  // ============================================
  // REFERRAL CODES TABLE (auth profile + referral flow)
  // ============================================
  `CREATE TABLE IF NOT EXISTS referral_codes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code VARCHAR(32) NOT NULL UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`,
  `CREATE INDEX IF NOT EXISTS idx_referral_codes_user_id ON referral_codes(user_id);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_codes_code ON referral_codes(code);`,

  // ============================================
  // AUTH PROVIDERS TABLE
  // ============================================
  `CREATE TABLE IF NOT EXISTS auth_providers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(20) NOT NULL CHECK (provider IN ('email', 'google', 'apple', 'telegram')),
    provider_user_id VARCHAR(255),
    access_token TEXT,
    refresh_token TEXT,
    token_expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, provider),
    UNIQUE(provider, provider_user_id)
  );`,
  
  // Alter existing auth_providers table to allow telegram
  `DO $$ 
   BEGIN 
     ALTER TABLE auth_providers DROP CONSTRAINT IF EXISTS auth_providers_provider_check;
     ALTER TABLE auth_providers ADD CONSTRAINT auth_providers_provider_check 
       CHECK (provider IN ('email', 'google', 'apple', 'telegram'));
   EXCEPTION WHEN others THEN NULL;
   END $$;`,

  `CREATE INDEX IF NOT EXISTS idx_auth_providers_user_id ON auth_providers(user_id);`,
  `CREATE INDEX IF NOT EXISTS idx_auth_providers_provider ON auth_providers(provider, provider_user_id);`,

  // ============================================
  // SESSIONS TABLE
  // ============================================
  `CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token_hash VARCHAR(255) NOT NULL,
    device_info JSONB,
    ip_address INET,
    user_agent TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`,

  `CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id) WHERE is_active = TRUE;`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_refresh_token ON sessions(refresh_token_hash);`,

  // ============================================
  // USER SESSIONS (for OTP / passkey / OAuth login flow)
  // ============================================
  `CREATE TABLE IF NOT EXISTS user_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_token VARCHAR(255) NOT NULL UNIQUE,
    device_type VARCHAR(50) NOT NULL DEFAULT 'web',
    ip_address INET,
    user_agent TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    revoked_at TIMESTAMP WITH TIME ZONE
  );`,
  `CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);`,
  `CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(session_token);`,
  `CREATE INDEX IF NOT EXISTS idx_user_sessions_active ON user_sessions(is_active, expires_at) WHERE is_active = TRUE;`,
  `ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS device_id VARCHAR(255);`,
  `CREATE INDEX IF NOT EXISTS idx_user_sessions_device_id ON user_sessions(device_id) WHERE device_id IS NOT NULL;`,

  // ============================================
  // USER ACTIVITY LOGS
  // ============================================
  `CREATE TABLE IF NOT EXISTS user_activity_logs (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id UUID REFERENCES user_sessions(id) ON DELETE SET NULL,
    activity_type VARCHAR(80) NOT NULL,
    activity_details JSONB,
    ip_address INET,
    user_agent TEXT,
    details JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`,
  `CREATE INDEX IF NOT EXISTS idx_user_activity_logs_user_id ON user_activity_logs(user_id);`,
  `CREATE INDEX IF NOT EXISTS idx_user_activity_logs_activity_type ON user_activity_logs(activity_type);`,
  `CREATE INDEX IF NOT EXISTS idx_user_activity_logs_created ON user_activity_logs(created_at DESC);`,
  `ALTER TABLE user_activity_logs ADD COLUMN IF NOT EXISTS device_id VARCHAR(255);`,
  `CREATE INDEX IF NOT EXISTS idx_user_activity_logs_user_created ON user_activity_logs(user_id, created_at DESC);`,

  // ============================================
  // OTP VERIFICATIONS TABLE
  // ============================================
  `CREATE TABLE IF NOT EXISTS otp_verifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    identifier VARCHAR(255) NOT NULL,
    type VARCHAR(20) NOT NULL CHECK (type IN ('email', 'phone', 'password_reset', 'two_factor')),
    otp_hash VARCHAR(255) NOT NULL,
    salt VARCHAR(64) NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 5,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    verified_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`,

  `CREATE INDEX IF NOT EXISTS idx_otp_identifier ON otp_verifications(identifier, type) WHERE verified_at IS NULL;`,
  `CREATE INDEX IF NOT EXISTS idx_otp_expires ON otp_verifications(expires_at);`,

  // ============================================
  // PASSWORD HISTORY TABLE
  // ============================================
  `CREATE TABLE IF NOT EXISTS password_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    password_hash VARCHAR(255) NOT NULL,
    changed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`,

  `CREATE INDEX IF NOT EXISTS idx_password_history_user_id ON password_history(user_id);`,

  // ============================================
  // KYC RECORDS TABLE
  // ============================================
  `CREATE TABLE IF NOT EXISTS kyc_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(30) NOT NULL DEFAULT 'not_started' 
      CHECK (status IN ('not_started', 'pending', 'approved', 'rejected', 'requires_resubmission')),
    level INTEGER NOT NULL DEFAULT 0 CHECK (level >= 0 AND level <= 3),
    
    -- PAN Details
    pan_number VARCHAR(20),
    pan_name VARCHAR(255),
    pan_verified BOOLEAN NOT NULL DEFAULT FALSE,
    pan_verified_at TIMESTAMP WITH TIME ZONE,
    
    -- Aadhaar Details  
    aadhaar_number_hash VARCHAR(255),
    aadhaar_name VARCHAR(255),
    aadhaar_verified BOOLEAN NOT NULL DEFAULT FALSE,
    aadhaar_verified_at TIMESTAMP WITH TIME ZONE,
    
    -- Liveness Detection
    liveness_score DECIMAL(5,2),
    liveness_verified BOOLEAN NOT NULL DEFAULT FALSE,
    liveness_verified_at TIMESTAMP WITH TIME ZONE,
    
    -- Geo Location
    geo_latitude DECIMAL(10,8),
    geo_longitude DECIMAL(11,8),
    geo_country VARCHAR(100),
    geo_state VARCHAR(100),
    geo_city VARCHAR(100),
    
    -- Rejection
    rejection_reason TEXT,
    rejection_count INTEGER NOT NULL DEFAULT 0,
    
    -- Admin
    reviewed_by UUID REFERENCES users(id),
    reviewed_at TIMESTAMP WITH TIME ZONE,
    
    submitted_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`,

  `CREATE INDEX IF NOT EXISTS idx_kyc_user_id ON kyc_records(user_id);`,
  `CREATE INDEX IF NOT EXISTS idx_kyc_status ON kyc_records(status);`,

  `DROP TRIGGER IF EXISTS update_kyc_records_updated_at ON kyc_records;
   CREATE TRIGGER update_kyc_records_updated_at
   BEFORE UPDATE ON kyc_records
   FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();`,

  // ============================================
  // KYC APPLICATIONS TABLE (user-facing KYC flow; code uses this)
  // ============================================
  `CREATE TABLE IF NOT EXISTS kyc_applications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kyc_level SMALLINT NOT NULL DEFAULT 0,
    status VARCHAR(30) NOT NULL DEFAULT 'not_submitted',
    rejection_reason TEXT,
    submitted_at TIMESTAMP WITH TIME ZONE,
    reviewed_at TIMESTAMP WITH TIME ZONE,
    reviewed_by UUID REFERENCES users(id),
    reviewer_notes TEXT,
    country VARCHAR(10),
    document_type VARCHAR(50),
    third_party_provider VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`,
  `CREATE INDEX IF NOT EXISTS idx_kyc_applications_user_id ON kyc_applications(user_id);`,

  // ============================================
  // KYC DOCUMENTS TABLE
  // ============================================
  `CREATE TABLE IF NOT EXISTS kyc_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    kyc_record_id UUID NOT NULL REFERENCES kyc_records(id) ON DELETE CASCADE,
    type VARCHAR(30) NOT NULL 
      CHECK (type IN ('pan', 'aadhaar_front', 'aadhaar_back', 'selfie', 'liveness_video', 'address_proof')),
    file_url TEXT NOT NULL,
    file_hash VARCHAR(64),
    verified BOOLEAN NOT NULL DEFAULT FALSE,
    verified_by UUID REFERENCES users(id),
    verified_at TIMESTAMP WITH TIME ZONE,
    rejection_reason TEXT,
    uploaded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`,

  `ALTER TABLE kyc_documents ADD COLUMN IF NOT EXISTS kyc_record_id UUID REFERENCES kyc_records(id) ON DELETE CASCADE;`,
  `DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'kyc_documents' AND column_name = 'kyc_record_id') THEN
      CREATE INDEX IF NOT EXISTS idx_kyc_documents_record_id ON kyc_documents(kyc_record_id);
    END IF;
  END $$;`,

  // ============================================
  // CHAINS + TOKENS AS TABLES (not views)
  // Exchange requires chains/tokens to be TABLES. If they exist as VIEWs,
  // CREATE TABLE IF NOT EXISTS would do nothing and wallet APIs would fail.
  // We drop the views (tokens first, then chains) only when they are views;
  // tables are left unchanged. Backup view definitions elsewhere if needed.
  // ============================================
  `DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'tokens' AND c.relkind = 'v') THEN
      DROP VIEW IF EXISTS tokens CASCADE;
      RAISE NOTICE 'Dropped view tokens so migrations can create tokens table.';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'chains' AND c.relkind = 'v') THEN
      DROP VIEW IF EXISTS chains CASCADE;
      RAISE NOTICE 'Dropped view chains so migrations can create chains table.';
    END IF;
  END $$;`,
  `CREATE TABLE IF NOT EXISTS chains (
    id VARCHAR(20) PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    type VARCHAR(20) NOT NULL CHECK (type IN ('evm', 'solana', 'tron', 'bitcoin')),
    native_currency VARCHAR(10) NOT NULL,
    decimals INTEGER NOT NULL,
    rpc_url TEXT NOT NULL,
    ws_url TEXT,
    explorer_url TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    confirmations_required INTEGER NOT NULL DEFAULT 12,
    avg_block_time INTEGER NOT NULL DEFAULT 12,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`,

  // ============================================
  // TOKENS TABLE
  // ============================================
  `CREATE TABLE IF NOT EXISTS tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    symbol VARCHAR(20) NOT NULL,
    name VARCHAR(100) NOT NULL,
    chain_id VARCHAR(20) NOT NULL REFERENCES chains(id),
    contract_address VARCHAR(100),
    decimals INTEGER NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_native BOOLEAN NOT NULL DEFAULT FALSE,
    icon_url TEXT,
    coingecko_id VARCHAR(100),
    min_deposit DECIMAL(36,18) NOT NULL DEFAULT 0,
    min_withdrawal DECIMAL(36,18) NOT NULL DEFAULT 0,
    withdrawal_fee DECIMAL(36,18) NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(chain_id, contract_address),
    UNIQUE(chain_id, symbol, is_native)
  );`,

  `DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'tokens' AND c.relkind = 'r') THEN
      ALTER TABLE tokens ADD COLUMN IF NOT EXISTS chain_id VARCHAR(20) REFERENCES chains(id);
      ALTER TABLE tokens ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tokens' AND column_name = 'chain_id') AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tokens' AND column_name = 'is_active') THEN
        CREATE INDEX IF NOT EXISTS idx_tokens_chain_id ON tokens(chain_id) WHERE is_active = TRUE;
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tokens' AND column_name = 'symbol') THEN
        CREATE INDEX IF NOT EXISTS idx_tokens_symbol ON tokens(symbol);
      END IF;
    END IF;
  END $$;`,

  // Token withdrawal limits: canonical columns (required for admin + withdrawal validation)
  `DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'tokens' AND c.relkind = 'r') THEN
      ALTER TABLE tokens ADD COLUMN IF NOT EXISTS min_withdrawal DECIMAL(36,18) NOT NULL DEFAULT 0;
      ALTER TABLE tokens ADD COLUMN IF NOT EXISTS max_withdrawal DECIMAL(36,18) NULL;
    END IF;
  END $$;`,

  // ============================================
  // USER MASTER KEYS TABLE (for HD wallet derivation)
  // ============================================
  `CREATE TABLE IF NOT EXISTS user_master_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    encrypted_seed TEXT NOT NULL,
    key_version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`,

  `CREATE INDEX IF NOT EXISTS idx_user_master_keys_user_id ON user_master_keys(user_id);`,

  // ============================================
  // WALLETS TABLE
  // ============================================
  `CREATE TABLE IF NOT EXISTS wallets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    chain_id VARCHAR(20) NOT NULL REFERENCES chains(id),
    address VARCHAR(100) NOT NULL,
    encrypted_private_key TEXT NOT NULL,
    hd_path VARCHAR(50) NOT NULL,
    hd_index INTEGER NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, chain_id),
    UNIQUE(chain_id, address)
  );`,

  `DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'wallets' AND c.relkind = 'r') THEN
      CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON wallets(user_id);
      CREATE INDEX IF NOT EXISTS idx_wallets_address ON wallets(chain_id, address);
    END IF;
  END $$;`,

  // User deposit addresses are immutable: do not allow changing address once set (change only via code)
  `CREATE OR REPLACE FUNCTION prevent_wallets_address_change()
  RETURNS TRIGGER AS $$
  BEGIN
    IF OLD.address IS DISTINCT FROM NEW.address THEN
      RAISE EXCEPTION 'wallets.address is immutable: user deposit address must not be changed once set';
    END IF;
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql;`,
  `DROP TRIGGER IF EXISTS trg_prevent_wallets_address_change ON wallets;
   CREATE TRIGGER trg_prevent_wallets_address_change
   BEFORE UPDATE ON wallets
   FOR EACH ROW EXECUTE FUNCTION prevent_wallets_address_change();`,

  // Fix: wallets.chain_id must be VARCHAR (chain ids like 'bsc', 'ethereum'), not UUID
  `DO $$
  DECLARE
    col_type text;
    conname text;
  BEGIN
    SELECT data_type INTO col_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'wallets' AND column_name = 'chain_id';
    IF col_type = 'uuid' THEN
      SELECT c.conname INTO conname FROM pg_constraint c
      JOIN pg_class t ON c.conrelid = t.oid
      WHERE t.relname = 'wallets' AND c.contype = 'f' AND c.conkey @> ARRAY(
        (SELECT attnum FROM pg_attribute WHERE attrelid = (SELECT oid FROM pg_class WHERE relname = 'wallets') AND attname = 'chain_id' AND NOT attisdropped)
      ) LIMIT 1;
      IF conname IS NOT NULL THEN
        EXECUTE format('ALTER TABLE wallets DROP CONSTRAINT IF EXISTS %I', conname);
      END IF;
      ALTER TABLE wallets ALTER COLUMN chain_id TYPE VARCHAR(20) USING chain_id::text;
      ALTER TABLE wallets ADD CONSTRAINT wallets_chain_id_fkey FOREIGN KEY (chain_id) REFERENCES chains(id);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END $$;`,

  // ============================================
  // BALANCES TABLE
  // ============================================
  `CREATE TABLE IF NOT EXISTS balances (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_id UUID NOT NULL REFERENCES tokens(id),
    available DECIMAL(36,18) NOT NULL DEFAULT 0 CHECK (available >= 0),
    locked DECIMAL(36,18) NOT NULL DEFAULT 0 CHECK (locked >= 0),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, token_id)
  );`,

  `DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'balances' AND c.relkind = 'r')
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'balances' AND column_name = 'token_id') THEN
      CREATE INDEX IF NOT EXISTS idx_balances_user_id ON balances(user_id);
      CREATE INDEX IF NOT EXISTS idx_balances_token_id ON balances(token_id);
    END IF;
  END $$;`,

  // balances table: add columns used by wallet routes (only if balances is legacy table with token_id, not settlement table)
  `DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'balances' AND c.relkind = 'r')
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'balances' AND column_name = 'token_id') THEN
      ALTER TABLE balances ADD COLUMN IF NOT EXISTS available_balance DECIMAL(36,18) DEFAULT 0;
      ALTER TABLE balances ADD COLUMN IF NOT EXISTS account_type VARCHAR(50) NOT NULL DEFAULT 'funding';
      ALTER TABLE balances ADD COLUMN IF NOT EXISTS locked_balance DECIMAL(36,18) DEFAULT 0;
      UPDATE balances SET available_balance = COALESCE(available_balance, available, 0), locked_balance = COALESCE(locked_balance, locked, 0) WHERE available_balance IS NULL OR locked_balance IS NULL;
    END IF;
  END $$;`,

  // ============================================
  // TRADING PAIRS TABLE
  // ============================================
  `CREATE TABLE IF NOT EXISTS trading_pairs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    symbol VARCHAR(20) NOT NULL UNIQUE,
    base_token_id UUID NOT NULL REFERENCES tokens(id),
    quote_token_id UUID NOT NULL REFERENCES tokens(id),
    min_order_size DECIMAL(36,18) NOT NULL,
    max_order_size DECIMAL(36,18) NOT NULL,
    tick_size DECIMAL(36,18) NOT NULL,
    step_size DECIMAL(36,18) NOT NULL,
    maker_fee DECIMAL(10,6) NOT NULL DEFAULT 0.001,
    taker_fee DECIMAL(10,6) NOT NULL DEFAULT 0.001,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(base_token_id, quote_token_id)
  );`,

  `DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'trading_pairs' AND c.relkind = 'r') THEN
      CREATE INDEX IF NOT EXISTS idx_trading_pairs_symbol ON trading_pairs(symbol) WHERE is_active = TRUE;
    END IF;
  END $$;`,

  // ============================================
  // ORDERS TABLE
  // ============================================
  `CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    pair_id UUID NOT NULL REFERENCES trading_pairs(id),
    side VARCHAR(4) NOT NULL CHECK (side IN ('buy', 'sell')),
    type VARCHAR(20) NOT NULL CHECK (type IN ('market', 'limit', 'stop_loss', 'stop_limit')),
    status VARCHAR(20) NOT NULL DEFAULT 'pending' 
      CHECK (status IN ('pending', 'open', 'partially_filled', 'filled', 'cancelled', 'expired', 'rejected')),
    time_in_force VARCHAR(3) NOT NULL DEFAULT 'gtc' CHECK (time_in_force IN ('gtc', 'ioc', 'fok')),
    price DECIMAL(36,18),
    stop_price DECIMAL(36,18),
    quantity DECIMAL(36,18) NOT NULL,
    filled_quantity DECIMAL(36,18) NOT NULL DEFAULT 0,
    remaining_quantity DECIMAL(36,18) NOT NULL,
    average_price DECIMAL(36,18),
    fee DECIMAL(36,18) NOT NULL DEFAULT 0,
    fee_asset VARCHAR(20),
    client_order_id VARCHAR(64),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    filled_at TIMESTAMP WITH TIME ZONE,
    cancelled_at TIMESTAMP WITH TIME ZONE
  );`,

  `DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'orders' AND c.relkind = 'r') THEN
      CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
      CREATE INDEX IF NOT EXISTS idx_orders_pair_id ON orders(pair_id);
      CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
      CREATE INDEX IF NOT EXISTS idx_orders_open ON orders(pair_id, side, price) WHERE status IN ('open', 'partially_filled');
      CREATE INDEX IF NOT EXISTS idx_orders_user_open ON orders(user_id, status) WHERE status IN ('open', 'partially_filled');
      CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_orders_client_order_id ON orders(user_id, client_order_id);
      DROP TRIGGER IF EXISTS update_orders_updated_at ON orders;
      CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
  END $$;`,

  // ============================================
  // TRADES TABLE
  // ============================================
  `CREATE TABLE IF NOT EXISTS trades (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pair_id UUID NOT NULL REFERENCES trading_pairs(id),
    buy_order_id UUID NOT NULL REFERENCES orders(id),
    sell_order_id UUID NOT NULL REFERENCES orders(id),
    buyer_id UUID NOT NULL REFERENCES users(id),
    seller_id UUID NOT NULL REFERENCES users(id),
    price DECIMAL(36,18) NOT NULL,
    quantity DECIMAL(36,18) NOT NULL,
    quote_quantity DECIMAL(36,18) NOT NULL,
    buyer_fee DECIMAL(36,18) NOT NULL,
    seller_fee DECIMAL(36,18) NOT NULL,
    buyer_is_maker BOOLEAN NOT NULL,
    executed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`,

  `DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'trades' AND c.relkind = 'r') THEN
      CREATE INDEX IF NOT EXISTS idx_trades_pair_id ON trades(pair_id);
      CREATE INDEX IF NOT EXISTS idx_trades_buyer_id ON trades(buyer_id);
      CREATE INDEX IF NOT EXISTS idx_trades_seller_id ON trades(seller_id);
      CREATE INDEX IF NOT EXISTS idx_trades_executed_at ON trades(executed_at DESC);
      CREATE INDEX IF NOT EXISTS idx_trades_pair_executed ON trades(pair_id, executed_at DESC);
    END IF;
  END $$;`,

  // ============================================
  // PHASE-3: SPOT TRADING (spot_markets, spot_orders, spot_trades)
  // ============================================
  `CREATE TABLE IF NOT EXISTS spot_markets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    symbol VARCHAR(30) NOT NULL UNIQUE,
    base_asset VARCHAR(20) NOT NULL,
    quote_asset VARCHAR(20) NOT NULL,
    base_currency_id UUID,
    quote_currency_id UUID,
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'maintenance')),
    min_qty DECIMAL(36,18) NOT NULL DEFAULT 0.0001,
    min_notional DECIMAL(36,18) NOT NULL DEFAULT 1,
    price_precision INT NOT NULL DEFAULT 8,
    qty_precision INT NOT NULL DEFAULT 8,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`,
  `CREATE INDEX IF NOT EXISTS idx_spot_markets_symbol ON spot_markets(symbol) WHERE status = 'active';`,
  `CREATE INDEX IF NOT EXISTS idx_spot_markets_status ON spot_markets(status);`,

  `CREATE TABLE IF NOT EXISTS spot_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    market VARCHAR(30) NOT NULL,
    side VARCHAR(4) NOT NULL CHECK (side IN ('buy', 'sell')),
    type VARCHAR(10) NOT NULL CHECK (type IN ('market', 'limit')),
    price DECIMAL(36,18),
    quantity DECIMAL(36,18) NOT NULL,
    filled_quantity DECIMAL(36,18) NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'OPEN'
      CHECK (status IN ('OPEN', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED', 'REJECTED')),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`,
  `CREATE INDEX IF NOT EXISTS idx_spot_orders_user_id ON spot_orders(user_id);`,
  `DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'spot_orders' AND column_name = 'market') THEN
      CREATE INDEX IF NOT EXISTS idx_spot_orders_market ON spot_orders(market);
    ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'spot_orders' AND column_name = 'trading_pair_id') THEN
      CREATE INDEX IF NOT EXISTS idx_spot_orders_market ON spot_orders(trading_pair_id);
    END IF;
  END $$;`,
  `CREATE INDEX IF NOT EXISTS idx_spot_orders_status ON spot_orders(status);`,
  `CREATE INDEX IF NOT EXISTS idx_spot_orders_created_at ON spot_orders(created_at DESC);`,
  `DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'spot_orders' AND column_name = 'market') THEN
      CREATE INDEX IF NOT EXISTS idx_spot_orders_open ON spot_orders(market, side, status) WHERE status IN ('OPEN', 'PARTIALLY_FILLED');
    ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'spot_orders' AND column_name = 'trading_pair_id') THEN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_spot_orders_open ON spot_orders(trading_pair_id, side, status) WHERE status IN (''new''::order_status, ''partially_filled''::order_status)';
    END IF;
  END $$;`,

  `CREATE TABLE IF NOT EXISTS spot_trades (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES spot_orders(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    market VARCHAR(30) NOT NULL,
    side VARCHAR(4) NOT NULL CHECK (side IN ('buy', 'sell')),
    price DECIMAL(36,18) NOT NULL,
    quantity DECIMAL(36,18) NOT NULL,
    fee DECIMAL(36,18) NOT NULL DEFAULT 0,
    fee_asset VARCHAR(20),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`,
  `DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'spot_trades' AND column_name = 'order_id') THEN
      CREATE INDEX IF NOT EXISTS idx_spot_trades_order_id ON spot_trades(order_id);
    ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'spot_trades' AND column_name = 'maker_order_id') THEN
      CREATE INDEX IF NOT EXISTS idx_spot_trades_maker_order ON spot_trades(maker_order_id);
      CREATE INDEX IF NOT EXISTS idx_spot_trades_taker_order ON spot_trades(taker_order_id);
    END IF;
  END $$;`,
  `DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'spot_trades' AND column_name = 'user_id') THEN
      CREATE INDEX IF NOT EXISTS idx_spot_trades_user_id ON spot_trades(user_id);
    ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'spot_trades' AND column_name = 'maker_user_id') THEN
      CREATE INDEX IF NOT EXISTS idx_spot_trades_maker ON spot_trades(maker_user_id);
      CREATE INDEX IF NOT EXISTS idx_spot_trades_taker ON spot_trades(taker_user_id);
    END IF;
  END $$;`,
  `DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'spot_trades' AND column_name = 'market') THEN
      CREATE INDEX IF NOT EXISTS idx_spot_trades_market ON spot_trades(market);
    ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'spot_trades' AND column_name = 'trading_pair_id') THEN
      CREATE INDEX IF NOT EXISTS idx_spot_trades_market ON spot_trades(trading_pair_id);
    END IF;
  END $$;`,
  `CREATE INDEX IF NOT EXISTS idx_spot_trades_created_at ON spot_trades(created_at DESC);`,

  // OHLCV candles for chart (GET /trading/candles/:symbol)
  `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'candle_interval') THEN CREATE TYPE candle_interval AS ENUM ('1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M'); END IF; END $$;`,
  `CREATE TABLE IF NOT EXISTS ohlcv_candles (
    id BIGSERIAL PRIMARY KEY,
    trading_pair_id UUID NOT NULL REFERENCES trading_pairs(id),
    interval_type candle_interval NOT NULL,
    open_time TIMESTAMP WITH TIME ZONE NOT NULL,
    close_time TIMESTAMP WITH TIME ZONE NOT NULL,
    open_price DECIMAL(30,8) NOT NULL,
    high_price DECIMAL(30,8) NOT NULL,
    low_price DECIMAL(30,8) NOT NULL,
    close_price DECIMAL(30,8) NOT NULL,
    volume DECIMAL(30,8) NOT NULL,
    quote_volume DECIMAL(30,8) NOT NULL DEFAULT 0,
    trade_count INT NOT NULL DEFAULT 0,
    UNIQUE(trading_pair_id, interval_type, open_time)
  );`,
  `CREATE INDEX IF NOT EXISTS idx_candles_query ON ohlcv_candles(trading_pair_id, interval_type, open_time);`,

  // trading_pairs.trading_enabled for candles API (GET /trading/candles/:symbol)
  `ALTER TABLE trading_pairs ADD COLUMN IF NOT EXISTS trading_enabled BOOLEAN DEFAULT TRUE;`,
  `UPDATE trading_pairs SET trading_enabled = COALESCE(is_active, TRUE) WHERE trading_enabled IS NULL;`,

  // Sync trading_pairs from spot_markets so GET /trading/candles/:symbol works for every spot symbol
  `DO $$
  DECLARE
    r RECORD;
    bid UUID;
    qid UUID;
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'trading_pairs')
       OR NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'spot_markets')
       OR NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'tokens') THEN
      RETURN;
    END IF;
    FOR r IN SELECT symbol, base_asset, quote_asset FROM spot_markets WHERE status IN ('active', 'maintenance')
    LOOP
      IF NOT EXISTS (SELECT 1 FROM trading_pairs WHERE trading_pairs.symbol = r.symbol) THEN
        SELECT id INTO bid FROM tokens WHERE symbol = r.base_asset AND is_active = TRUE ORDER BY is_native DESC NULLS LAST LIMIT 1;
        SELECT id INTO qid FROM tokens WHERE symbol = r.quote_asset AND is_active = TRUE ORDER BY is_native DESC NULLS LAST LIMIT 1;
        IF bid IS NOT NULL AND qid IS NOT NULL THEN
          INSERT INTO trading_pairs (symbol, base_token_id, quote_token_id, min_order_size, max_order_size, tick_size, step_size, maker_fee, taker_fee, is_active, trading_enabled)
          VALUES (r.symbol, bid, qid, 0.0001, 1000000000, 0.01, 0.0001, 0.001, 0.001, TRUE, TRUE)
          ON CONFLICT (symbol) DO NOTHING;
        END IF;
      END IF;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END $$;`,

  // Phase-4: maker/taker fee per market
  `ALTER TABLE spot_markets ADD COLUMN IF NOT EXISTS maker_fee DECIMAL(10,6) NOT NULL DEFAULT 0.001;`,
  `ALTER TABLE spot_markets ADD COLUMN IF NOT EXISTS taker_fee DECIMAL(10,6) NOT NULL DEFAULT 0.001;`,

  // Currencies table + seed for spot (BTC, ETH, USDT) so spot_markets INSERT works
  `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'currency_type') THEN CREATE TYPE currency_type AS ENUM ('crypto', 'fiat', 'stablecoin'); END IF; END $$;`,
  `DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'currencies') THEN
      CREATE TABLE currencies (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        symbol VARCHAR(20) NOT NULL,
        name VARCHAR(100),
        currency_type currency_type DEFAULT 'crypto'::currency_type,
        blockchain_id UUID,
        contract_address VARCHAR(100),
        decimals INT DEFAULT 18,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    END IF;
  END $$;`,
  `CREATE INDEX IF NOT EXISTS idx_currencies_symbol ON currencies(symbol);`,
  `CREATE INDEX IF NOT EXISTS idx_currencies_symbol ON currencies(symbol);`,
  `DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM currencies WHERE UPPER(TRIM(symbol)) = 'BTC' LIMIT 1) THEN
      INSERT INTO currencies (symbol, name, currency_type, decimals) VALUES ('BTC', 'Bitcoin', 'crypto'::currency_type, 8);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM currencies WHERE UPPER(TRIM(symbol)) = 'ETH' LIMIT 1) THEN
      INSERT INTO currencies (symbol, name, currency_type, decimals) VALUES ('ETH', 'Ethereum', 'crypto'::currency_type, 18);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM currencies WHERE UPPER(TRIM(symbol)) = 'USDT' LIMIT 1) THEN
      INSERT INTO currencies (symbol, name, currency_type, decimals) VALUES ('USDT', 'Tether USD', 'crypto'::currency_type, 6);
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END $$;`,

  `DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'spot_markets') THEN
      INSERT INTO spot_markets (symbol, base_asset, quote_asset, base_currency_id, quote_currency_id, status, min_qty, min_notional, price_precision, qty_precision)
      SELECT 'BTC_USDT', 'BTC', 'USDT', (SELECT id FROM currencies WHERE UPPER(TRIM(symbol)) = 'BTC' LIMIT 1), (SELECT id FROM currencies WHERE UPPER(TRIM(symbol)) = 'USDT' LIMIT 1), 'active', 0.0001, 1, 8, 8
      WHERE EXISTS (SELECT 1 FROM currencies LIMIT 1) AND NOT EXISTS (SELECT 1 FROM spot_markets WHERE symbol = 'BTC_USDT');
      INSERT INTO spot_markets (symbol, base_asset, quote_asset, base_currency_id, quote_currency_id, status, min_qty, min_notional, price_precision, qty_precision)
      SELECT 'ETH_USDT', 'ETH', 'USDT', (SELECT id FROM currencies WHERE UPPER(TRIM(symbol)) = 'ETH' LIMIT 1), (SELECT id FROM currencies WHERE UPPER(TRIM(symbol)) = 'USDT' LIMIT 1), 'active', 0.0001, 1, 8, 8
      WHERE EXISTS (SELECT 1 FROM currencies LIMIT 1) AND NOT EXISTS (SELECT 1 FROM spot_markets WHERE symbol = 'ETH_USDT');
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END $$;`,

  // Create market_prices for convert/swap and balances summary (requires currencies)
  `DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'currencies') THEN
      CREATE TABLE IF NOT EXISTS market_prices (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        base_currency_id UUID NOT NULL REFERENCES currencies(id),
        quote_currency_id UUID NOT NULL REFERENCES currencies(id),
        price DECIMAL(30, 18) NOT NULL,
        price_24h_ago DECIMAL(30, 18),
        change_24h DECIMAL(10, 4),
        change_24h_percent DECIMAL(10, 4),
        high_24h DECIMAL(30, 18),
        low_24h DECIMAL(30, 18),
        volume_24h DECIMAL(30, 18),
        last_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(base_currency_id, quote_currency_id)
      );
      CREATE INDEX IF NOT EXISTS idx_market_prices_pair ON market_prices(base_currency_id, quote_currency_id);
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END $$;`,

  // ============================================
  // PAYMENT METHODS TABLE
  // ============================================
  `CREATE TABLE IF NOT EXISTS payment_methods (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(30) NOT NULL 
      CHECK (type IN ('bank_transfer', 'upi', 'paytm', 'phonepe', 'gpay', 'imps', 'neft')),
    name VARCHAR(100) NOT NULL,
    details_encrypted TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`,

  `DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'payment_methods' AND c.relkind = 'r') THEN
      CREATE INDEX IF NOT EXISTS idx_payment_methods_user_id ON payment_methods(user_id) WHERE is_active = TRUE;
    END IF;
  END $$;`,

  // ============================================
  // P2P ADS TABLE
  // ============================================
  `CREATE TABLE IF NOT EXISTS p2p_ads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    type VARCHAR(4) NOT NULL CHECK (type IN ('buy', 'sell')),
    token_id UUID NOT NULL REFERENCES tokens(id),
    fiat_currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    price_type VARCHAR(10) NOT NULL CHECK (price_type IN ('fixed', 'floating')),
    price DECIMAL(36,18) NOT NULL,
    floating_price_margin DECIMAL(10,4),
    min_amount DECIMAL(36,18) NOT NULL,
    max_amount DECIMAL(36,18) NOT NULL,
    available_amount DECIMAL(36,18) NOT NULL,
    total_amount DECIMAL(36,18) NOT NULL,
    payment_methods UUID[] NOT NULL,
    payment_time_limit INTEGER NOT NULL DEFAULT 15,
    remarks TEXT,
    auto_reply TEXT,
    countries VARCHAR(3)[],
    status VARCHAR(20) NOT NULL DEFAULT 'active' 
      CHECK (status IN ('active', 'paused', 'completed', 'cancelled')),
    completed_orders INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`,

  `DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'p2p_ads' AND c.relkind = 'r') THEN
      BEGIN CREATE INDEX IF NOT EXISTS idx_p2p_ads_user_id ON p2p_ads(user_id); EXCEPTION WHEN OTHERS THEN NULL; END;
      BEGIN CREATE INDEX IF NOT EXISTS idx_p2p_ads_type ON p2p_ads(type, status) WHERE status = 'active'; EXCEPTION WHEN OTHERS THEN NULL; END;
      BEGIN CREATE INDEX IF NOT EXISTS idx_p2p_ads_token ON p2p_ads(token_id, fiat_currency, status) WHERE status = 'active'; EXCEPTION WHEN OTHERS THEN NULL; END;
      BEGIN CREATE INDEX IF NOT EXISTS idx_p2p_ads_price ON p2p_ads(price) WHERE status = 'active'; EXCEPTION WHEN OTHERS THEN NULL; END;
    END IF;
  END $$;`,

  // ============================================
  // ESCROWS TABLE (create without tokens FK if tokens is a view)
  // ============================================
  `DO $$
  DECLARE
    tokens_is_table BOOLEAN;
  BEGIN
    SELECT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'tokens' AND c.relkind = 'r') INTO tokens_is_table;
    IF tokens_is_table THEN
      CREATE TABLE IF NOT EXISTS escrows (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID NOT NULL REFERENCES users(id),
        token_id UUID NOT NULL REFERENCES tokens(id),
        amount DECIMAL(36,18) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'locked' CHECK (status IN ('locked', 'released', 'refunded')),
        locked_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        released_at TIMESTAMP WITH TIME ZONE,
        refunded_at TIMESTAMP WITH TIME ZONE
      );
    ELSE
      CREATE TABLE IF NOT EXISTS escrows (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID NOT NULL REFERENCES users(id),
        token_id UUID NOT NULL,
        amount DECIMAL(36,18) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'locked' CHECK (status IN ('locked', 'released', 'refunded')),
        locked_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        released_at TIMESTAMP WITH TIME ZONE,
        refunded_at TIMESTAMP WITH TIME ZONE
      );
    END IF;
  END $$;`,

  `DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'escrows' AND c.relkind = 'r') THEN
      CREATE INDEX IF NOT EXISTS idx_escrows_user_id ON escrows(user_id);
      CREATE INDEX IF NOT EXISTS idx_escrows_status ON escrows(status) WHERE status = 'locked';
    END IF;
  END $$;`,

  // PHASE-14: Operator escrow freeze (admin hold blocks release/refund until unfreeze)
  `ALTER TABLE escrows ADD COLUMN IF NOT EXISTS admin_frozen_at TIMESTAMPTZ NULL;`,
  `ALTER TABLE escrows ADD COLUMN IF NOT EXISTS admin_frozen_reason TEXT NULL;`,

  // ============================================
  // P2P ORDERS TABLE
  // ============================================
  `CREATE TABLE IF NOT EXISTS p2p_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ad_id UUID NOT NULL REFERENCES p2p_ads(id),
    buyer_id UUID NOT NULL REFERENCES users(id),
    seller_id UUID NOT NULL REFERENCES users(id),
    token_id UUID NOT NULL REFERENCES tokens(id),
    fiat_currency VARCHAR(3) NOT NULL,
    price DECIMAL(36,18) NOT NULL,
    quantity DECIMAL(36,18) NOT NULL,
    fiat_amount DECIMAL(36,18) NOT NULL,
    payment_method_id UUID NOT NULL REFERENCES payment_methods(id),
    escrow_id UUID NOT NULL REFERENCES escrows(id),
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'payment_pending', 'payment_confirmed', 'releasing', 'completed', 'cancelled', 'disputed', 'expired')),
    payment_confirmed_at TIMESTAMP WITH TIME ZONE,
    released_at TIMESTAMP WITH TIME ZONE,
    cancelled_at TIMESTAMP WITH TIME ZONE,
    cancel_reason TEXT,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`,

  `DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'p2p_orders' AND c.relkind = 'r') THEN
      BEGIN CREATE INDEX IF NOT EXISTS idx_p2p_orders_ad_id ON p2p_orders(ad_id); EXCEPTION WHEN OTHERS THEN NULL; END;
      BEGIN CREATE INDEX IF NOT EXISTS idx_p2p_orders_buyer_id ON p2p_orders(buyer_id); EXCEPTION WHEN OTHERS THEN NULL; END;
      BEGIN CREATE INDEX IF NOT EXISTS idx_p2p_orders_seller_id ON p2p_orders(seller_id); EXCEPTION WHEN OTHERS THEN NULL; END;
      BEGIN CREATE INDEX IF NOT EXISTS idx_p2p_orders_status ON p2p_orders(status); EXCEPTION WHEN OTHERS THEN NULL; END;
      BEGIN
        CREATE INDEX IF NOT EXISTS idx_p2p_orders_expires ON p2p_orders(expires_at) WHERE status IN ('pending', 'payment_pending');
      EXCEPTION WHEN OTHERS THEN
        BEGIN CREATE INDEX IF NOT EXISTS idx_p2p_orders_expires ON p2p_orders(expires_at); EXCEPTION WHEN OTHERS THEN NULL; END;
      END;
    END IF;
  END $$;`,

  // ============================================
  // P2P DISPUTES TABLE
  // ============================================
  `CREATE TABLE IF NOT EXISTS p2p_disputes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES p2p_orders(id),
    initiator_id UUID NOT NULL REFERENCES users(id),
    reason TEXT NOT NULL,
    evidence TEXT[],
    status VARCHAR(20) NOT NULL DEFAULT 'open'
      CHECK (status IN ('open', 'under_review', 'resolved', 'closed')),
    resolution VARCHAR(20) CHECK (resolution IN ('favor_buyer', 'favor_seller', 'cancelled')),
    admin_id UUID REFERENCES users(id),
    admin_notes TEXT,
    resolved_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`,

  // P2P merchant stats (used by auth verify-otp when creating new users)
  `CREATE TABLE IF NOT EXISTS p2p_merchant_stats (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    total_orders INT DEFAULT 0,
    completed_orders INT DEFAULT 0,
    cancelled_orders INT DEFAULT 0,
    disputed_orders INT DEFAULT 0,
    completion_rate DECIMAL(5,2) DEFAULT 0,
    total_buy_volume DECIMAL(30,8) DEFAULT 0,
    total_sell_volume DECIMAL(30,8) DEFAULT 0,
    total_ratings INT DEFAULT 0,
    positive_ratings INT DEFAULT 0,
    negative_ratings INT DEFAULT 0,
    average_rating DECIMAL(3,2) DEFAULT 0,
    avg_release_time INT DEFAULT 0,
    avg_payment_time INT DEFAULT 0,
    is_merchant BOOLEAN DEFAULT FALSE,
    merchant_since TIMESTAMP WITH TIME ZONE,
    first_trade_at TIMESTAMP WITH TIME ZONE,
    last_active_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  );`,

  `DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'p2p_disputes' AND c.relkind = 'r') THEN
      CREATE INDEX IF NOT EXISTS idx_p2p_disputes_order_id ON p2p_disputes(order_id);
      CREATE INDEX IF NOT EXISTS idx_p2p_disputes_status ON p2p_disputes(status) WHERE status IN ('open', 'under_review');
    END IF;
  END $$;`,

  // ============================================
  // TRANSACTIONS TABLE (optional FKs when tokens/chains are views)
  // ============================================
  `DO $$
  DECLARE
    tokens_is_table BOOLEAN;
    chains_is_table BOOLEAN;
    token_ref TEXT;
    chain_ref TEXT;
    q TEXT;
  BEGIN
    SELECT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'tokens' AND c.relkind = 'r') INTO tokens_is_table;
    SELECT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'chains' AND c.relkind = 'r') INTO chains_is_table;
    token_ref := CASE WHEN tokens_is_table THEN ' REFERENCES tokens(id)' ELSE '' END;
    chain_ref := CASE WHEN chains_is_table THEN ' REFERENCES chains(id)' ELSE '' END;
    q := 'CREATE TABLE IF NOT EXISTS transactions (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id UUID NOT NULL REFERENCES users(id),
      token_id UUID NOT NULL' || token_ref || ',
      type VARCHAR(30) NOT NULL CHECK (type IN (''deposit'', ''withdrawal'', ''trade'', ''fee'', ''p2p_escrow_lock'', ''p2p_escrow_release'', ''p2p_escrow_refund'', ''referral_reward'', ''airdrop'', ''adjustment'')),
      status VARCHAR(20) NOT NULL DEFAULT ''pending'' CHECK (status IN (''pending'', ''confirming'', ''completed'', ''failed'', ''cancelled'')),
      amount DECIMAL(36,18) NOT NULL,
      fee DECIMAL(36,18),
      tx_hash VARCHAR(100),
      chain_id VARCHAR(20)' || chain_ref || ',
      from_address VARCHAR(100),
      to_address VARCHAR(100),
      confirmations INTEGER NOT NULL DEFAULT 0,
      required_confirmations INTEGER NOT NULL DEFAULT 0,
      memo TEXT,
      reference_id UUID,
      reference_type VARCHAR(30),
      metadata JSONB,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at TIMESTAMP WITH TIME ZONE
    )';
    EXECUTE q;
  END $$;`,

  `DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'transactions' AND c.relkind = 'r') THEN
      CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
      CREATE INDEX IF NOT EXISTS idx_transactions_token_id ON transactions(token_id);
      CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
      CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
      CREATE INDEX IF NOT EXISTS idx_transactions_tx_hash ON transactions(tx_hash) WHERE tx_hash IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_transactions_pending ON transactions(chain_id, status) WHERE status IN ('pending', 'confirming');
    END IF;
  END $$;`,

  // ============================================
  // AUDIT LOGS TABLE
  // ============================================
  `CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    action VARCHAR(50) NOT NULL,
    resource_type VARCHAR(50),
    resource_id UUID,
    ip_address INET NOT NULL,
    user_agent TEXT,
    details JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`,

  `DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'audit_logs' AND c.relkind = 'r') THEN
      CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
    END IF;
  END $$;`,

  // Withdrawal lifecycle audit: structured columns (never store private keys)
  `ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS withdrawal_id UUID;`,
  `ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS admin_id UUID;`,
  `ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS token_id UUID;`,
  `ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS chain_id VARCHAR(50);`,
  `ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS amount NUMERIC(36,18);`,
  `ALTER TABLE audit_logs ALTER COLUMN ip_address DROP NOT NULL;`,
  `CREATE INDEX IF NOT EXISTS idx_audit_logs_withdrawal_id ON audit_logs(withdrawal_id) WHERE withdrawal_id IS NOT NULL;`,

  // Partition audit logs by month (for production scale)
  // `CREATE TABLE audit_logs_y2024m01 PARTITION OF audit_logs FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');`,

  // ============================================
  // IMMUTABLE AUDIT LOG (append-only; no UPDATE/DELETE)
  // ============================================
  `DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'audit_actor_type_immutable') THEN
      CREATE TYPE audit_actor_type_immutable AS ENUM ('user', 'admin', 'system');
    END IF;
  END $$;`,
  `DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'audit_action_immutable') THEN
      CREATE TYPE audit_action_immutable AS ENUM (
        'login', 'login_failed', 'logout',
        'password_change', 'password_reset',
        '2fa_enable', '2fa_disable',
        'api_key_create', 'api_key_revoke',
        'withdrawal_request', 'withdrawal_approved', 'withdrawal_rejected', 'withdrawal_completed',
        'withdrawal_address_add', 'withdrawal_address_remove',
        'kyc_submit', 'kyc_approve', 'kyc_reject',
        'device_trust', 'device_revoke',
        'admin_login', 'admin_withdrawal_approve', 'admin_withdrawal_reject',
        'admin_user_lock', 'admin_user_unlock', 'admin_settings_change',
        'system_withdrawal_signed', 'system_balance_adjust'
      );
    END IF;
  END $$;`,
  `CREATE TABLE IF NOT EXISTS audit_logs_immutable (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    request_id VARCHAR(64),
    actor_type audit_actor_type_immutable NOT NULL,
    actor_id UUID,
    action VARCHAR(80) NOT NULL,
    resource_type VARCHAR(50),
    resource_id UUID,
    old_value TEXT,
    new_value TEXT,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`,
  `CREATE INDEX IF NOT EXISTS idx_audit_immutable_actor ON audit_logs_immutable(actor_type, actor_id, created_at DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_audit_immutable_action ON audit_logs_immutable(action, created_at DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_audit_immutable_resource ON audit_logs_immutable(resource_type, resource_id);`,
  `CREATE INDEX IF NOT EXISTS idx_audit_immutable_created ON audit_logs_immutable(created_at DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_audit_immutable_request_id ON audit_logs_immutable(request_id) WHERE request_id IS NOT NULL;`,
  `CREATE OR REPLACE FUNCTION audit_logs_immutable_no_update_delete()
   RETURNS TRIGGER AS $$
   BEGIN
     IF TG_OP = 'UPDATE' THEN
       RAISE EXCEPTION 'audit_logs_immutable: UPDATE not allowed';
     END IF;
     IF TG_OP = 'DELETE' THEN
       RAISE EXCEPTION 'audit_logs_immutable: DELETE not allowed';
     END IF;
     RETURN NULL;
   END;
   $$ LANGUAGE plpgsql;`,
  `DROP TRIGGER IF EXISTS trg_audit_logs_immutable_no_update ON audit_logs_immutable;`,
  `CREATE TRIGGER trg_audit_logs_immutable_no_update
   BEFORE UPDATE ON audit_logs_immutable FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable_no_update_delete();`,
  `DROP TRIGGER IF EXISTS trg_audit_logs_immutable_no_delete ON audit_logs_immutable;`,
  `CREATE TRIGGER trg_audit_logs_immutable_no_delete
   BEFORE DELETE ON audit_logs_immutable FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable_no_update_delete();`,

  // ============================================
  // REFERRAL REWARDS TABLE (optional FKs when trades/tokens are views)
  // ============================================
  `DO $$
  DECLARE
    trades_is_table BOOLEAN;
    tokens_is_table BOOLEAN;
    trade_ref TEXT;
    token_ref TEXT;
    q TEXT;
  BEGIN
    SELECT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'trades' AND c.relkind = 'r') INTO trades_is_table;
    SELECT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'tokens' AND c.relkind = 'r') INTO tokens_is_table;
    trade_ref := CASE WHEN trades_is_table THEN ' REFERENCES trades(id)' ELSE '' END;
    token_ref := CASE WHEN tokens_is_table THEN ' REFERENCES tokens(id)' ELSE '' END;
    q := 'CREATE TABLE IF NOT EXISTS referral_rewards (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      referrer_id UUID NOT NULL REFERENCES users(id),
      referee_id UUID NOT NULL REFERENCES users(id),
      trade_id UUID' || trade_ref || ',
      reward_amount DECIMAL(36,18) NOT NULL,
      token_id UUID NOT NULL' || token_ref || ',
      status VARCHAR(20) NOT NULL DEFAULT ''pending'' CHECK (status IN (''pending'', ''credited'', ''failed'')),
      credited_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
    )';
    EXECUTE q;
  END $$;`,

  `DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'referral_rewards' AND c.relkind = 'r') THEN
      CREATE INDEX IF NOT EXISTS idx_referral_rewards_referrer ON referral_rewards(referrer_id);
      CREATE INDEX IF NOT EXISTS idx_referral_rewards_referee ON referral_rewards(referee_id);
    END IF;
  END $$;`,

  // ============================================
  // RATE LIMITS TABLE
  // ============================================
  `CREATE TABLE IF NOT EXISTS rate_limit_overrides (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    ip_address INET,
    endpoint VARCHAR(255),
    max_requests INTEGER NOT NULL,
    window_seconds INTEGER NOT NULL,
    reason TEXT,
    created_by UUID REFERENCES users(id),
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (user_id IS NOT NULL OR ip_address IS NOT NULL)
  );`,

  // ============================================
  // SYSTEM SETTINGS TABLE
  // ============================================
  `CREATE TABLE IF NOT EXISTS system_settings (
    key VARCHAR(100) PRIMARY KEY,
    value JSONB NOT NULL,
    description TEXT,
    updated_by UUID REFERENCES users(id),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`,

  // ============================================
  // INSERT DEFAULT DATA
  // ============================================
  
  // Insert chains (idempotent). Skip or use minimal columns if chains is a view or has different schema.
  `DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'chains' AND column_name = 'confirmations_required') THEN
      INSERT INTO chains (id, name, type, native_currency, decimals, rpc_url, explorer_url, confirmations_required, avg_block_time)
      VALUES
        ('eth', 'Ethereum', 'evm', 'ETH', 18, 'https://eth-mainnet.g.alchemy.com/v2/demo', 'https://etherscan.io', 12, 12),
        ('ethereum', 'Ethereum', 'evm', 'ETH', 18, 'https://eth-mainnet.g.alchemy.com/v2/demo', 'https://etherscan.io', 12, 12),
        ('bsc', 'BNB Smart Chain', 'evm', 'BNB', 18, 'https://bsc-dataseed.binance.org', 'https://bscscan.com', 15, 3),
        ('polygon', 'Polygon', 'evm', 'MATIC', 18, 'https://polygon-rpc.com', 'https://polygonscan.com', 128, 2),
        ('arbitrum', 'Arbitrum One', 'evm', 'ETH', 18, 'https://arb1.arbitrum.io/rpc', 'https://arbiscan.io', 12, 1),
        ('optimism', 'Optimism', 'evm', 'ETH', 18, 'https://mainnet.optimism.io', 'https://optimistic.etherscan.io', 12, 2),
        ('base', 'Base', 'evm', 'ETH', 18, 'https://mainnet.base.org', 'https://basescan.org', 12, 2),
        ('solana', 'Solana', 'solana', 'SOL', 9, 'https://api.mainnet-beta.solana.com', 'https://solscan.io', 32, 1),
        ('tron', 'Tron', 'tron', 'TRX', 6, 'https://api.trongrid.io', 'https://tronscan.org', 19, 3),
        ('bitcoin', 'Bitcoin', 'bitcoin', 'BTC', 8, 'http://localhost:8332', 'https://blockstream.info', 6, 600)
      ON CONFLICT (id) DO NOTHING;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END $$;`,

  // Add polkadot to chains type and insert Polkadot chain
  `DO $$
  DECLARE
    conname text;
  BEGIN
    SELECT c.conname INTO conname FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'chains' AND c.contype = 'c' AND c.conname LIKE '%type%' LIMIT 1;
    IF conname IS NOT NULL THEN
      EXECUTE format('ALTER TABLE chains DROP CONSTRAINT IF EXISTS %I', conname);
    END IF;
    ALTER TABLE chains ADD CONSTRAINT chains_type_check CHECK (type IN ('evm', 'solana', 'tron', 'bitcoin', 'polkadot'));
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END $$;`,
  `INSERT INTO chains (id, name, type, native_currency, decimals, rpc_url, explorer_url, confirmations_required, avg_block_time)
   VALUES ('polkadot', 'Polkadot', 'polkadot', 'DOT', 10, 'https://rpc.polkadot.io', 'https://polkascan.io/polkadot', 12, 6)
   ON CONFLICT (id) DO NOTHING;`,

  // Insert tokens (native + major stablecoins). Skip if tokens is a view or schema differs.
  `DO $$
  BEGIN
    INSERT INTO tokens (id, symbol, name, chain_id, contract_address, decimals, is_active, is_native, min_deposit, min_withdrawal, withdrawal_fee)
    VALUES
      (uuid_generate_v4(), 'ETH', 'Ethereum', 'ethereum', NULL, 18, true, true, 0.001, 0.001, 0.0005),
      (uuid_generate_v4(), 'BNB', 'BNB', 'bsc', NULL, 18, true, true, 0.01, 0.01, 0.0005),
      (uuid_generate_v4(), 'MATIC', 'Polygon', 'polygon', NULL, 18, true, true, 1, 1, 0.1),
      (uuid_generate_v4(), 'SOL', 'Solana', 'solana', NULL, 9, true, true, 0.01, 0.01, 0.001),
      (uuid_generate_v4(), 'TRX', 'Tron', 'tron', NULL, 6, true, true, 10, 10, 1),
      (uuid_generate_v4(), 'BTC', 'Bitcoin', 'bitcoin', NULL, 8, true, true, 0.0001, 0.0001, 0.00005),
      (uuid_generate_v4(), 'USDT', 'Tether USD', 'ethereum', '0xdAC17F958D2ee523a2206206994597C13D831ec7', 6, true, false, 10, 10, 5),
      (uuid_generate_v4(), 'USDT', 'Tether USD', 'bsc', '0x55d398326f99059fF775485246999027B3197955', 18, true, false, 10, 10, 1),
      (uuid_generate_v4(), 'USDT', 'Tether USD', 'polygon', '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', 6, true, false, 10, 10, 1),
      (uuid_generate_v4(), 'USDT', 'Tether USD', 'tron', 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', 6, true, false, 10, 10, 1),
      (uuid_generate_v4(), 'USDT', 'Tether USD', 'arbitrum', '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', 6, true, false, 10, 10, 1),
      (uuid_generate_v4(), 'USDC', 'USD Coin', 'ethereum', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 6, true, false, 10, 10, 5),
      (uuid_generate_v4(), 'USDC', 'USD Coin', 'bsc', '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', 18, true, false, 10, 10, 1),
      (uuid_generate_v4(), 'USDC', 'USD Coin', 'polygon', '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', 6, true, false, 10, 10, 1),
      (uuid_generate_v4(), 'USDC', 'USD Coin', 'arbitrum', '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', 6, true, false, 10, 10, 1),
      (uuid_generate_v4(), 'USDC', 'USD Coin', 'base', '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 6, true, false, 10, 10, 1),
      (uuid_generate_v4(), 'DOT', 'Polkadot', 'polkadot', NULL, 10, true, true, 0.1, 0.1, 0.01)
    ON CONFLICT DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END $$;`,

  // Insert default system settings
  `INSERT INTO system_settings (key, value, description)
   VALUES
     ('trading_enabled', 'true', 'Global trading enable/disable'),
     ('p2p_enabled', 'true', 'P2P trading enable/disable'),
     ('withdrawals_enabled', 'true', 'Withdrawals enable/disable'),
     ('deposits_enabled', 'true', 'Deposits enable/disable'),
     ('kyc_required_for_trading', 'false', 'Require KYC for trading'),
     ('kyc_required_for_withdrawal', 'true', 'Require KYC for withdrawals'),
     ('max_daily_withdrawal_usd', '10000', 'Max daily withdrawal in USD equivalent'),
     ('referral_reward_percentage', '0.1', 'Referral reward percentage of trading fees'),
     ('maintenance_mode', 'false', 'System maintenance mode')
   ON CONFLICT (key) DO NOTHING;`,

  // ============================================
  // FEE TIERS TABLE
  // ============================================
  `CREATE TABLE IF NOT EXISTS fee_tiers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tier_name VARCHAR(50) NOT NULL,
    tier_level INT UNIQUE NOT NULL,
    min_trading_volume DECIMAL(30,8) NOT NULL DEFAULT 0,
    min_token_holding DECIMAL(30,8) DEFAULT 0,
    spot_maker_fee DECIMAL(5,4) NOT NULL DEFAULT 0.001,
    spot_taker_fee DECIMAL(5,4) NOT NULL DEFAULT 0.001,
    withdrawal_fee_discount DECIMAL(5,4) DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  );`,
  `INSERT INTO fee_tiers (tier_name, tier_level, min_trading_volume, spot_maker_fee, spot_taker_fee)
   SELECT 'Regular', 0, 0, 0.001, 0.001 WHERE NOT EXISTS (SELECT 1 FROM fee_tiers LIMIT 1);`,

  // ============================================
  // FEE PROMOTIONS TABLE
  // ============================================
  `CREATE TABLE IF NOT EXISTS fee_promotions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    promotion_type VARCHAR(50) NOT NULL CHECK (promotion_type IN ('spot_maker', 'spot_taker', 'spot_both', 'withdrawal', 'p2p_maker', 'p2p_taker')),
    discount_type VARCHAR(20) NOT NULL DEFAULT 'percentage' CHECK (discount_type IN ('percentage', 'fixed_rate')),
    discount_value DECIMAL(10,6) NOT NULL,
    min_volume_30d DECIMAL(30,8) DEFAULT 0,
    start_date TIMESTAMP WITH TIME ZONE NOT NULL,
    end_date TIMESTAMP WITH TIME ZONE NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  );`,

  // ============================================
  // NOTIFICATIONS: enum + user_notifications, system_announcements, email_templates, sms_templates
  // ============================================
  `DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_type') THEN
      CREATE TYPE notification_type AS ENUM (
        'deposit_confirmed', 'withdrawal_processed',
        'order_filled', 'order_cancelled',
        'p2p_new_order', 'p2p_payment_received', 'p2p_completed',
        'kyc_approved', 'kyc_rejected',
        'security_alert', 'system_announcement',
        'referral_commission', 'promotion'
      );
    END IF;
  END $$;`,
  `CREATE TABLE IF NOT EXISTS user_notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    notification_type notification_type NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    data JSONB,
    is_read BOOLEAN DEFAULT FALSE,
    read_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  );`,
  `CREATE INDEX IF NOT EXISTS idx_user_notifications_user_id ON user_notifications(user_id);`,
  `CREATE INDEX IF NOT EXISTS idx_user_notifications_unread ON user_notifications(user_id, is_read);`,
  `CREATE TABLE IF NOT EXISTS system_announcements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(500) NOT NULL,
    body TEXT,
    summary VARCHAR(1000),
    type VARCHAR(50) NOT NULL DEFAULT 'general' CHECK (type IN ('general', 'maintenance', 'security', 'listing', 'product', 'critical')),
    is_pinned BOOLEAN DEFAULT FALSE,
    is_published BOOLEAN DEFAULT TRUE,
    published_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by UUID
  );`,
  `CREATE INDEX IF NOT EXISTS idx_system_announcements_published ON system_announcements(is_published, published_at DESC);`,
  `CREATE TABLE IF NOT EXISTS email_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    slug VARCHAR(100) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    subject VARCHAR(500) NOT NULL,
    body_html TEXT NOT NULL,
    body_text TEXT,
    variables JSONB DEFAULT '[]',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  );`,
  `CREATE TABLE IF NOT EXISTS sms_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    slug VARCHAR(100) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    variables JSONB DEFAULT '[]',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  );`,

  // ============================================
  // API SETTINGS TABLE
  // ============================================
  `CREATE TABLE IF NOT EXISTS api_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    category VARCHAR(50) NOT NULL,
    provider VARCHAR(50) NOT NULL,
    name VARCHAR(100) NOT NULL,
    api_key TEXT,
    api_secret TEXT,
    api_url TEXT,
    additional_config JSONB DEFAULT '{}',
    is_active BOOLEAN NOT NULL DEFAULT FALSE,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(category, provider)
  );`,

  `CREATE INDEX IF NOT EXISTS idx_api_settings_category ON api_settings(category);`,
  `CREATE INDEX IF NOT EXISTS idx_api_settings_active ON api_settings(category, is_active) WHERE is_active = TRUE;`,

  `DROP TRIGGER IF EXISTS update_api_settings_updated_at ON api_settings;
   CREATE TRIGGER update_api_settings_updated_at
   BEFORE UPDATE ON api_settings
   FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();`,

  // Seed api_settings for SMS OTP (admin fills api_key/api_secret and sets is_active = true)
  `INSERT INTO api_settings (category, provider, name, is_active, is_default) VALUES ('sms', 'fast2sms', 'Fast2SMS', FALSE, TRUE) ON CONFLICT (category, provider) DO NOTHING;`,
  `INSERT INTO api_settings (category, provider, name, is_active, is_default) VALUES ('sms', 'twilio', 'Twilio SMS', FALSE, FALSE) ON CONFLICT (category, provider) DO NOTHING;`,

  // ============================================
  // FEATURE TOGGLES TABLE
  // ============================================
  `CREATE TABLE IF NOT EXISTS feature_toggles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    feature_key VARCHAR(100) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    config JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`,

  `CREATE INDEX IF NOT EXISTS idx_feature_toggles_key ON feature_toggles(feature_key);`,

  // Backfill currencies so deposits.currency_id exists (avoids user_balances_currency_id_fkey)
  `DO $$
  DECLARE
    has_ub int; has_c int; has_d int; has_t int;
  BEGIN
    SELECT COUNT(*) INTO has_ub FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'user_balances';
    SELECT COUNT(*) INTO has_c FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'currencies';
    SELECT COUNT(*) INTO has_d FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'deposits';
    SELECT COUNT(*) INTO has_t FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'tokens';
    IF has_ub > 0 AND has_c > 0 AND has_d > 0 AND has_t > 0 THEN
      INSERT INTO currencies (id, symbol, name, currency_type, blockchain_id, contract_address, decimals)
      SELECT t.id, t.symbol, t.name, 'crypto'::currency_type, NULL, t.contract_address, t.decimals
      FROM tokens t
      WHERE t.id IN (SELECT d.currency_id FROM deposits d WHERE d.currency_id IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM currencies c WHERE c.id = t.id)
      ON CONFLICT (id) DO NOTHING;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END $$;`,

  // ============================================
  // USER SECURITY SETTINGS COLUMNS
  // ============================================
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS sms_auth_enabled BOOLEAN DEFAULT FALSE;`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS email_auth_enabled BOOLEAN DEFAULT TRUE;`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS passkeys_enabled BOOLEAN DEFAULT FALSE;`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS fund_password_hash VARCHAR(255);`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS anti_phishing_code VARCHAR(50);`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS withdrawal_whitelist_enabled BOOLEAN DEFAULT FALSE;`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS address_book_enabled BOOLEAN DEFAULT FALSE;`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret VARCHAR(255);`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN DEFAULT FALSE;`,

  // ============================================
  // USER PASSKEYS TABLE
  // ============================================
  `CREATE TABLE IF NOT EXISTS user_passkeys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credential_id TEXT NOT NULL UNIQUE,
    public_key TEXT NOT NULL,
    counter INTEGER NOT NULL DEFAULT 0,
    device_name VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at TIMESTAMP WITH TIME ZONE
  );`,

  `CREATE INDEX IF NOT EXISTS idx_user_passkeys_user_id ON user_passkeys(user_id);`,
  `CREATE INDEX IF NOT EXISTS idx_user_passkeys_credential_id ON user_passkeys(credential_id);`,

  // ============================================
  // LOGIN VERIFICATION TOKENS TABLE
  // ============================================
  `CREATE TABLE IF NOT EXISTS login_verification_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(255) NOT NULL UNIQUE,
    login_method VARCHAR(20) NOT NULL CHECK (login_method IN ('email', 'phone', 'passkey')),
    steps_completed JSONB DEFAULT '[]',
    steps_required JSONB DEFAULT '[]',
    current_step INTEGER NOT NULL DEFAULT 0,
    ip_address INET,
    user_agent TEXT,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`,

  `CREATE INDEX IF NOT EXISTS idx_login_verification_token ON login_verification_tokens(token) WHERE completed_at IS NULL;`,
  `CREATE INDEX IF NOT EXISTS idx_login_verification_user_id ON login_verification_tokens(user_id);`,

  // ============================================
  // HOT WALLETS TABLE (admin MPC-like hot wallet per chain). Optional chains FK if chains is view.
  // ============================================
  `DO $$
  DECLARE
    chains_is_table BOOLEAN;
    chain_ref TEXT;
    q TEXT;
  BEGIN
    SELECT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'chains' AND c.relkind = 'r') INTO chains_is_table;
    chain_ref := CASE WHEN chains_is_table THEN ' REFERENCES chains(id) ON DELETE CASCADE' ELSE '' END;
    q := 'CREATE TABLE IF NOT EXISTS hot_wallets (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      chain_id VARCHAR(64) NOT NULL' || chain_ref || ',
      address VARCHAR(255) NOT NULL,
      encrypted_private_key TEXT NOT NULL,
      balance_cache DECIMAL(36,18) NOT NULL DEFAULT 0,
      min_balance_alert DECIMAL(36,18) NOT NULL DEFAULT 0,
      min_hot_balance DECIMAL(36,18) NOT NULL DEFAULT 0,
      cold_wallet_address VARCHAR(255),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(chain_id)
    )';
    EXECUTE q;
  END $$;`,
  `DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'hot_wallets' AND c.relkind = 'r') THEN
      ALTER TABLE hot_wallets ALTER COLUMN chain_id TYPE VARCHAR(64);
      CREATE INDEX IF NOT EXISTS idx_hot_wallets_chain_id ON hot_wallets(chain_id);
      CREATE INDEX IF NOT EXISTS idx_hot_wallets_active ON hot_wallets(is_active) WHERE is_active = TRUE;
      ALTER TABLE hot_wallets ADD COLUMN IF NOT EXISTS min_hot_balance DECIMAL(36,18) NOT NULL DEFAULT 0;
      ALTER TABLE hot_wallets ADD COLUMN IF NOT EXISTS cold_wallet_address VARCHAR(255);
      ALTER TABLE hot_wallets ADD COLUMN IF NOT EXISTS last_sweep_tx_hash VARCHAR(255);
      ALTER TABLE hot_wallets ADD COLUMN IF NOT EXISTS last_sweep_at TIMESTAMP WITH TIME ZONE;
      ALTER TABLE hot_wallets ADD COLUMN IF NOT EXISTS max_single_tx DECIMAL(36,18);
      ALTER TABLE hot_wallets ADD COLUMN IF NOT EXISTS max_daily_outflow DECIMAL(36,18);
      ALTER TABLE hot_wallets ADD COLUMN IF NOT EXISTS encrypted_dek TEXT;
      ALTER TABLE hot_wallets ADD COLUMN IF NOT EXISTS key_version VARCHAR(20);
      DROP TRIGGER IF EXISTS update_hot_wallets_updated_at ON hot_wallets;
      CREATE TRIGGER update_hot_wallets_updated_at BEFORE UPDATE ON hot_wallets FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
  END $$;`,

  // HOT WALLET AUDIT: every action with actor_id, payload_hash, no plaintext secrets
  `CREATE TABLE IF NOT EXISTS hot_wallet_audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    actor_id VARCHAR(255) NOT NULL,
    actor_type VARCHAR(20) NOT NULL DEFAULT 'admin',
    action VARCHAR(80) NOT NULL,
    resource_type VARCHAR(50),
    resource_id VARCHAR(255),
    payload_hash VARCHAR(64),
    ip_address INET,
    user_agent TEXT,
    details JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`,
  `CREATE INDEX IF NOT EXISTS idx_hot_wallet_audit_actor ON hot_wallet_audit_log(actor_id);`,
  `CREATE INDEX IF NOT EXISTS idx_hot_wallet_audit_action ON hot_wallet_audit_log(action);`,
  `CREATE INDEX IF NOT EXISTS idx_hot_wallet_audit_created ON hot_wallet_audit_log(created_at DESC);`,

  // DEPOSIT SWEEPS: user deposit address → hot wallet consolidation (idempotent by chain_id + from_address)
  `CREATE TABLE IF NOT EXISTS deposit_sweeps (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    chain_id VARCHAR(64) NOT NULL,
    from_address VARCHAR(255) NOT NULL,
    to_address VARCHAR(255) NOT NULL,
    amount DECIMAL(36,18) NOT NULL DEFAULT 0,
    amount_raw TEXT,
    tx_hash VARCHAR(255),
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE,
    UNIQUE(chain_id, from_address)
  );`,
  `CREATE INDEX IF NOT EXISTS idx_deposit_sweeps_chain_status ON deposit_sweeps(chain_id, status);`,
  `CREATE INDEX IF NOT EXISTS idx_deposit_sweeps_created ON deposit_sweeps(created_at DESC);`,

  // WITHDRAWAL SIGNING QUEUE: async, rate-limited, idempotent. Optional chains FK if chains is view.
  `DO $$
  DECLARE
    chains_is_table BOOLEAN;
    chain_ref TEXT;
    q TEXT;
  BEGIN
    SELECT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'chains' AND c.relkind = 'r') INTO chains_is_table;
    chain_ref := CASE WHEN chains_is_table THEN ' REFERENCES chains(id)' ELSE '' END;
    q := 'CREATE TABLE IF NOT EXISTS withdrawal_signing_queue (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      withdrawal_id UUID NOT NULL,
      chain_id VARCHAR(20) NOT NULL' || chain_ref || ',
      status VARCHAR(20) NOT NULL DEFAULT ''pending'' CHECK (status IN (''pending'', ''signing'', ''broadcast'', ''completed'', ''failed'')),
      idempotency_key VARCHAR(255) UNIQUE,
      signed_tx_hex TEXT,
      tx_hash VARCHAR(255),
      error_message TEXT,
      attempts INT NOT NULL DEFAULT 0,
      max_attempts INT NOT NULL DEFAULT 3,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
      processed_at TIMESTAMP WITH TIME ZONE
    )';
    EXECUTE q;
  END $$;`,
  `CREATE INDEX IF NOT EXISTS idx_withdrawal_signing_queue_status ON withdrawal_signing_queue(status) WHERE status IN ('pending', 'signing', 'broadcast');`,
  `CREATE INDEX IF NOT EXISTS idx_withdrawal_signing_queue_withdrawal ON withdrawal_signing_queue(withdrawal_id);`,

  // ============================================
  // WITHDRAWALS TABLE. Optional tokens/chains FKs when they are views.
  // ============================================
  `DO $$
  DECLARE
    tokens_is_table BOOLEAN;
    chains_is_table BOOLEAN;
    token_ref TEXT;
    chain_ref TEXT;
    q TEXT;
  BEGIN
    SELECT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'tokens' AND c.relkind = 'r') INTO tokens_is_table;
    SELECT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'chains' AND c.relkind = 'r') INTO chains_is_table;
    token_ref := CASE WHEN tokens_is_table THEN ' REFERENCES tokens(id)' ELSE '' END;
    chain_ref := CASE WHEN chains_is_table THEN ' REFERENCES chains(id)' ELSE '' END;
    q := 'CREATE TABLE IF NOT EXISTS withdrawals (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_id UUID NOT NULL' || token_ref || ',
      chain_id VARCHAR(20) NOT NULL' || chain_ref || ',
      amount DECIMAL(36,18) NOT NULL,
      fee DECIMAL(36,18) NOT NULL DEFAULT 0,
      net_amount DECIMAL(36,18),
      to_address VARCHAR(255) NOT NULL,
      tx_hash VARCHAR(255),
      memo VARCHAR(255),
      status VARCHAR(50) NOT NULL DEFAULT ''pending'',
      account_type VARCHAR(50) NOT NULL DEFAULT ''funding'',
      email_verified BOOLEAN NOT NULL DEFAULT FALSE,
      two_fa_verified BOOLEAN NOT NULL DEFAULT FALSE,
      withdrawal_address_id UUID,
      processed_at TIMESTAMP WITH TIME ZONE,
      completed_at TIMESTAMP WITH TIME ZONE,
      failed_reason TEXT,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
    )';
    EXECUTE q;
  END $$;`,
  `CREATE INDEX IF NOT EXISTS idx_withdrawals_user_id ON withdrawals(user_id);`,
  `CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status);`,
  `CREATE INDEX IF NOT EXISTS idx_withdrawals_created_at ON withdrawals(created_at DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_withdrawals_tx_hash ON withdrawals(tx_hash) WHERE tx_hash IS NOT NULL;`,

  // ============================================
  // WITHDRAWAL SECURITY COLUMNS (withdrawals + users)
  // ============================================
  `ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE;`,
  `ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS two_fa_verified BOOLEAN NOT NULL DEFAULT FALSE;`,
  `ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS withdrawal_address_id UUID;`,
  `ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS net_amount DECIMAL(36,18);`,
  `ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP WITH TIME ZONE;`,
  `ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS failed_reason TEXT;`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_withdrawal_limit DECIMAL(36,18) DEFAULT 1000000;`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS monthly_withdrawal_limit DECIMAL(36,18) DEFAULT 10000000;`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_withdrawal_used DECIMAL(36,18) DEFAULT 0;`,

  // ============================================
  // WITHDRAWAL ADDRESSES (whitelist per user)
  // ============================================
  `CREATE TABLE IF NOT EXISTS withdrawal_addresses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    asset VARCHAR(20),
    network VARCHAR(50),
    address VARCHAR(255),
    note VARCHAR(255),
    memo VARCHAR(255),
    address_type VARCHAR(30) DEFAULT 'onchain',
    wallet_type VARCHAR(30) DEFAULT 'regular',
    save_as_universal BOOLEAN DEFAULT FALSE,
    no_verification_needed BOOLEAN DEFAULT FALSE,
    recipient_account VARCHAR(255),
    recipient_type VARCHAR(50),
    is_whitelisted BOOLEAN DEFAULT FALSE,
    deleted_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`,
  `CREATE INDEX IF NOT EXISTS idx_withdrawal_addresses_user ON withdrawal_addresses(user_id) WHERE deleted_at IS NULL;`,
  `CREATE INDEX IF NOT EXISTS idx_withdrawal_addresses_address ON withdrawal_addresses(user_id, address) WHERE deleted_at IS NULL;`,

  // ============================================
  // ADMIN USERS (separate from app users; for admin panel login)
  // ============================================
  `CREATE TABLE IF NOT EXISTS admin_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'admin',
    permissions TEXT[] NOT NULL DEFAULT '{}',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`,
  `CREATE INDEX IF NOT EXISTS idx_admin_users_email ON admin_users(email);`,
  `CREATE INDEX IF NOT EXISTS idx_admin_users_active ON admin_users(is_active) WHERE is_active = TRUE;`,

  // system_announcements.created_by FK (table is created earlier; admin_users must exist first)
  `DO $$
  BEGIN
    IF to_regclass('public.system_announcements') IS NOT NULL
       AND to_regclass('public.admin_users') IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         WHERE t.relname = 'system_announcements' AND c.conname = 'system_announcements_created_by_fkey'
       ) THEN
      ALTER TABLE system_announcements
        ADD CONSTRAINT system_announcements_created_by_fkey
        FOREIGN KEY (created_by) REFERENCES admin_users(id);
    END IF;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_column THEN NULL;
    WHEN undefined_table THEN NULL;
  END $$;`,

  // ============================================
  // ADMIN SESSIONS
  // ============================================
  `CREATE TABLE IF NOT EXISTS admin_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    admin_id UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
    session_token VARCHAR(255) NOT NULL,
    ip_address INET,
    user_agent TEXT,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`,
  `CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin_id ON admin_sessions(admin_id);`,
  `CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires ON admin_sessions(expires_at);`,

  // ============================================
  // ADMIN ACTIVITY LOGS
  // ============================================
  `CREATE TABLE IF NOT EXISTS admin_activity_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    admin_id UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
    action VARCHAR(80) NOT NULL,
    details JSONB,
    ip_address INET,
    user_agent TEXT,
    device_id VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`,
  `CREATE INDEX IF NOT EXISTS idx_admin_activity_logs_admin_id ON admin_activity_logs(admin_id);`,
  `CREATE INDEX IF NOT EXISTS idx_admin_activity_logs_created ON admin_activity_logs(created_at DESC);`,
  `ALTER TABLE admin_activity_logs ADD COLUMN IF NOT EXISTS user_agent TEXT;`,
  `ALTER TABLE admin_activity_logs ADD COLUMN IF NOT EXISTS device_id VARCHAR(255);`,
  `CREATE INDEX IF NOT EXISTS idx_admin_activity_logs_admin_created ON admin_activity_logs(admin_id, created_at DESC);`,

  // ============================================
  // SECURITY IP RULES (whitelist/blacklist, geo)
  // ============================================
  `CREATE TABLE IF NOT EXISTS security_ip_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    scope VARCHAR(20) NOT NULL CHECK (scope IN ('admin', 'user')),
    rule_type VARCHAR(20) NOT NULL CHECK (rule_type IN ('whitelist', 'blacklist')),
    ip_cidr VARCHAR(45),
    country_code VARCHAR(2),
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT security_ip_rules_cidr_or_country CHECK (ip_cidr IS NOT NULL OR country_code IS NOT NULL)
  );`,
  `CREATE INDEX IF NOT EXISTS idx_security_ip_rules_scope_enabled ON security_ip_rules(scope, enabled) WHERE enabled = TRUE;`,
  `CREATE INDEX IF NOT EXISTS idx_security_ip_rules_scope_type ON security_ip_rules(scope, rule_type) WHERE enabled = TRUE;`,
  `CREATE INDEX IF NOT EXISTS idx_security_ip_rules_country ON security_ip_rules(scope, country_code) WHERE enabled = TRUE AND country_code IS NOT NULL;`,

  // ============================================
  // SECURITY RISK ENGINE
  // ============================================
  `CREATE TABLE IF NOT EXISTS security_risk_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    scope VARCHAR(30) NOT NULL CHECK (scope IN ('login', 'withdrawal', 'p2p', 'api', 'admin')),
    min_score INTEGER NOT NULL DEFAULT 0 CHECK (min_score >= 0 AND min_score <= 100),
    max_score INTEGER NOT NULL DEFAULT 100 CHECK (max_score >= 0 AND max_score <= 100),
    decision VARCHAR(20) NOT NULL CHECK (decision IN ('allow', 'challenge', 'block')),
    priority INTEGER NOT NULL DEFAULT 0,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT security_risk_rules_score_range CHECK (min_score <= max_score)
  );`,
  `CREATE INDEX IF NOT EXISTS idx_security_risk_rules_scope_enabled ON security_risk_rules(scope, enabled) WHERE enabled = TRUE;`,
  `CREATE INDEX IF NOT EXISTS idx_security_risk_rules_priority ON security_risk_rules(scope, priority DESC) WHERE enabled = TRUE;`,

  `CREATE TABLE IF NOT EXISTS security_risk_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    actor_type VARCHAR(20) NOT NULL,
    actor_id VARCHAR(255),
    scope VARCHAR(30) NOT NULL,
    score INTEGER NOT NULL CHECK (score >= 0 AND score <= 100),
    decision VARCHAR(20) NOT NULL CHECK (decision IN ('allow', 'challenge', 'block')),
    signals JSONB,
    request_id VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`,
  `CREATE INDEX IF NOT EXISTS idx_security_risk_events_actor ON security_risk_events(actor_type, actor_id, created_at DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_security_risk_events_scope ON security_risk_events(scope, created_at DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_security_risk_events_request ON security_risk_events(request_id) WHERE request_id IS NOT NULL;`,

  // ============================================
  // DEFAULT ADMIN USER (only if no admin exists). Password: admin123
  // ============================================
  `DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM admin_users LIMIT 1) THEN
      INSERT INTO admin_users (id, email, password_hash, name, role, permissions, is_active)
      VALUES (
        uuid_generate_v4(),
        'admin@example.com',
        crypt('admin123', gen_salt('bf')),
        'Super Admin',
        'super_admin',
        ARRAY['all']::text[],
        TRUE
      );
    END IF;
  END $$;`,

  // ============================================
  // WITHDRAWAL ADMIN APPROVAL (pending_approval → approved → signed)
  // ============================================
  `ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES admin_users(id);`,
  `ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP WITH TIME ZONE;`,
  `ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS rejected_by UUID REFERENCES admin_users(id);`,
  `ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMP WITH TIME ZONE;`,
  `ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS rejection_reason TEXT;`,
  `CREATE INDEX IF NOT EXISTS idx_withdrawals_pending_approval ON withdrawals(status) WHERE status = 'pending_approval';`,
  `ALTER TABLE tokens ADD COLUMN IF NOT EXISTS is_high_risk BOOLEAN NOT NULL DEFAULT FALSE;`,

  // Withdrawal type: onchain | internal; internal_user_id for internal transfers; to_address nullable for internal
  `ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS type VARCHAR(20) NOT NULL DEFAULT 'onchain';`,
  `ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS internal_user_id UUID REFERENCES users(id);`,
  `DO $$ BEGIN ALTER TABLE withdrawals ALTER COLUMN to_address DROP NOT NULL; EXCEPTION WHEN OTHERS THEN NULL; END $$;`,

  // withdrawals may have been created with currency_id/blockchain_id (full-schema); ensure token_id/chain_id exist for wallet API
  `ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS token_id UUID;`,
  `ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS chain_id VARCHAR(50);`,
  `ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS account_type VARCHAR(50) NOT NULL DEFAULT 'funding';`,
  `ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS memo TEXT;`,
  `DO $$ BEGIN ALTER TABLE withdrawals ALTER COLUMN token_id DROP NOT NULL; EXCEPTION WHEN OTHERS THEN NULL; END $$;`,
  `DO $$ BEGIN ALTER TABLE withdrawals ALTER COLUMN chain_id DROP NOT NULL; EXCEPTION WHEN OTHERS THEN NULL; END $$;`,
  `DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'withdrawals' AND column_name = 'currency_id') THEN ALTER TABLE withdrawals ALTER COLUMN currency_id DROP NOT NULL; END IF; END $$;`,
  `DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'withdrawals' AND column_name = 'blockchain_id') THEN ALTER TABLE withdrawals ALTER COLUMN blockchain_id DROP NOT NULL; END IF; END $$;`,

  // ============================================
  // HARD GUARD: Only pending withdrawals can be enqueued for signing
  // ============================================
  `CREATE OR REPLACE FUNCTION check_withdrawal_pending_before_queue_insert()
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
   $$ LANGUAGE plpgsql;`,
  `DROP TRIGGER IF EXISTS trg_withdrawal_queue_only_pending ON withdrawal_signing_queue;`,
  `CREATE TRIGGER trg_withdrawal_queue_only_pending
   BEFORE INSERT ON withdrawal_signing_queue
   FOR EACH ROW
   EXECUTE FUNCTION check_withdrawal_pending_before_queue_insert();`,

  // ============================================
  // ENUM balance_account_type: must exist before ADD VALUE or user_balances (if created elsewhere)
  // ============================================
  `DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'balance_account_type') THEN
      CREATE TYPE balance_account_type AS ENUM ('funding', 'trading');
    END IF;
  END $$;`,
  // ============================================
  // FREEZE BALANCE FOUNDATION: user_balances as single source of truth
  // Add 'spot' to enum; add chain_id and unique (user_id, currency_id, chain_id, account_type)
  // ============================================
  `DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_enum e
      JOIN pg_type t ON e.enumtypid = t.oid
      WHERE t.typname = 'balance_account_type'
        AND e.enumlabel = 'spot'
    ) THEN
      ALTER TYPE balance_account_type ADD VALUE 'spot';
    END IF;
  END $$;`,
  `DO $$
   BEGIN
     IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'user_balances') THEN
       IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'user_balances' AND column_name = 'chain_id') THEN
         ALTER TABLE user_balances ADD COLUMN chain_id VARCHAR(20) NOT NULL DEFAULT '';
       END IF;
       ALTER TABLE user_balances DROP CONSTRAINT IF EXISTS user_balances_user_id_currency_id_account_type_key;
       ALTER TABLE user_balances DROP CONSTRAINT IF EXISTS user_balances_user_id_currency_id_key;
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_balances_user_currency_chain_account_key') THEN
         ALTER TABLE user_balances ADD CONSTRAINT user_balances_user_currency_chain_account_key UNIQUE (user_id, currency_id, chain_id, account_type);
       END IF;
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_balances_available_non_negative') THEN
         ALTER TABLE user_balances ADD CONSTRAINT user_balances_available_non_negative CHECK (available_balance >= 0);
       END IF;
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_balances_locked_non_negative') THEN
         ALTER TABLE user_balances ADD CONSTRAINT user_balances_locked_non_negative CHECK (locked_balance >= 0);
       END IF;
     END IF;
   END $$;`,
  // Track when a completed deposit has been applied to user_balances (avoids double-credit on repair).
  `ALTER TABLE deposits ADD COLUMN IF NOT EXISTS balance_applied_at TIMESTAMP WITH TIME ZONE;`,

  // Tier-1 compliance: sanctions screening — flagged deposits are not credited.
  `ALTER TABLE deposits ADD COLUMN IF NOT EXISTS is_flagged BOOLEAN DEFAULT FALSE;`,
  `ALTER TABLE deposits ADD COLUMN IF NOT EXISTS flagged_reason TEXT;`,

  // FIX #2: Prevent double deposit credit — UNIQUE(chain_id|blockchain_id, tx_hash, to_address). Idempotent; no data dropped.
  `DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deposits_unique_chain_tx_to' AND conrelid = 'deposits'::regclass) THEN
      RETURN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'deposits') THEN
      RETURN;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'deposits' AND column_name = 'chain_id') THEN
      ALTER TABLE deposits ADD CONSTRAINT deposits_unique_chain_tx_to UNIQUE (chain_id, tx_hash, to_address);
    ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'deposits' AND column_name = 'blockchain_id') THEN
      ALTER TABLE deposits ADD CONSTRAINT deposits_unique_chain_tx_to UNIQUE (blockchain_id, tx_hash, to_address);
    END IF;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE NOTICE 'deposits_unique_chain_tx_to: duplicate (chain, tx_hash, to_address) rows exist; resolve before adding constraint.';
    WHEN duplicate_object THEN
      NULL;
  END $$;`,

  // Drop legacy balances (view or table). user_balances is the only source of truth; runtime never uses balances.
  `DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'balances' AND c.relkind = 'v') THEN
      DROP VIEW balances CASCADE;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'balances' AND c.relkind = 'r') THEN
      DROP TABLE balances;
    END IF;
  END $$;`,

  // ============================================
  // WITHDRAWAL ADDRESS WHITELIST & TIMELOCKS (Step 5A)
  // ============================================
  `CREATE TABLE IF NOT EXISTS withdrawal_address_whitelist (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    asset TEXT NOT NULL,
    address TEXT NOT NULL,
    label TEXT,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    added_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, asset, address)
  );`,
  `CREATE TABLE IF NOT EXISTS withdrawal_address_timelocks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    address_id UUID NOT NULL REFERENCES withdrawal_address_whitelist(id) ON DELETE CASCADE,
    unlock_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`,

  // ============================================
  // SECURITY COOLDOWNS (Step 5D) — block withdrawals after sensitive changes
  // ============================================
  `CREATE TABLE IF NOT EXISTS security_cooldowns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    cooldown_until TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`,
  `CREATE INDEX IF NOT EXISTS idx_security_cooldowns_user_until ON security_cooldowns(user_id, cooldown_until);`,

  // ============================================
  // AML & COMPLIANCE (Step 6A) — FIU-IND transaction monitoring & reporting
  // ============================================
  `CREATE TABLE IF NOT EXISTS aml_alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    alert_type TEXT NOT NULL,
    severity TEXT NOT NULL,
    status TEXT NOT NULL,
    details JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`,
  `CREATE INDEX IF NOT EXISTS idx_aml_alerts_user_status ON aml_alerts(user_id, status);`,

  `CREATE TABLE IF NOT EXISTS aml_transaction_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    txn_type TEXT NOT NULL,
    asset TEXT,
    amount NUMERIC,
    fiat_amount NUMERIC,
    fiat_currency TEXT,
    country_code TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`,
  `CREATE INDEX IF NOT EXISTS idx_aml_transaction_logs_user_created ON aml_transaction_logs(user_id, created_at);`,

  `CREATE TABLE IF NOT EXISTS aml_str_ctr_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    report_type TEXT NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    period_start DATE,
    period_end DATE,
    total_amount NUMERIC,
    status TEXT NOT NULL,
    payload JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`,
  `CREATE INDEX IF NOT EXISTS idx_aml_str_ctr_logs_report_status ON aml_str_ctr_logs(report_type, status);`,

  // ============================================
  // BALANCE SAFETY: total balance CHECK + balance_locks (Phase-7 Step-1)
  // ============================================
  `DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'user_balances') THEN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'user_balances'::regclass AND conname = 'user_balances_total_non_negative') THEN
        ALTER TABLE user_balances ADD CONSTRAINT user_balances_total_non_negative
          CHECK (COALESCE(available_balance, 0) + COALESCE(locked_balance, 0) >= 0);
      END IF;
    END IF;
  END $$;`,
  `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'balance_lock_reason') THEN CREATE TYPE balance_lock_reason AS ENUM ('order', 'withdrawal', 'escrow'); END IF; END $$;`,
  `CREATE TABLE IF NOT EXISTS balance_locks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    currency_id UUID NOT NULL REFERENCES currencies(id) ON DELETE CASCADE,
    account_type balance_account_type NOT NULL,
    amount DECIMAL(30,8) NOT NULL CHECK (amount > 0),
    reason balance_lock_reason NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`,
  `CREATE INDEX IF NOT EXISTS idx_balance_locks_user_currency_account ON balance_locks(user_id, currency_id, account_type);`,
  `CREATE INDEX IF NOT EXISTS idx_balance_locks_expires_at ON balance_locks(expires_at);`,

  // Phase-7 Step-2: spot_orders idempotency (client_order_id)
  `ALTER TABLE spot_orders ADD COLUMN IF NOT EXISTS client_order_id VARCHAR(64);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_spot_orders_user_client_order_id ON spot_orders(user_id, client_order_id) WHERE client_order_id IS NOT NULL;`,

  // Phase-7 Step-3: balance_locks reference_id for order cancel (release lock by order)
  `ALTER TABLE balance_locks ADD COLUMN IF NOT EXISTS reference_id UUID;`,
  `CREATE INDEX IF NOT EXISTS idx_balance_locks_reference_id ON balance_locks(reference_id) WHERE reference_id IS NOT NULL;`,

  // ============================================
  // PHASE-8 STEP-5: SETTLEMENT PIPELINE
  // ============================================
  `CREATE OR REPLACE VIEW markets AS
   SELECT m.symbol, m.base_asset, m.quote_asset, m.price_precision, m.qty_precision,
          COALESCE(c.decimals, m.price_precision) AS quote_precision
   FROM spot_markets m
   LEFT JOIN currencies c ON c.id = m.quote_currency_id;`,
  `CREATE TABLE IF NOT EXISTS settlement_poller_cursor (
    id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    last_engine_event_id BIGINT NOT NULL DEFAULT 0
  );`,
  `INSERT INTO settlement_poller_cursor (id, last_engine_event_id) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;`,
  `CREATE TABLE IF NOT EXISTS balances (
    user_id TEXT NOT NULL,
    asset TEXT NOT NULL,
    available NUMERIC NOT NULL DEFAULT 0 CHECK (available >= 0),
    locked NUMERIC NOT NULL DEFAULT 0 CHECK (locked >= 0),
    PRIMARY KEY (user_id, asset)
  );`,
  `CREATE TABLE IF NOT EXISTS settlement_events (
    id BIGSERIAL PRIMARY KEY,
    engine_event_id BIGINT NOT NULL UNIQUE,
    payload JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    retry_count INT NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMP,
    hash TEXT
  );`,
  `CREATE TABLE IF NOT EXISTS settlement_ledger_entries (
    id BIGSERIAL PRIMARY KEY,
    settlement_event_id BIGINT NOT NULL,
    user_id TEXT NOT NULL,
    asset TEXT NOT NULL,
    delta NUMERIC NOT NULL,
    prev_hash TEXT NULL,
    entry_hash TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  );`,
  `ALTER TABLE settlement_ledger_entries ADD COLUMN IF NOT EXISTS prev_hash TEXT NULL;`,
  `ALTER TABLE settlement_ledger_entries ADD COLUMN IF NOT EXISTS entry_hash TEXT NULL;`,
  `CREATE INDEX IF NOT EXISTS idx_settlement_ledger_user_asset ON settlement_ledger_entries(user_id, asset);`,
  `CREATE OR REPLACE FUNCTION prevent_ledger_update_delete()
   RETURNS TRIGGER AS $$
   BEGIN
     IF TG_OP IN ('UPDATE', 'DELETE') THEN
       RAISE EXCEPTION 'LEDGER_IMMUTABLE_VIOLATION';
     END IF;
     RETURN NULL;
   END;
   $$ LANGUAGE plpgsql;`,
  `DROP TRIGGER IF EXISTS trg_settlement_ledger_immutable_no_update ON settlement_ledger_entries;`,
  `CREATE TRIGGER trg_settlement_ledger_immutable_no_update
   BEFORE UPDATE ON settlement_ledger_entries FOR EACH ROW EXECUTE FUNCTION prevent_ledger_update_delete();`,
  `DROP TRIGGER IF EXISTS trg_settlement_ledger_immutable_no_delete ON settlement_ledger_entries;`,
  `CREATE TRIGGER trg_settlement_ledger_immutable_no_delete
   BEFORE DELETE ON settlement_ledger_entries FOR EACH ROW EXECUTE FUNCTION prevent_ledger_update_delete();`,
  `ALTER TABLE settlement_events ADD COLUMN IF NOT EXISTS hash TEXT;`,
  `CREATE INDEX IF NOT EXISTS idx_settlement_events_status ON settlement_events(status);`,
  `CREATE INDEX IF NOT EXISTS idx_settlement_events_engine_event_id ON settlement_events(engine_event_id);`,
  `CREATE TABLE IF NOT EXISTS settlement_trades (
    id BIGSERIAL PRIMARY KEY,
    symbol TEXT NOT NULL,
    price NUMERIC NOT NULL,
    qty NUMERIC NOT NULL,
    quote_qty NUMERIC NOT NULL,
    taker_user_id TEXT NOT NULL,
    maker_user_id TEXT NOT NULL,
    taker_order_id TEXT NOT NULL,
    maker_order_id TEXT NOT NULL,
    taker_fee NUMERIC NOT NULL,
    maker_fee NUMERIC NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  );`,
  `CREATE INDEX IF NOT EXISTS idx_settlement_trades_symbol ON settlement_trades(symbol);`,
  `CREATE INDEX IF NOT EXISTS idx_settlement_trades_created_at ON settlement_trades(created_at);`,

  // Phase-9 Step-1: Snapshot & recovery anchors (append-only)
  `CREATE TABLE IF NOT EXISTS system_snapshots (
    id BIGSERIAL PRIMARY KEY,
    snapshot_type TEXT NOT NULL,
    engine_event_id BIGINT NOT NULL,
    payload JSONB NOT NULL,
    ledger_chain_head TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  );`,
  `CREATE INDEX IF NOT EXISTS idx_system_snapshots_engine_event_id ON system_snapshots(engine_event_id DESC);`,
  `CREATE OR REPLACE FUNCTION prevent_snapshot_update_delete()
   RETURNS TRIGGER AS $$
   BEGIN
     IF TG_OP IN ('UPDATE', 'DELETE') THEN
       RAISE EXCEPTION 'SNAPSHOT_IMMUTABLE_VIOLATION';
     END IF;
     RETURN NULL;
   END;
   $$ LANGUAGE plpgsql;`,
  `DROP TRIGGER IF EXISTS trg_system_snapshots_immutable_no_update ON system_snapshots;`,
  `CREATE TRIGGER trg_system_snapshots_immutable_no_update
   BEFORE UPDATE ON system_snapshots FOR EACH ROW EXECUTE FUNCTION prevent_snapshot_update_delete();`,
  `DROP TRIGGER IF EXISTS trg_system_snapshots_immutable_no_delete ON system_snapshots;`,
  `CREATE TRIGGER trg_system_snapshots_immutable_no_delete
   BEFORE DELETE ON system_snapshots FOR EACH ROW EXECUTE FUNCTION prevent_snapshot_update_delete();`,

  // Phase-9 Step-3: Wallet reconciliation snapshots (append-only)
  `CREATE TABLE IF NOT EXISTS wallet_state_snapshots (
    id BIGSERIAL PRIMARY KEY,
    asset TEXT NOT NULL,
    wallet_type TEXT NOT NULL,
    onchain_balance NUMERIC NOT NULL,
    internal_ledger_balance NUMERIC NOT NULL,
    balance_delta NUMERIC NOT NULL,
    snapshot_time TIMESTAMP NOT NULL DEFAULT NOW()
  );`,
  `CREATE OR REPLACE FUNCTION prevent_wallet_snapshot_update_delete()
   RETURNS TRIGGER AS $$
   BEGIN
     IF TG_OP IN ('UPDATE', 'DELETE') THEN
       RAISE EXCEPTION 'WALLET_SNAPSHOT_IMMUTABLE_VIOLATION';
     END IF;
     RETURN NULL;
   END;
   $$ LANGUAGE plpgsql;`,
  `DROP TRIGGER IF EXISTS trg_wallet_state_snapshots_immutable_no_update ON wallet_state_snapshots;`,
  `CREATE TRIGGER trg_wallet_state_snapshots_immutable_no_update
   BEFORE UPDATE ON wallet_state_snapshots FOR EACH ROW EXECUTE FUNCTION prevent_wallet_snapshot_update_delete();`,
  `DROP TRIGGER IF EXISTS trg_wallet_state_snapshots_immutable_no_delete ON wallet_state_snapshots;`,
  `CREATE TRIGGER trg_wallet_state_snapshots_immutable_no_delete
   BEFORE DELETE ON wallet_state_snapshots FOR EACH ROW EXECUTE FUNCTION prevent_wallet_snapshot_update_delete();`,

  // Phase-9 Step-4: Ledger compaction & archival (checkpoints append-only, archive append-only)
  `CREATE TABLE IF NOT EXISTS ledger_checkpoints (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    asset TEXT NOT NULL,
    checkpoint_ledger_id BIGINT NOT NULL,
    available NUMERIC NOT NULL,
    locked NUMERIC NOT NULL,
    chain_head TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  );`,
  `CREATE INDEX IF NOT EXISTS idx_ledger_checkpoints_user_asset ON ledger_checkpoints(user_id, asset);`,
  `CREATE INDEX IF NOT EXISTS idx_ledger_checkpoints_ledger_id ON ledger_checkpoints(checkpoint_ledger_id);`,
  `CREATE OR REPLACE FUNCTION prevent_checkpoint_update_delete()
   RETURNS TRIGGER AS $$
   BEGIN
     IF TG_OP IN ('UPDATE', 'DELETE') THEN
       RAISE EXCEPTION 'CHECKPOINT_IMMUTABLE_VIOLATION';
     END IF;
     RETURN NULL;
   END;
   $$ LANGUAGE plpgsql;`,
  `DROP TRIGGER IF EXISTS trg_ledger_checkpoints_immutable_no_update ON ledger_checkpoints;`,
  `CREATE TRIGGER trg_ledger_checkpoints_immutable_no_update
   BEFORE UPDATE ON ledger_checkpoints FOR EACH ROW EXECUTE FUNCTION prevent_checkpoint_update_delete();`,
  `DROP TRIGGER IF EXISTS trg_ledger_checkpoints_immutable_no_delete ON ledger_checkpoints;`,
  `CREATE TRIGGER trg_ledger_checkpoints_immutable_no_delete
   BEFORE DELETE ON ledger_checkpoints FOR EACH ROW EXECUTE FUNCTION prevent_checkpoint_update_delete();`,
  `CREATE TABLE IF NOT EXISTS settlement_ledger_entries_archive (
    id BIGINT NOT NULL,
    settlement_event_id BIGINT NOT NULL,
    user_id TEXT NOT NULL,
    asset TEXT NOT NULL,
    delta NUMERIC NOT NULL,
    prev_hash TEXT,
    entry_hash TEXT,
    created_at TIMESTAMP NOT NULL
  );`,
  `CREATE OR REPLACE FUNCTION prevent_archive_update_delete()
   RETURNS TRIGGER AS $$
   BEGIN
     IF TG_OP IN ('UPDATE', 'DELETE') THEN
       RAISE EXCEPTION 'ARCHIVE_IMMUTABLE_VIOLATION';
     END IF;
     RETURN NULL;
   END;
   $$ LANGUAGE plpgsql;`,
  `DROP TRIGGER IF EXISTS trg_ledger_archive_immutable_no_update ON settlement_ledger_entries_archive;`,
  `CREATE TRIGGER trg_ledger_archive_immutable_no_update
   BEFORE UPDATE ON settlement_ledger_entries_archive FOR EACH ROW EXECUTE FUNCTION prevent_archive_update_delete();`,
  `DROP TRIGGER IF EXISTS trg_ledger_archive_immutable_no_delete ON settlement_ledger_entries_archive;`,
  `CREATE TRIGGER trg_ledger_archive_immutable_no_delete
   BEFORE DELETE ON settlement_ledger_entries_archive FOR EACH ROW EXECUTE FUNCTION prevent_archive_update_delete();`,
  `CREATE OR REPLACE FUNCTION prevent_ledger_update_delete()
   RETURNS TRIGGER AS $$
   BEGIN
     IF TG_OP = 'UPDATE' THEN
       RAISE EXCEPTION 'LEDGER_IMMUTABLE_VIOLATION';
     END IF;
     IF TG_OP = 'DELETE' THEN
       IF NOT EXISTS (SELECT 1 FROM settlement_ledger_entries_archive a WHERE a.id = OLD.id) THEN
         RAISE EXCEPTION 'LEDGER_IMMUTABLE_VIOLATION';
       END IF;
     END IF;
     RETURN NULL;
   END;
   $$ LANGUAGE plpgsql;`,

  // Phase-10 Step-1: Risk & exposure engine foundation
  `CREATE TABLE IF NOT EXISTS user_positions (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    position_size NUMERIC NOT NULL,
    entry_price NUMERIC NOT NULL,
    realized_pnl NUMERIC NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  );`,
  `CREATE INDEX IF NOT EXISTS idx_user_positions_user_id ON user_positions(user_id);`,
  `CREATE INDEX IF NOT EXISTS idx_user_positions_user_symbol ON user_positions(user_id, symbol);`,
  `DROP TRIGGER IF EXISTS update_user_positions_updated_at ON user_positions;`,
  `CREATE TRIGGER update_user_positions_updated_at BEFORE UPDATE ON user_positions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();`,
  `CREATE TABLE IF NOT EXISTS risk_metrics_cache (
    user_id TEXT PRIMARY KEY,
    equity NUMERIC NOT NULL,
    maintenance_margin NUMERIC NOT NULL,
    margin_ratio NUMERIC NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  );`,

  // Stop loss / stop limit: spot_orders stop_price + PENDING_TRIGGER status (only when column is varchar, not enum)
  `ALTER TABLE spot_orders ADD COLUMN IF NOT EXISTS stop_price DECIMAL(36,18);`,
  `DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'spot_orders' AND column_name = 'type' AND udt_name = 'varchar') THEN
      ALTER TABLE spot_orders DROP CONSTRAINT IF EXISTS spot_orders_type_check;
      ALTER TABLE spot_orders ADD CONSTRAINT spot_orders_type_check CHECK (type IN ('market', 'limit', 'stop_loss', 'stop_limit'));
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END $$;`,
  `DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'spot_orders' AND column_name = 'status' AND udt_name = 'varchar') THEN
      ALTER TABLE spot_orders DROP CONSTRAINT IF EXISTS spot_orders_status_check;
      ALTER TABLE spot_orders ADD CONSTRAINT spot_orders_status_check CHECK (status IN ('OPEN', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED', 'REJECTED', 'PENDING_TRIGGER'));
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END $$;`,

  // Spot: time_in_force (GTC/IOC/FOK) for limit orders
  `ALTER TABLE spot_orders ADD COLUMN IF NOT EXISTS time_in_force VARCHAR(3) NOT NULL DEFAULT 'gtc' CHECK (time_in_force IN ('gtc', 'ioc', 'fok'));`,

  // P2P: block advertiser (user_id blocks advertiser_id)
  `CREATE TABLE IF NOT EXISTS p2p_blocked_advertisers (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    advertiser_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, advertiser_id),
    CHECK (user_id != advertiser_id)
  );`,
  `CREATE INDEX IF NOT EXISTS idx_p2p_blocked_advertisers_user ON p2p_blocked_advertisers(user_id);`,

  // P2P order chat (Binance-style in-order messages)
  `CREATE TABLE IF NOT EXISTS p2p_order_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES p2p_orders(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`,
  `CREATE INDEX IF NOT EXISTS idx_p2p_order_messages_order_id ON p2p_order_messages(order_id);`,

  // P2P payment proof upload (buyer uploads receipt when confirming payment)
  `ALTER TABLE p2p_orders ADD COLUMN IF NOT EXISTS payment_proof_url TEXT;`,
  // P2P payment verification (fraud prevention): seller must verify before release (unless SLA / admin).
  `ALTER TABLE p2p_orders ADD COLUMN IF NOT EXISTS transaction_reference TEXT;`,
  `ALTER TABLE p2p_orders ADD COLUMN IF NOT EXISTS payment_proof_uploaded_at TIMESTAMPTZ;`,
  `ALTER TABLE p2p_orders ADD COLUMN IF NOT EXISTS payment_verification_status VARCHAR(20);`,
  `ALTER TABLE p2p_orders ADD COLUMN IF NOT EXISTS payment_verified_at TIMESTAMPTZ;`,
  `ALTER TABLE p2p_orders ADD COLUMN IF NOT EXISTS payment_verified_by UUID REFERENCES users(id);`,
  `ALTER TABLE p2p_orders ADD COLUMN IF NOT EXISTS payment_metadata JSONB DEFAULT '{}'::jsonb;`,
  `ALTER TABLE p2p_disputes ADD COLUMN IF NOT EXISTS payment_context JSONB DEFAULT '{}'::jsonb;`,

  // P4: trailing_stop_market, trailing_delta, trailing_best_price, oco_group_id
  `ALTER TABLE spot_orders ADD COLUMN IF NOT EXISTS trailing_delta DECIMAL(36,18);`,
  `ALTER TABLE spot_orders ADD COLUMN IF NOT EXISTS trailing_best_price DECIMAL(36,18);`,
  `ALTER TABLE spot_orders ADD COLUMN IF NOT EXISTS oco_group_id UUID;`,
  `CREATE INDEX IF NOT EXISTS idx_spot_orders_oco_group ON spot_orders(oco_group_id) WHERE oco_group_id IS NOT NULL;`,
  `DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'spot_orders' AND column_name = 'type' AND udt_name = 'varchar') THEN
      ALTER TABLE spot_orders DROP CONSTRAINT IF EXISTS spot_orders_type_check;
      ALTER TABLE spot_orders ADD CONSTRAINT spot_orders_type_check CHECK (type IN ('market', 'limit', 'stop_loss', 'stop_limit', 'trailing_stop_market'));
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END $$;`,

  // API key scopes: optional permissions (e.g. no_withdraw) for withdrawal enforcement
  `DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'user_api_keys') THEN
      ALTER TABLE user_api_keys ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '{}';
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END $$;`,

  // P2: Iceberg orders — display_quantity (visible in book); remainder revealed as filled
  `ALTER TABLE spot_orders ADD COLUMN IF NOT EXISTS display_quantity DECIMAL(36,18);`,

  // Phase 2–4: Circuit breaker history (who opened/reset, when)
  `CREATE TABLE IF NOT EXISTS circuit_breaker_history (
    id BIGSERIAL PRIMARY KEY,
    event_type VARCHAR(20) NOT NULL,
    reason TEXT,
    actor_type VARCHAR(20) NOT NULL DEFAULT 'system',
    actor_id VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`,
  `CREATE INDEX IF NOT EXISTS idx_circuit_breaker_history_created ON circuit_breaker_history(created_at DESC);`,

  // Phase 2: Cold wallet movement log (cold address change per chain)
  `CREATE TABLE IF NOT EXISTS cold_wallet_movements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    chain_id VARCHAR(50) NOT NULL,
    previous_address VARCHAR(255),
    new_address VARCHAR(255),
    actor_type VARCHAR(20) NOT NULL DEFAULT 'admin',
    actor_id VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`,
  `CREATE INDEX IF NOT EXISTS idx_cold_wallet_movements_chain ON cold_wallet_movements(chain_id, created_at DESC);`,

  // Phase 3: feature_toggles rollout (percentage 0-100)
  `ALTER TABLE feature_toggles ADD COLUMN IF NOT EXISTS rollout_percentage INTEGER DEFAULT 100 CHECK (rollout_percentage >= 0 AND rollout_percentage <= 100);`,

  // P2P: auto_release on payment confirm (seller pre-agrees to auto-release when buyer confirms)
  `ALTER TABLE p2p_ads ADD COLUMN IF NOT EXISTS auto_release BOOLEAN DEFAULT FALSE;`,

  // Performance: composite indexes for balance reads and ticker aggregation
  `CREATE INDEX IF NOT EXISTS idx_user_balances_user_account ON user_balances(user_id, account_type);`,
  `DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'spot_trades' AND column_name = 'market') THEN
      CREATE INDEX IF NOT EXISTS idx_spot_trades_market_created ON spot_trades(market, created_at DESC);
    ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'spot_trades' AND column_name = 'trading_pair_id') THEN
      CREATE INDEX IF NOT EXISTS idx_spot_trades_pair_created ON spot_trades(trading_pair_id, created_at DESC);
    END IF;
  END $$;`,

  // Tier-1 multi-engine: per-engine identity, composite settlement idempotency, per-engine poller cursors
  `ALTER TABLE settlement_events ADD COLUMN IF NOT EXISTS match_engine_id VARCHAR(128) NOT NULL DEFAULT 'default';`,
  `UPDATE settlement_events SET match_engine_id = 'default' WHERE match_engine_id IS NULL OR trim(match_engine_id) = '';`,
  `ALTER TABLE spot_orders ADD COLUMN IF NOT EXISTS match_engine_id VARCHAR(128) NOT NULL DEFAULT 'default';`,
  `UPDATE spot_orders SET match_engine_id = 'default' WHERE match_engine_id IS NULL OR trim(match_engine_id) = '';`,
  `CREATE TABLE IF NOT EXISTS settlement_engine_poll_cursor (
    engine_id VARCHAR(128) PRIMARY KEY,
    last_after_id BIGINT NOT NULL DEFAULT 0
  );`,
  `INSERT INTO settlement_engine_poll_cursor (engine_id, last_after_id)
   SELECT 'default', COALESCE(last_engine_event_id, 0) FROM settlement_poller_cursor WHERE id = 1
   ON CONFLICT (engine_id) DO NOTHING;`,
  `ALTER TABLE settlement_events DROP CONSTRAINT IF EXISTS settlement_events_engine_event_id_key;`,
  `DROP INDEX IF EXISTS settlement_events_engine_event_id_key;`,
  `CREATE UNIQUE INDEX IF NOT EXISTS settlement_events_match_engine_event_uidx ON settlement_events(match_engine_id, engine_event_id);`,
  `CREATE INDEX IF NOT EXISTS idx_settlement_events_match_engine ON settlement_events(match_engine_id, engine_event_id);`,

  // security_risk_signal_weights (moved from stray tail migration)
  `CREATE TABLE IF NOT EXISTS security_risk_signal_weights (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scope TEXT NOT NULL,
    signal TEXT NOT NULL,
    weight INT NOT NULL CHECK (weight >= 0),
    enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (scope, signal)
  );`,

  // balance_ledger: allow genesis / reconciliation backfill lines (idempotent inserts)
  `DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ledger_reference_type') THEN
      IF NOT EXISTS (
        SELECT 1 FROM pg_enum e
        JOIN pg_type t ON e.enumtypid = t.oid
        WHERE t.typname = 'ledger_reference_type' AND e.enumlabel = 'opening_balance'
      ) THEN
        ALTER TYPE ledger_reference_type ADD VALUE 'opening_balance';
      END IF;
    END IF;
  END $$;`,

  // P2P escrow + canonical balance reads: readUserBalances selects escrow_balance
  `ALTER TABLE user_balances ADD COLUMN IF NOT EXISTS escrow_balance NUMERIC(36,18) NOT NULL DEFAULT 0;`,

  // ============================================
  // COIN SEED: ~35 currencies + ~38 spot markets for tier-1 market depth
  // ============================================

  // --- Currencies (idempotent: skip if symbol already exists) ---
  `DO $$
  BEGIN
    -- Stablecoins
    IF NOT EXISTS (SELECT 1 FROM currencies WHERE UPPER(TRIM(symbol)) = 'USDC' AND currency_type = 'crypto' LIMIT 1) THEN
      INSERT INTO currencies (symbol, name, currency_type, decimals) VALUES ('USDC', 'USD Coin', 'stablecoin'::currency_type, 6);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM currencies WHERE UPPER(TRIM(symbol)) = 'DAI' LIMIT 1) THEN
      INSERT INTO currencies (symbol, name, currency_type, decimals) VALUES ('DAI', 'Dai', 'stablecoin'::currency_type, 18);
    END IF;

    -- L1 Majors
    IF NOT EXISTS (SELECT 1 FROM currencies WHERE UPPER(TRIM(symbol)) = 'BNB' LIMIT 1) THEN
      INSERT INTO currencies (symbol, name, currency_type, decimals) VALUES ('BNB', 'BNB', 'crypto'::currency_type, 18);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM currencies WHERE UPPER(TRIM(symbol)) = 'SOL' LIMIT 1) THEN
      INSERT INTO currencies (symbol, name, currency_type, decimals) VALUES ('SOL', 'Solana', 'crypto'::currency_type, 9);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM currencies WHERE UPPER(TRIM(symbol)) = 'XRP' LIMIT 1) THEN
      INSERT INTO currencies (symbol, name, currency_type, decimals) VALUES ('XRP', 'XRP', 'crypto'::currency_type, 6);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM currencies WHERE UPPER(TRIM(symbol)) = 'ADA' LIMIT 1) THEN
      INSERT INTO currencies (symbol, name, currency_type, decimals) VALUES ('ADA', 'Cardano', 'crypto'::currency_type, 6);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM currencies WHERE UPPER(TRIM(symbol)) = 'AVAX' LIMIT 1) THEN
      INSERT INTO currencies (symbol, name, currency_type, decimals) VALUES ('AVAX', 'Avalanche', 'crypto'::currency_type, 18);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM currencies WHERE UPPER(TRIM(symbol)) = 'DOT' LIMIT 1) THEN
      INSERT INTO currencies (symbol, name, currency_type, decimals) VALUES ('DOT', 'Polkadot', 'crypto'::currency_type, 10);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM currencies WHERE UPPER(TRIM(symbol)) = 'ATOM' LIMIT 1) THEN
      INSERT INTO currencies (symbol, name, currency_type, decimals) VALUES ('ATOM', 'Cosmos', 'crypto'::currency_type, 6);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM currencies WHERE UPPER(TRIM(symbol)) = 'NEAR' LIMIT 1) THEN
      INSERT INTO currencies (symbol, name, currency_type, decimals) VALUES ('NEAR', 'NEAR Protocol', 'crypto'::currency_type, 24);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM currencies WHERE UPPER(TRIM(symbol)) = 'SUI' LIMIT 1) THEN
      INSERT INTO currencies (symbol, name, currency_type, decimals) VALUES ('SUI', 'Sui', 'crypto'::currency_type, 9);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM currencies WHERE UPPER(TRIM(symbol)) = 'APT' LIMIT 1) THEN
      INSERT INTO currencies (symbol, name, currency_type, decimals) VALUES ('APT', 'Aptos', 'crypto'::currency_type, 8);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM currencies WHERE UPPER(TRIM(symbol)) = 'SEI' LIMIT 1) THEN
      INSERT INTO currencies (symbol, name, currency_type, decimals) VALUES ('SEI', 'Sei', 'crypto'::currency_type, 6);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM currencies WHERE UPPER(TRIM(symbol)) = 'TRX' LIMIT 1) THEN
      INSERT INTO currencies (symbol, name, currency_type, decimals) VALUES ('TRX', 'TRON', 'crypto'::currency_type, 6);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM currencies WHERE UPPER(TRIM(symbol)) = 'LTC' LIMIT 1) THEN
      INSERT INTO currencies (symbol, name, currency_type, decimals) VALUES ('LTC', 'Litecoin', 'crypto'::currency_type, 8);
    END IF;

    -- L2
    IF NOT EXISTS (SELECT 1 FROM currencies WHERE UPPER(TRIM(symbol)) = 'MATIC' LIMIT 1) THEN
      INSERT INTO currencies (symbol, name, currency_type, decimals) VALUES ('MATIC', 'Polygon', 'crypto'::currency_type, 18);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM currencies WHERE UPPER(TRIM(symbol)) = 'ARB' LIMIT 1) THEN
      INSERT INTO currencies (symbol, name, currency_type, decimals) VALUES ('ARB', 'Arbitrum', 'crypto'::currency_type, 18);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM currencies WHERE UPPER(TRIM(symbol)) = 'OP' LIMIT 1) THEN
      INSERT INTO currencies (symbol, name, currency_type, decimals) VALUES ('OP', 'Optimism', 'crypto'::currency_type, 18);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM currencies WHERE UPPER(TRIM(symbol)) = 'IMX' LIMIT 1) THEN
      INSERT INTO currencies (symbol, name, currency_type, decimals) VALUES ('IMX', 'Immutable X', 'crypto'::currency_type, 18);
    END IF;

    -- DeFi
    IF NOT EXISTS (SELECT 1 FROM currencies WHERE UPPER(TRIM(symbol)) = 'UNI' LIMIT 1) THEN
      INSERT INTO currencies (symbol, name, currency_type, decimals) VALUES ('UNI', 'Uniswap', 'crypto'::currency_type, 18);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM currencies WHERE UPPER(TRIM(symbol)) = 'AAVE' LIMIT 1) THEN
      INSERT INTO currencies (symbol, name, currency_type, decimals) VALUES ('AAVE', 'Aave', 'crypto'::currency_type, 18);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM currencies WHERE UPPER(TRIM(symbol)) = 'LINK' LIMIT 1) THEN
      INSERT INTO currencies (symbol, name, currency_type, decimals) VALUES ('LINK', 'Chainlink', 'crypto'::currency_type, 18);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM currencies WHERE UPPER(TRIM(symbol)) = 'MKR' LIMIT 1) THEN
      INSERT INTO currencies (symbol, name, currency_type, decimals) VALUES ('MKR', 'Maker', 'crypto'::currency_type, 18);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM currencies WHERE UPPER(TRIM(symbol)) = 'LDO' LIMIT 1) THEN
      INSERT INTO currencies (symbol, name, currency_type, decimals) VALUES ('LDO', 'Lido DAO', 'crypto'::currency_type, 18);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM currencies WHERE UPPER(TRIM(symbol)) = 'INJ' LIMIT 1) THEN
      INSERT INTO currencies (symbol, name, currency_type, decimals) VALUES ('INJ', 'Injective', 'crypto'::currency_type, 18);
    END IF;

    -- Meme
    IF NOT EXISTS (SELECT 1 FROM currencies WHERE UPPER(TRIM(symbol)) = 'DOGE' LIMIT 1) THEN
      INSERT INTO currencies (symbol, name, currency_type, decimals) VALUES ('DOGE', 'Dogecoin', 'crypto'::currency_type, 8);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM currencies WHERE UPPER(TRIM(symbol)) = 'SHIB' LIMIT 1) THEN
      INSERT INTO currencies (symbol, name, currency_type, decimals) VALUES ('SHIB', 'Shiba Inu', 'crypto'::currency_type, 18);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM currencies WHERE UPPER(TRIM(symbol)) = 'PEPE' LIMIT 1) THEN
      INSERT INTO currencies (symbol, name, currency_type, decimals) VALUES ('PEPE', 'Pepe', 'crypto'::currency_type, 18);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM currencies WHERE UPPER(TRIM(symbol)) = 'WIF' LIMIT 1) THEN
      INSERT INTO currencies (symbol, name, currency_type, decimals) VALUES ('WIF', 'dogwifhat', 'crypto'::currency_type, 6);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM currencies WHERE UPPER(TRIM(symbol)) = 'FLOKI' LIMIT 1) THEN
      INSERT INTO currencies (symbol, name, currency_type, decimals) VALUES ('FLOKI', 'Floki', 'crypto'::currency_type, 9);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM currencies WHERE UPPER(TRIM(symbol)) = 'BONK' LIMIT 1) THEN
      INSERT INTO currencies (symbol, name, currency_type, decimals) VALUES ('BONK', 'Bonk', 'crypto'::currency_type, 5);
    END IF;

    -- AI
    IF NOT EXISTS (SELECT 1 FROM currencies WHERE UPPER(TRIM(symbol)) = 'FET' LIMIT 1) THEN
      INSERT INTO currencies (symbol, name, currency_type, decimals) VALUES ('FET', 'Fetch.ai', 'crypto'::currency_type, 18);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM currencies WHERE UPPER(TRIM(symbol)) = 'RENDER' LIMIT 1) THEN
      INSERT INTO currencies (symbol, name, currency_type, decimals) VALUES ('RENDER', 'Render', 'crypto'::currency_type, 18);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM currencies WHERE UPPER(TRIM(symbol)) = 'WLD' LIMIT 1) THEN
      INSERT INTO currencies (symbol, name, currency_type, decimals) VALUES ('WLD', 'Worldcoin', 'crypto'::currency_type, 18);
    END IF;

    -- Infrastructure / Storage
    IF NOT EXISTS (SELECT 1 FROM currencies WHERE UPPER(TRIM(symbol)) = 'FIL' LIMIT 1) THEN
      INSERT INTO currencies (symbol, name, currency_type, decimals) VALUES ('FIL', 'Filecoin', 'crypto'::currency_type, 18);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM currencies WHERE UPPER(TRIM(symbol)) = 'GRT' LIMIT 1) THEN
      INSERT INTO currencies (symbol, name, currency_type, decimals) VALUES ('GRT', 'The Graph', 'crypto'::currency_type, 18);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM currencies WHERE UPPER(TRIM(symbol)) = 'AR' LIMIT 1) THEN
      INSERT INTO currencies (symbol, name, currency_type, decimals) VALUES ('AR', 'Arweave', 'crypto'::currency_type, 12);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM currencies WHERE UPPER(TRIM(symbol)) = 'ICP' LIMIT 1) THEN
      INSERT INTO currencies (symbol, name, currency_type, decimals) VALUES ('ICP', 'Internet Computer', 'crypto'::currency_type, 8);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM currencies WHERE UPPER(TRIM(symbol)) = 'HBAR' LIMIT 1) THEN
      INSERT INTO currencies (symbol, name, currency_type, decimals) VALUES ('HBAR', 'Hedera', 'crypto'::currency_type, 8);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM currencies WHERE UPPER(TRIM(symbol)) = 'VET' LIMIT 1) THEN
      INSERT INTO currencies (symbol, name, currency_type, decimals) VALUES ('VET', 'VeChain', 'crypto'::currency_type, 18);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'coin-seed currencies: %', SQLERRM;
  END $$;`,

  // --- Spot Markets: USDT pairs (idempotent) ---
  `DO $$
  DECLARE
    rec RECORD;
    base_cur_id UUID;
    quote_cur_id UUID;
  BEGIN
    quote_cur_id := (SELECT id FROM currencies WHERE UPPER(TRIM(symbol)) = 'USDT' LIMIT 1);
    IF quote_cur_id IS NULL THEN
      RAISE WARNING 'coin-seed: USDT currency not found, skipping spot_markets';
      RETURN;
    END IF;

    FOR rec IN (
      SELECT * FROM (VALUES
        -- sym,         base,   min_qty,        min_notional,  price_prec, qty_prec
        ('BNB_USDT',    'BNB',   0.01,           1,             4, 4),
        ('SOL_USDT',    'SOL',   0.01,           1,             4, 4),
        ('XRP_USDT',    'XRP',   1,              1,             5, 2),
        ('ADA_USDT',    'ADA',   1,              1,             5, 2),
        ('AVAX_USDT',   'AVAX',  0.1,            1,             4, 3),
        ('DOT_USDT',    'DOT',   0.1,            1,             4, 3),
        ('ATOM_USDT',   'ATOM',  0.1,            1,             4, 3),
        ('NEAR_USDT',   'NEAR',  0.1,            1,             4, 3),
        ('SUI_USDT',    'SUI',   1,              1,             5, 2),
        ('APT_USDT',    'APT',   0.1,            1,             4, 3),
        ('SEI_USDT',    'SEI',   1,              1,             5, 2),
        ('TRX_USDT',    'TRX',   1,              1,             5, 1),
        ('LTC_USDT',    'LTC',   0.01,           1,             4, 4),
        ('MATIC_USDT',  'MATIC', 1,              1,             5, 2),
        ('ARB_USDT',    'ARB',   1,              1,             5, 2),
        ('OP_USDT',     'OP',    1,              1,             5, 2),
        ('IMX_USDT',    'IMX',   1,              1,             5, 2),
        ('UNI_USDT',    'UNI',   0.1,            1,             4, 3),
        ('AAVE_USDT',   'AAVE',  0.01,           1,             4, 4),
        ('LINK_USDT',   'LINK',  0.1,            1,             4, 3),
        ('MKR_USDT',    'MKR',   0.001,          1,             2, 5),
        ('LDO_USDT',    'LDO',   1,              1,             4, 2),
        ('INJ_USDT',    'INJ',   0.1,            1,             4, 3),
        ('DOGE_USDT',   'DOGE',  1,              1,             6, 1),
        ('SHIB_USDT',   'SHIB',  1000,           1,             10, 0),
        ('PEPE_USDT',   'PEPE',  10000,          1,             10, 0),
        ('WIF_USDT',    'WIF',   1,              1,             5, 2),
        ('FLOKI_USDT',  'FLOKI', 1000,           1,             9, 0),
        ('BONK_USDT',   'BONK',  10000,          1,             10, 0),
        ('FET_USDT',    'FET',   1,              1,             5, 2),
        ('RENDER_USDT', 'RENDER',0.1,            1,             4, 3),
        ('WLD_USDT',    'WLD',   1,              1,             5, 2),
        ('FIL_USDT',    'FIL',   0.1,            1,             4, 3),
        ('GRT_USDT',    'GRT',   1,              1,             5, 2),
        ('AR_USDT',     'AR',    0.1,            1,             4, 3),
        ('ICP_USDT',    'ICP',   0.1,            1,             4, 3),
        ('HBAR_USDT',   'HBAR',  1,              1,             5, 2),
        ('VET_USDT',    'VET',   1,              1,             6, 1),
        ('USDC_USDT',   'USDC',  1,              1,             5, 2),
        ('DAI_USDT',    'DAI',   1,              1,             5, 2)
      ) AS t(sym, base, minq, minn, ppre, qpre)
    ) LOOP
      IF NOT EXISTS (SELECT 1 FROM spot_markets WHERE symbol = rec.sym) THEN
        base_cur_id := (SELECT id FROM currencies WHERE UPPER(TRIM(symbol)) = rec.base LIMIT 1);
        INSERT INTO spot_markets (symbol, base_asset, quote_asset, base_currency_id, quote_currency_id, status, min_qty, min_notional, price_precision, qty_precision)
        VALUES (rec.sym, rec.base, 'USDT', base_cur_id, quote_cur_id, 'active', rec.minq, rec.minn, rec.ppre, rec.qpre);
      END IF;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'coin-seed spot_markets USDT: %', SQLERRM;
  END $$;`,

  // --- Spot Markets: BTC pairs ---
  `DO $$
  DECLARE
    rec RECORD;
    base_cur_id UUID;
    quote_cur_id UUID;
  BEGIN
    quote_cur_id := (SELECT id FROM currencies WHERE UPPER(TRIM(symbol)) = 'BTC' LIMIT 1);
    IF quote_cur_id IS NULL THEN RETURN; END IF;

    FOR rec IN (
      SELECT * FROM (VALUES
        ('ETH_BTC',  'ETH',  0.001,  0.0001, 6, 5),
        ('SOL_BTC',  'SOL',  0.1,    0.0001, 8, 3),
        ('BNB_BTC',  'BNB',  0.01,   0.0001, 7, 4),
        ('XRP_BTC',  'XRP',  1,      0.0001, 8, 2),
        ('DOGE_BTC', 'DOGE', 10,     0.0001, 10, 1),
        ('LINK_BTC', 'LINK', 0.1,    0.0001, 8, 3)
      ) AS t(sym, base, minq, minn, ppre, qpre)
    ) LOOP
      IF NOT EXISTS (SELECT 1 FROM spot_markets WHERE symbol = rec.sym) THEN
        base_cur_id := (SELECT id FROM currencies WHERE UPPER(TRIM(symbol)) = rec.base LIMIT 1);
        INSERT INTO spot_markets (symbol, base_asset, quote_asset, base_currency_id, quote_currency_id, status, min_qty, min_notional, price_precision, qty_precision)
        VALUES (rec.sym, rec.base, 'BTC', base_cur_id, quote_cur_id, 'active', rec.minq, rec.minn, rec.ppre, rec.qpre);
      END IF;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'coin-seed spot_markets BTC: %', SQLERRM;
  END $$;`,

  // --- Sync new spot_markets into trading_pairs (for candle charts) ---
  `DO $$
  DECLARE
    r RECORD;
    bid UUID;
    qid UUID;
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'trading_pairs')
       OR NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'spot_markets') THEN
      RETURN;
    END IF;
    FOR r IN SELECT symbol, base_asset, quote_asset FROM spot_markets WHERE status IN ('active', 'maintenance')
    LOOP
      IF NOT EXISTS (SELECT 1 FROM trading_pairs WHERE trading_pairs.symbol = r.symbol) THEN
        bid := NULL; qid := NULL;
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'tokens') THEN
          SELECT id INTO bid FROM tokens WHERE symbol = r.base_asset AND is_active = TRUE ORDER BY is_native DESC NULLS LAST LIMIT 1;
          SELECT id INTO qid FROM tokens WHERE symbol = r.quote_asset AND is_active = TRUE ORDER BY is_native DESC NULLS LAST LIMIT 1;
        END IF;
        IF bid IS NOT NULL AND qid IS NOT NULL THEN
          INSERT INTO trading_pairs (symbol, base_token_id, quote_token_id, min_order_size, max_order_size, tick_size, step_size, maker_fee, taker_fee, is_active, trading_enabled)
          VALUES (r.symbol, bid, qid, 0.0001, 1000000000, 0.01, 0.0001, 0.001, 0.001, TRUE, TRUE)
          ON CONFLICT (symbol) DO NOTHING;
        END IF;
      END IF;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'coin-seed trading_pairs sync: %', SQLERRM;
  END $$;`,

  // Ensure every spot_market base/quote asset has a tokens row (needed for trading_pairs FK)
  `DO $$
  DECLARE
    asset TEXT;
    default_chain TEXT;
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'tokens')
       OR NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'spot_markets') THEN
      RETURN;
    END IF;
    SELECT id INTO default_chain FROM chains WHERE id = 'ethereum' LIMIT 1;
    IF default_chain IS NULL THEN
      SELECT id INTO default_chain FROM chains WHERE is_active = TRUE ORDER BY id LIMIT 1;
    END IF;
    IF default_chain IS NULL THEN RETURN; END IF;
    FOR asset IN
      SELECT DISTINCT unnest(ARRAY[base_asset, quote_asset]) AS a
      FROM spot_markets WHERE status IN ('active', 'maintenance')
    LOOP
      IF NOT EXISTS (SELECT 1 FROM tokens WHERE UPPER(TRIM(symbol)) = UPPER(TRIM(asset)) AND is_active = TRUE) THEN
        BEGIN
          INSERT INTO tokens (symbol, name, chain_id, decimals, is_active)
          VALUES (UPPER(TRIM(asset)), UPPER(TRIM(asset)), default_chain, 18, TRUE);
        EXCEPTION WHEN unique_violation THEN NULL;
        END;
      END IF;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'auto-token-seed: %', SQLERRM;
  END $$;`,

  // Re-sync spot_markets → trading_pairs using base/quote_currency_id from spot_markets
  `DO $$
  DECLARE
    r RECORD;
    bid UUID;
    qid UUID;
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'trading_pairs')
       OR NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'spot_markets') THEN
      RETURN;
    END IF;
    FOR r IN SELECT symbol, base_asset, quote_asset, base_currency_id, quote_currency_id,
                    price_precision, qty_precision, min_qty, min_notional
             FROM spot_markets WHERE status IN ('active', 'maintenance')
    LOOP
      IF NOT EXISTS (SELECT 1 FROM trading_pairs WHERE trading_pairs.symbol = r.symbol) THEN
        bid := r.base_currency_id;
        qid := r.quote_currency_id;
        IF bid IS NULL THEN
          SELECT id INTO bid FROM currencies WHERE UPPER(TRIM(symbol)) = UPPER(TRIM(r.base_asset)) LIMIT 1;
        END IF;
        IF qid IS NULL THEN
          SELECT id INTO qid FROM currencies WHERE UPPER(TRIM(symbol)) = UPPER(TRIM(r.quote_asset)) LIMIT 1;
        END IF;
        IF bid IS NOT NULL AND qid IS NOT NULL THEN
          INSERT INTO trading_pairs (symbol, base_currency_id, quote_currency_id, price_precision, quantity_precision,
                                     tick_size, min_quantity, min_notional, maker_fee, taker_fee, status, trading_enabled, is_active)
          VALUES (r.symbol, bid, qid, COALESCE(r.price_precision,8), COALESCE(r.qty_precision,8),
                  0.01, COALESCE(r.min_qty,0.0001), COALESCE(r.min_notional,1), 0.001, 0.001, 'active', TRUE, TRUE)
          ON CONFLICT (symbol) DO NOTHING;
        END IF;
      END IF;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'auto-trading-pairs-sync: %', SQLERRM;
  END $$;`,

  // Refresh markets materialized view if exists
  `DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_matviews WHERE matviewname = 'markets') THEN
      REFRESH MATERIALIZED VIEW CONCURRENTLY markets;
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END $$;`,

  // ============================================
  // PORTFOLIO SNAPSHOTS (for balance history chart)
  // ============================================
  `CREATE TABLE IF NOT EXISTS portfolio_snapshots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    total_usd NUMERIC(20,2) NOT NULL DEFAULT 0,
    breakdown JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );`,
  `CREATE INDEX IF NOT EXISTS idx_portfolio_snapshots_user_time
   ON portfolio_snapshots (user_id, created_at DESC);`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'portfolio_snapshots_retention') THEN
      NULL;
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END $$;`,
];

/** True if this migration SQL touches the legacy "balances" table (not user_balances). Run such steps via raw pool so runtime guard does not block. */
function touchesLegacyBalancesTable(sql: string): boolean {
  const normalized = sql.replace(/\s+/g, ' ').trim();
  return /\bbalances\b/i.test(normalized) && !/user_balances/i.test(normalized);
}

async function migrate(direction: 'up' | 'down' = 'up'): Promise<void> {
  logger.info(`Running database migrations (${direction})...`);
  const pool = db.getPool();

  try {
    if (direction === 'up') {
      for (let i = 0; i < migrations.length; i++) {
        const migration = migrations[i]!;
        try {
          if (touchesLegacyBalancesTable(migration)) {
            await pool.query(migration);
          } else {
            await db.query(migration);
          }
          logger.debug(`Migration ${i + 1}/${migrations.length} completed`);
        } catch (error) {
          logger.error(`Migration ${i + 1} failed`, { 
            error: error instanceof Error ? error.message : 'Unknown',
            migration: migration.substring(0, 100)
          });
          throw error;
        }
      }
    } else {
      // Drop all tables (for development only)
      const dropTables = `
        DROP VIEW IF EXISTS markets CASCADE;
        DROP TABLE IF EXISTS
          user_notifications,
          system_announcements,
          email_templates,
          sms_templates,
          deposit_sweeps,
          withdrawal_signing_queue,
          hot_wallet_audit_log,
          withdrawal_addresses,
          hot_wallets,
          withdrawals,
          referral_rewards,
          rate_limit_overrides,
          audit_logs_immutable,
          audit_logs,
          transactions,
          p2p_disputes,
          p2p_orders,
          p2p_merchant_stats,
          escrows,
          p2p_ads,
          payment_methods,
          risk_metrics_cache,
          user_positions,
          wallet_state_snapshots,
          system_snapshots,
          settlement_ledger_entries_archive,
          ledger_checkpoints,
          settlement_ledger_entries,
          settlement_events,
          settlement_engine_poll_cursor,
          settlement_poller_cursor,
          settlement_trades,
          trades,
          orders,
          trading_pairs,
          balances,
          wallets,
          tokens,
          chains,
          kyc_documents,
          kyc_records,
          otp_verifications,
          sessions,
          auth_providers,
          users,
          system_settings
        CASCADE;
        DROP TYPE IF EXISTS notification_type CASCADE;
        DROP TYPE IF EXISTS audit_actor_type_immutable CASCADE;
        DROP TYPE IF EXISTS audit_action_immutable CASCADE;
        DROP FUNCTION IF EXISTS audit_logs_immutable_no_update_delete CASCADE;
        DROP FUNCTION IF EXISTS update_updated_at_column CASCADE;
      `;
      await db.query(dropTables);
    }

    logger.info('Database migrations completed successfully');
  } catch (error) {
    logger.error('Database migration failed', { 
      error: error instanceof Error ? error.message : 'Unknown' 
    });
    process.exit(1);
  } finally {
    await db.close();
  }
}

// Run migrations if called directly
const args = process.argv.slice(2);
const direction = args[0] === 'down' ? 'down' : 'up';
migrate(direction);

export { migrate };
