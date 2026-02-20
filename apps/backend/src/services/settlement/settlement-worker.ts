/**
 * Phase-8 Step-5: Settlement Worker.
 * Process pending settlement_events in a single transaction per event:
 * lock user_balances, apply atomic balance mutations, insert settlement_trades. Idempotent by engine_event_id.
 * Ledger MUST be written before any balance update (ledger-first invariant).
 * Uses user_balances (single source of truth); balances table is deprecated.
 */
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

async function resolveMarketAssets(
  client: PoolClient,
  symbol: string
): Promise<{
  base: string;
  quote: string;
  base_currency_id: string;
  quote_currency_id: string;
  price_precision: number;
  qty_precision: number;
  quote_precision: number;
}> {
  const r = await client.query<{
    base_asset: string;
    quote_asset: string;
    base_currency_id: string | null;
    quote_currency_id: string | null;
    price_precision: number;
    qty_precision: number;
    quote_precision: number;
  }>(
    `SELECT base_asset, quote_asset, base_currency_id, quote_currency_id, price_precision, qty_precision,
            COALESCE(c.decimals, 8)::int AS quote_precision
     FROM spot_markets m
     LEFT JOIN currencies c ON c.id = m.quote_currency_id
     WHERE m.symbol = $1`,
    [symbol]
  );
  if (r.rows.length === 0) {
    throw new Error('MARKET_NOT_FOUND');
  }
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
  if (!baseCurrencyId || !quoteCurrencyId) {
    throw new Error('MARKET_CURRENCY_NOT_FOUND');
  }
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
  /* Replay safety: if ledger entries already exist (crash after apply, before status update), only mark processed. */
  const existingLedger = await client.query<{ id: number }>(
    `SELECT id FROM settlement_ledger_entries WHERE settlement_event_id = $1 LIMIT 1`,
    [row.id]
  );
  if (existingLedger.rows.length > 0) {
    const p = row.payload as EnginePayload;
    const { quote_precision } = await resolveMarketAssets(client, p.symbol);
    const price = new Decimal(p.price);
    const qty = new Decimal(p.qty);
    const tradeVal = tradeValue(p.price, p.qty).toDecimalPlaces(quote_precision, 1);
    const takerFeeAmt = takerFee(tradeVal).toDecimalPlaces(quote_precision, 1);
    const makerFeeAmt = makerFee(tradeVal).toDecimalPlaces(quote_precision, 1);
    const ledgerRows = await client.query<{ user_id: string; asset: string; delta: string }>(
      `SELECT user_id, asset, delta::text AS delta FROM settlement_ledger_entries WHERE settlement_event_id = $1 ORDER BY id`,
      [row.id]
    );
    const ledgerLines = ledgerRows.rows
      .map((r) => `${r.user_id}|${r.asset}|${toNumeric(new Decimal(r.delta))}`)
      .sort()
      .join('\n');
    const payloadSorted = (Object.keys(p) as (keyof EnginePayload)[]).sort();
    const payloadCanonical = JSON.stringify(
      payloadSorted.map((k) => [k, (p as unknown as Record<string, unknown>)[k]])
    );
    const hashPayload = [
      SETTLEMENT_EVENT_DOMAIN,
      payloadCanonical,
      toNumeric(tradeVal),
      toNumeric(takerFeeAmt),
      toNumeric(makerFeeAmt),
      ledgerLines,
    ].join('|');
    const computedHash = crypto.createHash('sha256').update(hashPayload, 'utf8').digest('hex');
    await client.query(
      `UPDATE settlement_events SET status = 'processed', processed_at = NOW(), hash = $2 WHERE id = $1`,
      [row.id, computedHash]
    );
    recordSettlementEvent({
      type: 'replay_detected',
      settlementEventId: row.id,
      engineEventId: row.engine_event_id,
    });
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
  /* Precision: price→price_precision, qty→qty_precision (base), trade_value & fees→quote_precision. ROUND_DOWN only. */
  const price = new Decimal(p.price).toDecimalPlaces(price_precision, ROUND_DOWN);
  const qty = new Decimal(p.qty).toDecimalPlaces(qty_precision, ROUND_DOWN);
  const tradeVal = tradeValue(p.price, p.qty).toDecimalPlaces(quote_precision, ROUND_DOWN);
  const takerFeeAmt = takerFee(tradeVal).toDecimalPlaces(quote_precision, ROUND_DOWN);
  const makerFeeAmt = makerFee(tradeVal).toDecimalPlaces(quote_precision, ROUND_DOWN);
  /* Fee invariant: taker_fee + maker_fee <= trade_value. Fees derived only from rounded trade_value. */
  if (takerFeeAmt.plus(makerFeeAmt).gt(tradeVal)) {
    throw new Error('FEE_INVARIANT_VIOLATION');
  }

  const takerId = p.taker_user_id;
  const makerId = p.maker_user_id;
  /* PHASE-12: Self-trade prevention. Normalize UUIDs so same user in different string forms is detected. */
  const norm = (s: string) => String(s).toLowerCase().replace(/-/g, '');
  if (norm(takerId) === norm(makerId)) {
    throw new Error('SELF_TRADE_REJECTED');
  }

  const pairs: [string, string][] = [
    [takerId, base],
    [takerId, quote],
    [makerId, base],
    [makerId, quote],
  ];
  const uniquePairs = Array.from(new Map(pairs.map(([u, a]) => [`${u}:${a}`, [u, a] as [string, string]])).values());
  uniquePairs.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));

  for (const [userId, asset] of uniquePairs) {
    const currencyId = assetToCurrency[asset];
    if (currencyId) {
      await ensureUserBalanceRow(userId, currencyId, CHAIN_ID_GLOBAL, SETTLEMENT_ACCOUNT_TYPE, client);
    }
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
    if (takerQuoteLocked.lt(tradeVal) || makerBaseLocked.lt(qty)) {
      throw new Error('INSUFFICIENT_LOCKED_FUNDS');
    }
  } else {
    const takerBaseLocked = getBal(takerId, base).locked;
    const makerQuoteLocked = getBal(makerId, quote).locked;
    if (takerBaseLocked.lt(qty) || makerQuoteLocked.lt(tradeVal)) {
      throw new Error('INSUFFICIENT_LOCKED_FUNDS');
    }
  }

  if (p.taker_side === 'buy') {
    const takerQuoteAvail = getBal(takerId, quote).available;
    const makerQuoteAvail = getBal(makerId, quote).available;
    if (takerQuoteAvail.lt(takerFeeAmt)) {
      throw new Error('INSUFFICIENT_FUNDS_FOR_FEE');
    }
    if (makerQuoteAvail.plus(tradeVal).lt(makerFeeAmt)) {
      throw new Error('INSUFFICIENT_FUNDS_FOR_FEE');
    }
  } else {
    const takerQuoteAvail = getBal(takerId, quote).available;
    const makerQuoteAvail = getBal(makerId, quote).available;
    if (takerQuoteAvail.plus(tradeVal).lt(takerFeeAmt)) {
      throw new Error('INSUFFICIENT_FUNDS_FOR_FEE');
    }
    if (makerQuoteAvail.lt(makerFeeAmt)) {
      throw new Error('INSUFFICIENT_FUNDS_FOR_FEE');
    }
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
      {
        userId: takerId,
        asset: quote,
        currencyId: quote_currency_id,
        available: takerQuote.available.minus(takerFeeAmt),
        locked: takerQuote.locked.minus(tradeVal),
      },
      {
        userId: makerId,
        asset: base,
        currencyId: base_currency_id,
        available: makerBase.available,
        locked: makerBase.locked.minus(qty),
      },
      {
        userId: makerId,
        asset: quote,
        currencyId: quote_currency_id,
        available: makerQuote.available.plus(makerQuoteNetCredit),
        locked: makerQuote.locked,
      },
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
      {
        userId: takerId,
        asset: base,
        currencyId: base_currency_id,
        available: takerBase.available,
        locked: takerBase.locked.minus(qty),
      },
      {
        userId: takerId,
        asset: quote,
        currencyId: quote_currency_id,
        available: takerQuote.available.plus(takerQuoteNetCredit),
        locked: takerQuote.locked,
      },
      {
        userId: makerId,
        asset: base,
        currencyId: base_currency_id,
        available: makerBase.available.plus(qty),
        locked: makerBase.locked,
      },
      {
        userId: makerId,
        asset: quote,
        currencyId: quote_currency_id,
        available: makerQuote.available.minus(makerFeeAmt),
        locked: makerQuote.locked.minus(tradeVal),
      },
    );
    ledgerDeltas.push(
      { user_id: takerId, asset: base, delta: qty.negated() },
      { user_id: takerId, asset: quote, delta: takerQuoteNetCredit },
      { user_id: makerId, asset: base, delta: qty },
      { user_id: makerId, asset: quote, delta: tradeVal.negated().minus(makerFeeAmt) },
    );
  }

  if (ledgerDeltas.length === 0) {
    throw new Error('LEDGER_CONSISTENCY_VIOLATION');
  }

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

  /* Chain verification inside transaction; deterministic order by id. Mismatch → LEDGER_CHAIN_VIOLATION (fatal). */
  const insertedRows = await client.query<{ id: number; prev_hash: string | null; entry_hash: string | null }>(
    `SELECT id, prev_hash, entry_hash FROM settlement_ledger_entries WHERE settlement_event_id = $1 ORDER BY id ASC`,
    [row.id]
  );
  const expectedFirstPrev = lastEntryRow.rows[0]?.entry_hash ?? null;
  for (let i = 0; i < insertedRows.rows.length; i++) {
    const r = insertedRows.rows[i]!;
    const expectedPrev = i === 0 ? expectedFirstPrev : insertedRows.rows[i - 1]!.entry_hash;
    if ((r.prev_hash ?? null) !== (expectedPrev ?? null) || !r.entry_hash) {
      throw new Error('LEDGER_CHAIN_VIOLATION');
    }
  }

  /* Ledger writes precede balance updates (ledger-first). Every balance mutation has a ledger entry. */
  for (const u of updates) {
    if (u.available.lt(0) || u.locked.lt(0)) {
      throw new Error(
        `Settlement would result in negative balance: user=${u.userId} currency=${u.currencyId} available=${u.available.toString()} locked=${u.locked.toString()}`
      );
    }
    const updResult = await client.query(
      `UPDATE user_balances SET available_balance = $1, locked_balance = $2, updated_at = NOW()
       WHERE user_id = $3 AND currency_id = $4 AND COALESCE(chain_id, '') = $5 AND account_type = $6
       RETURNING *`,
      [toNumeric(u.available), toNumeric(u.locked), u.userId, u.currencyId, CHAIN_ID_GLOBAL, SETTLEMENT_ACCOUNT_TYPE]
    );
    if (updResult.rowCount === 0) {
      throw new Error('MISSING_BALANCE_ROW_FOR_LOCKED_DEBIT');
    }
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
    if (!ledgerTotal.eq(balanceTotal)) {
      throw new Error('GLOBAL_LEDGER_INVARIANT_VIOLATION');
    }
  }

  const ledgerLines = [...ledgerDeltas]
    .sort((a, b) => (a.user_id === b.user_id ? a.asset.localeCompare(b.asset) : a.user_id.localeCompare(b.user_id)))
    .map((ld) => `${ld.user_id}|${ld.asset}|${toNumeric(ld.delta)}`)
    .join('\n');
  const payloadSorted = (Object.keys(p) as (keyof EnginePayload)[]).sort();
  const payloadCanonical = JSON.stringify(
    payloadSorted.map((k) => [k, (p as unknown as Record<string, unknown>)[k]])
  );
  const hashPayload = [
    SETTLEMENT_EVENT_DOMAIN,
    payloadCanonical,
    toNumeric(tradeVal),
    toNumeric(takerFeeAmt),
    toNumeric(makerFeeAmt),
    ledgerLines,
  ].join('|');
  const computedHash = crypto.createHash('sha256').update(hashPayload, 'utf8').digest('hex');

  const existingHashRow = await client.query<{ hash: string | null }>(
    `SELECT hash FROM settlement_events WHERE id = $1`,
    [row.id]
  );
  const existingHash = existingHashRow.rows[0]?.hash ?? null;
  if (existingHash != null && existingHash !== computedHash) {
    throw new Error('SETTLEMENT_HASH_MISMATCH');
  }

  await client.query(
    `INSERT INTO settlement_trades (symbol, price, qty, quote_qty, taker_user_id, maker_user_id, taker_order_id, maker_order_id, taker_fee, maker_fee)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      p.symbol,
      toNumeric(price),
      toNumeric(qty),
      toNumeric(tradeVal),
      p.taker_user_id,
      p.maker_user_id,
      p.taker_order_id,
      p.maker_order_id,
      toNumeric(takerFeeAmt),
      toNumeric(makerFeeAmt),
    ]
  );

  const matchedQtyNum = toNumeric(qty);
  const takerOrderUpdate = await client.query(
    `UPDATE orders SET filled_quantity = filled_quantity + $1, remaining_quantity = remaining_quantity - $1,
     status = CASE WHEN (remaining_quantity - $1) <= 0 THEN 'filled' ELSE 'partially_filled' END,
     updated_at = NOW() WHERE id = $2::uuid AND remaining_quantity >= $1`,
    [matchedQtyNum, p.taker_order_id]
  );
  if ((takerOrderUpdate.rowCount ?? 0) === 0) {
    throw new Error('ORDER_INVARIANT_VIOLATION');
  }
  const makerOrderUpdate = await client.query(
    `UPDATE orders SET filled_quantity = filled_quantity + $1, remaining_quantity = remaining_quantity - $1,
     status = CASE WHEN (remaining_quantity - $1) <= 0 THEN 'filled' ELSE 'partially_filled' END,
     updated_at = NOW() WHERE id = $2::uuid AND remaining_quantity >= $1`,
    [matchedQtyNum, p.maker_order_id]
  );
  if ((makerOrderUpdate.rowCount ?? 0) === 0) {
    throw new Error('ORDER_INVARIANT_VIOLATION');
  }

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
        errMsg === 'LEDGER_CONSISTENCY_VIOLATION' ||
        errMsg === 'MISSING_BALANCE_ROW_FOR_LOCKED_DEBIT' ||
        errMsg.includes('negative balance') ||
        errMsg.startsWith('[INVARIANT_VIOLATION]') ||
        errMsg.startsWith('Settlement would result in negative balance');
      if (isFatalError) {
        recordSettlementEvent({
          type: 'failure_fatal',
          settlementEventId: row.id,
          engineEventId: row.engine_event_id,
          error: errMsg,
        });
        await client.query(
          `UPDATE settlement_events SET status = 'failed', last_error = $1, processed_at = NOW() WHERE id = $2`,
          [errMsg.substring(0, 1000), row.id]
        );
        logger.error('Settlement event failed (fatal, non-retryable)', {
          level: 'critical',
          id: row.id,
          engine_event_id: row.engine_event_id,
          error: errMsg,
        });
      } else {
        const updateResult = await client.query<{ retry_count: number }>(
          `UPDATE settlement_events SET retry_count = retry_count + 1, last_error = $1 WHERE id = $2 RETURNING retry_count`,
          [errMsg.substring(0, 1000), row.id]
        );
        const newRetryCount = updateResult.rows[0]?.retry_count ?? 0;
        if (newRetryCount >= MAX_RETRIES) {
          recordSettlementEvent({
            type: 'failure_max_retries',
            settlementEventId: row.id,
            engineEventId: row.engine_event_id,
            error: errMsg,
            retryCount: newRetryCount,
          });
          await client.query(
            `UPDATE settlement_events SET status = 'failed', processed_at = NOW() WHERE id = $1`,
            [row.id]
          );
        } else {
          recordSettlementEvent({
            type: 'failure_retry',
            settlementEventId: row.id,
            engineEventId: row.engine_event_id,
            error: errMsg,
            retryCount: newRetryCount,
          });
        }
        logger.warn('Settlement event failed, will retry', {
          id: row.id,
          engine_event_id: row.engine_event_id,
          error: errMsg,
          retry_count: newRetryCount,
        });
      }
    }
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    recordOperationalEvent({
      type: 'settlement_worker_error',
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  } finally {
    client.release();
  }
}

let workerIntervalId: ReturnType<typeof setInterval> | null = null;

export function startSettlementWorker(): void {
  if (workerIntervalId != null) {
    return;
  }
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
