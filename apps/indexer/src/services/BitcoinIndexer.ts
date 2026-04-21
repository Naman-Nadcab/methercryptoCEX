/**
 * Bitcoin deposit indexer (BlockCypher-backed).
 *
 * Strategy: poll BlockCypher's per-address endpoint on a fixed interval for every
 * active BTC wallet in the `wallets` table. Each response includes confirmed
 * and unconfirmed tx refs with per-tx confirmation counts, which is exactly
 * what the deposit pipeline needs — no block-by-block scanning required.
 *
 * Why polling and not a BlockCypher webhook:
 *  - Webhooks need a public HTTPS callback URL (not available in dev / behind NAT).
 *  - Polling is bounded and deterministic — 9 addresses × 20s interval = ~3 req/s,
 *    well under BlockCypher's 3 req/s / 200 req/hr free-tier limit.
 *  - Polling also provides the heartbeat for /health/deep's indexer_state check.
 *
 * Rate-limit: we process addresses one-at-a-time with a small spacer (`REQ_SPACING_MS`)
 * so a large watchlist does not burst past BlockCypher's QPS ceiling.
 *
 * Confirmation & credit flow reuses the shared `nonEvmDepositFlow` helpers:
 *  - On discovering a new tx that sends BTC to a watched address → INSERT deposit.
 *  - Every tick updates confirmations in-place and credits once ≥ requiredConfirmations.
 *  - `balance_applied_at IS NULL` in the UPDATE-RETURNING clause is the credit mutex.
 */
import { query } from '../config/database';
import { logger } from '../utils/logger';
import { creditReadyDepositsForChain, recordOrUpdateDeposit } from './nonEvmDepositFlow';

const CHAIN_ID = 'bitcoin';
const CHAIN_NAME = 'Bitcoin';
const EXPLORER_TX_PREFIX = 'https://www.blockchain.com/btc/tx/';
const SATOSHI_PER_BTC = 100_000_000n;
const REQ_SPACING_MS = 350; // ~3 req/s cap for BlockCypher free tier

interface BcTxRef {
  tx_hash: string;
  confirmations: number;
  block_height: number;
  confirmed?: string;
  value: number;
  tx_input_n: number;
  tx_output_n: number;
  double_spend: boolean;
  spent?: boolean;
}

interface BcAddressResponse {
  address: string;
  final_balance: number;
  balance: number;
  unconfirmed_balance: number;
  n_tx: number;
  unconfirmed_n_tx: number;
  txrefs?: BcTxRef[];
  unconfirmed_txrefs?: BcTxRef[];
}

export class BitcoinIndexer {
  private watched: Set<string> = new Set();
  private currencyId: string | null = null;
  private requiredConfirmations = 3;
  private pollTimer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private readonly pollIntervalMs: number;
  private readonly token: string;
  private readonly baseUrl: string;
  private lastPollBlock = 0;

  constructor() {
    this.token = process.env.BLOCKCYPHER_TOKEN || '';
    this.baseUrl = (process.env.BLOCKCYPHER_BASE_URL || 'https://api.blockcypher.com/v1/btc/main').replace(/\/+$/, '');
    // Bitcoin avg_block_time is 600s; a 60s poll gives us timely detection without burning quota.
    // Override via BTC_INDEXER_POLL_MS if needed.
    this.pollIntervalMs = parseInt(process.env.BTC_INDEXER_POLL_MS || '60000', 10);
  }

  async start(): Promise<void> {
    if (!this.token) {
      logger.warn('BitcoinIndexer disabled: BLOCKCYPHER_TOKEN not set');
      return;
    }

    try {
      await this.loadConfig();
      await this.loadWatched();
      await this.ensureIndexerState();
      this.isRunning = true;
      logger.info(`Bitcoin indexer started`, {
        watched: this.watched.size,
        pollIntervalMs: this.pollIntervalMs,
        requiredConfirmations: this.requiredConfirmations,
      });
      // Fire once immediately, then on interval.
      this.tick().catch((e) =>
        logger.debug('BitcoinIndexer first tick failed', { error: e instanceof Error ? e.message : String(e) })
      );
      this.pollTimer = setInterval(() => {
        this.tick().catch((e) =>
          logger.debug('BitcoinIndexer tick failed', { error: e instanceof Error ? e.message : String(e) })
        );
      }, this.pollIntervalMs);
    } catch (err) {
      logger.error('Bitcoin indexer failed to start', {
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
    logger.info('Bitcoin indexer stopped');
  }

  async addWatchedAddress(address: string): Promise<void> {
    this.watched.add(address);
    logger.info('Added watched BTC address', { address });
  }

  getStats(): object {
    return {
      chain: CHAIN_NAME,
      chainId: CHAIN_ID,
      isRunning: this.isRunning,
      watchedAddresses: this.watched.size,
      tokenContracts: 0,
      lastProcessedBlock: this.lastPollBlock,
      reconnectAttempts: 0,
    };
  }

  // --- internal -----------------------------------------------------------

  private async loadConfig(): Promise<void> {
    // Required confirmations come from the `blockchains` (UUID-keyed) table to
    // stay consistent with UI/admin settings.
    const cfgRes = await query(
      `SELECT required_confirmations FROM blockchains WHERE LOWER(chain_symbol) = 'btc' LIMIT 1`
    );
    if (cfgRes.rows[0]?.required_confirmations) {
      this.requiredConfirmations = Number(cfgRes.rows[0].required_confirmations) || 3;
    }

    const curRes = await query(
      `SELECT id FROM currencies WHERE UPPER(symbol) = 'BTC' AND contract_address IS NULL LIMIT 1`
    );
    this.currencyId = curRes.rows[0]?.id || null;
    if (!this.currencyId) {
      throw new Error('BitcoinIndexer: BTC currency row not found in currencies table');
    }
  }

  private async loadWatched(): Promise<void> {
    const res = await query(
      `SELECT DISTINCT address FROM wallets
        WHERE chain_id = 'bitcoin' AND is_active = TRUE AND address IS NOT NULL AND address <> ''`
    );
    this.watched.clear();
    for (const row of res.rows as Array<{ address: string }>) {
      this.watched.add(row.address); // case-sensitive bech32 — DO NOT lowercase
    }
    logger.info(`BitcoinIndexer: loaded ${this.watched.size} watched addresses`);
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

    // Reload watchlist periodically so new signups get picked up without restart.
    // This is cheap (single SQL query); do it every 5 ticks.
    this.tickCounter = (this.tickCounter + 1) % 5;
    if (this.tickCounter === 0) {
      await this.loadWatched().catch((e) =>
        logger.debug('BTC watchlist reload failed', { error: e instanceof Error ? e.message : String(e) })
      );
    }

    let tipHeight = 0;
    try {
      tipHeight = await this.fetchTipHeight();
      this.lastPollBlock = tipHeight;
    } catch (e) {
      logger.debug('BTC tip fetch failed', { error: e instanceof Error ? e.message : String(e) });
    }

    // Heartbeat first: even if per-address calls fail, mark indexer alive for /health/deep.
    await query(
      `UPDATE indexer_state SET last_block = GREATEST(last_block, $1), updated_at = NOW() WHERE chain_id = $2`,
      [tipHeight, CHAIN_ID]
    ).catch(() => { /* best-effort */ });

    if (this.watched.size === 0 || !this.currencyId) return;

    for (const addr of this.watched) {
      if (!this.isRunning) break;
      try {
        await this.processAddress(addr);
      } catch (err) {
        logger.debug('BTC processAddress failed', {
          address: addr,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      await sleep(REQ_SPACING_MS);
    }

    // Second pass: confirm/credit any previously recorded deposits whose on-chain
    // confirmations crossed the threshold since last poll.
    const credited = await creditReadyDepositsForChain(
      CHAIN_ID,
      CHAIN_NAME,
      EXPLORER_TX_PREFIX,
      async (txHash) => {
        try {
          const tx = await this.fetchTx(txHash);
          return tx?.confirmations ?? null;
        } catch {
          return null;
        }
      }
    );
    if (credited > 0) logger.info(`BTC confirmed+credited ${credited} deposit(s)`);
  }

  private tickCounter = -1;

  private async processAddress(address: string): Promise<void> {
    if (!this.currencyId) return;
    const data = await this.fetchAddressSummary(address);
    if (!data) return;

    const all: BcTxRef[] = [
      ...(data.txrefs || []),
      ...(data.unconfirmed_txrefs || []),
    ];

    for (const ref of all) {
      // tx_input_n === -1 means this ref is an OUTPUT to our address (i.e. a deposit).
      // tx_output_n === -1 means this ref is an INPUT from our address (a spend).
      if (ref.tx_input_n !== -1) continue;
      if (ref.double_spend) continue;
      if (ref.value <= 0) continue;

      const btcAmount = formatSatoshis(BigInt(ref.value));
      const blockTsSec = ref.confirmed
        ? Math.floor(new Date(ref.confirmed).getTime() / 1000)
        : Math.floor(Date.now() / 1000);

      await recordOrUpdateDeposit({
        chainId: CHAIN_ID,
        chainName: CHAIN_NAME,
        txHash: ref.tx_hash,
        fromAddress: null, // BlockCypher address endpoint doesn't expose inputs directly
        toAddress: address,
        currencyId: this.currencyId,
        symbol: 'BTC',
        amount: btcAmount,
        confirmations: Math.max(0, ref.confirmations),
        requiredConfirmations: this.requiredConfirmations,
        blockNumber: ref.block_height > 0 ? ref.block_height : 0,
        blockTimestampSec: blockTsSec,
        explorerUrl: `${EXPLORER_TX_PREFIX}${ref.tx_hash}`,
      });
    }
  }

  private async fetchAddressSummary(address: string): Promise<BcAddressResponse | null> {
    const url = `${this.baseUrl}/addrs/${address}?limit=25&token=${encodeURIComponent(this.token)}`;
    const res = await fetch(url);
    if (res.status === 429) {
      logger.warn('BlockCypher 429 rate-limit for address lookup', { address });
      await sleep(2_000);
      return null;
    }
    if (res.status === 404) {
      // Brand-new address that BlockCypher hasn't indexed — not an error.
      return null;
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`BlockCypher HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    return (await res.json()) as BcAddressResponse;
  }

  private async fetchTx(txHash: string): Promise<{ confirmations: number } | null> {
    const url = `${this.baseUrl}/txs/${txHash}?token=${encodeURIComponent(this.token)}&limit=1`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const j = (await res.json()) as { confirmations?: number };
    return { confirmations: j.confirmations ?? 0 };
  }

  private async fetchTipHeight(): Promise<number> {
    const url = `${this.baseUrl}?token=${encodeURIComponent(this.token)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`BlockCypher tip HTTP ${res.status}`);
    const j = (await res.json()) as { height?: number };
    return j.height ?? 0;
  }
}

function formatSatoshis(sats: bigint): string {
  const negative = sats < 0n;
  const v = negative ? -sats : sats;
  const whole = v / SATOSHI_PER_BTC;
  const frac = (v % SATOSHI_PER_BTC).toString().padStart(8, '0');
  return `${negative ? '-' : ''}${whole.toString()}.${frac}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
