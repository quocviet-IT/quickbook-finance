import { describe, expect, it } from "vitest";
import { APP_VERSION, RELEASES } from "@/lib/domain/changelog";

describe("2.22 in the release notes", () => {
  const release = RELEASES.find((r) => r.version === "2.22")!;
  const said = release.changes.map((c) => `${c.title} ${c.detail ?? ""}`).join(" ");

  it("is listed, dated the day it was built, and newer releases sit above it", () => {
    expect(release).toBeDefined();
    expect(RELEASES.indexOf(release)).toBeGreaterThanOrEqual(0);
    expect(Number(APP_VERSION)).toBeGreaterThanOrEqual(2.22);
    expect(release.date).toBe("2026-10-17");
  });

  it("names the two reports that were reported, and both fixes", () => {
    for (const words of ["Vendor Balances", "Expenses by Vendor", "50 / page", "last row of the table"]) {
      expect(said).toContain(words);
    }
  });

  it("points at the two report screens", () => {
    expect(release.changes.map((c) => c.route)).toEqual(["/reports/vendor-balances", "/reports/expenses-by-vendor"]);
  });
});
