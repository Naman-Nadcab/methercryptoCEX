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
  `CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code);`,
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

  `CREATE INDEX IF NOT EXISTS idx_kyc_documents_record_id ON kyc_documents(kyc_record_id);`,

  // ============================================
  // CHAINS TABLE
  // ============================================
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

  `CREATE INDEX IF NOT EXISTS idx_tokens_chain_id ON tokens(chain_id) WHERE is_active = TRUE;`,
  `CREATE INDEX IF NOT EXISTS idx_tokens_symbol ON tokens(symbol);`,

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

  `CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON wallets(user_id);`,
  `CREATE INDEX IF NOT EXISTS idx_wallets_address ON wallets(chain_id, address);`,

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

  `CREATE INDEX IF NOT EXISTS idx_balances_user_id ON balances(user_id);`,
  `CREATE INDEX IF NOT EXISTS idx_balances_token_id ON balances(token_id);`,

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

  `CREATE INDEX IF NOT EXISTS idx_trading_pairs_symbol ON trading_pairs(symbol) WHERE is_active = TRUE;`,

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

  `CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);`,
  `CREATE INDEX IF NOT EXISTS idx_orders_pair_id ON orders(pair_id);`,
  `CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);`,
  `CREATE INDEX IF NOT EXISTS idx_orders_open ON orders(pair_id, side, price) WHERE status IN ('open', 'partially_filled');`,
  `CREATE INDEX IF NOT EXISTS idx_orders_user_open ON orders(user_id, status) WHERE status IN ('open', 'partially_filled');`,
  `CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_orders_client_order_id ON orders(user_id, client_order_id);`,

  `DROP TRIGGER IF EXISTS update_orders_updated_at ON orders;
   CREATE TRIGGER update_orders_updated_at
   BEFORE UPDATE ON orders
   FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();`,

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

  `CREATE INDEX IF NOT EXISTS idx_trades_pair_id ON trades(pair_id);`,
  `CREATE INDEX IF NOT EXISTS idx_trades_buyer_id ON trades(buyer_id);`,
  `CREATE INDEX IF NOT EXISTS idx_trades_seller_id ON trades(seller_id);`,
  `CREATE INDEX IF NOT EXISTS idx_trades_executed_at ON trades(executed_at DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_trades_pair_executed ON trades(pair_id, executed_at DESC);`,

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

  `CREATE INDEX IF NOT EXISTS idx_payment_methods_user_id ON payment_methods(user_id) WHERE is_active = TRUE;`,

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

  `CREATE INDEX IF NOT EXISTS idx_p2p_ads_user_id ON p2p_ads(user_id);`,
  `CREATE INDEX IF NOT EXISTS idx_p2p_ads_type ON p2p_ads(type, status) WHERE status = 'active';`,
  `CREATE INDEX IF NOT EXISTS idx_p2p_ads_token ON p2p_ads(token_id, fiat_currency, status) WHERE status = 'active';`,
  `CREATE INDEX IF NOT EXISTS idx_p2p_ads_price ON p2p_ads(price) WHERE status = 'active';`,

  // ============================================
  // ESCROWS TABLE
  // ============================================
  `CREATE TABLE IF NOT EXISTS escrows (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    token_id UUID NOT NULL REFERENCES tokens(id),
    amount DECIMAL(36,18) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'locked' 
      CHECK (status IN ('locked', 'released', 'refunded')),
    locked_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    released_at TIMESTAMP WITH TIME ZONE,
    refunded_at TIMESTAMP WITH TIME ZONE
  );`,

  `CREATE INDEX IF NOT EXISTS idx_escrows_user_id ON escrows(user_id);`,
  `CREATE INDEX IF NOT EXISTS idx_escrows_status ON escrows(status) WHERE status = 'locked';`,

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

  `CREATE INDEX IF NOT EXISTS idx_p2p_orders_ad_id ON p2p_orders(ad_id);`,
  `CREATE INDEX IF NOT EXISTS idx_p2p_orders_buyer_id ON p2p_orders(buyer_id);`,
  `CREATE INDEX IF NOT EXISTS idx_p2p_orders_seller_id ON p2p_orders(seller_id);`,
  `CREATE INDEX IF NOT EXISTS idx_p2p_orders_status ON p2p_orders(status);`,
  `CREATE INDEX IF NOT EXISTS idx_p2p_orders_expires ON p2p_orders(expires_at) WHERE status IN ('pending', 'payment_pending');`,

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

  `CREATE INDEX IF NOT EXISTS idx_p2p_disputes_order_id ON p2p_disputes(order_id);`,
  `CREATE INDEX IF NOT EXISTS idx_p2p_disputes_status ON p2p_disputes(status) WHERE status IN ('open', 'under_review');`,

  // ============================================
  // TRANSACTIONS TABLE
  // ============================================
  `CREATE TABLE IF NOT EXISTS transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    token_id UUID NOT NULL REFERENCES tokens(id),
    type VARCHAR(30) NOT NULL
      CHECK (type IN ('deposit', 'withdrawal', 'trade', 'fee', 'p2p_escrow_lock', 'p2p_escrow_release', 'p2p_escrow_refund', 'referral_reward', 'airdrop', 'adjustment')),
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'confirming', 'completed', 'failed', 'cancelled')),
    amount DECIMAL(36,18) NOT NULL,
    fee DECIMAL(36,18),
    tx_hash VARCHAR(100),
    chain_id VARCHAR(20) REFERENCES chains(id),
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
  );`,

  `CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_token_id ON transactions(token_id);`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_tx_hash ON transactions(tx_hash) WHERE tx_hash IS NOT NULL;`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_pending ON transactions(chain_id, status) WHERE status IN ('pending', 'confirming');`,

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

  `CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);`,
  `CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);`,
  `CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id);`,

  // Partition audit logs by month (for production scale)
  // `CREATE TABLE audit_logs_y2024m01 PARTITION OF audit_logs FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');`,

  // ============================================
  // REFERRAL REWARDS TABLE
  // ============================================
  `CREATE TABLE IF NOT EXISTS referral_rewards (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    referrer_id UUID NOT NULL REFERENCES users(id),
    referee_id UUID NOT NULL REFERENCES users(id),
    trade_id UUID REFERENCES trades(id),
    reward_amount DECIMAL(36,18) NOT NULL,
    token_id UUID NOT NULL REFERENCES tokens(id),
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'credited', 'failed')),
    credited_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`,

  `CREATE INDEX IF NOT EXISTS idx_referral_rewards_referrer ON referral_rewards(referrer_id);`,
  `CREATE INDEX IF NOT EXISTS idx_referral_rewards_referee ON referral_rewards(referee_id);`,

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
  
  // Insert chains
  `INSERT INTO chains (id, name, type, native_currency, decimals, rpc_url, explorer_url, confirmations_required, avg_block_time)
   VALUES 
     ('ethereum', 'Ethereum', 'evm', 'ETH', 18, 'https://eth-mainnet.g.alchemy.com/v2/demo', 'https://etherscan.io', 12, 12),
     ('bsc', 'BNB Smart Chain', 'evm', 'BNB', 18, 'https://bsc-dataseed.binance.org', 'https://bscscan.com', 15, 3),
     ('polygon', 'Polygon', 'evm', 'MATIC', 18, 'https://polygon-rpc.com', 'https://polygonscan.com', 128, 2),
     ('arbitrum', 'Arbitrum One', 'evm', 'ETH', 18, 'https://arb1.arbitrum.io/rpc', 'https://arbiscan.io', 12, 1),
     ('optimism', 'Optimism', 'evm', 'ETH', 18, 'https://mainnet.optimism.io', 'https://optimistic.etherscan.io', 12, 2),
     ('base', 'Base', 'evm', 'ETH', 18, 'https://mainnet.base.org', 'https://basescan.org', 12, 2),
     ('solana', 'Solana', 'solana', 'SOL', 9, 'https://api.mainnet-beta.solana.com', 'https://solscan.io', 32, 1),
     ('tron', 'Tron', 'tron', 'TRX', 6, 'https://api.trongrid.io', 'https://tronscan.org', 19, 3),
     ('bitcoin', 'Bitcoin', 'bitcoin', 'BTC', 8, 'http://localhost:8332', 'https://blockstream.info', 6, 600)
   ON CONFLICT (id) DO NOTHING;`,

  // Insert tokens (native + major stablecoins)
  `INSERT INTO tokens (id, symbol, name, chain_id, contract_address, decimals, is_active, is_native, min_deposit, min_withdrawal, withdrawal_fee)
   VALUES
     -- Native tokens
     (uuid_generate_v4(), 'ETH', 'Ethereum', 'ethereum', NULL, 18, true, true, 0.001, 0.001, 0.0005),
     (uuid_generate_v4(), 'BNB', 'BNB', 'bsc', NULL, 18, true, true, 0.01, 0.01, 0.0005),
     (uuid_generate_v4(), 'MATIC', 'Polygon', 'polygon', NULL, 18, true, true, 1, 1, 0.1),
     (uuid_generate_v4(), 'SOL', 'Solana', 'solana', NULL, 9, true, true, 0.01, 0.01, 0.001),
     (uuid_generate_v4(), 'TRX', 'Tron', 'tron', NULL, 6, true, true, 10, 10, 1),
     (uuid_generate_v4(), 'BTC', 'Bitcoin', 'bitcoin', NULL, 8, true, true, 0.0001, 0.0001, 0.00005),
     
     -- USDT on different chains
     (uuid_generate_v4(), 'USDT', 'Tether USD', 'ethereum', '0xdAC17F958D2ee523a2206206994597C13D831ec7', 6, true, false, 10, 10, 5),
     (uuid_generate_v4(), 'USDT', 'Tether USD', 'bsc', '0x55d398326f99059fF775485246999027B3197955', 18, true, false, 10, 10, 1),
     (uuid_generate_v4(), 'USDT', 'Tether USD', 'polygon', '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', 6, true, false, 10, 10, 1),
     (uuid_generate_v4(), 'USDT', 'Tether USD', 'tron', 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', 6, true, false, 10, 10, 1),
     (uuid_generate_v4(), 'USDT', 'Tether USD', 'arbitrum', '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', 6, true, false, 10, 10, 1),
     
     -- USDC on different chains
     (uuid_generate_v4(), 'USDC', 'USD Coin', 'ethereum', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 6, true, false, 10, 10, 5),
     (uuid_generate_v4(), 'USDC', 'USD Coin', 'bsc', '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', 18, true, false, 10, 10, 1),
     (uuid_generate_v4(), 'USDC', 'USD Coin', 'polygon', '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', 6, true, false, 10, 10, 1),
     (uuid_generate_v4(), 'USDC', 'USD Coin', 'arbitrum', '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', 6, true, false, 10, 10, 1),
     (uuid_generate_v4(), 'USDC', 'USD Coin', 'base', '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 6, true, false, 10, 10, 1)
   ON CONFLICT DO NOTHING;`,

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
];

async function migrate(direction: 'up' | 'down' = 'up'): Promise<void> {
  logger.info(`Running database migrations (${direction})...`);

  try {
    if (direction === 'up') {
      for (let i = 0; i < migrations.length; i++) {
        const migration = migrations[i]!;
        try {
          await db.query(migration);
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
