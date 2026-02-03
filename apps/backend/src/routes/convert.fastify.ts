import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../lib/database.js';
import { logger, auditLog } from '../lib/logger.js';

interface MarketPrice {
  id: string;
  base_currency_id: string;
  base_symbol: string;
  base_name: string;
  base_logo: string;
  quote_currency_id: string;
  quote_symbol: string;
  quote_name: string;
  quote_logo: string;
  price: string;
  change_24h_percent: string;
}

interface Currency {
  id: string;
  symbol: string;
  name: string;
  logo_url: string;
  decimals: number;
  is_active: boolean;
}

interface Conversion {
  id: string;
  user_id: string;
  conversion_type: string;
  from_currency_id: string;
  from_symbol: string;
  from_name: string;
  from_logo: string;
  from_amount: string;
  to_currency_id: string;
  to_symbol: string;
  to_name: string;
  to_logo: string;
  to_amount: string;
  conversion_rate: string;
  target_rate: string;
  fee_amount: string;
  account_type: string;
  status: string;
  expires_at: Date;
  created_at: Date;
  completed_at: Date;
}

interface Balance {
  currency_id: string;
  symbol: string;
  available_balance: string;
}

export default async function convertRoutes(app: FastifyInstance) {
  // Get market prices for trending/newly listed coins (unique base currencies only)
  app.get('/market-prices', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Get unique base currencies with their USDT price (or highest price if no USDT pair)
      const result = await db.query<MarketPrice>(`
        SELECT DISTINCT ON (UPPER(bc.symbol))
          mp.id,
          mp.base_currency_id,
          bc.symbol as base_symbol,
          bc.name as base_name,
          bc.logo_url as base_logo,
          mp.quote_currency_id,
          qc.symbol as quote_symbol,
          qc.name as quote_name,
          qc.logo_url as quote_logo,
          mp.price::text,
          COALESCE(mp.change_24h_percent, 0)::text as change_24h_percent
        FROM market_prices mp
        JOIN currencies bc ON mp.base_currency_id = bc.id
        JOIN currencies qc ON mp.quote_currency_id = qc.id
        WHERE bc.is_active = TRUE 
          AND qc.is_active = TRUE
          AND UPPER(bc.symbol) != 'USDT'
        ORDER BY UPPER(bc.symbol), 
          CASE WHEN UPPER(qc.symbol) = 'USDT' THEN 0 ELSE 1 END,
          mp.price DESC
      `);

      // Clean currency names - remove chain info like "(ETH)", "(BSC)", "(SOLANA)" etc
      const cleanName = (name: string): string => {
        return name.replace(/\s*\([A-Z0-9]+\)\s*$/i, '').trim();
      };

      // Fix logo URLs and clean names
      const withFixedLogos = result.rows.map(row => ({
        ...row,
        base_name: cleanName(row.base_name),
        quote_name: cleanName(row.quote_name),
        base_logo: `https://cryptologos.cc/logos/${row.base_symbol.toLowerCase()}-${row.base_symbol.toLowerCase()}-logo.svg?v=040`,
        quote_logo: `https://cryptologos.cc/logos/${row.quote_symbol.toLowerCase()}-${row.quote_symbol.toLowerCase()}-logo.svg?v=040`,
      }));

      return { success: true, data: withFixedLogos };
    } catch (error) {
      logger.error('Error fetching market prices', { error });
      return reply.status(500).send({ success: false, error: 'Failed to fetch market prices' });
    }
  });

  // Get all currencies available for conversion (unique symbols only)
  app.get('/currencies', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Select unique currencies by symbol, preferring the one with logo
      const result = await db.query<Currency>(`
        SELECT DISTINCT ON (UPPER(symbol))
          id,
          symbol,
          name,
          logo_url,
          decimals,
          is_active
        FROM currencies
        WHERE is_active = TRUE
        ORDER BY 
          UPPER(symbol),
          CASE WHEN logo_url IS NOT NULL AND logo_url != '' THEN 0 ELSE 1 END,
          created_at DESC
      `);

      // Sort the results by priority
      const sorted = result.rows.sort((a, b) => {
        const priority: Record<string, number> = { 'BTC': 1, 'ETH': 2, 'USDT': 3, 'USDC': 4, 'SOL': 5, 'BNB': 6 };
        const aPriority = priority[a.symbol.toUpperCase()] || 100;
        const bPriority = priority[b.symbol.toUpperCase()] || 100;
        if (aPriority !== bPriority) return aPriority - bPriority;
        return a.symbol.localeCompare(b.symbol);
      });

      // Clean currency names - remove chain info like "(ETH)", "(BSC)", "(SOLANA)" etc
      const cleanName = (name: string): string => {
        return name.replace(/\s*\([A-Z0-9]+\)\s*$/i, '').trim();
      };

      // Fix logo URLs and clean names
      const withFixedLogos = sorted.map(c => ({
        ...c,
        name: cleanName(c.name),
        logo_url: c.logo_url 
          ? (c.logo_url.startsWith('http') 
              ? c.logo_url 
              : `https://cryptologos.cc/logos/${c.symbol.toLowerCase()}-${c.symbol.toLowerCase()}-logo.svg?v=040`)
          : `https://cryptologos.cc/logos/${c.symbol.toLowerCase()}-${c.symbol.toLowerCase()}-logo.svg?v=040`
      }));

      return { success: true, data: withFixedLogos };
    } catch (error) {
      logger.error('Error fetching currencies', { error });
      return reply.status(500).send({ success: false, error: 'Failed to fetch currencies' });
    }
  });

  // Get conversion rate/quote between two currencies
  app.get('/quote', async (request: FastifyRequest<{
    Querystring: { from: string; to: string; amount?: string }
  }>, reply: FastifyReply) => {
    try {
      const { from, to, amount = '1' } = request.query;

      if (!from || !to) {
        return reply.status(400).send({ success: false, error: 'From and to currencies are required' });
      }

      // Get direct price or calculate through USDT
      let rate: number | null = null;
      let priceData: any = null;

      // Try direct pair first
      const directResult = await db.query<{ price: string }>(`
        SELECT mp.price::text
        FROM market_prices mp
        JOIN currencies bc ON mp.base_currency_id = bc.id
        JOIN currencies qc ON mp.quote_currency_id = qc.id
        WHERE UPPER(bc.symbol) = UPPER($1) AND UPPER(qc.symbol) = UPPER($2)
      `, [from, to]);

      if (directResult.rows.length > 0) {
        rate = parseFloat(directResult.rows[0].price);
      } else {
        // Try reverse pair
        const reverseResult = await db.query<{ price: string }>(`
          SELECT mp.price::text
          FROM market_prices mp
          JOIN currencies bc ON mp.base_currency_id = bc.id
          JOIN currencies qc ON mp.quote_currency_id = qc.id
          WHERE UPPER(bc.symbol) = UPPER($1) AND UPPER(qc.symbol) = UPPER($2)
        `, [to, from]);

        if (reverseResult.rows.length > 0) {
          rate = 1 / parseFloat(reverseResult.rows[0].price);
        } else {
          // Calculate through USDT
          const fromUsdtResult = await db.query<{ price: string }>(`
            SELECT mp.price::text
            FROM market_prices mp
            JOIN currencies bc ON mp.base_currency_id = bc.id
            JOIN currencies qc ON mp.quote_currency_id = qc.id
            WHERE UPPER(bc.symbol) = UPPER($1) AND UPPER(qc.symbol) = 'USDT'
          `, [from]);

          const toUsdtResult = await db.query<{ price: string }>(`
            SELECT mp.price::text
            FROM market_prices mp
            JOIN currencies bc ON mp.base_currency_id = bc.id
            JOIN currencies qc ON mp.quote_currency_id = qc.id
            WHERE UPPER(bc.symbol) = UPPER($1) AND UPPER(qc.symbol) = 'USDT'
          `, [to]);

          if (fromUsdtResult.rows.length > 0 && toUsdtResult.rows.length > 0) {
            const fromUsdt = parseFloat(fromUsdtResult.rows[0].price);
            const toUsdt = parseFloat(toUsdtResult.rows[0].price);
            rate = fromUsdt / toUsdt;
          } else if (fromUsdtResult.rows.length > 0 && to.toUpperCase() === 'USDT') {
            rate = parseFloat(fromUsdtResult.rows[0].price);
          } else if (toUsdtResult.rows.length > 0 && from.toUpperCase() === 'USDT') {
            rate = 1 / parseFloat(toUsdtResult.rows[0].price);
          }
        }
      }

      if (rate === null) {
        return reply.status(400).send({ success: false, error: 'Conversion rate not available for this pair' });
      }

      const fromAmount = parseFloat(amount);
      const toAmount = fromAmount * rate;

      // Get currency details
      const currencyDetails = await db.query<{ symbol: string; name: string; logo_url: string; id: string }>(`
        SELECT id, symbol, name, logo_url FROM currencies WHERE UPPER(symbol) IN (UPPER($1), UPPER($2))
      `, [from, to]);

      const fromCurrency = currencyDetails.rows.find(c => c.symbol.toUpperCase() === from.toUpperCase());
      const toCurrency = currencyDetails.rows.find(c => c.symbol.toUpperCase() === to.toUpperCase());

      return {
        success: true,
        data: {
          from: {
            symbol: from.toUpperCase(),
            name: fromCurrency?.name,
            logo: fromCurrency?.logo_url,
            id: fromCurrency?.id,
            amount: fromAmount.toString()
          },
          to: {
            symbol: to.toUpperCase(),
            name: toCurrency?.name,
            logo: toCurrency?.logo_url,
            id: toCurrency?.id,
            amount: toAmount.toFixed(8)
          },
          rate: rate.toString(),
          fee: '0',
          expiresIn: 30 // Quote valid for 30 seconds
        }
      };
    } catch (error) {
      logger.error('Error getting conversion quote', { error });
      return reply.status(500).send({ success: false, error: 'Failed to get quote' });
    }
  });

  // Execute instant conversion (authenticated)
  app.post('/instant', {
    preHandler: [app.authenticate]
  }, async (request: FastifyRequest<{
    Body: {
      fromCurrencyId: string;
      toCurrencyId: string;
      fromAmount: string;
      accountType?: string;
    }
  }>, reply: FastifyReply) => {
    const client = await db.getClient();
    
    try {
      const userId = (request as any).user.id;
      const { fromCurrencyId, toCurrencyId, fromAmount, accountType = 'funding' } = request.body;

      if (!fromCurrencyId || !toCurrencyId || !fromAmount) {
        return reply.status(400).send({ success: false, error: 'Missing required fields' });
      }

      const amount = parseFloat(fromAmount);
      if (isNaN(amount) || amount <= 0) {
        return reply.status(400).send({ success: false, error: 'Invalid amount' });
      }

      await client.query('BEGIN');

      // Get currency symbols for rate calculation
      const currencyResult = await client.query<{ id: string; symbol: string; name: string; logo_url: string }>(`
        SELECT id, symbol, name, logo_url FROM currencies WHERE id IN ($1, $2)
      `, [fromCurrencyId, toCurrencyId]);

      const fromCurrency = currencyResult.rows.find(c => c.id === fromCurrencyId);
      const toCurrency = currencyResult.rows.find(c => c.id === toCurrencyId);

      if (!fromCurrency || !toCurrency) {
        await client.query('ROLLBACK');
        return reply.status(400).send({ success: false, error: 'Invalid currencies' });
      }

      // Check user balance
      const balanceResult = await client.query<{ available_balance: string }>(`
        SELECT available_balance::text FROM user_balances 
        WHERE user_id = $1 AND currency_id = $2 AND account_type = $3
      `, [userId, fromCurrencyId, accountType]);

      const availableBalance = balanceResult.rows.length > 0 
        ? parseFloat(balanceResult.rows[0].available_balance) 
        : 0;

      if (availableBalance < amount) {
        await client.query('ROLLBACK');
        return reply.status(400).send({ success: false, error: 'Insufficient balance' });
      }

      // Get conversion rate
      let rate: number | null = null;

      // Try direct pair
      const directResult = await client.query<{ price: string }>(`
        SELECT mp.price::text
        FROM market_prices mp
        WHERE mp.base_currency_id = $1 AND mp.quote_currency_id = $2
      `, [fromCurrencyId, toCurrencyId]);

      if (directResult.rows.length > 0) {
        rate = parseFloat(directResult.rows[0].price);
      } else {
        // Try reverse
        const reverseResult = await client.query<{ price: string }>(`
          SELECT mp.price::text
          FROM market_prices mp
          WHERE mp.base_currency_id = $1 AND mp.quote_currency_id = $2
        `, [toCurrencyId, fromCurrencyId]);

        if (reverseResult.rows.length > 0) {
          rate = 1 / parseFloat(reverseResult.rows[0].price);
        } else {
          // Calculate through USDT
          const usdtId = await client.query<{ id: string }>(`SELECT id FROM currencies WHERE UPPER(symbol) = 'USDT' LIMIT 1`);
          
          if (usdtId.rows.length > 0) {
            const usdtCurrencyId = usdtId.rows[0].id;
            
            const fromUsdtResult = await client.query<{ price: string }>(`
              SELECT price::text FROM market_prices WHERE base_currency_id = $1 AND quote_currency_id = $2
            `, [fromCurrencyId, usdtCurrencyId]);
            
            const toUsdtResult = await client.query<{ price: string }>(`
              SELECT price::text FROM market_prices WHERE base_currency_id = $1 AND quote_currency_id = $2
            `, [toCurrencyId, usdtCurrencyId]);

            if (fromUsdtResult.rows.length > 0 && toUsdtResult.rows.length > 0) {
              rate = parseFloat(fromUsdtResult.rows[0].price) / parseFloat(toUsdtResult.rows[0].price);
            } else if (fromCurrencyId === usdtCurrencyId && toUsdtResult.rows.length > 0) {
              rate = 1 / parseFloat(toUsdtResult.rows[0].price);
            } else if (toCurrencyId === usdtCurrencyId && fromUsdtResult.rows.length > 0) {
              rate = parseFloat(fromUsdtResult.rows[0].price);
            }
          }
        }
      }

      if (rate === null) {
        await client.query('ROLLBACK');
        return reply.status(400).send({ success: false, error: 'Conversion rate not available' });
      }

      const toAmount = amount * rate;

      // Deduct from balance
      await client.query(`
        UPDATE user_balances 
        SET available_balance = available_balance - $1, updated_at = NOW()
        WHERE user_id = $2 AND currency_id = $3 AND account_type = $4
      `, [amount, userId, fromCurrencyId, accountType]);

      // Add to balance (insert or update)
      await client.query(`
        INSERT INTO user_balances (user_id, currency_id, account_type, available_balance, total_balance)
        VALUES ($1, $2, $3, $4, $4)
        ON CONFLICT (user_id, currency_id, account_type)
        DO UPDATE SET 
          available_balance = user_balances.available_balance + $4,
          total_balance = user_balances.total_balance + $4,
          updated_at = NOW()
      `, [userId, toCurrencyId, accountType, toAmount]);

      // Record the conversion
      const conversionResult = await client.query<{ id: string }>(`
        INSERT INTO conversions (
          user_id, conversion_type, from_currency_id, from_amount, 
          to_currency_id, to_amount, conversion_rate, 
          account_type, status, completed_at, ip_address
        ) VALUES ($1, 'instant', $2, $3, $4, $5, $6, $7, 'completed', NOW(), $8)
        RETURNING id
      `, [userId, fromCurrencyId, amount, toCurrencyId, toAmount, rate, accountType, request.ip]);

      await client.query('COMMIT');

      auditLog({
        action: 'instant_conversion',
        userId,
        details: {
          conversionId: conversionResult.rows[0].id,
          from: `${amount} ${fromCurrency.symbol}`,
          to: `${toAmount} ${toCurrency.symbol}`,
          rate
        }
      });

      return {
        success: true,
        data: {
          id: conversionResult.rows[0].id,
          from: {
            currency: fromCurrency.symbol,
            amount: amount.toString()
          },
          to: {
            currency: toCurrency.symbol,
            amount: toAmount.toFixed(8)
          },
          rate: rate.toString(),
          status: 'completed'
        }
      };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error executing instant conversion', { error });
      return reply.status(500).send({ success: false, error: 'Failed to execute conversion' });
    } finally {
      client.release();
    }
  });

  // Place limit conversion order (authenticated)
  app.post('/limit', {
    preHandler: [app.authenticate]
  }, async (request: FastifyRequest<{
    Body: {
      fromCurrencyId: string;
      toCurrencyId: string;
      fromAmount: string;
      targetRate: string;
      expiresInDays?: number;
      accountType?: string;
    }
  }>, reply: FastifyReply) => {
    const client = await db.getClient();
    
    try {
      const userId = (request as any).user.id;
      const { 
        fromCurrencyId, 
        toCurrencyId, 
        fromAmount, 
        targetRate,
        expiresInDays = 30,
        accountType = 'funding' 
      } = request.body;

      if (!fromCurrencyId || !toCurrencyId || !fromAmount || !targetRate) {
        return reply.status(400).send({ success: false, error: 'Missing required fields' });
      }

      const amount = parseFloat(fromAmount);
      const rate = parseFloat(targetRate);
      
      if (isNaN(amount) || amount <= 0 || isNaN(rate) || rate <= 0) {
        return reply.status(400).send({ success: false, error: 'Invalid amount or rate' });
      }

      await client.query('BEGIN');

      // Get currency details
      const currencyResult = await client.query<{ id: string; symbol: string; name: string }>(`
        SELECT id, symbol, name FROM currencies WHERE id IN ($1, $2)
      `, [fromCurrencyId, toCurrencyId]);

      const fromCurrency = currencyResult.rows.find(c => c.id === fromCurrencyId);
      const toCurrency = currencyResult.rows.find(c => c.id === toCurrencyId);

      if (!fromCurrency || !toCurrency) {
        await client.query('ROLLBACK');
        return reply.status(400).send({ success: false, error: 'Invalid currencies' });
      }

      // Check user balance
      const balanceResult = await client.query<{ available_balance: string }>(`
        SELECT available_balance::text FROM user_balances 
        WHERE user_id = $1 AND currency_id = $2 AND account_type = $3
      `, [userId, fromCurrencyId, accountType]);

      const availableBalance = balanceResult.rows.length > 0 
        ? parseFloat(balanceResult.rows[0].available_balance) 
        : 0;

      if (availableBalance < amount) {
        await client.query('ROLLBACK');
        return reply.status(400).send({ success: false, error: 'Insufficient balance' });
      }

      const toAmount = amount * rate;
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + expiresInDays);

      // Lock the funds (reduce available balance but keep total)
      await client.query(`
        UPDATE user_balances 
        SET available_balance = available_balance - $1, updated_at = NOW()
        WHERE user_id = $2 AND currency_id = $3 AND account_type = $4
      `, [amount, userId, fromCurrencyId, accountType]);

      // Create limit order
      const orderResult = await client.query<{ id: string }>(`
        INSERT INTO conversions (
          user_id, conversion_type, from_currency_id, from_amount, 
          to_currency_id, to_amount, conversion_rate, target_rate,
          account_type, status, expires_at, ip_address
        ) VALUES ($1, 'limit', $2, $3, $4, $5, $6, $6, $7, 'pending', $8, $9)
        RETURNING id
      `, [userId, fromCurrencyId, amount, toCurrencyId, toAmount, rate, accountType, expiresAt, request.ip]);

      await client.query('COMMIT');

      auditLog({
        action: 'limit_conversion_placed',
        userId,
        details: {
          orderId: orderResult.rows[0].id,
          from: `${amount} ${fromCurrency.symbol}`,
          targetRate: rate,
          expiresAt
        }
      });

      return {
        success: true,
        data: {
          id: orderResult.rows[0].id,
          from: {
            currency: fromCurrency.symbol,
            amount: amount.toString()
          },
          to: {
            currency: toCurrency.symbol,
            estimatedAmount: toAmount.toFixed(8)
          },
          targetRate: rate.toString(),
          expiresAt: expiresAt.toISOString(),
          status: 'pending'
        }
      };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error placing limit conversion order', { error });
      return reply.status(500).send({ success: false, error: 'Failed to place limit order' });
    } finally {
      client.release();
    }
  });

  // Cancel limit order (authenticated)
  app.post('/limit/:orderId/cancel', {
    preHandler: [app.authenticate]
  }, async (request: FastifyRequest<{
    Params: { orderId: string }
  }>, reply: FastifyReply) => {
    const client = await db.getClient();
    
    try {
      const userId = (request as any).user.id;
      const { orderId } = request.params;

      await client.query('BEGIN');

      // Get order details
      const orderResult = await client.query<Conversion>(`
        SELECT * FROM conversions 
        WHERE id = $1 AND user_id = $2 AND conversion_type = 'limit' AND status = 'pending'
      `, [orderId, userId]);

      if (orderResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return reply.status(404).send({ success: false, error: 'Order not found or already processed' });
      }

      const order = orderResult.rows[0];

      // Refund the locked amount
      await client.query(`
        UPDATE user_balances 
        SET available_balance = available_balance + $1, updated_at = NOW()
        WHERE user_id = $2 AND currency_id = $3 AND account_type = $4
      `, [order.from_amount, userId, order.from_currency_id, order.account_type]);

      // Update order status
      await client.query(`
        UPDATE conversions 
        SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
        WHERE id = $1
      `, [orderId]);

      await client.query('COMMIT');

      return { success: true, message: 'Order cancelled successfully' };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error cancelling limit order', { error });
      return reply.status(500).send({ success: false, error: 'Failed to cancel order' });
    } finally {
      client.release();
    }
  });

  // Get active limit orders (authenticated)
  app.get('/orders/active', {
    preHandler: [app.authenticate]
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = (request as any).user.id;

      const result = await db.query<Conversion>(`
        SELECT 
          c.id, c.conversion_type, c.from_amount::text, c.to_amount::text,
          c.conversion_rate::text, c.target_rate::text, c.account_type,
          c.status, c.expires_at, c.created_at,
          fc.symbol as from_symbol, fc.name as from_name, fc.logo_url as from_logo,
          tc.symbol as to_symbol, tc.name as to_name, tc.logo_url as to_logo
        FROM conversions c
        JOIN currencies fc ON c.from_currency_id = fc.id
        JOIN currencies tc ON c.to_currency_id = tc.id
        WHERE c.user_id = $1 AND c.conversion_type = 'limit' AND c.status = 'pending'
        ORDER BY c.created_at DESC
      `, [userId]);

      return { success: true, data: result.rows };
    } catch (error) {
      logger.error('Error fetching active orders', { error });
      return reply.status(500).send({ success: false, error: 'Failed to fetch orders' });
    }
  });

  // Get conversion history (authenticated)
  app.get('/history', {
    preHandler: [app.authenticate]
  }, async (request: FastifyRequest<{
    Querystring: { page?: string; limit?: string; type?: string; status?: string }
  }>, reply: FastifyReply) => {
    try {
      const userId = (request as any).user.id;
      const page = parseInt(request.query.page || '1');
      const limit = Math.min(parseInt(request.query.limit || '20'), 100);
      const offset = (page - 1) * limit;
      const type = request.query.type;
      const status = request.query.status;

      let whereClause = 'WHERE c.user_id = $1';
      const params: any[] = [userId];
      let paramIndex = 2;

      if (type) {
        whereClause += ` AND c.conversion_type = $${paramIndex}`;
        params.push(type);
        paramIndex++;
      }

      if (status) {
        whereClause += ` AND c.status = $${paramIndex}`;
        params.push(status);
        paramIndex++;
      }

      const countResult = await db.query<{ count: string }>(`
        SELECT COUNT(*) as count FROM conversions c ${whereClause}
      `, params);

      const result = await db.query<Conversion>(`
        SELECT 
          c.id, c.conversion_type, c.from_amount::text, c.to_amount::text,
          c.conversion_rate::text, c.target_rate::text, c.fee_amount::text,
          c.account_type, c.status, c.expires_at, c.created_at, c.completed_at,
          fc.symbol as from_symbol, fc.name as from_name, fc.logo_url as from_logo,
          tc.symbol as to_symbol, tc.name as to_name, tc.logo_url as to_logo
        FROM conversions c
        JOIN currencies fc ON c.from_currency_id = fc.id
        JOIN currencies tc ON c.to_currency_id = tc.id
        ${whereClause}
        ORDER BY c.created_at DESC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `, [...params, limit, offset]);

      return {
        success: true,
        data: result.rows,
        pagination: {
          page,
          limit,
          total: parseInt(countResult.rows[0].count),
          totalPages: Math.ceil(parseInt(countResult.rows[0].count) / limit)
        }
      };
    } catch (error) {
      logger.error('Error fetching conversion history', { error });
      return reply.status(500).send({ success: false, error: 'Failed to fetch history' });
    }
  });

  // Get user balances for conversion (authenticated)
  app.get('/balances', {
    preHandler: [app.authenticate]
  }, async (request: FastifyRequest<{
    Querystring: { accountType?: string }
  }>, reply: FastifyReply) => {
    try {
      const userId = (request as any).user.id;
      const accountType = request.query.accountType || 'funding';

      const result = await db.query<Balance>(`
        SELECT 
          ub.currency_id,
          c.symbol,
          c.name,
          c.logo_url,
          ub.available_balance::text,
          ub.total_balance::text
        FROM user_balances ub
        JOIN currencies c ON ub.currency_id = c.id
        WHERE ub.user_id = $1 AND ub.account_type = $2 AND ub.available_balance > 0
        ORDER BY ub.available_balance DESC
      `, [userId, accountType]);

      return { success: true, data: result.rows };
    } catch (error) {
      logger.error('Error fetching balances', { error });
      return reply.status(500).send({ success: false, error: 'Failed to fetch balances' });
    }
  });
}
