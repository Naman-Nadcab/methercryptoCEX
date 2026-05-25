import { db } from '../lib/database.js';
import { logger } from '../lib/logger.js';
import { config } from '../config/index.js';

export type ApprovalActionType =
  | 'withdrawal_approve'
  | 'manual_credit'
  | 'trading_halt'
  | 'global_control_action'
  | 'settlement_circuit_reset'
  | 'system_config_change'
  | 'admin_role_change';

const DEFAULT_APPROVAL_THRESHOLDS: Record<string, number> = {
  withdrawal_approve: 2,
  manual_credit: 2,
  trading_halt: 2,
  global_control_action: 2,
  settlement_circuit_reset: 3,
  system_config_change: 2,
  admin_role_change: 2,
};

const DEFAULT_EXPIRY_HOURS = 24;

export interface ApprovalRequest {
  id: string;
  action_type: string;
  action_payload: Record<string, unknown>;
  requested_by: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  required_approvals: number;
  current_approvals: number;
  approved_by: string[] | null;
  rejected_by: string | null;
  rejection_reason: string | null;
  expires_at: string;
  executed_at: string | null;
  created_at: string;
  updated_at: string;
  maker_unlock_at?: string | null;
  action_executed?: boolean;
  execution_attempts?: number;
  last_execution_attempt_at?: string | null;
  execution_error?: string | null;
  execution_context?: Record<string, unknown> | null;
  requester_name?: string;
  requester_email?: string;
  approver_details?: Array<{ id: string; name: string; email: string; role: string }>;
}

export function effectiveRequiredApprovals(actionType: ApprovalActionType, custom?: number): number {
  if (custom != null) return custom;
  if (
    config.security.makerCheckerEnabled &&
    (actionType === 'withdrawal_approve' || actionType === 'manual_credit')
  ) {
    return config.security.makerCheckerRequiredApprovals;
  }
  return DEFAULT_APPROVAL_THRESHOLDS[actionType] ?? 2;
}

function makerUnlockAt(actionType: ApprovalActionType): Date | null {
  if (
    !config.security.makerCheckerEnabled ||
    (actionType !== 'withdrawal_approve' && actionType !== 'manual_credit')
  ) {
    return null;
  }
  return new Date(Date.now() + config.security.makerCheckerDelaySec * 1000);
}

class AdminApprovalService {
  private normalizeRole(role: string): string {
    const normalized = (role || '').trim().toLowerCase().replace(/\s+/g, '_');
    if (normalized === 'support_agent') return 'support';
    if (normalized === 'compliance_officer') return 'compliance';
    if (normalized === 'finance_admin') return 'finance_ops';
    return normalized;
  }

  async createRequest(
    actionType: ApprovalActionType,
    actionPayload: Record<string, unknown>,
    requestedBy: string,
    customThreshold?: number
  ): Promise<ApprovalRequest> {
    const requiredApprovals = effectiveRequiredApprovals(actionType, customThreshold);
    const expiresAt = new Date(Date.now() + DEFAULT_EXPIRY_HOURS * 60 * 60 * 1000);
    const unlock = makerUnlockAt(actionType);

    const result = await db.query<ApprovalRequest>(
      `INSERT INTO admin_approval_requests
         (action_type, action_payload, requested_by, required_approvals, expires_at, maker_unlock_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [actionType, JSON.stringify(actionPayload), requestedBy, requiredApprovals, expiresAt, unlock]
    );

    const request = result.rows[0]!;
    logger.info('Approval request created', {
      id: request.id,
      actionType,
      requestedBy,
      requiredApprovals,
      makerUnlockAt: unlock?.toISOString() ?? null,
    });
    return request;
  }

  async listRequests(
    status?: string,
    limit = 50,
    offset = 0
  ): Promise<{ requests: ApprovalRequest[]; total: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (status) {
      conditions.push(`r.status = $${idx++}`);
      params.push(status);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM admin_approval_requests r ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0]?.count ?? '0', 10);

    const dataResult = await db.query<ApprovalRequest>(
      `SELECT r.*, a.name AS requester_name, a.email AS requester_email
       FROM admin_approval_requests r
       LEFT JOIN admin_users a ON a.id = r.requested_by
       ${where}
       ORDER BY r.created_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, limit, offset]
    );

    const rows = dataResult.rows;
    const approverIds = Array.from(
      new Set(
        rows.flatMap((r) =>
          Array.isArray(r.approved_by) ? r.approved_by.filter((id): id is string => typeof id === 'string' && id.length > 0) : []
        )
      )
    );
    const approverMap = new Map<string, { id: string; name: string; email: string; role: string }>();
    if (approverIds.length > 0) {
      const approverRows = await db.query<{ id: string; name: string; email: string; role: string }>(
        `SELECT id::text, name, email, role
         FROM admin_users
         WHERE id = ANY($1::uuid[])`,
        [approverIds]
      );
      for (const row of approverRows.rows) {
        approverMap.set(row.id, row);
      }
    }
    const enriched = rows.map((r) => ({
      ...r,
      approver_details: Array.isArray(r.approved_by)
        ? r.approved_by
            .map((id) => approverMap.get(id))
            .filter((v): v is { id: string; name: string; email: string; role: string } => !!v)
        : [],
    }));

    return { requests: enriched, total };
  }

  async approveRequest(
    requestId: string,
    adminId: string,
    adminRole?: string
  ): Promise<{ success: boolean; message: string; request?: ApprovalRequest }> {
    const result = await db.query<ApprovalRequest>(
      'SELECT * FROM admin_approval_requests WHERE id = $1',
      [requestId]
    );
    const request = result.rows[0];

    if (!request) {
      return { success: false, message: 'Approval request not found' };
    }
    if (request.status !== 'pending') {
      return { success: false, message: `Request is already ${request.status}` };
    }
    if (new Date(request.expires_at) < new Date()) {
      await db.query(
        `UPDATE admin_approval_requests SET status = 'expired', updated_at = NOW() WHERE id = $1`,
        [requestId]
      );
      return { success: false, message: 'Request has expired' };
    }
    if (request.requested_by === adminId) {
      return { success: false, message: 'Cannot approve your own request' };
    }
    if (request.maker_unlock_at && new Date(request.maker_unlock_at) > new Date()) {
      return {
        success: false,
        message: `Maker-checker delay not elapsed; earliest approval at ${request.maker_unlock_at}`,
      };
    }
    const currentApprovers = request.approved_by ?? [];
    if (currentApprovers.includes(adminId)) {
      return { success: false, message: 'You have already approved this request' };
    }
    if (request.action_type === 'global_control_action') {
      const action = String((request.action_payload as { action?: string })?.action ?? '').trim();
      if (action) {
        const { getAdminApprovalPolicyByKey } = await import('./admin-approval-policy.service.js');
        const policy = await getAdminApprovalPolicyByKey(`global_action:${action}`);
        if (policy.require_distinct_role) {
          const [requesterRoleRes, approverRoleRes] = await Promise.all([
            db.query<{ role: string }>(`SELECT role FROM admin_users WHERE id = $1::uuid LIMIT 1`, [request.requested_by]),
            adminRole
              ? Promise.resolve({ rows: [{ role: adminRole }] })
              : db.query<{ role: string }>(`SELECT role FROM admin_users WHERE id = $1::uuid LIMIT 1`, [adminId]),
          ]);
          const requesterRole = String(requesterRoleRes.rows[0]?.role ?? '').trim().toLowerCase();
          const checkerRole = String(approverRoleRes.rows[0]?.role ?? '').trim().toLowerCase();
          if (requesterRole && checkerRole && requesterRole === checkerRole) {
            return { success: false, message: 'Checker role must be distinct from maker role for this action.' };
          }
        }
        if (policy.allowed_checker_roles.length > 0) {
          const approverRoleRes = adminRole
            ? { rows: [{ role: adminRole }] }
            : await db.query<{ role: string }>(`SELECT role FROM admin_users WHERE id = $1::uuid LIMIT 1`, [adminId]);
          const checkerRole = this.normalizeRole(String(approverRoleRes.rows[0]?.role ?? ''));
          const allowedSet = new Set(policy.allowed_checker_roles.map((r) => this.normalizeRole(r)));
          if (!checkerRole || !allowedSet.has(checkerRole)) {
            return {
              success: false,
              message: `Checker role '${checkerRole || 'unknown'}' is not allowed for this action.`,
            };
          }
        }
      }
    }

    const newApprovals = request.current_approvals + 1;
    const newApprovers = [...currentApprovers, adminId];
    const isFullyApproved = newApprovals >= request.required_approvals;

    const updated = await db.query<ApprovalRequest>(
      `UPDATE admin_approval_requests
       SET current_approvals = $1,
           approved_by = $2,
           status = $3,
           executed_at = $4,
           updated_at = NOW()
       WHERE id = $5
       RETURNING *`,
      [
        newApprovals,
        newApprovers,
        isFullyApproved ? 'approved' : 'pending',
        isFullyApproved ? new Date() : null,
        requestId,
      ]
    );

    const row = updated.rows[0]!;

    logger.info('Approval request updated', {
      requestId,
      adminId,
      newApprovals,
      required: request.required_approvals,
      fullyApproved: isFullyApproved,
    });

    if (
      !isFullyApproved &&
      row.action_type === 'withdrawal_approve' &&
      newApprovals >= 1
    ) {
      const withdrawalId = String((row.action_payload as { withdrawalId?: string })?.withdrawalId ?? '').trim();
      if (withdrawalId) {
        await db.query(
          `UPDATE withdrawals SET treasury_stage = 'maker_approved', updated_at = NOW()
           WHERE id = $1::uuid AND status = 'pending_approval'`,
          [withdrawalId]
        );
      }
    }

    if (
      isFullyApproved &&
      config.security.makerCheckerEnabled &&
      (row.action_type === 'withdrawal_approve' || row.action_type === 'manual_credit' || row.action_type === 'global_control_action')
    ) {
      try {
        await db.query(
          `UPDATE admin_approval_requests
           SET execution_attempts = COALESCE(execution_attempts, 0) + 1,
               last_execution_attempt_at = NOW(),
               execution_context = $2::jsonb,
               execution_error = NULL,
               updated_at = NOW()
           WHERE id = $1::uuid`,
          [row.id, JSON.stringify({ trigger: 'auto_on_approval' })]
        );
        const { executeMakerCheckerIfFullyApproved } = await import('./maker-checker-execute.service.js');
        await executeMakerCheckerIfFullyApproved(row);
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        await db.query(
          `UPDATE admin_approval_requests
           SET action_executed = FALSE,
               execution_error = LEFT($2, 1000),
               updated_at = NOW()
           WHERE id = $1::uuid`,
          [row.id, errMsg]
        );
        logger.error('maker-checker execution failed', {
          requestId: row.id,
          error: errMsg,
        });
      }
    }

    return {
      success: true,
      message: isFullyApproved
        ? 'Request fully approved and executed where applicable'
        : `Approved (${newApprovals}/${request.required_approvals})`,
      request: row,
    };
  }

  async rejectRequest(
    requestId: string,
    adminId: string,
    reason?: string
  ): Promise<{ success: boolean; message: string; request?: ApprovalRequest }> {
    const result = await db.query<ApprovalRequest>(
      'SELECT * FROM admin_approval_requests WHERE id = $1',
      [requestId]
    );
    const request = result.rows[0];

    if (!request) {
      return { success: false, message: 'Approval request not found' };
    }
    if (request.status !== 'pending') {
      return { success: false, message: `Request is already ${request.status}` };
    }

    const updated = await db.query<ApprovalRequest>(
      `UPDATE admin_approval_requests
       SET status = 'rejected',
           rejected_by = $1,
           rejection_reason = $2,
           updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [adminId, reason ?? null, requestId]
    );

    logger.info('Approval request rejected', { requestId, adminId, reason });
    return {
      success: true,
      message: 'Request rejected',
      request: updated.rows[0],
    };
  }

  async expireStalePending(): Promise<number> {
    const result = await db.query(
      `UPDATE admin_approval_requests
       SET status = 'expired', updated_at = NOW()
       WHERE status = 'pending' AND expires_at < NOW()`,
    );
    const count = result.rowCount ?? 0;
    if (count > 0) {
      logger.info('Expired stale approval requests', { count });
    }
    return count;
  }

  getDefaultThreshold(actionType: string): number {
    return effectiveRequiredApprovals(actionType as ApprovalActionType);
  }

  async markExecutionRetry(
    requestId: string,
    actorAdminId: string,
    reason: string,
    context?: Record<string, unknown>
  ): Promise<ApprovalRequest | null> {
    const res = await db.query<ApprovalRequest>(
      `UPDATE admin_approval_requests
       SET execution_attempts = COALESCE(execution_attempts, 0) + 1,
           last_execution_attempt_at = NOW(),
           execution_error = NULL,
           execution_context = $2::jsonb,
           updated_at = NOW()
       WHERE id = $1::uuid
       RETURNING *`,
      [requestId, JSON.stringify({ retry_reason: reason, actor_admin_id: actorAdminId, ...(context ?? {}) })]
    );
    return res.rows[0] ?? null;
  }
}

export const adminApprovalService = new AdminApprovalService();
