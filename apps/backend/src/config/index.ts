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

  // Redis
  REDIS_URL: z.string().default('redis://localhost:6379'),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_TLS_ENABLED: z.coerce.boolean().default(false),
  REDIS_WS_PUBSUB_ENABLED: z.string().transform(v => v === 'true').default('false'),

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
  PORT: z.coerce.number().default(4000),
  FRONTEND_URL: z.string().default('http://localhost:3000'),
  API_VERSION: z.string().default('v1'),

  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(900000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(100),

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

  // Feature Flags
  ENABLE_SPOT_ORDERS_RESERVE_ONLY: z.string().transform(v => v === 'true').default('false'), // POST /spot/orders reserve-only path; default OFF for safety
  FEATURE_P2P_ENABLED: z.string().transform(v => v === 'true').default('true'),
  FEATURE_SPOT_TRADING_ENABLED: z.string().transform(v => v === 'true').default('true'),
  FEATURE_MARGIN_TRADING_ENABLED: z.string().transform(v => v === 'true').default('false'),
  MAINTENANCE_MODE: z.string().transform(v => v === 'true').default('false'),

  // Account lockout after failed logins
  MAX_FAILED_LOGIN_ATTEMPTS: z.coerce.number().min(3).max(20).default(5),
  LOCKOUT_MINUTES: z.coerce.number().min(5).max(1440).default(30),

  // Withdrawal approval: amount (in token units) above this requires admin approval
  WITHDRAWAL_APPROVAL_THRESHOLD: z.coerce.number().default(10000),

  // Deposit consolidation: sweep user deposit addresses to hot wallet
  DEPOSIT_SWEEP_ENABLED: z.string().transform(v => v === 'true').default('true'),
  DEPOSIT_SWEEP_MIN_WEI: z.string().default('1000000000000000'),

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
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = {
  env: parsed.data.NODE_ENV,
  port: parsed.data.PORT,
  frontendUrl: parsed.data.FRONTEND_URL,
  apiVersion: parsed.data.API_VERSION,
  isProduction: parsed.data.NODE_ENV === 'production',
  isDevelopment: parsed.data.NODE_ENV === 'development',

  database: {
    url: parsed.data.DATABASE_URL,
    poolMin: parsed.data.DATABASE_POOL_MIN,
    poolMax: parsed.data.DATABASE_POOL_MAX,
  },

  redis: {
    url: parsed.data.REDIS_URL,
    password: parsed.data.REDIS_PASSWORD,
    tlsEnabled: parsed.data.REDIS_TLS_ENABLED,
    wsPubSubEnabled: parsed.data.REDIS_WS_PUBSUB_ENABLED,
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
  },

  features: {
    enableSpotOrdersReserveOnly: parsed.data.ENABLE_SPOT_ORDERS_RESERVE_ONLY,
    p2pEnabled: parsed.data.FEATURE_P2P_ENABLED,
    spotTradingEnabled: parsed.data.FEATURE_SPOT_TRADING_ENABLED,
    marginTradingEnabled: parsed.data.FEATURE_MARGIN_TRADING_ENABLED,
    maintenanceMode: parsed.data.MAINTENANCE_MODE,
  },

  maxFailedLoginAttempts: parsed.data.MAX_FAILED_LOGIN_ATTEMPTS,
  lockoutMinutes: parsed.data.LOCKOUT_MINUTES,
  withdrawalApprovalThreshold: parsed.data.WITHDRAWAL_APPROVAL_THRESHOLD,

  depositSweep: {
    enabled: parsed.data.DEPOSIT_SWEEP_ENABLED,
    minWei: parsed.data.DEPOSIT_SWEEP_MIN_WEI,
  },

  p2p: {
    maxFiatPerOrderInr: parsed.data.P2P_MAX_FIAT_PER_ORDER_INR,
    maxCryptoPerOrderUsdt: parsed.data.P2P_MAX_CRYPTO_PER_ORDER_USDT,
    maxFiatPerUserDailyInr: parsed.data.P2P_MAX_FIAT_PER_USER_DAILY_INR,
    maxCryptoPerUserDailyUsdt: parsed.data.P2P_MAX_CRYPTO_PER_USER_DAILY_USDT,
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
