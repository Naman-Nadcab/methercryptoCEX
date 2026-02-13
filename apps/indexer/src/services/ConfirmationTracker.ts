import { JsonRpcProvider } from 'ethers';
import { CHAIN_CONFIGS } from '../config/chains';
import { query, getClient } from '../config/database';
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

      // PHASE-15: Use a single DB client so BEGIN/COMMIT form a real transaction. Prevents double-credit
      // if we crash between crediting user_balances and setting balance_applied_at (pool.query auto-commits each call).
      const client = await getClient();
      let committed = false;
      try {
        await client.query('BEGIN');
        // Atomic: set completed + credited_at only if not already set; then credit balance and set balance_applied_at in same tx.
        const updateDepositResult = await client.query(
          `UPDATE deposits SET status = 'completed', credited_at = NOW(), updated_at = NOW()
           WHERE id = $1 AND credited_at IS NULL
           RETURNING id`,
          [deposit.id]
        );
        const creditedNow = updateDepositResult.rowCount ?? 0;
        if (creditedNow === 0) {
          await client.query('ROLLBACK');
          logger.debug(`Deposit already credited, skipping balance credit (idempotent): ${deposit.id}`);
          return;
        }

        const currencyId = deposit.currency_id;
        if (currencyId) {
          const curCheck = await client.query(`SELECT 1 FROM currencies WHERE id = $1`, [currencyId]);
          if (curCheck.rows.length === 0) {
            logger.warn('ConfirmationTracker: currency_id not in currencies, skipping user_balances update', {
              depositId: deposit.id,
              currencyId,
              symbol: deposit.symbol,
            });
          } else {
            const CHAIN_ID_GLOBAL = '';
            await client.query(
              `INSERT INTO user_balances (id, user_id, currency_id, chain_id, available_balance, locked_balance, pending_balance, total_deposited, account_type, updated_at)
               VALUES (gen_random_uuid(), $1, $2, $3, 0, 0, 0, 0, 'funding', NOW())
               ON CONFLICT (user_id, currency_id, chain_id, account_type) DO NOTHING`,
              [deposit.user_id, currencyId, CHAIN_ID_GLOBAL]
            );
            const lockSel = await client.query(
              `SELECT available_balance::text FROM user_balances
               WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = 'funding'
               FOR UPDATE`,
              [deposit.user_id, currencyId, CHAIN_ID_GLOBAL]
            );
            if (lockSel.rows.length === 0) {
              throw new Error('indexer_deposit_credit: balance row not found after ensure');
            }
            const avBefore = lockSel.rows[0]?.available_balance ?? '0';
            const balUpd = await client.query(
              `UPDATE user_balances
               SET available_balance = available_balance + $1, pending_balance = GREATEST(COALESCE(pending_balance, 0) - $1, 0),
                   total_deposited = COALESCE(total_deposited, 0) + $1, updated_at = NOW()
               WHERE user_id = $2 AND currency_id = $3 AND COALESCE(chain_id, '') = $4 AND account_type = 'funding'
               RETURNING *`,
              [deposit.amount, deposit.user_id, currencyId, CHAIN_ID_GLOBAL]
            );
            const row = balUpd.rows[0];
            if (row) {
              const av = Number(row.available_balance ?? 0);
              if (av < 0 || !Number.isFinite(av)) {
                throw new Error(`indexer_deposit_credit: balance invariant violated after credit`);
              }
            }
            const avAfter = String(balUpd.rows[0]?.available_balance ?? 0);
            await client.query(
              `INSERT INTO balance_ledger (user_id, currency_id, reference_type, reference_id, debit, credit, balance_before, balance_after, balance_type, description, created_at)
               VALUES ($1, $2, 'deposit', $3, 0, $4, $5, $6, 'available', 'account_type=funding', NOW())`,
              [deposit.user_id, currencyId, deposit.id, deposit.amount, avBefore, avAfter]
            );
            try {
              await client.query(`UPDATE deposits SET balance_applied_at = NOW() WHERE id = $1`, [deposit.id]);
            } catch (colErr: unknown) {
              const code = (colErr as { code?: string })?.code;
              if (code !== '42703') {
                logger.error('balance_applied_at update failed', { depositId: deposit.id, error: colErr });
                throw colErr;
              }
            }
          }
        }

        await client.query(
          `INSERT INTO user_activity_logs (id, user_id, activity_type, description, metadata, ip_address, user_agent, created_at)
           VALUES (gen_random_uuid(), $1, 'deposit_confirmed', $2, $3, '0.0.0.0', 'indexer', NOW())`,
          [
            deposit.user_id,
            `Deposit of ${deposit.amount} ${deposit.symbol} confirmed`,
            JSON.stringify({
              chain: deposit.chain_key,
              txHash: deposit.tx_hash,
              amount: deposit.amount,
              symbol: deposit.symbol,
            }),
          ]
        );
        await client.query('COMMIT');
        committed = true;
      } catch (dbError) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error(`Database error confirming deposit, keeping as pending for retry`, {
          depositId: deposit.id,
          error: dbError,
        });
        return;
      } finally {
        client.release();
      }

      if (committed) {
        logger.info(`Deposit confirmed and credited`, {
          depositId: deposit.id,
          userId: deposit.user_id,
          amount: deposit.amount,
          symbol: deposit.symbol,
        });
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
      }
    } catch (error) {
      // General error - DON'T mark as failed unless we verified blockchain status
      logger.error(`Error processing deposit confirmation, keeping as pending`, { deposit, error });
      // DO NOT automatically mark as failed - this prevents valid deposits from being lost
    }
  }
}
