# Admin Panel migration (canonical operator console)

**Primary UI:** `apps/admin-panel` — dev URL `http://localhost:3001/dashboard`  
**Legacy UI:** removed. The user app (`apps/frontend`) no longer ships embedded `/admin` pages. Requests to `/admin` and `/admin/*` are **redirected** to `NEXT_PUBLIC_ADMIN_PANEL_URL` (see `apps/frontend/next.config.js`).

---

## Phase 0 — Rules (historical)

1. **Branch per slice** — e.g. `chore/admin-migration-docs`, `feat/admin-panel-logs-hub`. Avoid mixing “delete legacy” with “new features”.
2. **Legacy `/admin`** — deleted from `apps/frontend`; redirects preserve bookmarks.
3. **Definition of done** for “P0 parity”: every row in §P0 below is ✅ **Implemented & smoke-tested** in admin-panel.
4. **Rollback:** revert the branch / redeploy previous image; document in PR.

---

## Phase 1 — Route parity map (legacy → canonical)

Use this when redirecting or training operators. Prefix **Legacy** with your user app origin (e.g. `http://localhost:3000`). **Canonical** is admin-panel origin (e.g. `http://localhost:3001`).

| Area | Legacy (`/admin/...`) | Canonical (admin-panel) | Notes |
|------|------------------------|---------------------------|--------|
| Home | `/admin/dashboard`, `/admin/dashboard-v2` | `/dashboard` | Single dashboard in admin-panel |
| Users | `/admin/users`, `/admin/users/banned`, … | `/users`, `/users/[id]` | Detail via dynamic route |
| KYC | `/admin/kyc`, `/admin/kyc/pending`, … | `/kyc` | Extend admin-panel if sub-states missing |
| Wallets | `/admin/wallets/*` | `/wallets`, `/treasury` | Many legacy sub-routes; map case-by-case |
| Deposits | `/admin/deposits` | `/deposits`, `/deposits/[id]` | |
| Withdrawals | `/admin/withdrawals` | `/withdrawals`, `/withdrawals/[id]` | |
| Spot / markets | `/admin/trading/spot-markets`, `/admin/trading/pairs` | `/markets`, `/markets/[symbol]` | |
| Orders / trades | (various) | `/orders`, `/trades` | |
| P2P | `/admin/p2p/*` | `/p2p` | Expand if legacy has-only flows |
| Liquidity / MM | `/admin/market-making`, `/admin/liquidity` | `/liquidity`, **`/admin/mm-control`** | MM desk path includes `/admin` segment in app router |
| Control center | (incidents, engine, … in legacy) | `/admin-control`, `/control-center`, `/incidents`, `/monitoring` | Feature flags may hide some |
| Risk | `/admin/risk/*` | `/risk`, `/risk/settings`, … | |
| Fees | `/admin/fees/trading` | `/fees` | |
| Security / audit | `/admin/security/*` | `/security`, `/audit`, `/audit/config` | Legacy “Security” landing may be placeholder |
| Settings | `/admin/settings/*` | `/settings`, `/settings/system`, … | |
| Admin users | `/admin/admins` | `/admin-users` | |

**Gap tracking:** Add rows to your issue tracker for any **Legacy** route with no canonical row; decide P0 vs P1 vs drop.

---

## P0 smoke checklist (~10–15 min, after each release candidate)

Run against **staging** (or local `npm run dev:admin` + backend).

- [ ] Login / logout; session expiry shows clear error  
- [ ] **Dashboard** loads without hard error  
- [ ] **Users** — search or list loads  
- [ ] **Withdrawals** — list loads; open one detail `[id]`  
- [ ] **Deposits** — list loads  
- [ ] **KYC** — page loads (queue if applicable)  
- [ ] **Markets** — list loads  
- [ ] **Admin control** (`/admin-control`) — critical tiles load (permission-dependent)  
- [ ] **MM desk** (`/admin/mm-control`) — status loads (if liquidity bot configured)  
- [ ] **Audit** (`/audit` or `/audit/config`) — loads for auditor role  

Record date + environment + who ran it in PR or release notes.

---

## Phase 2 — Implement gaps (safe slices)

**Done in repo (incremental):** Sidebar grouped by domain; **Approvals** and **MM desk** in nav; **Operator shortcuts** on `/dashboard`; **Operations** hub links MM + approvals; **`/logs`** hub avoids dead link. **Nav parity:** **Control center**, **Admin users**, **Compliance**, **Audit** (`/audit`), **Support**, **Announcements**, **Backups** added to sidebar (existing entries unchanged); **Audit** active state is exact path so `/audit/config` does not highlight **Audit**.

1. Pick one **P0** gap from the matrix.  
2. Reuse existing `adminFetch` / API libs in `apps/admin-panel/src/lib`.  
3. Add loading / error / empty states; respect RBAC (`ProtectedAction` / permission checks).  
4. Merge; run P0 smoke.

---

## Phase 3 — Navigation & IA

- Keep **one** sidebar source: `apps/admin-panel/src/lib/admin/nav-sections.ts` (rendered by `components/shell/UnifiedSidebar.tsx`).  
- Group related items (Operations, Funds, Trading, Risk, Compliance, System).  
- Avoid duplicate labels pointing at different URLs.

---

## Phase 4 — Soft deprecate legacy *(completed → removed)*

Legacy embedded admin is gone; bookmarks hit `next.config.js` redirects to the admin-panel origin.

---

## Phase 5 — Remove legacy admin *(done)*

Embedded `apps/frontend/src/app/admin/**` and related components, hooks, and API helpers were removed. **Keep** `NEXT_PUBLIC_ADMIN_PANEL_URL` set in each environment so `/admin` and `/admin/*` redirect correctly.

---

## Maintenance

- New operator features → **admin-panel first**.  
- Update this doc when you add a canonical route or retire a legacy one.
