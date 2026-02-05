/**
 * Debug routes (e.g. balance verification). GET /api/v1/debug/user-balance/:email
 * Returns user_balances rows, computed total, and warning if balances table still has rows.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../lib/database.js';
import { logger } from '../lib/logger.js';

export default async function debugRoutes(app: FastifyInstance) {
  // GET /api/v1/debug/user-balance/:email — same contract as wallet balance-debug (email = path param)
  app.get<{ Params: { email: string } }>('/user-balance/:email', {
    preHandler: [app.authenticate],
  }, async (request: FastifyRequest<{ Params: { email: string } }>, reply: FastifyReply) => {
    try {
      const currentUserId = request.user!.id;
      const email = request.params.email;
      if (!email || !email.trim()) {
        return reply.status(400).send({ success: false, error: { code: 'BAD_REQUEST', message: 'Email is required' } });
      }
      const u = await db.query<{ id: string; email: string }>(
        `SELECT id, email FROM users WHERE LOWER(TRIM(email)) = LOWER(TRIM($1)) AND deleted_at IS NULL LIMIT 1`,
        [email.trim()]
      );
      if (u.rows.length === 0) {
        return reply.status(404).send({ success: false, error: { code: 'USER_NOT_FOUND', message: 'User not found for this email' } });
      }
      const userId = u.rows[0]!.id;
      if (userId !== currentUserId) {
        return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'You can only debug your own balance' } });
      }

      const ubRows = await db.query<{
        user_id: string;
        currency_id: string;
        account_type: string;
        available_balance: string;
        locked_balance: string;
        pending_balance: string;
        total_deposited: string;
        updated_at: string;
      }>(`SELECT user_id, currency_id, account_type::text as account_type, available_balance::text, locked_balance::text, pending_balance::text, total_deposited::text, updated_at::text FROM user_balances WHERE user_id = $1`, [userId]);

      const fundingSum = await db.query<{ total: string }>(`
        SELECT COALESCE(SUM(COALESCE(ub.available_balance, 0) + COALESCE(ub.locked_balance, 0)), 0)::text as total
        FROM user_balances ub
        WHERE ub.user_id = $1 AND COALESCE(ub.account_type::text, 'funding') IN ('funding', 'spot')
      `, [userId]);
      const tradingSum = await db.query<{ total: string }>(`
        SELECT COALESCE(SUM(COALESCE(ub.available_balance, 0) + COALESCE(ub.locked_balance, 0)), 0)::text as total
        FROM user_balances ub
        WHERE ub.user_id = $1 AND COALESCE(ub.account_type::text, 'funding') IN ('trading', 'unified')
      `, [userId]);

      const fundingTotal = parseFloat(fundingSum.rows[0]?.total || '0');
      const tradingTotal = parseFloat(tradingSum.rows[0]?.total || '0');
      const reason_if_zero = ubRows.rows.length === 0
        ? 'BUG: ZERO rows in user_balances for this user — deposit credit or ensureUserBalanceRow did not create row.'
        : fundingTotal === 0 && tradingTotal === 0
          ? 'Rows exist but SUM(available_balance + locked_balance) is 0 for funding and trading. Check account_type matches (canonical: funding).'
          : null;

      // Runtime must never read from deprecated balances table. user_balances is the only source of truth.
      const balances_table_warning = 'user_balances is the only source of truth; legacy balances table must not be used.';

      return reply.send({
        success: true,
        data: {
          user_id: userId,
          user_balances_rows: ubRows.rows,
          user_balances_row_count: ubRows.rows.length,
          dashboard_summary: {
            funding_total: fundingTotal,
            trading_total: tradingTotal,
            total: fundingTotal + tradingTotal,
          },
          reason_if_zero: reason_if_zero ?? 'Balance data present; dashboard should show non-zero.',
          balances_table_warning,
        },
      });
    } catch (e) {
      logger.error('Debug user-balance failed', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Balance debug failed' } });
    }
  });
}
