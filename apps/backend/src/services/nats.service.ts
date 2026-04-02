/**
 * NATS + JetStream for spot.match.* (ingress) and spot.orderbook|ticker|trades.* (fan-out).
 * Fan-out subjects may include priority tiers, e.g. spot.orderbook.high.BTC_USDT, spot.ticker.low.*, spot.trades.medium.*.
 * No-op when NATS_URL is unset — legacy Redis / in-process WS unchanged.
 *
 * Multi-region (ops): run a hub cluster in the primary region; attach secondary-region nodes via
 * NATS leaf nodes so `spot.match.*` and JetStream replication/mirroring follow your topology.
 * Failover is typically DNS or global LB to the active API/writer pool; only one elected writer
 * per shard should consume each JetStream durable (see orderbook-writer-leader.service).
 */

import {
  connect,
  RetentionPolicy,
  StorageType,
  type JetStreamClient,
  type NatsConnection,
} from 'nats';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';

let nc: NatsConnection | null = null;
let js: JetStreamClient | null = null;
let initPromise: Promise<void> | null = null;

const NS_DAY = 86_400_000_000_000; // nanoseconds
/** 7d retention for durable match audit trail (JetStream), nanoseconds. */
const NS_7D = 7 * NS_DAY;

/** JetStream stream: engine match events → settlement consumer. */
export const STREAM_MATCH_EVENTS = 'MATCH_EVENTS';
/** Dead-letter stream for poison / fatal settlement messages (audit + replay tooling). */
export const STREAM_MATCH_SETTLEMENT_DLQ = 'MATCH_SETTLEMENT_DLQ';
/** Subject prefix captured by MATCH_SETTLEMENT_DLQ. */
export const SUBJECT_MATCH_SETTLEMENT_DLQ = 'match.settlement.dlq.v1';
/** @deprecated Legacy single consumer; replaced by settlement_group_p{partition}. */
export const CONSUMER_SETTLEMENT_MATCH = 'settlement_group';

export function settlementPartitionConsumerName(partition: number): string {
  return `settlement_group_p${partition}`;
}

/** Nats-Msg-Id dedup window on MATCH_EVENTS (nanoseconds). */
const NS_MATCH_EVENTS_DEDUP = 120_000_000_000; // 2m

export function isNatsSpotPipelineConfigured(): boolean {
  return Boolean(config.nats.url && config.nats.spotPipelineEnabled);
}

export async function initNatsJetStream(): Promise<void> {
  if (!config.nats.url) return;
  if (nc && js) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const servers = config.nats.url!.split(',').map((s) => s.trim()).filter(Boolean);
    const conn = await connect({ servers, name: `exchange-${config.nodeId}` });
    nc = conn;
    js = conn.jetstream();
    const jsm = await conn.jetstreamManager();

    const streams: Array<{
      name: string;
      subjects: string[];
      max_age: number;
      duplicate_window?: number;
    }> = [
      { name: 'SPOT_MATCH', subjects: ['spot.match.>'], max_age: NS_DAY },
      {
        name: 'SPOT_ORDERBOOK',
        subjects: ['spot.orderbook.>', 'spot.ticker.>', 'spot.trades.>'],
        max_age: NS_DAY,
      },
      {
        name: STREAM_MATCH_EVENTS,
        subjects: ['match.events.>'],
        max_age: NS_7D,
        duplicate_window: NS_MATCH_EVENTS_DEDUP,
      },
      {
        name: STREAM_MATCH_SETTLEMENT_DLQ,
        subjects: ['match.settlement.dlq.>'],
        max_age: NS_7D,
      },
    ];

    for (const spec of streams) {
      try {
        await jsm.streams.info(spec.name);
      } catch {
        await jsm.streams.add({
          name: spec.name,
          subjects: spec.subjects,
          retention: RetentionPolicy.Limits,
          storage: StorageType.File,
          max_age: spec.max_age,
          ...(spec.duplicate_window != null ? { duplicate_window: spec.duplicate_window } : {}),
        });
        logger.info('NATS JetStream stream created', { name: spec.name, subjects: spec.subjects });
      }
    }
    logger.info('NATS JetStream connected', { servers: servers[0] });
  })().catch((e) => {
    initPromise = null;
    throw e;
  });

  return initPromise;
}

export async function ensureNatsJetStreamReady(): Promise<void> {
  if (!config.nats.url) return;
  await initNatsJetStream();
}

export function getJetStream(): JetStreamClient {
  if (!js) throw new Error('NATS JetStream not initialized; call ensureNatsJetStreamReady() first');
  return js;
}

/** Safe for optional consumers (writer/forwarder) after failed init. */
export function tryGetJetStream(): JetStreamClient | null {
  return js;
}

export function getNatsConnection(): NatsConnection {
  if (!nc) throw new Error('NATS not connected');
  return nc;
}

export async function closeNats(): Promise<void> {
  if (nc) {
    await nc.drain().catch(() => {});
    nc = null;
    js = null;
    initPromise = null;
  }
}

/** For /health: verify connection + expected JetStream streams exist. */
export async function probeNatsJetStreamStreams(): Promise<{
  ok: boolean;
  error?: string;
  stream_status?: Record<string, string>;
}> {
  if (!config.nats.url?.trim()) return { ok: true, stream_status: {} };
  try {
    await initNatsJetStream();
    const conn = getNatsConnection();
    await conn.flush();
    const jsm = await conn.jetstreamManager();
    const stream_status: Record<string, string> = {};
    const requiredStreams = ['SPOT_MATCH', 'SPOT_ORDERBOOK', STREAM_MATCH_EVENTS];
    if (config.nats.useEventStream) {
      requiredStreams.push(STREAM_MATCH_SETTLEMENT_DLQ);
    }
    for (const name of requiredStreams) {
      try {
        await jsm.streams.info(name);
        stream_status[name] = 'ok';
      } catch {
        stream_status[name] = 'missing';
      }
    }
    const allOk = Object.values(stream_status).every((s) => s === 'ok');
    return allOk
      ? { ok: true, stream_status }
      : { ok: false, error: 'jetstream_stream_missing', stream_status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
