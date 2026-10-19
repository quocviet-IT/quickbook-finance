import { describe, expect, it } from "vitest";
import { APP_VERSION, RELEASES } from "@/lib/domain/changelog";

describe("the report bar release in the release notes", () => {
  const release = RELEASES.find((r) => r.changes.some((c) => c.title === "One report bar on every report"))!;
  const said = release.changes.map((c) => `${c.title} ${c.detail ?? ""}`).join(" ");

  it("is listed, dated the day it was built, and newer releases sit above it", () => {
    expect(release).toBeDefined();
    expect(Number(APP_VERSION)).toBeGreaterThanOrEqual(Number(release.version));
    expect(release.date).toBe("2026-10-19");
  });

  it("names the one run label, the exports in order, and the reports that now open run", () => {
    for (const words of ["Run report everywhere", "Copy this report, CSV, PDF, Excel and Print", "AP Aging", "General Ledger"]) {
      expect(said).toContain(words);
    }
  });
});
