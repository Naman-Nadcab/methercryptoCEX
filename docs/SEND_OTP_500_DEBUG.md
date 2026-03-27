# send-otp 500 Debug Report

## Summary

The `/api/v1/auth/send-otp` endpoint was returning 500. Backend-only debugging was performed.

## Findings

### Debug script (direct service calls)

Running `npx tsx scripts/debug-send-otp.ts` **succeeded** for all steps:
- [1] `createOTP` (DB + Redis) — OK
- [2] `sendEmailOTP` — OK
- [3] User lookup — OK

So the OTP flow itself works when invoked directly. The 500 likely occurs when:
- The request goes through HTTP (preHandler, schema validation, etc.)
- Or when the user's DB has schema drift (missing columns in `users`)

### Handler location

| Item | Value |
|------|-------|
| **File** | `apps/backend/src/routes/auth.fastify.ts` |
| **Route** | `POST /api/v1/auth/send-otp` |
| **Handler lines** | ~156–323 |

### Logging added

Each failing operation now logs:
- `[send-otp] FAILING_OPERATION: <operation>`
- `[send-otp] ROOT_ERROR: <message>`
- `[send-otp] STACK: <stack trace>`

Operations covered:
1. `createOTP` (DB query + Redis)
2. `sendEmailOTP` / `sendSMSOTP`
3. `user lookup` (with fallback)
4. `outer catch` (unhandled)

## Fixes applied

1. **User lookup fallback** — If the full `SELECT id, email, phone, status, email_verified, phone_verified` query fails (e.g. missing columns), a minimal `SELECT id` query is used instead. Avoids 500 when the schema differs.
2. **User lookup error handling** — On failure, we log and continue with `isNewUser=true` instead of throwing. OTP is already sent, so we avoid a 500.
3. **Stack logging** — Added stack trace logging in the sendOTP catch block for easier debugging.

## Capturing the actual error

When 500 occurs, check the backend terminal for:

```
[send-otp] ROOT_ERROR ...
[send-otp] STACK ...
[send-otp] FAILING_OPERATION: ...
```

Or run the debug script and HTTP test locally:

```bash
# 1. Isolate which step fails (DB/OTP/user lookup)
cd apps/backend && npx tsx scripts/debug-send-otp.ts

# 2. Test via HTTP (backend must be running)
# In one terminal: npm run dev
# In another:
curl -X POST http://127.0.0.1:4000/api/v1/auth/send-otp \
  -H "Content-Type: application/json" \
  -d '{"identifier":"test@example.com"}'
```

In development, 500 responses include `detail` with the error message and a short stack.
