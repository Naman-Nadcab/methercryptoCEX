import dotenv from 'dotenv';
import { z } from 'zod';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from root .env
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

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

  // Email
  SMTP_HOST: z.string().default('smtp.gmail.com'),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_SECURE: z.coerce.boolean().default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  EMAIL_FROM: z.string().default('noreply@exchange.com'),

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

  // Tier 1: Rust matching engine primary. When true, spot limit/market orders go to Rust engine.
  USE_RUST_MATCHING_ENGINE: z.string().transform(v => v === 'true').default('true'),
  MATCHING_ENGINE_URL: z.string().default('http://localhost:7101'),
  /** Secret for engine->backend internal API (orderbook rebuild). When set, engine must send X-Engine-Secret. */
  ENGINE_INTERNAL_SECRET: z.string().optional().transform(v => (v ?? '').trim() || undefined),

  // Phase D: Price oracle (update market_prices from external API)
  PRICE_ORACLE_ENABLED: z.string().transform(v => v === 'true').default('false'),
  PRICE_ORACLE_INTERVAL_SEC: z.coerce.number().min(60).max(3600).default(120),

  // Phase D: Internal liquidity bot (place/cancel limit orders around mid)
  LIQUIDITY_BOT_ENABLED: z.string().transform(v => v === 'true').default('false'),
  LIQUIDITY_BOT_API_KEY: z.string().optional(),
  LIQUIDITY_BOT_SPREAD_BPS: z.coerce.number().min(1).max(500).default(10),
  LIQUIDITY_BOT_ORDER_SIZE: z.string().default('0.001'),
  LIQUIDITY_BOT_SYMBOLS: z.string().default('BTC_USDT'),

  // Worker disable flags (for separation / graceful degrade)
  DISABLE_MATCH_POLLER: z.string().transform(v => v === 'true').default('false'),
  DISABLE_SETTLEMENT_WORKER: z.string().transform(v => v === 'true').default('false'),
  SETTLEMENT_BATCH_SIZE: z.coerce.number().min(1).max(100).default(20), // Tier 1: events per run for ~500+/s throughput
  DISABLE_SIGNING_QUEUE: z.string().transform(v => v === 'true').default('false'),
  DISABLE_DEPOSIT_SWEEP: z.string().transform(v => v === 'true').default('false'),
  DISABLE_WALLET_RECONCILIATION: z.string().transform(v => v === 'true').default('false'),
  DISABLE_SAFETY_TRIGGER_WORKER: z.string().transform(v => v === 'true').default('false'),
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

  // AML transaction monitoring (Step 6C)
  AML_LARGE_FIAT_INR_THRESHOLD: z.coerce.number().default(1_000_000),
  AML_LARGE_CRYPTO_WITHDRAWAL_THRESHOLD: z.coerce.number().default(100_000),
  AML_VELOCITY_WITHDRAWAL_COUNT: z.coerce.number().min(2).default(3),
  AML_VELOCITY_WINDOW_HOURS: z.coerce.number().min(1).default(24),
  AML_HIGH_RISK_COUNTRIES: z.string().default(''), // Comma-separated ISO codes, e.g. KP,IR,SY
  GEO_BLOCKED_COUNTRIES: z.string().default(''), // Comma-separated ISO codes for geo-blocking

  // Tier 1 launch: when true, enables fail-closed, Rust engine, and enforces production safety
  TIER1_LAUNCH: z.string().transform(v => v === 'true' || v === '1').default('false'),
  // SLO endpoint IP whitelist (comma-separated); when set, only these IPs can access /observability/slo
  SLO_IP_WHITELIST: z.string().optional().transform(v => (v ?? '').trim() || undefined),
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

  redis: {
    url: parsed.data.REDIS_URL,
    password: parsed.data.REDIS_PASSWORD,
    tlsEnabled: parsed.data.REDIS_TLS_ENABLED,
    wsPubSubEnabled: parsed.data.REDIS_WS_PUBSUB_ENABLED,
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
    password: parsed.data.SMTP_PASSWORD,
    from: parsed.data.EMAIL_FROM,
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

  rustMatchingEngine: {
    enabled: parsed.data.USE_RUST_MATCHING_ENGINE,
    url: parsed.data.MATCHING_ENGINE_URL,
    internalSecret: parsed.data.ENGINE_INTERNAL_SECRET,
  },

  priceOracle: {
    enabled: parsed.data.PRICE_ORACLE_ENABLED,
    intervalSec: parsed.data.PRICE_ORACLE_INTERVAL_SEC,
  },

  liquidityBot: {
    enabled: parsed.data.LIQUIDITY_BOT_ENABLED,
    apiKey: parsed.data.LIQUIDITY_BOT_API_KEY ?? undefined,
    spreadBps: parsed.data.LIQUIDITY_BOT_SPREAD_BPS,
    orderSize: parsed.data.LIQUIDITY_BOT_ORDER_SIZE,
    symbols: parsed.data.LIQUIDITY_BOT_SYMBOLS.split(',').map((s) => s.trim().toUpperCase().replace(/-/g, '_')).filter(Boolean),
  },

  workers: {
    settlementBatchSize: parsed.data.SETTLEMENT_BATCH_SIZE,
    disableMatchPoller: parsed.data.DISABLE_MATCH_POLLER,
    disableSettlementWorker: parsed.data.DISABLE_SETTLEMENT_WORKER,
    disableSigningQueue: parsed.data.DISABLE_SIGNING_QUEUE,
    disableDepositSweep: parsed.data.DISABLE_DEPOSIT_SWEEP,
    disableWalletReconciliation: parsed.data.DISABLE_WALLET_RECONCILIATION,
    disableSafetyTriggerWorker: parsed.data.DISABLE_SAFETY_TRIGGER_WORKER,
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
