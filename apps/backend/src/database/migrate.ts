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

  `DROP TRIGGER IF EXISTS update_users_updated_at ON users;
   CREATE TRIGGER update_users_updated_at
   BEFORE UPDATE ON users
   FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();`,

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
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'balances' AND c.relkind = 'r') THEN
      CREATE INDEX IF NOT EXISTS idx_balances_user_id ON balances(user_id);
      CREATE INDEX IF NOT EXISTS idx_balances_token_id ON balances(token_id);
    END IF;
  END $$;`,

  // balances table: add columns used by wallet routes (only if balances is a table, not a view)
  `DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'balances' AND c.relkind = 'r') THEN
      ALTER TABLE balances ADD COLUMN IF NOT EXISTS available_balance DECIMAL(36,18) DEFAULT 0;
      ALTER TABLE balances ADD COLUMN IF NOT EXISTS locked_balance DECIMAL(36,18) DEFAULT 0;
      ALTER TABLE balances ADD COLUMN IF NOT EXISTS account_type VARCHAR(50) NOT NULL DEFAULT 'funding';
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
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`,
  `CREATE INDEX IF NOT EXISTS idx_admin_activity_logs_admin_id ON admin_activity_logs(admin_id);`,
  `CREATE INDEX IF NOT EXISTS idx_admin_activity_logs_created ON admin_activity_logs(created_at DESC);`,

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
     END IF;
   END $$;`,
  // Track when a completed deposit has been applied to user_balances (avoids double-credit on repair).
  `ALTER TABLE deposits ADD COLUMN IF NOT EXISTS balance_applied_at TIMESTAMP WITH TIME ZONE;`,

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
        DROP TABLE IF EXISTS 
          deposit_sweeps,
          withdrawal_signing_queue,
          hot_wallet_audit_log,
          withdrawal_addresses,
          hot_wallets,
          withdrawals,
          referral_rewards,
          rate_limit_overrides,
          audit_logs,
          transactions,
          p2p_disputes,
          p2p_orders,
          escrows,
          p2p_ads,
          payment_methods,
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
