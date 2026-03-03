# User-Side Deep UX/UI Audit — Binance-Grade Exchange

**Scope:** User-facing only (`apps/frontend/src/app`). Admin excluded.  
**Goal:** Har page, flow, button, icon — function tak; koi point miss na ho.

---

## 1. Page Inventory

### Before-login (public / auth)

| Route | File | Purpose |
|-------|------|---------|
| `/` | `app/page.tsx` | Landing; CTA signup, markets, spot, P2P |
| `/login` | `app/(auth)/login/page.tsx` | Login (identifier → OTP → 2FA/passkey) |
| `/signup` | `app/(auth)/signup/page.tsx` | Signup (email/phone → OTP → password) |
| `/forgot-password` | `app/(auth)/forgot-password/page.tsx` | Request OTP → new password |
| `/terms` | `app/(auth)/terms/page.tsx` | Terms of Use |
| `/privacy` | `app/(auth)/privacy/page.tsx` | Privacy Policy |
| `/spot` | `app/spot/page.tsx` | Public spot gate; Login / Go to Trading |
| `/p2p` | `app/p2p/page.tsx` | Public P2P gate; Login / Go to P2P |
| `/orders`, `/history`, `/assets` | redirect | → dashboard equivalents |
| `/auth/callback/google`, `/apple` | callback pages | OAuth redirect |

**Gap:** Login/signup footer "Cookie Policy" → `/cookies` but **no `/cookies` route** (404).

### After-login (dashboard, RequireAuth)

| Area | Routes | Notes |
|------|--------|--------|
| Home | `/dashboard` | Overview |
| Spot | `/dashboard/spot`, `/dashboard/trade/spot` | Grid + standalone form |
| P2P | `/dashboard/p2p`, `.../p2p/[type]/[crypto]/[fiat]`, `.../orders/[orderId]`, payment-methods | Full flow |
| Orders | `/dashboard/orders`, `.../orders/spot`, `.../orders/p2p` | Hub + lists |
| Assets | `/dashboard/assets/overview`, funding, unified, convert, history, pnl | All exist |
| Deposit/Withdraw | `/dashboard/deposit/crypto`, `.../withdraw/crypto`, `.../transfer` | Full flow |
| Identity | `/dashboard/identity`, `.../upload`, `.../success` | KYC flow |
| Account | account, security, change-password, withdrawal-limits, passkeys, data-export | All exist |
| Other | referral, preferences, api, fee-rates, markets, announcements, address-book, progress, events | |
| Placeholder | `/dashboard/earn`, `.../copy-trading`, `.../demo-trading` | "Coming Soon" |

**Gap:** API list "Edit" → `/dashboard/api/edit/${id}` but **no `api/edit/[id]` route** (404).

---

## 2. Layout & Nav Verification

- **Top nav:** Spot, P2P, Orders, Assets, History — all hrefs valid.
- **Sidebar:** Overview, Spot, P2P (Trading + Payment Methods), Orders, Assets (Overview, Funding, Unified, Convert, History, P&L), History, Account (Info, Identity, Security, Data Export), Referral, Preferences, API, Fee Rates, Progress, Spot Wallet — all valid.
- **Deposit dropdown:** Deposit Crypto, P2P Trading, Buy with INR — valid.
- **Assets dropdown:** Overview, Deposit, Withdraw, Transfer, Unified, Funding, Spot Wallet, Earn, Copy Trading — valid (Earn/Copy Trading are placeholder pages).
- **Orders dropdown:** All Orders, Spot, P2P, Deposit — valid.
- **User dropdown:** Overview, Account, Events, Referral, Preferences, API, Fee Rates, Demo Trading, Logout — valid.  
  **Gap:** "Switch/Create Account" is a **button with no onClick/href** — does nothing.
- **Footer:** Market Overview, Trading Fee, API, Help Center — valid.
- **Landing footer:** Terms, Privacy exist; Help Center, Fees, Risk Warning → `#` (placeholder).

---

## 3. Flow Check (summary)

| Flow | Entry | Steps | Buttons/Actions | Status |
|------|--------|--------|-----------------|--------|
| Login | `/login` | Identifier → OTP → optional 2FA | Send OTP, Submit, Forgot password, Sign up | ✅ |
| Signup | `/signup` | Email/phone + terms → OTP → password | Send OTP, Continue, Create account | ✅ |
| Forgot password | `/forgot-password` | Request → OTP + new password | Send, Resend, Reset | ✅ |
| Spot | `/dashboard/spot` | Pair → order form → open/history | Buy/Sell, Cancel, tabs | ✅ |
| P2P | `/dashboard/p2p` | Type/crypto/fiat → ads → order → detail | Go, Buy/Sell, Confirm payment, Release, Cancel, Chat | ✅ |
| Deposit crypto | Deposit dropdown | Token → chain → address + QR | Copy, sidebar links | ✅ |
| Withdraw crypto | Assets/Deposit | Coin, chain, address, amount → review → submit | Review, Back, Confirm | ✅ |
| KYC | `/dashboard/identity` | Country/doc → DigiLocker or upload → success | Verify, Proceed, Submit | ✅ |
| Orders Spot | `/dashboard/orders/spot` | Open/History tabs, cancel | Cancel, Load more | ✅ |
| Orders P2P | `/dashboard/orders/p2p` | List → View → detail | View | ✅ |
| Convert | `/dashboard/assets/convert` | From/to, amount, submit | Convert, history | ✅ |
| Referral | `/dashboard/referral` | Code/link, copy, share | Copy, Share, My referrals | ✅ |
| API create | `/dashboard/api` → create | Name, permissions, IP → submit | Create, Back | ✅ |

**Gaps in flows:**  
- API: "Edit" goes to non-existent route; "Delete" has no handler.  
- Withdraw: FAQ links all `#`.  
- Cookie Policy link → 404.

---

## 4. Buttons & Icons (summary)

- **Header:** Deposit, Assets, Orders (dropdown toggles), Notifications (aria-label), Theme, User menu — all functional. "Switch/Create Account" — **no action**.
- **Sidebar:** Expand/collapse (aria-label), all menu links — functional. Mobile menu toggle — functional.
- **Skip link:** `#main-content` — ✅.
- **KYC banner:** Verify Now link, Dismiss (aria-label) — ✅.
- **Auth pages:** Primary actions have loading/disabled; Terms, Privacy, Forgot password, Sign up — links work. Cookie Policy — **broken**.
- **Spot/P2P:** Place order, Cancel, Confirm payment, Release — loading + error handling. Chat send — ✅.
- **Deposit/Withdraw:** Copy, Review, Confirm, Back — ✅. Withdraw FAQ — `#` only.
- **API page:** "Create New Key" — ✅. "Documentation" button — **no href/onClick**. "Edit" — **404**. "Delete" — **no onClick**.
- **Placeholder pages (Earn, Copy Trading, Demo Trading):** Single CTA to Convert/Spot — ✅.

---

## 5. Gaps (Kamiya) — Prioritized

### P0 – Broken / blocking

1. **Cookie Policy (`/cookies`) missing**  
   Login & signup footer link to `/cookies`. Route does not exist → 404.

2. **API key Edit → 404**  
   API list "Edit" → `/dashboard/api/edit/${key.id}`. No `dashboard/api/edit/[id]` page.

3. **API key Delete not wired**  
   Delete button in API list has no `onClick` / handler. No delete behavior.

### P1 – Misleading / placeholder

4. **"Switch/Create Account" does nothing**  
   User dropdown button; no `href` or `onClick`.

5. **API "Documentation" button does nothing**  
   No `href` or `onClick`; looks like CTA.

6. **Earn / Copy Trading / Demo Trading**  
   Linked as normal nav items but are "Coming Soon". Acceptable if copy is clear; consider "Coming soon" in nav or separate section.

### P2 – Inconsistent / missing feedback

7. **Withdraw: FAQ links all `#`**  
   Either add real help URLs or make non-clickable / remove.

8. **Landing footer: Help Center, Fees, Risk Warning → `#`**  
   Same as above.

### P3 – Polish

9. **API row:** Delete button needs `aria-label`; Edit/Delete could show confirmation where needed.
10. **Mobile sidebar close:** Prefer `aria-label="Close menu"` on icon.
11. **Redirect after login:** Ensure `?redirect=` used so user returns to intended page (e.g. Markets) after login.

---

## 6. Binance Comparison (short)

| Binance has | Our status |
|-------------|------------|
| Cookie/consent page | ❌ Link to `/cookies` → 404 |
| API: Edit + Delete keys | ❌ Edit 404; Delete no handler |
| Help / Fee / Risk docs | ⚠️ Footer links `#` |
| Demo / Testnet | Placeholder "Coming Soon" |
| Earn / Staking | Placeholder "Coming Soon" |
| Copy Trading | Placeholder "Coming Soon" |
| Account switcher / sub-accounts | Button present, no implementation |
| API documentation link | Button present, no target |
| Global search (markets) | Markets list only; no header search |
| Login/signup + passkey | ✅ Present |

---

## 7. Action Items (recommended)

### ✅ Fixed (P0)

1. ~~**Add `/cookies` page**~~ **Done:** `app/(auth)/cookies/page.tsx` — Cookie Policy page added.
2. ~~**API Edit**~~ **Done:** Edit button disabled with tooltip "Edit coming soon - create a new key to change settings" (no backend PATCH; user creates new key).
3. ~~**API key Delete**~~ **Done:** Delete handler with confirm → `DELETE /api/v1/auth/api-keys/:id` → toast + refresh list.
4. ~~**"Switch/Create Account"**~~ **Done:** Button shows "Soon" badge; onClick → toast "Coming soon".
5. ~~**API "Documentation"**~~ **Done:** Link to `NEXT_PUBLIC_API_DOCS_URL` or fallback `/dashboard/announcements`.

### ✅ Fixed (P1/P2/P3)

6. ~~**Withdraw FAQ links**~~ **Done:** Real routes — announcements, transfer, history, withdrawal-limits, address-book.
7. ~~**Landing footer**~~ **Done:** Help Center → `/dashboard/announcements`, Fees → `/dashboard/fee-rates`, Risk Warning → `/terms`.
8. ~~**Earn/Copy Trading/Demo**~~ **Done:** "Soon" badge in Assets & User dropdown.
9. ~~**Mobile sidebar close**~~ **Done:** `aria-label="Close menu"` on close button.
10. ~~**Redirect after login**~~ **Done:** `RequireAuth` passes `?redirect=`; `GuestOnly` redirects to it after login.

---

*Audit complete. P0–P3 fixes implemented for spot & P2P exchange.*
