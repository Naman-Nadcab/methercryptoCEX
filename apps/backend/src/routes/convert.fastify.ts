import crypto from 'node:crypto';
import { Decimal, type DecimalInstance } from '../lib/decimal.js';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../lib/database.js';
import { redis } from '../lib/redis.js';
import { getTokenIdsByCurrencyId } from '../lib/currency-resolver.js';
import { insertBalanceLedger } from '../lib/balance-ledger.js';

const ROUND_DOWN = 1;
const CONVERT_IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;
const CONVERT_IDEMPOTENCY_LOCK_TTL_SECONDS = 30;
const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

function buildConvertInstantRequestHash(body: Record<string, unknown>): string {
  const normalized = {
    fromCurrencyId: String(body.fromCurrencyId ?? '').trim(),
    toCurrencyId: String(body.toCurrencyId ?? '').trim(),
    fromAmount: String(body.fromAmount ?? '').trim(),
    accountType: String(body.accountType ?? 'funding').trim(),
  };
  return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

function buildConvertLimitRequestHash(body: Record<string, unknown>): string {
  const normalized = {
    fromCurrencyId: String(body.fromCurrencyId ?? '').trim(),
    toCurrencyId: String(body.toCurrencyId ?? '').trim(),
    fromAmount: String(body.fromAmount ?? '').trim(),
    targetRate: String(body.targetRate ?? '').trim(),
    expiresInDays: body.expiresInDays != null ? String(body.expiresInDays).trim() : '',
    accountType: String(body.accountType ?? 'funding').trim(),
  };
  return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

interface ConvertIdempotencyCache {
  requestHash: string;
  response: { success: true; data: Record<string, unknown> };
}

const RATE_PRECISION = 18;
const AMOUNT_PRECISION = 8;
import { logger, auditLog } from '../lib/logger.js';
import { ensureUserBalanceRow, assertUserBalanceUpdated, CHAIN_ID_GLOBAL } from '../lib/user-balance-helper.js';
import { readUserBalances } from '../services/balance/readUserBalances.js';

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
      let rate: DecimalInstance | null = null;
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
        rate = new Decimal(directResult.rows[0]!.price).toDecimalPlaces(RATE_PRECISION, ROUND_DOWN);
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
          rate = new Decimal(1).div(reverseResult.rows[0]!.price).toDecimalPlaces(RATE_PRECISION, ROUND_DOWN);
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
            const fromUsdt = new Decimal(fromUsdtResult.rows[0]!.price).toDecimalPlaces(RATE_PRECISION, ROUND_DOWN);
            const toUsdt = new Decimal(toUsdtResult.rows[0]!.price).toDecimalPlaces(RATE_PRECISION, ROUND_DOWN);
            rate = fromUsdt.div(toUsdt).toDecimalPlaces(RATE_PRECISION, ROUND_DOWN);
          } else if (fromUsdtResult.rows.length > 0 && to.toUpperCase() === 'USDT') {
            rate = new Decimal(fromUsdtResult.rows[0]!.price).toDecimalPlaces(RATE_PRECISION, ROUND_DOWN);
          } else if (toUsdtResult.rows.length > 0 && from.toUpperCase() === 'USDT') {
            rate = new Decimal(1).div(toUsdtResult.rows[0]!.price).toDecimalPlaces(RATE_PRECISION, ROUND_DOWN);
          }
        }
      }

      if (rate === null) {
        return reply.status(400).send({ success: false, error: 'Conversion rate not available for this pair' });
      }

      const fromAmount = new Decimal(amount).toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN);
      const toAmount = fromAmount.times(rate).toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN);

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
            amount: toAmount.toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN).toString()
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
  app.post<{
    Body: {
      fromCurrencyId: string;
      toCurrencyId: string;
      fromAmount: string;
      accountType?: string;
    };
  }>('/instant', {
    preHandler: [app.authenticate]
  }, async (request, reply) => {
    const userId = (request as any).user.id;
    let { fromCurrencyId, toCurrencyId, fromAmount, accountType = 'funding' } = request.body;

    const idempotencyKeyRaw = (request.headers[IDEMPOTENCY_KEY_HEADER] ?? request.headers['Idempotency-Key']) as string | undefined;
    const idempotencyKey = typeof idempotencyKeyRaw === 'string' ? idempotencyKeyRaw.trim() : '';
    if (!idempotencyKey) {
      return reply.status(400).send({
        success: false,
        error: { code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'Idempotency-Key header is required for convert requests.' },
      });
    }
    if (idempotencyKey.length > 256) {
      return reply.status(400).send({
        success: false,
        error: { code: 'IDEMPOTENCY_KEY_INVALID', message: 'Idempotency-Key must be at most 256 characters.' },
      });
    }
    const instantRequestHash = buildConvertInstantRequestHash(request.body as Record<string, unknown>);
    const instantRedisKey = `convert:instant:idempotency:${userId}:${idempotencyKey}`;
    const instantCached = await redis.getJson<ConvertIdempotencyCache>(instantRedisKey);
    if (instantCached) {
      if (instantCached.requestHash !== instantRequestHash) {
        return reply.status(409).send({
          success: false,
          error: {
            code: 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_BODY',
            message: 'Idempotency-Key was already used with a different request body. Use a new key or the same request body.',
          },
        });
      }
      return reply.status(200).send(instantCached.response);
    }
    const instantLockKey = `convert:instant:lock:${userId}:${idempotencyKey}`;
    const instantLockAcquired = await redis.setNxEx(instantLockKey, '1', CONVERT_IDEMPOTENCY_LOCK_TTL_SECONDS);
    if (!instantLockAcquired) {
      return reply.status(409).send({
        success: false,
        error: {
          code: 'DUPLICATE_REQUEST',
          message: 'A convert with this Idempotency-Key is already in progress. Retry after a few seconds.',
        },
      });
    }

    const allowedAccountTypes = ['funding', 'spot', 'trading'];
    if (!allowedAccountTypes.includes(accountType)) accountType = 'funding';

    if (!fromCurrencyId || !toCurrencyId || !fromAmount) {
      return reply.status(400).send({ success: false, error: 'Missing required fields' });
    }

    let amountDec: DecimalInstance;
    try {
      amountDec = new Decimal(fromAmount).toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN);
    } catch {
      return reply.status(400).send({ success: false, error: 'Invalid amount' });
    }
    if (amountDec.lte(0) || !amountDec.isFinite()) {
      return reply.status(400).send({ success: false, error: 'Invalid amount' });
    }

    try {
      const { fromCurrency, toCurrency, conversionId, amountStr, toAmountStr, rateStr } = await db.transaction(async (client) => {
        const currencyResult = await client.query<{ id: string; symbol: string; name: string; logo_url: string }>(`
          SELECT id, symbol, name, logo_url FROM currencies WHERE id IN ($1, $2)
        `, [fromCurrencyId, toCurrencyId]);

        const fromCurrency = currencyResult.rows.find(c => c.id === fromCurrencyId);
        const toCurrency = currencyResult.rows.find(c => c.id === toCurrencyId);

        if (!fromCurrency || !toCurrency) {
          const err = new Error('Invalid currencies') as Error & { statusCode?: number };
          err.statusCode = 400;
          throw err;
        }

        const balanceResult = await client.query<{ available_balance: string }>(`
          SELECT available_balance::text FROM user_balances 
          WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = $4
        `, [userId, fromCurrencyId, CHAIN_ID_GLOBAL, accountType]);

        const availableBalance = balanceResult.rows.length > 0
          ? new Decimal(balanceResult.rows[0]!.available_balance).toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN)
          : new Decimal(0);

        if (availableBalance.lt(amountDec)) {
          const err = new Error('Insufficient balance') as Error & { statusCode?: number };
          err.statusCode = 400;
          throw err;
        }

        let rateDec: DecimalInstance | null = null;

        const directResult = await client.query<{ price: string }>(`
          SELECT mp.price::text
          FROM market_prices mp
          WHERE mp.base_currency_id = $1 AND mp.quote_currency_id = $2
        `, [fromCurrencyId, toCurrencyId]);

        if (directResult.rows.length > 0) {
          rateDec = new Decimal(directResult.rows[0]!.price).toDecimalPlaces(RATE_PRECISION, ROUND_DOWN);
        } else {
          const reverseResult = await client.query<{ price: string }>(`
            SELECT mp.price::text
            FROM market_prices mp
            WHERE mp.base_currency_id = $1 AND mp.quote_currency_id = $2
          `, [toCurrencyId, fromCurrencyId]);

          if (reverseResult.rows.length > 0) {
            rateDec = new Decimal(1).div(reverseResult.rows[0]!.price).toDecimalPlaces(RATE_PRECISION, ROUND_DOWN);
          } else {
            const usdtId = await client.query<{ id: string }>(`SELECT id FROM currencies WHERE UPPER(symbol) = 'USDT' LIMIT 1`);
            if (usdtId.rows.length > 0) {
              const usdtCurrencyId = usdtId.rows[0]!.id;
              const fromUsdtResult = await client.query<{ price: string }>(`
                SELECT price::text FROM market_prices WHERE base_currency_id = $1 AND quote_currency_id = $2
              `, [fromCurrencyId, usdtCurrencyId]);
              const toUsdtResult = await client.query<{ price: string }>(`
                SELECT price::text FROM market_prices WHERE base_currency_id = $1 AND quote_currency_id = $2
              `, [toCurrencyId, usdtCurrencyId]);

              if (fromUsdtResult.rows.length > 0 && toUsdtResult.rows.length > 0) {
                const fromUsdt = new Decimal(fromUsdtResult.rows[0]!.price).toDecimalPlaces(RATE_PRECISION, ROUND_DOWN);
                const toUsdt = new Decimal(toUsdtResult.rows[0]!.price).toDecimalPlaces(RATE_PRECISION, ROUND_DOWN);
                rateDec = fromUsdt.div(toUsdt).toDecimalPlaces(RATE_PRECISION, ROUND_DOWN);
              } else if (fromCurrencyId === usdtCurrencyId && toUsdtResult.rows.length > 0) {
                rateDec = new Decimal(1).div(toUsdtResult.rows[0]!.price).toDecimalPlaces(RATE_PRECISION, ROUND_DOWN);
              } else if (toCurrencyId === usdtCurrencyId && fromUsdtResult.rows.length > 0) {
                rateDec = new Decimal(fromUsdtResult.rows[0]!.price).toDecimalPlaces(RATE_PRECISION, ROUND_DOWN);
              }
            }
          }
        }

        if (rateDec === null) {
          const err = new Error('Conversion rate not available') as Error & { statusCode?: number };
          err.statusCode = 400;
          throw err;
        }

        const toAmountDec = amountDec.times(rateDec).toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN);
        const amountStr = amountDec.toString();
        const toAmountStr = toAmountDec.toString();
        const rateStr = rateDec.toString();
        const conversionId = crypto.randomUUID();

        await ensureUserBalanceRow(userId, fromCurrencyId, CHAIN_ID_GLOBAL, accountType, client);
        const deductSel = await client.query<{ available_balance: string }>(
          `SELECT available_balance::text FROM user_balances
           WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = $4 FOR UPDATE`,
          [userId, fromCurrencyId, CHAIN_ID_GLOBAL, accountType]
        );
        if (deductSel.rows.length === 0) throw new Error('convert_instant: from balance row not found');
        const fromAvBefore = new Decimal(deductSel.rows[0]!.available_balance);
        const deductUpd = await client.query(`
          UPDATE user_balances 
          SET available_balance = available_balance - $1, updated_at = NOW()
          WHERE user_id = $2 AND currency_id = $3 AND COALESCE(chain_id, '') = $4 AND account_type = $5
        `, [amountStr, userId, fromCurrencyId, CHAIN_ID_GLOBAL, accountType]);
        assertUserBalanceUpdated('convert_instant_deduct', deductUpd, userId, fromCurrencyId, accountType, CHAIN_ID_GLOBAL);
        await insertBalanceLedger({
          client,
          userId,
          currencyId: fromCurrencyId,
          accountType,
          debit: amountStr,
          credit: '0',
          balanceBefore: fromAvBefore.toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN).toString(),
          balanceAfter: fromAvBefore.minus(amountStr).toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN).toString(),
          referenceType: 'internal_transfer',
          referenceId: conversionId,
          balanceType: 'available',
        });

        await ensureUserBalanceRow(userId, toCurrencyId, CHAIN_ID_GLOBAL, accountType, client);
        const addSel = await client.query<{ available_balance: string }>(
          `SELECT available_balance::text FROM user_balances
           WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = $4 FOR UPDATE`,
          [userId, toCurrencyId, CHAIN_ID_GLOBAL, accountType]
        );
        if (addSel.rows.length === 0) throw new Error('convert_instant: to balance row not found');
        const toAvBefore = new Decimal(addSel.rows[0]!.available_balance);
        const addUpd = await client.query(`
          UPDATE user_balances
          SET available_balance = available_balance + $1, updated_at = NOW()
          WHERE user_id = $2 AND currency_id = $3 AND COALESCE(chain_id, '') = $4 AND account_type = $5
        `, [toAmountStr, userId, toCurrencyId, CHAIN_ID_GLOBAL, accountType]);
        assertUserBalanceUpdated('convert_instant_add', addUpd, userId, toCurrencyId, accountType, CHAIN_ID_GLOBAL);
        await insertBalanceLedger({
          client,
          userId,
          currencyId: toCurrencyId,
          accountType,
          debit: '0',
          credit: toAmountStr,
          balanceBefore: toAvBefore.toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN).toString(),
          balanceAfter: toAvBefore.plus(toAmountStr).toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN).toString(),
          referenceType: 'internal_transfer',
          referenceId: conversionId,
          balanceType: 'available',
        });

        await client.query(`
          INSERT INTO conversions (
            id, user_id, conversion_type, from_currency_id, from_amount, 
            to_currency_id, to_amount, conversion_rate, 
            account_type, status, completed_at, ip_address
          ) VALUES ($1, $2, 'instant', $3, $4, $5, $6, $7, $8, 'completed', NOW(), $9)
        `, [conversionId, userId, fromCurrencyId, amountStr, toCurrencyId, toAmountStr, rateStr, accountType, request.ip]);

        return { fromCurrency, toCurrency, conversionId, amountStr, toAmountStr, rateStr };
      });

      const fromTokenIds = await getTokenIdsByCurrencyId(fromCurrencyId);
      const toTokenIds = await getTokenIdsByCurrencyId(toCurrencyId);
      for (const tid of fromTokenIds) {
        try { await redis.del(`balance:${userId}:${tid}`); } catch { /* best effort */ }
      }
      for (const tid of toTokenIds) {
        try { await redis.del(`balance:${userId}:${tid}`); } catch { /* best effort */ }
      }

      auditLog('instant_conversion', userId, {
        conversionId,
        from: `${amountStr} ${fromCurrency.symbol}`,
        to: `${toAmountStr} ${toCurrency.symbol}`,
        rate: rateStr
      }, request.ip);

      const instantResponse = {
        success: true as const,
        data: {
          id: conversionId,
          from: { currency: fromCurrency.symbol, amount: amountStr },
          to: { currency: toCurrency.symbol, amount: toAmountStr },
          rate: rateStr,
          status: 'completed'
        }
      };
      try {
        await redis.setJson(instantRedisKey, { requestHash: instantRequestHash, response: instantResponse }, CONVERT_IDEMPOTENCY_TTL_SECONDS);
      } catch {
        /* best effort */
      }
      return reply.send(instantResponse);
    } catch (error) {
      const err = error as Error & { statusCode?: number };
      if (err.statusCode === 400) {
        return reply.status(400).send({ success: false, error: err.message });
      }
      logger.error('Error executing instant conversion', { error });
      return reply.status(500).send({ success: false, error: 'Failed to execute conversion' });
    }
  });

  // Place limit conversion order (authenticated)
  app.post<{
    Body: {
      fromCurrencyId: string;
      toCurrencyId: string;
      fromAmount: string;
      targetRate: string;
      expiresInDays?: number;
      accountType?: string;
    };
  }>('/limit', {
    preHandler: [app.authenticate]
  }, async (request, reply) => {
    const userId = (request as any).user.id;
    let { fromCurrencyId, toCurrencyId, fromAmount, targetRate, expiresInDays = 30, accountType = 'funding' } = request.body;

    const limitIdempotencyKeyRaw = (request.headers[IDEMPOTENCY_KEY_HEADER] ?? request.headers['Idempotency-Key']) as string | undefined;
    const limitIdempotencyKey = typeof limitIdempotencyKeyRaw === 'string' ? limitIdempotencyKeyRaw.trim() : '';
    if (!limitIdempotencyKey) {
      return reply.status(400).send({
        success: false,
        error: { code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'Idempotency-Key header is required for convert requests.' },
      });
    }
    if (limitIdempotencyKey.length > 256) {
      return reply.status(400).send({
        success: false,
        error: { code: 'IDEMPOTENCY_KEY_INVALID', message: 'Idempotency-Key must be at most 256 characters.' },
      });
    }
    const limitRequestHash = buildConvertLimitRequestHash(request.body as Record<string, unknown>);
    const limitRedisKey = `convert:limit:idempotency:${userId}:${limitIdempotencyKey}`;
    const limitCached = await redis.getJson<ConvertIdempotencyCache>(limitRedisKey);
    if (limitCached) {
      if (limitCached.requestHash !== limitRequestHash) {
        return reply.status(409).send({
          success: false,
          error: {
            code: 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_BODY',
            message: 'Idempotency-Key was already used with a different request body. Use a new key or the same request body.',
          },
        });
      }
      return reply.status(200).send(limitCached.response);
    }
    const limitLockKey = `convert:limit:lock:${userId}:${limitIdempotencyKey}`;
    const limitLockAcquired = await redis.setNxEx(limitLockKey, '1', CONVERT_IDEMPOTENCY_LOCK_TTL_SECONDS);
    if (!limitLockAcquired) {
      return reply.status(409).send({
        success: false,
        error: {
          code: 'DUPLICATE_REQUEST',
          message: 'A convert limit order with this Idempotency-Key is already in progress. Retry after a few seconds.',
        },
      });
    }

    const allowedAccountTypes = ['funding', 'spot', 'trading'];
    if (!allowedAccountTypes.includes(accountType)) accountType = 'funding';

    if (!fromCurrencyId || !toCurrencyId || !fromAmount || !targetRate) {
      return reply.status(400).send({ success: false, error: 'Missing required fields' });
    }

    let amountDec: DecimalInstance;
    let rateDec: DecimalInstance;
    try {
      amountDec = new Decimal(fromAmount).toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN);
      rateDec = new Decimal(targetRate).toDecimalPlaces(RATE_PRECISION, ROUND_DOWN);
    } catch {
      return reply.status(400).send({ success: false, error: 'Invalid amount or rate' });
    }
    if (amountDec.lte(0) || !amountDec.isFinite() || rateDec.lte(0) || !rateDec.isFinite()) {
      return reply.status(400).send({ success: false, error: 'Invalid amount or rate' });
    }

    try {
      const { fromCurrency, toCurrency, orderId, amountStr, toAmountStr, rateStr, expiresAt } = await db.transaction(async (client) => {
        const currencyResult = await client.query<{ id: string; symbol: string; name: string }>(`
          SELECT id, symbol, name FROM currencies WHERE id IN ($1, $2)
        `, [fromCurrencyId, toCurrencyId]);

        const fromCurrency = currencyResult.rows.find(c => c.id === fromCurrencyId);
        const toCurrency = currencyResult.rows.find(c => c.id === toCurrencyId);

        if (!fromCurrency || !toCurrency) {
          const err = new Error('Invalid currencies') as Error & { statusCode?: number };
          err.statusCode = 400;
          throw err;
        }

        const balanceResult = await client.query<{ available_balance: string }>(`
          SELECT available_balance::text FROM user_balances 
          WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = $4
        `, [userId, fromCurrencyId, CHAIN_ID_GLOBAL, accountType]);

        const availableBalance = balanceResult.rows.length > 0
          ? new Decimal(balanceResult.rows[0]!.available_balance).toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN)
          : new Decimal(0);

        if (availableBalance.lt(amountDec)) {
          const err = new Error('Insufficient balance') as Error & { statusCode?: number };
          err.statusCode = 400;
          throw err;
        }

        const toAmountDec = amountDec.times(rateDec).toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN);
        const amountStr = amountDec.toString();
        const toAmountStr = toAmountDec.toString();
        const rateStr = rateDec.toString();
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + expiresInDays);
        const orderId = crypto.randomUUID();

        await ensureUserBalanceRow(userId, fromCurrencyId, CHAIN_ID_GLOBAL, accountType, client);
        const lockSel = await client.query<{ available_balance: string }>(
          `SELECT available_balance::text FROM user_balances
           WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = $4 FOR UPDATE`,
          [userId, fromCurrencyId, CHAIN_ID_GLOBAL, accountType]
        );
        if (lockSel.rows.length === 0) throw new Error('convert_limit: balance row not found');
        const avBefore = new Decimal(lockSel.rows[0]!.available_balance);
        const lockUpd = await client.query(`
          UPDATE user_balances 
          SET available_balance = available_balance - $1, updated_at = NOW()
          WHERE user_id = $2 AND currency_id = $3 AND COALESCE(chain_id, '') = $4 AND account_type = $5
        `, [amountStr, userId, fromCurrencyId, CHAIN_ID_GLOBAL, accountType]);
        assertUserBalanceUpdated('convert_limit_lock', lockUpd, userId, fromCurrencyId, accountType, CHAIN_ID_GLOBAL);
        await insertBalanceLedger({
          client,
          userId,
          currencyId: fromCurrencyId,
          accountType,
          debit: amountStr,
          credit: '0',
          balanceBefore: avBefore.toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN).toString(),
          balanceAfter: avBefore.minus(amountStr).toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN).toString(),
          referenceType: 'internal_transfer',
          referenceId: orderId,
          balanceType: 'available',
        });

        await client.query(`
          INSERT INTO conversions (
            id, user_id, conversion_type, from_currency_id, from_amount, 
            to_currency_id, to_amount, conversion_rate, target_rate,
            account_type, status, expires_at, ip_address
          ) VALUES ($1, $2, 'limit', $3, $4, $5, $6, $7, $7, $8, 'pending', $9, $10)
        `, [orderId, userId, fromCurrencyId, amountStr, toCurrencyId, toAmountStr, rateStr, accountType, expiresAt, request.ip]);

        return { fromCurrency, toCurrency, orderId, amountStr, toAmountStr, rateStr, expiresAt };
      });

      const limitFromTokenIds = await getTokenIdsByCurrencyId(fromCurrencyId);
      for (const tid of limitFromTokenIds) {
        try { await redis.del(`balance:${userId}:${tid}`); } catch { /* best effort */ }
      }

      auditLog('limit_conversion_placed', userId, {
        orderId,
        from: `${amountStr} ${fromCurrency.symbol}`,
        targetRate: rateStr,
        expiresAt
      }, request.ip);

      const limitResponse = {
        success: true as const,
        data: {
          id: orderId,
          from: { currency: fromCurrency.symbol, amount: amountStr },
          to: { currency: toCurrency.symbol, estimatedAmount: toAmountStr },
          targetRate: rateStr,
          expiresAt: expiresAt.toISOString(),
          status: 'pending'
        }
      };
      try {
        await redis.setJson(limitRedisKey, { requestHash: limitRequestHash, response: limitResponse }, CONVERT_IDEMPOTENCY_TTL_SECONDS);
      } catch {
        /* best effort */
      }
      return reply.send(limitResponse);
    } catch (error) {
      const err = error as Error & { statusCode?: number };
      if (err.statusCode === 400) {
        return reply.status(400).send({ success: false, error: err.message });
      }
      logger.error('Error placing limit conversion order', { error });
      return reply.status(500).send({ success: false, error: 'Failed to place limit order' });
    }
  });

  // Cancel limit order (authenticated)
  app.post<{ Params: { orderId: string } }>('/limit/:orderId/cancel', {
    preHandler: [app.authenticate]
  }, async (request, reply) => {
    try {
      const userId = (request as any).user.id;
      const { orderId } = request.params;

      const refundedCurrencyId = await db.transaction(async (client) => {
        // Lock conversion row to prevent concurrent cancel (double refund)
        const orderResult = await client.query<Conversion>(`
          SELECT * FROM conversions 
          WHERE id = $1 AND user_id = $2 AND conversion_type = 'limit'
          FOR UPDATE
        `, [orderId, userId]);

        if (orderResult.rows.length === 0) {
          throw new Error('ORDER_NOT_FOUND');
        }

        const order = orderResult.rows[0]!;

        // Re-check status after lock — only pending can be cancelled
        if (order.status !== 'pending') {
          throw new Error('ORDER_ALREADY_PROCESSED');
        }

        const cancelAccountType = ['funding', 'spot', 'trading'].includes(order.account_type) ? order.account_type : 'funding';

        // Refund the locked amount (ensure row, SELECT FOR UPDATE, update, ledger)
        await ensureUserBalanceRow(userId, order.from_currency_id, CHAIN_ID_GLOBAL, cancelAccountType, client);
        const refundSel = await client.query<{ available_balance: string }>(
        `SELECT available_balance::text FROM user_balances
         WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = $4 FOR UPDATE`,
          [userId, order.from_currency_id, CHAIN_ID_GLOBAL, cancelAccountType]
        );
        if (refundSel.rows.length === 0) throw new Error('convert_limit_cancel: balance row not found');
        const avBefore = new Decimal(refundSel.rows[0]!.available_balance);
        const refundUpd = await client.query(`
          UPDATE user_balances 
          SET available_balance = available_balance + $1, updated_at = NOW()
          WHERE user_id = $2 AND currency_id = $3 AND COALESCE(chain_id, '') = $4 AND account_type = $5
        `, [order.from_amount, userId, order.from_currency_id, CHAIN_ID_GLOBAL, cancelAccountType]);
        assertUserBalanceUpdated('convert_limit_cancel_refund', refundUpd, userId, order.from_currency_id, cancelAccountType, CHAIN_ID_GLOBAL);
        await insertBalanceLedger({
          client,
          userId,
          currencyId: order.from_currency_id,
          accountType: cancelAccountType,
          debit: '0',
          credit: order.from_amount,
          balanceBefore: avBefore.toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN).toString(),
          balanceAfter: avBefore.plus(order.from_amount).toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN).toString(),
          referenceType: 'internal_transfer',
          referenceId: orderId,
          balanceType: 'available',
        });

        // Update order status (only if still pending — prevents double refund on retry)
        await client.query(`
          UPDATE conversions 
          SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
          WHERE id = $1 AND status = 'pending'
        `, [orderId]);
        return order.from_currency_id;
      });

      if (refundedCurrencyId) {
        const cancelTokenIds = await getTokenIdsByCurrencyId(refundedCurrencyId);
        for (const tid of cancelTokenIds) {
          try { await redis.del(`balance:${userId}:${tid}`); } catch { /* best effort */ }
        }
      }

      return reply.send({ success: true, message: 'Order cancelled successfully' });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg === 'ORDER_NOT_FOUND') {
        return reply.status(404).send({ success: false, error: 'Order not found or already processed' });
      }
      if (msg === 'ORDER_ALREADY_PROCESSED') {
        return reply.status(400).send({ success: false, error: 'Order not found or already processed' });
      }
      logger.error('Error cancelling limit order', { error });
      return reply.status(500).send({ success: false, error: 'Failed to cancel order' });
    }
  });

  // Get active limit orders (authenticated)
  app.get('/orders/active', {
    preHandler: [app.authenticate]
  }, async (request, reply) => {
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
  app.get<{
    Querystring: { page?: string; limit?: string; type?: string; status?: string };
  }>('/history', {
    preHandler: [app.authenticate]
  }, async (request, reply) => {
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
          total: parseInt(countResult.rows[0]?.count ?? '0'),
          totalPages: Math.ceil(parseInt(countResult.rows[0]?.count ?? '0') / limit)
        }
      };
    } catch (error) {
      logger.error('Error fetching conversion history', { error });
      return reply.status(500).send({ success: false, error: 'Failed to fetch history' });
    }
  });

  // Get user balances for conversion (authenticated). Uses canonical readUserBalances; no total_balance column.
  app.get<{ Querystring: { accountType?: string } }>('/balances', {
    preHandler: [app.authenticate]
  }, async (request, reply) => {
    try {
      const userId = (request as any).user.id;
      const rawAccountType = request.query.accountType || 'funding';
      const allowedAccountTypes = ['funding', 'spot', 'trading'];
      const accountType = allowedAccountTypes.includes(rawAccountType) ? rawAccountType : 'funding';

      const rows = await readUserBalances(userId, accountType);

      if (rows.length === 0) {
        return { success: true, data: [] };
      }

      const currencyIds = [...new Set(rows.map((r) => r.currency_id))];
      const currenciesResult = await db.query<{ id: string; symbol: string; name: string; logo_url: string | null }>(
        `SELECT id, symbol, COALESCE(name, symbol) as name, logo_url FROM currencies WHERE id = ANY($1::uuid[])`,
        [currencyIds]
      );
      const byId = Object.fromEntries(currenciesResult.rows.map((r) => [r.id, r]));

      const data = rows
        .map((r) => {
          const available = new Decimal(r.available_balance || '0').toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN);
          const locked = new Decimal(r.locked_balance || '0').toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN);
          const total = available.plus(locked).toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN);
          if (available.lte(0)) return null;
          const cur = byId[r.currency_id];
          return {
            currency_id: r.currency_id,
            symbol: r.symbol,
            name: cur?.name ?? r.symbol,
            logo_url: cur?.logo_url ?? null,
            available_balance: r.available_balance,
            total_balance: total.toString(),
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null)
        .sort((a, b) => new Decimal(b.available_balance).cmp(a.available_balance));

      return { success: true, data };
    } catch (error) {
      logger.error('Error fetching balances', { error });
      return reply.status(500).send({ success: false, error: 'Failed to fetch balances' });
    }
  });
}
