import crypto from 'node:crypto';
import { Decimal, type DecimalInstance } from '../lib/decimal.js';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../lib/database.js';
import { redis } from '../lib/redis.js';
import { getCurrencyIdBySymbol } from '../lib/currency-resolver.js';
import { ensureUserBalanceRow, ensureUserBalanceRowsBulk, assertUserBalanceUpdated, assertBalanceInvariant, DEFAULT_ACCOUNT_TYPE, CHAIN_ID_GLOBAL } from '../lib/user-balance-helper.js';
import { insertBalanceLedger } from '../lib/balance-ledger.js';
import { readUserBalances } from '../services/balance/readUserBalances.js';
import { getActiveCurrencyIds } from '../lib/active-currencies-cache.js';
import { walletService } from '../services/wallet.service.js';
import { logger, auditLog } from '../lib/logger.js';
import { logWithdrawalLifecycle } from '../lib/withdrawal-audit.js';
import { ChainId } from '../types/index.js';
import { evaluateAndLogRisk } from '../services/risk-engine.service.js';
import { getDeviceIdFromRequest, logUserActivity } from '../services/activity-monitor.service.js';
import { isAddressAllowed } from '../services/withdrawal-whitelist.service.js';
import { hasActiveCooldown } from '../services/security-cooldown.service.js';
import { rateLimitByUser } from '../lib/rate-limit-fastify.js';
import { config } from '../config/index.js';
import { creditOverdueDepositsForUser, applyBalanceForOneCompletedDeposit } from '../services/deposit-credit.service.js';
import { recordAndEvaluate } from '../services/aml-transaction-monitor.service.js';
import { handleWithdrawPreview, type WithdrawPreviewQuerystring } from './wallet-withdraw-preview.js';
import { getPortfolioHistory } from '../services/portfolio-snapshot.service.js';
import { getCoinInfo } from '../services/coin-info.service.js';
import { assertWithdrawalAllowedForTreasuryPolicy } from '../services/treasury/treasury-emergency.service.js';
import { assessWithdrawalTreasuryRisk } from '../services/treasury/withdrawal-treasury-risk.service.js';

const ROUND_DOWN = 1;
const AMOUNT_PRECISION = 8;
const WITHDRAWAL_IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60; // 24 hours
const WITHDRAWAL_IDEMPOTENCY_LOCK_TTL_SECONDS = 30;
const TRANSFER_IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60; // 24 hours
const TRANSFER_IDEMPOTENCY_LOCK_TTL_SECONDS = 30;
const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

/** Build a stable hash of withdrawal request body for idempotency (same payload => same hash). */
function buildWithdrawalRequestHash(body: Record<string, unknown>): string {
  const normalized = {
    accountType: String(body.accountType ?? 'funding').trim(),
    amount: String(body.amount ?? '').trim(),
    chainId: body.chainId != null ? String(body.chainId).trim() : '',
    internal_user_identifier: body.internal_user_identifier != null ? String(body.internal_user_identifier).trim() : '',
    memo: body.memo != null ? String(body.memo).trim() : '',
    symbol: String(body.symbol ?? '').trim(),
    toAddress: body.toAddress != null ? String(body.toAddress).trim().toLowerCase() : '',
    type: String(body.type ?? 'onchain').trim(),
  };
  const str = JSON.stringify(normalized);
  return crypto.createHash('sha256').update(str).digest('hex');
}

interface WithdrawalIdempotencyCache {
  withdrawalId: string;
  requestHash: string;
  response: { success: true; data: Record<string, unknown> };
}

/** Build a stable hash of transfer request body for idempotency. */
function buildTransferRequestHash(body: Record<string, unknown>): string {
  const normalized = {
    fromAccount: String(body.fromAccount ?? '').trim(),
    toAccount: String(body.toAccount ?? '').trim(),
    tokenId: String(body.tokenId ?? '').trim(),
    amount: String(body.amount ?? '').trim(),
  };
  return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

interface TransferIdempotencyCache {
  requestHash: string;
  response: { success: true; message: string; data: Record<string, unknown> };
}

function toBooleanFlag(value: unknown, defaultValue: boolean): boolean {
  if (value == null) return defaultValue;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off', 'disabled'].includes(normalized)) return false;
  return defaultValue;
}

async function isFeatureToggleEnabled(featureKey: string, defaultEnabled = true): Promise<boolean> {
  try {
    const row = await db.query<{ is_enabled: boolean | null }>(
      `SELECT is_enabled
       FROM feature_toggles
       WHERE feature_key = $1
       ORDER BY updated_at DESC NULLS LAST, created_at DESC
       LIMIT 1`,
      [featureKey]
    );
    if (row.rows.length === 0) return defaultEnabled;
    return row.rows[0]!.is_enabled !== false;
  } catch {
    return defaultEnabled;
  }
}

async function isSystemSettingEnabled(settingKey: string, defaultEnabled = true): Promise<boolean> {
  try {
    const row = await db.query<{ value: unknown }>(
      `SELECT value FROM system_settings WHERE key = $1 LIMIT 1`,
      [settingKey]
    );
    if (row.rows.length === 0) return defaultEnabled;
    return toBooleanFlag(row.rows[0]!.value, defaultEnabled);
  } catch {
    return defaultEnabled;
  }
}

interface ChainDB {
  id: string;
  id_text?: string;
  name: string;
  type: string;
  native_currency: string;
  decimals: number;
  rpc_url?: string;
  explorer_url?: string;
  is_active: boolean;
  required_confirmations?: number;
  confirmations_required?: number;
  avg_block_time?: number;
  icon_url?: string;
}

interface TokenDB {
  id: string;
  symbol: string;
  name: string;
  chain_id: string;
  chain_name?: string;
  chain_type?: string;
  contract_address?: string;
  decimals: number;
  is_active: boolean;
  is_native: boolean;
  icon_url?: string;
  min_deposit?: string;
  min_withdrawal?: string;
  withdrawal_fee?: string;
}

interface DepositDB {
  id: string;
  user_id: string;
  token_id: string;
  chain_id: string;
  amount: string;
  tx_hash?: string;
  from_address: string;
  to_address: string;
  confirmations: number;
  required_confirmations: number;
  status: string;
  credited_at?: Date;
  created_at: Date;
}

export default async function walletRoutes(app: FastifyInstance) {
  /**
   * GET /wallet/chains — active chain list. Reference data that changes rarely
   * (admin adds a chain or toggles `is_active`). Serve from Redis with a short
   * TTL; emit `Cache-Control` so React Query + browser HTTP cache both cooperate.
   * On cache miss we still protect the DB with a 5-minute TTL.
   */
  app.get('/chains', async (request: FastifyRequest, reply: FastifyReply) => {
    const cacheKey = 'wallet:chains:active:v1';
    try {
      const cached = await redis.getJson<ChainDB[]>(cacheKey).catch(() => null);
      if (Array.isArray(cached)) {
        reply.header('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');
        return { success: true, data: cached };
      }

      const result = await db.query<ChainDB>(`
        SELECT c.id, c.id as id_text, c.name, c.type, c.native_currency, c.decimals,
               c.rpc_url, c.explorer_url, c.is_active,
               COALESCE(c.confirmations_required, 25) as confirmations_required
        FROM chains c
        WHERE c.is_active = TRUE
        ORDER BY c.name ASC
      `);
      await redis.setJson(cacheKey, result.rows, 300).catch(() => {});
      reply.header('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');
      return { success: true, data: result.rows };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('Failed to get chains', { error: err.message, stack: err.stack });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch chains' }
      });
    }
  });

  // Get tokens for a specific chain
  app.get('/chains/:chainId/tokens', async (request: FastifyRequest<{
    Params: { chainId: string }
  }>, reply: FastifyReply) => {
    try {
      const { chainId } = request.params;

      const cacheKey = `tokens:chain:${chainId}`;
      const cached = await redis.getJson<TokenDB[]>(cacheKey).catch(() => null);
      if (cached) {
        reply.header('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');
        return { success: true, data: cached };
      }

      const result = await db.query<TokenDB>(`
        SELECT t.id, t.symbol, t.name, t.chain_id, t.contract_address, t.decimals, 
               t.is_active, COALESCE(t.is_native, false) as is_native,
               c.name as chain_name, c.type as chain_type
        FROM tokens t
        LEFT JOIN chains c ON t.chain_id = c.id
        WHERE t.chain_id = $1 AND t.is_active = TRUE
        ORDER BY COALESCE(t.is_native, false) DESC, t.symbol ASC
      `, [chainId]);

      await redis.setJson(cacheKey, result.rows, 300).catch(() => {});
      reply.header('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');
      return { success: true, data: result.rows };
    } catch (error) {
      logger.error('Failed to get tokens', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch tokens' }
      });
    }
  });

  // Get all UNIQUE tokens (for deposit selection UI - one per symbol)
  app.get('/tokens', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const cacheKey = 'tokens:unique:active';
      const cached = await redis.getJson<TokenDB[]>(cacheKey).catch(() => null);
      if (cached) {
        reply.header('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');
        return { success: true, data: cached };
      }

      const result = await db.query<TokenDB>(`
        SELECT DISTINCT ON (UPPER(t.symbol)) 
               t.id, t.symbol, 
               CASE 
                 WHEN t.name LIKE '%(%' THEN SPLIT_PART(t.name, ' (', 1)
                 ELSE t.name
               END as name,
               t.decimals, t.is_active, COALESCE(t.is_native, false) as is_native,
               LOWER(t.symbol) as icon
        FROM tokens t
        WHERE t.is_active = TRUE
        ORDER BY UPPER(t.symbol), t.name ASC
      `);

      await redis.setJson(cacheKey, result.rows, 300).catch(() => {});
      reply.header('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');
      return { success: true, data: result.rows };
    } catch (error) {
      logger.error('Failed to get tokens', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch tokens' }
      });
    }
  });

  // Get chains that support this token (asset). Used to filter chains by selected asset.
  app.get('/tokens/:symbol/chains', async (request: FastifyRequest<{
    Params: { symbol: string }
  }>, reply: FastifyReply) => {
    const { symbol } = request.params;
    const cacheKey = `tokens:${symbol.toUpperCase()}:chains`;
    try {
      const cached = await redis.getJson<ChainDB[]>(cacheKey);
      if (cached && Array.isArray(cached)) {
        reply.header('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');
        return { success: true, data: cached };
      }
    } catch (_) {
      /* Redis optional */
    }
    try {
      const result = await db.query<ChainDB>(`
        SELECT DISTINCT 
               c.id, c.id as id_text, c.name, c.type, c.native_currency, 
               COALESCE(c.confirmations_required, 12) as confirmations_required,
               c.explorer_url,
               LOWER(c.id) as icon,
               CASE c.type WHEN 'evm' THEN 1 ELSE 2 END as sort_order
        FROM tokens t
        JOIN chains c ON t.chain_id = c.id
        WHERE UPPER(t.symbol) = UPPER($1) AND t.is_active = TRUE AND c.is_active = TRUE
        ORDER BY sort_order, c.name ASC
      `, [symbol]);
      try {
        await redis.setJson(cacheKey, result.rows, 300);
      } catch (_) {
        /* ignore */
      }
      reply.header('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');
      return { success: true, data: result.rows };
    } catch (error) {
      logger.error('Failed to get chains for token', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch chains' }
      });
    }
  });

  // Check KYC status (authenticated)
  app.get('/kyc-status', {
    preHandler: [app.authenticate]
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user!.id;

      // Check KYC application status - only select columns that exist
      const kycCheck = await db.query(`
        SELECT status, kyc_level, submitted_at, reviewed_at, rejection_reason
        FROM kyc_applications 
        WHERE user_id = $1 
        ORDER BY created_at DESC 
        LIMIT 1
      `, [userId]);

      if (kycCheck.rows.length === 0) {
        return {
          success: true,
          data: {
            verified: false,
            status: 'not_submitted',
            level: 0,
            message: 'KYC verification not submitted'
          }
        };
      }

      const kyc = kycCheck.rows[0]!;
      const isVerified = kyc.status === 'approved';

      return {
        success: true,
        data: {
          verified: isVerified,
          status: kyc.status,
          level: kyc.kyc_level || (isVerified ? 1 : 0),
          submittedAt: kyc.submitted_at,
          verifiedAt: kyc.reviewed_at,
          rejectionReason: kyc.rejection_reason
        }
      };
    } catch (error) {
      logger.error('Failed to check KYC status', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to check KYC status' }
      });
    }
  });

  // Get deposit address (authenticated)
  app.get<{ Params: { chainId: string } }>('/deposit-address/:chainId', {
    preHandler: [app.authenticate]
  }, async (request, reply) => {
    const userId = request.user!.id;
    const { chainId } = request.params;
    const dev = process.env.NODE_ENV === 'development';

    const fail = (code: string, message: string, detail?: string) =>
      reply.status(500).send({
        success: false,
        error: { code, message, ...(dev && detail ? { detail } : {}) }
      });

    try {
      // Hard-enforce operational deposit toggles (feature flag + emergency switch).
      const [depositFeatureEnabled, emergencyDisableDeposits] = await Promise.all([
        isFeatureToggleEnabled('deposit.enabled', true),
        isSystemSettingEnabled('emergency_disable_deposits', false),
      ]);
      if (!depositFeatureEnabled || emergencyDisableDeposits) {
        return reply.status(503).send({
          success: false,
          error: { code: 'DEPOSITS_PAUSED', message: 'Deposits are temporarily paused by system controls.' },
        });
      }

      // Step 1: KYC (support both kyc_applications and kyc_records)
      let isKycVerified = false;
      try {
        try {
          const kycCheck = await db.query(`SELECT status FROM kyc_applications WHERE user_id = $1 AND status = 'approved' LIMIT 1`, [userId]);
          isKycVerified = kycCheck.rows.length > 0;
        } catch {
          const kycRecords = await db.query(`SELECT status FROM kyc_records WHERE user_id = $1 AND status = 'approved' LIMIT 1`, [userId]);
          isKycVerified = kycRecords.rows.length > 0;
        }
      } catch (kycError) {
        const msg = kycError instanceof Error ? kycError.message : 'Unknown';
        logger.warn('KYC check failed', { error: msg });
        isKycVerified = false;
      }

      if (!isKycVerified) {
        return reply.status(403).send({
          success: false,
          error: { code: 'KYC_REQUIRED', message: 'Identity verification required to deposit', kycRequired: true }
        });
      }

      // Step 2: Chain lookup
      let chain: ChainDB;
      try {
        const chainCheck = await db.query<ChainDB>(
          `SELECT c.*, COALESCE(c.confirmations_required, 25) as confirmations_required
           FROM chains c WHERE (c.id::text = $1 OR LOWER(c.id) = LOWER($1) OR LOWER(c.name) = LOWER($1)) AND c.is_active = TRUE`,
          [chainId]
        );
        if (chainCheck.rows.length === 0) {
          return reply.status(400).send({
            success: false,
            error: { code: 'INVALID_CHAIN', message: 'Invalid or inactive chain' }
          });
        }
        chain = chainCheck.rows[0]!;
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Unknown';
        logger.error('Deposit address: chain lookup failed', { error: msg, chainId });
        return fail('CHAIN_LOOKUP_FAILED', 'Failed to get deposit address', msg);
      }

      // Step 3: Resolve wallet chain ID (EVM shares one address per user; use chain.id if wallet exists, else first EVM)
      let walletChainId = chain.id;
      if (chain.type === 'evm') {
        const existing = await walletService.getWallet(userId, chain.id as ChainId);
        if (!existing) {
          const ethChain = await db.query<{ id: string }>(`SELECT id FROM chains WHERE type = 'evm' AND is_active = TRUE ORDER BY id LIMIT 1`);
          if (ethChain.rows.length > 0) walletChainId = ethChain.rows[0]!.id;
        }
      }

      // Step 4: Get or create wallet
      let wallet: { address: string } | null = null;
      try {
        wallet = await walletService.getWallet(userId, walletChainId as ChainId);
        if (!wallet) {
          await walletService.createWalletsForUser(userId);
          wallet = await walletService.getWallet(userId, walletChainId as ChainId);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Unknown';
        logger.error('Deposit address: wallet get/create failed', { error: msg, userId, walletChainId });
        return fail('WALLET_CREATE_FAILED', 'Failed to get deposit address', msg);
      }

      if (!wallet) {
        return reply.status(500).send({
          success: false,
          error: { code: 'WALLET_CREATE_FAILED', message: 'Could not create or load wallet for this chain.' }
        });
      }

      const confirmations = chain.confirmations_required ?? chain.required_confirmations ?? 25;
      return {
        success: true,
        data: {
          address: wallet.address,
          chain: {
            id: chain.id,
            name: chain.name,
            type: chain.type,
            confirmationsRequired: confirmations,
            explorerUrl: chain.explorer_url || ''
          },
          qrCodeData: `${chain.type === 'evm' ? 'ethereum' : chain.name.toLowerCase()}:${wallet.address}`,
          notice: getDepositNotice(chain.type, confirmations)
        }
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Unknown';
      const errStack = error instanceof Error ? error.stack : undefined;
      logger.error('Deposit address: unexpected error', { error: errMsg, stack: errStack, userId, chainId });
      return reply.status(500).send({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to get deposit address',
          ...(dev && errMsg ? { detail: errMsg } : {})
        }
      });
    }
  });

  // Get all user wallets/addresses (authenticated)
  app.get('/addresses', {
    preHandler: [app.authenticate]
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user!.id;

      let wallets = await walletService.getUserWallets(userId);

      if (wallets.length === 0) {
        // Create wallets for user
        wallets = await walletService.createWalletsForUser(userId);
      }

      // Get chain info
      const chainsResult = await db.query<ChainDB>(
        'SELECT * FROM chains WHERE is_active = TRUE'
      );
      const chainsMap = new Map(chainsResult.rows.map(c => [c.id, c]));

      const addresses = wallets.map(w => {
        const chain = chainsMap.get(w.chainId);
        return {
          chainId: w.chainId,
          address: w.address,
          chainName: chain?.name || w.chainId,
          chainType: chain?.type || 'unknown',
          isEvm: chain?.type === 'evm'
        };
      });

      // Group EVM addresses (they share the same address)
      const evmAddress = addresses.find(a => a.isEvm)?.address;
      const evmChains = addresses.filter(a => a.isEvm).map(a => a.chainId);

      return {
        success: true,
        data: {
          addresses,
          evmAddress,
          evmChains,
          notice: 'EVM chains (Ethereum, BSC, Polygon, Arbitrum, Optimism, Base) share the same deposit address.'
        }
      };
    } catch (error) {
      logger.error('Failed to get user addresses', { 
        error: error instanceof Error ? error.message : 'Unknown',
        userId: request.user?.id 
      });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to get addresses' }
      });
    }
  });

  // Get recent deposits (authenticated)
  app.get<{ Querystring: { page?: string; limit?: string; status?: string } }>('/deposits', {
    preHandler: [app.authenticate]
  }, async (request, reply) => {
    try {
      const userId = request.user!.id;
      const page = parseInt(request.query.page || '1');
      const limit = Math.min(parseInt(request.query.limit || '20'), 100);
      const offset = (page - 1) * limit;
      const status = request.query.status;

      let query = `
        SELECT d.*, t.symbol, t.name as token_name, c.name as chain_name
        FROM transactions d
        JOIN tokens t ON d.token_id = t.id
        JOIN chains c ON d.chain_id = c.id
        WHERE d.user_id = $1 AND d.type = 'deposit'
      `;
      const params: unknown[] = [userId];

      if (status) {
        params.push(status);
        query += ` AND d.status = $${params.length}`;
      }

      query += ` ORDER BY d.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      params.push(limit, offset);

      const result = await db.query<DepositDB & { symbol: string; token_name: string; chain_name: string }>(query, params);

      // Get total count
      const countResult = await db.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM transactions WHERE user_id = $1 AND type = 'deposit'`,
        [userId]
      );

      return {
        success: true,
        data: result.rows,
        pagination: {
          page,
          limit,
          total: parseInt(countResult.rows[0]?.count || '0'),
          totalPages: Math.ceil(parseInt(countResult.rows[0]?.count || '0') / limit)
        }
      };
    } catch (error) {
      logger.error('Failed to get deposits', { 
        error: error instanceof Error ? error.message : 'Unknown',
        userId: request.user?.id 
      });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to get deposits' }
      });
    }
  });

  // Diagnostic: why funds/history might not show (authenticated, for debugging)
  app.get('/balance-diagnostic', {
    preHandler: [app.authenticate]
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user!.id;
      const out: Record<string, number | string | boolean> = { userId: userId.slice(0, 8) + '...' };
      try {
        const ub = await db.query<{ count: string }>(`SELECT COUNT(*) as count FROM user_balances WHERE user_id = $1`, [userId]);
        out.user_balances_rows = parseInt(ub.rows[0]?.count || '0', 10);
      } catch {
        out.user_balances_rows = 'table_missing_or_error';
      }
      let user_balances_funding_sum: string = '0';
      try {
        const ubSum = await db.query<{ total: string }>(`
          SELECT COALESCE(SUM(COALESCE(ub.available_balance, 0) + COALESCE(ub.locked_balance, 0)), 0)::text as total
          FROM user_balances ub WHERE ub.user_id = $1 AND COALESCE(ub.account_type::text, 'funding') IN ('funding', 'spot')
        `, [userId]);
        user_balances_funding_sum = new Decimal(ubSum.rows[0]?.total || '0').toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN).toString();
      } catch {
        user_balances_funding_sum = 'query_error';
      }
      out.user_balances_funding_sum = user_balances_funding_sum;
      try {
        const d = await db.query<{ count: string }>(`SELECT COUNT(*) as count FROM deposits WHERE user_id = $1`, [userId]);
        out.deposits_count = parseInt(d.rows[0]?.count || '0', 10);
      } catch {
        out.deposits_count = 'table_missing_or_error';
      }
      try {
        const w = await db.query<{ count: string }>(`SELECT COUNT(*) as count FROM withdrawals WHERE user_id = $1`, [userId]);
        out.withdrawals_count = parseInt(w.rows[0]?.count || '0', 10);
      } catch {
        out.withdrawals_count = 'table_missing_or_error';
      }
      const ubRows = Number(out.user_balances_rows) || 0;
      const ubFundingZero = typeof user_balances_funding_sum === 'string' && user_balances_funding_sum !== 'query_error'
        ? new Decimal(user_balances_funding_sum).isZero()
        : true;
      out.reason_funds_zero = ubRows === 0
        ? 'BUG: ZERO rows in user_balances (source of truth). Deposit credit or ensureUserBalanceRow must create row.'
        : ubFundingZero
          ? 'user_balances rows exist but SUM(available_balance+locked_balance) for funding is 0. Check account_type = funding.'
          : 'user_balances data exists; dashboard API should return non-zero. Check filters.';
      const depCount = Number(out.deposits_count) || 0;
      const withCount = Number(out.withdrawals_count) || 0;
      out.reason_history_empty = depCount === 0 && withCount === 0
        ? 'No deposits or withdrawals for this user in DB.'
        : 'Data exists; deposit-history or withdrawals API may use different schema (e.g. currency_id vs token_id).';
      return reply.send({ success: true, data: out });
    } catch (e) {
      logger.error('Balance diagnostic failed', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Diagnostic failed' } });
    }
  });

  // CRITICAL DEBUG: Data truth check — resolve user by email, return full user_balances rows and dashboard summary.
  // GET /balance-debug?email=nmnsingh02@gmail.com (email must be current user's email)
  // Returns: user_id, user_balances_rows (full), dashboard_summary (what API returns), reason_if_zero.
  app.get<{ Querystring: { email?: string } }>('/balance-debug', {
    preHandler: [app.authenticate]
  }, async (request, reply) => {
    try {
      const currentUserId = request.user!.id;
      let userId: string;
      if (request.query.email) {
        const u = await db.query<{ id: string; email: string }>(
          `SELECT id, email FROM users WHERE LOWER(TRIM(email)) = LOWER(TRIM($1)) AND deleted_at IS NULL LIMIT 1`,
          [request.query.email]
        );
        if (u.rows.length === 0) {
          return reply.status(404).send({ success: false, error: { code: 'USER_NOT_FOUND', message: 'User not found for this email' } });
        }
        userId = u.rows[0]!.id;
        if (userId !== currentUserId) {
          return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'You can only debug your own balance' } });
        }
      } else {
        userId = currentUserId;
      }

      const ubRows = await db.query<{
        user_id: string;
        currency_id: string;
        account_type: string;
        available_balance: string;
        locked_balance: string;
        pending_balance: string;
        total_deposited: string;
        updated_at: string;
      }>(`SELECT user_id, currency_id, account_type::text as account_type, available_balance::text, locked_balance::text, pending_balance::text, total_deposited::text, updated_at::text FROM user_balances WHERE user_id = $1`, [userId]);

      const fundingSum = await db.query<{ total: string }>(`
        SELECT COALESCE(SUM(COALESCE(ub.available_balance, 0) + COALESCE(ub.locked_balance, 0)), 0)::text as total
        FROM user_balances ub
        WHERE ub.user_id = $1 AND COALESCE(ub.account_type::text, 'funding') IN ('funding', 'spot')
      `, [userId]);
      const tradingSum = await db.query<{ total: string }>(`
        SELECT COALESCE(SUM(COALESCE(ub.available_balance, 0) + COALESCE(ub.locked_balance, 0)), 0)::text as total
        FROM user_balances ub
        WHERE ub.user_id = $1 AND COALESCE(ub.account_type::text, 'funding') = 'trading'
      `, [userId]);

      const fundingTotal = new Decimal(fundingSum.rows[0]?.total || '0').toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN);
      const tradingTotal = new Decimal(tradingSum.rows[0]?.total || '0').toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN);
      const reason_if_zero = ubRows.rows.length === 0
        ? 'BUG: ZERO rows in user_balances for this user — deposit credit or ensureUserBalanceRow did not create row.'
        : fundingTotal.isZero() && tradingTotal.isZero()
          ? 'Rows exist but SUM(available_balance + locked_balance) is 0 for funding and trading. Check account_type matches (canonical: funding).'
          : null;

      // Runtime must never read from deprecated balances table. user_balances is the only source of truth.
      const balances_table_warning = 'user_balances is the only source of truth; legacy balances table must not be used.';

      return reply.send({
        success: true,
        data: {
          user_id: userId,
          user_balances_rows: ubRows.rows,
          user_balances_row_count: ubRows.rows.length,
          dashboard_summary: {
            funding_total: fundingTotal.toString(),
            trading_total: tradingTotal.toString(),
            total: fundingTotal.plus(tradingTotal).toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN).toString()
          },
          reason_if_zero: reason_if_zero ?? 'Balance data present; dashboard should show non-zero.',
          balances_table_warning
        }
      });
    } catch (e) {
      logger.error('Balance debug failed', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Balance debug failed' } });
    }
  });

  /**
   * Account types (user_balances.account_type):
   * - funding: Deposits and withdrawals. Main on-ramp balance. Trading != funding; move funds to spot to trade.
   * - trading (spot): Spot trading wallet. Used for order margin and settlements. Separate from funding.
   * - escrow (p2p): P2P order escrow. Locked until order completes or is released.
   * Balances API returns per-row: asset, balance, available_balance, account_type.
   */
  app.get('/balances', {
    preHandler: [app.authenticate]
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user!.id;

      // Phase 1 (hardening): ensure rows exist for all three account types in parallel,
      // then do a SINGLE JOIN read covering funding/spot/trading + currency metadata.
      // Previous implementation issued 3 × (ensure+select) + 1 currencies query = 7
      // round trips. This path is 3 parallel ensures + 1 combined read.
      const currencyIds = await getActiveCurrencyIds();
      if (currencyIds.length > 0) {
        await Promise.all([
          ensureUserBalanceRowsBulk(userId, currencyIds, CHAIN_ID_GLOBAL, 'funding').catch((e) => {
            logger.warn('Balances: ensure(funding) failed', { userId, err: e instanceof Error ? e.message : String(e) });
          }),
          ensureUserBalanceRowsBulk(userId, currencyIds, CHAIN_ID_GLOBAL, 'spot').catch((e) => {
            logger.warn('Balances: ensure(spot) failed', { userId, err: e instanceof Error ? e.message : String(e) });
          }),
          ensureUserBalanceRowsBulk(userId, currencyIds, CHAIN_ID_GLOBAL, 'trading').catch((e) => {
            logger.warn('Balances: ensure(trading) failed', { userId, err: e instanceof Error ? e.message : String(e) });
          }),
        ]);
      }

      const { rows } = await db.query<{
        currency_id: string;
        symbol: string;
        name: string;
        account_type: string;
        available_balance: string;
        locked_balance: string;
      }>(
        `SELECT
           ub.currency_id,
           c.symbol AS symbol,
           COALESCE(c.name, c.symbol) AS name,
           ub.account_type::text AS account_type,
           COALESCE(ub.available_balance, 0)::text AS available_balance,
           COALESCE(ub.locked_balance,    0)::text AS locked_balance
         FROM user_balances ub
         JOIN currencies   c ON c.id = ub.currency_id
         WHERE ub.user_id = $1
           AND c.is_active = TRUE
           AND ub.account_type::text IN ('funding','spot','trading')
         ORDER BY c.symbol ASC, ub.account_type::text ASC`,
        [userId]
      );

      const balances = rows.map((r) => {
        const avail  = new Decimal(r.available_balance || '0').toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN);
        const locked = new Decimal(r.locked_balance    || '0').toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN);
        const total  = avail.plus(locked).toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN);
        return {
          asset: r.symbol,
          currency_id: r.currency_id,
          name: r.name || r.symbol,
          balance: total.toString(),
          available_balance: avail.toString(),
          locked_balance: locked.toString(),
          account_type: r.account_type,
        };
      });

      return reply.send({
        success: true,
        data: balances
      });
    } catch (error) {
      logger.error('Failed to get balances', {
        error: error instanceof Error ? error.message : 'Unknown',
        userId: request.user?.id
      });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to get balances' }
      });
    }
  });

  /**
   * GET /balances/spot — Spot wallet only (trading account). Read-only.
   * Returns: asset, balance, available_balance, account_type (Spot).
   */
  app.get('/balances/spot', {
    preHandler: [app.authenticate]
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user!.id;
      const rows = await readUserBalances(userId, 'trading');
      const namesResult = await db.query<{ id: string; name: string }>(
        `SELECT id, COALESCE(name, symbol) as name FROM currencies WHERE is_active = TRUE`
      );
      const nameById: Record<string, string> = {};
      namesResult.rows.forEach(row => { nameById[row.id] = row.name; });
      const data = rows.map(r => {
        const avail = new Decimal(r.available_balance || '0').toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN);
        const locked = new Decimal(r.locked_balance || '0').toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN);
        const balance = avail.plus(locked).toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN);
        return {
          asset: r.symbol,
          balance: balance.toString(),
          available_balance: avail.toString(),
          locked_balance: locked.toString(),
          account_type: 'spot' as const,
        };
      });
      return reply.send({ success: true, data });
    } catch (error) {
      logger.error('Failed to get spot balances', { error: error instanceof Error ? error.message : 'Unknown', userId: request.user?.id });
      return reply.status(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to get spot balances' } });
    }
  });

  // ============================================
  // WITHDRAWAL ENDPOINTS
  // ============================================

  // Get withdrawal history (authenticated)
  app.get<{ Querystring: { page?: string; limit?: string; status?: string; coin?: string } }>('/withdrawals', {
    preHandler: [app.authenticate]
  }, async (request, reply) => {
    try {
      const userId = request.user!.id;
      const page = parseInt(request.query.page || '1');
      const limit = Math.min(parseInt(request.query.limit || '20'), 100);
      const offset = (page - 1) * limit;
      const status = request.query.status;
      const coin = request.query.coin;

      // Check if withdrawals table exists
      const tableCheck = await db.query(`
        SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'withdrawals')
      `);

      const tcRow = tableCheck.rows[0] as { exists: boolean } | undefined;
      if (!tcRow || !tcRow.exists) {
        return { success: true, data: [], pagination: { page, limit, total: 0, totalPages: 0 } };
      }

      let query = `
        SELECT 
          w.id, w.user_id, w.token_id, w.chain_id, w.amount, w.fee, w.net_amount,
          w.to_address, w.tx_hash, w.status, w.created_at, w.processed_at, w.completed_at,
          w.failed_reason, w.rejection_reason,
          w.type as withdrawal_type, w.internal_user_id,
          t.symbol, t.name as token_name, t.icon_url as logo_url,
          c.name as chain_name, c.native_currency as chain_type,
          u_internal.email as internal_recipient_email
        FROM withdrawals w
        LEFT JOIN tokens t ON w.token_id = t.id
        LEFT JOIN chains c ON w.chain_id = c.id
        LEFT JOIN users u_internal ON w.internal_user_id = u_internal.id
        WHERE w.user_id = $1
      `;
      const params: unknown[] = [userId];

      if (status && status !== 'all') {
        params.push(status.toLowerCase());
        query += ` AND LOWER(w.status) = $${params.length}`;
      }

      if (coin && coin !== 'all') {
        params.push(coin.toUpperCase());
        query += ` AND UPPER(t.symbol) = $${params.length}`;
      }

      query += ` ORDER BY w.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      params.push(limit, offset);

      const result = await db.query(query, params);

      // Get total count
      let countQuery = `SELECT COUNT(*) as count FROM withdrawals w LEFT JOIN tokens t ON w.token_id = t.id WHERE w.user_id = $1`;
      const countParams: unknown[] = [userId];
      if (status && status !== 'all') {
        countParams.push(status.toLowerCase());
        countQuery += ` AND LOWER(w.status) = $${countParams.length}`;
      }
      if (coin && coin !== 'all') {
        countParams.push(coin.toUpperCase());
        countQuery += ` AND UPPER(t.symbol) = $${countParams.length}`;
      }
      const countResult = await db.query<{ count: string }>(countQuery, countParams);

      // Map status for display: all transitions reflected to user
      const displayStatus = (s: string) => {
        const v = (s || '').toLowerCase();
        if (v === 'pending_approval') return 'Pending approval';
        if (['pending', 'queued', 'signed', 'broadcasted', 'processing'].includes(v)) return 'Processing';
        if (v === 'completed') return 'Completed';
        if (v === 'rejected') return 'Rejected';
        if (v === 'failed') return 'Failed';
        if (v === 'cancelled') return 'Cancelled';
        return s || 'Unknown';
      };
      type WithdrawalRow = {
        id: string;
        symbol?: string;
        logo_url?: string;
        chain_name?: string;
        amount: string;
        fee?: string | null;
        net_amount?: string | null;
        to_address?: string | null;
        tx_hash?: string | null;
        status: string;
        created_at: string;
        withdrawal_type?: string;
        internal_user_id?: string | null;
        internal_recipient_email?: string | null;
        failed_reason?: string | null;
        rejection_reason?: string | null;
      };
      const mappedData = result.rows.map((w) => {
        const row = w as WithdrawalRow;
        const rejectionReason = row.rejection_reason ?? row.failed_reason ?? null;
        return {
          id: row.id,
          type: 'withdraw',
          amount: row.amount,
          fee: row.fee ?? '0',
          net_amount: row.net_amount ?? row.amount,
          status: row.status,
          displayStatus: displayStatus(row.status),
          chain: row.chain_name ?? 'Unknown',
          token: row.symbol ?? 'Unknown',
          tx_hash: row.tx_hash ?? null,
          rejection_reason: rejectionReason,
          coin: row.symbol || 'Unknown',
          coin_logo: row.logo_url || `/assets/upload/currency-logo/${(row.symbol || 'btc').toLowerCase()}.svg`,
          chain_type: row.chain_name || 'Unknown',
          quantity: row.amount,
          address: row.to_address ?? '',
          txid: row.tx_hash || '',
          date_time: row.created_at,
          withdrawal_type: row.withdrawal_type || 'onchain',
          internal_user_id: row.internal_user_id ?? null,
          internal_recipient_email: row.internal_recipient_email ?? null,
        };
      });

      return {
        success: true,
        data: mappedData,
        pagination: {
          page,
          limit,
          total: parseInt(countResult.rows[0]?.count || '0'),
          totalPages: Math.ceil(parseInt(countResult.rows[0]?.count || '0') / limit)
        }
      };
    } catch (error) {
      logger.error('Failed to get withdrawals', { 
        error: error instanceof Error ? error.message : 'Unknown',
        userId: request.user?.id 
      });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to get withdrawals' }
      });
    }
  });

  // Get user balances by account type (authenticated). Read ONLY from user_balances. SUM(available_balance + locked_balance).
  app.get('/balances/by-account', {
    preHandler: [app.authenticate]
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user!.id;
      const balancesByToken: Record<string, { symbol: string; name: string; funding: string; trading: string; total: string }> = {};
      const { getActiveCurrencyIds } = await import('../lib/active-currencies-cache.js');
      const currencyIds = await getActiveCurrencyIds();
      const [fundingRows, spotRows, tradingRows, namesResult] = await Promise.all([
        readUserBalances(userId, 'funding', currencyIds).catch((e) => {
          logger.warn('Balances by-account: readUserBalances(funding) failed', { userId, err: e instanceof Error ? e.message : String(e) });
          return [] as Awaited<ReturnType<typeof readUserBalances>>;
        }),
        readUserBalances(userId, 'spot', currencyIds).catch((e) => {
          logger.warn('Balances by-account: readUserBalances(spot) failed', { userId, err: e instanceof Error ? e.message : String(e) });
          return [] as Awaited<ReturnType<typeof readUserBalances>>;
        }),
        readUserBalances(userId, 'trading', currencyIds).catch((e) => {
          logger.warn('Balances by-account: readUserBalances(trading) failed', { userId, err: e instanceof Error ? e.message : String(e) });
          return [] as Awaited<ReturnType<typeof readUserBalances>>;
        }),
        db.query<{ id: string; symbol: string; name: string }>(
          `SELECT id, symbol, REGEXP_REPLACE(COALESCE(name, symbol), '\\s*\\([A-Z0-9]+\\)\\s*$', '', 'i') as name FROM currencies WHERE is_active = TRUE`
        ),
      ]);
      const nameBySymbol: Record<string, string> = {};
      namesResult.rows.forEach(row => {
        nameBySymbol[row.symbol] = row.name || row.symbol;
      });

      const addBalance = (rows: { currency_id: string; symbol: string; available_balance: string; locked_balance: string }[], bucket: 'funding' | 'trading') => {
        for (const r of rows) {
          const sym = r.symbol || '?';
          if (!balancesByToken[sym]) {
            balancesByToken[sym] = { symbol: sym, name: nameBySymbol[sym] ?? sym, funding: '0', trading: '0', total: '0' };
          }
          const bal = new Decimal(r.available_balance || '0').plus(r.locked_balance || '0').toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN).toString();
          const cur = new Decimal(balancesByToken[sym][bucket]);
          balancesByToken[sym][bucket] = cur.plus(bal).toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN).toString();
          const f = new Decimal(balancesByToken[sym].funding);
          const t = new Decimal(balancesByToken[sym].trading);
          balancesByToken[sym].total = f.plus(t).toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN).toString();
        }
      };
      addBalance(fundingRows, 'funding');
      addBalance(spotRows, 'funding');
      addBalance(tradingRows, 'trading');

      return {
        success: true,
        data: Object.values(balancesByToken)
      };
    } catch (error) {
      logger.error('Failed to get balances by account', {
        error: error instanceof Error ? error.message : 'Unknown',
        userId: request.user?.id
      });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to get balances' }
      });
    }
  });

  // Get withdrawal limits (authenticated)
  app.get<{ Querystring: { symbol?: string } }>('/withdrawal-limits', {
    preHandler: [app.authenticate]
  }, async (request, reply) => {
    try {
      const userId = request.user!.id;
      const symbol = request.query.symbol || 'USDT';

      // Get user's withdrawal limits from users table
      const userResult = await db.query(`
        SELECT 
          daily_withdrawal_limit,
          monthly_withdrawal_limit,
          vip_level
        FROM users
        WHERE id = $1
      `, [userId]);

      const user = userResult.rows[0];
      // Use stored limits; default to standard tier limits if zero (not configured)
      const rawDaily = new Decimal(user?.daily_withdrawal_limit || '0');
      const rawMonthly = new Decimal(user?.monthly_withdrawal_limit || '0');
      const dailyLimit = rawDaily.isZero() ? new Decimal('10000') : rawDaily.toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN);
      const monthlyLimit = rawMonthly.isZero() ? new Decimal('100000') : rawMonthly.toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN);

      // Get today's withdrawals (using actual enum values)
      const todayResult = await db.query<{ total: string }>(`
        SELECT COALESCE(SUM(w.amount), 0) as total
        FROM withdrawals w
        WHERE w.user_id = $1 
          AND w.status IN ('pending_approval', 'pending_email_verify', 'pending_2fa', 'pending_blockchain', 'processing', 'completed')
          AND w.created_at >= CURRENT_DATE
      `, [userId]);

      // Get this month's withdrawals
      const monthResult = await db.query<{ total: string }>(`
        SELECT COALESCE(SUM(w.amount), 0) as total
        FROM withdrawals w
        WHERE w.user_id = $1 
          AND w.status IN ('pending_approval', 'pending_email_verify', 'pending_2fa', 'pending_blockchain', 'processing', 'completed')
          AND w.created_at >= DATE_TRUNC('month', CURRENT_DATE)
      `, [userId]);

      const todayUsed = new Decimal(todayResult.rows[0]?.total || '0').toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN);
      const monthUsed = new Decimal(monthResult.rows[0]?.total || '0').toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN);
      const dailyRemaining = Decimal.max(0, dailyLimit.minus(todayUsed)).toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN);
      const monthlyRemaining = Decimal.max(0, monthlyLimit.minus(monthUsed)).toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN);
      const dailyPct = dailyLimit.isZero() ? new Decimal(0) : todayUsed.div(dailyLimit).times(100).toDecimalPlaces(2, ROUND_DOWN);
      const monthlyPct = monthlyLimit.isZero() ? new Decimal(0) : monthUsed.div(monthlyLimit).times(100).toDecimalPlaces(2, ROUND_DOWN);

      return {
        success: true,
        data: {
          daily: {
            limit: dailyLimit.toString(),
            used: todayUsed.toString(),
            remaining: dailyRemaining.toString(),
            percentage: dailyPct.toString()
          },
          monthly: {
            limit: monthlyLimit.toString(),
            used: monthUsed.toString(),
            remaining: monthlyRemaining.toString(),
            percentage: monthlyPct.toString()
          },
          vipLevel: user?.vip_level || 0
        }
      };
    } catch (error) {
      logger.error('Failed to get withdrawal limits', { 
        error: error instanceof Error ? error.message : 'Unknown',
        userId: request.user?.id 
      });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to get withdrawal limits' }
      });
    }
  });

  // -------------------------------------------------------------------------
  // GET /wallet/ledger — unified read-only ledger (deposits, withdrawals, conversions)
  // -------------------------------------------------------------------------
  app.get<{ Querystring: { page?: string; limit?: string; asset?: string; type?: string; from?: string; to?: string } }>('/ledger', {
    preHandler: [app.authenticate]
  }, async (request, reply) => {
    try {
      const userId = request.user!.id;
      const page = Math.max(1, parseInt(request.query.page || '1'));
      const limit = Math.min(100, Math.max(1, parseInt(request.query.limit || '20')));
      const offset = (page - 1) * limit;
      const assetFilter = request.query.asset?.trim().toUpperCase();
      const typeFilter = request.query.type?.toLowerCase();
      const fromDate = request.query.from ? new Date(request.query.from) : null;
      const toDate = request.query.to ? new Date(request.query.to) : null;

      const ledgerDisplayStatus = (s: string): string => {
        const v = (s || '').toLowerCase();
        if (['pending', 'pending_approval'].includes(v)) return 'Pending';
        if (['processing', 'queued', 'signed', 'broadcasted'].includes(v)) return 'Processing';
        if (v === 'completed') return 'Completed';
        if (['failed', 'rejected', 'cancelled'].includes(v)) return v === 'rejected' ? 'Rejected' : v === 'cancelled' ? 'Cancelled' : 'Failed';
        return s || 'Unknown';
      };
      type LedgerRow = {
        id: string;
        type: 'deposit' | 'withdrawal' | 'internal_transfer' | 'convert' | 'spot_trade';
        asset: string;
        amount: string;
        fee: string;
        direction: 'in' | 'out';
        status: string;
        displayStatus: string;
        reference_id: string;
        created_at: Date;
      };
      const rows: LedgerRow[] = [];

      if (!typeFilter || typeFilter === 'deposit') {
        try {
          let depQuery = `
            SELECT d.id, d.amount::text as amount, COALESCE(d.fee, 0)::text as fee, d.status, d.created_at, c.symbol
            FROM deposits d
            LEFT JOIN currencies c ON d.currency_id = c.id
            WHERE d.user_id = $1 AND (d.amount IS NULL OR d.amount::numeric > 0)
          `;
          const depParams: unknown[] = [userId];
          let pi = 2;
          if (assetFilter) {
            depQuery += ` AND UPPER(c.symbol) = $${pi}`;
            depParams.push(assetFilter);
            pi++;
          }
          if (fromDate && !isNaN(fromDate.getTime())) {
            depQuery += ` AND d.created_at >= $${pi}`;
            depParams.push(fromDate);
            pi++;
          }
          if (toDate && !isNaN(toDate.getTime())) {
            depQuery += ` AND d.created_at <= $${pi}`;
            depParams.push(toDate);
            pi++;
          }
          depQuery += ` ORDER BY d.created_at DESC LIMIT 500`;
          const depRes = await db.query<{ id: string; amount: string; fee: string; status: string; created_at: Date; symbol: string | null }>(depQuery, depParams);
          for (const r of depRes.rows) {
            rows.push({
              id: r.id,
              type: 'deposit',
              asset: r.symbol || '?',
              amount: r.amount,
              fee: r.fee || '0',
              direction: 'in',
              status: r.status,
              displayStatus: ledgerDisplayStatus(r.status),
              reference_id: r.id,
              created_at: r.created_at
            });
          }
        } catch {
          // deposits table may not exist or different schema
        }
      }

      if (!typeFilter || typeFilter === 'withdrawal' || typeFilter === 'internal_transfer') {
        try {
          let wQuery = `
            SELECT w.id, w.amount::text as amount, COALESCE(w.fee, 0)::text as fee, w.status, w.created_at, t.symbol, w.type as wtype
            FROM withdrawals w
            LEFT JOIN tokens t ON w.token_id = t.id
            WHERE w.user_id = $1
          `;
          const wParams: unknown[] = [userId];
          let pi = 2;
          if (typeFilter === 'withdrawal') {
            wQuery += ` AND (w.type IS NULL OR w.type != 'internal')`;
          } else if (typeFilter === 'internal_transfer') {
            wQuery += ` AND w.type = 'internal'`;
          }
          if (assetFilter) {
            wQuery += ` AND UPPER(t.symbol) = $${pi}`;
            wParams.push(assetFilter);
            pi++;
          }
          if (fromDate && !isNaN(fromDate.getTime())) {
            wQuery += ` AND w.created_at >= $${pi}`;
            wParams.push(fromDate);
            pi++;
          }
          if (toDate && !isNaN(toDate.getTime())) {
            wQuery += ` AND w.created_at <= $${pi}`;
            wParams.push(toDate);
            pi++;
          }
          wQuery += ` ORDER BY w.created_at DESC LIMIT 500`;
          const wRes = await db.query<{ id: string; amount: string; fee: string; status: string; created_at: Date; symbol: string | null; wtype: string | null }>(wQuery, wParams);
          for (const r of wRes.rows) {
            const entryType: LedgerRow['type'] = (r.wtype || '').toLowerCase() === 'internal' ? 'internal_transfer' : 'withdrawal';
            rows.push({
              id: r.id,
              type: entryType,
              asset: r.symbol || '?',
              amount: r.amount,
              fee: r.fee || '0',
              direction: 'out',
              status: r.status,
              displayStatus: ledgerDisplayStatus(r.status),
              reference_id: r.id,
              created_at: r.created_at
            });
          }
        } catch {
          // withdrawals table may not exist
        }
      }

      if (!typeFilter || typeFilter === 'convert') {
        try {
          let cQuery = `
            SELECT c.id, c.from_amount::text as amount, COALESCE(c.fee_amount, 0)::text as fee, c.status, c.created_at, fc.symbol as from_symbol
            FROM conversions c
            JOIN currencies fc ON c.from_currency_id = fc.id
            WHERE c.user_id = $1
          `;
          const cParams: unknown[] = [userId];
          let pi = 2;
          if (assetFilter) {
            cQuery += ` AND UPPER(fc.symbol) = $${pi}`;
            cParams.push(assetFilter);
            pi++;
          }
          if (fromDate && !isNaN(fromDate.getTime())) {
            cQuery += ` AND c.created_at >= $${pi}`;
            cParams.push(fromDate);
            pi++;
          }
          if (toDate && !isNaN(toDate.getTime())) {
            cQuery += ` AND c.created_at <= $${pi}`;
            cParams.push(toDate);
            pi++;
          }
          cQuery += ` ORDER BY c.created_at DESC LIMIT 500`;
          const cRes = await db.query<{ id: string; amount: string; fee: string; status: string; created_at: Date; from_symbol: string }>(cQuery, cParams);
          for (const r of cRes.rows) {
            rows.push({
              id: r.id,
              type: 'convert',
              asset: r.from_symbol || '?',
              amount: r.amount,
              fee: r.fee || '0',
              direction: 'out',
              status: r.status,
              displayStatus: ledgerDisplayStatus(r.status),
              reference_id: r.id,
              created_at: r.created_at
            });
          }
        } catch {
          // conversions table may not exist
        }
      }

      if (!typeFilter || typeFilter === 'spot_trade') {
        try {
          let stQuery = `
            SELECT st.id, st.order_id, st.side, st.price::text, st.quantity::text, COALESCE(st.fee, 0)::text as fee, st.created_at, st.market
            FROM spot_trades st
            WHERE st.user_id = $1
          `;
          const stParams: unknown[] = [userId];
          let pi = 2;
          if (assetFilter) {
            stQuery += ` AND (st.market LIKE $${pi} OR st.market LIKE $${pi + 1})`;
            stParams.push(assetFilter + '_%', '%_' + assetFilter);
            pi += 2;
          }
          if (fromDate && !isNaN(fromDate.getTime())) {
            stQuery += ` AND st.created_at >= $${pi}`;
            stParams.push(fromDate);
            pi++;
          }
          if (toDate && !isNaN(toDate.getTime())) {
            stQuery += ` AND st.created_at <= $${pi}`;
            stParams.push(toDate);
            pi++;
          }
          stQuery += ` ORDER BY st.created_at DESC LIMIT 500`;
          const stRes = await db.query<{ id: string; order_id: string; side: string; price: string; quantity: string; fee: string; created_at: Date; market: string }>(stQuery, stParams);
          for (const r of stRes.rows) {
            const [baseAsset, quoteAsset] = r.market.split('_');
            const asset = r.side === 'buy' ? (baseAsset || '?') : (quoteAsset || '?');
            const amount = r.side === 'buy' ? r.quantity : new Decimal(r.price).times(r.quantity).toDecimalPlaces(18, ROUND_DOWN).toString();
            rows.push({
              id: r.id,
              type: 'spot_trade',
              asset,
              amount,
              fee: r.fee || '0',
              direction: 'in',
              status: 'completed',
              displayStatus: 'Completed',
              reference_id: r.order_id,
              created_at: r.created_at
            });
          }
        } catch {
          // spot_trades table may not exist
        }
      }

      rows.sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
      const total = rows.length;
      const data = rows.slice(offset, offset + limit);

      return reply.send({
        success: true,
        data,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      logger.error('Failed to get ledger', { error: error instanceof Error ? error.message : 'Unknown', userId: request.user?.id });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to get ledger' }
      });
    }
  });

  // -------------------------------------------------------------------------
  // GET /wallet/fund-history — UX: combined deposit + withdrawal history (Funds tab)
  // -------------------------------------------------------------------------
  app.get<{ Querystring: { page?: string; limit?: string; kind?: string } }>('/fund-history', {
    preHandler: [app.authenticate]
  }, async (request, reply) => {
    try {
      const userId = request.user!.id;
      const page = Math.max(1, parseInt(request.query.page || '1'));
      const limit = Math.min(100, Math.max(1, parseInt(request.query.limit || '20')));
      const offset = (page - 1) * limit;
      const kind = (request.query.kind || 'all').toLowerCase(); // 'deposits' | 'withdrawals' | 'all'

      type FundItem = {
        id: string;
        kind: 'deposit' | 'withdrawal' | 'spot_trade';
        amount: string;
        fee: string;
        asset: string;
        status: string;
        created_at: string;
        tx_hash?: string | null;
        to_address?: string | null;
        displayStatus?: string;
        order_id?: string;
      };
      const combined: FundItem[] = [];

      if (kind === 'all' || kind === 'deposits') {
        try {
          const depRes = await db.query<{ id: string; amount: string; fee: string; status: string; created_at: Date; symbol: string | null }>(`
            SELECT d.id, d.amount::text as amount, COALESCE(d.fee, 0)::text as fee, d.status, d.created_at, c.symbol
            FROM deposits d
            LEFT JOIN currencies c ON d.currency_id = c.id
            WHERE d.user_id = $1 AND (d.amount IS NULL OR d.amount::numeric > 0)
            ORDER BY d.created_at DESC
            LIMIT 300
          `, [userId]);
          for (const r of depRes.rows) {
            combined.push({
              id: r.id,
              kind: 'deposit',
              amount: r.amount,
              fee: r.fee || '0',
              asset: r.symbol || '?',
              status: r.status,
              created_at: r.created_at.toISOString(),
              displayStatus: r.status === 'pending' ? 'Pending' : r.status === 'completed' ? 'Completed' : r.status === 'failed' ? 'Failed' : 'Processing'
            });
          }
        } catch {
          // skip
        }
      }

      if (kind === 'all' || kind === 'withdrawals') {
        try {
          const wRes = await db.query<{ id: string; amount: string; fee: string; status: string; created_at: Date; symbol: string | null; tx_hash: string | null; to_address: string | null }>(`
            SELECT w.id, w.amount::text as amount, COALESCE(w.fee, 0)::text as fee, w.status, w.created_at, t.symbol, w.tx_hash, w.to_address
            FROM withdrawals w
            LEFT JOIN tokens t ON w.token_id = t.id
            WHERE w.user_id = $1
            ORDER BY w.created_at DESC
            LIMIT 300
          `, [userId]);
          const displayStatus = (s: string) => {
            const v = (s || '').toLowerCase();
            if (v === 'pending_approval') return 'Pending';
            if (['pending', 'queued', 'signed', 'broadcasted', 'processing'].includes(v)) return 'Processing';
            if (v === 'completed') return 'Completed';
            if (v === 'rejected' || v === 'failed' || v === 'cancelled') return v === 'rejected' ? 'Rejected' : v === 'cancelled' ? 'Cancelled' : 'Failed';
            return s || 'Unknown';
          };
          for (const r of wRes.rows) {
            combined.push({
              id: r.id,
              kind: 'withdrawal',
              amount: r.amount,
              fee: r.fee || '0',
              asset: r.symbol || '?',
              status: r.status,
              created_at: r.created_at.toISOString(),
              tx_hash: r.tx_hash,
              to_address: r.to_address,
              displayStatus: displayStatus(r.status)
            });
          }
        } catch {
          // skip
        }
      }

      if (kind === 'all' || kind === 'spot_trade') {
        try {
          const stRes = await db.query<{ id: string; order_id: string; side: string; price: string; quantity: string; fee: string; created_at: Date; market: string }>(`
            SELECT id, order_id, side, price::text, quantity::text, COALESCE(fee, 0)::text as fee, created_at, market
            FROM spot_trades WHERE user_id = $1 ORDER BY created_at DESC LIMIT 300
          `, [userId]);
          for (const r of stRes.rows) {
            const [baseAsset, quoteAsset] = r.market.split('_');
            const asset = r.side === 'buy' ? (baseAsset || '?') : (quoteAsset || '?');
            const amount = r.side === 'buy' ? r.quantity : new Decimal(r.price).times(r.quantity).toDecimalPlaces(18, ROUND_DOWN).toString();
            combined.push({
              id: r.id,
              kind: 'spot_trade',
              amount,
              fee: r.fee || '0',
              asset,
              status: 'completed',
              created_at: r.created_at.toISOString(),
              displayStatus: 'Completed',
              order_id: r.order_id
            });
          }
        } catch {
          // skip
        }
      }

      combined.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      const total = combined.length;
      const data = combined.slice(offset, offset + limit);

      return reply.send({
        success: true,
        data,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
      });
    } catch (error) {
      logger.error('Failed to get fund-history', { error: error instanceof Error ? error.message : 'Unknown', userId: request.user?.id });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to get fund history' }
      });
    }
  });

  // -------------------------------------------------------------------------
  // GET /wallet/internal-transfers — withdrawals where type = 'internal' (direction: funding ↔ trading)
  // -------------------------------------------------------------------------
  app.get<{ Querystring: { page?: string; limit?: string; direction?: string } }>('/internal-transfers', {
    preHandler: [app.authenticate]
  }, async (request, reply) => {
    try {
      const userId = request.user!.id;
      const page = Math.max(1, parseInt(request.query.page || '1'));
      const limit = Math.min(100, Math.max(1, parseInt(request.query.limit || '20')));
      const offset = (page - 1) * limit;
      const directionFilter = request.query.direction?.toLowerCase(); // 'funding_to_trading' | 'trading_to_funding' | omit = all

      let query = `
        SELECT w.id, w.amount::text, COALESCE(w.fee, 0)::text as fee, w.status, w.created_at, w.account_type,
          t.symbol, u_internal.email as internal_recipient_email
        FROM withdrawals w
        LEFT JOIN tokens t ON w.token_id = t.id
        LEFT JOIN users u_internal ON w.internal_user_id = u_internal.id
        WHERE w.user_id = $1 AND (w.type = 'internal' OR w.type IS NULL AND w.internal_user_id IS NOT NULL)
      `;
      const params: unknown[] = [userId];
      let pi = 2;
      if (directionFilter === 'funding_to_trading') {
        query += ` AND w.account_type IN ('funding', 'spot')`;
      } else if (directionFilter === 'trading_to_funding') {
        query += ` AND w.account_type = 'trading'`;
      }
      query += ` ORDER BY w.created_at DESC LIMIT $${pi} OFFSET $${pi + 1}`;
      params.push(limit, offset);

      const tableCheck = await db.query(`SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'withdrawals')`);
      const tableRow = tableCheck.rows[0] as { exists: boolean } | undefined;
      if (!tableRow || !tableRow.exists) {
        return reply.send({
          success: true,
          data: [],
          pagination: { page, limit, total: 0, totalPages: 0 }
        });
      }

      const countResult = await db.query<{ count: string }>(`
        SELECT COUNT(*) as count FROM withdrawals w
        WHERE w.user_id = $1 AND (w.type = 'internal' OR (w.type IS NULL AND w.internal_user_id IS NOT NULL))
        ${directionFilter === 'funding_to_trading' ? ` AND w.account_type IN ('funding', 'spot')` : ''}
        ${directionFilter === 'trading_to_funding' ? ` AND w.account_type = 'trading'` : ''}
      `, [userId]);
      const total = parseInt(countResult.rows[0]?.count || '0');

      const result = await db.query(query, params);
      const displayStatus = (s: string) => {
        const v = (s || '').toLowerCase();
        if (v === 'pending_approval') return 'Pending';
        if (['pending', 'queued', 'signed', 'broadcasted', 'processing'].includes(v)) return 'Processing';
        if (v === 'completed') return 'Completed';
        if (v === 'rejected' || v === 'failed' || v === 'cancelled') return v === 'rejected' ? 'Rejected' : v === 'cancelled' ? 'Cancelled' : 'Failed';
        return s || 'Unknown';
      };
      const data = result.rows.map((w) => {
        const row = w as { id: string; amount: string; fee: string; status: string; created_at: Date; account_type: string; symbol: string | null; internal_recipient_email: string | null };
        return ({
        id: row.id,
        amount: row.amount,
        fee: row.fee,
        asset: row.symbol || '?',
        status: row.status,
        displayStatus: displayStatus(row.status),
        direction: (row.account_type || 'funding').toLowerCase() === 'trading' ? 'trading_to_funding' : 'funding_to_trading',
        account_type: row.account_type,
        internal_recipient_email: row.internal_recipient_email ?? null,
        created_at: row.created_at
      }); });

      return reply.send({
        success: true,
        data,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
      });
    } catch (error) {
      logger.error('Failed to get internal transfers', { error: error instanceof Error ? error.message : 'Unknown', userId: request.user?.id });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to get internal transfers' }
      });
    }
  });

  // Get withdrawal fee for a specific token and chain
  app.get<{ Params: { symbol: string; chainId: string } }>('/withdrawal-fee/:symbol/:chainId', async (request, reply) => {
    try {
      const { symbol, chainId } = request.params;

      const result = await db.query(`
        SELECT 
          t.withdrawal_fee,
          t.min_withdrawal,
          t.decimals,
          c.name as chain_name
        FROM tokens t
        JOIN chains c ON t.chain_id = c.id
        WHERE UPPER(t.symbol) = UPPER($1) 
          AND (c.id = $2 OR LOWER(COALESCE(c.id, c.name)) = LOWER($2))
          AND t.is_active = TRUE
        LIMIT 1
      `, [symbol, chainId]);

      if (result.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Token or chain not found' }
        });
      }

      const token = result.rows[0]!;

      return {
        success: true,
        data: {
          fee: token.withdrawal_fee || '0',
          minWithdrawal: token.min_withdrawal || '0',
          decimals: token.decimals,
          chainName: token.chain_name
        }
      };
    } catch (error) {
      logger.error('Failed to get withdrawal fee', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to get withdrawal fee' }
      });
    }
  });

  // Withdrawal preview: fee and net amount (authenticated, for UI)
  app.get<{ Querystring: WithdrawPreviewQuerystring }>('/withdraw/preview', { preHandler: [app.authenticate] }, handleWithdrawPreview);

  // Create withdrawal request (authenticated)
  // type: 'onchain' | 'internal'. Internal: use internal_user_identifier (email/uid/phone); no toAddress. On-chain: toAddress required.
  // FIX #4: Rate limit 5/hour per user (after authenticate).
  app.post<{
    Body: {
      symbol: string;
      chainId?: string;
      amount: string;
      toAddress?: string;
      accountType?: string;
      memo?: string;
      twoFactorCode?: string;
      fund_password?: string;
      withdrawalAddressId?: string;
      type?: 'onchain' | 'internal';
      internal_user_identifier?: string;
    };
  }>('/withdrawals', {
    preHandler: [app.authenticate, rateLimitByUser('wallet:withdrawal', 5, 3600, { failClosed: config.rateLimit.failClosed })],
  }, async (request, reply) => {
    try {
      // Hard-enforce operational withdrawal toggles (feature flag + emergency switch).
      const [withdrawFeatureEnabled, emergencyDisableWithdrawals] = await Promise.all([
        isFeatureToggleEnabled('withdrawal.enabled', true),
        isSystemSettingEnabled('emergency_disable_withdrawals', false),
      ]);
      if (!withdrawFeatureEnabled || emergencyDisableWithdrawals) {
        return reply.status(503).send({
          success: false,
          error: { code: 'WITHDRAWALS_PAUSED', message: 'Withdrawals are temporarily paused by system controls.' },
        });
      }

      if (request.user?.allowWithdraw === false) {
        return reply.status(403).send({
          success: false,
          error: { code: 'API_KEY_NO_WITHDRAW', message: 'This API key does not have withdrawal permission. Use a key with withdraw scope or log in with your account.' },
        });
      }
      const userId = request.user!.id;
      const { redisBlocksUserWithdrawals } = await import('../services/redis-health.service.js');
      if (redisBlocksUserWithdrawals()) {
        return reply.status(503).send({
          success: false,
          error: {
            code: 'REDIS_UNAVAILABLE',
            message: 'Withdrawals are unavailable while Redis is unhealthy.',
          },
        });
      }
      const withdrawType = (request.body.type ?? 'onchain') as 'onchain' | 'internal';
      let { symbol, chainId, amount, toAddress, accountType = 'funding', memo, twoFactorCode, fund_password, withdrawalAddressId, internal_user_identifier } = request.body;
      const allowedWithdrawalAccounts = ['funding', 'spot', 'trading'];
      if (!allowedWithdrawalAccounts.includes(accountType)) {
        accountType = 'funding';
      }

      // Idempotency: check BEFORE any balance lock or DB write
      const idempotencyKeyRaw = (request.headers[IDEMPOTENCY_KEY_HEADER] ?? request.headers['Idempotency-Key']) as string | undefined;
      const idempotencyKey = typeof idempotencyKeyRaw === 'string' ? idempotencyKeyRaw.trim() : '';
      if (!idempotencyKey) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'IDEMPOTENCY_KEY_REQUIRED',
            message: 'Idempotency-Key header is required for withdrawal requests.',
          },
        });
      }
      if (idempotencyKey.length > 256) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'IDEMPOTENCY_KEY_INVALID',
            message: 'Idempotency-Key must be at most 256 characters.',
          },
        });
      }
      const requestHash = buildWithdrawalRequestHash(request.body as Record<string, unknown>);
      const redisKey = `withdrawal:idempotency:${userId}:${idempotencyKey}`;
      const cached = await redis.getJson<WithdrawalIdempotencyCache>(redisKey);
      if (cached) {
        if (cached.requestHash !== requestHash) {
          logger.warn('Idempotency key reuse with different payload', {
            userId,
            idempotencyKey: idempotencyKey.slice(0, 32),
            existingWithdrawalId: cached.withdrawalId,
          });
          return reply.status(409).send({
            success: false,
            error: {
              code: 'IDEMPOTENCY_KEY_REUSED',
              message: 'Idempotency-Key was already used with a different request body. Use a new key or the same request body.',
            },
          });
        }
        // Verify: refresh status from DB so we return current state
        try {
          const verifyRes = await db.query<{ status: string }>(
            `SELECT status FROM withdrawals WHERE id = $1 AND user_id = $2 LIMIT 1`,
            [cached.withdrawalId, userId]
          );
          if (verifyRes.rows.length > 0) {
            const currentStatus = verifyRes.rows[0]!.status;
            const resp = { ...cached.response };
            if (resp.data && typeof resp.data === 'object' && 'status' in resp.data) {
              (resp.data as Record<string, unknown>).status = currentStatus;
            }
            return reply.status(200).send(resp);
          }
        } catch {
          /* fallback to cached */
        }
        return reply.status(200).send(cached.response);
      }

      // Cache miss: acquire lock so concurrent requests with same key cannot both proceed
      const lockKey = `withdrawal:idempotency:lock:${userId}:${idempotencyKey}`;
      const lockAcquired = await redis.setNxEx(lockKey, '1', WITHDRAWAL_IDEMPOTENCY_LOCK_TTL_SECONDS);
      if (!lockAcquired) {
        return reply.status(409).send({
          success: false,
          error: {
            code: 'IDEMPOTENCY_KEY_IN_PROGRESS',
            message: 'A withdrawal with this Idempotency-Key is already in progress. Retry after a few seconds.',
          },
        });
      }

      try {
      // Validate input
      if (!symbol || !amount) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_INPUT', message: 'Missing required fields: symbol, amount' }
        });
      }
      if (withdrawType === 'internal') {
        if (!internal_user_identifier || typeof internal_user_identifier !== 'string' || !internal_user_identifier.trim()) {
          return reply.status(400).send({
            success: false,
            error: { code: 'INVALID_INPUT', message: 'Internal transfer requires internal_user_identifier (email, user id, or phone)' }
          });
        }
      } else {
        if (!chainId || !toAddress) {
          return reply.status(400).send({
            success: false,
            error: { code: 'INVALID_INPUT', message: 'On-chain withdrawal requires chainId and toAddress' }
          });
        }
      }

      let withdrawAmountDec: DecimalInstance;
      try {
        withdrawAmountDec = new Decimal(amount).toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN);
      } catch {
        withdrawAmountDec = new Decimal(NaN);
      }
      if (!withdrawAmountDec.isFinite() || withdrawAmountDec.lte(0)) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_AMOUNT', message: 'Invalid withdrawal amount' }
        });
      }

      // ---------- INTERNAL TRANSFER (Binance-style: any currency with balance can be transferred) ----------
      if (withdrawType === 'internal') {
        const identifier = internal_user_identifier!.trim();
        let symbolNorm = (typeof symbol === 'string' ? symbol : '').trim();
        if (!symbolNorm) {
          return reply.status(400).send({
            success: false,
            error: { code: 'INVALID_TOKEN', message: 'Please select a coin' }
          });
        }
        if (symbolNorm.includes(' ')) {
          symbolNorm = symbolNorm.split(/\s+/)[0]!.trim() || symbolNorm;
        }
        const currencyId = await getCurrencyIdBySymbol(symbolNorm);
        if (!currencyId) {
          return reply.status(400).send({
            success: false,
            error: { code: 'INVALID_TOKEN', message: 'This asset is not available for internal transfer' }
          });
        }
        let token: { token_id: string | null; chain_id: string | null; symbol: string; min_withdrawal: string | null; max_withdrawal: string | null; chain_name: string };
        const tokenResult = await db.query(`
          SELECT t.id as token_id, t.symbol, t.decimals, t.withdrawal_fee, t.min_withdrawal, t.max_withdrawal, t.chain_id,
                 c.id as chain_id, c.name as chain_name
          FROM tokens t
          JOIN chains c ON t.chain_id = c.id
          WHERE UPPER(t.symbol) = UPPER($1) AND t.is_active = TRUE
          LIMIT 1
        `, [symbolNorm]);
        if (tokenResult.rows.length > 0) {
          token = tokenResult.rows[0]! as { token_id: string | null; chain_id: string | null; symbol: string; min_withdrawal: string | null; max_withdrawal: string | null; chain_name: string };
        } else {
          token = {
            token_id: null,
            chain_id: null,
            symbol: symbolNorm,
            min_withdrawal: '0',
            max_withdrawal: null,
            chain_name: 'Internal'
          };
        }
        const recipientRow = await db.query<{ id: string }>(
          `SELECT id FROM users WHERE status = 'active' AND deleted_at IS NULL AND (
            id::text = $1 OR LOWER(TRIM(email)) = LOWER(TRIM($1)) OR TRIM(phone) = TRIM($1)
          ) LIMIT 1`,
          [identifier]
        );
        if (recipientRow.rows.length === 0) {
          return reply.status(400).send({
            success: false,
            error: { code: 'INVALID_INTERNAL_USER', message: 'Recipient not found' }
          });
        }
        const recipientId = recipientRow.rows[0]!.id;
        if (recipientId === userId) {
          return reply.status(400).send({
            success: false,
            error: { code: 'INVALID_INTERNAL_USER', message: 'Cannot transfer to yourself' }
          });
        }
        // Internal transfer: enforce 2FA and/or fund password when user has them enabled
        const { verifyUser2FA: verify2FA, userHas2FA: userHas2FACheck, userHasFundPassword, verifyFundPassword } = await import('../lib/totp-verify.js');
        const has2FAInternal = await userHas2FACheck(userId);
        const hasFundPwdInternal = await userHasFundPassword(userId);
        let internalTwoFaVerified = false;
        if (has2FAInternal) {
          if (!twoFactorCode || typeof twoFactorCode !== 'string') {
            return reply.status(400).send({
              success: false,
              error: { code: '2FA_REQUIRED', message: 'Two-factor code is required for withdrawal' }
            });
          }
          const valid2FA = await verify2FA(userId, twoFactorCode.trim());
          if (!valid2FA) {
            return reply.status(400).send({
              success: false,
              error: { code: 'INVALID_2FA', message: 'Invalid two-factor code' }
            });
          }
          internalTwoFaVerified = true;
        }
        if (hasFundPwdInternal) {
          if (!fund_password || typeof fund_password !== 'string') {
            return reply.status(400).send({
              success: false,
              error: { code: 'FUND_PASSWORD_REQUIRED', message: 'Fund password is required for withdrawal' }
            });
          }
          const validFundPwd = await verifyFundPassword(userId, fund_password);
          if (!validFundPwd) {
            return reply.status(400).send({
              success: false,
              error: { code: 'INVALID_FUND_PASSWORD', message: 'Invalid fund password' }
            });
          }
        }
        const feeDec = new Decimal(0);
        const minWithdrawal = new Decimal(token.min_withdrawal ?? '0').toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN);
        const maxWithdrawalRaw = token.max_withdrawal != null ? new Decimal(String(token.max_withdrawal)).toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN) : null;
        if (minWithdrawal.gt(0) && withdrawAmountDec.lt(minWithdrawal)) {
          return reply.status(400).send({
            success: false,
            error: { code: 'BELOW_MINIMUM', message: `Minimum is ${minWithdrawal.toString()} ${symbol}` }
          });
        }
        if (maxWithdrawalRaw != null && withdrawAmountDec.gt(maxWithdrawalRaw)) {
          return reply.status(400).send({
            success: false,
            error: { code: 'ABOVE_MAXIMUM', message: `Maximum withdrawal is ${maxWithdrawalRaw.toString()} ${symbol}` }
          });
        }
        logger.info('[WITHDRAW_LIMIT]', {
          symbol: token.symbol,
          min_withdrawal: minWithdrawal.toString(),
          max_withdrawal: maxWithdrawalRaw?.toString() ?? 'unlimited',
          amount: withdrawAmountDec.toString(),
        });
        // currencyId already resolved above for internal transfer
        // Use same rows we will debit: funding/spot with chain_id = '' (CHAIN_ID_GLOBAL). Avoids mismatch with readUserBalances.
        const balanceRows = await db.query<{ available_balance: string }>(
          `SELECT COALESCE(available_balance, 0)::text AS available_balance
           FROM user_balances
           WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3
             AND LOWER(TRIM(COALESCE(account_type::text, ''))) IN ('funding', 'spot')`,
          [userId, currencyId, CHAIN_ID_GLOBAL]
        );
        const availableBalance = balanceRows.rows.reduce(
          (sum, r) => sum.plus(r.available_balance || '0'),
          new Decimal(0)
        ).toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN);
        const epsilon = new Decimal('1e-8');
        if (availableBalance.lt(withdrawAmountDec.minus(epsilon))) {
          logger.warn('Internal transfer insufficient balance', {
            userId,
            currencyId,
            symbol: token.symbol,
            availableBalance: availableBalance.toString(),
            withdrawAmount: withdrawAmountDec.toString(),
            byAccountRows: balanceRows.rows.length,
          });
          return reply.status(400).send({
            success: false,
            error: { code: 'INSUFFICIENT_BALANCE', message: 'Insufficient balance' }
          });
        }
        const treasuryInternal = await assertWithdrawalAllowedForTreasuryPolicy({
          userId,
          assetSymbol: symbolNorm,
        });
        if (!treasuryInternal.ok) {
          return reply.status(503).send({
            success: false,
            error: { code: treasuryInternal.code, message: treasuryInternal.message },
          });
        }
        // Internal transfer is always funding->funding; use CHAIN_ID_GLOBAL so we match user_balances rows (chain_id = '')
        // History: internal_transfers INSERT is inside the same transaction so history is always created when balance updates
        const withdrawalInternal = await db.transaction(async (client) => {
          await ensureUserBalanceRow(userId, currencyId, CHAIN_ID_GLOBAL, 'funding', client);
          await ensureUserBalanceRow(recipientId, currencyId, CHAIN_ID_GLOBAL, 'funding', client);
          const ins = await client.query<{ id: string; created_at: string }>(`
            INSERT INTO withdrawals (
              user_id, token_id, chain_id, amount, fee, net_amount, to_address, status, account_type,
              type, internal_user_id, email_verified, two_fa_verified, treasury_stage
            ) VALUES ($1, $2, $3, $4, $5, $6, NULL, 'completed', 'funding', 'internal', $7, FALSE, $8, 'broadcasted')
            RETURNING id, created_at
          `, [userId, token.token_id, token.chain_id, withdrawAmountDec.toString(), feeDec.toString(), withdrawAmountDec.toString(), recipientId, internalTwoFaVerified]);
          const w = ins.rows[0]!;
          const amtStr = withdrawAmountDec.toString();
          const refId = w.id;

          const senderLock = await client.query<{ id: string; available_balance: string; account_type: string }>(
            `SELECT id, available_balance::text, COALESCE(account_type::text, 'funding') as account_type FROM user_balances
             WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3
               AND COALESCE(account_type::text, 'funding') IN ('funding', 'spot')
               AND available_balance >= $4::numeric
             ORDER BY available_balance DESC NULLS LAST
             LIMIT 1
             FOR UPDATE`,
            [userId, currencyId, CHAIN_ID_GLOBAL, amtStr]
          );
          if (senderLock.rows.length === 0) {
            throw new Error('INSUFFICIENT_BALANCE');
          }
          const senderRow = senderLock.rows[0]!;
          const senderAvBefore = new Decimal(senderRow.available_balance);
          const senderUpd = await client.query(
            `UPDATE user_balances SET available_balance = available_balance - $1::numeric, updated_at = NOW() WHERE id = $2 RETURNING *`,
            [amtStr, senderRow.id]
          );
          assertUserBalanceUpdated('internal_transfer_debit', senderUpd, userId, currencyId, 'funding', CHAIN_ID_GLOBAL);
          assertBalanceInvariant(senderUpd.rows[0]);
          await insertBalanceLedger({
            client,
            userId,
            currencyId,
            accountType: senderRow.account_type,
            debit: amtStr,
            credit: '0',
            balanceBefore: senderAvBefore.toFixed(),
            balanceAfter: senderAvBefore.minus(amtStr).toFixed(),
            referenceType: 'internal_transfer',
            referenceId: refId,
            balanceType: 'available',
          });

          const receiverLock = await client.query<{ id: string; available_balance: string }>(
            `SELECT id, available_balance::text FROM user_balances
             WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND COALESCE(account_type::text, 'funding') = 'funding'
             LIMIT 1
             FOR UPDATE`,
            [recipientId, currencyId, CHAIN_ID_GLOBAL]
          );
          if (receiverLock.rows.length === 0) {
            throw new Error('RECIPIENT_BALANCE_ROW_NOT_FOUND');
          }
          const receiverRow = receiverLock.rows[0]!;
          const receiverAvBefore = new Decimal(receiverRow.available_balance);
          const receiverUpd = await client.query(
            `UPDATE user_balances SET available_balance = available_balance + $1::numeric, updated_at = NOW() WHERE id = $2 RETURNING *`,
            [amtStr, receiverRow.id]
          );
          assertUserBalanceUpdated('internal_transfer_credit', receiverUpd, recipientId, currencyId, 'funding', CHAIN_ID_GLOBAL);
          assertBalanceInvariant(receiverUpd.rows[0]);
          await insertBalanceLedger({
            client,
            userId: recipientId,
            currencyId,
            accountType: 'funding',
            debit: '0',
            credit: amtStr,
            balanceBefore: receiverAvBefore.toFixed(),
            balanceAfter: receiverAvBefore.plus(amtStr).toFixed(),
            referenceType: 'internal_transfer',
            referenceId: refId,
            balanceType: 'available',
          });
          // Create history in same transaction so it never happens without balance update (Binance-style)
          await client.query(
            `INSERT INTO internal_transfers (from_user_id, to_user_id, currency_id, amount, transfer_type, status, notes)
             VALUES ($1, $2, $3, $4::numeric, 'user_to_user', 'completed', $5)`,
            [userId, recipientId, currencyId, withdrawAmountDec.toString(), `Internal transfer to recipient`]
          );
          return w;
        });
        await logWithdrawalLifecycle('withdrawal_internal_completed', {
          withdrawal_id: withdrawalInternal.id,
          user_id: userId,
          admin_id: null,
          token_id: token.token_id,
          chain_id: token.chain_id,
          amount: withdrawAmountDec.toString(),
          ip: request.ip ?? undefined,
          user_agent: request.headers['user-agent'] ?? undefined,
        });
        auditLog('withdrawal_internal_completed', userId, {
          withdrawalId: withdrawalInternal.id,
          symbol,
          amount: withdrawAmountDec.toString(),
          recipientId,
        });
        const amtStr = withdrawAmountDec.toString();
        recordAndEvaluate({
          userId,
          txnType: 'internal_transfer',
          asset: symbol,
          amount: amtStr,
          fiatAmount: null,
          fiatCurrency: null,
          countryCode: null,
        }).catch((e) =>
          logger.warn('AML internal_transfer (sender) failed (best-effort)', {
            userId,
            error: e instanceof Error ? e.message : String(e),
          })
        );
        recordAndEvaluate({
          userId: recipientId,
          txnType: 'internal_transfer',
          asset: symbol,
          amount: amtStr,
          fiatAmount: null,
          fiatCurrency: null,
          countryCode: null,
        }).catch((e) =>
          logger.warn('AML internal_transfer (recipient) failed (best-effort)', {
            userId: recipientId,
            error: e instanceof Error ? e.message : String(e),
          })
        );
        const internalResponse = {
          success: true as const,
          data: {
            id: withdrawalInternal.id,
            symbol,
            chain: token.chain_name,
            amount: withdrawAmountDec.toString(),
            fee: '0',
            netAmount: withdrawAmountDec.toString(),
            toAddress: null,
            type: 'internal',
            status: 'completed',
            createdAt: withdrawalInternal.created_at,
          },
        };
        try {
          await redis.setJson(
            redisKey,
            { withdrawalId: withdrawalInternal.id, requestHash, response: internalResponse },
            WITHDRAWAL_IDEMPOTENCY_TTL_SECONDS
          );
        } catch (e) {
          logger.warn('Withdrawal idempotency cache set failed', {
            userId,
            idempotencyKey: idempotencyKey.slice(0, 32),
            error: e instanceof Error ? e.message : String(e),
          });
        }
        return reply.send(internalResponse);
      }

      // ---------- ON-CHAIN WITHDRAWAL ----------
      // Get token and chain info (include is_high_risk for approval flow)
      const tokenResult = await db.query(`
        SELECT 
          t.id as token_id, t.symbol, t.decimals, t.withdrawal_fee, t.min_withdrawal, t.max_withdrawal,
          COALESCE(t.is_high_risk, FALSE) as is_high_risk,
          c.id as chain_id, c.name as chain_name, c.type as chain_type
        FROM tokens t
        JOIN chains c ON t.chain_id = c.id
        WHERE UPPER(t.symbol) = UPPER($1) 
          AND (c.id = $2 OR LOWER(COALESCE(c.id, c.name)) = LOWER($2))
          AND t.is_active = TRUE AND c.is_active = TRUE
        LIMIT 1
      `, [symbol, chainId!]);

      if (tokenResult.rows.length === 0) {
        logger.warn('Withdrawal creation failed: INVALID_TOKEN (token or chain not found)', {
          user_id: userId,
          chain_id: chainId,
          symbol,
        });
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_TOKEN', message: 'Invalid token or chain' }
        });
      }

      const token = tokenResult.rows[0]!;
      const treasuryGate = await assertWithdrawalAllowedForTreasuryPolicy({
        userId,
        assetSymbol: token.symbol,
      });
      if (!treasuryGate.ok) {
        return reply.status(503).send({
          success: false,
          error: { code: treasuryGate.code, message: treasuryGate.message },
        });
      }
      const rawFee = token.withdrawal_fee;
      if (rawFee == null || rawFee === '') {
        logger.warn('tokens.withdrawal_fee is NULL or empty, defaulting to 0', {
          symbol: token.symbol,
          chain_id: token.chain_id,
        });
      }
      const feeDec = new Decimal(rawFee || '0').toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN);
      const minWithdrawal = new Decimal(token.min_withdrawal ?? '0').toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN);
      const maxWithdrawalRaw = token.max_withdrawal != null ? new Decimal(String(token.max_withdrawal)).toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN) : null;

      // Token-driven validation: min only if > 0, max only if NOT NULL
      if (minWithdrawal.gt(0) && withdrawAmountDec.lt(minWithdrawal)) {
        logger.warn('Withdrawal creation failed: BELOW_MINIMUM', {
          user_id: userId,
          chain_id: token.chain_id,
          symbol: token.symbol,
          amount: withdrawAmountDec.toString(),
          min_withdrawal: minWithdrawal.toString(),
          max_withdrawal: maxWithdrawalRaw?.toString() ?? 'unlimited',
        });
        return reply.status(400).send({
          success: false,
          error: { code: 'BELOW_MINIMUM', message: `Minimum withdrawal is ${minWithdrawal.toString()} ${symbol}` }
        });
      }
      if (maxWithdrawalRaw != null && withdrawAmountDec.gt(maxWithdrawalRaw)) {
        logger.warn('Withdrawal creation failed: ABOVE_MAXIMUM', {
          user_id: userId,
          chain_id: token.chain_id,
          symbol: token.symbol,
          amount: withdrawAmountDec.toString(),
          max_withdrawal: maxWithdrawalRaw.toString(),
        });
        return reply.status(400).send({
          success: false,
          error: { code: 'ABOVE_MAXIMUM', message: `Maximum withdrawal is ${maxWithdrawalRaw.toString()} ${symbol}` }
        });
      }

      logger.info('[WITHDRAW_LIMIT]', {
        symbol: token.symbol,
        min_withdrawal: minWithdrawal.toString(),
        max_withdrawal: maxWithdrawalRaw?.toString() ?? 'unlimited',
        amount: withdrawAmountDec.toString(),
      });

      // Check user balance via canonical readUserBalances
      const currencyId = await getCurrencyIdBySymbol(token.symbol);
      if (!currencyId) {
        logger.warn('Withdrawal creation failed: INVALID_TOKEN (currency not found)', {
          user_id: userId,
          chain_id: token.chain_id,
          symbol,
        });
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_TOKEN', message: 'Currency not found for this token' }
        });
      }
      const chainIdCheck = token.chain_id ?? CHAIN_ID_GLOBAL;
      const withdrawBalances = await readUserBalances(userId, accountType);
      const withdrawRow = withdrawBalances.find(r => r.currency_id === currencyId);
      const availableBalance = withdrawRow ? new Decimal(withdrawRow.available_balance || '0').toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN) : new Decimal(0);
      const totalRequired = withdrawAmountDec.plus(feeDec).toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN);
      const netAmount = withdrawAmountDec.minus(feeDec).toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN);

      if (netAmount.lte(0)) {
        logger.warn('Withdrawal creation failed: NET_AMOUNT_INVALID (amount - fee <= 0)', {
          user_id: userId,
          chain_id: token.chain_id,
          currency_id: currencyId,
          amount: withdrawAmountDec.toString(),
          fee: feeDec.toString(),
          net_amount: netAmount.toString(),
          account_type: accountType,
        });
        return reply.status(400).send({
          success: false,
          error: { code: 'FEE_CONFIG_MISSING', message: 'Net amount would be zero or negative. Check withdrawal fee configuration.' }
        });
      }

      const withdrawalLogContext = {
        user_id: userId,
        chain_id: token.chain_id,
        currency_id: currencyId,
        available_balance: availableBalance.toString(),
        amount: withdrawAmountDec.toString(),
        fee: feeDec.toString(),
        totalRequired: totalRequired.toString(),
        account_type: accountType,
      };

      if (availableBalance.lt(totalRequired)) {
        logger.warn('Withdrawal creation failed: INSUFFICIENT_BALANCE', withdrawalLogContext);
        return reply.status(400).send({
          success: false,
          error: { code: 'INSUFFICIENT_BALANCE', message: 'Insufficient balance' }
        });
      }

      // Check withdrawal limits (include pending_approval so they count toward daily limit)
      const todayResult = await db.query<{ total: string }>(`
        SELECT COALESCE(SUM(amount), 0) as total
        FROM withdrawals
        WHERE user_id = $1 
          AND status IN ('pending_approval', 'pending', 'processing', 'completed')
          AND created_at >= CURRENT_DATE
      `, [userId]);

      const userLimitResult = await db.query(`
        SELECT daily_withdrawal_limit FROM users WHERE id = $1
      `, [userId]);

      const dailyLimit = new Decimal(userLimitResult.rows[0]?.daily_withdrawal_limit || '1000000').toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN);
      const todayUsed = new Decimal(todayResult.rows[0]?.total || '0').toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN);

      if (todayUsed.plus(withdrawAmountDec).gt(dailyLimit)) {
        logger.warn('Withdrawal creation failed: LIMIT_EXCEEDED', withdrawalLogContext);
        return reply.status(400).send({
          success: false,
          error: { code: 'LIMIT_EXCEEDED', message: 'Daily withdrawal limit exceeded' }
        });
      }

      const userLimitResult2 = await db.query(
        `SELECT monthly_withdrawal_limit FROM users WHERE id = $1`,
        [userId]
      );
      const monthlyLimit = new Decimal(userLimitResult2.rows[0]?.monthly_withdrawal_limit || '10000000').toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN);
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);
      const monthResult = await db.query<{ total: string }>(`
        SELECT COALESCE(SUM(amount), 0) as total
        FROM withdrawals
        WHERE user_id = $1
          AND status IN ('pending_approval', 'pending', 'processing', 'completed')
          AND created_at >= $2
      `, [userId, monthStart.toISOString()]);
      const monthUsed = new Decimal(monthResult.rows[0]?.total || '0').toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN);
      if (monthUsed.plus(withdrawAmountDec).gt(monthlyLimit)) {
        logger.warn('Withdrawal creation failed: LIMIT_EXCEEDED (monthly)', withdrawalLogContext);
        return reply.status(400).send({
          success: false,
          error: { code: 'LIMIT_EXCEEDED', message: 'Monthly withdrawal limit exceeded' }
        });
      }

      // --- STRICT EXECUTION ORDER (no withdrawal record must exist if any step blocks) ---
      // 1. Risk engine (BLOCK → no DB insert; CHALLENGE → pending_approval)
      // 2. Security cooldown
      // 3. KYC (when enabled)
      // 4. Withdrawal address whitelist & timelock
      // 5. 2FA (when user has 2FA)
      // 6. Balance lock + withdrawal insert in one transaction

      // 1. Risk engine: evaluate withdrawal risk; BLOCK returns 403, CHALLENGE forces manual review (pending_approval)
      const req = request as FastifyRequest & { clientIp?: string; countryCode?: string | null; securityFlags?: { isVpnOrTor: boolean }; requestId?: string };
      const riskResult = await evaluateAndLogRisk({
        scope: 'withdrawal',
        actorType: 'user',
        actorId: userId,
        context: {
          userId,
          amount: withdrawAmountDec.toString(),
          ip: req.clientIp ?? request.ip,
          countryCode: req.countryCode ?? null,
          deviceId: getDeviceIdFromRequest(request.headers as Record<string, string | undefined>),
          isVpnOrTor: req.securityFlags?.isVpnOrTor ?? false,
          requestId: req.requestId ?? null,
          symbol: token.symbol,
          isHighRiskAsset: token.is_high_risk ?? false,
        },
        requestId: req.requestId ?? null,
        ipAddress: req.clientIp ?? request.ip,
        userAgent: request.headers['user-agent'],
      });
      if (riskResult.decision === 'block') {
        logger.warn('Withdrawal creation failed: RISK_BLOCKED', { ...withdrawalLogContext, score: riskResult.score, signals: riskResult.signals });
        return reply.status(403).send({
          success: false,
          error: { code: 'RISK_BLOCKED', message: 'Withdrawal not allowed due to risk policy. Contact support if this is in error.' }
        });
      }

      const riskRequiresChallenge = riskResult.decision === 'challenge';

      // 2. Security cooldown — block withdrawals after password/2FA/device changes
      const cooldown = await hasActiveCooldown({ userId });
      if (cooldown.active) {
        await logUserActivity({
          userId,
          action: 'access_blocked',
          ipAddress: req.clientIp ?? request.ip,
          userAgent: request.headers['user-agent'],
          deviceId: getDeviceIdFromRequest(request.headers as Record<string, string | undefined>),
          metadata: { reason: 'withdrawal_cooldown_active', cooldown_until: cooldown.until?.toISOString(), cooldown_reason: cooldown.reason },
        });
        return reply.status(403).send({
          success: false,
          error: {
            code: 'WITHDRAWAL_COOLDOWN_ACTIVE',
            message: 'Withdrawals are temporarily disabled after a recent security change.',
            cooldown_until: cooldown.until?.toISOString(),
            reason: cooldown.reason,
          },
        });
      }

      // 3. KYC enforcement (when system_settings.kyc_required_for_withdrawal is true)
      let kycRequired = true;
      try {
        const kycSetting = await db.query<{ value: unknown }>(
          `SELECT value FROM system_settings WHERE key = 'kyc_required_for_withdrawal' LIMIT 1`
        );
        if (kycSetting.rows.length > 0) {
          const v = kycSetting.rows[0]!.value;
          kycRequired = v === true || v === 'true' || (typeof v === 'string' && v.toLowerCase() === 'true');
        }
      } catch {
        // Fail closed: if settings table missing, require KYC
      }
      if (kycRequired) {
        const { assertKycAllowed, KycRequiredError, KycPendingError } = await import('../services/kyc-enforcement.service.js');
        try {
          await assertKycAllowed({ userId, action: 'withdrawal' });
        } catch (err) {
          if (err instanceof KycPendingError) {
            return reply.status(403).send({
              success: false,
              error: { code: 'KYC_PENDING', message: err.message },
            });
          }
          if (err instanceof KycRequiredError) {
            return reply.status(403).send({
              success: false,
              error: { code: 'KYC_REQUIRED', message: err.message },
            });
          }
          throw err;
        }
      }

      // 4. Withdrawal address whitelist & timelock (24h default) — required unless WITHDRAWAL_WHITELIST_RELAXED (non-prod only)
      if (!config.withdrawalWhitelistRelaxed) {
        const whitelistCheck = await isAddressAllowed({
          userId,
          asset: token.symbol,
          address: toAddress!,
        });
        if (!whitelistCheck.allowed) {
          await logUserActivity({
            userId,
            action: 'access_blocked',
            ipAddress: req.clientIp ?? request.ip,
            userAgent: request.headers['user-agent'],
            deviceId: getDeviceIdFromRequest(request.headers as Record<string, string | undefined>),
            metadata: {
              reason: whitelistCheck.unlockAt ? 'address_timelocked' : 'address_not_whitelisted',
              scope: 'withdrawal',
              asset: token.symbol,
              unlockAt: whitelistCheck.unlockAt?.toISOString(),
            },
          });
          if (whitelistCheck.unlockAt) {
            return reply.status(403).send({
              success: false,
              error: {
                code: 'ADDRESS_TIMELOCKED',
                message: 'This address is in a timelock period and cannot be used yet.',
                unlockAt: whitelistCheck.unlockAt.toISOString(),
              },
            });
          }
          return reply.status(403).send({
            success: false,
            error: {
              code: 'ADDRESS_NOT_WHITELISTED',
              message: 'This address is not in your withdrawal whitelist. Add it first and wait for the timelock to expire.',
            },
          });
        }
      }

      // 4.5 Sanctions / Travel Rule screening (on-chain only)
      const { checkSanctions } = await import('../services/sanctions-screening.service.js');
      const sanctionsResult = await checkSanctions({
        address: toAddress!,
        amount: withdrawAmountDec.toString(),
        asset: token.symbol,
        userId,
      });
      if (!sanctionsResult.allowed) {
        logger.warn('Withdrawal creation failed: SANCTIONS_BLOCKED', { ...withdrawalLogContext, reason: sanctionsResult.reason });
        return reply.status(403).send({
          success: false,
          error: {
            code: 'SANCTIONS_BLOCKED',
            message: sanctionsResult.reason ?? 'Withdrawal blocked by compliance screening.',
          },
        });
      }

      // 5. Withdrawal security: 2FA and fund password (user must satisfy when enabled)
      const { verifyUser2FA, userHas2FA, userHasFundPassword, verifyFundPassword } = await import('../lib/totp-verify.js');
      const has2FA = await userHas2FA(userId);
      const { getTwoFaPolicy } = await import('../services/twofa-enforcement.service.js');
      const twoFaPolicy = await getTwoFaPolicy();
      if (twoFaPolicy.require2faWithdrawal && !has2FA) {
        logger.warn('Withdrawal creation failed: 2FA_REQUIRED_BY_POLICY', withdrawalLogContext);
        return reply.status(400).send({
          success: false,
          error: { code: '2FA_REQUIRED', message: 'Two-factor authentication is required for withdrawals. Please enable 2FA in security settings.' }
        });
      }
      if (has2FA) {
        if (!twoFactorCode || typeof twoFactorCode !== 'string') {
          logger.warn('Withdrawal creation failed: 2FA_REQUIRED', withdrawalLogContext);
          return reply.status(400).send({
            success: false,
            error: { code: '2FA_REQUIRED', message: 'Two-factor code is required for withdrawal' }
          });
        }
        const valid2FA = await verifyUser2FA(userId, twoFactorCode.trim());
        if (!valid2FA) {
          logger.warn('Withdrawal creation failed: INVALID_2FA', withdrawalLogContext);
          return reply.status(400).send({
            success: false,
            error: { code: 'INVALID_2FA', message: 'Invalid two-factor code' }
          });
        }
      }
      const hasFundPwd = await userHasFundPassword(userId);
      if (hasFundPwd) {
        if (!fund_password || typeof fund_password !== 'string') {
          logger.warn('Withdrawal creation failed: FUND_PASSWORD_REQUIRED', withdrawalLogContext);
          return reply.status(400).send({
            success: false,
            error: { code: 'FUND_PASSWORD_REQUIRED', message: 'Fund password is required for withdrawal' }
          });
        }
        const validFundPwd = await verifyFundPassword(userId, fund_password);
        if (!validFundPwd) {
          logger.warn('Withdrawal creation failed: INVALID_FUND_PASSWORD', withdrawalLogContext);
          return reply.status(400).send({
            success: false,
            error: { code: 'INVALID_FUND_PASSWORD', message: 'Invalid fund password' }
          });
        }
      }

      let withdrawalAddressIdRes: string | null = null;
      const whitelistResult = await db.query<{ withdrawal_whitelist_enabled: boolean }>(
        `SELECT COALESCE(withdrawal_whitelist_enabled, FALSE) as withdrawal_whitelist_enabled FROM users WHERE id = $1`,
        [userId]
      );
      const whitelistEnabled = whitelistResult.rows[0]?.withdrawal_whitelist_enabled ?? false;
      if (whitelistEnabled) {
        const addrCheck = await db.query<{ id: string }>(
          `SELECT id FROM withdrawal_addresses WHERE user_id = $1 AND (address = $2 OR LOWER(address) = LOWER($2)) AND deleted_at IS NULL`,
          [userId, toAddress]
        );
        if (addrCheck.rows.length === 0) {
          logger.warn('Withdrawal creation failed: ADDRESS_NOT_WHITELISTED', withdrawalLogContext);
          return reply.status(400).send({
            success: false,
            error: { code: 'ADDRESS_NOT_WHITELISTED', message: 'This address is not in your withdrawal whitelist' }
          });
        }
        withdrawalAddressIdRes = addrCheck.rows[0]!.id;
      }

      // Backend source of truth: amount (user requested), fee (from token), net_amount = amount - fee (already validated > 0)
      const twoFaVerified = has2FA;

      // Admin approval: required if amount > threshold, asset is high-risk, risk CHALLENGE, or treasury risk signals
      const { requiresWithdrawalApproval } = await import('../services/withdrawal-approval.service.js');
      const treasuryRisk = await assessWithdrawalTreasuryRisk({
        userId,
        toAddress: toAddress!,
        amount: withdrawAmountDec.toString(),
        symbol: token.symbol,
      });
      const needsApproval =
        riskRequiresChallenge ||
        treasuryRisk.requiresManualReview ||
        requiresWithdrawalApproval(withdrawAmountDec.toString(), {
          is_high_risk: token.is_high_risk,
        });
      const initialStatus = needsApproval ? 'pending_approval' : 'pending';
      const initialTreasuryStage = needsApproval ? 'pending' : 'checker_approved';

      // 6. Create withdrawal record and lock balance atomically (on-chain). No record exists if any prior step blocked.
      // Stores amount, fee, net_amount; lock uses amount + fee.
      const chainIdForLock = token.chain_id ?? CHAIN_ID_GLOBAL;
      let withdrawal: { id: string; created_at: Date };
      let updatedChainId = chainIdForLock;
      try {
        const txResult = await db.transaction(async (client) => {
          const insertResult = await client.query<{ id: string; created_at: Date }>(`
            INSERT INTO withdrawals (
              user_id, token_id, chain_id, amount, fee, net_amount, to_address, memo, status, account_type,
              type, email_verified, two_fa_verified, withdrawal_address_id, treasury_stage
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'onchain', FALSE, $11, $12, $13)
            RETURNING id, created_at
          `, [userId, token.token_id, token.chain_id, withdrawAmountDec.toString(), feeDec.toString(), netAmount.toString(), toAddress!, memo || null, initialStatus, accountType, twoFaVerified, withdrawalAddressIdRes, initialTreasuryStage]);
          const w = insertResult.rows[0]!;
          const totalStr = totalRequired.toString();

          await ensureUserBalanceRow(userId, currencyId, chainIdForLock, accountType, client);
          let lockSel = await client.query<{ available_balance: string; locked_balance: string }>(
            `SELECT available_balance::text, locked_balance::text FROM user_balances
             WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = $4
               AND available_balance >= $5::numeric
             FOR UPDATE`,
            [userId, currencyId, chainIdForLock, accountType, totalStr]
          );
          let chainUsed = chainIdForLock;
          if (lockSel.rows.length === 0 && chainIdForLock !== CHAIN_ID_GLOBAL) {
            await ensureUserBalanceRow(userId, currencyId, CHAIN_ID_GLOBAL, accountType, client);
            lockSel = await client.query<{ available_balance: string; locked_balance: string }>(
              `SELECT available_balance::text, locked_balance::text FROM user_balances
               WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = $4
                 AND available_balance >= $5::numeric
               FOR UPDATE`,
              [userId, currencyId, CHAIN_ID_GLOBAL, accountType, totalStr]
            );
            chainUsed = CHAIN_ID_GLOBAL;
          }
          if (lockSel.rows.length === 0) {
            throw new Error('BALANCE_ROW_NOT_FOUND_OR_MISMATCH');
          }
          const avBefore = lockSel.rows[0]!.available_balance ?? '0';
          const lockBefore = lockSel.rows[0]!.locked_balance ?? '0';

          const upd = await client.query(
            `UPDATE user_balances
             SET available_balance = available_balance - $1::numeric, locked_balance = locked_balance + $1::numeric, updated_at = NOW()
             WHERE user_id = $2 AND currency_id = $3 AND COALESCE(chain_id, '') = $4 AND account_type = $5
               AND available_balance >= $1::numeric
             RETURNING *`,
            [totalStr, userId, currencyId, chainUsed, accountType]
          );
          assertUserBalanceUpdated('withdrawal_lock', upd, userId, currencyId, accountType, chainUsed);
          assertBalanceInvariant(upd.rows[0]);
          const row = upd.rows[0]!;

          await insertBalanceLedger({
            client,
            userId,
            currencyId,
            accountType,
            debit: totalStr,
            credit: '0',
            balanceBefore: avBefore,
            balanceAfter: String(row.available_balance ?? 0),
            referenceType: 'withdrawal',
            referenceId: w.id,
            balanceType: 'available',
          });
          await insertBalanceLedger({
            client,
            userId,
            currencyId,
            accountType,
            debit: '0',
            credit: totalStr,
            balanceBefore: lockBefore,
            balanceAfter: String(row.locked_balance ?? 0),
            referenceType: 'withdrawal',
            referenceId: w.id,
            balanceType: 'locked',
          });

          return { withdrawal: w, updatedChainId: chainUsed };
        });
        withdrawal = txResult.withdrawal;
        updatedChainId = txResult.updatedChainId;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('BALANCE_ROW_NOT_FOUND_OR_MISMATCH')) {
          logger.error('Withdrawal creation failed: BALANCE_ROW_NOT_FOUND_OR_MISMATCH', withdrawalLogContext);
          return reply.status(400).send({
            success: false,
            error: {
              code: 'BALANCE_ROW_NOT_FOUND_OR_MISMATCH',
              message: 'No matching balance row with sufficient available balance. Check user_balances for (user, currency, chain, account_type).',
            },
          });
        }
        logger.error('Withdrawal creation failed: BALANCE_LOCK_FAILED', {
          ...withdrawalLogContext,
          error: msg,
        });
        return reply.status(500).send({
          success: false,
          error: {
            code: 'BALANCE_LOCK_FAILED',
            message: err instanceof Error ? err.message : 'Balance lock failed',
          },
        });
      }

      try {
        const { publishWithdrawalRequested } = await import('../services/admin-ws.service.js');
        publishWithdrawalRequested({ id: withdrawal.id, user_id: userId, amount: withdrawAmountDec.toString(), to_address: toAddress ?? undefined });
      } catch { /* best-effort */ }

      // Log activity
      auditLog('withdrawal_request', userId, {
        withdrawalId: withdrawal.id,
        symbol,
        chain: token.chain_name,
        amount: withdrawAmountDec.toString(),
        fee: feeDec.toString(),
        toAddress,
        status: initialStatus,
      });

      await logWithdrawalLifecycle('withdrawal_created', {
        withdrawal_id: withdrawal.id,
        user_id: userId,
        admin_id: null,
        token_id: token.token_id,
        chain_id: token.chain_id,
        amount: withdrawAmountDec.toString(),
        ip: request.ip ?? undefined,
        user_agent: request.headers['user-agent'] ?? undefined,
      });

      recordAndEvaluate({
        userId,
        txnType: 'withdrawal',
        asset: symbol,
        amount: withdrawAmountDec.toString(),
        fiatAmount: null,
        fiatCurrency: 'INR',
        countryCode: (request as { countryCode?: string }).countryCode ?? null,
      }).catch((e) =>
        logger.warn('AML withdrawal record failed (best-effort)', {
          userId,
          withdrawalId: withdrawal.id,
          error: e instanceof Error ? e.message : String(e),
        })
      );

      logger.info('Withdrawal request created', {
        userId,
        withdrawalId: withdrawal.id,
        symbol,
        amount: withdrawAmountDec.toString(),
        status: initialStatus,
      });
      // E2E withdrawal lifecycle: stage 1 — created (balance locked)
      logger.info('[E2E_WITHDRAWAL] stage=created', {
        withdrawal_id: withdrawal.id,
        status: initialStatus,
        chain_id: token.chain_id,
        symbol,
      });

      let enqueueCode: string | undefined;
      let enqueueReason: string | undefined;
      if (initialStatus === 'pending') {
        const { enqueueWithdrawal } = await import('../services/withdrawal-signing.service.js');
        const enqueueResult = await enqueueWithdrawal(withdrawal.id);
        if (!enqueueResult.enqueued && enqueueResult.reason) {
          logger.warn('Withdrawal not enqueued for signing', { withdrawalId: withdrawal.id, reason: enqueueResult.reason });
          enqueueCode = enqueueResult.code;
          enqueueReason = enqueueResult.reason;
        }
      }

      const onchainResponse = {
        success: true as const,
        data: {
          id: withdrawal.id,
          type: 'onchain',
          symbol,
          chain: token.chain_name,
          amount: withdrawAmountDec.toString(),
          fee: feeDec.toString(),
          netAmount: netAmount.toString(),
          toAddress,
          status: initialStatus,
          createdAt: withdrawal.created_at,
          ...(enqueueCode && { enqueueCode, enqueueReason }),
        },
      };
      try {
        await redis.setJson(
          redisKey,
          { withdrawalId: withdrawal.id, requestHash, response: onchainResponse },
          WITHDRAWAL_IDEMPOTENCY_TTL_SECONDS
        );
      } catch (e) {
        logger.warn('Withdrawal idempotency cache set failed', {
          userId,
          idempotencyKey: idempotencyKey.slice(0, 32),
          error: e instanceof Error ? e.message : String(e),
        });
      }
      return onchainResponse;
      } finally {
        redis.del(lockKey).catch((e) => {
          logger.warn('Withdrawal idempotency lock release failed', {
            lockKey,
            error: e instanceof Error ? e.message : String(e),
          });
        });
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const msg = err.message;
      if (msg === 'INSUFFICIENT_BALANCE') {
        return reply.status(400).send({
          success: false,
          error: { code: 'INSUFFICIENT_BALANCE', message: 'Insufficient balance' },
        });
      }
      if (msg === 'RECIPIENT_BALANCE_ROW_NOT_FOUND') {
        logger.error('Internal transfer: recipient balance row not found after ensure', { userId: request.user?.id });
        return reply.status(500).send({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Recipient account setup failed. Please try again.' },
        });
      }
      const code = (err as { code?: string }).code;
      logger.error('Withdrawal creation failed: unhandled error', {
        user_id: request.user?.id,
        error: msg,
        stack: err.stack,
      });
      const message = code === 'BALANCE_LOCK_FAILED' ? 'Balance lock failed'
        : code === 'BALANCE_ROW_NOT_FOUND_OR_MISMATCH' ? 'No matching balance row'
        : msg || 'Failed to create withdrawal';
      return reply.status(500).send({
        success: false,
        error: {
          code: code && /^[A-Z_]+$/.test(code) ? code : 'INTERNAL_ERROR',
          message,
        },
      });
    }
  });

  // Cancel withdrawal (authenticated)
  /**
   * POST /wallet/withdrawals/:id/send-email-otp
   * Send a 6-digit OTP to user's email to confirm a withdrawal.
   * Only allowed when withdrawal is in `pending_email_verify` status.
   * Rate-limited: max 3 sends per 10 minutes per withdrawal.
   */
  app.post<{ Params: { id: string } }>('/withdrawals/:id/send-email-otp', {
    preHandler: [app.authenticate, rateLimitByUser('wallet:withdrawal:email-otp', 3, 600, { failClosed: false })]
  }, async (request, reply) => {
    try {
      const userId = request.user!.id;
      const withdrawalId = request.params.id;

      const wRow = await db.query<{ id: string; status: string; email_verified: boolean; user_id: string }>(
        `SELECT id, status, email_verified, user_id FROM withdrawals WHERE id = $1`,
        [withdrawalId]
      );
      if (!wRow.rows[0]) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Withdrawal not found' } });
      if (wRow.rows[0].user_id !== userId) return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Not your withdrawal' } });
      if (wRow.rows[0].email_verified) return reply.send({ success: true, data: { message: 'Already verified' } });
      if (!['pending_email_verify', 'pending'].includes(wRow.rows[0].status)) {
        return reply.status(400).send({ success: false, error: { code: 'INVALID_STATUS', message: 'Withdrawal is not awaiting email verification' } });
      }

      const userRow = await db.query<{ email: string }>(`SELECT email FROM users WHERE id = $1`, [userId]);
      const email = userRow.rows[0]?.email;
      if (!email) return reply.status(400).send({ success: false, error: { code: 'NO_EMAIL', message: 'No email on account' } });

      const otpCode = String(Math.floor(100000 + Math.random() * 900000));
      const redisKey = `withdrawal:email:otp:${withdrawalId}`;
      await redis.set(redisKey, otpCode, 600); // 10 minutes

      const { otpService } = await import('../services/otp.service.js');
      const sent = await otpService.sendEmailOTP(email, otpCode);
      if (!sent) {
        await redis.del(redisKey);
        return reply.status(503).send({ success: false, error: { code: 'EMAIL_FAILED', message: 'Failed to send verification email. Try again shortly.' } });
      }

      logger.info('Withdrawal email OTP sent', { userId, withdrawalId });
      return reply.send({ success: true, data: { message: 'Verification code sent to your email', maskedEmail: email.replace(/(.{2}).+(@.+)/, '$1***$2') } });
    } catch (err) {
      logger.error('Send withdrawal email OTP error', { error: err instanceof Error ? err.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to send OTP' } });
    }
  });

  /**
   * POST /wallet/withdrawals/:id/verify-email-otp
   * Verify the 6-digit email OTP. On success, marks email_verified=true and
   * moves the withdrawal from `pending_email_verify` → `pending` and enqueues it.
   */
  app.post<{ Params: { id: string }; Body: { otp: string } }>('/withdrawals/:id/verify-email-otp', {
    preHandler: [app.authenticate, rateLimitByUser('wallet:withdrawal:verify-otp', 5, 300, { failClosed: false })]
  }, async (request, reply) => {
    try {
      const userId = request.user!.id;
      const withdrawalId = request.params.id;
      const { otp } = request.body;

      if (!otp || !/^\d{6}$/.test(otp)) {
        return reply.status(400).send({ success: false, error: { code: 'INVALID_OTP', message: 'OTP must be 6 digits' } });
      }

      const wRow = await db.query<{ id: string; status: string; email_verified: boolean; user_id: string; chain_id: string }>(
        `SELECT id, status, email_verified, user_id, chain_id FROM withdrawals WHERE id = $1`,
        [withdrawalId]
      );
      if (!wRow.rows[0]) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Withdrawal not found' } });
      if (wRow.rows[0].user_id !== userId) return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Not your withdrawal' } });
      if (wRow.rows[0].email_verified) return reply.send({ success: true, data: { message: 'Already verified', status: wRow.rows[0].status } });

      const redisKey = `withdrawal:email:otp:${withdrawalId}`;
      const storedOtp = await redis.get(redisKey);
      if (!storedOtp) return reply.status(400).send({ success: false, error: { code: 'OTP_EXPIRED', message: 'Verification code expired. Request a new one.' } });
      if (storedOtp !== otp) return reply.status(400).send({ success: false, error: { code: 'OTP_INVALID', message: 'Incorrect verification code' } });

      // Mark verified and move to pending so the signing queue picks it up
      await db.query(
        `UPDATE withdrawals SET email_verified = TRUE, status = CASE WHEN status = 'pending_email_verify' THEN 'pending' ELSE status END, updated_at = NOW() WHERE id = $1`,
        [withdrawalId]
      );
      await redis.del(redisKey);

      // Enqueue for signing if it was pending_email_verify
      if (wRow.rows[0].status === 'pending_email_verify') {
        const { enqueueWithdrawal } = await import('../services/withdrawal-signing.service.js');
        const enq = await enqueueWithdrawal(withdrawalId);
        logger.info('Withdrawal enqueued after email verify', { userId, withdrawalId, enqueued: enq.enqueued });
      }

      logger.info('Withdrawal email verified', { userId, withdrawalId });
      return reply.send({ success: true, data: { message: 'Email verified. Your withdrawal is being processed.', status: 'pending' } });
    } catch (err) {
      logger.error('Verify withdrawal email OTP error', { error: err instanceof Error ? err.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Verification failed' } });
    }
  });

  app.post<{ Params: { id: string } }>('/withdrawals/:id/cancel', {
    preHandler: [app.authenticate]
  }, async (request, reply) => {
    try {
      const userId = request.user!.id;
      const { id } = request.params;

      let withdrawalForAudit: { symbol: string; amount: string } | null = null;

      // Update withdrawal status and release balance atomically (lock row first so processor cannot complete between check and update).
      await db.transaction(async (client) => {
        const sel = await client.query<{ status: string; tx_hash: string | null; amount: string; fee: string; symbol: string; account_type: string; chain_id: string | null }>(
          `SELECT w.status, w.tx_hash, w.amount, w.fee, t.symbol, w.account_type, w.chain_id
           FROM withdrawals w
           JOIN tokens t ON w.token_id = t.id
           WHERE w.id = $1 AND w.user_id = $2
           FOR UPDATE`,
          [id, userId]
        );
        if (sel.rows.length === 0) {
          throw new Error('NOT_FOUND');
        }
        const w = sel.rows[0]!;
        if (w.status !== 'pending') {
          throw new Error('Withdrawal no longer pending (possibly being processed)');
        }
        if (w.tx_hash != null && w.tx_hash !== '') {
          throw new Error('ALREADY_BROADCAST');
        }
        withdrawalForAudit = { symbol: w.symbol, amount: w.amount };

        const totalLocked = new Decimal(w.amount).plus(w.fee).toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN).toString();
        const currencyId = await getCurrencyIdBySymbol(w.symbol);
        const cancelAccountType = w.account_type || 'spot';
        const chainIdCancel = w.chain_id ?? CHAIN_ID_GLOBAL;

        const upd = await client.query(
          `UPDATE withdrawals SET status = 'cancelled', processed_at = NOW()
           WHERE id = $1 AND status IN ('pending_approval','pending_email_verify','pending_2fa')
           RETURNING id`,
          [id]
        );
        if (upd.rowCount === 0) {
          throw new Error('Withdrawal no longer pending (possibly being processed)');
        }
        if (currencyId) {
          await ensureUserBalanceRow(userId, currencyId, chainIdCancel, cancelAccountType, client);
          const lockSel = await client.query<{ available_balance: string; locked_balance: string }>(
            `SELECT available_balance::text, locked_balance::text FROM user_balances
             WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = $4
               AND locked_balance >= $5::numeric
             FOR UPDATE`,
            [userId, currencyId, chainIdCancel, cancelAccountType, totalLocked.toString()]
          );
          if (lockSel.rows.length === 0) {
            throw new Error('WITHDRAWAL_CANCEL_BALANCE_ROW_NOT_FOUND');
          }
          const avBefore = lockSel.rows[0]!.available_balance ?? '0';
          const lockBefore = lockSel.rows[0]!.locked_balance ?? '0';

          const cancelUpd = await client.query(
            `UPDATE user_balances
             SET available_balance = available_balance + $1::numeric, locked_balance = locked_balance - $1::numeric, updated_at = NOW()
             WHERE user_id = $2 AND currency_id = $3 AND COALESCE(chain_id, '') = $4 AND account_type = $5
               AND locked_balance >= $1::numeric
             RETURNING *`,
            [totalLocked.toString(), userId, currencyId, chainIdCancel, cancelAccountType]
          );
          assertUserBalanceUpdated('withdrawal_cancel', cancelUpd, userId, currencyId, cancelAccountType, w.chain_id ?? undefined);
          assertBalanceInvariant(cancelUpd.rows[0]);
          const row = cancelUpd.rows[0]!;

          await insertBalanceLedger({
            client,
            userId,
            currencyId,
            accountType: cancelAccountType,
            debit: '0',
            credit: totalLocked.toString(),
            balanceBefore: avBefore,
            balanceAfter: String(row.available_balance ?? 0),
            referenceType: 'withdrawal',
            referenceId: id,
            balanceType: 'available',
          });
          await insertBalanceLedger({
            client,
            userId,
            currencyId,
            accountType: cancelAccountType,
            debit: totalLocked.toString(),
            credit: '0',
            balanceBefore: lockBefore,
            balanceAfter: String(row.locked_balance ?? 0),
            referenceType: 'withdrawal',
            referenceId: id,
            balanceType: 'locked',
          });
        }
      });

      auditLog('withdrawal_cancelled', userId, {
        withdrawalId: id,
        symbol: withdrawalForAudit!.symbol,
        amount: withdrawalForAudit!.amount
      });

      return {
        success: true,
        message: 'Withdrawal cancelled successfully'
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg === 'NOT_FOUND') {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Withdrawal not found' }
        });
      }
      if (msg === 'ALREADY_BROADCAST') {
        return reply.status(400).send({
          success: false,
          error: { code: 'ALREADY_BROADCAST', message: 'Withdrawal already broadcast; cannot cancel' }
        });
      }
      if (msg === 'Withdrawal no longer pending (possibly being processed)') {
        return reply.status(400).send({
          success: false,
          error: { code: 'WITHDRAWAL_NOT_CANCELLABLE', message: msg },
        });
      }
      logger.error('Failed to cancel withdrawal', { error: msg, userId: request.user?.id });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to cancel withdrawal' },
      });
    }
  });

  // ============================================
  // ASSETS OVERVIEW ENDPOINTS
  // ============================================
  // Balance read: always use readUserBalances; total USD = sum(amount * price) per currency. See docs/BALANCE_AND_DEPOSIT_RULES.md

  // Get balances summary for assets overview (authenticated). Uses canonical readUserBalances only.
  // Resilient: if currencies/user_balances/market_prices missing or schema mismatch, returns zeros instead of 500.
  app.get('/balances/summary', {
    preHandler: [app.authenticate]
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user!.id;
      const pricesSql = `
        SELECT DISTINCT ON (UPPER(bc.symbol)) bc.symbol, mp.price::numeric as usd_price
        FROM market_prices mp
        JOIN currencies bc ON mp.base_currency_id = bc.id
        JOIN currencies qc ON mp.quote_currency_id = qc.id
        WHERE UPPER(qc.symbol) = 'USDT'
        ORDER BY UPPER(bc.symbol), mp.price DESC`;
      const { getActiveCurrencyIds } = await import('../lib/active-currencies-cache.js');
      const currencyIds = await getActiveCurrencyIds();
      const [fundingResult, spotResult, tradingResult, pricesResult] = await Promise.all([
        readUserBalances(userId, 'funding', currencyIds).catch((e) => {
          logger.warn('Balances summary: readUserBalances(funding) failed', { userId, err: e instanceof Error ? e.message : String(e) });
          return [] as Awaited<ReturnType<typeof readUserBalances>>;
        }),
        readUserBalances(userId, 'spot', currencyIds).catch((e) => {
          logger.warn('Balances summary: readUserBalances(spot) failed', { userId, err: e instanceof Error ? e.message : String(e) });
          return [] as Awaited<ReturnType<typeof readUserBalances>>;
        }),
        readUserBalances(userId, 'trading', currencyIds).catch((e) => {
          logger.warn('Balances summary: readUserBalances(trading) failed', { userId, err: e instanceof Error ? e.message : String(e) });
          return [] as Awaited<ReturnType<typeof readUserBalances>>;
        }),
        db.query<{ symbol: string; usd_price: string }>(pricesSql).catch(() => ({ rows: [] })),
      ]);
      const fundingRows = fundingResult;
      const spotRows = spotResult;
      const tradingRows = tradingResult;
      const priceMap: Record<string, string> = { USDT: '1', USDC: '1', DAI: '1', BUSD: '1' };
      const rows = Array.isArray(pricesResult?.rows) ? pricesResult.rows : [];
      for (const row of rows) {
        const sym = row?.symbol != null ? String(row.symbol).trim() : '';
        if (!sym) continue;
        const key = sym.toUpperCase();
        try {
          const raw = row?.usd_price != null ? String(row.usd_price) : '1';
          priceMap[key] = new Decimal(raw).toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN).toString();
        } catch {
          priceMap[key] = '1';
        }
      }
      type BalanceLike = { symbol: string; available_balance: string; locked_balance: string };
      const toUsd = (rows: BalanceLike[]) =>
        rows.reduce((t, r) => {
          const q = new Decimal(r.available_balance || '0').plus(r.locked_balance || '0').toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN);
          const price = new Decimal(priceMap[r.symbol?.toUpperCase()] ?? '1');
          return t.plus(q.times(price)).toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN);
        }, new Decimal(0));
      let fundingRowsForTotal: BalanceLike[] = fundingRows;
      let spotRowsForTotal: BalanceLike[] = spotRows;
      if (fundingRows.length === 0 && spotRows.length === 0) {
        try {
          const direct = await db.query<{ symbol: string; available_balance: string; locked_balance: string }>(
            `SELECT COALESCE(c.symbol, '') AS symbol, COALESCE(ub.available_balance, 0)::text AS available_balance, COALESCE(ub.locked_balance, 0)::text AS locked_balance
             FROM user_balances ub
             LEFT JOIN currencies c ON c.id = ub.currency_id
             WHERE ub.user_id = $1 AND (LOWER(TRIM(COALESCE(ub.account_type::text, ''))) IN ('funding', 'spot') OR ub.account_type IS NULL)`,
            [userId]
          );
          fundingRowsForTotal = direct.rows.map(r => ({
            symbol: r.symbol,
            available_balance: r.available_balance ?? '0',
            locked_balance: r.locked_balance ?? '0'
          }));
        } catch (e) {
          logger.warn('Balances summary: direct fallback query failed', { userId, err: e instanceof Error ? e.message : String(e) });
        }
        spotRowsForTotal = [];
      }
      const fundingTotal = toUsd(fundingRowsForTotal).plus(toUsd(spotRowsForTotal)).toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN);
      const tradingTotal = toUsd(tradingRows).toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN);
      const btcPrice = new Decimal(82000);
      return reply.send({
        success: true,
        data: {
          funding: {
            type: 'funding',
            totalUsd: fundingTotal.toString(),
            totalBtc: fundingTotal.div(btcPrice).toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN).toString()
          },
          trading: {
            type: 'trading',
            totalUsd: tradingTotal.toString(),
            totalBtc: tradingTotal.div(btcPrice).toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN).toString()
          },
          total: {
            totalUsd: fundingTotal.plus(tradingTotal).toString(),
            totalBtc: fundingTotal.plus(tradingTotal).div(btcPrice).toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN).toString()
          }
        }
      });
    } catch (error) {
      request.log.error(error);
      logger.error('Failed to get balances summary', {
        error: error instanceof Error ? error.message : 'Unknown',
        stack: error instanceof Error ? error.stack : undefined,
        userId: request.user?.id
      });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : 'Failed to get balances summary' }
      });
    }
  });

  // Get funding account balances (authenticated). Uses canonical readUserBalances only.
  app.get('/balances/funding', {
    preHandler: [app.authenticate]
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user!.id;
      const btcPrice = new Decimal(97500);
      const priceMap: Record<string, string> = { 'USDT': '1', 'USDC': '1' };

      // Repair: apply balance for completed deposits that were never applied (atomic per deposit, no double-credit)
      try {
        const hasColumn = await db.query(
          `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'deposits' AND column_name = 'balance_applied_at'`
        );
        if (hasColumn.rows.length > 0) {
          const unapplied = await db.query<{ id: string; currency_id: string }>(
            `SELECT id, currency_id FROM deposits
             WHERE user_id = $1 AND status = 'completed' AND credited_at IS NOT NULL AND balance_applied_at IS NULL
             AND (amount IS NULL OR amount::numeric > 0)`,
            [userId]
          );
          if (unapplied.rows.length > 0) {
            const currencyIds = [...new Set(unapplied.rows.map((r) => (r as { currency_id: string }).currency_id))];
            const curCheck = await db.query(`SELECT id FROM currencies WHERE id = ANY($1::uuid[])`, [currencyIds]);
            const validIds = new Set(curCheck.rows.map((r) => (r as { id: string }).id));
            const toApply = unapplied.rows.filter((r) => validIds.has(r.currency_id));
            let applied = 0;
            for (const row of toApply) {
              const res = await applyBalanceForOneCompletedDeposit(row.id);
              if (res.credited) applied++;
            }
            if (applied > 0) logger.info('Repair: applied balance for completed deposits', { userId, count: applied });
          }
        }
      } catch (repairErr) {
        logger.warn('Funding balance repair skipped or failed', { userId, error: repairErr instanceof Error ? repairErr.message : 'Unknown' });
      }

      const pricesSql = `
        SELECT DISTINCT ON (UPPER(bc.symbol)) bc.symbol, mp.price::numeric as usd_price
        FROM market_prices mp
        JOIN currencies bc ON mp.base_currency_id = bc.id
        JOIN currencies qc ON mp.quote_currency_id = qc.id
        WHERE UPPER(qc.symbol) = 'USDT'
        ORDER BY UPPER(bc.symbol), mp.price DESC`;
      const namesSql = `SELECT id, symbol, REGEXP_REPLACE(COALESCE(name, symbol), '\\s*\\([A-Z0-9]+\\)\\s*$', '', 'i') as name FROM currencies WHERE is_active = TRUE`;

      const [fundingRows, spotRowsResult, pricesResult, namesResult] = await Promise.all([
        readUserBalances(userId, 'funding').catch((e) => {
          logger.warn('Funding route: readUserBalances(funding) failed', { userId, err: e instanceof Error ? e.message : String(e) });
          return [] as Awaited<ReturnType<typeof readUserBalances>>;
        }),
        readUserBalances(userId, 'spot').catch((e) => {
          logger.warn('Funding route: readUserBalances(spot) failed', { userId, err: e instanceof Error ? e.message : String(e) });
          return [] as Awaited<ReturnType<typeof readUserBalances>>;
        }),
        db.query<{ symbol: string; usd_price: string }>(pricesSql).catch(() => ({ rows: [] })),
        db.query<{ id: string; symbol: string; name: string }>(namesSql),
      ]);
      let spotRows = spotRowsResult;
      let fundingRowsFinal = fundingRows;

      // Fallback: if canonical read returned nothing, read directly from user_balances (funding/spot) so balance is never hidden (same logic as summary)
      if (fundingRows.length === 0 && spotRows.length === 0) {
        try {
          const direct = await db.query<{ currency_id: string; symbol: string; available_balance: string; locked_balance: string }>(
            `SELECT ub.currency_id, COALESCE(c.symbol, '') AS symbol,
                    COALESCE(ub.available_balance, 0)::text AS available_balance, COALESCE(ub.locked_balance, 0)::text AS locked_balance
             FROM user_balances ub
             LEFT JOIN currencies c ON c.id = ub.currency_id
             WHERE ub.user_id = $1 AND (LOWER(TRIM(COALESCE(ub.account_type::text, ''))) IN ('funding', 'spot') OR ub.account_type IS NULL)
             ORDER BY COALESCE(c.symbol, ub.currency_id::text)`,
            [userId]
          );
          fundingRowsFinal = direct.rows.map(r => ({
            currency_id: r.currency_id,
            symbol: r.symbol,
            account_type: 'funding',
            available_balance: r.available_balance ?? '0',
            locked_balance: r.locked_balance ?? '0'
          }));
          spotRows = [];
        } catch (e) {
          logger.warn('Funding route: direct fallback query failed', { userId, err: e instanceof Error ? e.message : String(e) });
        }
      }

      pricesResult.rows.forEach(row => {
        try {
          priceMap[row.symbol.toUpperCase()] = new Decimal(row.usd_price).toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN).toString();
        } catch {
          priceMap[row.symbol.toUpperCase()] = '1';
        }
      });
      const nameByCurrencyId: Record<string, string> = {};
      namesResult.rows.forEach(row => {
        nameByCurrencyId[row.id] = row.name || row.symbol;
      });

      const byCurrency: Record<string, { symbol: string; available: DecimalInstance; locked: DecimalInstance }> = {};
      for (const r of fundingRowsFinal) {
        const av = new Decimal(r.available_balance || '0').toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN);
        const lk = new Decimal(r.locked_balance || '0').toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN);
        if (!byCurrency[r.currency_id]) {
          byCurrency[r.currency_id] = { symbol: r.symbol, available: new Decimal(0), locked: new Decimal(0) };
        }
        const bc = byCurrency[r.currency_id]!;
        bc.available = bc.available.plus(av).toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN);
        bc.locked = bc.locked.plus(lk).toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN);
      }
      for (const r of spotRows) {
        if (!byCurrency[r.currency_id]) {
          byCurrency[r.currency_id] = { symbol: r.symbol, available: new Decimal(0), locked: new Decimal(0) };
        }
        const bc = byCurrency[r.currency_id]!;
        bc.available = bc.available.plus(r.available_balance || '0').toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN);
        bc.locked = bc.locked.plus(r.locked_balance || '0').toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN);
      }

      const balances = Object.entries(byCurrency).map(([currency_id, agg]) => {
        const total = agg.available.plus(agg.locked).toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN);
        const price = new Decimal(priceMap[agg.symbol.toUpperCase()] ?? '1');
        const usdValue = total.times(price).toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN);
        return {
          token_id: currency_id,
          symbol: agg.symbol,
          name: nameByCurrencyId[currency_id] ?? agg.symbol,
          total_balance: total.toString(),
          available_balance: agg.available.toString(),
          locked_balance: agg.locked.toString(),
          btc_value: usdValue.div(btcPrice).toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN).toString(),
          usd_value: usdValue.toDecimalPlaces(2, ROUND_DOWN).toString()
        };
      });

      if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'production') {
        console.log('Funding raw balances:', balances);
        console.log('Funding byCurrency:', byCurrency);
      }

      balances.sort((a, b) => {
        const aHasBalance = new Decimal(a.total_balance).gt(0);
        const bHasBalance = new Decimal(b.total_balance).gt(0);
        if (aHasBalance && !bHasBalance) return -1;
        if (!aHasBalance && bHasBalance) return 1;
        return a.symbol.localeCompare(b.symbol);
      });

      const totalUsd = balances.reduce((sum, b) => sum.plus(b.usd_value).toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN), new Decimal(0));
      const availableUsd = balances.reduce((sum, b) => {
        const price = new Decimal(priceMap[b.symbol.toUpperCase()] ?? '1');
        return sum.plus(new Decimal(b.available_balance).times(price)).toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN);
      }, new Decimal(0));
      const lockedUsd = balances.reduce((sum, b) => {
        const price = new Decimal(priceMap[b.symbol.toUpperCase()] ?? '1');
        return sum.plus(new Decimal(b.locked_balance).times(price)).toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN);
      }, new Decimal(0));

      return reply.send({
        success: true,
        data: {
          balances,
          totalEquity: { usd: totalUsd.toString(), btc: totalUsd.div(btcPrice).toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN).toString() },
          availableBalance: { usd: availableUsd.toString(), btc: availableUsd.div(btcPrice).toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN).toString() },
          inUse: { usd: lockedUsd.toString(), btc: lockedUsd.div(btcPrice).toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN).toString() }
        }
      });
    } catch (error) {
      logger.error('Failed to get funding balances', {
        error: error instanceof Error ? error.message : 'Unknown',
        userId: request.user?.id
      });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to get funding balances' }
      });
    }
  });

  // Get trading account balances (authenticated). Uses canonical readUserBalances only. Trading view = trading only.
  // authenticateUser: JWT (@fastify/jwt) or X-API-Key — aligns with e2e-provision-credentials (jsonwebtoken-signed JWT may not verify via app.jwt).
  app.get('/balances/trading', {
    preHandler: [app.authenticateUser]
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user!.id;
      const tradingRows = await readUserBalances(userId, 'trading');
      const byCurrency: Record<string, { symbol: string; equity: DecimalInstance }> = {};
      for (const r of tradingRows) {
        byCurrency[r.currency_id] = {
          symbol: r.symbol,
          equity: new Decimal(r.available_balance || '0').plus(r.locked_balance || '0').toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN)
        };
      }
      const namesResult = await db.query<{ id: string; name: string }>(
        `SELECT id, REGEXP_REPLACE(COALESCE(name, symbol), '\\s*\\([A-Z0-9]+\\)\\s*$', '', 'i') as name FROM currencies WHERE is_active = TRUE`
      );
      const nameById: Record<string, string> = {};
      namesResult.rows.forEach(row => {
        nameById[row.id] = row.name;
      });
      const balances = Object.entries(byCurrency).map(([token_id, agg]) => ({
        token_id,
        symbol: agg.symbol,
        name: nameById[token_id] ?? agg.symbol,
        equity: agg.equity.toString(),
        wallet_balance: agg.equity.toString(),
        borrowed_amount: '0',
        used_as_collateral: '0',
        usd_value: agg.equity.toString()
      }));
      function safeEquityDec(s: string): DecimalInstance {
        const t = String(s ?? '').trim();
        if (!t) return new Decimal(0);
        try {
          const d = new Decimal(t);
          return d.isFinite() ? d : new Decimal(0);
        } catch {
          return new Decimal(0);
        }
      }
      balances.sort((a, b) => safeEquityDec(b.equity).comparedTo(safeEquityDec(a.equity)));
      const totalEquity = balances.reduce((sum, b) => sum.plus(b.equity).toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN), new Decimal(0));

      return reply.send({
        success: true,
        data: {
          balances,
          totalEquity: { usd: totalEquity.toString() },
          marginBalance: { usd: totalEquity.toString() },
          unrealizedPnl: { usd: 0 },
          marginInfo: { im: 0, imUsd: 0, mm: 0, mmUsd: 0 }
        }
      });
    } catch (error) {
      logger.error('Failed to get trading balances', {
        error: error instanceof Error ? error.message : 'Unknown',
        userId: request.user?.id
      });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to get trading balances' }
      });
    }
  });

  // ============================================
  // INTERNAL TRANSFER ENDPOINTS
  // ============================================

  // Get transferable balances between accounts. Uses canonical readUserBalances only.
  app.get<{ Querystring: { from?: string; to?: string } }>('/transfer/balances', {
    preHandler: [app.authenticate]
  }, async (request, reply) => {
    try {
      const userId = request.user!.id;
      const fromAccount = request.query.from || 'funding';
      const allowedFrom = ['funding', 'spot', 'trading'];
      const account = allowedFrom.includes(fromAccount) ? fromAccount : 'funding';
      const rows = await readUserBalances(userId, account);
      const currenciesResult = await db.query<{ id: string; symbol: string; name: string; decimals: number; chain_id: string; chain_name: string }>(`
        SELECT c.id, c.symbol,
          REGEXP_REPLACE(COALESCE(c.name, c.symbol), '\\s*\\([A-Z0-9]+\\)\\s*$', '', 'i') as name,
          COALESCE(c.decimals, 8) as decimals,
          b.id as chain_id,
          b.chain_name
        FROM currencies c
        LEFT JOIN blockchains b ON c.blockchain_id = b.id
        WHERE c.is_active = TRUE
      `);
      const byId = Object.fromEntries(currenciesResult.rows.map((r) => [(r as { id: string }).id, r]));
      const data = rows.map(r => {
        const cur = byId[r.currency_id];
        const available = new Decimal(r.available_balance || '0').plus(r.locked_balance || '0').toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN).toString();
        return {
          tokenId: r.currency_id,
          symbol: r.symbol,
          name: cur?.name ?? r.symbol,
          iconUrl: `/assets/upload/currency-logo/${r.symbol?.toLowerCase?.() ?? ''}.svg`,
          decimals: cur?.decimals ?? 8,
          chainId: cur?.chain_id ?? null,
          chainName: cur?.chain_name ?? null,
          availableBalance: available
        };
      });
      data.sort((a, b) => new Decimal(b.availableBalance).comparedTo(a.availableBalance));
      return { success: true, data };
    } catch (error) {
      logger.error('Failed to get transfer balances', {
        error: error instanceof Error ? error.message : 'Unknown',
        userId: request.user?.id
      });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to get transfer balances' }
      });
    }
  });

  // Execute internal transfer between accounts
  app.post<{ Body: { fromAccount: string; toAccount: string; tokenId: string; amount: string } }>('/transfer', {
    preHandler: [app.authenticate]
  }, async (request, reply) => {
    try {
      const userId = request.user!.id;
      const { fromAccount, toAccount, tokenId, amount } = request.body;

      // Idempotency: check before balance operations
      const idempotencyKeyRaw = (request.headers[IDEMPOTENCY_KEY_HEADER] ?? request.headers['Idempotency-Key']) as string | undefined;
      const idempotencyKey = typeof idempotencyKeyRaw === 'string' ? idempotencyKeyRaw.trim() : '';
      if (!idempotencyKey) {
        return reply.status(400).send({
          success: false,
          error: { code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'Idempotency-Key header is required for transfer requests.' },
        });
      }
      if (idempotencyKey.length > 256) {
        return reply.status(400).send({
          success: false,
          error: { code: 'IDEMPOTENCY_KEY_INVALID', message: 'Idempotency-Key must be at most 256 characters.' },
        });
      }
      const transferRequestHash = buildTransferRequestHash(request.body as Record<string, unknown>);
      const transferRedisKey = `transfer:idempotency:${userId}:${idempotencyKey}`;
      const transferCached = await redis.getJson<TransferIdempotencyCache>(transferRedisKey);
      if (transferCached) {
        if (transferCached.requestHash !== transferRequestHash) {
          return reply.status(409).send({
            success: false,
            error: {
              code: 'IDEMPOTENCY_KEY_REUSED',
              message: 'Idempotency-Key was already used with a different request body. Use a new key or the same request body.',
            },
          });
        }
        return reply.status(200).send(transferCached.response);
      }
      const transferLockKey = `transfer:idempotency:lock:${userId}:${idempotencyKey}`;
      const transferLockAcquired = await redis.setNxEx(transferLockKey, '1', TRANSFER_IDEMPOTENCY_LOCK_TTL_SECONDS);
      if (!transferLockAcquired) {
        return reply.status(409).send({
          success: false,
          error: {
            code: 'IDEMPOTENCY_KEY_IN_PROGRESS',
            message: 'A transfer with this Idempotency-Key is already in progress. Retry after a few seconds.',
          },
        });
      }

      // Validate accounts (funding, spot, trading only; no unified)
      const validAccounts = ['funding', 'spot', 'trading'];
      if (!validAccounts.includes(fromAccount) || !validAccounts.includes(toAccount)) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_ACCOUNT', message: 'Invalid account type' }
        });
      }

      if (fromAccount === toAccount) {
        return reply.status(400).send({
          success: false,
          error: { code: 'SAME_ACCOUNT', message: 'Cannot transfer to the same account' }
        });
      }

      let transferAmountDec: DecimalInstance;
      try {
        transferAmountDec = new Decimal(amount).toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN);
      } catch {
        transferAmountDec = new Decimal(NaN);
      }
      if (!transferAmountDec.isFinite() || transferAmountDec.lte(0)) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_AMOUNT', message: 'Invalid transfer amount' }
        });
      }

      // Check if token exists (use tokens table directly)
      const tokenResult = await db.query(`
        SELECT id, symbol, name FROM tokens WHERE id = $1 AND is_active = TRUE
      `, [tokenId]);

      if (tokenResult.rows.length === 0) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_TOKEN', message: 'Token not found or inactive' }
        });
      }

      const token = tokenResult.rows[0]!;
      const currencyId = await getCurrencyIdBySymbol(token.symbol);
      if (!currencyId) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_TOKEN', message: 'Currency not found for token' }
        });
      }

      const amountStr = transferAmountDec.toString();

      // Debit fromAccount, credit toAccount in user_balances (transaction; abort if debit fails)
      // Lock both account rows in deterministic order to avoid deadlock when concurrent transfers run (e.g. funding→trading and trading→funding).
      const [firstAccount, secondAccount] = [fromAccount, toAccount].slice().sort();
      await db.transaction(async (client) => {
        await ensureUserBalanceRow(userId, currencyId, CHAIN_ID_GLOBAL, fromAccount, client);
        await ensureUserBalanceRow(userId, currencyId, CHAIN_ID_GLOBAL, toAccount, client);

        await client.query(
          `SELECT available_balance FROM user_balances
           WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = $4 FOR UPDATE`,
          [userId, currencyId, CHAIN_ID_GLOBAL, firstAccount]
        );
        await client.query(
          `SELECT available_balance FROM user_balances
           WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = $4 FOR UPDATE`,
          [userId, currencyId, CHAIN_ID_GLOBAL, secondAccount]
        );

        const lockResult = await client.query<{ available_balance: string }>(`
          SELECT available_balance
          FROM user_balances
          WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = $4
        `, [userId, currencyId, CHAIN_ID_GLOBAL, fromAccount]);

        if (lockResult.rows.length === 0) {
          const err = new Error('NO_BALANCE_FOR_ACCOUNT');
          (err as { statusCode?: number; code?: string }).statusCode = 400;
          (err as { statusCode?: number; code?: string }).code = 'NO_BALANCE_FOR_ACCOUNT';
          throw err;
        }

        const availableBalance = new Decimal(lockResult.rows[0]!.available_balance || '0').toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN);
        if (availableBalance.lt(transferAmountDec)) {
          const err = new Error('INSUFFICIENT_BALANCE');
          (err as { statusCode?: number; code?: string }).statusCode = 400;
          (err as { statusCode?: number; code?: string }).code = 'INSUFFICIENT_BALANCE';
          throw err;
        }

        await walletService.debitAvailableBalance(userId, currencyId, fromAccount, amountStr, client);
        await walletService.creditBalanceForAccount(userId, currencyId, toAccount, amountStr, client);
      });

      auditLog(userId, 'internal_transfer', {
        fromAccount,
        toAccount,
        tokenId,
        symbol: token.symbol,
        amount: amountStr
      });

      try {
        await db.query(`
          INSERT INTO internal_transfers (from_user_id, to_user_id, currency_id, amount, transfer_type, status, notes)
          VALUES ($1, $1, $2, $3, 'internal', 'completed', $4)
        `, [userId, currencyId, amountStr, `Transfer from ${fromAccount} to ${toAccount}`]);
      } catch {
        logger.debug('internal_transfers table not available, skipping record');
      }

      logger.info('Internal transfer completed', {
        userId,
        fromAccount,
        toAccount,
        symbol: token.symbol,
        amount: amountStr
      });

      const transferResponse = {
        success: true,
        message: `Successfully transferred ${amountStr} ${token.symbol} from ${fromAccount} to ${toAccount}`,
        data: {
          fromAccount,
          toAccount,
          symbol: token.symbol,
          amount: amountStr
        }
      };
      try {
        await redis.setJson(
          transferRedisKey,
          { requestHash: transferRequestHash, response: transferResponse },
          TRANSFER_IDEMPOTENCY_TTL_SECONDS
        );
      } catch (e) {
        logger.warn('Transfer idempotency cache set failed', { userId, idempotencyKey: idempotencyKey.slice(0, 32) });
      }
      return transferResponse;
    } catch (error) {
      const err = error as { statusCode?: number; code?: string; message?: string };
      if (err.statusCode === 400 && err.code === 'NO_BALANCE_FOR_ACCOUNT') {
        return reply.status(400).send({
          success: false,
          error: { code: 'NO_BALANCE_FOR_ACCOUNT', message: 'No balance for this account type. Use funding if you have no spot/trading rows.' }
        });
      }
      if (err.statusCode === 400 && err.code === 'INSUFFICIENT_BALANCE') {
        return reply.status(400).send({
          success: false,
          error: { code: 'INSUFFICIENT_BALANCE', message: 'Insufficient balance for transfer' }
        });
      }
      logger.error('Failed to execute transfer', { 
        error: error instanceof Error ? error.message : 'Unknown',
        userId: request.user?.id 
      });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to execute transfer' }
      });
    }
  });

  // Get transfer history
  app.get<{ Querystring: { limit?: string; offset?: string } }>('/transfer/history', {
    preHandler: [app.authenticate]
  }, async (request, reply) => {
    try {
      const userId = request.user!.id;
      const limit = parseInt(request.query.limit || '20');
      const offset = parseInt(request.query.offset || '0');

      // Check if table exists
      const tableCheck = await db.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = 'internal_transfers'
        )
      `);

      const tableRow = tableCheck.rows[0] as { exists: boolean } | undefined;
      if (!tableRow?.exists) {
        return reply.send({ success: true, data: [], total: 0 });
      }

      const result = await db.query<{
        id: string;
        from_user_id: string;
        to_user_id: string;
        amount: string;
        status: string;
        created_at: string;
        symbol: string;
        name: string;
        icon_url: string | null;
        from_email: string | null;
        to_email: string | null;
      }>(`
        SELECT 
          it.id,
          it.from_user_id,
          it.to_user_id,
          it.amount::text,
          it.status,
          it.created_at::text,
          c.symbol,
          c.name,
          c.logo_url as icon_url,
          u_from.email as from_email,
          u_to.email as to_email
        FROM internal_transfers it
        JOIN currencies c ON it.currency_id = c.id
        LEFT JOIN users u_from ON it.from_user_id = u_from.id
        LEFT JOIN users u_to ON it.to_user_id = u_to.id
        WHERE it.from_user_id = $1 OR it.to_user_id = $1
        ORDER BY it.created_at DESC
        LIMIT $2 OFFSET $3
      `, [userId, limit, offset]);

      const countResult = await db.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM internal_transfers WHERE from_user_id = $1 OR to_user_id = $1`,
        [userId]
      );

      const data = result.rows.map(row => {
        const isOut = row.from_user_id === userId;
        const toEmail = row.to_email || 'user';
        const fromEmail = row.from_email || 'user';
        return {
          id: row.id,
          fromAccount: isOut ? 'Funding' : fromEmail,
          toAccount: isOut ? toEmail : 'Funding',
          description: isOut ? `Sent to ${toEmail}` : `Received from ${fromEmail}`,
          amount: row.amount,
          symbol: row.symbol,
          name: row.name,
          iconUrl: row.icon_url ?? undefined,
          status: row.status,
          createdAt: row.created_at,
          direction: isOut ? 'sent' as const : 'received' as const,
        };
      });

      return reply.send({
        success: true,
        data,
        total: parseInt(countResult.rows[0]?.count ?? '0', 10)
      });
    } catch (error) {
      logger.error('Failed to get transfer history', { 
        error: error instanceof Error ? error.message : 'Unknown',
        userId: request.user?.id 
      });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to get transfer history' }
      });
    }
  });

  // Get P&L data (authenticated)
  app.get<{ Querystring: { period?: string; type?: string; symbol?: string } }>('/pnl', {
    preHandler: [app.authenticate]
  }, async (request, reply) => {
    try {
      const userId = request.user!.id;
      const period = request.query.period || '7D';
      const type = request.query.type || 'spot';
      const symbol = request.query.symbol || 'all';

      // Calculate date range
      const days = period === '7D' ? 7 : period === '30D' ? 30 : period === '60D' ? 60 : period === '90D' ? 90 : 180;
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      // Get trading history for P&L calculation (period-scoped spot fills)
      const tradesResult = await db.query(`
        SELECT 
          t.symbol,
          SUM(CASE WHEN o.side = 'buy' THEN o.filled_amount * o.price ELSE 0 END) as buy_value,
          SUM(CASE WHEN o.side = 'sell' THEN o.filled_amount * o.price ELSE 0 END) as sell_value,
          SUM(CASE WHEN o.side = 'buy' THEN o.filled_amount ELSE 0 END) as buy_qty,
          SUM(CASE WHEN o.side = 'sell' THEN o.filled_amount ELSE 0 END) as sell_qty
        FROM orders o
        JOIN tokens t ON o.token_id = t.id
        WHERE o.user_id = $1 
          AND o.status = 'filled'
          AND o.created_at >= $2
          ${symbol !== 'all' ? 'AND UPPER(t.symbol) = UPPER($3)' : ''}
        GROUP BY t.symbol
        ORDER BY (SUM(CASE WHEN o.side = 'sell' THEN o.filled_amount * o.price ELSE 0 END) - SUM(CASE WHEN o.side = 'buy' THEN o.filled_amount * o.price ELSE 0 END)) DESC
      `, symbol !== 'all' ? [userId, startDate, symbol] : [userId, startDate]);

      type PnlRow = {
        symbol?: string;
        sell_value?: string;
        buy_value?: string;
        buy_qty?: string;
        sell_qty?: string;
      };

      const assets = tradesResult.rows.map((row) => {
        const r = row as PnlRow;
        const buyVal = new Decimal(r.buy_value || '0');
        const sellVal = new Decimal(r.sell_value || '0');
        const buyQty = new Decimal(r.buy_qty || '0');
        const sellQty = new Decimal(r.sell_qty || '0');
        const pnl = sellVal.minus(buyVal).toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN);
        const avgBuyPrice = buyQty.gt(0)
          ? buyVal.div(buyQty).toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN).toNumber()
          : 0;
        const quantity = Decimal.max(0, buyQty.minus(sellQty)).toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN).toNumber();
        const pnlPercent = buyVal.gt(0)
          ? pnl.div(buyVal).times(100).toDecimalPlaces(2, ROUND_DOWN).toNumber()
          : 0;
        return {
          symbol: r.symbol ?? 'Unknown',
          pnl: pnl.toNumber(),
          pnlPercent,
          avgBuyPrice,
          currentPrice: 0,
          quantity,
        };
      });

      const totalPnlDec = assets.reduce((sum, a) => sum.plus(a.pnl), new Decimal(0)).toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN);
      const totalBuyDec = tradesResult.rows.reduce((sum, row) => {
        const r = row as PnlRow;
        return sum.plus(r.buy_value || '0');
      }, new Decimal(0)).toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN);
      const totalPnlPercent = totalBuyDec.gt(0)
        ? totalPnlDec.div(totalBuyDec).times(100).toDecimalPlaces(2, ROUND_DOWN).toNumber()
        : 0;

      const totalPnl = totalPnlDec.toNumber();
      const unrealizedPnl = 0;
      const realizedPnl = totalPnl;

      return {
        success: true,
        data: {
          totalPnl,
          totalPnlPercent,
          unrealizedPnl,
          realizedPnl,
          assets,
        },
      };
    } catch (error) {
      logger.error('Failed to get P&L data', { 
        error: error instanceof Error ? error.message : 'Unknown',
        userId: request.user?.id 
      });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to get P&L data' }
      });
    }
  });

  // Get deposit history with confirmation tracking (from indexer)
  app.get<{ Querystring: { page?: string; limit?: string; status?: string } }>('/deposit-history', {
    preHandler: [app.authenticate]
  }, async (request, reply) => {
    try {
      const userId = request.user!.id;
      const page = parseInt(request.query.page || '1');
      const limit = Math.min(parseInt(request.query.limit || '20'), 100);
      const offset = (page - 1) * limit;
      const status = request.query.status;

      // Repair: complete overdue pending deposits via atomic credit service (no double-credit)
      try {
        const hasUserBalances = await db.query(
          `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'user_balances'`
        );
        if (hasUserBalances.rows.length > 0) {
          const { credited } = await creditOverdueDepositsForUser(userId);
          if (credited > 0) logger.info('Deposit repair: credited overdue deposits', { userId, credited });
        }
      } catch (e) {
        logger.warn('Deposit repair skipped or failed', { userId, error: e instanceof Error ? e.message : 'Unknown' });
      }

      let whereClause = 'd.user_id = $1 AND (d.amount IS NULL OR d.amount::numeric > 0)';
      const params: unknown[] = [userId];

      if (status) {
        params.push(status);
        whereClause += ` AND d.status = $${params.length}`;
      }

      let result: { rows: any[] };
      let countResult: { rows: { count: string }[] };
      try {
        result = await db.query(`
          SELECT 
            d.id,
            d.tx_hash,
            d.from_address,
            d.to_address,
            d.amount::text,
            d.confirmations,
            d.required_confirmations,
            d.block_number,
            d.block_timestamp,
            d.status,
            d.credited_at,
            d.created_at,
            d.updated_at,
            c.symbol,
            c.name as currency_name,
            c.logo_url,
            b.chain_name,
            b.chain_symbol,
            b.chain_id as chain_numeric_id
          FROM deposits d
          LEFT JOIN currencies c ON d.currency_id = c.id
          LEFT JOIN blockchains b ON d.blockchain_id = b.id
          WHERE ${whereClause}
          ORDER BY d.created_at DESC
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}
        `, [...params, limit, offset]);
        countResult = await db.query<{ count: string }>(
          `SELECT COUNT(*) as count FROM deposits WHERE user_id = $1 AND (amount IS NULL OR amount::numeric > 0)`,
          [userId]
        );
      } catch (queryError) {
        logger.warn('Deposit history query failed (schema or tables)', { userId, error: queryError instanceof Error ? queryError.message : 'Unknown' });
        return reply.send({
          success: true,
          data: [],
          pagination: { page: 1, limit, total: 0, totalPages: 0 }
        });
      }

      const explorerMap: Record<string, string> = {
        'ETH': 'https://etherscan.io/tx/',
        'BSC': 'https://bscscan.com/tx/',
        'BNB': 'https://bscscan.com/tx/',
        'MATIC': 'https://polygonscan.com/tx/',
        'ARB': 'https://arbiscan.io/tx/',
        'BASE': 'https://basescan.org/tx/',
      };

      const deposits = result.rows.map(row => {
        const explorerBase = explorerMap[row.chain_symbol?.toUpperCase()] || 'https://etherscan.io/tx/';
        return {
          id: row.id,
          txHash: row.tx_hash,
          explorerUrl: row.tx_hash ? `${explorerBase}${row.tx_hash}` : null,
          fromAddress: row.from_address,
          toAddress: row.to_address,
          amount: row.amount,
          symbol: row.symbol,
          currencyName: row.currency_name,
          logoUrl: row.logo_url,
          chainName: row.chain_name,
          chainSymbol: row.chain_symbol,
          confirmations: row.confirmations || 0,
          requiredConfirmations: row.required_confirmations || 25,
          confirmationProgress: Math.min(100, ((row.confirmations || 0) / (row.required_confirmations || 25)) * 100),
          blockNumber: row.block_number,
          blockTimestamp: row.block_timestamp,
          status: row.status,
          creditedAt: row.credited_at,
          createdAt: row.created_at,
          updatedAt: row.updated_at
        };
      });

      return reply.send({
        success: true,
        data: deposits,
        pagination: {
          page,
          limit,
          total: parseInt(countResult.rows[0]?.count || '0'),
          totalPages: Math.ceil(parseInt(countResult.rows[0]?.count || '0') / limit)
        }
      });
    } catch (error) {
      logger.error('Failed to get deposit history', { 
        error: error instanceof Error ? error.message : 'Unknown',
        userId: request.user?.id 
      });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to get deposit history' }
      });
    }
  });

  // Get ALL transactions (deposits + withdrawals + transfers combined)
  app.get<{ Querystring: { limit?: string; offset?: string; status?: string; coin?: string } }>('/transactions/all', {
    preHandler: [app.authenticate]
  }, async (request, reply) => {
    try {
      const userId = request.user!.id;
      const limit = parseInt(request.query.limit || '50');
      const offset = parseInt(request.query.offset || '0');
      const statusFilter = request.query.status?.toLowerCase();
      const coinFilter = request.query.coin?.toUpperCase();

      // Repair: overdue pending deposits via atomic credit service (no double-credit)
      try {
        const hasUB = await db.query(
          `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'user_balances'`
        );
        if (hasUB.rows.length > 0) {
          const { credited } = await creditOverdueDepositsForUser(userId);
          if (credited > 0) logger.info('Deposit repair: credited overdue deposits', { userId, credited });
        }
      } catch (e) {
        logger.warn('Deposit repair skipped or failed', { userId, error: e instanceof Error ? e.message : 'Unknown' });
      }

      const allTransactions: any[] = [];
      let paramIndex = 2;

      // 1. Get DEPOSITS (exclude zero amount; address = sender = from_address)
      try {
        let depositQuery = `
          SELECT 
            d.id,
            'deposit' as type,
            d.tx_hash,
            d.from_address,
            d.to_address,
            d.amount,
            d.status,
            d.confirmations,
            d.required_confirmations,
            d.created_at,
            c.symbol,
            c.name as currency_name,
            c.logo_url,
            b.chain_name
          FROM deposits d
          LEFT JOIN currencies c ON d.currency_id = c.id
          LEFT JOIN blockchains b ON d.blockchain_id = b.id
          WHERE d.user_id = $1 AND (d.amount IS NULL OR d.amount::numeric > 0)
        `;
        const depositParams: any[] = [userId];
        let dpIdx = 2;
        if (statusFilter && statusFilter !== 'all') {
          depositQuery += ` AND LOWER(d.status) = $${dpIdx}`;
          depositParams.push(statusFilter);
          dpIdx++;
        }
        if (coinFilter && coinFilter !== 'ALL') {
          depositQuery += ` AND UPPER(c.symbol) = $${dpIdx}`;
          depositParams.push(coinFilter);
        }
        const depositsResult = await db.query(depositQuery, depositParams);
        depositsResult.rows.forEach(row => {
          allTransactions.push({
            id: row.id,
            type: 'deposit',
            coin: row.symbol || 'Unknown',
            coin_logo: row.logo_url || `/assets/upload/currency-logo/${(row.symbol || 'btc').toLowerCase()}.svg`,
            chain_type: row.chain_name || 'Unknown',
            quantity: row.amount,
            address: row.from_address || '',
            txid: row.tx_hash || '',
            status: row.status,
            date_time: row.created_at,
            confirmations: row.confirmations || 0,
            requiredConfirmations: row.required_confirmations || 25
          });
        });
      } catch (e) {
        logger.warn('Transactions/all: deposits query failed', { userId, error: e instanceof Error ? e.message : 'Unknown' });
      }

      // 2. Get WITHDRAWALS (try tokens/chains schema first; fallback to currencies/blockchains)
      try {
        // Withdrawals table in this app uses token_id, chain_id (tokens, chains)
        const withdrawQueryTokens = `
          SELECT 
            w.id,
            'withdraw' as type,
            w.tx_hash,
            w.to_address as address,
            w.amount,
            w.status,
            w.created_at,
            w.type as withdrawal_type,
            w.internal_user_id,
            u_internal.email as internal_recipient_email,
            t.symbol,
            t.name as currency_name,
            t.icon_url as logo_url,
            c.name as chain_name
          FROM withdrawals w
          LEFT JOIN tokens t ON w.token_id = t.id
          LEFT JOIN chains c ON w.chain_id = c.id
          LEFT JOIN users u_internal ON w.internal_user_id = u_internal.id
          WHERE w.user_id = $1
        `;
        const withdrawParams: any[] = [userId];
        let wpIdx = 2;
        let withdrawQuery = withdrawQueryTokens;
        if (statusFilter && statusFilter !== 'all') {
          withdrawQuery += ` AND LOWER(w.status) = $${wpIdx}`;
          withdrawParams.push(statusFilter);
          wpIdx++;
        }
        if (coinFilter && coinFilter !== 'ALL') {
          withdrawQuery += ` AND UPPER(t.symbol) = $${wpIdx}`;
          withdrawParams.push(coinFilter);
        }
        const withdrawalsResult = await db.query(withdrawQuery, withdrawParams);
        withdrawalsResult.rows.forEach((row) => {
          const r = row as { id: string; symbol: string; logo_url: string | null; chain_name: string | null; amount: string; address: string | null; tx_hash: string | null; status: string; created_at: string; withdrawal_type?: string; internal_recipient_email?: string | null };
          const isInternal = r.withdrawal_type === 'internal';
          const chainType = isInternal
            ? `Sent to ${r.internal_recipient_email || 'user'}`
            : (r.chain_name || 'Unknown');
          allTransactions.push({
            id: r.id,
            type: 'withdraw',
            coin: r.symbol || 'Unknown',
            coin_logo: r.logo_url || `/assets/upload/currency-logo/${(r.symbol || 'btc').toLowerCase()}.svg`,
            chain_type: chainType,
            quantity: r.amount,
            address: r.address || (isInternal ? (r.internal_recipient_email || '') : ''),
            txid: r.tx_hash || '',
            status: r.status,
            date_time: r.created_at
          });
        });
      } catch (e) {
        logger.warn('Transactions/all: withdrawals query failed', { userId, error: e instanceof Error ? e.message : 'Unknown' });
      }

      // 3. Get TRANSFERS
      try {
        const tableCheck = await db.query(`
          SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'internal_transfers')
        `);

        const tableRow = tableCheck.rows[0] as { exists: boolean } | undefined;
        if (tableRow?.exists) {
          let transferQuery = `
            SELECT 
              it.id,
              'transfer' as type,
              it.from_user_id,
              it.to_user_id,
              it.amount,
              it.status,
              it.created_at,
              c.symbol,
              c.name as currency_name,
              c.logo_url,
              u_from.email as from_email,
              u_to.email as to_email
            FROM internal_transfers it
            JOIN currencies c ON it.currency_id = c.id
            LEFT JOIN users u_from ON it.from_user_id = u_from.id
            LEFT JOIN users u_to ON it.to_user_id = u_to.id
            WHERE it.from_user_id = $1 OR it.to_user_id = $1
          `;
          const transferParams: any[] = [userId];
          paramIndex = 2;

          if (statusFilter && statusFilter !== 'all') {
            transferQuery += ` AND LOWER(it.status) = $${paramIndex}`;
            transferParams.push(statusFilter);
            paramIndex++;
          }
          if (coinFilter && coinFilter !== 'ALL') {
            transferQuery += ` AND UPPER(c.symbol) = $${paramIndex}`;
            transferParams.push(coinFilter);
          }

          const transfersResult = await db.query(transferQuery, transferParams);
          transfersResult.rows.forEach((row) => {
            const r = row as { id: string; from_user_id: string; to_user_id: string; amount: string; status: string; created_at: string; symbol: string; logo_url: string | null; from_email: string | null; to_email: string | null };
            const isOut = r.from_user_id === userId;
            const desc = isOut ? `Sent to ${r.to_email || 'user'}` : `Received from ${r.from_email || 'user'}`;
            allTransactions.push({
              id: r.id,
              type: 'transfer',
              coin: r.symbol || 'Unknown',
              coin_logo: r.logo_url || `/assets/upload/currency-logo/${(r.symbol || 'btc').toLowerCase()}.svg`,
              chain_type: desc,
              quantity: r.amount,
              address: isOut ? (r.to_email || '') : (r.from_email || ''),
              txid: '',
              status: r.status,
              date_time: r.created_at
            });
          });
        }
      } catch (e) {
        // Internal transfers table may not exist
      }

      // Sort all by date descending
      allTransactions.sort((a, b) => new Date(b.date_time).getTime() - new Date(a.date_time).getTime());

      // Apply pagination
      const paginatedTransactions = allTransactions.slice(offset, offset + limit);

      return {
        success: true,
        data: paginatedTransactions,
        total: allTransactions.length
      };
    } catch (error) {
      logger.error('Failed to get all transactions', { 
        error: error instanceof Error ? error.message : 'Unknown',
        userId: request.user?.id 
      });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to get all transactions' }
      });
    }
  });

  // Get single deposit details with real-time confirmation update
  app.get<{ Params: { txHash: string } }>('/deposit/:txHash', {
    preHandler: [app.authenticate]
  }, async (request, reply) => {
    try {
      const userId = request.user!.id;
      const { txHash } = request.params;

      const result = await db.query(`
        SELECT 
          d.*,
          c.symbol,
          c.name as currency_name,
          c.logo_url,
          b.chain_name,
          b.chain_symbol
        FROM deposits d
        LEFT JOIN currencies c ON d.currency_id = c.id
        LEFT JOIN blockchains b ON d.blockchain_id = b.id
        WHERE d.tx_hash = $1 AND d.user_id = $2
      `, [txHash, userId]);

      if (result.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Deposit not found' }
        });
      }

      const deposit = result.rows[0]!;

      return {
        success: true,
        data: {
          id: deposit.id,
          txHash: deposit.tx_hash,
          fromAddress: deposit.from_address,
          toAddress: deposit.to_address,
          amount: deposit.amount,
          symbol: deposit.symbol,
          currencyName: deposit.currency_name,
          logoUrl: deposit.logo_url,
          chainName: deposit.chain_name,
          chainSymbol: deposit.chain_symbol,
          confirmations: deposit.confirmations || 0,
          requiredConfirmations: deposit.required_confirmations || 25,
          status: deposit.status,
          blockNumber: deposit.block_number,
          blockTimestamp: deposit.block_timestamp,
          creditedAt: deposit.credited_at,
          createdAt: deposit.created_at
        }
      };
    } catch (error) {
      logger.error('Failed to get deposit details', { 
        error: error instanceof Error ? error.message : 'Unknown' 
      });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to get deposit details' }
      });
    }
  });

  // Register advanced tier-1 wallet endpoints
  await registerAdvancedWalletRoutes(app);
}

/** Block confirmations required for deposit crediting only (chain-level setting). */
function getDepositNotice(chainType: string, confirmations: number | undefined): string {
  const confirms = confirmations || 12;
  const notices: string[] = [
    `Your deposit will be credited after ${confirms} block confirmations on the network.`,
    'Please ensure you are sending the correct token on the correct network.',
    'Sending tokens on the wrong network may result in permanent loss of funds.'
  ];

  if (chainType === 'evm') {
    notices.push('This address supports all ERC-20/BEP-20 compatible tokens on this chain.');
  }

  return notices.join(' ');
}

/* ─────────────────────────────────────────────
   Advanced wallet endpoints (tier-1 features)
   ───────────────────────────────────────────── */

export async function registerAdvancedWalletRoutes(app: FastifyInstance): Promise<void> {

  // Portfolio balance history (for chart)
  app.get<{ Querystring: { period?: string } }>(
    '/portfolio-history',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      try {
        const userId = request.user!.id;
        const period = (request.query.period || '7d') as '24h' | '7d' | '30d' | '90d' | '1y';
        const validPeriods = ['24h', '7d', '30d', '90d', '1y'];
        const safePeriod = validPeriods.includes(period) ? period : '7d';
        const data = await getPortfolioHistory(userId, safePeriod as '24h' | '7d' | '30d' | '90d' | '1y');
        return reply.send({ success: true, data });
      } catch (e) {
        logger.error(`portfolio-history error: ${e instanceof Error ? e.message : 'unknown'}`);
        return reply.status(500).send({ success: false, error: { message: 'Failed to load portfolio history' } });
      }
    }
  );

  // Coin info (CoinGecko data)
  app.get<{ Params: { symbol: string } }>(
    '/coin-info/:symbol',
    async (request, reply) => {
      try {
        const { symbol } = request.params;
        if (!symbol || symbol.length > 20) {
          return reply.status(400).send({ success: false, error: { message: 'Invalid symbol' } });
        }
        const info = await getCoinInfo(symbol);
        return reply.send({ success: true, data: info });
      } catch (e) {
        logger.error(`coin-info error: ${e instanceof Error ? e.message : 'unknown'}`);
        return reply.status(500).send({ success: false, error: { message: 'Failed to load coin info' } });
      }
    }
  );

  // Dust conversion - convert all small balances (< threshold USD) to USDT
  app.post<{ Body: { threshold?: number } }>(
    '/convert-dust',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      try {
        const userId = request.user!.id;
        const threshold = Math.min(request.body?.threshold ?? 1, 10); // max $10 per asset
        
        const { rows: balances } = await db.query<{
          currency_id: string; symbol: string; balance: string; account_type: string;
        }>(
          `SELECT ub.currency_id, c.symbol, (ub.available_balance + ub.locked_balance)::text AS balance, ub.account_type
           FROM user_balances ub
           JOIN currencies c ON c.id = ub.currency_id
           WHERE ub.user_id = $1 AND ub.account_type = 'funding'
             AND (CAST(ub.available_balance AS NUMERIC) > 0 OR CAST(ub.locked_balance AS NUMERIC) > 0)
             AND c.symbol NOT IN ('USDT', 'USDC', 'DAI')`,
          [userId]
        );

        const { rows: tickers } = await db.query<{ symbol: string; last_price: string }>(
          `SELECT sm.symbol,
                  COALESCE(mp.price::text, candle.close_price::text, '0') AS last_price
           FROM spot_markets sm
           LEFT JOIN LATERAL (
             SELECT mp2.price FROM market_prices mp2
             WHERE mp2.base_currency_id = sm.base_currency_id AND mp2.quote_currency_id = sm.quote_currency_id
             LIMIT 1
           ) mp ON TRUE
           LEFT JOIN LATERAL (
             SELECT oc.close_price FROM ohlcv_candles oc
             JOIN trading_pairs tp2 ON tp2.id = oc.trading_pair_id
             WHERE tp2.symbol = sm.symbol ORDER BY oc.open_time DESC LIMIT 1
           ) candle ON TRUE
           WHERE sm.status IN ('active', 'maintenance')`
        );
        const priceMap: Record<string, number> = {};
        for (const t of tickers) {
          const base = t.symbol.split('_')[0];
          if (base) priceMap[base] = parseFloat(t.last_price) || 0;
        }

        const converted: Array<{ symbol: string; amount: string; usd_value: string }> = [];
        const usdtCurrencyId = await getCurrencyIdBySymbol('USDT');
        if (!usdtCurrencyId) {
          return reply.status(400).send({ success: false, error: { message: 'USDT currency not found' } });
        }

        for (const b of balances) {
          const amt = parseFloat(b.balance) || 0;
          const price = priceMap[b.symbol] ?? 0;
          const usdVal = amt * price;

          if (usdVal > 0 && usdVal < threshold && price > 0) {
            try {
              const usdtAmount = new Decimal(amt).mul(price).toFixed(AMOUNT_PRECISION, ROUND_DOWN);
              if (parseFloat(usdtAmount) <= 0) continue;

              await db.transaction(async (client) => {
                const deductResult = await client.query(
                  `UPDATE user_balances SET available_balance = (CAST(available_balance AS NUMERIC) - $1)::TEXT,
                   updated_at = NOW()
                   WHERE user_id = $2 AND currency_id = $3 AND account_type = 'funding'
                     AND CAST(available_balance AS NUMERIC) >= $1
                   RETURNING id`,
                  [b.balance, userId, b.currency_id]
                );
                if (deductResult.rowCount === 0) return;

                // Credit USDT
                await ensureUserBalanceRow(userId, usdtCurrencyId, 'funding');
                await client.query(
                  `UPDATE user_balances SET available_balance = (CAST(available_balance AS NUMERIC) + $1)::TEXT,
                   updated_at = NOW()
                   WHERE user_id = $2 AND currency_id = $3 AND account_type = 'funding'`,
                  [usdtAmount, userId, usdtCurrencyId]
                );

                // Record ledger entries for dust conversion
                const refId = crypto.randomUUID();
                await client.query(
                  `INSERT INTO balance_ledger (user_id, currency_id, reference_type, reference_id, debit, credit, balance_before, balance_after, balance_type, description, created_at)
                   VALUES ($1, $2, 'adjustment'::ledger_reference_type, $3, $4::numeric, 0, 0, 0, 'available'::balance_type, $5, NOW())`,
                  [userId, b.currency_id, refId, b.balance, `Dust convert ${b.symbol} to USDT`]
                );
                await client.query(
                  `INSERT INTO balance_ledger (user_id, currency_id, reference_type, reference_id, debit, credit, balance_before, balance_after, balance_type, description, created_at)
                   VALUES ($1, $2, 'adjustment'::ledger_reference_type, $3, 0, $4::numeric, 0, 0, 'available'::balance_type, $5, NOW())`,
                  [userId, usdtCurrencyId, refId, usdtAmount, `Dust convert from ${b.symbol}`]
                );

                converted.push({ symbol: b.symbol, amount: b.balance, usd_value: usdVal.toFixed(2) });
              });
            } catch (e) {
              logger.warn(`dust convert failed for ${b.symbol}: ${e instanceof Error ? e.message : 'unknown'}`);
            }
          }
        }

        return reply.send({
          success: true,
          data: {
            converted_count: converted.length,
            converted_assets: converted,
            total_usdt_received: converted.reduce((s, c) => s + parseFloat(c.usd_value), 0).toFixed(2),
          },
        });
      } catch (e) {
        logger.error(`convert-dust error: ${e instanceof Error ? e.message : 'unknown'}`);
        return reply.status(500).send({ success: false, error: { message: 'Dust conversion failed' } });
      }
    }
  );

  // Transaction statement export (CSV)
  app.get<{ Querystring: { year?: string; format?: string } }>(
    '/statement',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      try {
        const userId = request.user!.id;
        const year = parseInt(request.query.year || String(new Date().getFullYear()), 10);
        const startDate = `${year}-01-01`;
        const endDate = `${year + 1}-01-01`;

        const { rows } = await db.query<{
          type: string; symbol: string; amount: string; fee: string;
          status: string; created_at: string; description: string;
        }>(
          `SELECT
             CASE
               WHEN reference_type = 'deposit' THEN 'Deposit'
               WHEN reference_type = 'withdrawal' THEN 'Withdrawal'
               WHEN reference_type = 'internal_transfer' THEN 'Transfer'
               WHEN reference_type = 'conversion' THEN 'Convert'
               WHEN reference_type IN ('spot_trade', 'trade') THEN 'Trade'
               ELSE reference_type
             END AS type,
             c.symbol,
             bl.amount,
             '0' AS fee,
             'completed' AS status,
             bl.created_at::TEXT AS created_at,
             COALESCE(bl.description, '') AS description
           FROM balance_ledger bl
           JOIN currencies c ON c.id = bl.currency_id
           WHERE bl.user_id = $1
             AND bl.created_at >= $2 AND bl.created_at < $3
           ORDER BY bl.created_at ASC
           LIMIT 10000`,
          [userId, startDate, endDate]
        );

        const fmt = request.query.format || 'json';
        if (fmt === 'csv') {
          const header = 'Date,Type,Asset,Amount,Fee,Status,Description\n';
          const body = rows.map((r) =>
            `${r.created_at},${r.type},${r.symbol},${r.amount},${r.fee},${r.status},"${r.description.replace(/"/g, '""')}"`
          ).join('\n');
          reply.header('Content-Type', 'text/csv');
          reply.header('Content-Disposition', `attachment; filename="statement-${year}.csv"`);
          return reply.send(header + body);
        }

        return reply.send({ success: true, data: { year, transactions: rows, count: rows.length } });
      } catch (e) {
        logger.error(`statement error: ${e instanceof Error ? e.message : 'unknown'}`);
        return reply.status(500).send({ success: false, error: { message: 'Failed to generate statement' } });
      }
    }
  );

  // Explorer URL for a specific chain
  app.get<{ Params: { chainId: string }; Querystring: { txHash?: string; address?: string } }>(
    '/explorer-url/:chainId',
    async (request, reply) => {
      try {
        const { chainId } = request.params;
        const { txHash, address } = request.query;

        const { rows } = await db.query<{ explorer_url: string; chain_type: string }>(
          `SELECT explorer_url, chain_type FROM blockchains WHERE id = $1 LIMIT 1`,
          [chainId]
        );

        const row = rows[0];
        if (!row || !row.explorer_url) {
          return reply.send({ success: true, data: { url: null } });
        }

        const baseUrl = row.explorer_url.replace(/\/+$/, '');
        let url = baseUrl;

        if (txHash) {
          url = `${baseUrl}/tx/${txHash}`;
        } else if (address) {
          url = `${baseUrl}/address/${address}`;
        }

        return reply.send({ success: true, data: { url, explorer_base: baseUrl } });
      } catch (e) {
        return reply.status(500).send({ success: false, error: { message: 'Failed to get explorer URL' } });
      }
    }
  );
}
