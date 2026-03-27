# POST /auth/send-otp — Pre-Handler Lifecycle Debug

## Request lifecycle (before handler)

1. **onRequest** (earliest)
   - `[LIFECYCLE] INCOMING REQUEST: POST /api/v1/auth/send-otp`
   - latencyTracePlugin, authDecisionPlugin, app.addHook (requestId), ipRulesMiddleware, geoBlockMiddleware

2. **preParsing** — body stream transformation

3. **Parsing** — body parsed

4. **preValidation** — schema validation runs (400 if fails)

5. **preHandler** — rateLimitByIp('auth:send-otp', 3, 60) — route-specific

6. **Handler** — send-otp handler

## Fixes applied

### 1. authDecisionPlugin (session-core fetch)
- **Problem:** Runs on EVERY request; fetches `http://localhost:7001/validate`. When session-core is not running, fetch hangs up to 5s then aborts. Every auth request delayed 5s; client may timeout.
- **File:** `apps/backend/src/plugins/authDecision.plugin.ts`
- **Fix:** Skip session-core fetch for public auth routes: send-otp, verify-otp, login, signup, check-passkeys, passkey options/verify, register options/verify.

### 2. ipRulesMiddleware (IP rules + VPN check)
- **Problem:** Runs for /api/v1/auth/send-otp; calls checkVpnTor (Redis), matchRules (DB query to security_ip_rules). Potential hang or error if Redis/DB slow or table missing.
- **File:** `apps/backend/src/middleware/ip-rules.middleware.ts`
- **Fix:** Added send-otp and other public auth routes to SKIP_PATHS so they bypass IP rule evaluation.

### 3. Debug logging
- **File:** `apps/backend/src/server.ts`
  - `[LIFECYCLE] INCOMING REQUEST:` — first onRequest
- **File:** `apps/backend/src/middleware/ip-rules.middleware.ts`
  - `[LIFECYCLE] ipRulesMiddleware:` — when IP rules run for auth paths

## How to trace

1. Start backend: `cd apps/backend && npm run dev`
2. Trigger POST /api/v1/auth/send-otp from login
3. Check logs in order:
   - See `INCOMING REQUEST` → request reached Fastify
   - See `ipRulesMiddleware` with `skip=true` → IP rules skipped (after fix)
   - See `[send-otp] BODY:` → handler reached
   - If handler logs never appear → failure is in preHandler (rate limit) or preValidation (schema)
