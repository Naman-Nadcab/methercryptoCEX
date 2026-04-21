/**
 * TronGrid client for TRX + TRC-20 (USDT) support.
 *
 * Read-heavy methods (balances, tx history) are used by deposit watchers and
 * balance reconcilers. Broadcast is used by the withdrawal signer — the signer
 * builds + signs the raw tx locally via `tronweb`, this module only pushes it.
 *
 * API docs: https://developers.tron.network/reference/tron-grid-api
 */
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';

const BASE = config.blockchain.tron.apiUrl;
const API_KEY = config.blockchain.tron.apiKey;

// USDT (TRC-20) mainnet contract — same across all Tron exchanges worldwide.
export const USDT_TRC20_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
export const USDT_TRC20_DECIMALS = 6;

export interface TronAccount {
  address: string;
  /** TRX balance in SUN (1 TRX = 1_000_000 SUN). */
  balance: number;
  create_time?: number;
  latest_opration_time?: number;
}

export interface TronTrc20Transfer {
  transaction_id: string;
  block_timestamp: number;
  from: string;
  to: string;
  value: string; // raw on-chain value (need decimals conversion)
  token_info: {
    symbol: string;
    address: string;
    decimals: number;
    name: string;
  };
}

function buildHeaders(extra?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(extra ?? {}),
  };
  if (API_KEY) h['TRON-PRO-API-KEY'] = API_KEY;
  return h;
}

async function tgFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${BASE}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: buildHeaders(init?.headers as Record<string, string> | undefined),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`TRONGRID_HTTP_${res.status}: ${body.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

export function isTronGridEnabled(): boolean {
  return Boolean(API_KEY);
}

/**
 * Fetch account info (TRX balance + metadata). Accepts base58 (T…) address.
 * Tron accepts either hex or base58 — we always pass base58 for consistency.
 */
export async function getAccount(address: string): Promise<TronAccount | null> {
  const data = await tgFetch<{ data: TronAccount[] }>(
    `/v1/accounts/${address}`
  );
  return data.data?.[0] ?? null;
}

/**
 * TRC-20 transfers TO / FROM an address, newest first.
 * Used by deposit watcher to detect inbound USDT-TRC20 payments.
 */
export async function getTrc20Transfers(
  address: string,
  opts: { contract?: string; limit?: number; onlyTo?: boolean } = {}
): Promise<TronTrc20Transfer[]> {
  const params = new URLSearchParams();
  params.set('limit', String(opts.limit ?? 50));
  params.set('only_confirmed', 'true');
  if (opts.contract) params.set('contract_address', opts.contract);
  if (opts.onlyTo) params.set('only_to', 'true');
  const data = await tgFetch<{ data: TronTrc20Transfer[] }>(
    `/v1/accounts/${address}/transactions/trc20?${params.toString()}`
  );
  return data.data ?? [];
}

/**
 * Raw TRX transactions (all types) for an address. Use getTrc20Transfers() for
 * stablecoin deposits.
 */
export async function getAccountTransactions(
  address: string,
  limit = 50
): Promise<unknown[]> {
  const data = await tgFetch<{ data: unknown[] }>(
    `/v1/accounts/${address}/transactions?limit=${limit}&only_confirmed=true`
  );
  return data.data ?? [];
}

/**
 * Broadcast a signed Tron transaction. The signer produces the canonical
 * JSON payload; we only POST it.
 */
export async function broadcastSignedTx(
  signed: Record<string, unknown>
): Promise<{ result?: boolean; txid?: string; code?: string; message?: string }> {
  return tgFetch(`/wallet/broadcasttransaction`, {
    method: 'POST',
    body: JSON.stringify(signed),
  });
}

/** Read-only health check used by /health/deep. */
export async function trongridPing(): Promise<{ ok: boolean; block?: number; error?: string }> {
  try {
    const data = await tgFetch<{ block_header?: { raw_data?: { number?: number } } }>(
      `/wallet/getnowblock`
    );
    const block = data?.block_header?.raw_data?.number;
    return { ok: typeof block === 'number', block };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    logger.warn('trongrid_ping failed', { error: msg });
    return { ok: false, error: msg };
  }
}
