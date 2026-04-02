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
import { isTradingHalted, setTradingHalted, triggerCircuitIfViolation } from './settlement-circuit.js';
import { LEDGER_ENTRY_DOMAIN, SETTLEMENT_EVENT_DOMAIN } from './settlement-hash-constants.js';
import { assertNonNegative, assertValidDecimal } from '../../lib/monetary-invariants.js';
import {
  recordSettlementEvent,
  recordOperationalEvent,
} from '../exchange-monitoring.service.js';
import { ensureUserBalanceRow, assertBalanceInvariant, CHAIN_ID_GLOBAL } from '../../lib/user-balance-helper.js';
import { config } from '../../config/index.js';
import { publishTradeExecuted } from '../admin-ws.service.js';
import { invalidateTickersCache, invalidateOrderbook } from '../cache-invalidation.service.js';
import { applyCommittedEngineNotify, type EngineLiveNotifyPayload } from '../spot-engine-live-bridge.service.js';
import { notifySpotPrivateChannelsAfterSettlement } from '../spot-settlement-private-ws.service.js';
import { getSpotTradesShapeSync, loadSpotTradesShape } from '../../lib/spot-trades-shape.js';
import { insertSpotTradesAfterMatch, updateSpotOrdersFilledAfterMatch } from './spot-settlement-order-writes.js';
import { computeSettlementLedgerDeltasFromPayload } from './settlement-ledger-deltas.js';
import { insertBalanceLedger } from '../../lib/balance-ledger.js';

function settlementWorkerIntervalMs(): number {
  return config.workers?.settlementWorkerIntervalMs ?? 250;
}

function settlementWorkerVerboseLogs(): boolean {
  const v = process.env.SETTLEMENT_WORKER_VERBOSE?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

const MAX_RETRIES = 10;

function errStack(err: unknown): string | undefined {
  return err instanceof Error ? err.stack : undefined;
}

interface EnginePayload {
  event_id: number;
  match_engine_id?: string;
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

export interface SettlementRow {
  id: number;
  engine_event_id: number;
  match_engine_id: string;
  payload: EnginePayload;
}

/** DB JSONB may arrive as object; tolerate string (legacy). */
export function normalizeSettlementPayload(raw: unknown): EnginePayload {
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw) as unknown;
    } catch {
      throw new Error('SETTLEMENT_PAYLOAD_INVALID_JSON');
    }
  }
  if (!obj || typeof obj !== 'object') {
    throw new Error('SETTLEMENT_PAYLOAD_INVALID');
  }
  const o = obj as Record<string, unknown>;
  const symbol = o.symbol;
  const price = o.price;
  const qty = o.qty;
  const takerOrderId = o.taker_order_id;
  const makerOrderId = o.maker_order_id;
  const takerUserId = o.taker_user_id;
  const makerUserId = o.maker_user_id;
  const takerSideRaw = o.taker_side;
  const takerSideNorm =
    typeof takerSideRaw === 'string' ? takerSideRaw.trim().toLowerCase() : '';
  if (
    typeof symbol !== 'string' ||
    typeof price !== 'string' ||
    typeof qty !== 'string' ||
    typeof takerOrderId !== 'string' ||
    typeof makerOrderId !== 'string' ||
    typeof takerUserId !== 'string' ||
    typeof makerUserId !== 'string' ||
    (takerSideNorm !== 'buy' && takerSideNorm !== 'sell')
  ) {
    throw new Error('SETTLEMENT_PAYLOAD_MISSING_FIELDS');
  }
  const match_engine_id =
    typeof o.match_engine_id === 'string' && o.match_engine_id.trim() ? o.match_engine_id.trim() : undefined;
  return {
    event_id: typeof o.event_id === 'number' ? o.event_id : Number(o.event_id),
    match_engine_id,
    symbol,
    price,
    qty,
    taker_order_id: takerOrderId,
    maker_order_id: makerOrderId,
    taker_user_id: takerUserId,
    maker_user_id: makerUserId,
    taker_side: takerSideNorm as 'buy' | 'sell',
    timestamp: typeof o.timestamp === 'number' ? o.timestamp : Number(o.timestamp),
  };
}

function batchSize(): number {
  return config.workers?.settlementBatchSize ?? 1;
}
const SETTLEMENT_ACCOUNT_TYPE = 'trading';

export async function resolveMarketAssets(
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

export async function processSettlementEventRow(
  client: PoolClient,
  row: SettlementRow
): Promise<EngineLiveNotifyPayload | undefined> {
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
    const rebates = config.features.makerRebatesEnabled;
    const makerFeeForHashReplay = rebates ? makerFeeAmt.negated() : makerFeeAmt;
    const hashPayload = [
      SETTLEMENT_EVENT_DOMAIN,
      payloadCanonical,
      toNumeric(tradeVal),
      toNumeric(takerFeeAmt),
      toNumeric(makerFeeForHashReplay),
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
    return undefined;
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
  const makerRebatesEnabled = config.features.makerRebatesEnabled;
  /* Fee invariant: taker_fee + maker_fee <= trade_value. With rebates, maker gets credit so only taker_fee <= trade_value. */
  if (makerRebatesEnabled) {
    if (takerFeeAmt.gt(tradeVal)) throw new Error('FEE_INVARIANT_VIOLATION');
  } else {
    if (takerFeeAmt.plus(makerFeeAmt).gt(tradeVal)) throw new Error('FEE_INVARIANT_VIOLATION');
  }

  const takerId = p.taker_user_id;
  const makerId = p.maker_user_id;
  /* PHASE-12: Self-trade prevention. Normalize UUIDs so same user in different string forms is detected. */
  const norm = (s: string) => String(s).toLowerCase().replace(/-/g, '');
  if (norm(takerId) === norm(makerId)) {
    throw new Error('SELF_TRADE_REJECTED');
  }

  const usersOk = await client.query<{ id: string }>(
    `SELECT id::text FROM users WHERE id IN ($1::uuid, $2::uuid)`,
    [takerId, makerId]
  );
  if (usersOk.rows.length !== 2) {
    throw new Error('SETTLEMENT_USER_NOT_FOUND');
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
  const lockValues = uniqueUserCurrency.flatMap(([u, c]) => [u, c]);
  const nPairs = uniqueUserCurrency.length;
  const lockResult =
    nPairs === 0
      ? { rows: [] as { user_id: string; currency_id: string; available_balance: string; locked_balance: string }[] }
      : await client.query<{ user_id: string; currency_id: string; available_balance: string; locked_balance: string }>(
          `SELECT ub.user_id::text AS user_id, ub.currency_id::text AS currency_id,
                  ub.available_balance::text AS available_balance, ub.locked_balance::text AS locked_balance
           FROM user_balances ub
           INNER JOIN (
             VALUES ${uniqueUserCurrency
               .map((_, i) => {
                 const base = i * 2 + 1;
                 return `($${base}::uuid, $${base + 1}::uuid)`;
               })
               .join(', ')}
           ) AS t(user_id, currency_id) ON ub.user_id = t.user_id AND ub.currency_id = t.currency_id
           WHERE COALESCE(ub.chain_id, '') = $${nPairs * 2 + 1} AND ub.account_type::text = $${nPairs * 2 + 2}
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
    if (!makerRebatesEnabled && makerQuoteAvail.plus(tradeVal).lt(makerFeeAmt)) {
      throw new Error('INSUFFICIENT_FUNDS_FOR_FEE');
    }
  } else {
    const takerQuoteAvail = getBal(takerId, quote).available;
    const makerQuoteAvail = getBal(makerId, quote).available;
    if (takerQuoteAvail.plus(tradeVal).lt(takerFeeAmt)) {
      throw new Error('INSUFFICIENT_FUNDS_FOR_FEE');
    }
    if (!makerRebatesEnabled && makerQuoteAvail.lt(makerFeeAmt)) {
      throw new Error('INSUFFICIENT_FUNDS_FOR_FEE');
    }
  }

  /* Phase D: Maker rebates = maker receives trade value + rebate (no fee). Otherwise maker receives trade - fee. */
  const makerQuoteNetCredit = (makerRebatesEnabled
    ? tradeVal.plus(makerFeeAmt)
    : tradeVal.minus(makerFeeAmt)).toDecimalPlaces(quote_precision, ROUND_DOWN);
  const takerQuoteNetCredit = tradeVal.minus(takerFeeAmt).toDecimalPlaces(quote_precision, ROUND_DOWN);

  const updates: { userId: string; asset: string; currencyId: string; available: DecimalInstance; locked: DecimalInstance }[] = [];

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
  }

  const ledgerDeltas = computeSettlementLedgerDeltasFromPayload(
    p,
    { base, quote, price_precision, qty_precision, quote_precision },
    makerRebatesEnabled
  );

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

  /* Per-event ledger verification inside transaction; mismatch → LEDGER_CHAIN_VIOLATION (fatal). */
  const insertedRows = await client.query<{
    id: number;
    user_id: string;
    asset: string;
    delta: string;
    prev_hash: string | null;
    entry_hash: string | null;
  }>(
    `SELECT id, user_id, asset, delta::text AS delta, prev_hash, entry_hash
     FROM settlement_ledger_entries WHERE settlement_event_id = $1 ORDER BY id ASC`,
    [row.id]
  );
  if (insertedRows.rows.length !== chainEntries.length) {
    throw new Error('LEDGER_CHAIN_VIOLATION');
  }
  const expectedFirstPrev = lastEntryRow.rows[0]?.entry_hash ?? null;
  for (let i = 0; i < insertedRows.rows.length; i++) {
    const r = insertedRows.rows[i]!;
    const ce = chainEntries[i]!;
    const expectedPrev = i === 0 ? expectedFirstPrev : insertedRows.rows[i - 1]!.entry_hash;
    const expectedDelta = toNumeric(ce.delta);
    if (
      (r.prev_hash ?? null) !== (expectedPrev ?? null) ||
      !r.entry_hash ||
      r.user_id !== ce.user_id ||
      r.asset !== ce.asset ||
      toNumeric(new Decimal(r.delta)) !== expectedDelta ||
      r.entry_hash !== ce.entry_hash
    ) {
      throw new Error('LEDGER_CHAIN_VIOLATION');
    }
  }

  /* balance_ledger: mirror trading bucket deltas (spot integrity sums this vs user_balances). */
  const balanceLedgerRefId = crypto.randomUUID();
  const balanceLedgerMeta = `settlement_event_id=${row.id};engine_event_id=${row.engine_event_id}`;
  for (const u of updates) {
    const old = getBal(u.userId, u.asset);
    const dAvail = u.available.minus(old.available);
    const dLock = u.locked.minus(old.locked);
    if (!dAvail.isZero()) {
      await insertBalanceLedger({
        client,
        userId: u.userId,
        currencyId: u.currencyId,
        accountType: 'trading',
        debit: dAvail.lt(0) ? toNumeric(dAvail.abs()) : '0',
        credit: dAvail.gt(0) ? toNumeric(dAvail) : '0',
        balanceBefore: toNumeric(old.available),
        balanceAfter: toNumeric(u.available),
        referenceType: 'adjustment',
        referenceId: balanceLedgerRefId,
        balanceType: 'available',
        descriptionSuffix: balanceLedgerMeta,
      });
    }
    if (!dLock.isZero()) {
      await insertBalanceLedger({
        client,
        userId: u.userId,
        currencyId: u.currencyId,
        accountType: 'trading',
        debit: dLock.lt(0) ? toNumeric(dLock.abs()) : '0',
        credit: dLock.gt(0) ? toNumeric(dLock) : '0',
        balanceBefore: toNumeric(old.locked),
        balanceAfter: toNumeric(u.locked),
        referenceType: 'adjustment',
        referenceId: balanceLedgerRefId,
        balanceType: 'locked',
        descriptionSuffix: balanceLedgerMeta,
      });
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
       WHERE user_id = $3::uuid AND currency_id = $4::uuid AND COALESCE(chain_id, '') = $5 AND account_type::text = $6
       RETURNING *`,
      [toNumeric(u.available), toNumeric(u.locked), u.userId, u.currencyId, CHAIN_ID_GLOBAL, SETTLEMENT_ACCOUNT_TYPE]
    );
    if (updResult.rowCount === 0) {
      throw new Error('MISSING_BALANCE_ROW_FOR_LOCKED_DEBIT');
    }
    if (updResult.rows[0]) assertBalanceInvariant(updResult.rows[0]);
  }

  /* Do not compare cumulative settlement ledger to total balances here:
     total balances include non-settlement sources (deposits/opening backfills/etc).
     Settlement consistency is enforced by per-event ledger checks above + periodic aggregate audit. */

  const ledgerLines = [...ledgerDeltas]
    .sort((a, b) => (a.user_id === b.user_id ? a.asset.localeCompare(b.asset) : a.user_id.localeCompare(b.user_id)))
    .map((ld) => `${ld.user_id}|${ld.asset}|${toNumeric(ld.delta)}`)
    .join('\n');
  const payloadSorted = (Object.keys(p) as (keyof EnginePayload)[]).sort();
  const payloadCanonical = JSON.stringify(
    payloadSorted.map((k) => [k, (p as unknown as Record<string, unknown>)[k]])
  );
  const makerFeeForHash = makerRebatesEnabled ? makerFeeAmt.negated() : makerFeeAmt;
  const hashPayload = [
    SETTLEMENT_EVENT_DOMAIN,
    payloadCanonical,
    toNumeric(tradeVal),
    toNumeric(takerFeeAmt),
    toNumeric(makerFeeForHash),
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

  const makerFeeForDb = makerRebatesEnabled ? makerFeeAmt.negated() : makerFeeAmt;
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
      toNumeric(makerFeeForDb),
    ]
  );

  const matchedQtyNum = toNumeric(qty);
  let spotShape = getSpotTradesShapeSync();
  if (!spotShape) {
    spotShape = await loadSpotTradesShape();
  }
  await updateSpotOrdersFilledAfterMatch(client, matchedQtyNum, p.taker_order_id, p.maker_order_id);

  const buyerId = p.taker_side === 'buy' ? p.taker_user_id : p.maker_user_id;
  const sellerId = p.taker_side === 'buy' ? p.maker_user_id : p.taker_user_id;
  const buyerOrderId = p.taker_side === 'buy' ? p.taker_order_id : p.maker_order_id;
  const sellerOrderId = p.taker_side === 'buy' ? p.maker_order_id : p.taker_order_id;
  const buyerFee = p.taker_side === 'buy' ? toNumeric(takerFeeAmt) : toNumeric(makerRebatesEnabled ? makerFeeAmt.negated() : makerFeeAmt);
  const sellerFee = p.taker_side === 'buy' ? toNumeric(makerRebatesEnabled ? makerFeeAmt.negated() : makerFeeAmt) : toNumeric(takerFeeAmt);
  await insertSpotTradesAfterMatch(
    client,
    spotShape,
    {
      symbol: p.symbol,
      taker_order_id: p.taker_order_id,
      maker_order_id: p.maker_order_id,
      taker_user_id: p.taker_user_id,
      maker_user_id: p.maker_user_id,
      taker_side: p.taker_side,
    },
    {
      fillQty: matchedQtyNum,
      price: toNumeric(price),
      buyerId,
      sellerId,
      buyerOrderId,
      sellerOrderId,
      buyerFee,
      sellerFee,
      takerFee: toNumeric(takerFeeAmt),
      makerFee: toNumeric(makerFeeForDb),
      quoteAsset: quote,
      quoteAmount: toNumeric(tradeVal),
      quoteCurrencyId: quote_currency_id,
    }
  );

  try {
    publishTradeExecuted({
      market: p.symbol,
      side: 'buy',
      price: toNumeric(price).toString(),
      quantity: matchedQtyNum.toString(),
      user_id: buyerId,
    });
  } catch {
    /* best-effort admin metrics */
  }
  void invalidateTickersCache();
  void invalidateOrderbook(p.symbol);

  await client.query(
    `UPDATE settlement_events SET status = 'processed', processed_at = NOW(), hash = $2 WHERE id = $1`,
    [row.id, computedHash]
  );

  const matchEngineId = row.match_engine_id || p.match_engine_id || 'default';
  return {
    matchEngineId,
    engineEventId: row.engine_event_id,
    symbol: p.symbol,
    price: p.price,
    qty: p.qty,
    taker_side: p.taker_side,
    taker_user_id: p.taker_user_id,
    maker_user_id: p.maker_user_id,
    taker_order_id: p.taker_order_id,
    maker_order_id: p.maker_order_id,
    base,
    quote,
    quoteValue: tradeVal.toString(),
    quote_precision: quote_precision,
  };
}

export type JetStreamSettleOutcome =
  | { outcome: 'settled'; liveNotify?: EngineLiveNotifyPayload }
  | { outcome: 'already_done' };

/**
 * JetStream MATCH_EVENTS consumer path: insert (idempotent) + settle in one DB transaction, ack after commit outside.
 * Postgres + poller remain fallback when stream is off or publisher fails.
 */
export async function ingestAndSettleMatchEventFromJetStream(
  raw: Record<string, unknown>
): Promise<JetStreamSettleOutcome> {
  const matchEngineId = String(raw.engine_id ?? raw.match_engine_id ?? 'default').trim() || 'default';
  const eventId = Number(raw.event_id);
  if (!Number.isFinite(eventId) || eventId < 1) {
    throw new Error('STREAM_MATCH_EVENT_INVALID_ID');
  }
  const payloadObj = {
    event_id: eventId,
    match_engine_id: matchEngineId,
    symbol: String(raw.symbol ?? ''),
    price: String(raw.price ?? ''),
    qty: String(raw.qty ?? ''),
    taker_order_id: String(raw.taker_order_id ?? ''),
    maker_order_id: String(raw.maker_order_id ?? ''),
    taker_user_id: String(raw.taker_user_id ?? ''),
    maker_user_id: String(raw.maker_user_id ?? ''),
    taker_side: String(raw.taker_side ?? ''),
    timestamp: typeof raw.timestamp === 'number' ? raw.timestamp : Number(raw.timestamp),
  };
  const payload = normalizeSettlementPayload(payloadObj);
  const payloadJson = JSON.stringify({
    event_id: payload.event_id,
    match_engine_id: matchEngineId,
    symbol: payload.symbol,
    price: payload.price,
    qty: payload.qty,
    taker_order_id: payload.taker_order_id,
    maker_order_id: payload.maker_order_id,
    taker_user_id: payload.taker_user_id,
    maker_user_id: payload.maker_user_id,
    taker_side: payload.taker_side,
    timestamp: payload.timestamp,
  });

  const client = await db.getSettlementClient();
  try {
    await client.query('BEGIN');
    const ins = await client.query<{ id: number }>(
      `INSERT INTO settlement_events (match_engine_id, engine_event_id, payload, status)
       VALUES ($1, $2, $3::jsonb, 'pending')
       ON CONFLICT (match_engine_id, engine_event_id) DO NOTHING
       RETURNING id`,
      [matchEngineId, eventId, payloadJson]
    );
    let rowId: number;
    if (ins.rows.length > 0) {
      rowId = ins.rows[0]!.id;
    } else {
      const ex = await client.query<{ id: number; status: string }>(
        `SELECT id, status::text AS status FROM settlement_events
         WHERE match_engine_id = $1 AND engine_event_id = $2 FOR UPDATE`,
        [matchEngineId, eventId]
      );
      if (ex.rows.length === 0) {
        throw new Error('STREAM_MATCH_EVENT_ROW_MISSING');
      }
      const st = (ex.rows[0]!.status || '').toLowerCase();
      if (st === 'processed' || st === 'failed') {
        await client.query('COMMIT');
        return { outcome: 'already_done' };
      }
      rowId = ex.rows[0]!.id;
    }

    const locked = await client.query<{
      id: number;
      engine_event_id: number;
      match_engine_id: string;
      payload: unknown;
      status: string;
    }>(
      `SELECT id, engine_event_id, match_engine_id::text, payload, status::text AS status
       FROM settlement_events WHERE id = $1 FOR UPDATE`,
      [rowId]
    );
    const lr = locked.rows[0]!;
    const st2 = (lr.status || '').toLowerCase();
    if (st2 === 'processed' || st2 === 'failed') {
      await client.query('COMMIT');
      return { outcome: 'already_done' };
    }

    let pl: EnginePayload;
    try {
      pl = normalizeSettlementPayload(lr.payload);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
    const row: SettlementRow = {
      id: lr.id,
      engine_event_id: lr.engine_event_id,
      match_engine_id: lr.match_engine_id || matchEngineId,
      payload: pl,
    };
    const liveNotify = await processSettlementEventRow(client, row);
    await client.query('COMMIT');
    return { outcome: 'settled', liveNotify };
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    client.release();
  }
}

async function processOneEvent(): Promise<boolean> {
  const client = await db.getSettlementClient();
  try {
    await client.query('BEGIN');
    const pending = await client.query<{
      id: number;
      engine_event_id: number;
      match_engine_id: string;
      payload: unknown;
    }>(
      `SELECT id, engine_event_id, match_engine_id::text, payload FROM settlement_events
       WHERE LOWER(TRIM(status::text)) = 'pending' AND COALESCE(retry_count, 0) < $1
       ORDER BY id ASC LIMIT 1 FOR UPDATE SKIP LOCKED`,
      [MAX_RETRIES]
    );
    if (pending.rows.length === 0) {
      const eligible = await client.query<{ c: string }>(
        `SELECT count(*)::text AS c FROM settlement_events
         WHERE LOWER(TRIM(status::text)) = 'pending' AND COALESCE(retry_count, 0) < $1`,
        [MAX_RETRIES]
      );
      const eligibleCount = parseInt(eligible.rows[0]?.c ?? '0', 10);
      if (eligibleCount > 0) {
        logger.warn('Settlement: eligible pending rows exist but none claimed (SKIP LOCKED contention or filter mismatch)', {
          eligiblePendingCount: eligibleCount,
          maxRetries: MAX_RETRIES,
        });
      }
      await client.query('ROLLBACK');
      return false;
    }
    const rawRow = pending.rows[0]!;
    let payload: EnginePayload;
    try {
      payload = normalizeSettlementPayload(rawRow.payload);
    } catch (normErr) {
      await client.query('ROLLBACK');
      const msg = normErr instanceof Error ? normErr.message : String(normErr);
      logger.error('Settlement payload normalize failed (fatal)', {
        settlementEventId: rawRow.id,
        engineEventId: rawRow.engine_event_id,
        error: msg,
        stack: errStack(normErr),
      });
      await db.query(
        `UPDATE settlement_events SET status = 'failed', last_error = $1, processed_at = NOW() WHERE id = $2`,
        [msg.substring(0, 1000), rawRow.id]
      );
      return true;
    }
    const row: SettlementRow = {
      id: rawRow.id,
      engine_event_id: rawRow.engine_event_id,
      match_engine_id: rawRow.match_engine_id || 'default',
      payload,
    };
    logger.info('Settlement claiming pending event', {
      settlementEventId: row.id,
      engineEventId: row.engine_event_id,
      symbol: row.payload.symbol,
    });
    try {
      const liveNotify = await processSettlementEventRow(client, row);
      await client.query('COMMIT');
      logger.info('Settlement event committed', {
        settlementEventId: row.id,
        engineEventId: row.engine_event_id,
        symbol: row.payload.symbol,
      });
      if (liveNotify) {
        try {
          await applyCommittedEngineNotify(liveNotify);
        } catch (liveErr) {
          logger.warn('Settlement live book notify failed (best-effort)', {
            error: liveErr instanceof Error ? liveErr.message : String(liveErr),
            engineEventId: liveNotify.engineEventId,
            stack: errStack(liveErr),
          });
        }
        try {
          await notifySpotPrivateChannelsAfterSettlement({
            symbol: liveNotify.symbol,
            takerOrderId: liveNotify.taker_order_id,
            makerOrderId: liveNotify.maker_order_id,
            takerUserId: liveNotify.taker_user_id,
            makerUserId: liveNotify.maker_user_id,
          });
        } catch (wsErr) {
          logger.warn('Settlement private WS notify failed (best-effort)', {
            error: wsErr instanceof Error ? wsErr.message : String(wsErr),
          });
        }
      }
      return true;
    } catch (err) {
      await client.query('ROLLBACK');
      const errMsg = err instanceof Error ? err.message : String(err);
      triggerCircuitIfViolation(errMsg);
      logger.error('Settlement processEvent failed', {
        settlementEventId: row.id,
        engineEventId: row.engine_event_id,
        error: errMsg,
        stack: errStack(err),
      });
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
        errMsg === 'MARKET_NOT_FOUND' ||
        errMsg === 'MARKET_CURRENCY_NOT_FOUND' ||
        errMsg === 'TRADING_PAIR_NOT_FOUND_FOR_SYMBOL' ||
        errMsg.startsWith('SPOT_TRADES_SCHEMA_UNSUPPORTED') ||
        errMsg.startsWith('SETTLEMENT_PAYLOAD_') ||
        errMsg === 'SELF_TRADE_REJECTED' ||
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
          stack: errStack(err),
        });
      }
      return true;
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
    logger.error('Settlement worker outer error', {
      error: err instanceof Error ? err.message : String(err),
      stack: errStack(err),
    });
    throw err;
  } finally {
    client.release();
  }
}

/**
 * One worker poll tick: processes up to `batchSize` pending events (honours Redis halt + settlement circuit).
 * Safe to call from a short-lived CLI to drain backlog while the API process is stopped.
 */
export async function runSettlementWorkerOnce(): Promise<void> {
  await runOnce();
}

async function runOnce(): Promise<void> {
  const redisGlobalHalt = await getTradingHalted();
  const circuitOpen = await getSettlementCircuitOpen();

  /**
   * triggerCircuitIfViolation() sets in-process tradingHalted=true AND Redis circuit.
   * Clearing Redis alone (e.g. redis-cli DEL) leaves this flag true forever → worker never drains.
   * Sync: if Redis says circuit closed and global halt off, drop stale local halt.
   */
  if (isTradingHalted() && !circuitOpen && !redisGlobalHalt) {
    setTradingHalted(false);
    logger.info('Settlement worker cleared stale in-process trading halt (Redis circuit closed, no global halt)');
  }

  if (settlementWorkerVerboseLogs()) {
    logger.info('Settlement worker poll tick', {
      intervalMs: settlementWorkerIntervalMs(),
      localTradingHalted: isTradingHalted(),
      redisGlobalHalt,
      settlementCircuitOpen: circuitOpen,
    });
  }

  if (isTradingHalted()) {
    logger.info('Settlement worker skipped tick (local trading halt)', { reason: 'isTradingHalted' });
    return;
  }
  if (redisGlobalHalt) {
    logger.info('Settlement worker skipped tick (Redis/global trading halt)', { reason: 'getTradingHalted' });
    return;
  }
  if (circuitOpen) {
    logger.info('Settlement worker skipped tick (settlement circuit open)', { reason: 'getSettlementCircuitOpen' });
    return;
  }
  const limit = batchSize();
  for (let i = 0; i < limit; i++) {
    const processed = await processOneEvent();
    if (!processed) break;
  }
}

let workerIntervalId: ReturnType<typeof setInterval> | null = null;

/** Serialize ticks so overlapping processOneEvent calls cannot starve the pool or hide SKIP LOCKED behavior. */
let settlementTickChain: Promise<void> = Promise.resolve();

export function startSettlementWorker(): void {
  if (workerIntervalId != null) {
    return;
  }
  const enqueue = (): void => {
    settlementTickChain = settlementTickChain
      .then(() => runOnce())
      .catch((err) => {
        logger.error('Settlement worker error', {
          error: err instanceof Error ? err.message : String(err),
          stack: errStack(err),
        });
      });
  };
  enqueue();
  workerIntervalId = setInterval(enqueue, settlementWorkerIntervalMs());
  recordOperationalEvent({ type: 'settlement_worker_start' });
  logger.info('Settlement worker started', { intervalMs: settlementWorkerIntervalMs() });
}

export function stopSettlementWorker(): void {
  if (workerIntervalId != null) {
    clearInterval(workerIntervalId);
    workerIntervalId = null;
    settlementTickChain = Promise.resolve();
    recordOperationalEvent({ type: 'settlement_worker_stop' });
    logger.info('Settlement worker stopped');
  }
}
