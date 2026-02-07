/**
 * Global risk engine: aggregates security signals and returns ALLOW / CHALLENGE / BLOCK.
 * Used for login (post-auth), withdrawal, P2P, API key usage.
 * Always logs to security_risk_events; high-risk decisions also to audit_logs_immutable.
 */

import { db } from '../lib/database.js';
import { logger } from '../lib/logger.js';
import { logAudit } from './audit-log.service.js';

export type RiskScope = 'login' | 'withdrawal' | 'p2p' | 'api' | 'admin';
export type RiskDecision = 'allow' | 'challenge' | 'block';

export interface RiskRuleRow {
  id: string;
  scope: string;
  min_score: number;
  max_score: number;
  decision: string;
  priority: number;
  enabled: boolean;
}

export interface RiskContext {
  /** User or admin id */
  userId?: string | null;
  /** For withdrawal: amount in token units (numeric string or number) */
  amount?: number | string | null;
  /** Current client IP */
  ip?: string | null;
  /** Country from request (e.g. CF-IPCountry) */
  countryCode?: string | null;
  /** Device id from request */
  deviceId?: string | null;
  /** VPN/TOR flag from middleware */
  isVpnOrTor?: boolean;
  /** Request id for tracing */
  requestId?: string | null;
  /** Token symbol for withdrawal (e.g. high-risk asset) */
  symbol?: string | null;
  /** Whether asset is high-risk */
  isHighRiskAsset?: boolean;
}

export interface RiskSignals {
  [key: string]: number | boolean | string | null | undefined;
}

export interface RiskResult {
  score: number;
  decision: RiskDecision;
  signals: RiskSignals;
  ruleId?: string | null;
}

/** Default weights per signal (sum of weighted contributions capped to 100). */
const DEFAULT_WEIGHTS: Record<string, number> = {
  failed_login_count: 15,
  new_device: 12,
  new_country: 15,
  vpn_tor: 20,
  ip_block_attempt: 25,
  kyc_not_approved: 18,
  amount_high: 10,
  velocity_high: 15,
}

const VELOCITY_WINDOW_HOURS = 24;
const VELOCITY_THRESHOLD_WITHDRAWALS = 5;

/**
 * Fetch failed login count for user from users table.
 */
export async function getFailedLoginCount(userId: string): Promise<number> {
  const r = await db.query<{ failed_login_attempts: number }>(
    `SELECT COALESCE(failed_login_attempts, 0)::int AS failed_login_attempts FROM users WHERE id = $1`,
    [userId]
  );
  return r.rows[0]?.failed_login_attempts ?? 0;
}

/**
 * Check if current device has been seen before for this user (sessions or activity).
 */
export async function isNewDevice(userId: string, deviceId: string | null): Promise<boolean> {
  if (!deviceId) return true;
  const r = await db.query<{ n: string }>(
    `SELECT 1 AS n FROM user_sessions WHERE user_id = $1 AND device_id = $2 AND is_active = TRUE LIMIT 1`,
    [userId, deviceId]
  );
  if (r.rows.length > 0) return false;
  const r2 = await db.query<{ n: string }>(
    `SELECT 1 AS n FROM user_activity_logs WHERE user_id = $1 AND device_id = $2 LIMIT 1`,
    [userId, deviceId]
  );
  return r2.rows.length === 0;
}

/**
 * Check if current country has been seen before for this user.
 * Uses activity logs details JSON if it contains country_code; otherwise treats as not new (false) to avoid false positives.
 */
export async function isNewCountry(userId: string, countryCode: string | null): Promise<boolean> {
  if (!countryCode) return false;
  try {
    const r = await db.query<{ details: string | null }>(
      `SELECT details FROM user_activity_logs WHERE user_id = $1 AND details IS NOT NULL AND details::jsonb ? 'country_code' ORDER BY created_at DESC LIMIT 5`,
      [userId]
    );
    for (const row of r.rows) {
      if (!row.details) continue;
      try {
        const d = typeof row.details === 'string' ? JSON.parse(row.details) : row.details;
        if (d && String(d.country_code).toUpperCase() === countryCode.toUpperCase()) return false;
      } catch {
        // ignore malformed JSON
      }
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * KYC approved for user (any approved kyc_applications). Returns false if table missing or error.
 */
export async function getKycApproved(userId: string): Promise<boolean> {
  try {
    const r = await db.query<{ n: string }>(
      `SELECT 1 AS n FROM kyc_applications WHERE user_id = $1 AND status = 'approved' LIMIT 1`,
      [userId]
    );
    return r.rows.length > 0;
  } catch {
    return false;
  }
}

/**
 * Count withdrawals by user in the last N hours (velocity).
 */
export async function getWithdrawalVelocity(userId: string, hours: number = VELOCITY_WINDOW_HOURS): Promise<number> {
  const r = await db.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM withdrawals WHERE user_id = $1 AND created_at > NOW() - ($2 || ' hours')::interval`,
    [userId, hours]
  );
  return parseInt(r.rows[0]?.count ?? '0', 10);
}

/**
 * Check for recent access_blocked or login_failed in user_activity_logs (IP block attempt signal).
 */
export async function hasRecentIpBlockOrFailedLogin(userId: string, withinMinutes: number = 60): Promise<boolean> {
  const r = await db.query<{ n: string }>(
    `SELECT 1 AS n FROM user_activity_logs
     WHERE user_id = $1 AND activity_type IN ('access_blocked', 'login_failed') AND created_at > NOW() - ($2 || ' minutes')::interval LIMIT 1`,
    [userId, withinMinutes]
  );
  return r.rows.length > 0;
}

/**
 * Compute all signals for the given context and scope. Returns a flat map of signal names to values (for explainability).
 */
export async function computeSignals(params: {
  scope: RiskScope;
  actorId: string | null;
  context: RiskContext;
}): Promise<RiskSignals> {
  const { scope, actorId, context } = params;
  const signals: RiskSignals = {};

  if (actorId) {
    const failedCount = await getFailedLoginCount(actorId);
    signals.failed_login_count = Math.min(failedCount, 5);
    signals.new_device = await isNewDevice(actorId, context.deviceId ?? null);
    signals.new_country = await isNewCountry(actorId, context.countryCode ?? null);
    signals.kyc_not_approved = !(await getKycApproved(actorId));
  } else {
    signals.failed_login_count = 0;
    signals.new_device = false;
    signals.new_country = false;
    signals.kyc_not_approved = true;
  }

  signals.vpn_tor = context.isVpnOrTor === true;
  signals.ip_block_attempt = actorId ? await hasRecentIpBlockOrFailedLogin(actorId) : false;

  if (scope === 'withdrawal' && context.amount != null && actorId) {
    const amount = typeof context.amount === 'string' ? parseFloat(context.amount) : Number(context.amount);
    const velocity = await getWithdrawalVelocity(actorId);
    signals.amount_high = amount > 10000 ? 1 : amount > 1000 ? 0.5 : 0;
    signals.velocity_high = velocity >= VELOCITY_THRESHOLD_WITHDRAWALS ? 1 : 0;
    if (context.isHighRiskAsset) signals.asset_high_risk = true;
  } else {
    signals.amount_high = 0;
    signals.velocity_high = 0;
  }

  return signals;
}

/**
 * Compute composite score 0–100 from signals and weights. Uses default weights; can be overridden via Redis later.
 */
export function scoreFromSignals(signals: RiskSignals, weights: Record<string, number> = DEFAULT_WEIGHTS): number {
  let total = 0;
  if (signals.failed_login_count != null && typeof signals.failed_login_count === 'number') {
    total += (signals.failed_login_count / 5) * (weights.failed_login_count ?? 15);
  }
  if (signals.new_device === true) total += weights.new_device ?? 12;
  if (signals.new_country === true) total += weights.new_country ?? 15;
  if (signals.vpn_tor === true) total += weights.vpn_tor ?? 20;
  if (signals.ip_block_attempt === true) total += weights.ip_block_attempt ?? 25;
  if (signals.kyc_not_approved === true) total += weights.kyc_not_approved ?? 18;
  if (typeof signals.amount_high === 'number') {
    total += signals.amount_high * (weights.amount_high ?? 10);
  }
  if (typeof signals.velocity_high === 'number') {
    total += signals.velocity_high * (weights.velocity_high ?? 15);
  }
  if (signals.asset_high_risk === true) total += 8;
  return Math.min(100, Math.round(Math.min(100, total)));
}

/**
 * Load enabled rules for scope, ordered by priority DESC.
 */
async function getRulesForScope(scope: RiskScope): Promise<RiskRuleRow[]> {
  const r = await db.query<RiskRuleRow>(
    `SELECT id, scope, min_score, max_score, decision, priority, enabled
     FROM security_risk_rules WHERE scope = $1 AND enabled = TRUE ORDER BY priority DESC`,
    [scope]
  );
  return r.rows;
}

/**
 * Apply first matching rule by score; default allow if no rule matches.
 */
function applyRules(score: number, rules: RiskRuleRow[]): { decision: RiskDecision; ruleId?: string } {
  for (const rule of rules) {
    if (score >= rule.min_score && score <= rule.max_score) {
      return { decision: rule.decision as RiskDecision, ruleId: rule.id };
    }
  }
  return { decision: 'allow' };
}

/**
 * Evaluate risk: compute signals, score, apply rules, return result.
 */
export async function evaluateRisk(params: {
  scope: RiskScope;
  actorType: 'user' | 'admin' | 'system';
  actorId: string | null;
  context: RiskContext;
  requestId?: string | null;
}): Promise<RiskResult> {
  const { scope, actorType, actorId, context, requestId } = params;
  const signals = await computeSignals({ scope, actorId, context });
  const score = scoreFromSignals(signals);
  const rules = await getRulesForScope(scope);
  const { decision, ruleId } = applyRules(score, rules);
  return { score, decision, signals, ruleId };
}

/**
 * Log risk event to security_risk_events. Best-effort.
 */
export async function logRiskEvent(params: {
  actorType: string;
  actorId: string | null;
  scope: RiskScope;
  score: number;
  decision: RiskDecision;
  signals: RiskSignals;
  requestId?: string | null;
}): Promise<void> {
  const { actorType, actorId, scope, score, decision, signals, requestId } = params;
  try {
    await db.query(
      `INSERT INTO security_risk_events (actor_type, actor_id, scope, score, decision, signals, request_id)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
      [actorType, actorId, scope, score, decision, JSON.stringify(signals), requestId ?? null]
    );
  } catch (e) {
    logger.warn('Risk event log failed (best-effort)', {
      scope,
      decision,
      error: e instanceof Error ? e.message : 'Unknown',
    });
  }
}

/**
 * Log high-risk (challenge/block) to audit_logs_immutable. Best-effort.
 */
export async function logHighRiskToAudit(params: {
  requestId?: string | null;
  actorType: 'user' | 'admin' | 'system';
  actorId: string | null;
  scope: RiskScope;
  decision: RiskDecision;
  score: number;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  if (params.decision === 'allow') return;
  try {
    await logAudit({
      requestId: params.requestId ?? null,
      actorType: params.actorType,
      actorId: params.actorId,
      action: 'risk_engine_decision',
      resourceType: 'risk',
      resourceId: null,
      newValue: { scope: params.scope, decision: params.decision, score: params.score },
      ipAddress: params.ipAddress ?? null,
      userAgent: params.userAgent ?? null,
    });
  } catch (e) {
    logger.warn('Risk audit log failed (best-effort)', { scope: params.scope, error: e instanceof Error ? e.message : 'Unknown' });
  }
}

/**
 * Evaluate risk, log event, and optionally log to audit if decision is challenge/block.
 * Returns the result so the caller can allow/challenge/block.
 */
export async function evaluateAndLogRisk(params: {
  scope: RiskScope;
  actorType: 'user' | 'admin' | 'system';
  actorId: string | null;
  context: RiskContext;
  requestId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<RiskResult> {
  const result = await evaluateRisk({
    scope: params.scope,
    actorType: params.actorType,
    actorId: params.actorId,
    context: params.context,
    requestId: params.requestId,
  });
  await logRiskEvent({
    actorType: params.actorType,
    actorId: params.actorId,
    scope: params.scope,
    score: result.score,
    decision: result.decision,
    signals: result.signals,
    requestId: params.requestId,
  });
  if (result.decision !== 'allow') {
    await logHighRiskToAudit({
      requestId: params.requestId,
      actorType: params.actorType,
      actorId: params.actorId,
      scope: params.scope,
      decision: result.decision,
      score: result.score,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
    });
  }
  return result;
}

// ---------- Admin CRUD for risk rules ----------

export interface RiskRuleRecord {
  id: string;
  scope: RiskScope;
  min_score: number;
  max_score: number;
  decision: RiskDecision;
  priority: number;
  enabled: boolean;
  created_at: string;
}

export interface CreateRiskRuleInput {
  scope: RiskScope;
  min_score?: number;
  max_score?: number;
  decision: RiskDecision;
  priority?: number;
  enabled?: boolean;
}

export interface UpdateRiskRuleInput {
  min_score?: number;
  max_score?: number;
  decision?: RiskDecision;
  priority?: number;
  enabled?: boolean;
}

export async function listRiskRules(params: { scope?: RiskScope | null; enabled?: boolean | null; limit?: number; offset?: number } = {}): Promise<{ rules: RiskRuleRecord[]; total: number }> {
  const { scope = null, enabled = null, limit = 50, offset = 0 } = params;
  const conditions: string[] = ['1=1'];
  const queryParams: unknown[] = [];
  let i = 1;
  if (scope) {
    conditions.push(`scope = $${i++}`);
    queryParams.push(scope);
  }
  if (enabled !== null && enabled !== undefined) {
    conditions.push(`enabled = $${i++}`);
    queryParams.push(enabled);
  }
  const where = conditions.join(' AND ');
  const countResult = await db.query<{ count: string }>(`SELECT COUNT(*) AS count FROM security_risk_rules WHERE ${where}`, queryParams);
  const total = parseInt(countResult.rows[0]?.count ?? '0', 10);
  queryParams.push(limit, offset);
  const result = await db.query<RiskRuleRecord>(
    `SELECT id, scope, min_score, max_score, decision, priority, enabled, created_at
     FROM security_risk_rules WHERE ${where} ORDER BY scope, priority DESC LIMIT $${i} OFFSET $${i + 1}`,
    queryParams
  );
  return { rules: result.rows, total };
}

export async function getRiskRuleById(id: string): Promise<RiskRuleRecord | null> {
  const r = await db.query<RiskRuleRecord>(
    `SELECT id, scope, min_score, max_score, decision, priority, enabled, created_at FROM security_risk_rules WHERE id = $1`,
    [id]
  );
  return r.rows[0] ?? null;
}

export async function createRiskRule(input: CreateRiskRuleInput): Promise<RiskRuleRecord> {
  const min_score = Math.max(0, Math.min(100, input.min_score ?? 0));
  const max_score = Math.max(0, Math.min(100, input.max_score ?? 100));
  if (min_score > max_score) throw new Error('min_score must be <= max_score');
  const priority = input.priority ?? 0;
  const enabled = input.enabled ?? true;
  const result = await db.query<RiskRuleRecord>(
    `INSERT INTO security_risk_rules (scope, min_score, max_score, decision, priority, enabled)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, scope, min_score, max_score, decision, priority, enabled, created_at`,
    [input.scope, min_score, max_score, input.decision, priority, enabled]
  );
  return result.rows[0]!;
}

export async function updateRiskRule(id: string, input: UpdateRiskRuleInput): Promise<RiskRuleRecord | null> {
  const existing = await getRiskRuleById(id);
  if (!existing) return null;
  const min_score = input.min_score !== undefined ? Math.max(0, Math.min(100, input.min_score)) : existing.min_score;
  const max_score = input.max_score !== undefined ? Math.max(0, Math.min(100, input.max_score)) : existing.max_score;
  if (min_score > max_score) throw new Error('min_score must be <= max_score');
  const decision = input.decision ?? existing.decision;
  const priority = input.priority !== undefined ? input.priority : existing.priority;
  const enabled = input.enabled !== undefined ? input.enabled : existing.enabled;
  const result = await db.query<RiskRuleRecord>(
    `UPDATE security_risk_rules SET min_score = $2, max_score = $3, decision = $4, priority = $5, enabled = $6 WHERE id = $1
     RETURNING id, scope, min_score, max_score, decision, priority, enabled, created_at`,
    [id, min_score, max_score, decision, priority, enabled]
  );
  return result.rows[0] ?? null;
}

export async function setRiskRuleEnabled(id: string, enabled: boolean): Promise<RiskRuleRecord | null> {
  const result = await db.query<RiskRuleRecord>(
    `UPDATE security_risk_rules SET enabled = $2 WHERE id = $1 RETURNING id, scope, min_score, max_score, decision, priority, enabled, created_at`,
    [id, enabled]
  );
  return result.rows[0] ?? null;
}

export async function deleteRiskRule(id: string): Promise<boolean> {
  const result = await db.query(`DELETE FROM security_risk_rules WHERE id = $1`, [id]);
  return (result.rowCount ?? 0) > 0;
}
