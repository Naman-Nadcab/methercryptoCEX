# Admin Panel — Complete Theme Breakdown (Color & Theme Upgrade Guide)

Theme ko upgrade karne ke liye saari colors aur variables ek jagah, source ke hisaab se. Koi bhi color change karna ho to is doc se dekh ke exact file + variable/line update kar sakte ho.

---

## 1. Admin Panel — Primary Source (globals.css)

**File:** `apps/frontend/src/app/globals.css`  
**Scope:** `.admin-panel` (admin layout ke andar)

### 1.1 Hex-based variables (lines ~280–291)

| Variable | Current value | Hex | Use |
|----------|----------------|-----|-----|
| `--admin-bg` | `#0B0F1A` | Dark navy | Page background |
| `--admin-card` | `#111827` | Slightly lighter | Cards, panels, table bg |
| `--admin-card-hover` | `#1a1f2e` | Lighter | Hover state |
| `--admin-border` | `rgba(255,255,255,0.06)` | White 6% | Borders |
| `--admin-accent-blue` | `#3B82F6` | Blue | Primary actions, links |
| `--admin-accent-purple` | `#8B5CF6` | Purple | Charts, secondary accent |
| `--admin-accent-green` | `#10B981` | Emerald | Success, positive |
| `--admin-accent-orange` | `#F59E0B` | Amber | Warning |
| `--admin-accent-red` | `#EF4444` | Red | Error, danger |
| `--admin-text` | `#F3F4F6` | Light gray | Primary text |
| `--admin-muted` | `#9CA3AF` | Gray | Secondary text, labels |

**Usage in same file:**
- `.admin-panel`, `.admin-panel body` → `background: var(--admin-bg)`, `color: var(--admin-text)`
- `.admin-panel .admin-card` → gradient with `var(--admin-card)`, border `var(--admin-border)`, shadow
- `.admin-panel .admin-card:hover` → border `rgba(255,255,255,0.1)`, stronger shadow
- `.admin-metric-value` → `var(--admin-text)`
- `.admin-metric-label` → `var(--admin-muted)`
- `.admin-accent-blue` … `.admin-accent-red` → utility classes for text color

**Upgrade:** In sab ko globals.css me change karo. Naya palette chahiye to in 11 variables ko replace karo.

---

### 1.2 Spacing & layout (lines ~391–401)

| Variable | Value | Use |
|----------|--------|-----|
| `--admin-space-1` | 4px | Tiny gap |
| `--admin-space-2` | 8px | Small gap |
| `--admin-space-3` | 12px | Medium gap |
| `--admin-space-4` | 16px | Large gap |
| `--admin-radius` | 4px | Border radius |
| `--admin-sidebar-w` | 220px | Sidebar width |

**Upgrade:** Radius ya density change karni ho to yahi adjust karo.

---

### 1.3 Dark theme — HSL tokens (lines ~404–416)

**Class:** `.dark .admin-panel`

| Variable | HSL value | Approx | Use |
|----------|-----------|--------|-----|
| `--admin-bg` | `222 18% 7%` | Very dark | Background |
| `--admin-bg-elevated` | `222 16% 10%` | Dark | Cards |
| `--admin-bg-overlay` | `222 14% 12%` | Dark | Overlays |
| `--admin-fg` | `210 14% 92%` | Light | Text |
| `--admin-fg-muted` | `215 12% 62%` | Gray | Muted text |
| `--admin-border` | `220 12% 18%` | Dark gray | Border |
| `--admin-border-subtle` | `220 12% 14%` | Darker | Subtle border |
| `--admin-accent` | `210 100% 52%` | Blue | Primary |
| `--admin-accent-fg` | `0 0% 100%` | White | On accent |
| `--admin-danger` | `0 72% 51%` | Red | Danger |
| `--admin-warning` | `38 92% 50%` | Amber | Warning |
| `--admin-success` | `142 71% 45%` | Green | Success |

**Note:** Ye HSL vars baad me Tailwind-style tokens se map hote hain (lines 436–444). Sidebar/Header/Panel Tailwind classes use karte hain (`bg-card`, `text-foreground`, etc.) jo in se resolve hote hain.

**Upgrade:** Dark theme ka tone (cooler/warmer) ya contrast change karna ho to in HSL values ko edit karo.

---

### 1.4 Light theme — HSL tokens (lines ~419–433)

**Class:** `.admin-panel.light-theme` ya `:root:not(.dark) .admin-panel`

| Variable | HSL value | Use |
|----------|-----------|-----|
| `--admin-bg` | `210 20% 98%` | Light gray bg |
| `--admin-bg-elevated` | `0 0% 100%` | White cards |
| `--admin-bg-overlay` | `210 20% 96%` | Overlay |
| `--admin-fg` | `220 18% 14%` | Dark text |
| `--admin-fg-muted` | `215 14% 42%` | Muted text |
| `--admin-border` | `214 20% 88%` | Border |
| `--admin-border-subtle` | `214 24% 92%` | Subtle border |
| `--admin-accent` | `210 100% 45%` | Blue |
| `--admin-accent-fg` | `0 0% 100%` | White on accent |
| `--admin-danger` | `0 72% 51%` | Red |
| `--admin-warning` | `38 92% 45%` | Amber |
| `--admin-success` | `142 71% 40%` | Green |

**Upgrade:** Light theme ka contrast ya hue change karna ho to yahi HSL edit karo.

---

### 1.5 Tailwind mapping (lines 436–457)

Admin HSL vars ko Tailwind tokens se map kiya gaya hai:
- `--background` ← `--admin-bg`
- `--foreground` ← `--admin-fg`
- `--card` ← `--admin-bg-elevated`
- `--muted` ← `--admin-bg-overlay`
- `--muted-foreground` ← `--admin-fg-muted`
- `--border` ← `--admin-border`
- `--primary` ← `--admin-accent`
- `--primary-foreground` ← `--admin-accent-fg`
- `--ring` ← `--admin-accent`

**Usage:** Sidebar/Header/Panel/components `bg-card`, `text-foreground`, `border-border`, `bg-muted`, `text-muted-foreground`, `border-primary`, etc. use karte hain. In sab ka source yahi mapping hai.

**Upgrade:** Agar Tailwind classes alag tokens use karein to yahi mapping change karo (e.g. `--primary` ko kisi aur admin var se map karo).

---

## 2. Ant Design theme (AdminAntdProvider)

**File:** `apps/frontend/src/components/admin/AdminAntdProvider.tsx`

Ant Design components (Table, Form, Button, Input, Select, Modal, Tag, etc.) in tokens se styled hote hain:

| Token | Value | Use |
|-------|--------|-----|
| `colorBgContainer` | `#111827` | Table/form/panel bg |
| `colorBgElevated` | `#1a1f2e` | Dropdown, popover |
| `colorBorder` | `rgba(255,255,255,0.06)` | Borders |
| `colorText` | `#F3F4F6` | Text |
| `colorTextSecondary` | `#9CA3AF` | Secondary text |
| `colorPrimary` | `#3B82F6` | Buttons, links, focus |
| `colorSuccess` | `#10B981` | Success state |
| `colorWarning` | `#F59E0B` | Warning |
| `colorError` | `#EF4444` | Error |

**Table override:**
- `colorBgContainer`: `#111827`
- `colorBorderSecondary`: `rgba(255,255,255,0.06)`

**Upgrade:** Naya admin color set use karna ho to yahi object me values replace karo. Ant Design 5 ki full token list ke liye: https://ant.design/docs/react/customize-theme#seedtoken.

---

## 3. Tailwind config (global theme)

**File:** `apps/frontend/tailwind.config.ts`

Ye **:root / .dark** (globals.css) ke variables use karta hai — admin-panel specific nahi, poore app ke liye:

- `background`, `foreground`, `card`, `primary`, `muted`, `border`, `destructive`, `accent`, `popover`, `input`, `ring`
- **Exchange:** `buy`, `sell`, `price-up`, `price-down`, `panel`
- **warning:** `hsl(45 86% 49%)` (hardcoded)

Admin layout **.admin-panel** ke andar hai, to dark mode me `.dark` class ke saath admin ke liye globals.css wale HSL mapping (section 1.3) use hote hain. Tailwind config me koi alag admin-specific color define nahi hai.

**Upgrade:** App-wide primary/muted/border change karna ho to `:root` / `.dark` in globals.css me edit karo; Tailwind config me sirf variable names same rahenge.

---

## 4. Recharts (admin charts) — hardcoded colors

**Location:** `apps/frontend/src/components/admin/charts/*.tsx`

Abhi colors direct hex se set hain. Upgrade ke time inko CSS variables ya theme object se replace karna better hai.

| File | Color | Hex | Use |
|------|--------|-----|-----|
| UserGrowthChart | stroke/fill | `#8B5CF6` | Area chart |
| UserGrowthChart | grid, axis, tooltip | `rgba(255,255,255,0.06)`, `#9CA3AF`, `#111827`, `rgba(255,255,255,0.1)` | Grid, labels, tooltip bg |
| TradeDistributionChart | segments | `#3B82F6`, `#8B5CF6`, `#10B981`, `#F59E0B` | Pie |
| TradingVolumeChart | stroke/fill | `#3B82F6` | Area |
| RevenueChart | stroke/fill | `#10B981` | Area |
| P2PActivityChart | stroke/fill | `#F59E0B` | Area |
| DepositWithdrawChart | bars | `#10B981`, `#F59E0B` | Deposit / Withdraw |
| OrderFlowChart | bars | `#10B981`, `#EF4444` | Buy / Sell |
| TopMarketsChart | bar | `#3B82F6` | Bar fill |
| SettlementThroughputChart | lines | `#10B981`, `#F59E0B` | Settled / Pending |

**Common pattern:** Tooltip/card bg `#111827`, border `1px solid rgba(255,255,255,0.1)`, axis/grid `#9CA3AF`, grid stroke `rgba(255,255,255,0.06)`.

**Upgrade:**  
- Option A: In files me hex ki jagah `var(--admin-accent-blue)` etc. use karo (globals.css vars).  
- Option B: Ek `adminChartTheme.ts` banao: `chartColors: { primary: '#3B82F6', success: '#10B981', ... }` aur charts me import karke use karo — phir theme change ek file me.

---

## 5. Control-plane & layout components

### 5.1 Panel.tsx
- Classes: `border-border`, `bg-card`, `text-foreground`, `text-muted-foreground`, `bg-muted/40`.  
- **Source:** Tailwind → admin HSL mapping (section 1.5).  
- **Upgrade:** Globals.css admin vars / Tailwind mapping change karo.

### 5.2 MetricWidget.tsx
- **neutral:** `border-border`, `bg-card`, `text-foreground`
- **positive:** `emerald-500/30`, `emerald-500/5`, `emerald-500/10`, `text-emerald-700` / `dark:text-emerald-400`
- **warning:** `amber-500/30`, `amber-500/5`, `amber-500/10`, `text-amber-700` / `dark:text-amber-400`
- **danger:** `red-500/30`, `red-500/5`, `red-500/10`, `text-red-700` / `dark:text-red-400`

**Upgrade:** Tailwind palette use ho raha hai. Agar admin-specific green/amber/red chahiye to custom classes banao jo `--admin-accent-green` etc. use karein, ya Tailwind theme extend karke admin colors add karo.

### 5.3 StatusBadge.tsx
- **LIVE:** emerald-500
- **HALTED / RISK:** red-500
- **DEGRADED:** amber-500
- **NEUTRAL:** gray-500

**Upgrade:** Same as MetricWidget — ya to Tailwind theme extend karo ya custom classes with CSS vars.

### 5.4 Sidebar.tsx
- `bg-card`, `border-border`, `text-foreground`, `text-muted-foreground`, `bg-muted`, `border-primary`, `bg-muted/60`, `bg-black/50` (overlay).  
- **Source:** Tailwind + admin mapping.  
- **Upgrade:** Globals.css + mapping.

### 5.5 Header.tsx
- Tailwind semantic classes (foreground, muted, border, etc.).  
- **Upgrade:** Same as Sidebar.

---

## 6. Single reference table — “change kaha karna hai”

| Goal | File(s) | What to change |
|------|---------|----------------|
| Page/card background | globals.css | `--admin-bg`, `--admin-card`, `--admin-card-hover` (hex block) |
| All borders | globals.css, AdminAntdProvider | `--admin-border`, Ant Design `colorBorder` |
| Primary blue | globals.css, AdminAntdProvider | `--admin-accent-blue`, `colorPrimary` |
| Success green | globals.css, AdminAntdProvider | `--admin-accent-green`, `colorSuccess` |
| Warning orange | globals.css, AdminAntdProvider | `--admin-accent-orange`, `colorWarning` |
| Error red | globals.css, AdminAntdProvider | `--admin-accent-red`, `colorError` |
| Text / muted | globals.css, AdminAntdProvider | `--admin-text`, `--admin-muted`, `colorText`, `colorTextSecondary` |
| Purple accent | globals.css, chart files | `--admin-accent-purple`, Recharts hex `#8B5CF6` |
| Dark theme tone (HSL) | globals.css | `.dark .admin-panel` block (section 1.3) |
| Light theme | globals.css | `.admin-panel.light-theme` / `:root:not(.dark) .admin-panel` (section 1.4) |
| Ant Design components | AdminAntdProvider.tsx | `adminTheme` object |
| Charts colors | admin/charts/*.tsx | Hardcoded hex → vars ya theme object |

---

## 7. Suggested upgrade flow (color-wise)

1. **Decide palette**  
   - Background: 1 dark base (e.g. `#0B0F1A` → `#0D1321`).  
   - Cards: 1 elevated (e.g. `#111827` → `#151C2C`).  
   - Primary: 1 blue (e.g. `#3B82F6` → `#2563EB`).  
   - Success / Warning / Error: green / amber / red.  
   - Text: 1 primary, 1 muted.

2. **Apply in order**  
   - **Step 1:** globals.css — hex block (1.1) + card gradient/shadow if needed.  
   - **Step 2:** AdminAntdProvider — same hex/tokens for Ant Design.  
   - **Step 3:** globals.css — dark/light HSL blocks (1.3, 1.4) if you use them.  
   - **Step 4:** Recharts — replace hex with vars ya theme object (section 4).  
   - **Step 5:** MetricWidget/StatusBadge — optional: custom classes with `--admin-*` vars.

3. **Consistency**  
   - Ant Design tokens aur globals.css ke hex/HSL dono ko ek hi palette se derive karo (e.g. primary blue ek hi hex, sab jagah wahi).

---

## 8. Optional: central theme file

Upgrade aur maintain karna easy rahe iske liye ek single source bana sakte ho:

**Example:** `src/styles/admin-theme.ts` (or `.js`)

```ts
export const adminTheme = {
  colors: {
    bg: '#0B0F1A',
    card: '#111827',
    cardHover: '#1a1f2e',
    border: 'rgba(255,255,255,0.06)',
    primary: '#3B82F6',
    success: '#10B981',
    warning: '#F59E0B',
    error: '#EF4444',
    purple: '#8B5CF6',
    text: '#F3F4F6',
    muted: '#9CA3AF',
  },
};
```

- **AdminAntdProvider:** is object se Ant Design tokens set karo.  
- **globals.css:** ek script ya build step se CSS variables generate kar sakte ho (optional).  
- **Charts:** is object se import karke use karo.

Abhi theme do jagah (globals.css + AdminAntdProvider) hai; is breakdown se tum dono ko ek hi palette se sync rakh sakte ho aur color/theme wise jitna upgrade chaho utna kar sakte ho.
