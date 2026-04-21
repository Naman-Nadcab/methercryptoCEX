/**
 * Tron deposit indexer (TronGrid-backed). Handles TRX native deposits and
 * TRC-20 token deposits (USDT-TRC20 is the primary use-case — 90% of
 * Indian stablecoin flow runs on TRC-20).
 *
 * Design mirrors BitcoinIndexer: poll per watched address, rely on TronGrid's
 * per-account endpoints which give us confirmation state + value directly.
 * Two endpoints per address per tick:
 *   GET /v1/accounts/{addr}/transactions       → TRX transfers (TransferContract)
 *   GET /v1/accounts/{addr}/transactions/trc20 → TRC-20 token transfers
 * Both support `only_to=true` to skip sends from our own wallets.
 *
 * Token matching: TRC-20 tokens are looked up by the token contract address
 * (base58, e.g. `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`) against the `currencies`
 * table, same column that EVM uses for ERC-20s. Unknown contracts are ignored.
 *
 * Rate-limits: TronGrid free tier = 15 QPS without key, 100 QPS with key.
 * With 8 addresses × 2 endpoints = 16 req/tick, spaced by 200ms = ~5 req/s.
 */
import { query } from '../config/database';
import { logger } from '../utils/logger';
import { creditReadyDepositsForChain, recordOrUpdateDeposit } from './nonEvmDepositFlow';

const CHAIN_ID = 'tron';
const CHAIN_NAME = 'Tron';
const EXPLORER_TX_PREFIX = 'https://tronscan.org/#/transaction/';
const REQ_SPACING_MS = 200;
const SUN_PER_TRX = 1_000_000n; // 1 TRX = 1e6 SUN
// Tron settles every ~3s with SR-majority finality at ~19 confirmations. 20 is
// the conservative industry default used by Binance/OKX etc.
const DEFAULT_REQUIRED_CONFIRMATIONS = 20;

interface TronTrc20Transfer {
  transaction_id: string;
  block_timestamp: number;
  from: string;
  to: string;
  value: string;
  token_info?: {
    symbol: string;
    address: string;
    decimals: number;
    name: string;
  };
}

interface TronNativeTx {
  txID: string;
  block_timestamp: number;
  blockNumber?: number;
  raw_data?: {
    contract?: Array<{
      type?: string;
      parameter?: {
        value?: {
          amount?: number;
          to_address?: string; // hex
          owner_address?: string; // hex
        };
      };
    }>;
  };
  ret?: Array<{ contractRet?: string }>;
}

interface TronBlockInfoForTx {
  block_header?: { raw_data?: { number?: number } };
}

export class TronIndexer {
  private watched: Set<string> = new Set();
  private trxCurrencyId: string | null = null;
  /** map: contract address (exact case) → { currencyId, symbol, decimals } */
  private trc20Currencies: Map<string, { currencyId: string; symbol: string; decimals: number }> = new Map();
  private requiredConfirmations = DEFAULT_REQUIRED_CONFIRMATIONS;
  private pollTimer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly pollIntervalMs: number;
  private lastTipBlock = 0;
  private tickCounter = -1;

  constructor() {
    this.apiUrl = (process.env.TRON_API_URL || 'https://api.trongrid.io').replace(/\/+$/, '');
    this.apiKey = process.env.TRON_API_KEY || '';
    // Tron block time ~3s. 30s poll gives ~10-block resolution — plenty for 20-conf credit policy.
    this.pollIntervalMs = parseInt(process.env.TRON_INDEXER_POLL_MS || '30000', 10);
  }

  async start(): Promise<void> {
    try {
      await this.loadConfig();
      await this.loadWatched();
      await this.ensureIndexerState();
      if (!this.trxCurrencyId && this.trc20Currencies.size === 0) {
        logger.warn('Tron indexer: no TRX or TRC-20 currencies found; nothing to track');
        return;
      }
      this.isRunning = true;
      logger.info('Tron indexer started', {
        watched: this.watched.size,
        trc20Tokens: this.trc20Currencies.size,
        pollIntervalMs: this.pollIntervalMs,
        requiredConfirmations: this.requiredConfirmations,
        hasApiKey: Boolean(this.apiKey),
      });
      this.tick().catch((e) =>
        logger.debug('TronIndexer first tick failed', { error: e instanceof Error ? e.message : String(e) })
      );
      this.pollTimer = setInterval(() => {
        this.tick().catch((e) =>
          logger.debug('TronIndexer tick failed', { error: e instanceof Error ? e.message : String(e) })
        );
      }, this.pollIntervalMs);
    } catch (err) {
      logger.error('Tron indexer failed to start', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    logger.info('Tron indexer stopped');
  }

  async addWatchedAddress(address: string): Promise<void> {
    this.watched.add(address);
    logger.info('Added watched Tron address', { address });
  }

  getStats(): object {
    return {
      chain: CHAIN_NAME,
      chainId: CHAIN_ID,
      isRunning: this.isRunning,
      watchedAddresses: this.watched.size,
      tokenContracts: this.trc20Currencies.size,
      lastProcessedBlock: this.lastTipBlock,
      reconnectAttempts: 0,
    };
  }

  // --- internal -----------------------------------------------------------

  private async loadConfig(): Promise<void> {
    const cfgRes = await query(
      `SELECT required_confirmations FROM blockchains
        WHERE LOWER(chain_symbol) = 'trx' OR LOWER(chain_name) = 'tron' LIMIT 1`
    );
    if (cfgRes.rows[0]?.required_confirmations) {
      this.requiredConfirmations = Number(cfgRes.rows[0].required_confirmations) || DEFAULT_REQUIRED_CONFIRMATIONS;
    }

    // Tron blockchain_id in the `blockchains` table; used to scope currencies.
    const blockchainRes = await query(
      `SELECT id FROM blockchains WHERE LOWER(chain_symbol) = 'trx' OR LOWER(chain_name) = 'tron' LIMIT 1`
    );
    const blockchainId = blockchainRes.rows[0]?.id;

    if (blockchainId) {
      // Native TRX
      const trxRes = await query(
        `SELECT id FROM currencies
          WHERE UPPER(symbol) = 'TRX' AND blockchain_id = $1 AND contract_address IS NULL
          LIMIT 1`,
        [blockchainId]
      );
      this.trxCurrencyId = trxRes.rows[0]?.id || null;

      // TRC-20 tokens
      const trc20Res = await query(
        `SELECT id, symbol, contract_address, decimals FROM currencies
          WHERE blockchain_id = $1 AND contract_address IS NOT NULL AND is_active = TRUE`,
        [blockchainId]
      );
      this.trc20Currencies.clear();
      for (const r of trc20Res.rows as Array<{
        id: string; symbol: string; contract_address: string; decimals: number;
      }>) {
        // Tron contract addresses are case-sensitive base58 — store exact.
        this.trc20Currencies.set(r.contract_address, {
          currencyId: r.id,
          symbol: r.symbol,
          decimals: Number(r.decimals) || 6,
        });
      }
    }

    logger.info('Tron indexer: config loaded', {
      trxCurrencyId: Boolean(this.trxCurrencyId),
      trc20TokenCount: this.trc20Currencies.size,
      requiredConfirmations: this.requiredConfirmations,
    });
  }

  private async loadWatched(): Promise<void> {
    const res = await query(
      `SELECT DISTINCT address FROM wallets
        WHERE chain_id = 'tron' AND is_active = TRUE AND address IS NOT NULL AND address <> ''`
    );
    this.watched.clear();
    for (const row of res.rows as Array<{ address: string }>) {
      this.watched.add(row.address); // base58 T... addresses — case-sensitive
    }
    logger.info(`TronIndexer: loaded ${this.watched.size} watched addresses`);
  }

  private async ensureIndexerState(): Promise<void> {
    await query(
      `INSERT INTO indexer_state (chain_id, last_block, updated_at)
       VALUES ($1, 0, NOW())
       ON CONFLICT (chain_id) DO UPDATE SET updated_at = NOW()`,
      [CHAIN_ID]
    );
  }

  private async tick(): Promise<void> {
    if (!this.isRunning) return;

    // Refresh watchlist + token list every 5 ticks (~2.5 min) so new wallets/tokens are picked up live.
    this.tickCounter = (this.tickCounter + 1) % 5;
    if (this.tickCounter === 0) {
      await Promise.all([
        this.loadWatched().catch(() => {}),
        this.loadConfig().catch(() => {}),
      ]);
    }

    let tipBlock = 0;
    try {
      tipBlock = await this.fetchTipBlock();
      this.lastTipBlock = tipBlock;
    } catch (e) {
      logger.debug('Tron tip fetch failed', { error: e instanceof Error ? e.message : String(e) });
    }

    // Heartbeat — /health/deep uses indexer_state.updated_at to detect stale indexer.
    await query(
      `UPDATE indexer_state SET last_block = GREATEST(last_block, $1), updated_at = NOW() WHERE chain_id = $2`,
      [tipBlock, CHAIN_ID]
    ).catch(() => { /* best-effort */ });

    if (this.watched.size === 0) return;

    for (const addr of this.watched) {
      if (!this.isRunning) break;
      try {
        if (this.trc20Currencies.size > 0) {
          await this.processTrc20Transfers(addr);
          await sleep(REQ_SPACING_MS);
        }
        if (this.trxCurrencyId) {
          await this.processTrxTransfers(addr);
          await sleep(REQ_SPACING_MS);
        }
      } catch (err) {
        logger.debug('Tron processAddress failed', {
          address: addr,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Promote any pending deposits that just crossed confirmation threshold.
    const credited = await creditReadyDepositsForChain(
      CHAIN_ID,
      CHAIN_NAME,
      EXPLORER_TX_PREFIX,
      async (txHash) => this.fetchTxConfirmations(txHash, tipBlock)
    );
    if (credited > 0) logger.info(`Tron confirmed+credited ${credited} deposit(s)`);
  }

  private async processTrc20Transfers(address: string): Promise<void> {
    const url = `${this.apiUrl}/v1/accounts/${address}/transactions/trc20?limit=50&only_confirmed=true&only_to=true`;
    const res = await this.fetch(url);
    if (!res) return;
    const transfers = Array.isArray(res.data) ? (res.data as TronTrc20Transfer[]) : [];
    if (transfers.length === 0) return;

    const tipBlock = this.lastTipBlock;

    for (const t of transfers) {
      if (!t.token_info?.address) continue;
      const tokenInfo = this.trc20Currencies.get(t.token_info.address);
      if (!tokenInfo) continue; // unknown/ignored token
      if (t.to !== address) continue;

      const amount = formatBaseUnits(BigInt(t.value), tokenInfo.decimals);
      const numAmount = Number(amount);
      if (!Number.isFinite(numAmount) || numAmount <= 0) continue;

      // TronGrid doesn't return per-tx confirmation count on the trc20 list;
      // we fetch it separately (cheap, cached by tx). `only_confirmed=true`
      // guarantees at least one block of depth.
      const confirmations = await this.fetchTxConfirmations(t.transaction_id, tipBlock);
      const blockTsSec = Math.floor((t.block_timestamp || Date.now()) / 1000);

      await recordOrUpdateDeposit({
        chainId: CHAIN_ID,
        chainName: CHAIN_NAME,
        txHash: t.transaction_id,
        fromAddress: t.from || null,
        toAddress: address,
        currencyId: tokenInfo.currencyId,
        symbol: tokenInfo.symbol,
        amount,
        confirmations: Math.max(1, confirmations ?? 1),
        requiredConfirmations: this.requiredConfirmations,
        blockNumber: 0, // per-tx block number isn't in this response
        blockTimestampSec: blockTsSec,
        explorerUrl: `${EXPLORER_TX_PREFIX}${t.transaction_id}`,
      });
    }
  }

  private async processTrxTransfers(address: string): Promise<void> {
    if (!this.trxCurrencyId) return;
    const url = `${this.apiUrl}/v1/accounts/${address}/transactions?limit=50&only_confirmed=true&only_to=true`;
    const res = await this.fetch(url);
    if (!res) return;
    const txs = Array.isArray(res.data) ? (res.data as TronNativeTx[]) : [];
    if (txs.length === 0) return;

    const tipBlock = this.lastTipBlock;
    const addressHex = base58ToHex(address);
    if (!addressHex) return;

    for (const tx of txs) {
      const contract = tx.raw_data?.contract?.[0];
      if (!contract) continue;
      if (contract.type !== 'TransferContract') continue;
      const v = contract.parameter?.value;
      if (!v) continue;
      // TronGrid returns recipients as hex (41-prefixed). Match against our wallet's hex form.
      if (!v.to_address || v.to_address.toLowerCase() !== addressHex.toLowerCase()) continue;
      if (!v.amount || v.amount <= 0) continue;

      // Filter failed transactions (contractRet !== SUCCESS). Defensive; `only_confirmed=true`
      // already skips rejected ones but TronGrid's semantics occasionally surprise.
      const ret = tx.ret?.[0]?.contractRet;
      if (ret && ret !== 'SUCCESS') continue;

      const amount = formatBaseUnits(BigInt(v.amount), 6); // TRX has 6 decimals
      const numAmount = Number(amount);
      if (!Number.isFinite(numAmount) || numAmount <= 0) continue;

      const confirmations = await this.fetchTxConfirmations(tx.txID, tipBlock);
      const blockTsSec = Math.floor((tx.block_timestamp || Date.now()) / 1000);

      await recordOrUpdateDeposit({
        chainId: CHAIN_ID,
        chainName: CHAIN_NAME,
        txHash: tx.txID,
        fromAddress: v.owner_address ? hexToBase58(v.owner_address) : null,
        toAddress: address,
        currencyId: this.trxCurrencyId,
        symbol: 'TRX',
        amount,
        confirmations: Math.max(1, confirmations ?? 1),
        requiredConfirmations: this.requiredConfirmations,
        blockNumber: 0,
        blockTimestampSec: blockTsSec,
        explorerUrl: `${EXPLORER_TX_PREFIX}${tx.txID}`,
      });
    }
  }

  /** Fetch tip block number via `wallet/getnowblock`. */
  private async fetchTipBlock(): Promise<number> {
    const url = `${this.apiUrl}/wallet/getnowblock`;
    const res = await this.fetch(url);
    const bh = (res as TronBlockInfoForTx | null)?.block_header?.raw_data?.number;
    return typeof bh === 'number' ? bh : 0;
  }

  /** Resolve per-tx confirmations: (tip - tx_block). Returns null if unavailable. */
  private async fetchTxConfirmations(txHash: string, tipBlock: number): Promise<number | null> {
    try {
      // `wallet/gettransactioninfobyid` returns { blockNumber } for confirmed txs.
      const url = `${this.apiUrl}/wallet/gettransactioninfobyid`;
      const res = await this.fetch(url, {
        method: 'POST',
        body: JSON.stringify({ value: txHash }),
      });
      const blockNumber = (res as { blockNumber?: number } | null)?.blockNumber;
      if (!blockNumber || !tipBlock) return null;
      return Math.max(0, tipBlock - blockNumber);
    } catch {
      return null;
    }
  }

  private async fetch(url: string, init?: RequestInit): Promise<any> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers['TRON-PRO-API-KEY'] = this.apiKey;
    const res = await fetch(url, { ...init, headers });
    if (res.status === 429) {
      logger.warn('TronGrid 429 rate-limit', { url: url.slice(0, 80) });
      await sleep(2_000);
      return null;
    }
    if (res.status === 404) return null;
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`TronGrid HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    return res.json();
  }
}

function formatBaseUnits(raw: bigint, decimals: number): string {
  const negative = raw < 0n;
  const v = negative ? -raw : raw;
  const divisor = 10n ** BigInt(decimals);
  const whole = v / divisor;
  const frac = (v % divisor).toString().padStart(decimals, '0');
  return `${negative ? '-' : ''}${whole.toString()}.${frac}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// --- Tron address encoding helpers (base58check with 0x41 prefix) ----------

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Decode(str: string): Uint8Array | null {
  const bytes: number[] = [0];
  for (const ch of str) {
    const idx = BASE58_ALPHABET.indexOf(ch);
    if (idx < 0) return null;
    let carry = idx;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  // Leading zeros
  for (const ch of str) {
    if (ch === '1') bytes.push(0);
    else break;
  }
  return Uint8Array.from(bytes.reverse());
}

function base58Encode(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits: number[] = [0];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = '';
  for (let i = 0; i < zeros; i++) out += '1';
  for (let i = digits.length - 1; i >= 0; i--) out += BASE58_ALPHABET[digits[i]];
  return out;
}

/**
 * Convert a base58 T-address to its 21-byte hex form (41 || address_20) lowercased,
 * which is what TronGrid returns in tx payload `to_address` / `owner_address`.
 */
function base58ToHex(addr: string): string | null {
  const decoded = base58Decode(addr);
  if (!decoded || decoded.length < 25) return null;
  // Strip trailing 4-byte checksum (we trust base58 roundtrip here; don't re-verify for indexing).
  const payload = decoded.slice(0, -4);
  return Buffer.from(payload).toString('hex');
}

function hexToBase58(hex: string): string | null {
  try {
    const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
    const payload = Buffer.from(clean, 'hex');
    if (payload.length !== 21) return null;
    // base58check: payload || sha256(sha256(payload))[0..4]
    const crypto = require('crypto') as typeof import('crypto');
    const c1 = crypto.createHash('sha256').update(payload).digest();
    const c2 = crypto.createHash('sha256').update(c1).digest();
    const full = Buffer.concat([payload, c2.slice(0, 4)]);
    return base58Encode(full);
  } catch {
    return null;
  }
}
