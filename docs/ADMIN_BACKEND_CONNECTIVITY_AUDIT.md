# Admin Panel Backend Connectivity Audit Report

> Comprehensive audit of admin panel connections to backend operational modules.  
> Generated: 2025-02-27

---

## Executive Summary

The admin panel is **substantially connected** to backend operational systems. Most critical modules (spot trading, deposits/withdrawals, P2P, compliance, analytics, system config) have admin APIs and UI pages. Gaps exist for **deposit indexer** (separate app), **price oracle** (no admin control UI), **sanctions screening** (no dedicated admin UI), **geo-blocking** (config-only), and **VPN/TOR service** (no admin visibility).

---

## STEP 1 — Backend Operational Modules

| # | Backend Module | Location | Admin-visible? |
|---|----------------|----------|----------------|
| 1 | Spot trading engine | `spot.fastify`, Rust engine | Via settlement/order APIs |
| 2 | Order matching | `spot-matching.service`, Rust engine | Via spot trades, orders |
| 3 | Orderbook cache | `spot-orderbook-cache.service` | ✅ `/admin/analytics/orderbook-intelligence` |
| 4 | Settlement worker | `settlement-worker.ts` | ✅ `/admin/settlement`, circuit-reset |
| 5 | Match poller | `match-poller.ts` | Via settlement events |
| 6 | Deposit indexer | `apps/indexer` (separate) | ❌ No admin API |
| 7 | Deposit credit service | `deposit-credit.service` | Via deposits list, manual-credit |
| 8 | Deposit sweep | `deposit-sweep.service` | ✅ `/admin/deposit-sweeps`, `/admin/wallets/operations` |
| 9 | Withdrawal signing | `withdrawal-signing.service` | Via withdrawal approve flow |
| 10 | Hot wallet service | `hot-wallet.service` | ✅ `/admin/hot-wallets`, funds/summary |
| 11 | P2P trading | `p2p.service` | ✅ `/admin/p2p/*` |
| 12 | P2P escrow | `p2p-escrow.service` | ✅ `/admin/escrows` |
| 13 | Merchant stats | `p2p.service` (p2p_merchant_stats) | Via P2P orders/ads |
| 14 | AML monitoring | `aml-transaction-monitor.service` | ✅ `/admin/aml/dashboard`, compliance |
| 15 | Sanctions screening | `sanctions-screening.service` | ⚠️ Pre-withdrawal only; no admin UI |
| 16 | Rate limiting | `rate-limit-fastify.ts`, `rateLimiter.ts` | ✅ `/admin/operational/rate-limits` |
| 17 | Geo blocking | `geo-block.middleware` | Config only (env); no admin toggle |
| 18 | Price oracle | `price-oracle.service` | ❌ No admin control |
| 19 | Liquidity bot | `liquidity-bot.service` | ✅ `/admin/liquidity-bot/config`, market-making |
| 20 | Analytics services | `admin-analytics.fastify` | ✅ `/admin/analytics` |

---

## STEP 2 — Admin APIs (by System)

### Exchange Control
| Endpoint | Method | Route File |
|----------|--------|------------|
| `/admin/trading-halt` | GET | admin.fastify |
| `/admin/trading-halt` | POST | admin.fastify |
| `/admin/settlement/events` | GET | admin.fastify |
| `/admin/settlement/events/:id` | GET | admin.fastify |
| `/admin/settlement/circuit-reset` | POST | admin.fastify |
| `/admin/settlement/balance-reconcile` | POST | admin.fastify |
| `/admin/settlement/ledger-discrepancy` | GET | admin.fastify |
| `/admin/monitoring/counters` | GET | admin.fastify |
| `/admin/monitoring/mm-risk` | GET | admin.fastify |
| `/admin/liquidity-bot/config` | GET | admin.fastify |
| `/admin/control/overview` | GET | admin-control.fastify |
| `/admin/control/settlement/stats` | GET | admin-control.fastify |

### Wallet Operations
| Endpoint | Method | Route File |
|----------|--------|------------|
| `/admin/wallets` | GET | admin.fastify |
| `/admin/funds/summary` | GET | admin.fastify |
| `/admin/deposits` | GET | admin.fastify |
| `/admin/deposits/manual-credit` | POST | admin.fastify |
| `/admin/deposit-sweeps` | GET | admin.fastify |
| `/admin/deposit-sweeps/eligibility` | GET | admin.fastify |
| `/admin/deposit-sweeps/run` | POST | admin.fastify |
| `/admin/hot-wallets` | GET | admin.fastify |
| `/admin/withdrawals` | GET | admin.fastify |
| `/admin/withdrawals/:id/approve` | POST | admin.fastify |
| `/admin/withdrawals/:id/reject` | POST | admin.fastify |
| `/admin/withdrawals/reports` | GET | admin.fastify |
| `/admin/operational/wallet-status` | GET | admin-operational.fastify |
| `/admin/operational/wallet-status` | PATCH | admin-operational.fastify |

### Market Management
| Endpoint | Method | Route File |
|----------|--------|------------|
| `/admin/spot/markets` | GET | admin-spot.fastify |
| `/admin/spot/markets/:symbol` | GET, PATCH | admin-spot.fastify |
| `/admin/spot/markets/:symbol/symbol-circuit` | POST | admin-spot.fastify |
| `/admin/spot/markets/:symbol/circuit-reset` | POST | admin-spot.fastify |
| `/admin/spot/orders` | GET | admin-spot.fastify |
| `/admin/spot/trades` | GET | admin-spot.fastify |
| `/admin/settings/trading-pairs` | GET, POST, PUT, PATCH, DELETE | admin.fastify |
| `/admin/settings/quote-assets` | GET, POST, PUT, DELETE | admin.fastify |

### P2P Management
| Endpoint | Method | Route File |
|----------|--------|------------|
| `/admin/p2p` | GET | admin.fastify |
| `/admin/p2p/ads` | GET | admin.fastify |
| `/admin/p2p/orders` | GET | admin.fastify |
| `/admin/p2p/disputes` | GET | admin.fastify |
| `/admin/p2p/disputes/:id/resolve` | PATCH | admin.fastify |
| `/admin/escrows` | GET | admin.fastify |
| `/admin/escrows/:id` | GET | admin.fastify |
| `/admin/escrows/:id/freeze` | POST | admin.fastify |
| `/admin/escrows/:id/unfreeze` | POST | admin.fastify |
| `/admin/settings/p2p-assets` | GET, POST, PUT, PATCH, DELETE | admin.fastify |

### Compliance
| Endpoint | Method | Route File |
|----------|--------|------------|
| `/admin/aml/config` | GET | admin-aml.fastify |
| `/admin/aml/dashboard` | GET | admin-aml.fastify |
| `/admin/kyc` | GET | admin.fastify |
| `/admin/kyc/pending` | GET | admin.fastify |
| `/admin/kyc/:id/review` | PATCH | admin.fastify |

### Risk Monitoring
| Endpoint | Method | Route File |
|----------|--------|------------|
| `/admin/security/dashboard` | GET | admin-security.fastify |
| `/admin/security/withdrawals` | GET, POST (pending, approve, reject) | admin-security.fastify |
| `/admin/analytics/risk-intelligence` | GET | admin-analytics.fastify |
| `/admin/analytics/user-risk` | GET | admin-analytics.fastify |

### Analytics
| Endpoint | Method | Route File |
|----------|--------|------------|
| `/admin/dashboard/stats` | GET | admin.fastify |
| `/admin/analytics/trading-volume` | GET | admin-analytics |
| `/admin/analytics/user-growth` | GET | admin-analytics |
| `/admin/analytics/revenue` | GET | admin-analytics |
| `/admin/analytics/deposits` | GET | admin-analytics |
| `/admin/analytics/withdrawals` | GET | admin-analytics |
| `/admin/analytics/p2p-volume` | GET | admin-analytics |
| `/admin/analytics/aml-alerts` | GET | admin-analytics |
| `/admin/analytics/security-events` | GET | admin-analytics |
| `/admin/analytics/order-distribution` | GET | admin-analytics |
| `/admin/analytics/orderbook-intelligence` | GET | admin-analytics |
| `/admin/analytics/liquidity` | GET | admin-analytics |
| `/admin/analytics/revenue-breakdown` | GET | admin-analytics |
| `/admin/analytics/api-metrics` | GET | admin-analytics |
| `/admin/analytics/risk-intelligence` | GET | admin-analytics |
| `/admin/analytics/all` | GET | admin-analytics |

### Automation
| Endpoint | Method | Route File |
|----------|--------|------------|
| `/admin/operations/automation/rules` | GET, POST | admin-operations.fastify |
| `/admin/operations/automation/executions` | GET | admin-operations.fastify |
| `/admin/operations/trader-intelligence` | GET | admin-operations.fastify |
| `/admin/operations/liquidity-stability` | GET | admin-operations.fastify |
| `/admin/operations/whale-activity` | GET | admin-operations.fastify |
| `/admin/operations/incidents` | GET | admin-operations.fastify |
| `/admin/operations/smart-alerts` | GET | admin-operations.fastify |
| `/admin/operations/proof-of-reserves` | GET | admin-operations.fastify |
| `/admin/operations/system-reliability` | GET | admin-operations.fastify |
| `/admin/operations/forensics` | GET | admin-operations.fastify |
| `/admin/operations/playbooks` | GET | admin-operations.fastify |

### System Configuration
| Endpoint | Method | Route File |
|----------|--------|------------|
| `/admin/settings` | GET, PATCH | admin.fastify |
| `/admin/settings/blockchains` | GET, POST, PUT, DELETE, PATCH toggle | admin.fastify |
| `/admin/settings/currencies` | GET, POST, PUT, DELETE, PATCH toggle | admin.fastify |
| `/admin/settings/quote-assets` | GET, POST, PUT, DELETE | admin.fastify |
| `/admin/settings/trading-pairs` | GET, POST, PUT, PATCH, DELETE, bulk | admin.fastify |
| `/admin/settings/p2p-assets` | GET, POST, PUT, PATCH, DELETE | admin.fastify |
| `/admin/settings/features` | GET, POST, PATCH, DELETE, bulk, toggle | admin.fastify |

### Integrations
| Endpoint | Method | Route File |
|----------|--------|------------|
| `/admin/notifications/*` | CRUD | admin.fastify |
| `/admin/settings/api` | GET, POST, PUT, etc. | admin.fastify |
| Fees, referrals, tokens | Various | admin.fastify |

### Backup and Recovery
| Endpoint | Method | Route File |
|----------|--------|------------|
| `/admin/operational/backups` | GET | admin-operational.fastify |
| `/admin/operational/backups/create` | POST | admin-operational.fastify |
| `/admin/operational/backups/:id/restore` | POST | admin-operational.fastify |

### Rate Limit Monitoring
| Endpoint | Method | Route File |
|----------|--------|------------|
| `/admin/operational/rate-limits` | GET | admin-operational.fastify |

---

## STEP 3 — Admin Frontend Pages

| Path | Purpose |
|------|---------|
| `/admin` | Landing / redirect |
| `/admin/dashboard` | Dashboard |
| `/admin/analytics` | Analytics hub |
| `/admin/login` | Admin login |
| **Users** | |
| `/admin/users` | User list |
| `/admin/users/detail` | User detail |
| `/admin/users/risk` | User risk |
| `/admin/users/[id]` | User detail by ID |
| `/admin/users/verification` | Verification |
| `/admin/users/tiers` | User tiers |
| `/admin/users/suspended` | Suspended users |
| **KYC** | |
| `/admin/kyc` | KYC overview |
| `/admin/kyc/pending` | Pending KYC |
| `/admin/kyc/approved` | Approved KYC |
| `/admin/kyc/rejected` | Rejected KYC |
| `/admin/kyc/audit` | KYC audit |
| `/admin/kyc/review` | KYC review |
| `/admin/kyc/settings` | KYC settings |
| **Wallet & Funds** | |
| `/admin/wallets` | Wallets overview |
| `/admin/wallets/operations` | **Wallet Operations** (pause deposits/withdrawals, sweep, hot/cold) |
| `/admin/wallets/deposits` | Deposits list |
| `/admin/wallets/deposits/manual-credit` | Manual credit |
| `/admin/wallets/withdrawals` | Withdrawals list |
| `/admin/wallets/funds-summary` | Funds summary |
| `/admin/wallets/hot` | Hot wallets |
| `/admin/wallets/hot/[chainId]` | Hot wallet detail |
| `/admin/wallets/deposit-sweeps` | Deposit sweeps |
| `/admin/wallets/reconciliation` | Reconciliation |
| `/admin/wallets/ledger/balance` | Balance ledger |
| `/admin/wallets/ledger/settlement` | Settlement ledger |
| `/admin/wallets/adjust` | Manual adjustments |
| `/admin/wallets/blockchain` | Blockchain config |
| `/admin/wallets/currencies` | Currencies |
| **Markets & Trading** | |
| `/admin/markets` | **Market Management** (trading pairs, fees, pause) |
| `/admin/trading` | Trading overview |
| `/admin/trading/spot-markets` | Spot markets |
| `/admin/trading/orders` | Order monitoring |
| `/admin/trading/trade-history` | Trade history |
| `/admin/trading/fees` | Fee controls |
| `/admin/trading/circuit-breakers` | Circuit breakers |
| `/admin/trading/market-control` | Market halt controls |
| `/admin/trading/orderbook` | Orderbook view |
| `/admin/trading/pairs` | Trading pairs |
| **P2P** | |
| `/admin/p2p` | P2P overview |
| `/admin/p2p/orders` | P2P orders |
| `/admin/p2p/escrows` | Escrow monitor |
| `/admin/p2p/disputes` | Disputes |
| `/admin/p2p/disputes/[id]` | Dispute detail |
| `/admin/p2p/trades` | P2P trades |
| `/admin/p2p/settings` | P2P settings |
| `/admin/p2p/ads` | P2P ads |
| **Compliance** | |
| `/admin/compliance/alerts` | AML alerts |
| `/admin/compliance/alerts/[id]` | Alert detail |
| `/admin/compliance/reports` | STR/CTR reports |
| `/admin/compliance/reports/[id]` | Report detail |
| `/admin/compliance/cases` | Case management |
| **Security** | |
| `/admin/security/dashboard` | Security dashboard |
| `/admin/security/audit-logs` | Audit logs |
| `/admin/security/sessions` | Active sessions |
| `/admin/security/ip-rules` | IP risk rules |
| `/admin/security/withdrawals` | Withdrawal risk |
| `/admin/security/risk-rules` | Risk rules |
| `/admin/security/compliance` | AML dashboard |
| `/admin/security/ip` | IP config |
| `/admin/security/activity` | Activity log |
| `/admin/security/fraud` | Fraud |
| `/admin/rate-limits` | **Rate Limit Monitoring** |
| **Exchange Control** | |
| `/admin/control-center` | Control center |
| `/admin/automation` | Automation engine |
| `/admin/smart-alerts` | Smart alerts |
| `/admin/incidents` | Incidents |
| `/admin/orderbook-intelligence` | Orderbook intelligence |
| `/admin/liquidity-stability` | Liquidity stability |
| `/admin/user-risk` | User risk intelligence |
| `/admin/trader-intelligence` | Trader intelligence |
| `/admin/whale-activity` | Whale activity |
| `/admin/liquidity` | Liquidity monitoring |
| `/admin/revenue` | Revenue intelligence |
| `/admin/api-monitoring` | API monitoring |
| **System** | |
| `/admin/system-config` | **System Configuration** (maintenance, spot, P2P, liquidity bot, withdrawal limits) |
| `/admin/settings` | System settings |
| `/admin/settings/operations` | Operations control |
| `/admin/settings/features` | Feature flags |
| `/admin/settings/blockchain` | Blockchain config |
| `/admin/settings/blockchain/chains` | Chains |
| `/admin/settings/blockchain/currencies` | Currencies |
| `/admin/settings/blockchain/tokens` | Tokens |
| `/admin/settings/trading-pairs` | Trading pairs |
| `/admin/settings/p2p-assets` | P2P assets |
| `/admin/system/api-settings` | API settings |
| `/admin/system-health` | Observability |
| `/admin/backups` | **Backup & Recovery** |
| `/admin/integrations` | Integrations |
| `/admin/monitoring/counters` | Counters |
| **Fees & Finance** | |
| `/admin/fees` | Fee overview |
| `/admin/fees/trading` | Trading fees |
| `/admin/fees/withdrawal` | Withdrawal fees |
| `/admin/fees/promotions` | Fee promotions |
| **Deposits / Withdrawals** | |
| `/admin/deposits` | Deposits list |
| `/admin/deposits/pending` | Pending deposits |
| `/admin/deposits/completed` | Completed |
| `/admin/deposits/reports` | Deposit reports |
| `/admin/withdrawals` | Withdrawals |
| `/admin/withdrawals/pending` | Pending |
| `/admin/withdrawals/pending-approval` | Pending approval |
| `/admin/withdrawals/completed` | Completed |
| `/admin/withdrawals/settings` | Withdrawal settings |
| `/admin/withdrawals/reports` | Withdrawal reports |
| **Referrals** | |
| `/admin/referrals` | Referrals |
| `/admin/referrals/commissions` | Commissions |
| `/admin/referrals/relationships` | Relationships |
| `/admin/referrals/campaigns` | Campaigns |
| `/admin/referrals/codes` | Referral codes |
| **Governance** | |
| `/admin/forensics` | Forensics |
| `/admin/proof-of-reserves` | Proof of reserves |
| `/admin/user-behavior` | User behavior |
| `/admin/system-reliability` | System reliability |
| `/admin/playbooks` | Operational playbooks |
| **Other** | |
| `/admin/market-making` | Market making |
| `/admin/treasury` | Treasury |
| `/admin/risk-intelligence` | Risk intelligence |
| `/admin/reports` | Reports |
| `/admin/reports/financial` | Financial reports |
| `/admin/reports/users` | User reports |
| `/admin/reports/trading` | Trading reports |
| `/admin/reports/custom` | Custom reports |
| `/admin/notifications` | Notifications |
| `/admin/notifications/announcements` | Announcements |
| `/admin/notifications/email` | Email templates |
| `/admin/notifications/sms` | SMS templates |
| `/admin/notifications/push` | Push broadcast |
| `/admin/admins` | Admin list |
| `/admin/admins/roles` | Roles & permissions |
| `/admin/support` | Support |
| `/admin/deposits/manual-credit` | Manual credit |

---

## STEP 4 — Backend → Admin API → Admin UI Mapping

| Backend Service | Admin API | Admin UI Page |
|-----------------|-----------|---------------|
| deposit-credit | GET /deposits, POST /deposits/manual-credit | /admin/deposits, /admin/wallets/deposits/manual-credit |
| deposit-sweep | GET /deposit-sweeps, POST /deposit-sweeps/run | /admin/wallets/deposit-sweeps, /admin/wallets/operations |
| withdrawal-signing | POST /withdrawals/:id/approve, reject | /admin/withdrawals, /admin/withdrawals/pending-approval |
| hot-wallet | GET /hot-wallets, GET /funds/summary | /admin/wallets/hot, /admin/wallets/funds-summary |
| p2p.service | GET /p2p, /p2p/ads, /p2p/orders | /admin/p2p, /admin/p2p/ads, /admin/p2p/orders |
| p2p-escrow | GET /escrows, POST freeze/unfreeze | /admin/p2p/escrows |
| aml-transaction-monitor | GET /aml/dashboard | /admin/compliance/alerts, /admin/security/compliance |
| spot-orderbook-cache | GET /analytics/orderbook-intelligence | /admin/orderbook-intelligence |
| settlement-worker | GET /settlement/events, POST circuit-reset | /admin/control-center, /admin/incidents |
| liquidity-bot | GET /liquidity-bot/config | /admin/market-making |
| spot-matching (via admin-spot) | GET /spot/markets, /spot/orders, /spot/trades | /admin/markets, /admin/trading/spot-markets, /admin/trading/orders |
| feature_toggles | GET/PATCH /settings, /settings/features | /admin/system-config, /admin/settings/features |
| system_settings | GET/PATCH /settings | /admin/settings, /admin/system-config |
| exchange-monitoring | GET /monitoring/counters | /admin/monitoring/counters |
| rate-limit-fastify | GET /operational/rate-limits | /admin/rate-limits |
| backup (operational) | GET/POST /operational/backups | /admin/backups |

---

## STEP 5 — Missing Admin Integrations

### Backend modules without admin API
| Module | Notes |
|--------|-------|
| **Deposit indexer** | Separate app `apps/indexer`; no admin endpoint to view indexer status or trigger scans |
| **Price oracle** | Runs in background; no admin API to view or control |
| **Geo-blocking** | Env var only; no admin UI to manage GEO_BLOCKED_COUNTRIES |
| **VPN/TOR service** | `vpn-tor.service` — no admin visibility or config |
| **Candle aggregation** | Background worker; no admin control |

### Backend modules with API but no dedicated UI
| Module | API | Gap |
|--------|-----|-----|
| **Sanctions screening** | Used in withdrawal flow | No admin dashboard for sanctions hits or config |
| **IP rules** | `security_ip_rules` table | UI may exist at /admin/security/ip-rules; backend has ip-rules middleware |

### Recommended additions
1. **Indexer status API** — GET /admin/operational/indexer-status (last block, health)
2. **Price oracle admin** — GET /admin/price-oracle/status, PATCH /admin/price-oracle/pause
3. **Geo-block admin** — GET/PATCH /admin/settings/geo-block (read/write GEO_BLOCKED_COUNTRIES)
4. **Sanctions dashboard** — GET /admin/compliance/sanctions (screening hits, config)

---

## STEP 6 — Summary

### Complete backend modules list (20)
Spot trading engine, order matching, orderbook cache, settlement worker, match poller, deposit indexer, deposit credit, deposit sweep, withdrawal signing, hot wallet, P2P trading, P2P escrow, merchant stats, AML monitoring, sanctions screening, rate limiting, geo blocking, price oracle, liquidity bot, analytics services.

### Admin API count
~120+ admin endpoints across admin.fastify, admin-spot, admin-aml, admin-security, admin-analytics, admin-operations, admin-operational, admin-control.

### Admin UI pages count
~90+ admin pages under `/admin/*`.

### Mapping coverage
- **Fully connected**: Deposit sweep, withdrawal signing, hot wallet, P2P, escrow, AML, orderbook cache, settlement, liquidity bot, spot markets, fees, settings, backups, rate limits.
- **Partially connected**: Deposit indexer (no admin), price oracle (no admin), geo-blocking (config only).

### Missing admin integrations
1. Deposit indexer — no admin API
2. Price oracle — no admin control
3. Geo-blocking — no admin toggle
4. Sanctions screening — no dedicated UI
5. VPN/TOR service — no admin visibility

---

*Audit complete. Admin panel is production-ready for core operations; consider adding indexer, oracle, and geo-block admin interfaces for full operational control.*
