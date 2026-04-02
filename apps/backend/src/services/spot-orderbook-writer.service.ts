/**
 * JetStream consumer: spot.match.* → shard L2 → spot.orderbook|ticker|trades.*
 * Leader election (Redis), lag circuit refresh, backpressure, strict seq (optional).
 */
import { consumerOpts } from 'nats';
import { TextEncoder } from 'node:util';
import { Decimal } from '../lib/decimal.js';
import { config } from '../config/index.js';
import { ensureNatsJetStreamReady, tryGetJetStream, isNatsSpotPipelineConfigured, getNatsConnection } from './nats.service.js';
import { isOrderbookShardOwner } from './spot-orderbook-shard.service.js';
import { consumeMatchEventKeyDistributed } from './spot-match-writer-dedup.service.js';
import { addLiquidity, removeLiquidity } from './spot-in-memory-orderbook.service.js';
import { takeOrderbookWireFromMemory, buildOrderbookResyncWire } from './spot-orderbook-ws-engine.service.js';
import { buildPublicSpotFeedWires } from './spot-live-ws-fanout.service.js';
import { applyExecutedTrades } from './spot-live-market-state.service.js';
import type { ExecutedTrade } from './spot-matching.service.js';
import { broadcastWriterLocalFanout } from './spot-ws-writer-local-fanout.service.js';
import { scheduleOrderbookRedisBackup } from './spot-orderbook-coalescer.service.js';
import { loadWriterSnapshotIfPresent, saveWriterSnapshot } from './spot-orderbook-snapshot-persistence.service.js';
import type { SpotMatchNatsPayload } from './spot-match-nats-publisher.service.js';
import { ROUND_DOWN } from './spot-decimal.js';
import { logger } from '../lib/logger.js';
import {
  recordStreamMessageAcked,
  getLastAckedStreamSeq,
  setWriterSeq,
  getPrevWriterSeq,
  setLastEventKey,
  markWriterProcessEnd,
  setWriterPendingEstimate,
  getWriterProcessingLagMs,
  getWriterPendingEstimate,
} from './spot-orderbook-writer-state.service.js';
import {
  spotOrderbookWriterProcessSeconds,
  spotOrderbookWriterLagMs,
  spotOrderbookWriterPending,
  spotOrderbookWriterResyncTotal,
  spotOrderbookWriterDroppedTotal,
} from '../lib/prometheus-metrics.js';
import {
  renewOrAcquireOrderbookWriterLeadership,
  releaseOrderbookWriterLeadership,
} from './orderbook-writer-leader.service.js';
import { refreshOrderbookWriterLagCircuit } from './orderbook-writer-lag-circuit.service.js';
import { redis } from '../lib/redis.js';

const te = new TextEncoder();
const STREAM_SPOT_MATCH = 'SPOT_MATCH';

const writerLog = logger.child({ component: 'orderbook_writer', shard_id: String(config.nats.shardId) });

let writerLoopAbort = false;
let writerTimer: ReturnType<typeof setInterval> | null = null;
let writerPullTimer: ReturnType<typeof setTimeout> | null = null;
let writerMetricsTimer: ReturnType<typeof setInterval> | null = null;
let leaderTickInterval: ReturnType<typeof setInterval> | null = null;
let writerShutdown = false;
let consumerStop: (() => Promise<void>) | null = null;
let syncLeadershipRunning = false;

const pullState = {
  ms: 150,
  pendingHigh: false,
};

function durableSanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
}

function shardLabel(): string {
  return String(config.nats.shardId);
}

function tradesToExecuted(payload: SpotMatchNatsPayload): ExecutedTrade[] {
  const takerSide = payload.taker_side ?? 'buy';
  const base = payload.base ?? '';
  const quote = payload.quote ?? '';
  const qp = payload.quote_precision ?? 8;
  const out: ExecutedTrade[] = [];
  for (const t of payload.trades ?? []) {
    const buyerId = takerSide === 'buy' ? t.taker_user_id : t.maker_user_id;
    const sellerId = takerSide === 'buy' ? t.maker_user_id : t.taker_user_id;
    const quoteValue = new Decimal(t.price)
      .times(t.quantity)
      .toDecimalPlaces(qp, ROUND_DOWN)
      .toString();
    out.push({
      buyerId,
      sellerId,
      baseAsset: base,
      quoteAsset: quote,
      quantity: t.quantity,
      price: t.price,
      quoteValue,
    });
  }
  return out;
}

function publishOutboundFanout(
  symbol: string,
  orderbookBuf: Uint8Array,
  tickerWire: string | null,
  tradesWire: string
): void {
  const js = tryGetJetStream();
  if (!js) return;
  const sym = symbol.toUpperCase();
  void js.publish(`spot.orderbook.high.${sym}`, orderbookBuf, { timeout: 2000 }).catch((e) =>
    writerLog.warn('publish orderbook failed', { err: e instanceof Error ? e.message : String(e), symbol: sym }),
  );
  if (tickerWire) {
    void js.publish(`spot.ticker.low.${sym}`, te.encode(tickerWire), { timeout: 2000 }).catch((e) =>
      writerLog.warn('publish ticker failed', { err: e instanceof Error ? e.message : String(e), symbol: sym }),
    );
  }
  void js.publish(`spot.trades.medium.${sym}`, te.encode(tradesWire), { timeout: 2000 }).catch((e) =>
    writerLog.warn('publish trades failed', { err: e instanceof Error ? e.message : String(e), symbol: sym }),
  );
}

function maybeLocalBroadcast(symbol: string, orderbookWire: string, tickerWire: string | null, tradesWire: string): void {
  if (!config.nats.writerLocalWsBroadcast) return;
  const sym = symbol.toUpperCase();
  broadcastWriterLocalFanout(sym, orderbookWire, tickerWire, tradesWire);
}

function publishOrderbookResyncFanout(symbol: string): void {
  const sym = symbol.toUpperCase();
  const wire = buildOrderbookResyncWire(sym);
  const buf = te.encode(wire);
  const js = tryGetJetStream();
  if (js) {
    void js.publish(`spot.orderbook.high.${sym}`, buf, { timeout: 2000 }).catch((e) =>
      writerLog.warn('publish resync failed', { err: e instanceof Error ? e.message : String(e), symbol: sym }),
    );
  }
  if (config.nats.writerLocalWsBroadcast) {
    broadcastWriterLocalFanout(sym, wire, null, null);
  }
}

function checkWriterSeqGap(symbol: string, payload: SpotMatchNatsPayload): void {
  const ws = payload.writer_seq;
  if (!config.nats.writerStrictSeq) {
    if (ws != null) setWriterSeq(symbol, Math.max(getPrevWriterSeq(symbol), ws));
    return;
  }
  if (ws == null) {
    writerLog.warn('strict seq but writer_seq missing', { symbol, event_key: payload.event_key });
    return;
  }
  const prev = getPrevWriterSeq(symbol);
  const expected = prev + 1;
  if (prev === 0 && ws === 1) {
    setWriterSeq(symbol, ws);
    return;
  }
  if (ws !== expected) {
    writerLog.error('writer_seq gap', { symbol, expected, got: ws, prev, event_key: payload.event_key });
    spotOrderbookWriterResyncTotal.inc({ shard: shardLabel() });
    publishOrderbookResyncFanout(symbol);
  }
  setWriterSeq(symbol, ws);
}

function processMatchPayload(payload: SpotMatchNatsPayload): void {
  const symbol = String(payload.symbol || '').toUpperCase();
  if (!symbol || !isOrderbookShardOwner(symbol)) return;

  const sample = config.observability.spotWriterLogSampleRate;
  if (sample > 0 && Math.random() < sample) {
    writerLog.info('match_apply_sample', {
      symbol,
      writer_seq: payload.writer_seq,
      event_key: payload.event_key,
      kind: payload.kind ?? 'match',
    });
  }

  const kind = payload.kind ?? 'match';
  if (kind === 'book_adjust') {
    for (const c of payload.cancels ?? []) {
      removeLiquidity(symbol, c.side, c.price, c.quantity);
    }
    for (const r of payload.resting ?? []) {
      addLiquidity(symbol, r.side, r.price, r.quantity);
    }
  } else {
    const takerSide = payload.taker_side ?? 'buy';
    const makerSide: 'buy' | 'sell' = takerSide === 'buy' ? 'sell' : 'buy';
    for (const t of payload.trades ?? []) {
      removeLiquidity(symbol, makerSide, t.price, t.quantity);
    }
    const exec = tradesToExecuted(payload);
    if (exec.length) applyExecutedTrades(symbol, exec, takerSide);
    for (const r of payload.resting ?? []) {
      addLiquidity(symbol, r.side, r.price, r.quantity);
    }
  }

  const orderbookWire = takeOrderbookWireFromMemory(symbol);
  if (!orderbookWire) return;

  const { tickerWire, tradesWire } = buildPublicSpotFeedWires(symbol);
  const orderbookBuf = te.encode(orderbookWire);

  publishOutboundFanout(symbol, orderbookBuf, tickerWire, tradesWire);
  maybeLocalBroadcast(symbol, orderbookWire, tickerWire, tradesWire);
  scheduleOrderbookRedisBackup(symbol);
}

function scheduleRecursivePull(sub: { pull: (o: { batch: number; expires: number }) => void }): void {
  if (writerLoopAbort || writerShutdown) return;
  writerPullTimer = setTimeout(() => {
    if (writerLoopAbort || writerShutdown) return;
    try {
      const batch = pullState.pendingHigh ? 8 : 64;
      sub.pull({ batch, expires: 500 });
    } catch (e) {
      writerLog.warn('pull failed', { err: e instanceof Error ? e.message : String(e) });
    }
    scheduleRecursivePull(sub);
  }, pullState.ms);
}

async function mountPullConsumer(js: NonNullable<ReturnType<typeof tryGetJetStream>>): Promise<() => Promise<void>> {
  writerLoopAbort = false;
  pullState.ms = config.nats.writerPullMsFast;
  pullState.pendingHigh = false;

  const opts = consumerOpts();
  opts.durable(durableSanitize(`orderbook-writer-${config.nats.shardId}`));
  opts.manualAck();
  opts.ackExplicit();
  opts.filterSubject('spot.match.>');

  const resumeAfter = getLastAckedStreamSeq();
  if (resumeAfter > 0) {
    opts.startSequence(resumeAfter + 1);
    writerLog.info('JetStream resume from snapshot stream seq', { resumeAfter, next: resumeAfter + 1 });
  } else {
    opts.deliverNew();
  }

  const sub = await js.pullSubscribe('spot.match.>', opts);
  const durableName = durableSanitize(`orderbook-writer-${config.nats.shardId}`);

  writerMetricsTimer = setInterval(async () => {
    try {
      const nc = getNatsConnection();
      const jsm = await nc.jetstreamManager();
      const info = await jsm.consumers.info(STREAM_SPOT_MATCH, durableName);
      const pending = info.num_pending;
      setWriterPendingEstimate(pending);
      spotOrderbookWriterPending.labels(shardLabel()).set(pending);
      const threshold = config.nats.writerLagPendingThreshold;
      if (pending > threshold) {
        pullState.pendingHigh = true;
        pullState.ms = config.nats.writerPullMsSlow;
      } else {
        pullState.pendingHigh = false;
        pullState.ms = config.nats.writerPullMsFast;
      }
      const lagMs = getWriterProcessingLagMs();
      spotOrderbookWriterLagMs.labels(shardLabel()).set(lagMs);
      await refreshOrderbookWriterLagCircuit(lagMs, pending);
      void redis
        .set(
          `spot:pub:writer_health:${config.nats.shardId}`,
          JSON.stringify({ lag_ms: lagMs, pending, updated: Date.now() }),
          3,
        )
        .catch(() => {});
    } catch {
      const lagMs = getWriterProcessingLagMs();
      spotOrderbookWriterLagMs.labels(shardLabel()).set(lagMs);
      await refreshOrderbookWriterLagCircuit(lagMs, getWriterPendingEstimate());
      void redis
        .set(
          `spot:pub:writer_health:${config.nats.shardId}`,
          JSON.stringify({ lag_ms: lagMs, pending: getWriterPendingEstimate(), updated: Date.now() }),
          3,
        )
        .catch(() => {});
    }
  }, 1000);

  try {
    sub.pull({ batch: 64, expires: 500 });
  } catch (e) {
    writerLog.warn('initial pull failed', { err: e instanceof Error ? e.message : String(e) });
  }
  scheduleRecursivePull(sub);

  void (async () => {
    try {
      for await (const m of sub) {
        if (writerLoopAbort || writerShutdown) {
          m.term();
          break;
        }
        const t0 = process.hrtime.bigint();
        try {
          const streamSeq = m.info.streamSequence;
          const raw = m.string();
          const payload = JSON.parse(raw) as SpotMatchNatsPayload;
          const symbol = String(payload.symbol || '').toUpperCase();

          if (!symbol || !isOrderbookShardOwner(symbol)) {
            recordStreamMessageAcked(streamSeq);
            m.ack();
            markWriterProcessEnd();
            continue;
          }

          const key = payload.event_key;
          if (!key) {
            spotOrderbookWriterDroppedTotal.inc({ shard: shardLabel(), reason: 'no_event_key' });
            recordStreamMessageAcked(streamSeq);
            m.ack();
            markWriterProcessEnd();
            continue;
          }

          const fresh = await consumeMatchEventKeyDistributed(key);
          if (!fresh) {
            spotOrderbookWriterDroppedTotal.inc({ shard: shardLabel(), reason: 'dedup' });
            recordStreamMessageAcked(streamSeq);
            m.ack();
            markWriterProcessEnd();
            continue;
          }

          checkWriterSeqGap(symbol, payload);
          processMatchPayload(payload);
          setLastEventKey(symbol, key);

          recordStreamMessageAcked(streamSeq);
          m.ack();
          markWriterProcessEnd();

          const elapsedSec = Number(process.hrtime.bigint() - t0) / 1e9;
          spotOrderbookWriterProcessSeconds.labels(shardLabel()).observe(elapsedSec);
        } catch (e) {
          writerLog.warn('message error', { err: e instanceof Error ? e.message : String(e) });
          m.nak();
          markWriterProcessEnd();
        }
      }
    } catch (e) {
      writerLog.error('iterator ended', { err: e instanceof Error ? e.message : String(e) });
    }
  })();

  return async () => {
    writerLoopAbort = true;
    if (writerPullTimer) {
      clearTimeout(writerPullTimer);
      writerPullTimer = null;
    }
    if (writerMetricsTimer) {
      clearInterval(writerMetricsTimer);
      writerMetricsTimer = null;
    }
    try {
      await sub.unsubscribe();
    } catch (e) {
      writerLog.warn('unsubscribe', { err: e instanceof Error ? e.message : String(e) });
    }
  };
}

async function stopPullConsumer(): Promise<void> {
  writerLoopAbort = true;
  if (writerPullTimer) {
    clearTimeout(writerPullTimer);
    writerPullTimer = null;
  }
  if (writerMetricsTimer) {
    clearInterval(writerMetricsTimer);
    writerMetricsTimer = null;
  }
  if (consumerStop) {
    await consumerStop();
    consumerStop = null;
  }
  writerLoopAbort = false;
}

async function syncLeadershipAndConsumer(js: NonNullable<ReturnType<typeof tryGetJetStream>>): Promise<void> {
  if (syncLeadershipRunning) return;
  syncLeadershipRunning = true;
  try {
    if (writerShutdown) return;
    const hold =
      !config.nats.writerLeaderElection || (await renewOrAcquireOrderbookWriterLeadership());
    if (!hold) {
      if (consumerStop) {
        await stopPullConsumer();
      }
      return;
    }
    if (!consumerStop) {
      consumerStop = await mountPullConsumer(js);
    }
  } catch (e) {
    writerLog.warn('sync leadership/consumer', { err: e instanceof Error ? e.message : String(e) });
  } finally {
    syncLeadershipRunning = false;
  }
}

export async function startSpotOrderbookWriter(): Promise<void> {
  if (!config.nats.orderbookWriterEnabled) return;
  if (!isNatsSpotPipelineConfigured()) {
    writerLog.warn('ORDERBOOK_WRITER enabled but NATS_URL / NATS_SPOT_PIPELINE_ENABLED missing');
    return;
  }
  writerShutdown = false;
  pullState.ms = config.nats.writerPullMsFast;
  pullState.pendingHigh = false;

  await loadWriterSnapshotIfPresent();
  await ensureNatsJetStreamReady();
  const js = tryGetJetStream();
  if (!js) {
    writerLog.error('JetStream not available');
    return;
  }

  const renewMs = Math.max(500, Math.floor(config.nats.writerLeaderTtlMs / 3));
  await syncLeadershipAndConsumer(js);
  leaderTickInterval = setInterval(() => {
    void syncLeadershipAndConsumer(js);
  }, renewMs);

  const snapMs = config.nats.snapshotIntervalMs;
  const interval = snapMs > 0 ? Math.max(5000, snapMs) : 60_000;
  writerTimer = setInterval(() => {
    void saveWriterSnapshot().catch((e) =>
      writerLog.warn('snapshot save failed', { err: e instanceof Error ? e.message : String(e) }),
    );
  }, interval);
}

export async function stopSpotOrderbookWriter(): Promise<void> {
  writerShutdown = true;
  if (leaderTickInterval) {
    clearInterval(leaderTickInterval);
    leaderTickInterval = null;
  }
  await stopPullConsumer();
  if (config.nats.writerLeaderElection) {
    await releaseOrderbookWriterLeadership();
  }
  if (writerTimer) {
    clearInterval(writerTimer);
    writerTimer = null;
  }
}
