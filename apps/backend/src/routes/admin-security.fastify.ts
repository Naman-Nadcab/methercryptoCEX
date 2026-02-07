/**
 * Admin Security API (Step S1–S5). Dashboard, Risk rules, IP rules, Withdrawal review, Sessions/Devices/Audit (read-only).
 * Admin JWT required.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../lib/database.js';
import { logger } from '../lib/logger.js';
import { getAdminFromRequest, getAdminForWithdrawalApproval } from './admin.fastify.js';
import {
  listRiskRules,
  getRiskRuleById,
  createRiskRule,
  updateRiskRule,
  setRiskRuleEnabled,
  deleteRiskRule,
  type CreateRiskRuleInput,
  type UpdateRiskRuleInput,
  type RiskScope,
  type RiskDecision,
} from '../services/risk-engine.service.js';
import {
  listRules,
  getRuleById,
  createRule,
  updateRule,
  setRuleEnabled,
  deleteRule,
  type CreateIpRuleInput,
  type UpdateIpRuleInput,
  type IpRuleScope,
  type IpRuleType,
} from '../services/ip-rules.service.js';
import { isAddressAllowed } from '../services/withdrawal-whitelist.service.js';
import { hasActiveCooldown } from '../services/security-cooldown.service.js';
import {
  approveWithdrawal,
  rejectWithdrawal,
  WithdrawalApprovalError,
  WithdrawalApprovalErrors,
} from '../services/withdrawal-approval.service.js';

const VALID_DECISIONS: RiskDecision[] = ['allow', 'challenge', 'block'];
const VALID_SCOPES: RiskScope[] = ['login', 'withdrawal', 'p2p', 'api', 'admin'];
const IP_SCOPES: IpRuleScope[] = ['admin', 'user'];
const IP_RULE_TYPES: IpRuleType[] = ['whitelist', 'blacklist'];

const INTERVAL_24H = `NOW() - INTERVAL '24 hours'`;

export default async function adminSecurityRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /admin/security/dashboard
   * Returns aggregated security metrics (last 24 hours unless stated).
   */
  app.get('/security/dashboard', async (request: FastifyRequest, reply: FastifyReply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;

    try {
      const [
        riskBlock,
        riskChallenge,
        accessBlocked,
        vpnTorDetections,
        withdrawalsBlocked,
        withdrawalsPendingApproval,
        usersLocked,
        loginFailed24h,
        newDevice24h,
      ] = await Promise.all([
        db.query<{ count: string }>(
          `SELECT COUNT(*) AS count FROM security_risk_events WHERE decision = 'block' AND created_at > ${INTERVAL_24H}`
        ),
        db.query<{ count: string }>(
          `SELECT COUNT(*) AS count FROM security_risk_events WHERE decision = 'challenge' AND created_at > ${INTERVAL_24H}`
        ),
        db.query<{ count: string }>(
          `SELECT COUNT(*) AS count FROM user_activity_logs WHERE activity_type = 'access_blocked' AND created_at > ${INTERVAL_24H}`
        ),
        db.query<{ count: string }>(
          `SELECT COUNT(*) AS count FROM audit_logs_immutable WHERE action ILIKE '%vpn%' AND created_at > ${INTERVAL_24H}`
        ),
        db.query<{ count: string }>(
          `SELECT COUNT(*) AS count FROM withdrawals WHERE status = 'blocked'`
        ),
        db.query<{ count: string }>(
          `SELECT COUNT(*) AS count FROM withdrawals WHERE status = 'pending_approval'`
        ),
        db.query<{ count: string }>(
          `SELECT COUNT(*) AS count FROM users WHERE locked_until > NOW() AND deleted_at IS NULL`
        ),
        db.query<{ count: string }>(
          `SELECT COUNT(*) AS count FROM user_activity_logs WHERE activity_type = 'login_failed' AND created_at > ${INTERVAL_24H}`
        ),
        db.query<{ count: string }>(
          `SELECT COUNT(*) AS count FROM user_activity_logs WHERE activity_type = 'new_device_verified' AND created_at > ${INTERVAL_24H}`
        ),
      ]);

      const data = {
        risk: {
          blocksLast24h: parseInt(riskBlock.rows[0]?.count ?? '0', 10),
          challengesLast24h: parseInt(riskChallenge.rows[0]?.count ?? '0', 10),
        },
        access: {
          accessBlockedLast24h: parseInt(accessBlocked.rows[0]?.count ?? '0', 10),
          vpnTorDetectionsLast24h: parseInt(vpnTorDetections.rows[0]?.count ?? '0', 10),
        },
        withdrawals: {
          blockedBySecurity: parseInt(withdrawalsBlocked.rows[0]?.count ?? '0', 10),
          pendingAdminApproval: parseInt(withdrawalsPendingApproval.rows[0]?.count ?? '0', 10),
        },
        accounts: {
          usersCurrentlyLocked: parseInt(usersLocked.rows[0]?.count ?? '0', 10),
          loginFailedLast24h: parseInt(loginFailed24h.rows[0]?.count ?? '0', 10),
          newDeviceLoginsLast24h: parseInt(newDevice24h.rows[0]?.count ?? '0', 10),
        },
      };

      return reply.send({ success: true, data });
    } catch (error) {
      logger.error('Security dashboard error', {
        error: error instanceof Error ? error.message : 'Unknown',
      });
      return reply.status(500).send({
        success: false,
        error: {
          code: 'DASHBOARD_ERROR',
          message: 'Failed to load security dashboard data',
        },
      });
    }
  });

  // -------------------------------------------------------------------------
  // Risk Engine rules (Step S2)
  // -------------------------------------------------------------------------

  app.get<{
    Querystring: { scope?: string; enabled?: string; limit?: string; offset?: string };
  }>('/security/risk-rules', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const q = request.query;
      const scope = q.scope && VALID_SCOPES.includes(q.scope as RiskScope) ? (q.scope as RiskScope) : undefined;
      const enabled = q.enabled === 'true' ? true : q.enabled === 'false' ? false : undefined;
      const limit = Math.min(100, Math.max(1, parseInt(String(q.limit), 10) || 50));
      const offset = Math.max(0, parseInt(String(q.offset), 10) || 0);
      const { rules, total } = await listRiskRules({ scope, enabled, limit, offset });
      return reply.send({ success: true, data: { rules, total } });
    } catch (error) {
      logger.error('List risk rules error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'LIST_FAILED', message: 'Failed to list risk rules' },
      });
    }
  });

  app.get<{ Params: { id: string } }>('/security/risk-rules/:id', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    const rule = await getRiskRuleById(request.params.id);
    if (!rule) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Risk rule not found' },
      });
    }
    return reply.send({ success: true, data: rule });
  });

  app.post<{ Body: CreateRiskRuleInput }>('/security/risk-rules', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    const body = request.body ?? {};
    if (!body.scope || !VALID_SCOPES.includes(body.scope as RiskScope)) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'scope is required and must be one of: login, withdrawal, p2p, api, admin' },
      });
    }
    if (!body.decision || !VALID_DECISIONS.includes(body.decision as RiskDecision)) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'decision is required and must be one of: allow, challenge, block' },
      });
    }
    try {
      const rule = await createRiskRule(body as CreateRiskRuleInput);
      return reply.status(201).send({ success: true, data: rule });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to create rule';
      if (msg.includes('min_score')) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_INPUT', message: msg },
        });
      }
      logger.error('Create risk rule error', { error: msg });
      return reply.status(500).send({
        success: false,
        error: { code: 'CREATE_FAILED', message: msg },
      });
    }
  });

  app.patch<{ Params: { id: string }; Body: UpdateRiskRuleInput }>('/security/risk-rules/:id', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    const body = request.body ?? {};
    if (body.decision != null && !VALID_DECISIONS.includes(body.decision as RiskDecision)) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'decision must be one of: allow, challenge, block' },
      });
    }
    try {
      const rule = await updateRiskRule(request.params.id, body);
      if (!rule) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Risk rule not found' },
        });
      }
      return reply.send({ success: true, data: rule });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to update rule';
      if (msg.includes('min_score')) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_INPUT', message: msg },
        });
      }
      logger.error('Update risk rule error', { error: msg });
      return reply.status(500).send({
        success: false,
        error: { code: 'UPDATE_FAILED', message: msg },
      });
    }
  });

  app.patch<{ Params: { id: string } }>('/security/risk-rules/:id/enable', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    const rule = await setRiskRuleEnabled(request.params.id, true);
    if (!rule) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Risk rule not found' },
      });
    }
    return reply.send({ success: true, data: rule });
  });

  app.patch<{ Params: { id: string } }>('/security/risk-rules/:id/disable', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    const rule = await setRiskRuleEnabled(request.params.id, false);
    if (!rule) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Risk rule not found' },
      });
    }
    return reply.send({ success: true, data: rule });
  });

  app.delete<{ Params: { id: string } }>('/security/risk-rules/:id', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    const deleted = await deleteRiskRule(request.params.id);
    if (!deleted) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Risk rule not found' },
      });
    }
    return reply.send({ success: true, data: { deleted: true } });
  });

  // -------------------------------------------------------------------------
  // IP Rules (Step S3)
  // -------------------------------------------------------------------------

  app.get<{
    Querystring: { scope?: string; rule_type?: string; enabled?: string; limit?: string; offset?: string };
  }>('/security/ip-rules', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const q = request.query;
      const scope = q.scope && IP_SCOPES.includes(q.scope as IpRuleScope) ? (q.scope as IpRuleScope) : undefined;
      const rule_type = q.rule_type && IP_RULE_TYPES.includes(q.rule_type as IpRuleType) ? (q.rule_type as IpRuleType) : undefined;
      const enabled = q.enabled === 'true' ? true : q.enabled === 'false' ? false : undefined;
      const limit = Math.min(100, Math.max(1, parseInt(String(q.limit), 10) || 50));
      const offset = Math.max(0, parseInt(String(q.offset), 10) || 0);
      const { rules, total } = await listRules({ scope, rule_type, enabled, limit, offset });
      return reply.send({ success: true, data: { rules, total } });
    } catch (error) {
      logger.error('List IP rules error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'LIST_FAILED', message: 'Failed to list IP rules' },
      });
    }
  });

  app.get<{ Params: { id: string } }>('/security/ip-rules/:id', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    const rule = await getRuleById(request.params.id);
    if (!rule) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'IP rule not found' },
      });
    }
    return reply.send({ success: true, data: rule });
  });

  app.post<{ Body: CreateIpRuleInput }>('/security/ip-rules', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    const body = request.body ?? {};
    if (!body.scope || !IP_SCOPES.includes(body.scope as IpRuleScope)) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'scope is required and must be admin or user' },
      });
    }
    if (!body.rule_type || !IP_RULE_TYPES.includes(body.rule_type as IpRuleType)) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'rule_type is required and must be whitelist or blacklist' },
      });
    }
    if (!body.ip_cidr && !body.country_code) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'At least one of ip_cidr or country_code is required' },
      });
    }
    try {
      const rule = await createRule(body as CreateIpRuleInput);
      return reply.status(201).send({ success: true, data: rule });
    } catch (error) {
      logger.error('Create IP rule error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'CREATE_FAILED', message: error instanceof Error ? error.message : 'Failed to create IP rule' },
      });
    }
  });

  app.patch<{ Params: { id: string }; Body: { ip_cidr?: string | null; country_code?: string | null; enabled?: boolean } }>('/security/ip-rules/:id', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    const body = request.body ?? {};
    try {
      const rule = await updateRule(request.params.id, body as UpdateIpRuleInput);
      if (!rule) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'IP rule not found' },
        });
      }
      return reply.send({ success: true, data: rule });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown';
      if (msg.includes('ip_cidr') || msg.includes('country_code')) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_INPUT', message: msg },
        });
      }
      logger.error('Update IP rule error', { error: msg });
      return reply.status(500).send({
        success: false,
        error: { code: 'UPDATE_FAILED', message: msg },
      });
    }
  });

  app.patch<{ Params: { id: string } }>('/security/ip-rules/:id/enable', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    const rule = await setRuleEnabled(request.params.id, true);
    if (!rule) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'IP rule not found' },
      });
    }
    return reply.send({ success: true, data: rule });
  });

  app.patch<{ Params: { id: string } }>('/security/ip-rules/:id/disable', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    const rule = await setRuleEnabled(request.params.id, false);
    if (!rule) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'IP rule not found' },
      });
    }
    return reply.send({ success: true, data: rule });
  });

  app.delete<{ Params: { id: string } }>('/security/ip-rules/:id', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    const deleted = await deleteRule(request.params.id);
    if (!deleted) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'IP rule not found' },
      });
    }
    return reply.send({ success: true, data: { deleted: true } });
  });

  // -------------------------------------------------------------------------
  // Withdrawal security review & approval (Step S4)
  // -------------------------------------------------------------------------

  app.get<{
    Querystring: { asset?: string; userId?: string; limit?: string; offset?: string };
  }>('/security/withdrawals/pending', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const q = request.query;
      const conditions: string[] = ["w.status = 'pending_approval'"];
      const params: unknown[] = [];
      let i = 1;
      if (q.asset?.trim()) {
        conditions.push(`t.symbol = $${i++}`);
        params.push(q.asset.trim().toUpperCase());
      }
      if (q.userId?.trim()) {
        conditions.push(`w.user_id = $${i++}`);
        params.push(q.userId.trim());
      }
      const where = conditions.join(' AND ');
      const limit = Math.min(100, Math.max(1, parseInt(String(q.limit), 10) || 50));
      const offset = Math.max(0, parseInt(String(q.offset), 10) || 0);
      params.push(limit, offset);

      const countResult = await db.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM withdrawals w
         LEFT JOIN tokens t ON w.token_id = t.id
         WHERE ${where}`,
        params.slice(0, params.length - 2)
      );
      const total = parseInt(countResult.rows[0]?.count ?? '0', 10);

      const listResult = await db.query<{
        id: string;
        user_id: string;
        token_id: string | null;
        chain_id: string | null;
        amount: string;
        to_address: string | null;
        status: string;
        created_at: string;
        symbol: string | null;
      }>(
        `SELECT w.id, w.user_id, w.token_id, w.chain_id, w.amount, w.to_address, w.status, w.created_at, t.symbol
         FROM withdrawals w
         LEFT JOIN tokens t ON w.token_id = t.id
         WHERE ${where}
         ORDER BY w.created_at ASC
         LIMIT $${i} OFFSET $${i + 1}`,
        params
      );

      const withdrawals = listResult.rows.map((row) => ({
        id: row.id,
        user_id: row.user_id,
        asset: row.symbol ?? null,
        amount: row.amount,
        to_address: row.to_address,
        status: row.status,
        created_at: row.created_at,
      }));
      return reply.send({ success: true, data: { withdrawals, total } });
    } catch (error) {
      logger.error('List pending withdrawals error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'LIST_FAILED', message: 'Failed to list pending withdrawals' },
      });
    }
  });

  app.get<{ Params: { id: string } }>('/security/withdrawals/:id', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const row = await db.query<{
        id: string;
        user_id: string;
        token_id: string | null;
        chain_id: string | null;
        amount: string;
        to_address: string | null;
        status: string;
        created_at: string;
        symbol: string | null;
      }>(
        `SELECT w.id, w.user_id, w.token_id, w.chain_id, w.amount, w.to_address, w.status, w.created_at, t.symbol
         FROM withdrawals w
         LEFT JOIN tokens t ON w.token_id = t.id
         WHERE w.id = $1`,
        [request.params.id]
      );
      if (row.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Withdrawal not found' },
        });
      }
      const w = row.rows[0]!;
      const asset = w.symbol ?? null;
      const toAddress = w.to_address?.trim() || null;

      let whitelistStatus: 'allowed' | 'timelocked' | 'not_whitelisted' | null = null;
      if (asset && toAddress) {
        try {
          const check = await isAddressAllowed({
            userId: w.user_id,
            asset,
            address: toAddress,
          });
          whitelistStatus = check.allowed ? 'allowed' : (check.unlockAt ? 'timelocked' : 'not_whitelisted');
        } catch {
          whitelistStatus = 'not_whitelisted';
        }
      }

      let cooldown: { active: true; until: string; reason: string } | null = null;
      try {
        const cd = await hasActiveCooldown({ userId: w.user_id });
        if (cd.active && cd.until) {
          cooldown = { active: true, until: cd.until.toISOString(), reason: cd.reason ?? '' };
        }
      } catch {
        // ignore
      }

      let latestRiskDecision: { decision: string; score: number; created_at: string } | null = null;
      try {
        const riskRow = await db.query<{ decision: string; score: number; created_at: string }>(
          `SELECT decision, score, created_at
           FROM security_risk_events
           WHERE scope = 'withdrawal' AND actor_id = $1
           ORDER BY created_at DESC LIMIT 1`,
          [w.user_id]
        );
        if (riskRow.rows.length > 0) {
          const r = riskRow.rows[0]!;
          latestRiskDecision = {
            decision: r.decision,
            score: r.score,
            created_at: typeof r.created_at === 'string' ? r.created_at : (r.created_at as Date).toISOString(),
          };
        }
      } catch {
        // ignore
      }

      return reply.send({
        success: true,
        data: {
          user_id: w.user_id,
          asset,
          amount: w.amount,
          to_address: toAddress,
          status: w.status,
          created_at: w.created_at,
          whitelist_status: whitelistStatus,
          cooldown,
          latest_risk_decision: latestRiskDecision,
        },
      });
    } catch (error) {
      logger.error('Get withdrawal error', { id: request.params.id, error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to fetch withdrawal' },
      });
    }
  });

  app.post<{ Params: { id: string }; Body: { note?: string } }>('/security/withdrawals/:id/approve', async (request, reply) => {
    const admin = await getAdminForWithdrawalApproval(app, request, reply);
    if (!admin) return;
    const withdrawalId = request.params.id;
    if (!withdrawalId) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Withdrawal id is required' },
      });
    }
    try {
      await approveWithdrawal(withdrawalId, admin.adminId, {
        ip: request.ip ?? undefined,
        userAgent: request.headers['user-agent'] ?? undefined,
      });
      return reply.send({ success: true, data: { approved: true, withdrawalId } });
    } catch (error: unknown) {
      const err = error instanceof WithdrawalApprovalError ? error : undefined;
      const code = err?.code;
      if (code === WithdrawalApprovalErrors.WITHDRAWAL_NOT_FOUND) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: err?.message ?? 'Withdrawal not found' },
        });
      }
      if (code === WithdrawalApprovalErrors.NOT_PENDING_APPROVAL) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_STATE', message: err?.message ?? 'Withdrawal is not pending approval' },
        });
      }
      if (code === WithdrawalApprovalErrors.HOT_WALLET_CAP_EXCEEDED) {
        return reply.status(400).send({
          success: false,
          error: { code: 'HOT_WALLET_CAP_EXCEEDED', message: err?.message ?? 'Hot wallet limit exceeded' },
        });
      }
      logger.error('Approve withdrawal error', { withdrawalId, error: error instanceof Error ? error.message : error });
      return reply.status(500).send({
        success: false,
        error: { code: 'APPROVE_FAILED', message: 'Failed to approve withdrawal' },
      });
    }
  });

  // -------------------------------------------------------------------------
  // Sessions, Devices, Audit logs — read-only (Step S5)
  // -------------------------------------------------------------------------

  app.get<{
    Querystring: { userId?: string; active?: string; limit?: string; offset?: string };
  }>('/security/sessions', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const q = request.query;
      const conditions: string[] = ['1=1'];
      const params: unknown[] = [];
      let i = 1;
      if (q.userId?.trim()) {
        conditions.push(`user_id = $${i++}`);
        params.push(q.userId.trim());
      }
      if (q.active === 'true' || q.active === 'false') {
        conditions.push(`is_active = $${i++}`);
        params.push(q.active === 'true');
      }
      const where = conditions.join(' AND ');
      const limit = Math.min(100, Math.max(1, parseInt(String(q.limit), 10) || 50));
      const offset = Math.max(0, parseInt(String(q.offset), 10) || 0);
      params.push(limit, offset);

      const countResult = await db.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM user_sessions WHERE ${where}`,
        params.slice(0, params.length - 2)
      );
      const total = parseInt(countResult.rows[0]?.count ?? '0', 10);

      const listResult = await db.query<{
        id: string;
        user_id: string;
        device_type: string | null;
        ip_address: string | null;
        user_agent: string | null;
        is_active: boolean;
        created_at: string;
        expires_at: string;
        revoked_at: string | null;
        device_id: string | null;
      }>(
        `SELECT id, user_id, device_type, ip_address, user_agent, is_active, created_at, expires_at, revoked_at, device_id
         FROM user_sessions WHERE ${where}
         ORDER BY created_at DESC
         LIMIT $${i} OFFSET $${i + 1}`,
        params
      );
      return reply.send({ success: true, data: { sessions: listResult.rows, total } });
    } catch (error) {
      logger.error('List sessions error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'LIST_FAILED', message: 'Failed to list sessions' },
      });
    }
  });

  app.get<{
    Querystring: { userId?: string; limit?: string; offset?: string };
  }>('/security/devices', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const q = request.query;
      const conditions: string[] = ['1=1'];
      const params: unknown[] = [];
      let i = 1;
      if (q.userId?.trim()) {
        conditions.push(`user_id = $${i++}`);
        params.push(q.userId.trim());
      }
      const where = conditions.join(' AND ');
      const limit = Math.min(100, Math.max(1, parseInt(String(q.limit), 10) || 50));
      const offset = Math.max(0, parseInt(String(q.offset), 10) || 0);
      params.push(limit, offset);

      const countResult = await db.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM user_devices WHERE ${where}`,
        params.slice(0, params.length - 2)
      );
      const total = parseInt(countResult.rows[0]?.count ?? '0', 10);

      const listResult = await db.query<{
        id: string;
        user_id: string;
        device_fingerprint: string;
        device_name: string | null;
        device_type: string | null;
        is_trusted: boolean | null;
        first_seen_at: string | null;
        last_seen_at: string | null;
        ip_address: string | null;
        location_country: string | null;
      }>(
        `SELECT id, user_id, device_fingerprint, device_name, device_type, is_trusted, first_seen_at, last_seen_at, ip_address, location_country
         FROM user_devices WHERE ${where}
         ORDER BY last_seen_at DESC NULLS LAST
         LIMIT $${i} OFFSET $${i + 1}`,
        params
      );
      return reply.send({ success: true, data: { devices: listResult.rows, total } });
    } catch (error) {
      logger.error('List devices error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'LIST_FAILED', message: 'Failed to list devices' },
      });
    }
  });

  app.get<{
    Querystring: { actorType?: string; actorId?: string; action?: string; resourceType?: string; limit?: string; offset?: string };
  }>('/security/audit-logs', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    const validActorTypes = ['user', 'admin', 'system'];
    const q = request.query;
    if (q.actorType != null && q.actorType !== '' && !validActorTypes.includes(q.actorType)) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'actorType must be one of: user, admin, system' },
      });
    }
    try {
      const conditions: string[] = ['1=1'];
      const params: unknown[] = [];
      let i = 1;
      if (q.actorType && validActorTypes.includes(q.actorType)) {
        conditions.push(`actor_type = $${i++}`);
        params.push(q.actorType);
      }
      if (q.actorId?.trim()) {
        conditions.push(`actor_id = $${i++}`);
        params.push(q.actorId.trim());
      }
      if (q.action?.trim()) {
        conditions.push(`action = $${i++}`);
        params.push(q.action.trim());
      }
      if (q.resourceType?.trim()) {
        conditions.push(`resource_type = $${i++}`);
        params.push(q.resourceType.trim());
      }
      const where = conditions.join(' AND ');
      const limit = Math.min(100, Math.max(1, parseInt(String(q.limit), 10) || 50));
      const offset = Math.max(0, parseInt(String(q.offset), 10) || 0);
      params.push(limit, offset);

      const countResult = await db.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM audit_logs_immutable WHERE ${where}`,
        params.slice(0, params.length - 2)
      );
      const total = parseInt(countResult.rows[0]?.count ?? '0', 10);

      const listResult = await db.query<{
        id: string;
        request_id: string | null;
        actor_type: string;
        actor_id: string | null;
        action: string;
        resource_type: string | null;
        resource_id: string | null;
        old_value: string | null;
        new_value: string | null;
        ip_address: string | null;
        user_agent: string | null;
        created_at: string;
      }>(
        `SELECT id, request_id, actor_type, actor_id, action, resource_type, resource_id, old_value, new_value, ip_address, user_agent, created_at
         FROM audit_logs_immutable WHERE ${where}
         ORDER BY created_at DESC
         LIMIT $${i} OFFSET $${i + 1}`,
        params
      );
      return reply.send({ success: true, data: { audit_logs: listResult.rows, total } });
    } catch (error) {
      logger.error('List audit logs error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'LIST_FAILED', message: 'Failed to list audit logs' },
      });
    }
  });

  app.post<{ Params: { id: string }; Body: { reason: string } }>('/security/withdrawals/:id/reject', async (request, reply) => {
    const admin = await getAdminForWithdrawalApproval(app, request, reply);
    if (!admin) return;
    const withdrawalId = request.params.id;
    const reason = (request.body?.reason ?? '').trim();
    if (!reason) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'reason is required' },
      });
    }
    try {
      await rejectWithdrawal(withdrawalId, admin.adminId, reason, {
        ip: request.ip ?? undefined,
        userAgent: request.headers['user-agent'] ?? undefined,
      });
      return reply.send({ success: true, data: { rejected: true, withdrawalId } });
    } catch (error: unknown) {
      const err = error instanceof WithdrawalApprovalError ? error : undefined;
      const code = err?.code;
      if (code === WithdrawalApprovalErrors.WITHDRAWAL_NOT_FOUND) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: err?.message ?? 'Withdrawal not found' },
        });
      }
      if (code === WithdrawalApprovalErrors.NOT_PENDING_APPROVAL) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_STATE', message: err?.message ?? 'Withdrawal is not pending approval' },
        });
      }
      logger.error('Reject withdrawal error', { withdrawalId, error: error instanceof Error ? error.message : error });
      return reply.status(500).send({
        success: false,
        error: { code: 'REJECT_FAILED', message: 'Failed to reject withdrawal' },
      });
    }
  });
}

/*
  SQL queries (last 24h = created_at > NOW() - INTERVAL '24 hours'):

  Risk:
  - SELECT COUNT(*) AS count FROM security_risk_events WHERE decision = 'block' AND created_at > NOW() - INTERVAL '24 hours';
  - SELECT COUNT(*) AS count FROM security_risk_events WHERE decision = 'challenge' AND created_at > NOW() - INTERVAL '24 hours';

  IP / Access:
  - SELECT COUNT(*) AS count FROM user_activity_logs WHERE activity_type = 'access_blocked' AND created_at > NOW() - INTERVAL '24 hours';
  - SELECT COUNT(*) AS count FROM audit_logs_immutable WHERE action ILIKE '%vpn%' AND created_at > NOW() - INTERVAL '24 hours';

  Withdrawals (no time filter; current state):
  - SELECT COUNT(*) AS count FROM withdrawals WHERE status = 'blocked';
  - SELECT COUNT(*) AS count FROM withdrawals WHERE status = 'pending_approval';

  Accounts:
  - SELECT COUNT(*) AS count FROM users WHERE locked_until > NOW() AND deleted_at IS NULL;
  - SELECT COUNT(*) AS count FROM user_activity_logs WHERE activity_type = 'login_failed' AND created_at > NOW() - INTERVAL '24 hours';
  - SELECT COUNT(*) AS count FROM user_activity_logs WHERE activity_type = 'new_device_verified' AND created_at > NOW() - INTERVAL '24 hours';

  Example response JSON:

  {
    "success": true,
    "data": {
      "risk": {
        "blocksLast24h": 5,
        "challengesLast24h": 12
      },
      "access": {
        "accessBlockedLast24h": 3,
        "vpnTorDetectionsLast24h": 2
      },
      "withdrawals": {
        "blockedBySecurity": 0,
        "pendingAdminApproval": 4
      },
      "accounts": {
        "usersCurrentlyLocked": 1,
        "loginFailedLast24h": 28,
        "newDeviceLoginsLast24h": 6
      }
    }
  }

  --- Step S2: Risk rules API examples ---

  GET /api/v1/admin/security/risk-rules?scope=withdrawal&enabled=true&limit=20&offset=0
  Response: { "success": true, "data": { "rules": [...], "total": N } }

  GET /api/v1/admin/security/risk-rules/:id
  Response: { "success": true, "data": { "id", "scope", "min_score", "max_score", "decision", "priority", "enabled", "created_at" } }

  POST /api/v1/admin/security/risk-rules
  Body: { "scope": "withdrawal", "min_score": 70, "max_score": 100, "decision": "block", "priority": 10, "enabled": true }
  Response: 201 { "success": true, "data": rule }

  PATCH /api/v1/admin/security/risk-rules/:id
  Body: { "min_score": 60, "decision": "challenge", "enabled": false }
  Response: { "success": true, "data": rule }

  PATCH .../enable, PATCH .../disable, DELETE .../:id → 404 if not found; 400 for invalid input.

  --- Step S3: IP rules API examples ---

  GET /api/v1/admin/security/ip-rules?scope=admin&rule_type=whitelist&enabled=true&limit=20&offset=0
  Response: { "success": true, "data": { "rules": [{ "id", "scope", "rule_type", "ip_cidr", "country_code", "enabled", "created_at" }], "total": N } }

  GET /api/v1/admin/security/ip-rules/:id
  Response: { "success": true, "data": rule }

  POST /api/v1/admin/security/ip-rules
  Body: { "scope": "admin", "rule_type": "whitelist", "ip_cidr": "192.168.1.0/24", "country_code": "IN", "enabled": true }
  Response: 201 { "success": true, "data": rule }

  PATCH /api/v1/admin/security/ip-rules/:id
  Body: { "ip_cidr": "10.0.0.0/8", "enabled": false }
  Response: { "success": true, "data": rule }

  PATCH .../enable, PATCH .../disable, DELETE .../:id → 404 if not found; 400 if both ip_cidr and country_code cleared.

  --- Step S4: Withdrawal security review & approval ---

  GET /api/v1/admin/security/withdrawals/pending?asset=USDT&userId=uuid&limit=20&offset=0
  Response: { "success": true, "data": { "withdrawals": [{ "id", "user_id", "asset", "amount", "to_address", "status", "created_at" }], "total": N } }

  GET /api/v1/admin/security/withdrawals/:id
  Response: { "success": true, "data": { "user_id", "asset", "amount", "to_address", "status", "created_at", "whitelist_status", "cooldown", "latest_risk_decision" } }

  POST /api/v1/admin/security/withdrawals/:id/approve
  Body: { "note": "optional" }
  Response: { "success": true, "data": { "approved": true, "withdrawalId" } }

  POST /api/v1/admin/security/withdrawals/:id/reject
  Body: { "reason": "Required reason" }
  Response: { "success": true, "data": { "rejected": true, "withdrawalId" } }

  --- Step S5: Sessions, Devices, Audit logs (read-only) ---

  GET /api/v1/admin/security/sessions?userId=uuid&active=true&limit=20&offset=0
  Response: { "success": true, "data": { "sessions": [{ "id", "user_id", "device_type", "ip_address", "user_agent", "is_active", "created_at", "expires_at", "revoked_at", "device_id" }], "total": N } }

  GET /api/v1/admin/security/devices?userId=uuid&limit=20&offset=0
  Response: { "success": true, "data": { "devices": [{ "id", "user_id", "device_fingerprint", "device_name", "device_type", "is_trusted", "first_seen_at", "last_seen_at", "ip_address", "location_country" }], "total": N } }

  GET /api/v1/admin/security/audit-logs?actorType=admin&actorId=uuid&action=admin_login&limit=50&offset=0
  Response: { "success": true, "data": { "audit_logs": [{ "id", "request_id", "actor_type", "actor_id", "action", "resource_type", "resource_id", "old_value", "new_value", "ip_address", "user_agent", "created_at" }], "total": N } }
*/
