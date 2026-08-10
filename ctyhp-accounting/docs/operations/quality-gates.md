# Quality gate operations

The quality harness measures the existing production build without changing application code. It has a static bundle tier and an authenticated, read-only browser tier. Run commands from the `ctyhp-accounting` project root.

## Prerequisites and server ownership

- Use Node 22 LTS version 22.9.0 or later, or Node 24 or later. The runtime command relies on `--env-file-if-exists`, which was added in Node 22.9; CI currently uses Node 22.
- Install the project dependencies and the Playwright Chromium browser used by this repository.
- Run `npm run build` before bundle analysis or before starting a local production server. `quality:bundle` reads `.next`; it does not build the application.
- Run runtime checks against either that built local server or an approved QA/preview URL. Do not use `npm run dev` as runtime evidence.
- Configure `QUALITY_BASE_URL` and authentication in `.env.local`. `quality:runtime` loads that file when it exists. Authentication always needs the public Supabase URL and anonymous key. It resolves the email and password independently, preferring each `SMOKE_*` variable over its corresponding `E2E_*` fallback; when both resolved values are present it uses password sign-in. Otherwise, an explicitly approved local service-role key mints a session for the resolved email or the first active administrator. Use dedicated `SMOKE_*` credentials for QA and CI and never give the runtime workflow a service-role key.
- Leave `QUALITY_DATABASE_URL` empty unless a separately approved, non-production QA database and audit window are available.

For a local run, start the built server in a separate foreground terminal:

```powershell
npm run build
npm start
```

Wait until the server is listening, run the quality command from another terminal, and then stop the exact `npm start` process with `Ctrl+C`. The operator or automation that starts the server owns its cleanup. The quality harness starts and closes Chromium, but it never starts or stops the application server. Automation must retain the exact process handle/PID it started, stop and wait for that process and its descendants in a `finally` path, and confirm the port is no longer listening. Do not use a name-based process kill.

When using an approved QA/preview server, its owner remains responsible for that server's lifecycle; the quality command only connects to `QUALITY_BASE_URL`.

## Command surface

| Command | Purpose and prerequisites |
| --- | --- |
| `npm run quality:bundle` | Read the existing `.next` Turbopack manifests, measure route/shared browser JavaScript, write `bundle.json`, and refresh the aggregate summaries. A missing, incomplete, escaping, or unreadable manifest/chunk fails the command. |
| `npm run quality:runtime` | Authenticate, launch headless Chromium, run keyboard, Axe, viewport, route, and performance checks, optionally sample query timing, then refresh the aggregate summaries. A built server or approved QA/preview server must already be available. |
| `npm run quality:report` | Re-aggregate the section JSON files already in `.quality-results/` and rewrite `summary.json` and `summary.md`. It does not rerun a build, browser audit, or database query. |
| `npm run quality:all` | Run bundle analysis and then runtime analysis with `&&`. It assumes both a fresh build and an already-running built/QA server; it does not manage the server. A bundle failure prevents the runtime command from starting. |
| `npm run quality:accept-baseline` | After explicit human review, convert `.quality-results/summary.json` into `tests/quality/baseline.json`. It is fail-closed unless the exact one-time opt-in is set. |

`quality:report` also accepts alternate paths when diagnosing copied artifacts:

```powershell
npm run quality:report -- <results-directory> [baseline-file]
```

The aggregate represents the section JSON files currently present in the selected results directory. Check their timestamps and provenance before treating a mixed or copied directory as one run.

## Exit semantics

`QUALITY_MODE=report` is the default. In report mode, ordinary quality debt is recorded but does not make the command fail. This includes Axe violations, keyboard assertion failures, viewport findings, failed non-document subresources, informational performance-budget findings, unavailable browser metrics, and unavailable/advisory query timing.

Report mode is not "always green." It exits non-zero for a safety failure or a harness/configuration failure. Bundle-manifest failures and malformed or missing report artifacts also fail. `quality:report` preserves any safety failures already recorded in its input artifacts and exits non-zero for them.

`QUALITY_MODE=regression` additionally requires a valid accepted baseline. It exits non-zero for a new finding fingerprint or a blocking bundle/performance regression. Query regressions remain advisory and do not block. A missing or malformed regression baseline is a harness error.

## Read-only boundary and safety failures

Browser contexts are created with service workers blocked. Only `GET`, `HEAD`, and `OPTIONS` requests may leave the browser. Any `POST`, `PUT`, `PATCH`, `DELETE`, or unknown method is aborted and makes the run fail. Authentication happens before the guarded browser context is created.

The runtime currently records these safety-failure kinds:

| Kind | Recorded condition |
| --- | --- |
| `auth` | Smoke-session authentication fails, or an audited navigation lands on canonical `/login`. |
| `document-navigation` | A main-document navigation returns an unsuccessful/non-2xx status or otherwise lacks a valid success status in the route audit. |
| `error-boundary` | The application renders its `We could not load this page` error boundary. |
| `page-error` | Playwright observes an uncaught page error, including one arriving immediately before guard assertion and cleanup. |
| `blocked-method` | The read-only route guard aborts a non-allowed browser request. |
| `blocked-<method>` | The keyboard observer sees a non-read request, for example `blocked-post`; the route guard also remains authoritative and records the blocked write. |
| `page-crash` | The page crashes during a keyboard scenario. |
| `page-closed` | The keyboard page closes before all scenarios and final safety checks complete. Normal context cleanup after completion is not a failure. |
| `navigation-render` | A keyboard navigation or expected main-content render does not complete within its bounded wait. |
| `harness-error` | An unexpected keyboard/Playwright API failure occurs rather than an expected user-facing keyboard assertion failure. |
| `route-audit` | A scheduled Axe/viewport route audit throws, times out, or cannot complete its artifact work. |
| `performance-audit` | A route's warm-up or measured performance audit throws or cannot complete. |
| `runtime-harness` | Runtime setup or orchestration fails, including invalid base URL/route selection, route discovery, browser launch, or another unexpected runtime error. |
| `cleanup` | Closing Chromium or another runtime resource fails. This does not refer to the separately owned application server. |

The runtime command also fails directly if its owned `.quality-results` or screenshot roots are missing, linked/reparse targets, non-directories, or escape physical containment. Invalid `QUALITY_MODE`, a base URL with a protocol other than HTTP(S), an unknown `QUALITY_ONLY` route, or no selected static route is a configuration/harness failure. These conditions may be rejected before a normal section result can be recorded.

An expected keyboard usability assertion is a `keyboard` finding, not a safety failure. Never weaken an assertion or accept a baseline merely to turn that finding green.

## Runtime schedule

Static authenticated routes are discovered recursively under `app/(app)`. Directories whose name starts with `[` are dynamic and are not auto-scheduled.

Every discovered non-matrix route receives an Axe audit at desktop size. These representative routes receive both Axe and viewport checks at all four sizes:

- `/dashboard`
- `/sales`
- `/invoices`
- `/purchases`
- `/bills`
- `/banking`
- `/accounting`
- `/accounts`
- `/reports`
- `/settings`
- `/settings/import`
- `/approvals`

| Viewport name | Width | Height |
| --- | ---: | ---: |
| `mobile` | 375 | 812 |
| `tablet-portrait` | 768 | 1024 |
| `compact-desktop` | 1024 | 768 |
| `desktop` | 1440 | 900 |

After the scheduled accessibility/viewport sweep is safety-clean, every selected static route receives desktop performance collection: one warm-up navigation followed by exactly three measured navigations, summarized by the median. Unsupported or incomplete metrics are written to `unavailable` rather than coerced to zero.

The eight non-mutating keyboard scenarios run before the route sweep. They cover the skip link, desktop navigation, mobile navigation, account/New menus without choosing an item, global search, report-center controls, the guide drawer, and import controls without selecting or uploading a file. Keyboard runs even when `QUALITY_ONLY` contains a route subset. Set `QUALITY_ONLY=keyboard` to run only the keyboard phase; otherwise a comma-separated `QUALITY_ONLY` value must name discovered static routes.

The latest live evidence has five genuine report-only keyboard findings: `desktop-navigation`, `mobile-navigation`, `global-search-focus`, `guide-drawer`, and `import-controls`. They are UI findings to investigate, not harness safety failures, and this operations task does not fix or suppress them.

## Artifacts and sensitivity

All generated output is under the ignored project-root `.quality-results/` directory.

| Artifact | Contents |
| --- | --- |
| `bundle.json` | Per-route, per-chunk, shared, and total raw/gzip JavaScript sizes; chunk hashes and bundle measurements. |
| `axe.json` | Sanitized Axe finding records. |
| `keyboard.json` | Eight scenario results plus report-only keyboard findings and keyboard safety failures. |
| `viewports.json` | Matrix snapshots and document overflow, clipping, shell-overlap, and target-size findings. Designated internal table/modal/drawer scrolling is counted separately from document overflow. |
| `web-vitals.json` | Route medians, informational performance findings, and unavailable metrics. |
| `routes.json` | Scheduled route/status records, sanitized non-document request findings, and runtime safety failures. |
| `queries.json` | Query sampler availability or sanitized query deltas and advisory measurements. It is written even when query timing is unavailable. |
| `screenshots/*.png` | Full-page evidence only when an Axe/viewport page audit has findings. |
| `summary.json` and `summary.md` | Recursively sanitized aggregate counts and section results; regression comparison is included in regression mode. |

JSON and Markdown serialization redacts credential-shaped keys and values, authorization/cookie material, database URLs, HTML-shaped content, and URL query strings. Network findings retain only a sanitized path, and DOM targets use structural tag/role/type/ordinal tokens rather than customer-shaped IDs, classes, or raw selectors. Normalized SQL replaces string, numeric, boolean, and null literals and removes comments.

Redaction is defense in depth, not permission to publish artifacts. Screenshots are not content-redacted and may show customer/business data. Treat the entire directory as sensitive local/CI output: never commit it, never paste or upload it without review, and restrict CI artifact access and retention. The Git ignore rule is not an access-control boundary.

The accepted baseline is different: `tests/quality/baseline.json` is intended for review and commit. It contains only finding fingerprints, scalar measurement baselines, and numeric budgets—not screenshots, raw HTML, credentials, or customer values.

## Optional QA-only query timing

Leave `QUALITY_DATABASE_URL` empty for normal local work. The runtime then writes `queries.json` with `available: false` and reason `QUALITY_DATABASE_URL is not configured`; the rest of the audit continues.

For a separately approved QA database only, set `QUALITY_DATABASE_URL` to a least-privilege connection where `pg_stat_statements` can be read. Never point it at production. The sampler opens one bounded pool connection and takes its first snapshot before authentication and keyboard work begin. Its final snapshot runs after the route/performance phases and browser cleanup, so the delta spans the entire runtime audit rather than only the route sweep. It then computes non-negative deltas and closes the pool. It never resets statistics or changes database settings.

Pool construction, snapshot, extension/permission, idle-connection, final-read, and pool-close errors produce a redacted `Query timing is unavailable` result rather than a runtime safety failure. Query measurements and regressions remain advisory because `pg_stat_statements` is shared state; do not promote them to blocking until a dedicated QA database and isolated audit window exist.

## Investigate before changing the baseline

When a run reports a new finding or regression:

1. Do not run baseline acceptance.
2. Check `summary.md`, the originating section JSON, route/viewport, safety failures, unavailable metrics, and any screenshot. Confirm the artifacts all belong to the same run.
3. Reproduce in report mode. Use `QUALITY_ONLY=keyboard` for keyboard work or a discovered comma-separated route subset for route work. Repeat performance/query evidence when machine, network, or shared-database noise is plausible.
4. Inspect the built UI and server logs without activating mutating controls. Distinguish a real application finding from an authentication, environment, harness, or cleanup failure.
5. Fix the application or harness in its own reviewed task, rerun the focused check and the relevant full quality command, and confirm the finding is understood. Existing genuine keyboard findings remain findings until UI owners remediate them.
6. Change the baseline only when the whole reviewed result is an intentional new reference state—not to silence an unexplained failure.

## Baseline review, acceptance, and promotion

Establish a baseline only after several stable report-mode runs. Review `summary.md`, every section artifact, every unavailable record and safety failure, all screenshots, measurement noise, and the known findings. There must be no unexplained safety or harness failure.

Baseline acceptance requires the exact opt-in value `ONEBOOK_REVIEWED_QUALITY_BASELINE`. Set it for one command only and remove it even if the command fails:

```powershell
$env:QUALITY_ACCEPT_BASELINE = 'ONEBOOK_REVIEWED_QUALITY_BASELINE'
try {
  npm run quality:accept-baseline
} finally {
  Remove-Item Env:QUALITY_ACCEPT_BASELINE -ErrorAction SilentlyContinue
}
```

The command reads `.quality-results/summary.json` and atomically writes `tests/quality/baseline.json`. A normal bundle, runtime, report, or all run never rewrites that baseline. Review the baseline diff before committing it.

Promotion to a blocking regression gate is a separate decision:

1. Commit the reviewed baseline.
2. Set `QUALITY_MODE=regression` only in the local/CI jobs chosen for enforcement.
3. Confirm new finding fingerprints and material bundle/performance regressions fail, while known baseline findings remain visible.
4. Keep query regressions advisory until the QA workload is isolated.
5. Preserve the report artifacts on both success and failure so the cause is reviewable.

Do not leave `QUALITY_ACCEPT_BASELINE` populated in `.env.local`, CI variables, or a shell after the one reviewed acceptance.
