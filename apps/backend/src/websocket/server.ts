import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage, Server } from 'http';
import { URL } from 'url';
import { redis } from '../lib/redis.js';
import { isSessionValid } from '../services/session.service.js';
import { logger, securityLog } from '../lib/logger.js';
import { consumeWsTicket } from '../services/ws-ticket.service.js';
import { resolvePublicOrderbookSnapshot } from '../services/spot-orderbook-public.service.js';
import { getClientIpFromIncomingMessage } from '../lib/client-ip.js';

interface WSClient extends WebSocket {
  id: string;
  userId?: string;
  subscriptions: Set<string>;
  isAlive: boolean;
  lastPing: number;
  connectIp: string;
}

interface WSMessage {
  type: string;
  channel?: string;
  data?: unknown;
}

class WebSocketManager {
  private wss: WebSocketServer | null = null;
  private clients: Map<string, WSClient> = new Map();
  /** Simple per-client message rate limit (M3): max messages per window */
  private wsMsgBuckets: Map<string, { count: number; resetAt: number }> = new Map();
  private static readonly WS_MSG_WINDOW_MS = 10_000;
  private static readonly WS_MSG_MAX_PER_WINDOW = 40;
  private userClients: Map<string, Set<string>> = new Map(); // userId -> clientIds
  private channelSubscribers: Map<string, Set<string>> = new Map(); // channel -> clientIds
  private heartbeatInterval: NodeJS.Timeout | null = null;

  /**
   * Initialize WebSocket server
   */
  initialize(server: Server): void {
    this.wss = new WebSocketServer({
      server,
      path: '/api/v1/spot/ws',
      maxPayload: 64 * 1024, // 64 KiB — mitigates large-frame DoS (M3)
    });

    this.wss.on('connection', this.handleConnection.bind(this));
    this.wss.on('error', (error) => {
      logger.error('WebSocket server error', { error: error.message });
    });

    // Start heartbeat
    this.heartbeatInterval = setInterval(() => {
      this.heartbeat();
    }, 30000); // 30 seconds

    // Subscribe to Redis channels for cross-instance communication
    this.subscribeToRedisChannels();

    logger.info('WebSocket server initialized');
  }

  /**
   * Handle new connection
   */
  private handleConnection(ws: WebSocket, request: IncomingMessage): void {
    const client = ws as WSClient;
    client.id = this.generateClientId();
    client.subscriptions = new Set();
    client.isAlive = true;
    client.lastPing = Date.now();
    client.connectIp = getClientIpFromIncomingMessage(request);

    const url = new URL(request.url || '', `http://${request.headers.host}`);
    if (url.searchParams.has('token')) {
      ws.close(1008, 'JWT query param is not permitted');
      return;
    }

    this.clients.set(client.id, client);

    // Setup event handlers
    client.on('message', (data) => this.handleMessage(client, data));
    client.on('close', () => this.handleClose(client));
    client.on('error', (error) => this.handleError(client, error));
    client.on('pong', () => {
      client.isAlive = true;
      client.lastPing = Date.now();
    });

    // Send welcome message (consistent format: type, channel?, data, timestamp)
    this.send(client, {
      type: 'connected',
      channel: undefined,
      data: {
        clientId: client.id,
        authenticated: !!client.userId,
      },
    });

    logger.debug('WebSocket client connected', { 
      clientId: client.id,
      authenticated: !!client.userId,
    });
  }

  /**
   * Handle incoming message
   */
  private consumeWsMessageBudget(client: WSClient): boolean {
    const now = Date.now();
    let b = this.wsMsgBuckets.get(client.id);
    if (!b || now >= b.resetAt) {
      b = { count: 0, resetAt: now + WebSocketManager.WS_MSG_WINDOW_MS };
      this.wsMsgBuckets.set(client.id, b);
    }
    b.count += 1;
    return b.count <= WebSocketManager.WS_MSG_MAX_PER_WINDOW;
  }

  private async handleMessage(client: WSClient, data: WebSocket.RawData): Promise<void> {
    try {
      const message = JSON.parse(data.toString()) as WSMessage;

      if (!this.consumeWsMessageBudget(client)) {
        this.send(client, { type: 'error', data: { message: 'Too many messages; slow down' } });
        return;
      }

      switch (message.type) {
        case 'ping':
          this.send(client, { type: 'pong', data: { timestamp: Date.now() } });
          break;

        case 'subscribe':
          if (message.channel) {
            await this.handleSubscribe(client, message.channel);
          }
          break;

        case 'unsubscribe':
          if (message.channel) {
            this.handleUnsubscribe(client, message.channel);
          }
          break;

        case 'auth':
          if (message.data && typeof message.data === 'object' && 'ticket' in message.data) {
            const ticket =
              typeof (message.data as { ticket?: string }).ticket === 'string'
                ? (message.data as { ticket: string }).ticket.trim()
                : '';
            if (!ticket) {
              this.send(client, { type: 'auth_result', data: { success: false, error: 'ticket_required' } });
              break;
            }
            const consumed = await consumeWsTicket(ticket, client.connectIp, 'spot');
            if (!consumed.ok || !consumed.userId || !consumed.userSessionId) {
              this.send(client, { type: 'auth_result', data: { success: false, error: 'invalid_ticket' } });
              break;
            }
            const valid = await isSessionValid(consumed.userSessionId);
            if (!valid) {
              this.send(client, { type: 'auth_result', data: { success: false, error: 'session_invalid' } });
              break;
            }
            const uid = consumed.userId;
            client.userId = uid;
            if (!this.userClients.has(uid)) {
              this.userClients.set(uid, new Set());
            }
            this.userClients.get(uid)!.add(client.id);
            this.subscribeToChannel(client, `user:${uid}:orders`);
            this.subscribeToChannel(client, `user:${uid}:balances`);
            this.send(client, { type: 'auth_result', data: { success: true } });
          }
          break;

        default:
          logger.debug('Unknown WebSocket message type', {
            clientId: client.id,
            type: message.type,
          });
      }
    } catch (error) {
      logger.error('Failed to handle WebSocket message', {
        clientId: client.id,
        error: error instanceof Error ? error.message : 'Unknown',
      });
    }
  }

  /**
   * Handle channel subscription
   */
  private async handleSubscribe(client: WSClient, channel: string): Promise<void> {
    // Validate channel access
    if (!this.canAccessChannel(client, channel)) {
      this.send(client, {
        type: 'error',
        data: { message: 'Access denied to channel', channel },
      });
      return;
    }

    this.subscribeToChannel(client, channel);

    // Send initial data for certain channels
    if (channel.startsWith('orderbook:')) {
      const sym = channel.split(':')[1];
      if (sym) {
        const orderbook = await resolvePublicOrderbookSnapshot(sym, 50);
        this.send(client, {
          type: 'orderbook_snapshot',
          channel,
          data: orderbook,
        });
      }
    }

    this.send(client, {
      type: 'subscribed',
      data: { channel },
    });
  }

  /**
   * Handle channel unsubscription
   */
  private handleUnsubscribe(client: WSClient, channel: string): void {
    client.subscriptions.delete(channel);
    
    const subscribers = this.channelSubscribers.get(channel);
    if (subscribers) {
      subscribers.delete(client.id);
      if (subscribers.size === 0) {
        this.channelSubscribers.delete(channel);
      }
    }

    this.send(client, {
      type: 'unsubscribed',
      data: { channel },
    });
  }

  /**
   * Subscribe client to channel
   */
  private subscribeToChannel(client: WSClient, channel: string): void {
    client.subscriptions.add(channel);
    
    if (!this.channelSubscribers.has(channel)) {
      this.channelSubscribers.set(channel, new Set());
    }
    this.channelSubscribers.get(channel)!.add(client.id);
  }

  /**
   * Check if client can access channel
   */
  private canAccessChannel(client: WSClient, channel: string): boolean {
    // Public channels
    if (channel.startsWith('orderbook:') || 
        channel.startsWith('trades:') || 
        channel.startsWith('ticker:')) {
      return true;
    }

    // User-specific channels require authentication
    if (channel.startsWith('user:')) {
      if (!client.userId) {
        return false;
      }
      const channelUserId = channel.split(':')[1];
      return channelUserId === client.userId;
    }

    return false;
  }

  /**
   * Handle client close
   */
  private handleClose(client: WSClient): void {
    // Remove from all channels
    for (const channel of client.subscriptions) {
      const subscribers = this.channelSubscribers.get(channel);
      if (subscribers) {
        subscribers.delete(client.id);
        if (subscribers.size === 0) {
          this.channelSubscribers.delete(channel);
        }
      }
    }

    // Remove from user clients
    if (client.userId) {
      const userClientSet = this.userClients.get(client.userId);
      if (userClientSet) {
        userClientSet.delete(client.id);
        if (userClientSet.size === 0) {
          this.userClients.delete(client.userId);
        }
      }
    }

    this.clients.delete(client.id);
    this.wsMsgBuckets.delete(client.id);

    logger.debug('WebSocket client disconnected', { clientId: client.id });
  }

  /**
   * Handle client error
   */
  private handleError(client: WSClient, error: Error): void {
    logger.error('WebSocket client error', {
      clientId: client.id,
      error: error.message,
    });
  }

  /**
   * Send message to client
   */
  private send(client: WSClient, message: WSMessage): void {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(JSON.stringify({
          ...message,
          timestamp: Date.now(),
        }));
      } catch (error) {
        logger.error('Failed to send WebSocket message', {
          clientId: client.id,
          error: error instanceof Error ? error.message : 'Unknown',
        });
      }
    }
  }

  /**
   * Broadcast to channel
   */
  broadcast(channel: string, message: WSMessage): void {
    const subscribers = this.channelSubscribers.get(channel);
    if (!subscribers || subscribers.size === 0) {
      return;
    }

    const payload = JSON.stringify({
      ...message,
      channel,
      timestamp: Date.now(),
    });

    for (const clientId of subscribers) {
      const client = this.clients.get(clientId);
      if (client && client.readyState === WebSocket.OPEN) {
        try {
          client.send(payload);
        } catch (error) {
          // Will be cleaned up on next heartbeat
        }
      }
    }
  }

  /**
   * Send to specific user
   */
  sendToUser(userId: string, message: WSMessage): void {
    const clientIds = this.userClients.get(userId);
    if (!clientIds || clientIds.size === 0) {
      return;
    }

    for (const clientId of clientIds) {
      const client = this.clients.get(clientId);
      if (client) {
        this.send(client, message);
      }
    }
  }

  /**
   * Heartbeat to clean up dead connections
   */
  private heartbeat(): void {
    for (const [id, client] of this.clients) {
      if (!client.isAlive) {
        logger.debug('Terminating inactive WebSocket client', { clientId: id });
        client.terminate();
        this.handleClose(client);
        continue;
      }

      client.isAlive = false;
      client.ping();
    }
  }

  /**
   * Subscribe to Redis pub/sub for cross-instance communication.
   * Use psubscribe for pattern "orderbook:*" so we receive messages for any pair.
   */
  private subscribeToRedisChannels(): void {
    redis.psubscribe('orderbook:*', (channel, message) => {
      try {
        const data = JSON.parse(message) as { pair?: string; bids?: unknown[]; asks?: unknown[] };
        const pair = data.pair ?? channel.replace(/^orderbook:/, '');
        if (pair) {
          this.broadcast(`orderbook:${pair}`, {
            type: 'orderbook_update',
            channel: `orderbook:${pair}`,
            data: { pair, bids: data.bids ?? [], asks: data.asks ?? [] },
          });
        }
      } catch (error) {
        logger.error('Failed to handle Redis orderbook message', {
          error: error instanceof Error ? error.message : 'Unknown',
        });
      }
    });
  }

  /**
   * Generate unique client ID
   */
  private generateClientId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get connection stats
   */
  getStats(): {
    totalConnections: number;
    authenticatedConnections: number;
    channels: number;
  } {
    let authenticated = 0;
    for (const client of this.clients.values()) {
      if (client.userId) authenticated++;
    }

    return {
      totalConnections: this.clients.size,
      authenticatedConnections: authenticated,
      channels: this.channelSubscribers.size,
    };
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    // Close all connections
    for (const client of this.clients.values()) {
      client.close(1001, 'Server shutting down');
    }

    if (this.wss) {
      await new Promise<void>((resolve) => {
        this.wss!.close(() => resolve());
      });
    }

    logger.info('WebSocket server shut down');
  }
}

export const wsManager = new WebSocketManager();

// Event handlers for broadcasting updates
export function broadcastOrderbookUpdate(pairId: string, data: unknown): void {
  wsManager.broadcast(`orderbook:${pairId}`, {
    type: 'orderbook_update',
    data,
  });
}

export function broadcastTrade(pairId: string, trade: unknown): void {
  wsManager.broadcast(`trades:${pairId}`, {
    type: 'trade',
    data: trade,
  });
}

export function broadcastTicker(pairId: string, ticker: unknown): void {
  wsManager.broadcast(`ticker:${pairId}`, {
    type: 'ticker',
    data: ticker,
  });
}

export function sendOrderUpdate(userId: string, order: unknown): void {
  wsManager.sendToUser(userId, {
    type: 'order_update',
    data: order,
  });
}

export function sendBalanceUpdate(userId: string, balance: unknown): void {
  wsManager.sendToUser(userId, {
    type: 'balance_update',
    data: balance,
  });
}

export function sendP2PUpdate(userId: string, data: unknown): void {
  wsManager.sendToUser(userId, {
    type: 'p2p_update',
    data,
  });
}
