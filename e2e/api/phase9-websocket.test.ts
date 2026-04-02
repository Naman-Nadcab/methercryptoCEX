/**
 * Phase 9 — WebSocket E2E: orderbook, ticker, trades, adaptive_mode, soak, reconnect-storm guard.
 * Env: E2E_WS_SOAK_MS (default 12000, max 310000), E2E_SPOT_SYMBOL (default BTC_USDT)
 * Optional: E2E_WS_PARITY=true — after soak, run WS vs REST parity (ticker, orderbook, trades).
 */
import { config } from '../config.js';
import { runWsRestParitySuite } from '../utils/ws-rest-parity.js';

const BASE = config.baseUrl.replace(/^http/, 'ws');
const HARD_CAP_MS = Math.min(310_000, Math.max(3_000, Number(process.env.E2E_WS_SOAK_MS || 12_000)));

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

export async function runPhase9(): Promise<{ passed: number; failed: number; results: string[] }> {
  const results: string[] = [];
  let passed = 0;
  let failed = 0;
  const WS = await getWebSocket();
  if (!WS) {
    results.push('SKIP: WebSocket (no ws package or WebSocket global)');
    return { passed, failed, results };
  }

  const symbol = (process.env.E2E_SPOT_SYMBOL || 'BTC_USDT').trim();
  const channels = [`orderbook:${symbol}`, `ticker:${symbol}`, `trades:${symbol}`] as const;

  return new Promise((resolve) => {
    const url = `${BASE}/api/v1/spot/ws`;
    const ws = new WS(url);
    const subscribed = new Set<string>();
    const counts = { orderbook: 0, ticker: 0, trades: 0, adaptive: 0 };
    let openCount = 0;
    let done = false;
    let soakTimer: ReturnType<typeof setTimeout> | null = null;

    const finish = (lines: string[]) => {
      if (done) return;
      done = true;
      clearTimeout(openTimeout);
      if (soakTimer) clearTimeout(soakTimer);
      for (const line of lines) {
        results.push(line);
        if (line.startsWith('PASS:')) passed++;
        if (line.startsWith('FAIL:')) failed++;
      }
      try {
        ws.close();
      } catch {
        //
      }
      resolve({ passed, failed, results });
    };

    const openTimeout = setTimeout(() => {
      if (!done) finish(['FAIL: WebSocket open timeout']);
    }, config.timeoutMs);

    const armSoak = () => {
      if (done) return;
      if (soakTimer) clearTimeout(soakTimer);
      soakTimer = setTimeout(() => {
        void (async () => {
          const lines: string[] = [];
          lines.push('PASS: WebSocket connect');
          for (const ch of channels) {
            if (!subscribed.has(ch)) {
              lines.push(`FAIL: missing subscribed ack for ${ch}`);
            }
          }
          if (counts.orderbook < 1) lines.push('FAIL: no orderbook frames during soak');
          else lines.push('PASS: orderbook stream delivered');
          // Ticker may be coalesced / quiet on illiquid pairs — do not hard-fail short soaks.
          if (counts.ticker < 1) lines.push('INFO: no ticker frames in soak window (quiet market or coalesce)');
          else lines.push('PASS: ticker stream delivered');
          if (counts.trades < 1) lines.push('INFO: no trades frames (illiquid market is OK)');
          else lines.push('PASS: trades stream delivered');
          if (counts.adaptive < 1) lines.push('INFO: no adaptive_mode in soak window (optional)');
          else lines.push('PASS: adaptive_mode received');

          if (process.env.E2E_WS_PARITY === 'true') {
            lines.push('INFO: E2E_WS_PARITY running REST vs WS comparison');
            try {
              const { summary, allPass } = await runWsRestParitySuite(symbol);
              for (const s of summary) lines.push(s);
              if (!allPass) lines.push('FAIL: WS/REST parity suite had mismatches');
            } catch (e) {
              lines.push(`FAIL: parity suite threw ${e instanceof Error ? e.message : String(e)}`);
            }
          }

          finish(lines);
        })();
      }, HARD_CAP_MS);
    };

    ws.on('open', () => {
      clearTimeout(openTimeout);
      openCount++;
      if (openCount > 6) {
        finish(['FAIL: reconnect storm (>6 open events)']);
        return;
      }
      for (const ch of channels) {
        ws.send(JSON.stringify({ type: 'subscribe', channel: ch }));
      }
      armSoak();
    });

    ws.on('message', (buf: Buffer | string) => {
      if (done) return;
      try {
        const raw = typeof buf === 'string' ? buf : buf.toString();
        const msg = JSON.parse(raw) as { type?: string; channel?: string };
        if (msg.type === 'subscribed' && typeof msg.channel === 'string') {
          subscribed.add(msg.channel);
        }
        const t = msg.type || '';
        if (t === 'orderbook_snapshot' || t === 'orderbook_update' || t === 'orderbook_delta' || t === 'orderbook_resync') {
          counts.orderbook++;
        } else if (t === 'ticker') {
          counts.ticker++;
        } else if (t === 'trades') {
          counts.trades++;
        } else if (t === 'adaptive_mode') {
          counts.adaptive++;
        }
      } catch {
        //
      }
    });

    ws.on('error', (e: Error) => {
      finish([`FAIL: WebSocket error ${e.message}`]);
    });

    ws.on('close', () => {
      if (!done) {
        finish(['FAIL: WebSocket closed before soak completed']);
      }
    });
  });
}
