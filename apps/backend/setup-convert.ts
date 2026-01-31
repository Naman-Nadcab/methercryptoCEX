import { db } from './src/lib/database.js';

async function setupConvertTables() {
  console.log('Setting up convert/swap tables...');

  try {
    // Create conversion_type enum if not exists
    await db.query(`
      DO $$ BEGIN
        CREATE TYPE conversion_type AS ENUM ('instant', 'limit');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    console.log('✓ Created conversion_type enum');

    // Create conversion_status enum if not exists
    await db.query(`
      DO $$ BEGIN
        CREATE TYPE conversion_status AS ENUM ('pending', 'processing', 'completed', 'cancelled', 'expired', 'failed');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    console.log('✓ Created conversion_status enum');

    // Create conversions table
    await db.query(`
      CREATE TABLE IF NOT EXISTS conversions (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID NOT NULL REFERENCES users(id),
        
        -- Conversion type
        conversion_type conversion_type NOT NULL DEFAULT 'instant',
        
        -- From currency
        from_currency_id UUID NOT NULL REFERENCES currencies(id),
        from_amount DECIMAL(30, 18) NOT NULL,
        
        -- To currency
        to_currency_id UUID NOT NULL REFERENCES currencies(id),
        to_amount DECIMAL(30, 18),
        
        -- Rate and price info
        conversion_rate DECIMAL(30, 18) NOT NULL,
        market_rate DECIMAL(30, 18),
        
        -- For limit orders
        target_rate DECIMAL(30, 18),
        rate_deviation_percent DECIMAL(5, 2),
        expires_at TIMESTAMP WITH TIME ZONE,
        
        -- Fees
        fee_amount DECIMAL(30, 18) DEFAULT 0,
        fee_currency_id UUID REFERENCES currencies(id),
        
        -- Account type (funding/trading)
        account_type VARCHAR(20) DEFAULT 'funding',
        
        -- Status
        status conversion_status DEFAULT 'pending',
        
        -- Timestamps
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP WITH TIME ZONE,
        cancelled_at TIMESTAMP WITH TIME ZONE,
        
        -- Additional info
        ip_address INET,
        user_agent TEXT
      );
    `);
    console.log('✓ Created conversions table');

    // Create indexes
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_conversions_user_id ON conversions(user_id);
      CREATE INDEX IF NOT EXISTS idx_conversions_status ON conversions(status);
      CREATE INDEX IF NOT EXISTS idx_conversions_type ON conversions(conversion_type);
      CREATE INDEX IF NOT EXISTS idx_conversions_created_at ON conversions(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_conversions_from_currency ON conversions(from_currency_id);
      CREATE INDEX IF NOT EXISTS idx_conversions_to_currency ON conversions(to_currency_id);
    `);
    console.log('✓ Created indexes');

    // Create market_prices table for storing live prices
    await db.query(`
      CREATE TABLE IF NOT EXISTS market_prices (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        base_currency_id UUID NOT NULL REFERENCES currencies(id),
        quote_currency_id UUID NOT NULL REFERENCES currencies(id),
        
        price DECIMAL(30, 18) NOT NULL,
        price_24h_ago DECIMAL(30, 18),
        change_24h DECIMAL(10, 4),
        change_24h_percent DECIMAL(10, 4),
        
        high_24h DECIMAL(30, 18),
        low_24h DECIMAL(30, 18),
        volume_24h DECIMAL(30, 18),
        
        last_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        
        UNIQUE(base_currency_id, quote_currency_id)
      );
    `);
    console.log('✓ Created market_prices table');

    // Create index for market prices
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_market_prices_pair ON market_prices(base_currency_id, quote_currency_id);
    `);
    console.log('✓ Created market_prices indexes');

    // Insert sample market prices (BTC, ETH, etc. vs USDT)
    const samplePrices = [
      { base: 'BTC', quote: 'USDT', price: 83051.50, change: 0.33 },
      { base: 'ETH', quote: 'USDT', price: 2649.58, change: -3.3 },
      { base: 'SOL', quote: 'USDT', price: 116.58, change: 0.46 },
      { base: 'XRP', quote: 'USDT', price: 1.7036, change: -2.75 },
      { base: 'MNT', quote: 'USDT', price: 0.7669, change: -3.17 },
      { base: 'USDC', quote: 'USDT', price: 1.0012, change: -0.04 },
      { base: 'AAVE', quote: 'USDT', price: 215.50, change: 1.25 },
      { base: 'LINK', quote: 'USDT', price: 18.75, change: -1.5 },
      { base: 'MATIC', quote: 'USDT', price: 0.85, change: -2.1 },
      { base: 'DOT', quote: 'USDT', price: 6.45, change: -1.8 },
      { base: 'AVAX', quote: 'USDT', price: 35.20, change: 2.3 },
      { base: 'ATOM', quote: 'USDT', price: 8.90, change: -0.9 },
    ];

    for (const item of samplePrices) {
      await db.query(`
        INSERT INTO market_prices (base_currency_id, quote_currency_id, price, change_24h_percent, last_updated)
        SELECT 
          (SELECT id FROM currencies WHERE UPPER(symbol) = $1 LIMIT 1),
          (SELECT id FROM currencies WHERE UPPER(symbol) = $2 LIMIT 1),
          $3, $4, NOW()
        WHERE EXISTS (SELECT 1 FROM currencies WHERE UPPER(symbol) = $1)
          AND EXISTS (SELECT 1 FROM currencies WHERE UPPER(symbol) = $2)
        ON CONFLICT (base_currency_id, quote_currency_id) 
        DO UPDATE SET price = $3, change_24h_percent = $4, last_updated = NOW();
      `, [item.base, item.quote, item.price, item.change]);
    }
    console.log('✓ Inserted sample market prices');

    // Insert some sample conversion records for testing
    await db.query(`
      INSERT INTO conversions (user_id, conversion_type, from_currency_id, from_amount, to_currency_id, to_amount, conversion_rate, status, completed_at)
      SELECT 
        (SELECT id FROM users LIMIT 1),
        'instant',
        (SELECT id FROM currencies WHERE UPPER(symbol) = 'ETH' LIMIT 1),
        0.5,
        (SELECT id FROM currencies WHERE UPPER(symbol) = 'USDT' LIMIT 1),
        1324.79,
        2649.58,
        'completed',
        NOW() - INTERVAL '2 hours'
      WHERE EXISTS (SELECT 1 FROM users)
        AND EXISTS (SELECT 1 FROM currencies WHERE UPPER(symbol) = 'ETH')
        AND EXISTS (SELECT 1 FROM currencies WHERE UPPER(symbol) = 'USDT')
      ON CONFLICT DO NOTHING;
    `);
    console.log('✓ Inserted sample conversion records');

    console.log('\n✅ Convert tables setup complete!');
  } catch (error) {
    console.error('Error setting up convert tables:', error);
    throw error;
  } finally {
    process.exit(0);
  }
}

setupConvertTables();
