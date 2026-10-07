# Testing

```bash
npm run test:run   # vitest; islands opt into jsdom per file via a @vitest-environment docblock
composer test      # phpunit
```

CI (`_build.yml`) runs both suites, plus type-check, `lint:primitives` and build, on
every run.

## Test environment against the current tds-shared

tds-shared is a **peer** dependency, so a fresh standalone install may resolve an old
version while every product build composes the current one. Keep these in mind:

- `apiFetch` first consults the host runtime config (`/tds-runtime.json`), so
  `fetch.mock.calls[0]` is that probe. Call **`primeRuntimeConfig(null)`** in
  `beforeEach`; panel products never ship that file, so "absent" matches production.
- `apiFetch` is **async**. `await waitFor(() => expect(fetch).toHaveBeenCalled())`
  before reading `mock.calls`.
- A multipart upload carries an **empty** `headers` object. Assert "no content-type
  header", never "headers is undefined".
- Error-path tests answer with a **populated** body and a non-OK status. Against an
  empty error body the ok-check is unobservable.
- At least one assertion per suite pins the **absolute API host** (see
  [frontend-conventions.md](frontend-conventions.md#api-calls-apifetch-never-a-relative-fetch)).

## Suites

| Suite | Sharpest assertions |
|---|---|
| `islands/grouping.test.ts` | Registrable-domain reduction (subdomains collapse, two-label suffixes survive, unknown suffix degrades to a coarser heading); grouping preserves server order |
| `islands/ContactInbox.test.tsx` | Absolute API host; non-OK never shows submitter data; triage PATCH sends the requested status; reload keeps the current filter; reply 503 vs other failures |
| `islands/WidgetBody.test.tsx` | Unanswered-request count, `Number()` coercion asserted with `"05"` |
| `src/index.test.ts` + `tests/packaging.test.ts` | Manifest as a product build sees it; specifiers ship; version stays in the **0.2** line |
| `php/tests/ContactTicketsModuleTest.php` | Public submit validation, honeypot, inbox/reply RBAC, all without a DB (paths short-circuit before repo/mailer) |
| `php/tests/ContactTicketsApiDocsTest.php` | API-doc parity |

DB-backed PHP tests skip without `TDS_TEST_DB_DSN`.

Three tests exist because the obvious versions were blind:

- Widget coercion is invisible against `"5"`, so it uses `"05"`.
- Clearing a stale error before a retry is only visible if asserted **while the retry is in
  flight**.
- The detail view's ok-check had no test at all.

Mutation check: 44 breakages, 44 caught.

### Version line

`tds-admin-frontend` caret-pins `^0.2.x`, and under 0.x a caret means `<0.3.0`. Extensions
don't all live in 0.1.x; the rule is: never leave the minor line your consumers pin.
