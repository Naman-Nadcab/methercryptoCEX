# Internal Transfer Safety Fix & Development Phase Report

**Generated:** 2025-02-13  
**Scope:** POST /transfer hardening, user_balances audit, phase classification, next priorities.

---

## PART 1 — INTERNAL TRANSFER SAFETY FIX

### Summary

Moved balance validation **inside** the existing `db.transaction` block and added row-level locking (`SELECT ... FOR UPDATE`) on the source account row to eliminate race conditions and concurrent double-spend.

### Safe Pattern Implemented

```
BEGIN transaction
  → ensureUserBalanceRow(source)
  → ensureUserBalanceRow(dest)
  → SELECT available_balance ... FOR UPDATE (source row)
  → Validate balance >= amount (re-check inside transaction)
  → debitAvailableBalance
  → creditBalanceForAccount
COMMIT
```

### Full Updated Handler Code

```typescript
  // Execute internal transfer between accounts
  app.post('/transfer', {
    preHandler: [app.authenticate]
  }, async (request: FastifyRequest<{
    Body: {
      fromAccount: string;
      toAccount: string;
      tokenId: string;
      amount: string;
    }
  }>, reply: FastifyReply) => {
    try {
      const userId = request.user!.id;
      const { fromAccount, toAccount, tokenId, amount } = request.body;

      // Validate accounts (funding, spot, trading only; no unified)
      const validAccounts = ['funding', 'spot', 'trading'];
      if (!validAccounts.includes(fromAccount) || !validAccounts.includes(toAccount)) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_ACCOUNT', message: 'Invalid account type' }
        });
      }

      if (fromAccount === toAccount) {
        return reply.status(400).send({
          success: false,
          error: { code: 'SAME_ACCOUNT', message: 'Cannot transfer to the same account' }
        });
      }

      let transferAmountDec: Decimal;
      try {
        transferAmountDec = new Decimal(amount).toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN);
      } catch {
        transferAmountDec = new Decimal(NaN);
      }
      if (!transferAmountDec.isFinite() || transferAmountDec.lte(0)) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_AMOUNT', message: 'Invalid transfer amount' }
        });
      }

      // Check if token exists (use tokens table directly)
      const tokenResult = await db.query(`
        SELECT id, symbol, name FROM tokens WHERE id = $1 AND is_active = TRUE
      `, [tokenId]);

      if (tokenResult.rows.length === 0) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_TOKEN', message: 'Token not found or inactive' }
        });
      }

      const token = tokenResult.rows[0];
      const currencyId = await getCurrencyIdBySymbol(token.symbol);
      if (!currencyId) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_TOKEN', message: 'Currency not found for token' }
        });
      }

      const amountStr = transferAmountDec.toString();

      // Debit fromAccount, credit toAccount in user_balances (transaction; abort if debit fails)
      // Safe pattern: BEGIN → ensure rows → SELECT FOR UPDATE → validate balance → debit → credit → COMMIT
      await db.transaction(async (client) => {
        await ensureUserBalanceRow(userId, currencyId, CHAIN_ID_GLOBAL, fromAccount, client);
        await ensureUserBalanceRow(userId, currencyId, CHAIN_ID_GLOBAL, toAccount, client);

        const lockResult = await client.query<{ available_balance: string }>(`
          SELECT available_balance
          FROM user_balances
          WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = $4
          FOR UPDATE
        `, [userId, currencyId, CHAIN_ID_GLOBAL, fromAccount]);

        if (lockResult.rows.length === 0) {
          const err = new Error('NO_BALANCE_FOR_ACCOUNT');
          (err as { statusCode?: number; code?: string }).statusCode = 400;
          (err as { statusCode?: number; code?: string }).code = 'NO_BALANCE_FOR_ACCOUNT';
          throw err;
        }

        const availableBalance = new Decimal(lockResult.rows[0].available_balance || '0').toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN);
        if (availableBalance.lt(transferAmountDec)) {
          const err = new Error('INSUFFICIENT_BALANCE');
          (err as { statusCode?: number; code?: string }).statusCode = 400;
          (err as { statusCode?: number; code?: string }).code = 'INSUFFICIENT_BALANCE';
          throw err;
        }

        await walletService.debitAvailableBalance(userId, currencyId, fromAccount, amountStr, client);
        await walletService.creditBalanceForAccount(userId, currencyId, toAccount, amountStr, client);
      });

      auditLog(userId, 'internal_transfer', {
        fromAccount,
        toAccount,
        tokenId,
        symbol: token.symbol,
        amount: amountStr
      });

      try {
        await db.query(`
          INSERT INTO internal_transfers (from_user_id, to_user_id, currency_id, amount, transfer_type, status, notes)
          VALUES ($1, $1, $2, $3, 'internal', 'completed', $4)
        `, [userId, currencyId, amountStr, `Transfer from ${fromAccount} to ${toAccount}`]);
      } catch {
        logger.debug('internal_transfers table not available, skipping record');
      }

      logger.info('Internal transfer completed', {
        userId,
        fromAccount,
        toAccount,
        symbol: token.symbol,
        amount: amountStr
      });

      return {
        success: true,
        message: `Successfully transferred ${amountStr} ${token.symbol} from ${fromAccount} to ${toAccount}`,
        data: {
          fromAccount,
          toAccount,
          symbol: token.symbol,
          amount: amountStr
        }
      };
    } catch (error) {
      const err = error as { statusCode?: number; code?: string; message?: string };
      if (err.statusCode === 400 && err.code === 'NO_BALANCE_FOR_ACCOUNT') {
        return reply.status(400).send({
          success: false,
          error: { code: 'NO_BALANCE_FOR_ACCOUNT', message: 'No balance for this account type. Use funding if you have no spot/trading rows.' }
        });
      }
      if (err.statusCode === 400 && err.code === 'INSUFFICIENT_BALANCE') {
        return reply.status(400).send({
          success: false,
          error: { code: 'INSUFFICIENT_BALANCE', message: 'Insufficient balance for transfer' }
        });
      }
      logger.error('Failed to execute transfer', { 
        error: error instanceof Error ? error.message : 'Unknown',
        userId: request.user?.id 
      });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to execute transfer' }
      });
    }
  });
```

### Changes vs. Original

| Aspect | Before | After |
|--------|--------|-------|
| Balance check | Outside transaction (readUserBalances) | Inside transaction after `SELECT ... FOR UPDATE` |
| Locking | None | `SELECT ... FOR UPDATE` on source row |
| Re-check before debit | Implicit in debit's `WHERE available_balance >= $4` | Explicit re-check after lock |
| Race safety | TOCTOU between read and debit | Eliminated by holding lock until commit |

---

## PART 2 — MULTI-ROW DEBIT / DUPLICATE ROW AUDIT

### ensureUserBalanceRow()

- **Logic:** `INSERT ... ON CONFLICT (user_id, currency_id, chain_id, account_type) DO NOTHING`
- **Safety:** Idempotent; only inserts if no row exists. Handles legacy 2-col unique via `PG_UNIQUE_VIOLATION` catch for `user_balances_user_id_currency_id_key`.

### user_balances Constraints

**Migration (migrate.ts ~1780):**
- `user_balances_user_currency_chain_account_key` — `UNIQUE (user_id, currency_id, chain_id, account_type)` ✓
- `user_balances_available_non_negative` — `CHECK (available_balance >= 0)` ✓
- `user_balances_locked_non_negative` — `CHECK (locked_balance >= 0)` ✓

**Full-schema.sql (reference):** Uses 3-col unique `(user_id, currency_id, account_type)` and no `chain_id`. Production schema is driven by migrations, which add `chain_id` and the 4-col unique.

### debitAvailableBalance()

- **UPDATE:** `WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = $5 AND available_balance >= $4::numeric`
- **Uniqueness:** With `UNIQUE (user_id, currency_id, chain_id, account_type)`, at most one row matches. No multi-row update risk ✓

### creditBalanceForAccount()

- **UPDATE:** Same predicate without `available_balance >=` check.
- **Uniqueness:** Same; single row per (user_id, currency_id, chain_id, account_type) ✓

### Conclusion

| Item | Status |
|------|--------|
| UNIQUE constraint | ✓ `user_balances_user_currency_chain_account_key` in migrations |
| Duplicate rows possible | ✗ Prevented by unique |
| Unsafe INSERT | ✗ `ON CONFLICT DO NOTHING` is idempotent |
| Multi-row update risk | ✗ Predicates guarantee single-row updates |

### Optional SQL Verification

If your DB was created before the migration or schema is uncertain, run:

```sql
-- Verify 4-col unique exists
SELECT conname, pg_get_constraintdef(oid) 
FROM pg_constraint 
WHERE conrelid = 'user_balances'::regclass 
  AND contype = 'u';

-- If user_balances_user_currency_chain_account_key is missing:
ALTER TABLE user_balances 
  ADD CONSTRAINT user_balances_user_currency_chain_account_key 
  UNIQUE (user_id, currency_id, COALESCE(chain_id, ''), account_type);
```

*(Use only if `chain_id` may be NULL; your schema uses `COALESCE(chain_id, '')` in code.)*

---

## PART 3 — DEVELOPMENT STAGE DETECTION

### Component State Summary

| Component | State | Notes |
|----------|-------|-------|
| **Security engine** | Partial | security.ts, helmet, rate limiting, IP whitelist, KYC; trading halt via Redis |
| **Wallet system** | Hardened | user_balances, Decimal.js, monetary invariants, assertBalanceInvariant |
| **Internal transfers** | Hardened (this PR) | FOR UPDATE, balance re-check inside transaction |
| **Deposits / withdrawals** | Functional | Indexer, deposit-credit, withdrawal-signing, confirmation tracker |
| **Spot trading** | Dual path | Express trading.routes + matching-engine (orders/trades) vs Fastify spot (spot_orders) |
| **Matching engine** | Functional | In-memory orderbook, lockBalance, executeTrade, RabbitMQ |
| **Order book** | Functional | Map-based bids/asks, FIFO matching |
| **P2P trading** | Functional | Escrow, release/refund, disputes |
| **Risk engine** | Minimal | Trading halt, rate limits; no formal risk/position limits |
| **Ledger / accounting** | Partial | balance_ledger schema exists; not wired to all flows |
| **Admin controls** | Present | admin.fastify, admin-aml, admin-spot, admin-security |

### Dual Trading Architectures

- **Express / RabbitMQ:** `orders`, `trades`, `transactions` tables; `matching-engine.service.ts`, `trading.routes.ts`
- **Fastify / Spot:** `spot_orders`, `spot.fastify.ts`, settlement-worker, different tables

Both coexist; this increases complexity and audit surface.

### Stage Classification

**Current stage: Pre-production phase**

- Infrastructure: PostgreSQL, Redis, RabbitMQ, EVM indexer ✓
- Trading core: Matching engine, spot orders, P2P ✓
- Hardening: Monetary invariants, Decimal.js discipline, deposit idempotency, internal transfer FOR UPDATE ✓
- Gaps: Full ledger wiring, risk limits, unified spot vs. trading paths, production deployment/ops

---

## PART 4 — NEXT DEVELOPMENT PRIORITIES

### 1. User-to-user internal transfer (withdraw type=internal) safety

**Why:** Binance-style internal transfers in `wallet.fastify.ts` (~1813–1847) use inline `UPDATE` + `assertUserBalanceUpdated`. No `SELECT ... FOR UPDATE` on sender or recipient rows.

**Action:** Apply the same pattern: `SELECT ... FOR UPDATE` on sender funding row, validate, then debit sender and credit recipient inside the same transaction.

---

### 2. P2P escrow moveToEscrow concurrency

**Why:** `moveToEscrow` uses `UPDATE ... WHERE available_balance >= $4` without row locking. Concurrent P2P orders can both read “sufficient” balance before either updates.

**Action:** Add `SELECT available_balance ... FOR UPDATE` on the seller’s funding row before the UPDATE in the same transaction.

---

### 3. Spot settlement and matching engine alignment

**Why:** Two different trading stacks (Express orders/trades vs Fastify spot_orders/settlement) increase risk of inconsistencies, double-execution, or misbooked fills.

**Action:** Consolidate on one model (prefer settlement-worker path) or clearly define boundaries and ensure no shared balance paths or double-settlement.

---

### 4. Matching engine order placement locking

**Why:** `placeOrder` uses Redis per-user lock, then `lockBalance` inside a transaction. Lock/balance interaction with other balance mutations (internal transfer, P2P, withdrawals) should be explicitly designed.

**Action:** Ensure all balance-affecting flows use row-level locking (`SELECT ... FOR UPDATE`) on the relevant `user_balances` rows so ordering of Redis vs DB locks is consistent and deadlock-free.

---

### 5. Wallet invariants coverage

**Why:** `assertBalanceInvariant` is used in wallet.service; other services (e.g. P2P escrow, deposit-credit) may not use it after every balance UPDATE.

**Action:** Add `assertBalanceInvariant(updatedRow)` after every `UPDATE user_balances ... RETURNING *` across deposit-credit, P2P escrow, and settlement paths.

---

### 6. Balance ledger wiring

**Why:** `balance_ledger` exists but may not be populated for all balance changes. Full auditability and reconciliation depend on it.

**Action:** Ensure every balance mutation (deposit credit, withdrawal debit, internal transfer, spot settlement, P2P escrow release) inserts into `balance_ledger` with correct `reference_type`, `balance_before`, `balance_after`.

---

### Priority Order

1. **User-to-user internal transfer FOR UPDATE** — High frequency, same pattern as POST /transfer
2. **P2P escrow moveToEscrow locking** — Escrow funds are held; races are user-impacting
3. **Spot/matching consolidation** — Reduces architectural risk and bugs
4. **Wallet invariants everywhere** — Defensive, quick to add
5. **Balance ledger wiring** — Audit and compliance
6. **Order placement locking design** — Cross-cutting concurrency review

---

*End of report.*
