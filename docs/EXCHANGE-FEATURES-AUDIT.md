# Exchange Platform – Features & System Audit Report

**Project:** Spot + P2P Cryptocurrency Exchange  
**Audit Date:** February 2025  
**Scope:** Sections, Features, Admin, User, Deposit, Withdrawal, Wallet, Blockchain, FIU/IND, Security, Trade, P2P, Matching Engine, Balance

---

## 1. SECTIONS & FEATURES

### User-facing pages & sections

| Section | Routes | Description |
|--------|--------|-------------|
| **Landing** | `/`, `/page` | Public homepage |
| **Auth** | `/login`, `/register` | Login / signup |
| **Admin login** | `/admin/login` | Admin authentication |
| **Spot** | `/dashboard/spot`, `/spot`, `/trade`, `/trade/spot` | Spot trading |
| **P2P** | `/dashboard/p2p`, `/p2p`, `/p2p/[type]/[crypto]/[fiat]`, `/p2p/orders/[orderId]` | P2P marketplace |
| **Dashboard** | `/dashboard` | Main dashboard |
| **Orders** | `/orders`, `/dashboard/orders`, `/orders/spot`, `/orders/p2p` | Spot & P2P orders |
| **Assets** | `/assets`, `/dashboard/assets/*` | Asset and portfolio views |
| **History** | `/history` | Transaction history |
| **Wallet** | `/dashboard/wallet/spot`, `/dashboard/wallet/[symbol]` | Spot and per-asset wallets |
| **Deposit/Withdraw** | `/dashboard/deposit/crypto`, `/dashboard/withdraw/crypto`, `/dashboard/withdraw/fiat` | Deposit/withdraw flows |
| **Markets** | `/dashboard/markets` | Market list |
| **Transfer** | `/dashboard/transfer` | Internal transfer |
| **Account** | `/dashboard/account` | Account info |
| **Identity** | `/dashboard/identity`, `/dashboard/identity/upload` | KYC flow |
| **Security** | `/dashboard/security`, `/dashboard/security/withdrawal-limits` | Security and limits |
| **API** | `/dashboard/api`, `/dashboard/api/create` | API key management |
| **Referral** | `/dashboard/referral`, `/dashboard/referral/my-referrals` | Referral program |
| **Preferences** | `/dashboard/preferences` | User preferences |
| **Data export** | `/dashboard/data-export` | Data export |
| **Fee rates** | `/dashboard/fee-rates` | Fee overview |

### Admin pages & sections

| Section | Routes | Description |
|--------|--------|-------------|
| **Dashboard** | `/admin/dashboard` | Admin overview |
| **Users** | `/admin/users`, `/admin/users/[id]`, `/admin/users/detail`, `/admin/users/risk`, `/admin/users/banned`, `/admin/users/suspended`, `/admin/users/verification`, `/admin/users/tiers` | User management |
| **KYC** | `/admin/kyc/pending`, `/admin/kyc/approved`, `/admin/kyc/rejected`, `/admin/kyc/review`, `/admin/kyc/audit`, `/admin/kyc/settings` | KYC review and audit |
| **Wallets** | `/admin/wallets`, `/admin/wallets/deposits`, `/admin/wallets/withdrawals`, `/admin/wallets/adjust`, `/admin/wallets/funds-summary`, `/admin/wallets/hot`, `/admin/wallets/hot/[chainId]`, `/admin/wallets/cold`, `/admin/wallets/reconciliation`, `/admin/wallets/ledger/balance`, `/admin/wallets/ledger/settlement`, `/admin/wallets/blockchain`, `/admin/wallets/currencies` | Wallet operations |
| **Deposits** | `/admin/deposits/manual-credit` | Manual deposit credits |
| **Spot markets** | `/admin/trading`, `/admin/trading/spot-markets`, `/admin/trading/orders`, `/admin/trading/trade-history`, `/admin/trading/order-history`, `/admin/trading/circuit-breakers`, `/admin/trading/fees`, `/admin/trading/market-control`, `/admin/trading/orderbook`, `/admin/trading/pairs` | Spot trading controls |
| **P2P** | `/admin/p2p`, `/admin/p2p/trades`, `/admin/p2p/orders`, `/admin/p2p/ads`, `/admin/p2p/escrows`, `/admin/p2p/disputes`, `/admin/p2p/disputes/[id]`, `/admin/p2p/merchants`, `/admin/p2p/payment-methods`, `/admin/p2p/settings` | P2P controls |
| **Compliance** | `/admin/compliance/alerts`, `/admin/compliance/alerts/[id]`, `/admin/compliance/alert`, `/admin/compliance/reports`, `/admin/compliance/reports/[id]`, `/admin/compliance/cases` | AML / compliance |
| **Security** | `/admin/security/compliance`, `/admin/security/fraud`, `/admin/security/audit`, `/admin/security/audit-logs`, `/admin/security/sessions`, `/admin/security/ip`, `/admin/security/activity` | Security and audit |
| **System** | `/admin/settings`, `/admin/settings/maintenance`, `/admin/settings/api`, `/admin/settings/blockchain`, `/admin/settings/blockchain/chains`, `/admin/settings/blockchain/currencies`, `/admin/settings/trading-pairs`, `/admin/settings/p2p-assets`, `/admin/settings/features`, `/admin/system/api-settings`, `/admin/system-health`, `/admin/monitoring/counters` | Settings and health |
| **Finance** | `/admin/referrals/commissions` | Referrals and commissions |
| **Support** | `/admin/support/my-tickets`, `/admin/support/responses` | Support tickets |
| **Reports** | `/admin/reports`, `/admin/reports/users`, `/admin/reports/trading`, `/admin/reports/financial`, `/admin/reports/p2p`, `/admin/reports/custom` | Reporting |
| **Admins** | `/admin/admins/roles` | Admin roles and permissions |

---

## 2. USER FEATURES

### Authentication
- **Email/password** – Login, signup, logout
- **OTP** – Email and phone OTP (send/verify, password reset, 2FA)
- **Passkeys** – Registration, auth, list, delete (`@simplewebauthn/server`)
- **OAuth** – Google, Apple, Telegram (`auth.oauth.js`)
- **2FA/TOTP** – Setup, enable, verify, disable
- **Fund password** – Status, set, check
- **SMS auth** – Toggle and status
- **Sessions** – Logout, logout-all, logout-all-other

### Account & profile
- Profile (email, phone, username, status, tier)
- Change password, email, phone
- Withdrawal limits (daily/monthly, OTP for changes)
- Withdrawal whitelist / address book
- Anti-phishing code
- Preferences
- Data export

### Trading (spot)
- Market, limit, stop-loss orders
- Order history, open orders
- Real-time orderbook and trades via WebSocket
- Lightweight Charts integration
- Trading pairs and price feed

### P2P
- Create buy/sell ads (fixed/floating pricing)
- Browse ads (token, fiat, payment method, country filters)
- Place orders
- Payment method management
- Escrow flows (move to escrow, release, refund)
- Dispute creation and resolution
- Order status lifecycle
- P2P order list and detail pages

### Assets & wallet
- Funding vs trading accounts
- Per-token balances (spot, funding)
- Deposit crypto (per-chain deposit address)
- Withdraw crypto (onchain + internal)
- Internal transfer (funding ↔ trading)
- Convert (instant and limit conversions)
- Balance history
- P&L view
- Markets list

### Orders & history
- Spot orders (open, history)
- P2P orders (my orders)
- History page (trades, deposits, withdrawals)

### KYC / identity
- KYC status
- Document upload (PAN, Aadhaar, national ID, etc.)
- DigiLocker consent (India)
- KYC levels
- Identity verification flow
- Rejection reason display

### Referrals
- Referral program page
- My referrals
- Referral codes and commissions
- Campaign participation

### API
- API key creation
- API key management (list, delete)
- API create page

### Other
- Fee rates display
- MNT discount for fees
- Announcements
- Notifications (read, mark all read)
- Risk status

---

## 3. ADMIN FEATURES

### Dashboard & overview
- Trading halt status
- KYC pending/review/approved/rejected stats
- Withdrawal approval counts
- Open disputes count
- Other core metrics

### User management
- User list (search, status, KYC level filters)
- User detail (profile, balances)
- User risk profile
- User activity / sessions
- Status change (suspend, freeze, activate) with reason
- Banned / suspended / verification / tiers views

### KYC
- Pending verifications
- Approved / rejected lists
- KYC review (approve/reject with reason)
- KYC audit trail
- KYC settings

### Wallet & funds
- Deposits list (filters, pagination)
- Manual credit (user, currency, amount, reason)
- Withdrawals list
- Withdrawal approve / reject
- Manual adjustments
- Funds summary
- Hot wallet monitor (per-chain balances, history)
- Cold wallet monitor
- Reconciliation (Super Admin)
- Balance ledger
- Settlement ledger

### Spot markets
- Market pairs list
- Order monitoring
- Trade history
- Circuit breakers
- Fee controls
- Market halt controls

### P2P
- P2P overview
- Active trades
- Orders / ads
- Escrow monitor
- Escrow freeze / unfreeze
- Disputes (list, detail, resolve)
- Merchants
- Payment methods
- P2P settings

### Compliance / AML
- AML dashboard (open alerts, STR/CTR pending, INR totals)
- AML alerts list (status, severity filters)
- Alert detail
- STR/CTR reports (submit, acknowledge)
- Case management
- FIU-IND transaction monitoring

### Security
- Audit logs (immutable)
- Active sessions
- IP / device risk rules
- Withdrawal risk monitor
- Risk rules
- Security dashboard

### System
- Settings
- API settings (OTP, notifications)
- Feature flags (bulk toggle)
- Blockchain / token config
- Trading pairs
- P2P assets
- Counters / limits

### Finance & support
- Fee configuration
- Revenue metrics
- Referral campaigns
- Support tickets
- Reports (users, trading, financial, P2P, custom)
- Announcements, email/SMS templates, push broadcast

### Admins
- Roles and permissions
- Admin list
- Admin activity logs

---

## 4. CORE SYSTEMS

### Matching engine
- **Service:** `matching-engine.service.ts`
- In-memory orderbooks (Map per pair)
- Price-time priority
- Order types: limit, market, stop-loss
- Time-in-force: GTC, IOC, FOK
- Load/reconcile from DB on init
- Persist to Redis (orderbook cache)
- Publishes trades to RabbitMQ
- Atomic balance locking
- Circuit breaker per symbol

### Orderbook
- Bids/asks (Map per price level)
- Redis cache via `spot-orderbook-cache.service`
- WebSocket stream for live updates

### Balance management
- `user_balances` (user_id, currency_id, chain_id, account_type)
- Separate funding and trading accounts
- Locked / available / escrow
- Ledger: `balance_ledger`
- Helpers: `user-balance-helper.js`, `readUserBalances.js`
- Atomic operations with `FOR UPDATE`

### Settlement
- **Worker:** `settlement-worker.ts` (1s interval)
- Processes `settlement_events` from RabbitMQ
- One DB transaction per event
- Ledger-first invariant
- Atomic balance updates for maker/taker
- Uses `engine_event_id` for idempotency
- Circuit breaker for violations

### Match poller & integration
- `match-poller.ts` reads matches from RabbitMQ
- Pushes into settlement pipeline

---

## 5. BLOCKCHAIN & WALLET

### Supported chains (indexer)
- **EVM:** Ethereum, BSC, Polygon, Base, Arbitrum
- **Non-EVM:** Solana, Tron, Bitcoin, Polkadot (multi-chain address derivation)

### Deposit flow
1. User requests address (per chain/token)
2. KYC check (required)
3. Address derivation via `wallet.service` + `multi-chain-address.ts`
4. Indexer listens for incoming txs
5. `ConfirmationTracker` (indexer) tracks confirmations
6. `deposit-credit.service` credits when confirmed
7. `aml-transaction-monitor.service` records and evaluates AML rules

### Withdrawal flow
1. Validation (KYC, limits, whitelist, risk)
2. Lock balance in one transaction
3. Idempotency (request hash + Redis lock)
4. Admin approval above threshold
5. `withdrawal-signing.service` signs and broadcasts
6. Rate-limited per chain (2s between signings)

### Address generation
- HD derivation (BIP32/BIP44)
- EVM: ethers.js
- Solana: Keypair.fromSeed
- Bitcoin: BIP84 (bech32)
- Tron: TronWeb
- Polkadot: Keyring sr25519
- Master seed stored encrypted (KMS/HSM ready)

### Confirmation tracking
- `ConfirmationTracker` (indexer) polls every 30s
- Updates `confirmations` on pending deposits
- Triggers credit when `confirmations >= required_confirmations`

### Indexer
- Watches deposits for user deposit addresses
- Block-based polling
- Confirmation tracking
- Calls backend for credit

---

## 6. P2P

### Ads
- Create buy/sell ads
- Fixed/floating pricing
- Min/max/total amount
- Payment methods
- Countries
- Auto-reply, remarks
- Merchant stats

### Escrow
- `p2p-escrow.service` – move to escrow, release, refund
- `assertP2PEscrowCapInTransaction`, `assertP2POrderVelocityInTransaction`
- Admin freeze / unfreeze
- RabbitMQ for escrow events

### Payment methods
- User P2P payment methods
- Admin-managed global payment method types
- Bank transfer, UPI, etc.
- Per-user active/inactive

### Order flow
1. Create order (buyer selects ad, quantity, payment method)
2. Funds moved to escrow
3. Buyer marks "paid"
4. Seller confirms payment
5. Release from escrow
6. Or refund/cancel/dispute

### Release / refund
- Release: move from escrow to buyer funding
- Refund: move from escrow back to seller
- Admin can freeze/unfreeze escrow

### Disputes
- Create dispute on order
- Admin resolve (with notes)
- Resolution: release_to_buyer, release_to_seller, partial_split

---

## 7. SECURITY

### Auth
- JWT (access + refresh)
- Fastify `authenticate` decorator
- Session validation (Redis)
- Separate user vs admin tokens

### Rate limiting
- Global: 100 req/min (Fastify rate-limit)
- Auth: `rateLimiters.auth`
- OTP: `rateLimiters.otp`
- Spot order: 30/min per user
- Spot cancel: 60/min per user
- P2P order create: 30/min
- P2P confirm/release/cancel: 60/min
- Admin: 60/min per admin
- IP-based DDoS limit (1000 in Express index)

### CORS
- Configurable origins
- Dev: localhost/127.0.0.1 any port
- Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD
- Credentials enabled
- Headers: Content-Type, Authorization, X-Requested-With, etc.

### Validation
- Express-validator on auth
- Zod on config
- Body schemas on Fastify routes

### Lockout
- `MAX_FAILED_LOGIN_ATTEMPTS` (default 5)
- `LOCKOUT_MINUTES` (default 30)
- `authLockPlugin` for lockout

### IP rules
- IP whitelist/blacklist
- Country rules
- Admin IP whitelist (`ADMIN_IP_WHITELIST`)
- VPN/Tor check (fail-open)
- Blocks logged to `audit_logs_immutable` and `user_activity_logs`

### Encryption
- AES-256 for sensitive data
- KMS: local or AWS
- HSM support
- Master seed encrypted at rest

### Audit
- `audit_logs_immutable` (append-only, no update/delete)
- `audit_logs` (withdrawal lifecycle)
- `hot_wallet_audit_log` (hot wallet ops)
- `logAudit`, `logAuditFromRequest`, `logAdminActivity`

---

## 8. FIU / IND COMPLIANCE

### India-specific

| Component | Status | Notes |
|----------|--------|------|
| **PAN** | ✅ Implemented | `kyc_applications` (pan_number, pan_name, pan_verified); types include `pan` |
| **Aadhaar** | ✅ Implemented | Types: `aadhaar_front`, `aadhaar_back`; `aadhaar_number_hash`, `aadhaar_verified` |
| **KYC levels** | ✅ Implemented | `kyc_level`, tier-based logic |
| **Withdrawal limits** | ✅ Implemented | `daily_withdrawal_limit`, `monthly_withdrawal_limit` per user |
| **AML thresholds** | ✅ Implemented | `AML_LARGE_FIAT_INR_THRESHOLD` (default 1M INR), `large_fiat_txn` alerts |
| **STR/CTR** | ✅ Implemented | `aml_str_ctr_logs`, escalate to STR, CTR submission/acknowledgment |
| **FIU-IND** | ⚠️ Partial | Compliance page mentions FIU-IND; no explicit FIU registration/reporting flow |
| **PMLA** | ⚠️ Partial | AML monitoring and alerting; no explicit PMLA citations |
| **RBI** | ⚠️ Partial | Implied via KYC/AML; no direct RBI integration |

### AML rules (`aml-transaction-monitor.service`)
- Large fiat (INR threshold)
- Large crypto withdrawal
- Velocity (multiple withdrawals in window)
- High-risk countries
- KYC violation

### Reporting
- STR/CTR submission and acknowledgment
- Pending STR/CTR counts on AML dashboard
- Transaction logs in `aml_transaction_logs`
- Alerts in `aml_alerts`

### Gaps
- No explicit FIU-IND registration or dedicated reporting flow
- No RBI-specific controls or reporting
- No PMLA-specific procedural documentation in code

---

## 9. GAPS & RECOMMENDATIONS

### Critical gaps

1. **Audit trail**
   - Manual credit not consistently written to `audit_logs_immutable`
   - User status change reason not stored in immutable audit
   - KYC approve/reject not consistently logged to `audit_logs_immutable`
   - Escrow freeze/unfreeze audit path unclear

2. **Schema consistency**
   - Some code uses `kyc_applications`, migrate may create `kyc_records`; potential table mismatch

3. **OTP delivery**
   - SMTP/SMS timeouts added; still worth monitoring for slow providers

### Important gaps

4. **Admin sidebar vs routes**
   - Sidebar links may not match all actual route paths

5. **Support / reports**
   - Support tickets and custom reports may have limited or placeholder implementations

6. **Feature flags**
   - Feature toggle pages may not fully map to backend feature flags

### Recommendations

1. **Audit trail:** All high-impact admin actions (manual credit, user status, KYC, escrow) should write to `audit_logs_immutable` with actor, resource, reason, and timestamp.
2. **Status reasons:** Store user status change reasons in DB or immutable audit payload.
3. **KYC schema:** Unify `kyc_applications` vs `kyc_records` across migrations and code.
4. **Admin links:** Validate all admin sidebar links and route mappings.
5. **FIU-IND / PMLA / RBI:** Add explicit procedures, thresholds, and reporting flows for India compliance.
6. **Rate limits:** Review and tighten per-route rate limits for auth, trading, and P2P.
7. **API base:** Ensure withdrawal and deposit address flows use the same API base (e.g. `getApiBaseUrl()`).
8. **Monitoring:** Add monitoring and alerting for settlement worker, deposit credit, and withdrawal signing.

---

## 10. File reference

| Purpose | Path |
|---------|------|
| Backend entry (Fastify) | `apps/backend/src/server.ts` |
| Matching engine | `apps/backend/src/services/matching-engine.service.ts` |
| Settlement worker | `apps/backend/src/workers/settlement-worker.ts` |
| Spot routes | `apps/backend/src/routes/spot.fastify.ts` |
| P2P routes | `apps/backend/src/routes/p2p.fastify.ts` |
| Wallet service | `apps/backend/src/services/wallet.service.ts` |
| Deposit credit | `apps/backend/src/services/deposit-credit.service.ts` |
| Withdrawal signing | `apps/backend/src/services/withdrawal-signing.service.ts` |
| P2P escrow | `apps/backend/src/services/p2p-escrow.service.ts` |
| AML monitor | `apps/backend/src/services/aml-transaction-monitor.service.ts` |
| Auth (Fastify) | `apps/backend/src/routes/auth.fastify.ts` |
| Config (Zod) | `apps/backend/src/config/index.ts` |
