/**
 * JetStream → WS: forwards pre-serialized spot.orderbook|ticker|trades.* to broadcastSerialized (no L2).
 * Run on API nodes when NATS_WRITER_LOCAL_WS_BROADCAST=false.
 *
 * Priority subjects (writer): spot.orderbook.high.<SYM>, spot.trades.medium.<SYM>, spot.ticker.low.<SYM>
 * Legacy spot.<kind>.<SYM> without tier is parsed with defaults: orderbook→high, trades→medium, ticker→low.
 *
 * Under load, shedding acks messages without broadcasting: tier1 drops LOW (ticker), tier2 drops MEDIUM+LOW.
 * HIGH (orderbook_delta + orderbook_resync) is never dropped.
 */

import { consumerOpts } from 'nats';
import { config } from '../config/index.js';
import { ensureNatsJetStreamReady, tryGetJetStream, getNatsConnection } from './nats.service.js';
import {
  broadcastSerialized,
  getSpotWsBroadcastBacklogBytes,
  stampTradesFeedSeqOnWireIfNeeded,
} from './spot-ws.service.js';
import { logger } from '../lib/logger.js';
import { redis } from '../lib/redis.js';
import {
  spotWsForwarderDecodeMs,
  spotWsForwarderMode,
  spotWsForwarderMessagesDroppedTotal,
  spotWsForwarderPendingSum,
} from '../lib/prometheus-metrics.js';

const STREAM_SPOT_ORDERBOOK = 'SPOT_ORDERBOOK';

type MsgPriority = 'high' | 'medium' | 'low';
type ShedMode = 0 | 1 | 2;

let forwarderAbort = false;
const pullTimers: ReturnType<typeof setInterval>[] = [];
let telemetryTimer: ReturnType<typeof setInterval> | null = null;

/** Updated by telemetry interval; read on message path (same thread). */
let currentShedMode: ShedMode = 0;

const TIER_SET = new Set<string>(['high', 'medium', 'low']);

function durableSanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
}

function forwarderDurable(suffix: string): string {
  return durableSanitize(`ws-fwd-${suffix}-${config.nodeId}`);
}

function parseBroadcastSubject(subject: string): { channel: string; priority: MsgPriority } | null {
  const defs: Array<{ prefix: string; legacyDefault: MsgPriority; channelPrefix: string }> = [
    { prefix: 'spot.orderbook.', legacyDefault: 'high', channelPrefix: 'orderbook:' },
    { prefix: 'spot.ticker.', legacyDefault: 'low', channelPrefix: 'ticker:' },
    { prefix: 'spot.trades.', legacyDefault: 'medium', channelPrefix: 'trades:' },
  ];
  for (const d of defs) {
    if (!subject.startsWith(d.prefix)) continue;
    const rest = subject.slice(d.prefix.length);
    const dot = rest.indexOf('.');
    let priority: MsgPriority = d.legacyDefault;
    let sym = rest;
    if (dot !== -1) {
      const head = rest.slice(0, dot);
      if (TIER_SET.has(head)) {
        priority = head as MsgPriority;
        sym = rest.slice(dot + 1);
      }
    }
    if (!sym) return null;
    // Always treat orderbook (delta + resync) as HIGH so shedding never drops book recovery paths.
    const outPriority: MsgPriority = d.channelPrefix === 'orderbook:' ? 'high' : priority;
    return { channel: `${d.channelPrefix}${sym}`, priority: outPriority };
  }
  return null;
}

function shouldDrop(priority: MsgPriority, mode: ShedMode): boolean {
  if (priority === 'high') return false;
  if (mode === 0) return false;
  if (mode === 1) return priority === 'low';
  return true;
}

async function refreshShedTelemetry(durables: string[]): Promise<void> {
  const cfg = config.wsForwarderShed;
  const instance = config.nodeId;
  let pendingSum = 0;
  try {
    const nc = getNatsConnection();
    const jsm = await nc.jetstreamManager();
    for (const d of durables) {
      try {
        const info = await jsm.consumers.info(STREAM_SPOT_ORDERBOOK, d);
        pendingSum += info.num_pending;
      } catch {
        /* consumer may not exist yet */
      }
    }
  } catch {
    /* NATS unavailable */
  }
  spotWsForwarderPendingSum.labels(instance).set(pendingSum);

  let maxWriterLag = 0;
  let sumWriterPending = 0;
  for (let s = 0; s < config.nats.shardTotal; s++) {
    try {
      const raw = await redis.get(`spot:pub:writer_health:${s}`);
      if (!raw) continue;
      const j = JSON.parse(raw) as { lag_ms?: number; pending?: number };
      maxWriterLag = Math.max(maxWriterLag, Number(j.lag_ms) || 0);
      sumWriterPending += Number(j.pending) || 0;
    } catch {
      /* ignore */
    }
  }

  const backlog = getSpotWsBroadcastBacklogBytes();
  const pendingMetric = Math.max(pendingSum, sumWriterPending);

  let mode: ShedMode = 0;
  if (cfg.enabled) {
    const hit2 =
      (cfg.tier2Pending > 0 && pendingMetric >= cfg.tier2Pending) ||
      (cfg.tier2LagMs > 0 && maxWriterLag >= cfg.tier2LagMs) ||
      (cfg.tier2BacklogBytes > 0 && backlog >= cfg.tier2BacklogBytes);
    const hit1 =
      (cfg.tier1Pending > 0 && pendingMetric >= cfg.tier1Pending) ||
      (cfg.tier1LagMs > 0 && maxWriterLag >= cfg.tier1LagMs) ||
      (cfg.tier1BacklogBytes > 0 && backlog >= cfg.tier1BacklogBytes);
    if (hit2) mode = 2;
    else if (hit1) mode = 1;
  }
  currentShedMode = mode;
  spotWsForwarderMode.labels(instance).set(mode);
}

function startOneForwarder(
  js: NonNullable<ReturnType<typeof tryGetJetStream>>,
  filter: string,
  durableSuffix: string
): void {
  const opts = consumerOpts();
  opts.durable(forwarderDurable(durableSuffix));
  opts.manualAck();
  opts.ackExplicit();
  opts.deliverNew();
  opts.filterSubject(filter);

  void (async () => {
    let sub: Awaited<ReturnType<typeof js.pullSubscribe>>;
    try {
      sub = await js.pullSubscribe(filter, opts);
    } catch (e) {
      logger.error('WS NATS forwarder: pullSubscribe failed', {
        err: e instanceof Error ? e.message : String(e),
        filter,
      });
      return;
    }

    void (async () => {
      try {
        for await (const m of sub) {
          if (forwarderAbort) {
            m.term();
            break;
          }
          try {
            const parsed = parseBroadcastSubject(m.subject);
            if (!parsed) {
              m.ack();
              continue;
            }
            const mode = currentShedMode;
            if (shouldDrop(parsed.priority, mode)) {
              spotWsForwarderMessagesDroppedTotal.labels(parsed.priority).inc();
              m.ack();
              continue;
            }
            const t0 = performance.now();
            const rawStr = Buffer.from(m.data).toString('utf8');
            const payload = stampTradesFeedSeqOnWireIfNeeded(parsed.channel, rawStr);
            broadcastSerialized(parsed.channel, payload);
            spotWsForwarderDecodeMs.labels(config.nodeId).set(performance.now() - t0);
            m.ack();
          } catch (e) {
            logger.warn('WS NATS forwarder: message error', { err: e instanceof Error ? e.message : String(e) });
            m.nak();
          }
        }
      } catch (e) {
        logger.error('WS NATS forwarder iterator ended', {
          err: e instanceof Error ? e.message : String(e),
          filter,
        });
      }
    })();

    const t = setInterval(() => {
      if (forwarderAbort) return;
      try {
        sub.pull({ batch: 32, expires: 500 });
      } catch (e) {
        logger.warn('WS NATS forwarder pull failed', {
          err: e instanceof Error ? e.message : String(e),
          filter,
        });
      }
    }, 150);
    pullTimers.push(t);
  })();
}

export async function startSpotWsNatsOrderbookForwarder(): Promise<void> {
  if (!config.nats.wsOrderbookForwarderEnabled) return;
  if (config.nats.writerLocalWsBroadcast) {
    logger.info('WS NATS forwarder skipped (NATS_WRITER_LOCAL_WS_BROADCAST=true)');
    return;
  }
  if (!config.nats.url) return;

  forwarderAbort = false;
  currentShedMode = 0;
  await ensureNatsJetStreamReady();
  const js = tryGetJetStream();
  if (!js) {
    logger.warn('WS NATS forwarder: JetStream unavailable');
    return;
  }

  const dOb = forwarderDurable('ob');
  const dTk = forwarderDurable('tk');
  const dTr = forwarderDurable('tr');
  const durables = [dOb, dTk, dTr];

  startOneForwarder(js, 'spot.orderbook.>', 'ob');
  startOneForwarder(js, 'spot.ticker.>', 'tk');
  startOneForwarder(js, 'spot.trades.>', 'tr');

  const telMs = config.wsForwarderShed.telemetryMs;
  void refreshShedTelemetry(durables);
  telemetryTimer = setInterval(() => {
    void refreshShedTelemetry(durables);
  }, telMs);

  logger.info('Spot WS NATS forwarder pull consumers started', {
    shed_enabled: config.wsForwarderShed.enabled,
    telemetry_ms: telMs,
  });
}

export function stopSpotWsNatsOrderbookForwarder(): void {
  forwarderAbort = true;
  if (telemetryTimer) {
    clearInterval(telemetryTimer);
    telemetryTimer = null;
  }
  for (const t of pullTimers) clearInterval(t);
  pullTimers.length = 0;
}
