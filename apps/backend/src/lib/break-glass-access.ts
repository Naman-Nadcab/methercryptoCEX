import { config } from '../config/index.js';
import { isIpInWhitelist } from './admin-ip-whitelist.js';

/** Break-glass challenge/login: Tier-1 IP gate (ADMIN_BREAK_GLASS_ALLOWED_IPS). */
export function isBreakGlassClientIpAllowed(clientIp: string): boolean {
  const list = config.security.breakGlassAllowedIps;
  if (list.length > 0) return isIpInWhitelist(clientIp, list);
  if (!config.isProduction) return isIpInWhitelist(clientIp, ['127.0.0.1', '::1']);
  return false;
}
