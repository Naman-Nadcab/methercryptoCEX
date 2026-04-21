/**
 * BlockCypher Bitcoin client.
 *
 * Thin, read-only first class wrapper around the BlockCypher API used by:
 *   - deposit watchers (balance / tx polling)
 *   - withdrawal signer (tx broadcast)
 *   - admin balance reconciliation
 *
 * Webhook ingestion is intentionally separate (see routes/webhooks.fastify.ts)
 * because it needs a publicly reachable HTTPS callback. This module only
 * creates/deletes hooks on the BlockCypher side — inbound HTTP is handled
 * at the Fastify layer.
 */
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';

const BASE = config.blockchain.bitcoin.blockcypherBaseUrl;
const TOKEN = config.blockchain.bitcoin.blockcypherToken;

export interface BtcAddressInfo {
  address: string;
  /** Confirmed + unconfirmed balance in satoshis. */
  final_balance: number;
  /** Confirmed-only balance in satoshis. */
  balance: number;
  unconfirmed_balance: number;
  n_tx: number;
  unconfirmed_n_tx: number;
}

export interface BtcTxSummary {
  tx_hash: string;
  confirmations: number;
  block_height: number;
  confirmed?: string;
  value: number; // satoshis moved to/from this address (signed)
  tx_input_n: number; // -1 == output (received)
  tx_output_n: number; // -1 == input (sent)
  spent?: boolean;
  double_spend: boolean;
}

export interface BtcTx {
  hash: string;
  block_height: number;
  confirmations: number;
  confirmed?: string;
  total: number;
  fees: number;
  inputs: Array<{ addresses?: string[]; output_value: number }>;
  outputs: Array<{ addresses?: string[]; value: number; spent_by?: string }>;
}

function buildUrl(path: string, params?: Record<string, string | number | undefined>): string {
  const qp = new URLSearchParams();
  if (TOKEN) qp.set('token', TOKEN);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) qp.set(k, String(v));
    }
  }
  const qs = qp.toString();
  return `${BASE}${path}${qs ? `?${qs}` : ''}`;
}

async function bcFetch<T>(url: string, init?: RequestInit): Promise<T> {
  if (!TOKEN) {
    throw new Error('BLOCKCYPHER_DISABLED: BLOCKCYPHER_TOKEN not configured');
  }
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`BLOCKCYPHER_HTTP_${res.status}: ${body.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

export function isBlockcypherEnabled(): boolean {
  return Boolean(TOKEN);
}

/**
 * Fetch address balance + tx count. Uses `/addrs/{addr}/balance` (cheap).
 * For deposit indexing call getAddressSummary() instead; it includes tx refs.
 */
export async function getAddressBalance(address: string): Promise<BtcAddressInfo> {
  const url = buildUrl(`/addrs/${address}/balance`);
  return bcFetch<BtcAddressInfo>(url);
}

/**
 * Fetch address with recent tx refs. Used by deposit watchers.
 * `limit` caps the number of tx refs; default 50.
 */
export async function getAddressSummary(
  address: string,
  limit = 50
): Promise<BtcAddressInfo & { txrefs?: BtcTxSummary[]; unconfirmed_txrefs?: BtcTxSummary[] }> {
  const url = buildUrl(`/addrs/${address}`, { limit });
  return bcFetch(url);
}

export async function getTransaction(txHash: string): Promise<BtcTx> {
  const url = buildUrl(`/txs/${txHash}`);
  return bcFetch<BtcTx>(url);
}

/**
 * Broadcast a signed Bitcoin transaction (hex).
 * BlockCypher returns the full tx object on success.
 */
export async function broadcastSignedTx(txHex: string): Promise<{ tx: BtcTx }> {
  const url = buildUrl(`/txs/push`);
  return bcFetch(url, { method: 'POST', body: JSON.stringify({ tx: txHex }) });
}

/**
 * Create a confirmation webhook for a given address. `callbackUrl` must be a
 * public HTTPS endpoint that can receive POST requests from BlockCypher.
 * `confirmations` is the number of confirmations at which the webhook fires
 * (we use 2 for hot-wallet credit, 6 for cold/withdraw finality).
 */
export async function createAddressWebhook(params: {
  address: string;
  callbackUrl: string;
  event?: 'confirmed-tx' | 'unconfirmed-tx' | 'tx-confirmation';
  confirmations?: number;
}): Promise<{ id: string }> {
  const url = buildUrl(`/hooks`);
  const body = {
    event: params.event ?? 'tx-confirmation',
    address: params.address,
    url: params.callbackUrl,
    confirmations: params.confirmations ?? 2,
  };
  return bcFetch(url, { method: 'POST', body: JSON.stringify(body) });
}

export async function deleteWebhook(id: string): Promise<void> {
  const url = buildUrl(`/hooks/${id}`);
  const res = await fetch(url, { method: 'DELETE' });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`BLOCKCYPHER_HTTP_${res.status}: ${body.slice(0, 200)}`);
  }
}

/** Quick health probe used by /health/deep. */
export async function blockcypherPing(): Promise<{ ok: boolean; height?: number; error?: string }> {
  try {
    if (!TOKEN) return { ok: false, error: 'no_token' };
    const data = await bcFetch<{ height: number }>(buildUrl(''));
    return { ok: true, height: data.height };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    logger.warn('blockcypher_ping failed', { error: msg });
    return { ok: false, error: msg };
  }
}
