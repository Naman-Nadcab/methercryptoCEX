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
 * Production-specific config checks. Logs warnings for misconfigurations.
 * Does not block startup; operator must fix before handling real money.
 */
export function validateProductionConfig(): void {
  if (process.env.NODE_ENV !== 'production') return;

  const warnings: string[] = [];

  const adminIps = (process.env.ADMIN_IP_WHITELIST ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (adminIps.length === 0) {
    warnings.push('ADMIN_IP_WHITELIST is empty. No admin will be able to access. Set it before production use.');
  }

  if (warnings.length > 0) {
    logger.warn('Production config warnings (fix before handling real money)', { warnings });
  }
}
