import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

type QualityExitInput = {
  mode: "report" | "regression";
  comparison: {
    newFindings: unknown[];
    measurementRegressions: Array<{ advisory?: boolean }>;
  };
  safetyFailures: Array<{ kind: string }>;
};

const qualityExitCodeWithTypedFindings = qualityExitCode as unknown as (
  input: QualityExitInput,
) => number;
const emptyTestEnv: NodeJS.ProcessEnv = { NODE_ENV: "test" };
const reviewedBaseline: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  QUALITY_ACCEPT_BASELINE: "ONEBOOK_REVIEWED_QUALITY_BASELINE",
};

describe("quality result model", () => {
  it("uses stable fingerprints and medians", () => {
    expect(median([])).toBeNull();
    expect(median([900, 100, 300])).toBe(300);
    expect(median([4, 2])).toBe(3);
    expect(findingFingerprint({ kind: "axe", rule: "label", route: "/invoices", viewport: "desktop", target: "#name" }))
      .toBe("axe|label|/invoices|desktop|#name");
  });

  it("redacts credentials, authorization values, URLs, query strings, and HTML recursively", () => {
    expect(redactQualityValue("postgres://user:secret@db/name")).toBe("[redacted-url]");
    expect(redactQualityValue({
      url: "https://qa.example.test/invoices?token=secret",
      headers: ["authorization=Bearer-secret", "Authorization: Bearer credential-value", "cookie=session-secret"],
      customerPayload: "<main><p>Customer Name</p></main>",
      nested: { apiKey: "plain-secret", safe: "desktop" },
    })).toEqual({
      url: "https://qa.example.test/invoices",
      headers: ["authorization=[redacted]", "Authorization=[redacted]", "cookie=[redacted]"],
      customerPayload: "[redacted-content]",
      nested: { apiKey: "[redacted]", safe: "desktop" },
    });
  });

  it("redacts free-text credentials, database URLs, relative queries, Basic auth, and customer fields from artifacts", () => {
    const dir = mkdtempSync(join(tmpdir(), "onebook-redaction-regression-"));
    const unsafe = {
      notes: [
        "password=hunter2",
        "token=secret",
        "mysql://user:pw@host/db",
        "/invoices?token=secret",
        "invoices?customer=QueryLeak",
        "Authorization: Basic credential",
      ],
      customerName: "Acme",
      dbPassword: "database-password",
      authMaterial: "private-auth-value",
    };

    expect(redactQualityValue(unsafe)).toEqual({
      notes: [
        "password=[redacted]",
        "token=[redacted]",
        "[redacted-url]",
        "/invoices",
        "invoices",
        "Authorization=[redacted]",
      ],
      customerName: "[redacted]",
      dbPassword: "[redacted]",
      authMaterial: "[redacted]",
    });

    writeQualityReport(dir, {
      version: 1,
      mode: "report",
      findings: [unsafe],
      measurements: [],
      unavailable: [],
      safetyFailures: [],
    });
    for (const artifact of ["summary.json", "summary.md"]) {
      const contents = readFileSync(join(dir, artifact), "utf8");
      for (const secret of ["hunter2", "secret", "user:pw", "credential", "Acme", "QueryLeak", "database-password", "private-auth-value", "?token=", "?customer="]) {
        expect(contents).not.toContain(secret);
      }
    }
  });

  it("reports new fingerprints plus material metric regressions", () => {
    const baseline = {
      fingerprints: ["axe|label|/invoices|desktop|#name"],
      measurements: [
        { key: "bundle.route./invoices.gzipBytes", kind: "bundle", value: 100_000 },
        { key: "performance./invoices.responseMs", kind: "performance", value: 1_000 },
        { key: "performance./invoices.cls", kind: "cls", value: 0.05 },
        { key: "query./invoices.count", kind: "query", value: 10 },
      ],
    };
    const current = { findings: [
      { fingerprint: "axe|label|/invoices|desktop|#name" },
      { fingerprint: "overflow|document|/banking|mobile|body" },
    ], measurements: [
      { key: "bundle.route./invoices.gzipBytes", kind: "bundle", value: 125_001 },
      { key: "performance./invoices.responseMs", kind: "performance", value: 1_250 },
      { key: "performance./invoices.cls", kind: "cls", value: 0.09 },
      { key: "query./invoices.count", kind: "query", value: 30 },
    ] };
    const comparison = compareAgainstBaseline(current, baseline, {
      bundle: { percent: 0.10, absoluteGzipBytes: 20 * 1024 },
      performance: { percent: 0.20, absoluteMs: 200, clsAbsolute: 0.03 },
    });
    expect(comparison.newFindings).toHaveLength(1);
    expect(comparison.measurementRegressions.map(({ key }: { key: string }) => key)).toEqual([
      "bundle.route./invoices.gzipBytes",
      "performance./invoices.responseMs",
      "performance./invoices.cls",
      "query./invoices.count",
    ]);
    expect(comparison.measurementRegressions.at(-1)?.advisory).toBe(true);
    expect(qualityExitCodeWithTypedFindings({ mode: "report", comparison, safetyFailures: [] })).toBe(0);
    expect(qualityExitCodeWithTypedFindings({ mode: "regression", comparison, safetyFailures: [] })).toBe(1);
  });

  it("keeps query regressions advisory but always fails safety failures", () => {
    const comparison = {
      newFindings: [],
      measurementRegressions: [{ key: "query.count", advisory: true }],
    };
    expect(qualityExitCodeWithTypedFindings({ mode: "regression", comparison, safetyFailures: [] })).toBe(0);
    expect(qualityExitCodeWithTypedFindings({ mode: "report", comparison, safetyFailures: [{ kind: "auth" }] })).toBe(1);
  });

  it("writes sanitized JSON and Markdown atomically without implicit baseline mutation", () => {
    const dir = mkdtempSync(join(tmpdir(), "onebook-quality-"));
    const baseline = join(dir, "baseline.json");
    writeFileSync(baseline, JSON.stringify({ fingerprints: [] }), "utf8");
    writeQualityReport(dir, {
      version: 1,
      mode: "report",
      findings: [{ payload: "<div>Customer One</div>" }],
      measurements: {},
      unavailable: [],
      safetyFailures: [],
      databaseUrl: "postgresql://user:password@host/db",
    });
    const json = readFileSync(join(dir, "summary.json"), "utf8");
    const markdown = readFileSync(join(dir, "summary.md"), "utf8");
    expect(JSON.parse(json)).toMatchObject({ mode: "report", databaseUrl: "[redacted-url]" });
    expect(json).not.toContain("Customer One");
    expect(markdown).not.toContain("Customer One");
    expect(markdown).not.toContain("password");
    expect(readFileSync(baseline, "utf8")).toBe('{"fingerprints":[]}');
    expect(existsSync(join(dir, "summary.json.tmp"))).toBe(false);
  });

  it("requires the exact opt-in and accepts only a compact normalized baseline", () => {
    const dir = mkdtempSync(join(tmpdir(), "onebook-baseline-"));
    const results = join(dir, "summary.json");
    const baseline = join(dir, "nested", "baseline.json");
    writeFileSync(results, JSON.stringify({
      version: 9,
      mode: "report",
      findings: [
        { fingerprint: "z-finding", payload: "customer" },
        { kind: "axe", rule: "label", route: "/invoices", viewport: "desktop", target: "#name" },
      ],
      measurements: {
        response: { key: "performance./invoices.responseMs", kind: "performance", value: 1_000, raw: "private" },
      },
      budgets: { performance: { percent: 0.20, absoluteMs: 200, clsAbsolute: 0.03 } },
      unavailable: [{ reason: "secret" }],
      safetyFailures: [{ html: "<p>Customer</p>" }],
    }), "utf8");
    expect(() => acceptBaseline(results, baseline, emptyTestEnv)).toThrow(/QUALITY_ACCEPT_BASELINE/);
    acceptBaseline(results, baseline, reviewedBaseline);
    expect(JSON.parse(readFileSync(baseline, "utf8"))).toEqual({
      version: 1,
      fingerprints: ["axe|label|/invoices|desktop|#name", "z-finding"],
      measurements: [{ key: "performance./invoices.responseMs", kind: "performance", value: 1_000 }],
      budgets: { performance: { percent: 0.20, absoluteMs: 200, clsAbsolute: 0.03 } },
    });
  });

  it("rejects non-string fingerprints during baseline acceptance", () => {
    const dir = mkdtempSync(join(tmpdir(), "onebook-baseline-fingerprint-"));
    const results = join(dir, "summary.json");
    const baseline = join(dir, "baseline.json");
    writeFileSync(results, JSON.stringify({
      findings: [{ fingerprint: 42 }],
      measurements: [],
      budgets: { performance: { percent: 0.2 } },
    }));

    expect(() => acceptBaseline(results, baseline, reviewedBaseline)).toThrow(/fingerprint/i);
    expect(existsSync(baseline)).toBe(false);
  });

  it("refuses to create an accepted baseline without numeric threshold budgets", () => {
    const dir = mkdtempSync(join(tmpdir(), "onebook-baseline-budget-"));
    const results = join(dir, "summary.json");
    const baseline = join(dir, "baseline.json");
    writeFileSync(results, JSON.stringify({
      findings: [],
      measurements: [],
      budgets: { performance: { percent: "secret" } },
    }));

    expect(() => acceptBaseline(results, baseline, reviewedBaseline)).toThrow(/numeric.*budget/i);
    expect(existsSync(baseline)).toBe(false);
  });

  it("atomically rejects mixed accepted measurements with invalid keys, kinds, or nonfinite values", () => {
    const validMetric = '{"key":"performance.valid.responseMs","kind":"performance","value":1000}';
    const invalidMetrics = [
      '{"key":42,"kind":"performance","value":1001}',
      '{"key":"performance.invalid.responseMs","kind":"unknown","value":1001}',
      '{"key":"performance.invalid.responseMs","kind":"performance","value":1e999}',
    ];

    for (const invalidMetric of invalidMetrics) {
      const dir = mkdtempSync(join(tmpdir(), "onebook-baseline-measurement-"));
      const results = join(dir, "summary.json");
      const baseline = join(dir, "baseline.json");
      writeFileSync(results, `{"findings":[],"measurements":[${validMetric},${invalidMetric}],"budgets":{"performance":{"percent":0.2}}}`);

      expect(() => acceptBaseline(results, baseline, reviewedBaseline)).toThrow(/measurement/i);
      expect(existsSync(baseline)).toBe(false);
    }
  });

  it("atomically rejects accepted budget trees containing any invalid leaf", () => {
    const dir = mkdtempSync(join(tmpdir(), "onebook-baseline-mixed-budget-"));
    const results = join(dir, "summary.json");
    const baseline = join(dir, "baseline.json");
    writeFileSync(results, JSON.stringify({
      findings: [],
      measurements: [],
      budgets: {
        performance: { percent: 0.2, absoluteMs: "two hundred" },
        bundle: { percent: 0.1, absoluteGzipBytes: 20_480 },
      },
    }));

    expect(() => acceptBaseline(results, baseline, reviewedBaseline)).toThrow(/numeric.*budget/i);
    expect(existsSync(baseline)).toBe(false);
  });

  it("direct report CLI aggregates section artifacts", () => {
    const dir = mkdtempSync(join(tmpdir(), "onebook-report-cli-"));
    writeFileSync(join(dir, "accessibility.json"), JSON.stringify({
      findings: [{ fingerprint: "axe|label|/invoices|desktop|#name" }],
      measurements: [{ key: "query.count", kind: "query", value: 2 }],
      unavailable: [],
      safetyFailures: [],
    }));
    const script = join(process.cwd(), "scripts", "quality", "report.mjs");
    const result = spawnSync(process.execPath, [script, dir], { cwd: process.cwd(), encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, "summary.json"), "utf8"))).toMatchObject({
      findings: [{ fingerprint: "axe|label|/invoices|desktop|#name" }],
      measurements: [{ key: "query.count", kind: "query", value: 2 }],
    });
  });

  it("direct report CLI fails clearly without artifacts or a valid regression baseline", () => {
    const emptyDir = mkdtempSync(join(tmpdir(), "onebook-report-empty-"));
    const missingDir = join(emptyDir, "not-created");
    const regressionDir = mkdtempSync(join(tmpdir(), "onebook-report-regression-"));
    writeFileSync(join(regressionDir, "bundle.json"), JSON.stringify({
      findings: [], measurements: [], unavailable: [], safetyFailures: [],
    }));
    const script = join(process.cwd(), "scripts", "quality", "report.mjs");

    const empty = spawnSync(process.execPath, [script, emptyDir], { cwd: process.cwd(), encoding: "utf8" });
    expect(empty.status).toBe(1);
    expect(empty.stderr).toMatch(/no section artifacts/i);

    const missing = spawnSync(process.execPath, [script, missingDir], { cwd: process.cwd(), encoding: "utf8" });
    expect(missing.status).toBe(1);
    expect(missing.stderr).toMatch(/no section artifacts/i);

    const regression = spawnSync(process.execPath, [script, regressionDir], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, QUALITY_MODE: "regression", QUALITY_BASELINE_PATH: join(regressionDir, "missing.json") },
    });
    expect(regression.status).toBe(1);
    expect(regression.stderr).toMatch(/baseline/i);
  });

  it("rejects malformed regression baseline scalar values", () => {
    const root = mkdtempSync(join(tmpdir(), "onebook-invalid-baseline-"));
    const resultsDir = mkdtempSync(join(tmpdir(), "onebook-invalid-baseline-results-"));
    const baseline = join(root, "baseline.json");
    const script = join(process.cwd(), "scripts", "quality", "report.mjs");
    const valid = {
      version: 1,
      fingerprints: ["axe|label|/invoices|desktop|#name"],
      measurements: [{ key: "performance./invoices.responseMs", kind: "performance", value: 1_000 }],
      budgets: { performance: { percent: 0.2, absoluteMs: 200, clsAbsolute: 0.03 } },
    };
    const invalidBaselines = [
      { ...valid, fingerprints: [42] },
      { ...valid, measurements: [{ key: "metric", kind: "performance", value: null }] },
      { ...valid, measurements: [{ key: 42, kind: "performance", value: 1 }] },
      { ...valid, measurements: [{ key: "metric", kind: null, value: 1 }] },
      { ...valid, measurements: [{ key: "metric", kind: "unknown", value: 1 }] },
      { ...valid, budgets: { performance: { percent: "twenty percent" } } },
    ];
    writeFileSync(join(resultsDir, "performance.json"), JSON.stringify({
      findings: [], measurements: [], unavailable: [], safetyFailures: [],
    }));
    for (const invalid of invalidBaselines) {
      writeFileSync(baseline, JSON.stringify(invalid));
      const result = spawnSync(process.execPath, [script, resultsDir], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: { ...process.env, QUALITY_MODE: "regression", QUALITY_BASELINE_PATH: baseline },
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/baseline.*malformed/i);
    }
  });

  it("rejects empty and invalid section artifact contracts with a clear harness error", () => {
    const dir = mkdtempSync(join(tmpdir(), "onebook-invalid-section-"));
    const script = join(process.cwd(), "scripts", "quality", "report.mjs");
    const invalidSections = [
      {},
      { findings: {}, measurements: [], unavailable: [], safetyFailures: [] },
      { findings: [], measurements: "fast", unavailable: [], safetyFailures: [] },
      { findings: [], measurements: [], unavailable: {}, safetyFailures: [] },
      { findings: [], measurements: [], unavailable: [], safetyFailures: {} },
    ];

    for (const invalid of invalidSections) {
      writeFileSync(join(dir, "section.json"), JSON.stringify(invalid));
      const result = spawnSync(process.execPath, [script, dir], { cwd: process.cwd(), encoding: "utf8" });
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/quality harness error.*section artifact.*contract/i);
    }
  });
});
