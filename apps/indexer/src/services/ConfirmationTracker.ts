import { JsonRpcProvider } from 'ethers';
import { CHAIN_CONFIGS } from '../config/chains';
import { query } from '../config/database';
import { logger } from '../utils/logger';
import { emailService } from './EmailService';

interface PendingDeposit {
  id: string;
  user_id: string;
  blockchain_id: string;
  chain_key: string;
  tx_hash: string;
  symbol: string;
  amount: string;
  block_number: number;
  confirmations: number;
  required_confirmations: number;
  currency_id: string;
}

export class ConfirmationTracker {
  private providers: Map<string, JsonRpcProvider> = new Map();
  private isRunning: boolean = false;
  private checkInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Initialize providers for all chains
    for (const [chainKey, config] of Object.entries(CHAIN_CONFIGS)) {
      this.providers.set(chainKey, new JsonRpcProvider(config.rpcUrl));
    }
  }

  async start(): Promise<void> {
    this.isRunning = true;
    logger.info('Confirmation tracker started');
    
    // Check confirmations every 30 seconds
    this.checkInterval = setInterval(() => {
      this.checkPendingDeposits();
    }, 30000);
    
    // Initial check
    await this.checkPendingDeposits();
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    
    logger.info('Confirmation tracker stopped');
  }

  private async checkPendingDeposits(): Promise<void> {
    if (!this.isRunning) return;

    try {
      // Get all pending deposits
      const result = await query(`
        SELECT 
          d.id, d.user_id, d.blockchain_id, d.tx_hash, 
          d.amount::text as amount, d.block_number, d.confirmations, d.required_confirmations,
          d.currency_id,
          c.symbol,
          b.chain_symbol as chain_key,
          b.chain_id as chain_numeric_id
        FROM deposits d
        JOIN currencies c ON d.currency_id = c.id
        LEFT JOIN blockchains b ON d.blockchain_id = b.id
        WHERE d.status = 'pending'
        ORDER BY d.created_at ASC
        LIMIT 100
      `);

      if (result.rows.length === 0) return;

      logger.debug(`Checking ${result.rows.length} pending deposits`);

      // Map chain symbols to our chain keys
      const chainKeyMap: Record<string, string> = {
        'ETH': 'ethereum',
        'BNB': 'bsc',
        'BSC': 'bsc',
        'MATIC': 'polygon',
        'ARB': 'arbitrum',
        'BASE': 'base',
      };

      // Group by chain for efficiency
      const depositsByChain = new Map<string, PendingDeposit[]>();
      
      for (const deposit of result.rows) {
        const chainKey = chainKeyMap[deposit.chain_key?.toUpperCase()] || 'ethereum';
        const chainDeposits = depositsByChain.get(chainKey) || [];
        chainDeposits.push({
          ...deposit,
          chain_key: chainKey
        });
        depositsByChain.set(chainKey, chainDeposits);
      }

      // Process each chain
      for (const [chainKey, deposits] of depositsByChain) {
        await this.processChainDeposits(chainKey, deposits);
      }
    } catch (error) {
      logger.error('Error checking pending deposits', { error });
    }
  }

  private async processChainDeposits(chainId: string, deposits: PendingDeposit[]): Promise<void> {
    const provider = this.providers.get(chainId);
    if (!provider) {
      logger.warn(`No provider for chain ${chainId}`);
      return;
    }

    try {
      const currentBlock = await provider.getBlockNumber();

      for (const deposit of deposits) {
        const confirmations = currentBlock - deposit.block_number;
        
        // Update confirmation count
        await query(`
          UPDATE deposits SET confirmations = $1, updated_at = NOW() WHERE id = $2
        `, [confirmations, deposit.id]);

        // Check if fully confirmed
        if (confirmations >= deposit.required_confirmations) {
          await this.confirmDeposit(deposit);
        }
      }
    } catch (error) {
      logger.error(`Error processing deposits for chain ${chainId}`, { error });
    }
  }

  private async confirmDeposit(deposit: PendingDeposit): Promise<void> {
    try {
      logger.info(`Confirming deposit`, {
        id: deposit.id,
        chain: deposit.chain_key,
        txHash: deposit.tx_hash,
        symbol: deposit.symbol,
        amount: deposit.amount,
      });

      // CRITICAL: First verify the transaction on blockchain before confirming
      const provider = this.providers.get(deposit.chain_key);
      if (provider && deposit.tx_hash) {
        try {
          const receipt = await provider.getTransactionReceipt(deposit.tx_hash);
          
          if (!receipt) {
            // Transaction not found - keep as pending, don't mark failed
            logger.warn(`Transaction receipt not found, keeping as pending`, { txHash: deposit.tx_hash });
            return;
          }
          
          if (receipt.status === 0) {
            // Transaction actually failed on blockchain - only then mark as failed
            logger.warn(`Transaction failed on blockchain`, { txHash: deposit.tx_hash });
            await query(`
              UPDATE deposits SET status = 'failed', updated_at = NOW() WHERE id = $1
            `, [deposit.id]);
            return;
          }
          
          // Transaction is successful on blockchain (status === 1)
          logger.info(`Transaction verified on blockchain`, { txHash: deposit.tx_hash, status: receipt.status });
        } catch (rpcError) {
          // RPC error - don't mark as failed, just skip and retry later
          logger.warn(`RPC error verifying transaction, will retry`, { txHash: deposit.tx_hash, error: rpcError });
          return;
        }
      }

      // Start database transaction
      await query('BEGIN');

      try {
        // Update deposit status to completed
        await query(`
          UPDATE deposits SET status = 'completed', credited_at = NOW(), updated_at = NOW()
          WHERE id = $1
        `, [deposit.id]);

        const currencyId = deposit.currency_id;

        if (currencyId) {
          // Avoid FK violation: only touch user_balances if currency exists in currencies
          const curCheck = await query(`SELECT 1 FROM currencies WHERE id = $1`, [currencyId]);
          if (curCheck.rows.length === 0) {
            logger.warn('ConfirmationTracker: currency_id not in currencies, skipping user_balances update', {
              depositId: deposit.id,
              currencyId,
              symbol: deposit.symbol,
            });
          } else {
            // Move from pending to available balance
            await query(`
              UPDATE user_balances 
              SET 
                available_balance = available_balance + $1,
                pending_balance = GREATEST(pending_balance - $1, 0),
                total_deposited = COALESCE(total_deposited, 0) + $1,
                updated_at = NOW()
              WHERE user_id = $2 AND currency_id = $3 AND account_type = 'funding'
            `, [deposit.amount, deposit.user_id, currencyId]);

            // If no rows updated, create the balance entry
            const updateResult = await query(`
              SELECT 1 FROM user_balances 
              WHERE user_id = $1 AND currency_id = $2 AND account_type = 'funding'
            `, [deposit.user_id, currencyId]);

            if (updateResult.rows.length === 0) {
              await query(`
                INSERT INTO user_balances (id, user_id, currency_id, available_balance, pending_balance, total_deposited, account_type, updated_at)
                VALUES (gen_random_uuid(), $1, $2, $3, 0, $3, 'funding', NOW())
              `, [deposit.user_id, currencyId, deposit.amount]);
            }
          }
        }

        // Log activity
        await query(`
          INSERT INTO user_activity_logs (id, user_id, activity_type, description, metadata, ip_address, user_agent, created_at)
          VALUES (gen_random_uuid(), $1, 'deposit_confirmed', $2, $3, '0.0.0.0', 'indexer', NOW())
        `, [
          deposit.user_id,
          `Deposit of ${deposit.amount} ${deposit.symbol} confirmed`,
          JSON.stringify({
            chain: deposit.chain_key,
            txHash: deposit.tx_hash,
            amount: deposit.amount,
            symbol: deposit.symbol,
          }),
        ]);

        await query('COMMIT');
        
        logger.info(`Deposit confirmed and credited`, {
          depositId: deposit.id,
          userId: deposit.user_id,
          amount: deposit.amount,
          symbol: deposit.symbol,
        });

        // Send confirmation email
        const explorerMap: Record<string, string> = {
          'ethereum': 'https://etherscan.io/tx/',
          'bsc': 'https://bscscan.com/tx/',
          'polygon': 'https://polygonscan.com/tx/',
          'arbitrum': 'https://arbiscan.io/tx/',
          'base': 'https://basescan.org/tx/',
        };
        const chainName = CHAIN_CONFIGS[deposit.chain_key]?.name || deposit.chain_key;
        const explorerUrl = explorerMap[deposit.chain_key] ? `${explorerMap[deposit.chain_key]}${deposit.tx_hash}` : undefined;

        emailService.sendDepositConfirmedEmail(deposit.user_id, {
          symbol: deposit.symbol,
          amount: deposit.amount,
          chainName,
          txHash: deposit.tx_hash,
          explorerUrl,
        });
      } catch (dbError) {
        await query('ROLLBACK');
        // Database error - DON'T mark as failed, keep as pending for retry
        logger.error(`Database error confirming deposit, keeping as pending for retry`, { 
          deposit, 
          error: dbError 
        });
        // DO NOT mark as failed - the blockchain tx is valid!
      }
    } catch (error) {
      // General error - DON'T mark as failed unless we verified blockchain status
      logger.error(`Error processing deposit confirmation, keeping as pending`, { deposit, error });
      // DO NOT automatically mark as failed - this prevents valid deposits from being lost
    }
  }
}
