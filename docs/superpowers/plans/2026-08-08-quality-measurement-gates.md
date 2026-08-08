# Quality Measurement and Regression Gates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build report-only accessibility, keyboard, responsive, performance, query-timing, and bundle audits for all of One Book, with an explicit path to block only new regressions.

**Architecture:** A static analyzer reads the existing Next.js production build without loading application code. A separate Playwright harness signs in through the existing smoke-session helper, blocks every application mutation request, audits authenticated pages, and writes redacted JSON/Markdown artifacts. An optional QA-only PostgreSQL sampler reads `pg_stat_statements`; no runtime instrumentation is shipped in the application.

**Tech Stack:** Node.js 22, Next.js 16.2.11/Turbopack build artifacts, Playwright 1.62.1, `@axe-core/playwright`, Vitest 4.1.10, PostgreSQL `pg_stat_statements`, GitHub Actions.

## Global Constraints

- Do not change accounting domain rules, posting builders, financial services, Supabase RPCs, RLS, triggers, migrations, or production data.
- Runtime browser requests allow only `GET`, `HEAD`, and `OPTIONS`; every application `POST`, `PUT`, `PATCH`, or `DELETE` is an immediate safety failure.
- Complete authentication before installing the browser request guard.
- Do not activate Save, Post, Import, Issue, Approve, Void, Undo, Reconcile, Create, or any other mutation control.
- Do not upload an Import file: selecting a file starts a Server Action over the blocked `POST` transport.
- Keep all generated artifacts under `.quality-results/`; never commit screenshots, HTML snippets, authentication material, query parameters, or customer data.
- Start in report-only mode. Quality findings succeed; harness, authentication, build-artifact, render, and safety failures fail.
- Baseline acceptance is always an explicit command and never happens during a normal audit.
- Use the exact viewport matrix: 375×812, 768×1024, 1024×768, and 1440×900.
- Measure performance three times after one warm-up and compare medians.
- Query timing uses only the explicit QA-only `QUALITY_DATABASE_URL`, never an application database variable.
- Keep query timing advisory until it runs against a dedicated QA database.
- The product name remains **One Book** in user-visible and report text.

---

## File Structure

### Create

- `ctyhp-accounting/scripts/quality/config.mjs` — routes, viewports, budgets, modes, and result paths.
- `ctyhp-accounting/scripts/quality/routes.mjs` — static authenticated route discovery.
- `ctyhp-accounting/scripts/quality/session-cookie.mjs` — shared Supabase SSR cookie serialization for fetch and Playwright.
- `ctyhp-accounting/scripts/quality/model.mjs` — findings, fingerprints, medians, redaction, and baseline comparison.
- `ctyhp-accounting/scripts/quality/report.mjs` — atomic JSON and Markdown artifact writer.
- `ctyhp-accounting/scripts/quality/bundle.mjs` — Turbopack client-reference-manifest analyzer.
- `ctyhp-accounting/scripts/quality/browser.mjs` — authenticated Playwright context and write-request guard.
- `ctyhp-accounting/scripts/quality/page-audit.mjs` — Axe, viewport, Navigation Timing, LCP, CLS, Event Timing, and long-task collection.
- `ctyhp-accounting/scripts/quality/self-test-runtime.mjs` — isolated HTTP/Playwright proof for Axe, overflow classification, and blocked writes.
- `ctyhp-accounting/scripts/quality/keyboard.mjs` — non-mutating keyboard scenarios.
- `ctyhp-accounting/scripts/quality/query-timing.mjs` — optional read-only `pg_stat_statements` snapshots and deltas.
- `ctyhp-accounting/scripts/quality/run-bundle.mjs` — static-tier CLI.
- `ctyhp-accounting/scripts/quality/run-runtime.mjs` — runtime-tier CLI.
- `ctyhp-accounting/scripts/quality/accept-baseline.mjs` — explicit baseline writer.
- `ctyhp-accounting/tests/quality/fixtures/bundle/.next/server/app/(app)/dashboard/page_client-reference-manifest.js` — deterministic Turbopack manifest fixture.
- `ctyhp-accounting/tests/quality/fixtures/bundle/.next/static/chunks/shared.js` — deterministic shared chunk.
- `ctyhp-accounting/tests/quality/fixtures/bundle/.next/static/chunks/route.js` — deterministic route chunk.
- `ctyhp-accounting/tests/unit/quality-config.test.ts` — config and mode tests.
- `ctyhp-accounting/tests/unit/quality-routes-session.test.ts` — route and cookie tests.
- `ctyhp-accounting/tests/unit/quality-model-report.test.ts` — report, redaction, and baseline tests.
- `ctyhp-accounting/tests/unit/quality-bundle.test.ts` — bundle parser and byte-accounting tests.
- `ctyhp-accounting/tests/unit/quality-browser.test.ts` — request policy and viewport-analysis tests.
- `ctyhp-accounting/tests/unit/quality-keyboard.test.ts` — scenario registry safety tests.
- `ctyhp-accounting/tests/unit/quality-query-timing.test.ts` — query delta and redaction tests.
- `ctyhp-accounting/docs/operations/quality-gates.md` — local/CI operation and promotion guide.
- `.github/workflows/quality-runtime.yml` — manual/scheduled QA audit.

### Modify

- `ctyhp-accounting/package.json` — dependency and quality command surface.
- `ctyhp-accounting/package-lock.json` — locked Axe dependency.
- `ctyhp-accounting/.gitignore` — ignore `.quality-results/`.
- `ctyhp-accounting/.env.local.example` — document safe quality variables.
- `ctyhp-accounting/scripts/smoke-pages.mjs` — consume shared route/cookie helpers.
- `.github/workflows/ci.yml` — report-only bundle job and artifact upload after build.

### Created only by explicit baseline acceptance

- `ctyhp-accounting/tests/quality/baseline.json` — reviewed fingerprints and budgets; not created by ordinary runs.

---

### Task 1: Quality configuration and dependency boundary

**Files:**
- Create: `ctyhp-accounting/scripts/quality/config.mjs`
- Create: `ctyhp-accounting/tests/unit/quality-config.test.ts`
- Modify: `ctyhp-accounting/package.json`
- Modify: `ctyhp-accounting/package-lock.json`

**Interfaces:**
- Consumes: repository root from `process.cwd()` and optional `QUALITY_MODE`, `QUALITY_BASE_URL`, `QUALITY_DATABASE_URL`.
- Produces: `VIEWPORTS`, `MATRIX_ROUTES`, `BUDGETS`, `qualityMode(env)`, and `qualityPaths(root)`.

- [ ] **Step 1: Write the failing configuration test**

```ts
import { describe, expect, it } from "vitest";
import {
  BUDGETS,
  MATRIX_ROUTES,
  VIEWPORTS,
  qualityMode,
  qualityPaths,
} from "../../scripts/quality/config.mjs";

describe("quality configuration", () => {
  it("uses the approved viewport matrix and report-only default", () => {
    expect(VIEWPORTS).toEqual([
      { name: "mobile", width: 375, height: 812 },
      { name: "tablet-portrait", width: 768, height: 1024 },
      { name: "compact-desktop", width: 1024, height: 768 },
      { name: "desktop", width: 1440, height: 900 },
    ]);
    expect(qualityMode({})).toBe("report");
    expect(() => qualityMode({ QUALITY_MODE: "unknown" })).toThrow(/QUALITY_MODE/);
    expect(MATRIX_ROUTES).toContain("/settings/import");
    expect(BUDGETS.bundle.absoluteGzipBytes).toBe(20 * 1024);
  });

  it("keeps generated output outside committed source", () => {
    expect(qualityPaths("C:/repo/app").resultsDir).toBe("C:/repo/app/.quality-results");
  });
});
```

- [ ] **Step 2: Run the test and verify the missing module failure**

Run: `npm test -- tests/unit/quality-config.test.ts`

Expected: FAIL because `scripts/quality/config.mjs` does not exist.

- [ ] **Step 3: Add the minimal immutable configuration module**

```js
import { resolve } from "node:path";

export const VIEWPORTS = Object.freeze([
  Object.freeze({ name: "mobile", width: 375, height: 812 }),
  Object.freeze({ name: "tablet-portrait", width: 768, height: 1024 }),
  Object.freeze({ name: "compact-desktop", width: 1024, height: 768 }),
  Object.freeze({ name: "desktop", width: 1440, height: 900 }),
]);

export const MATRIX_ROUTES = Object.freeze([
  "/dashboard", "/sales", "/invoices", "/purchases", "/bills", "/banking",
  "/accounting", "/accounts", "/reports", "/settings", "/settings/import", "/approvals",
]);

export const BUDGETS = Object.freeze({
  bundle: Object.freeze({ percent: 0.10, absoluteGzipBytes: 20 * 1024 }),
  performance: Object.freeze({ percent: 0.20, absoluteMs: 200, clsAbsolute: 0.03 }),
  informational: Object.freeze({ lcpMs: 2500, cls: 0.1, interactionMs: 200, responseMs: 1000, longTaskMs: 200 }),
});

export function qualityMode(env = process.env) {
  const mode = env.QUALITY_MODE?.trim() || "report";
  if (mode !== "report" && mode !== "regression") {
    throw new Error(`QUALITY_MODE must be report or regression; received ${mode}`);
  }
  return mode;
}

export function qualityPaths(root = process.cwd()) {
  return {
    resultsDir: resolve(root, ".quality-results"),
    baselinePath: resolve(root, "tests", "quality", "baseline.json"),
    appDir: resolve(root, "app", "(app)"),
    nextDir: resolve(root, ".next"),
  };
}
```

- [ ] **Step 4: Install the only new browser-audit dependency**

Run: `npm install --save-dev @axe-core/playwright`

Expected: `package.json` and `package-lock.json` contain `@axe-core/playwright`; the existing Playwright version remains `1.62.1`.

- [ ] **Step 5: Run the focused test and dependency audit**

Run: `npm test -- tests/unit/quality-config.test.ts`

Expected: PASS.

Run: `npm ls @axe-core/playwright playwright`

Expected: both packages resolve without invalid peer dependencies.

- [ ] **Step 6: Commit the configuration boundary**

```bash
git add ctyhp-accounting/scripts/quality/config.mjs ctyhp-accounting/tests/unit/quality-config.test.ts ctyhp-accounting/package.json ctyhp-accounting/package-lock.json
git commit -m "test: define quality audit configuration"
```

---

### Task 2: Shared route discovery and authenticated session cookies

**Files:**
- Create: `ctyhp-accounting/scripts/quality/routes.mjs`
- Create: `ctyhp-accounting/scripts/quality/session-cookie.mjs`
- Create: `ctyhp-accounting/tests/unit/quality-routes-session.test.ts`
- Modify: `ctyhp-accounting/scripts/smoke-pages.mjs`

**Interfaces:**
- Consumes: `app/(app)` directory and `{ session, user, supabaseUrl, appBaseUrl }`.
- Produces: `discoverStaticRoutes(appDir): string[]`, `sessionCookieParts(input): {name,value}[]`, `sessionCookieHeader(input): string`, and `playwrightSessionCookies(input): BrowserContextCookie[]`.

- [ ] **Step 1: Write failing route and cookie tests**

```ts
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { discoverStaticRoutes } from "../../scripts/quality/routes.mjs";
import {
  playwrightSessionCookies,
  sessionCookieHeader,
  sessionCookieParts,
} from "../../scripts/quality/session-cookie.mjs";

describe("quality route and session helpers", () => {
  it("discovers static pages and skips dynamic segments", () => {
    const root = mkdtempSync(join(tmpdir(), "onebook-routes-"));
    mkdirSync(join(root, "dashboard"), { recursive: true });
    mkdirSync(join(root, "invoices", "[id]"), { recursive: true });
    writeFileSync(join(root, "dashboard", "page.tsx"), "export default function Page(){}", "utf8");
    writeFileSync(join(root, "invoices", "[id]", "page.tsx"), "export default function Page(){}", "utf8");
    expect(discoverStaticRoutes(root)).toEqual(["/dashboard"]);
  });

  it("serializes the same chunked session for fetch and Playwright", () => {
    const input = {
      session: { access_token: "a".repeat(5000), refresh_token: "r", expires_at: 1, expires_in: 1, token_type: "bearer" },
      user: { id: "user-1", email: "admin@example.com" },
      supabaseUrl: "https://project.supabase.co",
      appBaseUrl: "http://localhost:3000",
    };
    const parts = sessionCookieParts(input);
    expect(parts.length).toBeGreaterThan(1);
    expect(sessionCookieHeader(input)).toContain(`${parts[0].name}=${parts[0].value}`);
    expect(playwrightSessionCookies(input)[0]).toMatchObject({ url: "http://localhost:3000" });
  });
});
```

- [ ] **Step 2: Run the test and verify both imports fail**

Run: `npm test -- tests/unit/quality-routes-session.test.ts`

Expected: FAIL because the two helper modules do not exist.

- [ ] **Step 3: Extract route discovery without changing smoke behaviour**

```js
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export function discoverStaticRoutes(appDir, prefix = "") {
  const routes = [];
  for (const entry of readdirSync(appDir)) {
    const full = join(appDir, entry);
    if (statSync(full).isDirectory()) {
      if (!entry.startsWith("[")) routes.push(...discoverStaticRoutes(full, `${prefix}/${entry}`));
    } else if (entry === "page.tsx" && prefix) {
      routes.push(prefix);
    }
  }
  return [...new Set(routes)].sort();
}
```

Update `smoke-pages.mjs` to import `discoverStaticRoutes` and remove only its duplicate `discoverRoutes` function. Keep flags, ordering, concurrency, authentication, and output unchanged.

- [ ] **Step 4: Add one cookie serializer used by fetch and Playwright**

```js
function payloadFor(session, user) {
  const payload = {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at,
    expires_in: session.expires_in,
    token_type: session.token_type,
    user,
  };
  return "base64-" + Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

export function sessionCookieParts({ session, user, supabaseUrl }) {
  const ref = new URL(supabaseUrl).hostname.split(".")[0];
  const encoded = payloadFor(session, user);
  const baseName = `sb-${ref}-auth-token`;
  const size = 3180;
  if (encoded.length <= size) return [{ name: baseName, value: encoded }];
  return Array.from({ length: Math.ceil(encoded.length / size) }, (_, index) => ({
    name: `${baseName}.${index}`,
    value: encoded.slice(index * size, (index + 1) * size),
  }));
}

export function sessionCookieHeader(input) {
  return sessionCookieParts(input).map(({ name, value }) => `${name}=${value}`).join("; ");
}

export function playwrightSessionCookies(input) {
  return sessionCookieParts(input).map(({ name, value }) => ({ name, value, url: input.appBaseUrl }));
}
```

Update `smoke-pages.mjs` to import `sessionCookieHeader` and delete its duplicate serializer.

- [ ] **Step 5: Verify focused tests and existing smoke contracts**

Run: `npm test -- tests/unit/quality-routes-session.test.ts tests/unit/rsc-antd.test.ts`

Expected: PASS.

Run against an already running built server: `node --env-file=.env.local scripts/smoke-pages.mjs http://localhost:3000 --only=dashboard,reports`

Expected: `2 of 2 pages rendered`.

- [ ] **Step 6: Commit the shared read-only helpers**

```bash
git add ctyhp-accounting/scripts/quality/routes.mjs ctyhp-accounting/scripts/quality/session-cookie.mjs ctyhp-accounting/tests/unit/quality-routes-session.test.ts ctyhp-accounting/scripts/smoke-pages.mjs
git commit -m "test: share authenticated route audit helpers"
```

---

### Task 3: Findings, redaction, reports, and baseline comparison

**Files:**
- Create: `ctyhp-accounting/scripts/quality/model.mjs`
- Create: `ctyhp-accounting/scripts/quality/report.mjs`
- Create: `ctyhp-accounting/scripts/quality/accept-baseline.mjs`
- Create: `ctyhp-accounting/tests/unit/quality-model-report.test.ts`

**Interfaces:**
- Consumes: section results in `{ findings, measurements, unavailable, safetyFailures }` form.
- Produces: `median`, `findingFingerprint`, `redactQualityValue`, `compareAgainstBaseline`, `qualityExitCode`, `writeQualityReport`, and `acceptBaseline`.

- [ ] **Step 1: Write failing model/report tests**

```ts
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  compareAgainstBaseline,
  findingFingerprint,
  median,
  qualityExitCode,
  redactQualityValue,
} from "../../scripts/quality/model.mjs";
import { acceptBaseline } from "../../scripts/quality/accept-baseline.mjs";
import { writeQualityReport } from "../../scripts/quality/report.mjs";

describe("quality result model", () => {
  it("uses stable fingerprints and medians", () => {
    expect(median([900, 100, 300])).toBe(300);
    expect(findingFingerprint({ kind: "axe", rule: "label", route: "/invoices", viewport: "desktop", target: "#name" }))
      .toBe("axe|label|/invoices|desktop|#name");
  });

  it("redacts secrets and reports new fingerprints plus material metric regressions", () => {
    expect(redactQualityValue("postgres://user:secret@db/name")).toBe("[redacted-url]");
    expect(redactQualityValue({
      url: "https://qa.example.test/invoices?token=secret",
      headers: ["authorization=Bearer-secret"],
    })).toEqual({
      url: "https://qa.example.test/invoices",
      headers: ["authorization=[redacted]"],
    });
    const baseline = {
      fingerprints: ["axe|label|/invoices|desktop|#name"],
      measurements: [
        { key: "bundle.route./invoices.gzipBytes", kind: "bundle", value: 100_000 },
        { key: "performance./invoices.responseMs", kind: "performance", value: 1_000 },
        { key: "performance./invoices.cls", kind: "cls", value: 0.05 },
      ],
    };
    const current = { findings: [
      { fingerprint: "axe|label|/invoices|desktop|#name" },
      { fingerprint: "overflow|document|/banking|mobile|body" },
    ], measurements: [
      { key: "bundle.route./invoices.gzipBytes", kind: "bundle", value: 125_001 },
      { key: "performance./invoices.responseMs", kind: "performance", value: 1_250 },
      { key: "performance./invoices.cls", kind: "cls", value: 0.09 },
    ] };
    const comparison = compareAgainstBaseline(current, baseline, {
      bundle: { percent: 0.10, absoluteGzipBytes: 20 * 1024 },
      performance: { percent: 0.20, absoluteMs: 200, clsAbsolute: 0.03 },
    });
    expect(comparison.newFindings).toHaveLength(1);
    expect(comparison.measurementRegressions.map(({ key }) => key)).toEqual([
      "bundle.route./invoices.gzipBytes",
      "performance./invoices.responseMs",
      "performance./invoices.cls",
    ]);
    expect(qualityExitCode({ mode: "report", comparison, safetyFailures: [] })).toBe(0);
    expect(qualityExitCode({ mode: "regression", comparison, safetyFailures: [] })).toBe(1);
  });

  it("writes JSON and Markdown without implicit baseline mutation", () => {
    const dir = mkdtempSync(join(tmpdir(), "onebook-quality-"));
    const baseline = join(dir, "baseline.json");
    writeFileSync(baseline, JSON.stringify({ fingerprints: [] }), "utf8");
    writeQualityReport(dir, { version: 1, mode: "report", findings: [], measurements: {}, unavailable: [], safetyFailures: [] });
    expect(JSON.parse(readFileSync(join(dir, "summary.json"), "utf8")).mode).toBe("report");
    expect(readFileSync(baseline, "utf8")).toBe('{"fingerprints":[]}');
  });

  it("requires the exact opt-in before accepting a compact baseline", () => {
    const dir = mkdtempSync(join(tmpdir(), "onebook-baseline-"));
    const results = join(dir, "summary.json");
    const baseline = join(dir, "baseline.json");
    writeFileSync(results, JSON.stringify({
      findings: [{ fingerprint: "axe|label|/invoices|desktop|#name" }],
      measurements: [{ key: "performance./invoices.responseMs", kind: "performance", value: 1_000 }],
      budgets: { performance: { percent: 0.20, absoluteMs: 200, clsAbsolute: 0.03 } },
    }), "utf8");
    expect(() => acceptBaseline(results, baseline, {})).toThrow(/QUALITY_ACCEPT_BASELINE/);
    acceptBaseline(results, baseline, { QUALITY_ACCEPT_BASELINE: "ONEBOOK_REVIEWED_QUALITY_BASELINE" });
    expect(JSON.parse(readFileSync(baseline, "utf8"))).toMatchObject({ version: 1 });
  });
});
```

- [ ] **Step 2: Run and verify missing model/report modules**

Run: `npm test -- tests/unit/quality-model-report.test.ts`

Expected: FAIL on missing imports.

- [ ] **Step 3: Implement stable model functions**

```js
import { createHash } from "node:crypto";

export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function findingFingerprint(finding) {
  return [finding.kind, finding.rule, finding.route, finding.viewport, finding.target].map((v) => v ?? "").join("|");
}

export function redactQualityValue(value) {
  if (Array.isArray(value)) return value.map(redactQualityValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactQualityValue(item)]));
  }
  if (typeof value !== "string") return value;
  if (/^(postgres|postgresql):\/\//i.test(value)) return "[redacted-url]";
  return value
    .replace(/https?:\/\/[^\s)]+/gi, (rawUrl) => {
      const parsed = new URL(rawUrl);
      return `${parsed.origin}${parsed.pathname}`;
    })
    .replace(/(access_token|refresh_token|apikey|authorization)=[^&\s]+/gi, "$1=[redacted]");
}

export function stableHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function compareAgainstBaseline(current, baseline, budgets) {
  const known = new Set(baseline?.fingerprints ?? []);
  const previous = new Map((baseline?.measurements ?? []).map((metric) => [metric.key, metric]));
  const measurementRegressions = (current.measurements ?? []).flatMap((metric) => {
    const prior = previous.get(metric.key);
    if (!prior || metric.value <= prior.value) return [];
    const delta = metric.value - prior.value;
    const material = metric.kind === "cls"
      ? delta > budgets.performance.clsAbsolute
      : delta > (metric.kind === "bundle" ? budgets.bundle.absoluteGzipBytes : budgets.performance.absoluteMs)
        && delta / prior.value > (metric.kind === "bundle" ? budgets.bundle.percent : budgets.performance.percent);
    return material ? [{ ...metric, previousValue: prior.value, delta, advisory: metric.kind === "query" }] : [];
  });
  return {
    newFindings: (current.findings ?? []).filter((finding) => !known.has(finding.fingerprint)),
    measurementRegressions,
  };
}

export function qualityExitCode({ mode, comparison, safetyFailures }) {
  if (safetyFailures.length) return 1;
  const blockingMetrics = comparison.measurementRegressions.filter((item) => !item.advisory);
  return mode === "regression" && (comparison.newFindings.length || blockingMetrics.length) ? 1 : 0;
}
```

- [ ] **Step 4: Implement atomic report and explicit baseline writing**

`writeQualityReport(resultsDir, summary)` recursively applies `redactQualityValue`, writes a temporary JSON file, renames it to `summary.json`, and writes `summary.md` from the same sanitized object. Make `report.mjs` dual-purpose: it exports `writeQualityReport` for the section CLIs and, when invoked directly, reads the existing section JSON artifacts and regenerates the aggregate summary. If no section artifact exists, the direct CLI fails with a clear harness error. In `regression` mode, a missing or malformed baseline is also a harness/configuration failure. `acceptBaseline(resultsPath, baselinePath)` must refuse unless `QUALITY_ACCEPT_BASELINE=ONEBOOK_REVIEWED_QUALITY_BASELINE` is present and must store fingerprints, normalized scalar measurement baselines, and threshold budgets only.

```js
export function acceptBaseline(resultsPath, baselinePath, env = process.env) {
  if (env.QUALITY_ACCEPT_BASELINE !== "ONEBOOK_REVIEWED_QUALITY_BASELINE") {
    throw new Error("Set QUALITY_ACCEPT_BASELINE=ONEBOOK_REVIEWED_QUALITY_BASELINE after reviewing summary.md");
  }
  // Read the sanitized summary and atomically write only version, fingerprints,
  // normalized scalar measurements, and budgets to baselinePath.
}
```

- [ ] **Step 5: Run focused tests**

Run: `npm test -- tests/unit/quality-model-report.test.ts`

Expected: PASS with no baseline created in the repository.

- [ ] **Step 6: Commit the report model**

```bash
git add ctyhp-accounting/scripts/quality/model.mjs ctyhp-accounting/scripts/quality/report.mjs ctyhp-accounting/scripts/quality/accept-baseline.mjs ctyhp-accounting/tests/unit/quality-model-report.test.ts
git commit -m "test: add quality reports and explicit baselines"
```

---

### Task 4: Turbopack bundle analyzer

**Files:**
- Create: `ctyhp-accounting/scripts/quality/bundle.mjs`
- Create: `ctyhp-accounting/scripts/quality/run-bundle.mjs`
- Create: `ctyhp-accounting/tests/unit/quality-bundle.test.ts`
- Create: bundle fixtures listed in File Structure
- Modify: `ctyhp-accounting/package.json`

**Interfaces:**
- Consumes: `.next/server/app/**/page_client-reference-manifest.js` and `.next/static/chunks/*`.
- Produces: `parseClientReferenceManifest(text)`, `analyzeBundle(nextDir)`, and `.quality-results/bundle.json`.

- [ ] **Step 1: Write a failing deterministic manifest test**

```ts
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { analyzeBundle, parseClientReferenceManifest, summarizeRouteChunks } from "../../scripts/quality/bundle.mjs";

describe("quality bundle analyzer", () => {
  it("deduplicates route chunks from Turbopack entryJSFiles", () => {
    const text = 'globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};\n' +
      'globalThis.__RSC_MANIFEST["/(app)/dashboard/page"] = ' +
      JSON.stringify({ entryJSFiles: {
        "[project]/app/layout": ["static/chunks/shared.js"],
        "[project]/app/(app)/dashboard/page": ["static/chunks/shared.js", "static/chunks/route.js"],
      }}) + ';';
    const manifest = parseClientReferenceManifest(text);
    expect(summarizeRouteChunks(manifest)).toEqual(["static/chunks/route.js", "static/chunks/shared.js"]);
  });

  it("produces stable route bytes from the checked-in fixture", () => {
    const nextDir = resolve(dirname(fileURLToPath(import.meta.url)), "../quality/fixtures/bundle/.next");
    const report = analyzeBundle(nextDir);
    const expectedGzipBytes = ["route.js", "shared.js"]
      .map((name) => gzipSync(readFileSync(resolve(nextDir, "static/chunks", name))).byteLength)
      .reduce((total, value) => total + value, 0);
    expect(report.routes).toContainEqual(expect.objectContaining({ route: "/dashboard", gzipBytes: expectedGzipBytes }));
  });
});
```

- [ ] **Step 2: Run and verify the missing analyzer failure**

Run: `npm test -- tests/unit/quality-bundle.test.ts`

Expected: FAIL because `bundle.mjs` does not exist.

- [ ] **Step 3: Implement manifest extraction and byte accounting**

```js
import { readFileSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";

export function parseClientReferenceManifest(text) {
  const match = text.match(/globalThis\.__RSC_MANIFEST\[[^\]]+\]\s*=\s*(\{.*\});?\s*$/s);
  if (!match) throw new Error("Unreadable client reference manifest");
  return JSON.parse(match[1]);
}

export function summarizeRouteChunks(manifest) {
  return [...new Set(Object.values(manifest.entryJSFiles ?? {}).flat())].sort();
}

export function chunkSize(nextDir, chunk) {
  const path = `${nextDir}/${chunk.replace(/^\/?_next\//, "")}`;
  const bytes = statSync(path).size;
  const gzipBytes = gzipSync(readFileSync(path)).byteLength;
  return { chunk, bytes, gzipBytes };
}
```

`analyzeBundle` discovers every static route client-reference manifest, maps `/(app)/x/page` to `/x`, computes per-route deduplicated totals, computes unique global chunks once, and throws when no route manifests or chunk files are found.

Create the checked-in fixture with exactly one `/dashboard` manifest whose `entryJSFiles` references `static/chunks/shared.js` from the layout and both `static/chunks/shared.js` and `static/chunks/route.js` from the page. Give each chunk a small, fixed JavaScript statement so raw and gzip totals are deterministic.

- [ ] **Step 4: Add the report-only bundle CLI**

```json
{
  "scripts": {
    "quality:bundle": "node scripts/quality/run-bundle.mjs"
  }
}
```

The CLI reads `QUALITY_MODE`, analyzes `.next`, writes the bundle section and summary artifacts, and exits non-zero only for missing/unreadable build output in report mode. In regression mode it additionally loads the accepted baseline and uses `qualityExitCode` so only new findings or material bundle growth can fail.

- [ ] **Step 5: Verify fixture and real build parsing**

Run: `npm test -- tests/unit/quality-bundle.test.ts`

Expected: PASS.

Run after a fresh build: `npm run quality:bundle`

Expected: `.quality-results/bundle.json` and `.quality-results/summary.md` exist and list `/invoices` plus at least one JavaScript chunk.

- [ ] **Step 6: Commit the static tier**

```bash
git add ctyhp-accounting/scripts/quality/bundle.mjs ctyhp-accounting/scripts/quality/run-bundle.mjs ctyhp-accounting/tests/unit/quality-bundle.test.ts ctyhp-accounting/tests/quality/fixtures ctyhp-accounting/package.json
git commit -m "test: report route bundle sizes"
```

---

### Task 5: Read-only browser guard and page audit primitives

**Files:**
- Create: `ctyhp-accounting/scripts/quality/browser.mjs`
- Create: `ctyhp-accounting/scripts/quality/page-audit.mjs`
- Create: `ctyhp-accounting/scripts/quality/self-test-runtime.mjs`
- Create: `ctyhp-accounting/tests/unit/quality-browser.test.ts`

**Interfaces:**
- Consumes: Playwright `Browser`, session cookies, route URL, and viewport.
- Produces: `isAllowedBrowserMethod`, `safeRequestTarget`, `createReadOnlyContext`, `installMetricObservers`, `auditPage`, and `inspectViewport`.

- [ ] **Step 1: Write failing request-policy and viewport tests**

```ts
import { describe, expect, it } from "vitest";
import { isAllowedBrowserMethod, safeRequestTarget } from "../../scripts/quality/browser.mjs";
import { classifyViewportSnapshot } from "../../scripts/quality/page-audit.mjs";

describe("quality browser safety", () => {
  it("allows reads and refuses every write transport", () => {
    expect(isAllowedBrowserMethod("GET")).toBe(true);
    expect(isAllowedBrowserMethod("HEAD")).toBe(true);
    expect(isAllowedBrowserMethod("OPTIONS")).toBe(true);
    expect(isAllowedBrowserMethod("POST")).toBe(false);
    expect(isAllowedBrowserMethod("PUT")).toBe(false);
    expect(isAllowedBrowserMethod("PATCH")).toBe(false);
    expect(isAllowedBrowserMethod("DELETE")).toBe(false);
    expect(safeRequestTarget("https://qa.example.test/invoices?token=secret")).toBe("/invoices");
  });

  it("permits an internal table scroller but reports document overflow", () => {
    expect(classifyViewportSnapshot({ documentOverflow: 0, internalScrollers: 1, clippedTargets: [], shellOverlaps: [] }).findings).toHaveLength(0);
    expect(classifyViewportSnapshot({ documentOverflow: 14, internalScrollers: 1, clippedTargets: [], shellOverlaps: [] }).findings[0].rule).toBe("document-overflow");
    expect(classifyViewportSnapshot({ documentOverflow: 0, internalScrollers: 0, clippedTargets: [], shellOverlaps: ["#primary-action"] }).findings[0].rule)
      .toBe("fixed-shell-overlap");
  });
});
```

- [ ] **Step 2: Run and verify missing browser modules**

Run: `npm test -- tests/unit/quality-browser.test.ts`

Expected: FAIL on missing imports.

- [ ] **Step 3: Implement the fail-closed browser context**

```js
export function isAllowedBrowserMethod(method) {
  return ["GET", "HEAD", "OPTIONS"].includes(String(method).toUpperCase());
}

export function safeRequestTarget(rawUrl) {
  try {
    return new URL(rawUrl).pathname;
  } catch {
    return "[invalid-url]";
  }
}

export async function createReadOnlyContext(browser, { cookies, viewport }) {
  const blocked = [];
  const context = await browser.newContext({ viewport });
  await context.addCookies(cookies);
  await context.route("**/*", async (route) => {
    const request = route.request();
    if (isAllowedBrowserMethod(request.method())) return route.continue();
    blocked.push({ method: request.method(), target: safeRequestTarget(request.url()) });
    await route.abort("blockedbyclient");
  });
  return {
    context,
    blocked,
    assertSafe() {
      if (blocked.length) throw new Error(`Quality audit blocked a write request: ${blocked[0].method} ${blocked[0].target}`);
    },
  };
}
```

- [ ] **Step 4: Install in-page metric observers before navigation**

`installMetricObservers(page)` uses `page.addInitScript` to create `window.__oneBookQuality` and buffered observers for `largest-contentful-paint`, `layout-shift`, `event`, and `longtask`. It stores numeric values only.

```js
await page.addInitScript(() => {
  window.__oneBookQuality = { lcp: 0, cls: 0, interactions: [], longTasks: [] };
  new PerformanceObserver((list) => {
    const entries = list.getEntries();
    window.__oneBookQuality.lcp = entries.at(-1)?.startTime ?? 0;
  }).observe({ type: "largest-contentful-paint", buffered: true });
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__oneBookQuality.cls += entry.value;
  }).observe({ type: "layout-shift", buffered: true });
});
```

Wrap unsupported observer types individually so one missing API marks only that metric unsupported.

- [ ] **Step 5: Implement Axe and viewport inspection**

`auditPage` navigates with `waitUntil: "domcontentloaded"`, waits for `#main-content`, waits 500 ms for layout stabilization, runs `new AxeBuilder({ page }).analyze()`, collects Navigation Timing and metric observer values, and takes screenshots only when findings exist.

`inspectViewport` reports document overflow, primary controls clipped outside the viewport, content/control bounding boxes hidden under visible fixed or sticky shell regions, and interactive targets smaller than 44×44 CSS pixels. It ignores overflow owned by `.accounting-data-table`, `.ant-modal-body`, `.ant-drawer-body`, and elements whose computed `overflow-x` is `auto` or `scroll`. Overlap detection compares rectangles against the app header, sidebar/mobile navigation shell, and visible fixed overlays while excluding an element contained by that same shell.

- [ ] **Step 6: Run focused tests**

Run: `npm test -- tests/unit/quality-browser.test.ts`

Expected: PASS.

- [ ] **Step 7: Add and run the isolated runtime safety proof**

`self-test-runtime.mjs` starts a Node HTTP server on `127.0.0.1` and an ephemeral port. Its only GET page contains `#main-content`, one deliberately unlabeled input, and a wide child inside `.accounting-data-table`; its POST handler increments an in-memory counter. Launch Chromium, install the same read-only context guard, and prove all of the following before closing server/browser resources in `finally`:

- Axe reports the synthetic unlabeled-input violation;
- the internal table scroller does not become a document-overflow finding;
- `page.evaluate(() => fetch("/", { method: "POST" }))` is aborted by the guard;
- `assertSafe()` throws the expected write-request error;
- the server-side POST counter remains zero.

Run: `node scripts/quality/self-test-runtime.mjs`

Expected: exit 0 with a concise `runtime quality self-test passed` message. A missing Chromium executable is a harness failure, not a skipped test.

- [ ] **Step 8: Commit the runtime primitives**

```bash
git add ctyhp-accounting/scripts/quality/browser.mjs ctyhp-accounting/scripts/quality/page-audit.mjs ctyhp-accounting/scripts/quality/self-test-runtime.mjs ctyhp-accounting/tests/unit/quality-browser.test.ts
git commit -m "test: add read-only accessibility audit primitives"
```

---

### Task 6: Runtime Axe, viewport, Web Vitals, and route audit

**Files:**
- Create: `ctyhp-accounting/scripts/quality/run-runtime.mjs`
- Modify: `ctyhp-accounting/package.json`

**Interfaces:**
- Consumes: `smokeSession`, static routes, four viewports, representative routes, and browser audit primitives.
- Produces: `axe.json`, `viewports.json`, `web-vitals.json`, `routes.json`, screenshots on findings, and an aggregated summary.

- [ ] **Step 1: Add a failing schedule assertion to the config test**

```ts
it("audits every static route at desktop and matrix routes at four viewports", () => {
  const schedule = runtimeSchedule(["/dashboard", "/reports", "/settings/import"]);
  expect(schedule.filter((item) => item.route === "/dashboard")).toHaveLength(4);
  expect(schedule).toContainEqual({ route: "/settings/import", viewport: "desktop", audit: "matrix" });
});
```

Export `runtimeSchedule` from `config.mjs`. Matrix routes receive four viewport entries; discovered non-matrix routes receive one desktop Axe entry. Deduplicate identical route/viewport pairs.

- [ ] **Step 2: Run and verify `runtimeSchedule` is missing**

Run: `npm test -- tests/unit/quality-config.test.ts`

Expected: FAIL because `runtimeSchedule` is not exported.

- [ ] **Step 3: Implement the schedule and runtime orchestrator**

The CLI must:

1. Resolve `QUALITY_BASE_URL`, defaulting to `http://localhost:3000`.
2. Call `smokeSession()` before launching a guarded context.
3. Create Playwright cookies for the app base URL.
4. Discover static routes from `app/(app)`.
5. Run desktop Axe on every discovered route.
6. Run the representative matrix at all viewports.
7. Run one warm-up plus three measured navigations for performance routes and store medians.
8. Call `assertSafe()` after every route and again before browser shutdown.
9. Mark Axe/size/performance findings as report-only findings.
10. Treat auth failure, an error boundary, a failed/non-2xx document navigation, an uncaught page error, and any blocked method as safety/harness failures; report failed non-document subresources as quality findings so one optional asset does not create a false harness failure.
11. Load and compare the accepted baseline only in regression mode; feed new fingerprints and material non-advisory metric regressions to `qualityExitCode`.

- [ ] **Step 4: Add the runtime command**

```json
{
  "scripts": {
    "quality:runtime": "node --env-file-if-exists=.env.local scripts/quality/run-runtime.mjs"
  }
}
```

- [ ] **Step 5: Run a two-route runtime smoke in report mode**

Run against an already running built server:

`$env:QUALITY_ONLY='dashboard,reports'; npm run quality:runtime`

Expected: exit 0, no blocked request, and non-empty `axe.json`, `viewports.json`, `web-vitals.json`, and `routes.json`.

- [ ] **Step 6: Prove the write guard fails closed**

Add a harness-only test option `QUALITY_PROBE_BLOCKED_METHOD=1` that evaluates `fetch("/dashboard", { method: "POST" })` inside the guarded page. Browser-page fetch goes through `browserContext.route`; do not use `page.request`, because its separate `APIRequestContext` can bypass the page routing guard. The probe must be available only inside the runtime script and must never be enabled by normal commands.

Run: `$env:QUALITY_PROBE_BLOCKED_METHOD='1'; $env:QUALITY_ONLY='dashboard'; npm run quality:runtime`

Expected: non-zero exit with `Quality audit blocked a write request`; no application request reaches the server.

- [ ] **Step 7: Commit the runtime audit**

```bash
git add ctyhp-accounting/scripts/quality/config.mjs ctyhp-accounting/scripts/quality/run-runtime.mjs ctyhp-accounting/tests/unit/quality-config.test.ts ctyhp-accounting/package.json
git commit -m "test: audit authenticated routes and viewports"
```

---

### Task 7: Non-mutating keyboard scenarios

**Files:**
- Create: `ctyhp-accounting/scripts/quality/keyboard.mjs`
- Create: `ctyhp-accounting/tests/unit/quality-keyboard.test.ts`
- Modify: `ctyhp-accounting/scripts/quality/run-runtime.mjs`

**Interfaces:**
- Consumes: guarded Playwright page and `QUALITY_BASE_URL`.
- Produces: `KEYBOARD_SCENARIOS` and `runKeyboardScenarios(page, baseUrl): KeyboardResult[]`.

- [ ] **Step 1: Write the failing scenario-safety test**

```ts
import { describe, expect, it } from "vitest";
import { KEYBOARD_SCENARIOS, MUTATION_LABEL_PATTERN } from "../../scripts/quality/keyboard.mjs";

describe("keyboard quality scenarios", () => {
  it("names the approved stable scenarios and excludes mutation actions", () => {
    expect(KEYBOARD_SCENARIOS.map((scenario) => scenario.id)).toEqual([
      "skip-link", "desktop-navigation", "mobile-navigation", "account-and-new-menus",
      "global-search-focus", "report-center-controls", "guide-drawer", "import-controls",
    ]);
    for (const scenario of KEYBOARD_SCENARIOS) {
      expect(scenario.actions.join(" ")).not.toMatch(MUTATION_LABEL_PATTERN);
    }
  });
});
```

- [ ] **Step 2: Run and verify missing keyboard module**

Run: `npm test -- tests/unit/quality-keyboard.test.ts`

Expected: FAIL because `keyboard.mjs` does not exist.

- [ ] **Step 3: Implement scenarios using stable accessible locators**

Implement these exact user-observable assertions:

- `skip-link`: first Tab focuses `.accounting-skip-link`; Enter focuses `#main-content`.
- `desktop-navigation`: focus `a[href="/sales"]` inside `[aria-label="Primary navigation"]`; Enter reaches `/sales`.
- `mobile-navigation`: focus `[aria-label="Open navigation"]`; Enter opens the Drawer; Escape closes it and returns focus to the trigger.
- `account-and-new-menus`: focus `[aria-label^="Open account menu for "]`, open with Enter, and close with Escape; then focus `[aria-label="Create new transaction"]`, open with Enter, and close with Escape. Do not choose an item in either menu.
- `global-search-focus`: focus `[aria-label="Search documents and contacts"]`; enter one character only so no Server Action starts; Escape clears/closes.
- `report-center-controls`: type into `[aria-label="Search reports"]`; verify results update; use the category control at mobile width.
- `guide-drawer`: focus `[aria-label^="System guide"]`; Enter opens the Drawer; Tab stays inside; Escape closes and restores focus.
- `import-controls`: on `/settings/import`, use arrow keys on the import-type control and focus the CSV file input; do not set a file.

Every result includes `{ id, status, route, focusedBefore, focusedAfter, message }`. At each focus checkpoint assert `element.matches(":focus-visible")`; verify logical movement, Escape behaviour, focus trapping where applicable, and trigger-focus restoration. Catch scenario assertions to report quality findings, but rethrow blocked-request and navigation/render safety failures.

- [ ] **Step 4: Merge keyboard results into runtime artifacts**

Run keyboard scenarios once at the viewport appropriate to each scenario. Write `keyboard.json`; include failures in `summary.md`. Keep report-mode exit 0 for keyboard quality failures.

- [ ] **Step 5: Run keyboard audit against the built server**

Run: `$env:QUALITY_ONLY='keyboard'; npm run quality:runtime`

Expected: `keyboard.json` contains eight scenario IDs, no blocked requests, and no mutation action is activated.

- [ ] **Step 6: Commit keyboard coverage**

```bash
git add ctyhp-accounting/scripts/quality/keyboard.mjs ctyhp-accounting/scripts/quality/run-runtime.mjs ctyhp-accounting/tests/unit/quality-keyboard.test.ts
git commit -m "test: cover primary keyboard workflows"
```

---

### Task 8: Optional read-only query timing

**Files:**
- Create: `ctyhp-accounting/scripts/quality/query-timing.mjs`
- Create: `ctyhp-accounting/tests/unit/quality-query-timing.test.ts`
- Modify: `ctyhp-accounting/scripts/quality/run-runtime.mjs`

**Interfaces:**
- Consumes: explicit `QUALITY_DATABASE_URL` and pre/post `pg_stat_statements` snapshots.
- Produces: `readQuerySnapshot(sql)`, `queryTimingDelta(before, after)`, and `queries.json` or an unavailable reason.

- [ ] **Step 1: Write failing query-delta tests**

```ts
import { describe, expect, it } from "vitest";
import { queryTimingDelta, sanitizeNormalizedQuery } from "../../scripts/quality/query-timing.mjs";

describe("quality query timing", () => {
  it("computes non-negative deltas without resetting shared stats", () => {
    const before = [{ queryid: "1", calls: 10, total_exec_time: 100, mean_exec_time: 10, query: "select * from acc_invoice where id = $1" }];
    const after = [{ queryid: "1", calls: 13, total_exec_time: 145, mean_exec_time: 15, query: "select * from acc_invoice where id = $1" }];
    expect(queryTimingDelta(before, after)[0]).toMatchObject({ queryid: "1", calls: 3, totalExecMs: 45, meanExecMs: 15 });
  });

  it("keeps normalized SQL shape and removes comments/literals", () => {
    expect(sanitizeNormalizedQuery("select * from acc_invoice where memo = 'customer secret' -- note"))
      .toBe("select * from acc_invoice where memo = ?");
  });
});
```

- [ ] **Step 2: Run and verify missing query module**

Run: `npm test -- tests/unit/quality-query-timing.test.ts`

Expected: FAIL because `query-timing.mjs` does not exist.

- [ ] **Step 3: Implement the read-only snapshot**

Use the existing `pg` dev dependency and only this SQL:

```sql
select
  queryid::text,
  calls::bigint,
  total_exec_time::double precision,
  mean_exec_time::double precision,
  query
from pg_stat_statements
where dbid = (select oid from pg_database where datname = current_database())
order by total_exec_time desc
limit 500
```

Do not execute `pg_stat_statements_reset`, `set`, DDL, DML, RPCs, or multiple statements. Open with `application_name = 'onebook-quality-readonly'`, `max: 1`, and a 5-second connection timeout; close in `finally`.

- [ ] **Step 4: Integrate optional before/after snapshots**

If `QUALITY_DATABASE_URL` is absent, write `{ available: false, reason: "QUALITY_DATABASE_URL is not configured" }`. If the extension is absent, record the database error class/message after redaction and continue. Never read `DATABASE_URL`, `SUPABASE_DB_URL`, or `E2E_DATABASE_URL` as fallbacks. Convert each mean-time value into a scalar baseline measurement with `kind: "query"`; material regressions appear in the report with `advisory: true` and never affect `qualityExitCode` until a dedicated QA database and isolated audit window are separately approved.

- [ ] **Step 5: Run unit and optional QA verification**

Run: `npm test -- tests/unit/quality-query-timing.test.ts`

Expected: PASS.

Run without the variable: `npm run quality:runtime`

Expected: `queries.json` marks query timing unavailable and the remaining audit completes.

Run only on an approved QA database: `$env:QUALITY_DATABASE_URL='<qa-only-url>'; npm run quality:runtime`

Expected: `queries.json` lists normalized query deltas and no reset/write statement appears in database logs.

- [ ] **Step 6: Commit optional query timing**

```bash
git add ctyhp-accounting/scripts/quality/query-timing.mjs ctyhp-accounting/scripts/quality/run-runtime.mjs ctyhp-accounting/tests/unit/quality-query-timing.test.ts
git commit -m "test: report read-only query timing"
```

---

### Task 9: Command surface, ignored artifacts, and operations guide

**Files:**
- Modify: `ctyhp-accounting/package.json`
- Modify: `ctyhp-accounting/.gitignore`
- Modify: `ctyhp-accounting/.env.local.example`
- Create: `ctyhp-accounting/docs/operations/quality-gates.md`

**Interfaces:**
- Consumes: completed static/runtime CLIs.
- Produces: the approved five-command surface and operator documentation.

- [ ] **Step 1: Add a failing package-script contract test**

Add to `tests/unit/quality-config.test.ts`:

```ts
import packageJson from "../../package.json";

it("publishes the approved quality command surface", () => {
  expect(packageJson.scripts).toMatchObject({
    "quality:bundle": "node scripts/quality/run-bundle.mjs",
    "quality:runtime": "node --env-file-if-exists=.env.local scripts/quality/run-runtime.mjs",
    "quality:report": "node scripts/quality/report.mjs",
    "quality:all": "npm run quality:bundle && npm run quality:runtime",
    "quality:accept-baseline": "node scripts/quality/accept-baseline.mjs",
  });
});
```

- [ ] **Step 2: Run and verify missing commands**

Run: `npm test -- tests/unit/quality-config.test.ts`

Expected: FAIL until all five commands match exactly.

- [ ] **Step 3: Add scripts, ignored output, and safe environment examples**

Append to `.gitignore`:

```gitignore
# Generated accessibility, performance, viewport, and bundle reports.
/.quality-results/
```

Append to `.env.local.example`:

```dotenv
# Read-only quality audit. Use a built local server or an approved QA/preview URL.
QUALITY_BASE_URL=http://localhost:3000
QUALITY_MODE=report
SMOKE_EMAIL=
SMOKE_PASSWORD=
# Optional, QA-only direct database URL for pg_stat_statements. Never use production.
QUALITY_DATABASE_URL=
# Explicit one-time opt-in used only after reviewing .quality-results/summary.md.
QUALITY_ACCEPT_BASELINE=
```

- [ ] **Step 4: Write the operations guide**

The guide must include:

- prerequisites and built-server lifecycle;
- local static and runtime commands;
- report-only exit semantics;
- every safety failure condition;
- the four viewport sizes and route matrix;
- artifact contents and sensitivity rules;
- QA-only query timing setup;
- baseline review and exact acceptance opt-in;
- promotion to regression mode;
- how to investigate a new finding without changing the baseline first.

- [ ] **Step 5: Run the command contract and report-only commands**

Run: `npm test -- tests/unit/quality-config.test.ts`

Expected: PASS.

Run: `npm run quality:bundle`

Expected: exit 0 with a bundle artifact.

Run against a built server: `npm run quality:runtime`

Expected: exit 0 for quality findings and non-zero only for harness/safety failure.

- [ ] **Step 6: Commit the operator surface**

```bash
git add ctyhp-accounting/package.json ctyhp-accounting/.gitignore ctyhp-accounting/.env.local.example ctyhp-accounting/docs/operations/quality-gates.md ctyhp-accounting/tests/unit/quality-config.test.ts
git commit -m "docs: document quality gate operation"
```

---

### Task 10: CI report-only integration

**Files:**
- Modify: `.github/workflows/ci.yml`
- Create: `.github/workflows/quality-runtime.yml`
- Test: `ctyhp-accounting/tests/unit/quality-ci-contract.test.ts`

**Interfaces:**
- Consumes: build output, quality commands, optional `QUALITY_BASE_URL`, `SMOKE_EMAIL`, `SMOKE_PASSWORD`, and `QUALITY_DATABASE_URL` secrets/variables.
- Produces: PR bundle artifacts and manual/scheduled runtime artifacts without exposing credentials.

- [ ] **Step 1: Write a failing CI contract test**

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("quality CI contracts", () => {
  it("runs bundle reporting after build and uploads artifacts", () => {
    const yaml = readFileSync("../.github/workflows/ci.yml", "utf8");
    expect(yaml.indexOf("npm run build")).toBeLessThan(yaml.indexOf("npm run quality:bundle"));
    expect(yaml).toContain("actions/upload-artifact@v4");
    expect(yaml).toContain("ctyhp-accounting/.quality-results");
  });

  it("keeps runtime quality separate from placeholder CI", () => {
    const yaml = readFileSync("../.github/workflows/quality-runtime.yml", "utf8");
    expect(yaml).toContain("workflow_dispatch:");
    expect(yaml).toContain("QUALITY_BASE_URL");
    expect(yaml).toContain("npm run quality:runtime");
    expect(yaml).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
  });
});
```

- [ ] **Step 2: Run and verify workflow assertions fail**

Run: `npm test -- tests/unit/quality-ci-contract.test.ts`

Expected: FAIL because runtime workflow and CI steps do not exist.

- [ ] **Step 3: Add bundle reporting to existing CI**

After the current Build step, add:

```yaml
      - name: Bundle quality report
        run: npm run quality:bundle

      - name: Upload quality report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: quality-bundle-${{ github.sha }}
          path: ctyhp-accounting/.quality-results
          if-no-files-found: error
          retention-days: 14
```

Quality findings remain exit 0 in report mode. Missing build artifacts still fail the analyzer.

- [ ] **Step 4: Add a secret-minimal runtime workflow**

The new workflow uses `workflow_dispatch` and a weekly schedule. It runs against `vars.QUALITY_BASE_URL`, authenticates only with `secrets.SMOKE_EMAIL` and `secrets.SMOKE_PASSWORD`, optionally receives `secrets.QUALITY_DATABASE_URL`, and never receives the service-role key. It must stop with a clear configuration error if base URL or smoke credentials are absent.

```yaml
permissions:
  contents: read

jobs:
  runtime-quality:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    defaults:
      run:
        working-directory: ctyhp-accounting
    env:
      QUALITY_BASE_URL: ${{ vars.QUALITY_BASE_URL }}
      QUALITY_MODE: report
      SMOKE_EMAIL: ${{ secrets.SMOKE_EMAIL }}
      SMOKE_PASSWORD: ${{ secrets.SMOKE_PASSWORD }}
      QUALITY_DATABASE_URL: ${{ secrets.QUALITY_DATABASE_URL }}
```

Install dependencies with `npm ci`, install Chromium with `npx playwright install --with-deps chromium`, run `node scripts/quality/self-test-runtime.mjs` to prove the fail-closed guard in isolation, run `npm run quality:runtime`, and upload `.quality-results` with `if: always()`.

- [ ] **Step 5: Verify CI contracts and YAML structure**

Run: `npm test -- tests/unit/quality-ci-contract.test.ts`

Expected: PASS.

Run: `npm run lint`

Expected: PASS; workflow strings contain no committed credentials.

- [ ] **Step 6: Commit CI integration**

```bash
git add .github/workflows/ci.yml .github/workflows/quality-runtime.yml ctyhp-accounting/tests/unit/quality-ci-contract.test.ts
git commit -m "ci: publish report-only quality audits"
```

---

### Task 11: Full verification and first report-only baseline candidate

**Files:**
- Verify all files from Tasks 1–10
- Do not create `tests/quality/baseline.json` in this task

**Interfaces:**
- Consumes: completed implementation and a built local server using `.env.local`.
- Produces: verified report-only artifacts ready for human baseline review.

- [ ] **Step 1: Run all unit tests**

Run: `npm test`

Expected: all test files pass with zero failures.

- [ ] **Step 2: Run typecheck and lint**

Run: `npm run typecheck`

Expected: exit 0.

Run: `npm run lint`

Expected: exit 0.

- [ ] **Step 3: Run a clean production build**

Run: `npm run build`

Expected: exit 0 and route client-reference manifests exist under `.next/server/app`.

- [ ] **Step 4: Run static quality analysis**

Run: `npm run quality:bundle`

Expected: exit 0; bundle JSON and Markdown summary contain measured route/chunk values.

- [ ] **Step 5: Prove the browser guard in isolation**

Run: `node scripts/quality/self-test-runtime.mjs`

Expected: Axe detects the synthetic violation, internal table scrolling is allowed, the attempted POST is blocked before reaching the test server, and the command exits 0.

- [ ] **Step 6: Start the built server and run the read-only runtime audit**

Start: `npm start`

Run in another terminal: `npm run quality:runtime`

Expected: runtime completes in report mode, all application requests are read-only, and all six runtime artifacts exist. Query timing may be explicitly unavailable.

- [ ] **Step 7: Run the full existing page smoke sweep**

Run: `node --env-file=.env.local scripts/smoke-pages.mjs http://localhost:3000`

Expected: every discovered static page renders with status 200 and no error boundary.

- [ ] **Step 8: Inspect artifact safety**

Run:

```powershell
rg -n -i "access_token|refresh_token|authorization|postgres(ql)?://|service_role|customer secret" .quality-results
```

Expected: no credential, connection string, or test secret is present. Allowed matches are only redaction labels such as `[redacted-url]`.

- [ ] **Step 9: Verify no business files changed**

Run:

```powershell
git diff --name-only d1ae3c9..HEAD | rg "^(ctyhp-accounting/(lib/domain|lib/services|supabase/migrations)|ctyhp-accounting/app/\(app\)/.+/actions\.ts)$"
```

Expected: no output.

- [ ] **Step 10: Commit only any verification-document correction**

If verification required an operations-guide correction, stage only that documentation file and commit it. Do not commit `.quality-results/` or accept a baseline in this task.

```bash
git status --short
git diff --check
```

Expected: generated quality artifacts are ignored; no unintended source changes remain.

- [ ] **Step 11: Hand the baseline candidate to the user**

Report:

- test/build/smoke command results;
- highest-impact Axe findings;
- keyboard failures;
- viewport overflow and small-target counts;
- median route/Web Vital results;
- query timing availability;
- largest shared and route bundles;
- confirmation that no business write request occurred.

Ask for explicit baseline acceptance before running:

```powershell
$env:QUALITY_ACCEPT_BASELINE='ONEBOOK_REVIEWED_QUALITY_BASELINE'
npm run quality:accept-baseline
```

Do not run that command without the user's separate approval of the generated report.
