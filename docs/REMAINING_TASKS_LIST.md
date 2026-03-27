# Admin Panel — Remaining Tasks List (Isko hisaab se kya kya karna hai)

Summary doc ke hisaab se jo improvements baaki hain, woh yahan list hain. Jis order mein karna ho kar sakte ho.

---

## A. Settings / System Configuration (`/settings/system`)

| # | Task | Detail |
|---|------|--------|
| A1 | **Bulk enable/disable features** | Ek saath multiple features on/off karne ka option (checkboxes + "Enable selected" / "Disable selected"). |
| A2 | **Feature search/filter** | Feature flags table pe search box ya filter (name/status se). |
| A3 | **Export/import system settings** | "Export settings" → JSON download; "Import settings" → JSON upload se settings restore. |
| A4 | **Numeric limits validation** | System limits (API rate, max withdrawal, etc.) pe min/max validation frontend + backend. |
| A5 | **Version history filters** | Version history tab pe filter: date range, "Updated by" (admin). |
| A6 | **Diff: highlight changed keys** | Diff viewer mein sirf changed keys highlight (green/red ya inline diff). |
| A7 | **Save current to profile** | "Save current settings to profile" button → current settings ko selected profile (Production/Staging/Testing) mein save. |
| A8 | **Dependency rules add/edit** | Feature dependencies ko UI se add/edit (sirf liquidity_bot → spot_trading hi nahi, naye rules). |
| A9 | **Config audit view** | Alag page/section: "Config audit" — filters: action, setting key, date, admin; audit_logs se data. |

---

## B. Master Control Panel (`/admin-control`)

| # | Task | Detail |
|---|------|--------|
| B1 | **WebSocket for status/health** | Control status + health score real-time: WebSocket event aane pe auto-refresh (ya 5s polling). |
| B2 | **Create incident** | "Create incident" button: type (RPC failure, Queue overflow, etc.), severity; backend POST incident. |
| B3 | **Commands: last run info** | System commands ke paas "Last run: 2 min ago" / "Last triggered by: admin@email.com" (backend me store + API). |
| B4 | **Event log filters + export** | Global event log pe filter: service, severity; "Export CSV" button. |
| B5 | **Health score: live + breakdown** | Health score refetch 5s (ya WebSocket); UI pe dikhao "Score -10: API latency high". |
| B6 | **Service status: real data** | Services ki status/uptime/last restart actual workers/processes se (health endpoints ya process list). |
| B7 | **Asset freeze history: filter + export** | History table pe filter: asset, action; "Export" CSV/JSON. |
| B8 | **Circuit history: filter** | Circuit history pe filter: service (circuit vs emergency). |
| B9 | **Timeline: filter + load more + realtime** | Timeline pe filter (service/severity), "Load more", aur WebSocket se naye events push. |
| B10 | **Emergency level: short description** | Level 1/2/3 ke saath 1 line copy: "Level 1: Pause trading only", etc. |
| B11 | **Safety triggers: edit in UI** | Trigger ki threshold + action edit (sirf toggle nahi); modal ya inline edit. |
| B12 | **Safety triggers: add new** | "Add trigger" — trigger type, threshold, action; backend + UI. |
| B13 | **Safety triggers: test (dry run)** | "Test trigger" — check karo threshold hit hota ya nahi, action run mat karo. |
| B14 | **Safety triggers: actual automation** | Background job/cron jo thresholds check kare (queue backlog, RPC failure rate, etc.) aur enabled triggers ke hisaab se action run kare. |

---

## C. Global (Saare modules par)

| # | Task | Detail |
|---|------|--------|
| C1 | **WebSocket invalidation** | Admin-control aur settings/system pe jo queries hain, unhe WebSocket events se invalidate (e.g. control_status_changed, config_updated). |
| C2 | **RBAC for control & settings** | Permissions define karo: e.g. `control:emergency`, `control:circuit`, `settings:system`; backend check + frontend pe permission ke hisaab se buttons hide/disable. |
| C3 | **Central Audit log page** | Ek "Audit log" page: filters — module, action, admin, date; saare admin actions (audit_logs / audit_logs_immutable) list + export. |
| C4 | **Export pattern standardise** | Tables (incidents, events, history, alerts, etc.) ke liye common CSV/JSON export component ya helper. |
| C5 | **Error handling** | Failed mutations pe toast ya inline error message; jahan sensible ho wahan "Retry" option. |

---

## Priority / Order suggestion

**Pehle (quick wins):**
- A4 (limits validation)
- A6 (diff highlight)
- A7 (Save to profile)
- B10 (emergency level description)
- B11 (safety trigger edit in UI)

**Phir (UX):**
- A1, A2 (bulk + filter features)
- A5, B8 (history/timeline filters)
- B4, B7 (export)
- C4, C5 (export + errors)

**Phir (realtime + power features):**
- B1, B5, B9 (WebSocket / live data)
- B2 (create incident)
- B3 (command last run)
- B14 (safety automation job)
- C1, C2, C3 (WebSocket invalidation, RBAC, audit page)

**Last (advanced):**
- A3 (import/export settings)
- A8 (dependency CRUD)
- A9 (config audit view)
- B6 (real service status)
- B12, B13 (add trigger, test trigger)

---

## Checklist (copy-paste use ke liye)

```
Settings/Config:
[ ] A1 Bulk feature toggle
[ ] A2 Feature search/filter
[ ] A3 Export/import settings
[ ] A4 Limits validation
[ ] A5 Version history filters
[ ] A6 Diff highlight
[ ] A7 Save to profile
[ ] A8 Dependency CRUD
[ ] A9 Config audit view

Control Panel:
[ ] B1 WebSocket status/health
[ ] B2 Create incident
[ ] B3 Command last run
[ ] B4 Event log filter + export
[ ] B5 Health live + breakdown
[ ] B6 Real service status
[ ] B7 Freeze history filter + export
[ ] B8 Circuit history filter
[ ] B9 Timeline filter + load more + realtime
[ ] B10 Emergency level description
[ ] B11 Safety trigger edit UI
[ ] B12 Add new trigger
[ ] B13 Test trigger
[ ] B14 Safety automation job

Global:
[ ] C1 WebSocket invalidation
[ ] C2 RBAC control & settings
[ ] C3 Central audit log page
[ ] C4 Export pattern
[ ] C5 Error handling
```

Is list ko `REMAINING_TASKS_LIST.md` mein save kar diya hai — iske hisaab se ek ek karke improve kar sakte ho.
