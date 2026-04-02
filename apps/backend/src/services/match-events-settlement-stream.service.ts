/**
 * JetStream MATCH_EVENTS (match.events.*.pK) → durable consumers settlement_group_pK → Postgres.
 * Partition count must match engine MATCH_EVENTS_PARTITIONS for throughput and ordered-ish sharding.
 */
import { AckPolicy, DeliverPolicy, consumerOpts } from 'nats';
import type { JsMsg } from 'nats';
import {
  ensureNatsJetStreamReady,
  getJetStream,
  getNatsConnection,
  STREAM_MATCH_EVENTS,
  STREAM_MATCH_SETTLEMENT_DLQ,
  SUBJECT_MATCH_SETTLEMENT_DLQ,
  CONSUMER_SETTLEMENT_MATCH,
  settlementPartitionConsumerName,
  tryGetJetStream,
} from './nats.service.js';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';
import { ingestAndSettleMatchEventFromJetStream } from './settlement/settlement-worker.js';
import { applyCommittedEngineNotify } from './spot-engine-live-bridge.service.js';
import { isTradingHalted, triggerCircuitIfViolation } from './settlement/settlement-circuit.js';
import { getTradingHalted, getSettlementCircuitOpen } from '../lib/trading-halt.js';
import {
  settlementMatchStreamPending,
  settlementMatchStreamAckTotal,
  settlementMatchStreamTermTotal,
  settlementMatchStreamNakTotal,
  settlementMatchStreamLagSequences,
  settlementMatchStreamDlqTotal,
  settlementMatchStreamPartitionLag,
  settlementMatchStreamPartitionPending,
} from '../lib/prometheus-metrics.js';

let stopped = false;
let started = false;
let metricsTimer: ReturnType<typeof setInterval> | null = null;
const pullTimers: ReturnType<typeof setTimeout>[] = [];

export function isMatchEventsSettlementStreamEnabled(): boolean {
  return Boolean(config.nats.url?.trim() && config.nats.useEventStream);
}

function partitionCount(): number {
  return config.nats.matchEventsPartitionCount;
}

/** Single partition: consume entire match.events.> (legacy + .p0). Multi: isolate by .pK suffix. */
function filterForPartition(partition: number, total: number): string {
  if (total <= 1) {
    return 'match.events.>';
  }
  return `match.events.*.p${partition}`;
}

function settlementConsumerAckWaitNanos(): number {
  return Math.round(config.nats.settlementStreamAckWaitMs * 1_000_000);
}

function settlementMatchConsumerFieldsForPartition(
  partition: number,
  deliverPolicy: DeliverPolicy,
  optStartSeq?: number
): {
  durable_name: string;
  filter_subject: string;
  ack_policy: AckPolicy;
  deliver_policy: DeliverPolicy;
  opt_start_seq?: number;
  ack_wait: number;
  max_deliver: number;
  max_ack_pending: number;
} {
  const P = partitionCount();
  return {
    durable_name: settlementPartitionConsumerName(partition),
    filter_subject: filterForPartition(partition, P),
    ack_policy: AckPolicy.Explicit,
    deliver_policy: deliverPolicy,
    ...(optStartSeq != null ? { opt_start_seq: optStartSeq } : {}),
    ack_wait: settlementConsumerAckWaitNanos(),
    max_deliver: config.nats.settlementStreamMaxDeliver,
    max_ack_pending: config.nats.settlementStreamMaxAckPending,
  };
}

async function publishMatchSettlementDlq(envelope: {
  v: number;
  ts_ms: number;
  source_stream: string;
  dlq_stream: string;
  consumer: string;
  phase: 'json_parse' | 'settlement_fatal';
  reason: string;
  payload_text?: string;
  payload_b64?: string;
  original_nats_subject?: string;
}): Promise<void> {
  try {
    const js = tryGetJetStream();
    if (!js) return;
    await js.publish(SUBJECT_MATCH_SETTLEMENT_DLQ, JSON.stringify(envelope));
    settlementMatchStreamDlqTotal.inc();
  } catch (e) {
    logger.error('MATCH_SETTLEMENT_DLQ publish failed', {
      error: e instanceof Error ? e.message : String(e),
      phase: envelope.phase,
    });
  }
}

export async function resetSettlementMatchStreamConsumerFromSequence(optStartSeq: number): Promise<void> {
  if (optStartSeq < 1) {
    throw new Error('opt_start_seq must be >= 1');
  }
  const nc = getNatsConnection();
  const jsm = await nc.jetstreamManager();
  const P = partitionCount();
  try {
    await jsm.consumers.delete(STREAM_MATCH_EVENTS, CONSUMER_SETTLEMENT_MATCH);
  } catch {
    /* legacy */
  }
  for (let p = 0; p < P; p++) {
    const name = settlementPartitionConsumerName(p);
    try {
      await jsm.consumers.delete(STREAM_MATCH_EVENTS, name);
    } catch {
      /* absent */
    }
    await jsm.consumers.add(
      STREAM_MATCH_EVENTS,
      settlementMatchConsumerFieldsForPartition(p, DeliverPolicy.StartSequence, optStartSeq)
    );
  }
  logger.warn('MATCH_EVENTS partition consumers recreated for replay — restart stream consumer workers', {
    opt_start_seq: optStartSeq,
    partitions: P,
  });
}

async function ensureSettlementConsumersExist(): Promise<void> {
  const nc = getNatsConnection();
  const jsm = await nc.jetstreamManager();
  try {
    await jsm.consumers.delete(STREAM_MATCH_EVENTS, CONSUMER_SETTLEMENT_MATCH);
  } catch {
    /* no legacy */
  }
  const P = partitionCount();
  for (let p = 0; p < P; p++) {
    const name = settlementPartitionConsumerName(p);
    try {
      await jsm.consumers.info(STREAM_MATCH_EVENTS, name);
    } catch {
      await jsm.consumers.add(
        STREAM_MATCH_EVENTS,
        settlementMatchConsumerFieldsForPartition(p, DeliverPolicy.All)
      );
      logger.info('JetStream settlement partition consumer created', {
        stream: STREAM_MATCH_EVENTS,
        durable: name,
        partition: p,
      });
    }
  }
}

function scheduleRecursivePull(
  sub: { pull: (o: { batch: number; expires: number }) => void },
  pullBatch: number,
  pullMs: number
): void {
  const t = setTimeout(() => {
    if (stopped) return;
    try {
      sub.pull({ batch: pullBatch, expires: 500 });
    } catch {
      /* ignore */
    }
    scheduleRecursivePull(sub, pullBatch, pullMs);
  }, pullMs);
  pullTimers.push(t);
}

async function handleSettlementJsMessage(m: JsMsg, partition: number, consumerName: string): Promise<void> {
  const originalSubject = m.subject;

  if (isTradingHalted() || (await getTradingHalted())) {
    m.nak();
    return;
  }
  if (await getSettlementCircuitOpen()) {
    m.nak();
    return;
  }

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(m.string()) as Record<string, unknown>;
  } catch {
    const payload_b64 = Buffer.from(m.data).toString('base64');
    await publishMatchSettlementDlq({
      v: 1,
      ts_ms: Date.now(),
      source_stream: STREAM_MATCH_EVENTS,
      dlq_stream: STREAM_MATCH_SETTLEMENT_DLQ,
      consumer: consumerName,
      phase: 'json_parse',
      reason: 'invalid_json',
      payload_b64,
      original_nats_subject: originalSubject,
    });
    settlementMatchStreamTermTotal.inc();
    m.term();
    return;
  }

  try {
    const r = await ingestAndSettleMatchEventFromJetStream(raw);
    if (r.outcome === 'settled' && r.liveNotify) {
      try {
        await applyCommittedEngineNotify(r.liveNotify);
      } catch (e) {
        logger.warn('Stream settlement live notify failed (best-effort)', {
          error: e instanceof Error ? e.message : String(e),
        });
      }
      try {
        const { notifySpotPrivateChannelsAfterSettlement } = await import('./spot-settlement-private-ws.service.js');
        await notifySpotPrivateChannelsAfterSettlement({
          symbol: r.liveNotify.symbol,
          takerOrderId: r.liveNotify.taker_order_id,
          makerOrderId: r.liveNotify.maker_order_id,
          takerUserId: r.liveNotify.taker_user_id,
          makerUserId: r.liveNotify.maker_user_id,
        });
      } catch (e) {
        logger.warn('Stream settlement private WS notify failed (best-effort)', {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    settlementMatchStreamAckTotal.inc();
    m.ack();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    triggerCircuitIfViolation(msg);
    const fatalNonRetryable =
      msg.startsWith('STREAM_MATCH_EVENT_INVALID') ||
      msg.startsWith('SETTLEMENT_PAYLOAD_') ||
      msg === 'SELF_TRADE_REJECTED' ||
      msg.startsWith('FEE_INVARIANT') ||
      msg.startsWith('ORDER_INVARIANT') ||
      msg.startsWith('GLOBAL_') ||
      msg.startsWith('LEDGER_') ||
      msg.startsWith('SPOT_TRADES_SCHEMA') ||
      msg.startsWith('MARKET_') ||
      msg.startsWith('TRADING_PAIR_') ||
      msg.includes('negative balance');
    if (fatalNonRetryable) {
      const payload_text = JSON.stringify(raw);
      await publishMatchSettlementDlq({
        v: 1,
        ts_ms: Date.now(),
        source_stream: STREAM_MATCH_EVENTS,
        dlq_stream: STREAM_MATCH_SETTLEMENT_DLQ,
        consumer: consumerName,
        phase: 'settlement_fatal',
        reason: msg.slice(0, 4000),
        payload_text: payload_text.length > 800_000 ? payload_text.slice(0, 800_000) : payload_text,
        original_nats_subject: originalSubject,
      });
      settlementMatchStreamTermTotal.inc();
      m.term();
      logger.error('MATCH_EVENTS message terminated (non-retryable)', {
        partition,
        error: msg.slice(0, 500),
      });
      return;
    }
    settlementMatchStreamNakTotal.inc();
    m.nak();
  }
}

export async function startMatchEventsSettlementStreamConsumer(): Promise<void> {
  if (!isMatchEventsSettlementStreamEnabled()) {
    logger.info('MATCH_EVENTS settlement stream consumer off (USE_EVENT_STREAM=false or no NATS_URL)');
    return;
  }
  if (started) {
    return;
  }
  started = true;
  stopped = false;
  pullTimers.length = 0;

  await ensureNatsJetStreamReady();
  await ensureSettlementConsumersExist();
  const js = getJetStream();
  const P = partitionCount();
  const pullBatch = config.nats.settlementStreamPullBatch;
  const pullMs = config.nats.settlementStreamPullIntervalMs;

  metricsTimer = setInterval(async () => {
    try {
      const nc = getNatsConnection();
      const jsm = await nc.jetstreamManager();
      const sinfo = await jsm.streams.info(STREAM_MATCH_EVENTS);
      const lastSeq = sinfo.state?.last_seq ?? 0;
      let maxLag = 0;
      let sumPending = 0;
      for (let p = 0; p < P; p++) {
        const name = settlementPartitionConsumerName(p);
        try {
          const cinfo = await jsm.consumers.info(STREAM_MATCH_EVENTS, name);
          const pending = typeof cinfo.num_pending === 'number' ? cinfo.num_pending : 0;
          sumPending += pending;
          const delivered = (cinfo as { delivered?: { stream_seq?: number } }).delivered?.stream_seq ?? 0;
          const lag = Math.max(0, lastSeq - delivered);
          maxLag = Math.max(maxLag, lag);
          settlementMatchStreamPartitionPending.labels(String(p)).set(pending);
          settlementMatchStreamPartitionLag.labels(String(p)).set(lag);
        } catch {
          settlementMatchStreamPartitionPending.labels(String(p)).set(0);
          settlementMatchStreamPartitionLag.labels(String(p)).set(0);
        }
      }
      settlementMatchStreamPending.set(sumPending);
      settlementMatchStreamLagSequences.set(maxLag);
    } catch {
      /* ignore */
    }
  }, 2000);

  for (let p = 0; p < P; p++) {
    const durable = settlementPartitionConsumerName(p);
    const filter = filterForPartition(p, P);
    const opts = consumerOpts();
    opts.durable(durable);
    opts.manualAck();
    opts.ackExplicit();
    opts.filterSubject(filter);
    opts.ackWait(config.nats.settlementStreamAckWaitMs);
    opts.maxAckPending(config.nats.settlementStreamMaxAckPending);

    const sub = await js.pullSubscribe(filter, opts);
    try {
      sub.pull({ batch: pullBatch, expires: 500 });
    } catch {
      /* ignore */
    }
    scheduleRecursivePull(sub, pullBatch, pullMs);

    void (async () => {
      try {
        for await (const m of sub) {
          if (stopped) {
            m.term();
            break;
          }
          await handleSettlementJsMessage(m, p, durable);
        }
      } catch (e) {
        logger.error('MATCH_EVENTS partition consumer loop exited', {
          partition: p,
          error: e instanceof Error ? e.message : String(e),
        });
        started = false;
      }
    })();
  }

  logger.info('MATCH_EVENTS settlement stream consumers running', {
    partitions: P,
    pullBatch,
    pullMs,
    maxAckPending: config.nats.settlementStreamMaxAckPending,
    ackWaitMs: config.nats.settlementStreamAckWaitMs,
  });
}

export function stopMatchEventsSettlementStreamConsumer(): void {
  stopped = true;
  started = false;
  for (const t of pullTimers) {
    clearTimeout(t);
  }
  pullTimers.length = 0;
  if (metricsTimer) {
    clearInterval(metricsTimer);
    metricsTimer = null;
  }
}

export function scheduleMatchEventsSettlementStreamConsumer(): void {
  void startMatchEventsSettlementStreamConsumer().catch((e) => {
    logger.warn('MATCH_EVENTS settlement stream consumer failed to start', {
      error: e instanceof Error ? e.message : String(e),
    });
  });
}
