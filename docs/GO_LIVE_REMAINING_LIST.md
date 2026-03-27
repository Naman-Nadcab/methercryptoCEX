# Go-Live Remaining — Sirf List

**System ko live jane ke liye kya kya remaining hai (sirf list).**  
**Har item ke saath likha hai: [Backend] / [Frontend] / [Infra] / [Both].**

---

## Critical (launch block)

1. **Sanctions screening** [Backend] — Abhi stub; hamesha `allowed: true`. Real provider integrate karo (Chainalysis/Elliptic) aur error pe **fail closed** (`allowed: false`).
2. **Sanctions error pe fail-open** [Backend] — `sanctions-screening.service.ts` catch block me `allowed: true` mat return karo; error pe `allowed: false` + log.
3. **Rust matching engine orderbook persist nahi** [Backend] — Restart pe open orders lose. Orderbook persist karo (RocksDB/SQLite) ya backend `spot_orders` se replay on startup.

---

## High (production se pehle fix)

4. **SETTLEMENT_BATCH_SIZE** [Backend / Infra] — Default 10 hai; production me `SETTLEMENT_BATCH_SIZE=20` (ya >= 20) set karo.
5. **Withdrawal signing — distributed lock** [Backend] — Multiple worker nodes pe Redis lock use karo: `redis.acquireLock('withdrawal:sign:' + withdrawalId)` signing se pehle.

---

## Auth / Login (go-live se pehle ensure)

6. **Signup pe rate limit** [Backend] — `POST /auth/signup` pe rate limit add karo (e.g. 10/hour per IP).
7. **Signup — Redis down pe flow** [Backend] — Redis na ho to signup break ho sakta hai (verify-otp/signup Redis pe depend). DB-based fallback for OTP verified flag.
8. **Signup success** [Frontend] — Signup ke baad `useAuthStore().login()` use karo, direct localStorage nahi.
9. **Signup error response** [Frontend] — Non-JSON response ke liye `response.text()` + `JSON.parse` use karo.
10. **Production OTP delivery** [Backend / Infra] — SMTP/SMS configure karo; nahi to send-otp 503/500 de sakta hai. Ya 503 + clear message when delivery fails.

---

## Spot / Matching

11. **POST /spot/orders rate limit** [Backend] — `POST /api/v1/spot/orders` pe bhi rate limit add karo (e.g. per user 30/min).
12. **Candle aggregation** [Backend] — `spot_trades` se `ohlcv_candles` fill karne wala job (1m, 5m, 1h etc.); chart ke liye candles chahiye.
13. **Chart / candles** [Backend] — Ensure candle job run ho ya candles populate ho, warna chart empty rahega.

---

## Infra / Ops (production)

14. **Redis Sentinel** [Infra] — HA ke liye production me use karo.
15. **REDIS_WS_PUBSUB_ENABLED** [Infra] — Multi-node WebSocket ke liye enable karo.
16. **DB read replica** [Infra] — Heavy read ke liye optional `DATABASE_READ_REPLICA_URL`.
17. **RUN_MODE split** [Infra] — Production me `RUN_MODE=api` aur `RUN_MODE=workers` alag nodes pe.
18. **ALERT_WEBHOOK_URL** [Infra] — circuit_open, integrity_mismatch etc. ke liye configure karo.
19. **SANCTIONS_PROVIDER** [Infra] — Production me real provider set karo; startup pe warn hai agar missing.

---

## Optional / Nice to have

20. **verify-otp purpose** [Backend / Frontend] — Signup flow me `purpose` required ya safe default.
21. **Rate limit Redis fail-closed** [Backend] — Auth routes pe Redis error pe request reject (fail closed) consider karo.
22. **Session-core / Lock service** [Backend / Infra] — Agar use ho rahe hain to production URLs + health check; nahi to 409 on login document karo.

---

## User login pre-check

23. **Backend port 4000** [Infra / Config] — User panel ka rewrite backend 4000 pe point kare.
24. **Migrations** [Backend] — `otp_verifications` + saari required tables; `npm run migrate` run ho chuka ho.
25. **Frontend API URL** [Frontend] — User panel ke liye `NEXT_PUBLIC_API_BASE_URL` / `NEXT_PUBLIC_API_URL` sahi (e.g. local: `http://localhost:4000` ya unset).
26. **Redis** [Infra] — Rate limit ke liye Redis up; production me must.

---

## Summary — kaun si list kiski hai

| Kiski | Items (numbers) |
|-------|------------------|
| **Sirf Backend** | 1, 2, 3, 5, 6, 7, 11, 12, 13, 21, 24 |
| **Sirf Frontend** | 8, 9, 25 |
| **Sirf Infra / Config** | 14, 15, 16, 17, 18, 19, 23, 26 |
| **Backend + Infra** | 4, 10, 22 |
| **Backend + Frontend** | 20 |

---

**Total: 26 items (Critical 3, High 2, Auth 5, Spot 3, Infra 6, Optional 3, Pre-check 4).**
