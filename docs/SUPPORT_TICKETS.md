# Support tickets (future)

A full support-ticket flow is **not yet implemented**. This doc describes what would be needed for a Binance-style “Help → Submit ticket” flow.

---

## Required backend

- **Table:** `support_tickets` (id, user_id, subject, status, created_at, updated_at) and `support_ticket_messages` (id, ticket_id, sender_id, sender_type: 'user'|'admin', message, created_at).
- **User API:** `POST /support/tickets` (create), `GET /support/tickets` (list own), `GET /support/tickets/:id` (detail + messages), `POST /support/tickets/:id/messages` (reply).
- **Admin API:** `GET /admin/support/tickets` (list all, filter by status), `GET /admin/support/tickets/:id`, `POST /admin/support/tickets/:id/messages` (admin reply), `PATCH /admin/support/tickets/:id` (e.g. close, assign).

---

## Frontend

- **User:** Dashboard → Help / Support → “Create ticket”, list of my tickets, ticket detail with thread of messages.
- **Admin:** Admin panel → Support → list tickets, open ticket, reply, close.

---

## Status

- **Current:** No `support_tickets` table or routes. Use this doc as a spec when implementing.
- **Optional:** Notifications (email/in-app) when a new message is added to a ticket.
