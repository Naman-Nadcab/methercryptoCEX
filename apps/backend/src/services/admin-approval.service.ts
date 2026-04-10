import { db } from '../lib/database.js';
import { logger } from '../lib/logger.js';
import { config } from '../config/index.js';

export type ApprovalActionType =
  | 'withdrawal_approve'
  | 'manual_credit'
  | 'trading_halt'
  | 'settlement_circuit_reset'
  | 'system_config_change'
  | 'admin_role_change';

const DEFAULT_APPROVAL_THRESHOLDS: Record<string, number> = {
  withdrawal_approve: 2,
  manual_credit: 2,
  trading_halt: 2,
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
  requester_name?: string;
  requester_email?: string;
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

    return { requests: dataResult.rows, total };
  }

  async approveRequest(
    requestId: string,
    adminId: string
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
      (row.action_type === 'withdrawal_approve' || row.action_type === 'manual_credit')
    ) {
      try {
        const { executeMakerCheckerIfFullyApproved } = await import('./maker-checker-execute.service.js');
        await executeMakerCheckerIfFullyApproved(row);
      } catch (e) {
        logger.error('maker-checker execution failed', {
          requestId: row.id,
          error: e instanceof Error ? e.message : String(e),
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
}

export const adminApprovalService = new AdminApprovalService();
