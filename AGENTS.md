# AGENTS.md — tds-ext-contact-tickets-pkg

The public contact-form inbox. Read `tds-frontend-contract-pkg` + `tds-core-frontend-api`
AGENTS first. Standalone — NOT the support-ticket system (separate `contact_message`
table); support-tickets also has a `/tickets/contact` ingest, but this extension
is the dedicated public inbox.

## Model

- **`POST /contact` is PUBLIC** (no auth) — the marketing form posts here. It's
  the only unauthenticated write in the platform, so it's kept tight: validation +
  honeypot (`website`) + **IP-hash rate-limit** (max 5 / IP / 10 min → 429). The IP
  is only ever stored as a salted SHA-256 (`ip_hash`, `CONTACT_RATE_SALT` else
  `SETTINGS_ENCRYPTION_KEY`); never the raw IP, and it's stripped from the detail API.
- Admin inbox gated by `contact:read` / `contact:write` (admins bypass) via the
  core UserContext. `status` moves new → handled | spam.
- **Admin reply** (`POST /contact/messages/{id}/reply`, `contact:write`) emails the
  submitter via the **core Mailer**, stores the reply in `contact_reply` (shown in the
  detail view), and moves a `new` message to `handled`. 503 when the Mailer is
  unconfigured. Admin notification on new submissions also via the core Mailer
  (`CONTACT_ADMIN_EMAIL`, else `TICKET_ADMIN_EMAIL`; Reply-To = the submitter).

## Gotchas

- **Never call the API with a relative path — always `apiFetch` from
  `@tracht-digital-solutions/tds-shared/api`.** This is the bug that made the
  whole inbox look empty: the panel is a static site on `management.…`, the API
  is `api.…`, and the static host answers an unknown path with its SPA fallback
  — **200 + HTML**. So `res.ok` was `true`, `res.json()` threw, and
  `.catch(() => setMessages([]))` rendered "Keine Anfragen." forever with the
  rows sitting in `contact_message`. Nothing logged it. `ContactInbox.test.tsx`
  now pins the absolute host explicitly, because a relative path passes every
  behavioural assertion in a mocked-fetch test.
- **`PATCH` had to be added to the core's CORS allow-list** for triage to work
  at all cross-origin (`tds-core-frontend-api` `CorsMiddleware`). A method
  missing there fails at the preflight: the button does nothing and the network
  tab shows an OPTIONS where you expect a PATCH.
- **A failed load is an in-flow alert, not an empty list.** "Keine Anfragen." for
  a 500 is how the original bug hid for months; the island distinguishes
  failure / no-results-for-this-search / genuinely-empty.
- **Sorting goes through `ContactRepository::SORTABLE`, never a query
  parameter.** There is no other dynamic `ORDER BY` in this codebase and there
  should not be one; the `q` search also escapes `%`/`_` so a search for "50%"
  does not match everything.
- **`notifications()` resolves the repository from the container captured in
  `register()`**, because it is called outside a route and has no `$app`. It
  must never throw (a first-boot service has no DB) — the base's feed, and with
  it the shell's poll on *every* page, matters more than this module's events.
  The cursor is the highest `contact_message.id` and only advances past rows
  actually handed over, so a burst larger than `NOTIFY_MAX` is not skipped.
- **The reply outcome is a toast (tds-shared `>=0.16.0`); the two things that
  are NOT outcomes stay in-flow** — "Antwort darf nicht leer sein." (validation,
  next to the box it is about) and "E-Mail-Versand ist nicht konfiguriert."
  (something an operator has to go and set). That banner is `.tds-alert--danger`
  now. Never mount a `ToastHost` here; the frontend host owns the one.

- Migration class names are **module-prefixed** (`ContactTickets*`) AND the
  numeric **version prefixes are globally unique** (this module owns the
  `20260726*` band) — every composed module's migrations share one `phinxlog`,
  so a reused class name OR version collides. Keep new migrations in this band.
- Routes are closures resolving `ContactRepository`/`Mailer`/`UserContext` from
  the container at request time (rebound per request by the core AuthMiddleware).
- DB-backed tests skip without `TDS_TEST_DB_DSN`; the committed test covers the
  public submit validation + honeypot + inbox/reply RBAC without a DB (all tested
  paths short-circuit at auth/validation before the repo/mailer).

## Checkpoint status

- **CP1:** `contact_message` schema, `Domain\ContactRepository`, public submit +
  admin inbox CRUD/status with RBAC, notify-admin via core Mailer, inbox UI +
  widget.
- **CP2:** `contact_reply` table + `ip_hash` column; IP-hash rate-limit on the
  public submit (429); admin reply-by-email endpoint (core Mailer → `contact_reply`
  → auto-handle); frontend detail view (full body + reply history + compose).
- **CP3:** the transport fix (`apiFetch`) that made the inbox visible at all;
  `GET /contact/messages` gains `q`/`sort`/`dir`/`limit` + an `excerpt`;
  client-side grouping (email/name/company/registrable domain, freemail-flagged);
  `NotificationSource` so a new request toasts live and refreshes the open list.
- **TODO (next):** optional forward to support-tickets; per-message spam heuristics.

## Tests

```bash
npm run test:run    # vitest, 85 tests (jsdom per-file via a @vitest-environment docblock)
```

- `islands/grouping.test.ts` — the registrable-domain reduction (subdomains
  collapse, two-label suffixes survive, an unknown suffix degrades to a coarser
  heading rather than a wrong group) and that grouping PRESERVES the server's
  order: re-sorting groups alphabetically would silently override the sort the
  user just picked.
- `islands/ContactInbox.test.tsx` — triage + the detail view + the email reply.
  Every message came from a stranger on the public marketing site, so a non-OK
  response is asserted never to put their name, address or words on screen.
  Beyond that: the triage PATCH sends the status that was *asked for* and the
  reload afterwards keeps the **current filter** (reloading under a hardcoded
  one swaps the list out from under the highlighted chip), and the reply
  distinguishes **503 "mail not configured"** from any other failure — the
  first means the answer was never sent and will not be until the host is
  fixed, which does not belong under a generic error.
- `islands/WidgetBody.test.tsx` — the unanswered-request count.
- `src/index.test.ts` + `tests/packaging.test.ts` — the manifest as a product
  build sees it, and that every specifier resolves, is exported, and ships.

Error-path tests deliberately answer with a POPULATED body and a non-OK status.
Against an EMPTY error body `r.ok ? r.json() : { messages: [] }` and a bare
`r.json()` are indistinguishable, so the ok-check could be deleted with no test
noticing.

`tests/packaging.test.ts` pins the version to the **0.2** line — `tds-admin-frontend`
caret-pins `^0.2.1`, and under 0.x a caret means `>=0.2.1 <0.3.0`. (The root
`CLAUDE.md` says all extensions stay in `0.1.x`; that is not universal — this
one is 0.2.x and support-tickets is 0.7.x. The real rule is: never leave the
minor line your consumers pin.)

Three tests exist only because the mutation pass proved the obvious versions
blind: the widget's `Number()` coercion is invisible against `"5"` (it uses a
zero-padded `"05"` instead), clearing a stale error before a retry is invisible
unless asserted **while the retry is in flight**, and the detail view's ok-check
had no test at all.

> **Behaviour worth knowing:** a failed detail load leaves the view on its
> "Wird geladen …" line forever — pinned as-is rather than changed in a
> test-only pass, but a real error state would be friendlier. Likewise
> `WidgetBody` shows `0` on a failure where the lexware/time-tracker widgets
> show `—`.

Verified by mutation: 44 deliberate breakages introduced, 44 caught.

## After a change

Bump `version` in `package.json` + `composer.json` (lockstep), update docs, commit.

## API-Referenz (`php/docs/api.php`)

This module implements the contract's optional `ApiDocSource`: `php/docs/api.php`
returns one entry per route (summary, params, responses, required permission),
and the admin frontend's API reference joins it onto the introspected Slim routes
by `"<METHOD> <pattern>"`. Two things to know before editing a route:

- **`pattern` must be the Slim pattern verbatim**, inline regex included
  (`/contact/messages/{id:[0-9]+}`). A prettified path silently produces an orphan doc *and* an
  undocumented route rather than an error.
- **`php/tests/ContactTicketsApiDocsTest.php` asserts both directions** — the documented
  set and the registered set must be the same set, every path placeholder must
  be described, and a named permission must exist in `permissions()`. Adding or
  renaming a route without touching `docs/api.php` fails there. That is the
  point: prose next to code rots, and a reference full of confident, wrong
  detail is worse than the bare route list it replaced.
