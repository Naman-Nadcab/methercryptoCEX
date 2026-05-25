/**
 * Minimal Binance Spot signed HTTP (HMAC SHA256). baseUrl and credentials come from DB only.
 */
import crypto from 'node:crypto';

const BINANCE_HTTP_TIMEOUT_MS = 15_000;

function trimBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

export function signBinanceQuery(queryString: string, apiSecret: string): string {
  return crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');
}

export async function binanceSignedGet(
  baseUrl: string,
  path: string,
  apiKey: string,
  apiSecret: string,
  params: Record<string, string | number | undefined>
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const u = new URL(path, trimBaseUrl(baseUrl));
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    sp.set(k, String(v));
  }
  const qs = sp.toString();
  const sig = signBinanceQuery(qs, apiSecret);
  u.search = `${qs}&signature=${sig}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BINANCE_HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(u.toString(), {
      method: 'GET',
      headers: { 'X-MBX-APIKEY': apiKey },
      signal: controller.signal,
    });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      /* keep raw */
    }
    return { ok: res.ok, status: res.status, body };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      body: {
        code: 'BINANCE_HTTP_GET_FAILED',
        message: e instanceof Error ? e.message : String(e),
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function binanceSignedPost(
  baseUrl: string,
  path: string,
  apiKey: string,
  apiSecret: string,
  params: Record<string, string | number | undefined>
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const u = new URL(path, trimBaseUrl(baseUrl));
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    sp.set(k, String(v));
  }
  const qs = sp.toString();
  const sig = signBinanceQuery(qs, apiSecret);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BINANCE_HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(u.toString(), {
      method: 'POST',
      headers: {
        'X-MBX-APIKEY': apiKey,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `${qs}&signature=${sig}`,
      signal: controller.signal,
    });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      /* keep raw */
    }
    return { ok: res.ok, status: res.status, body };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      body: {
        code: 'BINANCE_HTTP_POST_FAILED',
        message: e instanceof Error ? e.message : String(e),
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function toBinanceSymbol(internalMarket: string): string {
  return internalMarket.replace(/_/g, '').toUpperCase();
}
