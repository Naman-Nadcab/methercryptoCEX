# User-Side Closed-Beta Fixes — Summary & Verification

**Goal:** Zero 500s on a fresh DB created only from `migrate.ts`.  
**Done:** Schema mismatches, unsafe queries, and auth payload handling fixed.

---

## a) Exact SQL / migrate.ts patches (already applied)

### 1. KYC applications table (after kyc_records trigger, before kyc_documents)

```sql
-- KYC APPLICATIONS TABLE (user-facing KYC flow; code uses this)
CREATE TABLE IF NOT EXISTS kyc_applications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kyc_level SMALLINT NOT NULL DEFAULT 0,
  status VARCHAR(30) NOT NULL DEFAULT 'not_submitted',
  rejection_reason TEXT,
  submitted_at TIMESTAMP WITH TIME ZONE,
  reviewed_at TIMESTAMP WITH TIME ZONE,
  reviewed_by UUID REFERENCES users(id),
  reviewer_notes TEXT,
  country VARCHAR(10),
  document_type VARCHAR(50),
  third_party_provider VARCHAR(50),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_kyc_applications_user_id ON kyc_applications(user_id);
```

### 2. Referral codes table (after users trigger, before auth_providers)

```sql
-- REFERRAL CODES TABLE (auth profile + referral flow)
CREATE TABLE IF NOT EXISTS referral_codes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code VARCHAR(32) NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_referral_codes_user_id ON referral_codes(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_codes_code ON referral_codes(code);
```

---

## b) Exact Fastify code diffs

### 1. GET /user/sessions — `apps/backend/src/routes/user.fastify.ts`

**Before:** SELECT used `device_name, browser, os, location_country, location_city, last_activity_at` (not in migrate).  
**After:**

```ts
const result = await db.query(`
  SELECT 
    id, device_type, ip_address, user_agent, device_id,
    created_at, expires_at,
    CASE WHEN id = $2 THEN TRUE ELSE FALSE END as is_current
  FROM user_sessions
  WHERE user_id = $1 AND is_active = TRUE AND expires_at > NOW()
  ORDER BY created_at DESC
`, [userId, currentSessionId]);
```

### 2. GET /auth/profile — `apps/backend/src/routes/auth.fastify.ts`

- **JWT normalization helper** (added near top of file):

```ts
/** Normalize request.user so request.user.id always exists (from userId or id). Returns false if already replied 401. */
function normalizeUserPayload(request: FastifyRequest, reply: FastifyReply): boolean {
  const u = request.user as { id?: string; userId?: string } | undefined;
  if (!u) return true;
  const id = u.id ?? u.userId;
  if (!id || typeof id !== 'string') {
    reply.status(401).send({ success: false, error: { code: 'INVALID_JWT_PAYLOAD', message: 'Invalid token payload' } });
    return false;
  }
  (request.user as { id: string }).id = id;
  return true;
}
```

- **Profile handler:** after `await request.jwtVerify();` add:

```ts
if (!normalizeUserPayload(request, reply)) return;
const userId = (request.user as { id: string }).id;
```

(Replace previous `const { userId } = request.user as ...`.)

- **Referral block:** wrap in try/catch and never throw; set `referralCode = null` on any error. No INSERT/SELECT outside try; on catch set `referralCode = null`.

### 3. No other route logic changed

- Wallet, deposit, withdrawal, internal transfer: unchanged.  
- KYC route code: unchanged; only `kyc_applications` table added in migrate.

---

## c) Closed-beta verification checklist

Run on a **fresh DB created only via `migrate.ts`** (e.g. new DB, then `npm run migrate` or equivalent).

1. **GET /auth/profile**  
   - With valid Bearer (user JWT): 200, `data.user` present.  
   - With invalid/malformed token: 401.  
   - No 500.

2. **GET /user/sessions**  
   - With valid Bearer: 200, `data` array of sessions with `id, device_type, ip_address, user_agent, device_id, created_at, expires_at, is_current`.  
   - No 500.

3. **GET /kyc/status**  
   - With valid Bearer: 200, `data.status` (e.g. `not_submitted`) and `data.verified`.  
   - No 500 (table `kyc_applications` exists).

4. **GET /wallet/deposit-address/:chainId**  
   - With valid Bearer and valid chainId (and KYC satisfied if enforced): 200, address returned.  
   - No 500 from missing `kyc_applications` or `referral_codes`.

5. **Schema**  
   - `user_sessions`: only columns used in SELECT exist (id, device_type, ip_address, user_agent, device_id, created_at, expires_at, is_active).  
   - `kyc_applications`: present with id, user_id, kyc_level, status, rejection_reason, submitted_at, reviewed_at, created_at, updated_at, plus country, document_type, third_party_provider, reviewed_by, reviewer_notes.  
   - `referral_codes`: present with id, user_id, code, is_active, created_at, updated_at.

6. **JWT payload**  
   - Profile uses `request.user.id` after `normalizeUserPayload`; works for payloads with `userId` or `id`.  
   - Missing both → 401 `INVALID_JWT_PAYLOAD`, no 500.

---

**Files touched**

- `apps/backend/src/database/migrate.ts` — added `kyc_applications`, `referral_codes`.  
- `apps/backend/src/routes/user.fastify.ts` — GET /user/sessions SELECT and ORDER BY.  
- `apps/backend/src/routes/auth.fastify.ts` — `normalizeUserPayload`, profile userId and referral block.
