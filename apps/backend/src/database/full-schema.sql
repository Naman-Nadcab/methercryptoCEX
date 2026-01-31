-- ============================================================================
-- ADVANCED CRYPTOCURRENCY EXCHANGE DATABASE SCHEMA
-- Spot Orderbook + P2P Exchange (PostgreSQL Version)
-- Version: 1.0
-- ============================================================================

-- Drop all existing tables and types
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO public;

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- ENUM TYPES
-- ============================================================================

-- User related enums
CREATE TYPE user_status AS ENUM ('pending', 'active', 'suspended', 'banned', 'deleted');
CREATE TYPE account_type AS ENUM ('individual', 'corporate', 'institutional');
CREATE TYPE device_type AS ENUM ('web', 'ios', 'android', 'api');
CREATE TYPE activity_type AS ENUM (
    'login', 'logout', 'login_failed',
    'password_change', 'password_reset',
    '2fa_enable', '2fa_disable',
    'api_key_create', 'api_key_delete',
    'withdrawal_address_add', 'withdrawal_address_delete',
    'kyc_submit', 'settings_change',
    'device_trust', 'device_untrust'
);

-- KYC enums
CREATE TYPE kyc_status AS ENUM ('pending', 'under_review', 'approved', 'rejected', 'expired');
CREATE TYPE gender_type AS ENUM ('male', 'female', 'other');
CREATE TYPE document_type AS ENUM ('passport', 'national_id', 'driving_license', 'residence_permit');
CREATE TYPE kyc_document_type AS ENUM (
    'id_front', 'id_back', 'passport_main', 'passport_photo',
    'selfie', 'selfie_with_id', 'proof_of_address', 'bank_statement',
    'company_registration', 'memorandum_of_association',
    'director_list', 'shareholder_list', 'source_of_funds', 'other'
);
CREATE TYPE verification_status AS ENUM ('pending', 'verified', 'rejected');
CREATE TYPE kyc_action AS ENUM ('submitted', 'auto_verified', 'manual_review', 'approved', 'rejected', 'expired');

-- Referral enums
CREATE TYPE referral_code_type AS ENUM ('standard', 'influencer', 'affiliate', 'campaign');
CREATE TYPE referral_status AS ENUM ('pending', 'active', 'expired', 'terminated');
CREATE TYPE commission_source AS ENUM ('spot_trade', 'p2p_trade', 'futures_trade', 'margin_trade');
CREATE TYPE commission_status AS ENUM ('pending', 'credited', 'cancelled');

-- Blockchain/Currency enums
CREATE TYPE network_type AS ENUM ('mainnet', 'testnet');
CREATE TYPE currency_type AS ENUM ('crypto', 'fiat', 'stablecoin');
CREATE TYPE fee_type AS ENUM ('fixed', 'percentage');

-- Deposit/Withdrawal enums
CREATE TYPE deposit_status AS ENUM ('pending', 'confirming', 'completed', 'failed', 'cancelled');
CREATE TYPE withdrawal_status AS ENUM (
    'pending_approval', 'pending_email_verify', 'pending_2fa',
    'processing', 'pending_blockchain',
    'completed', 'failed', 'cancelled', 'rejected'
);
CREATE TYPE transfer_type AS ENUM ('user_to_user', 'spot_to_p2p', 'p2p_to_spot', 'spot_to_futures');
CREATE TYPE transfer_status AS ENUM ('pending', 'completed', 'failed', 'cancelled');

-- Trading enums
CREATE TYPE pair_status AS ENUM ('active', 'suspended', 'delisted');
CREATE TYPE order_type AS ENUM (
    'market', 'limit', 'stop_loss', 'stop_loss_limit',
    'take_profit', 'take_profit_limit', 'stop_limit',
    'trailing_stop', 'iceberg', 'fok', 'ioc', 'gtc', 'gtd'
);
CREATE TYPE order_side AS ENUM ('buy', 'sell');
CREATE TYPE time_in_force AS ENUM ('GTC', 'IOC', 'FOK', 'GTD');
CREATE TYPE order_status AS ENUM (
    'new', 'partially_filled', 'filled',
    'cancelled', 'rejected', 'expired', 'pending_cancel'
);
CREATE TYPE order_source AS ENUM ('web', 'mobile', 'api', 'bot');
CREATE TYPE trade_role AS ENUM ('maker', 'taker');
CREATE TYPE candle_interval AS ENUM ('1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M');

-- P2P enums
CREATE TYPE p2p_method_type AS ENUM ('bank', 'ewallet', 'card', 'cash', 'other');
CREATE TYPE p2p_ad_type AS ENUM ('buy', 'sell');
CREATE TYPE p2p_pricing_type AS ENUM ('fixed', 'floating');
CREATE TYPE p2p_ad_status AS ENUM ('active', 'paused', 'completed', 'cancelled');
CREATE TYPE p2p_order_status AS ENUM (
    'pending', 'awaiting_payment', 'payment_sent',
    'payment_confirmed', 'completed',
    'disputed', 'cancelled', 'expired',
    'appeal_pending', 'appeal_resolved'
);
CREATE TYPE dispute_reason AS ENUM (
    'payment_not_received', 'payment_incomplete',
    'wrong_amount', 'delayed_release',
    'fraud_suspected', 'other'
);
CREATE TYPE dispute_status AS ENUM ('open', 'under_review', 'resolved', 'escalated');
CREATE TYPE dispute_resolution AS ENUM ('favor_buyer', 'favor_seller', 'split', 'cancelled');
CREATE TYPE message_type AS ENUM ('text', 'image', 'system');

-- Ledger enums
CREATE TYPE ledger_reference_type AS ENUM (
    'deposit', 'withdrawal', 'trade_buy', 'trade_sell',
    'trade_fee', 'referral_commission',
    'p2p_escrow_lock', 'p2p_escrow_release',
    'internal_transfer', 'adjustment',
    'staking_lock', 'staking_reward', 'airdrop', 'promotion'
);
CREATE TYPE balance_type AS ENUM ('available', 'locked', 'pending');

-- Notification enums
CREATE TYPE notification_type AS ENUM (
    'deposit_confirmed', 'withdrawal_processed',
    'order_filled', 'order_cancelled',
    'p2p_new_order', 'p2p_payment_received', 'p2p_completed',
    'kyc_approved', 'kyc_rejected',
    'security_alert', 'system_announcement',
    'referral_commission', 'promotion'
);

CREATE TYPE setting_value_type AS ENUM ('string', 'number', 'boolean', 'json');

-- ============================================================================
-- SECTION 1: USER MANAGEMENT & ONBOARDING
-- ============================================================================

-- 1.1 Users Master Table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    email_verified BOOLEAN DEFAULT FALSE,
    phone VARCHAR(20) UNIQUE,
    phone_verified BOOLEAN DEFAULT FALSE,
    password_hash VARCHAR(255) NOT NULL,
    salt VARCHAR(64) NOT NULL,
    
    -- Profile Info
    username VARCHAR(50) UNIQUE,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    avatar_url TEXT,
    country_code CHAR(2),
    timezone VARCHAR(50) DEFAULT 'UTC',
    language VARCHAR(10) DEFAULT 'en',
    
    -- Account Status
    status user_status DEFAULT 'pending',
    account_type account_type DEFAULT 'individual',
    
    -- Security
    two_fa_enabled BOOLEAN DEFAULT FALSE,
    two_fa_secret VARCHAR(64),
    two_fa_backup_codes JSONB,
    anti_phishing_code VARCHAR(20),
    login_password_enabled BOOLEAN DEFAULT FALSE,
    trading_password_hash VARCHAR(255),
    withdrawal_password_hash VARCHAR(255),
    
    -- Limits & Tiers
    tier_level INT DEFAULT 0,
    daily_withdrawal_limit DECIMAL(30,8) DEFAULT 0,
    monthly_withdrawal_limit DECIMAL(30,8) DEFAULT 0,
    
    -- Trading Preferences
    default_fiat_currency VARCHAR(10) DEFAULT 'USD',
    maker_fee_discount DECIMAL(5,4) DEFAULT 0,
    taker_fee_discount DECIMAL(5,4) DEFAULT 0,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_login_at TIMESTAMP WITH TIME ZONE,
    email_verified_at TIMESTAMP WITH TIME ZONE,
    phone_verified_at TIMESTAMP WITH TIME ZONE,
    deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_phone ON users(phone);
CREATE INDEX idx_users_status ON users(status);
CREATE INDEX idx_users_tier ON users(tier_level);
CREATE INDEX idx_users_created ON users(created_at);

-- 1.2 User Sessions
CREATE TABLE user_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_token VARCHAR(255) UNIQUE NOT NULL,
    refresh_token VARCHAR(255) UNIQUE,
    device_id VARCHAR(255),
    device_type device_type NOT NULL,
    device_name VARCHAR(255),
    browser VARCHAR(100),
    os VARCHAR(100),
    ip_address INET NOT NULL,
    user_agent TEXT,
    location_country VARCHAR(100),
    location_city VARCHAR(100),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    last_activity_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    revoked_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_sessions_user ON user_sessions(user_id);
CREATE INDEX idx_sessions_token ON user_sessions(session_token);
CREATE INDEX idx_sessions_active ON user_sessions(is_active, expires_at);

-- 1.3 User Activity Logs
CREATE TABLE user_activity_logs (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id UUID REFERENCES user_sessions(id),
    activity_type activity_type NOT NULL,
    activity_details JSONB,
    ip_address INET,
    user_agent TEXT,
    risk_score INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_activity_user ON user_activity_logs(user_id);
CREATE INDEX idx_activity_type ON user_activity_logs(activity_type);
CREATE INDEX idx_activity_created ON user_activity_logs(created_at);

-- 1.4 User Devices
CREATE TABLE user_devices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_fingerprint VARCHAR(255) NOT NULL,
    device_name VARCHAR(255),
    device_type device_type NOT NULL,
    is_trusted BOOLEAN DEFAULT FALSE,
    trust_expires_at TIMESTAMP WITH TIME ZONE,
    first_seen_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    ip_address INET,
    location_country VARCHAR(100),
    UNIQUE(user_id, device_fingerprint)
);

CREATE INDEX idx_devices_user ON user_devices(user_id);

-- ============================================================================
-- SECTION 2: KYC (KNOW YOUR CUSTOMER)
-- ============================================================================

-- 2.1 KYC Applications
CREATE TABLE kyc_applications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kyc_level INT NOT NULL,
    status kyc_status DEFAULT 'pending',
    
    -- Personal Information
    legal_first_name VARCHAR(100),
    legal_last_name VARCHAR(100),
    legal_middle_name VARCHAR(100),
    date_of_birth DATE,
    gender gender_type,
    nationality VARCHAR(100),
    
    -- Address
    address_line1 VARCHAR(255),
    address_line2 VARCHAR(255),
    city VARCHAR(100),
    state_province VARCHAR(100),
    postal_code VARCHAR(20),
    country VARCHAR(100),
    
    -- Document Info
    document_type document_type,
    document_number VARCHAR(100),
    document_issuing_country VARCHAR(100),
    document_expiry_date DATE,
    
    -- Corporate KYC
    company_name VARCHAR(255),
    company_registration_number VARCHAR(100),
    company_type VARCHAR(100),
    company_country VARCHAR(100),
    
    -- Verification
    submitted_at TIMESTAMP WITH TIME ZONE,
    reviewed_at TIMESTAMP WITH TIME ZONE,
    reviewed_by UUID,
    reviewer_notes TEXT,
    rejection_reason TEXT,
    
    -- Risk Assessment
    risk_score INT DEFAULT 0,
    pep_check BOOLEAN DEFAULT FALSE,
    sanctions_check BOOLEAN DEFAULT FALSE,
    aml_check BOOLEAN DEFAULT FALSE,
    
    -- Third Party Verification
    third_party_provider VARCHAR(100),
    third_party_reference_id VARCHAR(255),
    third_party_status VARCHAR(50),
    third_party_response JSONB,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_kyc_user ON kyc_applications(user_id);
CREATE INDEX idx_kyc_status ON kyc_applications(status);
CREATE INDEX idx_kyc_level ON kyc_applications(kyc_level);

-- 2.2 KYC Documents
CREATE TABLE kyc_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    kyc_application_id UUID NOT NULL REFERENCES kyc_applications(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    document_type kyc_document_type NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    file_type VARCHAR(50) NOT NULL,
    file_size INT NOT NULL,
    file_hash VARCHAR(64),
    storage_path TEXT NOT NULL,
    ocr_extracted_data JSONB,
    face_match_score DECIMAL(5,2),
    verification_status verification_status DEFAULT 'pending',
    rejection_reason TEXT,
    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    verified_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_kyc_docs_application ON kyc_documents(kyc_application_id);
CREATE INDEX idx_kyc_docs_user ON kyc_documents(user_id);

-- 2.3 KYC Verification History
CREATE TABLE kyc_verification_history (
    id BIGSERIAL PRIMARY KEY,
    kyc_application_id UUID NOT NULL REFERENCES kyc_applications(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action kyc_action NOT NULL,
    previous_status VARCHAR(50),
    new_status VARCHAR(50),
    performed_by UUID,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_kyc_history_application ON kyc_verification_history(kyc_application_id);

-- ============================================================================
-- SECTION 3: REFERRAL SYSTEM
-- ============================================================================

-- 3.1 Referral Codes
CREATE TABLE referral_codes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code VARCHAR(20) UNIQUE NOT NULL,
    code_type referral_code_type DEFAULT 'standard',
    
    referrer_commission_rate DECIMAL(5,4) DEFAULT 0.20,
    referee_discount_rate DECIMAL(5,4) DEFAULT 0.10,
    
    max_referrals INT DEFAULT NULL,
    current_referrals INT DEFAULT 0,
    
    is_active BOOLEAN DEFAULT TRUE,
    valid_from TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    valid_until TIMESTAMP WITH TIME ZONE,
    
    total_earnings DECIMAL(30,8) DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_referral_code ON referral_codes(code);
CREATE INDEX idx_referral_user ON referral_codes(user_id);

-- 3.2 Referral Relationships
CREATE TABLE referral_relationships (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    referrer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    referee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    referral_code_id UUID NOT NULL REFERENCES referral_codes(id),
    
    locked_referrer_commission DECIMAL(5,4) NOT NULL,
    locked_referee_discount DECIMAL(5,4) NOT NULL,
    
    tier_level INT DEFAULT 1,
    parent_relationship_id UUID REFERENCES referral_relationships(id),
    
    status referral_status DEFAULT 'pending',
    activated_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE,
    
    total_commission_earned DECIMAL(30,8) DEFAULT 0,
    total_trades_count INT DEFAULT 0,
    total_trading_volume DECIMAL(30,8) DEFAULT 0,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(referrer_id, referee_id)
);

CREATE INDEX idx_referral_rel_referrer ON referral_relationships(referrer_id);
CREATE INDEX idx_referral_rel_referee ON referral_relationships(referee_id);

-- 3.3 Referral Commissions
CREATE TABLE referral_commissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    relationship_id UUID NOT NULL REFERENCES referral_relationships(id),
    referrer_id UUID NOT NULL REFERENCES users(id),
    referee_id UUID NOT NULL REFERENCES users(id),
    
    source_type commission_source NOT NULL,
    source_trade_id UUID NOT NULL,
    
    original_fee DECIMAL(30,8) NOT NULL,
    commission_rate DECIMAL(5,4) NOT NULL,
    commission_amount DECIMAL(30,8) NOT NULL,
    commission_currency VARCHAR(20) NOT NULL,
    
    status commission_status DEFAULT 'pending',
    credited_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_commission_referrer ON referral_commissions(referrer_id);
CREATE INDEX idx_commission_status ON referral_commissions(status);
CREATE INDEX idx_commission_created ON referral_commissions(created_at);

-- 3.4 Referral Campaigns
CREATE TABLE referral_campaigns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    campaign_name VARCHAR(255) NOT NULL,
    campaign_code VARCHAR(50) UNIQUE NOT NULL,
    description TEXT,
    
    referrer_commission_rate DECIMAL(5,4) NOT NULL,
    referee_discount_rate DECIMAL(5,4) NOT NULL,
    bonus_amount DECIMAL(30,8) DEFAULT 0,
    bonus_currency VARCHAR(20),
    
    min_trade_volume DECIMAL(30,8) DEFAULT 0,
    min_deposit_amount DECIMAL(30,8) DEFAULT 0,
    
    max_participants INT,
    current_participants INT DEFAULT 0,
    total_budget DECIMAL(30,8),
    spent_budget DECIMAL(30,8) DEFAULT 0,
    
    is_active BOOLEAN DEFAULT TRUE,
    start_date TIMESTAMP WITH TIME ZONE NOT NULL,
    end_date TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_campaign_code ON referral_campaigns(campaign_code);
CREATE INDEX idx_campaign_active ON referral_campaigns(is_active, start_date, end_date);

-- ============================================================================
-- SECTION 4: WALLET MANAGEMENT (MULTI-CHAIN)
-- ============================================================================

-- 4.1 Supported Blockchains
CREATE TABLE blockchains (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    chain_name VARCHAR(100) NOT NULL,
    chain_symbol VARCHAR(20) NOT NULL UNIQUE,
    chain_id INT,
    
    network_type network_type DEFAULT 'mainnet',
    rpc_endpoints JSONB,
    explorer_url VARCHAR(255),
    
    derivation_path VARCHAR(100),
    address_format VARCHAR(50),
    
    required_confirmations INT DEFAULT 12,
    
    is_active BOOLEAN DEFAULT TRUE,
    deposit_enabled BOOLEAN DEFAULT TRUE,
    withdrawal_enabled BOOLEAN DEFAULT TRUE,
    
    avg_block_time INT,
    gas_limit_default BIGINT,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_blockchain_symbol ON blockchains(chain_symbol);

-- 4.2 Supported Tokens/Currencies
CREATE TABLE currencies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    symbol VARCHAR(20) NOT NULL,
    name VARCHAR(100) NOT NULL,
    currency_type currency_type NOT NULL,
    
    blockchain_id UUID REFERENCES blockchains(id),
    contract_address VARCHAR(100),
    decimals INT DEFAULT 18,
    
    logo_url TEXT,
    display_decimals INT DEFAULT 8,
    
    is_active BOOLEAN DEFAULT TRUE,
    is_listed BOOLEAN DEFAULT TRUE,
    deposit_enabled BOOLEAN DEFAULT TRUE,
    withdrawal_enabled BOOLEAN DEFAULT TRUE,
    
    min_deposit DECIMAL(30,8) DEFAULT 0,
    min_withdrawal DECIMAL(30,8),
    withdrawal_fee DECIMAL(30,8),
    withdrawal_fee_type fee_type DEFAULT 'fixed',
    
    max_daily_withdrawal DECIMAL(30,8),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(symbol, blockchain_id)
);

CREATE INDEX idx_currency_symbol ON currencies(symbol);
CREATE INDEX idx_currency_blockchain ON currencies(blockchain_id);

-- 4.3 User Wallets (Per Chain)
CREATE TABLE user_wallets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blockchain_id UUID NOT NULL REFERENCES blockchains(id),
    
    address VARCHAR(255) NOT NULL,
    address_tag VARCHAR(100),
    
    encrypted_private_key TEXT,
    key_index INT,
    derivation_path VARCHAR(100),
    
    is_active BOOLEAN DEFAULT TRUE,
    is_internal BOOLEAN DEFAULT TRUE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, blockchain_id)
);

CREATE INDEX idx_wallet_user ON user_wallets(user_id);
CREATE INDEX idx_wallet_address ON user_wallets(address);

-- 4.4 User Balances (Spot)
-- Balance account types for internal transfers
CREATE TYPE balance_account_type AS ENUM ('funding', 'trading', 'unified');

CREATE TABLE user_balances (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    currency_id UUID NOT NULL REFERENCES currencies(id),
    account_type balance_account_type DEFAULT 'funding',
    
    available_balance DECIMAL(30,8) DEFAULT 0,
    locked_balance DECIMAL(30,8) DEFAULT 0,
    pending_balance DECIMAL(30,8) DEFAULT 0,
    staked_balance DECIMAL(30,8) DEFAULT 0,
    
    total_deposited DECIMAL(30,8) DEFAULT 0,
    total_withdrawn DECIMAL(30,8) DEFAULT 0,
    
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, currency_id, account_type),
    CONSTRAINT chk_available_balance CHECK (available_balance >= 0),
    CONSTRAINT chk_locked_balance CHECK (locked_balance >= 0)
);

CREATE INDEX idx_balance_user ON user_balances(user_id);
CREATE INDEX idx_balance_currency ON user_balances(currency_id);

-- 4.5 User Whitelisted Addresses
CREATE TABLE withdrawal_addresses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blockchain_id UUID NOT NULL REFERENCES blockchains(id),
    label VARCHAR(100),
    address VARCHAR(255) NOT NULL,
    address_tag VARCHAR(100),
    
    is_whitelisted BOOLEAN DEFAULT FALSE,
    whitelisted_at TIMESTAMP WITH TIME ZONE,
    whitelist_expires_at TIMESTAMP WITH TIME ZONE,
    
    is_verified BOOLEAN DEFAULT FALSE,
    verification_code VARCHAR(10),
    verified_at TIMESTAMP WITH TIME ZONE,
    
    is_internal BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_withdrawal_addr_user ON withdrawal_addresses(user_id);
CREATE INDEX idx_withdrawal_addr_address ON withdrawal_addresses(address);

-- ============================================================================
-- SECTION 5: DEPOSITS & WITHDRAWALS
-- ============================================================================

-- 5.1 Deposits
CREATE TABLE deposits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    currency_id UUID NOT NULL REFERENCES currencies(id),
    blockchain_id UUID NOT NULL REFERENCES blockchains(id),
    wallet_id UUID NOT NULL REFERENCES user_wallets(id),
    
    tx_hash VARCHAR(255) NOT NULL,
    from_address VARCHAR(255),
    to_address VARCHAR(255) NOT NULL,
    amount DECIMAL(30,8) NOT NULL,
    fee DECIMAL(30,8) DEFAULT 0,
    
    confirmations INT DEFAULT 0,
    required_confirmations INT NOT NULL,
    block_number BIGINT,
    block_timestamp TIMESTAMP WITH TIME ZONE,
    
    status deposit_status DEFAULT 'pending',
    credited_at TIMESTAMP WITH TIME ZONE,
    
    risk_score INT DEFAULT 0,
    risk_flags JSONB,
    is_flagged BOOLEAN DEFAULT FALSE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_deposit_user ON deposits(user_id);
CREATE INDEX idx_deposit_tx ON deposits(tx_hash);
CREATE INDEX idx_deposit_status ON deposits(status);
CREATE INDEX idx_deposit_created ON deposits(created_at);

-- 5.2 Withdrawals
CREATE TABLE withdrawals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    currency_id UUID NOT NULL REFERENCES currencies(id),
    blockchain_id UUID NOT NULL REFERENCES blockchains(id),
    
    to_address VARCHAR(255) NOT NULL,
    address_tag VARCHAR(100),
    withdrawal_address_id UUID REFERENCES withdrawal_addresses(id),
    
    amount DECIMAL(30,8) NOT NULL,
    fee DECIMAL(30,8) NOT NULL,
    network_fee DECIMAL(30,8),
    net_amount DECIMAL(30,8) NOT NULL,
    
    tx_hash VARCHAR(255),
    block_number BIGINT,
    
    status withdrawal_status DEFAULT 'pending_approval',
    
    email_verified BOOLEAN DEFAULT FALSE,
    two_fa_verified BOOLEAN DEFAULT FALSE,
    
    processed_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    cancelled_at TIMESTAMP WITH TIME ZONE,
    cancellation_reason TEXT,
    
    requires_manual_review BOOLEAN DEFAULT FALSE,
    reviewed_by UUID,
    reviewed_at TIMESTAMP WITH TIME ZONE,
    review_notes TEXT,
    rejection_reason TEXT,
    
    risk_score INT DEFAULT 0,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_withdrawal_user ON withdrawals(user_id);
CREATE INDEX idx_withdrawal_status ON withdrawals(status);
CREATE INDEX idx_withdrawal_tx ON withdrawals(tx_hash);
CREATE INDEX idx_withdrawal_created ON withdrawals(created_at);

-- 5.3 Internal Transfers
CREATE TABLE internal_transfers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    from_user_id UUID NOT NULL REFERENCES users(id),
    to_user_id UUID NOT NULL REFERENCES users(id),
    currency_id UUID NOT NULL REFERENCES currencies(id),
    
    amount DECIMAL(30,8) NOT NULL,
    fee DECIMAL(30,8) DEFAULT 0,
    
    transfer_type transfer_type NOT NULL,
    status transfer_status DEFAULT 'completed',
    notes TEXT,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_internal_from ON internal_transfers(from_user_id);
CREATE INDEX idx_internal_to ON internal_transfers(to_user_id);
CREATE INDEX idx_internal_created ON internal_transfers(created_at);

-- ============================================================================
-- SECTION 6: SPOT TRADING - ORDERBOOK
-- ============================================================================

-- 6.1 Trading Pairs
CREATE TABLE trading_pairs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    base_currency_id UUID NOT NULL REFERENCES currencies(id),
    quote_currency_id UUID NOT NULL REFERENCES currencies(id),
    symbol VARCHAR(20) NOT NULL UNIQUE,
    
    price_precision INT NOT NULL DEFAULT 8,
    quantity_precision INT NOT NULL DEFAULT 8,
    min_price DECIMAL(30,8),
    max_price DECIMAL(30,8),
    tick_size DECIMAL(30,8) NOT NULL,
    
    min_quantity DECIMAL(30,8) NOT NULL,
    max_quantity DECIMAL(30,8),
    min_notional DECIMAL(30,8),
    max_notional DECIMAL(30,8),
    
    maker_fee DECIMAL(5,4) DEFAULT 0.001,
    taker_fee DECIMAL(5,4) DEFAULT 0.001,
    
    status pair_status DEFAULT 'active',
    trading_enabled BOOLEAN DEFAULT TRUE,
    
    sort_order INT DEFAULT 0,
    is_featured BOOLEAN DEFAULT FALSE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_pair_symbol ON trading_pairs(symbol);
CREATE INDEX idx_pair_status ON trading_pairs(status);

-- 6.2 Spot Orders
CREATE TABLE spot_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    trading_pair_id UUID NOT NULL REFERENCES trading_pairs(id),
    
    client_order_id VARCHAR(100),
    order_type order_type NOT NULL,
    side order_side NOT NULL,
    
    price DECIMAL(30,8),
    stop_price DECIMAL(30,8),
    trailing_delta DECIMAL(30,8),
    
    quantity DECIMAL(30,8) NOT NULL,
    filled_quantity DECIMAL(30,8) DEFAULT 0,
    remaining_quantity DECIMAL(30,8),
    
    visible_quantity DECIMAL(30,8),
    
    quote_quantity DECIMAL(30,8),
    filled_quote_amount DECIMAL(30,8) DEFAULT 0,
    
    avg_fill_price DECIMAL(30,8),
    
    fee_amount DECIMAL(30,8) DEFAULT 0,
    fee_currency_id UUID REFERENCES currencies(id),
    is_maker BOOLEAN,
    
    time_in_force time_in_force DEFAULT 'GTC',
    expire_at TIMESTAMP WITH TIME ZONE,
    
    status order_status DEFAULT 'new',
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    filled_at TIMESTAMP WITH TIME ZONE,
    cancelled_at TIMESTAMP WITH TIME ZONE,
    
    source order_source DEFAULT 'web',
    ip_address INET
);

CREATE INDEX idx_orders_user ON spot_orders(user_id);
CREATE INDEX idx_orders_pair ON spot_orders(trading_pair_id);
CREATE INDEX idx_orders_status ON spot_orders(status);
CREATE INDEX idx_orders_created ON spot_orders(created_at);
CREATE INDEX idx_orders_client_id ON spot_orders(client_order_id);
CREATE INDEX idx_orders_book ON spot_orders(trading_pair_id, side, status, price);

-- 6.3 Order Book Snapshots
CREATE TABLE orderbook_snapshots (
    id BIGSERIAL PRIMARY KEY,
    trading_pair_id UUID NOT NULL REFERENCES trading_pairs(id),
    snapshot_time TIMESTAMP WITH TIME ZONE NOT NULL,
    bids JSONB NOT NULL,
    asks JSONB NOT NULL,
    best_bid DECIMAL(30,8),
    best_ask DECIMAL(30,8),
    spread DECIMAL(30,8),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_snapshot_pair_time ON orderbook_snapshots(trading_pair_id, snapshot_time);

-- 6.4 Spot Trades
CREATE TABLE spot_trades (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    trading_pair_id UUID NOT NULL REFERENCES trading_pairs(id),
    
    maker_order_id UUID NOT NULL REFERENCES spot_orders(id),
    taker_order_id UUID NOT NULL REFERENCES spot_orders(id),
    maker_user_id UUID NOT NULL REFERENCES users(id),
    taker_user_id UUID NOT NULL REFERENCES users(id),
    
    price DECIMAL(30,8) NOT NULL,
    quantity DECIMAL(30,8) NOT NULL,
    quote_amount DECIMAL(30,8) NOT NULL,
    side order_side NOT NULL,
    
    maker_fee DECIMAL(30,8) NOT NULL,
    maker_fee_currency_id UUID NOT NULL REFERENCES currencies(id),
    taker_fee DECIMAL(30,8) NOT NULL,
    taker_fee_currency_id UUID NOT NULL REFERENCES currencies(id),
    
    maker_referral_commission DECIMAL(30,8) DEFAULT 0,
    taker_referral_commission DECIMAL(30,8) DEFAULT 0,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_trades_pair ON spot_trades(trading_pair_id);
CREATE INDEX idx_trades_maker ON spot_trades(maker_user_id);
CREATE INDEX idx_trades_taker ON spot_trades(taker_user_id);
CREATE INDEX idx_trades_created ON spot_trades(created_at);
CREATE INDEX idx_trades_maker_order ON spot_trades(maker_order_id);
CREATE INDEX idx_trades_taker_order ON spot_trades(taker_order_id);

-- 6.5 User Trade History
CREATE TABLE user_trade_history (
    id BIGSERIAL PRIMARY KEY,
    trade_id UUID NOT NULL REFERENCES spot_trades(id),
    user_id UUID NOT NULL REFERENCES users(id),
    trading_pair_id UUID NOT NULL REFERENCES trading_pairs(id),
    side order_side NOT NULL,
    role trade_role NOT NULL,
    price DECIMAL(30,8) NOT NULL,
    quantity DECIMAL(30,8) NOT NULL,
    quote_amount DECIMAL(30,8) NOT NULL,
    fee DECIMAL(30,8) NOT NULL,
    fee_currency_id UUID NOT NULL REFERENCES currencies(id),
    order_id UUID NOT NULL REFERENCES spot_orders(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_user_trades_user ON user_trade_history(user_id);
CREATE INDEX idx_user_trades_pair ON user_trade_history(user_id, trading_pair_id);
CREATE INDEX idx_user_trades_created ON user_trade_history(user_id, created_at);

-- 6.6 OHLCV Candles
CREATE TABLE ohlcv_candles (
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
    quote_volume DECIMAL(30,8) NOT NULL,
    trade_count INT NOT NULL,
    UNIQUE(trading_pair_id, interval_type, open_time)
);

CREATE INDEX idx_candles_query ON ohlcv_candles(trading_pair_id, interval_type, open_time);

-- ============================================================================
-- SECTION 7: P2P TRADING
-- ============================================================================

-- 7.1 P2P Payment Methods
CREATE TABLE p2p_payment_methods (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    code VARCHAR(50) UNIQUE NOT NULL,
    method_type p2p_method_type NOT NULL,
    
    supported_countries JSONB,
    required_fields JSONB NOT NULL,
    
    icon_url TEXT,
    color_hex VARCHAR(7),
    is_active BOOLEAN DEFAULT TRUE,
    sort_order INT DEFAULT 0,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_p2p_method_code ON p2p_payment_methods(code);

-- 7.2 User P2P Payment Methods
CREATE TABLE user_p2p_payment_methods (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    payment_method_id UUID NOT NULL REFERENCES p2p_payment_methods(id),
    
    payment_details JSONB NOT NULL,
    display_name VARCHAR(100),
    is_verified BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_user_payment_user ON user_p2p_payment_methods(user_id);

-- 7.3 P2P Advertisements
CREATE TABLE p2p_ads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    
    ad_type p2p_ad_type NOT NULL,
    
    crypto_currency_id UUID NOT NULL REFERENCES currencies(id),
    fiat_currency VARCHAR(10) NOT NULL,
    
    pricing_type p2p_pricing_type DEFAULT 'floating',
    fixed_price DECIMAL(30,8),
    float_percentage DECIMAL(5,2),
    price_source VARCHAR(50) DEFAULT 'binance',
    current_price DECIMAL(30,8),
    
    min_amount DECIMAL(30,8) NOT NULL,
    max_amount DECIMAL(30,8) NOT NULL,
    available_amount DECIMAL(30,8) NOT NULL,
    
    payment_time_limit INT DEFAULT 15,
    accepted_payment_methods JSONB NOT NULL,
    
    min_trades_required INT DEFAULT 0,
    min_completion_rate DECIMAL(5,2),
    min_kyc_level INT DEFAULT 1,
    allowed_countries JSONB,
    blocked_countries JSONB,
    
    auto_reply_message TEXT,
    terms_and_conditions TEXT,
    
    status p2p_ad_status DEFAULT 'active',
    
    total_orders INT DEFAULT 0,
    completed_orders INT DEFAULT 0,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_p2p_ads_user ON p2p_ads(user_id);
CREATE INDEX idx_p2p_ads_type ON p2p_ads(ad_type, crypto_currency_id, fiat_currency);
CREATE INDEX idx_p2p_ads_status ON p2p_ads(status);
CREATE INDEX idx_p2p_ads_price ON p2p_ads(ad_type, fiat_currency, current_price);

-- 7.4 P2P Orders
CREATE TABLE p2p_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ad_id UUID NOT NULL REFERENCES p2p_ads(id),
    
    buyer_id UUID NOT NULL REFERENCES users(id),
    seller_id UUID NOT NULL REFERENCES users(id),
    initiator_id UUID NOT NULL REFERENCES users(id),
    
    order_type p2p_ad_type NOT NULL,
    crypto_currency_id UUID NOT NULL REFERENCES currencies(id),
    fiat_currency VARCHAR(10) NOT NULL,
    price DECIMAL(30,8) NOT NULL,
    crypto_amount DECIMAL(30,8) NOT NULL,
    fiat_amount DECIMAL(30,8) NOT NULL,
    
    payment_method_id UUID NOT NULL REFERENCES user_p2p_payment_methods(id),
    payment_details JSONB,
    payment_reference VARCHAR(255),
    
    payment_deadline TIMESTAMP WITH TIME ZONE,
    release_deadline TIMESTAMP WITH TIME ZONE,
    
    status p2p_order_status DEFAULT 'pending',
    
    escrow_locked BOOLEAN DEFAULT FALSE,
    escrow_locked_at TIMESTAMP WITH TIME ZONE,
    escrow_released_at TIMESTAMP WITH TIME ZONE,
    
    chat_room_id UUID,
    
    completed_at TIMESTAMP WITH TIME ZONE,
    cancelled_at TIMESTAMP WITH TIME ZONE,
    cancelled_by UUID REFERENCES users(id),
    cancellation_reason TEXT,
    
    buyer_rated BOOLEAN DEFAULT FALSE,
    seller_rated BOOLEAN DEFAULT FALSE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_p2p_order_buyer ON p2p_orders(buyer_id);
CREATE INDEX idx_p2p_order_seller ON p2p_orders(seller_id);
CREATE INDEX idx_p2p_order_status ON p2p_orders(status);
CREATE INDEX idx_p2p_order_ad ON p2p_orders(ad_id);
CREATE INDEX idx_p2p_order_created ON p2p_orders(created_at);

-- 7.5 P2P Disputes
CREATE TABLE p2p_disputes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES p2p_orders(id),
    raised_by UUID NOT NULL REFERENCES users(id),
    raised_against UUID NOT NULL REFERENCES users(id),
    
    reason dispute_reason NOT NULL,
    description TEXT NOT NULL,
    evidence JSONB,
    
    status dispute_status DEFAULT 'open',
    resolution dispute_resolution,
    resolution_notes TEXT,
    resolved_by UUID,
    resolved_at TIMESTAMP WITH TIME ZONE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_dispute_order ON p2p_disputes(order_id);
CREATE INDEX idx_dispute_status ON p2p_disputes(status);

-- 7.6 P2P Chat Messages
CREATE TABLE p2p_chat_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES p2p_orders(id),
    sender_id UUID NOT NULL REFERENCES users(id),
    message_type message_type DEFAULT 'text',
    content TEXT NOT NULL,
    attachment_url TEXT,
    is_read BOOLEAN DEFAULT FALSE,
    read_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_chat_order ON p2p_chat_messages(order_id);
CREATE INDEX idx_chat_sender ON p2p_chat_messages(sender_id);

-- 7.7 P2P User Ratings
CREATE TABLE p2p_ratings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES p2p_orders(id),
    rater_id UUID NOT NULL REFERENCES users(id),
    rated_user_id UUID NOT NULL REFERENCES users(id),
    rating INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    review TEXT,
    is_positive BOOLEAN GENERATED ALWAYS AS (rating >= 4) STORED,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(order_id, rater_id)
);

CREATE INDEX idx_rating_rated_user ON p2p_ratings(rated_user_id);

-- 7.8 P2P Merchant Stats
CREATE TABLE p2p_merchant_stats (
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
);

-- ============================================================================
-- SECTION 8: BALANCE LEDGER & AUDIT
-- ============================================================================

CREATE TABLE balance_ledger (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id),
    currency_id UUID NOT NULL REFERENCES currencies(id),
    
    reference_type ledger_reference_type NOT NULL,
    reference_id UUID NOT NULL,
    
    debit DECIMAL(30,8) DEFAULT 0,
    credit DECIMAL(30,8) DEFAULT 0,
    
    balance_before DECIMAL(30,8) NOT NULL,
    balance_after DECIMAL(30,8) NOT NULL,
    balance_type balance_type DEFAULT 'available',
    
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ledger_user ON balance_ledger(user_id);
CREATE INDEX idx_ledger_currency ON balance_ledger(user_id, currency_id);
CREATE INDEX idx_ledger_reference ON balance_ledger(reference_type, reference_id);
CREATE INDEX idx_ledger_created ON balance_ledger(created_at);

-- ============================================================================
-- SECTION 9: API KEYS
-- ============================================================================

CREATE TABLE api_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label VARCHAR(100) NOT NULL,
    api_key VARCHAR(64) UNIQUE NOT NULL,
    api_secret_hash VARCHAR(255) NOT NULL,
    
    can_read BOOLEAN DEFAULT TRUE,
    can_trade BOOLEAN DEFAULT FALSE,
    can_withdraw BOOLEAN DEFAULT FALSE,
    
    ip_whitelist JSONB,
    allowed_pairs JSONB,
    
    rate_limit INT DEFAULT 1200,
    
    is_active BOOLEAN DEFAULT TRUE,
    
    last_used_at TIMESTAMP WITH TIME ZONE,
    total_requests BIGINT DEFAULT 0,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_api_key ON api_keys(api_key);
CREATE INDEX idx_api_user ON api_keys(user_id);

-- ============================================================================
-- SECTION 10: SYSTEM CONFIGURATION
-- ============================================================================

-- 10.1 Fee Tiers
CREATE TABLE fee_tiers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tier_name VARCHAR(50) NOT NULL,
    tier_level INT UNIQUE NOT NULL,
    
    min_trading_volume DECIMAL(30,8) NOT NULL,
    min_token_holding DECIMAL(30,8) DEFAULT 0,
    
    spot_maker_fee DECIMAL(5,4) NOT NULL,
    spot_taker_fee DECIMAL(5,4) NOT NULL,
    
    withdrawal_fee_discount DECIMAL(5,4) DEFAULT 0,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 10.2 System Settings
CREATE TABLE system_settings (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT NOT NULL,
    value_type setting_value_type DEFAULT 'string',
    description TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_by UUID
);

-- ============================================================================
-- SECTION 11: NOTIFICATIONS
-- ============================================================================

CREATE TABLE user_notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    notification_type notification_type NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    data JSONB,
    channels JSONB DEFAULT '["push", "email"]',
    is_read BOOLEAN DEFAULT FALSE,
    read_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_notification_user ON user_notifications(user_id);
CREATE INDEX idx_notification_unread ON user_notifications(user_id, is_read);

-- ============================================================================
-- TRIGGERS FOR updated_at
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_kyc_applications_updated_at BEFORE UPDATE ON kyc_applications FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_referral_codes_updated_at BEFORE UPDATE ON referral_codes FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_blockchains_updated_at BEFORE UPDATE ON blockchains FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_currencies_updated_at BEFORE UPDATE ON currencies FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_deposits_updated_at BEFORE UPDATE ON deposits FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_withdrawals_updated_at BEFORE UPDATE ON withdrawals FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_trading_pairs_updated_at BEFORE UPDATE ON trading_pairs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_spot_orders_updated_at BEFORE UPDATE ON spot_orders FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_p2p_ads_updated_at BEFORE UPDATE ON p2p_ads FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_p2p_orders_updated_at BEFORE UPDATE ON p2p_orders FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_p2p_disputes_updated_at BEFORE UPDATE ON p2p_disputes FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_user_p2p_payment_methods_updated_at BEFORE UPDATE ON user_p2p_payment_methods FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_p2p_merchant_stats_updated_at BEFORE UPDATE ON p2p_merchant_stats FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- INSERT DEFAULT DATA
-- ============================================================================

-- Default Blockchains
INSERT INTO blockchains (chain_name, chain_symbol, chain_id, derivation_path, required_confirmations, avg_block_time) VALUES
('Ethereum', 'ETH', 1, 'm/44''/60''/0''/0', 12, 12),
('BNB Smart Chain', 'BSC', 56, 'm/44''/60''/0''/0', 15, 3),
('Polygon', 'MATIC', 137, 'm/44''/60''/0''/0', 128, 2),
('Tron', 'TRX', NULL, 'm/44''/195''/0''/0', 20, 3),
('Solana', 'SOL', NULL, 'm/44''/501''/0''/0''', 32, 1),
('Arbitrum One', 'ARB', 42161, 'm/44''/60''/0''/0', 12, 1),
('Avalanche C-Chain', 'AVAX', 43114, 'm/44''/60''/0''/0', 12, 2),
('Bitcoin', 'BTC', NULL, 'm/84''/0''/0''/0', 3, 600);

-- Default Currencies
INSERT INTO currencies (symbol, name, currency_type, blockchain_id, decimals, min_withdrawal, withdrawal_fee) VALUES
('BTC', 'Bitcoin', 'crypto', (SELECT id FROM blockchains WHERE chain_symbol = 'BTC'), 8, 0.0001, 0.0001),
('ETH', 'Ethereum', 'crypto', (SELECT id FROM blockchains WHERE chain_symbol = 'ETH'), 18, 0.001, 0.0005),
('BNB', 'BNB', 'crypto', (SELECT id FROM blockchains WHERE chain_symbol = 'BSC'), 18, 0.01, 0.001),
('USDT', 'Tether USD', 'stablecoin', (SELECT id FROM blockchains WHERE chain_symbol = 'ETH'), 6, 10, 5),
('USDT', 'Tether USD (TRC20)', 'stablecoin', (SELECT id FROM blockchains WHERE chain_symbol = 'TRX'), 6, 10, 1),
('USDT', 'Tether USD (BEP20)', 'stablecoin', (SELECT id FROM blockchains WHERE chain_symbol = 'BSC'), 18, 10, 0.5),
('USDC', 'USD Coin', 'stablecoin', (SELECT id FROM blockchains WHERE chain_symbol = 'ETH'), 6, 10, 5),
('SOL', 'Solana', 'crypto', (SELECT id FROM blockchains WHERE chain_symbol = 'SOL'), 9, 0.1, 0.01),
('MATIC', 'Polygon', 'crypto', (SELECT id FROM blockchains WHERE chain_symbol = 'MATIC'), 18, 1, 0.1),
('TRX', 'Tron', 'crypto', (SELECT id FROM blockchains WHERE chain_symbol = 'TRX'), 6, 10, 1),
('AVAX', 'Avalanche', 'crypto', (SELECT id FROM blockchains WHERE chain_symbol = 'AVAX'), 18, 0.1, 0.01),
('ARB', 'Arbitrum', 'crypto', (SELECT id FROM blockchains WHERE chain_symbol = 'ARB'), 18, 1, 0.1);

-- Fiat Currencies
INSERT INTO currencies (symbol, name, currency_type, decimals, is_listed) VALUES
('USD', 'US Dollar', 'fiat', 2, TRUE),
('EUR', 'Euro', 'fiat', 2, TRUE),
('INR', 'Indian Rupee', 'fiat', 2, TRUE),
('GBP', 'British Pound', 'fiat', 2, TRUE);

-- Default Fee Tiers
INSERT INTO fee_tiers (tier_name, tier_level, min_trading_volume, spot_maker_fee, spot_taker_fee) VALUES
('Regular', 0, 0, 0.0010, 0.0010),
('VIP 1', 1, 100000, 0.0009, 0.0010),
('VIP 2', 2, 500000, 0.0008, 0.0009),
('VIP 3', 3, 1000000, 0.0007, 0.0008),
('VIP 4', 4, 5000000, 0.0006, 0.0007),
('VIP 5', 5, 10000000, 0.0004, 0.0006);

-- Default P2P Payment Methods
INSERT INTO p2p_payment_methods (name, code, method_type, required_fields, supported_countries) VALUES
('UPI', 'upi', 'ewallet', '[{"name": "upi_id", "label": "UPI ID", "type": "string", "required": true}]', '["IN"]'),
('IMPS Bank Transfer', 'imps', 'bank', '[{"name": "account_name", "label": "Account Holder Name", "type": "string", "required": true}, {"name": "account_number", "label": "Account Number", "type": "string", "required": true}, {"name": "ifsc_code", "label": "IFSC Code", "type": "string", "required": true}]', '["IN"]'),
('PayTM', 'paytm', 'ewallet', '[{"name": "phone", "label": "PayTM Phone Number", "type": "string", "required": true}]', '["IN"]'),
('Bank Transfer', 'bank_transfer', 'bank', '[{"name": "account_name", "label": "Account Holder Name", "type": "string", "required": true}, {"name": "account_number", "label": "Account Number", "type": "string", "required": true}, {"name": "bank_name", "label": "Bank Name", "type": "string", "required": true}, {"name": "swift_code", "label": "SWIFT Code", "type": "string", "required": false}]', NULL),
('PayPal', 'paypal', 'ewallet', '[{"name": "email", "label": "PayPal Email", "type": "email", "required": true}]', NULL);

-- System Settings
INSERT INTO system_settings (key, value, value_type, description) VALUES
('maintenance_mode', 'false', 'boolean', 'Enable maintenance mode'),
('new_user_registration', 'true', 'boolean', 'Allow new user registration'),
('min_withdrawal_btc', '0.001', 'number', 'Minimum BTC withdrawal'),
('referral_commission_rate', '0.20', 'number', 'Default referral commission rate'),
('p2p_escrow_timeout_minutes', '60', 'number', 'P2P escrow auto-cancel timeout'),
('kyc_required_for_withdrawal', 'true', 'boolean', 'Require KYC for withdrawals'),
('max_open_orders_per_pair', '100', 'number', 'Maximum open orders per trading pair per user'),
('trading_enabled', 'true', 'boolean', 'Global trading enabled flag'),
('p2p_enabled', 'true', 'boolean', 'P2P trading enabled flag');

-- Trading Pairs
INSERT INTO trading_pairs (base_currency_id, quote_currency_id, symbol, tick_size, min_quantity, maker_fee, taker_fee) VALUES
((SELECT id FROM currencies WHERE symbol = 'BTC' AND currency_type = 'crypto' LIMIT 1), 
 (SELECT id FROM currencies WHERE symbol = 'USDT' AND blockchain_id = (SELECT id FROM blockchains WHERE chain_symbol = 'ETH') LIMIT 1), 
 'BTC_USDT', 0.01, 0.0001, 0.001, 0.001),
((SELECT id FROM currencies WHERE symbol = 'ETH' LIMIT 1), 
 (SELECT id FROM currencies WHERE symbol = 'USDT' AND blockchain_id = (SELECT id FROM blockchains WHERE chain_symbol = 'ETH') LIMIT 1), 
 'ETH_USDT', 0.01, 0.001, 0.001, 0.001),
((SELECT id FROM currencies WHERE symbol = 'BNB' LIMIT 1), 
 (SELECT id FROM currencies WHERE symbol = 'USDT' AND blockchain_id = (SELECT id FROM blockchains WHERE chain_symbol = 'ETH') LIMIT 1), 
 'BNB_USDT', 0.01, 0.01, 0.001, 0.001),
((SELECT id FROM currencies WHERE symbol = 'SOL' LIMIT 1), 
 (SELECT id FROM currencies WHERE symbol = 'USDT' AND blockchain_id = (SELECT id FROM blockchains WHERE chain_symbol = 'ETH') LIMIT 1), 
 'SOL_USDT', 0.01, 0.1, 0.001, 0.001),
((SELECT id FROM currencies WHERE symbol = 'ETH' LIMIT 1), 
 (SELECT id FROM currencies WHERE symbol = 'BTC' AND currency_type = 'crypto' LIMIT 1), 
 'ETH_BTC', 0.000001, 0.001, 0.001, 0.001);

-- ============================================================================
-- INSERT DUMMY DATA
-- ============================================================================

-- Dummy Users (password is 'Test1234!' hashed with bcrypt)
INSERT INTO users (id, email, email_verified, phone, password_hash, salt, username, first_name, last_name, status, tier_level, country_code) VALUES
('11111111-1111-1111-1111-111111111111', 'john@example.com', TRUE, '+1234567890', '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4.bLLGOGmV7KVqKG', 'randomsalt123', 'john_trader', 'John', 'Doe', 'active', 1, 'US'),
('22222222-2222-2222-2222-222222222222', 'alice@example.com', TRUE, '+1987654321', '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4.bLLGOGmV7KVqKG', 'randomsalt456', 'alice_crypto', 'Alice', 'Smith', 'active', 2, 'UK'),
('33333333-3333-3333-3333-333333333333', 'bob@example.com', TRUE, '+1122334455', '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4.bLLGOGmV7KVqKG', 'randomsalt789', 'bob_investor', 'Bob', 'Johnson', 'active', 1, 'IN'),
('44444444-4444-4444-4444-444444444444', 'emma@example.com', FALSE, NULL, '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4.bLLGOGmV7KVqKG', 'randomsalt000', 'emma_new', 'Emma', 'Wilson', 'pending', 0, 'CA');

-- Referral Codes for users
INSERT INTO referral_codes (user_id, code, referrer_commission_rate, referee_discount_rate) VALUES
('11111111-1111-1111-1111-111111111111', 'JOHN2024', 0.20, 0.10),
('22222222-2222-2222-2222-222222222222', 'ALICE50', 0.25, 0.15),
('33333333-3333-3333-3333-333333333333', 'BOBINDIA', 0.20, 0.10);

-- User Wallets
INSERT INTO user_wallets (user_id, blockchain_id, address, key_index) VALUES
('11111111-1111-1111-1111-111111111111', (SELECT id FROM blockchains WHERE chain_symbol = 'ETH'), '0x1234567890abcdef1234567890abcdef12345678', 0),
('11111111-1111-1111-1111-111111111111', (SELECT id FROM blockchains WHERE chain_symbol = 'BSC'), '0x1234567890abcdef1234567890abcdef12345678', 0),
('11111111-1111-1111-1111-111111111111', (SELECT id FROM blockchains WHERE chain_symbol = 'BTC'), 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh', 0),
('22222222-2222-2222-2222-222222222222', (SELECT id FROM blockchains WHERE chain_symbol = 'ETH'), '0xabcdef1234567890abcdef1234567890abcdef12', 0),
('22222222-2222-2222-2222-222222222222', (SELECT id FROM blockchains WHERE chain_symbol = 'TRX'), 'TXyz1234567890abcdef1234567890abcd', 0),
('33333333-3333-3333-3333-333333333333', (SELECT id FROM blockchains WHERE chain_symbol = 'ETH'), '0x9876543210fedcba9876543210fedcba98765432', 0);

-- User Balances
INSERT INTO user_balances (user_id, currency_id, available_balance, locked_balance, total_deposited) VALUES
('11111111-1111-1111-1111-111111111111', (SELECT id FROM currencies WHERE symbol = 'BTC' AND currency_type = 'crypto' LIMIT 1), 0.5, 0.1, 0.6),
('11111111-1111-1111-1111-111111111111', (SELECT id FROM currencies WHERE symbol = 'ETH' LIMIT 1), 5.0, 0, 5.0),
('11111111-1111-1111-1111-111111111111', (SELECT id FROM currencies WHERE symbol = 'USDT' AND blockchain_id = (SELECT id FROM blockchains WHERE chain_symbol = 'ETH') LIMIT 1), 10000, 500, 10500),
('22222222-2222-2222-2222-222222222222', (SELECT id FROM currencies WHERE symbol = 'BTC' AND currency_type = 'crypto' LIMIT 1), 1.2, 0, 1.2),
('22222222-2222-2222-2222-222222222222', (SELECT id FROM currencies WHERE symbol = 'USDT' AND blockchain_id = (SELECT id FROM blockchains WHERE chain_symbol = 'ETH') LIMIT 1), 50000, 1000, 51000),
('33333333-3333-3333-3333-333333333333', (SELECT id FROM currencies WHERE symbol = 'ETH' LIMIT 1), 10.0, 2.0, 12.0),
('33333333-3333-3333-3333-333333333333', (SELECT id FROM currencies WHERE symbol = 'USDT' AND blockchain_id = (SELECT id FROM blockchains WHERE chain_symbol = 'ETH') LIMIT 1), 25000, 0, 25000);

-- P2P Merchant Stats
INSERT INTO p2p_merchant_stats (user_id, total_orders, completed_orders, completion_rate, average_rating, is_merchant) VALUES
('11111111-1111-1111-1111-111111111111', 150, 145, 96.67, 4.8, TRUE),
('22222222-2222-2222-2222-222222222222', 300, 295, 98.33, 4.9, TRUE),
('33333333-3333-3333-3333-333333333333', 50, 48, 96.00, 4.5, TRUE);

-- User P2P Payment Methods
INSERT INTO user_p2p_payment_methods (user_id, payment_method_id, payment_details, display_name, is_verified) VALUES
('11111111-1111-1111-1111-111111111111', (SELECT id FROM p2p_payment_methods WHERE code = 'bank_transfer'), '{"account_name": "John Doe", "account_number": "1234567890", "bank_name": "Chase Bank"}', 'My Chase Account', TRUE),
('22222222-2222-2222-2222-222222222222', (SELECT id FROM p2p_payment_methods WHERE code = 'paypal'), '{"email": "alice@paypal.com"}', 'PayPal Main', TRUE),
('33333333-3333-3333-3333-333333333333', (SELECT id FROM p2p_payment_methods WHERE code = 'upi'), '{"upi_id": "bob@okicici"}', 'ICICI UPI', TRUE),
('33333333-3333-3333-3333-333333333333', (SELECT id FROM p2p_payment_methods WHERE code = 'imps'), '{"account_name": "Bob Johnson", "account_number": "9876543210", "ifsc_code": "ICIC0001234"}', 'ICICI Bank', TRUE);

-- P2P Ads
INSERT INTO p2p_ads (user_id, ad_type, crypto_currency_id, fiat_currency, pricing_type, float_percentage, current_price, min_amount, max_amount, available_amount, accepted_payment_methods, status, total_orders, completed_orders) VALUES
('11111111-1111-1111-1111-111111111111', 'sell', 
 (SELECT id FROM currencies WHERE symbol = 'USDT' AND blockchain_id = (SELECT id FROM blockchains WHERE chain_symbol = 'ETH') LIMIT 1), 
 'USD', 'floating', 1.5, 1.015, 100, 5000, 8000, 
 '["bank_transfer"]', 'active', 50, 48),
('22222222-2222-2222-2222-222222222222', 'buy', 
 (SELECT id FROM currencies WHERE symbol = 'BTC' AND currency_type = 'crypto' LIMIT 1), 
 'USD', 'floating', -0.5, 42500, 500, 10000, 25000, 
 '["paypal", "bank_transfer"]', 'active', 80, 78),
('33333333-3333-3333-3333-333333333333', 'sell', 
 (SELECT id FROM currencies WHERE symbol = 'USDT' AND blockchain_id = (SELECT id FROM blockchains WHERE chain_symbol = 'ETH') LIMIT 1), 
 'INR', 'floating', 2.0, 84.5, 5000, 100000, 50000, 
 '["upi", "imps"]', 'active', 30, 28);

-- Sample Spot Orders
INSERT INTO spot_orders (user_id, trading_pair_id, order_type, side, price, quantity, remaining_quantity, status, source) VALUES
('11111111-1111-1111-1111-111111111111', (SELECT id FROM trading_pairs WHERE symbol = 'BTC_USDT'), 'limit', 'buy', 42000, 0.1, 0.1, 'new', 'web'),
('11111111-1111-1111-1111-111111111111', (SELECT id FROM trading_pairs WHERE symbol = 'ETH_USDT'), 'limit', 'sell', 2500, 1.0, 1.0, 'new', 'web'),
('22222222-2222-2222-2222-222222222222', (SELECT id FROM trading_pairs WHERE symbol = 'BTC_USDT'), 'limit', 'sell', 43000, 0.5, 0.5, 'new', 'api'),
('33333333-3333-3333-3333-333333333333', (SELECT id FROM trading_pairs WHERE symbol = 'ETH_USDT'), 'limit', 'buy', 2400, 2.0, 2.0, 'new', 'mobile');

-- ============================================================================
-- VIEWS FOR COMMON QUERIES
-- ============================================================================

-- User Balance Summary View
CREATE VIEW v_user_balance_summary AS
SELECT 
    ub.user_id,
    c.symbol,
    c.name as currency_name,
    ub.available_balance,
    ub.locked_balance,
    (ub.available_balance + ub.locked_balance) as total_balance
FROM user_balances ub
JOIN currencies c ON ub.currency_id = c.id
WHERE c.is_active = TRUE;

-- Active Orders View
CREATE VIEW v_active_orders AS
SELECT 
    o.id,
    o.user_id,
    tp.symbol as pair,
    o.order_type,
    o.side,
    o.price,
    o.quantity,
    o.filled_quantity,
    o.remaining_quantity,
    o.status,
    o.created_at
FROM spot_orders o
JOIN trading_pairs tp ON o.trading_pair_id = tp.id
WHERE o.status IN ('new', 'partially_filled');

-- P2P Merchant Leaderboard
CREATE VIEW v_p2p_merchant_leaderboard AS
SELECT 
    u.id as user_id,
    u.username,
    pms.total_orders,
    pms.completed_orders,
    pms.completion_rate,
    pms.average_rating,
    pms.positive_ratings,
    (pms.total_buy_volume + pms.total_sell_volume) as total_volume
FROM p2p_merchant_stats pms
JOIN users u ON pms.user_id = u.id
WHERE pms.is_merchant = TRUE
ORDER BY pms.completion_rate DESC, pms.total_orders DESC;

-- ============================================================================
-- SCHEMA COMPLETE
-- ============================================================================
