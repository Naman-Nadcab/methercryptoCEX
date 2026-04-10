/**
 * Fatal invariants before serving traffic (belt-and-suspenders after env parse).
 */
import { config } from '../config/index.js';
import { logger } from './logger.js';

export function assertLaunchSecurityInvariants(): void {
  if (config.isProduction && config.withdrawalWhitelistRelaxed) {
    logger.error('FATAL: WITHDRAWAL_WHITELIST_RELAXED must be false in production');
    process.exit(1);
  }
}
