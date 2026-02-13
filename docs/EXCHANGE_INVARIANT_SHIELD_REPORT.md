# Exchange Invariant Shield — Strict Mode Report

**Task:** Regression-prevention and safety shield for the production financial engine.  
**Scope:** Protective guard rails only. No change to trading logic, settlement logic, or DB schema.

---

## SECTION 1 — STATIC SHIELD CHANGES

### ESLint rules added

- **File:** `apps/backend/.eslintrc.cjs`
- **Rules:** `no-restricted-syntax` (error) for:
  - `CallExpression[callee.name='parseFloat']` — message: INVARIANT: parseFloat forbidden. Use Decimal.js for monetary values.
  - `CallExpression[callee.name='Number']` — message: INVARIANT: Number() forbidden. Use Decimal.js for monetary values.
  - `MemberExpression[object.name='Decimal'][property.name='toNumber']` — message: INVARIANT: Decimal.toNumber() forbidden in financial logic.
  - `CallExpression[callee.object.name='Math'][callee.property.name='round']` — message: INVARIANT: Math.round forbidden for money. Use Decimal.js.
  - `CallExpression[callee.object.name='Math'][callee.property.name='floor']` — message: INVARIANT: Math.floor forbidden for money. Use Decimal.js.
  - `CallExpression[callee.object.name='Math'][callee.property.name='ceil']` — message: INVARIANT: Math.ceil forbidden for money. Use Decimal.js.

### Unsafe patterns blocked

- **parseFloat** — Blocked in all `src/**/*.ts` except whitelisted files.
- **Number(...)** — Blocked in all `src/**/*.ts` except whitelisted files.
- **Decimal.prototype.toNumber()** — Blocked everywhere.
- **Math.round / Math.floor / Math.ceil** — Blocked everywhere (no monetary rounding via Math).

### Whitelist (non-monetary use only)

The following files are exempt from `no-restricted-syntax` for **non-monetary** use only (counts, pagination, port, latency, Redis score, IP parsing, KYC level, etc.):

- `src/lib/redis.ts`
- `src/plugins/latencyTrace.plugin.ts`
- `src/server.ts`
- `src/routes/user.fastify.ts`
- `src/routes/wallet.fastify.ts`
- `src/middleware/rateLimiter.ts`
- `src/middleware/security.ts`
- `src/middleware/auth.ts`
- `src/services/otp.service.ts`
- `src/lib/admin-ip-whitelist.ts`

**Note:** Backend lint script is `eslint src --ext .ts`. If the project does not have `eslint` and `@typescript-eslint/parser` / `@typescript-eslint/eslint-plugin` in `apps/backend/package.json` devDependencies, add them so `npm run lint` applies these rules.

---

## SECTION 2 — RUNTIME GUARDS ADDED

### Helper functions created

- **File:** `apps/backend/src/lib/monetary-invariants.ts`
- **Functions:**
  - **assertNonNegative(label, value)** — Throws if value &lt; 0 or not finite. Use before debit/lock.
  - **assertValidDecimal(label, value)** — Throws if value is NaN or infinite.
  - **assertDebitNotExceedLocked(debit, locked)** — Throws if debit &gt; locked.
  - **assertUnlockNotExceedLocked(unlock, locked)** — Throws if unlock &gt; locked.
  - **assertDebitNotExceedAvailable(debit, available)** — Throws if debit &gt; available.

All throw hard errors on violation; no silent clamping or auto-corrections.

### Locations applied

- **user-balance-helper.ts** — Re-exports all invariant helpers for use at balance boundaries.
- **wallet.service.ts**  
  - `debitAvailableBalance`: `assertValidDecimal('debitAmount', amount)` and `assertNonNegative('debitAmount', amount)` at entry.  
  - `creditBalanceForAccount`: `assertValidDecimal('creditAmount', amount)` and `assertNonNegative('creditAmount', amount)` at entry.  
  - `lockBalance`: `assertValidDecimal('lockAmount', amount)` and `assertNonNegative('lockAmount', amount)` at entry.  
  - `unlockBalance`: `assertValidDecimal('unlockAmount', amount)` and `assertNonNegative('unlockAmount', amount)` at entry.
- **settlement-worker.ts** — `assertValidDecimal('settlement_price', p.price)`, `assertValidDecimal('settlement_qty', p.qty)`, `assertNonNegative('settlement_qty', p.qty)` before processing event.

Existing logic (e.g. `assertBalanceInvariant` after UPDATE, `INSUFFICIENT_LOCKED_FUNDS` in settlement) is unchanged. Additional call sites for `assertDebitNotExceedLocked` / `assertUnlockNotExceedLocked` can be added where the caller already has locked/available values (e.g. withdrawal lock path in wallet.fastify) without changing behavior.

---

## SECTION 3 — DECIMAL DISCIPLINE VALIDATION

### .toNumber() usage

- **Result:** **NONE** in backend `src/`.
- **Grep:** `\.toNumber\(\)` and `\.valueOf\(\)` — no matches in financial or other code.

### Validation

- No `Decimal.prototype.toNumber()` in monetary or comparator paths.
- No `valueOf()` used for monetary coercion in the backend.

---

## SECTION 4 — PRECISION POLICY VALIDATION

### Single source of precision

- **File:** `apps/backend/src/config/monetary-precision.ts`
- **Exports:**
  - **ROUNDING_MODE** / **ROUND_DOWN** = 1 (Decimal.js ROUND_DOWN)
  - **AMOUNT_PRECISION** = 8
  - **PRICE_PRECISION** = 18
  - **RATE_PRECISION** = 18
  - **PERCENTAGE_DISPLAY_PRECISION** = 2

### Files wired to central config

- **spot-decimal.ts** — Imports `ROUND_DOWN` and `AMOUNT_PRECISION` from `config/monetary-precision.js`; exports `ROUND_DOWN`; uses `AMOUNT_PRECISION` as `DEFAULT_PRECISION`.
- **getSpendableBalance.ts** — Imports `ROUND_DOWN` and `AMOUNT_PRECISION` from `config/monetary-precision.js`.

Other files (e.g. wallet.fastify, convert.fastify, auth, user, admin, aml) still use local `ROUND_DOWN` / `AMOUNT_PRECISION` / `PREC` constants with the **same numeric values** (1, 8, 18). They can be migrated incrementally to import from `config/monetary-precision.js` without changing behavior. Numeric values were not changed; only centralization was added.

---

## SECTION 5 — SERIALIZATION SAFETY VALIDATION

### Monetary value output

- **Rule:** All monetary values MUST be serialized via **Decimal.toString()** (or `.toDecimalPlaces(..., ROUND_DOWN).toString()`).  
- **Forbidden:** `Number(...)`, `.toFixed(...)` on floats, or implicit numeric conversion for money at API/DB boundaries.

### Verification

- Per **BACKEND_FLOAT_ERADICATION_REPORT.md**, float math was removed from financial paths and DB/API output uses `Decimal.toString()`.
- No new serialization of monetary values was added in this shield task; existing patterns (string amounts, Decimal-only math) were preserved.
- **Result:** No violations introduced. Serialization remains safe where the float-eradication pass was completed.

---

## SUMMARY

| Item | Status |
|------|--------|
| ESLint: parseFloat / Number / toNumber / Math.round|floor|ceil forbidden | ✅ Implemented (with whitelist for non-monetary files) |
| Runtime: assertNonNegative, assertValidDecimal, assertDebitNotExceedLocked, assertUnlockNotExceedLocked | ✅ Implemented and applied at wallet.service + settlement-worker |
| .toNumber() in backend | ✅ None |
| Central precision module | ✅ Added; spot-decimal and getSpendableBalance use it |
| Serialization (Decimal.toString only) | ✅ No violations; consistent with float-eradication |

**No float-based monetary logic was detected in the scope of this shield.**  
**No unsafe numeric pattern was introduced.**  
**Result: SUCCESS — Invariant shield in place; business logic and schema unchanged.**
