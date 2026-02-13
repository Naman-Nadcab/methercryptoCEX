# Settlement & Matching Balance Mutation — Safety Audit Report

## PART 1 — DISCOVERED SETTLEMENT/MATCHING MUTATION BLOCKS

| File | Block | Functions / Operations |
|------|-------|------------------------|
| `apps/backend/src/services/matching-engine.service.ts` | executeTrade (lines 496–607) | debitLockedBalance (buyer quote, seller base), creditBalance (buyer base, seller quote) |
| `apps/backend/src/routes/spot.fastify.ts` | runMatching (lines 452–542) | debitLockedTradingBalance, creditTradingBalance (buyer/seller per match) |
| `apps/backend/src/routes/spot.fastify.ts` | place order (lines 330–372) | lockTradingBalance |
| `apps/backend/src/routes/spot.fastify.ts` | cancel / cancel-all (lines 491–433) | unlockTradingBalance |
| `apps/backend/src/services/settlement/settlement-worker.ts` | processEvent (lines 378–411) | UPDATE user_balances (4 per trade) |
| `apps/backend/src/services/spot-balance.service.ts` | lockTradingBalance, unlockTradingBalance, debitLockedTradingBalance, creditTradingBalance | All: SELECT FOR UPDATE, UPDATE, ledger, assertBalanceInvariant |
| `apps/backend/src/services/wallet.service.ts` | debitLockedBalance, creditBalance, lockBalance, unlockBalance | All: SELECT FOR UPDATE, UPDATE, ledger, assertBalanceInvariant |

---

## PART 2 — SAFETY AUDIT RESULTS

### matching-engine.service.ts executeTrade
| Criterion | Status | Notes |
|-----------|--------|-------|
| Atomicity | ✔ | All in db.transaction() |
| Row Locking | ✔ | wallet.service uses SELECT ... FOR UPDATE |
| Balance Safety | ✗ | debitLockedBalance returns boolean; return value not checked |
| Ledger Safety | ✔ | wallet.service inserts balance_ledger |
| Invariant Enforcement | ✔ | wallet.service calls assertBalanceInvariant |
| Partial Failure Risk | ✗ | If debitLockedBalance returns false, creditBalance still runs → credit without debit |

### spot.fastify.ts runMatching
| Criterion | Status | Notes |
|-----------|--------|-------|
| Atomicity | ✔ | In db.transaction() from place order |
| Row Locking | ✔ | spot-balance uses SELECT ... FOR UPDATE |
| Balance Safety | ✗ | debitLockedTradingBalance returns boolean; return value not checked |
| Ledger Safety | ✔ | spot-balance inserts balance_ledger |
| Invariant Enforcement | ✔ | spot-balance calls assertBalanceInvariant |
| Partial Failure Risk | ✗ | If debitLockedTradingBalance returns false, credit still runs |

### settlement-worker.ts processEvent
| Criterion | Status | Notes |
|-----------|--------|-------|
| Atomicity | ✔ | Single transaction |
| Row Locking | ✔ | SELECT ... FOR UPDATE before updates |
| Balance Safety | ✔ | Negative balance check before UPDATE |
| Ledger Safety | ✔ | settlement_ledger_entries (separate audit) |
| Invariant Enforcement | ✗ | No assertBalanceInvariant after UPDATE |
| Partial Failure Risk | ✔ | All 4 updates in one tx; ledger-first |

### spot-balance.service.ts (lock/unlock/debit/credit)
| Criterion | Status |
|-----------|--------|
| All | ✔ |

### wallet.service.ts (debit/credit/lock/unlock)
| Criterion | Status |
|-----------|--------|
| All | ✔ |

---

## PART 3 — CORRECTIONS APPLIED

### 1. matching-engine.service.ts — Partial Failure Risk

**File:** `apps/backend/src/services/matching-engine.service.ts`

**Change:** Check `debitLockedBalance` return value and throw on failure.

```typescript
      // Update buyer balances
      // - Debit locked quote (already locked when order placed)
      const buyerQuoteDebited = await walletService.debitLockedBalance(buyerId, quoteTokenId, quoteQuantity, client);
      if (!buyerQuoteDebited) {
        throw new Error('INSUFFICIENT_LOCKED_FUNDS');
      }
      // - Credit base (minus fee)
      const buyerReceives = new Decimal(quantity).minus(buyerFee).toString();
      await walletService.creditBalance(buyerId, baseTokenId, buyerReceives, client);

      // Update seller balances
      // - Debit locked base (already locked when order placed)
      const sellerBaseDebited = await walletService.debitLockedBalance(sellerId, baseTokenId, quantity, client);
      if (!sellerBaseDebited) {
        throw new Error('INSUFFICIENT_LOCKED_FUNDS');
      }
      // - Credit quote (minus fee)
      const sellerReceives = new Decimal(quoteQuantity).minus(sellerFee).toString();
      await walletService.creditBalance(sellerId, quoteTokenId, sellerReceives, client);
```

---

### 2. spot.fastify.ts runMatching — Partial Failure Risk

**File:** `apps/backend/src/routes/spot.fastify.ts`

**Change:** Check `debitLockedTradingBalance` return value and throw on failure.

```typescript
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
```

---

### 3. settlement-worker.ts — Invariant Enforcement

**File:** `apps/backend/src/services/settlement/settlement-worker.ts`

**Change:** Add `assertBalanceInvariant` after each balance UPDATE; add `RETURNING *` to UPDATE.

```typescript
import { ensureUserBalanceRow, assertBalanceInvariant, CHAIN_ID_GLOBAL } from '../../lib/user-balance-helper.js';
```

```typescript
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
    if (updResult.rows[0]) assertBalanceInvariant(updResult.rows[0]);
  }
```
