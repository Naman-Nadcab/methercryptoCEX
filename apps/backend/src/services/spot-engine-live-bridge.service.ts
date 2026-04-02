/**
 * Rust engine matches → in-memory L2 + WS (legacy), or NATS spot.match.* (Tier-1 horizontal).
 * Idempotent via consumeEngineEventOnce(match_engine_id, engine_event_id). Match events are persisted to Postgres first (durable log).
 */

import { Decimal } from '../lib/decimal.js';
import { ROUND_DOWN } from './spot-decimal.js';
import { fetchMatchesForEngine, type EngineMatchEvent } from './settlement/engine-client.js';
import { persistEngineMatchEventsWithRetry } from './settlement/match-event-persistence.service.js';
import { removeLiquidity } from './spot-in-memory-orderbook.service.js';
import { consumeEngineEventOnce } from './spot-engine-live-dedup.service.js';
import { applyExecutedTrades } from './spot-live-market-state.service.js';
import { ingestOrderbookFromMemory } from './spot-orderbook-ws-engine.service.js';
import { broadcastPublicSpotFeeds } from './spot-live-ws-fanout.service.js';
import type { ExecutedTrade } from './spot-matching.service.js';
import { isNatsSpotPipelineConfigured } from './nats.service.js';
import { matchPayloadFromEngineEvent, publishSpotMatchPayload } from './spot-match-nats-publisher.service.js';
import { getMatchingEngineInstanceById } from './settlement/matching-engine-registry.js';
import {
  bumpPollCursorForEngine,
  getPollCursorForEngine,
  reconcilePollCursorIfEngineBehind,
} from './settlement/match-poller.js';

export type EngineLiveNotifyPayload = {
  matchEngineId: string;
  engineEventId: number;
  symbol: string;
  price: string;
  qty: string;
  taker_side: 'buy' | 'sell';
  taker_user_id: string;
  maker_user_id: string;
  taker_order_id: string;
  maker_order_id: string;
  base: string;
  quote: string;
  quoteValue: string;
  quote_precision?: number;
};

function buildExecutedTradeFromEngineEvent(
  ev: EngineMatchEvent,
  base: string,
  quote: string,
  quotePrecision: number
): ExecutedTrade {
  const buyerId = ev.taker_side === 'buy' ? ev.taker_user_id : ev.maker_user_id;
  const sellerId = ev.taker_side === 'buy' ? ev.maker_user_id : ev.taker_user_id;
  const quoteValue = new Decimal(ev.price)
    .times(ev.qty)
    .toDecimalPlaces(quotePrecision, ROUND_DOWN)
    .toString();
  return {
    buyerId,
    sellerId,
    baseAsset: base,
    quoteAsset: quote,
    quantity: ev.qty,
    price: ev.price,
    quoteValue,
  };
}

async function advanceCursorAfterFetch(
  matchEngineId: string,
  afterBefore: number,
  last_id: number,
  events: EngineMatchEvent[]
): Promise<void> {
  if (events.length > 0) {
    const maxId = events.reduce((m, e) => (e.event_id > m ? e.event_id : m), afterBefore);
    await bumpPollCursorForEngine(matchEngineId, maxId);
  } else if (last_id > afterBefore) {
    await bumpPollCursorForEngine(matchEngineId, last_id);
  }
}

async function applyOneEngineEvent(
  symbol: string,
  ev: EngineMatchEvent,
  base: string,
  quote: string,
  quotePrecision: number
): Promise<ExecutedTrade | null> {
  if (ev.symbol !== symbol) return null;

  const mid = ev.match_engine_id || 'default';

  if (isNatsSpotPipelineConfigured()) {
    void publishSpotMatchPayload(matchPayloadFromEngineEvent(ev, base, quote, quotePrecision));
    if (!(await consumeEngineEventOnce(mid, ev.event_id))) {
      return buildExecutedTradeFromEngineEvent(ev, base, quote, quotePrecision);
    }
    const trade = buildExecutedTradeFromEngineEvent(ev, base, quote, quotePrecision);
    applyExecutedTrades(symbol, [trade], ev.taker_side);
    return trade;
  }

  if (!(await consumeEngineEventOnce(mid, ev.event_id))) return null;
  const makerSide: 'buy' | 'sell' = ev.taker_side === 'buy' ? 'sell' : 'buy';
  removeLiquidity(symbol, makerSide, ev.price, ev.qty);
  const trade = buildExecutedTradeFromEngineEvent(ev, base, quote, quotePrecision);
  applyExecutedTrades(symbol, [trade], ev.taker_side);
  return trade;
}

type LiveEmitOpts = { emitPublicWs?: boolean; matchEngineId?: string };

/** Pull new engine events once (after place or lag); returns trades applied to live state. */
export async function syncEngineMatchesAfterPlace(
  symbol: string,
  base: string,
  quote: string,
  quotePrecision: number,
  opts?: LiveEmitOpts
): Promise<ExecutedTrade[]> {
  const matchEngineId = opts?.matchEngineId ?? 'default';
  const inst = getMatchingEngineInstanceById(matchEngineId);
  const baseUrl = inst?.baseUrl.replace(/\/$/, '') ?? '';
  if (!baseUrl) {
    throw new Error(`syncEngineMatchesAfterPlace: unknown match_engine_id ${matchEngineId}`);
  }
  let afterId = await getPollCursorForEngine(matchEngineId);
  let { last_id, events } = await fetchMatchesForEngine(baseUrl, afterId, matchEngineId);
  if (events.length === 0 && last_id > 0 && last_id < afterId) {
    const fixed = await reconcilePollCursorIfEngineBehind(matchEngineId, afterId, last_id);
    if (fixed) {
      afterId = last_id;
      ({ last_id, events } = await fetchMatchesForEngine(baseUrl, afterId, matchEngineId));
    }
  }
  if (events.length > 0) {
    await persistEngineMatchEventsWithRetry(events, 'sync_pull');
  }
  await advanceCursorAfterFetch(matchEngineId, afterId, last_id, events);
  const out: ExecutedTrade[] = [];
  for (const ev of events) {
    const t = await applyOneEngineEvent(symbol, ev, base, quote, quotePrecision);
    if (t) out.push(t);
  }
  if (out.length && opts?.emitPublicWs !== false && !isNatsSpotPipelineConfigured()) {
    ingestOrderbookFromMemory(symbol);
    broadcastPublicSpotFeeds(symbol);
  }
  return out;
}

/** Apply matches returned inline from POST /engine/place (when engine supports it). */
export async function applyInlineEngineEvents(
  symbol: string,
  base: string,
  quote: string,
  quotePrecision: number,
  events: EngineMatchEvent[],
  opts?: LiveEmitOpts
): Promise<ExecutedTrade[]> {
  const matchEngineId = opts?.matchEngineId ?? 'default';
  const tagged = events.map((e) => ({ ...e, match_engine_id: e.match_engine_id || matchEngineId }));
  if (tagged.length > 0) {
    await persistEngineMatchEventsWithRetry(tagged, 'rust_inline');
    const maxId = tagged.reduce((m, e) => (e.event_id > m ? e.event_id : m), 0);
    if (maxId > 0) {
      await bumpPollCursorForEngine(matchEngineId, maxId);
    }
  }
  const out: ExecutedTrade[] = [];
  for (const ev of tagged) {
    const t = await applyOneEngineEvent(symbol, ev, base, quote, quotePrecision);
    if (t) out.push(t);
  }
  if (out.length && opts?.emitPublicWs !== false && !isNatsSpotPipelineConfigured()) {
    ingestOrderbookFromMemory(symbol);
    broadcastPublicSpotFeeds(symbol);
  }
  return out;
}

/** Single WS tick after all L2 + tape mutations on the API hot path (Rust + resting). */
export function flushLivePublicOrderbookAndFeeds(symbol: string): void {
  if (isNatsSpotPipelineConfigured()) return;
  ingestOrderbookFromMemory(symbol);
  broadcastPublicSpotFeeds(symbol);
}

/** Post-settlement DB commit: same idempotency as API path (legacy L2); NATS publish only. */
export async function applyCommittedEngineNotify(live: EngineLiveNotifyPayload): Promise<void> {
  if (isNatsSpotPipelineConfigured()) {
    void publishSpotMatchPayload({
      kind: 'match',
      symbol: live.symbol,
      event_key: `engine:${live.matchEngineId}:${live.engineEventId}`,
      timestamp: Date.now(),
      source: 'settlement',
      taker_side: live.taker_side,
      base: live.base,
      quote: live.quote,
      quote_precision: live.quote_precision ?? 8,
      trades: [
        {
          price: live.price,
          quantity: live.qty,
          taker_user_id: live.taker_user_id,
          maker_user_id: live.maker_user_id,
        },
      ],
    });
    return;
  }

  if (!(await consumeEngineEventOnce(live.matchEngineId, live.engineEventId))) return;
  const makerSide: 'buy' | 'sell' = live.taker_side === 'buy' ? 'sell' : 'buy';
  removeLiquidity(live.symbol, makerSide, live.price, live.qty);
  const buyerId = live.taker_side === 'buy' ? live.taker_user_id : live.maker_user_id;
  const sellerId = live.taker_side === 'buy' ? live.maker_user_id : live.taker_user_id;
  applyExecutedTrades(
    live.symbol,
    [
      {
        buyerId,
        sellerId,
        baseAsset: live.base,
        quoteAsset: live.quote,
        quantity: live.qty,
        price: live.price,
        quoteValue: live.quoteValue,
      },
    ],
    live.taker_side
  );
  ingestOrderbookFromMemory(live.symbol);
  broadcastPublicSpotFeeds(live.symbol);
}
