# Idempotency-Key Audit — Frontend State-Changing Requests

**Scope:** All POST, PUT, PATCH, DELETE requests in `apps/frontend`  
**Date:** 2025-02-11  
**Rule:** Analysis only — no code modifications

---

## 1) SAFE — Already Sending Idempotency (or Equivalent)

| File | Line | Method | Endpoint | Notes |
|------|------|--------|----------|-------|
| `apps/frontend/src/app/dashboard/trade/spot/page.tsx` | 128-131 | POST | `/api/v1/spot/orders` | Sends `client_order_id` in body — backend uses it for idempotency |

**Subtotal: 1 request**

---

## 2) UNSAFE — Missing Idempotency-Key (Backend Requires It)

| File | Line | Method | Endpoint | Backend Expectation |
|------|------|--------|----------|---------------------|
| `apps/frontend/src/app/dashboard/withdraw/crypto/page.tsx` | 446-452 | POST | `/api/v1/wallet/withdrawals` | Requires `Idempotency-Key` header → 400 if missing |
| `apps/frontend/src/app/dashboard/withdraw/crypto/page.tsx` | 486-489 | POST | `/api/v1/wallet/withdrawals/:id/cancel` | Cancel — verify if backend requires idempotency |
| `apps/frontend/src/app/dashboard/transfer/page.tsx` | 140-151 | POST | `/api/v1/wallet/transfer` | Requires `Idempotency-Key` header → 400 if missing |
| `apps/frontend/src/app/dashboard/assets/convert/page.tsx` | 319-325 | POST | `/api/v1/convert/instant` | Requires `Idempotency-Key` header → 400 if missing |
| `apps/frontend/src/app/dashboard/assets/convert/page.tsx` | 319-325 | POST | `/api/v1/convert/limit` | Requires `Idempotency-Key` header → 400 if missing |
| `apps/frontend/src/app/dashboard/assets/convert/page.tsx` | 354-356 | POST | `/api/v1/convert/limit/:orderId/cancel` | Cancel — verify backend |

**Note:** Withdraw create, Transfer, Convert instant, Convert limit are **confirmed** to require Idempotency-Key. Cancel endpoints may vary.

**Subtotal: 4–6 requests (4 confirmed critical)**

---

## 3) SUSPICIOUS — Mutations via Helper / Indirect / Unclear

### 3a) `api.post` / `api.put` / `api.patch` (lib/api.ts)

The `api` client merges headers from `options` but **never injects Idempotency-Key**. Callers must pass it explicitly.

| File | Line | Method | Endpoint | Notes |
|------|------|--------|----------|-------|
| `apps/frontend/src/app/dashboard/trade/page.tsx` | 209 | POST | `/api/v1/spot/order` | `api.post()` — no client_order_id, no Idempotency-Key; uses older /order (singular) API |
| `apps/frontend/src/app/dashboard/trade/page.tsx` | 226 | POST | `/api/v1/spot/order/:id/cancel` | `api.post()` — no idempotency |
| `apps/frontend/src/app/dashboard/trade/page.tsx` | 241 | POST | `/api/v1/spot/orders/cancel-all` | `api.post()` — no idempotency |

### 3b) `securityApi.ts` — Admin Security Helper

Uses `adminFetch()` internally; no Idempotency-Key added. Mutations include approve/reject withdrawal and CRUD on risk/IP rules.

| File | Line | Method | Endpoint | Notes |
|------|------|--------|----------|-------|
| `apps/frontend/src/lib/securityApi.ts` | 161 | POST | `/api/v1/admin/security/risk-rules` | createRiskRule |
| `apps/frontend/src/lib/securityApi.ts` | 173 | PATCH | `/api/v1/admin/security/risk-rules/:id` | updateRiskRule |
| `apps/frontend/src/lib/securityApi.ts` | 186 | PATCH | `/api/v1/admin/security/risk-rules/:id/enable|disable` | setRiskRuleEnabled |
| `apps/frontend/src/lib/securityApi.ts` | 193 | DELETE | `/api/v1/admin/security/risk-rules/:id` | deleteRiskRuleById |
| `apps/frontend/src/lib/securityApi.ts` | 259 | POST | `/api/v1/admin/security/ip-rules` | createIpRule |
| `apps/frontend/src/lib/securityApi.ts` | 269 | PATCH | `/api/v1/admin/security/ip-rules/:id` | updateIpRule |
| `apps/frontend/src/lib/securityApi.ts` | 281 | PATCH | `/api/v1/admin/security/ip-rules/:id/enable|disable` | setIpRuleEnabled |
| `apps/frontend/src/lib/securityApi.ts` | 288 | DELETE | `/api/v1/admin/security/ip-rules/:id` | deleteIpRuleById |
| `apps/frontend/src/lib/securityApi.ts` | 353 | POST | `/api/v1/admin/security/withdrawals/:id/approve` | approveWithdrawalById |
| `apps/frontend/src/lib/securityApi.ts` | 363 | POST | `/api/v1/admin/security/withdrawals/:id/reject` | rejectWithdrawalById |

### 3c) Auth / User Mutations (Typical Non-Balance Flows)

Auth and security flows are generally idempotent by design (OTP send, verify, toggle). Listed for completeness; backend idempotency requirements unknown.

| File | Line | Method | Endpoint |
|------|------|--------|----------|
| `apps/frontend/src/lib/api.ts` | 47 | POST | `/api/v1/auth/refresh` |
| `apps/frontend/src/app/admin/login/page.tsx` | 40 | POST | `/api/v1/admin/auth/login` |
| `apps/frontend/src/app/(auth)/login/page.tsx` | 73 | POST | `/api/v1/auth/login/check-passkeys` |
| `apps/frontend/src/app/(auth)/login/page.tsx` | 127 | POST | `/api/v1/auth/passkey/authenticate/options` |
| `apps/frontend/src/app/(auth)/login/page.tsx` | 163 | POST | `/api/v1/auth/passkey/authenticate/verify` |
| `apps/frontend/src/app/(auth)/login/page.tsx` | 196 | POST | `/api/v1/auth/send-otp` |
| `apps/frontend/src/app/(auth)/login/page.tsx` | 280 | POST | `/api/v1/auth/login` |
| `apps/frontend/src/app/(auth)/login/page.tsx` | 358 | POST | `/api/v1/auth/login/verify-step` |
| `apps/frontend/src/app/(auth)/login/page.tsx` | 420 | POST | `/api/v1/auth/send-otp` |
| `apps/frontend/src/app/(auth)/login/page.tsx` | 431 | POST | `/api/v1/auth/login/resend-otp` |
| `apps/frontend/src/app/(auth)/signup/page.tsx` | 72 | POST | `/api/v1/auth/send-otp` |
| `apps/frontend/src/app/(auth)/signup/page.tsx` | 140 | POST | `/api/v1/auth/verify-otp` |
| `apps/frontend/src/app/(auth)/signup/page.tsx` | 178 | POST | `/api/v1/auth/signup` |
| `apps/frontend/src/app/(auth)/signup/page.tsx` | 219 | POST | `/api/v1/auth/send-otp` |
| `apps/frontend/src/lib/oauth.ts` | 58 | POST | `/api/v1/auth/oauth/google/callback` |
| `apps/frontend/src/lib/oauth.ts` | 100 | POST | `/api/v1/auth/oauth/apple/callback` |
| `apps/frontend/src/lib/oauth.ts` | 130 | POST | `/api/v1/auth/oauth/telegram` |

### 3d) Dashboard User Mutations (No Idempotency-Key)

| File | Line | Method | Endpoint |
|------|------|--------|----------|
| `apps/frontend/src/app/dashboard/layout.tsx` | 202 | POST | `/api/v1/user/notifications/read-all` |
| `apps/frontend/src/app/dashboard/fee-rates/page.tsx` | 93 | POST | `/api/v1/auth/fee-rates/mnt-discount` |
| `apps/frontend/src/app/dashboard/preferences/page.tsx` | 179 | POST | `/api/v1/auth/preferences` |
| `apps/frontend/src/app/dashboard/identity/page.tsx` | 127 | POST | `/api/v1/kyc/initiate` |
| `apps/frontend/src/app/dashboard/identity/upload/page.tsx` | 110 | POST | `/api/v1/kyc/upload-document` |
| `apps/frontend/src/app/dashboard/api/create/page.tsx` | 78 | POST | `/api/v1/auth/api-keys` |
| `apps/frontend/src/app/dashboard/address-book/page.tsx` | 283 | POST | `/api/v1/auth/send-security-otp` |
| `apps/frontend/src/app/dashboard/address-book/page.tsx` | 323 | POST | `/api/v1/auth/verify-security-otp` |
| `apps/frontend/src/app/dashboard/address-book/page.tsx` | 341 | POST | `/api/v1/auth/2fa/verify` |
| `apps/frontend/src/app/dashboard/address-book/page.tsx` | 360 | POST | `/api/v1/auth/withdrawal-whitelist/toggle` |
| `apps/frontend/src/app/dashboard/address-book/page.tsx` | 427 | POST | `/api/v1/auth/withdrawal-addresses` |
| `apps/frontend/src/app/dashboard/address-book/page.tsx` | 476 | DELETE | `/api/v1/auth/withdrawal-addresses/:id` |
| `apps/frontend/src/app/dashboard/address-book/add-batches/page.tsx` | 221 | POST | `/api/v1/auth/withdrawal-addresses` |

### 3e) Security Page Mutations

| File | Line | Method | Endpoint |
|------|------|--------|----------|
| `apps/frontend/src/app/dashboard/security/page.tsx` | 562 | POST | `/api/v1/auth/sms-auth/toggle` |
| `apps/frontend/src/app/dashboard/security/page.tsx` | 594 | POST | `/api/v1/auth/send-security-otp` |
| `apps/frontend/src/app/dashboard/security/page.tsx` | 622 | POST | `/api/v1/auth/verify-security-otp` |
| `apps/frontend/src/app/dashboard/security/page.tsx` | 688 | POST | `/api/v1/auth/send-security-otp` |
| `apps/frontend/src/app/dashboard/security/page.tsx` | 717 | POST | `/api/v1/auth/verify-phone-setup` |
| `apps/frontend/src/app/dashboard/security/page.tsx` | 753 | POST | `/api/v1/auth/send-security-otp` |
| `apps/frontend/src/app/dashboard/security/page.tsx` | 781 | POST | `/api/v1/auth/verify-security-otp` |
| `apps/frontend/src/app/dashboard/security/page.tsx` | 796 | POST | `/api/v1/auth/2fa/setup` |
| `apps/frontend/src/app/dashboard/security/page.tsx` | 831 | POST | `/api/v1/auth/2fa/enable` |
| `apps/frontend/src/app/dashboard/security/page.tsx` | 876 | POST | `/api/v1/auth/2fa/disable` |
| `apps/frontend/src/app/dashboard/security/page.tsx` | 945 | POST | `/api/v1/auth/passkey/register/options` |
| `apps/frontend/src/app/dashboard/security/page.tsx` | 983 | POST | `/api/v1/auth/passkey/register/verify` |
| `apps/frontend/src/app/dashboard/security/page.tsx` | 1019 | DELETE | `/api/v1/auth/passkeys/:id` |
| `apps/frontend/src/app/dashboard/security/page.tsx` | 1073 | POST | `/api/v1/auth/fund-password/set` |
| `apps/frontend/src/app/dashboard/security/page.tsx` | 1140 | POST | `/api/v1/auth/anti-phishing/set` |
| `apps/frontend/src/app/dashboard/security/page.tsx` | 1182 | POST | `/api/v1/auth/send-otp` |
| `apps/frontend/src/app/dashboard/security/page.tsx` | 1213 | POST | `/api/v1/auth/change-email` |
| `apps/frontend/src/app/dashboard/security/page.tsx` | 1250 | POST | `/api/v1/auth/send-security-otp` |
| `apps/frontend/src/app/dashboard/security/page.tsx` | 1280 | POST | `/api/v1/auth/verify-security-otp` |
| `apps/frontend/src/app/dashboard/security/page.tsx` | 1310 | POST | `/api/v1/auth/send-otp` |
| `apps/frontend/src/app/dashboard/security/page.tsx` | 1342 | POST | `/api/v1/auth/change-phone` |
| `apps/frontend/src/app/dashboard/security/page.tsx` | 1389 | POST | `/api/v1/auth/change-password` |
| `apps/frontend/src/app/dashboard/security/page.tsx` | 1426 | POST | `/api/v1/auth/send-security-otp` |
| `apps/frontend/src/app/dashboard/security/page.tsx` | 1457 | POST | `/api/v1/auth/verify-security-otp` |
| `apps/frontend/src/app/dashboard/security/page.tsx` | 1503 | POST | `/api/v1/auth/withdrawal-whitelist/toggle` |
| `apps/frontend/src/app/dashboard/security/page.tsx` | 1541 | POST | `/api/v1/auth/address-book/toggle` |

### 3f) Admin Mutations (Direct fetch, No Idempotency-Key)

| File | Line | Method | Endpoint |
|------|------|--------|----------|
| `apps/frontend/src/app/admin/(protected)/settings/p2p-assets/page.tsx` | 167 | PATCH | `/api/v1/admin/settings/p2p-assets/:id/toggle` |
| `apps/frontend/src/app/admin/(protected)/settings/p2p-assets/page.tsx` | 187 | DELETE | `/api/v1/admin/settings/p2p-assets/:id` |
| `apps/frontend/src/app/admin/(protected)/settings/p2p-assets/page.tsx` | 269 | POST | `/api/v1/admin/settings/p2p-assets` |
| `apps/frontend/src/app/admin/(protected)/settings/p2p-assets/page.tsx` | 492 | PUT | `/api/v1/admin/settings/p2p-assets/:id` |
| `apps/frontend/src/app/admin/(protected)/wallets/hot/page.tsx` | 240 | POST | `/api/v1/admin/hot-wallets` |
| `apps/frontend/src/app/admin/(protected)/wallets/hot/page.tsx` | 366 | POST | `/api/v1/admin/hot-wallets/:chainId/replace` |
| `apps/frontend/src/app/admin/(protected)/wallets/hot/page.tsx` | 404 | DELETE | `/api/v1/admin/hot-wallets/:chainId` |
| `apps/frontend/src/app/admin/(protected)/wallets/hot/[chainId]/page.tsx` | 203 | POST | `/api/v1/admin/deposit-sweeps/run` |
| `apps/frontend/src/app/admin/(protected)/settings/blockchain/chains/page.tsx` | 99 | PATCH | `/api/v1/admin/settings/blockchains/:id/toggle` |
| `apps/frontend/src/app/admin/(protected)/settings/blockchain/chains/page.tsx` | 209 | POST | `upload/logo/blockchain` |
| `apps/frontend/src/app/admin/(protected)/settings/blockchain/chains/page.tsx` | 240 | POST/PUT | blockchains create/update |
| `apps/frontend/src/app/admin/(protected)/settings/blockchain/page.tsx` | 114 | PATCH | `/api/v1/admin/settings/blockchains/:id/toggle` |
| `apps/frontend/src/app/admin/(protected)/settings/blockchain/page.tsx` | 161 | PATCH | `/api/v1/admin/settings/currencies/:id/toggle` |
| `apps/frontend/src/app/admin/(protected)/settings/blockchain/page.tsx` | 283 | POST | `upload/logo/blockchain` |
| `apps/frontend/src/app/admin/(protected)/settings/blockchain/page.tsx` | 316 | POST/PUT | blockchains |
| `apps/frontend/src/app/admin/(protected)/settings/blockchain/page.tsx` | 614 | POST | `upload/logo/currency` |
| `apps/frontend/src/app/admin/(protected)/settings/blockchain/page.tsx` | 647 | POST/PUT | currencies |
| `apps/frontend/src/app/admin/(protected)/settings/blockchain/currencies/page.tsx` | 177 | PATCH | `/api/v1/admin/settings/currencies/symbol/:symbol/toggle` |
| `apps/frontend/src/app/admin/(protected)/settings/trading-pairs/page.tsx` | 248 | PATCH | `/api/v1/admin/settings/trading-pairs/:id/toggle` |
| `apps/frontend/src/app/admin/(protected)/settings/trading-pairs/page.tsx` | 268 | DELETE | `/api/v1/admin/settings/trading-pairs/:id` |
| `apps/frontend/src/app/admin/(protected)/settings/trading-pairs/page.tsx` | 292 | DELETE | `/api/v1/admin/settings/quote-assets/:id` |
| `apps/frontend/src/app/admin/(protected)/settings/trading-pairs/page.tsx` | 370 | POST | `/api/v1/admin/settings/quote-assets` |
| `apps/frontend/src/app/admin/(protected)/settings/trading-pairs/page.tsx` | 679 | POST | `/api/v1/admin/settings/trading-pairs/bulk` |
| `apps/frontend/src/app/admin/(protected)/settings/trading-pairs/page.tsx` | 835 | PUT | `/api/v1/admin/settings/trading-pairs/:id` |
| `apps/frontend/src/app/admin/(protected)/trading/circuit-breakers/page.tsx` | 61 | POST | `/api/v1/admin/spot/markets/:symbol/circuit-reset` |
| `apps/frontend/src/app/admin/(protected)/trading/market-control/page.tsx` | 112 | PATCH | spot market status |
| `apps/frontend/src/app/admin/(protected)/trading/market-control/page.tsx` | 143 | POST | circuit-reset |
| `apps/frontend/src/app/admin/(protected)/trading/market-control/page.tsx` | 180 | PATCH | trading config |
| `apps/frontend/src/app/admin/(protected)/trading/spot-markets/page.tsx` | 78 | PATCH | `/api/v1/admin/spot/markets/:symbol` |
| `apps/frontend/src/app/admin/(protected)/trading/spot-markets/page.tsx` | 115 | PATCH | `/api/v1/admin/spot/markets/:symbol` status |
| `apps/frontend/src/app/admin/(protected)/notifications/sms/page.tsx` | 94 | PATCH | `/api/v1/admin/notifications/sms-templates/:id` |
| `apps/frontend/src/app/admin/(protected)/notifications/sms/page.tsx` | 105 | POST | `/api/v1/admin/notifications/sms-templates` |
| `apps/frontend/src/app/admin/(protected)/notifications/sms/page.tsx` | 127 | DELETE | `/api/v1/admin/notifications/sms-templates/:id` |
| `apps/frontend/src/app/admin/(protected)/notifications/email/page.tsx` | 102 | PATCH | email templates |
| `apps/frontend/src/app/admin/(protected)/notifications/email/page.tsx` | 113 | POST | email templates |
| `apps/frontend/src/app/admin/(protected)/notifications/email/page.tsx` | 135 | DELETE | email templates |
| `apps/frontend/src/app/admin/(protected)/notifications/push/page.tsx` | 29 | POST | push broadcast |
| `apps/frontend/src/app/admin/(protected)/notifications/announcements/page.tsx` | 118 | PATCH | announcements |
| `apps/frontend/src/app/admin/(protected)/notifications/announcements/page.tsx` | 131 | POST | announcements |

---

## Summary

| Category | Count |
|----------|-------|
| **SAFE** | 1 |
| **UNSAFE** (confirmed backend requires Idempotency-Key) | 4 |
| **SUSPICIOUS** (helper / indirect / unknown backend) | 80+ |

### Priority Fixes (UNSAFE — Will Fail or Double-Execute)

1. `withdraw/crypto/page.tsx:446` — `POST /wallet/withdrawals`
2. `transfer/page.tsx:140` — `POST /wallet/transfer`
3. `assets/convert/page.tsx:319` — `POST /convert/instant` and `POST /convert/limit`

---

*Audit complete. No code modifications were made.*
