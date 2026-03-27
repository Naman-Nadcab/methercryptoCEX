# User Panel Pages — UX/UI Status

**Route** | **UX/UI** | **Notes**

---

## Auth Pages

| Page | Route | Status | Issues |
|------|-------|--------|--------|
| Login | `/login` | ⚠️ Issues | • Button "Continue with OTP" vs "Sending..." confusion<br>• OTP inputs lack aria-labels<br>• Passkey flow feedback improve ho sakta hai |
| Signup | `/signup` | ⚠️ Issues | • Step transitions pe loading indicator nahi<br>• Password Show toggle ke liye aria-label missing<br>• Terms/Privacy links OK |
| Forgot Password | `/forgot-password` | — | Basic form; verify karo |
| Terms | `/terms` | ✅ Proper | Static content |
| Privacy | `/privacy` | ✅ Proper | Static content |

---

## Dashboard & Trading

| Page | Route | Status | Issues |
|------|-------|--------|--------|
| Dashboard | `/dashboard` | ✅ Proper | Loading skeleton, error banner, empty announcements |
| Spot Trading | `/dashboard/spot` | ⚠️ Issues | • Suspense fallback sirf "Loading…"<br>• Error boundary missing |
| P2P Hub | `/dashboard/p2p` | ⚠️ Issues | • **Mock data** — real ads fetch nahi<br>• No loading/error/empty states<br>• `h-screen overflow-hidden` se mobile scroll issue |
| P2P Trade (BTC/INR etc) | `/dashboard/p2p/[type]/[crypto]/[fiat]` | ✅ Proper | Loading, empty, error sab handle |
| P2P Create Ad | `/dashboard/p2p/[type]/[crypto]/[fiat]/create` | — | Create ad form |
| Markets | `/dashboard/markets` | ✅ Proper | Skeleton, empty state, search aria-label |
| Orders Hub | `/dashboard/orders` | ✅ Proper | Static hub, links valid |
| Spot Orders | `/dashboard/orders/spot` | ✅ Proper | Skeleton, EmptyState, cancel error |
| P2P Orders | `/dashboard/orders/p2p` | ⚠️ Issues | • `fetchMyOrders` fail pe error UI nahi<br>• Skeleton ki jagah sirf spinner |
| P2P Order Detail | `/dashboard/p2p/orders/[orderId]` | — | Order chat/status |

---

## Assets & Wallet

| Page | Route | Status | Issues |
|------|-------|--------|--------|
| Assets Overview | `/dashboard/assets/overview` | ✅ Proper | Balance error, loading, empty, "Why 0?" |
| Assets Funding | `/dashboard/assets/funding` | ✅ Proper | Skeleton, empty, session error |
| Assets History | `/dashboard/assets/history` | ✅ Proper | Skeleton, empty tabs, date filters |
| Convert | `/dashboard/assets/convert` | ✅ Proper | Loading, error, success banners |
| Unified Trading | `/dashboard/assets/unified` | ✅ Proper | Trading balances, guide banner |
| Asset Detail | `/dashboard/assets/[symbol]` | — | Per-coin page |
| P&L Analysis | `/dashboard/assets/pnl` | — | Chart/analysis |
| Wallet Spot | `/dashboard/wallet/spot` | — | Redirect to assets |
| Deposit Crypto | `/dashboard/deposit/crypto` | ✅ Proper | Loading, error, empty, KYC modal |
| Withdraw Crypto | `/dashboard/withdraw/crypto` | ✅ Proper | Loading, error, success, empty |
| Withdraw Fiat | `/dashboard/withdraw/fiat` | — | Fiat withdrawal |
| Transfer | `/dashboard/transfer` | ✅ Proper | Loading, error, success |

---

## Account & Security

| Page | Route | Status | Issues |
|------|-------|--------|--------|
| Account Info | `/dashboard/account` | ⚠️ Issues | • Profile fetch pe "Loading..." sirf last login ke liye<br>• Trusted Devices, Login History, Delete Account — **placeholder**, real flow nahi<br>• Delete Account pe confirmation nahi |
| Identity (KYC) | `/dashboard/identity` | ✅ Proper | Verified/pending/not_submitted, error banner |
| Identity Upload | `/dashboard/identity/upload` | — | Upload flow |
| Security | `/dashboard/security` | ✅ Proper | 2FA, sessions, modals |
| Change Password | `/dashboard/security/change-password` | — | Form |
| Passkeys | `/dashboard/security/passkeys` | — | Passkey manage |
| Withdrawal Limits | `/dashboard/security/withdrawal-limits` | — | Limits view |
| Data Export | `/dashboard/data-export` | — | Export request |
| Preferences | `/dashboard/preferences` | — | Theme, language etc |
| Address Book | `/dashboard/address-book` | — | Saved addresses |
| Progress Tracker | `/dashboard/progress` | — | Onboarding steps |

---

## Referral, API, Help

| Page | Route | Status | Issues |
|------|-------|--------|--------|
| Referral | `/dashboard/referral` | ✅ Proper | Skeleton, error, empty, share modal |
| API Keys | `/dashboard/api` | ✅ Proper | Skeleton, empty CTA, delete loading |
| API Create | `/dashboard/api/create` | — | Create key form |
| Fee Rates | `/dashboard/fee-rates` | ✅ Proper | Loading, error handled |
| Help | `/dashboard/help` | ✅ Proper | Static, anchor links |
| Announcements | `/dashboard/announcements` | ✅ Proper | Loading, empty, list |
| Announcement Detail | `/dashboard/announcements/[id]` | — | Single announcement |

---

## Placeholder / Coming Soon

| Page | Route | Status | Issues |
|------|-------|--------|--------|
| Earn | `/dashboard/earn` | ✅ Placeholder | "Coming Soon" + Convert link |
| Copy Trading | `/dashboard/copy-trading` | ✅ Placeholder | "Coming Soon" + Spot link |
| Demo Trading | `/dashboard/demo-trading` | ✅ Placeholder | "Coming Soon" + Spot link |
| Events | `/dashboard/events` | — | Events list |
| Trade (legacy) | `/dashboard/trade` | — | Redirect to spot |
| Convert (legacy) | `/dashboard/convert` | — | Redirect to assets/convert |

---

## Summary

| Category | Proper | Issues |
|----------|--------|--------|
| **Auth** | 2 | 2 (Login, Signup) |
| **Trading** | 5 | 3 (Spot, P2P hub, P2P orders) |
| **Assets** | 8 | 0 |
| **Account** | 2 | 1 (Account Info) |
| **Referral/API/Help** | 5 | 0 |
| **Placeholder** | 3 | 0 |

**Total:** ~25 pages proper, ~6 pages me UX issues.

---

## Priority Fixes

1. **P2P Hub** — Mock data hatao, real API + loading/error/empty
2. **Account Info** — Profile loading, placeholder actions (Trusted Devices, Delete Account) fix/replace
3. **P2P Orders** — Error state add karo jab fetch fail
4. **Spot** — Suspense/error boundary improve
5. **Login/Signup** — aria-labels, loading feedback
