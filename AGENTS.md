# AGENTS.md — tds-ext-contact-tickets-pkg

Frontend extension for the **public contact-form inbox**. The marketing site posts to
`POST /contact`; admins triage, search and reply by email in the panel. It contributes a
PHP `Module` to `tds-core-frontend-api` and the inbox route, a widget and live
notifications to the admin product.

Standalone: this is **not** the support-ticket system (separate `contact_message` table).
`tds-ext-support-tickets-pkg` has its own `/tickets/contact` ingest.

Read `tds-frontend-contract-pkg/AGENTS.md` and `tds-core-frontend-api/AGENTS.md` first.

## Commands

```bash
npm install --no-package-lock   # never npm ci
npm run type-check
npm run lint:primitives
npm run test:run                # vitest
npm run build                   # tsup
composer install && composer test   # phpunit; DB-backed tests need TDS_TEST_DB_DSN
```

## Hard rules

- `POST /contact` is the platform's only unauthenticated write: keep validation, honeypot and rate limit.
- Store the IP only as a salted hash; never return it from the API.
- Sorting goes through `ContactRepository::SORTABLE`, never a raw query parameter.
- `notifications()` must never throw.
- A failed load is an in-flow alert, never an empty list.
- Call the API with `apiFetch`, never a relative `fetch`. Never mount a `ToastHost`.
- Every route change updates `php/docs/api.php`. New migrations stay in the `20260726*` band.
- Stay in the `0.2.x` line (`tds-admin-frontend` pins `^0.2.x`). Versions move via the release workflow only.

## Topic files

| File | Read before |
|---|---|
| [docs/agents/architecture.md](docs/agents/architecture.md) | Changing routes, the public submit, replies, notifications or search |
| [docs/agents/backend.md](docs/agents/backend.md) | Touching PHP, migrations or `php/docs/api.php` |
| [docs/agents/frontend-conventions.md](docs/agents/frontend-conventions.md) | Touching any island, page or widget markup |
| [docs/agents/testing.md](docs/agents/testing.md) | Writing or changing tests |
| [docs/agents/release.md](docs/agents/release.md) | Releasing or changing CI |

Workspace rules: `../CLAUDE.md`. Cross-repo state: `../MIGRATION-STATUS.md`.
