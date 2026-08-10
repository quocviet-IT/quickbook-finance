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

const reviewedBaseline = { QUALITY_ACCEPT_BASELINE: "ONEBOOK_REVIEWED_QUALITY_BASELINE" };

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
    expect(comparison.measurementRegressions.map(({ key }) => key)).toEqual([
      "bundle.route./invoices.gzipBytes",
      "performance./invoices.responseMs",
      "performance./invoices.cls",
      "query./invoices.count",
    ]);
    expect(comparison.measurementRegressions.at(-1)?.advisory).toBe(true);
    expect(qualityExitCode({ mode: "report", comparison, safetyFailures: [] })).toBe(0);
    expect(qualityExitCode({ mode: "regression", comparison, safetyFailures: [] })).toBe(1);
  });

  it("keeps query regressions advisory but always fails safety failures", () => {
    const comparison = {
      newFindings: [],
      measurementRegressions: [{ key: "query.count", advisory: true }],
    };
    expect(qualityExitCode({ mode: "regression", comparison, safetyFailures: [] })).toBe(0);
    expect(qualityExitCode({ mode: "report", comparison, safetyFailures: [{ kind: "auth" }] })).toBe(1);
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
        ignored: { key: "ignored", kind: "performance", value: "not-a-number" },
      },
      budgets: { performance: { percent: 0.20, absoluteMs: 200, clsAbsolute: 0.03 } },
      unavailable: [{ reason: "secret" }],
      safetyFailures: [{ html: "<p>Customer</p>" }],
    }), "utf8");
    expect(() => acceptBaseline(results, baseline, {})).toThrow(/QUALITY_ACCEPT_BASELINE/);
    acceptBaseline(results, baseline, reviewedBaseline);
    expect(JSON.parse(readFileSync(baseline, "utf8"))).toEqual({
      version: 1,
      fingerprints: ["axe|label|/invoices|desktop|#name", "z-finding"],
      measurements: [{ key: "performance./invoices.responseMs", kind: "performance", value: 1_000 }],
      budgets: { performance: { percent: 0.20, absoluteMs: 200, clsAbsolute: 0.03 } },
    });
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
    writeFileSync(join(regressionDir, "bundle.json"), JSON.stringify({ findings: [], measurements: [] }));
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
});
