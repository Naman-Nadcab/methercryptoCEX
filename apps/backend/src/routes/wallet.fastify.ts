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
  // Get all active chains
  app.get('/chains', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Try cache first
      const cacheKey = 'chains:active';
      const cached = await redis.getJson<ChainDB[]>(cacheKey);
      
      if (cached) {
        return { success: true, data: cached };
      }

      const result = await db.query<ChainDB>(`
        SELECT id, COALESCE(id_text, name) as id_text, name, type, native_currency, decimals, 
               rpc_url, explorer_url, is_active, 
               COALESCE(required_confirmations, 12) as confirmations_required
        FROM chains
        WHERE is_active = TRUE
        ORDER BY 
          CASE UPPER(COALESCE(id_text, name))
            WHEN 'ETH' THEN 1
            WHEN 'ETHEREUM' THEN 1
            WHEN 'BSC' THEN 2
            WHEN 'BNB SMART CHAIN' THEN 2
            WHEN 'POLYGON' THEN 3
            WHEN 'MATIC' THEN 3
            WHEN 'ARBITRUM' THEN 4
            WHEN 'OPTIMISM' THEN 5
            WHEN 'BASE' THEN 6
            WHEN 'TRON' THEN 7
            WHEN 'TRX' THEN 7
            WHEN 'SOLANA' THEN 8
            WHEN 'SOL' THEN 8
            WHEN 'BITCOIN' THEN 9
            WHEN 'BTC' THEN 9
            ELSE 10
          END
      `);

      // Cache for 5 minutes
      await redis.setJson(cacheKey, result.rows, 300);

      return { success: true, data: result.rows };
    } catch (error) {
      logger.error('Failed to get chains', { error: error instanceof Error ? error.message : 'Unknown' });
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

  // Get chains available for a specific token symbol
  app.get('/tokens/:symbol/chains', async (request: FastifyRequest<{
    Params: { symbol: string }
  }>, reply: FastifyReply) => {
    try {
      const { symbol } = request.params;

      // Try cache first
      const cacheKey = `tokens:${symbol.toUpperCase()}:chains`;
      const cached = await redis.getJson<ChainDB[]>(cacheKey);
      
      if (cached) {
        return { success: true, data: cached };
      }

      const result = await db.query<ChainDB>(`
        SELECT DISTINCT 
               c.id, c.id_text, c.name, c.type, c.native_currency, 
               COALESCE(c.required_confirmations, 12) as confirmations_required,
               c.explorer_url,
               LOWER(COALESCE(c.id_text, c.name)) as icon,
               CASE c.type WHEN 'evm' THEN 1 ELSE 2 END as sort_order
        FROM tokens t
        JOIN chains c ON t.chain_id = c.id
        WHERE UPPER(t.symbol) = UPPER($1) AND t.is_active = TRUE AND c.is_active = TRUE
        ORDER BY sort_order, c.name ASC
      `, [symbol]);

      // Cache for 5 minutes
      await redis.setJson(cacheKey, result.rows, 300);

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
    try {
      const userId = request.user!.id;
      const { chainId } = request.params;

      // Check KYC status first
      let isKycVerified = false;
      try {
        logger.info('Checking KYC for user', { userId, email: request.user?.email });
        const kycCheck = await db.query(`
          SELECT status FROM kyc_applications 
          WHERE user_id = $1 AND status = 'approved'
          LIMIT 1
        `, [userId]);
        isKycVerified = kycCheck.rows.length > 0;
        logger.info('KYC check result', { userId, isKycVerified, rowsFound: kycCheck.rows.length });
      } catch (kycError) {
        // If KYC table doesn't exist or query fails, treat as not verified
        logger.warn('KYC check failed, treating as not verified', { error: kycError instanceof Error ? kycError.message : 'Unknown' });
        isKycVerified = false;
      }

      if (!isKycVerified) {
        logger.info('KYC not verified, returning 403', { userId });
        return reply.status(403).send({
          success: false,
          error: { 
            code: 'KYC_REQUIRED', 
            message: 'Identity verification required to deposit',
            kycRequired: true
          }
        });
      }

      // Validate chain exists (chainId can be UUID or string id)
      const chainCheck = await db.query<ChainDB>(
        `SELECT *, COALESCE(required_confirmations, 12) as confirmations_required 
         FROM chains WHERE (id::text = $1 OR LOWER(COALESCE(id_text, name)) = LOWER($1)) AND is_active = TRUE`,
        [chainId]
      );

      if (chainCheck.rows.length === 0) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_CHAIN', message: 'Invalid or inactive chain' }
        });
      }

      const chain = chainCheck.rows[0]!;

      // For EVM chains, use a single shared address
      // Determine if this is an EVM chain
      const isEvmChain = chain.type === 'evm';
      
      // For EVM chains, we use a "master" EVM chain ID to share addresses
      // All EVM chains use the same address
      let walletChainId = chain.id;
      
      if (isEvmChain) {
        // Find the Ethereum chain ID to use as master for all EVM wallets
        const ethChain = await db.query<{ id: string }>(`SELECT id FROM chains WHERE LOWER(id_text) = 'eth' LIMIT 1`);
        if (ethChain.rows.length > 0) {
          walletChainId = ethChain.rows[0]!.id;
        }
      }

      // Check if wallet exists for this user and chain
      let walletResult = await db.query<{ address: string }>(
        `SELECT address FROM wallets WHERE user_id = $1 AND chain_id = $2`,
        [userId, walletChainId]
      );

      let walletAddress: string;

      if (walletResult.rows.length === 0) {
        // Create new wallet - generate address
        logger.info('Creating new wallet for user', { userId, chainId: walletChainId, chainType: chain.type });
        
        // Generate deterministic wallet from user ID
        const crypto = await import('crypto');
        const { ethers } = await import('ethers');
        
        // Create deterministic seed from user ID
        const seed = crypto.createHash('sha256').update(`wallet:${userId}:${walletChainId}`).digest('hex');
        
        if (isEvmChain) {
          // Generate EVM address
          const wallet = ethers.Wallet.fromPhrase(ethers.Mnemonic.entropyToPhrase(Buffer.from(seed, 'hex').slice(0, 16)));
          walletAddress = wallet.address;
        } else {
          // Generate placeholder addresses for non-EVM chains
          const chainKey = (chain.id_text || chain.name).toLowerCase();
          if (chainKey === 'sol' || chainKey === 'solana') {
            walletAddress = `So${seed.slice(0, 42)}`;
          } else if (chainKey === 'trx' || chainKey === 'tron') {
            walletAddress = `T${seed.slice(0, 33)}`;
          } else if (chainKey === 'btc' || chainKey === 'bitcoin') {
            walletAddress = `bc1q${seed.slice(0, 38)}`;
          } else {
            walletAddress = `0x${seed.slice(0, 40)}`;
          }
        }

        // Store the wallet
        await db.query(
          `INSERT INTO wallets (user_id, chain_id, address, hd_path, hd_index, is_active)
           VALUES ($1, $2, $3, $4, $5, true)
           ON CONFLICT (user_id, chain_id) DO UPDATE SET address = EXCLUDED.address`,
          [userId, walletChainId, walletAddress, "m/44'/60'/0'/0/0", 0]
        );
        
        logger.info('Created wallet', { userId, chainId: walletChainId, address: walletAddress });
      } else {
        walletAddress = walletResult.rows[0]!.address;
      }

      const confirmations = chain.confirmations_required || chain.required_confirmations || 12;

      return {
        success: true,
        data: {
          address: walletAddress,
          chain: {
            id: chain.id,
            name: chain.name,
            type: chain.type,
            confirmationsRequired: confirmations,
            explorerUrl: chain.explorer_url || ''
          },
          qrCodeData: `${chain.type === 'evm' ? 'ethereum' : chain.name.toLowerCase()}:${walletAddress}`,
          notice: getDepositNotice(chain.type, confirmations)
        }
      };
    } catch (error) {
      logger.error('Failed to get deposit address', { 
        error: error instanceof Error ? error.message : 'Unknown',
        userId: request.user?.id 
      });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to get deposit address' }
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
}

function getDepositNotice(chainType: string, confirmations: number | undefined): string {
  const confirms = confirmations || 12;
  const notices: string[] = [
    `Your deposit will be credited after ${confirms} network confirmations.`,
    'Please ensure you are sending the correct token on the correct network.',
    'Sending tokens on the wrong network may result in permanent loss of funds.'
  ];

  if (chainType === 'evm') {
    notices.push('This address supports all ERC-20/BEP-20 compatible tokens on this chain.');
  }

  return notices.join(' ');
}
