import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../lib/database.js';
import { redis } from '../lib/redis.js';
import { walletService } from '../services/wallet.service.js';
import { logger, auditLog } from '../lib/logger.js';
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

  // Get user balances (authenticated)
  app.get('/balances', {
    preHandler: [app.authenticate]
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user!.id;
      const balances = await walletService.getBalances(userId);

      return {
        success: true,
        data: balances
      };
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
          t.symbol, t.name as token_name, t.icon_url as logo_url,
          c.name as chain_name, c.native_currency as chain_type
        FROM withdrawals w
        LEFT JOIN tokens t ON w.token_id = t.id
        LEFT JOIN chains c ON w.chain_id = c.id
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

      // Map to consistent format
      const mappedData = result.rows.map(w => ({
        id: w.id,
        type: 'withdraw',
        coin: w.symbol || 'Unknown',
        coin_logo: w.logo_url || `/assets/upload/currency-logo/${(w.symbol || 'btc').toLowerCase()}.svg`,
        chain_type: w.chain_name || 'Unknown',
        quantity: w.amount,
        address: w.to_address || '',
        txid: w.tx_hash || '',
        status: w.status,
        date_time: w.created_at
      }));

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

  // Get user balances by account type (authenticated)
  app.get('/balances/by-account', {
    preHandler: [app.authenticate]
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user!.id;

      // Get balances grouped by account type
      const result = await db.query(`
        SELECT 
          b.token_id,
          t.symbol,
          t.name as token_name,
          b.account_type,
          b.available_balance,
          b.locked_balance,
          (b.available_balance + b.locked_balance) as total_balance
        FROM balances b
        JOIN tokens t ON b.token_id = t.id
        WHERE b.user_id = $1 AND (b.available_balance > 0 OR b.locked_balance > 0)
        ORDER BY t.symbol, b.account_type
      `, [userId]);

      // Group by token
      const balancesByToken: Record<string, {
        symbol: string;
        name: string;
        funding: string;
        trading: string;
        total: string;
      }> = {};

      for (const row of result.rows) {
        if (!balancesByToken[row.symbol]) {
          balancesByToken[row.symbol] = {
            symbol: row.symbol,
            name: row.token_name,
            funding: '0',
            trading: '0',
            total: '0'
          };
        }
        if (row.account_type === 'funding') {
          balancesByToken[row.symbol].funding = row.available_balance;
        } else if (row.account_type === 'trading' || row.account_type === 'unified') {
          balancesByToken[row.symbol].trading = row.available_balance;
        }
        balancesByToken[row.symbol].total = (
          parseFloat(balancesByToken[row.symbol].funding) + 
          parseFloat(balancesByToken[row.symbol].trading)
        ).toString();
      }

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
          AND (c.id::text = $2 OR LOWER(COALESCE(c.id_text, c.name)) = LOWER($2))
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

  // Create withdrawal request (authenticated)
  // Security: if user has 2FA or withdrawal whitelist enabled, those conditions must be satisfied before withdrawal is created.
  app.post('/withdrawals', {
    preHandler: [app.authenticate]
  }, async (request: FastifyRequest<{
    Body: {
      symbol: string;
      chainId: string;
      amount: string;
      toAddress: string;
      accountType?: string;
      memo?: string;
      twoFactorCode?: string;
      withdrawalAddressId?: string;
    }
  }>, reply: FastifyReply) => {
    try {
      const userId = request.user!.id;
      const { symbol, chainId, amount, toAddress, accountType = 'funding', memo, twoFactorCode, withdrawalAddressId } = request.body;

      // Validate input
      if (!symbol || !chainId || !amount || !toAddress) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_INPUT', message: 'Missing required fields' }
        });
      }

      const withdrawAmount = parseFloat(amount);
      if (isNaN(withdrawAmount) || withdrawAmount <= 0) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_AMOUNT', message: 'Invalid withdrawal amount' }
        });
      }

      // Get token and chain info
      const tokenResult = await db.query(`
        SELECT 
          t.id as token_id, t.symbol, t.decimals, t.withdrawal_fee, t.min_withdrawal,
          c.id as chain_id, c.name as chain_name, c.type as chain_type
        FROM tokens t
        JOIN chains c ON t.chain_id = c.id
        WHERE UPPER(t.symbol) = UPPER($1) 
          AND (c.id::text = $2 OR LOWER(COALESCE(c.id_text, c.name)) = LOWER($2))
          AND t.is_active = TRUE AND c.is_active = TRUE
        LIMIT 1
      `, [symbol, chainId]);

      if (tokenResult.rows.length === 0) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_TOKEN', message: 'Invalid token or chain' }
        });
      }

      const token = tokenResult.rows[0];
      const fee = parseFloat(token.withdrawal_fee || '0');
      const minWithdrawal = parseFloat(token.min_withdrawal || '0');

      // Check minimum withdrawal
      if (withdrawAmount < minWithdrawal) {
        return reply.status(400).send({
          success: false,
          error: { code: 'BELOW_MINIMUM', message: `Minimum withdrawal is ${minWithdrawal} ${symbol}` }
        });
      }

      // Check user balance
      const balanceResult = await db.query(`
        SELECT available_balance 
        FROM balances 
        WHERE user_id = $1 AND token_id = $2 AND account_type = $3
      `, [userId, token.token_id, accountType]);

      const availableBalance = parseFloat(balanceResult.rows[0]?.available_balance || '0');
      const totalRequired = withdrawAmount + fee;

      if (availableBalance < totalRequired) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INSUFFICIENT_BALANCE', message: 'Insufficient balance' }
        });
      }

      // Check withdrawal limits
      const todayResult = await db.query<{ total: string }>(`
        SELECT COALESCE(SUM(amount), 0) as total
        FROM withdrawals
        WHERE user_id = $1 
          AND status IN ('pending', 'processing', 'completed')
          AND created_at >= CURRENT_DATE
      `, [userId]);

      const userLimitResult = await db.query(`
        SELECT daily_withdrawal_limit FROM users WHERE id = $1
      `, [userId]);

      const dailyLimit = parseFloat(userLimitResult.rows[0]?.daily_withdrawal_limit || '1000000');
      const todayUsed = parseFloat(todayResult.rows[0]?.total || '0');

      if (todayUsed + withdrawAmount > dailyLimit) {
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
          return reply.status(400).send({
            success: false,
            error: { code: '2FA_REQUIRED', message: 'Two-factor code is required for withdrawal' }
          });
        }
        const valid2FA = await verifyUser2FA(userId, twoFactorCode.trim());
        if (!valid2FA) {
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
          return reply.status(400).send({
            success: false,
            error: { code: 'ADDRESS_NOT_WHITELISTED', message: 'This address is not in your withdrawal whitelist' }
          });
        }
        withdrawalAddressIdRes = addrCheck.rows[0]!.id;
      }

      const netAmount = withdrawAmount - fee;
      const twoFaVerified = has2FA;

      // Create withdrawal record
      const withdrawalResult = await db.query(`
        INSERT INTO withdrawals (
          user_id, token_id, chain_id, amount, fee, net_amount, to_address, memo, status, account_type,
          email_verified, two_fa_verified, withdrawal_address_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9, FALSE, $10, $11)
        RETURNING id, created_at
      `, [userId, token.token_id, token.chain_id, withdrawAmount.toString(), fee.toString(), netAmount.toString(), toAddress, memo || null, accountType, twoFaVerified, withdrawalAddressIdRes]);

      const withdrawal = withdrawalResult.rows[0];

      // Deduct from balance (lock the funds)
      await db.query(`
        UPDATE balances 
        SET 
          available_balance = available_balance - $1,
          locked_balance = locked_balance + $1,
          updated_at = NOW()
        WHERE user_id = $2 AND token_id = $3 AND account_type = $4
      `, [totalRequired.toString(), userId, token.token_id, accountType]);

      // Log activity
      auditLog('withdrawal_request', userId, {
        withdrawalId: withdrawal.id,
        symbol,
        chain: token.chain_name,
        amount: withdrawAmount,
        fee,
        toAddress
      });

      logger.info('Withdrawal request created', {
        userId,
        withdrawalId: withdrawal.id,
        symbol,
        amount: withdrawAmount
      });

      const { enqueueWithdrawal } = await import('../services/withdrawal-signing.service.js');
      const enqueueResult = await enqueueWithdrawal(withdrawal.id);
      if (!enqueueResult.enqueued && enqueueResult.reason) {
        logger.warn('Withdrawal not enqueued for signing', { withdrawalId: withdrawal.id, reason: enqueueResult.reason });
      }

      return {
        success: true,
        data: {
          id: withdrawal.id,
          symbol,
          chain: token.chain_name,
          amount: withdrawAmount,
          fee,
          netAmount: withdrawAmount - fee,
          toAddress,
          status: 'pending',
          createdAt: withdrawal.created_at
        }
      };
    } catch (error) {
      logger.error('Failed to create withdrawal', { 
        error: error instanceof Error ? error.message : 'Unknown',
        userId: request.user?.id 
      });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to create withdrawal' }
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

      // Refund to balance
      const totalLocked = parseFloat(withdrawal.amount) + parseFloat(withdrawal.fee);
      await db.query(`
        UPDATE balances 
        SET 
          available_balance = available_balance + $1,
          locked_balance = locked_balance - $1,
          updated_at = NOW()
        WHERE user_id = $2 AND token_id = $3 AND account_type = $4
      `, [totalLocked.toString(), userId, withdrawal.token_id, withdrawal.account_type || 'funding']);

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

  // Get balances summary for assets overview (authenticated)
  app.get('/balances/summary', {
    preHandler: [app.authenticate]
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user!.id;

      // Get funding account balances
      const fundingResult = await db.query(`
        SELECT 
          COALESCE(SUM(b.available_balance + b.locked_balance), 0) as total
        FROM balances b
        WHERE b.user_id = $1 AND b.account_type = 'funding'
      `, [userId]);

      // Get trading account balances
      const tradingResult = await db.query(`
        SELECT 
          COALESCE(SUM(b.available_balance + b.locked_balance), 0) as total
        FROM balances b
        WHERE b.user_id = $1 AND (b.account_type = 'trading' OR b.account_type = 'unified')
      `, [userId]);

      const fundingTotal = parseFloat(fundingResult.rows[0]?.total || '0');
      const tradingTotal = parseFloat(tradingResult.rows[0]?.total || '0');

      // Mock BTC price for conversion (in production, fetch from price service)
      const btcPrice = 82000;

      return {
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
      };
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

  // Get funding account balances (authenticated)
  app.get('/balances/funding', {
    preHandler: [app.authenticate]
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user!.id;

      // Get ONLY currencies where user has actual balance (from deposits/transfers)
      const result = await db.query(`
        SELECT DISTINCT ON (UPPER(c.symbol))
          c.id as token_id,
          c.symbol,
          REGEXP_REPLACE(c.name, '\\s*\\([A-Z0-9]+\\)\\s*$', '', 'i') as name,
          ub.available_balance::text as available_balance,
          ub.locked_balance::text as locked_balance,
          (ub.available_balance + ub.locked_balance)::text as total_balance
        FROM user_balances ub
        JOIN currencies c ON c.id = ub.currency_id
        WHERE ub.user_id = $1 
          AND ub.account_type = 'funding'
          AND (ub.available_balance > 0 OR ub.locked_balance > 0 OR ub.pending_balance > 0)
          AND c.is_active = TRUE
        ORDER BY UPPER(c.symbol), ub.available_balance DESC
      `, [userId]);

      // BTC price for conversion
      const btcPrice = 97500;

      // Get USDT prices for each currency
      const pricesResult = await db.query(`
        SELECT DISTINCT ON (UPPER(bc.symbol))
          bc.symbol,
          mp.price::numeric as usd_price
        FROM market_prices mp
        JOIN currencies bc ON mp.base_currency_id = bc.id
        JOIN currencies qc ON mp.quote_currency_id = qc.id
        WHERE UPPER(qc.symbol) = 'USDT'
        ORDER BY UPPER(bc.symbol), mp.price DESC
      `);
      
      const priceMap: Record<string, number> = { 'USDT': 1, 'USDC': 1 };
      pricesResult.rows.forEach(row => {
        priceMap[row.symbol.toUpperCase()] = parseFloat(row.usd_price) || 1;
      });

      const balances = result.rows.map(row => {
        const price = priceMap[row.symbol.toUpperCase()] || 1;
        const totalBalance = parseFloat(row.total_balance || '0');
        const usdValue = totalBalance * price;
        
        return {
          token_id: row.token_id,
          symbol: row.symbol,
          name: row.name,
          total_balance: row.total_balance || '0',
          available_balance: row.available_balance || '0',
          locked_balance: row.locked_balance || '0',
          btc_value: (usdValue / btcPrice).toFixed(8),
          usd_value: usdValue.toFixed(2)
        };
      });

      // Sort: coins with balance first, then alphabetically
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

      return {
        success: true,
        data: {
          balances,
          totalEquity: { usd: totalUsd, btc: totalUsd / btcPrice },
          availableBalance: { usd: availableUsd, btc: availableUsd / btcPrice },
          inUse: { usd: lockedUsd, btc: lockedUsd / btcPrice }
        }
      };
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

  // Get trading account balances (authenticated)
  app.get('/balances/trading', {
    preHandler: [app.authenticate]
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user!.id;

      // Get all token balances for trading account
      const result = await db.query(`
        SELECT 
          b.token_id,
          t.symbol,
          t.name,
          COALESCE(b.available_balance, 0) as equity,
          COALESCE(b.available_balance, 0) as wallet_balance,
          0 as borrowed_amount,
          0 as used_as_collateral
        FROM tokens t
        LEFT JOIN balances b ON t.id = b.token_id AND b.user_id = $1 AND (b.account_type = 'trading' OR b.account_type = 'unified')
        WHERE t.is_active = TRUE
        ORDER BY 
          CASE WHEN COALESCE(b.available_balance, 0) > 0 THEN 0 ELSE 1 END,
          t.symbol ASC
      `, [userId]);

      // Mock BTC price for conversion
      const btcPrice = 82000;

      const balances = result.rows.map(row => ({
        token_id: row.token_id,
        symbol: row.symbol,
        name: row.name,
        equity: row.equity || '0',
        wallet_balance: row.wallet_balance || '0',
        borrowed_amount: '0',
        used_as_collateral: '0',
        usd_value: row.equity || '0'
      }));

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

  // Get transferable balances between accounts
  app.get('/transfer/balances', {
    preHandler: [app.authenticate]
  }, async (request: FastifyRequest<{
    Querystring: { from?: string; to?: string }
  }>, reply: FastifyReply) => {
    try {
      const userId = request.user!.id;
      // Note: fromAccount is stored for future multi-account support
      // Currently returns all tokens with balances

      // Get available coins with their balances from the tokens table
      // This query works with the actual database schema (tokens + balances tables)
      const result = await db.query(`
        SELECT 
          t.id as token_id,
          t.symbol,
          t.name,
          t.decimals,
          t.chain_id,
          c.name as chain_name,
          COALESCE(b.available, 0) as available_balance
        FROM tokens t
        LEFT JOIN balances b ON t.id = b.token_id AND b.user_id = $1
        LEFT JOIN chains c ON t.chain_id = c.id
        WHERE t.is_active = TRUE
        ORDER BY 
          CASE WHEN COALESCE(b.available, 0) > 0 THEN 0 ELSE 1 END,
          t.symbol ASC
      `, [userId]);

      return {
        success: true,
        data: result.rows.map(row => ({
          tokenId: row.token_id,
          symbol: row.symbol,
          name: row.name,
          iconUrl: `/assets/upload/currency-logo/${row.symbol.toLowerCase()}.svg`,
          decimals: row.decimals,
          chainId: row.chain_id,
          chainName: row.chain_name,
          availableBalance: row.available_balance?.toString() || '0'
        }))
      };
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

      // Validate accounts
      const validAccounts = ['funding', 'trading', 'unified'];
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

      // Check available balance (use balances table)
      // Note: Currently using single balance per token, multi-account support can be added later
      const balanceResult = await db.query(`
        SELECT available FROM balances 
        WHERE user_id = $1 AND token_id = $2
      `, [userId, tokenId]);

      const availableBalance = parseFloat(balanceResult.rows[0]?.available || '0');

      if (availableBalance < transferAmount) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INSUFFICIENT_BALANCE', message: 'Insufficient balance for transfer' }
        });
      }

      // For now, internal transfers between funding/trading are conceptual
      // Since we use a single balance table, we'll just log the transfer
      // In production, you'd have separate balance records per account type

      // Log the transfer
      auditLog(userId, 'internal_transfer', {
        fromAccount,
        toAccount,
        tokenId,
        symbol: token.symbol,
        amount: transferAmount
      });

      // Create internal_transfers table entry if it exists
      try {
        await db.query(`
          INSERT INTO internal_transfers (from_user_id, to_user_id, currency_id, amount, transfer_type, status, notes)
          VALUES ($1, $1, $2, $3, 'internal', 'completed', $4)
        `, [userId, tokenId, transferAmount, `Transfer from ${fromAccount} to ${toAccount}`]);
      } catch {
        // Table might not exist, continue without recording
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
        return { success: true, data: [], total: 0 };
      }

      const result = await db.query(`
        SELECT 
          it.id,
          it.from_account,
          it.to_account,
          it.amount,
          it.status,
          it.created_at,
          c.symbol,
          c.name,
          c.logo_url as icon_url
        FROM internal_transfers it
        JOIN currencies c ON it.currency_id = c.id
        WHERE it.user_id = $1
        ORDER BY it.created_at DESC
        LIMIT $2 OFFSET $3
      `, [userId, limit, offset]);

      const countResult = await db.query(`
        SELECT COUNT(*) FROM internal_transfers WHERE user_id = $1
      `, [userId]);

      return {
        success: true,
        data: result.rows.map(row => ({
          id: row.id,
          fromAccount: row.from_account,
          toAccount: row.to_account,
          amount: row.amount,
          symbol: row.symbol,
          name: row.name,
          iconUrl: row.icon_url,
          status: row.status,
          createdAt: row.created_at
        })),
        total: parseInt(countResult.rows[0].count)
      };
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
          const upd = await db.query(`
            UPDATE user_balances
            SET available_balance = available_balance + $1::numeric,
                pending_balance = GREATEST(pending_balance - $1::numeric, 0),
                total_deposited = COALESCE(total_deposited, 0) + $1::numeric,
                updated_at = NOW()
            WHERE user_id = $2 AND currency_id = $3 AND account_type = 'funding'
          `, [amount, row.user_id, row.currency_id]);
          if (upd.rowCount === 0) {
            await db.query(`
              INSERT INTO user_balances (id, user_id, currency_id, available_balance, locked_balance, pending_balance, total_deposited, account_type, updated_at)
              VALUES (gen_random_uuid(), $1, $2, $3::numeric, 0, 0, $3::numeric, 'funding', NOW())
            `, [row.user_id, row.currency_id, amount]);
          }
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

      const result = await db.query(`
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

      // Get total count (exclude zero amount)
      const countResult = await db.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM deposits WHERE user_id = $1 AND (amount IS NULL OR amount::numeric > 0)`,
        [userId]
      );

      // Get explorer URLs for each chain
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

      return {
        success: true,
        data: deposits,
        pagination: {
          page,
          limit,
          total: parseInt(countResult.rows[0]?.count || '0'),
          totalPages: Math.ceil(parseInt(countResult.rows[0]?.count || '0') / limit)
        }
      };
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
            const upd = await db.query(`
              UPDATE user_balances
              SET available_balance = available_balance + $1::numeric,
                  pending_balance = GREATEST(pending_balance - $1::numeric, 0),
                  total_deposited = COALESCE(total_deposited, 0) + $1::numeric,
                  updated_at = NOW()
              WHERE user_id = $2 AND currency_id = $3 AND account_type = 'funding'
            `, [amount, row.user_id, row.currency_id]);
            if (upd.rowCount === 0) {
              await db.query(`
                INSERT INTO user_balances (id, user_id, currency_id, available_balance, locked_balance, pending_balance, total_deposited, account_type, updated_at)
                VALUES (gen_random_uuid(), $1, $2, $3::numeric, 0, 0, $3::numeric, 'funding', NOW())
              `, [row.user_id, row.currency_id, amount]);
            }
            await db.query('COMMIT');
            logger.info('Deposit completed (overdue confirmations)', { depositId: row.id, userId: row.user_id });
          } catch (e) {
            await db.query('ROLLBACK');
            logger.warn('Repair deposit failed', { depositId: row.id, error: e });
          }
        }
      }

      const allTransactions: any[] = [];

      // 1. Get DEPOSITS (exclude zero amount; address = sender = from_address)
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
      let paramIndex = 2;

      if (statusFilter && statusFilter !== 'all') {
        depositQuery += ` AND LOWER(d.status) = $${paramIndex}`;
        depositParams.push(statusFilter);
        paramIndex++;
      }
      if (coinFilter && coinFilter !== 'ALL') {
        depositQuery += ` AND UPPER(c.symbol) = $${paramIndex}`;
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
          address: row.from_address || '',  // sender address
          txid: row.tx_hash || '',
          status: row.status,
          date_time: row.created_at,
          confirmations: row.confirmations || 0,
          requiredConfirmations: row.required_confirmations || 25
        });
      });

      // 2. Get WITHDRAWALS
      let withdrawQuery = `
        SELECT 
          w.id,
          'withdraw' as type,
          w.tx_hash,
          w.to_address as address,
          w.amount,
          w.status,
          w.created_at,
          c.symbol,
          c.name as currency_name,
          c.logo_url,
          b.chain_name
        FROM withdrawals w
        LEFT JOIN currencies c ON w.currency_id = c.id
        LEFT JOIN blockchains b ON w.blockchain_id = b.id
        WHERE w.user_id = $1
      `;
      const withdrawParams: any[] = [userId];
      paramIndex = 2;

      if (statusFilter && statusFilter !== 'all') {
        withdrawQuery += ` AND LOWER(w.status) = $${paramIndex}`;
        withdrawParams.push(statusFilter);
        paramIndex++;
      }
      if (coinFilter && coinFilter !== 'ALL') {
        withdrawQuery += ` AND UPPER(c.symbol) = $${paramIndex}`;
        withdrawParams.push(coinFilter);
      }

      try {
        const withdrawalsResult = await db.query(withdrawQuery, withdrawParams);
        withdrawalsResult.rows.forEach(row => {
          allTransactions.push({
            id: row.id,
            type: 'withdraw',
            coin: row.symbol || 'Unknown',
            coin_logo: row.logo_url || `/assets/upload/currency-logo/${(row.symbol || 'btc').toLowerCase()}.svg`,
            chain_type: row.chain_name || 'Unknown',
            quantity: row.amount,
            address: row.address || '',
            txid: row.tx_hash || '',
            status: row.status,
            date_time: row.created_at
          });
        });
      } catch (e) {
        // Withdrawals table may not exist
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
              it.from_account,
              it.to_account,
              it.amount,
              it.status,
              it.created_at,
              c.symbol,
              c.name as currency_name,
              c.logo_url
            FROM internal_transfers it
            JOIN currencies c ON it.currency_id = c.id
            WHERE it.user_id = $1
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
          transfersResult.rows.forEach(row => {
            allTransactions.push({
              id: row.id,
              type: 'transfer',
              coin: row.symbol || 'Unknown',
              coin_logo: row.logo_url || `/assets/upload/currency-logo/${(row.symbol || 'btc').toLowerCase()}.svg`,
              chain_type: `${row.from_account} → ${row.to_account}`,
              quantity: row.amount,
              address: '',
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
