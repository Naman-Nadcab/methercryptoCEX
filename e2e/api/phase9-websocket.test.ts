/**
 * Phase 9 — WebSocket E2E. Connects to /api/v1/spot/ws and subscribes.
 * Uses 'ws' package in Node (has .on() API); optional global WebSocket in browser.
 */
import { config } from '../config.js';

const BASE = config.baseUrl.replace(/^http/, 'ws');
const TIMEOUT = config.timeoutMs;

type WsInstance = { on(ev: string, fn: (...a: unknown[]) => void): void; send(d: string): void; close(): void };
type WsCtor = new (url: string) => WsInstance;

async function getWebSocket(): Promise<WsCtor | null> {
  try {
    const mod = await import('ws');
    const Ws = (mod.default ?? mod) as WsCtor;
    if (typeof Ws === 'function') return Ws;
  } catch {
    //
  }
  if (typeof WebSocket !== 'undefined') {
    const G = WebSocket as unknown as new (url: string) => { addEventListener(ev: string, fn: () => void): void; send(d: string): void; close(): void };
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

export async function runPhase9(): Promise<{ passed: number; failed: number; results: string[] }> {
  const results: string[] = [];
  let passed = 0;
  let failed = 0;
  const WS = await getWebSocket();
  if (!WS) {
    results.push('SKIP: WebSocket (no ws package or WebSocket global)');
    return { passed, failed, results };
  }

  return new Promise((resolve) => {
    const url = `${BASE}/api/v1/spot/ws`;
    const ws = new WS(url);
    const t = setTimeout(() => {
      try {
        ws.close();
      } catch {
        //
      }
      if (!results.some((r) => r.startsWith('PASS: WebSocket'))) {
        results.push('FAIL: WebSocket timeout');
        failed++;
      }
      resolve({ passed, failed, results });
    }, TIMEOUT);

    ws.on('open', () => {
      results.push('PASS: WebSocket connect');
      passed++;
      ws.send(JSON.stringify({ type: 'subscribe', channel: 'orderbook:BTC_USDT' }));
    });
    ws.on('message', (buf: Buffer | string) => {
      try {
        const raw = typeof buf === 'string' ? buf : buf.toString();
        const msg = JSON.parse(raw) as { type?: string };
        if (msg.type === 'subscribed' || msg.type === 'orderbook_snapshot') {
          results.push('PASS: WebSocket subscribe response');
          passed++;
          clearTimeout(t);
          ws.close();
          resolve({ passed, failed, results });
        }
      } catch {
        //
      }
    });
    ws.on('error', (e: Error) => {
      results.push(`FAIL: WebSocket ${e.message}`);
      failed++;
      clearTimeout(t);
      resolve({ passed, failed, results });
    });
    ws.on('close', () => {
      clearTimeout(t);
      if (results.filter((r) => r.startsWith('PASS') || r.startsWith('FAIL')).length === 0) resolve({ passed, failed, results });
    });
  });
}
