/**
 * Internal API for Rust matching engine: orderbook rebuild on startup.
 * Secured by parent-plugin middleware: CIDR allowlist, rate limit, X-Engine-Secret or engine HMAC v2.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../lib/database.js';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';
import { getSpotOrdersUseMarketSync } from '../lib/spot-schema-cache.js';

/**
 * `order_status` enum values are lowercase: new, partially_filled, filled,
 * cancelled, rejected, expired, pending_cancel. Using uppercase here caused
 * the engine-recovery endpoint to return 0 open orders after a Rust restart,
 * which silently "lost" real customer orders until manual intervention.
 */
const OPEN_STATUSES = ['new', 'partially_filled'];

export default async function internalEngineRoutes(app: FastifyInstance): Promise<void> {
  /** GET /internal/engine/state — open orders + last_engine_event_id for engine restart recovery */
  app.get('/state', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const useMarket = getSpotOrdersUseMarketSync();
      const ordersQuery = useMarket
        ? db.query<{
            id: string; user_id: string; market: string; side: string; type: string;
            price: string | null; quantity: string; filled_quantity: string; created_at: Date;
          }>(
            `SELECT id::text, user_id::text, market, side, type, price::text, quantity::text, filled_quantity::text, created_at
             FROM spot_orders
             WHERE status = ANY($1::text[])
             ORDER BY market, created_at ASC, id::text ASC`,
            [OPEN_STATUSES]
          )
        : db.query<{
            id: string; user_id: string; market: string; side: string; type: string;
            price: string | null; quantity: string; filled_quantity: string; created_at: Date;
          }>(
            `SELECT o.id::text, o.user_id::text, tp.symbol AS market, o.side::text, o.order_type::text AS type, o.price::text, o.quantity::text, o.filled_quantity::text, o.created_at
             FROM spot_orders o
             INNER JOIN trading_pairs tp ON tp.id = o.trading_pair_id
             WHERE o.status::text = ANY($1::text[])
             ORDER BY tp.symbol, o.created_at ASC, o.id::text ASC`,
            [['new', 'partially_filled']]
          );
      const [ordersRes, cursorRes] = await Promise.all([
        ordersQuery,
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

  /**
   * POST /internal/engine/settlement-stream/replay
   * Recreate durable consumer `settlement_group` with deliver_policy=start_sequence (JetStream sequence on MATCH_EVENTS).
   * Restart processes running the MATCH_EVENTS pull consumer after calling this.
   */
  app.post('/settlement-stream/replay', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!config.nats.url?.trim()) {
      return reply.status(503).send({
        error: 'NATS_NOT_CONFIGURED',
        message: 'NATS_URL is required to reset the MATCH_EVENTS consumer',
      });
    }

    const body = request.body as { start_sequence?: unknown };
    const seq = Number(body?.start_sequence);
    if (!Number.isFinite(seq) || seq < 1) {
      return reply.status(400).send({
        error: 'INVALID_BODY',
        message: 'start_sequence must be a number >= 1 (JetStream stream sequence on MATCH_EVENTS)',
      });
    }

    try {
      const { ensureNatsJetStreamReady } = await import('../services/nats.service.js');
      const { resetSettlementMatchStreamConsumerFromSequence } = await import(
        '../services/match-events-settlement-stream.service.js'
      );
      await ensureNatsJetStreamReady();
      await resetSettlementMatchStreamConsumerFromSequence(Math.floor(seq));
      return reply.send({
        ok: true,
        start_sequence: Math.floor(seq),
        message: 'Consumer reset; restart API/worker processes that run the MATCH_EVENTS settlement consumer',
      });
    } catch (e) {
      logger.error('settlement-stream replay failed', { error: e instanceof Error ? e.message : String(e) });
      return reply.status(503).send({
        error: 'REPLAY_FAILED',
        message: e instanceof Error ? e.message : String(e),
      });
    }
  });

  /**
   * POST /internal/engine/settlement-dlq/replay
   * Re-publish DLQ payloads onto their original match.events.* subjects (requires original_nats_subject on envelope).
   */
  app.post('/settlement-dlq/replay', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!config.nats.url?.trim()) {
      return reply.status(503).send({
        error: 'NATS_NOT_CONFIGURED',
        message: 'NATS_URL is required',
      });
    }

    const body = request.body as { start_sequence?: unknown; limit?: unknown };
    const startSeq = Number(body?.start_sequence ?? 1);
    const limit = Number(body?.limit ?? 50);
    if (!Number.isFinite(startSeq) || startSeq < 1) {
      return reply.status(400).send({ error: 'INVALID_BODY', message: 'start_sequence must be >= 1' });
    }
    if (!Number.isFinite(limit) || limit < 1 || limit > 500) {
      return reply.status(400).send({ error: 'INVALID_BODY', message: 'limit must be 1..500' });
    }

    try {
      const { ensureNatsJetStreamReady } = await import('../services/nats.service.js');
      const { replaySettlementDlqToMatchStream } = await import(
        '../services/match-settlement-dlq-replay.service.js'
      );
      await ensureNatsJetStreamReady();
      const r = await replaySettlementDlqToMatchStream({
        startSeq: Math.floor(startSeq),
        limit: Math.floor(limit),
      });
      return reply.send({ ok: true, ...r });
    } catch (e) {
      logger.error('settlement-dlq replay failed', { error: e instanceof Error ? e.message : String(e) });
      return reply.status(503).send({
        error: 'DLQ_REPLAY_FAILED',
        message: e instanceof Error ? e.message : String(e),
      });
    }
  });
}
