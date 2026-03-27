# Login 500 Error — Root Cause Analysis

## "Sending OTP ke baad 500" — Kahan fail hota hai?

500 do jagah aa sakta hai:

1. **send-otp** (`POST /api/v1/auth/send-otp`) — OTP bhejne ke dauran
2. **login** (`POST /api/v1/auth/login`) — OTP daal kar submit karne ke baad

---

## 1. send-otp pe 500

### Possible causes

| # | Operation | Error | Cause |
|---|-----------|-------|-------|
| 1 | **createOTP** (DB) | `OTP_CREATE_FAILED` | `otp_verifications` table missing / wrong schema |
| 2 | **Outer catch** | `OTP_SEND_FAILED` | Unhandled exception (e.g. getIdentifierType, normalize) |

### createOTP kya karta hai

- `DELETE FROM otp_verifications WHERE identifier = $1 AND type = $2`
- `INSERT INTO otp_verifications (identifier, type, otp_hash, salt, expires_at, max_attempts)`
- Redis (optional) — fail hone par bhi DB se flow chal sakta hai

### Agar table missing ho

- Error: `relation "otp_verifications" does not exist`
- Fix: `cd apps/backend && npm run migrate`

### Backend logs dekho

```
[send-otp] ROOT_ERROR createOTP: <exact message>
[send-otp] STACK: <stack trace>
[send-otp] FAILING_OPERATION: createOTP
```

---

## 2. login pe 500 (OTP submit ke baad)

### Possible causes

| # | Operation | Error | Cause |
|---|-----------|-------|-------|
| 1 | **User query** | INTERNAL_ERROR | `users` table missing columns (sms_auth_enabled, totp_enabled, etc.) |
| 2 | **user_sessions INSERT** | INTERNAL_ERROR | `user_sessions` table missing |
| 3 | **user_activity_logs INSERT** | INTERNAL_ERROR | `user_activity_logs` table missing |
| 4 | **generateTokens** | `TOKEN_GENERATION_FAILED` | JWT sign fail (e.g. JWT_SECRET invalid) |

### Backend logs dekho

```
Login error { message: "...", stack: "..." }
```

---

## 3. Comparison — Frontend vs Backend

### send-otp

| Frontend sends | Backend expects | Match? |
|----------------|-----------------|--------|
| `{ identifier, type, purpose }` | `identifier` required (minLength 5), `type`, `purpose` optional | ✅ |
| POST | POST | ✅ |

### login (OTP submit)

| Frontend sends | Backend expects | Match? |
|----------------|-----------------|--------|
| `{ email: "x@y.com", otp: "123456" }` or `{ phone: "+91...", otp: "123456" }` | `email?`, `phone?`, `otp` (6 chars) | ✅ |
| POST | POST | ✅ |

### Response

| Backend returns (success) | Frontend expects | Match? |
|---------------------------|------------------|--------|
| `{ success: true, data: { user, accessToken, refreshToken } }` | Same | ✅ |

---

## 4. Sabse common cause: migrations na chalna

500 ka sabse zyada wajah:

```
cd apps/backend && npm run migrate
```

Ye ensure karta hai:

- `otp_verifications`
- `user_sessions`
- `user_activity_logs`
- `users` (with required columns)

---

## 5. Verify script

```bash
cd apps/backend
npm run migrate
npx tsx scripts/debug-send-otp.ts
```

Agar script success ho, to send-otp ka DB/OTP flow theek hai. Phir:

- Agar UI par ab bhi 500 aaye, to Network tab se check karo: send-otp ya login pe 500?
- Backend terminal mein `[send-otp]` ya `Login error` logs dekho.

---

## 6. Quick checklist

- [ ] `npm run migrate` chala?
- [ ] Backend chal raha hai? (`curl http://localhost:4000/health`)
- [ ] send-otp 200 aa raha? (`curl -X POST ... /send-otp`)
- [ ] Backend logs mein exact error kya hai?
