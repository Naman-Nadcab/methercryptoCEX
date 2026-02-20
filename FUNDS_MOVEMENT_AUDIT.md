# Funds Movement Audit: Withdraw, Transfer, Convert

Production-style validation. Output: critical issues, root cause, minimal safe diffs only.

---

## 1) Balances from React Query cache

| Flow | Current | Issue |
|------|---------|--------|
| Withdraw | `useState(balances)` + `fetchBalances()` → `/wallet/balances/by-account` | Balances not from React Query; local fetch only. Overview/Funding use `['balances']` cache; withdraw uses separate state. After invalidateQueries we refetch locally too, so consistency is eventual but source is not the cache. |
| Transfer | `useState(tokens)` + `fetchTransferableBalances()` → `/wallet/transfer/balances` | Transfer uses a different API (by from-account). No shared React Query key for this. Acceptable if design is “page-owned” data; cache invalidation of `['balances']` on success is already in place. |
| Convert | `useState(balances)` + `fetchBalances()` → `/convert/balances?accountType=` | Same as withdraw: not sourced from React Query. Invalidate on success is present. |

**Verdict:** Balances are **not** sourced from React Query in any of the three flows; they use local state + page fetch. Cache is invalidated on mutation success so Overview/Funding eventually match. Making these flows read from a shared React Query cache would be an architecture change (new query keys / endpoints). **No minimal diff** for “always from cache” without that; current invalidation is the minimal consistency fix already applied.

---

## 2) Idempotency-Key on ALL mutations

| Mutation | Idempotency-Key |
|----------|------------------|
| POST /wallet/withdrawals | Yes |
| POST /wallet/withdrawals/:id/cancel | No |
| POST /wallet/transfer | Yes |
| POST /convert/instant, POST /convert/limit | Yes |
| POST /convert/limit/:id/cancel | No |

**Verdict:** Cancel mutations (withdraw cancel, convert limit cancel) do not send Idempotency-Key. Cancelling the same id twice is naturally idempotent; adding a key is optional for consistency. **Minimal diff (optional):** add `Idempotency-Key: crypto.randomUUID()` to both cancel requests.

---

## 3) Stale state / unsafe math (NaN, undefined)

| Location | Issue | Why |
|----------|--------|-----|
| **Withdraw** | `getAvailableBalance()` sums funding + trading when both checkboxes are selected, but submit sends only one account (`accountType: selectedAccounts.funding ? 'funding' : 'trading'`). So “Available” and “All” can show/set more than the balance of the account actually debited. | User can set amount > single-account balance and hit backend error or wrong UX. |
| **Transfer** | `transferAmount = parseFloat(amount)`, `availableBalance = parseFloat(selectedToken.availableBalance ?? '0')`. If either is NaN, `transferAmount > availableBalance` is false; no explicit NaN check. | Invalid input could be submitted (e.g. 0 or non-numeric). |
| **Convert** | `handleConvert` does not validate `parseFloat(fromAmount) > 0` or `!isNaN(parseFloat(fromAmount))`, or that amount ≤ available balance. | Can submit non-numeric or negative fromAmount; no client-side insufficient-balance check. |
| **Convert** | Quote response: `setToAmount(parseFloat(data.data.to.amount).toFixed(6))`. If `data.data.to.amount` is missing/invalid, result is `"NaN"`. | UI can show "NaN" in to-amount. |

**Minimal diffs:** See fixes below (withdraw getAvailableBalance; transfer NaN guard; convert validation + quote NaN guard).

---

## 4) Success/failure balance invariants

- **Success:** All three flows invalidate `['balances']` and refetch local balances (or equivalent). Invariants: cache invalidated, local data refreshed.
- **Failure:** No refetch on failure (correct; balances unchanged). Error state shown; retry is “submit again” (no double mutation if user clicks once, Idempotency-Key on mutations).

**Verdict:** Invariants hold. No change.

---

## 5) Balance refresh after mutation success

- Withdraw: `queryClient.invalidateQueries({ queryKey: ['balances'] })` + `fetchBalances()` + `fetchWithdrawalLimits()` + `fetchRecentWithdrawals()`.
- Transfer: `invalidateQueries` + `fetchTransferableBalances()` + `fetchTransferHistory()`.
- Convert: `invalidateQueries` + `fetchBalances()` (+ `fetchActiveOrders()` for limit).

**Verdict:** All refresh correctly. No change.

---

## 6) Race conditions / duplicate requests

| Flow | Finding |
|------|--------|
| Withdraw | Preview effect: 300ms debounce, but in-flight fetch is not aborted when amount/chain changes. Stale preview can overwrite. Low impact (preview only). Optional: AbortController in effect. |
| Transfer | Single submit; Idempotency-Key prevents duplicate deduction. No race. |
| Convert | Quote already uses AbortController; duplicate submit guarded by `converting` and Idempotency-Key. No change. |

**Verdict:** No critical race. Optional: withdraw preview AbortController (minimal diff not applied here).

---

## 7) Chain/network selection (withdraw)

- Chains loaded per token: `fetchChainsForToken(selectedToken.symbol)` when token changes. Chain list from `/wallet/tokens/:symbol/chains`.
- Submit sends `chainId: selectedChain.id` and `toAddress` for on-chain. Internal uses `internal_user_identifier`.
- Chain dropdown disabled when no token; chain cleared when token changes (`setSelectedChain(null)` in fetchChainsForToken). Logic is correct.

**Verdict:** No change.

---

## 8) Max/All button correctness

| Flow | Issue |
|------|--------|
| Withdraw | “All” uses `setMaxAmount()` → `getAvailableBalance()`. When both funding and trading are selected, getAvailableBalance returns the **sum** but submit debits only **one** account. So “All” can set an amount greater than the single-account balance. Fix: make getAvailableBalance return the balance of the account we actually debit (the one implied by `accountType`). |
| Transfer | “Max” sets `selectedToken.availableBalance ?? '0'`. Correct. |
| Convert | “Max” sets `getAvailableBalance()` (from-currency balance). Correct. |

**Minimal diff:** Withdraw: change `getAvailableBalance()` to return the balance of the account type sent in the request (funding if `selectedAccounts.funding`, else trading), not the sum of both.

---

## 9) Error handling and retry safety

- All three: set error state on failure, clear on retry/submit. No automatic retry of mutation (safe).
- Transfer: `catch` → “Network error. Please try again.” Withdraw/Convert: similar. Retry is user-driven; Idempotency-Key prevents double debit on double click.

**Verdict:** Adequate. No change.

---

# Critical issues summary and minimal diffs

### Critical 1: Withdraw “Available” / “All” vs single-account debit

- **Why:** `getAvailableBalance()` sums funding and trading when both checkboxes are selected; request sends only one `accountType`. User can set amount above that account’s balance.
- **Fix:** In withdraw page, make `getAvailableBalance()` return the balance for the account we actually debit: `selectedAccounts.funding ? safeNum(tokenBalance.funding) : safeNum(tokenBalance.trading)` (and keep `safeNum`/token lookup as today).

### Critical 2: Transfer NaN allows invalid submit

- **Why:** No check for `isNaN(transferAmount)` or `isNaN(availableBalance)`; NaN comparisons are false so validation can pass.
- **Fix:** In transfer `handleTransfer`, reject when `!Number.isFinite(transferAmount) || transferAmount <= 0` or when `!Number.isFinite(parseFloat(selectedToken.availableBalance ?? '0'))`.

### Critical 3: Convert no client-side amount validation / quote NaN

- **Why:** handleConvert doesn’t validate positive numeric fromAmount or ≤ available balance; quote can set toAmount to "NaN" if API omits `data.data.to.amount`.
- **Fix:** (1) In handleConvert, validate `const fromNum = parseFloat(fromAmount); if (!Number.isFinite(fromNum) || fromNum <= 0) { setError('...'); return; }` and optionally `fromNum > parseFloat(getAvailableBalance())` → insufficient balance. (2) When setting quote result, use `const toVal = parseFloat(data.data?.to?.amount); if (Number.isFinite(toVal)) setToAmount(toVal.toFixed(6));` (and same for conversionRate/targetRate).

### Optional: Idempotency-Key on cancel mutations

- **Why:** Consistency with other mutations.
- **Fix:** Add header `Idempotency-Key: crypto.randomUUID()` to withdraw cancel and convert limit cancel.

All above are minimal diffs; no architecture refactor.
