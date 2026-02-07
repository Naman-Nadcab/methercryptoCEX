/**
 * Security IP rules: whitelist/blacklist and country rules per scope (admin | user).
 * Used by ipRulesMiddleware for access control.
 */

import { db } from '../lib/database.js';
import { logger } from '../lib/logger.js';

export type IpRuleScope = 'admin' | 'user';
export type IpRuleType = 'whitelist' | 'blacklist';

export interface SecurityIpRule {
  id: string;
  scope: IpRuleScope;
  rule_type: IpRuleType;
  ip_cidr: string | null;
  country_code: string | null;
  enabled: boolean;
  created_at: string;
}

export interface CreateIpRuleInput {
  scope: IpRuleScope;
  rule_type: IpRuleType;
  ip_cidr?: string | null;
  country_code?: string | null;
  enabled?: boolean;
}

export interface UpdateIpRuleInput {
  rule_type?: IpRuleType;
  ip_cidr?: string | null;
  country_code?: string | null;
  enabled?: boolean;
}

export interface ListIpRulesOptions {
  scope?: IpRuleScope | null;
  rule_type?: IpRuleType | null;
  enabled?: boolean | null;
  limit?: number;
  offset?: number;
}

const RULES_CACHE_KEY = 'security:ip_rules:v1';
const RULES_CACHE_TTL_SEC = 60;

/**
 * Normalize CIDR for DB: single IP becomes /32 for IPv4, /128 for IPv6.
 */
function normalizeCidr(cidr: string): string {
  const s = cidr.trim();
  if (s.includes('/')) return s;
  if (s.includes(':')) return `${s}/128`;
  return `${s}/32`;
}

/**
 * Check if a rule matches the client IP (and optionally country).
 * Uses PostgreSQL inet operators for CIDR matching.
 * Admin: if any whitelist rule exists for scope, allow only when client matches a whitelist rule.
 */
export async function matchRules(params: {
  scope: IpRuleScope;
  clientIp: string;
  countryCode?: string | null;
}): Promise<{ allow: boolean; reason: string; matchedRule?: SecurityIpRule }> {
  const { scope, clientIp, countryCode } = params;
  const country = (countryCode ?? '').toUpperCase() || null;

  let rows: { rows: (SecurityIpRule & { matches: boolean })[] };
  try {
    rows = await db.query<SecurityIpRule & { matches: boolean }>(
    `SELECT id, scope, rule_type, ip_cidr, country_code, enabled, created_at,
            (
              (ip_cidr IS NULL OR $2::inet << ip_cidr::inet)
              AND (country_code IS NULL OR country_code = $3)
            ) AS matches
     FROM security_ip_rules
     WHERE scope = $1 AND enabled = TRUE`,
      [scope, clientIp, country]
    );
  } catch (e) {
    logger.warn('IP rules match query failed', { scope, clientIp, error: e instanceof Error ? e.message : 'Unknown' });
    if (scope === 'admin') return { allow: false, reason: 'IP_NOT_WHITELISTED' };
    return { allow: true, reason: 'OK' };
  }

  const all = rows.rows;
  const hasWhitelistRules = all.some((r) => r.rule_type === 'whitelist');
  const whitelistMatches = all.filter((r) => r.rule_type === 'whitelist' && r.matches);
  const blacklistMatches = all.filter((r) => r.rule_type === 'blacklist' && r.matches);

  if (scope === 'admin') {
    if (blacklistMatches.length > 0) {
      return { allow: false, reason: 'IP_BLACKLISTED', matchedRule: blacklistMatches[0] as SecurityIpRule };
    }
    if (hasWhitelistRules) {
      if (whitelistMatches.length === 0) {
        return { allow: false, reason: 'IP_NOT_WHITELISTED' };
      }
      return { allow: true, reason: 'OK', matchedRule: whitelistMatches[0] as SecurityIpRule };
    }
    return { allow: true, reason: 'OK' };
  }

  if (scope === 'user') {
    if (blacklistMatches.length > 0) {
      return { allow: false, reason: 'IP_BLACKLISTED', matchedRule: blacklistMatches[0] as SecurityIpRule };
    }
    return { allow: true, reason: 'OK' };
  }

  return { allow: true, reason: 'OK' };
}

/**
 * Admin: require at least one whitelist match for admin scope.
 * If any whitelist rules exist and none match, deny.
 */
export async function evaluateAdminAccess(params: {
  clientIp: string;
  countryCode?: string | null;
}): Promise<{ allow: boolean; reason: string; matchedRule?: SecurityIpRule }> {
  return matchRules({ scope: 'admin', ...params });
}

/**
 * User scope: deny if any blacklist rule matches.
 */
export async function evaluateUserAccess(params: {
  clientIp: string;
  countryCode?: string | null;
}): Promise<{ allow: boolean; reason: string; matchedRule?: SecurityIpRule }> {
  return matchRules({ scope: 'user', ...params });
}

export async function listRules(options: ListIpRulesOptions = {}): Promise<{ rules: SecurityIpRule[]; total: number }> {
  const { scope = null, rule_type = null, enabled = null, limit = 50, offset = 0 } = options;
  const conditions: string[] = ['1=1'];
  const params: unknown[] = [];
  let i = 1;
  if (scope) {
    conditions.push(`scope = $${i++}`);
    params.push(scope);
  }
  if (rule_type) {
    conditions.push(`rule_type = $${i++}`);
    params.push(rule_type);
  }
  if (enabled !== null && enabled !== undefined) {
    conditions.push(`enabled = $${i++}`);
    params.push(enabled);
  }
  const where = conditions.join(' AND ');
  const countResult = await db.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM security_ip_rules WHERE ${where}`,
    params
  );
  const total = parseInt(countResult.rows[0]?.count ?? '0', 10);
  params.push(limit, offset);
  const result = await db.query<SecurityIpRule>(
    `SELECT id, scope, rule_type, ip_cidr, country_code, enabled, created_at
     FROM security_ip_rules WHERE ${where}
     ORDER BY created_at DESC LIMIT $${i} OFFSET $${i + 1}`,
    params
  );
  return { rules: result.rows, total };
}

export async function getRuleById(id: string): Promise<SecurityIpRule | null> {
  const result = await db.query<SecurityIpRule>(
    `SELECT id, scope, rule_type, ip_cidr, country_code, enabled, created_at
     FROM security_ip_rules WHERE id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}

export async function createRule(input: CreateIpRuleInput): Promise<SecurityIpRule> {
  if (!input.ip_cidr && !input.country_code) {
    throw new Error('Either ip_cidr or country_code must be set');
  }
  const ipCidr = input.ip_cidr ? normalizeCidr(input.ip_cidr) : null;
  const countryCode = input.country_code ? input.country_code.trim().toUpperCase().slice(0, 2) : null;
  const enabled = input.enabled ?? true;
  const result = await db.query<SecurityIpRule>(
    `INSERT INTO security_ip_rules (scope, rule_type, ip_cidr, country_code, enabled)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, scope, rule_type, ip_cidr, country_code, enabled, created_at`,
    [input.scope, input.rule_type, ipCidr, countryCode, enabled]
  );
  return result.rows[0]!;
}

export async function updateRule(id: string, input: UpdateIpRuleInput): Promise<SecurityIpRule | null> {
  const existing = await getRuleById(id);
  if (!existing) return null;
  const ipCidr = input.ip_cidr !== undefined
    ? (input.ip_cidr ? normalizeCidr(input.ip_cidr) : null)
    : existing.ip_cidr;
  const countryCode = input.country_code !== undefined
    ? (input.country_code ? input.country_code.trim().toUpperCase().slice(0, 2) : null)
    : existing.country_code;
  if (!ipCidr && !countryCode) {
    throw new Error('Rule must have either ip_cidr or country_code');
  }
  const enabled = input.enabled !== undefined ? input.enabled : existing.enabled;
  const result = await db.query<SecurityIpRule>(
    `UPDATE security_ip_rules
     SET rule_type = COALESCE($2, rule_type), ip_cidr = COALESCE($3, ip_cidr),
         country_code = COALESCE($4, country_code), enabled = $5
     WHERE id = $1
     RETURNING id, scope, rule_type, ip_cidr, country_code, enabled, created_at`,
    [id, input.rule_type ?? existing.rule_type, ipCidr, countryCode, enabled]
  );
  return result.rows[0] ?? null;
}

export async function setRuleEnabled(id: string, enabled: boolean): Promise<SecurityIpRule | null> {
  const result = await db.query<SecurityIpRule>(
    `UPDATE security_ip_rules SET enabled = $2 WHERE id = $1
     RETURNING id, scope, rule_type, ip_cidr, country_code, enabled, created_at`,
    [id, enabled]
  );
  return result.rows[0] ?? null;
}

export async function deleteRule(id: string): Promise<boolean> {
  const result = await db.query(`DELETE FROM security_ip_rules WHERE id = $1`, [id]);
  return (result.rowCount ?? 0) > 0;
}
