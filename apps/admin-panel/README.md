# Exchange Admin Panel

New CRM-style admin dashboard for the cryptocurrency exchange. Replaces the legacy admin UI in `apps/frontend`.

## Stack

- **Next.js 14** (App Router)
- **Tailwind CSS** + design tokens (#F8FAFC, #6366F1, 12px cards, 24px padding, 16px gap)
- **Recharts** for charts
- **TanStack Query** for data
- **Zustand** for auth state
- **WebSocket** `/api/v1/admin/ws/metrics` for realtime updates

## Design (SmartHR-style)

- Background: `#F8FAFC`
- Cards: white, 12px radius, soft shadow, 24px padding, 16px gap
- Primary: `#6366F1`, Success: `#10B981`, Warning: `#F59E0B`, Danger: `#EF4444`, Muted: `#64748B`
- Sidebar: light, icons + labels, active state primary background
- Topbar: search, Engine/Trading/Settlement status, notifications, admin profile

## Run

```bash
# 1. Start backend (with DB + Redis)
cd apps/backend && npm run dev

# 2. Run migrations and seed admin user (first-time only)
cd apps/backend && npm run migrate && npx tsx seed-admin.ts

# 3. Start admin panel
npm run dev --workspace=@exchange/admin-panel
# Or from this directory
npm run dev
```

App runs on **http://localhost:3001** (frontend-user stays on 3000).

## Connectivity (Admin Panel ↔ Backend ↔ DB)

| Layer            | Connection |
|-----------------|------------|
| Admin Panel     | Calls backend via HTTP (`NEXT_PUBLIC_API_BASE_URL` or `http://localhost:4000`). No direct DB access. |
| Backend         | Connects to PostgreSQL (DATABASE_URL) and Redis (REDIS_URL). All admin API reads/writes go through backend. |
| Login           | POST `/api/v1/admin/auth/login` → backend validates against `admin_users` table. |
| CORS            | Backend must allow admin origin. Add `http://localhost:3001` to `CORS_ORIGINS` in `.env`. |

**First-time setup:** Run `npm run migrate` and `npx tsx seed-admin.ts` in `apps/backend`. Default admin: `test@gmail.com` / `test123`.

## Env

- `NEXT_PUBLIC_API_BASE_URL` or `NEXT_PUBLIC_API_URL` — backend base URL (default `http://localhost:4000`)

## Auth

- Login: `POST /api/v1/admin/auth/login` with `{ email, password }`. Store `accessToken` and `admin` in Zustand (persisted).
- All admin requests use `Authorization: Bearer <token>`.
- Protected layout redirects to `/login` when no token.

## Dashboard

- Welcome section, 8 KPI cards, 3 charts (volume by asset, deposits vs withdrawals, liquidity), pending withdrawals table, AML alerts, P2P activity, system monitoring, activity feed, top traders, market status, treasury overview, admin tasks.
- Realtime: `useAdminWs()` invalidates React Query on `trade_executed`, `withdrawal_requested`, `deposit_confirmed`, `p2p_order_created`, `aml_alert_triggered`.

## Routes (placeholders)

- `/dashboard` — full dashboard
- `/login` — admin login
- `/users`, `/withdrawals`, `/monitoring` — placeholder pages; remaining sidebar links (KYC, Wallets, Trading, Markets, Orders, Trades, P2P, Liquidity, Risk, Analytics, Fees, Notifications, Security, Settings, Operations) can be added under `app/(protected)/<segment>/page.tsx`.

## Replacing the old admin

- **Redirects:** In `apps/frontend`, `/admin` and `/admin/login` now redirect to this app (using `NEXT_PUBLIC_ADMIN_PANEL_URL` or `http://localhost:3001`). The catch-all `app/admin/[...slug]/page.tsx` redirects other `/admin/*` paths to the new panel.
- **Full removal (optional):** To remove the old admin UI from the frontend entirely, delete `apps/frontend/src/app/admin/(protected)/` (all legacy admin pages and layout). After that, delete `apps/frontend/src/components/admin/`, `apps/frontend/src/lib/admin/`, and `apps/frontend/src/hooks/admin/` if nothing else references them. Point operators to this app (e.g. `http://localhost:3001` or your deployed URL).
