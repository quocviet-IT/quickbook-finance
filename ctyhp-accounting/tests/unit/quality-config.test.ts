import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BUDGETS,
  MATRIX_ROUTES,
  VIEWPORTS,
  qualityMode,
  qualityPaths,
  runtimeSchedule,
} from "../../scripts/quality/config.mjs";
import {
  finalizeGuardedContext,
  isLoginLocation,
  isUnsafeOwnedRootEntry,
  navigateForPerformance,
  navigationSafetyFailures,
  pageFailureTracker,
  performanceSample,
  performanceMedians,
  selectRuntimeRoutes,
  subresourceFinding,
  validateOwnedResultRoots,
  waitForLoadFinalization,
} from "../../scripts/quality/run-runtime.mjs";

describe("quality configuration", () => {
  it("exposes five runnable quality operations through npm", () => {
    const npmCli = process.env.npm_execpath;
    expect(npmCli).toBeTruthy();
    const listed = spawnSync(process.execPath, [npmCli!, "run", "--json"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    expect(listed.status, listed.stderr).toBe(0);
    const scripts = JSON.parse(listed.stdout) as Record<string, string>;
    const qualityScripts = Object.fromEntries(
      Object.entries(scripts).filter(([name]) => name.startsWith("quality:")),
    );
    expect(qualityScripts).toEqual({
      "quality:bundle": "node scripts/quality/run-bundle.mjs",
      "quality:runtime": "node --env-file-if-exists=.env.local scripts/quality/run-runtime.mjs",
      "quality:report": "node scripts/quality/report.mjs",
      "quality:all": "npm run quality:bundle && npm run quality:runtime",
      "quality:accept-baseline": "node scripts/quality/accept-baseline.mjs",
    });

    const entryPoints = new Set(
      Object.values(qualityScripts).flatMap((command) =>
        command.match(/scripts\/quality\/[a-z-]+\.mjs/g) ?? [],
      ),
    );
    expect([...entryPoints].sort()).toEqual([
      "scripts/quality/accept-baseline.mjs",
      "scripts/quality/report.mjs",
      "scripts/quality/run-bundle.mjs",
      "scripts/quality/run-runtime.mjs",
    ]);
    for (const entryPoint of entryPoints) {
      expect(existsSync(join(process.cwd(), entryPoint)), entryPoint).toBe(true);
    }

    const temporary = mkdtempSync(join(tmpdir(), "quality-command-contract-"));
    const baselinePath = join(temporary, "baseline.json");
    try {
      writeFileSync(join(temporary, "bundle.json"), JSON.stringify({
        version: 1,
        findings: [],
        measurements: [],
        unavailable: [],
        safetyFailures: [],
      }));
      const safeEnv: NodeJS.ProcessEnv = { ...process.env, QUALITY_MODE: "report" };
      delete safeEnv.QUALITY_ACCEPT_BASELINE;
      const reported = spawnSync(
        process.execPath,
        [npmCli!, "run", "quality:report", "--", temporary],
        { cwd: process.cwd(), encoding: "utf8", env: safeEnv },
      );
      expect(reported.status, reported.stderr).toBe(0);
      expect(existsSync(join(temporary, "summary.json"))).toBe(true);

      const rejectedAcceptance = spawnSync(
        process.execPath,
        [
          npmCli!,
          "run",
          "quality:accept-baseline",
          "--",
          join(temporary, "summary.json"),
          baselinePath,
        ],
        { cwd: process.cwd(), encoding: "utf8", env: safeEnv },
      );
      expect(rejectedAcceptance.status).toBe(1);
      expect(rejectedAcceptance.stderr).toMatch(/ONEBOOK_REVIEWED_QUALITY_BASELINE/);
      expect(existsSync(baselinePath)).toBe(false);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  }, 15_000);

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

  it("audits every static route at desktop and matrix routes at four viewports", () => {
    const schedule = runtimeSchedule(["/dashboard", "/reports", "/settings/import"]);
    expect(schedule.filter((item) => item.route === "/dashboard")).toHaveLength(4);
    expect(schedule).toContainEqual({ route: "/settings/import", viewport: "desktop", audit: "matrix" });
  });

  it("selects only discovered static routes requested by QUALITY_ONLY", () => {
    expect(selectRuntimeRoutes(["/dashboard", "/reports", "/settings"], "reports,dashboard,reports"))
      .toEqual(["/dashboard", "/reports"]);
    expect(() => selectRuntimeRoutes(["/dashboard"], "missing")).toThrow(/static authenticated route/);
  });

  it("reports medians from exactly three measured navigations", () => {
    expect(performanceMedians([
      { navigationMs: 900, responseMs: 300, ttfbMs: 100, dclMs: 500, loadMs: 700, lcpMs: 600, cls: 0.06, interactionMs: 120, longTaskMs: 40, transferredBytes: 3_000, failedSubresources: 2 },
      { navigationMs: 300, responseMs: 100, ttfbMs: 50, dclMs: 200, loadMs: 250, lcpMs: 400, cls: 0.02, interactionMs: 80, longTaskMs: 20, transferredBytes: 1_000, failedSubresources: 0 },
      { navigationMs: 600, responseMs: 200, ttfbMs: 75, dclMs: 350, loadMs: 450, lcpMs: 500, cls: 0.04, interactionMs: 100, longTaskMs: 30, transferredBytes: 2_000, failedSubresources: 1 },
    ])).toEqual({
      navigationMs: 600,
      responseMs: 200,
      ttfbMs: 75,
      dclMs: 350,
      loadMs: 450,
      lcpMs: 500,
      cls: 0.04,
      interactionMs: 100,
      longTaskMs: 30,
      transferredBytes: 2_000,
      failedSubresources: 1,
    });
    expect(() => performanceMedians([])).toThrow(/exactly three/);
  });

  it("separates document harness failures from sanitized subresource findings", () => {
    expect(navigationSafetyFailures({
      route: "/dashboard",
      status: 503,
      finalPath: "/login",
      errorBoundary: true,
      pageError: true,
    }).map(({ kind }) => kind)).toEqual(["document-navigation", "auth", "error-boundary", "page-error"]);
    expect(subresourceFinding({
      route: "/dashboard",
      viewport: "desktop",
      url: "https://example.test/private/avatar.png?token=secret",
      resourceType: "image",
      status: 404,
    })).toEqual({
      kind: "subresource",
      rule: "request-failed",
      route: "/dashboard",
      viewport: "desktop",
      target: "/private/avatar.png",
      resourceType: "image",
      status: 404,
    });
  });

  it("keeps incomplete load data and an empty interaction observation unavailable", async () => {
    const calls: unknown[] = [];
    const finalized = await waitForLoadFinalization({
      waitForLoadState: async (...args: unknown[]) => {
        calls.push(args);
        throw new Error("load timeout");
      },
    }, 2_500);
    expect(finalized).toBe(false);
    expect(calls).toEqual([["load", { timeout: 2_500 }]]);

    expect(performanceSample({
      navigation: {
        duration: 900,
        responseEnd: 300,
        responseStart: 100,
        domContentLoadedEventEnd: 500,
        loadEventEnd: 0,
        transferSize: 3_000,
      },
      resources: [{ transferSize: 1_000 }],
      metrics: { lcp: 600, cls: 0.06, interactions: [], longTasks: [40], unsupported: [] },
    }, { loadFinalized: finalized, failedSubresources: 2 })).toEqual({
      navigationMs: null,
      responseMs: 300,
      ttfbMs: 100,
      dclMs: 500,
      loadMs: null,
      lcpMs: 600,
      cls: 0.06,
      interactionMs: null,
      longTaskMs: 40,
      transferredBytes: null,
      failedSubresources: 2,
    });
    expect(performanceMedians([
      { interactionMs: null },
      { interactionMs: 20 },
      { interactionMs: 40 },
    ]).interactionMs).toBeNull();
  });

  it("records a late page error immediately before guard assertion and cleanup", async () => {
    const order: string[] = [];
    const sections = { routes: { safetyFailures: [] as Array<{ kind: string; route?: string }> } };
    await finalizeGuardedContext({
      tracker: {
        get pageError() {
          order.push("page-error-check");
          return true;
        },
      },
      guard: {
        blocked: [],
        assertSafe() { order.push("assert-safe"); },
        context: { async close() { order.push("close"); } },
      },
      sections,
      route: "/dashboard",
      viewport: "desktop",
    });
    expect(sections.routes.safetyFailures).toEqual([{ kind: "page-error", route: "/dashboard" }]);
    expect(order).toEqual(["page-error-check", "assert-safe", "close"]);
  });

  it("keeps a late page error sticky across sequential performance navigations", async () => {
    const handlers = new Map<string, () => void>();
    let navigations = 0;
    const page = {
      on(event: string, handler: () => void) { handlers.set(event, handler); },
      async goto() {
        navigations += 1;
        return { status: () => 200 };
      },
      async waitForSelector() {},
      async waitForLoadState() {},
      async waitForTimeout() {},
      url: () => "http://quality.test/dashboard",
      getByText: () => ({ count: async () => 0 }),
      async evaluate() {
        return {
          navigation: {
            duration: 900,
            responseEnd: 300,
            responseStart: 100,
            domContentLoadedEventEnd: 500,
            loadEventEnd: 700,
            transferSize: 3_000,
          },
          resources: [{ transferSize: 1_000 }],
          metrics: { lcp: 600, cls: 0.06, interactions: [], longTasks: [40], unsupported: [] },
        };
      },
    };
    const tracker = pageFailureTracker(page, "/dashboard", "desktop");

    const first = await navigateForPerformance(page, tracker, "http://quality.test/dashboard", "/dashboard");
    expect(first.safetyFailures).toEqual([]);
    handlers.get("pageerror")?.();
    const second = await navigateForPerformance(page, tracker, "http://quality.test/dashboard", "/dashboard");

    expect(navigations).toBe(2);
    expect(second.safetyFailures).toContainEqual({ kind: "page-error", route: "/dashboard" });
    expect(tracker.pageError).toBe(true);
  });

  it("normalizes canonical login locations without matching unrelated routes", () => {
    expect(isLoginLocation("/login")).toBe(true);
    expect(isLoginLocation("/login/")).toBe(true);
    expect(isLoginLocation("https://example.test/login/?next=%2Fdashboard#form")).toBe(true);
    expect(isLoginLocation("/login-help")).toBe(false);
    expect(navigationSafetyFailures({ route: "/dashboard", status: 200, finalPath: "/login/" }))
      .toEqual([{ kind: "auth", route: "/dashboard" }]);
  });

  it("rejects unsafe owned result roots before artifact writes", () => {
    expect(isUnsafeOwnedRootEntry({ isSymbolicLink: () => true, isDirectory: () => true })).toBe(true);
    expect(isUnsafeOwnedRootEntry({ isSymbolicLink: () => false, isDirectory: () => false })).toBe(true);
    expect(isUnsafeOwnedRootEntry({ isSymbolicLink: () => false, isDirectory: () => true })).toBe(false);

    const temporary = mkdtempSync(join(tmpdir(), "quality-runtime-roots-"));
    const results = join(temporary, "results");
    const screenshots = join(results, "screenshots");
    mkdirSync(screenshots, { recursive: true });
    try {
      expect(() => validateOwnedResultRoots(results, screenshots)).not.toThrow();
      const outside = join(temporary, "outside");
      const linkedResults = join(temporary, "linked-results");
      mkdirSync(outside);
      try {
        symlinkSync(outside, linkedResults, "junction");
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code ?? "";
        if (["EACCES", "EPERM", "ENOTSUP"].includes(code)) return;
        throw error;
      }
      expect(() => validateOwnedResultRoots(linkedResults, join(linkedResults, "screenshots")))
        .toThrow(/owned quality result root/i);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });
});
