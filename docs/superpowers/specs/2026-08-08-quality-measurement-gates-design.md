# Quality measurement and regression gates — design

Date: 2026-08-08
Status: Approved for implementation planning
Scope: Accessibility, keyboard operation, Web Vitals, route/query timing, bundle analysis, and responsive viewport checks

## 1. Goal

Add a repeatable quality-measurement layer for the whole One Book application without changing accounting behaviour or writing business data.

The first release records a baseline and publishes reports. It does not fail CI for an existing quality issue. After the baseline has been reviewed, the same tools become regression gates: a change fails only when it introduces a new issue or exceeds an agreed budget.

The work must not modify:

- accounting domain rules;
- posting builders or ledger behaviour;
- application services that create, update, post, void, reconcile, import, or approve records;
- Supabase RPCs, RLS, triggers, or migrations;
- production data.

## 2. Chosen approach

Three approaches were considered.

### A. Local-only scripts

This is the smallest change and needs no CI credentials. It is safe but cannot prevent regressions consistently because running it depends on a developer remembering to do so.

### B. Two-tier report-only then regression gate — chosen

The static tier runs after every CI build without a database. The runtime tier uses an authenticated, read-only browser sweep against a built local server or an approved QA/preview deployment. Both produce machine-readable and human-readable artifacts.

Existing issues are reported first. Once the baseline is accepted, only new regressions block CI.

### C. Production runtime telemetry

This would provide the most representative field data, but it adds instrumentation to the production bundle and introduces operational and privacy decisions. It is outside this scope because the stated priority is measurement without affecting the application runtime or business behaviour.

## 3. Architecture

```text
                         npm run build
                               │
                  ┌────────────┴────────────┐
                  │                         │
          Static quality tier       Runtime quality tier
                  │                         │
          Bundle manifest          Built server / QA URL
                  │                         │
          Bundle report         Authenticated read-only session
                  │                         │
                  │              ┌──────────┼───────────┐
                  │              │          │           │
                  │             Axe      Keyboard    Viewports
                  │              │          │           │
                  │              └────── Web/route metrics
                  │                         │
                  │              Optional pg_stat_statements
                  │                         │
                  └────────────┬────────────┘
                               │
                   JSON + Markdown artifacts
                               │
                 Report-only baseline comparison
                               │
              Later: fail only on new regressions
```

All quality code lives under test, script, configuration, and workflow paths. Runtime application code is not instrumented.

## 4. Safety boundary

### 4.1. Authenticated but read-only

The runtime audit reuses the existing smoke-session mechanism. It signs in as an administrator so protected pages render, but the browser harness installs a request guard before visiting application routes.

Allowed browser requests:

- `GET`;
- `HEAD`;
- `OPTIONS`.

Blocked browser requests:

- application `POST` requests, including Server Actions;
- `PUT`, `PATCH`, and `DELETE`;
- any unknown method.

A blocked request is a safety failure, not a quality finding. The run stops and exits non-zero even during report-only mode.

Authentication is completed before the guarded browser context starts. Therefore the browser does not need a POST exception for sign-in.

### 4.2. Safe keyboard scenarios

Keyboard tests may:

- follow links;
- open and close menus, drawers, and modals;
- move between tabs and controls;
- enter text into client-side filters;
- focus and operate controls that do not trigger a Server Action;
- use Escape, Enter, Space, arrow keys, and Tab.

Keyboard tests may not activate Save, Post, Import, Issue, Approve, Void, Undo, Reconcile, Create, or other mutation controls.

### 4.3. Query timing is read-only

When an explicit QA-only `QUALITY_DATABASE_URL` is available, the harness reads `pg_stat_statements` before and after the route sweep and computes deltas. It never calls a stats reset function and never changes database settings.

If the extension or database URL is unavailable, query timing is marked `unavailable`; the rest of the runtime report still completes.

Only normalized query fingerprints, duration aggregates, call counts, and relation/function names are reported. Parameter values and customer data are not included.

## 5. Static quality tier

### 5.1. Bundle analysis

The analyzer reads artifacts produced by the existing Next.js build. It does not enable production instrumentation or change the build mode.

The report contains:

- total browser JavaScript bytes, raw and gzip;
- shared browser JavaScript bytes;
- JavaScript bytes attributable to each route when the build manifest provides that mapping;
- the largest chunks and their hashes;
- changes from the accepted baseline;
- packages or chunks newly crossing a budget.

The analyzer must fail on an unreadable or incomplete build manifest because a green report with no measurements would be misleading.

### 5.2. Initial budgets

During report-only mode, budgets are labels in the report rather than CI failures. The first accepted baseline records the real application values.

After promotion to regression mode, a bundle regression requires both:

- an increase of more than 10%; and
- an increase of more than 20 KiB gzip for the affected route or shared bundle.

Using both a percentage and an absolute floor avoids failing on noise in tiny chunks.

## 6. Runtime accessibility audit

### 6.1. Axe coverage

At desktop width, the audit discovers the same authenticated static routes as `smoke-pages.mjs` and scans every route that the administrator can open.

The four-viewport matrix runs on representative work areas:

- `/dashboard`;
- `/sales`;
- `/invoices`;
- `/purchases`;
- `/bills`;
- `/banking`;
- `/accounting`;
- `/accounts`;
- `/reports`;
- `/settings`;
- `/settings/import`;
- `/approvals`.

Dynamic routes requiring a real record ID remain outside automatic discovery. They can be added later through explicit safe fixtures.

The Axe report records:

- rule ID and impact;
- route and viewport;
- target selector;
- concise failure summary;
- count of affected nodes.

Screenshots and HTML snippets are captured only for failures and are treated as local/CI artifacts, not committed source.

### 6.2. Report-only and regression semantics

During baseline mode, Axe violations do not fail the command. Harness errors, authentication errors, render failures, and blocked write requests do fail.

After baseline acceptance, a new tuple of `rule + route + viewport + target signature` fails the regression gate. An existing violation whose affected-node count decreases is reported as an improvement.

## 7. Keyboard quality audit

The first keyboard suite covers stable, non-mutating flows:

1. Skip link moves focus to main content.
2. Desktop primary navigation can be traversed and activated by keyboard.
3. Mobile navigation opens, traps focus, closes with Escape, and returns focus to its trigger.
4. Account and New menus open and close without selecting a mutation action.
5. Global Search can receive focus and be dismissed without triggering a Server Action.
6. Report Center search/category controls are operable by keyboard.
7. A safe modal/drawer opens, traps focus, closes with Escape, and restores focus.
8. The Import type selector and file input are keyboard reachable; file upload, Preview, and Import are not activated because choosing a file starts a read-only Server Action that still uses the blocked `POST` transport.

Each scenario checks focus visibility, logical focus order, keyboard activation, Escape behaviour, and focus restoration. The suite does not assert implementation-specific DOM order beyond what a user experiences.

Keyboard failures are reported during baseline mode. A safety breach or inability to complete the harness setup fails immediately.

## 8. Viewport and overflow audit

The viewport matrix is:

| Name | Width | Height |
| --- | ---: | ---: |
| Mobile | 375 | 812 |
| Tablet portrait | 768 | 1024 |
| Tablet/compact desktop | 1024 | 768 |
| Desktop | 1440 | 900 |

For every representative route, the audit checks:

- document-level horizontal overflow;
- content hidden behind fixed shell controls;
- target controls whose bounding box is outside the viewport;
- primary interactive targets smaller than 44 by 44 CSS pixels, reported as findings;
- uncaught page errors and failed network requests;
- layout stability during the measurement window.

Wide accounting tables may scroll inside their designated table container. That is not document-level overflow and must not be reported as a failure.

## 9. Web Vitals and route timing

Metrics are collected from the browser harness, not from production application code.

For each representative route, the report records:

- navigation response time and time to first byte;
- DOM content loaded and load completion;
- largest contentful paint;
- cumulative layout shift;
- interaction latency where the browser exposes Event Timing data;
- total blocking/long-task duration;
- transferred bytes by resource type;
- failed requests.

Each performance route is measured three times after one warm-up navigation. The report uses the median to reduce machine and network noise.

Initial project budgets are informational:

- LCP: 2.5 seconds;
- CLS: 0.1;
- interaction latency: 200 milliseconds;
- common-route response time: 1 second;
- no single long task above 200 milliseconds.

After baseline acceptance, timing becomes a regression only when the median worsens by more than 20% and by more than 200 milliseconds. CLS uses an absolute increase of 0.03 because it is unitless.

## 10. Query timing

The optional database sampler calculates the delta between snapshots of `pg_stat_statements` around the read-only route sweep.

The report ranks:

- highest added total execution time;
- highest added call count;
- highest mean execution time;
- queries whose mean time materially regressed from the accepted baseline.

Because `pg_stat_statements` is shared aggregate state, results are advisory when another workload is using the same database. Query timing cannot block CI until it runs against a dedicated QA database with an isolated audit window.

## 11. Reports and baseline

Generated output is written under `.quality-results/`, which is ignored by Git.

Each run creates:

- `summary.md` — human-readable outcome and highest-priority findings;
- `axe.json`;
- `keyboard.json`;
- `viewports.json`;
- `web-vitals.json`;
- `routes.json`;
- `queries.json` when available;
- `bundle.json`;
- failure screenshots and minimal HTML snippets.

The accepted baseline is a compact, reviewable JSON document under `tests/quality/baseline.json`. It stores fingerprints and budgets, not screenshots, raw HTML, customer values, or authentication material.

Baseline acceptance is a separate explicit command. A normal quality run never rewrites the baseline.

## 12. Commands

The intended command surface is:

```text
npm run quality:bundle
npm run quality:runtime
npm run quality:report
npm run quality:all
npm run quality:accept-baseline
```

`quality:all` assumes a built server or approved QA base URL for runtime checks. The exact server lifecycle is documented rather than hidden inside the test command, matching the existing smoke-page workflow.

## 13. CI integration

### Existing pull-request CI

After `npm run build`:

1. Run bundle analysis in report-only mode.
2. Upload `.quality-results` as an artifact.
3. Do not fail on a budget finding until the baseline is accepted.
4. Continue failing on analyzer crashes or missing build output.

### Runtime quality workflow

A separate manual/scheduled workflow runs only when an approved QA/preview URL and authentication secrets are configured. It:

1. runs the authenticated read-only audit;
2. uploads reports and failure evidence;
3. starts in report-only mode;
4. later compares against the accepted baseline.

The existing CI continues to use placeholder Supabase values and therefore never receives production credentials.

## 14. Error handling

| Situation | Result |
| --- | --- |
| Existing Axe violation | Reported, command succeeds during baseline mode |
| New regression after baseline promotion | Regression command fails |
| Sign-in unavailable | Harness failure |
| A browser write request is attempted | Immediate safety failure |
| Route renders the error boundary | Harness failure |
| Build manifest missing | Bundle analyzer failure |
| `pg_stat_statements` unavailable | Query timing marked unavailable |
| Screenshot contains runtime business data | Artifact only, never committed |
| Metrics API unsupported by browser | Metric marked unsupported, other checks continue |

## 15. Verification strategy

Unit tests cover:

- route discovery;
- baseline fingerprinting and comparison;
- bundle manifest parsing;
- timing median and regression thresholds;
- write-request guard;
- report serialization with sensitive-value exclusion.

Integration tests cover:

- one synthetic Axe violation appearing in report-only output;
- one new baseline violation failing regression mode;
- one attempted POST being blocked before the request leaves the browser;
- one table with internal scrolling not being mistaken for document overflow;
- one deterministic bundle fixture producing stable byte totals.

Runtime verification covers:

- the four viewport sizes;
- all representative routes;
- all keyboard scenarios;
- full desktop Axe route discovery;
- three-run median performance collection;
- zero business-data mutations before and after the run where a QA database snapshot is available.

Existing application gates remain required:

- `npm run typecheck`;
- `npm test`;
- `npm run lint`;
- `npm run build`;
- built-server smoke sweep.

## 16. Promotion to blocking regression gates

Promotion is deliberately separate from implementation:

1. Run report-only audits enough times to establish stable results.
2. Review and accept the baseline explicitly.
3. Enable comparison mode in CI.
4. Block only new accessibility, overflow, bundle, and stable performance regressions.
5. Keep query timing advisory until a dedicated QA database removes shared-workload noise.

This prevents the new quality system from freezing delivery because of existing debt while still ensuring the debt cannot silently increase.

## 17. Definition of done

The P0 quality layer is complete when:

1. Bundle analysis runs after a production build and publishes JSON/Markdown artifacts.
2. Axe audits authenticated pages without issuing a business write.
3. Keyboard tests cover the agreed stable flows.
4. Representative routes run at all four viewport sizes.
5. Web Vitals and route timings use three-run medians.
6. Query timing is captured read-only when available and degrades explicitly when unavailable.
7. Existing quality findings do not fail baseline-mode CI.
8. Harness, authentication, render, and safety failures always fail.
9. Baseline acceptance cannot happen implicitly.
10. No accounting service, posting rule, RPC, migration, or production record is changed.
