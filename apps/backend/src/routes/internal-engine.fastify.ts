/**
 * Internal API for Rust matching engine: orderbook rebuild on startup.
 * Protected by X-Engine-Secret when ENGINE_INTERNAL_SECRET is set.
 * Returns open spot orders and last_engine_event_id for deterministic recovery.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../lib/database.js';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';

const OPEN_STATUSES = ['OPEN', 'PARTIALLY_FILLED'];

function authInternalEngine(request: FastifyRequest, reply: FastifyReply): boolean {
  const secret = config.rustMatchingEngine?.internalSecret;
  if (!secret) {
    return true;
  }
  const header = request.headers['x-engine-secret'];
  if (header !== secret) {
    reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Invalid or missing X-Engine-Secret' });
    return false;
  }
  return true;
}

export default async function internalEngineRoutes(app: FastifyInstance): Promise<void> {
  /** GET /internal/engine/state — open orders + last_engine_event_id for engine restart recovery */
  app.get('/state', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!authInternalEngine(request, reply)) return;

    try {
      const [ordersRes, cursorRes] = await Promise.all([
        db.query<{
          id: string;
          user_id: string;
          market: string;
          side: string;
          type: string;
          price: string | null;
          quantity: string;
          filled_quantity: string;
          created_at: Date;
        }>(
          `SELECT id::text, user_id::text, market, side, type, price::text, quantity::text, filled_quantity::text, created_at
           FROM spot_orders
           WHERE status = ANY($1::text[])
           ORDER BY market, created_at ASC, id::text ASC`,
          [OPEN_STATUSES]
        ),
        db.query<{ last_engine_event_id: string }>(
          `SELECT COALESCE(last_engine_event_id, 0)::text AS last_engine_event_id FROM settlement_poller_cursor WHERE id = 1`
        ).catch(() => ({ rows: [{ last_engine_event_id: '0' }] })),
      ]);

      const lastEngineEventId = cursorRes.rows[0]?.last_engine_event_id
        ? parseInt(cursorRes.rows[0].last_engine_event_id, 10) || 0
        : 0;

      const orders = ordersRes.rows.map((r) => {
        const qty = parseFloat(r.quantity) || 0;
        const filled = parseFloat(r.filled_quantity) || 0;
        const remaining = Math.max(0, qty - filled);
        const createdAt = r.created_at instanceof Date ? r.created_at : new Date(r.created_at);
        return {
          id: r.id,
          user_id: r.user_id,
          market: r.market,
          side: (r.side || 'buy').toUpperCase(),
          type: (r.type || 'limit').toUpperCase(),
          price: r.price,
          quantity: String(qty),
          remaining: String(remaining),
          created_at: Math.floor(createdAt.getTime() / 1000),
        };
      });

      return reply.send({
        orders,
        last_engine_event_id: lastEngineEventId,
      });
    } catch (e) {
      logger.error('Internal engine state failed', { error: e instanceof Error ? e.message : String(e) });
      reply.status(503).send({
        error: 'SERVICE_UNAVAILABLE',
        message: 'Failed to load engine state',
      });
    }
  });
}
