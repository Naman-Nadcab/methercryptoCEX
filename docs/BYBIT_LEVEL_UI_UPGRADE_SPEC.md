# Bybit-Level UI/UX Upgrade Specification

**Scope:** User panel only. **Excluded:** Spot trading page.

This document lists exact UI improvements and component upgrades for implementation. Layout structure remains unchanged.

---

## 1. GLOBAL UI IMPROVEMENTS

### 1.1 Information Density (Bybit-style)

**Files:** All dashboard cards across `apps/frontend/src/app/dashboard/` and shared card components.

**Pattern to apply:**
- Add micro-stats to every balance/value card:
  - `+X.X% today` or `-X.X% today` (24h change)
  - `Last update: X min ago`
  - Small contextual metadata (e.g. "Since last month")

**Example transformations:**
| Before | After |
|--------|-------|
| Total Balance<br>1,200 USDT | Total Balance<br>1,200 USDT<br>+2.3% today · Last update: 2 min ago |
| Your Earnings<br>$320 | Your Earnings<br>$320<br>+$12 this week · 3 new referrals |

**Concrete locations:**
- `dashboard/page.tsx` — Welcome card: add 24h change, last update
- `assets/overview/page.tsx` — Total Balance card: add 24h change, last update
- `referral/page.tsx` — Stats cards: add weekly change, last activity
- `api/page.tsx` — Info cards: add last request time

---

### 1.2 Card Visual Upgrade

**Files:** `globals.css`, shared card wrapper (create `components/ui/Card.tsx` if needed), all pages using cards.

**Add to cards:**
- Soft gradient background: `bg-gradient-to-br from-card to-card/80` or `from-gray-900/50 to-gray-800/30` (dark)
- Layered shadow: `shadow-lg shadow-black/5 dark:shadow-black/20`
- Hover: `hover:-translate-y-0.5 hover:shadow-xl hover:shadow-primary/5 transition-all duration-200`
- Border: subtle `border border-border/80`

**Class to add to card containers:**
```css
.card-bybit {
  @apply rounded-xl border border-border/80 bg-card/95;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}
.card-bybit:hover {
  transform: translateY(-3px);
  box-shadow: 0 8px 25px -5px rgba(0,0,0,0.1), 0 4px 10px -6px rgba(0,0,0,0.1);
}
```

---

### 1.3 Tooltips Everywhere

**Files:** All pages with metrics. Use existing `Tooltip`, `TooltipTrigger`, `TooltipContent`, `TooltipProvider` from `@/components/ui/Tooltip`.

**Add tooltips to:**
- `referral/page.tsx`: Commission Rate (i) — "Percentage you earn from referrals' trading fees"
- `referral/page.tsx`: Your Referrals (i) — "Users who signed up using your link"
- `api/page.tsx`: API Keys (i) — "Keys without IP binding expire in 3 months"
- `assets/overview/page.tsx`: Already has some; add for Today's P&L, Account types
- `dashboard/page.tsx`: Total Balance (i) — "Combined funding + trading balance"
- All "Available", "Locked" column headers (already in assets overview)

**Pattern:**
```tsx
<span className="inline-flex items-center gap-1">
  Commission Rate
  <TooltipProvider><Tooltip>
    <TooltipTrigger asChild>
      <HelpCircle className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
    </TooltipTrigger>
    <TooltipContent>This is the percentage you earn from your referrals' trading fees.</TooltipContent>
  </Tooltip></TooltipProvider>
</span>
```

---

### 1.4 Loading Skeletons

**Files:** `components/ui/Skeleton.tsx` (create if missing), all pages with loading states.

**Current:** "Loading…", "No data", spinner only.

**Replace with:**
- `referral/page.tsx`: Skeleton for stats cards (hero) — 4 card skeletons with `animate-pulse`
- `api/page.tsx`: Table row skeletons (already has Loader2); replace with 5 skeleton rows
- `assets/overview/page.tsx`: Balance card skeleton, chart bar skeleton
- `dashboard/page.tsx`: Markets table already has skeletons ✓; announcements: add list skeleton
- `assets/history/page.tsx`: Transaction row skeletons
- `p2p/page.tsx` (P2PMerchantTable): Replace "Loading…" with 5 skeleton rows

**Skeleton component (if not exists):**
```tsx
// components/ui/skeleton.tsx
<div className="animate-pulse rounded-md bg-muted h-4 w-full" />
```

---

### 1.5 Empty-State Illustrations

**Files:** `components/ui/EmptyState.tsx`, all pages with empty lists.

**Upgrade EmptyState:**
- Add optional `illustration?: 'referrals' | 'api-keys' | 'transactions' | 'orders' | 'p2p'`
- Use SVG illustrations (simple, line-art style) instead of icon-only
- Example: "No referrals yet" → Illustration + "Invite friends to start earning rewards." + CTA

**Concrete updates:**
- `api/page.tsx`: Empty state — add illustration, "Create your first API key to automate trading"
- `referral/page.tsx`: If no referrals — "Invite friends to start earning" with share CTA
- `assets/history/page.tsx`: "No transactions" — illustration + "Deposit or trade to see history"
- `P2PMerchantTable`: "No merchants found" — illustration + "Try different filters or create your own ad"

---

### 1.6 Spacing Consistency (8px System)

**Files:** `tailwind.config.ts`, all dashboard pages.

**Apply:**
- Gap scale: `gap-2` (8px), `gap-4` (16px), `gap-6` (24px), `gap-8` (32px)
- Padding: `p-2`, `p-4`, `p-6`, `p-8`
- Replace arbitrary `gap-3`, `gap-5`, `p-5`, `py-12` with scale values where feasible
- Reduce large vertical gaps (e.g. `mb-12` → `mb-8`, `py-20` → `py-12`)

---

## 2. REFERRAL PAGE IMPROVEMENTS

**File:** `apps/frontend/src/app/dashboard/referral/page.tsx`

### 2.1 Referral Performance Chart
- Add section: "Referral Earnings (30 days)"
- Simple area/line chart (use lightweight-charts or recharts)
- X-axis: dates, Y-axis: earnings
- Data from API: `/api/v1/user/referrals/earnings-history?days=30` (backend may need endpoint)

### 2.2 Referral Funnel
- Add card with funnel stats:
  - Link clicks
  - Signups
  - Verified users
  - Active traders
  - Revenue
- Layout: horizontal bars or funnel visualization
- Place below hero stats

### 2.3 Referral Analytics Cards
- Add 4 cards: Active Referrals, Avg Earnings per Trader, Conversion Rate, Monthly Earnings
- Use same card style as hero; add tooltips
- Wire to referral API if available

### 2.4 Leaderboard Section
- Add "Top Referrers" table (or "Your rank" if user-specific)
- Columns: Rank, User (masked), Total Earnings
- Show top 10; "View full leaderboard" link

### 2.5 Referral Banner Generator
- Add section "Share Banners"
- 3 download buttons: Twitter banner (1500×500), Telegram banner (1200×628), Square (1080×1080)
- Generate canvas images with referral code + QR (extend existing `saveImage` logic)
- Store preset dimensions per platform

---

## 3. API MANAGEMENT PAGE IMPROVEMENTS

**File:** `apps/frontend/src/app/dashboard/api/page.tsx`

### 3.1 API Usage Statistics
- Add card: "Requests today" | "Errors" | "Rate limit usage"
- Requires backend: `GET /api/v1/user/api-usage` or similar
- If no API: show "—" or "N/A" with tooltip "Enable in settings"

### 3.2 Quick Documentation Links
- Add row of links:
  - Python SDK
  - Node SDK
  - REST Docs
  - WebSocket Docs
- Use `NEXT_PUBLIC_API_DOCS_URL` and env for SDK links

### 3.3 API Security Status (per key)
- In each key row or expandable section, show:
  - IP whitelist: Enabled / Not set
  - Withdrawal: Disabled / Enabled
  - Read-only: Yes / No
- Use badges (green check / gray dash)

---

## 4. API KEY CREATION PAGE IMPROVEMENTS

**File:** `apps/frontend/src/app/dashboard/api/create/page.tsx`

### 4.1 Permission Summary Before Creation
- Add collapsible/summary card above "Create API Key" button:
  - Key Name: {name}
  - Permissions: Spot trading, Account data (list checked)
  - IP Restriction: Enabled / None
  - Withdrawal: Disabled
- Updates live as user changes form

### 4.2 Key Expiration Selector
- Add dropdown/radio: "30 days" | "90 days" | "Never"
- Only when `ipRestriction === 'no_restriction'` (keys with IP binding = never expire)
- Wire to creation payload if backend supports

---

## 5. P2P PAGE UX UPGRADE

**Files:**
- `components/p2p/P2PMerchantTable.tsx`
- `components/p2p/P2PTradeWindow.tsx`
- `components/p2p/P2PFilters.tsx`
- `app/dashboard/p2p/page.tsx`

### 5.1 Merchant Statistics (extend P2PMerchantRow)
- Add to row: `avgReleaseTime`, `tradeCount`, `isVerified`
- Display:
  - ✔ Verified badge (if `isVerified`)
  - Completion: 99.3%
  - Trades: 1,200
  - Avg release: 4 min
- Extend `P2PMerchantRow` type and mock/API data

### 5.2 Escrow Messaging
- Add banner in `P2PTradeWindow` and order flow:
  - "Funds secured in escrow"
  - "Released after payment confirmation."
- Use Shield icon; subtle success styling

### 5.3 Payment Method Icons
- Map payment methods to icons:
  - Bank Transfer → Building2 / Landmark
  - UPI → Smartphone / Indian Rupee
  - Wise → Globe
  - PayPal → external icon or text badge
- Show in P2PMerchantTable "Payment Methods" column and P2PTradeWindow

### 5.4 Trust Indicators
- Add to merchant row: Merchant rating (stars), "Identity verified", "KYC verified"
- Badges: small icons + text

---

## 6. ASSETS PAGE IMPROVEMENTS

**File:** `apps/frontend/src/app/dashboard/assets/overview/page.tsx`

### 6.1 Portfolio Analytics
- Add:
  - Portfolio allocation chart (pie/donut): % per asset
  - 24h portfolio change (from API or derived)
  - Asset performance table: symbol, 24h change, 7d change
- Layout: card next to balance; allocation chart in Account tab

### 6.2 Balance Card Enrichment
- "Portfolio value: 12,430 USDT"
- "+2.3% today" (green/red)
- Sub-line: "24h change" with tooltip

---

## 7. HISTORY / ORDERS PAGES

**Files:**
- `apps/frontend/src/app/dashboard/assets/history/page.tsx`
- `apps/frontend/src/app/dashboard/orders/spot/page.tsx`
- `apps/frontend/src/app/dashboard/orders/p2p/page.tsx`

### 7.1 Advanced Filters
- Date range: Start date, End date (already in history)
- Asset: dropdown (already)
- Transaction type: All, Deposit, Withdraw, Transfer (already)
- Status: All, Completed, Pending, Failed
- Ensure filter bar is consistent across history and orders

### 7.2 Export Options
- Add "Export" dropdown: CSV, Excel
- Button in filter bar
- Implement: `GET /api/v1/wallet/.../export?format=csv` or client-side CSV generation from current page data

---

## 8. GLOBAL FEATURES

### 8.1 Notification Center
**File:** `components/layout/ExchangeHeader.tsx`, `components/dashboard/NotificationCenter.tsx` (new)

- Change Bell link to dropdown (Popover/DropdownMenu)
- On click: show panel with:
  - Deposit confirmed
  - Order filled
  - Withdrawal sent
  - Security alert
- Each item: icon, title, time ago, link
- "View all" → `/dashboard/announcements` or new notifications page
- Badge count if unread
- Backend: `GET /api/v1/user/notifications` (may need new endpoint)

### 8.2 Global Search
**File:** `components/layout/ExchangeHeader.tsx` or dashboard layout

- Add search icon/input (or expand existing pair search when not on spot)
- Search scope: Markets, Assets, Help articles
- Keyboard shortcut: Cmd/Ctrl+K
- Results: tabs or grouped (Markets | Assets | Help)
- Help: link to `/dashboard/help` with query

### 8.3 Contextual Help Tooltips
- Apply tooltip pattern from 1.3 across all major forms and metrics
- Focus: deposit/withdraw, P2P, API, referral

---

## 9. VISUAL POLISH

### 9.1 Apply Globally
- Subtle gradients on cards (see 1.2)
- Micro-animations: `transition-all duration-200` on buttons, cards
- Card hover: `hover:-translate-y-0.5` or `hover:translateY(-3px)`
- Clean dividers: `border-t border-border/60`
- Consistent iconography: Lucide only, size `w-4 h-4` or `w-5 h-5`

### 9.2 Button Hover
- Primary: `hover:shadow-lg hover:shadow-primary/25`
- Secondary: `hover:bg-muted`

### 9.3 Table Rows
- `hover:bg-muted/50 transition-colors`
- Sticky header (already in some tables)

---

## 10. IMPLEMENTATION CHECKLIST

| Area | Tasks | Priority |
|------|-------|----------|
| Global | Card gradients + hover, 8px spacing, tooltips | High |
| Global | Loading skeletons, empty-state illustrations | High |
| Dashboard | Balance 24h change, last update, micro-stats | High |
| Referral | Funnel, analytics cards, banner generator, chart | Medium |
| API | Usage stats, doc links, security status | Medium |
| API Create | Permission summary, expiration selector | Low |
| P2P | Merchant stats, escrow banner, payment icons, trust badges | High |
| Assets | Allocation chart, 24h change, asset performance | High |
| History/Orders | Export CSV/Excel, filter consistency | Medium |
| Global | Notification dropdown, global search | High |

---

## 11. FILES TO CREATE/MODIFY

**Create:**
- `components/ui/Skeleton.tsx` (if missing)
- `components/dashboard/NotificationCenter.tsx`
- `components/dashboard/GlobalSearch.tsx`
- `components/ui/CardBybit.tsx` (optional wrapper)
- Empty-state SVG assets (or use inline SVGs)

**Modify:**
- `app/globals.css` — card-bybit class, animations
- `app/dashboard/page.tsx` — density, tooltips, skeleton
- `app/dashboard/referral/page.tsx` — funnel, chart, banners, leaderboard
- `app/dashboard/api/page.tsx` — usage, doc links, security status
- `app/dashboard/api/create/page.tsx` — summary, expiration
- `app/dashboard/p2p/page.tsx` — (minimal; components do the work)
- `app/dashboard/assets/overview/page.tsx` — allocation, 24h change
- `app/dashboard/assets/history/page.tsx` — export, skeletons
- `components/p2p/P2PMerchantTable.tsx` — merchant stats, icons, trust
- `components/p2p/P2PTradeWindow.tsx` — escrow banner, payment icons
- `components/ui/EmptyState.tsx` — illustration support
- `components/layout/ExchangeHeader.tsx` — notification dropdown, global search

---

## 12. DO NOT MODIFY

- **Spot trading page** and all components under `components/trade/` used by spot:
  - `SpotTradingGrid`, `SpotOrderEntryPanel`, `SpotOrderbookPanel`, `ChartPanel`, `SpotDepthChart`, `SpotBottomPanel`, `PairHeader`
- Layout structure (sidebar, header position, main content flow)
- Feature set (no new features beyond UI enrichment)
