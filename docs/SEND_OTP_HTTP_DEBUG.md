# POST /auth/send-otp — HTTP Request Layer Debug

## Expected input

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `identifier` | string | **Yes** | minLength: 5 (email or phone) |
| `type` | string | No | `'email'` or `'phone'` |
| `purpose` | string | No | `'login'` or `'signup'` |

**Example:**
```json
{
  "identifier": "user@example.com",
  "type": "email",
  "purpose": "login"
}
```

## Frontend actual payload (login page)

```javascript
// apps/frontend/src/app/(auth)/login/page.tsx:249-257
body: JSON.stringify({
  identifier,        // from state (user input)
  type: identifierType,  // 'email' | 'phone'
  purpose: 'login',
})
```

**Headers:** `Content-Type: application/json`

## Backend schema (Fastify)

```javascript
// auth.fastify.ts
schema: {
  body: {
    type: 'object',
    required: ['identifier'],
    properties: {
      identifier: { type: 'string', minLength: 5 },
      type: { type: 'string' },
      purpose: { type: 'string' },
    },
    additionalProperties: true,
  },
}
```

## Debugging flow

1. **Schema validation (before handler):** If Fastify rejects, you'll see:
   ```
   [send-otp/validation] Request REJECTED before handler: { path, validation, message }
   ```
   → Handler never runs; response is 400.

2. **Handler reached:** If you see `[send-otp] BODY:` in logs, parsing and validation passed.
   - `BODY:` — actual request.body
   - `EXPECTED:` — expected structure
   - `ACTUAL:` — parsed field types/lengths
   - `MISMATCH:` — if manual validation fails

## Common mismatches

| Symptom | Cause | Fix |
|---------|-------|-----|
| Body is `undefined` | Missing `Content-Type: application/json` or invalid JSON | Ensure fetch sends `headers: { 'Content-Type': 'application/json' }` and `body: JSON.stringify(...)` |
| identifier too short | User entered < 5 chars | Frontend validation or schema rejects (400) |
| Rejected before handler | Schema validation failed | Check `[send-otp/validation]` log for exact validation errors |
| 500 with no BODY log | Error in preHandler (e.g. rate limit) or before body parsing | Check rate-limit Redis; verify request reaches backend |

## Capturing actual request

1. Start backend: `cd apps/backend && npm run dev`
2. Trigger send-otp from login page
3. Check backend terminal for:
   - `[send-otp] BODY:` — actual parsed body
   - `[send-otp] EXPECTED:` vs `[send-otp] ACTUAL:` — comparison
   - `[send-otp] MISMATCH:` — if validation fails in handler
