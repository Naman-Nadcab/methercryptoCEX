import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../lib/database.js';
import { redis } from '../lib/redis.js';
import { getCurrencyIdBySymbol } from '../lib/currency-resolver.js';
import { ensureUserBalanceRow, assertUserBalanceUpdated, DEFAULT_ACCOUNT_TYPE, CHAIN_ID_GLOBAL } from '../lib/user-balance-helper.js';
import { readUserBalances } from '../services/balance/readUserBalances.js';
import { walletService } from '../services/wallet.service.js';
import { logger, auditLog } from '../lib/logger.js';
import { logWithdrawalLifecycle } from '../lib/withdrawal-audit.js';
import { ChainId } from '../types/index.js';

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
  // Get all active chains (DB-only; no Redis dependency)
  app.get('/chains', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = await db.query<ChainDB>(`
        SELECT c.id, c.id as id_text, c.name, c.type, c.native_currency, c.decimals,
               c.rpc_url, c.explorer_url, c.is_active,
               COALESCE(c.confirmations_required, 25) as confirmations_required
        FROM chains c
        WHERE c.is_active = TRUE
        ORDER BY c.name ASC
      `);
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

      // Try cache first
      const cacheKey = `tokens:chain:${chainId}`;
      const cached = await redis.getJson<TokenDB[]>(cacheKey);
      
      if (cached) {
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

      // Cache for 5 minutes
      await redis.setJson(cacheKey, result.rows, 300);

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
      // Try cache first
      const cacheKey = 'tokens:unique:active';
      const cached = await redis.getJson<TokenDB[]>(cacheKey);
      
      if (cached) {
        return { success: true, data: cached };
      }

      // Get unique tokens by symbol (one per symbol)
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

      // Cache for 5 minutes
      await redis.setJson(cacheKey, result.rows, 300);

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

      const kyc = kycCheck.rows[0];
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
  app.get('/deposit-address/:chainId', {
    preHandler: [app.authenticate]
  }, async (request: FastifyRequest<{
    Params: { chainId: string }
  }>, reply: FastifyReply) => {
    const userId = request.user!.id;
    const { chainId } = request.params;
    const dev = process.env.NODE_ENV === 'development';

    const fail = (code: string, message: string, detail?: string) =>
      reply.status(500).send({
        success: false,
        error: { code, message, ...(dev && detail ? { detail } : {}) }
      });

    try {
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
  app.get('/deposits', {
    preHandler: [app.authenticate]
  }, async (request: FastifyRequest<{
    Querystring: { page?: string; limit?: string; status?: string }
  }>, reply: FastifyReply) => {
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
      let user_balances_funding_sum: number | string = 0;
      try {
        const ubSum = await db.query<{ total: string }>(`
          SELECT COALESCE(SUM(COALESCE(ub.available_balance, 0) + COALESCE(ub.locked_balance, 0)), 0)::text as total
          FROM user_balances ub WHERE ub.user_id = $1 AND COALESCE(ub.account_type::text, 'funding') IN ('funding', 'spot')
        `, [userId]);
        user_balances_funding_sum = parseFloat(ubSum.rows[0]?.total || '0');
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
      const ubFunding = typeof user_balances_funding_sum === 'number' ? user_balances_funding_sum : 0;
      out.reason_funds_zero = ubRows === 0
        ? 'BUG: ZERO rows in user_balances (source of truth). Deposit credit or ensureUserBalanceRow must create row.'
        : ubFunding === 0
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
  app.get('/balance-debug', {
    preHandler: [app.authenticate]
  }, async (request: FastifyRequest<{
    Querystring: { email?: string }
  }>, reply: FastifyReply) => {
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

      const fundingTotal = parseFloat(fundingSum.rows[0]?.total || '0');
      const tradingTotal = parseFloat(tradingSum.rows[0]?.total || '0');
      const reason_if_zero = ubRows.rows.length === 0
        ? 'BUG: ZERO rows in user_balances for this user — deposit credit or ensureUserBalanceRow did not create row.'
        : fundingTotal === 0 && tradingTotal === 0
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
            funding_total: fundingTotal,
            trading_total: tradingTotal,
            total: fundingTotal + tradingTotal
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

  // Get user balances (authenticated). Uses canonical readUserBalances only.
  app.get('/balances', {
    preHandler: [app.authenticate]
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user!.id;
      const [fundingRows, spotRows, tradingRows, namesResult] = await Promise.all([
        readUserBalances(userId, 'funding'),
        readUserBalances(userId, 'spot').catch(() => [] as Awaited<ReturnType<typeof readUserBalances>>),
        readUserBalances(userId, 'trading').catch(() => [] as Awaited<ReturnType<typeof readUserBalances>>),
        db.query<{ id: string; symbol: string; name: string }>(`SELECT id, symbol, COALESCE(name, symbol) as name FROM currencies WHERE is_active = TRUE`),
      ]);
      const byCurrency: Record<string, { symbol: string; available: number; locked: number }> = {};
      const allRows = [...fundingRows, ...spotRows, ...tradingRows];
      for (const r of allRows) {
        if (!byCurrency[r.currency_id]) {
          byCurrency[r.currency_id] = { symbol: r.symbol, available: 0, locked: 0 };
        }
        byCurrency[r.currency_id].available += parseFloat(r.available_balance || '0');
        byCurrency[r.currency_id].locked += parseFloat(r.locked_balance || '0');
      }
      const nameById: Record<string, string> = {};
      namesResult.rows.forEach(row => {
        nameById[row.id] = row.name || row.symbol;
      });
      const balances = Object.entries(byCurrency).map(([currency_id, agg]) => ({
        currency_id,
        symbol: agg.symbol,
        name: nameById[currency_id] ?? agg.symbol,
        available_balance: agg.available,
        locked_balance: agg.locked,
        total: agg.available + agg.locked
      }));

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

  // ============================================
  // WITHDRAWAL ENDPOINTS
  // ============================================

  // Get withdrawal history (authenticated)
  app.get('/withdrawals', {
    preHandler: [app.authenticate]
  }, async (request: FastifyRequest<{
    Querystring: { page?: string; limit?: string; status?: string; coin?: string }
  }>, reply: FastifyReply) => {
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

      if (!tableCheck.rows[0].exists) {
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
      const mappedData = result.rows.map((w: WithdrawalRow) => {
        const rejectionReason = w.rejection_reason ?? w.failed_reason ?? null;
        return {
          id: w.id,
          type: 'withdraw',
          amount: w.amount,
          fee: w.fee ?? '0',
          net_amount: w.net_amount ?? w.amount,
          status: w.status,
          displayStatus: displayStatus(w.status),
          chain: w.chain_name ?? 'Unknown',
          token: w.symbol ?? 'Unknown',
          tx_hash: w.tx_hash ?? null,
          rejection_reason: rejectionReason,
          coin: w.symbol || 'Unknown',
          coin_logo: w.logo_url || `/assets/upload/currency-logo/${(w.symbol || 'btc').toLowerCase()}.svg`,
          chain_type: w.chain_name || 'Unknown',
          quantity: w.amount,
          address: w.to_address ?? '',
          txid: w.tx_hash || '',
          date_time: w.created_at,
          withdrawal_type: w.withdrawal_type || 'onchain',
          internal_user_id: w.internal_user_id ?? null,
          internal_recipient_email: w.internal_recipient_email ?? null,
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

      const [fundingRows, spotRows, tradingRows, namesResult] = await Promise.all([
        readUserBalances(userId, 'funding'),
        readUserBalances(userId, 'spot').catch(() => [] as Awaited<ReturnType<typeof readUserBalances>>),
        readUserBalances(userId, 'trading').catch(() => [] as Awaited<ReturnType<typeof readUserBalances>>),
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
          const bal = (parseFloat(r.available_balance || '0') + parseFloat(r.locked_balance || '0')).toString();
          const cur = parseFloat(balancesByToken[sym][bucket]);
          balancesByToken[sym][bucket] = (cur + parseFloat(bal)).toString();
          const f = parseFloat(balancesByToken[sym].funding);
          const t = parseFloat(balancesByToken[sym].trading);
          balancesByToken[sym].total = (f + t).toString();
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
  app.get('/withdrawal-limits', {
    preHandler: [app.authenticate]
  }, async (request: FastifyRequest<{
    Querystring: { symbol?: string }
  }>, reply: FastifyReply) => {
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
      const dailyLimit = parseFloat(user?.daily_withdrawal_limit || '1000000');
      const monthlyLimit = parseFloat(user?.monthly_withdrawal_limit || '10000000');

      // Get today's withdrawals
      const todayResult = await db.query<{ total: string }>(`
        SELECT COALESCE(SUM(w.amount), 0) as total
        FROM withdrawals w
        JOIN tokens t ON w.token_id = t.id
        WHERE w.user_id = $1 
          AND w.status IN ('pending', 'processing', 'completed')
          AND w.created_at >= CURRENT_DATE
      `, [userId]);

      // Get this month's withdrawals
      const monthResult = await db.query<{ total: string }>(`
        SELECT COALESCE(SUM(w.amount), 0) as total
        FROM withdrawals w
        JOIN tokens t ON w.token_id = t.id
        WHERE w.user_id = $1 
          AND w.status IN ('pending', 'processing', 'completed')
          AND w.created_at >= DATE_TRUNC('month', CURRENT_DATE)
      `, [userId]);

      const todayUsed = parseFloat(todayResult.rows[0]?.total || '0');
      const monthUsed = parseFloat(monthResult.rows[0]?.total || '0');

      return {
        success: true,
        data: {
          daily: {
            limit: dailyLimit,
            used: todayUsed,
            remaining: Math.max(0, dailyLimit - todayUsed),
            percentage: (todayUsed / dailyLimit) * 100
          },
          monthly: {
            limit: monthlyLimit,
            used: monthUsed,
            remaining: Math.max(0, monthlyLimit - monthUsed),
            percentage: (monthUsed / monthlyLimit) * 100
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

  // Get withdrawal fee for a specific token and chain
  app.get('/withdrawal-fee/:symbol/:chainId', async (request: FastifyRequest<{
    Params: { symbol: string; chainId: string }
  }>, reply: FastifyReply) => {
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

      const token = result.rows[0];

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
  app.get('/withdraw/preview', {
    preHandler: [app.authenticate]
  }, async (request: FastifyRequest<{
    Querystring: { symbol: string; chainId?: string; amount: string; type?: 'onchain' | 'internal' }
  }>, reply: FastifyReply) => {
    try {
      const { symbol, chainId, amount: amountStr, type = 'onchain' } = request.query;
      const amount = parseFloat(amountStr || '0');
      if (!symbol || isNaN(amount) || amount < 0) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_INPUT', message: 'symbol and amount required' }
        });
      }
      if (type === 'internal') {
        return reply.send({
          success: true,
          data: { fee: '0', net_amount: amountStr, min_withdrawal: '0', fee_exceeds_amount: false }
        });
      }
      if (!chainId) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_INPUT', message: 'chainId required for on-chain preview' }
        });
      }
      const result = await db.query(`
        SELECT t.withdrawal_fee, t.min_withdrawal
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
      const row = result.rows[0];
      const fee = parseFloat(row.withdrawal_fee || '0');
      const netAmount = Math.max(0, amount - fee);
      const feeExceedsAmount = amount > 0 && fee >= amount;
      return reply.send({
        success: true,
        data: {
          fee: fee.toString(),
          net_amount: netAmount.toString(),
          min_withdrawal: row.min_withdrawal || '0',
          fee_exceeds_amount: feeExceedsAmount
        }
      });
    } catch (error) {
      logger.error('Withdraw preview failed', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to get preview' }
      });
    }
  });

  // Create withdrawal request (authenticated)
  // type: 'onchain' | 'internal'. Internal: use internal_user_identifier (email/uid/phone); no toAddress. On-chain: toAddress required.
  app.post('/withdrawals', {
    preHandler: [app.authenticate]
  }, async (request: FastifyRequest<{
    Body: {
      symbol: string;
      chainId?: string;
      amount: string;
      toAddress?: string;
      accountType?: string;
      memo?: string;
      twoFactorCode?: string;
      withdrawalAddressId?: string;
      type?: 'onchain' | 'internal';
      internal_user_identifier?: string;
    }
  }>, reply: FastifyReply) => {
    try {
      const userId = request.user!.id;
      const withdrawType = (request.body.type ?? 'onchain') as 'onchain' | 'internal';
      let { symbol, chainId, amount, toAddress, accountType = 'funding', memo, twoFactorCode, withdrawalAddressId, internal_user_identifier } = request.body;
      const allowedWithdrawalAccounts = ['funding', 'spot', 'trading'];
      if (!allowedWithdrawalAccounts.includes(accountType)) {
        accountType = 'funding';
      }

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

      const withdrawAmount = parseFloat(amount);
      if (isNaN(withdrawAmount) || withdrawAmount <= 0) {
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
          token = tokenResult.rows[0];
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
        const fee = 0;
        const minWithdrawal = parseFloat(token.min_withdrawal ?? '0');
        const maxWithdrawalRaw = token.max_withdrawal != null ? parseFloat(String(token.max_withdrawal)) : null;
        if (minWithdrawal > 0 && withdrawAmount < minWithdrawal) {
          return reply.status(400).send({
            success: false,
            error: { code: 'BELOW_MINIMUM', message: `Minimum is ${minWithdrawal} ${symbol}` }
          });
        }
        if (maxWithdrawalRaw != null && withdrawAmount > maxWithdrawalRaw) {
          return reply.status(400).send({
            success: false,
            error: { code: 'ABOVE_MAXIMUM', message: `Maximum withdrawal is ${maxWithdrawalRaw} ${symbol}` }
          });
        }
        logger.info('[WITHDRAW_LIMIT]', {
          symbol: token.symbol,
          min_withdrawal: minWithdrawal,
          max_withdrawal: maxWithdrawalRaw ?? 'unlimited',
          amount: withdrawAmount,
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
          (sum, r) => sum + parseFloat(r.available_balance || '0'),
          0
        );
        const epsilon = 1e-8;
        if (availableBalance < withdrawAmount - epsilon) {
          logger.warn('Internal transfer insufficient balance', {
            userId,
            currencyId,
            symbol: token.symbol,
            availableBalance,
            withdrawAmount,
            byAccountRows: balanceRows.rows.length,
          });
          return reply.status(400).send({
            success: false,
            error: { code: 'INSUFFICIENT_BALANCE', message: 'Insufficient balance' }
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
              type, internal_user_id, email_verified, two_fa_verified
            ) VALUES ($1, $2, $3, $4, $5, $6, NULL, 'completed', 'funding', 'internal', $7, FALSE, FALSE)
            RETURNING id, created_at
          `, [userId, token.token_id, token.chain_id, withdrawAmount.toString(), fee.toString(), withdrawAmount.toString(), recipientId]);
          const w = ins.rows[0]!;
          const senderUpd = await client.query(`
            UPDATE user_balances
            SET available_balance = available_balance - $1::numeric, updated_at = NOW()
            WHERE id = (
              SELECT id FROM user_balances
              WHERE user_id = $2 AND currency_id = $3 AND COALESCE(chain_id, '') = $4
                AND COALESCE(account_type::text, 'funding') IN ('funding', 'spot')
                AND available_balance >= $1::numeric
              ORDER BY available_balance DESC NULLS LAST
              LIMIT 1
            )
          `, [withdrawAmount.toString(), userId, currencyId, CHAIN_ID_GLOBAL]);
          assertUserBalanceUpdated('internal_transfer_debit', senderUpd, userId, currencyId, 'funding', CHAIN_ID_GLOBAL);
          const receiverUpd = await client.query(`
            UPDATE user_balances SET available_balance = available_balance + $1::numeric, updated_at = NOW()
            WHERE user_id = $2 AND currency_id = $3 AND COALESCE(chain_id, '') = $4 AND COALESCE(account_type::text, 'funding') = 'funding'
          `, [withdrawAmount.toString(), recipientId, currencyId, CHAIN_ID_GLOBAL]);
          assertUserBalanceUpdated('internal_transfer_credit', receiverUpd, recipientId, currencyId, 'funding', CHAIN_ID_GLOBAL);
          // Create history in same transaction so it never happens without balance update (Binance-style)
          await client.query(
            `INSERT INTO internal_transfers (from_user_id, to_user_id, currency_id, amount, transfer_type, status, notes)
             VALUES ($1, $2, $3, $4::numeric, 'user_to_user', 'completed', $5)`,
            [userId, recipientId, currencyId, withdrawAmount.toString(), `Internal transfer to recipient`]
          );
          return w;
        });
        await logWithdrawalLifecycle('withdrawal_internal_completed', {
          withdrawal_id: withdrawalInternal.id,
          user_id: userId,
          admin_id: null,
          token_id: token.token_id,
          chain_id: token.chain_id,
          amount: withdrawAmount.toString(),
          ip: request.ip ?? undefined,
          user_agent: request.headers['user-agent'] ?? undefined,
        });
        auditLog('withdrawal_internal_completed', userId, {
          withdrawalId: withdrawalInternal.id,
          symbol,
          amount: withdrawAmount,
          recipientId,
        });
        return reply.send({
          success: true,
          data: {
            id: withdrawalInternal.id,
            symbol,
            chain: token.chain_name,
            amount: withdrawAmount,
            fee: 0,
            netAmount: withdrawAmount,
            toAddress: null,
            type: 'internal',
            status: 'completed',
            createdAt: withdrawalInternal.created_at,
          },
        });
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

      const token = tokenResult.rows[0];
      const rawFee = token.withdrawal_fee;
      if (rawFee == null || rawFee === '') {
        logger.warn('tokens.withdrawal_fee is NULL or empty, defaulting to 0', {
          symbol: token.symbol,
          chain_id: token.chain_id,
        });
      }
      const fee = parseFloat(rawFee || '0');
      const minWithdrawal = parseFloat(token.min_withdrawal ?? '0');
      const maxWithdrawalRaw = token.max_withdrawal != null ? parseFloat(String(token.max_withdrawal)) : null;

      // Token-driven validation: min only if > 0, max only if NOT NULL
      if (minWithdrawal > 0 && withdrawAmount < minWithdrawal) {
        logger.warn('Withdrawal creation failed: BELOW_MINIMUM', {
          user_id: userId,
          chain_id: token.chain_id,
          symbol: token.symbol,
          amount: withdrawAmount,
          min_withdrawal: minWithdrawal,
          max_withdrawal: maxWithdrawalRaw ?? 'unlimited',
        });
        return reply.status(400).send({
          success: false,
          error: { code: 'BELOW_MINIMUM', message: `Minimum withdrawal is ${minWithdrawal} ${symbol}` }
        });
      }
      if (maxWithdrawalRaw != null && withdrawAmount > maxWithdrawalRaw) {
        logger.warn('Withdrawal creation failed: ABOVE_MAXIMUM', {
          user_id: userId,
          chain_id: token.chain_id,
          symbol: token.symbol,
          amount: withdrawAmount,
          max_withdrawal: maxWithdrawalRaw,
        });
        return reply.status(400).send({
          success: false,
          error: { code: 'ABOVE_MAXIMUM', message: `Maximum withdrawal is ${maxWithdrawalRaw} ${symbol}` }
        });
      }

      logger.info('[WITHDRAW_LIMIT]', {
        symbol: token.symbol,
        min_withdrawal: minWithdrawal,
        max_withdrawal: maxWithdrawalRaw ?? 'unlimited',
        amount: withdrawAmount,
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
      const availableBalance = withdrawRow ? parseFloat(withdrawRow.available_balance || '0') : 0;
      const totalRequired = withdrawAmount + fee;
      const netAmount = withdrawAmount - fee;

      if (netAmount <= 0) {
        logger.warn('Withdrawal creation failed: NET_AMOUNT_INVALID (amount - fee <= 0)', {
          user_id: userId,
          chain_id: token.chain_id,
          currency_id: currencyId,
          amount: withdrawAmount,
          fee,
          net_amount: netAmount,
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
        available_balance: availableBalance,
        amount: withdrawAmount,
        fee,
        totalRequired,
        account_type: accountType,
      };

      if (availableBalance < totalRequired) {
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

      const dailyLimit = parseFloat(userLimitResult.rows[0]?.daily_withdrawal_limit || '1000000');
      const todayUsed = parseFloat(todayResult.rows[0]?.total || '0');

      if (todayUsed + withdrawAmount > dailyLimit) {
        logger.warn('Withdrawal creation failed: LIMIT_EXCEEDED', withdrawalLogContext);
        return reply.status(400).send({
          success: false,
          error: { code: 'LIMIT_EXCEEDED', message: 'Daily withdrawal limit exceeded' }
        });
      }

      // Withdrawal security: 2FA and whitelist (user must satisfy all enabled settings)
      const { verifyUser2FA, userHas2FA } = await import('../lib/totp-verify.js');
      const has2FA = await userHas2FA(userId);
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

      // Admin approval: required if amount > threshold OR asset is high-risk
      const { requiresWithdrawalApproval } = await import('../services/withdrawal-approval.service.js');
      const needsApproval = requiresWithdrawalApproval(withdrawAmount, {
        is_high_risk: token.is_high_risk,
      });
      const initialStatus = needsApproval ? 'pending_approval' : 'pending';

      // Create withdrawal record (on-chain). Stores amount, fee, net_amount; balance lock uses amount + fee.
      const withdrawalResult = await db.query(`
        INSERT INTO withdrawals (
          user_id, token_id, chain_id, amount, fee, net_amount, to_address, memo, status, account_type,
          type, email_verified, two_fa_verified, withdrawal_address_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'onchain', FALSE, $11, $12)
        RETURNING id, created_at
      `, [userId, token.token_id, token.chain_id, withdrawAmount.toString(), fee.toString(), netAmount.toString(), toAddress!, memo || null, initialStatus, accountType, twoFaVerified, withdrawalAddressIdRes]);

      const withdrawal = withdrawalResult.rows[0];

      const chainIdForLock = token.chain_id ?? CHAIN_ID_GLOBAL;
      let updatedChainId = chainIdForLock;
      try {
        await ensureUserBalanceRow(userId, currencyId, chainIdForLock, accountType);
        let upd = await db.query(`
          UPDATE user_balances
          SET
            available_balance = available_balance - $1::numeric,
            locked_balance = locked_balance + $1::numeric,
            updated_at = NOW()
          WHERE user_id = $2 AND currency_id = $3 AND COALESCE(chain_id, '') = $4 AND account_type = $5
            AND available_balance >= $1::numeric
        `, [totalRequired.toString(), userId, currencyId, chainIdForLock, accountType]);
        if (upd.rowCount === 0 && chainIdForLock !== CHAIN_ID_GLOBAL) {
          await ensureUserBalanceRow(userId, currencyId, CHAIN_ID_GLOBAL, accountType);
          upd = await db.query(`
            UPDATE user_balances
            SET
              available_balance = available_balance - $1::numeric,
              locked_balance = locked_balance + $1::numeric,
              updated_at = NOW()
            WHERE user_id = $2 AND currency_id = $3 AND COALESCE(chain_id, '') = $4 AND account_type = $5
              AND available_balance >= $1::numeric
          `, [totalRequired.toString(), userId, currencyId, CHAIN_ID_GLOBAL, accountType]);
          updatedChainId = CHAIN_ID_GLOBAL;
        }
        if (upd.rowCount === 0) {
          logger.error('Withdrawal creation failed: BALANCE_ROW_NOT_FOUND_OR_MISMATCH', withdrawalLogContext);
          await db.query(`DELETE FROM withdrawals WHERE id = $1`, [withdrawal.id]);
          return reply.status(400).send({
            success: false,
            error: {
              code: 'BALANCE_ROW_NOT_FOUND_OR_MISMATCH',
              message: 'No matching balance row with sufficient available balance. Check user_balances for (user, currency, chain, account_type).',
            },
          });
        }
        assertUserBalanceUpdated('withdrawal_lock', upd, userId, currencyId, accountType, updatedChainId);
      } catch (err) {
        await db.query(`DELETE FROM withdrawals WHERE id = $1`, [withdrawal.id]);
        logger.error('Withdrawal creation failed: BALANCE_LOCK_FAILED', {
          ...withdrawalLogContext,
          error: err instanceof Error ? err.message : String(err),
        });
        return reply.status(500).send({
          success: false,
          error: {
            code: 'BALANCE_LOCK_FAILED',
            message: err instanceof Error ? err.message : 'Balance lock failed',
          },
        });
      }

      // Log activity
      auditLog('withdrawal_request', userId, {
        withdrawalId: withdrawal.id,
        symbol,
        chain: token.chain_name,
        amount: withdrawAmount,
        fee,
        toAddress,
        status: initialStatus,
      });

      await logWithdrawalLifecycle('withdrawal_created', {
        withdrawal_id: withdrawal.id,
        user_id: userId,
        admin_id: null,
        token_id: token.token_id,
        chain_id: token.chain_id,
        amount: withdrawAmount.toString(),
        ip: request.ip ?? undefined,
        user_agent: request.headers['user-agent'] ?? undefined,
      });

      logger.info('Withdrawal request created', {
        userId,
        withdrawalId: withdrawal.id,
        symbol,
        amount: withdrawAmount,
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

      return {
        success: true,
        data: {
          id: withdrawal.id,
          type: 'onchain',
          symbol,
          chain: token.chain_name,
          amount: withdrawAmount,
          fee,
          netAmount,
          toAddress,
          status: initialStatus,
          createdAt: withdrawal.created_at,
          ...(enqueueCode && { enqueueCode, enqueueReason }),
        }
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('Withdrawal creation failed: unhandled error', {
        user_id: request.user?.id,
        error: err.message,
        stack: err.stack,
      });
      const code = (err as { code?: string }).code;
      const message = code === 'INSUFFICIENT_BALANCE' ? 'Insufficient balance'
        : code === 'BALANCE_LOCK_FAILED' ? 'Balance lock failed'
        : code === 'BALANCE_ROW_NOT_FOUND_OR_MISMATCH' ? 'No matching balance row'
        : err.message || 'Failed to create withdrawal';
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
  app.post('/withdrawals/:id/cancel', {
    preHandler: [app.authenticate]
  }, async (request: FastifyRequest<{
    Params: { id: string }
  }>, reply: FastifyReply) => {
    try {
      const userId = request.user!.id;
      const { id } = request.params;

      // Get withdrawal
      const withdrawalResult = await db.query(`
        SELECT w.*, t.symbol
        FROM withdrawals w
        JOIN tokens t ON w.token_id = t.id
        WHERE w.id = $1 AND w.user_id = $2
      `, [id, userId]);

      if (withdrawalResult.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Withdrawal not found' }
        });
      }

      const withdrawal = withdrawalResult.rows[0];

      if (withdrawal.status !== 'pending') {
        return reply.status(400).send({
          success: false,
          error: { code: 'CANNOT_CANCEL', message: 'Only pending withdrawals can be cancelled' }
        });
      }

      // Update withdrawal status
      await db.query(`
        UPDATE withdrawals SET status = 'cancelled', processed_at = NOW()
        WHERE id = $1
      `, [id]);

      // Refund to user_balances (single source of truth)
      const totalLocked = parseFloat(withdrawal.amount) + parseFloat(withdrawal.fee);
      const currencyId = await getCurrencyIdBySymbol(withdrawal.symbol);
      const cancelAccountType = withdrawal.account_type || 'spot';
      const chainIdCancel = withdrawal.chain_id ?? CHAIN_ID_GLOBAL;
      if (currencyId) {
        await ensureUserBalanceRow(userId, currencyId, chainIdCancel, cancelAccountType);
        const cancelUpd = await db.query(`
          UPDATE user_balances
          SET
            available_balance = available_balance + $1,
            locked_balance = locked_balance - $1,
            updated_at = NOW()
          WHERE user_id = $2 AND currency_id = $3 AND COALESCE(chain_id, '') = $4 AND account_type = $5
        `, [totalLocked.toString(), userId, currencyId, chainIdCancel, cancelAccountType]);
        assertUserBalanceUpdated('withdrawal_cancel', cancelUpd, userId, currencyId, cancelAccountType, withdrawal.chain_id);
      }

      auditLog('withdrawal_cancelled', userId, {
        withdrawalId: id,
        symbol: withdrawal.symbol,
        amount: withdrawal.amount
      });

      return {
        success: true,
        message: 'Withdrawal cancelled successfully'
      };
    } catch (error) {
      logger.error('Failed to cancel withdrawal', { 
        error: error instanceof Error ? error.message : 'Unknown',
        userId: request.user?.id 
      });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to cancel withdrawal' }
      });
    }
  });

  // ============================================
  // ASSETS OVERVIEW ENDPOINTS
  // ============================================
  // Balance read: always use readUserBalances; total USD = sum(amount * price) per currency. See docs/BALANCE_AND_DEPOSIT_RULES.md

  // Get balances summary for assets overview (authenticated). Uses canonical readUserBalances only.
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
      const [fundingRows, spotRows, tradingRows, pricesResult] = await Promise.all([
        readUserBalances(userId, 'funding'),
        readUserBalances(userId, 'spot').catch(() => [] as Awaited<ReturnType<typeof readUserBalances>>),
        readUserBalances(userId, 'trading').catch(() => [] as Awaited<ReturnType<typeof readUserBalances>>),
        db.query<{ symbol: string; usd_price: string }>(pricesSql).catch(() => ({ rows: [] })),
      ]);
      const priceMap: Record<string, number> = { USDT: 1, USDC: 1, DAI: 1, BUSD: 1 };
      pricesResult.rows.forEach(row => {
        priceMap[row.symbol.toUpperCase()] = parseFloat(row.usd_price) || 1;
      });
      const toUsd = (rows: { symbol: string; available_balance: string; locked_balance: string }[]) =>
        rows.reduce((t, r) => {
          const q = parseFloat(r.available_balance || '0') + parseFloat(r.locked_balance || '0');
          const price = priceMap[r.symbol?.toUpperCase()] ?? 1;
          return t + q * price;
        }, 0);
      let fundingRowsForTotal = fundingRows;
      let spotRowsForTotal = spotRows;
      if (fundingRows.length === 0 && spotRows.length === 0) {
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
        spotRowsForTotal = [];
      }
      const fundingTotal = toUsd(fundingRowsForTotal) + toUsd(spotRowsForTotal);
      const tradingTotal = toUsd(tradingRows);
      const btcPrice = 82000;
      return reply.send({
        success: true,
        data: {
          funding: {
            type: 'funding',
            totalUsd: fundingTotal,
            totalBtc: fundingTotal / btcPrice
          },
          trading: {
            type: 'trading',
            totalUsd: tradingTotal,
            totalBtc: tradingTotal / btcPrice
          },
          total: {
            totalUsd: fundingTotal + tradingTotal,
            totalBtc: (fundingTotal + tradingTotal) / btcPrice
          }
        }
      });
    } catch (error) {
      logger.error('Failed to get balances summary', {
        error: error instanceof Error ? error.message : 'Unknown',
        userId: request.user?.id
      });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to get balances summary' }
      });
    }
  });

  // Get funding account balances (authenticated). Uses canonical readUserBalances only.
  app.get('/balances/funding', {
    preHandler: [app.authenticate]
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user!.id;
      const btcPrice = 97500;
      const priceMap: Record<string, number> = { 'USDT': 1, 'USDC': 1 };

      // Repair: batch-credit completed deposits that were never applied (one tx per user)
      try {
        const hasColumn = await db.query(
          `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'deposits' AND column_name = 'balance_applied_at'`
        );
        if (hasColumn.rows.length > 0) {
          const unapplied = await db.query<{ id: string; user_id: string; currency_id: string; amount: string }>(
            `SELECT id, user_id, currency_id, amount::text as amount FROM deposits
             WHERE user_id = $1 AND status = 'completed' AND credited_at IS NOT NULL AND balance_applied_at IS NULL
             AND (amount IS NULL OR amount::numeric > 0)`,
            [userId]
          );
          if (unapplied.rows.length > 0) {
            const currencyIds = [...new Set(unapplied.rows.map((r) => r.currency_id))];
            const curCheck = await db.query(`SELECT id FROM currencies WHERE id = ANY($1::uuid[])`, [currencyIds]);
            const validIds = new Set(curCheck.rows.map((r: { id: string }) => r.id));
            const toApply = unapplied.rows.filter((r) => validIds.has(r.currency_id));
            if (toApply.length > 0) {
              await db.transaction(async (client) => {
                const byCurrency = new Map<string, { total: number; ids: string[] }>();
                for (const row of toApply) {
                  const amt = parseFloat(row.amount || '0');
                  const cur = byCurrency.get(row.currency_id) ?? { total: 0, ids: [] };
                  cur.total += amt;
                  cur.ids.push(row.id);
                  byCurrency.set(row.currency_id, cur);
                }
                for (const [currencyId, { total, ids }] of byCurrency) {
                  if (total <= 0) continue;
                  await ensureUserBalanceRow(userId, currencyId, CHAIN_ID_GLOBAL, 'funding', client);
                  const upd = await client.query(
                    `UPDATE user_balances SET available_balance = available_balance + $1::numeric, total_deposited = COALESCE(total_deposited, 0) + $1::numeric, updated_at = NOW()
                     WHERE user_id = $2 AND currency_id = $3 AND COALESCE(chain_id, '') = $4 AND account_type = 'funding'`,
                    [total.toString(), userId, currencyId, CHAIN_ID_GLOBAL]
                  );
                  if ((upd.rowCount ?? 0) >= 1) {
                    await client.query(`UPDATE deposits SET balance_applied_at = NOW() WHERE id = ANY($1::uuid[])`, [ids]);
                  }
                }
              });
              logger.info('Repair: credited completed deposits to user_balances', { userId, count: toApply.length });
            }
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
        readUserBalances(userId, 'funding'),
        readUserBalances(userId, 'spot').catch(() => [] as Awaited<ReturnType<typeof readUserBalances>>),
        db.query<{ symbol: string; usd_price: string }>(pricesSql).catch(() => ({ rows: [] })),
        db.query<{ id: string; symbol: string; name: string }>(namesSql),
      ]);
      let spotRows = spotRowsResult;
      let fundingRowsFinal = fundingRows;

      // Fallback: if canonical read returned nothing, read directly from user_balances (funding/spot) so balance is never hidden
      if (fundingRows.length === 0 && spotRows.length === 0) {
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
      }

      pricesResult.rows.forEach(row => {
        priceMap[row.symbol.toUpperCase()] = parseFloat(row.usd_price) || 1;
      });
      const nameByCurrencyId: Record<string, string> = {};
      namesResult.rows.forEach(row => {
        nameByCurrencyId[row.id] = row.name || row.symbol;
      });

      const byCurrency: Record<string, { symbol: string; available: number; locked: number }> = {};
      for (const r of fundingRowsFinal) {
        const av = parseFloat(r.available_balance || '0');
        const lk = parseFloat(r.locked_balance || '0');
        if (!byCurrency[r.currency_id]) {
          byCurrency[r.currency_id] = { symbol: r.symbol, available: 0, locked: 0 };
        }
        byCurrency[r.currency_id].available += av;
        byCurrency[r.currency_id].locked += lk;
      }
      for (const r of spotRows) {
        if (!byCurrency[r.currency_id]) {
          byCurrency[r.currency_id] = { symbol: r.symbol, available: 0, locked: 0 };
        }
        byCurrency[r.currency_id].available += parseFloat(r.available_balance || '0');
        byCurrency[r.currency_id].locked += parseFloat(r.locked_balance || '0');
      }

      const balances = Object.entries(byCurrency).map(([currency_id, agg]) => {
        const total = agg.available + agg.locked;
        const price = priceMap[agg.symbol.toUpperCase()] || 1;
        const usdValue = total * price;
        return {
          token_id: currency_id,
          symbol: agg.symbol,
          name: nameByCurrencyId[currency_id] ?? agg.symbol,
          total_balance: total.toFixed(8),
          available_balance: agg.available.toFixed(8),
          locked_balance: agg.locked.toFixed(8),
          btc_value: (usdValue / btcPrice).toFixed(8),
          usd_value: usdValue.toFixed(2)
        };
      });

      balances.sort((a, b) => {
        const aHasBalance = parseFloat(a.total_balance) > 0;
        const bHasBalance = parseFloat(b.total_balance) > 0;
        if (aHasBalance && !bHasBalance) return -1;
        if (!aHasBalance && bHasBalance) return 1;
        return a.symbol.localeCompare(b.symbol);
      });

      const totalUsd = balances.reduce((sum, b) => sum + parseFloat(b.usd_value), 0);
      const availableUsd = balances.reduce((sum, b) => {
        const price = priceMap[b.symbol.toUpperCase()] || 1;
        return sum + parseFloat(b.available_balance) * price;
      }, 0);
      const lockedUsd = balances.reduce((sum, b) => {
        const price = priceMap[b.symbol.toUpperCase()] || 1;
        return sum + parseFloat(b.locked_balance) * price;
      }, 0);

      return reply.send({
        success: true,
        data: {
          balances,
          totalEquity: { usd: totalUsd, btc: totalUsd / btcPrice },
          availableBalance: { usd: availableUsd, btc: availableUsd / btcPrice },
          inUse: { usd: lockedUsd, btc: lockedUsd / btcPrice }
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
  app.get('/balances/trading', {
    preHandler: [app.authenticate]
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user!.id;
      let tradingRows: Awaited<ReturnType<typeof readUserBalances>>;
      try {
        tradingRows = await readUserBalances(userId, 'trading');
      } catch {
        tradingRows = [];
      }
      const byCurrency: Record<string, { symbol: string; equity: number }> = {};
      for (const r of tradingRows) {
        byCurrency[r.currency_id] = {
          symbol: r.symbol,
          equity: parseFloat(r.available_balance || '0') + parseFloat(r.locked_balance || '0')
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
        equity: agg.equity.toFixed(8),
        wallet_balance: agg.equity.toFixed(8),
        borrowed_amount: '0',
        used_as_collateral: '0',
        usd_value: agg.equity.toFixed(8)
      }));
      balances.sort((a, b) => parseFloat(b.equity) - parseFloat(a.equity));
      const totalEquity = balances.reduce((sum, b) => sum + parseFloat(b.equity), 0);

      return {
        success: true,
        data: {
          balances,
          totalEquity: { usd: totalEquity },
          marginBalance: { usd: totalEquity },
          unrealizedPnl: { usd: 0 },
          marginInfo: { im: 0, imUsd: 0, mm: 0, mmUsd: 0 }
        }
      };
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
  app.get('/transfer/balances', {
    preHandler: [app.authenticate]
  }, async (request: FastifyRequest<{
    Querystring: { from?: string; to?: string }
  }>, reply: FastifyReply) => {
    try {
      const userId = request.user!.id;
      const fromAccount = request.query.from || 'funding';
      const allowedFrom = ['funding', 'spot', 'trading'];
      const account = allowedFrom.includes(fromAccount) ? fromAccount : 'funding';
      let rows: Awaited<ReturnType<typeof readUserBalances>>;
      try {
        rows = await readUserBalances(userId, account);
      } catch {
        rows = [];
      }
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
      const byId = Object.fromEntries(currenciesResult.rows.map(r => [r.id, r]));
      const data = rows.map(r => {
        const cur = byId[r.currency_id];
        const available = (parseFloat(r.available_balance || '0') + parseFloat(r.locked_balance || '0')).toString();
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
      data.sort((a, b) => parseFloat(b.availableBalance) - parseFloat(a.availableBalance));
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
  app.post('/transfer', {
    preHandler: [app.authenticate]
  }, async (request: FastifyRequest<{
    Body: {
      fromAccount: string;
      toAccount: string;
      tokenId: string;
      amount: string;
    }
  }>, reply: FastifyReply) => {
    try {
      const userId = request.user!.id;
      const { fromAccount, toAccount, tokenId, amount } = request.body;

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

      const transferAmount = parseFloat(amount);
      if (isNaN(transferAmount) || transferAmount <= 0) {
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

      const token = tokenResult.rows[0];
      const currencyId = await getCurrencyIdBySymbol(token.symbol);
      if (!currencyId) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_TOKEN', message: 'Currency not found for token' }
        });
      }

      // Check available balance in SOURCE account only (canonical readUserBalances).
      let sourceBalances: Awaited<ReturnType<typeof readUserBalances>>;
      try {
        sourceBalances = await readUserBalances(userId, fromAccount);
      } catch {
        return reply.status(400).send({
          success: false,
          error: { code: 'NO_BALANCE_FOR_ACCOUNT', message: 'No balance for this account type. Use funding if you have no spot/trading rows.' }
        });
      }
      const sourceRow = sourceBalances.find(r => r.currency_id === currencyId);
      const availableBalance = sourceRow ? parseFloat(sourceRow.available_balance || '0') : 0;

      if (availableBalance < transferAmount) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INSUFFICIENT_BALANCE', message: 'Insufficient balance for transfer' }
        });
      }

      const amountStr = transferAmount.toString();

      // Debit fromAccount, credit toAccount in user_balances (transaction; abort if debit fails)
      await db.transaction(async (client) => {
        await walletService.debitAvailableBalance(userId, currencyId, fromAccount, amountStr, client);
        await walletService.creditBalanceForAccount(userId, currencyId, toAccount, amountStr, client);
      });

      auditLog(userId, 'internal_transfer', {
        fromAccount,
        toAccount,
        tokenId,
        symbol: token.symbol,
        amount: transferAmount
      });

      try {
        await db.query(`
          INSERT INTO internal_transfers (from_user_id, to_user_id, currency_id, amount, transfer_type, status, notes)
          VALUES ($1, $1, $2, $3, 'internal', 'completed', $4)
        `, [userId, currencyId, transferAmount, `Transfer from ${fromAccount} to ${toAccount}`]);
      } catch {
        logger.debug('internal_transfers table not available, skipping record');
      }

      logger.info('Internal transfer completed', {
        userId,
        fromAccount,
        toAccount,
        symbol: token.symbol,
        amount: transferAmount
      });

      return {
        success: true,
        message: `Successfully transferred ${transferAmount} ${token.symbol} from ${fromAccount} to ${toAccount}`,
        data: {
          fromAccount,
          toAccount,
          symbol: token.symbol,
          amount: transferAmount
        }
      };
    } catch (error) {
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
  app.get('/transfer/history', {
    preHandler: [app.authenticate]
  }, async (request: FastifyRequest<{
    Querystring: { limit?: string; offset?: string }
  }>, reply: FastifyReply) => {
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

      if (!tableCheck.rows[0].exists) {
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
  app.get('/pnl', {
    preHandler: [app.authenticate]
  }, async (request: FastifyRequest<{
    Querystring: { period?: string; type?: string; symbol?: string }
  }>, reply: FastifyReply) => {
    try {
      const userId = request.user!.id;
      const period = request.query.period || '7D';
      const type = request.query.type || 'spot';
      const symbol = request.query.symbol || 'all';

      // Calculate date range
      const days = period === '7D' ? 7 : period === '30D' ? 30 : period === '60D' ? 60 : period === '90D' ? 90 : 180;
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      // Get trading history for P&L calculation
      const tradesResult = await db.query(`
        SELECT 
          t.symbol,
          SUM(CASE WHEN o.side = 'buy' THEN o.filled_amount * o.price ELSE 0 END) as buy_value,
          SUM(CASE WHEN o.side = 'sell' THEN o.filled_amount * o.price ELSE 0 END) as sell_value
        FROM orders o
        JOIN tokens t ON o.token_id = t.id
        WHERE o.user_id = $1 
          AND o.status = 'filled'
          AND o.created_at >= $2
          ${symbol !== 'all' ? 'AND UPPER(t.symbol) = UPPER($3)' : ''}
        GROUP BY t.symbol
        ORDER BY (sell_value - buy_value) DESC
      `, symbol !== 'all' ? [userId, startDate, symbol] : [userId, startDate]);

      const rankings = tradesResult.rows.map(row => ({
        symbol: row.symbol,
        pnl: parseFloat(row.sell_value || '0') - parseFloat(row.buy_value || '0'),
        pnlPercentage: 0
      }));

      const totalPnl = rankings.reduce((sum, r) => sum + r.pnl, 0);
      const totalFilledValue = tradesResult.rows.reduce((sum, r) => 
        sum + parseFloat(r.buy_value || '0') + parseFloat(r.sell_value || '0'), 0
      );

      // Generate chart data
      const chartData = [];
      for (let i = days - 1; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        chartData.push({
          date: date.toISOString().split('T')[0],
          value: 0
        });
      }

      return {
        success: true,
        data: {
          summary: { totalPnl, totalFilledValue },
          rankings,
          chartData
        }
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
  app.get('/deposit-history', {
    preHandler: [app.authenticate]
  }, async (request: FastifyRequest<{
    Querystring: { page?: string; limit?: string; status?: string }
  }>, reply: FastifyReply) => {
    try {
      const userId = request.user!.id;
      const page = parseInt(request.query.page || '1');
      const limit = Math.min(parseInt(request.query.limit || '20'), 100);
      const offset = (page - 1) * limit;
      const status = request.query.status;

      // Repair: complete any pending deposit (only if user_balances + currencies exist; skip rows with missing currency_id)
      const hasUserBalances = await db.query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'user_balances'`
      );
      if (hasUserBalances.rows.length > 0) {
        const overdue = await db.query(`
          SELECT id, user_id, currency_id, amount::numeric as amount
          FROM deposits
          WHERE user_id = $1 AND status = 'pending'
            AND confirmations >= COALESCE(required_confirmations, 25)
            AND (amount IS NULL OR amount::numeric > 0)
        `, [userId]).catch(() => ({ rows: [] }));
        for (const row of (overdue as { rows: { id: string; user_id: string; currency_id: string; amount: string | number }[] }).rows) {
          try {
            const cur = await db.query(`SELECT 1 FROM currencies WHERE id = $1`, [row.currency_id]);
            if (cur.rows.length === 0) {
              logger.warn('Repair deposit skipped: currency_id not in currencies', { depositId: row.id, currencyId: row.currency_id });
              continue;
            }
            await db.query('BEGIN');
          await db.query(
            `UPDATE deposits SET status = 'completed', credited_at = NOW(), updated_at = NOW() WHERE id = $1`,
            [row.id]
          );
          const amount = String(row.amount ?? 0);
          await ensureUserBalanceRow(row.user_id, row.currency_id, CHAIN_ID_GLOBAL, 'funding');
          const upd = await db.query(`
            UPDATE user_balances
            SET available_balance = available_balance + $1::numeric,
                pending_balance = GREATEST(pending_balance - $1::numeric, 0),
                total_deposited = COALESCE(total_deposited, 0) + $1::numeric,
                updated_at = NOW()
            WHERE user_id = $2 AND currency_id = $3 AND COALESCE(chain_id, '') = $4 AND account_type = 'funding'
          `, [amount, row.user_id, row.currency_id, CHAIN_ID_GLOBAL]);
          assertUserBalanceUpdated('deposit_credit_repair', upd, row.user_id, row.currency_id, 'funding', CHAIN_ID_GLOBAL);
          await db.query('COMMIT');
          logger.info('Deposit completed (overdue confirmations)', { depositId: row.id, userId: row.user_id });
        } catch (e) {
          await db.query('ROLLBACK');
          logger.warn('Repair deposit failed', { depositId: row.id, error: e });
        }
        }
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
  app.get('/transactions/all', {
    preHandler: [app.authenticate]
  }, async (request: FastifyRequest<{
    Querystring: { limit?: string; offset?: string; status?: string; coin?: string }
  }>, reply: FastifyReply) => {
    try {
      const userId = request.user!.id;
      const limit = parseInt(request.query.limit || '50');
      const offset = parseInt(request.query.offset || '0');
      const statusFilter = request.query.status?.toLowerCase();
      const coinFilter = request.query.coin?.toUpperCase();

      // Repair: only if user_balances exists; skip rows whose currency_id is not in currencies (avoids FK violation e.g. TRX)
      const hasUB = await db.query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'user_balances'`
      );
      if (hasUB.rows.length > 0) {
        const overdue2 = await db.query(`
          SELECT id, user_id, currency_id, amount::numeric as amount
          FROM deposits
          WHERE user_id = $1 AND status = 'pending'
            AND confirmations >= COALESCE(required_confirmations, 25)
            AND (amount IS NULL OR amount::numeric > 0)
        `, [userId]).catch(() => ({ rows: [] }));
        for (const row of (overdue2 as { rows: { id: string; user_id: string; currency_id: string; amount: string | number }[] }).rows) {
          try {
            const cur = await db.query(`SELECT 1 FROM currencies WHERE id = $1`, [row.currency_id]);
            if (cur.rows.length === 0) {
              logger.warn('Repair deposit skipped: currency_id not in currencies', { depositId: row.id, currencyId: row.currency_id });
              continue;
            }
            await db.query('BEGIN');
            await db.query(
              `UPDATE deposits SET status = 'completed', credited_at = NOW(), updated_at = NOW() WHERE id = $1`,
              [row.id]
            );
            const amount = String(row.amount ?? 0);
            await ensureUserBalanceRow(row.user_id, row.currency_id, CHAIN_ID_GLOBAL, 'funding');
            const upd = await db.query(`
              UPDATE user_balances
              SET available_balance = available_balance + $1::numeric,
                  pending_balance = GREATEST(pending_balance - $1::numeric, 0),
                  total_deposited = COALESCE(total_deposited, 0) + $1::numeric,
                  updated_at = NOW()
              WHERE user_id = $2 AND currency_id = $3 AND COALESCE(chain_id, '') = $4 AND account_type = 'funding'
            `, [amount, row.user_id, row.currency_id, CHAIN_ID_GLOBAL]);
            assertUserBalanceUpdated('deposit_credit_repair', upd, row.user_id, row.currency_id, 'funding', CHAIN_ID_GLOBAL);
            await db.query('COMMIT');
            logger.info('Deposit completed (overdue confirmations)', { depositId: row.id, userId: row.user_id });
          } catch (e) {
            await db.query('ROLLBACK');
            logger.warn('Repair deposit failed', { depositId: row.id, error: e });
          }
        }
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
        withdrawalsResult.rows.forEach((row: { id: string; symbol: string; logo_url: string | null; chain_name: string | null; amount: string; address: string | null; tx_hash: string | null; status: string; created_at: string; withdrawal_type?: string; internal_recipient_email?: string | null }) => {
          const isInternal = row.withdrawal_type === 'internal';
          const chainType = isInternal
            ? `Sent to ${row.internal_recipient_email || 'user'}`
            : (row.chain_name || 'Unknown');
          allTransactions.push({
            id: row.id,
            type: 'withdraw',
            coin: row.symbol || 'Unknown',
            coin_logo: row.logo_url || `/assets/upload/currency-logo/${(row.symbol || 'btc').toLowerCase()}.svg`,
            chain_type: chainType,
            quantity: row.amount,
            address: row.address || (isInternal ? (row.internal_recipient_email || '') : ''),
            txid: row.tx_hash || '',
            status: row.status,
            date_time: row.created_at
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

        if (tableCheck.rows[0].exists) {
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
          transfersResult.rows.forEach((row: { id: string; from_user_id: string; to_user_id: string; amount: string; status: string; created_at: string; symbol: string; logo_url: string | null; from_email: string | null; to_email: string | null }) => {
            const isOut = row.from_user_id === userId;
            const desc = isOut ? `Sent to ${row.to_email || 'user'}` : `Received from ${row.from_email || 'user'}`;
            allTransactions.push({
              id: row.id,
              type: 'transfer',
              coin: row.symbol || 'Unknown',
              coin_logo: row.logo_url || `/assets/upload/currency-logo/${(row.symbol || 'btc').toLowerCase()}.svg`,
              chain_type: desc,
              quantity: row.amount,
              address: isOut ? (row.to_email || '') : (row.from_email || ''),
              txid: '',
              status: row.status,
              date_time: row.created_at
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
  app.get('/deposit/:txHash', {
    preHandler: [app.authenticate]
  }, async (request: FastifyRequest<{
    Params: { txHash: string }
  }>, reply: FastifyReply) => {
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

      const deposit = result.rows[0];

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
