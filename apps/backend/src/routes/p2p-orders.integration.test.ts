/**
 * Integration tests for POST /api/v1/p2p/orders.
 *
 * Run with: npx tsx src/routes/p2p-orders.integration.test.ts
 * Requires: DATABASE_URL, REDIS_URL (optional; JWT-only auth used if Redis missing),
 *           JWT_SECRET. DB must have users, currencies, p2p_ads, user_p2p_payment_methods,
 *           p2p_payment_methods; for 201/available_amount tests also tokens, user_balances, escrows.
 */

import 'dotenv/config';
import { db } from '../lib/database.js';
import { redis } from '../lib/redis.js';
import { config } from '../config/index.js';
import { buildServer } from '../server.js';
import { v4 as uuidv4 } from 'uuid';

const BASE = '/api/v1/p2p';

interface TestData {
  sellerId: string;
  buyerId: string;
  adId: string;
  buyerPaymentMethodId: string;
  otherUserPaymentMethodId: string;
  currencyId: string;
  tokenId: string | null;
}

async function ensureRedis(): Promise<void> {
  try {
    await redis.connect();
  } catch {
    // JWT-only fallback when Redis missing
  }
}

async function signUserJwt(app: Awaited<ReturnType<typeof buildServer>>, userId: string, sessionId: string): Promise<string> {
  const payload = {
    userId,
    email: `test-${userId}@test.local`,
    role: 'user',
    sessionId,
  };
  return app.jwt.sign(payload, { expiresIn: config.jwt.expiresIn ?? '15m' });
}

async function setupTestData(): Promise<TestData | null> {
  // Ensure schema supports risk engine (e.g. when DB uses full-schema or partial migrate)
  try {
    await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER NOT NULL DEFAULT 0`);
  } catch {
    // ignore
  }
  try {
    await db.query(`ALTER TYPE activity_type ADD VALUE IF NOT EXISTS 'access_blocked'`);
  } catch {
    // ignore (e.g. activity_type is VARCHAR or enum already has value)
  }

  const sellerId = uuidv4();
  const buyerId = uuidv4();
  const otherUserId = uuidv4();

  const currencyRow = await db.query<{ id: string }>(`SELECT id FROM currencies WHERE is_active = TRUE LIMIT 1`);
  if (currencyRow.rows.length === 0) {
    console.log('SKIP: no active currency in DB');
    return null;
  }
  const currencyId = currencyRow.rows[0]!.id;

  let tokenId: string | null = null;
  try {
    const tokenRow = await db.query<{ id: string }>(
      `SELECT t.id FROM tokens t JOIN currencies c ON UPPER(TRIM(c.symbol)) = UPPER(TRIM(t.symbol)) WHERE c.id = $1 AND t.is_active = TRUE LIMIT 1`,
      [currencyId]
    );
    tokenId = tokenRow.rows[0]?.id ?? null;
  } catch {
    // tokens table may not exist
  }

  const pmRow = await db.query<{ id: string }>(`SELECT id FROM p2p_payment_methods WHERE is_active = TRUE LIMIT 1`);
  if (pmRow.rows.length === 0) {
    console.log('SKIP: no p2p_payment_methods in DB');
    return null;
  }
  const p2pPmId = pmRow.rows[0]!.id;

  await db.query(
    `INSERT INTO users (id, email, password_hash, salt) VALUES ($1, $2, 'hash', 'salt'), ($3, $4, 'hash', 'salt'), ($5, $6, 'hash', 'salt')`,
    [
      sellerId,
      `seller-${sellerId}@test.local`,
      buyerId,
      `buyer-${buyerId}@test.local`,
      otherUserId,
      `other-${otherUserId}@test.local`,
    ]
  );

  const adCryptoId = tokenId ?? currencyId;
  const adId = uuidv4();
  await db.query(
    `INSERT INTO p2p_ads (id, user_id, ad_type, crypto_currency_id, fiat_currency, pricing_type, current_price, min_amount, max_amount, available_amount, accepted_payment_methods, status, total_orders, completed_orders)
     VALUES ($1, $2, 'sell', $3, 'INR', 'fixed', 90, 100, 10000, 5000, $4, 'active', 0, 0)`,
    [adId, sellerId, adCryptoId, JSON.stringify([p2pPmId])]
  );
  if (tokenId) {
    try {
      await db.query(`UPDATE p2p_ads SET token_id = $1 WHERE id = $2`, [tokenId, adId]);
    } catch {
      // token_id column may not exist (e.g. full-schema only has crypto_currency_id)
    }
  }
  // Service expects p2p_ads.type, .price, .minAmount, .maxAmount (camelCase); align with full-schema snake_case
  try {
    await db.query(`ALTER TABLE p2p_ads ADD COLUMN IF NOT EXISTS type VARCHAR(4)`);
    await db.query(`UPDATE p2p_ads SET type = ad_type WHERE id = $1 AND (type IS NULL OR type = '')`, [adId]);
    await db.query(`ALTER TABLE p2p_ads ADD COLUMN IF NOT EXISTS price DECIMAL(36,18)`);
    await db.query(`UPDATE p2p_ads SET price = current_price WHERE id = $1 AND (price IS NULL)`, [adId]);
    await db.query(`ALTER TABLE p2p_ads ADD COLUMN IF NOT EXISTS "minAmount" DECIMAL(36,18)`);
    await db.query(`ALTER TABLE p2p_ads ADD COLUMN IF NOT EXISTS "maxAmount" DECIMAL(36,18)`);
    await db.query(`ALTER TABLE p2p_ads ADD COLUMN IF NOT EXISTS "availableAmount" DECIMAL(36,18)`);
    await db.query(
      `UPDATE p2p_ads SET "minAmount" = min_amount, "maxAmount" = max_amount, "availableAmount" = available_amount WHERE id = $1`,
      [adId]
    );
  } catch {
    // ignore
  }

  const buyerPmId = uuidv4();
  const otherPmId = uuidv4();
  await db.query(
    `INSERT INTO user_p2p_payment_methods (id, user_id, payment_method_id, payment_details, display_name, is_verified)
     VALUES ($1, $2, $3, '{}', 'Test PM', true), ($4, $5, $3, '{}', 'Other PM', true)`,
    [buyerPmId, buyerId, p2pPmId, otherPmId, otherUserId]
  );

  return {
    sellerId,
    buyerId,
    adId,
    buyerPaymentMethodId: buyerPmId,
    otherUserPaymentMethodId: otherPmId,
    currencyId,
    tokenId,
  };
}

async function teardown(data: TestData): Promise<void> {
  const otherUserIdRow = await db.query<{ user_id: string }>(`SELECT user_id FROM user_p2p_payment_methods WHERE id = $1`, [data.otherUserPaymentMethodId]);
  const otherUserId = otherUserIdRow.rows[0]?.user_id;

  await db.query(`DELETE FROM p2p_orders WHERE ad_id = $1`, [data.adId]);
  await db.query(`DELETE FROM escrows WHERE user_id = $1`, [data.sellerId]);
  await db.query(`DELETE FROM user_balances WHERE user_id IN ($1, $2)`, [data.sellerId, data.buyerId]);
  await db.query(`DELETE FROM p2p_ads WHERE id = $1`, [data.adId]);
  await db.query(`DELETE FROM user_p2p_payment_methods WHERE id IN ($1, $2)`, [
    data.buyerPaymentMethodId,
    data.otherUserPaymentMethodId,
  ]);
  const userIds = [data.sellerId, data.buyerId];
  if (otherUserId) userIds.push(otherUserId);
  for (const uid of userIds) {
    await db.query(`DELETE FROM users WHERE id = $1`, [uid]);
  }
}

async function run(): Promise<void> {
  await ensureRedis();

  const data = await setupTestData();
  if (!data) return;

  const app = await buildServer();
  const sessionId = uuidv4();
  const buyerToken = await signUserJwt(app, data.buyerId, sessionId);

  try {
    // --- 1. Reject unauthenticated request ---
    const resNoAuth = await app.inject({
      method: 'POST',
      url: `${BASE}/orders`,
      payload: { adId: data.adId, quantity: '500', paymentMethodId: data.buyerPaymentMethodId },
      headers: { 'content-type': 'application/json', 'Idempotency-Key': uuidv4() },
    });
    if (resNoAuth.statusCode !== 401) {
      throw new Error(`Expected 401 for unauthenticated request, got ${resNoAuth.statusCode}`);
    }
    const bodyNoAuth = JSON.parse(resNoAuth.body);
    if (!bodyNoAuth.error?.code || bodyNoAuth.error.code !== 'UNAUTHORIZED') {
      throw new Error(`Expected error code UNAUTHORIZED, got ${bodyNoAuth.error?.code}`);
    }
    console.log('PASS: unauthenticated request rejected with 401');

    // --- 2. Reject invalid paymentMethodId (not owned by buyer) ---
    const resBadPm = await app.inject({
      method: 'POST',
      url: `${BASE}/orders`,
      payload: {
        adId: data.adId,
        quantity: '500',
        paymentMethodId: data.otherUserPaymentMethodId,
      },
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${buyerToken}`,
        'Idempotency-Key': uuidv4(),
      },
    });
    if (resBadPm.statusCode !== 400) {
      throw new Error(`Expected 400 for invalid paymentMethodId, got ${resBadPm.statusCode} ${resBadPm.body}`);
    }
    const bodyBadPm = JSON.parse(resBadPm.body);
    if (!bodyBadPm.error?.message || !bodyBadPm.error.message.toLowerCase().includes('payment method')) {
      throw new Error(`Expected invalid payment method message, got ${bodyBadPm.error?.message}`);
    }
    console.log('PASS: invalid paymentMethodId (not owned by buyer) rejected');

    // --- 3. Reject quantity > available_amount ---
    const resQty = await app.inject({
      method: 'POST',
      url: `${BASE}/orders`,
      payload: {
        adId: data.adId,
        quantity: '99999',
        paymentMethodId: data.buyerPaymentMethodId,
      },
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${buyerToken}`,
        'Idempotency-Key': uuidv4(),
      },
    });
    if (resQty.statusCode !== 400) {
      throw new Error(`Expected 400 for quantity > available_amount, got ${resQty.statusCode} ${resQty.body}`);
    }
    const bodyQty = JSON.parse(resQty.body);
    if (!bodyQty.error?.message) {
      throw new Error(`Expected error message for quantity, got ${resQty.body}`);
    }
    console.log('PASS: quantity > available_amount rejected');

    // --- 4 & 5. Return 201 on valid payload and verify available_amount updated (if escrow path available) ---
    if (!data.tokenId) {
      console.log('SKIP: 201 and available_amount tests (no token_id for escrow)');
      await teardown(data);
      return;
    }

    const currencyId = (await db.query<{ id: string }>(`SELECT c.id FROM tokens t JOIN currencies c ON UPPER(TRIM(c.symbol)) = UPPER(TRIM(t.symbol)) WHERE t.id = $1`, [data.tokenId])).rows[0]?.id;
    if (!currencyId) {
      console.log('SKIP: 201 test (currency not found for token)');
      await teardown(data);
      return;
    }

    const chainId = (await db.query<{ chain_id: string | null }>(`SELECT chain_id FROM tokens WHERE id = $1`, [data.tokenId])).rows[0]?.chain_id ?? '';
    await db.query(
      `INSERT INTO user_balances (user_id, currency_id, chain_id, account_type, available_balance, updated_at)
       VALUES ($1, $2, $3, 'funding', 10000, NOW())
       ON CONFLICT (user_id, currency_id, COALESCE(chain_id, ''), account_type) DO UPDATE SET available_balance = 10000, updated_at = NOW()`,
      [data.sellerId, currencyId, chainId]
    );

    const idemKey = uuidv4();
    const res201 = await app.inject({
      method: 'POST',
      url: `${BASE}/orders`,
      payload: {
        adId: data.adId,
        quantity: '500',
        paymentMethodId: data.buyerPaymentMethodId,
      },
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${buyerToken}`,
        'Idempotency-Key': idemKey,
      },
    });

    if (res201.statusCode !== 201) {
      throw new Error(`Expected 201 for valid payload, got ${res201.statusCode} ${res201.body}`);
    }
    const body201 = JSON.parse(res201.body);
    if (!body201.success || !body201.data?.id) {
      throw new Error(`Expected success and order id, got ${res201.body}`);
    }
    console.log('PASS: valid payload returns 201 with order id');

    const adAfter = await db.query<{ available_amount: string }>(`SELECT available_amount FROM p2p_ads WHERE id = $1`, [data.adId]);
    const availAfter = parseFloat(adAfter.rows[0]?.available_amount ?? '0');
    if (Math.abs(availAfter - 4500) > 0.01) {
      throw new Error(`Expected ad available_amount 4500 after order (5000 - 500), got ${availAfter}`);
    }
    console.log('PASS: ad available_amount updated correctly (5000 -> 4500)');
  } finally {
    await teardown(data);
  }
}

run().then(
  () => process.exit(0),
  (err) => {
    console.error('FAIL:', err.message);
    process.exit(1);
  }
);
