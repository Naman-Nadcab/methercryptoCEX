/**
 * Unified Real-Time Client — manages both admin WS channels with:
 *   - Automatic reconnect with exponential backoff
 *   - Heartbeat (ping/pong) to detect stale connections
 *   - Typed event subscriptions
 *   - Connection state tracking
 *   - Fallback flag for polling when WS is down
 */

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

export type MetricsEventType =
  | 'connected'
  | 'trade_executed'
  | 'order_created'
  | 'deposit_confirmed'
  | 'withdrawal_requested'
  | 'p2p_order_created'
  | 'aml_alert_triggered';

export type ControlEventType =
  | 'connected'
  | 'control_status_changed'
  | 'emergency_level_changed'
  | 'incident_created'
  | 'service_restarted'
  | 'liquidity_kill_activated'
  | 'health_score_updated'
  | 'timeline_event';

export type RealtimeEventType = MetricsEventType | ControlEventType;

export interface RealtimeEvent {
  channel: 'metrics' | 'control';
  type: string;
  data: Record<string, unknown>;
  timestamp: number;
}

type EventHandler = (event: RealtimeEvent) => void;
type StateHandler = (state: ConnectionState) => void;

interface ChannelState {
  ws: WebSocket | null;
  state: ConnectionState;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  reconnectAttempt: number;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  lastPong: number;
}

const HEARTBEAT_INTERVAL = 25000;
const HEARTBEAT_TIMEOUT = 10000;
const MIN_RECONNECT_MS = 1000;
const MAX_RECONNECT_MS = 30000;
const BACKOFF_FACTOR = 1.5;

function getWsBaseUrl(): string {
  if (typeof window === 'undefined') return '';
  const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000').replace(/\/$/, '');
  try {
    const url = new URL(apiBase);
    const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${url.host}`;
  } catch {
    return 'ws://localhost:4000';
  }
}

function getBackoffMs(attempt: number): number {
  return Math.min(MAX_RECONNECT_MS, MIN_RECONNECT_MS * Math.pow(BACKOFF_FACTOR, attempt));
}

class RealtimeClient {
  private token: string | null = null;
  private eventHandlers = new Set<EventHandler>();
  private stateHandlers = new Set<StateHandler>();
  private channels: Record<'metrics' | 'control', ChannelState> = {
    metrics: { ws: null, state: 'disconnected', reconnectTimer: null, reconnectAttempt: 0, heartbeatTimer: null, lastPong: 0 },
    control: { ws: null, state: 'disconnected', reconnectTimer: null, reconnectAttempt: 0, heartbeatTimer: null, lastPong: 0 },
  };
  private _shouldFallbackToPoll = false;
  private _destroyed = false;

  /**
   * Initialize with an auth token and connect both channels.
   */
  connect(token: string): void {
    if (!token || typeof window === 'undefined') return;
    this.token = token;
    this._destroyed = false;
    this._shouldFallbackToPoll = false;
    this.connectChannel('metrics', '/api/v1/admin/ws/metrics');
    this.connectChannel('control', '/api/v1/admin/ws/events');
  }

  /**
   * Disconnect everything.
   */
  disconnect(): void {
    this._destroyed = true;
    this.disconnectChannel('metrics');
    this.disconnectChannel('control');
    this.token = null;
  }

  /**
   * Subscribe to all realtime events. Returns unsubscribe function.
   */
  onEvent(handler: EventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => { this.eventHandlers.delete(handler); };
  }

  /**
   * Subscribe to connection state changes. Returns unsubscribe function.
   */
  onStateChange(handler: StateHandler): () => void {
    this.stateHandlers.add(handler);
    return () => { this.stateHandlers.delete(handler); };
  }

  /**
   * Get overall connection state (worst of both channels).
   */
  getState(): ConnectionState {
    const m = this.channels.metrics.state;
    const c = this.channels.control.state;
    if (m === 'disconnected' || c === 'disconnected') return 'disconnected';
    if (m === 'reconnecting' || c === 'reconnecting') return 'reconnecting';
    if (m === 'connecting' || c === 'connecting') return 'connecting';
    return 'connected';
  }

  /**
   * Whether the client should fall back to HTTP polling (WS failed multiple times).
   */
  get shouldFallbackToPoll(): boolean {
    return this._shouldFallbackToPoll;
  }

  /* ---- Private ---- */

  private connectChannel(name: 'metrics' | 'control', path: string): void {
    const ch = this.channels[name];
    if (ch.ws) return;
    if (!this.token) return;

    const base = getWsBaseUrl();
    if (!base) return;

    const url = `${base}${path}?token=${encodeURIComponent(this.token)}`;
    this.setChannelState(name, 'connecting');

    try {
      const ws = new WebSocket(url);
      ch.ws = ws;

      ws.onopen = () => {
        if (this._destroyed) { ws.close(); return; }
        ch.reconnectAttempt = 0;
        ch.lastPong = Date.now();
        this._shouldFallbackToPoll = false;
        this.setChannelState(name, 'connected');
        this.startHeartbeat(name);
      };

      ws.onmessage = (event) => {
        try {
          const raw = JSON.parse(event.data as string);

          // Handle pong
          if (raw.type === 'pong' || raw.event === 'pong') {
            ch.lastPong = Date.now();
            return;
          }

          // Normalize event shape
          const realtimeEvent: RealtimeEvent = {
            channel: name,
            type: raw.type ?? raw.event ?? 'unknown',
            data: raw.data ?? raw.payload ?? {},
            timestamp: raw.timestamp ?? Date.now(),
          };

          if (realtimeEvent.type === 'connected' || realtimeEvent.type === 'error') return;

          Array.from(this.eventHandlers).forEach((handler) => {
            try { handler(realtimeEvent); } catch { /* skip */ }
          });
        } catch {
          // invalid JSON
        }
      };

      ws.onclose = () => {
        ch.ws = null;
        this.stopHeartbeat(name);
        if (!this._destroyed) {
          this.scheduleReconnect(name, path);
        } else {
          this.setChannelState(name, 'disconnected');
        }
      };

      ws.onerror = () => {
        // onclose will fire after this
      };
    } catch {
      ch.ws = null;
      if (!this._destroyed) {
        this.scheduleReconnect(name, path);
      }
    }
  }

  private disconnectChannel(name: 'metrics' | 'control'): void {
    const ch = this.channels[name];
    if (ch.reconnectTimer) { clearTimeout(ch.reconnectTimer); ch.reconnectTimer = null; }
    this.stopHeartbeat(name);
    if (ch.ws) {
      try { ch.ws.close(); } catch { /* skip */ }
      ch.ws = null;
    }
    ch.reconnectAttempt = 0;
    this.setChannelState(name, 'disconnected');
  }

  private scheduleReconnect(name: 'metrics' | 'control', path: string): void {
    const ch = this.channels[name];
    ch.reconnectAttempt++;

    if (ch.reconnectAttempt > 10) {
      this._shouldFallbackToPoll = true;
    }

    const delay = getBackoffMs(ch.reconnectAttempt);
    this.setChannelState(name, 'reconnecting');

    ch.reconnectTimer = setTimeout(() => {
      ch.reconnectTimer = null;
      if (!this._destroyed) {
        this.connectChannel(name, path);
      }
    }, delay);
  }

  private startHeartbeat(name: 'metrics' | 'control'): void {
    const ch = this.channels[name];
    this.stopHeartbeat(name);

    ch.heartbeatTimer = setInterval(() => {
      if (!ch.ws || ch.ws.readyState !== WebSocket.OPEN) return;

      // Check if last pong was too long ago
      if (ch.lastPong > 0 && Date.now() - ch.lastPong > HEARTBEAT_INTERVAL + HEARTBEAT_TIMEOUT) {
        ch.ws.close(4000, 'Heartbeat timeout');
        return;
      }

      try {
        ch.ws.send(JSON.stringify({ type: 'ping' }));
      } catch {
        // will trigger onclose
      }
    }, HEARTBEAT_INTERVAL);
  }

  private stopHeartbeat(name: 'metrics' | 'control'): void {
    const ch = this.channels[name];
    if (ch.heartbeatTimer) {
      clearInterval(ch.heartbeatTimer);
      ch.heartbeatTimer = null;
    }
  }

  private setChannelState(name: 'metrics' | 'control', state: ConnectionState): void {
    this.channels[name].state = state;
    const overall = this.getState();
    Array.from(this.stateHandlers).forEach((handler) => {
      try { handler(overall); } catch { /* skip */ }
    });
  }
}

/** Singleton — one client per browser tab */
export const realtimeClient = new RealtimeClient();
