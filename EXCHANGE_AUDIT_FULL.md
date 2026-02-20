# ZERO-OMISSION FULL EXCHANGE AUDIT

**System:** Centralized Crypto Exchange (CEX) — Spot + P2P only  
**Constraints:** No schema changes, no redesign; analysis of existing logic only.

---

## SECTION A — Full System Enumeration (Prove Coverage)

### Backend — Spot Engine Components

| File | Responsibility |
|------|----------------|
| `apps/backend/src/routes/spot.fastify.ts` | Spot HTTP API: place order (POST /orders), cancel (POST /orders/:id/cancel), cancel-all, open-orders, orderbook, ticker, trades; uses spot-balance lock/unlock/debit/credit; runMatching in same tx as place. |
| `apps/backend/src/services/spot-balance.service.ts` | Trading balance (account_type=trading): lockTradingBalance, unlockTradingBalance, debitLockedTradingBalance, creditTradingBalance; FOR UPDATE on user_balances; insertBalanceLedger on every mutation. |
| `apps/backend/src/services/spot-orderbook-cache.service.ts` | Redis cache for orderbook snapshot; TTL 10s; getCachedOrderbook, setOrderbookCache, refreshOrderbookCache, invalidateOrderbookCache. |
| `apps/backend/src/services/spot-risk.service.ts` | validateSpotOrderRiskUserBalances: checks trading balance vs order cost. |
| `apps/backend/src/services/spot-metrics.service.ts` | recordOrder, recordOrderLatencyMs. |
| `apps/backend/src/services/spot-ws.service.ts` | pushSpotUpdates, broadcast orderbook/trades/ticker to WS channels. |
| `apps/backend/src/routes/admin-spot.fastify.ts` | Admin spot routes (registered under /api/v1/admin/spot). |

### Backend — Legacy Order/Matching (trading pairs, orders table)

| File | Responsibility |
|------|----------------|
| `apps/backend/src/services/matching-engine.service.ts` | placeOrder (lock via wallet.service), matchOrder (executeTrade), cancelOrder (Redis lock + FOR UPDATE order); uses wallet.service lockBalance/debitLockedBalance/creditBalance (funding account). |
| `apps/backend/src/routes/trading.fastify.ts` | GET /pairs, /candles/:symbol, /balances, /wallets, /orders, /history, /currencies. |
| `apps/backend/src/routes/trading.routes.ts` | Express routes: orderbook, trades, placeOrder, cancelOrder, getUserOrders (uses matchingEngine). |
| `apps/backend/src/services/matchingEngine.ts` | External engine client: fetchMatchEvents(sinceIndex) from MATCHING_ENGINE_URL; used by admin refreshMatchEventsCache. |

### Backend — P2P & Escrow

| File | Responsibility |
|------|----------------|
| `apps/backend/src/services/p2p.service.ts` | createAd, createOrder (moveToEscrow in tx), confirmPayment, releaseCrypto (releaseFromEscrow), cancelOrder (refundFromEscrow), resolveDispute (release/refund by resolution); Redis locks for create order and release; FOR UPDATE on p2p_ads, p2p_orders, p2p_disputes. |
| `apps/backend/src/services/p2p-escrow.service.ts` | moveToEscrow (available → escrow_balance), releaseFromEscrow (to buyer), refundFromEscrow (to seller); FOR UPDATE user_balances funding; idempotent by escrow status; admin_frozen_at blocks release/refund; insertBalanceLedger. |
| `apps/backend/src/services/p2p-expiry.service.ts` | Process expired orders: FOR UPDATE p2p_orders, refund escrow. |
| `apps/backend/src/routes/p2p.fastify.ts` | P2P HTTP: create order (idempotency lock + cache), release (idempotency lock + cache), list ads/orders; calls p2pService. |
| `apps/backend/src/routes/p2p.routes.ts` | Express P2P routes (if used). |

### Backend — Wallet (Deposit / Withdrawal / Transfer)

| File | Responsibility |
|------|----------------|
| `apps/backend/src/routes/wallet.fastify.ts` | GET deposit-address/:chainId (get/create wallets), GET addresses, POST transfer (idempotency + lock, deterministic lock order, debitAvailableBalance/creditBalanceForAccount), POST withdrawals (idempotency, balance lock in tx, insert withdrawal), POST withdrawals/:id/cancel (status=cancelled + unlock in tx), balances/summary, by-account, transfer/history; admin send (internal transfer); FOR UPDATE on balance rows. |
| `apps/backend/src/services/wallet.service.ts` | createWalletsForUser (HD derivation, INSERT ON CONFLICT (user_id, chain_id) DO NOTHING), getMasterSeed, getNextHDIndex; lockBalance/unlockBalance (funding), debitLockedBalance/creditBalance (funding), debitAvailableBalance/creditBalanceForAccount (used by transfer); FOR UPDATE; insertBalanceLedger; getDepositAddress, getWallet, getUserWallets. |
| `apps/backend/src/services/deposit-credit.service.ts` | creditDepositIfConfirmed (single tx: UPDATE deposits SET balance_applied_at + credit user_balances + ledger); applyBalanceForOneCompletedDeposit; creditOverdueDepositsForUser. |
| `apps/backend/src/services/deposit-sweep.service.ts` | listSweepableAddresses, executeOneSweep (insert deposit_sweeps, sign, send, update status, updateBalanceCache hot_wallet); no single tx with broadcast; balance_cache read-then-write. |
| `apps/backend/src/services/withdrawal-signing.service.ts` | enqueueWithdrawal (FOR UPDATE withdrawal, insert queue ON CONFLICT DO NOTHING), processSigningQueue (FOR UPDATE SKIP LOCKED claim, sign, broadcast, completion tx: re-check status, if cancelled skip debit else debit locked + ledger). |
| `apps/backend/src/services/withdrawal-approval.service.ts` | approve/reject pending_approval withdrawals; FOR UPDATE; balance unlock on reject; insertBalanceLedger. |
| `apps/backend/src/services/withdrawal-whitelist.service.ts` | Whitelist and timelock checks for withdrawal addresses. |

### Backend — Funding vs Trading Balance Logic

| File | Responsibility |
|------|----------------|
| `apps/backend/src/services/wallet.service.ts` | account_type 'funding': lockBalance, unlockBalance, debitLockedBalance, creditBalance (used by matching-engine for legacy orders). |
| `apps/backend/src/services/spot-balance.service.ts` | account_type 'trading': lock/unlock/debit locked/credit (used by spot.fastify). |
| `apps/backend/src/routes/wallet.fastify.ts` | Transfer: fromAccount/toAccount funding|trading; ensureUserBalanceRow both; lock both in sorted order; debitAvailableBalance(fromAccount), creditBalanceForAccount(toAccount). |

### Backend — Balance Mutation Points (Exhaustive)

| Location | Operation | Ledger |
|----------|-----------|--------|
| wallet.service lockBalance | available -= X, locked += X (funding) | Yes |
| wallet.service unlockBalance | available += X, locked -= X (funding) | Yes |
| wallet.service debitLockedBalance | locked -= X (funding) | Yes |
| wallet.service creditBalance | available += X (funding) | Yes |
| wallet.service debitAvailableBalance | available -= X | Yes |
| wallet.service creditBalanceForAccount | available += X | Yes |
| spot-balance lockTradingBalance | available -= X, locked += X (trading) | Yes |
| spot-balance unlockTradingBalance | available += X, locked -= X (trading) | Yes |
| spot-balance debitLockedTradingBalance | locked -= X (trading) | Yes |
| spot-balance creditTradingBalance | available += X (trading) | Yes |
| wallet.fastify withdrawal create | available -= (amount+fee), locked += (amount+fee) | Yes |
| wallet.fastify withdrawal cancel | available += (amount+fee), locked -= (amount+fee) | Yes |
| withdrawal-signing completion tx | locked -= (amount+fee) | Yes |
| deposit-credit creditDepositIfConfirmed | available += amount, pending_balance -= amount, total_deposited += amount | Yes |
| p2p-escrow moveToEscrow | available -= X, escrow_balance += X | Yes |
| p2p-escrow releaseFromEscrow | seller escrow -= X, buyer available += X | Yes |
| p2p-escrow refundFromEscrow | seller escrow -= X, seller available += X | Yes |
| wallet.fastify transfer | debitAvailableBalance(fromAccount), creditBalanceForAccount(toAccount) | Yes (inside wallet.service) |
| wallet.fastify admin send | SELECT sender/receiver rows, UPDATE sender available -=, receiver available += | Yes (insertBalanceLedger in route) |
| admin.fastify admin credit | credit user_balances + ledger | Yes |
| convert.fastify | lock/debit/credit for convert flows | Yes |
| withdrawal-approval reject | unlock balance + ledger | Yes |
| operator-controls (recovery) | balance adjustments + ledger | Yes |

### Backend — Locking / Reservation Logic

| Location | Mechanism |
|----------|-----------|
| wallet.fastify withdrawal create | redis.setNxEx( withdrawal:idempotency:lock:userId:key, 30s ); cache response 24h. |
| wallet.fastify transfer | redis.setNxEx( transfer:idempotency:lock:userId:key, 30s ); lock both account rows FOR UPDATE in sorted order. |
| p2p.fastify order create | redis.setNxEx( lockKey, 30s ); cache 24h. |
| p2p.fastify release | redis.setNxEx( lockKey, 30s ); cache 24h. |
| matching-engine cancelOrder | redis.acquireLock( order:cancel:orderId, 5000 ). |
| p2p.service createOrder | redis.acquireLock( seller ), redis.acquireLock( order key ); FOR UPDATE p2p_ads, users. |
| withdrawal-signing enqueue | FOR UPDATE withdrawals; INSERT queue ON CONFLICT DO NOTHING. |
| withdrawal-signing processSigningQueue | FOR UPDATE SKIP LOCKED on queue; completion tx FOR UPDATE withdrawals. |
| All balance mutations above | FOR UPDATE on user_balances row(s) in same tx. |
| deposit-credit | UPDATE deposits WHERE balance_applied_at IS NULL (single winner). |
| p2p-escrow release/refund | UPDATE escrows SET status WHERE status='locked' (single winner). |
| settlement-worker | FOR UPDATE on settlement_events; FOR UPDATE user_balances. |
| wallet-reconciliation-scheduler | redis.acquireLock( LOCK_KEY, 4min ). |

### Backend — API Routes (Registered)

| Prefix | File | Notes |
|--------|------|------|
| /api/v1/auth | auth.fastify.ts, auth.routes.ts, auth.oauth.ts, passkey.routes.ts | Login, refresh, OAuth, passkey. |
| /api/v1/trading | trading.fastify.ts (server.ts), trading.routes.ts (index Express) | Pairs, candles, balances, orders, history, currencies. |
| /api/v1/p2p | p2p.fastify.ts (server), p2p.routes.ts (Express) | P2P ads, orders, create, release. |
| /api/v1/user | user.fastify.ts | User profile, wallets list. |
| /api/v1/admin | admin.fastify.ts, admin-aml.fastify.ts, admin-security.fastify.ts | Many admin endpoints; getAdminFromRequest used in most, not in P2P dispute resolve/list. |
| /api/v1/admin/spot | admin-spot.fastify.ts | Admin spot. |
| /api/v1/wallet | wallet.fastify.ts | Deposit address, addresses, transfer, withdrawals, cancel, balances, history. |
| /api/v1/convert | convert.fastify.ts | Convert/swap with idempotency and balance locks. |
| /api/v1/kyc | kyc.ts | KYC. |
| /api/v1/debug | debug.fastify.ts | Debug. |
| /api/v1/spot | spot.fastify.ts | Spot orders, orderbook, ticker, trades. |

### Backend — Other Relevant Modules

| File | Responsibility |
|------|----------------|
| lib/balance-ledger.ts | insertBalanceLedger(client, userId, currencyId, accountType, debit, credit, balanceBefore, balanceAfter, referenceType, referenceId, balanceType). |
| lib/user-balance-helper.ts | ensureUserBalanceRow, assertUserBalanceUpdated, assertBalanceInvariant; CHAIN_ID_GLOBAL. |
| lib/monetary-invariants.ts | assertValidDecimal, assertNonNegative, etc. |
| lib/redis.ts | setNxEx, acquireLock, releaseLock, getJson, setJson, del. |
| lib/trading-halt.ts | getTradingHalted (used by P2P). |
| services/operator-controls.service.ts | Trading halt, escrow freeze (admin_frozen_at), balance recovery; FOR UPDATE. |
| services/abuse-resilience.service.ts | Escrow cap, velocity; FOR UPDATE escrows. |
| services/hot-wallet.service.ts | getSignerForChain, updateBalanceCache (SET balance_cache = $1), checkHotWalletCaps. |
| services/hot-wallet-sweep.service.ts | sweepOneChain: read balance, sign, broadcast, updateBalanceCache(absolute). |
| config/monetary-precision.ts | ROUND_DOWN, AMOUNT_PRECISION. |

### Frontend — Data Flows

| File | Responsibility |
|------|----------------|
| lib/api.ts | apiRequest (auth, refresh on 401), api.get/post/put/patch/delete; getApiBaseUrl. |
| lib/balances.ts | fetchBalancesSummary (/api/v1/wallet/balances/summary, by-account fallback), useBalancesSummary, useTransferBalances; React Query keys ['balances','summary'], ['transfer', account]. |
| lib/p2pApi.ts | P2P API calls. |
| app/dashboard/transfer/page.tsx | useTransferBalances(fromAccount), POST transfer with idempotency key, fetchTransferHistory; state: fromAccount, toAccount, amount, error, success. |
| app/dashboard/withdraw/crypto/page.tsx | Withdrawal create, cancel; balance/preview APIs. |
| app/dashboard/deposit/crypto/page.tsx | Deposit address fetch. |
| app/dashboard/spot/page.tsx, trade/spot/page.tsx | Spot UI; useSpotWs (orderbook, trades, ticker). |
| hooks/useSpotWs.ts | WebSocket subscribe orderbook/trades/ticker. |
| components/trade/* | ChartPanel, OrderEntryPanel, OrderbookPanel, useChartAdapter (getChartCandles, ticker poll). |
| store/auth.ts | accessToken, refreshToken, setTokens, _hasHydrated. |

### Frontend — React Query / State

| Usage | Keys / invalidation |
|-------|---------------------|
| balances | ['balances','summary'], ['transfer', account]; staleTime 60s. |
| Transfer success | queryClient.invalidateQueries (balances). |
| Other pages | Various keys; not fully enumerated here. UNVERIFIABLE FROM AVAILABLE CONTEXT for complete list. |

### Error Handling & Idempotency

| Flow | Error handling | Idempotency |
|------|----------------|-------------|
| Withdrawal create | try/catch, 4xx/5xx, BALANCE_LOCK_FAILED; lock released on failure | Key + Redis lock 30s; cache 24h |
| Transfer | try/catch, NO_BALANCE_FOR_ACCOUNT, INSUFFICIENT_BALANCE | Key + Redis lock 30s; cache 24h |
| P2P create order | Service throws; route returns error | Lock 30s; cache 24h |
| P2P release | Same | Lock 30s; cache 24h |
| Deposit credit | creditDepositIfConfirmed returns { credited: boolean }; no throw on already applied | UPDATE WHERE balance_applied_at IS NULL |
| Withdrawal signing | markQueueFailed; completion tx re-checks status | FOR UPDATE SKIP LOCKED; signed_tx_hex reused on retry |
| Spot place order | INSUFFICIENT_BALANCE, NO_LIQUIDITY, etc. | No idempotency key on place (duplicate submits = duplicate orders if balance allows) |

---

## SECTION B — Correct vs Risky vs Defective vs Incomplete

### Logically Correct

- **deposit-credit.service.ts** — Single tx; UPDATE deposits with balance_applied_at; credit and ledger; only one winner per deposit id.
- **p2p-escrow.service.ts** — moveToEscrow, releaseFromEscrow, refundFromEscrow: FOR UPDATE, idempotent status, admin_frozen_at, ledger.
- **wallet.fastify transfer** — Deterministic lock order; single tx; debitAvailableBalance + creditBalanceForAccount; ledger inside wallet.service.
- **wallet.fastify withdrawal create** — Idempotency lock; balance lock and withdrawal insert in one tx; ledger.
- **withdrawal-signing.service.ts completion** — FOR UPDATE withdrawals; if status=cancelled skip debit; else debit locked + ledger.
- **wallet.fastify withdrawal cancel** — Only status=pending; single tx: UPDATE withdrawal + unlock balance + ledger.
- **spot-balance.service.ts** — All four ops with FOR UPDATE and ledger.
- **spot.fastify place order** — Lock in tx, insert order, runMatching in same client; on NO_LIQUIDITY unlock and throw.
- **Spot cancel (single)** — No FOR UPDATE on order row; but unlockTradingBalance requires locked_balance >= amount; second concurrent cancel sees reduced locked and throws. So one succeeds, one fails. Correct.
- **matching-engine executeTrade** — Single client; trade insert then debit/credit; throws on failure.

### Risky / Edge-case Vulnerable

- **Deposit address creation (wallet.service createWalletsForUser + wallet.fastify GET deposit-address)** — getNextHDIndex has no lock; two callers can get same index; INSERT ON CONFLICT (user_id, chain_id) DO NOTHING ensures one row. One request can get empty wallets and 500. **Reasoning:** Race causes one failure, not double address or balance bug.
- **Deposit sweep (deposit-sweep.service executeOneSweep)** — Not atomic with broadcast; balance_cache updated with read-then-write; two workers can race. **Reasoning:** balance_cache undercount or duplicate send attempt.
- **Hot wallet sweep (hot-wallet-sweep.service)** — updateBalanceCache(absolute); concurrent sweeps can overwrite. **Reasoning:** balance_cache drift.
- **Withdrawal idempotency lock TTL 30s** — If create flow exceeds 30s, duplicate request can acquire lock. **Reasoning:** Possible duplicate withdrawal if no DB uniqueness on idempotency key.
- **Legacy matching-engine cancelOrder** — Depends on Redis lock; Redis down => all cancels fail. **Reasoning:** Operational fail-closed; no double-unlock.
- **Spot cancel-all** — Iterates open orders and unlocks in one tx; no per-order FOR UPDATE. If same order cancelled twice (e.g. single cancel + cancel-all), second unlock fails (insufficient locked). **Reasoning:** Safe; possible UX confusion.

### Defective / Invariant Risk

- **admin.fastify PATCH /admin/p2p/disputes/:id/resolve** (and GET /admin/p2p/disputes) — **Defective.** Handler only runs `UPDATE p2p_disputes SET status = 'resolved', resolution = $1, resolution_notes = $2`. Does not call `p2pService.resolveDispute()`; escrow is never released or refunded. Handler does not call `getAdminFromRequest()`; route is unauthenticated under current pattern. **Reasoning:** Escrow stuck; possible privilege/abuse.
- **Withdrawal cancel during signing** — **Unsafe.** Withdrawal remains `pending` until processor runs completion tx. User can cancel after processor has broadcast tx. Cancel succeeds (UPDATE ... WHERE status = 'pending'); processor then sees status=cancelled and does not debit locked balance. Result: funds sent on-chain, user balance not debited. **Reasoning:** Exchange loss.

### Incomplete / Ambiguous

- **resolveDispute resolution 'split'** — Admin body allows resolution 'split'; p2p.service resolveDispute only handles favor_buyer | favor_seller | cancelled. If route is fixed to call service and passes 'split', service does not handle it. **Reasoning:** Incomplete handling of allowed value.

---

## SECTION C — Balance & Invariant Safety Risks

### Credits

- **Deposit credit:** Single tx; one winner per deposit id. No double credit from same deposit. UNIQUE(chain_id, tx_hash, to_address) on deposits prevents duplicate ingest of same on-chain tx.
- **P2P release:** Escrow status updated to released then seller escrow debited, buyer available credited in same tx. Idempotent.
- **P2P refund:** Escrow status updated to refunded then seller escrow debited, seller available credited. Idempotent.
- **Transfer credit:** In same tx as debit; deterministic lock order. No double credit.
- **Withdrawal completion:** Debit locked only when status not cancelled in same tx. **Risk:** Cancel-after-broadcast causes no debit (see Section I).

### Debits

- **Withdrawal create:** Lock (available -> locked) in same tx as INSERT withdrawal. Correct.
- **Withdrawal cancel:** Unlock in same tx as UPDATE status=cancelled. Correct.
- **Withdrawal completion:** Debit locked in completion tx; re-check status. **Risk:** If user cancelled after broadcast, processor skips debit => exchange loss.
- **Transfer:** Debit from one account in same tx as credit to other. Correct.
- **Spot / legacy match:** Debit locked and credit in same client/tx. Correct.

### Locks / Releases

- All balance locks use FOR UPDATE and ledger. No path found that releases without corresponding prior lock in same flow.
- **Lock leakage:** If withdrawal is cancelled after broadcast, locked balance is never debited (processor skips). So “lock” is effectively leaked (balance stays locked; funds already left). That is a form of desync: chain state vs user_balances.

### Desynchronization

- **Deposit sweep / hot sweep:** balance_cache (hot_wallets) updated with read-then-write or absolute set; concurrent runs can undercount or overwrite.
- **Redis balance cache (wallet.service getBalance):** TTL 30s; after mutation redis.del is called. Stale read possible for up to 30s if del fails. No double-credit from cache (writes go to DB).

### Phantom Balances

- No path found that credits without a corresponding debit or deposit/escrow source. Single exception: cancel-after-broadcast does not debit, so user’s locked balance is effectively “phantom” (already sent on-chain).

---

## SECTION D — Concurrency / Race Findings

- **Concurrent deposit address creation:** Two requests can both call createWalletsForUser; getNextHDIndex not serialized; INSERT ON CONFLICT ensures one row per (user_id, chain_id). One request can get empty list and 500. **Failure surface:** 500 and retry, not double wallet or balance bug.
- **Concurrent transfers (same user, funding ↔ trading):** Idempotency key + Redis lock; then tx with sorted FOR UPDATE on both account rows. No deadlock; no double transfer from same key. **Failure surface:** If lock TTL expires before tx commits, duplicate key could run (mitigation: ensure at most one transfer per key in DB if needed).
- **Concurrent withdrawal cancel vs completion:** Cancel does UPDATE withdrawals SET status='cancelled' WHERE status='pending'. Processor completion tx does SELECT status FOR UPDATE. If cancel commits first, processor sees cancelled and does not debit. **Failure surface:** Funds already broadcast; balance not debited (exchange loss).
- **Concurrent spot cancel same order:** First tx: UPDATE order CANCELLED, unlock (locked -= X). Second tx: UPDATE order CANCELLED, unlock; SELECT locked_balance >= amount finds 0 rows after first commit. Second throws. **Failure surface:** One success, one error; no double unlock.
- **Duplicate deposit replay:** Same (chain_id, tx_hash, to_address) cannot be inserted twice (UNIQUE). Credit is by deposit id with balance_applied_at guard. **Failure surface:** None for same on-chain tx.
- **P2P create order concurrent:** Redis lock + FOR UPDATE on ad and user; moveToEscrow in same tx. **Failure surface:** Second request waits or fails lock; no double escrow from same order id.
- **Retry storms:** Withdrawal/transfer use idempotency cache; repeated retries return cached response. Deposit credit is safe to retry. **Failure surface:** Idempotency lock TTL shorter than long-running request can allow duplicate submission.

---

## SECTION E — Contract / State Sync Risks

- **Balances summary:** Frontend expects `data.funding.totalUsd`, `data.trading.totalUsd` or fallback by-account. Backend returns summary and by-account. If backend renames or nests differently, frontend can show 0 or wrong. **Risk:** Response shape change.
- **Transfer:** Frontend sends idempotencyKey, fromAccount, toAccount, tokenId, amount. Backend expects same; errors INSUFFICIENT_BALANCE, NO_BALANCE_FOR_ACCOUNT. **Risk:** Low if backend keeps contract.
- **Transfer history:** Frontend expects list with from_account, to_account, symbol, amount, status, created_at. Backend must return compatible shape. **Risk:** Not re-verified in this pass. UNVERIFIABLE FROM AVAILABLE CONTEXT for exact contract.
- **Spot order response:** Frontend expects id, market, side, type, price, quantity, filled_quantity, status, displayStatus, created_at. Backend sends these. **Risk:** Low.
- **Null/undefined:** Various `row?.field ?? default` in backend. Frontend may assume presence; if backend omits field, UI can break. **Risk:** Per-endpoint; not fully enumerated.
- **Cache invalidation:** After transfer, balances invalidated. Multiple tabs share same React Query key; refetch-on-window-focus can reduce staleness. **Risk:** Stale balance in second tab until refetch.
- **Silent UI corruption:** If API returns success but with wrong data shape, UI can render wrong values. **Risk:** General; no specific instance found without full contract audit of every endpoint.

---

## SECTION F — Stress Scenario Results

| Scenario | Result | Mechanism |
|----------|--------|-----------|
| **A) Concurrent deposit address creation (same user)** | Risky | Two callers can both get wallet=null and call createWalletsForUser; getNextHDIndex race; ON CONFLICT ensures one row. One can get 500. No duplicate address; no balance bug. |
| **B) Concurrent transfers (funding ↔ trading)** | Safe | Idempotency key + lock; deterministic FOR UPDATE order; single tx debit/credit. |
| **C) Cancel withdrawal during signing** | Unsafe | After broadcast, withdrawal still pending; user cancels; processor sees cancelled and does not debit. Funds sent; balance not debited => exchange loss. |
| **D) Duplicate deposit replay** | Safe | UNIQUE(chain_id, tx_hash, to_address); credit by deposit id with balance_applied_at; single winner. |
| **E) Multiple tabs Spot + P2P** | Risky | Stale React Query cache across tabs; backend does not double-execute (per-order/per-request). Risk: stale UI, user repeats action. |
| **F) Rapid transfer loops** | Safe | Each transfer has idempotency key; same key returns cached result; different keys are separate transfers (balance permitting). |
| **G) Network retry / timeout** | Risky | Withdrawal/transfer: retry with same idempotency key returns cached response. If first request timed out after commit, cached response is correct. If lock TTL expired and duplicate key runs, second could create duplicate withdrawal unless DB prevents it. |
| **H) Refresh / reload mid-operation** | Risky | In-flight request may complete after reload; UI state lost. No double-execution from reload alone; idempotency protects same key. |

---

## SECTION G — Dead / Unused Logic

- **matchingEngine.ts (external engine client):** Used by admin (refreshMatchEventsCache). If no external engine is deployed, this is dead for matching; matching-engine.service is the in-process engine. Not dead code but alternate path.
- **trading.routes.ts (Express):** Used when index.ts (Express) is run; server.ts uses trading.fastify. Two stacks exist; which is production UNVERIFIABLE FROM AVAILABLE CONTEXT.
- **balance_locks table (spot.fastify):** DELETE FROM balance_locks in one cancel path (around line 1062); spot-balance uses user_balances locked_balance. Possible legacy path; balance_locks may or may not be used elsewhere. UNVERIFIABLE FROM AVAILABLE CONTEXT for full usage.
- **Admin P2P dispute handler:** Does not call p2pService.resolveDispute; effectively dead for correct escrow resolution (handler is active but logic is wrong).

---

## SECTION H — Missing / Remaining Work

- **Admin dispute resolve:** Enforce admin auth (getAdminFromRequest) on PATCH and GET dispute routes; call p2pService.resolveDispute so escrow is released/refunded; reject or implement 'split' resolution.
- **Withdrawal cancel after broadcast:** Prevent cancel once tx is broadcast (e.g. status or flag), or ensure processor always debits when tx has been broadcast so balance and chain stay consistent.
- **Deposit sweep:** Per-(chain_id, from_address) lock; atomic balance_cache update (e.g. balance_cache = balance_cache + $1).
- **Hot wallet sweep:** Atomic balance_cache update (e.g. decrement by sweep amount).
- **Withdrawal idempotency:** Longer lock TTL or refresh before critical section; ensure at most one withdrawal per idempotency key in DB (e.g. unique constraint).
- **Deposit address:** Optional serialization per (user_id, chain_id) to avoid getNextHDIndex race and 500 on loser.
- **Spot place order idempotency:** No idempotency key; duplicate submit creates duplicate order if balance allows. Optional: add key for “place order” to dedupe client retries.

---

## SECTION I — Critical Findings

1. **P2P admin dispute resolve (BROKEN)**  
   - **Where:** `apps/backend/src/routes/admin.fastify.ts` PATCH `/admin/p2p/disputes/:id/resolve` (and GET list).  
   - **What:** Handler only updates `p2p_disputes`; does not call `p2pService.resolveDispute()`; escrow is never released or refunded. No `getAdminFromRequest()` in handler.  
   - **Impact:** Disputes can be marked resolved with no fund movement; escrow stuck; unauthenticated if no global admin auth.

2. **Withdrawal cancel after broadcast (UNSAFE)**  
   - **Where:** POST `/withdrawals/:id/cancel` (wallet.fastify); withdrawal-signing.service completion tx.  
   - **What:** Withdrawal stays `pending` until processor commits completion. User can cancel after tx broadcast; cancel succeeds; processor sees `cancelled` and does not debit locked balance.  
   - **Impact:** Funds sent on-chain; user balance not debited => exchange loss.

3. **Deposit / hot sweep balance_cache (RISKY)**  
   - **Where:** deposit-sweep.service (read then updateBalanceCache); hot-wallet-sweep.service (updateBalanceCache absolute).  
   - **What:** Non-atomic read-then-write or absolute set; concurrent runs can undercount or overwrite.  
   - **Impact:** Hot wallet reconciliation and caps wrong.

4. **Admin dispute route auth (MISSING)**  
   - **Where:** Same dispute resolve and list handlers.  
   - **What:** No getAdminFromRequest (or equivalent) in handler.  
   - **Impact:** If admin prefix is not protected elsewhere, route may be callable without admin auth.

---

**End of audit.** No schema or architectural changes suggested; only correctness and safety of existing logic and minimal, targeted hardening as above. Where something could not be verified from the available code, it is marked "UNVERIFIABLE FROM AVAILABLE CONTEXT".
