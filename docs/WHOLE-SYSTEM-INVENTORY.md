# Whole System Inventory – Backend, Admin UI, User UI

Complete list of every backend route, service, admin page, and user (dashboard) page in the Exchange system.

---

# PART 1: BACKEND

Base URL: `/api/v1` (all routes below are under this prefix unless noted).

---

## 1.1 Health (no prefix)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check (DB, Redis status) |

---

## 1.2 Auth – `/api/v1/auth`

| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/send-otp` | Send OTP to email or phone |
| POST | `/auth/verify-otp` | Verify OTP and login/register |
| POST | `/auth/refresh` | Refresh access token |
| POST | `/auth/login` | Login (email/phone + password or step) |
| POST | `/auth/login/verify-step` | Login step verification |
| POST | `/auth/login/resend-otp` | Resend OTP during login |
| GET | `/auth/login/check-passkeys` | Check if user has passkeys |
| POST | `/auth/logout` | Logout (invalidate session) |
| GET | `/auth/me` | Current user (JWT payload) |
| GET | `/auth/profile` | User profile |
| GET | `/auth/check-password` | Check if password matches (for sensitive actions) |
| POST | `/auth/change-password` | Change password |
| POST | `/auth/change-email` | Change email |
| POST | `/auth/change-phone` | Change phone |
| POST | `/auth/send-security-otp` | Send security OTP |
| POST | `/auth/verify-security-otp` | Verify security OTP |
| POST | `/auth/verify-phone-setup` | Verify phone setup |
| POST | `/auth/2fa/setup` | Start 2FA setup |
| POST | `/auth/2fa/enable` | Enable 2FA |
| POST | `/auth/2fa/verify` | Verify 2FA code |
| POST | `/auth/2fa/disable` | Disable 2FA |
| GET | `/auth/fund-password/status` | Fund password status |
| POST | `/auth/fund-password/check-same` | Check fund password not same as login |
| POST | `/auth/fund-password/set` | Set fund password |
| GET | `/auth/anti-phishing/status` | Anti-phishing phrase status |
| POST | `/auth/anti-phishing/set` | Set anti-phishing phrase |
| GET | `/auth/api-keys` | List API keys |
| POST | `/auth/api-keys` | Create API key |
| DELETE | `/auth/api-keys/:id` | Delete API key |
| GET | `/auth/preferences` | User preferences |
| POST | `/auth/preferences` | Update preferences |
| GET | `/auth/withdrawal-limits` | Withdrawal limits |
| POST | `/auth/withdrawal-limits` | Set withdrawal limits |
| GET | `/auth/new-address-lock/status` | New address lock status |
| GET | `/auth/withdrawal-addresses` | Withdrawal whitelist addresses |
| POST | `/auth/withdrawal-addresses` | Add withdrawal address |
| DELETE | `/auth/withdrawal-addresses/:id` | Remove withdrawal address |
| GET | `/auth/address-book/status` | Address book feature status |
| POST | `/auth/address-book/toggle` | Toggle address book |
| POST | `/auth/sms-auth/toggle` | Toggle SMS auth |
| GET | `/auth/sms-auth/status` | SMS auth status |
| GET | `/auth/security/settings` | Security settings summary |
| POST | `/auth/address-book/toggle` | Address book toggle |
| GET | `/auth/withdrawal-whitelist/status` | Withdrawal whitelist status |
| POST | `/auth/withdrawal-whitelist/toggle` | Withdrawal whitelist toggle |
| GET | `/auth/fee-rates` | User fee rates |
| POST | `/auth/fee-rates/mnt-discount` | MNT discount (fee promotion) |
| POST | `/auth/passkey/register/options` | Passkey registration options |
| POST | `/auth/passkey/register/verify` | Passkey registration verify |
| POST | `/auth/passkey/authenticate/options` | Passkey auth options |
| POST | `/auth/passkey/authenticate/verify` | Passkey auth verify |
| GET | `/auth/passkeys` | List passkeys |
| DELETE | `/auth/passkeys/:passkeyId` | Remove passkey |
| GET | `/auth/oauth/google/url` | Google OAuth URL |
| GET | `/auth/oauth/apple/url` | Apple OAuth URL |

---

## 1.3 Wallet – `/api/v1/wallet`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/wallet/chains` | List active chains |
| GET | `/wallet/chains/:chainId/tokens` | Tokens for a chain |
| GET | `/wallet/tokens` | List tokens |
| GET | `/wallet/tokens/:symbol/chains` | Chains for a token (deposit/withdraw) |
| GET | `/wallet/kyc-status` | KYC verification status |
| GET | `/wallet/deposit-address/:chainId` | Get deposit address for chain |
| GET | `/wallet/addresses` | User wallet addresses |
| GET | `/wallet/deposits` | Legacy deposits list (if exists) |
| GET | `/wallet/balance-diagnostic` | Balance diagnostic (counts, why zero) |
| GET | `/wallet/balances` | Raw balances list (from `balances` table – legacy) |
| GET | `/wallet/withdrawals` | Withdrawal history |
| GET | `/wallet/balances/by-account` | Balances by account (funding/trading), user_balances first |
| GET | `/wallet/withdrawal-limits` | Withdrawal limits for user |
| GET | `/wallet/withdrawal-fee/:symbol/:chainId` | Withdrawal fee for token/chain |
| GET | `/wallet/withdraw/preview` | Withdraw preview (amount, fee, net) |
| POST | `/wallet/withdrawals` | Create withdrawal (on-chain or internal transfer) |
| POST | `/wallet/withdrawals/:id/cancel` | Cancel pending withdrawal |
| GET | `/wallet/balances/summary` | Assets overview summary (funding/trading totals) |
| GET | `/wallet/balances/funding` | Funding account balances (user_balances first) |
| GET | `/wallet/balances/trading` | Trading/unified account balances (reads `balances` only) |
| GET | `/wallet/transfer/balances` | Balances for internal transfer (by from-account) |
| POST | `/wallet/transfer` | Internal transfer (funding ↔ trading) |
| GET | `/wallet/transfer/history` | Internal transfer history |
| GET | `/wallet/pnl` | PnL (period, type, symbol) |
| GET | `/wallet/deposit-history` | Deposit history (paginated) |
| GET | `/wallet/transactions/all` | All transactions (combined) |
| GET | `/wallet/deposit/:txHash` | Single deposit by tx hash |

---

## 1.4 Trading – `/api/v1/trading`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/trading/pairs` | Trading pairs |
| GET | `/trading/balances` | User balances (Fastify: user_balances; Express trading.routes: balances) |
| GET | `/trading/wallets` | User wallets (trading.fastify: user_wallets + blockchains) |
| GET | `/trading/orders` | Orders (status, pairId, limit) |
| GET | `/trading/history` | Trade history |
| GET | `/trading/currencies` | Currencies for trading |

---

## 1.5 P2P – `/api/v1/p2p`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/p2p/ads` | List P2P ads |
| GET | `/p2p/payment-methods` | Payment methods |
| GET | `/p2p/my-ads` | My ads (auth) |
| GET | `/p2p/my-orders` | My orders (auth) |
| GET | `/p2p/merchant-stats` | Merchant stats (auth) |
| GET | `/p2p/my-payment-methods` | My payment methods (auth) |

---

## 1.6 User – `/api/v1/user`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/user/profile` | User profile |
| GET | `/user/sessions` | User sessions |
| GET | `/user/activity` | Activity log |
| GET | `/user/notifications` | Notifications |
| GET | `/user/referrals` | Referral info |
| GET | `/user/kyc` | KYC status/details |

---

## 1.7 Admin – `/api/v1/admin`

| Method | Path | Description |
|--------|------|-------------|
| POST | `/admin/auth/logout` | Admin logout |
| GET | `/admin/auth/me` | Current admin user |
| GET | `/admin/dashboard/stats` | Dashboard stats |
| GET | `/admin/users` | List users (paginated, filters) |
| GET | `/admin/users/:id` | User detail (profile, balances, sessions, activity) |
| GET | `/admin/users/:id/balances` | User balances (user_balances only) |
| PATCH | `/admin/users/:id/status` | Update user status (suspend/ban etc) |
| GET | `/admin/kyc/pending` | Pending KYC list |
| PATCH | `/admin/kyc/:id/review` | Review KYC (approve/reject) |
| GET | `/admin/kyc` | KYC list with filters |
| GET | `/admin/p2p/disputes` | P2P disputes |
| PATCH | `/admin/p2p/disputes/:id/resolve` | Resolve P2P dispute |
| GET | `/admin/settings` | Global settings |
| PATCH | `/admin/settings` | Update settings |
| GET | `/admin/wallets` | Wallets overview |
| GET | `/admin/funds/summary` | Funds summary (ledger vs on-chain) |
| GET | `/admin/deposit-sweeps/eligibility` | Deposit sweep eligibility |
| POST | `/admin/deposit-sweeps/run` | Run deposit sweep |
| GET | `/admin/deposits` | List deposits (filters, paginated) |
| GET | `/admin/withdrawals` | List withdrawals (status, chain, token, paginated) |
| POST | `/admin/withdrawals/:id/approve` | Approve withdrawal |
| POST | `/admin/withdrawals/:id/reject` | Reject withdrawal (releases lock in user_balances) |
| GET | `/admin/hot-wallets` | List hot wallets |
| POST | `/admin/hot-wallets` | Create/provision hot wallet |
| GET | `/admin/hot-wallets/balances` | Hot wallet balances (optional chainId) |
| GET | `/admin/hot-wallets/history` | Hot wallet history (withdrawals, etc) |
| GET | `/admin/hot-wallets/:chainSlug` | Hot wallet detail by chain slug |
| GET | `/admin/hot-wallets/:chainId/balance` | Hot wallet balance for chain |
| PATCH | `/admin/hot-wallets/:chainId` | Update hot wallet |
| POST | `/admin/hot-wallets/:chainId/replace` | Replace hot wallet |
| DELETE | `/admin/hot-wallets/:chainId` | Remove hot wallet |
| GET | `/admin/trading` | Trading overview |
| GET | `/admin/p2p` | P2P overview |
| GET | `/admin/p2p/ads` | P2P ads list |
| GET | `/admin/p2p/orders` | P2P orders list |
| GET | `/admin/referrals` | Referrals overview |
| GET | `/admin/fees` | Fees overview |
| GET | `/admin/admins` | List admins |
| GET | `/admin/admins/logs` | Admin action logs |
| GET | `/admin/settings/blockchains` | List blockchains |
| GET | `/admin/settings/blockchains/:id` | Get blockchain |
| POST | `/admin/settings/blockchains` | Create blockchain |
| PUT | `/admin/settings/blockchains/:id` | Update blockchain |
| DELETE | `/admin/settings/blockchains/:id` | Delete blockchain |
| PATCH | `/admin/settings/blockchains/:id/toggle` | Toggle blockchain |
| GET | `/admin/settings/currencies` | List currencies |
| POST | `/admin/settings/currencies` | Create currency |
| PUT | `/admin/settings/currencies/:id` | Update currency |
| DELETE | `/admin/settings/currencies/:id` | Delete currency |
| PATCH | `/admin/settings/currencies/:id/toggle` | Toggle currency |
| PATCH | `/admin/settings/currencies/symbol/:symbol/toggle` | Toggle currency by symbol |
| GET | `/admin/settings/quote-assets` | Quote assets (trading) |
| POST | `/admin/settings/quote-assets` | Create quote asset |
| PUT | `/admin/settings/quote-assets/:id` | Update quote asset |
| DELETE | `/admin/settings/quote-assets/:id` | Delete quote asset |
| GET | `/admin/settings/trading-pairs` | Trading pairs list |
| POST | `/admin/settings/trading-pairs` | Create trading pair |
| POST | `/admin/settings/trading-pairs/bulk` | Bulk create trading pairs |
| PUT | `/admin/settings/trading-pairs/:id` | Update trading pair |
| PATCH | `/admin/settings/trading-pairs/:id/toggle` | Toggle trading pair |
| DELETE | `/admin/settings/trading-pairs/:id` | Delete trading pair |
| GET | `/admin/settings/available-base-currencies` | Available base currencies for pair |
| GET | `/admin/settings/p2p-assets` | P2P assets list |
| POST | `/admin/settings/p2p-assets` | Create P2P asset |
| PUT | `/admin/settings/p2p-assets/:id` | Update P2P asset |
| PATCH | `/admin/settings/p2p-assets/:id/toggle` | Toggle P2P asset |
| DELETE | `/admin/settings/p2p-assets/:id` | Delete P2P asset |
| GET | `/admin/settings/available-p2p-currencies` | Available P2P currencies |
| GET | `/admin/settings/features` | Feature flags list |
| POST | `/admin/settings/features` | Create feature |
| POST | `/admin/settings/features/bulk` | Bulk create features |
| PATCH | `/admin/settings/features/:id/toggle` | Toggle feature |
| PATCH | `/admin/settings/features/bulk-toggle` | Bulk toggle features |
| PATCH | `/admin/settings/features/category/:category/toggle` | Toggle by category |
| PUT | `/admin/settings/features/:id` | Update feature |
| DELETE | `/admin/settings/features/:id` | Delete feature |
| GET | `/admin/settings/api` | API settings (by category) |
| POST | `/admin/settings/api` | Create API setting |
| PUT | `/admin/settings/api/:id` | Update API setting |
| PATCH | `/admin/settings/api/:id/toggle` | Toggle API setting |
| DELETE | `/admin/settings/api/:id` | Delete API setting |
| POST | `/admin/settings/api/:id/test` | Test API setting |

---

## 1.8 Upload – `/api/v1/upload`

| Method | Path | Description |
|--------|------|-------------|
| POST | `/upload/logo/blockchain/:blockchainId` | Upload blockchain logo |
| POST | `/upload/logo/currency/:currencyId` | Upload currency logo |
| POST | `/upload/logo/:type` | Generic logo upload |

---

## 1.9 Convert – `/api/v1/convert`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/convert/market-prices` | Market prices for convert |
| GET | `/convert/currencies` | Currencies for convert |
| GET | `/convert/quote` | Get quote (from, to, amount, accountType) |
| POST | `/convert/instant` | Execute instant conversion (user_balances) |
| POST | `/convert/limit` | Create limit conversion order |
| POST | `/convert/limit/:orderId/cancel` | Cancel limit order |
| GET | `/convert/orders/active` | Active limit orders |
| GET | `/convert/history` | Conversion history |
| GET | `/convert/balances` | Balances for convert (uses user_balances; references total_balance) |

---

## 1.10 KYC – `/api/v1/kyc`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/kyc/status` | KYC status (user) |
| POST | `/kyc/initiate` | Start KYC |
| POST | `/kyc/upload-document` | Upload KYC document |
| POST | `/kyc/admin/review/:applicationId` | Admin review KYC |

---

## 1.11 Backend services (non-route)

| Service | Purpose |
|---------|---------|
| `auth.service.ts` | User creation, wallet creation on signup, session handling |
| `otp.service.ts` | OTP send/verify, rate limiting |
| `wallet.service.ts` | Wallets (create, get), balances (getBalances, getBalance), lockBalance (user_balances), unlockBalance (balances), creditBalance (balances), debitLockedBalance (balances) |
| `withdrawal-approval.service.ts` | Withdrawal approve/reject; reject releases lock in user_balances |
| `withdrawal-signing.service.ts` | Enqueue, sign, broadcast; complete/fail update user_balances |
| `hot-wallet.service.ts` | Hot wallet provisioning, signer, balance cache, caps |
| `hot-wallet-sweep.service.ts` | Sweep hot wallet to cold |
| `deposit-sweep.service.ts` | Deposit sweep eligibility and run |
| `matching-engine.service.ts` | Order matching; uses walletService lock/unlock/credit/debitLocked (balances table) |
| `p2p.service.ts` | P2P ads, orders; uses walletService lock/unlock/credit/debitLocked (balances table) |
| `multi-chain-address.ts` | Multi-chain address derivation |

---

# PART 2: ADMIN UI

Base path: `/admin`. All under `(protected)` except login and error.

---

## 2.1 Admin auth & layout

| Path | Description |
|------|-------------|
| `/admin` | Admin landing |
| `/admin/login` | Admin login |
| `/admin/error` | Admin error page |
| `/admin/(protected)/layout` | Protected layout (sidebar, session) |

---

## 2.2 Dashboard

| Path | Description |
|------|-------------|
| `/admin/dashboard` | Admin dashboard (stats) |

---

## 2.3 User management

| Path | Description |
|------|-------------|
| `/admin/users` | All users list |
| `/admin/users/[id]` | User detail (overview, balances tab) |
| `/admin/users/tiers` | User tiers |
| `/admin/users/verification` | Verification queue |
| `/admin/users/suspended` | Suspended users |
| `/admin/users/banned` | Banned users |

---

## 2.4 KYC

| Path | Description |
|------|-------------|
| `/admin/kyc` | KYC dashboard |
| `/admin/kyc/pending` | Pending KYC |
| `/admin/kyc/review` | Under review |
| `/admin/kyc/approved` | Approved KYC |
| `/admin/kyc/rejected` | Rejected KYC |
| `/admin/kyc/settings` | KYC settings |

---

## 2.5 Wallets

| Path | Description |
|------|-------------|
| `/admin/wallets` | Wallets overview |
| `/admin/wallets/funds-summary` | Funds summary (ledger vs on-chain) |
| `/admin/wallets/deposit-sweeps` | Deposit sweeps (eligibility, run) |
| `/admin/wallets/hot` | Hot wallets list |
| `/admin/wallets/hot/[chainId]` | Hot wallet detail by chain |
| `/admin/wallets/cold` | Cold wallets |
| `/admin/wallets/currencies` | Currencies config |
| `/admin/wallets/blockchain` | Blockchain status |

---

## 2.6 Deposits

| Path | Description |
|------|-------------|
| `/admin/deposits` | All deposits |
| `/admin/deposits/pending` | Pending deposits |
| `/admin/deposits/flagged` | Flagged deposits |
| `/admin/deposits/reports` | Deposit reports |

---

## 2.7 Withdrawals

| Path | Description |
|------|-------------|
| `/admin/withdrawals` | All withdrawals |
| `/admin/withdrawals/pending` | Pending (approve/reject) |
| `/admin/withdrawals/processing` | Processing |
| `/admin/withdrawals/completed` | Completed |
| `/admin/withdrawals/failed` | Failed |
| `/admin/withdrawals/settings` | Withdrawal settings |

---

## 2.8 Trading (admin)

| Path | Description |
|------|-------------|
| `/admin/trading` | Trading overview (if exists as page) |
| `/admin/trading/pairs` | Trading pairs |
| `/admin/trading/orderbook` | Order book |
| `/admin/trading/orders` | Active orders |
| `/admin/trading/order-history` | Order history |
| `/admin/trading/trade-history` | Trade history |
| `/admin/trading/fees` | Fee config |

---

## 2.9 P2P (admin)

| Path | Description |
|------|-------------|
| `/admin/p2p` | P2P overview |
| `/admin/p2p/ads` | Advertisements |
| `/admin/p2p/orders` | Orders |
| `/admin/p2p/disputes` | Disputes |
| `/admin/p2p/merchants` | Merchants |
| `/admin/p2p/payment-methods` | Payment methods |
| `/admin/p2p/settings` | P2P settings |

---

## 2.10 Referrals (admin)

| Path | Description |
|------|-------------|
| `/admin/referrals` | Referrals overview |
| `/admin/referrals/codes` | Referral codes |
| `/admin/referrals/relationships` | Relationships |
| `/admin/referrals/commissions` | Commissions |
| `/admin/referrals/campaigns` | Campaigns |

---

## 2.11 Fees (admin)

| Path | Description |
|------|-------------|
| `/admin/fees` | Fee management overview |
| `/admin/fees/trading` | Trading fees |
| `/admin/fees/withdrawal` | Withdrawal fees |
| `/admin/fees/tiers` | Fee tiers |
| `/admin/fees/promotions` | Promotions |

---

## 2.12 Notifications (admin)

| Path | Description |
|------|-------------|
| `/admin/notifications` | Notifications overview |
| `/admin/notifications/announcements` | Announcements |
| `/admin/notifications/push` | Push notifications |
| `/admin/notifications/email` | Email templates |
| `/admin/notifications/sms` | SMS |

---

## 2.13 Security (admin)

| Path | Description |
|------|-------------|
| `/admin/security` | Security overview |
| `/admin/security/activity` | Activity monitor |
| `/admin/security/ip` | IP management |
| `/admin/security/fraud` | Fraud detection |
| `/admin/security/compliance` | AML/Compliance |
| `/admin/security/audit` | Audit logs |

---

## 2.14 Reports (admin)

| Path | Description |
|------|-------------|
| `/admin/reports` | Reports overview |
| `/admin/reports/financial` | Financial reports |
| `/admin/reports/users` | User reports |
| `/admin/reports/trading` | Trading reports |
| `/admin/reports/p2p` | P2P reports |
| `/admin/reports/custom` | Custom reports |

---

## 2.15 Settings (admin)

| Path | Description |
|------|-------------|
| `/admin/settings` | Settings root (from sidebar: may redirect) |
| `/admin/settings/blockchain` | Blockchain settings |
| `/admin/settings/blockchain/chains` | Chains |
| `/admin/settings/blockchain/currencies` | Currencies |
| `/admin/settings/features` | Feature flags |
| `/admin/settings/maintenance` | Maintenance |
| `/admin/settings/p2p-assets` | P2P assets |
| `/admin/settings/api` | API settings |
| `/admin/settings/trading-pairs` | Trading pairs |

---

## 2.16 Admins & support (admin)

| Path | Description |
|------|-------------|
| `/admin/admins` | List admins |
| `/admin/admins/roles` | Admin roles |
| `/admin/support` | Support overview |
| `/admin/support/my-tickets` | My tickets |
| `/admin/support/responses` | Responses |

---

# PART 3: USER (DASHBOARD) UI

Base path: `/dashboard`. All require user auth.

---

## 3.1 Main & assets

| Path | Description |
|------|-------------|
| `/dashboard` | Dashboard home / overview |
| `/dashboard/assets` | Assets section (may redirect to overview or list) |
| `/dashboard/assets/overview` | Assets overview (summary, funding/trading totals, recent tx) |
| `/dashboard/assets/funding` | Funding account (token list, deposit/withdraw/transfer) |
| `/dashboard/assets/unified` | Unified/Trading account (uses `/wallet/balances/trading`) |
| `/dashboard/assets/convert` | Convert (buy/sell crypto) |
| `/dashboard/assets/history` | Transaction history |
| `/dashboard/assets/pnl` | PnL |

---

## 3.2 Deposit & withdraw

| Path | Description |
|------|-------------|
| `/dashboard/deposit/crypto` | Deposit crypto (tokens, chains, address, history) |
| `/dashboard/withdraw` | Withdraw hub |
| `/dashboard/withdraw/crypto` | Withdraw crypto (tokens, chains, limits, fee, cancel) |

---

## 3.3 Transfer & convert

| Path | Description |
|------|-------------|
| `/dashboard/transfer` | Internal transfer (funding ↔ trading) |
| `/dashboard/convert` | Convert (alternate convert entry; may use same API as assets/convert) |

---

## 3.4 Account & identity

| Path | Description |
|------|-------------|
| `/dashboard/account` | Account info |
| `/dashboard/identity` | Identity verification (KYC) |
| `/dashboard/identity/upload` | KYC document upload |
| `/dashboard/identity/success` | KYC success |

---

## 3.5 Security & preferences

| Path | Description |
|------|-------------|
| `/dashboard/security` | Security overview |
| `/dashboard/security/change-password` | Change password |
| `/dashboard/security/passkeys` | Passkeys management |
| `/dashboard/security/withdrawal-limits` | Withdrawal limits |
| `/dashboard/preferences` | Preference settings |
| `/dashboard/data-export` | Data export |

---

## 3.6 API, fees, referral

| Path | Description |
|------|-------------|
| `/dashboard/api` | API keys / API management |
| `/dashboard/api/create` | Create API key |
| `/dashboard/fee-rates` | My fee rates |
| `/dashboard/referral` | Referral program |
| `/dashboard/referral/my-referrals` | My referrals |

---

## 3.7 Address book

| Path | Description |
|------|-------------|
| `/dashboard/address-book` | Address book |
| `/dashboard/address-book/add-batches` | Add batches (address book) |

---

# PART 4: AUTH / PUBLIC PAGES (USER)

| Path | Description |
|------|-------------|
| `/` | Landing (public) |
| `/login` | User login |
| `/signup` | User signup |
| `/terms` | Terms of service |
| `/privacy` | Privacy policy |
| `/auth/callback/google` | Google OAuth callback |
| `/auth/callback/apple` | Apple OAuth callback |

---

# PART 5: ISSUES IN THE SYSTEM

(Consolidated from balance unification work and codebase audit.)

---

## 5.1 Balance source of truth (backend)

- **wallet.service**  
  - `getBalances` / `getBalance` read only from `balances`.  
  - `unlockBalance`, `creditBalance`, `debitLockedBalance` write only to `balances`.  
  - Only `lockBalance` uses `user_balances`.  
  - **Impact:** Trading (matching-engine) and P2P (p2p.service) credit/debit/unlock go to `balances`; dashboard and withdrawals use `user_balances` → two ledgers, inconsistent balances and “balance 0” when funds exist only in `user_balances`.

- **GET `/wallet/balances`**  
  - Uses `walletService.getBalances()` → returns only `balances`. No `user_balances` fallback.

- **GET `/wallet/balances/trading`**  
  - Raw query on `balances` only. No `user_balances` path.  
  - **Impact:** User “Unified / Trading” page shows 0 when funds exist only in `user_balances`.

- **Convert**  
  - Uses `user_balances.total_balance` in INSERT/UPDATE/SELECT. `full-schema.sql` does not define `total_balance` on `user_balances`.  
  - **Impact:** Runtime error if column missing, or schema/docs out of date.

- **Express trading routes**  
  - If `trading.routes.ts` (Express) is still mounted, its `GET /trading/balances` uses `walletService.getBalances()` → `balances` only. Inconsistent with Fastify `GET /trading/balances` (user_balances).

---

## 5.2 UI / API wiring

- **User dashboard – Unified (Trading) page**  
  - Calls `GET /api/v1/wallet/balances/trading`. That endpoint reads only `balances` → page shows 0 when user has funds only in `user_balances`.

- **User dashboard – Overview / Funding**  
  - Use summary, by-account, funding endpoints that already prefer `user_balances` and have fallbacks; behavior is correct for current design.

- **Admin**  
  - User detail and user balances use `user_balances` only. No fallback to `balances`; legacy credits only in `balances` won’t appear (by design, but support may be confused).

---

## 5.3 Other potential issues

- **Duplicate auth routes**  
  - Passkey (and possibly other auth) may exist in both `auth.fastify.ts` and `passkey.routes.ts`; confirm which is mounted and avoid duplicate paths.

- **Trading routes**  
  - Fastify `trading.fastify.ts` is mounted at `/api/v1/trading`. If Express `trading.routes.ts` is also registered elsewhere, there may be two `/trading/balances` implementations (one user_balances, one balances).

- **Admin sidebar vs routes**  
  - Some sidebar links (e.g. Markets, Trade, Finance) point to `/dashboard/markets`, `/dashboard/trade`, `/dashboard/finance`; confirm these routes exist or are redirected.

- **KYC prefix**  
  - User KYC may be under `/api/v1/kyc` and also under `/api/v1/wallet/kyc-status`; document which is canonical for frontend.

---

**End of inventory.** For balance-specific details and recommended fixes, see `BALANCE-SYSTEM-SUMMARY-AND-ISSUES.md`.
