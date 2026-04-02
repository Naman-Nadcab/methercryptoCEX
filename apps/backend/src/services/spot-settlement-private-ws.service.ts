/**
 * After a match is settled in DB, push user.orders + user.trades on private Spot WS.
 * REST place-order path already calls pushSpotUpdates; settlement worker historically did not — E2E Phase 14 and UIs miss FILLED + tape without this.
 */
import { db } from '../lib/database.js';
import { getSpotOrdersUseMarketSync } from '../lib/spot-schema-cache.js';
import { filterUserTrades, type LiveWsTradeRow } from './spot-live-market-state.service.js';
import * as spotWs from './spot-ws.service.js';
import { logger } from '../lib/logger.js';
import { isNatsSpotPipelineConfigured } from './nats.service.js';
import { getSpotTradesShapeSync, loadSpotTradesShape } from '../lib/spot-trades-shape.js';

function displayStatus(status: string): string {
  const s = (status || '').toUpperCase();
  if (s === 'OPEN' || s === 'NEW') return 'Open';
  if (s === 'PARTIALLY_FILLED') return 'Partially Filled';
  if (s === 'FILLED') return 'Filled';
  if (s === 'CANCELLED') return 'Cancelled';
  if (s === 'REJECTED') return 'Rejected';
  if (s === 'PENDING_TRIGGER') return 'Pending Trigger';
  return status || 'Unknown';
}

function tradeRowToWirePayload(t: LiveWsTradeRow): Record<string, unknown> {
  return {
    id: t.id,
    order_id: t.order_id,
    market: t.market,
    side: t.side,
    price: t.price,
    quantity: t.quantity,
    amount: t.amount,
    created_at: t.created_at,
    time: t.time,
    timestamp: t.timestamp,
  };
}

/** When in-memory tape is empty (e.g. NATS-only API), load recent fills from DB (unified spot_trades only). */
async function userTradesWireFromDb(symbol: string, userId: string, limit: number): Promise<Record<string, unknown>[]> {
  let shape = getSpotTradesShapeSync();
  if (!shape) shape = await loadSpotTradesShape();
  if (!shape.hasUserId || !shape.hasMarket) return [];
  try {
    const r = await db.query<{
      id: string;
      order_id: string;
      market: string;
      side: string;
      price: string;
      quantity: string;
      created_at: Date;
    }>(
      `SELECT id::text, order_id::text, market, side, price::text AS price, quantity::text AS quantity, created_at
       FROM spot_trades WHERE user_id = $1::uuid AND UPPER(TRIM(market)) = UPPER(TRIM($2))
       ORDER BY created_at DESC LIMIT $3`,
      [userId, symbol, limit]
    );
    return r.rows.map((row) => {
      const ts = row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at);
      return {
        id: row.id,
        order_id: row.order_id,
        market: row.market,
        side: row.side,
        price: row.price,
        quantity: row.quantity,
        amount: row.quantity,
        created_at: ts,
        time: ts,
        timestamp: row.created_at instanceof Date ? Math.floor(row.created_at.getTime() / 1000) : null,
      };
    });
  } catch {
    return [];
  }
}

async function fetchOrderPayloadForWs(orderId: string): Promise<Record<string, unknown> | null> {
  const useMarket = getSpotOrdersUseMarketSync();
  if (useMarket) {
    const r = await db.query<{
      id: string;
      market: string;
      side: string;
      type: string;
      price: string | null;
      quantity: string;
      filled_quantity: string;
      status: string;
      client_order_id: string | null;
      created_at: Date;
    }>(
      `SELECT id, market, side, type, price::text AS price, quantity::text AS quantity, filled_quantity::text AS filled_quantity,
              status::text AS status, client_order_id, created_at
       FROM spot_orders WHERE id = $1::uuid`,
      [orderId]
    );
    const row = r.rows[0];
    if (!row) return null;
    const st = String(row.status ?? '').trim();
    return {
      ...row,
      status: st,
      created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
      displayStatus: displayStatus(st),
    };
  }
  const r = await db.query<{
    id: string;
    market: string;
    side: string;
    type: string;
    price: string | null;
    quantity: string;
    filled_quantity: string;
    status: string;
    client_order_id: string | null;
    created_at: Date;
  }>(
    `SELECT o.id, tp.symbol AS market, o.side::text AS side, o.order_type::text AS type, o.price::text AS price,
            o.quantity::text AS quantity, o.filled_quantity::text AS filled_quantity, o.status::text AS status,
            o.client_order_id, o.created_at
     FROM spot_orders o
     JOIN trading_pairs tp ON tp.id = o.trading_pair_id
     WHERE o.id = $1::uuid`,
    [orderId]
  );
  const row = r.rows[0];
  if (!row) return null;
  const st = String(row.status ?? '').trim();
  return {
    ...row,
    status: st,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    displayStatus: displayStatus(st),
  };
}

export async function notifySpotPrivateChannelsAfterSettlement(params: {
  symbol: string;
  takerOrderId: string;
  makerOrderId: string;
  takerUserId: string;
  makerUserId: string;
}): Promise<void> {
  const { symbol, takerOrderId, makerOrderId, takerUserId, makerUserId } = params;
  try {
    const [tPayload, mPayload] = await Promise.all([
      fetchOrderPayloadForWs(takerOrderId),
      fetchOrderPayloadForWs(makerOrderId),
    ]);
    if (!tPayload || !mPayload) {
      logger.warn('notifySpotPrivateChannelsAfterSettlement: missing order row', {
        takerOrderId,
        makerOrderId,
        hasTaker: Boolean(tPayload),
        hasMaker: Boolean(mPayload),
      });
      return;
    }

    const sendForUser = async (userId: string, orderPayload: Record<string, unknown>) => {
      spotWs.sendToUserSerialized(
        userId,
        'user.orders',
        spotWs.wireEnvelope('order_update', 'user.orders', orderPayload)
      );
      let tapeRows: LiveWsTradeRow[] = filterUserTrades(symbol, userId, 10);
      let wire: Record<string, unknown>[];
      if (tapeRows.length > 0) {
        wire = tapeRows.map(tradeRowToWirePayload);
      } else {
        wire = await userTradesWireFromDb(symbol, userId, 10);
      }
      spotWs.sendToUserSerialized(userId, 'user.trades', spotWs.wireEnvelope('trade', 'user.trades', wire));
    };

    await sendForUser(takerUserId, tPayload);
    await sendForUser(makerUserId, mPayload);
  } catch (e) {
    logger.warn('notifySpotPrivateChannelsAfterSettlement failed (best-effort)', {
      error: e instanceof Error ? e.message : String(e),
      symbol,
    });
  }
}
