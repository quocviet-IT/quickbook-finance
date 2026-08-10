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
  navigationSafetyFailures,
  performanceMedians,
  selectRuntimeRoutes,
  subresourceFinding,
} from "../../scripts/quality/run-runtime.mjs";

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
});
