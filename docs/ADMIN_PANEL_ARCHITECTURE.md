# Enterprise Admin Panel Architecture

> Designed from [BACKEND_ARCHITECTURE_REPORT.md](./BACKEND_ARCHITECTURE_REPORT.md).  
> Full operational visibility and control over the exchange backend.  
> **60+ screens · 50+ charts · RBAC · Activity logging.**

---

## Design System

| Token | Value | Usage |
|-------|--------|--------|
| **Background** | `#0B0F1A` | Main app background |
| **Card/panel** | `#111827` / `#1a1f2e` | Cards, sidebars |
| **Accent blue** | `#3B82F6` | Primary, links |
| **Accent purple** | `#8B5CF6` | Charts, secondary |
| **Accent green** | `#10B981` | Success, revenue |
| **Accent orange** | `#F59E0B` | Warnings, P2P |
| **Accent red** | `#EF4444` | Alerts, risk |

Charts: gradient palettes, animated where appropriate. Avoid table-only pages; every module includes charts/analytics.

---

## Backend → Admin Mapping (from BACKEND_ARCHITECTURE_REPORT)

| Backend | Admin usage |
|---------|-------------|
| **auth.fastify** | Admin login, session, refresh |
| **admin.fastify** | Dashboard stats, users, KYC, wallets, deposits, withdrawals, funds summary, hot wallets, deposit sweeps, ledger, settlement, escrows, trading halt, settings |
| **admin-aml.fastify** | AML alerts, reports, cases |
| **admin-security.fastify** | Audit logs, sessions, IP rules, risk rules |
| **admin-spot.fastify** | Spot markets, pairs, fees |
| **GET /health** | System health (DB, Redis, settlement queue, withdrawal queue) |
| **GET /metrics** | Prometheus metrics for observability |
| **GET /api/v1/observability/slo** | SLO status (IP-restricted) |

---

## Complete Admin Page Structure (60+ Screens)

### Global & Auth
| # | Route | Description |
|---|--------|-------------|
| 1 | `/admin/login` | Admin login |
| 2 | `/admin` | Redirect to dashboard |
| 3 | `/admin/dashboard` | **Global Operations Dashboard** (10 charts + metrics) |

### User Management
| 4 | `/admin/users` | User list + user growth & trading charts |
| 5 | `/admin/users/[id]` | User detail (balances, history, actions) |
| 6 | `/admin/users/detail` | User detail entry |
| 7 | `/admin/users/risk` | User risk profile |
| 8 | `/admin/users/suspended` | Suspended users |
| 9 | `/admin/users/banned` | Banned users |
| 10 | `/admin/users/verification` | Verification status |
| 11 | `/admin/users/tiers` | User tiers |
| 12 | `/admin/security/sessions` | User sessions / device / IP |

### KYC / Identity
| 13 | `/admin/kyc` | KYC overview |
| 14 | `/admin/kyc/pending` | Pending KYC |
| 15 | `/admin/kyc/approved` | Approved |
| 16 | `/admin/kyc/rejected` | Rejected |
| 17 | `/admin/kyc/review` | Review flow |
| 18 | `/admin/kyc/audit` | KYC audit trail |
| 19 | `/admin/kyc/settings` | KYC settings |

### Wallet & Treasury
| 20 | `/admin/wallets` | Treasury overview + deposit/withdraw/reserve charts |
| 21 | `/admin/wallets/deposits` | Deposits |
| 22 | `/admin/wallets/withdrawals` | Withdrawals |
| 23 | `/admin/wallets/adjust` | Manual balance adjustments |
| 24 | `/admin/wallets/funds-summary` | Funds summary |
| 25 | `/admin/wallets/hot` | Hot wallet monitor |
| 26 | `/admin/wallets/hot/[chainId]` | Hot wallet by chain |
| 27 | `/admin/wallets/cold` | Cold wallet |
| 28 | `/admin/wallets/deposit-sweeps` | Deposit sweeps |
| 29 | `/admin/wallets/reconciliation` | Reconciliation |
| 30 | `/admin/wallets/ledger/balance` | Balance ledger |
| 31 | `/admin/wallets/ledger/settlement` | Settlement ledger |
| 32 | `/admin/wallets/blockchain` | Blockchain config |
| 33 | `/admin/wallets/currencies` | Currencies |
| 34 | `/admin/deposits` | Deposits (alt) |
| 35 | `/admin/deposits/pending` | Pending deposits |
| 36 | `/admin/deposits/completed` | Completed |
| 37 | `/admin/deposits/flagged` | Flagged |
| 38 | `/admin/deposits/manual-credit` | Manual credit |
| 39 | `/admin/deposits/reports` | Deposit reports |
| 40 | `/admin/withdrawals` | Withdrawals |
| 41 | `/admin/withdrawals/pending` | Pending |
| 42 | `/admin/withdrawals/pending-approval` | Pending approval |
| 43 | `/admin/withdrawals/processing` | Processing |
| 44 | `/admin/withdrawals/completed` | Completed |
| 45 | `/admin/withdrawals/failed` | Failed |
| 46 | `/admin/withdrawals/reports` | Withdrawal reports |
| 47 | `/admin/withdrawals/settings` | Withdrawal settings |

### Spot Exchange
| 48 | `/admin/trading` | Spot overview |
| 49 | `/admin/trading/spot-markets` | Spot markets |
| 50 | `/admin/trading/pairs` | Trading pairs |
| 51 | `/admin/trading/orders` | Order monitoring |
| 52 | `/admin/trading/order-history` | Order history |
| 53 | `/admin/trading/trade-history` | Trade history |
| 54 | `/admin/trading/orderbook` | Orderbook view |
| 55 | `/admin/trading/fees` | Fee controls |
| 56 | `/admin/trading/market-control` | Market halt |
| 57 | `/admin/trading/circuit-breakers` | Circuit breakers |
| 58 | `/admin/monitoring/counters` | Counters |
| 59 | `/admin/monitoring/mm-risk` | Market making risk |

### P2P
| 60 | `/admin/p2p` | P2P overview + volume chart |
| 61 | `/admin/p2p/orders` | P2P orders |
| 62 | `/admin/p2p/trades` | P2P trades |
| 63 | `/admin/p2p/ads` | Advertisements |
| 64 | `/admin/p2p/escrows` | Escrow monitor |
| 65 | `/admin/p2p/disputes` | Disputes |
| 66 | `/admin/p2p/disputes/[id]` | Dispute detail |
| 67 | `/admin/p2p/merchants` | Merchants |
| 68 | `/admin/p2p/payment-methods` | Payment methods |
| 69 | `/admin/p2p/settings` | P2P settings |

### Compliance & AML
| 70 | `/admin/compliance/alerts` | AML alerts + timeline chart |
| 71 | `/admin/compliance/alerts/[id]` | Alert detail |
| 72 | `/admin/compliance/reports` | STR/CTR, FIU reports |
| 73 | `/admin/compliance/reports/[id]` | Report detail |
| 74 | `/admin/compliance/cases` | Case management |
| 75 | `/admin/security/compliance` | Compliance dashboard |

### Security
| 76 | `/admin/security` | Security overview |
| 77 | `/admin/security/dashboard` | Security dashboard + events chart |
| 78 | `/admin/security/audit-logs` | Audit logs |
| 79 | `/admin/security/audit` | Audit |
| 80 | `/admin/security/sessions` | Sessions |
| 81 | `/admin/security/ip-rules` | IP rules |
| 82 | `/admin/security/ip` | IP |
| 83 | `/admin/security/risk-rules` | Risk rules |
| 84 | `/admin/security/withdrawals` | Withdrawal risk |
| 85 | `/admin/security/activity` | Activity |
| 86 | `/admin/security/fraud` | Fraud |

### Marketing & Reports
| 87 | `/admin/referrals` | Referrals overview |
| 88 | `/admin/referrals/codes` | Referral codes |
| 89 | `/admin/referrals/campaigns` | Campaigns |
| 90 | `/admin/referrals/commissions` | Commissions |
| 91 | `/admin/referrals/relationships` | Relationships |
| 92 | `/admin/reports` | Reports |
| 93 | `/admin/reports/trading` | Trading reports |
| 94 | `/admin/reports/p2p` | P2P reports |
| 95 | `/admin/reports/financial` | Financial reports |
| 96 | `/admin/reports/users` | User reports |
| 97 | `/admin/reports/custom` | Custom reports |
| 98 | `/admin/notifications` | Notifications |
| 99 | `/admin/notifications/announcements` | Announcements |
| 100 | `/admin/notifications/email` | Email |
| 101 | `/admin/notifications/sms` | SMS |
| 102 | `/admin/notifications/push` | Push |

### System & Configuration
| 103 | `/admin/settings` | System settings (system_settings, feature_toggles) |
| 104 | `/admin/settings/features` | Feature flags |
| 105 | `/admin/settings/api` | API |
| 106 | `/admin/settings/blockchain` | Blockchain |
| 107 | `/admin/settings/blockchain/chains` | Chains |
| 108 | `/admin/settings/blockchain/currencies` | Currencies |
| 109 | `/admin/settings/blockchain/tokens` | Tokens |
| 110 | `/admin/settings/trading-pairs` | Trading pairs |
| 111 | `/admin/settings/p2p-assets` | P2P assets |
| 112 | `/admin/settings/maintenance` | Maintenance |
| 113 | `/admin/system/api-settings` | API settings (integrations) |
| 114 | `/admin/system-health` | **Observability** (latency, queues, SLO) |
| 115 | `/admin/fees` | Fees overview |
| 116 | `/admin/fees/trading` | Trading fees |
| 117 | `/admin/fees/withdrawal` | Withdrawal fees |
| 118 | `/admin/fees/tiers` | Fee tiers |
| 119 | `/admin/fees/promotions` | Fee promotions |

### Admin & Activity
| 120 | `/admin/admins` | Admin users |
| 121 | `/admin/admins/roles` | Roles & RBAC |
| 122 | `/admin/admins/logs` | **Admin activity log** (timestamp, admin ID, IP, action) |
| 123 | `/admin/support` | Support |
| 124 | `/admin/support/my-tickets` | My tickets |
| 125 | `/admin/support/responses` | Responses |

---

## Chart List (50+)

| # | Chart | Module / Page |
|---|--------|----------------|
| 1 | Trading volume (24h/7d) | Dashboard |
| 2 | User growth (cumulative) | Dashboard |
| 3 | Revenue trend | Dashboard |
| 4 | Deposit vs withdrawal | Dashboard |
| 5 | Liquidity heatmap (by pair) | Dashboard |
| 6 | Trade distribution (by pair/side) | Dashboard |
| 7 | Top trading pairs | Dashboard |
| 8 | P2P activity | Dashboard |
| 9 | Settlement throughput | Dashboard |
| 10 | Order flow | Dashboard |
| 11–14 | User growth, trading activity, deposit trends, withdraw trends | Users |
| 15–18 | Pair volume, orderbook depth, spread analytics, market liquidity heatmap | Spot |
| 19–21 | Liquidity heatmap, order distribution, price stabilization | Market Making |
| 22–24 | Deposit trends, withdraw trends, token reserve distribution | Wallets / Treasury |
| 25–27 | P2P volume, merchant performance, payment method usage | P2P |
| 28–30 | AML alerts timeline, risk score heatmap, suspicious transaction analytics | Compliance |
| 31–33 | Security events, risk heatmap | Security |
| 34–36 | Performance, latency, system load | Observability |
| 37+ | Per-module breakdowns, time series, heatmaps | Various |

---

## Admin RBAC Roles

| Role | Scope |
|------|--------|
| **Super Admin** | Full access |
| **Finance Admin** | Wallets, deposits, withdrawals, funds, fees, reports |
| **Compliance Admin** | KYC, AML, compliance, STR/CTR, FIU |
| **Security Admin** | Security, audit logs, sessions, IP/risk rules |
| **Support Admin** | Users (read), support tickets, responses |
| **Marketing Admin** | Referrals, campaigns, notifications |

Backend must enforce by admin role on each `/api/v1/admin/*` route.

---

## Admin Activity Logging

Every admin action must be logged:

- **Fields:** timestamp, admin ID, IP address, action, resource, details (JSON).
- **Actions:** configuration changes, user actions (freeze, reset, etc.), financial actions (approve/reject withdrawal, manual credit), security actions.
- **Storage:** `audit_logs` or dedicated `admin_activity_log` table.
- **UI:** `/admin/admins/logs` — filterable list + export.

---

## Tech Stack

- **Frontend:** Next.js 14, React, TypeScript, TailwindCSS, Ant Design (tables, forms, modals in admin).
- **Charts:** Recharts (primary), optional ECharts/D3 for heatmaps.
- **Real-time:** WebSockets where backend exposes; polling for metrics.
- **State:** Zustand, React Query.

---

## Implementation Notes

- **Do not remove** existing admin route files; they already wire to backend. **Upgrade** layout, dashboard, and key pages with the design system (#0B0F1A, gradient charts) and add missing charts/analytics.
- **Add** missing screens (e.g. admin activity log, observability) and ensure sidebar reflects the full 60+ structure.
- **Charts:** Use Recharts with gradient fills; placeholder/mock data where backend does not yet expose time-series; wire to `/admin/dashboard/stats`, `/health`, `/metrics`, settlement/events when available.

---

*Architecture aligned with BACKEND_ARCHITECTURE_REPORT.md for enterprise-grade operations.*
