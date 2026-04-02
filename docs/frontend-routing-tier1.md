# Tier-1 frontend routing & layout consolidation

Structural plan for Next.js App Router (`apps/frontend`). **No API or trading logic changes.** Phased rollout; deprecated URLs remain until validation (Phase 7).

---

## 1. Route mapping (old → new)

| Legacy / duplicate path | Canonical target | Notes |
|-------------------------|------------------|--------|
| `/dashboard/spot` | `/trade/spot` | Primary spot terminal (`SpotTradingGrid`). Preserve `?symbol=`. |
| `/dashboard/trade` | `/trade/spot` | Already rewritten in `next.config.js`; align to explicit redirect when canonical flag on. |
| `/dashboard/trade/spot` | `/trade/spot` | **Different UI** today (simpler form). Canonical = terminal; legacy form → deprecate or merge into terminal tabs later. |
| `/spot` | **No automatic redirect** | `app/spot/page.tsx` is a **public** landing. `next.config` rewrite may be ineffective if file wins. Update **links** to `/trade/spot` when logged in. |
| `/dashboard/markets` | `/markets` | App shell; not implemented in code yet (middleware off until page exists). |
| `/dashboard/orders`, `/dashboard/orders/spot`, `/dashboard/orders/p2p` | `/orders`, `/orders/spot`, `/orders/p2p` | Hub + children. |
| `/dashboard/assets/overview` (and key wallet subpaths) | `/wallet`, `/wallet/...` | Map 1:1 subpaths (`deposit` may stay `/wallet/deposit/crypto` or keep absolute paths). |
| `/p2p-v2`, `/p2p-v2/*` | `/p2p`, `/p2p/*` | **Phase 3.** Same components; trading shell only. |
| `/dashboard/p2p`, `/dashboard/p2p/*` | `/p2p`, `/p2p/*` | **Phase 3.** Merge flows with p2p-v2. |
| `/p2p` (current public stub) | `/p2p` (authenticated) **or** `/p2p/welcome` | Today links to `p2p-v2`. Resolve: public marketing vs trading root. |

**Earn (Phase 4 nav):** map to existing `/dashboard/earn` (or future `/earn`) — no rename until product confirms.

---

## 2. Layout usage map

| Shell | Routes (target) | Behavior |
|-------|-----------------|----------|
| **App shell** | `/markets`, `/orders`, `/wallet`, `/account`, `/settings`, … | Sticky header + sidebar + `max-w-[1400px]` content + footer (as today on dashboard). |
| **Trading shell** | `/trade/spot`, `/p2p` (+ nested) | Full viewport, **no sidebar**, `ExchangeHeader` / in-page chrome, bottom nav padding for mobile. |

**Rule:** Each feature lives in **one** shell only (no duplicate full implementations under dashboard + standalone).

---

## 3. Redirect implementation plan

1. **`NEXT_PUBLIC_CANONICAL_ROUTES=true`** — enables **308** redirects in `src/middleware.ts` (preserves query string). Default **false** in production until smoke-tested.
2. **`ENABLE_DEPRECATED_ROUTE_LOG=true`** — Edge-safe `console.info` JSON lines for hits on deprecated paths (optional analytics pipeline later).
3. **`next.config.js`:** keep existing admin redirects; **gradually replace** `/spot` rewrite with documented behavior once `/trade/spot` is default (avoid double-hop).
4. **Fallback (Phase 6):** if `NEXT_PUBLIC_CANONICAL_ROUTES_FALLBACK=true` (optional future), middleware skips redirect and only logs — for incident rollback without redeploy (same as turning main flag off).

---

## 4. Risk analysis

| Risk | Mitigation |
|------|------------|
| Extra redirect latency | 308 + CDN cache; eventually update internal `Link` hrefs (Phase 4). |
| `RequireAuth` / layout drift | Shared `TradeShellLayout` component used by `trade` and future `p2p` only. |
| Bookmarked `/dashboard/spot` | Redirect preserves query; no break. |
| Public `/spot` vs `/trade/spot` | Do not redirect `/spot` in middleware; fix CTAs in Phase 4–5. |
| P2P merge regressions | Feature flag per subsystem; e2e on take order, dispute, payment methods. |
| SEO | Use **308** only when canonical URLs are final; until then use **307** if you need to change mind without cache pain (configurable). |
| Deep links in emails | Map old paths in middleware for 2+ major versions. |

---

## 5. Step-by-step rollout (production-safe)

1. **Ship** `docs/frontend-routing-tier1.md` + `trade/spot` + middleware (flag **off**).
2. **Staging:** enable `NEXT_PUBLIC_CANONICAL_ROUTES=true`; test login, spot trade, WS, order history, refresh with `?symbol=`.
3. **Phase 4:** grep-replace internal links `dashboard/spot` → `trade/spot` (keep redirects for external bookmarks).
4. **Add** `/markets`, `/orders`, `/wallet` pages + app-shell route group; extend middleware map; repeat staging.
5. **Phase 3:** mount p2p-v2 tree under `/p2p` with trading shell; redirect `p2p-v2` + `dashboard/p2p`.
6. **Phase 5:** nav labels, Help vs Announcements, remove “Soon” from critical paths.
7. **Phase 7:** remove deprecated `page.tsx` trees only after metrics show &lt;1% traffic on old paths.

---

## 6. Target folder structure (clean)

```
apps/frontend/src/
  middleware.ts                 # gated redirects + optional deprecated logging
  lib/tier1-canonical-routes.ts # single source: from → to
  app/
    (marketing)/                # optional group: /, legal
    (app-shell)/                # header + sidebar
      layout.tsx                # refactored from dashboard/layout.tsx
      markets/
      orders/
      wallet/
      account/
      settings/
    (trading-shell)/
      layout.tsx                # full-screen + RequireAuth + bottom nav
      trade/spot/page.tsx
      p2p/...
    dashboard/                  # temporary: thin re-exports or redirects only → delete in Phase 7
```

**Current implementation (Phase 1 slice):** only `app/trade/` + middleware + lib map; dashboard layout unchanged.
