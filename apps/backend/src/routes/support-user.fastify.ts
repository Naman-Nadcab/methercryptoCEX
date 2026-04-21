/**
 * User-facing support ticket routes.
 *
 * Existing schema is admin-owned (see admin.fastify.ts /support/tickets). These routes
 * let a signed-in end user:
 *   - POST   /api/v1/support/tickets              → create a ticket (plus first message)
 *   - GET    /api/v1/support/tickets              → list own tickets
 *   - GET    /api/v1/support/tickets/:id          → get a ticket + messages (only if it belongs to the user)
 *   - POST   /api/v1/support/tickets/:id/reply    → append a user message
 *
 * Ownership is enforced on every read/write. Rate limits prevent abuse.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { db } from '../lib/database.js';
import { logger } from '../lib/logger.js';
import { rateLimitByUser } from '../lib/rate-limit-fastify.js';

const CATEGORIES = ['general', 'account', 'deposit', 'withdrawal', 'trading', 'kyc', 'security', 'other'] as const;
const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;

const createSchema = z.object({
  subject: z.string().trim().min(3).max(200),
  category: z.enum(CATEGORIES).optional().default('general'),
  priority: z.enum(PRIORITIES).optional().default('medium'),
  message: z.string().trim().min(5).max(5000),
});

const replySchema = z.object({
  message: z.string().trim().min(1).max(5000),
});

const listQuerySchema = z.object({
  status: z.enum(['open', 'in_progress', 'waiting_user', 'resolved', 'closed']).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export default async function supportUserRoutes(app: FastifyInstance) {
  // List own tickets.
  app.get('/tickets', {
    preHandler: [app.authenticateUser, rateLimitByUser('support:list', 30, 60)],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request as any).user?.id as string | undefined;
    if (!userId) return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED' } });

    const q = listQuerySchema.safeParse(request.query);
    if (!q.success) return reply.code(400).send({ success: false, error: { code: 'INVALID_QUERY' } });

    try {
      const params: unknown[] = [userId];
      let where = `WHERE t.user_id = $1`;
      if (q.data.status) {
        params.push(q.data.status);
        where += ` AND t.status = $${params.length}`;
      }
      params.push(q.data.limit);
      const limitIdx = params.length;
      params.push(q.data.offset);
      const offsetIdx = params.length;

      const r = await db.query(
        `SELECT t.id, t.subject, t.category, t.priority, t.status,
                t.created_at, t.updated_at, t.resolved_at,
                (SELECT COUNT(*)::int FROM support_ticket_messages m WHERE m.ticket_id = t.id) AS message_count
           FROM support_tickets t
           ${where}
          ORDER BY t.updated_at DESC
          LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        params
      );

      return reply.send({ success: true, data: { tickets: r.rows } });
    } catch (error) {
      logger.error('support/tickets list failed', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown',
      });
      return reply.code(500).send({ success: false, error: { code: 'LIST_FAILED' } });
    }
  });

  // Create a ticket with first message.
  app.post('/tickets', {
    preHandler: [app.authenticateUser, rateLimitByUser('support:create', 5, 300)],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request as any).user?.id as string | undefined;
    if (!userId) return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED' } });

    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: { code: 'INVALID_INPUT', message: parsed.error.issues[0]?.message } });
    }

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // Abuse cap: max 5 open/in_progress tickets per user.
      const openCountRes = await client.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM support_tickets
          WHERE user_id = $1 AND status IN ('open','in_progress','waiting_user')`,
        [userId]
      );
      if ((openCountRes.rows[0]?.n ?? 0) >= 5) {
        await client.query('ROLLBACK');
        return reply.code(429).send({
          success: false,
          error: { code: 'TOO_MANY_OPEN_TICKETS', message: 'You already have 5 open tickets. Please wait for a reply or close one.' },
        });
      }

      const ticketRes = await client.query<{ id: string; created_at: string }>(
        `INSERT INTO support_tickets (user_id, subject, category, priority, status)
         VALUES ($1, $2, $3, $4, 'open')
         RETURNING id, created_at`,
        [userId, parsed.data.subject, parsed.data.category, parsed.data.priority]
      );
      const ticketRow = ticketRes.rows[0];
      if (!ticketRow) {
        await client.query('ROLLBACK');
        return reply.code(500).send({ success: false, error: { code: 'CREATE_FAILED' } });
      }
      const ticketId = ticketRow.id;

      await client.query(
        `INSERT INTO support_ticket_messages (ticket_id, sender_type, sender_id, message)
         VALUES ($1, 'user', $2, $3)`,
        [ticketId, userId, parsed.data.message]
      );

      await client.query('COMMIT');
      return reply.send({
        success: true,
        data: { id: ticketId, created_at: ticketRow.created_at },
      });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      logger.error('support/tickets create failed', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown',
      });
      return reply.code(500).send({ success: false, error: { code: 'CREATE_FAILED', message: 'Failed to create ticket' } });
    } finally {
      client.release();
    }
  });

  // Get single ticket with messages (owner only).
  app.get('/tickets/:id', {
    preHandler: [app.authenticateUser, rateLimitByUser('support:get', 60, 60)],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request as any).user?.id as string | undefined;
    if (!userId) return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED' } });
    const { id } = request.params as { id: string };

    try {
      const tRes = await db.query(
        `SELECT id, subject, category, priority, status,
                created_at, updated_at, resolved_at, resolution_note
           FROM support_tickets
          WHERE id = $1 AND user_id = $2`,
        [id, userId]
      );
      if (tRes.rows.length === 0) {
        return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND' } });
      }

      const mRes = await db.query(
        `SELECT id, sender_type, message, attachments, created_at
           FROM support_ticket_messages
          WHERE ticket_id = $1
          ORDER BY created_at ASC`,
        [id]
      );

      return reply.send({
        success: true,
        data: { ticket: tRes.rows[0], messages: mRes.rows },
      });
    } catch (error) {
      logger.error('support/tickets get failed', {
        userId, ticketId: id,
        error: error instanceof Error ? error.message : 'Unknown',
      });
      return reply.code(500).send({ success: false, error: { code: 'GET_FAILED' } });
    }
  });

  // Append a user reply.
  app.post('/tickets/:id/reply', {
    preHandler: [app.authenticateUser, rateLimitByUser('support:reply', 20, 60)],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request as any).user?.id as string | undefined;
    if (!userId) return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED' } });
    const { id } = request.params as { id: string };

    const parsed = replySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: { code: 'INVALID_INPUT' } });
    }

    try {
      const check = await db.query<{ status: string }>(
        `SELECT status FROM support_tickets WHERE id = $1 AND user_id = $2`,
        [id, userId]
      );
      const existing = check.rows[0];
      if (!existing) {
        return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND' } });
      }
      if (existing.status === 'closed') {
        return reply.code(400).send({ success: false, error: { code: 'CLOSED', message: 'Ticket is closed. Please open a new ticket.' } });
      }

      const msgRes = await db.query<{ id: string; created_at: string }>(
        `INSERT INTO support_ticket_messages (ticket_id, sender_type, sender_id, message)
         VALUES ($1, 'user', $2, $3)
         RETURNING id, created_at`,
        [id, userId, parsed.data.message]
      );

      // User reply: move ticket back to 'open' if it was waiting_user / resolved.
      await db.query(
        `UPDATE support_tickets
            SET updated_at = now(),
                status = CASE
                           WHEN status IN ('waiting_user','resolved') THEN 'open'
                           ELSE status
                         END
          WHERE id = $1`,
        [id]
      );

      const newMsg = msgRes.rows[0];
      return reply.send({
        success: true,
        data: { id: newMsg?.id, created_at: newMsg?.created_at },
      });
    } catch (error) {
      logger.error('support/tickets reply failed', {
        userId, ticketId: id,
        error: error instanceof Error ? error.message : 'Unknown',
      });
      return reply.code(500).send({ success: false, error: { code: 'REPLY_FAILED' } });
    }
  });
}
