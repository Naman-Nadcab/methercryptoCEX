# Login fix – step-by-step

Follow these in order.

## 1. Backend must be running

```bash
cd apps/backend
npm run dev
```

Wait until you see: `Server running on http://localhost:4000` (or "Port 4000 is already in use" means something is already running there).

## 2. Run migrations (fixes most 500s)

If you never ran migrations or added new tables/columns:

```bash
cd apps/backend
npm run migrate
```

Then restart backend: `npm run dev`.

## 3. Frontend

```bash
cd apps/frontend
npm run dev
```

Open http://localhost:3000/login.

## 4. If you still get 500

1. Open **DevTools (F12)** → **Network** tab.
2. Try login again (email + Continue → enter OTP → Continue).
3. Click the **red (failed)** request (e.g. `send-otp` or `login`).
4. Open **Response** (or **Preview)** and read the JSON. The `error.message` (and in dev `error.detail`) is the real backend error.

- If it says **"relation … does not exist"** or **"column … does not exist"** → run step 2 again and restart backend.
- If it says **"Backend unreachable"** / **"Failed to fetch"** → backend is not running or not on port 4000. Do step 1.
- If you use **Next.js proxy** (no `NEXT_PUBLIC_API_BASE_URL`): requests go to Next then to backend. To test backend directly, in `apps/frontend/.env.local` add:
  ```env
  NEXT_PUBLIC_API_BASE_URL=http://localhost:4000
  ```
  Restart frontend and try again. CORS is allowed for localhost:3000.

## 5. Redis optional

Login works without Redis. If Redis is not running you’ll see warnings in backend logs; you can ignore them for login. Start Redis only if you need session cache / rate limit storage.

---

**Summary:** Run `npm run migrate` in `apps/backend`, then start backend and frontend. Use Network → Response to see the exact error when something fails.
