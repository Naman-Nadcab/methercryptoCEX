# One-Day Launch Checklist — Trading + P2P (UI ke saath)

**Target:** Din mein start karo, shaam tak trading + P2P UI se verify ho jaye.

---

## 🌅 Morning — Setup & Backend (9:00 – 12:00)

### 1. Environment & services
- [ ] `.env` check karo: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `NEXT_PUBLIC_API_URL`
- [ ] PostgreSQL running, Redis running
- [ ] Backend start: `npm run dev` (root) ya `apps/backend`: `npm run dev`
- [ ] Frontend start: `apps/frontend`: `npm run dev` (port 3000)
- [ ] Browser mein `http://localhost:4000/health` → `database: up`, `redis: up`

### 2. Database
- [ ] Migrations run: `npm run db:migrate` (root se)
- [ ] Koi migration error nahi aani chahiye

### 3. Spot market (min 1 pair)
- [ ] Admin login: `http://localhost:3000/admin/login`
- [ ] **System Controls → Blockchain / Token Config** — check: kam se kam 1 blockchain + base + quote currency (e.g. BTC, USDT)
- [ ] **System Controls** ya **Spot Markets** (admin) se **1 trading pair** active karo (e.g. BTC_USDT)
- [ ] Ya seed script run karo agar project mein hai (trading_pairs / spot_markets insert)

### 4. P2P basic config
- [ ] **System Controls → System Settings** — P2P se related toggles check (agar hain)
- [ ] **P2P System → Payment Methods** — kam se kam 1 payment method available
- [ ] **P2P Assets** (settings) — kam se kam 1 asset P2P ke liye enabled (e.g. USDT)

---

## ☀️ Afternoon — User flow & UI (12:00 – 16:00)

### 5. User auth & wallet UI
- [ ] User signup: `http://localhost:3000/login` (ya signup) — OTP flow test
- [ ] Login — dashboard open ho
- [ ] **Wallet / Deposit** — deposit address dikhe (crypto); agar 0 balance ho to thik hai
- [ ] **Wallet / Withdraw** — page load ho, limits/tokens dikhen (optional: withdraw submit mat karo abhi)

### 6. Spot trading UI
- [ ] **Spot / Trade** page kholo (dashboard/spot ya trade/spot)
- [ ] Market list mein apna pair dikhe (e.g. BTC_USDT)
- [ ] Market select karo — orderbook + ticker load hon (depth empty ho sakti hai abhi)
- [ ] Order form: limit order — price, quantity daal ke **Place Order** click karo
- [ ] Error na aaye (balance kam ho to “Insufficient balance” expected); agar test balance chahiye to admin se manual credit do

### 7. P2P UI
- [ ] **P2P** page kholo (dashboard/p2p ya p2p)
- [ ] Buy/Sell list mein ads dikhen (agar koi ad nahi to ek test user se ad create karo)
- [ ] Ek ad pe click — order create karo (amount enter karke)
- [ ] Order detail page — **Confirm payment** / **Release** buttons dikhen (flow test kar sakte ho)

### 8. Admin quick checks
- [ ] **Admin → Users** — naya user dikhe
- [ ] **Admin → Wallet & Funds → Withdrawals** — agar test withdraw kiya ho to list mein aaye
- [ ] **Admin → KYC** — pending list open ho
- [ ] **Admin → P2P → Orders/Disputes** — list load ho

---

## 🌆 Evening — Polish & verify (16:00 – 18:00)

### 9. UI fixes (agar time ho)
- [ ] Spot page: chart (TradingView) load ho raha hai ya “Select market” message sahi hai
- [ ] P2P order flow: messages/errors clear dikhen (amount min/max, “Payment confirmed” etc.)
- [ ] Mobile/responsive: spot order form aur P2P order page theek dikhen

### 10. Final verification
- [ ] **Spot:** 1 limit order place → open orders mein dikhe → cancel karo → history mein dikhe
- [ ] **P2P:** 1 order create (dusre user ke ad pe) → status “Pending payment” / “Paid” / “Released” flow dikhe (jaise tumne design kiya ho)
- [ ] Dono flows mein koi console error / 500 nahi aana chahiye

### 11. Docs / team (optional)
- [ ] `ONE_DAY_LAUNCH_CHECKLIST.md` (ye file) ko “Done” mark karo jo steps complete kiye
- [ ] Agar koi env / seed step missing ho to short note bana lo (e.g. “Run seed X for BTC_USDT”)

---

## ⚡ Quick reference

| Task              | Where (UI)                    | Backend / Admin                    |
|-------------------|-------------------------------|-----------------------------------|
| Spot market on    | Admin → Spot / System Controls | `trading_pairs` / `spot_markets`  |
| P2P asset on      | Admin → P2P / Settings        | P2P assets config                 |
| Test balance      | User deposit page             | Admin → Manual credit (if exists)  |
| Spot order        | Dashboard → Spot / Trade       | POST `/api/v1/spot/order`         |
| P2P order         | Dashboard → P2P               | POST `/api/v1/p2p/orders`         |

---

## ❌ Agar kuch fail ho

- **“Trading pair not found”** → Admin se spot pair add/activate karo.
- **“Insufficient balance”** → User ko test balance do (manual credit / deposit flow).
- **Orderbook empty** → Normal hai jab tak orders nahi lagte; ticker last trade se aata hai.
- **P2P ads nahi dikh rahe** → Ek user se P2P ad create karo (sell/buy).

---

*Is checklist ko din ke start mein open karo, har step complete hone par checkbox lagao. Shaam tak trading + P2P dono UI ke saath verify ho jayenge.*
