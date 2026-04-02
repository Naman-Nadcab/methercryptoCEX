# Frontend runtime: local dev vs Docker

## Ports (this monorepo)

| App | Port | Package / service |
|-----|------|-------------------|
| User UI (Next) | **3000** | `apps/frontend` |
| Admin panel | **3001** | `apps/admin-panel` |
| API | **4000** | `apps/backend` |

## Local development (live `src/`, hot reload)

From repo root:

```bash
npm run dev:frontend
```

Or:

```bash
cd apps/frontend
rm -rf .next node_modules/.cache   # optional, if routes/UI look stale
npm run dev
```

Open **http://localhost:3000**. Canonical routes include `/markets`, `/orders`, `/wallet`, `/p2p`, `/trade/spot`.

Sanity check (with dev server running):

```bash
cd apps/frontend && npm run verify:routes
```

Admin UI only (no backend via this script):

```bash
npm run dev:admin-panel
```

## Docker Compose `frontend` service (:3000)

The `frontend` container runs **`next build` output** baked into the image. It does **not** mount your local `src/`.

- Changing routes or components locally **does not** change what you see on **http://localhost:3000** until you **rebuild** the image:

```bash
npm run docker:frontend:rebuild
# same as:
# docker compose build --no-cache frontend && docker compose up -d frontend
```

- In the browser DevTools console, a **`[exchange-frontend] This UI is a baked production bundle`** warning appears when `NEXT_PUBLIC_DOCKER_USER_APP=1` is set (default in `docker-compose.yml` for this service).

## “New routes work in build but not in the browser”

1. Confirm **`window.location.origin`** matches how you started the app (`http://localhost:3000` for user UI).
2. If you use Docker for `:3000`, **rebuild** `frontend` (see above).
3. Hard refresh (**Ctrl+Shift+R** / **Cmd+Shift+R**) to avoid cached JS.
4. Ensure nothing else is bound to **3000** (`lsof -i :3000` on macOS/Linux).

## Active server (quick check)

```bash
lsof -i :3000
```

- **`node … next-server`** or **`next dev`** → local Next (expected for `npm run dev`).
- **Docker** → `com.docker…` / container name; treat as baked bundle until rebuild.
