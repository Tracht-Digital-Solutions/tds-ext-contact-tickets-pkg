# Architecture

## Routes

| Route | Gate | Purpose |
|---|---|---|
| `POST /contact` | **public** | Marketing contact form |
| `GET /contact/summary` | `contact:read` | Widget count of unanswered requests |
| `GET /contact/messages` | `contact:read` | Inbox; `q`, `sort`, `dir`, `limit`, plus an `excerpt` per row |
| `GET /contact/messages/{id:[0-9]+}` | `contact:read` | Detail with full body and reply history |
| `POST /contact/messages/{id:[0-9]+}/reply` | `contact:write` | Email reply to the submitter |
| `PATCH /contact/messages/{id:[0-9]+}` | `contact:write` | Triage: `status` new → handled / spam |

Auth is the core `UserContext` (admins bypass). Routes are closures that resolve
`ContactRepository`, `Mailer` and `UserContext` from the container at request time; the
core AuthMiddleware rebinds them per request.

## The public submit

`POST /contact` is the only unauthenticated write in the platform, so it stays tight:

- validation,
- a honeypot field (`website`),
- an **IP-hash rate limit**: max 5 per IP per 10 minutes, then **429**.

The IP is only ever stored as a salted SHA-256 (`ip_hash`). Salt: `CONTACT_RATE_SALT`,
else `SETTINGS_ENCRYPTION_KEY`. The raw IP is never stored, and `ip_hash` is stripped from
the detail API.

## Mail

- New submissions notify the admin via the core `Mailer` (`CONTACT_ADMIN_EMAIL`, else
  `TICKET_ADMIN_EMAIL`; Reply-To = the submitter).
- An admin reply emails the submitter via the core `Mailer`, stores the reply in
  `contact_reply`, and moves a `new` message to `handled`.
- An unconfigured Mailer → **503**. The island shows this distinctly ("mail not
  configured"), because the answer was never sent and won't be until the host is fixed.

## Search and sort

- Sorting goes through **`ContactRepository::SORTABLE`**, never a query parameter. There is
  no other dynamic `ORDER BY` in the codebase, and there shouldn't be.
- `q` escapes `%` and `_`, so searching for "50%" doesn't match everything.
- Client-side grouping (`islands/grouping.ts`) groups by email, name, company or registrable
  domain and flags freemail. It **preserves the server's order**; re-sorting groups would
  silently override the sort the user picked.

## Notifications

The module is a `NotificationSource`: a new request toasts live and refreshes the open list.

- `notifications()` resolves the repository from the container captured in `register()`,
  because it runs outside a route with no `$app`.
- It **must never throw** (a first-boot service has no DB). The shell polls the shared feed
  on every page; that matters more than this module's events.
- The cursor is the highest `contact_message.id` and only advances past rows actually
  handed over, so a burst larger than `NOTIFY_MAX` isn't skipped.

## CORS

Triage needs `PATCH` in the core's CORS allow-list (`tds-core-frontend-api`
`CorsMiddleware`). A missing method fails at the preflight: the button does nothing and the
network tab shows an OPTIONS where you expect a PATCH.

## Data model

- `contact_message` (with `ip_hash`) and `contact_reply`.
- Migrations `CreateContactTicketsMessage`, `AddContactTicketsReply`. Class names are
  prefixed `ContactTickets`; this module owns the `20260726*` version band.

## Frontend

- `islands/ContactInbox.tsx` — inbox, detail view, reply compose.
- A failed load is an **in-flow alert**, not an empty list. The island distinguishes
  failure, no results for this search, and genuinely empty. "Keine Anfragen." on a 500 is
  how a broken inbox once went unnoticed for months.
- The reply outcome is a toast (tds-shared `>=0.16.0`). Two non-outcomes stay in-flow:
  "Antwort darf nicht leer sein." (validation, next to the box) and
  "E-Mail-Versand ist nicht konfiguriert." (operator action), as `.tds-alert--danger`.
- A non-OK response never puts the submitter's name, address or words on screen; every
  message came from a stranger.
- After triage, the reload keeps the **current filter**.
- Motion (peer `>=0.38.2`): inbox ↔ message is a `Presence` swap, rows and replies are
  `AnimatedList` / `AnimatedItem`, status chips carry a `TabIndicator`, the validation
  banner is a `Collapse`. Leaving elements are `aria-hidden` + `inert` while they fade, so
  tests assert that rather than removal.
- The inbox is a **JSX variable, not an inner component**. A component declared inside
  `ContactInbox` is a new type each render, and the search box would lose focus on every
  keystroke.

### Known rough edges

- A failed detail load stays on "Wird geladen …" forever (pinned as is; a real error state
  would be friendlier).
- `WidgetBody` shows `0` on failure, while the lexware and time-tracker widgets show `—`.

## Open items

Optional forward to support-tickets; per-message spam heuristics.
