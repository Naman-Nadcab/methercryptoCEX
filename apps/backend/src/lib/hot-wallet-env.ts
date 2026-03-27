/**
 * Hot Wallet Critical Environment Validation
 * FAIL CLOSED: Refuse to start if any required config is missing or unsafe.
 */

import { config } from '../config/index.js';
import { logger } from './logger.js';

const MIN_ENCRYPTION_KEY_LENGTH = 32;

export function validateHotWalletEnv(): void {
  const errors: string[] = [];

  if (!config.database?.url || config.database.url.length < 10) {
    errors.push('DATABASE_URL is missing or invalid. Hot wallet cannot operate.');
  }
  const encKey = config.encryption?.key;
  if (!encKey || typeof encKey !== 'string') {
    errors.push('ENCRYPTION_KEY is missing. Set ENCRYPTION_KEY in .env (min 32 characters).');
  } else if (encKey.length < MIN_ENCRYPTION_KEY_LENGTH) {
    errors.push(`ENCRYPTION_KEY must be at least ${MIN_ENCRYPTION_KEY_LENGTH} characters.`);
  }

  if (errors.length > 0) {
    logger.error('Hot wallet critical env validation FAILED. Server will not start.', { errors });
    process.exit(1);
  }
  logger.info('Hot wallet critical env validated (ENCRYPTION_KEY, DATABASE_URL).');
}

/**
 * Production-specific config checks. FAIL CLOSED: blocks startup on critical misconfig.
 */
export function validateProductionConfig(): void {
  if (process.env.NODE_ENV !== 'production') return;

  const errors: string[] = [];
  const warnings: string[] = [];

  // P0: Admin IP whitelist must be set in production (fail-closed)
  const adminIps = (process.env.ADMIN_IP_WHITELIST ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (adminIps.length === 0) {
    errors.push(
      'ADMIN_IP_WHITELIST is empty in production. Set comma-separated admin IPs (e.g. 1.2.3.4,10.0.0.0/8). Server will not start until fixed.'
    );
  }

  // P0: Block plain private key in env (production only)
  const raw = process.env.HOT_WALLET_PRIVATE_KEY?.trim();
  if (raw && raw.length > 0) {
    errors.push(
      'HOT_WALLET_PRIVATE_KEY must not be set in production. Use HSM/KMS and encrypted keys only. Remove HOT_WALLET_PRIVATE_KEY from env.'
    );
  }

  // P1: Warn if ALERT_WEBHOOK_URL empty (circuit breaker alerts)
  const alertUrl = process.env.ALERT_WEBHOOK_URL?.trim();
  if (!alertUrl) {
    warnings.push('ALERT_WEBHOOK_URL is empty. Circuit breaker and integrity alerts will not be sent. Set Slack/email webhook for production.');
  }

  // P1: Warn if DB SSL verification disabled for remote DB
  const dbUrl = process.env.DATABASE_URL ?? '';
  const isLocalDb = dbUrl.includes('localhost') || dbUrl.includes('127.0.0.1');
  const sslReject = process.env.DATABASE_SSL_REJECT_UNAUTHORIZED ?? 'true';
  if (!isLocalDb && (sslReject === 'false' || sslReject === '0')) {
    warnings.push('DATABASE_SSL_REJECT_UNAUTHORIZED=false with remote DB. Use true in production to verify server cert, or document private-network-only.');
  }

  if (errors.length > 0) {
    logger.error('Production config validation FAILED. Server will not start.', { errors });
    process.exit(1);
  }

  if (warnings.length > 0) {
    logger.warn('Production config warnings', { warnings });
  }
}
