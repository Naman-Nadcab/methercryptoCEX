# Pending List — Backend पहले, फिर Frontend

**नोट:** Admin का पूरा UI बाद में बनाना है। Backend में कुछ भी pending न रहे — सिर्फ Frontend UI बाकी रहे।

---

# PART 1 — BACKEND (सब पहले पूरा करो)

## 1. SPOT Trading Backend

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | Post-only (maker only) order type | ❌ Pending | Tier 1 feature |
| 2 | Reduce-only order type | ❌ Pending | Tier 1 feature |
| 3 | Take-profit / Take-profit limit | ❌ Pending | Tier 1 feature |
| 4 | OCO full API expose | ⚠️ Partial | DB + matching में logic है, REST API से पूरा document & support नहीं |
| 5 | GTD (Good Till Date) time-in-force | ❌ Pending | Optional |
| 6 | Bulk order (batch place/cancel) | ❌ Pending | Optional |
| 7 | Iceberg full support | ⚠️ Partial | display_quantity है, full iceberg logic verify करो |

---

## 2. P2P Backend

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | P2P WebSocket (order status live) | ❌ Pending | Real-time order updates |
| 2 | Verified merchant badge/tier logic | ⚠️ Partial | merchant stats hai, badge criteria + API add |
| 3 | Auto-release option (on payment confirm) | ❌ Pending | Optional config |
| 4 | Cash-in-person payment ads | ❌ Pending | Optional |
| 5 | Ad boost / promote | ❌ Pending | Optional |

---

## 3. Auth Backend

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | OAuth redirect from `state` | ❌ Pending | Google/Apple callback को state से redirect URL read karke redirect karna |
| 2 | Device management API | ❌ Pending | Optional |
| 3 | Login notification (new device) | ❌ Pending | Optional |

---

## 4. KYC Backend

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | E-KYC provider (Sumsub/Jumio) webhook | ❌ Pending | Manual upload के साथ optional provider |
| 2 | Liveness check | ❌ Pending | E-KYC से आएगा |
| 3 | Document auto-verification | ❌ Pending | E-KYC से आएगा |

---

## 5. Wallet / Deposit / Withdraw Backend

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | Fiat deposit (bank transfer) flow | ❌ Pending | Optional — payment gateway chahiye |
| 2 | Fiat withdrawal flow | ⚠️ Verify | Withdraw fiat API hai ya nahi verify |
| 3 | Staking/Earn backend | ❌ Pending | earn page ke liye backend agar chahiye |
| 4 | Sub-accounts | ❌ Pending | Optional |
| 5 | Card on/off ramp | ❌ Pending | Optional — third-party |

---

## 6. ADMIN Backend (सब पूरा — UI बाद में)

**जो पहले से है:**
- Dashboard stats, users, KYC, P2P disputes/escrows/ads/orders
- Wallets, funds summary, deposits, withdrawals, hot-wallets
- Trading, fees, referrals, notifications
- Settings (blockchains, currencies, trading-pairs, p2p-assets)
- AML, security, analytics, operations, operational
- Engine recovery, cold reserves, 2FA enforcement, listing status
- Liquidity SLA, scheduled compliance, feature flags
- Indexer, oracle, geo-blocking, sanctions, network-risk
- STR/CTR, withdrawal tier limits, alert channels
- Admin users, logs

**Admin Backend में verify/add करो:**

| # | Admin Backend Item | Status | Notes |
|---|--------------------|--------|-------|
| 1 | Trading halt SET (POST/PATCH) | ⚠️ Verify | GET hai, halt toggle API hai? |
| 2 | User impersonation API | ❌ Pending | Support ke liye |
| 3 | Bulk user actions API | ❌ Pending | Suspend/unsuspend multiple |
| 4 | Withdrawals: approve/reject API | ⚠️ Verify | Admin withdrawals flow complete? |
| 5 | Deposits: manual credit API | ⚠️ Verify | Manual credit endpoint hai? |
| 6 | STR/CTR report generate API | ⚠️ Verify | Reports generate/export |
| 7 | AML alert resolve/assign API | ⚠️ Verify | Alerts resolve workflow |
| 8 | Admin roles/permissions CRUD | ⚠️ Verify | Roles backend complete? |

*Backend में सब endpoints ready होने चाहिए — Admin UI बाद में बनाना है।*

---

# PART 2 — FRONTEND (Backend complete होने के बाद)

## A. User Dashboard Frontend

### Dead Links / Missing Pages
| # | Link | Action |
|---|------|--------|
| 1 | `/vip-requirements` | Create page या `/dashboard/help#vip` redirect |
| 2 | `/fiat-fees` | Create page या `/dashboard/help#fiat-fees` redirect |
| 3 | `/mnt-discount` | Create page या `/dashboard/help#mnt-discount` redirect |
| 4 | `/dashboard/identity/business` | Create page या link remove |
| 5 | `/learn` | Create page या `/dashboard/help` redirect |
| 6 | `/dashboard/data-export` | Verify exists |

### Spot Trading UI
| # | Item | Notes |
|---|------|-------|
| 1 | Trailing stop full UI | SpotTradingGrid में type hai, UX complete karo |
| 2 | OCO order UI | Backend ready hone ke baad |
| 3 | Price alerts | Optional |
| 4 | Advanced order panel | Optional |

### P2P UI
| # | Item | Notes |
|---|------|-------|
| 1 | Verified merchant badge display | Backend badge API ready hone ke baad |
| 2 | Average release time in ad list | Backend data hai, UI में show |
| 3 | P2P real-time (WebSocket) | Backend WS ready hone ke baad |
| 4 | Ad analytics for merchant | Optional |

### Auth
| # | Item | Notes |
|---|------|-------|
| 1 | OAuth callback redirect from state | Backend fix ke baad frontend bhi sync |

### Build / Code
| # | Item | Notes |
|---|------|-------|
| 1 | Duplicate imports (if any) | blockchain/chains, api page — fix |
| 2 | Wrong footer links (markets, trading-fee, api, help) | `/dashboard/markets` etc. fix |

---

## B. ADMIN Frontend (बाद में — सिर्फ UI)

**Backend तैयार रखो। Admin UI ये सब बाद में बनाना है:**

### Admin Modules — UI बनाना बाकी

| # | Module | Route | Backend Ready? | UI Status |
|---|--------|-------|----------------|-----------|
| 1 | Dashboard | /admin/dashboard | ✅ | Exists, polish |
| 2 | Users (All, KYC, KYB, Suspended) | /admin/users, kyc/* | ✅ | Exists |
| 3 | Wallet & Funds | /admin/wallets/*, deposits, withdrawals | ✅ | Exists |
| 4 | Trading (Engine, Liquidity, Surveillance, etc.) | /admin/trading/* | ✅ | Exists |
| 5 | P2P (Orders, Disputes, Escrows, etc.) | /admin/p2p/* | ✅ | Exists |
| 6 | Risk (Dashboard, Withdrawals, AML) | /admin/risk, compliance/* | ✅ | Exists |
| 7 | Reports (Trading, Financial, Users) | /admin/reports/* | ✅ | Exists |
| 8 | System Config (Alerts, API, Features, etc.) | /admin/system/*, settings/* | ✅ | Exists |
| 9 | Admin Management (Users, Roles) | /admin/admins/* | ✅ | Exists |
| 10 | Security (Audit, IP, Withdrawals) | /admin/security/* | ✅ | Exists |

**Admin UI gaps (जहाँ backend है लेकिन UI weak/incomplete):**
- Engine recovery status → dedicated UI
- Oracle status → dedicated UI
- STR/CTR reports → full table + export UI
- Geo-blocking config → full CRUD UI
- Sanctions config → full CRUD UI
- Liquidity SLA settings → full form UI
- 2FA enforcement settings → full form UI
- Scheduled compliance → full form UI
- Trading halt toggle → one-click UI
- User impersonation → button + flow (backend add karke)
- Bulk user actions → multi-select + actions (backend add karke)

---

# SUMMARY

| Part | Items | Priority |
|------|-------|----------|
| **Backend — Spot** | 7 items | P1: Post-only, Reduce-only, OCO expose |
| **Backend — P2P** | 5 items | P1: P2P WebSocket, Verified badge |
| **Backend — Auth** | 3 items | P0: OAuth state redirect |
| **Backend — KYC** | 3 items | P2: E-KYC provider |
| **Backend — Wallet** | 5 items | P2/P3: Fiat, Earn |
| **Backend — Admin** | 8 items (verify) | सब verify करो, gaps add करो |
| **Frontend — User** | Dead links, Spot/P2P UI | P0: Dead links fix |
| **Frontend — Admin** | बाद में | Backend ready रखो, UI baad me |

**Order of work:**
1. Backend सब पूरा करो (Admin सहित)
2. User frontend fix (dead links, build)
3. Admin UI — बाद में जब backend 100% ready हो
