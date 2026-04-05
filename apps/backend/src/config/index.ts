import dotenv from 'dotenv';
import { z } from 'zod';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Root .env (monorepo), then apps/backend/.env (optional overrides — can be a symlink to root)
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env'), override: true });

const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().url(),
  DATABASE_POOL_MIN: z.coerce.number().default(5),
  DATABASE_POOL_MAX: z.coerce.number().default(20),
  // Production: use true. Dev/Supabase: set false to skip cert verification.
  DATABASE_SSL_REJECT_UNAUTHORIZED: z.string().default('true').transform(v => v !== 'false' && v !== '0'),
  DATABASE_READ_REPLICA_URL: z.string().url().optional(),

  // Redis
  REDIS_URL: z.string().default('redis://localhost:6379'),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_TLS_ENABLED: z.coerce.boolean().default(false),
  REDIS_WS_PUBSUB_ENABLED: z.string().transform(v => v === 'true').default('false'),
  // Redis Sentinel (HA): comma-separated hosts, e.g. sentinel1:26379,sentinel2:26379
  REDIS_SENTINELS: z.string().optional(),
  REDIS_SENTINEL_MASTER: z.string().optional(),

  // RabbitMQ
  RABBITMQ_URL: z.string().default('amqp://localhost:5672'),

  // JWT
  JWT_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  // Encryption
  ENCRYPTION_KEY: z.string().min(32),
  ENCRYPTION_IV_LENGTH: z.coerce.number().default(16),

  // HSM / KMS (envelope encryption for hot wallets)
  HSM_ENABLED: z.coerce.boolean().default(false),
  HSM_SLOT_ID: z.coerce.number().default(0),
  HSM_PIN: z.string().optional(),
  HSM_LIBRARY_PATH: z.string().optional(),
  KMS_TYPE: z.enum(['local', 'aws']).default('local'),
  KMS_KEY_VERSION: z.string().default('1'),
  AWS_KMS_KEY_ID: z.string().optional(),
  AWS_REGION: z.string().optional(),

  // OAuth
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CALLBACK_URL: z.string().optional(),
  APPLE_CLIENT_ID: z.string().optional(),
  APPLE_TEAM_ID: z.string().optional(),
  APPLE_KEY_ID: z.string().optional(),
  APPLE_PRIVATE_KEY: z.string().optional(),
  APPLE_CALLBACK_URL: z.string().optional(),
  TELEGRAM_BOT_TOKEN: z.string().optional(),

  // Email (accepts SMTP_PASSWORD or SMTP_PASS; EMAIL_FROM or SMTP_FROM)
  SMTP_HOST: z.string().default('smtp.gmail.com'),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_SECURE: z.coerce.boolean().default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  SMTP_FROM: z.string().optional(),

  // SMS
  SMS_PROVIDER: z.enum(['twilio', 'sns', 'mock']).default('mock'),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_PHONE_NUMBER: z.string().optional(),

  // KYC
  KYC_PROVIDER: z.enum(['hyperverge', 'onfido', 'mock']).default('mock'),
  HYPERVERGE_APP_ID: z.string().optional(),
  HYPERVERGE_APP_KEY: z.string().optional(),
  HYPERVERGE_BASE_URL: z.string().optional(),
  // DigiLocker demo auto-approve: ONLY for dev/demo. Set false in production.
  KYC_DIGILOCKER_DEMO_AUTO_APPROVE: z.string().transform(v => v === 'true').default('false'),

  // Blockchain RPCs
  ETH_RPC_URL: z.string().default('https://eth-mainnet.g.alchemy.com/v2/demo'),
  BSC_RPC_URL: z.string().default('https://bsc-dataseed.binance.org'),
  POLYGON_RPC_URL: z.string().default('https://polygon-rpc.com'),
  ARBITRUM_RPC_URL: z.string().default('https://arb1.arbitrum.io/rpc'),
  OPTIMISM_RPC_URL: z.string().default('https://mainnet.optimism.io'),
  BASE_RPC_URL: z.string().default('https://mainnet.base.org'),
  SOLANA_RPC_URL: z.string().default('https://api.mainnet-beta.solana.com'),
  TRON_API_URL: z.string().default('https://api.trongrid.io'),
  TRON_API_KEY: z.string().optional(),
  BITCOIN_RPC_URL: z.string().optional(),
  BITCOIN_RPC_USER: z.string().optional(),
  BITCOIN_RPC_PASSWORD: z.string().optional(),
  BITCOIN_NETWORK: z.enum(['mainnet', 'testnet']).default('mainnet'),

  // Application
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  RUN_MODE: z.enum(['api', 'workers', 'all']).default('all'),
  PORT: z.coerce.number().default(4000),
  FRONTEND_URL: z.string().default('http://localhost:3000'),
  API_VERSION: z.string().default('v1'),

  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(900000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(100),
  // Tier 1 default: when true, critical rate limits (OTP, withdrawal, spot order) fail-closed on Redis error (return 503)
  RATE_LIMIT_FAIL_CLOSED: z.string().transform(v => v === 'true' || v === '1').default('true'),

  // Security
  CORS_ORIGINS: z.string().default('http://localhost:3000,http://localhost:3001,http://127.0.0.1:3000,http://127.0.0.1:3001,http://localhost:4000,http://127.0.0.1:4000'),
  TRUSTED_PROXIES: z.coerce.number().default(1),
  ADMIN_IP_WHITELIST: z.string().default('127.0.0.1,::1'),
  SESSION_SECRET: z.string().min(32),
  CSRF_SECRET: z.string().min(32),
  // Auth services (optional; fallback to localhost when not set)
  SESSION_CORE_URL: z.string().url().optional().default('http://localhost:7001/validate'),
  LOCK_SERVICE_URL: z.string().url().optional().default('http://localhost:7001/lock'),
  TOTP_ENCRYPTION_KEY: z.string().min(32).optional(), // Prefer over ENCRYPTION_KEY for TOTP; fallback to ENCRYPTION_KEY

  // Monitoring
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  SENTRY_DSN: z.string().optional(),
  PROMETHEUS_ENABLED: z.coerce.boolean().default(false),
  PROMETHEUS_PORT: z.coerce.number().default(9090),
  ALERT_WEBHOOK_URL: z.string().optional().transform((v) => ((v ?? '').trim() || undefined)), // Slack/email webhook for circuit_open, integrity_mismatch

  // WebSocket connection caps (DoS protection)
  WS_MAX_CONNECTIONS_GLOBAL: z.coerce.number().min(100).max(100_000).default(10_000),
  WS_MAX_CONNECTIONS_PER_USER: z.coerce.number().min(1).max(50).default(5),

  // Phase E: Multi-node identity (for Prometheus instance label and tracing)
  NODE_ID: z.string().optional(),
  INSTANCE_ID: z.string().optional(),

  // Phase E: SLO thresholds for /observability/slo dashboard
  SLO_SETTLEMENT_PENDING_MAX: z.coerce.number().min(0).default(500),
  SLO_ORDER_LATENCY_P99_MS_MAX: z.coerce.number().min(0).default(1000),
  SLO_TRACING_ENABLED: z.string().transform(v => v === 'true').default('true'),

  // Feature Flags
  ENABLE_SPOT_ORDERS_RESERVE_ONLY: z.string().transform(v => v === 'true').default('false'),
  FEATURE_MAKER_REBATES: z.string().transform(v => v === 'true').default('false'),
  FEATURE_ICEBERG_ORDERS: z.string().transform(v => v === 'true').default('false'), // POST /spot/orders reserve-only path; default OFF for safety
  FEATURE_P2P_ENABLED: z.string().transform(v => v === 'true').default('true'),
  FEATURE_SPOT_TRADING_ENABLED: z.string().transform(v => v === 'true').default('true'),
  FEATURE_MARGIN_TRADING_ENABLED: z.string().transform(v => v === 'true').default('false'),
  MAINTENANCE_MODE: z.string().transform(v => v === 'true').default('false'),

  // Tier 1: Rust matching engine is mandatory; env kept for docs compatibility only (always treated as enabled).
  USE_RUST_MATCHING_ENGINE: z.string().optional().default('true'),
  /** Retries if inserting match events into settlement_events fails (Rust already matched). */
  MATCH_EVENT_PERSIST_RETRIES: z.coerce.number().min(1).max(15).default(3),
  /**
   * When true, engine_event_id dedup for WS/L2 tape uses Redis SET NX (shared across API instances).
   * When false, in-process Set only (duplicates possible if multiple API replicas).
   */
  SPOT_ENGINE_WS_DEDUP_REDIS: z.string().transform((v) => v !== 'false' && v !== '0').default('true'),
  /**
   * P2P payment proof: `public` = legacy path under frontend/static (discouraged).
   * `secure` = private directory + authenticated GET /p2p/orders/:id/payment-proof.
   */
  P2P_PAYMENT_PROOF_STORAGE: z.enum(['public', 'secure']).default('public'),
  MATCHING_ENGINE_URL: z.string().default('http://localhost:7101'),
  /**
   * Phase 1: route POST /engine/place by market using MATCHING_ENGINE_ROUTES. Match poller + GET /engine/matches
   * stay on MATCHING_ENGINE_URL only unless you run a single co-located engine process.
   */
  MATCHING_ENGINE_SHARD_ROUTING_ENABLED: z.string().transform((v) => v === 'true').default('false'),
  /** Comma-separated MARKET=baseUrl, e.g. BTC_USDT=http://host:7101,ETH_USDT=http://host:7102 */
  MATCHING_ENGINE_ROUTES: z.string().optional().transform((v) => (v ?? '').trim()),
  /**
   * Additional engine base URLs (comma-separated). Merged with MATCHING_ENGINE_URL (deduped) for multi-poller + instance ids.
   * Each engine must expose GET /health and GET /engine/matches.
   */
  MATCHING_ENGINE_URLS: z.string().optional().transform((v) => (v ?? '').trim()),
  /**
   * Optional comma-separated instance ids, same cardinality as merged URL list after dedupe.
   * If omitted: single engine → `default`; multi → engine_0, engine_1, ...
   */
  MATCHING_ENGINE_INSTANCE_IDS: z.string().optional().transform((v) => (v ?? '').trim()),
  /** When shard routing is on, markets not listed in MATCHING_ENGINE_ROUTES are rejected (no primary fallback). */
  MATCHING_ENGINE_STRICT_MARKET_ROUTING: z.string().transform((v) => v === 'true').default('false'),
  /** When true (default), POST /engine/place is rejected if /health says instance is down. Poller still polls all. */
  MATCHING_ENGINE_SKIP_UNHEALTHY_FOR_PLACE: z.string().transform((v) => v !== 'false' && v !== '0').default('true'),
  /** Secret for engine->backend internal API (orderbook rebuild). When set, engine must send X-Engine-Secret. */
  ENGINE_INTERNAL_SECRET: z.string().optional().transform(v => (v ?? '').trim() || undefined),

  // Phase D: Price oracle (update market_prices from external API)
  PRICE_ORACLE_ENABLED: z.string().transform(v => v === 'true').default('false'),
  PRICE_ORACLE_INTERVAL_SEC: z.coerce.number().min(60).max(3600).default(120),

  // Phase D: Internal liquidity bot (place/cancel limit orders around mid)
  LIQUIDITY_BOT_ENABLED: z.string().transform(v => v === 'true').default('false'),
  LIQUIDITY_BOT_API_KEY: z.string().optional(),
  LIQUIDITY_BOT_INTERNAL_API_URL: z.string().optional().transform((v) => (v ?? '').trim() || undefined),
  LIQUIDITY_BOT_SPREAD_BPS: z.coerce.number().min(1).max(500).default(10),
  LIQUIDITY_BOT_ORDER_SIZE: z.string().default('0.001'),
  LIQUIDITY_BOT_SYMBOLS: z.string().default('BTC_USDT'),
  /** Skip quoting entirely when market_prices.last_updated older than this (seconds). */
  LIQUIDITY_BOT_ORACLE_STALE_SEC: z.coerce.number().min(30).max(86_400).default(300),
  /** Multiply spread_bps when oracle is stale (still quoting). Ignored if SKIP_IF_ORACLE_STALE. */
  LIQUIDITY_BOT_STALE_SPREAD_MULTIPLIER: z.coerce.number().min(1).max(20).default(2),
  LIQUIDITY_BOT_SKIP_IF_ORACLE_STALE: z.string().transform(v => v === 'true').default('false'),
  /** Minimum mid price move (bps) vs resting order to cancel/replace. */
  LIQUIDITY_BOT_REPRICE_BPS_THRESHOLD: z.coerce.number().min(0).max(500).default(5),
  /** Minimum relative remaining-qty change to replace (0.02 = 2%). */
  LIQUIDITY_BOT_REPRICE_QTY_REL_THRESHOLD: z.coerce.number().min(0).max(1).default(0.02),
  /** Extra user UUIDs exempt from spot order/cancel burst + velocity (comma-separated). Bot API key user is auto-exempt after warm. */
  LIQUIDITY_BOT_RATE_LIMIT_EXEMPT_USER_IDS: z.string().optional().default(''),

  MM_HEALTH_ENABLED: z.string().transform((v) => v === 'true').default('true'),
  MM_HEALTH_ORACLE_CRITICAL_SEC: z.coerce.number().min(60).max(86_400).default(900),
  MM_HEALTH_SETTLEMENT_LAG_CRITICAL_SEC: z.coerce.number().min(5).max(7200).default(120),
  MM_HEALTH_BOT_ERROR_WINDOW: z.coerce.number().min(5).max(200).default(20),
  MM_HEALTH_BOT_ERROR_RATE_CRITICAL: z.coerce.number().min(0.05).max(1).default(0.55),
  MM_HEALTH_BOT_ERROR_RATE_WARN: z.coerce.number().min(0.05).max(1).default(0.28),
  MM_HEALTH_QUOTE_AGE_CRITICAL_SEC: z.coerce.number().min(120).max(86_400).default(900),
  MM_HEALTH_MIN_CYCLES_BEFORE_QUOTE_CHECK: z.coerce.number().min(0).max(200).default(4),
  MM_HEALTH_EXTERNAL_DIVERGENCE_WARN_BPS: z.coerce.number().min(5).max(5000).default(40),
  MM_HEALTH_EXTERNAL_DIVERGENCE_CRITICAL_BPS: z.coerce.number().min(10).max(10_000).default(120),
  MM_HEALTH_SPREAD_MULT_DEGRADED: z.coerce.number().min(1).max(10).default(1.5),
  MM_HEALTH_SPREAD_MULT_BAD: z.coerce.number().min(1).max(15).default(2.5),
  MM_HEALTH_AUTO_PAUSE_ON_CRITICAL: z.string().transform((v) => v === 'true').default('true'),
  EXTERNAL_PRICE_FEED_ENABLED: z.string().transform((v) => v === 'true').default('false'),
  EXTERNAL_PRICE_FEED_BASE_URL: z.string().optional().default('https://api.binance.com'),
  /** Comma-separated Binance-compatible API roots (e.g. https://api.binance.com,https://api.binance.us). Empty = use BASE_URL only. */
  EXTERNAL_PRICE_FEED_SOURCES: z.string().optional().default(''),
  EXTERNAL_PRICE_FEED_AGGREGATION: z.enum(['median', 'mean']).default('median'),
  /** 0 = disabled. Drop sources farther than this (bps from median) before aggregating. */
  EXTERNAL_PRICE_OUTLIER_MAX_BPS: z.coerce.number().min(0).max(500).default(0),
  EXTERNAL_PRICE_LATENCY_WEIGHT: z.string().transform((v) => v === 'true').default('false'),
  EXTERNAL_PRICE_LATENCY_FLOOR_MS: z.coerce.number().min(0).max(2000).default(25),

  ELITE_MM_FLOW_WINDOW_SEC: z.coerce.number().min(5).max(600).default(45),
  ELITE_MM_FLOW_TRADE_LIMIT: z.coerce.number().min(20).max(500).default(120),
  ELITE_MM_FLOW_SPREAD_COEFF: z.coerce.number().min(0).max(2).default(0.35),
  ELITE_MM_LATENCY_SPREAD_BPS_PER_MS: z.coerce.number().min(0).max(0.5).default(0.012),
  ELITE_MM_LATENCY_SPREAD_CAP_BPS: z.coerce.number().min(0).max(200).default(22),
  ELITE_MM_TOXIC_SLIPPAGE_COEFF: z.coerce.number().min(0).max(2).default(0.45),
  ELITE_MM_TOXIC_ADVERSE_COEFF: z.coerce.number().min(0).max(2).default(0.55),
  ELITE_MM_SPREAD_TOXIC_CAP_BPS: z.coerce.number().min(0).max(200).default(35),
  ELITE_MM_TOXIC_ADVERSE_BPS: z.coerce.number().min(1).max(200).default(8),
  ELITE_MM_TOXIC_SLIPPAGE_REF_BPS: z.coerce.number().min(1).max(500).default(28),
  ELITE_MM_INV_VOL_TIGHTEN_COEFF: z.coerce.number().min(0).max(1).default(0.38),
  ELITE_MM_INV_VOL_REF_BPS: z.coerce.number().min(1).max(500).default(90),

  ELITE_MM_AUTO_CIRCUIT_ENABLED: z.string().transform((v) => v === 'true').default('false'),
  ELITE_MM_AUTO_CIRCUIT_INTERVAL_MS: z.coerce.number().min(5000).max(300_000).default(30_000),
  ELITE_MM_AUTO_CIRCUIT_TOXIC_SCORE: z.coerce.number().min(0.05).max(1).default(0.58),
  ELITE_MM_AUTO_CIRCUIT_OFI_ABS: z.coerce.number().min(0.05).max(1).default(0.62),
  ELITE_MM_AUTO_CIRCUIT_EXT_DIV_BPS: z.coerce.number().min(10).max(2000).default(160),
  ELITE_MM_AUTO_CIRCUIT_OK_STREAK: z.coerce.number().min(1).max(50).default(6),
  /** Hysteresis: metrics must fall below these (while tripped) to count toward auto-clear streak. */
  ELITE_MM_AUTO_CIRCUIT_TOXIC_CLEAR: z.coerce.number().min(0.02).max(0.99).default(0.38),
  ELITE_MM_AUTO_CIRCUIT_OFI_CLEAR: z.coerce.number().min(0.02).max(0.99).default(0.42),
  ELITE_MM_AUTO_CIRCUIT_EXT_DIV_CLEAR: z.coerce.number().min(5).max(2000).default(95),

  ELITE_MM_PROFIT_METRICS_CACHE: z.string().transform((v) => v === 'true').default('true'),
  ELITE_MM_FEE_AWARE_SPREAD: z.string().transform((v) => v === 'true').default('true'),
  ELITE_MM_FEE_AWARE_MAKER_MULT: z.coerce.number().min(0).max(2).default(0.4),
  ELITE_MM_FEE_AWARE_TAKER_TAIL_MULT: z.coerce.number().min(0).max(1).default(0.1),
  ELITE_MM_PROFIT_SPREAD: z.string().transform((v) => v === 'true').default('true'),
  ELITE_MM_PROFIT_EDGE_TARGET_BPS: z.coerce.number().min(-50).max(200).default(3),
  ELITE_MM_PROFIT_SPREAD_COEFF: z.coerce.number().min(0).max(5).default(0.65),
  ELITE_MM_PROFIT_SPREAD_MAX_WIDEN_BPS: z.coerce.number().min(0).max(200).default(28),
  ELITE_MM_PROFIT_SPREAD_MAX_TIGHTEN_BPS: z.coerce.number().min(0).max(150).default(14),

  ELITE_MM_CAPITAL_ALLOC_ENABLED: z.string().transform((v) => v === 'true').default('false'),
  ELITE_MM_CAPITAL_W_PNL: z.coerce.number().min(0).max(1).default(0.45),
  ELITE_MM_CAPITAL_W_VOLUME: z.coerce.number().min(0).max(1).default(0.35),
  ELITE_MM_CAPITAL_W_VOLATILITY: z.coerce.number().min(0).max(1).default(0.2),
  ELITE_MM_CAPITAL_EMA_ALPHA: z.coerce.number().min(0.05).max(1).default(0.28),
  ELITE_MM_CAPITAL_WEIGHT_MIN: z.coerce.number().min(0.02).max(0.5).default(0.08),
  ELITE_MM_CAPITAL_WEIGHT_MAX: z.coerce.number().min(0.1).max(0.95).default(0.52),

  ELITE_MM_BENCH_OUTLIER_MAX_BPS: z.coerce.number().min(5).max(500).default(40),
  ELITE_MM_BENCH_EXTERNAL_BLEND: z.coerce.number().min(0).max(1).default(0.35),

  ELITE_MM_ADV_POSTTRADE_TRADES: z.coerce.number().min(1).max(20).default(3),
  ELITE_MM_ADV_SPREAD: z.string().transform((v) => v === 'true').default('true'),
  ELITE_MM_ADV_SPREAD_COEFF: z.coerce.number().min(0).max(2).default(0.52),
  ELITE_MM_ADV_SPREAD_CAP_BPS: z.coerce.number().min(0).max(120).default(18),

  ELITE_MM_PROFIT_TARGET_VOL_COEFF: z.coerce.number().min(0).max(50).default(4),
  ELITE_MM_PROFIT_TARGET_VOL_REF_BPS: z.coerce.number().min(1).max(500).default(90),
  ELITE_MM_PROFIT_TARGET_LIQ_COEFF: z.coerce.number().min(0).max(500).default(35),
  ELITE_MM_PROFIT_TARGET_LIQ_REF_QUOTE: z.coerce.number().min(1).max(1e9).default(75_000),

  ELITE_MM_BENCH_MICROPRICE_WEIGHT: z.coerce.number().min(0).max(1).default(0.22),
  ELITE_MM_MTM_MICRO_IN_MARK: z.coerce.number().min(0).max(1).default(0.35),

  ELITE_MM_ADV_HORIZON_BASE: z.coerce.number().min(1).max(15).default(3),
  ELITE_MM_ADV_HORIZON_VOL_COEFF: z.coerce.number().min(0).max(10).default(2.2),
  ELITE_MM_ADV_HORIZON_FREQ_COEFF: z.coerce.number().min(0).max(15).default(4),
  ELITE_MM_ADV_HORIZON_VOL_REF_BPS: z.coerce.number().min(1).max(500).default(90),
  ELITE_MM_ADV_HORIZON_MIN: z.coerce.number().min(1).max(10).default(2),
  ELITE_MM_ADV_HORIZON_MAX: z.coerce.number().min(3).max(25).default(14),

  ELITE_MM_REGIME_WINDOW_SEC: z.coerce.number().min(120).max(7200).default(3600),
  ELITE_MM_REGIME_MAX_TRADES: z.coerce.number().min(30).max(800).default(240),
  ELITE_MM_REGIME_MIN_TRADES: z.coerce.number().min(8).max(120).default(24),
  ELITE_MM_REGIME_TREND_RHO_MIN: z.coerce.number().min(0).max(0.5).default(0.07),
  ELITE_MM_REGIME_MR_RHO_MAX: z.coerce.number().min(-0.5).max(0).default(-0.04),
  ELITE_MM_REGIME_VR_TREND_MIN: z.coerce.number().min(1).max(3).default(1.35),
  ELITE_MM_REGIME_VR_MR_MAX: z.coerce.number().min(0.2).max(1).default(0.72),
  ELITE_MM_REGIME_TREND_TARGET_ADD_BPS: z.coerce.number().min(0).max(80).default(6),
  ELITE_MM_REGIME_MR_TARGET_SUB_BPS: z.coerce.number().min(0).max(80).default(4),

  ELITE_MM_CAPITAL_W_TREND: z.coerce.number().min(0).max(1).default(0.18),
  ELITE_MM_CAPITAL_W_FLOW: z.coerce.number().min(0).max(1).default(0.15),

  ELITE_MM_DESK_MICRO_MIN_NOTIONAL_QUOTE: z.coerce.number().min(0).max(1e12).default(4000),
  ELITE_MM_DESK_MICRO_MAX_SPREAD_BPS_TOP: z.coerce.number().min(1).max(500).default(28),
  ELITE_MM_DESK_MICRO_LEVELS: z.coerce.number().min(1).max(10).default(3),
  ELITE_MM_DESK_MICRO_JUMP_FILTER: z.string().transform((v) => v === 'true').default('true'),
  ELITE_MM_DESK_MICRO_MAX_JUMP_BPS: z.coerce.number().min(5).max(500).default(40),
  ELITE_MM_DESK_MICRO_PREV_TTL_SEC: z.coerce.number().min(2).max(120).default(10),

  ELITE_MM_DESK_MOMENTUM_WINDOW_SEC: z.coerce.number().min(5).max(120).default(30),
  ELITE_MM_DESK_MOMENTUM_MAX_TRADES: z.coerce.number().min(10).max(400).default(100),
  ELITE_MM_DESK_MOMENTUM_SPREAD_ENABLED: z.string().transform((v) => v === 'true').default('true'),
  ELITE_MM_DESK_MOMENTUM_SPREAD_COEFF: z.coerce.number().min(0).max(1).default(0.14),
  ELITE_MM_DESK_MOMENTUM_HALF_CAP_BPS: z.coerce.number().min(0).max(120).default(20),

  ELITE_MM_CAPITAL_EXPLORATION_ENABLED: z.string().transform((v) => v === 'true').default('false'),
  ELITE_MM_CAPITAL_EXPLORATION_EPSILON: z.coerce.number().min(0).max(0.5).default(0.07),

  ELITE_MM_DESK_BOOK_OBI_LEVELS: z.coerce.number().min(1).max(15).default(5),
  ELITE_MM_DESK_BOOK_ADV_ENABLED: z.string().transform((v) => v === 'true').default('true'),
  ELITE_MM_DESK_BOOK_ADV_COEFF: z.coerce.number().min(0).max(1).default(0.24),
  ELITE_MM_DESK_BOOK_ADV_CAP_BPS: z.coerce.number().min(0).max(150).default(24),

  ELITE_MM_DESK_LAT_ARB_ENABLED: z.string().transform((v) => v === 'true').default('true'),
  ELITE_MM_DESK_LAT_ARB_REF_MS: z.coerce.number().min(0).max(2000).default(75),
  ELITE_MM_DESK_LAT_ARB_LAT_COEFF: z.coerce.number().min(0).max(0.05).default(0.007),
  ELITE_MM_DESK_LAT_ARB_DIV_REF_BPS: z.coerce.number().min(0).max(200).default(12),
  ELITE_MM_DESK_LAT_ARB_DIV_COEFF: z.coerce.number().min(0).max(2).default(0.4),
  ELITE_MM_DESK_LAT_ARB_CAP_BPS: z.coerce.number().min(0).max(150).default(30),

  INSTITUTIONAL_MM_VOL_WINDOW_MINUTES: z.coerce.number().min(5).max(1440).default(30),
  INSTITUTIONAL_MM_VOL_MIN_SAMPLES: z.coerce.number().min(3).max(500).default(8),
  INSTITUTIONAL_MM_VOL_SPREAD_COEFF: z.coerce.number().min(0).max(3).default(0.12),
  INSTITUTIONAL_MM_VOL_SPREAD_CAP_BPS: z.coerce.number().min(0).max(2000).default(120),
  INSTITUTIONAL_MM_VOL_SPREAD_MULT_CAP: z.coerce.number().min(1).max(25).default(5),
  INSTITUTIONAL_MM_LADDER_LEVELS: z.coerce.number().min(1).max(12).default(1),
  INSTITUTIONAL_MM_LADDER_STEP_BPS: z.coerce.number().min(0).max(250).default(8),
  INSTITUTIONAL_MM_LADDER_SIZE_DECAY: z.coerce.number().min(0.15).max(1).default(0.68),
  INSTITUTIONAL_MM_QUOTE_MAX_AGE_SEC: z.coerce.number().min(0).max(7200).default(120),
  INSTITUTIONAL_MM_INV_SOFT_RATIO: z.coerce.number().min(0.5).max(0.85).default(0.53),
  INSTITUTIONAL_MM_INV_HARD_RATIO: z.coerce.number().min(0.52).max(0.95).default(0.7),
  INSTITUTIONAL_MM_INV_MAX_SKEW_BPS: z.coerce.number().min(0).max(200).default(15),
  INSTITUTIONAL_MM_INV_SIZE_TAPER: z.coerce.number().min(0.05).max(1).default(0.4),
  INSTITUTIONAL_MM_INV_EXTRA_SPREAD_BPS: z.coerce.number().min(0).max(200).default(6),

  // Worker disable flags (for separation / graceful degrade)
  DISABLE_MATCH_POLLER: z.string().transform(v => v === 'true').default('false'),
  DISABLE_SETTLEMENT_WORKER: z.string().transform(v => v === 'true').default('false'),
  SETTLEMENT_BATCH_SIZE: z.coerce.number().min(1).max(100).default(20), // Tier 1: events per run for ~500+/s throughput
  /** Poll interval for settlement worker (ms). Lower = faster drain of settlement_events. */
  SETTLEMENT_WORKER_INTERVAL_MS: z.coerce.number().min(50).max(60_000).default(250),
  DISABLE_SIGNING_QUEUE: z.string().transform(v => v === 'true').default('false'),
  DISABLE_DEPOSIT_SWEEP: z.string().transform(v => v === 'true').default('false'),
  DISABLE_WALLET_RECONCILIATION: z.string().transform(v => v === 'true').default('false'),
  DISABLE_SAFETY_TRIGGER_WORKER: z.string().transform(v => v === 'true').default('false'),
  /** Tier-1 reconciliation job (ledger coverage, balance invariants, settlement replay). */
  DISABLE_TIER1_RECONCILIATION: z.string().transform(v => v === 'true').default('false'),
  TIER1_RECONCILIATION_INTERVAL_MS: z.coerce.number().min(60_000).max(3_600_000).default(600_000),
  /** When true, POST /admin/settlement/circuit-reset and balance-reconcile require JSON body.confirm === true. */
  ADMIN_REQUIRE_DESTRUCTIVE_CONFIRM: z.string().transform(v => v === 'true').default('false'),
  DISABLE_CANDLE_AGGREGATION: z.string().transform(v => v === 'true').default('false'),

  // Account lockout after failed logins
  MAX_FAILED_LOGIN_ATTEMPTS: z.coerce.number().min(3).max(20).default(5),
  LOCKOUT_MINUTES: z.coerce.number().min(5).max(1440).default(30),

  // Withdrawal approval: amount (in token units) above this requires admin approval
  WITHDRAWAL_APPROVAL_THRESHOLD: z.coerce.number().default(10000),
  // New whitelisted addresses: hours before first withdrawal (timelock)
  WITHDRAWAL_ADDRESS_COOLING_HOURS: z.coerce.number().min(0).default(24),

  // Deposit consolidation: sweep user deposit addresses to hot wallet
  DEPOSIT_SWEEP_ENABLED: z.string().transform(v => v === 'true').default('true'),
  DEPOSIT_SWEEP_MIN_WEI: z.string().default('1000000000000000'),

  // Pre-trade risk (spot)
  SPOT_ORDER_VELOCITY_PER_MIN: z.coerce.number().min(1).default(60),
  SPOT_LARGE_ORDER_NOTIONAL_USDT: z.coerce.number().default(100_000),
  SPOT_MAX_OPEN_NOTIONAL_USDT: z.coerce.number().default(500_000),

  // P2P limits (FIU India compliance)
  P2P_MAX_FIAT_PER_ORDER_INR: z.coerce.number().default(500_000),
  P2P_MAX_CRYPTO_PER_ORDER_USDT: z.coerce.number().default(50_000),
  P2P_MAX_FIAT_PER_USER_DAILY_INR: z.coerce.number().default(1_000_000),
  P2P_MAX_CRYPTO_PER_USER_DAILY_USDT: z.coerce.number().default(100_000),
  /** 0 = disable. Buyers with accounts newer than this (hours) cannot exceed P2P_NEW_BUYER_MAX_ORDER_FIAT_INR_EQUIV per order (INR equivalent). */
  P2P_NEW_BUYER_MAX_ACCOUNT_AGE_HOURS: z.coerce.number().min(0).default(168),
  P2P_NEW_BUYER_MAX_ORDER_FIAT_INR_EQUIV: z.coerce.number().min(0).default(250_000),
  /** Sellers below P2P_VERIFIED_SELLER_MIN_COMPLETED_ORDERS cannot accept orders above this INR equivalent. */
  P2P_UNVERIFIED_SELLER_MAX_ORDER_FIAT_INR_EQUIV: z.coerce.number().min(0).default(400_000),
  P2P_VERIFIED_SELLER_MIN_COMPLETED_ORDERS: z.coerce.number().min(1).default(30),
  /** Redis TTL for GET /p2p/reference-price and internal pricing (seconds). */
  P2P_REFERENCE_PRICE_TTL_SEC: z.coerce.number().min(0).max(60).default(3),
  /** List GET /p2p/ads response cache TTL (0 = disabled). */
  P2P_ADS_LIST_CACHE_TTL_SEC: z.coerce.number().min(0).max(300).default(30),
  /** After payment_confirmed, auto release or dispute if seller does not release. */
  P2P_SLA_RELEASE_MINUTES: z.coerce.number().min(1).max(10_080).default(15),
  P2P_SLA_ACTION: z.enum(['release', 'dispute']).default('release'),
  P2P_SLA_WORKER_ENABLED: z.string().transform((v) => v === 'true' || v === '1').default('true'),
  /** When true, buyer must submit payment proof + transaction reference to mark paid. */
  P2P_REQUIRE_PAYMENT_PROOF: z.string().transform((v) => v !== 'false' && v !== '0').default('true'),
  P2P_MAX_PAYMENT_PROOF_BYTES: z.coerce.number().min(50_000).max(10_485_760).default(5_242_880),

  // AML transaction monitoring (Step 6C)
  AML_LARGE_FIAT_INR_THRESHOLD: z.coerce.number().default(1_000_000),
  AML_LARGE_CRYPTO_WITHDRAWAL_THRESHOLD: z.coerce.number().default(100_000),
  AML_VELOCITY_WITHDRAWAL_COUNT: z.coerce.number().min(2).default(3),
  AML_VELOCITY_WINDOW_HOURS: z.coerce.number().min(1).default(24),
  AML_HIGH_RISK_COUNTRIES: z.string().default(''), // Comma-separated ISO codes, e.g. KP,IR,SY
  GEO_BLOCKED_COUNTRIES: z.string().default(''), // Comma-separated ISO codes for geo-blocking

  // Tier 1 launch: when true, enables fail-closed, Rust engine, and enforces production safety
  TIER1_LAUNCH: z.string().transform(v => v === 'true' || v === '1').default('false'),
  /** When true, API exits if Redis (and tier-1 NATS when pipeline on) cannot connect. Auto-true when TIER1_LAUNCH or NODE_ENV=production if unset. Set false for local dev without Redis. */
  STRICT_DEPENDENCY_STARTUP: z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined || v === '') return undefined;
      return v === 'true' || v === '1';
    }),
  /** Health: require NATS JetStream when NATS_URL is set and pipeline features are on. Override with true/false. */
  HEALTH_REQUIRE_NATS: z.enum(['true', 'false', 'auto']).default('auto'),
    /** Health: require Rust matching engine HTTP in production (Rust matching is always enabled). */
  HEALTH_REQUIRE_MATCHING_ENGINE: z.enum(['true', 'false', 'auto']).default('auto'),
  /** Health: treat stale indexer as unhealthy (503). */
  HEALTH_FAIL_ON_STALE_INDEXER: z.string().transform(v => v === 'true' || v === '1').default('false'),
  HEALTH_INDEXER_MAX_LAG_SEC: z.coerce.number().min(60).default(300),
  /** When true (default), each /metrics scrape evaluates Tier-1 alert thresholds and logs ALERT_TRIGGERED if met (throttled). */
  TIER1_ALERT_EVAL_ON_METRICS: z.string().transform((v) => v !== 'false' && v !== '0').default('true'),
  /** /health warning if spot WS disconnect rate (between scrapes) exceeds this per second. 0 = disable warning. */
  HEALTH_WS_DISCONNECT_WARN_PER_SEC: z.coerce.number().min(0).default(5),
  /** /health PostgreSQL ping timeout (ms). Increase for cold starts or remote DB with high latency. */
  HEALTH_DATABASE_PING_TIMEOUT_MS: z.coerce.number().min(1000).max(120_000).default(8000),
  /** SELECT 1 attempts (startup + /health). Use 1 for fastest probes; 3–5 for flaky networks. */
  HEALTH_DATABASE_PING_MAX_ATTEMPTS: z.coerce.number().min(1).max(5).default(4),
  /** Base backoff (ms) between failed ping attempts (exponential: base * 2^n, capped at 10s). */
  HEALTH_DATABASE_PING_RETRY_BASE_MS: z.coerce.number().min(50).max(5000).default(400),
  /** persistent = infinite reconnect backoff; limited = stop after ~20 attempts (legacy dev). */
  REDIS_RETRY_MODE: z.enum(['limited', 'persistent']).default('persistent'),
  // SLO endpoint IP whitelist (comma-separated); when set, only these IPs can access /observability/slo
  SLO_IP_WHITELIST: z.string().optional().transform(v => (v ?? '').trim() || undefined),

  // NATS JetStream: spot.match.* → orderbook writer → spot.orderbook.* (optional; off = legacy in-process path)
  NATS_URL: z.string().optional().transform((v) => (v ?? '').trim() || undefined),
  /**
   * JetStream MATCH_EVENTS (match.events.*): engine publishes matches; settlement_group consumer settles then acks.
   * With EVENT_STREAM_MATCH_POLLER_FALLBACK=false, HTTP match poller is off when this is true (validate before disabling fallback).
   */
  USE_EVENT_STREAM: z.string().transform((v) => v === 'true').default('false'),
  SETTLEMENT_STREAM_PULL_BATCH: z.coerce.number().min(1).max(256).default(16),
  SETTLEMENT_STREAM_PULL_INTERVAL_MS: z.coerce.number().min(20).max(5000).default(100),
  /** When USE_EVENT_STREAM=true, still run GET /engine/matches poller unless set false (post-validation). */
  EVENT_STREAM_MATCH_POLLER_FALLBACK: z.string().transform((v) => v === 'true' || v === '1').default('true'),
  /** Pull consumer: max unacked redeliverable messages (backpressure / max inflight). */
  SETTLEMENT_STREAM_MAX_ACK_PENDING: z.coerce.number().min(1).max(4096).default(64),
  /** Consumer ack wait before redelivery (ms). */
  SETTLEMENT_STREAM_ACK_WAIT_MS: z.coerce.number().min(5000).max(600_000).default(60_000),
  /** Max delivery attempts before the server stops redelivering (we term + DLQ on fatal errors earlier). */
  SETTLEMENT_STREAM_MAX_DELIVER: z.coerce.number().min(1).max(100).default(12),
  /**
   * Parallel settlement partitions (subjects match.events.*.p0..p{N-1}). Must match engine MATCH_EVENTS_PARTITIONS.
   * Deletes legacy consumer `settlement_group` on ensure (replaced by settlement_group_p*).
   */
  MATCH_EVENTS_PARTITION_COUNT: z.coerce.number().min(1).max(64).default(1),
  NATS_SPOT_PIPELINE_ENABLED: z.string().transform((v) => v === 'true').default('false'),
  NATS_ORDERBOOK_WRITER_ENABLED: z.string().transform((v) => v === 'true').default('false'),
  NATS_WS_ORDERBOOK_FORWARDER_ENABLED: z.string().transform((v) => v === 'true').default('false'),
  /** When writer runs beside WS on same node, broadcast locally and skip duplicate forwarder consumption. */
  NATS_WRITER_LOCAL_WS_BROADCAST: z.string().transform((v) => v === 'true').default('true'),
  ORDERBOOK_SHARD_ID: z.coerce.number().min(0).default(0),
  ORDERBOOK_SHARD_TOTAL: z.coerce.number().min(1).max(1024).default(1),
  ORDERBOOK_SNAPSHOT_INTERVAL_MS: z.coerce.number().min(0).default(0),
  ORDERBOOK_SNAPSHOT_PATH: z.string().optional().transform((v) => (v ?? '').trim() || undefined),
  /** When true, writer requires contiguous writer_seq per symbol (gap → orderbook_resync). */
  ORDERBOOK_WRITER_STRICT_SEQ: z.string().transform((v) => v === 'true' || v === '1').default('false'),
  /** Redis INCR spot:match:seq:&lt;symbol&gt; on each publish (recommended for multi-publisher strict seq). */
  ORDERBOOK_PUBLISHER_ASSIGN_SEQ: z.string().transform((v) => v === 'true' || v === '1').default('true'),
  /** Use Redis SET NX for dedup keys (survives writer restart). */
  ORDERBOOK_WRITER_DEDUP_REDIS: z.string().transform((v) => v === 'true' || v === '1').default('true'),
  ORDERBOOK_WRITER_DEDUP_TTL_SEC: z.coerce.number().min(60).max(7 * 24 * 3600).default(86_400),
  ORDERBOOK_WRITER_LAG_PENDING_THRESHOLD: z.coerce.number().min(100).default(50_000),
  ORDERBOOK_WRITER_PULL_MS_FAST: z.coerce.number().min(50).default(150),
  ORDERBOOK_WRITER_PULL_MS_SLOW: z.coerce.number().min(100).default(500),
  /** Redis lease TTL (ms) for orderbook_writer_leader:<SHARD_ID>. */
  ORDERBOOK_WRITER_LEADER_TTL_MS: z.coerce.number().min(2000).default(5000),
  ORDERBOOK_WRITER_LEADER_ELECTION: z.string().transform((v) => v === 'true' || v === '1').default('true'),
  /** If >0, trip Redis spot:orderbook_writer_writer_lag_circuit when lag >= this (ms). */
  ORDERBOOK_WRITER_LAG_CIRCUIT_MS: z.coerce.number().min(0).default(0),
  /** If >0, trip circuit when JetStream num_pending >= this. */
  ORDERBOOK_WRITER_LAG_CIRCUIT_PENDING: z.coerce.number().min(0).default(0),
  /** Per-user spot order burst (per 1s window). 0 = disabled. */
  SPOT_ORDER_BURST_PER_SEC: z.coerce.number().min(0).default(0),
  SPOT_CANCEL_BURST_PER_SEC: z.coerce.number().min(0).default(0),
  SPOT_WS_SUBSCRIBE_BURST_PER_SEC: z.coerce.number().min(0).default(0),
  /** Sample rate 0..1 for high-frequency writer logs (0 = off). */
  SPOT_WRITER_LOG_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0),
  /** Force JSON logs in development (staging parity). */
  LOG_JSON: z.string().transform((v) => v === 'true' || v === '1').default('false'),

  /** WS NATS forwarder: priority shedding under load (JetStream → WS). */
  WS_FORWARDER_SHED_ENABLED: z.string().transform((v) => v === 'true' || v === '1').default('true'),
  WS_FORWARDER_SHED_T1_PENDING: z.coerce.number().min(0).default(3000),
  WS_FORWARDER_SHED_T2_PENDING: z.coerce.number().min(0).default(15_000),
  WS_FORWARDER_SHED_T1_LAG_MS: z.coerce.number().min(0).default(400),
  WS_FORWARDER_SHED_T2_LAG_MS: z.coerce.number().min(0).default(2000),
  WS_FORWARDER_SHED_T1_BACKLOG_BYTES: z.coerce.number().min(0).default(262_144),
  WS_FORWARDER_SHED_T2_BACKLOG_BYTES: z.coerce.number().min(0).default(1_572_864),
  WS_FORWARDER_SHED_TELEMETRY_MS: z.coerce.number().min(100).default(500),

  /** Writer colocated WS (NATS_WRITER_LOCAL_WS_BROADCAST): coalesce, batch, backpressure. */
  WS_WRITER_LOCAL_OPTIMIZE_ENABLED: z.string().transform((v) => v === 'true' || v === '1').default('true'),
  WS_WRITER_LOCAL_SHED_ENABLED: z.string().transform((v) => v === 'true' || v === '1').default('true'),
  WS_WRITER_LOCAL_TICKER_COALESCE_MS: z.coerce.number().min(0).default(8),
  WS_WRITER_LOCAL_TRADES_BATCH_MS: z.coerce.number().min(1).default(20),
  WS_WRITER_LOCAL_TRADES_BATCH_MAX: z.coerce.number().min(4).default(32),
  WS_WRITER_LOCAL_TRADES_BATCH_MIN_BACKLOG_BYTES: z.coerce.number().min(0).default(131_072),
  WS_WRITER_LOCAL_PER_CONN_SOFT_BUFFER_BYTES: z.coerce.number().min(0).default(131_072),
  WS_WRITER_LOCAL_PER_CONN_HARD_BUFFER_BYTES: z.coerce.number().min(0).default(524_288),
  /** 0 = fall back to generic soft buffer above. */
  WS_WRITER_LOCAL_PER_CONN_SOFT_TICKER_BYTES: z.coerce.number().min(0).default(0),
  WS_WRITER_LOCAL_PER_CONN_HARD_TICKER_BYTES: z.coerce.number().min(0).default(0),
  WS_WRITER_LOCAL_PER_CONN_SOFT_TRADES_BYTES: z.coerce.number().min(0).default(0),
  WS_WRITER_LOCAL_PER_CONN_HARD_TRADES_BYTES: z.coerce.number().min(0).default(0),
  WS_WRITER_LOCAL_DYNAMIC_COALESCE: z.string().transform((v) => v === 'true' || v === '1').default('true'),
  WS_WRITER_LOCAL_TICKER_COALESCE_MAX_MS: z.coerce.number().min(0).default(48),
  WS_WRITER_LOCAL_TRADES_BATCH_MS_MAX: z.coerce.number().min(1).default(80),
  WS_WRITER_LOCAL_ORDERBOOK_BURST_COALESCE: z.string().transform((v) => v === 'true' || v === '1').default('false'),
  WS_WRITER_LOCAL_ORDERBOOK_BURST_MS: z.coerce.number().min(1).default(12),
  WS_WRITER_LOCAL_ORDERBOOK_BURST_MS_MAX: z.coerce.number().min(1).default(40),
  WS_WRITER_LOCAL_ORDERBOOK_BURST_MIN_LAG_MS: z.coerce.number().min(0).default(120),
  WS_WRITER_LOCAL_ADAPTIVE_MODE: z.string().transform((v) => v === 'true' || v === '1').default('true'),
  WS_WRITER_LOCAL_ADAPTIVE_MODE_MIN_MS: z.coerce.number().min(100).default(2000),

  WS_WRITER_LOCAL_PID_ENABLED: z.string().transform((v) => v === 'true' || v === '1').default('true'),
  WS_PID_SETPOINT_LAG_MS: z.coerce.number().min(1).default(90),
  WS_PID_KP: z.coerce.number().min(0).default(0.004),
  WS_PID_KI: z.coerce.number().min(0).default(0.0006),
  WS_PID_KD: z.coerce.number().min(0).default(0.0012),
  WS_PID_INTEGRAL_MAX: z.coerce.number().min(1).default(800),
  WS_PID_UMIN: z.coerce.number().default(-0.22),
  WS_PID_UMAX: z.coerce.number().default(1.1),
  WS_PID_COALESCE_MIN_MULT: z.coerce.number().min(0.5).max(1).default(0.94),
  WS_PID_COALESCE_MAX_MULT: z.coerce.number().min(1).max(4).default(2.35),

  WS_WRITER_LOCAL_PUBLIC_QUEUE: z.string().transform((v) => v === 'true' || v === '1').default('false'),
  WS_PUBLIC_QUEUE_MAX: z.coerce.number().min(8).default(96),
  WS_PUBLIC_QUEUE_DRAIN_MS: z.coerce.number().min(2).default(5),

  WS_NET_ADAPT_ENABLED: z.string().transform((v) => v === 'true' || v === '1').default('true'),
  WS_NET_RTT_INFLATION_PER_MS: z.coerce.number().min(0).max(2).default(0.42),
  /** ms added per 1% client-reported loss (0–100). */
  WS_NET_LOSS_MS_PER_PERCENT: z.coerce.number().min(0).default(2.8),
  WS_NET_INFLATION_CAP_MS: z.coerce.number().min(0).default(800),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

// Tier 1: Production safety — block KYC demo auto-approve
if (parsed.data.NODE_ENV === 'production' && parsed.data.KYC_DIGILOCKER_DEMO_AUTO_APPROVE) {
  console.error('❌ KYC_DIGILOCKER_DEMO_AUTO_APPROVE must be false in production.');
  process.exit(1);
}

const natsPipelineOn =
  parsed.data.NATS_SPOT_PIPELINE_ENABLED ||
  parsed.data.NATS_ORDERBOOK_WRITER_ENABLED ||
  parsed.data.NATS_WS_ORDERBOOK_FORWARDER_ENABLED;
if (natsPipelineOn && !parsed.data.NATS_URL?.trim()) {
  console.error('❌ NATS_URL is required when NATS spot pipeline / writer / forwarder is enabled.');
  process.exit(1);
}

// Tier 1: Production — require admin IP whitelist (no open admin)
if (parsed.data.NODE_ENV === 'production') {
  const adminIps = parsed.data.ADMIN_IP_WHITELIST.split(',').map((s) => s.trim()).filter(Boolean);
  if (adminIps.length === 0) {
    console.error('❌ ADMIN_IP_WHITELIST must be set in production (comma-separated IPs or CIDR). Empty = deny all.');
    process.exit(1);
  }
  if (!parsed.data.SLO_IP_WHITELIST) {
    console.error('❌ SLO_IP_WHITELIST must be set in production so /observability/slo is not public.');
    process.exit(1);
  }
  if (!parsed.data.ALERT_WEBHOOK_URL?.trim()) {
    console.warn('⚠️  ALERT_WEBHOOK_URL not set — circuit_open and integrity_mismatch will not be sent to Slack/PagerDuty.');
  }
  if (!process.env.SANCTIONS_PROVIDER?.trim()) {
    console.warn('⚠️  SANCTIONS_PROVIDER not set — sanctions screening is no-op. Integrate a provider for compliance.');
  }
}

export const config = {
  env: parsed.data.NODE_ENV,
  port: parsed.data.PORT,
  frontendUrl: parsed.data.FRONTEND_URL,
  apiVersion: parsed.data.API_VERSION,
  isProduction: parsed.data.NODE_ENV === 'production',
  isDevelopment: parsed.data.NODE_ENV === 'development',
  runMode: parsed.data.RUN_MODE,

  database: {
    url: parsed.data.DATABASE_URL,
    poolMin: parsed.data.DATABASE_POOL_MIN,
    poolMax: parsed.data.DATABASE_POOL_MAX,
    sslRejectUnauthorized: parsed.data.DATABASE_SSL_REJECT_UNAUTHORIZED,
    readReplicaUrl: parsed.data.DATABASE_READ_REPLICA_URL,
  },

  strictDependencyStartup:
    parsed.data.STRICT_DEPENDENCY_STARTUP === true ||
    (parsed.data.STRICT_DEPENDENCY_STARTUP === undefined &&
      (parsed.data.TIER1_LAUNCH || parsed.data.NODE_ENV === 'production')),

  health: {
    requireNats:
      parsed.data.HEALTH_REQUIRE_NATS === 'true'
        ? true
        : parsed.data.HEALTH_REQUIRE_NATS === 'false'
          ? false
          : Boolean(
              parsed.data.NODE_ENV === 'production' &&
                parsed.data.NATS_URL?.trim() &&
                (parsed.data.NATS_SPOT_PIPELINE_ENABLED ||
                  parsed.data.NATS_ORDERBOOK_WRITER_ENABLED ||
                  parsed.data.NATS_WS_ORDERBOOK_FORWARDER_ENABLED)
            ),
    requireMatchingEngine:
      parsed.data.HEALTH_REQUIRE_MATCHING_ENGINE === 'true'
        ? true
        : parsed.data.HEALTH_REQUIRE_MATCHING_ENGINE === 'false'
          ? false
          : Boolean(parsed.data.NODE_ENV === 'production'),
    failOnStaleIndexer: parsed.data.HEALTH_FAIL_ON_STALE_INDEXER,
    indexerMaxLagSec: parsed.data.HEALTH_INDEXER_MAX_LAG_SEC,
    wsDisconnectWarnPerSec: parsed.data.HEALTH_WS_DISCONNECT_WARN_PER_SEC,
    databasePingTimeoutMs: parsed.data.HEALTH_DATABASE_PING_TIMEOUT_MS,
    databasePingMaxAttempts: parsed.data.HEALTH_DATABASE_PING_MAX_ATTEMPTS,
    databasePingRetryBaseMs: parsed.data.HEALTH_DATABASE_PING_RETRY_BASE_MS,
  },

  tier1: {
    alertEvalOnMetricsScrape: parsed.data.TIER1_ALERT_EVAL_ON_METRICS,
  },

  redis: {
    url: parsed.data.REDIS_URL,
    password: parsed.data.REDIS_PASSWORD,
    tlsEnabled: parsed.data.REDIS_TLS_ENABLED,
    wsPubSubEnabled: parsed.data.REDIS_WS_PUBSUB_ENABLED,
    retryMode: parsed.data.REDIS_RETRY_MODE,
    sentinels: (() => {
      const v = parsed.data.REDIS_SENTINELS?.trim();
      if (!v) return undefined;
      return v.split(',').map(s => {
        const [host, port] = s.trim().split(':');
        return { host: host || '127.0.0.1', port: parseInt(port || '26379', 10) };
      }).filter(x => x.host);
    })(),
    sentinelMaster: parsed.data.REDIS_SENTINEL_MASTER ?? undefined,
  },

  rabbitmq: {
    url: parsed.data.RABBITMQ_URL,
  },

  jwt: {
    secret: parsed.data.JWT_SECRET,
    refreshSecret: parsed.data.JWT_REFRESH_SECRET,
    expiresIn: parsed.data.NODE_ENV === 'development' ? '12h' : parsed.data.JWT_EXPIRES_IN,
    refreshExpiresIn: parsed.data.JWT_REFRESH_EXPIRES_IN,
  },

  encryption: {
    key: parsed.data.ENCRYPTION_KEY,
    ivLength: parsed.data.ENCRYPTION_IV_LENGTH,
  },

  hsm: {
    enabled: parsed.data.HSM_ENABLED,
    slotId: parsed.data.HSM_SLOT_ID,
    pin: parsed.data.HSM_PIN,
    libraryPath: parsed.data.HSM_LIBRARY_PATH,
  },

  kms: {
    type: parsed.data.KMS_TYPE,
    keyVersion: parsed.data.KMS_KEY_VERSION,
    aws: {
      keyId: parsed.data.AWS_KMS_KEY_ID,
      region: parsed.data.AWS_REGION,
    },
  },

  oauth: {
    google: {
      clientId: parsed.data.GOOGLE_CLIENT_ID,
      clientSecret: parsed.data.GOOGLE_CLIENT_SECRET,
      callbackUrl: parsed.data.GOOGLE_CALLBACK_URL,
    },
    apple: {
      clientId: parsed.data.APPLE_CLIENT_ID,
      teamId: parsed.data.APPLE_TEAM_ID,
      keyId: parsed.data.APPLE_KEY_ID,
      privateKey: parsed.data.APPLE_PRIVATE_KEY,
      callbackUrl: parsed.data.APPLE_CALLBACK_URL,
    },
    telegram: {
      botToken: parsed.data.TELEGRAM_BOT_TOKEN,
    },
  },

  email: {
    host: parsed.data.SMTP_HOST,
    port: parsed.data.SMTP_PORT,
    secure: parsed.data.SMTP_SECURE,
    user: parsed.data.SMTP_USER,
    password: parsed.data.SMTP_PASSWORD || parsed.data.SMTP_PASS || '',
    from: parsed.data.EMAIL_FROM || parsed.data.SMTP_FROM || 'noreply@exchange.com',
  },

  sms: {
    provider: parsed.data.SMS_PROVIDER,
    twilio: {
      accountSid: parsed.data.TWILIO_ACCOUNT_SID,
      authToken: parsed.data.TWILIO_AUTH_TOKEN,
      phoneNumber: parsed.data.TWILIO_PHONE_NUMBER,
    },
  },

  kyc: {
    provider: parsed.data.KYC_PROVIDER,
    digilockerDemoAutoApprove: parsed.data.KYC_DIGILOCKER_DEMO_AUTO_APPROVE,
    hyperverge: {
      appId: parsed.data.HYPERVERGE_APP_ID,
      appKey: parsed.data.HYPERVERGE_APP_KEY,
      baseUrl: parsed.data.HYPERVERGE_BASE_URL,
    },
  },

  blockchain: {
    ethereum: { rpcUrl: parsed.data.ETH_RPC_URL },
    bsc: { rpcUrl: parsed.data.BSC_RPC_URL },
    polygon: { rpcUrl: parsed.data.POLYGON_RPC_URL },
    arbitrum: { rpcUrl: parsed.data.ARBITRUM_RPC_URL },
    optimism: { rpcUrl: parsed.data.OPTIMISM_RPC_URL },
    base: { rpcUrl: parsed.data.BASE_RPC_URL },
    solana: { rpcUrl: parsed.data.SOLANA_RPC_URL },
    tron: {
      apiUrl: parsed.data.TRON_API_URL,
      apiKey: parsed.data.TRON_API_KEY,
    },
    bitcoin: {
      rpcUrl: parsed.data.BITCOIN_RPC_URL,
      rpcUser: parsed.data.BITCOIN_RPC_USER,
      rpcPassword: parsed.data.BITCOIN_RPC_PASSWORD,
      network: parsed.data.BITCOIN_NETWORK,
    },
  },

  rateLimit: {
    windowMs: parsed.data.RATE_LIMIT_WINDOW_MS,
    maxRequests: parsed.data.RATE_LIMIT_MAX_REQUESTS,
    failClosed: parsed.data.RATE_LIMIT_FAIL_CLOSED,
  },

  security: {
    corsOrigins: parsed.data.CORS_ORIGINS.split(',').map((o) => o.trim()),
    trustedProxies: parsed.data.TRUSTED_PROXIES,
    // FIX #3: Admin IP whitelist. Comma-separated IPs or CIDR (e.g. 10.0.0.0/8). Empty in production = deny all; in non-production = do not enforce.
    adminIpWhitelist: parsed.data.ADMIN_IP_WHITELIST.split(',')
      .map((ip) => ip.trim())
      .filter(Boolean),
    /** Destructive admin settlement actions require { confirm: true } when enabled. */
    adminRequireDestructiveConfirm: parsed.data.ADMIN_REQUIRE_DESTRUCTIVE_CONFIRM,
    sessionSecret: parsed.data.SESSION_SECRET,
    csrfSecret: parsed.data.CSRF_SECRET,
    sessionCoreUrl: parsed.data.SESSION_CORE_URL,
    lockServiceUrl: parsed.data.LOCK_SERVICE_URL,
    totpEncryptionKey: parsed.data.TOTP_ENCRYPTION_KEY,
  },

  logging: {
    level: parsed.data.LOG_LEVEL,
    sentryDsn: parsed.data.SENTRY_DSN,
  },

  monitoring: {
    prometheusEnabled: parsed.data.PROMETHEUS_ENABLED,
    prometheusPort: parsed.data.PROMETHEUS_PORT,
    alertWebhookUrl: parsed.data.ALERT_WEBHOOK_URL,
  },

  // Phase E: Multi-node and observability
  nodeId: parsed.data.NODE_ID ?? parsed.data.INSTANCE_ID ?? process.env.HOSTNAME ?? 'default',
  slo: {
    settlementPendingMax: parsed.data.SLO_SETTLEMENT_PENDING_MAX,
    orderLatencyP99MsMax: parsed.data.SLO_ORDER_LATENCY_P99_MS_MAX,
    ipWhitelist: parsed.data.SLO_IP_WHITELIST
      ? parsed.data.SLO_IP_WHITELIST.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined,
  },
  tracingEnabled: parsed.data.SLO_TRACING_ENABLED,

  ws: {
    maxConnectionsGlobal: parsed.data.WS_MAX_CONNECTIONS_GLOBAL,
    maxConnectionsPerUser: parsed.data.WS_MAX_CONNECTIONS_PER_USER,
  },

  wsForwarderShed: {
    enabled: parsed.data.WS_FORWARDER_SHED_ENABLED,
    tier1Pending: parsed.data.WS_FORWARDER_SHED_T1_PENDING,
    tier2Pending: parsed.data.WS_FORWARDER_SHED_T2_PENDING,
    tier1LagMs: parsed.data.WS_FORWARDER_SHED_T1_LAG_MS,
    tier2LagMs: parsed.data.WS_FORWARDER_SHED_T2_LAG_MS,
    tier1BacklogBytes: parsed.data.WS_FORWARDER_SHED_T1_BACKLOG_BYTES,
    tier2BacklogBytes: parsed.data.WS_FORWARDER_SHED_T2_BACKLOG_BYTES,
    telemetryMs: parsed.data.WS_FORWARDER_SHED_TELEMETRY_MS,
  },

  wsWriterLocal: {
    optimizeEnabled: parsed.data.WS_WRITER_LOCAL_OPTIMIZE_ENABLED,
    shedEnabled: parsed.data.WS_WRITER_LOCAL_SHED_ENABLED,
    tickerCoalesceMs: parsed.data.WS_WRITER_LOCAL_TICKER_COALESCE_MS,
    tradesBatchMs: parsed.data.WS_WRITER_LOCAL_TRADES_BATCH_MS,
    tradesBatchMax: parsed.data.WS_WRITER_LOCAL_TRADES_BATCH_MAX,
    tradesBatchMinBacklogBytes: parsed.data.WS_WRITER_LOCAL_TRADES_BATCH_MIN_BACKLOG_BYTES,
    perConnSoftBufferBytes: parsed.data.WS_WRITER_LOCAL_PER_CONN_SOFT_BUFFER_BYTES,
    perConnHardBufferBytes: parsed.data.WS_WRITER_LOCAL_PER_CONN_HARD_BUFFER_BYTES,
    perConnSoftTickerBytes: parsed.data.WS_WRITER_LOCAL_PER_CONN_SOFT_TICKER_BYTES,
    perConnHardTickerBytes: parsed.data.WS_WRITER_LOCAL_PER_CONN_HARD_TICKER_BYTES,
    perConnSoftTradesBytes: parsed.data.WS_WRITER_LOCAL_PER_CONN_SOFT_TRADES_BYTES,
    perConnHardTradesBytes: parsed.data.WS_WRITER_LOCAL_PER_CONN_HARD_TRADES_BYTES,
    dynamicCoalesce: parsed.data.WS_WRITER_LOCAL_DYNAMIC_COALESCE,
    tickerCoalesceMaxMs: parsed.data.WS_WRITER_LOCAL_TICKER_COALESCE_MAX_MS,
    tradesBatchMsMax: parsed.data.WS_WRITER_LOCAL_TRADES_BATCH_MS_MAX,
    orderbookBurstCoalesce: parsed.data.WS_WRITER_LOCAL_ORDERBOOK_BURST_COALESCE,
    orderbookBurstMs: parsed.data.WS_WRITER_LOCAL_ORDERBOOK_BURST_MS,
    orderbookBurstMsMax: parsed.data.WS_WRITER_LOCAL_ORDERBOOK_BURST_MS_MAX,
    orderbookBurstMinLagMs: parsed.data.WS_WRITER_LOCAL_ORDERBOOK_BURST_MIN_LAG_MS,
    adaptiveModeEnabled: parsed.data.WS_WRITER_LOCAL_ADAPTIVE_MODE,
    adaptiveModeMinIntervalMs: parsed.data.WS_WRITER_LOCAL_ADAPTIVE_MODE_MIN_MS,

    pidEnabled: parsed.data.WS_WRITER_LOCAL_PID_ENABLED,
    pidSetpointLagMs: parsed.data.WS_PID_SETPOINT_LAG_MS,
    pidKp: parsed.data.WS_PID_KP,
    pidKi: parsed.data.WS_PID_KI,
    pidKd: parsed.data.WS_PID_KD,
    pidIntegralMax: parsed.data.WS_PID_INTEGRAL_MAX,
    pidUmin: parsed.data.WS_PID_UMIN,
    pidUmax: parsed.data.WS_PID_UMAX,
    pidCoalesceMinMult: parsed.data.WS_PID_COALESCE_MIN_MULT,
    pidCoalesceMaxMult: parsed.data.WS_PID_COALESCE_MAX_MULT,

    publicQueueEnabled: parsed.data.WS_WRITER_LOCAL_PUBLIC_QUEUE,
    publicQueueMax: parsed.data.WS_PUBLIC_QUEUE_MAX,
    queueDrainIntervalMs: parsed.data.WS_PUBLIC_QUEUE_DRAIN_MS,

    netAdaptEnabled: parsed.data.WS_NET_ADAPT_ENABLED,
    netRttInflationPerMs: parsed.data.WS_NET_RTT_INFLATION_PER_MS,
    netLossInflationPerPct: parsed.data.WS_NET_LOSS_MS_PER_PERCENT,
    netInflationCapMs: parsed.data.WS_NET_INFLATION_CAP_MS,
  },

  rustMatchingEngine: {
    /** Node in-process matching is disabled; Rust HTTP engine is the only execution path. */
    enabled: true,
    url: parsed.data.MATCHING_ENGINE_URL,
    urlsRaw: parsed.data.MATCHING_ENGINE_URLS,
    instanceIdsRaw: parsed.data.MATCHING_ENGINE_INSTANCE_IDS,
    shardRoutingEnabled: parsed.data.MATCHING_ENGINE_SHARD_ROUTING_ENABLED,
    strictMarketRouting: parsed.data.MATCHING_ENGINE_STRICT_MARKET_ROUTING,
    skipUnhealthyForPlace: parsed.data.MATCHING_ENGINE_SKIP_UNHEALTHY_FOR_PLACE,
    routesRaw: parsed.data.MATCHING_ENGINE_ROUTES,
    internalSecret: parsed.data.ENGINE_INTERNAL_SECRET,
  },

  /** Spot durability / fan-out (Tier-1). */
  spot: {
    matchEventPersistRetries: parsed.data.MATCH_EVENT_PERSIST_RETRIES,
    engineWsDedupUseRedis: parsed.data.SPOT_ENGINE_WS_DEDUP_REDIS,
  },

  nats: {
    url: parsed.data.NATS_URL,
    useEventStream: parsed.data.USE_EVENT_STREAM,
    settlementStreamPullBatch: parsed.data.SETTLEMENT_STREAM_PULL_BATCH,
    settlementStreamPullIntervalMs: parsed.data.SETTLEMENT_STREAM_PULL_INTERVAL_MS,
    matchPollerFallbackEnabled: parsed.data.EVENT_STREAM_MATCH_POLLER_FALLBACK,
    settlementStreamMaxAckPending: parsed.data.SETTLEMENT_STREAM_MAX_ACK_PENDING,
    settlementStreamAckWaitMs: parsed.data.SETTLEMENT_STREAM_ACK_WAIT_MS,
    settlementStreamMaxDeliver: parsed.data.SETTLEMENT_STREAM_MAX_DELIVER,
    matchEventsPartitionCount: parsed.data.MATCH_EVENTS_PARTITION_COUNT,
    spotPipelineEnabled: parsed.data.NATS_SPOT_PIPELINE_ENABLED,
    orderbookWriterEnabled: parsed.data.NATS_ORDERBOOK_WRITER_ENABLED,
    wsOrderbookForwarderEnabled: parsed.data.NATS_WS_ORDERBOOK_FORWARDER_ENABLED,
    writerLocalWsBroadcast: parsed.data.NATS_WRITER_LOCAL_WS_BROADCAST,
    shardId: parsed.data.ORDERBOOK_SHARD_ID,
    shardTotal: parsed.data.ORDERBOOK_SHARD_TOTAL,
    snapshotIntervalMs: parsed.data.ORDERBOOK_SNAPSHOT_INTERVAL_MS,
    snapshotPath:
      parsed.data.ORDERBOOK_SNAPSHOT_PATH ||
      path.join(path.resolve(__dirname, '../../../../'), 'data', 'spot-orderbook-writer-snapshot.json'),
    writerStrictSeq: parsed.data.ORDERBOOK_WRITER_STRICT_SEQ,
    publisherAssignWriterSeq: parsed.data.ORDERBOOK_PUBLISHER_ASSIGN_SEQ,
    writerDedupUseRedis: parsed.data.ORDERBOOK_WRITER_DEDUP_REDIS,
    writerDedupTtlSec: parsed.data.ORDERBOOK_WRITER_DEDUP_TTL_SEC,
    writerLagPendingThreshold: parsed.data.ORDERBOOK_WRITER_LAG_PENDING_THRESHOLD,
    writerPullMsFast: parsed.data.ORDERBOOK_WRITER_PULL_MS_FAST,
    writerPullMsSlow: parsed.data.ORDERBOOK_WRITER_PULL_MS_SLOW,
    writerLeaderTtlMs: parsed.data.ORDERBOOK_WRITER_LEADER_TTL_MS,
    writerLeaderElection: parsed.data.ORDERBOOK_WRITER_LEADER_ELECTION,
    writerLagCircuitMs: parsed.data.ORDERBOOK_WRITER_LAG_CIRCUIT_MS,
    writerLagCircuitPending: parsed.data.ORDERBOOK_WRITER_LAG_CIRCUIT_PENDING,
  },

  spotBurstLimits: {
    ordersPerSec: parsed.data.SPOT_ORDER_BURST_PER_SEC,
    cancelsPerSec: parsed.data.SPOT_CANCEL_BURST_PER_SEC,
    wsSubscribePerSec: parsed.data.SPOT_WS_SUBSCRIBE_BURST_PER_SEC,
  },

  observability: {
    spotWriterLogSampleRate: parsed.data.SPOT_WRITER_LOG_SAMPLE_RATE,
    logJson: parsed.data.LOG_JSON,
  },

  priceOracle: {
    enabled: parsed.data.PRICE_ORACLE_ENABLED,
    intervalSec: parsed.data.PRICE_ORACLE_INTERVAL_SEC,
  },

  liquidityBot: {
    enabled: parsed.data.LIQUIDITY_BOT_ENABLED,
    apiKey: parsed.data.LIQUIDITY_BOT_API_KEY ?? undefined,
    internalApiBaseUrl: parsed.data.LIQUIDITY_BOT_INTERNAL_API_URL,
    spreadBps: parsed.data.LIQUIDITY_BOT_SPREAD_BPS,
    orderSize: parsed.data.LIQUIDITY_BOT_ORDER_SIZE,
    symbols: parsed.data.LIQUIDITY_BOT_SYMBOLS.split(',').map((s) => s.trim().toUpperCase().replace(/-/g, '_')).filter(Boolean),
    oracleStaleSec: parsed.data.LIQUIDITY_BOT_ORACLE_STALE_SEC,
    staleSpreadMultiplier: parsed.data.LIQUIDITY_BOT_STALE_SPREAD_MULTIPLIER,
    skipIfOracleStale: parsed.data.LIQUIDITY_BOT_SKIP_IF_ORACLE_STALE,
    repriceBpsThreshold: parsed.data.LIQUIDITY_BOT_REPRICE_BPS_THRESHOLD,
    repriceQtyRelThreshold: parsed.data.LIQUIDITY_BOT_REPRICE_QTY_REL_THRESHOLD,
    rateLimitExemptUserIds: new Set(
      parsed.data.LIQUIDITY_BOT_RATE_LIMIT_EXEMPT_USER_IDS.split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
    ),
  },

  mmHealth: {
    enabled: parsed.data.MM_HEALTH_ENABLED,
    oracleCriticalSec: parsed.data.MM_HEALTH_ORACLE_CRITICAL_SEC,
    settlementLagCriticalSec: parsed.data.MM_HEALTH_SETTLEMENT_LAG_CRITICAL_SEC,
    botErrorWindow: parsed.data.MM_HEALTH_BOT_ERROR_WINDOW,
    botErrorRateCritical: parsed.data.MM_HEALTH_BOT_ERROR_RATE_CRITICAL,
    botErrorRateWarn: parsed.data.MM_HEALTH_BOT_ERROR_RATE_WARN,
    quoteAgeCriticalSec: parsed.data.MM_HEALTH_QUOTE_AGE_CRITICAL_SEC,
    minCyclesBeforeQuoteCheck: parsed.data.MM_HEALTH_MIN_CYCLES_BEFORE_QUOTE_CHECK,
    externalDivergenceWarnBps: parsed.data.MM_HEALTH_EXTERNAL_DIVERGENCE_WARN_BPS,
    externalDivergenceCriticalBps: parsed.data.MM_HEALTH_EXTERNAL_DIVERGENCE_CRITICAL_BPS,
    spreadMultDegraded: parsed.data.MM_HEALTH_SPREAD_MULT_DEGRADED,
    spreadMultBad: parsed.data.MM_HEALTH_SPREAD_MULT_BAD,
    autoPauseOnCritical: parsed.data.MM_HEALTH_AUTO_PAUSE_ON_CRITICAL,
  },

  externalPriceFeed: {
    enabled: parsed.data.EXTERNAL_PRICE_FEED_ENABLED,
    baseUrl: parsed.data.EXTERNAL_PRICE_FEED_BASE_URL?.trim() || 'https://api.binance.com',
    sourceBaseUrls: parsed.data.EXTERNAL_PRICE_FEED_SOURCES.split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && /^https?:\/\//i.test(s)),
    aggregation: parsed.data.EXTERNAL_PRICE_FEED_AGGREGATION,
    outlierMaxBps: parsed.data.EXTERNAL_PRICE_OUTLIER_MAX_BPS,
    latencyWeightEnabled: parsed.data.EXTERNAL_PRICE_LATENCY_WEIGHT,
    latencyWeightFloorMs: parsed.data.EXTERNAL_PRICE_LATENCY_FLOOR_MS,
  },

  eliteMm: {
    flowWindowSec: parsed.data.ELITE_MM_FLOW_WINDOW_SEC,
    flowTradeLimit: parsed.data.ELITE_MM_FLOW_TRADE_LIMIT,
    flowSpreadCoeff: parsed.data.ELITE_MM_FLOW_SPREAD_COEFF,
    latencySpreadBpsPerMs: parsed.data.ELITE_MM_LATENCY_SPREAD_BPS_PER_MS,
    latencySpreadCapBps: parsed.data.ELITE_MM_LATENCY_SPREAD_CAP_BPS,
    toxicSlippageCoeff: parsed.data.ELITE_MM_TOXIC_SLIPPAGE_COEFF,
    toxicAdverseCoeff: parsed.data.ELITE_MM_TOXIC_ADVERSE_COEFF,
    spreadToxicCapBps: parsed.data.ELITE_MM_SPREAD_TOXIC_CAP_BPS,
    toxicAdverseBps: parsed.data.ELITE_MM_TOXIC_ADVERSE_BPS,
    toxicSlippageRefBps: parsed.data.ELITE_MM_TOXIC_SLIPPAGE_REF_BPS,
    invVolTightenCoeff: parsed.data.ELITE_MM_INV_VOL_TIGHTEN_COEFF,
    invVolRefBps: parsed.data.ELITE_MM_INV_VOL_REF_BPS,
    autoCircuitEnabled: parsed.data.ELITE_MM_AUTO_CIRCUIT_ENABLED,
    autoCircuitIntervalMs: parsed.data.ELITE_MM_AUTO_CIRCUIT_INTERVAL_MS,
    autoCircuitToxicScoreThreshold: parsed.data.ELITE_MM_AUTO_CIRCUIT_TOXIC_SCORE,
    autoCircuitOfiAbsThreshold: parsed.data.ELITE_MM_AUTO_CIRCUIT_OFI_ABS,
    autoCircuitExtDivergenceBps: parsed.data.ELITE_MM_AUTO_CIRCUIT_EXT_DIV_BPS,
    autoCircuitOkStreak: parsed.data.ELITE_MM_AUTO_CIRCUIT_OK_STREAK,
    autoCircuitToxicClearThreshold: parsed.data.ELITE_MM_AUTO_CIRCUIT_TOXIC_CLEAR,
    autoCircuitOfiClearThreshold: parsed.data.ELITE_MM_AUTO_CIRCUIT_OFI_CLEAR,
    autoCircuitExtDivergenceClearBps: parsed.data.ELITE_MM_AUTO_CIRCUIT_EXT_DIV_CLEAR,
    profitMetricsCacheEnabled: parsed.data.ELITE_MM_PROFIT_METRICS_CACHE,
    feeAwareSpreadEnabled: parsed.data.ELITE_MM_FEE_AWARE_SPREAD,
    feeAwareMakerMult: parsed.data.ELITE_MM_FEE_AWARE_MAKER_MULT,
    feeAwareTakerTailMult: parsed.data.ELITE_MM_FEE_AWARE_TAKER_TAIL_MULT,
    profitSpreadEnabled: parsed.data.ELITE_MM_PROFIT_SPREAD,
    profitEdgeTargetBps: parsed.data.ELITE_MM_PROFIT_EDGE_TARGET_BPS,
    profitSpreadCoeff: parsed.data.ELITE_MM_PROFIT_SPREAD_COEFF,
    profitSpreadMaxWidenBps: parsed.data.ELITE_MM_PROFIT_SPREAD_MAX_WIDEN_BPS,
    profitSpreadMaxTightenBps: parsed.data.ELITE_MM_PROFIT_SPREAD_MAX_TIGHTEN_BPS,
    capitalAllocEnabled: parsed.data.ELITE_MM_CAPITAL_ALLOC_ENABLED,
    capitalWeightPnl: parsed.data.ELITE_MM_CAPITAL_W_PNL,
    capitalWeightVolume: parsed.data.ELITE_MM_CAPITAL_W_VOLUME,
    capitalWeightVolatility: parsed.data.ELITE_MM_CAPITAL_W_VOLATILITY,
    capitalAllocEmaAlpha: parsed.data.ELITE_MM_CAPITAL_EMA_ALPHA,
    capitalAllocWeightMin: parsed.data.ELITE_MM_CAPITAL_WEIGHT_MIN,
    capitalAllocWeightMax: parsed.data.ELITE_MM_CAPITAL_WEIGHT_MAX,
    benchOutlierMaxBps: parsed.data.ELITE_MM_BENCH_OUTLIER_MAX_BPS,
    benchExternalBlend: parsed.data.ELITE_MM_BENCH_EXTERNAL_BLEND,
    adversePostTradeHorizonTrades: parsed.data.ELITE_MM_ADV_POSTTRADE_TRADES,
    adverseSpreadEnabled: parsed.data.ELITE_MM_ADV_SPREAD,
    adverseSpreadCoeff: parsed.data.ELITE_MM_ADV_SPREAD_COEFF,
    adverseSpreadCapBps: parsed.data.ELITE_MM_ADV_SPREAD_CAP_BPS,
    profitTargetVolCoeff: parsed.data.ELITE_MM_PROFIT_TARGET_VOL_COEFF,
    profitTargetVolRefBps: parsed.data.ELITE_MM_PROFIT_TARGET_VOL_REF_BPS,
    profitTargetLiqCoeff: parsed.data.ELITE_MM_PROFIT_TARGET_LIQ_COEFF,
    profitTargetLiqRefQuote: parsed.data.ELITE_MM_PROFIT_TARGET_LIQ_REF_QUOTE,
    benchMicropriceWeight: parsed.data.ELITE_MM_BENCH_MICROPRICE_WEIGHT,
    mtmMicroInMark: parsed.data.ELITE_MM_MTM_MICRO_IN_MARK,
    adverseHorizonBaseTrades: parsed.data.ELITE_MM_ADV_HORIZON_BASE,
    adverseHorizonVolCoeff: parsed.data.ELITE_MM_ADV_HORIZON_VOL_COEFF,
    adverseHorizonFreqCoeff: parsed.data.ELITE_MM_ADV_HORIZON_FREQ_COEFF,
    adverseHorizonVolRefBps: parsed.data.ELITE_MM_ADV_HORIZON_VOL_REF_BPS,
    adverseHorizonMinTrades: parsed.data.ELITE_MM_ADV_HORIZON_MIN,
    adverseHorizonMaxTrades: parsed.data.ELITE_MM_ADV_HORIZON_MAX,
    regimeWindowSec: parsed.data.ELITE_MM_REGIME_WINDOW_SEC,
    regimeMaxTrades: parsed.data.ELITE_MM_REGIME_MAX_TRADES,
    regimeMinTrades: parsed.data.ELITE_MM_REGIME_MIN_TRADES,
    regimeTrendRhoMin: parsed.data.ELITE_MM_REGIME_TREND_RHO_MIN,
    regimeMrRhoMax: parsed.data.ELITE_MM_REGIME_MR_RHO_MAX,
    regimeVrTrendMin: parsed.data.ELITE_MM_REGIME_VR_TREND_MIN,
    regimeVrMrMax: parsed.data.ELITE_MM_REGIME_VR_MR_MAX,
    regimeTrendTargetAddBps: parsed.data.ELITE_MM_REGIME_TREND_TARGET_ADD_BPS,
    regimeMrTargetSubtractBps: parsed.data.ELITE_MM_REGIME_MR_TARGET_SUB_BPS,
    capitalWeightTrend: parsed.data.ELITE_MM_CAPITAL_W_TREND,
    capitalWeightFlow: parsed.data.ELITE_MM_CAPITAL_W_FLOW,

    deskMicroMinNotionalQuote: parsed.data.ELITE_MM_DESK_MICRO_MIN_NOTIONAL_QUOTE,
    deskMicroMaxSpreadBpsTop: parsed.data.ELITE_MM_DESK_MICRO_MAX_SPREAD_BPS_TOP,
    deskMicroReliabilityLevels: parsed.data.ELITE_MM_DESK_MICRO_LEVELS,
    deskMicroJumpFilterEnabled: parsed.data.ELITE_MM_DESK_MICRO_JUMP_FILTER,
    deskMicroMaxJumpBps: parsed.data.ELITE_MM_DESK_MICRO_MAX_JUMP_BPS,
    deskMicroPrevTtlSec: parsed.data.ELITE_MM_DESK_MICRO_PREV_TTL_SEC,

    deskMomentumWindowSec: parsed.data.ELITE_MM_DESK_MOMENTUM_WINDOW_SEC,
    deskMomentumMaxTrades: parsed.data.ELITE_MM_DESK_MOMENTUM_MAX_TRADES,
    deskMomentumSpreadEnabled: parsed.data.ELITE_MM_DESK_MOMENTUM_SPREAD_ENABLED,
    deskMomentumSpreadCoeff: parsed.data.ELITE_MM_DESK_MOMENTUM_SPREAD_COEFF,
    deskMomentumHalfCapBps: parsed.data.ELITE_MM_DESK_MOMENTUM_HALF_CAP_BPS,

    capitalExplorationEnabled: parsed.data.ELITE_MM_CAPITAL_EXPLORATION_ENABLED,
    capitalExplorationEpsilon: parsed.data.ELITE_MM_CAPITAL_EXPLORATION_EPSILON,

    deskBookObiLevels: parsed.data.ELITE_MM_DESK_BOOK_OBI_LEVELS,
    deskBookAdvEnabled: parsed.data.ELITE_MM_DESK_BOOK_ADV_ENABLED,
    deskBookAdvCoeff: parsed.data.ELITE_MM_DESK_BOOK_ADV_COEFF,
    deskBookAdvCapBps: parsed.data.ELITE_MM_DESK_BOOK_ADV_CAP_BPS,

    deskLatArbEnabled: parsed.data.ELITE_MM_DESK_LAT_ARB_ENABLED,
    deskLatArbRefMs: parsed.data.ELITE_MM_DESK_LAT_ARB_REF_MS,
    deskLatArbLatCoeff: parsed.data.ELITE_MM_DESK_LAT_ARB_LAT_COEFF,
    deskLatArbDivRefBps: parsed.data.ELITE_MM_DESK_LAT_ARB_DIV_REF_BPS,
    deskLatArbDivCoeff: parsed.data.ELITE_MM_DESK_LAT_ARB_DIV_COEFF,
    deskLatArbCapBps: parsed.data.ELITE_MM_DESK_LAT_ARB_CAP_BPS,
  },

  institutionalMm: {
    volWindowMinutes: parsed.data.INSTITUTIONAL_MM_VOL_WINDOW_MINUTES,
    volMinSamples: parsed.data.INSTITUTIONAL_MM_VOL_MIN_SAMPLES,
    volSpreadCoeff: parsed.data.INSTITUTIONAL_MM_VOL_SPREAD_COEFF,
    volSpreadCapBps: parsed.data.INSTITUTIONAL_MM_VOL_SPREAD_CAP_BPS,
    volSpreadMultCap: parsed.data.INSTITUTIONAL_MM_VOL_SPREAD_MULT_CAP,
    ladderLevels: parsed.data.INSTITUTIONAL_MM_LADDER_LEVELS,
    ladderStepBps: parsed.data.INSTITUTIONAL_MM_LADDER_STEP_BPS,
    ladderSizeDecay: parsed.data.INSTITUTIONAL_MM_LADDER_SIZE_DECAY,
    quoteMaxAgeSec: parsed.data.INSTITUTIONAL_MM_QUOTE_MAX_AGE_SEC,
    inventorySoftRatio: parsed.data.INSTITUTIONAL_MM_INV_SOFT_RATIO,
    inventoryHardRatio: parsed.data.INSTITUTIONAL_MM_INV_HARD_RATIO,
    inventoryMaxSkewBps: parsed.data.INSTITUTIONAL_MM_INV_MAX_SKEW_BPS,
    inventorySizeTaper: parsed.data.INSTITUTIONAL_MM_INV_SIZE_TAPER,
    inventoryExtraSpreadBps: parsed.data.INSTITUTIONAL_MM_INV_EXTRA_SPREAD_BPS,
  },

  workers: {
    settlementBatchSize: parsed.data.SETTLEMENT_BATCH_SIZE,
    settlementWorkerIntervalMs: parsed.data.SETTLEMENT_WORKER_INTERVAL_MS,
    disableMatchPoller: parsed.data.DISABLE_MATCH_POLLER,
    disableSettlementWorker: parsed.data.DISABLE_SETTLEMENT_WORKER,
    disableSigningQueue: parsed.data.DISABLE_SIGNING_QUEUE,
    disableDepositSweep: parsed.data.DISABLE_DEPOSIT_SWEEP,
    disableWalletReconciliation: parsed.data.DISABLE_WALLET_RECONCILIATION,
    disableSafetyTriggerWorker: parsed.data.DISABLE_SAFETY_TRIGGER_WORKER,
    disableTier1Reconciliation: parsed.data.DISABLE_TIER1_RECONCILIATION,
    tier1ReconciliationIntervalMs: parsed.data.TIER1_RECONCILIATION_INTERVAL_MS,
    disableCandleAggregation: parsed.data.DISABLE_CANDLE_AGGREGATION,
  },

  features: {
    enableSpotOrdersReserveOnly: parsed.data.ENABLE_SPOT_ORDERS_RESERVE_ONLY,
    makerRebatesEnabled: parsed.data.FEATURE_MAKER_REBATES,
    icebergOrdersEnabled: parsed.data.FEATURE_ICEBERG_ORDERS,
    p2pEnabled: parsed.data.FEATURE_P2P_ENABLED,
    spotTradingEnabled: parsed.data.FEATURE_SPOT_TRADING_ENABLED,
    marginTradingEnabled: parsed.data.FEATURE_MARGIN_TRADING_ENABLED,
    maintenanceMode: parsed.data.MAINTENANCE_MODE,
  },

  maxFailedLoginAttempts: parsed.data.MAX_FAILED_LOGIN_ATTEMPTS,
  lockoutMinutes: parsed.data.LOCKOUT_MINUTES,
  withdrawalApprovalThreshold: parsed.data.WITHDRAWAL_APPROVAL_THRESHOLD,
  withdrawalAddressCoolingHours: parsed.data.WITHDRAWAL_ADDRESS_COOLING_HOURS,

  depositSweep: {
    enabled: parsed.data.DEPOSIT_SWEEP_ENABLED,
    minWei: parsed.data.DEPOSIT_SWEEP_MIN_WEI,
  },

  preTradeRisk: {
    spotOrderVelocityPerMin: parsed.data.SPOT_ORDER_VELOCITY_PER_MIN,
    spotLargeOrderNotionalUsdt: parsed.data.SPOT_LARGE_ORDER_NOTIONAL_USDT,
    spotMaxOpenNotionalUsdt: parsed.data.SPOT_MAX_OPEN_NOTIONAL_USDT,
  },

  p2p: {
    maxFiatPerOrderInr: parsed.data.P2P_MAX_FIAT_PER_ORDER_INR,
    maxCryptoPerOrderUsdt: parsed.data.P2P_MAX_CRYPTO_PER_ORDER_USDT,
    maxFiatPerUserDailyInr: parsed.data.P2P_MAX_FIAT_PER_USER_DAILY_INR,
    maxCryptoPerUserDailyUsdt: parsed.data.P2P_MAX_CRYPTO_PER_USER_DAILY_USDT,
    newBuyerMaxAccountAgeHours: parsed.data.P2P_NEW_BUYER_MAX_ACCOUNT_AGE_HOURS,
    newBuyerMaxOrderFiatInrEquiv: parsed.data.P2P_NEW_BUYER_MAX_ORDER_FIAT_INR_EQUIV,
    unverifiedSellerMaxOrderFiatInrEquiv: parsed.data.P2P_UNVERIFIED_SELLER_MAX_ORDER_FIAT_INR_EQUIV,
    verifiedSellerMinCompletedOrders: parsed.data.P2P_VERIFIED_SELLER_MIN_COMPLETED_ORDERS,
    referencePriceTtlSec: parsed.data.P2P_REFERENCE_PRICE_TTL_SEC,
    adsListCacheTtlSec: parsed.data.P2P_ADS_LIST_CACHE_TTL_SEC,
    slaReleaseMinutes: parsed.data.P2P_SLA_RELEASE_MINUTES,
    slaAction: parsed.data.P2P_SLA_ACTION,
    slaWorkerEnabled: parsed.data.P2P_SLA_WORKER_ENABLED,
    requirePaymentProof: parsed.data.P2P_REQUIRE_PAYMENT_PROOF,
    maxPaymentProofBytes: parsed.data.P2P_MAX_PAYMENT_PROOF_BYTES,
    paymentProofStorage: parsed.data.P2P_PAYMENT_PROOF_STORAGE,
  },

  geoBlocking: {
    blockedCountries: parsed.data.GEO_BLOCKED_COUNTRIES
      ? parsed.data.GEO_BLOCKED_COUNTRIES.split(',').map((c) => c.trim().toUpperCase()).filter(Boolean)
      : [],
  },

  aml: {
    largeFiatInrThreshold: parsed.data.AML_LARGE_FIAT_INR_THRESHOLD,
    largeCryptoWithdrawalThreshold: parsed.data.AML_LARGE_CRYPTO_WITHDRAWAL_THRESHOLD,
    velocityWithdrawalCount: parsed.data.AML_VELOCITY_WITHDRAWAL_COUNT,
    velocityWindowHours: parsed.data.AML_VELOCITY_WINDOW_HOURS,
    highRiskCountries: parsed.data.AML_HIGH_RISK_COUNTRIES
      ? parsed.data.AML_HIGH_RISK_COUNTRIES.split(',').map((c) => c.trim().toUpperCase()).filter(Boolean)
      : [],
  },
} as const;

export type Config = typeof config;
