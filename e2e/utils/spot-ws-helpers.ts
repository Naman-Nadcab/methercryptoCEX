/**
 * Spot WebSocket helpers for Tier-1 E2E (auth + subscribe + collect).
 * Auth: `{ type: 'auth', data: { token } }` (JWT).
 */
import { config } from '../config.js';

export type WsCtor = new (url: string) => {
  on(ev: string, fn: (...a: unknown[]) => void): void;
  send(d: string): void;
  close(): void;
};

export async function getSpotWebSocketClass(): Promise<WsCtor | null> {
  try {
    const mod = await import('ws');
    const Ws = (mod.default ?? mod) as WsCtor;
    if (typeof Ws === 'function') return Ws;
  } catch {
    //
  }
  if (typeof WebSocket !== 'undefined') {
    const G = WebSocket as unknown as new (url: string) => {
      addEventListener(ev: string, fn: () => void): void;
      send(d: string): void;
      close(): void;
    };
    return function NodeWs(url: string) {
      const w = new G(url);
      return {
        on(ev: string, fn: (..._a: unknown[]) => void) {
          w.addEventListener(ev, fn as () => void);
        },
        send: w.send.bind(w),
        close: w.close.bind(w),
      };
    } as unknown as WsCtor;
  }
  return null;
}

export function spotWsUrl(): string {
  return config.baseUrl.replace(/^http/, 'ws') + '/api/v1/spot/ws';
}

export type SpotWsInbound = {
  type?: string;
  channel?: string;
  data?: unknown;
  timestamp?: number;
};

export class SpotWsSession {
  readonly messages: SpotWsInbound[] = [];
  private ws: InstanceType<WsCtor> | null = null;
  private readonly url: string;

  constructor(url?: string) {
    this.url = url ?? spotWsUrl();
  }

  async connect(Ws: WsCtor): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const w = new Ws(this.url);
      this.ws = w;
      const to = setTimeout(() => reject(new Error('WS open timeout')), config.timeoutMs);
      w.on('open', () => {
        clearTimeout(to);
        resolve();
      });
      w.on('error', (e: Error) => {
        clearTimeout(to);
        reject(e);
      });
      w.on('message', (buf: Buffer | string) => {
        try {
          const raw = typeof buf === 'string' ? buf : buf.toString();
          const msg = JSON.parse(raw) as SpotWsInbound;
          this.messages.push(msg);
        } catch {
          //
        }
      });
    });
  }

  send(obj: unknown): void {
    this.ws?.send(JSON.stringify(obj));
  }

  close(): void {
    try {
      this.ws?.close();
    } catch {
      //
    }
    this.ws = null;
  }

  async auth(token: string): Promise<boolean> {
    const deadline = Date.now() + config.timeoutMs;
    const n0 = this.messages.length;
    this.send({ type: 'auth', data: { token } });
    while (Date.now() < deadline) {
      for (let i = n0; i < this.messages.length; i++) {
        const m = this.messages[i];
        if (m?.type === 'auth_result') return (m as { success?: boolean }).success === true;
      }
      await new Promise((r) => setTimeout(r, 40));
    }
    return false;
  }

  subscribe(channel: string): void {
    this.send({ type: 'subscribe', channel });
  }

  async waitSubscribed(channels: string[], timeoutMs: number): Promise<boolean> {
    const need = new Set(channels);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      for (const m of this.messages) {
        if (m.type === 'subscribed' && typeof m.channel === 'string' && need.has(m.channel)) {
          need.delete(m.channel);
        }
      }
      if (need.size === 0) return true;
      await new Promise((r) => setTimeout(r, 40));
    }
    return false;
  }

  waitFor(pred: (m: SpotWsInbound) => boolean, timeoutMs: number): Promise<SpotWsInbound | null> {
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve) => {
      const tick = () => {
        for (const m of this.messages) {
          if (pred(m)) {
            resolve(m);
            return;
          }
        }
        if (Date.now() >= deadline) {
          resolve(null);
          return;
        }
        setTimeout(tick, 35);
      };
      tick();
    });
  }
}
