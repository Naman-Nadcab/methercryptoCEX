import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { CHAIN_CONFIGS } from './config/chains';
import { query } from './config/database';
import { ChainIndexer } from './services/ChainIndexer';
import { ConfirmationTracker } from './services/ConfirmationTracker';
import { startApiServer } from './api/server';
import { logger } from './utils/logger';

class IndexerManager {
  private indexers: Map<string, ChainIndexer> = new Map();
  private confirmationTracker: ConfirmationTracker;
  private isShuttingDown: boolean = false;

  constructor() {
    this.confirmationTracker = new ConfirmationTracker();
  }

  async initialize(): Promise<void> {
    logger.info('🚀 Starting EVM Indexer...');
    
    // Ensure database tables exist
    await this.initializeDatabase();
    
    // Initialize indexers for all chains
    for (const [chainKey, config] of Object.entries(CHAIN_CONFIGS)) {
      const indexer = new ChainIndexer(chainKey, config);
      this.indexers.set(chainKey, indexer);
    }

    // Start all indexers
    const startPromises = Array.from(this.indexers.entries()).map(async ([chainKey, indexer]) => {
      try {
        await indexer.start();
        logger.info(`✅ ${CHAIN_CONFIGS[chainKey].name} indexer started`);
      } catch (error) {
        logger.error(`❌ Failed to start ${chainKey} indexer`, { error });
      }
    });

    await Promise.all(startPromises);

    // Start confirmation tracker
    await this.confirmationTracker.start();

    // Start API server
    startApiServer(this);
    
    logger.info('🎉 All indexers started successfully!');
    this.printStatus();
  }

  private async initializeDatabase(): Promise<void> {
    try {
      // Create indexer_state table if not exists
      await query(`
        CREATE TABLE IF NOT EXISTS indexer_state (
          chain_id VARCHAR(50) PRIMARY KEY,
          last_block BIGINT NOT NULL DEFAULT 0,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);

      // Deposits table should already exist from main backend schema
      // Just ensure indexes exist
      try {
        await query(`CREATE INDEX IF NOT EXISTS idx_deposits_user_id ON deposits(user_id)`);
        await query(`CREATE INDEX IF NOT EXISTS idx_deposits_status ON deposits(status)`);
        await query(`CREATE INDEX IF NOT EXISTS idx_deposits_to_address ON deposits(to_address)`);
      } catch (e) {
        // Indexes might already exist, ignore
      }

      // Create user_wallets table if not exists
      await query(`
        CREATE TABLE IF NOT EXISTS user_wallets (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID NOT NULL,
          chain_id VARCHAR(50) NOT NULL,
          address VARCHAR(100) NOT NULL,
          private_key_encrypted TEXT,
          derivation_path VARCHAR(100),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          UNIQUE(user_id, chain_id)
        )
      `);

      // Create tokens table if not exists  
      await query(`
        CREATE TABLE IF NOT EXISTS tokens (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          chain_id VARCHAR(50) NOT NULL,
          contract_address VARCHAR(100),
          symbol VARCHAR(20) NOT NULL,
          name VARCHAR(100) NOT NULL,
          decimals INTEGER NOT NULL DEFAULT 18,
          is_native BOOLEAN DEFAULT FALSE,
          is_active BOOLEAN DEFAULT TRUE,
          logo_url TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          UNIQUE(chain_id, contract_address)
        )
      `);

      logger.info('Database tables initialized');
    } catch (error) {
      logger.error('Failed to initialize database tables', { error });
      throw error;
    }
  }

  private printStatus(): void {
    console.log('\n' + '='.repeat(60));
    console.log('📊 Indexer Status');
    console.log('='.repeat(60));
    
    for (const [chainKey, indexer] of this.indexers) {
      const stats = indexer.getStats() as any;
      console.log(`
  ${stats.chain}:
    Chain ID: ${stats.chainId}
    Status: ${stats.isRunning ? '🟢 Running' : '🔴 Stopped'}
    Watched Addresses: ${stats.watchedAddresses}
    Token Contracts: ${stats.tokenContracts}
    Last Block: ${stats.lastProcessedBlock}
`);
    }
    console.log('='.repeat(60) + '\n');
  }

  async shutdown(): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;
    
    logger.info('Shutting down indexers...');
    
    // Stop confirmation tracker
    await this.confirmationTracker.stop();
    
    // Stop all indexers
    const stopPromises = Array.from(this.indexers.values()).map(indexer => indexer.stop());
    await Promise.all(stopPromises);
    
    logger.info('All indexers stopped');
    process.exit(0);
  }

  // API methods for external control
  async addWatchedAddress(chainId: string, address: string): Promise<boolean> {
    const indexer = this.indexers.get(chainId);
    if (!indexer) {
      logger.warn(`No indexer for chain ${chainId}`);
      return false;
    }
    
    await indexer.addWatchedAddress(address);
    return true;
  }

  getStats(): object {
    const stats: Record<string, object> = {};
    
    for (const [chainKey, indexer] of this.indexers) {
      stats[chainKey] = indexer.getStats();
    }
    
    return stats;
  }
}

// Main entry point
const manager = new IndexerManager();

// Handle graceful shutdown
process.on('SIGINT', () => manager.shutdown());
process.on('SIGTERM', () => manager.shutdown());
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error });
  manager.shutdown();
});
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason });
});

// Start the indexer
manager.initialize().catch((error) => {
  logger.error('Failed to initialize indexer', { error });
  process.exit(1);
});

export { manager as indexerManager };
