# tds-ext-contact-tickets-pkg

The **contact-form inbox** as a frontend extension. The public marketing site's
contact form submits to a **public endpoint**; each submission becomes a
`contact_message` an admin triages in the frontend. Standalone — its own table,
separate from the support-ticket system.

## Surface (checkpoint-1)

- **Public:** `POST /contact` — no auth; validated (name≥2, valid email,
  message≥20) + honeypot (`website` field) guarded; stores the message and (best-
  effort) notifies the admin via the **core Mailer** (`CONTACT_ADMIN_EMAIL`,
  Reply-To the submitter).
- **Admin inbox** (`contact:read` / `contact:write`): `GET /contact/summary`
  (the "Neue Anfragen" widget), `GET /contact/messages`,
  `GET /contact/messages/{id}`, `POST /contact/messages/{id}/reply`,
  `PATCH /contact/messages/{id}` (status new → handled | spam).
- **Frontend:** nav "Kontaktanfragen" → `/kontakt`, the inbox, the new-requests
  widget, DE/EN i18n.

### `GET /contact/messages` — filter, search, sort

| Param | Values | Default |
|---|---|---|
| `status` | `new` · `handled` · `spam` | all |
| `q` | free text over name / email / company / subject | — |
| `sort` | `created_at` · `name` · `email` · `company` · `status` | `created_at` |
| `dir` | `asc` · `desc` | `desc` |
| `limit` | 1–500 | 200 |

Everything goes through an allow-list, and an unknown value falls back to the
default rather than 422-ing — these come from chips and selects, so a bad one
means a stale bookmark. Rows carry an `excerpt` (first 160 characters of the
body) because the public form collects **no subject**, so without it every row
reads "Ohne Betreff" and has to be opened before it can be triaged. The response
echoes the effective `query` back, so a client can tell "no results" from "the
server ignored my filter".

### Grouping

Client-side, over the rows the server returned: **E-Mail · Name · Firma ·
Hauptdomain**. `islands/grouping.ts` resolves the registrable domain
(`a@mail.firma.co.uk` → `firma.co.uk`) with a small hand-kept list of two-label
public suffixes rather than a Public Suffix List dependency, and flags freemail
hosts so ten `gmx.de` addresses do not read as one company. If the 500-row cap
is ever reached, the groups describe the **truncated** list.

### Live notifications

The module implements the contract's `NotificationSource`, so a new request
shows up as a toast on any panel page (via the shell's single `/me/notifications`
poll) and the open inbox and dashboard widget refresh themselves on the
`tds:notification` window event.

## Still to port (later checkpoints)

Optional forwarding to the support-ticket system, and per-message spam
heuristics.

## Develop

```bash
npm install        # pulls tds-frontend-contract from GitHub Packages (needs NPM_TOKEN)
npm run build && npm run type-check
composer install   # resolves tds-frontend-contract from its public VCS repo
composer test      # phpunit — route/RBAC/validation coverage; DB tests skip without TDS_TEST_DB_DSN
```

## Enable it

Host `astro.config.mjs`: add the manifest to `frontendHost({ extensions: [...] })`.
Base API: add `new ContactTicketsModule()` to `Modules::enabled()`. Set
`CONTACT_ADMIN_EMAIL` (+ the core `MAIL_DSN`) for submission notifications.
