import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
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
import { aggregateQualityArtifacts, writeQualityReport } from "../../scripts/quality/report.mjs";

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
const requiredSectionArtifacts = [
  "axe.json",
  "bundle.json",
  "keyboard.json",
  "queries.json",
  "routes.json",
  "viewports.json",
  "web-vitals.json",
];

function completeReportSummary(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    mode: "report",
    sectionArtifacts: requiredSectionArtifacts,
    findings: [],
    measurements: [],
    unavailable: [],
    safetyFailures: [],
    budgets: { performance: { percent: 0.2, absoluteMs: 200, clsAbsolute: 0.03 } },
    ...overrides,
  };
}

function writeVerifiedReport(
  dir: string,
  overrides: Record<string, Record<string, unknown>> = {},
) {
  for (const name of requiredSectionArtifacts) {
    writeFileSync(join(dir, name), JSON.stringify({
      findings: [],
      measurements: [],
      unavailable: [],
      safetyFailures: [],
      ...(overrides[name] ?? {}),
    }));
  }
  const generated = aggregateQualityArtifacts(dir, { mode: "report" });
  writeQualityReport(dir, generated);
  return generated;
}

function expectNoBaselineOutput(dir: string, baseline: string) {
  expect(existsSync(baseline)).toBe(false);
  expect(readdirSync(dir).filter((name) => name.endsWith(".tmp"))).toEqual([]);
}

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

  it("requires the exact opt-in and accepts only a complete safety-clean report summary", () => {
    const dir = mkdtempSync(join(tmpdir(), "onebook-baseline-"));
    const results = join(dir, "summary.json");
    const baseline = join(dir, "nested", "baseline.json");
    writeVerifiedReport(dir, {
      "axe.json": { findings: [
        { fingerprint: "z-finding", payload: "customer" },
        { kind: "axe", rule: "label", route: "/invoices", viewport: "desktop", target: "#name" },
      ] },
      "web-vitals.json": { measurements: [
        { key: "performance./invoices.responseMs", kind: "performance", value: 1_000, raw: "private" },
      ] },
      "queries.json": { unavailable: [{ kind: "query", reason: "QUALITY_DATABASE_URL is not configured" }] },
    });
    expect(() => acceptBaseline(results, baseline, emptyTestEnv)).toThrow(/QUALITY_ACCEPT_BASELINE/);
    acceptBaseline(results, baseline, reviewedBaseline);
    expect(JSON.parse(readFileSync(baseline, "utf8"))).toEqual({
      version: 1,
      fingerprints: ["axe|label|/invoices|desktop|#name", "z-finding"],
      measurements: [{ key: "performance./invoices.responseMs", kind: "performance", value: 1_000 }],
      budgets: {
        bundle: { percent: 0.10, absoluteGzipBytes: 20_480 },
        performance: { percent: 0.20, absoluteMs: 200, clsAbsolute: 0.03 },
        informational: {
          lcpMs: 2_500,
          cls: 0.1,
          interactionMs: 200,
          responseMs: 1_000,
          longTaskMs: 200,
        },
      },
    });
  });

  it("rejects declared complete provenance when the seven source artifacts are absent", () => {
    const dir = mkdtempSync(join(tmpdir(), "onebook-baseline-forged-provenance-"));
    const results = join(dir, "summary.json");
    const baseline = join(dir, "baseline.json");
    writeFileSync(results, JSON.stringify(completeReportSummary()));

    expect(() => acceptBaseline(results, baseline, reviewedBaseline))
      .toThrow(/source|section artifact|provenance/i);
    expectNoBaselineOutput(dir, baseline);
  });

  it("rejects a generated summary whose canonical findings no longer match its source artifacts", () => {
    const dir = mkdtempSync(join(tmpdir(), "onebook-baseline-mismatch-"));
    const results = join(dir, "summary.json");
    const baseline = join(dir, "baseline.json");
    writeVerifiedReport(dir);
    const summary = JSON.parse(readFileSync(results, "utf8"));
    summary.findings.push({ fingerprint: "forged|finding|/dashboard|desktop|main" });
    writeFileSync(results, JSON.stringify(summary));

    expect(() => acceptBaseline(results, baseline, reviewedBaseline))
      .toThrow(/match|source|provenance/i);
    expectNoBaselineOutput(dir, baseline);
  });

  it("rejects linked results roots and linked summary entries before reading baseline input", () => {
    const base = mkdtempSync(join(tmpdir(), "onebook-baseline-linked-read-"));
    const outside = join(base, "outside");
    const linkedResults = join(base, "linked-results");
    const baseline = join(base, "baseline.json");
    mkdirSync(outside);
    writeVerifiedReport(outside);
    writeFileSync(join(outside, "sentinel.txt"), "outside-sentinel", "utf8");
    symlinkSync(outside, linkedResults, "junction");

    expect(() => acceptBaseline(join(linkedResults, "summary.json"), baseline, reviewedBaseline))
      .toThrow(/result root|owned|link|reparse/i);
    expect(readFileSync(join(outside, "sentinel.txt"), "utf8")).toBe("outside-sentinel");
    expectNoBaselineOutput(base, baseline);
    unlinkSync(linkedResults);

    const results = join(base, "real-results");
    const outsideSummary = join(base, "outside-summary");
    mkdirSync(results);
    mkdirSync(outsideSummary);
    writeVerifiedReport(results);
    unlinkSync(join(results, "summary.json"));
    writeFileSync(join(outsideSummary, "sentinel.txt"), "outside-summary-sentinel", "utf8");
    symlinkSync(outsideSummary, join(results, "summary.json"), "junction");

    expect(() => acceptBaseline(join(results, "summary.json"), baseline, reviewedBaseline))
      .toThrow(/target|owned|link|reparse/i);
    expect(readFileSync(join(outsideSummary, "sentinel.txt"), "utf8")).toBe("outside-summary-sentinel");
    expectNoBaselineOutput(base, baseline);
  });

  it.each([
    ["a non-v1 summary", { version: 9 }, /version/i],
    ["a regression summary", { mode: "regression" }, /report/i],
  ])("rejects %s without creating baseline or temporary output", (_label, override, expected) => {
    const dir = mkdtempSync(join(tmpdir(), "onebook-baseline-contract-"));
    const results = join(dir, "summary.json");
    const baseline = join(dir, "baseline.json");
    writeFileSync(results, JSON.stringify(completeReportSummary(override)));

    expect(() => acceptBaseline(results, baseline, reviewedBaseline)).toThrow(expected);
    expectNoBaselineOutput(dir, baseline);
  });

  it.each([
    ["findings", undefined],
    ["findings", {}],
    ["measurements", undefined],
    ["measurements", "fast"],
    ["unavailable", undefined],
    ["unavailable", {}],
    ["unavailable", ["not-a-record"]],
    ["safetyFailures", undefined],
    ["safetyFailures", {}],
  ])("rejects a summary with invalid required %s without output", (field, value) => {
    const dir = mkdtempSync(join(tmpdir(), "onebook-baseline-array-"));
    const results = join(dir, "summary.json");
    const baseline = join(dir, "baseline.json");
    const summary = completeReportSummary();
    if (value === undefined) delete summary[field as keyof typeof summary];
    else summary[field as keyof typeof summary] = value as never;
    writeFileSync(results, JSON.stringify(summary));

    expect(() => acceptBaseline(results, baseline, reviewedBaseline)).toThrow(new RegExp(String(field).replace(/s$/, "s?"), "i"));
    expectNoBaselineOutput(dir, baseline);
  });

  it("rejects any safety failure and incomplete section provenance without output", () => {
    for (const override of [
      { safetyFailures: [{ kind: "auth" }] },
      { sectionArtifacts: requiredSectionArtifacts.slice(0, -1) },
    ]) {
      const dir = mkdtempSync(join(tmpdir(), "onebook-baseline-provenance-"));
      const results = join(dir, "summary.json");
      const baseline = join(dir, "baseline.json");
      writeFileSync(results, JSON.stringify(completeReportSummary(override)));

      expect(() => acceptBaseline(results, baseline, reviewedBaseline)).toThrow(/safety|section artifact|provenance/i);
      expectNoBaselineOutput(dir, baseline);
    }
  });

  it("rejects a prepositioned baseline temporary reparse entry without touching outside content", () => {
    const dir = mkdtempSync(join(tmpdir(), "onebook-baseline-temp-link-"));
    const results = join(dir, "summary.json");
    const baseline = join(dir, "baseline.json");
    const outside = join(dir, "outside");
    const sentinel = join(outside, "sentinel.txt");
    const temporary = join(dir, "injected-baseline.tmp");
    writeVerifiedReport(dir);
    mkdirSync(outside);
    writeFileSync(sentinel, "outside-sentinel", "utf8");
    try {
      symlinkSync(outside, temporary, "junction");
    } catch (error) {
      if (["EACCES", "EPERM", "ENOTSUP"].includes((error as NodeJS.ErrnoException).code ?? "")) return;
      throw error;
    }

    expect(() => acceptBaseline(results, baseline, reviewedBaseline, {
      temporaryPathFor: () => temporary,
    })).toThrow(/temporary|link|exclusive|artifact/i);
    expect(readFileSync(sentinel, "utf8")).toBe("outside-sentinel");
    expect(existsSync(baseline)).toBe(false);
    expect(existsSync(temporary)).toBe(true);
    unlinkSync(temporary);
  });

  it("reports the exact section artifact filenames used for aggregation", () => {
    const dir = mkdtempSync(join(tmpdir(), "onebook-section-provenance-"));
    const emptySection = { findings: [], measurements: [], unavailable: [], safetyFailures: [] };
    for (const name of requiredSectionArtifacts) writeFileSync(join(dir, name), JSON.stringify(emptySection));

    expect(aggregateQualityArtifacts(dir, { mode: "report" }).sectionArtifacts)
      .toEqual(requiredSectionArtifacts);
  });

  it("rejects a linked report result root without writing through it", () => {
    const dir = mkdtempSync(join(tmpdir(), "onebook-report-linked-root-"));
    const outside = join(dir, "outside");
    const linked = join(dir, "linked-results");
    mkdirSync(outside);
    writeFileSync(join(outside, "sentinel.txt"), "outside-sentinel", "utf8");
    writeFileSync(join(outside, "bundle.json"), JSON.stringify({
      findings: [], measurements: [], unavailable: [], safetyFailures: [],
    }));
    try {
      symlinkSync(outside, linked, "junction");
    } catch (error) {
      if (["EACCES", "EPERM", "ENOTSUP"].includes((error as NodeJS.ErrnoException).code ?? "")) return;
      throw error;
    }

    expect(() => aggregateQualityArtifacts(linked, { mode: "report" }))
      .toThrow(/result root|owned|link|reparse/i);
    expect(() => writeQualityReport(linked, completeReportSummary()))
      .toThrow(/result root|owned|link|reparse/i);
    expect(readFileSync(join(outside, "sentinel.txt"), "utf8")).toBe("outside-sentinel");
    expect(existsSync(join(outside, "summary.json"))).toBe(false);
    unlinkSync(linked);
  });

  it("rejects a linked summary target without touching its outside sentinel", () => {
    const dir = mkdtempSync(join(tmpdir(), "onebook-summary-target-link-"));
    const outside = join(dir, "outside.txt");
    const target = join(dir, "summary.json");
    writeFileSync(outside, "outside-sentinel", "utf8");
    try {
      symlinkSync(outside, target, "file");
    } catch (error) {
      if (["EACCES", "EPERM", "ENOTSUP"].includes((error as NodeJS.ErrnoException).code ?? "")) return;
      throw error;
    }

    expect(() => writeQualityReport(dir, completeReportSummary())).toThrow(/target|artifact|link|reparse/i);
    expect(readFileSync(outside, "utf8")).toBe("outside-sentinel");
    expect(existsSync(target)).toBe(true);
  });

  it("rejects a deterministic prepositioned summary temporary reparse entry", () => {
    const dir = mkdtempSync(join(tmpdir(), "onebook-summary-temp-link-"));
    const outside = join(dir, "outside");
    const temporary = join(dir, "injected-summary.tmp");
    mkdirSync(outside);
    writeFileSync(join(outside, "sentinel.txt"), "outside-sentinel", "utf8");
    symlinkSync(outside, temporary, "junction");

    expect(() => writeQualityReport(dir, completeReportSummary(), {
      temporaryPathFor: () => temporary,
    })).toThrow(/temporary|link|exclusive|artifact/i);
    expect(readFileSync(join(outside, "sentinel.txt"), "utf8")).toBe("outside-sentinel");
    expect(existsSync(join(dir, "summary.json"))).toBe(false);
    expect(existsSync(temporary)).toBe(true);
    unlinkSync(temporary);
  });

  it("rejects a linked baseline target without touching its outside sentinel", () => {
    const dir = mkdtempSync(join(tmpdir(), "onebook-baseline-target-link-"));
    const results = join(dir, "summary.json");
    const baseline = join(dir, "baseline.json");
    const outside = join(dir, "outside.txt");
    writeVerifiedReport(dir);
    writeFileSync(outside, "outside-sentinel", "utf8");
    try {
      symlinkSync(outside, baseline, "file");
    } catch (error) {
      if (["EACCES", "EPERM", "ENOTSUP"].includes((error as NodeJS.ErrnoException).code ?? "")) return;
      throw error;
    }

    expect(() => acceptBaseline(results, baseline, reviewedBaseline)).toThrow(/target|artifact|link|reparse/i);
    expect(readFileSync(outside, "utf8")).toBe("outside-sentinel");
    expect(existsSync(baseline)).toBe(true);
  });

  it("rejects non-string fingerprints during baseline acceptance", () => {
    const dir = mkdtempSync(join(tmpdir(), "onebook-baseline-fingerprint-"));
    const results = join(dir, "summary.json");
    const baseline = join(dir, "baseline.json");
    writeFileSync(results, JSON.stringify(completeReportSummary({
      findings: [{ fingerprint: 42 }],
    })));

    expect(() => acceptBaseline(results, baseline, reviewedBaseline)).toThrow(/fingerprint/i);
    expect(existsSync(baseline)).toBe(false);
  });

  it("refuses to create an accepted baseline without numeric threshold budgets", () => {
    const dir = mkdtempSync(join(tmpdir(), "onebook-baseline-budget-"));
    const results = join(dir, "summary.json");
    const baseline = join(dir, "baseline.json");
    writeFileSync(results, JSON.stringify(completeReportSummary({
      budgets: { performance: { percent: "secret" } },
    })));

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
      writeFileSync(results, `{"version":1,"mode":"report","sectionArtifacts":${JSON.stringify(requiredSectionArtifacts)},"findings":[],"measurements":[${validMetric},${invalidMetric}],"unavailable":[],"safetyFailures":[],"budgets":{"performance":{"percent":0.2}}}`);

      expect(() => acceptBaseline(results, baseline, reviewedBaseline)).toThrow(/measurement/i);
      expect(existsSync(baseline)).toBe(false);
    }
  });

  it("atomically rejects accepted budget trees containing any invalid leaf", () => {
    const dir = mkdtempSync(join(tmpdir(), "onebook-baseline-mixed-budget-"));
    const results = join(dir, "summary.json");
    const baseline = join(dir, "baseline.json");
    writeFileSync(results, JSON.stringify(completeReportSummary({
      budgets: {
        performance: { percent: 0.2, absoluteMs: "two hundred" },
        bundle: { percent: 0.1, absoluteGzipBytes: 20_480 },
      },
    })));

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

  it("rejects a regression baseline beneath a linked parent before reading it", () => {
    const root = mkdtempSync(join(tmpdir(), "onebook-linked-regression-baseline-"));
    const resultsDir = join(root, "results");
    const outside = join(root, "outside");
    const linkedParent = join(root, "linked-parent");
    mkdirSync(resultsDir);
    mkdirSync(outside);
    writeFileSync(join(resultsDir, "bundle.json"), JSON.stringify({
      findings: [], measurements: [], unavailable: [], safetyFailures: [],
    }));
    writeFileSync(join(outside, "baseline.json"), JSON.stringify({
      version: 1,
      fingerprints: [],
      measurements: [],
      budgets: { performance: { percent: 0.2 } },
    }));
    symlinkSync(outside, linkedParent, "junction");
    const script = join(process.cwd(), "scripts", "quality", "report.mjs");

    const result = spawnSync(process.execPath, [script, resultsDir], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        QUALITY_MODE: "regression",
        QUALITY_BASELINE_PATH: join(linkedParent, "baseline.json"),
      },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/baseline.*owned|result root|link|reparse/i);
    expect(readFileSync(join(outside, "baseline.json"), "utf8")).toContain('"version":1');
    expect(existsSync(join(resultsDir, "summary.json"))).toBe(false);
    unlinkSync(linkedParent);
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
