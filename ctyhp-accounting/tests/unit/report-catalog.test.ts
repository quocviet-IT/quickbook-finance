import { describe, expect, it } from "vitest";
import { REPORT_CATALOG, REPORT_GROUPS } from "@/lib/domain/report-catalog";

describe("REPORT_CATALOG", () => {
  it("offers the saved reports archive", () => {
    const entry = REPORT_CATALOG.find((report) => report.id === "saved-reports");
    expect(entry).toBeDefined();
    expect(entry?.href).toBe("/reports/saved");
    expect(entry?.group).toBe("accounting");
  });

  it("gives every report a group that exists", () => {
    const groups = new Set(REPORT_GROUPS.map((group) => group.id));
    for (const report of REPORT_CATALOG) expect(groups.has(report.group)).toBe(true);
  });

  it("gives every report a unique id and href", () => {
    expect(new Set(REPORT_CATALOG.map((r) => r.id)).size).toBe(REPORT_CATALOG.length);
    expect(new Set(REPORT_CATALOG.map((r) => r.href)).size).toBe(REPORT_CATALOG.length);
  });
});
