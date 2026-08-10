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
