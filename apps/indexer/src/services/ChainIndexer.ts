import { ethers, WebSocketProvider, JsonRpcProvider, Log, Block, TransactionResponse } from 'ethers';
import { ChainConfig, ERC20_TRANSFER_TOPIC } from '../config/chains';
import { query } from '../config/database';
import { logger } from '../utils/logger';
import { emailService } from './EmailService';

export class ChainIndexer {
  private chainKey: string;
  private config: ChainConfig;
  private wsProvider: WebSocketProvider | null = null;
  private httpProvider: JsonRpcProvider;
  private watchedAddresses: Set<string> = new Set();
  private tokenContracts: Map<string, { symbol: string; decimals: number }> = new Map();
  private isRunning: boolean = false;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;
  private lastProcessedBlock: number = 0;

  constructor(chainKey: string, config: ChainConfig) {
    this.chainKey = chainKey;
    this.config = config;
    this.httpProvider = new JsonRpcProvider(config.rpcUrl);
  }

  async start(): Promise<void> {
    logger.info(`Starting indexer for ${this.config.name}`, { chainId: this.config.id });
    
    try {
      // Load watched addresses from database
      await this.loadWatchedAddresses();
      
      // Load token contracts
      await this.loadTokenContracts();
      
      // Get last processed block
      await this.loadLastProcessedBlock();
      
      // Connect WebSocket
      await this.connectWebSocket();
      
      this.isRunning = true;
      logger.info(`Indexer started for ${this.config.name}`, { 
        watchedAddresses: this.watchedAddresses.size,
        tokens: this.tokenContracts.size,
        lastBlock: this.lastProcessedBlock
      });
    } catch (error) {
      logger.error(`Failed to start indexer for ${this.config.name}`, { error });
      throw error;
    }
  }

  private async connectWebSocket(): Promise<void> {
    try {
      this.wsProvider = new WebSocketProvider(this.config.wssUrl);
      
      // Handle new blocks
      this.wsProvider.on('block', async (blockNumber: number) => {
        await this.processBlock(blockNumber);
      });

      // Handle WebSocket errors (WebSocketLike may not have .on in types; cast for Node ws)
      const ws = this.wsProvider.websocket as unknown as { on?: (ev: string, cb: (e?: Error) => void) => void };
      if (typeof ws?.on === 'function') {
        ws.on('error', (error?: Error) => {
          logger.error(`WebSocket error on ${this.config.name}`, { error: error?.message });
          this.handleDisconnect();
        });
        ws.on('close', () => {
          logger.warn(`WebSocket closed for ${this.config.name}`);
          this.handleDisconnect();
        });
      }

      this.reconnectAttempts = 0;
      logger.info(`WebSocket connected for ${this.config.name}`);
    } catch (error) {
      logger.error(`Failed to connect WebSocket for ${this.config.name}`, { error });
      this.handleDisconnect();
    }
  }

  private async handleDisconnect(): Promise<void> {
    if (!this.isRunning) return;
    
    this.reconnectAttempts++;
    
    if (this.reconnectAttempts > this.maxReconnectAttempts) {
      logger.error(`Max reconnect attempts reached for ${this.config.name}`);
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    logger.info(`Reconnecting to ${this.config.name} in ${delay}ms (attempt ${this.reconnectAttempts})`);
    
    setTimeout(async () => {
      try {
        await this.connectWebSocket();
      } catch (error) {
        logger.error(`Reconnect failed for ${this.config.name}`, { error });
      }
    }, delay);
  }

  private async loadWatchedAddresses(): Promise<void> {
    try {
      // Load user deposit addresses for this chain
      // Join with blockchains table using chain_id (numeric)
      const result = await query(`
        SELECT DISTINCT LOWER(uw.address) as address 
        FROM user_wallets uw
        JOIN blockchains b ON uw.blockchain_id = b.id
        WHERE b.chain_id = $1 AND uw.address IS NOT NULL AND uw.is_active = TRUE
      `, [this.config.id]);
      
      result.rows.forEach(row => {
        this.watchedAddresses.add(row.address.toLowerCase());
      });
      
      logger.info(`Loaded ${this.watchedAddresses.size} watched addresses for ${this.config.name}`);
    } catch (error) {
      logger.error(`Failed to load watched addresses for ${this.config.name}`, { error });
    }
  }

  private async loadTokenContracts(): Promise<void> {
    try {
      // Load tokens from currencies table that have contract addresses
      // The currencies table has contract_address for ERC20 tokens
      const result = await query(`
        SELECT LOWER(c.contract_address) as address, c.symbol, c.decimals 
        FROM currencies c
        WHERE c.contract_address IS NOT NULL 
          AND c.contract_address != '' 
          AND c.is_active = TRUE
      `);
      
      result.rows.forEach(row => {
        if (row.address) {
          this.tokenContracts.set(row.address.toLowerCase(), {
            symbol: row.symbol,
            decimals: row.decimals || 18
          });
        }
      });
      
      logger.info(`Loaded ${this.tokenContracts.size} token contracts for ${this.config.name}`);
    } catch (error) {
      logger.error(`Failed to load token contracts for ${this.config.name}`, { error });
    }
  }

  private async loadLastProcessedBlock(): Promise<void> {
    try {
      const result = await query(`
        SELECT last_block FROM indexer_state WHERE chain_id = $1
      `, [this.chainKey]);
      
      if (result.rows.length > 0) {
        this.lastProcessedBlock = result.rows[0].last_block;
      } else {
        // Get current block and start from there
        this.lastProcessedBlock = await this.httpProvider.getBlockNumber();
        await query(`
          INSERT INTO indexer_state (chain_id, last_block, updated_at)
          VALUES ($1, $2, NOW())
          ON CONFLICT (chain_id) DO UPDATE SET last_block = $2, updated_at = NOW()
        `, [this.chainKey, this.lastProcessedBlock]);
      }
    } catch (error) {
      logger.error(`Failed to load last processed block for ${this.config.name}`, { error });
      this.lastProcessedBlock = await this.httpProvider.getBlockNumber();
    }
  }

  private async processBlock(blockNumber: number): Promise<void> {
    if (blockNumber <= this.lastProcessedBlock) return;
    
    try {
      const block = await this.httpProvider.getBlock(blockNumber, true);
      if (!block) return;

      logger.debug(`Processing block ${blockNumber} on ${this.config.name}`);

      // Process native token transfers
      await this.processNativeTransfers(block);
      
      // Process ERC20 token transfers
      await this.processTokenTransfers(blockNumber);
      
      // Update last processed block
      this.lastProcessedBlock = blockNumber;
      await this.updateLastProcessedBlock(blockNumber);
      
    } catch (error) {
      logger.error(`Error processing block ${blockNumber} on ${this.config.name}`, { error });
    }
  }

  private async processNativeTransfers(block: Block): Promise<void> {
    if (!block.prefetchedTransactions) return;

    for (const tx of block.prefetchedTransactions) {
      if (!tx.to || !tx.value) continue;
      
      const toAddress = tx.to.toLowerCase();
      
      // Check if recipient is a watched address
      if (this.watchedAddresses.has(toAddress)) {
        const amount = ethers.formatUnits(tx.value, this.config.nativeDecimals);
        
        if (parseFloat(amount) > 0) {
          await this.recordDeposit({
            chainId: this.chainKey,
            txHash: tx.hash,
            fromAddress: tx.from.toLowerCase(),
            toAddress: toAddress,
            tokenAddress: null, // Native token
            symbol: this.config.symbol,
            amount: amount,
            decimals: this.config.nativeDecimals,
            blockNumber: block.number!,
            blockTimestamp: block.timestamp,
          });
        }
      }
    }
  }

  private async processTokenTransfers(blockNumber: number): Promise<void> {
    try {
      // Get all Transfer events in this block
      const logs = await this.httpProvider.getLogs({
        fromBlock: blockNumber,
        toBlock: blockNumber,
        topics: [ERC20_TRANSFER_TOPIC],
      });

      for (const log of logs) {
        await this.processTransferLog(log, blockNumber);
      }
    } catch (error) {
      logger.error(`Error processing token transfers for block ${blockNumber}`, { error });
    }
  }

  private async processTransferLog(log: Log, blockNumber: number): Promise<void> {
    try {
      if (log.topics.length < 3) return;
      
      const tokenAddress = log.address.toLowerCase();
      const fromAddress = '0x' + log.topics[1].slice(26).toLowerCase();
      const toAddress = '0x' + log.topics[2].slice(26).toLowerCase();
      
      // Check if recipient is a watched address
      if (!this.watchedAddresses.has(toAddress)) return;
      
      // Get token info
      let tokenInfo = this.tokenContracts.get(tokenAddress);
      
      if (!tokenInfo) {
        // Try to fetch token info if not in our list
        const fetched = await this.fetchTokenInfo(tokenAddress);
        if (fetched) {
          this.tokenContracts.set(tokenAddress, fetched);
          tokenInfo = fetched;
        } else {
          return; // Unknown token, skip
        }
      }
      
      // Decode amount from log data
      const amount = ethers.formatUnits(log.data, tokenInfo.decimals);
      
      if (parseFloat(amount) > 0) {
        const block = await this.httpProvider.getBlock(blockNumber);
        
        await this.recordDeposit({
          chainId: this.chainKey,
          txHash: log.transactionHash,
          fromAddress: fromAddress,
          toAddress: toAddress,
          tokenAddress: tokenAddress,
          symbol: tokenInfo.symbol,
          amount: amount,
          decimals: tokenInfo.decimals,
          blockNumber: blockNumber,
          blockTimestamp: block?.timestamp || Math.floor(Date.now() / 1000),
        });
      }
    } catch (error) {
      logger.error(`Error processing transfer log`, { log: log.transactionHash, error });
    }
  }

  private async fetchTokenInfo(tokenAddress: string): Promise<{ symbol: string; decimals: number } | null> {
    try {
      const abi = [
        'function symbol() view returns (string)',
        'function decimals() view returns (uint8)',
      ];
      const contract = new ethers.Contract(tokenAddress, abi, this.httpProvider);
      
      const [symbol, decimals] = await Promise.all([
        contract.symbol(),
        contract.decimals(),
      ]);
      
      return { symbol, decimals: Number(decimals) };
    } catch (error) {
      logger.debug(`Could not fetch token info for ${tokenAddress}`);
      return null;
    }
  }

  private async recordDeposit(deposit: {
    chainId: string;
    txHash: string;
    fromAddress: string;
    toAddress: string;
    tokenAddress: string | null;
    symbol: string;
    amount: string;
    decimals: number;
    blockNumber: number;
    blockTimestamp: number;
  }): Promise<void> {
    try {
      // Never record zero or negative amount (avoids duplicate/empty entries)
      if (!deposit.amount || parseFloat(deposit.amount) <= 0) {
        logger.debug(`Skipping zero/empty amount deposit: ${deposit.txHash}`);
        return;
      }

      // Skip zero-value deposits (e.g. contract calls that emit 0 transfer)
      if (!deposit.amount || parseFloat(deposit.amount) <= 0) {
        logger.debug(`Skipping zero-value deposit: ${deposit.txHash}`);
        return;
      }

      // Get user by deposit address (join with blockchains using chain_id)
      const userResult = await query(`
        SELECT uw.user_id, uw.id as wallet_id, uw.blockchain_id
        FROM user_wallets uw
        JOIN blockchains b ON uw.blockchain_id = b.id
        WHERE LOWER(uw.address) = $1 AND b.chain_id = $2
      `, [deposit.toAddress, this.config.id]);
      
      if (userResult.rows.length === 0) {
        logger.warn(`No user found for address ${deposit.toAddress} on ${deposit.chainId}`);
        return;
      }
      
      const userId = userResult.rows[0].user_id;
      const walletId = userResult.rows[0].wallet_id;
      const blockchainId = userResult.rows[0].blockchain_id;

      // Get currency ID
      let currencyId: string | null = null;
      
      if (deposit.tokenAddress) {
        // ERC20 token - find by contract address
        const tokenResult = await query(`
          SELECT id FROM currencies WHERE LOWER(contract_address) = $1 LIMIT 1
        `, [deposit.tokenAddress.toLowerCase()]);
        
        if (tokenResult.rows.length > 0) {
          currencyId = tokenResult.rows[0].id;
        }
      }
      
      // If no currency found by contract, find by symbol
      if (!currencyId) {
        const symbolResult = await query(`
          SELECT id FROM currencies WHERE UPPER(symbol) = $1 LIMIT 1
        `, [deposit.symbol.toUpperCase()]);
        
        if (symbolResult.rows.length > 0) {
          currencyId = symbolResult.rows[0].id;
        }
      }

      if (!currencyId) {
        logger.warn(`Currency not found for deposit`, { symbol: deposit.symbol, tokenAddress: deposit.tokenAddress });
        return;
      }

      // Record the deposit. ON CONFLICT DO NOTHING prevents duplicate rows for same on-chain tx
      // (DB constraint: UNIQUE(blockchain_id, tx_hash, to_address)). Replay or reindex safely reuses existing row.
      const insertResult = await query(`
        INSERT INTO deposits (
          id, user_id, currency_id, blockchain_id, wallet_id, tx_hash, 
          from_address, to_address, amount, fee, confirmations, 
          required_confirmations, block_number, block_timestamp, 
          status, created_at, updated_at
        ) VALUES (
          gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, 0, 0, $9, $10, 
          to_timestamp($11), 'pending', NOW(), NOW()
        )
        ON CONFLICT (blockchain_id, tx_hash, to_address) DO NOTHING
        RETURNING id
      `, [
        userId,
        currencyId,
        blockchainId,
        walletId,
        deposit.txHash,
        deposit.fromAddress,
        deposit.toAddress,
        deposit.amount,
        this.config.confirmations,
        deposit.blockNumber,
        deposit.blockTimestamp,
      ]);

      if (insertResult.rows.length === 0) {
        logger.debug(`Deposit already recorded (duplicate tx), skipping: ${deposit.txHash}`);
        return;
      }

      logger.info(`Recorded deposit`, {
        chain: this.config.name,
        txHash: deposit.txHash,
        symbol: deposit.symbol,
        amount: deposit.amount,
        user: userId,
      });

      // Update user pending balance
      await this.updatePendingBalance(userId, currencyId, deposit.amount);

      // Send email notification for deposit detected
      const explorerMap: Record<string, string> = {
        'ethereum': 'https://etherscan.io/tx/',
        'bsc': 'https://bscscan.com/tx/',
        'polygon': 'https://polygonscan.com/tx/',
        'arbitrum': 'https://arbiscan.io/tx/',
        'base': 'https://basescan.org/tx/',
      };
      const explorerUrl = explorerMap[this.chainKey] ? `${explorerMap[this.chainKey]}${deposit.txHash}` : undefined;

      emailService.sendDepositDetectedEmail(userId, {
        symbol: deposit.symbol,
        amount: deposit.amount,
        chainName: this.config.name,
        txHash: deposit.txHash,
        requiredConfirmations: this.config.confirmations,
        explorerUrl,
      });
    } catch (error) {
      logger.error(`Failed to record deposit`, { deposit, error });
    }
  }

  private async updatePendingBalance(userId: string, currencyId: string, amount: string): Promise<void> {
    try {
      const exists = await query(`SELECT 1 FROM currencies WHERE id = $1`, [currencyId]);
      if (exists.rows.length === 0) {
        logger.warn(`Currency ${currencyId} not in currencies, skipping pending balance update`);
        return;
      }
      const CHAIN_ID_GLOBAL = '';
      await query(`
        INSERT INTO user_balances (id, user_id, currency_id, chain_id, available_balance, pending_balance, account_type, updated_at)
        VALUES (gen_random_uuid(), $1, $2, $3, 0, $4, 'funding', NOW())
        ON CONFLICT (user_id, currency_id, chain_id, account_type)
        DO UPDATE SET pending_balance = user_balances.pending_balance + $4, updated_at = NOW()
      `, [userId, currencyId, CHAIN_ID_GLOBAL, amount]);
    } catch (error) {
      logger.error(`Failed to update pending balance`, { userId, currencyId, amount, error });
    }
  }

  private async updateLastProcessedBlock(blockNumber: number): Promise<void> {
    try {
      await query(`
        UPDATE indexer_state SET last_block = $1, updated_at = NOW() WHERE chain_id = $2
      `, [blockNumber, this.chainKey]);
    } catch (error) {
      logger.error(`Failed to update last processed block`, { blockNumber, error });
    }
  }

  // Add a new address to watch
  async addWatchedAddress(address: string): Promise<void> {
    this.watchedAddresses.add(address.toLowerCase());
    logger.info(`Added watched address for ${this.config.name}`, { address });
  }

  // Remove an address from watch list
  removeWatchedAddress(address: string): void {
    this.watchedAddresses.delete(address.toLowerCase());
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    
    if (this.wsProvider) {
      this.wsProvider.removeAllListeners();
      await this.wsProvider.destroy();
      this.wsProvider = null;
    }
    
    logger.info(`Indexer stopped for ${this.config.name}`);
  }

  getStats(): object {
    return {
      chain: this.config.name,
      chainId: this.config.id,
      isRunning: this.isRunning,
      watchedAddresses: this.watchedAddresses.size,
      tokenContracts: this.tokenContracts.size,
      lastProcessedBlock: this.lastProcessedBlock,
      reconnectAttempts: this.reconnectAttempts,
    };
  }
}
