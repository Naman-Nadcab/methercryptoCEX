/**
 * Publish match / book-adjust events to JetStream spot.match.<SYMBOL>.
 * Engine/API path only publishes — no L2 or WS here when NATS pipeline is enabled.
 */

import { TextEncoder } from 'node:util';
import { logger } from '../lib/logger.js';
import { config } from '../config/index.js';
import { redis } from '../lib/redis.js';
import { ensureNatsJetStreamReady, getJetStream, isNatsSpotPipelineConfigured } from './nats.service.js';
import type { EngineMatchEvent } from './settlement/engine-client.js';

const enc = new TextEncoder();

export type SpotMatchNatsPayload = {
  kind: 'match' | 'book_adjust';
  symbol: string;
  /** Idempotent key: engine:${id} | js:${orderId} | cancel:${orderId} | rust-rest:${orderId} */
  event_key: string;
  timestamp: number;
  source: 'engine' | 'settlement' | 'js' | 'cancel' | 'rust';
  taker_side?: 'buy' | 'sell';
  base?: string;
  quote?: string;
  quote_precision?: number;
  trades?: Array<{ price: string; quantity: string; taker_user_id: string; maker_user_id: string }>;
  resting?: Array<{ side: 'buy' | 'sell'; price: string; quantity: string }>;
  cancels?: Array<{ side: 'buy' | 'sell'; price: string; quantity: string }>;
  /** Monotonic per symbol; assigned via Redis INCR when ORDERBOOK_PUBLISHER_ASSIGN_SEQ=true */
  writer_seq?: number;
};

export function matchPayloadFromEngineEvent(
  ev: EngineMatchEvent,
  base: string,
  quote: string,
  quotePrecision: number
): SpotMatchNatsPayload {
  return {
    kind: 'match',
    symbol: ev.symbol,
    event_key: `engine:${ev.match_engine_id}:${ev.event_id}`,
    timestamp: Date.now(),
    source: 'engine',
    taker_side: ev.taker_side,
    base,
    quote,
    quote_precision: quotePrecision,
    trades: [
      {
        price: ev.price,
        quantity: ev.qty,
        taker_user_id: ev.taker_user_id,
        maker_user_id: ev.maker_user_id,
      },
    ],
  };
}

export async function publishSpotMatchPayload(payload: SpotMatchNatsPayload): Promise<void> {
  if (!isNatsSpotPipelineConfigured()) return;
  try {
    if (config.nats.publisherAssignWriterSeq && payload.writer_seq == null) {
      try {
        const sym = String(payload.symbol || '').toUpperCase();
        if (sym) {
          const n = await redis.incr(`spot:match:writer_seq:${sym}`);
          payload.writer_seq = n;
        }
      } catch (e) {
        logger.warn('spot.match publisher seq incr failed', { err: e instanceof Error ? e.message : String(e) });
      }
    }
    await ensureNatsJetStreamReady();
    const js = getJetStream();
    const data = enc.encode(JSON.stringify(payload));
    await js.publish(`spot.match.${payload.symbol}`, data, { msgID: payload.event_key });
  } catch (e) {
    logger.warn('NATS spot.match publish failed', {
      symbol: payload.symbol,
      event_key: payload.event_key,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
