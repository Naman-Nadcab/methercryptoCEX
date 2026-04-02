/**
 * Fan-out P2P order-scoped events over Spot WS + Redis (same transport as spot broadcast).
 * Channel wire format matches spot: { type, channel, data, timestamp }.
 */

import { config } from '../config/index.js';
import * as spotWs from './spot-ws.service.js';

const PREFIX = 'p2p.order.';

export function p2pOrderWireChannel(orderId: string): string {
  return `${PREFIX}${orderId}`;
}

export function publishP2POrderRoom(orderId: string, eventType: string, data: unknown): void {
  const channel = p2pOrderWireChannel(orderId);
  const wire = spotWs.wireEnvelope(eventType, channel, data);
  try {
    if (config.redis.wsPubSubEnabled) {
      spotWs.publishSpotBroadcastPayload({ channel, wire });
    } else {
      spotWs.broadcastToChannelLocal(channel, wire);
    }
  } catch {
    /* best-effort */
  }
}
