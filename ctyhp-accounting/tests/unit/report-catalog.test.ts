import { describe, expect, it } from "vitest";
import {
  REPORT_CATALOG,
  REPORT_GROUPS,
  findReportByLocation,
  isInternalReportId,
} from "@/lib/domain/report-catalog";

describe("report catalog", () => {
  it("contains unique reports and uses every category", () => {
    expect(REPORT_CATALOG).toHaveLength(17);
    expect(new Set(REPORT_CATALOG.map((report) => report.id)).size).toBe(
      REPORT_CATALOG.length,
    );

    for (const group of REPORT_GROUPS) {
      expect(REPORT_CATALOG.some((report) => report.group === group.id)).toBe(true);
    }
  });

  it("validates the five financial report identifiers", () => {
    expect(["trial", "pnl", "balance", "budget", "equity"].every(isInternalReportId)).toBe(
      true,
    );
    expect(isInternalReportId("cash-flow")).toBe(false);
    expect(isInternalReportId(undefined)).toBe(false);
  });

  it("resolves query-based financial reports", () => {
    expect(findReportByLocation("/reports", "pnl")?.id).toBe("profit-and-loss");
    expect(findReportByLocation("/reports", "trial")?.id).toBe("trial-balance");
    expect(findReportByLocation("/reports", "unknown")).toBeUndefined();
  });

  it("resolves dedicated report routes", () => {
    expect(findReportByLocation("/reports/general-ledger")?.id).toBe("general-ledger");
    expect(findReportByLocation("/sales-tax")?.id).toBe("sales-tax");
  });
});
