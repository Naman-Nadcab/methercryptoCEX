# Phase-0 Safety Audit — Code Extraction (Read-Only)

Raw code only. No modifications. No analysis.

---

## SECTION 1 — Spot Order Placement Logic

### 1. POST /spot/order handler (FULL)

```typescript
  app.post<{
    Body: { market: string; side: string; type: string; price?: string; quantity: string };
  }>('/order', {
    preHandler: [app.authenticate, rateLimitByUser('spot:order', 30, 60)],
  }, async (request, reply) => {
    const userId = request.user!.id;
    if (await isTradingHalted()) {
      return reply.status(503).send({
        success: false,
        error: { code: 'TRADING_HALTED', message: 'Trading is temporarily halted' },
      });
    }
    const marketSymbol = (request.body?.market || '').toUpperCase().replace(/-/g, '_');
    const side = (request.body?.side || '').toLowerCase();
    const type = (request.body?.type || 'limit').toLowerCase();
    const priceStr = request.body?.price;
    const quantityStr = request.body?.quantity;

    if (!marketSymbol || !['buy', 'sell'].includes(side) || !['market', 'limit'].includes(type)) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_ORDER', message: 'Invalid market, side, or type' },
      });
    }
    let quantityDec: DecimalInstance;
    try {
      quantityDec = new Decimal(quantityStr);
    } catch {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_ORDER', message: 'Invalid quantity' },
      });
    }
    if (quantityDec.lte(0) || !quantityDec.isFinite()) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_ORDER', message: 'Invalid quantity' },
      });
    }

    try {
      const marketRow = await db.query<{
        id: string;
        symbol: string;
        base_asset: string;
        quote_asset: string;
        base_currency_id: string | null;
        quote_currency_id: string | null;
        status: string;
        min_qty: string;
        min_notional: string;
        price_precision: number;
        qty_precision: number;
        maker_fee: string | null;
        taker_fee: string | null;
      }>(`SELECT id, symbol, base_asset, quote_asset, base_currency_id, quote_currency_id, status, min_qty, min_notional, price_precision, qty_precision, COALESCE(maker_fee, 0.001)::text as maker_fee, COALESCE(taker_fee, 0.001)::text as taker_fee FROM spot_markets WHERE symbol = $1`, [marketSymbol]);
      if (marketRow.rows.length === 0) {
        return reply.status(404).send({ success: false, error: { code: 'MARKET_NOT_FOUND', message: 'Market not found' } });
      }
      const m = marketRow.rows[0]!;
      if (m.status !== 'active') {
        return reply.status(400).send({
          success: false,
          error: {
            code: m.status === 'maintenance' ? 'MARKET_PAUSED' : 'MARKET_DISABLED',
            message: m.status === 'maintenance' ? 'Trading is temporarily paused for this market' : 'Market is not available',
          },
        });
      }
      const orderStartMs = Date.now();
      const precision = typeof m.price_precision === 'number' ? m.price_precision : 8;
      const qtyPrecision = typeof m.qty_precision === 'number' ? m.qty_precision : 8;

      const minQtyDec = new Decimal(m.min_qty).toDecimalPlaces(qtyPrecision, ROUND_DOWN);
      const minNotionalDec = new Decimal(m.min_notional).toDecimalPlaces(precision, ROUND_DOWN);
      const qtyRounded = quantityDec.toDecimalPlaces(qtyPrecision, ROUND_DOWN);
      if (qtyRounded.lt(minQtyDec)) {
        return reply.status(400).send({
          success: false,
          error: { code: 'MIN_QTY', message: `Minimum quantity is ${m.min_qty}` },
        });
      }

      let priceDec: DecimalInstance | null = null;
      if (type === 'limit') {
        if (priceStr == null || priceStr === '') {
          return reply.status(400).send({
            success: false,
            error: { code: 'INVALID_ORDER', message: 'Limit orders require a valid price' },
          });
        }
        try {
          priceDec = new Decimal(priceStr).toDecimalPlaces(precision, ROUND_DOWN);
        } catch {
          return reply.status(400).send({
            success: false,
            error: { code: 'INVALID_ORDER', message: 'Limit orders require a valid price' },
          });
        }
        if (priceDec.lte(0) || !priceDec.isFinite()) {
          return reply.status(400).send({
            success: false,
            error: { code: 'INVALID_ORDER', message: 'Limit orders require a valid price' },
          });
        }
        const notional = priceDec.times(qtyRounded).toDecimalPlaces(precision, ROUND_DOWN);
        if (notional.lt(minNotionalDec)) {
          return reply.status(400).send({
            success: false,
            error: { code: 'MIN_NOTIONAL', message: `Minimum notional is ${m.min_notional}` },
          });
        }
      }

      const baseCurrencyId = m.base_currency_id ?? (await getCurrencyIdBySymbol(m.base_asset)) ?? '';
      const quoteCurrencyId = m.quote_currency_id ?? (await getCurrencyIdBySymbol(m.quote_asset)) ?? '';
      if (!baseCurrencyId || !quoteCurrencyId) {
        return reply.status(400).send({
          success: false,
          error: { code: 'MARKET_NOT_READY', message: 'Market assets not configured' },
        });
      }

      let lockCurrencyId: string;
      let lockAmount: string;
      let priceForRisk: string;
      if (side === 'buy') {
        lockCurrencyId = quoteCurrencyId;
        if (type === 'market') {
          const bestAskStr = await getBestAsk(marketSymbol);
          const bestAskDec = new Decimal(bestAskStr).toDecimalPlaces(precision, ROUND_DOWN);
          if (bestAskDec.lte(0) || !bestAskDec.isFinite()) {
            throw new Error('NO_LIQUIDITY');
          }
          const effectivePrice = bestAskDec.times(new Decimal(1).plus(MARKET_ORDER_SLIPPAGE_BUFFER)).toDecimalPlaces(precision, ROUND_DOWN);
          lockAmount = lockAmountQuote(effectivePrice.toString(), qtyRounded.toString(), precision);
          priceForRisk = effectivePrice.toString();
        } else {
          lockAmount = lockAmountQuote(priceDec!.toString(), qtyRounded.toString(), precision);
          priceForRisk = priceDec!.toString();
        }
      } else {
        lockCurrencyId = baseCurrencyId;
        lockAmount = lockAmountBase(qtyRounded.toString(), qtyPrecision);
        priceForRisk = priceDec != null ? priceDec.toString() : '0';
      }

      await validateSpotOrderRiskUserBalances({
        user_id: userId,
        quote_currency_id: quoteCurrencyId,
        base_currency_id: baseCurrencyId,
        side: side as 'buy' | 'sell',
        price: priceForRisk,
        qty: qtyRounded.toString(),
        fee_rate: TAKER_FEE_RATE.toString(),
        precision,
      });

      const orderResult = await db.transaction(async (client) => {
        const locked = await lockTradingBalance(userId, lockCurrencyId, lockAmount, client);
        if (!locked) {
          throw new Error('INSUFFICIENT_BALANCE');
        }
        const insertPrice = type === 'limit' && priceDec != null ? priceDec.toString() : null;
        const orderIns = await client.query<{
          id: string;
          user_id: string;
          market: string;
          side: string;
          type: string;
          price: string | null;
          quantity: string;
          filled_quantity: string;
          status: string;
          created_at: Date;
        }>(
          `INSERT INTO spot_orders (user_id, market, side, type, price, quantity, filled_quantity, status)
           VALUES ($1, $2, $3, $4, $5, $6, 0, $7)
           RETURNING id, user_id, market, side, type, price, quantity, filled_quantity, status, created_at`,
          [userId, marketSymbol, side, type, insertPrice, qtyRounded.toString(), type === 'market' ? 'OPEN' : 'OPEN']
        );
        const order = orderIns.rows[0]!;
        if (type === 'limit') {
          await runMatching(client, order, m, baseCurrencyId, quoteCurrencyId, precision, qtyPrecision);
        } else {
          await runMatching(client, order, m, baseCurrencyId, quoteCurrencyId, precision, qtyPrecision);
          const updated = await client.query<{ status: string; filled_quantity: string }>(`SELECT status, filled_quantity::text AS filled_quantity FROM spot_orders WHERE id = $1`, [order.id]);
          const ord = updated.rows[0];
          const filledZero = ord && ord.status === 'OPEN' && new Decimal(ord.filled_quantity).lte(0);
          if (filledZero) {
            await client.query(`UPDATE spot_orders SET status = 'CANCELLED', updated_at = NOW() WHERE id = $1`, [order.id]);
            await unlockTradingBalance(userId, lockCurrencyId, lockAmount, client);
            throw new Error('NO_LIQUIDITY');
          }
        }
        const final = await client.query(
          `SELECT id, user_id, market, side, type, price, quantity, filled_quantity, status, created_at, updated_at FROM spot_orders WHERE id = $1`,
          [order.id]
        );
        return final.rows[0];
      });

      const o = orderResult as { id: string; market: string; side: string; type: string; price: string | null; quantity: string; filled_quantity: string; status: string; created_at: Date };
      spotMetrics.recordOrder();
      spotMetrics.recordOrderLatencyMs(Date.now() - orderStartMs);
      logger.info('spot_order_placed', { orderId: o.id, userId, market: marketSymbol, side: o.side, type: o.type, quantity: o.quantity, status: o.status });

      void pushSpotUpdates(marketSymbol, userId, { ...o, displayStatus: displayStatus(o.status) }).catch((e) => logger.warn('Spot push updates failed', { error: e instanceof Error ? e.message : 'Unknown' }));

      return reply.send({
        success: true,
        data: {
          id: o.id,
          market: o.market,
          side: o.side,
          type: o.type,
          price: o.price,
          quantity: o.quantity,
          filled_quantity: o.filled_quantity,
          status: o.status,
          displayStatus: displayStatus(o.status),
          created_at: o.created_at,
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown';
      void recordCircuitBreaker(marketSymbol).catch(() => {});
      if (msg === 'INSUFFICIENT_BALANCE') {
        return reply.status(400).send({
          success: false,
          error: { code: 'INSUFFICIENT_BALANCE', message: 'Insufficient trading balance' },
        });
      }
      if (msg === 'INSUFFICIENT_QUOTE_BALANCE' || msg === 'INSUFFICIENT_BASE_BALANCE') {
        return reply.status(400).send({
          success: false,
          error: { code: msg, message: msg === 'INSUFFICIENT_QUOTE_BALANCE' ? 'Insufficient quote balance (including fee)' : 'Insufficient base balance' },
        });
      }
      if (msg === 'MARKET_NOT_FOUND') {
        return reply.status(404).send({
          success: false,
          error: { code: 'MARKET_NOT_FOUND', message: 'Market not found' },
        });
      }
      if (msg === 'NO_LIQUIDITY') {
        return reply.status(400).send({
          success: false,
          error: { code: 'NO_LIQUIDITY', message: 'No liquidity for market order' },
        });
      }
      logger.error('Spot place order failed', { error: msg, userId });
      return reply.status(500).send({
        success: false,
        error: { code: 'ORDER_FAILED', message: 'Failed to place order' },
      });
    }
  });
```

### 2. POST /spot/orders handler (FULL)

```typescript
  app.post<{
    Body: { market: string; side: string; type: string; price?: string; quantity: string; client_order_id?: string };
  }>('/orders', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const userId = request.user!.id;
    const body = request.body || {};
    const marketSymbol = (body.market || '').toUpperCase().replace(/-/g, '_');
    const side = (body.side || '').toLowerCase();
    const type = (body.type || 'limit').toLowerCase();
    const priceStr = body.price;
    const quantityStr = body.quantity;
    const clientOrderId = typeof body.client_order_id === 'string' && body.client_order_id.trim() ? body.client_order_id.trim() : null;

    if (!marketSymbol || !['buy', 'sell'].includes(side) || !['limit', 'market'].includes(type)) {
      return reply.status(400).send({ success: false, error: { code: 'INVALID_ORDER', message: 'Invalid market, side, or type' } });
    }
    let quantityDec: DecimalInstance;
    try {
      quantityDec = new Decimal(quantityStr);
    } catch {
      return reply.status(400).send({ success: false, error: { code: 'INVALID_ORDER', message: 'Invalid quantity' } });
    }
    if (quantityDec.lte(0) || !quantityDec.isFinite()) {
      return reply.status(400).send({ success: false, error: { code: 'INVALID_ORDER', message: 'Invalid quantity' } });
    }

    let priceDec: DecimalInstance | null = null;
    if (type === 'limit' && priceStr != null && priceStr !== '') {
      try {
        priceDec = new Decimal(priceStr).toDecimalPlaces(8, ROUND_DOWN);
      } catch {
        return reply.status(400).send({ success: false, error: { code: 'INVALID_ORDER', message: 'Limit orders require a valid price' } });
      }
      if (priceDec.lte(0) || !priceDec.isFinite()) {
        return reply.status(400).send({ success: false, error: { code: 'INVALID_ORDER', message: 'Limit orders require a valid price' } });
      }
    }

    try {
      const marketRow = await db.query<{
        base_asset: string;
        quote_asset: string;
        base_currency_id: string | null;
        quote_currency_id: string | null;
        status: string;
        min_qty: string;
        min_notional: string;
      }>(`SELECT base_asset, quote_asset, base_currency_id, quote_currency_id, status, min_qty, min_notional FROM spot_markets WHERE symbol = $1`, [marketSymbol]);
      if (marketRow.rows.length === 0) {
        return reply.status(404).send({ success: false, error: { code: 'MARKET_NOT_FOUND', message: 'Market not found' } });
      }
      const m = marketRow.rows[0]!;
      if (m.status !== 'active') {
        return reply.status(400).send({
          success: false,
          error: { code: m.status === 'maintenance' ? 'MARKET_PAUSED' : 'MARKET_DISABLED', message: 'Market not available' },
        });
      }
      const precision = 8;
      const minQtyDec = new Decimal(m.min_qty).toDecimalPlaces(precision, ROUND_DOWN);
      const minNotionalDec = new Decimal(m.min_notional).toDecimalPlaces(precision, ROUND_DOWN);
      const qtyRounded = quantityDec.toDecimalPlaces(precision, ROUND_DOWN);
      if (qtyRounded.lt(minQtyDec)) {
        return reply.status(400).send({ success: false, error: { code: 'MIN_QTY', message: `Minimum quantity is ${m.min_qty}` } });
      }
      if (type === 'limit' && priceDec != null) {
        const notional = priceDec.times(qtyRounded).toDecimalPlaces(precision, ROUND_DOWN);
        if (notional.lt(minNotionalDec)) {
          return reply.status(400).send({ success: false, error: { code: 'MIN_NOTIONAL', message: `Minimum notional is ${m.min_notional}` } });
        }
      }

      const baseCurrencyId = m.base_currency_id ?? (await getCurrencyIdBySymbol(m.base_asset)) ?? '';
      const quoteCurrencyId = m.quote_currency_id ?? (await getCurrencyIdBySymbol(m.quote_asset)) ?? '';
      if (!baseCurrencyId || !quoteCurrencyId) {
        return reply.status(400).send({ success: false, error: { code: 'MARKET_NOT_READY', message: 'Market assets not configured' } });
      }

      let lockCurrencyId: string;
      let lockAmount: string;
      if (side === 'buy') {
        lockCurrencyId = quoteCurrencyId;
        if (type === 'market') {
          return reply.status(400).send({ success: false, error: { code: 'INVALID_ORDER', message: 'Market orders not supported in this flow' } });
        }
        lockAmount = priceDec != null ? lockAmountQuote(priceDec.toString(), qtyRounded.toString(), precision) : '0';
      } else {
        lockCurrencyId = baseCurrencyId;
        lockAmount = lockAmountBase(qtyRounded.toString(), precision);
      }

      if (type === 'limit' && priceDec != null) {
        await validateSpotOrderRiskUserBalances({
          user_id: userId,
          quote_currency_id: quoteCurrencyId,
          base_currency_id: baseCurrencyId,
          side: side as 'buy' | 'sell',
          price: priceDec.toString(),
          qty: qtyRounded.toString(),
          fee_rate: TAKER_FEE_RATE.toString(),
          precision,
        });
      }

      const ORDER_LOCK_TTL_DAYS = 30;

      const orderResult = await db.transaction(async (client) => {
        if (clientOrderId) {
          const existing = await client.query<{ id: string; market: string; side: string; type: string; price: string | null; quantity: string; filled_quantity: string; status: string; created_at: Date }>(
            `SELECT id, market, side, type, price, quantity, filled_quantity, status, created_at FROM spot_orders WHERE user_id = $1 AND client_order_id = $2`,
            [userId, clientOrderId]
          );
          if (existing.rows.length > 0) {
            const o = existing.rows[0]!;
            return { id: o.id, market: o.market, side: o.side, type: o.type, price: o.price, quantity: o.quantity, filled_quantity: o.filled_quantity, status: o.status, created_at: o.created_at };
          }
        }

        const balanceRow = await client.query<{ available_balance: string; locked_balance: string }>(
          `SELECT COALESCE(available_balance, 0)::text AS available_balance, COALESCE(locked_balance, 0)::text AS locked_balance
           FROM user_balances WHERE user_id = $1 AND currency_id = $2 AND chain_id = $3 AND account_type::text = 'trading'
           FOR UPDATE`,
          [userId, lockCurrencyId, CHAIN_ID_GLOBAL]
        );
        const total = balanceRow.rows.length === 0
          ? new Decimal(0)
          : new Decimal(balanceRow.rows[0]!.available_balance || '0').plus(balanceRow.rows[0]!.locked_balance || '0').toDecimalPlaces(precision, ROUND_DOWN);
        const sumLock = await client.query<{ sum: string }>(
          `SELECT COALESCE(SUM(amount), 0)::text AS sum FROM balance_locks WHERE user_id = $1 AND currency_id = $2 AND account_type::text = 'trading' AND expires_at > NOW()`,
          [userId, lockCurrencyId]
        );
        const lockedSum = new Decimal(sumLock.rows[0]?.sum || '0').toDecimalPlaces(precision, ROUND_DOWN);
        const spendable = total.minus(lockedSum).toDecimalPlaces(precision, ROUND_DOWN);
        const required = new Decimal(lockAmount).toDecimalPlaces(precision, ROUND_DOWN);
        if (required.gt(0) && spendable.lt(required)) {
          throw new Error('INSUFFICIENT_BALANCE');
        }

        const insertPrice = type === 'limit' && priceDec != null ? priceDec.toString() : null;
        const orderIns = await client.query<{
          id: string;
          market: string;
          side: string;
          type: string;
          price: string | null;
          quantity: string;
          filled_quantity: string;
          status: string;
          created_at: Date;
        }>(
          `INSERT INTO spot_orders (user_id, market, side, type, price, quantity, filled_quantity, status, client_order_id)
           VALUES ($1, $2, $3, $4, $5, $6, 0, 'OPEN', $7)
           RETURNING id, market, side, type, price, quantity, filled_quantity, status, created_at`,
          [userId, marketSymbol, side, type, insertPrice, qtyRounded.toString(), clientOrderId]
        );
        const orderRow = orderIns.rows[0]!;
        const expiresAt = new Date(Date.now() + ORDER_LOCK_TTL_DAYS * 24 * 60 * 60 * 1000);
        await client.query(
          `INSERT INTO balance_locks (user_id, currency_id, account_type, amount, reason, expires_at, reference_id) VALUES ($1, $2, 'trading', $3::numeric, 'order', $4, $5)`,
          [userId, lockCurrencyId, lockAmount, expiresAt, orderRow.id]
        );
        return orderRow;
      });

      return reply.send({
        success: true,
        data: {
          id: orderResult.id,
          market: orderResult.market,
          side: orderResult.side,
          type: orderResult.type,
          price: orderResult.price,
          quantity: orderResult.quantity,
          filled_quantity: orderResult.filled_quantity,
          status: orderResult.status,
          created_at: orderResult.created_at,
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown';
      if (msg === 'INSUFFICIENT_BALANCE') {
        return reply.status(400).send({
          success: false,
          error: { code: 'INSUFFICIENT_BALANCE', message: 'Insufficient balance' },
        });
      }
      if (msg === 'INSUFFICIENT_QUOTE_BALANCE' || msg === 'INSUFFICIENT_BASE_BALANCE') {
        return reply.status(400).send({
          success: false,
          error: { code: msg, message: msg === 'INSUFFICIENT_QUOTE_BALANCE' ? 'Insufficient quote balance (including fee)' : 'Insufficient base balance' },
        });
      }
      if (msg === 'MARKET_NOT_FOUND') {
        return reply.status(404).send({
          success: false,
          error: { code: 'MARKET_NOT_FOUND', message: 'Market not found' },
        });
      }
      logger.error('Spot place order (orders) failed', { error: msg, userId });
      return reply.status(500).send({
        success: false,
        error: { code: 'ORDER_FAILED', message: 'Failed to place order' },
      });
    }
  });
```

### 3. Shared helpers used by these handlers

```typescript
async function getBestAsk(symbol: string): Promise<string> {
  const r = await db.query<{ price: string }>(
    `SELECT MIN(price)::text as price FROM spot_orders WHERE market = $1 AND side = 'sell' AND status IN ('OPEN', 'PARTIALLY_FILLED') AND (quantity - filled_quantity) > 0`,
    [symbol]
  );
  const p = r.rows[0]?.price;
  return p ?? '0';
}
```

---

## SECTION 2 — Reservation / Locking Logic (CRITICAL)

### spot-balance.service.ts (FULL)

```typescript
import crypto from 'node:crypto';
import { db } from '../lib/database.js';
import type { PoolClient } from 'pg';
import {
  ensureUserBalanceRow,
  assertUserBalanceUpdated,
  assertBalanceInvariant,
  CHAIN_ID_GLOBAL,
} from '../lib/user-balance-helper.js';
import { insertBalanceLedger, type LedgerReferenceType } from '../lib/balance-ledger.js';

const ACCOUNT_TYPE = 'trading';

export async function lockTradingBalance(
  userId: string,
  currencyId: string,
  amount: string,
  client?: PoolClient,
  ledgerRef?: { referenceType: LedgerReferenceType; referenceId: string }
): Promise<boolean> {
  const refType = ledgerRef?.referenceType ?? 'adjustment';
  const refId = ledgerRef?.referenceId ?? crypto.randomUUID();
  const run = async (q: PoolClient) => {
    await ensureUserBalanceRow(userId, currencyId, CHAIN_ID_GLOBAL, ACCOUNT_TYPE, q);
    const lockSel = await q.query<{ available_balance: string; locked_balance: string }>(
      `SELECT available_balance::text, locked_balance::text FROM user_balances
       WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = $4 AND available_balance >= $5::numeric
       FOR UPDATE`,
      [userId, currencyId, CHAIN_ID_GLOBAL, ACCOUNT_TYPE, amount]
    );
    if (lockSel.rows.length === 0) return false;
    const selRow = lockSel.rows[0]!;
    const balanceBeforeAvail = selRow.available_balance ?? '0';
    const balanceBeforeLocked = selRow.locked_balance ?? '0';
    const result = await q.query(
      `UPDATE user_balances
       SET available_balance = available_balance - $4::numeric, locked_balance = locked_balance + $4::numeric, updated_at = NOW()
       WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = $5 AND available_balance >= $4::numeric
       RETURNING *`,
      [userId, currencyId, CHAIN_ID_GLOBAL, amount, ACCOUNT_TYPE]
    );
    if (result.rowCount === 0) return false;
    assertBalanceInvariant(result.rows[0]);
    const row = result.rows[0]!;
    await insertBalanceLedger({
      client: q,
      userId,
      currencyId,
      accountType: ACCOUNT_TYPE,
      debit: amount,
      credit: '0',
      balanceBefore: balanceBeforeAvail,
      balanceAfter: String(row.available_balance ?? 0),
      referenceType: refType,
      referenceId: refId,
      balanceType: 'available',
    });
    await insertBalanceLedger({
      client: q,
      userId,
      currencyId,
      accountType: ACCOUNT_TYPE,
      debit: '0',
      credit: amount,
      balanceBefore: balanceBeforeLocked,
      balanceAfter: String(row.locked_balance ?? 0),
      referenceType: refType,
      referenceId: refId,
      balanceType: 'locked',
    });
    return true;
  };
  if (client) return run(client);
  return db.transaction(run);
}

export async function unlockTradingBalance(
  userId: string,
  currencyId: string,
  amount: string,
  client?: PoolClient,
  ledgerRef?: { referenceType: LedgerReferenceType; referenceId: string }
): Promise<void> {
  const refType = ledgerRef?.referenceType ?? 'adjustment';
  const refId = ledgerRef?.referenceId ?? crypto.randomUUID();
  const run = async (q: PoolClient) => {
    await ensureUserBalanceRow(userId, currencyId, CHAIN_ID_GLOBAL, ACCOUNT_TYPE, q);
    const lockSel = await q.query<{ available_balance: string; locked_balance: string }>(
      `SELECT available_balance::text, locked_balance::text FROM user_balances
       WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = $4 AND locked_balance >= $5::numeric
       FOR UPDATE`,
      [userId, currencyId, CHAIN_ID_GLOBAL, ACCOUNT_TYPE, amount]
    );
    if (lockSel.rows.length === 0) {
      throw new Error('unlockTradingBalance: no rows or insufficient locked');
    }
    const selRow = lockSel.rows[0]!;
    const result = await q.query(
      `UPDATE user_balances
       SET available_balance = available_balance + $4::numeric, locked_balance = locked_balance - $4::numeric, updated_at = NOW()
       WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = $5 AND locked_balance >= $4::numeric
       RETURNING *`,
      [userId, currencyId, CHAIN_ID_GLOBAL, amount, ACCOUNT_TYPE]
    );
    assertUserBalanceUpdated('unlockTradingBalance', result, userId, currencyId, ACCOUNT_TYPE, CHAIN_ID_GLOBAL);
    assertBalanceInvariant(result.rows[0]);
    const row = result.rows[0]!;
    await insertBalanceLedger({
      client: q,
      userId,
      currencyId,
      accountType: ACCOUNT_TYPE,
      debit: '0',
      credit: amount,
      balanceBefore: selRow.available_balance ?? '0',
      balanceAfter: String(row.available_balance ?? 0),
      referenceType: refType,
      referenceId: refId,
      balanceType: 'available',
    });
    await insertBalanceLedger({
      client: q,
      userId,
      currencyId,
      accountType: ACCOUNT_TYPE,
      debit: amount,
      credit: '0',
      balanceBefore: selRow.locked_balance ?? '0',
      balanceAfter: String(row.locked_balance ?? 0),
      referenceType: refType,
      referenceId: refId,
      balanceType: 'locked',
    });
  };
  if (client) await run(client);
  else await db.transaction(run);
}

export async function debitLockedTradingBalance(
  userId: string,
  currencyId: string,
  amount: string,
  client?: PoolClient,
  ledgerRef?: { referenceType: LedgerReferenceType; referenceId: string }
): Promise<boolean> {
  const refType = ledgerRef?.referenceType ?? 'trade_sell';
  const refId = ledgerRef?.referenceId ?? crypto.randomUUID();
  const run = async (q: PoolClient) => {
    await ensureUserBalanceRow(userId, currencyId, CHAIN_ID_GLOBAL, ACCOUNT_TYPE, q);
    const lockSel = await q.query<{ locked_balance: string }>(
      `SELECT locked_balance::text FROM user_balances
       WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = $4 AND locked_balance >= $5::numeric
       FOR UPDATE`,
      [userId, currencyId, CHAIN_ID_GLOBAL, ACCOUNT_TYPE, amount]
    );
    if (lockSel.rows.length === 0) return false;
    const balanceBefore = lockSel.rows[0]!.locked_balance ?? '0';
    const result = await q.query(
      `UPDATE user_balances
       SET locked_balance = locked_balance - $4::numeric, updated_at = NOW()
       WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = $5 AND locked_balance >= $4::numeric
       RETURNING *`,
      [userId, currencyId, CHAIN_ID_GLOBAL, amount, ACCOUNT_TYPE]
    );
    if (result.rowCount === 0) return false;
    assertBalanceInvariant(result.rows[0]);
    const row = result.rows[0]!;
    await insertBalanceLedger({
      client: q,
      userId,
      currencyId,
      accountType: ACCOUNT_TYPE,
      debit: amount,
      credit: '0',
      balanceBefore,
      balanceAfter: String(row.locked_balance ?? 0),
      referenceType: refType,
      referenceId: refId,
      balanceType: 'locked',
    });
    return true;
  };
  if (client) return run(client);
  return db.transaction(run);
}

export async function creditTradingBalance(
  userId: string,
  currencyId: string,
  amount: string,
  client?: PoolClient,
  ledgerRef?: { referenceType: LedgerReferenceType; referenceId: string }
): Promise<void> {
  const refType = ledgerRef?.referenceType ?? 'trade_buy';
  const refId = ledgerRef?.referenceId ?? crypto.randomUUID();
  const run = async (q: PoolClient) => {
    await ensureUserBalanceRow(userId, currencyId, CHAIN_ID_GLOBAL, ACCOUNT_TYPE, q);
    const lockSel = await q.query<{ available_balance: string }>(
      `SELECT available_balance::text FROM user_balances
       WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = $4
       FOR UPDATE`,
      [userId, currencyId, CHAIN_ID_GLOBAL, ACCOUNT_TYPE]
    );
    if (lockSel.rows.length === 0) {
      throw new Error('creditTradingBalance: no balance row');
    }
    const balanceBefore = lockSel.rows[0]!.available_balance ?? '0';
    const result = await q.query(
      `UPDATE user_balances
       SET available_balance = available_balance + $4::numeric, updated_at = NOW()
       WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = $5
       RETURNING *`,
      [userId, currencyId, CHAIN_ID_GLOBAL, amount, ACCOUNT_TYPE]
    );
    assertUserBalanceUpdated('creditTradingBalance', result, userId, currencyId, ACCOUNT_TYPE, CHAIN_ID_GLOBAL);
    assertBalanceInvariant(result.rows[0]);
    const row = result.rows[0]!;
    await insertBalanceLedger({
      client: q,
      userId,
      currencyId,
      accountType: ACCOUNT_TYPE,
      debit: '0',
      credit: amount,
      balanceBefore,
      balanceAfter: String(row.available_balance ?? 0),
      referenceType: refType,
      referenceId: refId,
      balanceType: 'available',
    });
  };
  if (client) await run(client);
  else await db.transaction(run);
}
```

### user-balance-helper.ts (ensureUserBalanceRow, assertUserBalanceUpdated, assertBalanceInvariant)

```typescript
export async function ensureUserBalanceRow(
  userId: string,
  currencyId: string,
  chainId: string = CHAIN_ID_GLOBAL,
  accountType: string = DEFAULT_ACCOUNT_TYPE,
  client?: PoolClient
): Promise<void> {
  const sql = `INSERT INTO user_balances (
    id, user_id, currency_id, chain_id, account_type,
    available_balance, locked_balance, pending_balance, total_deposited, updated_at
  )
  VALUES (gen_random_uuid(), $1, $2, $3, $4::balance_account_type, 0, 0, 0, 0, NOW())
  ON CONFLICT (user_id, currency_id, chain_id, account_type) DO NOTHING`;
  const params = [userId, currencyId, chainId, accountType];
  try {
    if (client) {
      await client.query(sql, params);
    } else {
      await db.query(sql, params);
    }
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    const constraint = (err as { constraint?: string })?.constraint;
    if (code === PG_UNIQUE_VIOLATION && constraint === OLD_UB_CONSTRAINT) {
      return;
    }
    throw err;
  }
}

export function assertUserBalanceUpdated(
  operation: string,
  updateResult: QueryResult,
  userId: string,
  currencyId: string,
  accountType?: string,
  chainId?: string
): void {
  if (updateResult.rowCount === 0) {
    logUserBalanceUpdateZeroRows(operation, userId, currencyId, accountType, chainId);
    throw new Error(
      `user_balances UPDATE affected 0 rows (operation=${operation}, user_id=${userId}, currency_id=${currencyId}, account_type=${accountType ?? DEFAULT_ACCOUNT_TYPE})`
    );
  }
}

export function assertBalanceInvariant(row: UserBalanceRowLike | null | undefined): void {
  if (row == null) return;
  const av = new Decimal(String(row.available_balance ?? 0));
  const lk = new Decimal(String(row.locked_balance ?? 0));
  const pd = new Decimal(String(row.pending_balance ?? 0));
  const esc = new Decimal(String(row.escrow_balance ?? 0));
  if (!av.isFinite() || !lk.isFinite() || !pd.isFinite() || !esc.isFinite()) {
    logger.error('Balance invariant violated: non-finite value', { ... });
    throw new Error(`user_balances invariant violated: non-finite bucket value ...`);
  }
  if (av.lt(0) || lk.lt(0) || pd.lt(0) || esc.lt(0)) {
    logger.error('Balance invariant violated: negative balance', { ... });
    throw new Error(`user_balances invariant violated: available=..., locked=... (all must be >= 0)`);
  }
}
```

### balance-ledger.ts (insertBalanceLedger)

```typescript
export async function insertBalanceLedger(params: InsertBalanceLedgerParams): Promise<void> {
  const {
    client,
    userId,
    currencyId,
    accountType,
    debit,
    credit,
    balanceBefore,
    balanceAfter,
    referenceType,
    referenceId,
    balanceType,
  } = params;
  const q = client as Queryable;
  await q.query(
    `INSERT INTO balance_ledger (user_id, currency_id, reference_type, reference_id, debit, credit, balance_before, balance_after, balance_type, description, created_at)
     VALUES ($1, $2, $3::ledger_reference_type, $4, $5::numeric, $6::numeric, $7::numeric, $8::numeric, $9::balance_type, $10, NOW())`,
    [userId, currencyId, referenceType, referenceId, debit, credit, balanceBefore, balanceAfter, balanceType, `account_type=${accountType}`]
  );
}
```

### spot-decimal.ts (Decimal / rounding utilities)

```typescript
import { Decimal, type DecimalInstance } from '../lib/decimal.js';
import { ROUND_DOWN, AMOUNT_PRECISION } from '../config/monetary-precision.js';

export { ROUND_DOWN };

const DEFAULT_PRECISION = AMOUNT_PRECISION;

export function lockAmountQuote(price: string, qty: string, precision: number = DEFAULT_PRECISION): string {
  const p = new Decimal(price).toDecimalPlaces(precision, ROUND_DOWN);
  const q = new Decimal(qty).toDecimalPlaces(precision, ROUND_DOWN);
  return p.times(q).toDecimalPlaces(precision, ROUND_DOWN).toString();
}

export function lockAmountBase(qty: string, precision: number = DEFAULT_PRECISION): string {
  return new Decimal(qty).toDecimalPlaces(precision, ROUND_DOWN).toString();
}

export function debitAmountQuote(price: string, qty: string, precision: number = DEFAULT_PRECISION): string {
  return lockAmountQuote(price, qty, precision);
}

export function debitAmountBase(qty: string, precision: number = DEFAULT_PRECISION): string {
  return lockAmountBase(qty, precision);
}

export function unlockAmountQuote(price: string, qty: string, precision: number = DEFAULT_PRECISION): string {
  return lockAmountQuote(price, qty, precision);
}

export function unlockAmountBase(qty: string, precision: number = DEFAULT_PRECISION): string {
  return lockAmountBase(qty, precision);
}

export function toDecimalPlaces(value: string | DecimalInstance, precision: number): string {
  const d = typeof value === 'string' ? new Decimal(value) : value;
  return d.toDecimalPlaces(precision, ROUND_DOWN).toString();
}
```

---

## SECTION 3 — Cancel Order Logic

### 1. POST /spot/order/:id/cancel (FULL)

```typescript
  app.post<{ Params: { id: string } }>('/order/:id/cancel', {
    preHandler: [app.authenticate, rateLimitByUser('spot:cancel', 60, 60)],
  }, async (request, reply) => {
    const userId = request.user!.id;
    const orderId = request.params.id;
    try {
      const order = await db.query<{
        id: string;
        user_id: string;
        market: string;
        side: string;
        status: string;
        quantity: string;
        filled_quantity: string;
        price: string | null;
      }>(`SELECT id, user_id, market, side, status, quantity, filled_quantity, price FROM spot_orders WHERE id = $1 AND user_id = $2`, [orderId, userId]);
      if (order.rows.length === 0) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Order not found' } });
      }
      const o = order.rows[0]!;
      if (o.status !== 'OPEN' && o.status !== 'PARTIALLY_FILLED') {
        return reply.status(400).send({
          success: false,
          error: { code: 'ORDER_NOT_CANCELLABLE', message: 'Order cannot be cancelled' },
        });
      }

      const m = await db.query<{ base_currency_id: string | null; quote_currency_id: string | null; base_asset: string; quote_asset: string }>(
        `SELECT base_currency_id, quote_currency_id, base_asset, quote_asset FROM spot_markets WHERE symbol = $1`,
        [o.market]
      );
      const row = m.rows[0];
      const baseId = row?.base_currency_id ?? (await getCurrencyIdBySymbol(row?.base_asset ?? '')) ?? '';
      const quoteId = row?.quote_currency_id ?? (await getCurrencyIdBySymbol(row?.quote_asset ?? '')) ?? '';
      const remainingQty = new Decimal(o.quantity).minus(new Decimal(o.filled_quantity)).toDecimalPlaces(8, ROUND_DOWN);
      const unlockCurrencyId = o.side === 'buy' ? quoteId : baseId;
      const unlockAmount = o.side === 'buy'
        ? unlockAmountQuote(o.price ?? '0', remainingQty.toString(), 8)
        : unlockAmountBase(remainingQty.toString(), 8);

      await db.transaction(async (client) => {
        await client.query(`UPDATE spot_orders SET status = 'CANCELLED', updated_at = NOW() WHERE id = $1`, [orderId]);
        await unlockTradingBalance(userId, unlockCurrencyId, unlockAmount, client);
      });

      logger.info('spot_order_cancelled', { orderId, userId, market: o.market });
      void pushSpotUpdates(o.market, userId, { id: o.id, status: 'CANCELLED', displayStatus: 'Cancelled' }).catch(() => {});

      return reply.send({
        success: true,
        data: { id: o.id, status: 'CANCELLED', displayStatus: 'Cancelled' },
      });
    } catch (error) {
      logger.error('Spot cancel failed', { error: error instanceof Error ? error.message : 'Unknown', userId });
      return reply.status(500).send({ success: false, error: { code: 'CANCEL_FAILED', message: 'Failed to cancel order' } });
    }
  });
```

### 2. POST /spot/orders/:orderId/cancel (FULL)

```typescript
  app.post<{ Params: { orderId: string } }>('/orders/:orderId/cancel', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const userId = request.user!.id;
    const orderId = request.params.orderId?.trim();
    if (!orderId) {
      return reply.status(400).send({ success: false, error: { code: 'INVALID_ORDER', message: 'Order ID required' } });
    }
    try {
      const result = await db.transaction(async (client) => {
        const orderRow = await client.query<{
          id: string;
          user_id: string;
          market: string;
          side: string;
          type: string;
          price: string | null;
          quantity: string;
          filled_quantity: string;
          status: string;
          created_at: Date;
        }>(
          `SELECT id, user_id, market, side, type, price, quantity, filled_quantity, status, created_at
           FROM spot_orders WHERE id = $1 AND user_id = $2 FOR UPDATE`,
          [orderId, userId]
        );
        if (orderRow.rows.length === 0) {
          return { notFound: true as const, order: null };
        }
        const o = orderRow.rows[0]!;
        if (o.status !== 'OPEN') {
          return { notFound: false as const, order: o };
        }
        await client.query(
          `UPDATE spot_orders SET status = 'CANCELLED', updated_at = NOW() WHERE id = $1`,
          [orderId]
        );
        await client.query(
          `DELETE FROM balance_locks WHERE reference_id = $1 AND reason = 'order'`,
          [orderId]
        );
        return { notFound: false as const, order: { ...o, status: 'CANCELLED' } };
      });
      if (result.notFound && result.order === null) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Order not found' } });
      }
      const order = result.order!;
      return reply.send({
        success: true,
        data: {
          id: order.id,
          market: order.market,
          side: order.side,
          type: order.type,
          price: order.price,
          quantity: order.quantity,
          filled_quantity: order.filled_quantity,
          status: order.status,
          created_at: order.created_at,
        },
      });
    } catch (error) {
      logger.error('Spot order cancel failed', { error: error instanceof Error ? error.message : 'Unknown', orderId, userId });
      return reply.status(500).send({
        success: false,
        error: { code: 'CANCEL_FAILED', message: 'Failed to cancel order' },
      });
    }
  });
```

### 3. POST /spot/orders/cancel-all (unlock per order)

```typescript
  app.post<{ Body: { market: string } }>('/orders/cancel-all', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const userId = request.user!.id;
    const market = (request.body?.market || '').toUpperCase().replace(/-/g, '_');
    if (!market) {
      return reply.status(400).send({ success: false, error: { code: 'INVALID_MARKET', message: 'Market is required' } });
    }
    try {
      const open = await db.query<{ id: string; side: string; price: string | null; quantity: string; filled_quantity: string }>(
        `SELECT id, side, price, quantity, filled_quantity FROM spot_orders WHERE user_id = $1 AND market = $2 AND status IN ('OPEN', 'PARTIALLY_FILLED')`,
        [userId, market]
      );
      const m = await db.query<{ base_currency_id: string | null; quote_currency_id: string | null; base_asset: string; quote_asset: string }>(
        `SELECT base_currency_id, quote_currency_id, base_asset, quote_asset FROM spot_markets WHERE symbol = $1`,
        [market]
      );
      const row = m.rows[0];
      const baseId = row?.base_currency_id ?? (await getCurrencyIdBySymbol(row?.base_asset ?? '')) ?? '';
      const quoteId = row?.quote_currency_id ?? (await getCurrencyIdBySymbol(row?.quote_asset ?? '')) ?? '';
      await db.transaction(async (client) => {
        for (const o of open.rows) {
          const remainingQty = new Decimal(o.quantity).minus(new Decimal(o.filled_quantity)).toDecimalPlaces(8, ROUND_DOWN);
          const unlockCurrencyId = o.side === 'buy' ? quoteId : baseId;
          const unlockAmount = o.side === 'buy'
            ? unlockAmountQuote(o.price ?? '0', remainingQty.toString(), 8)
            : unlockAmountBase(remainingQty.toString(), 8);
          await client.query(`UPDATE spot_orders SET status = 'CANCELLED', updated_at = NOW() WHERE id = $1`, [o.id]);
          await unlockTradingBalance(userId, unlockCurrencyId, unlockAmount, client);
        }
      });
      ...
    }
  });
```

---

## SECTION 4 — Matching / Execution Logic

### runMatching (FULL)

```typescript
  async function runMatching(
    client: any,
    incomingOrder: { id: string; user_id: string; market: string; side: string; type: string; price: string | null; quantity: string; filled_quantity: string; status: string },
    m: MarketRow,
    baseCurrencyId: string,
    quoteCurrencyId: string,
    pricePrecision: number,
    qtyPrecision: number
  ): Promise<void> {
    const incomingQty = new Decimal(incomingOrder.quantity).toDecimalPlaces(qtyPrecision, ROUND_DOWN);
    const incomingFilled = new Decimal(incomingOrder.filled_quantity).toDecimalPlaces(qtyPrecision, ROUND_DOWN);
    let remaining = incomingQty.minus(incomingFilled).toDecimalPlaces(qtyPrecision, ROUND_DOWN);
    if (remaining.lte(0)) return;

    const isBuy = incomingOrder.side === 'buy';
    const oppositeSide = isBuy ? 'sell' : 'buy';
    const orderBy = isBuy ? 'ORDER BY price ASC, created_at ASC' : 'ORDER BY price DESC, created_at ASC';
    const params: unknown[] = [incomingOrder.market, oppositeSide, incomingOrder.user_id];
    const priceCond = incomingOrder.price ? (isBuy ? 'AND o.price <= $4' : 'AND o.price >= $4') : '';
    if (incomingOrder.price) params.push(incomingOrder.price);

    const candidates = await client.query(
      `SELECT id, user_id, price::text as price, quantity::text, filled_quantity::text
       FROM spot_orders o
       WHERE o.market = $1 AND o.side = $2 AND o.status IN ('OPEN', 'PARTIALLY_FILLED') AND o.user_id != $3
         AND (o.quantity - o.filled_quantity) > 0 ${priceCond}
       ${orderBy}`,
      params
    ) as { rows: Array<{ id: string; user_id: string; price: string; quantity: string; filled_quantity: string }> };

    let filledIncoming = incomingFilled;
    for (const other of candidates.rows) {
      if (filledIncoming.gte(incomingQty)) break;
      const otherQty = new Decimal(other.quantity).toDecimalPlaces(qtyPrecision, ROUND_DOWN);
      const otherFilled = new Decimal(other.filled_quantity).toDecimalPlaces(qtyPrecision, ROUND_DOWN);
      const otherRemaining = otherQty.minus(otherFilled).toDecimalPlaces(qtyPrecision, ROUND_DOWN);
      const remainingIncoming = incomingQty.minus(filledIncoming).toDecimalPlaces(qtyPrecision, ROUND_DOWN);
      const matchQtyDec = (remainingIncoming.lte(otherRemaining) ? remainingIncoming : otherRemaining).toDecimalPlaces(qtyPrecision, ROUND_DOWN);
      if (matchQtyDec.lte(0)) continue;

      const tradePriceDec = new Decimal(other.price).toDecimalPlaces(pricePrecision, ROUND_DOWN);
      const quoteAmountDec = tradePriceDec.times(matchQtyDec).toDecimalPlaces(pricePrecision, ROUND_DOWN);
      const sellerFeeRateDec = new Decimal(isBuy ? (m.maker_fee ?? '0.001') : (m.taker_fee ?? '0.001')).toDecimalPlaces(pricePrecision, ROUND_DOWN);
      const feeAmountDec = quoteAmountDec.times(sellerFeeRateDec).toDecimalPlaces(pricePrecision, ROUND_DOWN);
      const buyerReceivesQtyStr = toDecimalPlaces(matchQtyDec, qtyPrecision);
      const sellerReceivesQuoteStr = quoteAmountDec.minus(feeAmountDec).toDecimalPlaces(pricePrecision, ROUND_DOWN).toString();
      const debitQuoteStr = debitAmountQuote(tradePriceDec.toString(), matchQtyDec.toString(), pricePrecision);
      const debitBaseStr = debitAmountBase(matchQtyDec.toString(), qtyPrecision);

      const buyerId = isBuy ? incomingOrder.user_id : other.user_id;
      const sellerId = isBuy ? other.user_id : incomingOrder.user_id;

      await client.query(
        `INSERT INTO spot_trades (order_id, user_id, market, side, price, quantity, fee, fee_asset) VALUES ($1, $2, $3, 'buy', $4, $5, 0, $6)`,
        [isBuy ? incomingOrder.id : other.id, buyerId, incomingOrder.market, tradePriceDec.toString(), matchQtyDec.toString(), m.quote_asset]
      );
      await client.query(
        `INSERT INTO spot_trades (order_id, user_id, market, side, price, quantity, fee, fee_asset) VALUES ($1, $2, $3, 'sell', $4, $5, $6, $7)`,
        [isBuy ? other.id : incomingOrder.id, sellerId, incomingOrder.market, tradePriceDec.toString(), matchQtyDec.toString(), feeAmountDec.toString(), m.quote_asset]
      );
      spotMetrics.recordTrade();

      if (isBuy) {
        const buyerQuoteDebited = await debitLockedTradingBalance(buyerId, quoteCurrencyId, debitQuoteStr, client);
        if (!buyerQuoteDebited) throw new Error('INSUFFICIENT_LOCKED_FUNDS');
        await creditTradingBalance(buyerId, baseCurrencyId, buyerReceivesQtyStr, client);
        const sellerBaseDebited = await debitLockedTradingBalance(sellerId, baseCurrencyId, debitBaseStr, client);
        if (!sellerBaseDebited) throw new Error('INSUFFICIENT_LOCKED_FUNDS');
        await creditTradingBalance(sellerId, quoteCurrencyId, sellerReceivesQuoteStr, client);
      } else {
        const sellerBaseDebited = await debitLockedTradingBalance(sellerId, baseCurrencyId, debitBaseStr, client);
        if (!sellerBaseDebited) throw new Error('INSUFFICIENT_LOCKED_FUNDS');
        await creditTradingBalance(sellerId, quoteCurrencyId, sellerReceivesQuoteStr, client);
        const buyerQuoteDebited = await debitLockedTradingBalance(buyerId, quoteCurrencyId, debitQuoteStr, client);
        if (!buyerQuoteDebited) throw new Error('INSUFFICIENT_LOCKED_FUNDS');
        await creditTradingBalance(buyerId, baseCurrencyId, buyerReceivesQtyStr, client);
      }

      const newOtherFilled = otherFilled.plus(matchQtyDec).toDecimalPlaces(qtyPrecision, ROUND_DOWN);
      const otherStatus = newOtherFilled.gte(otherQty) ? 'FILLED' : 'PARTIALLY_FILLED';
      await client.query(
        `UPDATE spot_orders SET filled_quantity = $2, status = $3, updated_at = NOW() WHERE id = $1`,
        [other.id, newOtherFilled.toString(), otherStatus]
      );
      filledIncoming = filledIncoming.plus(matchQtyDec).toDecimalPlaces(qtyPrecision, ROUND_DOWN);
    }

    const newIncomingFilledStr = filledIncoming.toString();
    const incomingStatus = filledIncoming.gte(incomingQty) ? 'FILLED' : (filledIncoming.gt(0) ? 'PARTIALLY_FILLED' : 'OPEN');
    await client.query(
      `UPDATE spot_orders SET filled_quantity = $2, status = $3, updated_at = NOW() WHERE id = $1`,
      [incomingOrder.id, newIncomingFilledStr, incomingStatus]
    );
  }
```

### settlement_events insertion (match-poller.ts)

```typescript
  for (const ev of events) {
    await db.query(
      `INSERT INTO settlement_events (engine_event_id, payload, status)
       VALUES ($1, $2::jsonb, 'pending')
       ON CONFLICT (engine_event_id) DO NOTHING`,
      [ev.event_id, JSON.stringify(ev)]
    );
  }
```

---

## SECTION 5 — Settlement Worker (CRITICAL)

### settlement-worker.ts (FULL)

```typescript
import crypto from 'node:crypto';
import { PoolClient } from 'pg';
import { Decimal, type DecimalInstance } from '../../lib/decimal.js';
import { db } from '../../lib/database.js';
import { logger } from '../../lib/logger.js';
import { tradeValue, takerFee, makerFee, toNumeric } from './decimal-utils.js';
import { getTradingHalted, getSettlementCircuitOpen } from '../../lib/trading-halt.js';
import { isTradingHalted, triggerCircuitIfViolation } from './settlement-circuit.js';
import { LEDGER_ENTRY_DOMAIN, SETTLEMENT_EVENT_DOMAIN } from './settlement-hash-constants.js';
import { assertNonNegative, assertValidDecimal } from '../../lib/monetary-invariants.js';
import {
  recordSettlementEvent,
  recordOperationalEvent,
} from '../exchange-monitoring.service.js';
import { ensureUserBalanceRow, assertBalanceInvariant, CHAIN_ID_GLOBAL } from '../../lib/user-balance-helper.js';

const WORKER_INTERVAL_MS = 1_000;
const MAX_RETRIES = 10;
const SETTLEMENT_ACCOUNT_TYPE = 'trading';

interface SettlementRow {
  id: number;
  engine_event_id: number;
  payload: EnginePayload;
}

interface EnginePayload {
  event_id: number;
  symbol: string;
  price: string;
  qty: string;
  taker_order_id: string;
  maker_order_id: string;
  taker_user_id: string;
  maker_user_id: string;
  taker_side: 'buy' | 'sell';
  timestamp: number;
}

async function resolveMarketAssets(client: PoolClient, symbol: string): Promise<{ base: string; quote: string; base_currency_id: string; quote_currency_id: string; price_precision: number; qty_precision: number; quote_precision: number }> {
  const r = await client.query<{ base_asset: string; quote_asset: string; base_currency_id: string | null; quote_currency_id: string | null; price_precision: number; qty_precision: number; quote_precision: number }>(
    `SELECT base_asset, quote_asset, base_currency_id, quote_currency_id, price_precision, qty_precision, COALESCE(c.decimals, 8)::int AS quote_precision
     FROM spot_markets m LEFT JOIN currencies c ON c.id = m.quote_currency_id WHERE m.symbol = $1`,
    [symbol]
  );
  if (r.rows.length === 0) throw new Error('MARKET_NOT_FOUND');
  const row = r.rows[0]!;
  let baseCurrencyId = row.base_currency_id;
  let quoteCurrencyId = row.quote_currency_id;
  if (!baseCurrencyId || !quoteCurrencyId) {
    const bySym = await client.query<{ id: string; symbol: string }>(
      `SELECT id, symbol FROM currencies WHERE UPPER(TRIM(symbol)) IN (UPPER(TRIM($1)), UPPER(TRIM($2)))`,
      [row.base_asset, row.quote_asset]
    );
    for (const c of bySym.rows) {
      if (String(c.symbol).toUpperCase() === String(row.base_asset).toUpperCase()) baseCurrencyId = baseCurrencyId ?? c.id;
      if (String(c.symbol).toUpperCase() === String(row.quote_asset).toUpperCase()) quoteCurrencyId = quoteCurrencyId ?? c.id;
    }
  }
  if (!baseCurrencyId || !quoteCurrencyId) throw new Error('MARKET_CURRENCY_NOT_FOUND');
  return {
    base: row.base_asset,
    quote: row.quote_asset,
    base_currency_id: baseCurrencyId,
    quote_currency_id: quoteCurrencyId,
    price_precision: typeof row.price_precision === 'number' ? row.price_precision : 8,
    qty_precision: typeof row.qty_precision === 'number' ? row.qty_precision : 8,
    quote_precision: typeof row.quote_precision === 'number' ? row.quote_precision : 8,
  };
}

async function processEvent(client: PoolClient, row: SettlementRow): Promise<void> {
  const existingLedger = await client.query<{ id: number }>(
    `SELECT id FROM settlement_ledger_entries WHERE settlement_event_id = $1 LIMIT 1`,
    [row.id]
  );
  if (existingLedger.rows.length > 0) {
    const p = row.payload as EnginePayload;
    const { quote_precision } = await resolveMarketAssets(client, p.symbol);
    const tradeVal = tradeValue(p.price, p.qty).toDecimalPlaces(quote_precision, 1);
    const takerFeeAmt = takerFee(tradeVal).toDecimalPlaces(quote_precision, 1);
    const makerFeeAmt = makerFee(tradeVal).toDecimalPlaces(quote_precision, 1);
    const ledgerRows = await client.query<{ user_id: string; asset: string; delta: string }>(
      `SELECT user_id, asset, delta::text AS delta FROM settlement_ledger_entries WHERE settlement_event_id = $1 ORDER BY id`,
      [row.id]
    );
    const ledgerLines = ledgerRows.rows.map((r) => `${r.user_id}|${r.asset}|${toNumeric(new Decimal(r.delta))}`).sort().join('\n');
    const payloadSorted = (Object.keys(p) as (keyof EnginePayload)[]).sort();
    const payloadCanonical = JSON.stringify(payloadSorted.map((k) => [k, (p as unknown as Record<string, unknown>)[k]]));
    const hashPayload = [SETTLEMENT_EVENT_DOMAIN, payloadCanonical, toNumeric(tradeVal), toNumeric(takerFeeAmt), toNumeric(makerFeeAmt), ledgerLines].join('|');
    const computedHash = crypto.createHash('sha256').update(hashPayload, 'utf8').digest('hex');
    await client.query(
      `UPDATE settlement_events SET status = 'processed', processed_at = NOW(), hash = $2 WHERE id = $1`,
      [row.id, computedHash]
    );
    recordSettlementEvent({ type: 'replay_detected', settlementEventId: row.id, engineEventId: row.engine_event_id });
    return;
  }

  const p = row.payload as EnginePayload;
  const { base, quote, base_currency_id, quote_currency_id, price_precision, qty_precision, quote_precision } =
    await resolveMarketAssets(client, p.symbol);
  const assetToCurrency: Record<string, string> = { [base]: base_currency_id, [quote]: quote_currency_id };
  const ROUND_DOWN = 1;
  assertValidDecimal('settlement_price', p.price);
  assertValidDecimal('settlement_qty', p.qty);
  assertNonNegative('settlement_qty', p.qty);
  const price = new Decimal(p.price).toDecimalPlaces(price_precision, ROUND_DOWN);
  const qty = new Decimal(p.qty).toDecimalPlaces(qty_precision, ROUND_DOWN);
  const tradeVal = tradeValue(p.price, p.qty).toDecimalPlaces(quote_precision, ROUND_DOWN);
  const takerFeeAmt = takerFee(tradeVal).toDecimalPlaces(quote_precision, ROUND_DOWN);
  const makerFeeAmt = makerFee(tradeVal).toDecimalPlaces(quote_precision, ROUND_DOWN);
  if (takerFeeAmt.plus(makerFeeAmt).gt(tradeVal)) throw new Error('FEE_INVARIANT_VIOLATION');

  const takerId = p.taker_user_id;
  const makerId = p.maker_user_id;
  const norm = (s: string) => String(s).toLowerCase().replace(/-/g, '');
  if (norm(takerId) === norm(makerId)) throw new Error('SELF_TRADE_REJECTED');

  const pairs: [string, string][] = [
    [takerId, base], [takerId, quote], [makerId, base], [makerId, quote],
  ];
  const uniquePairs = Array.from(new Map(pairs.map(([u, a]) => [`${u}:${a}`, [u, a] as [string, string]])).values());
  uniquePairs.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));

  for (const [userId, asset] of uniquePairs) {
    const currencyId = assetToCurrency[asset];
    if (currencyId) await ensureUserBalanceRow(userId, currencyId, CHAIN_ID_GLOBAL, SETTLEMENT_ACCOUNT_TYPE, client);
  }

  const uniqueUserCurrency = Array.from(
    new Map(uniquePairs.map(([u, a]) => [`${u}:${assetToCurrency[a] ?? ''}`, [u, assetToCurrency[a]!] as [string, string]])).values()
  ).filter(([, cid]) => !!cid);
  const lockPlaceholders = uniqueUserCurrency.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(', ');
  const lockValues = uniqueUserCurrency.flatMap(([u, c]) => [u, c]);
  const lockResult =
    lockPlaceholders === ''
      ? { rows: [] as { user_id: string; currency_id: string; available_balance: string; locked_balance: string }[] }
      : await client.query<{ user_id: string; currency_id: string; available_balance: string; locked_balance: string }>(
          `SELECT user_id, currency_id, available_balance::text AS available_balance, locked_balance::text AS locked_balance
           FROM user_balances WHERE (user_id, currency_id) IN (${lockPlaceholders}) AND COALESCE(chain_id, '') = $1 AND account_type = $2
           FOR UPDATE`,
          [...lockValues, CHAIN_ID_GLOBAL, SETTLEMENT_ACCOUNT_TYPE]
        );

  const getBal = (userId: string, asset: string) => {
    const currencyId = assetToCurrency[asset];
    const r = lockResult.rows.find((row) => row.user_id === userId && row.currency_id === currencyId);
    return {
      available: new Decimal(r?.available_balance ?? '0'),
      locked: new Decimal(r?.locked_balance ?? '0'),
    };
  };

  if (p.taker_side === 'buy') {
    const takerQuoteLocked = getBal(takerId, quote).locked;
    const makerBaseLocked = getBal(makerId, base).locked;
    if (takerQuoteLocked.lt(tradeVal) || makerBaseLocked.lt(qty)) throw new Error('INSUFFICIENT_LOCKED_FUNDS');
  } else {
    const takerBaseLocked = getBal(takerId, base).locked;
    const makerQuoteLocked = getBal(makerId, quote).locked;
    if (takerBaseLocked.lt(qty) || makerQuoteLocked.lt(tradeVal)) throw new Error('INSUFFICIENT_LOCKED_FUNDS');
  }

  if (p.taker_side === 'buy') {
    const takerQuoteAvail = getBal(takerId, quote).available;
    const makerQuoteAvail = getBal(makerId, quote).available;
    if (takerQuoteAvail.lt(takerFeeAmt)) throw new Error('INSUFFICIENT_FUNDS_FOR_FEE');
    if (makerQuoteAvail.plus(tradeVal).lt(makerFeeAmt)) throw new Error('INSUFFICIENT_FUNDS_FOR_FEE');
  } else {
    const takerQuoteAvail = getBal(takerId, quote).available;
    const makerQuoteAvail = getBal(makerId, quote).available;
    if (takerQuoteAvail.plus(tradeVal).lt(takerFeeAmt)) throw new Error('INSUFFICIENT_FUNDS_FOR_FEE');
    if (makerQuoteAvail.lt(makerFeeAmt)) throw new Error('INSUFFICIENT_FUNDS_FOR_FEE');
  }

  const makerQuoteNetCredit = tradeVal.minus(makerFeeAmt).toDecimalPlaces(quote_precision, ROUND_DOWN);
  const takerQuoteNetCredit = tradeVal.minus(takerFeeAmt).toDecimalPlaces(quote_precision, ROUND_DOWN);

  const updates: { userId: string; asset: string; currencyId: string; available: DecimalInstance; locked: DecimalInstance }[] = [];
  const ledgerDeltas: { user_id: string; asset: string; delta: DecimalInstance }[] = [];

  if (p.taker_side === 'buy') {
    const takerBase = getBal(takerId, base);
    const takerQuote = getBal(takerId, quote);
    const makerBase = getBal(makerId, base);
    const makerQuote = getBal(makerId, quote);
    updates.push(
      { userId: takerId, asset: base, currencyId: base_currency_id, available: takerBase.available.plus(qty), locked: takerBase.locked },
      { userId: takerId, asset: quote, currencyId: quote_currency_id, available: takerQuote.available.minus(takerFeeAmt), locked: takerQuote.locked.minus(tradeVal) },
      { userId: makerId, asset: base, currencyId: base_currency_id, available: makerBase.available, locked: makerBase.locked.minus(qty) },
      { userId: makerId, asset: quote, currencyId: quote_currency_id, available: makerQuote.available.plus(makerQuoteNetCredit), locked: makerQuote.locked },
    );
    ledgerDeltas.push(
      { user_id: takerId, asset: base, delta: qty },
      { user_id: takerId, asset: quote, delta: tradeVal.negated().minus(takerFeeAmt) },
      { user_id: makerId, asset: base, delta: qty.negated() },
      { user_id: makerId, asset: quote, delta: makerQuoteNetCredit },
    );
  } else {
    const takerBase = getBal(takerId, base);
    const takerQuote = getBal(takerId, quote);
    const makerBase = getBal(makerId, base);
    const makerQuote = getBal(makerId, quote);
    updates.push(
      { userId: takerId, asset: base, currencyId: base_currency_id, available: takerBase.available, locked: takerBase.locked.minus(qty) },
      { userId: takerId, asset: quote, currencyId: quote_currency_id, available: takerQuote.available.plus(takerQuoteNetCredit), locked: takerQuote.locked },
      { userId: makerId, asset: base, currencyId: base_currency_id, available: makerBase.available.plus(qty), locked: makerBase.locked },
      { userId: makerId, asset: quote, currencyId: quote_currency_id, available: makerQuote.available.minus(makerFeeAmt), locked: makerQuote.locked.minus(tradeVal) },
    );
    ledgerDeltas.push(
      { user_id: takerId, asset: base, delta: qty.negated() },
      { user_id: takerId, asset: quote, delta: takerQuoteNetCredit },
      { user_id: makerId, asset: base, delta: qty },
      { user_id: makerId, asset: quote, delta: tradeVal.negated().minus(makerFeeAmt) },
    );
  }

  if (ledgerDeltas.length === 0) throw new Error('LEDGER_CONSISTENCY_VIOLATION');

  const lastEntryRow = await client.query<{ entry_hash: string | null }>(
    `SELECT entry_hash FROM settlement_ledger_entries ORDER BY id DESC LIMIT 1`
  );
  let prevHash: string | null = lastEntryRow.rows[0]?.entry_hash ?? null;

  const chainEntries: { user_id: string; asset: string; delta: DecimalInstance; prev_hash: string | null; entry_hash: string }[] = [];
  for (const ld of ledgerDeltas) {
    const deltaStr = toNumeric(ld.delta);
    const chainPayload = `${LEDGER_ENTRY_DOMAIN}|${prevHash ?? ''}|${row.id}|${ld.user_id}|${ld.asset}|${deltaStr}`;
    const entryHash = crypto.createHash('sha256').update(chainPayload, 'utf8').digest('hex');
    chainEntries.push({ user_id: ld.user_id, asset: ld.asset, delta: ld.delta, prev_hash: prevHash, entry_hash: entryHash });
    prevHash = entryHash;
  }

  for (let i = 0; i < chainEntries.length; i++) {
    const ce = chainEntries[i]!;
    await client.query(
      `INSERT INTO settlement_ledger_entries (settlement_event_id, user_id, asset, delta, prev_hash, entry_hash)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [row.id, ce.user_id, ce.asset, toNumeric(ce.delta), ce.prev_hash, ce.entry_hash]
    );
  }

  const insertedRows = await client.query<{ id: number; prev_hash: string | null; entry_hash: string | null }>(
    `SELECT id, prev_hash, entry_hash FROM settlement_ledger_entries WHERE settlement_event_id = $1 ORDER BY id ASC`,
    [row.id]
  );
  const expectedFirstPrev = lastEntryRow.rows[0]?.entry_hash ?? null;
  for (let i = 0; i < insertedRows.rows.length; i++) {
    const r = insertedRows.rows[i]!;
    const expectedPrev = i === 0 ? expectedFirstPrev : insertedRows.rows[i - 1]!.entry_hash;
    if ((r.prev_hash ?? null) !== (expectedPrev ?? null) || !r.entry_hash) throw new Error('LEDGER_CHAIN_VIOLATION');
  }

  for (const u of updates) {
    if (u.available.lt(0) || u.locked.lt(0)) {
      throw new Error(`Settlement would result in negative balance: user=${u.userId} currency=${u.currencyId} available=${u.available.toString()} locked=${u.locked.toString()}`);
    }
    const updResult = await client.query(
      `UPDATE user_balances SET available_balance = $1, locked_balance = $2, updated_at = NOW()
       WHERE user_id = $3 AND currency_id = $4 AND COALESCE(chain_id, '') = $5 AND account_type = $6
       RETURNING *`,
      [toNumeric(u.available), toNumeric(u.locked), u.userId, u.currencyId, CHAIN_ID_GLOBAL, SETTLEMENT_ACCOUNT_TYPE]
    );
    if (updResult.rows[0]) assertBalanceInvariant(updResult.rows[0]);
  }

  for (const { user_id, asset } of ledgerDeltas) {
    const currencyId = assetToCurrency[asset];
    if (!currencyId) continue;
    const sumResult = await client.query<{ sum: string }>(
      `SELECT COALESCE(SUM(delta), 0)::text AS sum FROM settlement_ledger_entries WHERE user_id = $1 AND asset = $2`,
      [user_id, asset]
    );
    const balResult = await client.query<{ available_balance: string; locked_balance: string }>(
      `SELECT available_balance::text, locked_balance::text FROM user_balances
       WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = $4`,
      [user_id, currencyId, CHAIN_ID_GLOBAL, SETTLEMENT_ACCOUNT_TYPE]
    );
    const ledgerTotal = new Decimal(sumResult.rows[0]?.sum ?? '0');
    const available = new Decimal(balResult.rows[0]?.available_balance ?? '0');
    const locked = new Decimal(balResult.rows[0]?.locked_balance ?? '0');
    const balanceTotal = available.plus(locked);
    if (!ledgerTotal.eq(balanceTotal)) throw new Error('GLOBAL_LEDGER_INVARIANT_VIOLATION');
  }

  const ledgerLines = [...ledgerDeltas]
    .sort((a, b) => (a.user_id === b.user_id ? a.asset.localeCompare(b.asset) : a.user_id.localeCompare(b.user_id)))
    .map((ld) => `${ld.user_id}|${ld.asset}|${toNumeric(ld.delta)}`)
    .join('\n');
  const payloadSorted = (Object.keys(p) as (keyof EnginePayload)[]).sort();
  const payloadCanonical = JSON.stringify(payloadSorted.map((k) => [k, (p as unknown as Record<string, unknown>)[k]]));
  const hashPayload = [SETTLEMENT_EVENT_DOMAIN, payloadCanonical, toNumeric(tradeVal), toNumeric(takerFeeAmt), toNumeric(makerFeeAmt), ledgerLines].join('|');
  const computedHash = crypto.createHash('sha256').update(hashPayload, 'utf8').digest('hex');

  const existingHashRow = await client.query<{ hash: string | null }>(`SELECT hash FROM settlement_events WHERE id = $1`, [row.id]);
  const existingHash = existingHashRow.rows[0]?.hash ?? null;
  if (existingHash != null && existingHash !== computedHash) throw new Error('SETTLEMENT_HASH_MISMATCH');

  await client.query(
    `INSERT INTO settlement_trades (symbol, price, qty, quote_qty, taker_user_id, maker_user_id, taker_order_id, maker_order_id, taker_fee, maker_fee)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [p.symbol, toNumeric(price), toNumeric(qty), toNumeric(tradeVal), p.taker_user_id, p.maker_user_id, p.taker_order_id, p.maker_order_id, toNumeric(takerFeeAmt), toNumeric(makerFeeAmt)]
  );

  const matchedQtyNum = toNumeric(qty);
  const takerOrderUpdate = await client.query(
    `UPDATE orders SET filled_quantity = filled_quantity + $1, remaining_quantity = remaining_quantity - $1,
     status = CASE WHEN (remaining_quantity - $1) <= 0 THEN 'filled' ELSE 'partially_filled' END,
     updated_at = NOW() WHERE id = $2::uuid AND remaining_quantity >= $1`,
    [matchedQtyNum, p.taker_order_id]
  );
  if ((takerOrderUpdate.rowCount ?? 0) === 0) throw new Error('ORDER_INVARIANT_VIOLATION');
  const makerOrderUpdate = await client.query(
    `UPDATE orders SET filled_quantity = filled_quantity + $1, remaining_quantity = remaining_quantity - $1,
     status = CASE WHEN (remaining_quantity - $1) <= 0 THEN 'filled' ELSE 'partially_filled' END,
     updated_at = NOW() WHERE id = $2::uuid AND remaining_quantity >= $1`,
    [matchedQtyNum, p.maker_order_id]
  );
  if ((makerOrderUpdate.rowCount ?? 0) === 0) throw new Error('ORDER_INVARIANT_VIOLATION');

  await client.query(
    `UPDATE settlement_events SET status = 'processed', processed_at = NOW(), hash = $2 WHERE id = $1`,
    [row.id, computedHash]
  );
}

async function runOnce(): Promise<void> {
  if (isTradingHalted()) return;
  if (await getTradingHalted()) return;
  if (await getSettlementCircuitOpen()) return;
  const client = await db.getSettlementClient();
  try {
    await client.query('BEGIN');
    const pending = await client.query<SettlementRow>(
      `SELECT id, engine_event_id, payload FROM settlement_events
       WHERE status = 'pending' AND retry_count < $1
       ORDER BY id ASC LIMIT 1 FOR UPDATE SKIP LOCKED`,
      [MAX_RETRIES]
    );
    if (pending.rows.length === 0) {
      await client.query('ROLLBACK');
      return;
    }
    const row = pending.rows[0]!;
    try {
      await processEvent(client, row);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      const errMsg = err instanceof Error ? err.message : String(err);
      triggerCircuitIfViolation(errMsg);
      const isFatalError =
        errMsg === 'INSUFFICIENT_LOCKED_FUNDS' ||
        errMsg === 'INSUFFICIENT_FUNDS_FOR_FEE' ||
        errMsg === 'ORDER_INVARIANT_VIOLATION' ||
        errMsg === 'FEE_INVARIANT_VIOLATION' ||
        errMsg === 'GLOBAL_BALANCE_INVARIANT_VIOLATION' ||
        errMsg === 'GLOBAL_LEDGER_INVARIANT_VIOLATION' ||
        errMsg === 'SETTLEMENT_HASH_MISMATCH' ||
        errMsg === 'LEDGER_CHAIN_VIOLATION' ||
        errMsg === 'LEDGER_IMMUTABLE_VIOLATION' ||
        errMsg === 'LEDGER_CONSISTENCY_VIOLATION';
      if (isFatalError) {
        recordSettlementEvent({ type: 'failure_fatal', settlementEventId: row.id, engineEventId: row.engine_event_id, error: errMsg });
        await client.query(
          `UPDATE settlement_events SET status = 'failed', last_error = $1, processed_at = NOW() WHERE id = $2`,
          [errMsg, row.id]
        );
        logger.warn('Settlement event failed (fatal)', { id: row.id, engine_event_id: row.engine_event_id, error: errMsg });
      } else {
        const updateResult = await client.query<{ retry_count: number }>(
          `UPDATE settlement_events SET retry_count = retry_count + 1, last_error = $1 WHERE id = $2 RETURNING retry_count`,
          [errMsg.substring(0, 1000), row.id]
        );
        const newRetryCount = updateResult.rows[0]?.retry_count ?? 0;
        if (newRetryCount >= MAX_RETRIES) {
          recordSettlementEvent({ type: 'failure_max_retries', settlementEventId: row.id, engineEventId: row.engine_event_id, error: errMsg, retryCount: newRetryCount });
          await client.query(`UPDATE settlement_events SET status = 'failed', processed_at = NOW() WHERE id = $1`, [row.id]);
        } else {
          recordSettlementEvent({ type: 'failure_retry', settlementEventId: row.id, engineEventId: row.engine_event_id, error: errMsg, retryCount: newRetryCount });
        }
        logger.warn('Settlement event failed, will retry', { id: row.id, engine_event_id: row.engine_event_id, error: errMsg, retry_count: newRetryCount });
      }
    }
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { }
    recordOperationalEvent({ type: 'settlement_worker_error', error: err instanceof Error ? err.message : String(err) });
    throw err;
  } finally {
    client.release();
  }
}

export function startSettlementWorker(): void {
  if (workerIntervalId != null) return;
  workerIntervalId = setInterval(() => {
    runOnce().catch((err) => {
      logger.error('Settlement worker error', { error: err instanceof Error ? err.message : String(err) });
    });
  }, WORKER_INTERVAL_MS);
  recordOperationalEvent({ type: 'settlement_worker_start' });
  logger.info('Settlement worker started');
}

export function stopSettlementWorker(): void {
  if (workerIntervalId != null) {
    clearInterval(workerIntervalId);
    workerIntervalId = null;
    recordOperationalEvent({ type: 'settlement_worker_stop' });
    logger.info('Settlement worker stopped');
  }
}
```

---

## SECTION 6 — Spot Schema Definitions

### migrate.ts

**spot_orders:**
```sql
CREATE TABLE IF NOT EXISTS spot_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  market VARCHAR(30) NOT NULL,
  side VARCHAR(4) NOT NULL CHECK (side IN ('buy', 'sell')),
  type VARCHAR(10) NOT NULL CHECK (type IN ('market', 'limit')),
  price DECIMAL(36,18),
  quantity DECIMAL(36,18) NOT NULL,
  filled_quantity DECIMAL(36,18) NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED', 'REJECTED')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_spot_orders_user_id ON spot_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_spot_orders_market ON spot_orders(market);
CREATE INDEX IF NOT EXISTS idx_spot_orders_status ON spot_orders(status);
CREATE INDEX IF NOT EXISTS idx_spot_orders_created_at ON spot_orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_spot_orders_open ON spot_orders(market, side, status) WHERE status IN ('OPEN', 'PARTIALLY_FILLED');
```

**spot_trades:**
```sql
CREATE TABLE IF NOT EXISTS spot_trades (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES spot_orders(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  market VARCHAR(30) NOT NULL,
  side VARCHAR(4) NOT NULL CHECK (side IN ('buy', 'sell')),
  price DECIMAL(36,18) NOT NULL,
  quantity DECIMAL(36,18) NOT NULL,
  fee DECIMAL(36,18) NOT NULL DEFAULT 0,
  fee_asset VARCHAR(20),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_spot_trades_order_id ON spot_trades(order_id);
CREATE INDEX IF NOT EXISTS idx_spot_trades_user_id ON spot_trades(user_id);
CREATE INDEX IF NOT EXISTS idx_spot_trades_market ON spot_trades(market);
CREATE INDEX IF NOT EXISTS idx_spot_trades_created_at ON spot_trades(created_at DESC);
```

**balance_locks:**
```sql
CREATE TYPE balance_lock_reason AS ENUM ('order', 'withdrawal', 'escrow');
CREATE TABLE IF NOT EXISTS balance_locks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  currency_id UUID NOT NULL REFERENCES currencies(id) ON DELETE CASCADE,
  account_type balance_account_type NOT NULL,
  amount DECIMAL(30,8) NOT NULL CHECK (amount > 0),
  reason balance_lock_reason NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE balance_locks ADD COLUMN IF NOT EXISTS reference_id UUID;
CREATE INDEX IF NOT EXISTS idx_balance_locks_user_currency_account ON balance_locks(user_id, currency_id, account_type);
CREATE INDEX IF NOT EXISTS idx_balance_locks_expires_at ON balance_locks(expires_at);
CREATE INDEX IF NOT EXISTS idx_balance_locks_reference_id ON balance_locks(reference_id) WHERE reference_id IS NOT NULL;
```

### full-schema.sql

**spot_orders:**
```sql
CREATE TABLE spot_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id),
  trading_pair_id UUID NOT NULL REFERENCES trading_pairs(id),
  client_order_id VARCHAR(100),
  order_type order_type NOT NULL,
  side order_side NOT NULL,
  price DECIMAL(30,8),
  stop_price DECIMAL(30,8),
  trailing_delta DECIMAL(30,8),
  quantity DECIMAL(30,8) NOT NULL,
  filled_quantity DECIMAL(30,8) DEFAULT 0,
  remaining_quantity DECIMAL(30,8),
  visible_quantity DECIMAL(30,8),
  quote_quantity DECIMAL(30,8),
  filled_quote_amount DECIMAL(30,8) DEFAULT 0,
  avg_fill_price DECIMAL(30,8),
  fee_amount DECIMAL(30,8) DEFAULT 0,
  fee_currency_id UUID REFERENCES currencies(id),
  is_maker BOOLEAN,
  time_in_force time_in_force DEFAULT 'GTC',
  expire_at TIMESTAMP WITH TIME ZONE,
  status order_status DEFAULT 'new',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  filled_at TIMESTAMP WITH TIME ZONE,
  cancelled_at TIMESTAMP WITH TIME ZONE,
  source order_source DEFAULT 'web',
  ip_address INET
);
CREATE INDEX idx_orders_user ON spot_orders(user_id);
CREATE INDEX idx_orders_pair ON spot_orders(trading_pair_id);
CREATE INDEX idx_orders_status ON spot_orders(status);
CREATE INDEX idx_orders_created ON spot_orders(created_at);
CREATE INDEX idx_orders_client_id ON spot_orders(client_order_id);
CREATE INDEX idx_orders_book ON spot_orders(trading_pair_id, side, status, price);
```

**spot_trades:**
```sql
CREATE TABLE spot_trades (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trading_pair_id UUID NOT NULL REFERENCES trading_pairs(id),
  maker_order_id UUID NOT NULL REFERENCES spot_orders(id),
  taker_order_id UUID NOT NULL REFERENCES spot_orders(id),
  maker_user_id UUID NOT NULL REFERENCES users(id),
  taker_user_id UUID NOT NULL REFERENCES users(id),
  price DECIMAL(30,8) NOT NULL,
  quantity DECIMAL(30,8) NOT NULL,
  quote_amount DECIMAL(30,8) NOT NULL,
  side order_side NOT NULL,
  maker_fee DECIMAL(30,8) NOT NULL,
  maker_fee_currency_id UUID NOT NULL REFERENCES currencies(id),
  taker_fee DECIMAL(30,8) NOT NULL,
  taker_fee_currency_id UUID NOT NULL REFERENCES currencies(id),
  maker_referral_commission DECIMAL(30,8) DEFAULT 0,
  taker_referral_commission DECIMAL(30,8) DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_trades_pair ON spot_trades(trading_pair_id);
CREATE INDEX idx_trades_maker ON spot_trades(maker_user_id);
CREATE INDEX idx_trades_taker ON spot_trades(taker_user_id);
CREATE INDEX idx_trades_created ON spot_trades(created_at);
CREATE INDEX idx_trades_maker_order ON spot_trades(maker_order_id);
CREATE INDEX idx_trades_taker_order ON spot_trades(taker_order_id);
```

**audit_logs_immutable (migrate.ts):**
```sql
CREATE TABLE IF NOT EXISTS audit_logs_immutable (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  request_id VARCHAR(64),
  actor_type audit_actor_type_immutable NOT NULL,
  actor_id UUID,
  action VARCHAR(80) NOT NULL,
  resource_type VARCHAR(50),
  resource_id UUID,
  old_value TEXT,
  new_value TEXT,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_audit_immutable_actor ON audit_logs_immutable(actor_type, actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_immutable_action ON audit_logs_immutable(action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_immutable_resource ON audit_logs_immutable(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_immutable_created ON audit_logs_immutable(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_immutable_request_id ON audit_logs_immutable(request_id) WHERE request_id IS NOT NULL;
CREATE OR REPLACE FUNCTION audit_logs_immutable_no_update_delete() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'audit_logs_immutable: UPDATE not allowed'; END IF;
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'audit_logs_immutable: DELETE not allowed'; END IF;
  RETURN NULL;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_audit_logs_immutable_no_update BEFORE UPDATE ON audit_logs_immutable FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable_no_update_delete();
CREATE TRIGGER trg_audit_logs_immutable_no_delete BEFORE DELETE ON audit_logs_immutable FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable_no_update_delete();
```

---

## SECTION 7 — Admin Manual Credit Flow (HIGH RISK)

### POST /admin/deposits/manual-credit (FULL)

```typescript
  app.post<{
    Body: { user: string; currency: string; amount: string; reason?: string };
  }>('/deposits/manual-credit', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const idempotencyKeyRaw = (request.headers[IDEMPOTENCY_KEY_HEADER] ?? request.headers['Idempotency-Key']) as string | undefined;
      const idempotencyKey = typeof idempotencyKeyRaw === 'string' ? idempotencyKeyRaw.trim() : '';
      if (!idempotencyKey) {
        return reply.status(400).send({
          success: false,
          error: { code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'Idempotency-Key header is required for manual credit requests.' },
        });
      }
      if (idempotencyKey.length > 256) {
        return reply.status(400).send({
          success: false,
          error: { code: 'IDEMPOTENCY_KEY_INVALID', message: 'Idempotency-Key must be at most 256 characters.' },
        });
      }
      const creditRequestHash = buildAdminManualCreditRequestHash((request.body || {}) as Record<string, unknown>);
      const creditRedisKey = `admin:manual-credit:idempotency:${admin.adminId}:${idempotencyKey}`;
      const creditCached = await redis.getJson<AdminManualCreditIdempotencyCache>(creditRedisKey);
      if (creditCached) {
        if (creditCached.requestHash !== creditRequestHash) {
          return reply.status(409).send({
            success: false,
            error: {
              code: 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_BODY',
              message: 'Idempotency-Key was already used with a different request body. Use a new key or the same request body.',
            },
          });
        }
        return reply.status(200).send(creditCached.response);
      }
      const creditLockKey = `admin:manual-credit:lock:${admin.adminId}:${idempotencyKey}`;
      const creditLockAcquired = await redis.setNxEx(creditLockKey, '1', ADMIN_CREDIT_IDEMPOTENCY_LOCK_TTL_SECONDS);
      if (!creditLockAcquired) {
        return reply.status(409).send({
          success: false,
          error: {
            code: 'DUPLICATE_REQUEST',
            message: 'A manual credit with this Idempotency-Key is already in progress. Retry after a few seconds.',
          },
        });
      }

      const { user: userInput, currency: symbol, amount: amountStr, reason } = request.body || {};
      if (!userInput?.trim() || !symbol?.trim() || !amountStr?.trim()) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_INPUT', message: 'user, currency, and amount are required' },
        });
      }
      const ROUND_DOWN = 1;
      const PREC = 8;
      let amountDec: DecimalInstance;
      try {
        amountDec = new Decimal(amountStr.trim()).toDecimalPlaces(PREC, ROUND_DOWN);
      } catch {
        amountDec = new Decimal(NaN);
      }
      if (!amountDec.isFinite() || amountDec.lte(0)) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_AMOUNT', message: 'amount must be a positive number' },
        });
      }
      const userRow = await db.query<{ id: string; email: string }>(
        `SELECT id, email FROM users WHERE status = 'active' AND deleted_at IS NULL
         AND (id::text = $1 OR LOWER(TRIM(email)) = LOWER(TRIM($1))) LIMIT 1`,
        [userInput.trim()]
      );
      if (userRow.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'USER_NOT_FOUND', message: 'User not found' },
        });
      }
      const userId = userRow.rows[0]!.id;
      const currencyId = await getCurrencyIdBySymbol(symbol.trim());
      if (!currencyId) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_CURRENCY', message: 'Currency not found' },
        });
      }

      await db.transaction(async (client) => {
        await ensureUserBalanceRow(userId, currencyId, CHAIN_ID_GLOBAL, 'funding', client);
        const sel = await client.query<{ available_balance: string }>(
          `SELECT available_balance::text FROM user_balances
           WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND COALESCE(account_type::text, 'funding') = 'funding'
           FOR UPDATE`,
          [userId, currencyId, CHAIN_ID_GLOBAL]
        );
        if (sel.rows.length === 0) {
          throw new Error('ADMIN_CREDIT_BALANCE_ROW_NOT_FOUND');
        }
        const avBefore = new Decimal(sel.rows[0]!.available_balance);
        const upd = await client.query(
          `UPDATE user_balances SET available_balance = available_balance + $1::numeric, updated_at = NOW()
           WHERE user_id = $2 AND currency_id = $3 AND COALESCE(chain_id, '') = $4 AND COALESCE(account_type::text, 'funding') = 'funding'
           RETURNING *`,
          [amountDec.toString(), userId, currencyId, CHAIN_ID_GLOBAL]
        );
        assertUserBalanceUpdated('admin_manual_credit', upd, userId, currencyId, 'funding', CHAIN_ID_GLOBAL);
        assertBalanceInvariant(upd.rows[0]);
        const avAfter = new Decimal(upd.rows[0]!.available_balance ?? 0);
        const refId = uuidv4();
        await insertBalanceLedger({
          client,
          userId,
          currencyId,
          accountType: 'funding',
          debit: '0',
          credit: amountDec.toString(),
          balanceBefore: avBefore.toFixed(),
          balanceAfter: avAfter.toFixed(),
          referenceType: 'adjustment',
          referenceId: refId,
          balanceType: 'available',
        });
      });

      logger.info('Admin manual credit', {
        adminId: admin.adminId,
        userId,
        currencyId,
        symbol: symbol.trim(),
        amount: amountDec.toString(),
        reason: reason ?? null,
      });
      const response = {
        success: true as const,
        data: { userId, email: userRow.rows[0]!.email, currency: symbol.trim(), amount: amountDec.toString(), reason: reason ?? null },
      };
      try {
        await redis.setJson(creditRedisKey, { requestHash: creditRequestHash, response }, ADMIN_CREDIT_IDEMPOTENCY_TTL_SECONDS);
      } catch (e) {
        logger.warn('Admin manual credit idempotency cache set failed', { adminId: admin.adminId });
      }
      return reply.send(response);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg === 'ADMIN_CREDIT_BALANCE_ROW_NOT_FOUND') {
        return reply.status(500).send({
          success: false,
          error: { code: 'CREDIT_FAILED', message: 'Balance row not found after ensure' },
        });
      }
      logger.error('Manual credit error', { error: msg });
      return reply.status(500).send({
        success: false,
        error: { code: 'CREDIT_FAILED', message: 'Manual credit failed' },
      });
    }
  });
```

### getAdminFromRequest (FULL)

```typescript
export async function getAdminFromRequest(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  requireSuperAdmin: boolean
): Promise<{ adminId: string; role: string } | null> {
  const token = request.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    reply.status(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'No token provided' } });
    return null;
  }
  let decoded: { adminId: string; role?: string; sessionId: string; type?: string };
  try {
    decoded = app.jwt.verify<typeof decoded>(token);
  } catch {
    reply.status(401).send({ success: false, error: { code: 'INVALID_TOKEN', message: 'Invalid or expired token' } });
    return null;
  }
  if (decoded.type !== 'admin') {
    reply.status(401).send({ success: false, error: { code: 'INVALID_TOKEN', message: 'Invalid admin token' } });
    return null;
  }
  let session: { adminId: string; role: string; isActive: boolean } | null = null;
  try {
    session = await redis.getJson<{ adminId: string; role: string; isActive: boolean }>(`admin:session:${decoded.sessionId}`);
  } catch { }
  if (!session || !session.isActive) {
    const dbSession = await db.query<{ admin_id: string; role: string }>(
      `SELECT s.admin_id, u.role FROM admin_sessions s
       JOIN admin_users u ON u.id = s.admin_id
       WHERE s.id = $1 AND s.expires_at > NOW()`,
      [decoded.sessionId]
    );
    if (dbSession.rows.length === 0) {
      reply.status(401).send({ success: false, error: { code: 'SESSION_EXPIRED', message: 'Session expired' } });
      return null;
    }
    const row = dbSession.rows[0]!;
    session = { adminId: row.admin_id, role: row.role, isActive: true };
  }
  const role = session.role ?? decoded.role ?? '';
  if (requireSuperAdmin && role !== 'super_admin' && role !== 'Super Admin') {
    reply.status(403).send({
      success: false,
      error: { code: 'FORBIDDEN', message: 'Hot wallet actions require Super Admin role.' },
    });
    return null;
  }
  const clientIp = getClientIp(request);
  const whitelist = config.security?.adminIpWhitelist ?? [];
  const path = (request as { routerPath?: string }).routerPath ?? request.url;
  if (config.isProduction && whitelist.length === 0) {
    logger.warn('Admin access denied: IP whitelist empty in production', { adminId: session.adminId, ip: clientIp, path });
    reply.status(403).send({
      success: false,
      error: { code: 'ADMIN_IP_NOT_ALLOWED', message: 'Admin access is restricted from this IP address' },
    });
    return null;
  }
  if (whitelist.length > 0 && !isIpInWhitelist(clientIp, whitelist)) {
    logger.warn('Admin access denied: IP not in whitelist', { adminId: session.adminId, ip: clientIp, path });
    reply.status(403).send({
      success: false,
      error: { code: 'ADMIN_IP_NOT_ALLOWED', message: 'Admin access is restricted from this IP address' },
    });
    return null;
  }
  const allowed = await enforceAdminRateLimit(request, reply, session.adminId, 'admin', 60, 60);
  if (!allowed) return null;
  return { adminId: session.adminId, role };
}
```

---

## SECTION 8 — Immutable Audit Logging

### audit-log.service.ts (FULL)

```typescript
import type { FastifyRequest } from 'fastify';
import { db } from '../lib/database.js';
import { logger } from '../lib/logger.js';
import { getAuditContextFromRequest } from '../lib/audit-context.js';

export type AuditActorType = 'user' | 'admin' | 'system';

export interface AuditLogParams {
  requestId?: string | null;
  actorType: AuditActorType;
  actorId?: string | null;
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  oldValue?: string | Record<string, unknown> | null;
  newValue?: string | Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

function toText(v: string | Record<string, unknown> | null | undefined): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return null;
  }
}

function parseIp(ip: string | undefined | null): string | null {
  if (ip == null || ip === '') return null;
  const trimmed = ip.trim();
  if (trimmed === '') return null;
  return trimmed;
}

export async function logAudit(params: AuditLogParams): Promise<void> {
  const {
    requestId,
    actorType,
    actorId,
    action,
    resourceType,
    resourceId,
    oldValue,
    newValue,
    ipAddress,
    userAgent,
  } = params;

  const oldValText = toText(oldValue ?? null);
  const newValText = toText(newValue ?? null);
  const ip = parseIp(ipAddress ?? null);

  try {
    await db.query(
      `INSERT INTO audit_logs_immutable (
        request_id, actor_type, actor_id, action,
        resource_type, resource_id, old_value, new_value,
        ip_address, user_agent
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::inet, $10)`,
      [
        requestId ?? null,
        actorType,
        actorId ?? null,
        action,
        resourceType ?? null,
        resourceId ?? null,
        oldValText,
        newValText,
        ip,
        userAgent ?? null,
      ]
    );
  } catch (err) {
    logger.warn('Audit log insert failed (best-effort)', {
      action,
      resourceType,
      resourceId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export interface AuditLogFromRequestOverrides {
  actorType: AuditActorType;
  actorId: string | null;
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  oldValue?: string | Record<string, unknown> | null;
  newValue?: string | Record<string, unknown> | null;
}

export async function logAuditFromRequest(
  request: FastifyRequest,
  overrides: AuditLogFromRequestOverrides
): Promise<void> {
  const ctx = getAuditContextFromRequest(request);
  await logAudit({
    requestId: ctx.requestId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    actorType: overrides.actorType,
    actorId: overrides.actorId,
    action: overrides.action,
    resourceType: overrides.resourceType,
    resourceId: overrides.resourceId,
    oldValue: overrides.oldValue,
    newValue: overrides.newValue,
  });
}
```

### audit-context.ts (getAuditContextFromRequest)

```typescript
export function getAuditContextFromRequest(request: FastifyRequest): AuditContext {
  const req = request as FastifyRequest & { requestId?: string };
  const ip = req.ip ?? request.headers['x-forwarded-for'] ?? request.headers['x-real-ip'];
  const ipStr = typeof ip === 'string' ? ip.split(',')[0]?.trim() ?? null : null;
  return {
    requestId: req.requestId ?? null,
    ipAddress: ipStr ?? null,
    userAgent: (request.headers['user-agent'] as string) ?? null,
    actorType: request.user ? 'user' : null,
    actorId: (request.user as { id?: string } | undefined)?.id ?? null,
  };
}
```

