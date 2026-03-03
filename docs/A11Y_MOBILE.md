# Accessibility and mobile

Short checklist for accessibility and mobile-friendly UX. Use this for a deeper pass when needed.

---

## Current state

- **Spot order entry:** Buy/Sell buttons have `aria-label` and `aria-pressed`; price, quantity, trigger price inputs have `aria-label`; Place order button has `aria-label` and `aria-busy`. Percent and Max buttons have `aria-label`.
- **Fee tier card:** Volume tier block has `aria-label="Spot volume fee tier"`.
- **Layout:** Responsive layout across dashboard and trading; breakpoints and touch targets can be refined.

---

## Recommended improvements

1. **Keyboard:** Ensure tab order is logical on spot/P2P order forms; focus trap in modals.
2. **Focus visible:** Use `focus-visible:ring` or similar so keyboard users see focus.
3. **Touch targets:** Minimum 44×44px for primary actions on mobile (buttons, links).
4. **Labels:** Ensure all form inputs have associated `<label>` or `aria-label`; error messages linked with `aria-describedby`.
5. **Live regions:** For order fill / toast notifications, use `aria-live="polite"` where appropriate.
6. **P2P order / chat:** Add `aria-label` on chat input and send button; order action buttons (Confirm, Release, etc.) clearly labeled.

---

## Mobile

- Test spot and P2P flows on small viewports (e.g. 375px).
- Consider a simplified “mobile” order form (e.g. full-width, stacked) if the current grid is cramped.
- Ensure bottom sheets or modals don’t trap focus and can be closed with Escape or back.
