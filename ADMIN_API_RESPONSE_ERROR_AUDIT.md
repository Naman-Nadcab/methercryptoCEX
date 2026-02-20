# Admin API Response & Error Consistency Audit

**Scope:** `/api/v1/admin` routes in `apps/backend/src/routes/admin.fastify.ts`. No schema/architecture changes.

---

## SECTION A — Response Shape Issues

### A.1 Success response: top-level `message` instead of `data`

**Standard pattern:** `{ success: true, data: { ... } }`.

**Deviations (success with top-level `message`, no `data`):**

| Location   | Route                                   | Current shape                                      |
|-----------|------------------------------------------|----------------------------------------------------|
| ~5079–5082 | DELETE /settings/blockchains/:id (disable) | `{ success: true, message: 'Blockchain disabled (has linked currencies)' }` |
| ~5087–5090 | DELETE /settings/blockchains/:id (delete)  | `{ success: true, message: 'Blockchain deleted' }` |
| ~5492–5495 | DELETE /settings/currencies/:id (disable)  | `{ success: true, message: 'Currency disabled (has user wallets)' }` |
| ~5500–5503 | DELETE /settings/currencies/:id (delete)   | `{ success: true, message: 'Currency deleted' }`  |

**Impact:** Clients that only read `data` will see `undefined` for these success responses.

---

### A.2 Success response: no `data` at all

| Location | Route                         | Current shape        |
|----------|--------------------------------|----------------------|
| ~3358    | DELETE /hot-wallets/:chainId   | `{ success: true }`  |

**Impact:** Inconsistent with other success responses; clients may expect `data` (e.g. `data: { deleted: true }` or `data: { message: '...' }`).

---

### A.3 Error response: extra top-level field

**Standard pattern:** `{ success: false, error: { code: string, message: string } }`.

**Deviation:**

| Location | Route                          | Current shape                                                                 |
|----------|---------------------------------|-------------------------------------------------------------------------------|
| ~717     | POST /settlement/balance-reconcile (when `!result.ok`) | `{ success: false, error: { code: 'RECONCILE_FAILED', message: result.message }, ledger_sum: result.ledger_sum }` |

**Impact:** Only this error adds a top-level `ledger_sum`. Clients that assume errors have exactly `success` + `error` must handle an optional extra field.

---

### A.4 Success response: `data` shape variance for “message only”

Most “message only” success responses use `data: { message: '...' }` (e.g. PATCH /settings, dispute resolve, KYC review). The DELETE blockchains/currencies responses above use top-level `message` instead of `data: { message }`, which is the inconsistency already noted in A.1.

---

## SECTION B — Status Code Issues

### B.1 200 + success on error path (silent failure)

| Location | Route            | Issue |
|----------|------------------|--------|
| ~338–342 | POST /auth/logout | In the `catch` block (e.g. when `app.jwt.verify(token)` throws for invalid/expired token), the handler returns `reply.send({ success: true, data: { message: 'Logged out' } })` with no explicit status (200). The client cannot distinguish “logout succeeded” from “token was invalid and we swallowed the error.” |

**Recommendation:** On catch (e.g. invalid/expired token), return 401 with `{ success: false, error: { code: 'INVALID_TOKEN', message: '...' } }` (or 200 only when no token was sent). Do not return `success: true` when verification failed.

---

### B.2 500 where 4xx may be more appropriate

- **Manual credit (ADMIN_CREDIT_BALANCE_ROW_NOT_FOUND), ~1700:** Returns 500. This is an internal consistency failure (row missing after ensure). 500 is defensible; no change required for “minimal” fix.
- **Hot wallet create (pgCode 23503 FK), ~2666–2670:** Returns 500 with message “Chain not found in database.” A “resource not found” or “invalid reference” could be 404/400; 500 is still used. Optional improvement: 404 for “chain not found,” 400 for bad request; left to “minimal corrections” if desired.
- **Hot wallet create (42P01 table missing), ~2593, ~2661:** Returns 500. Correct for server misconfiguration.
- **GET /hot-wallets (table missing / column missing), ~2512, ~2593:** Returns 500. Correct for server/schema issues.

No other clear cases where a deterministic 4xx was found to be wrongly 500 in the audited handlers.

---

### B.3 Consistent 4xx usage

Validation (missing/invalid input), NOT_FOUND, INVALID_STATE, and auth (401/403) are generally returned with appropriate status codes (400, 404, 401, 403, 409). Idempotency conflicts use 409. No systematic misuse found beyond B.1.

---

## SECTION C — Silent Failure Risks

### C.1 POST /auth/logout catch returns success

**Risk:** Invalid or expired token causes `jwt.verify` to throw; the catch returns 200 with `success: true`. Caller believes logout succeeded; session may still be valid on the server if the delete was never reached.

**Mitigation:** In the catch block, return 401 (or 400) with `success: false` and an error code/message; do not return `success: true`.

---

### C.2 getAdminFromRequest sends reply and returns null

**Observation:** When auth fails, `getAdminFromRequest` calls `reply.status(401|403).send(...)` and returns `null`. Handlers do `if (!admin) return;` and do not send again. So no “double send” or path where the handler continues after auth failure. No silent failure from this pattern.

---

### C.3 emptyResponse() in GET /funds/summary

**Observation:** On failure of `reply.send(...)` in the try block, the catch calls `return emptyResponse();`, which sends a valid 200 with empty data. Response is still sent; no silent failure.

---

### C.4 No other silent failure paths identified

All inspected catch blocks either return a reply (4xx/5xx) or call a helper that sends a response. No path was found where the handler exits without sending.

---

## SECTION D — Minimal Safe Corrections

Minimal, non-refactor changes that preserve handler logic and fix consistency/safety only.

---

### D.1 Success shape: normalize to `data` (optional but recommended)

- **DELETE /settings/blockchains/:id**  
  - Disable response (~5079): use `return reply.send({ success: true, data: { message: 'Blockchain disabled (has linked currencies)' } });`  
  - Delete response (~5087): use `return reply.send({ success: true, data: { message: 'Blockchain deleted' } });`
- **DELETE /settings/currencies/:id**  
  - Disable response (~5492): use `return reply.send({ success: true, data: { message: 'Currency disabled (has user wallets)' } });`  
  - Delete response (~5500): use `return reply.send({ success: true, data: { message: 'Currency deleted' } });`

This makes success responses consistently use `data` for payload (including message-only payloads).

---

### D.2 Success shape: DELETE /hot-wallets/:chainId (~3358)

- **Current:** `return reply.send({ success: true });`  
- **Minimal fix:** `return reply.send({ success: true, data: { deleted: true } });` (or `data: { message: 'Hot wallet removed' }`) so success always has a `data` field when the rest of the API uses it.

---

### D.3 Error shape: RECONCILE_FAILED (~717)

- **Current:** `{ success: false, error: { code: 'RECONCILE_FAILED', message: result.message }, ledger_sum: result.ledger_sum }`  
- **Minimal fix (preserve behavior):** Move `ledger_sum` into `error` so the error object is the only extra structure:  
  `{ success: false, error: { code: 'RECONCILE_FAILED', message: result.message, ledger_sum: result.ledger_sum } }`  
  Clients that already read top-level `ledger_sum` would need to read `error.ledger_sum` instead. Alternatively, keep top-level `ledger_sum` and document it as an optional field for this endpoint only; no code change.

---

### D.4 Status code / silent failure: POST /auth/logout (~338–342)

- **Current (catch):** `return reply.send({ success: true, data: { message: 'Logged out' } });`  
- **Minimal fix:** On catch (e.g. invalid/expired token), return an error response and do not report success. Example:  
  `return reply.status(401).send({ success: false, error: { code: 'INVALID_TOKEN', message: 'Invalid or expired token' } });`  
  Optionally preserve “no token provided” as 200 with success (logout is a no-op then). This removes the silent failure and incorrect 200 on verification failure.

---

### D.5 Logging consistency (optional)

- **Observation:** Many settings/quote-assets/trading-pairs/p2p-assets/features/api handlers use `console.error('...', error)` in catch blocks; the rest of the file uses `logger.error(...)`.  
- **Minimal fix:** Replace those `console.error` calls with `logger.error('...', { error: error instanceof Error ? error.message : String(error) })` (or equivalent) so logging is consistent. This does not change response shape or status codes.

---

**Summary**

| Section | Finding |
|--------|---------|
| A     | 4 success responses use top-level `message` instead of `data`; 1 success has no `data`; 1 error has top-level `ledger_sum`. |
| B     | 1 critical: logout catch returns 200 + success on error; no other systematic 500-vs-4xx issues. |
| C     | 1 silent-failure risk: logout catch; no other paths found that skip sending a response. |
| D     | Minimal safe corrections: normalize success to `data` (D.1–D.2), optional error shape fix (D.3), fix logout catch (D.4), optional logger (D.5). |

No schema changes, refactors, or architectural redesign recommended; only the above response/status/logging adjustments.
