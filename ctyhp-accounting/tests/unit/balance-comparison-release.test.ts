import { describe, expect, it } from "vitest";
import { RELEASES } from "@/lib/domain/changelog";

describe("2.18 in the release notes", () => {
  const release = RELEASES.find((r) => r.version === "2.18")!;
  const said = release.changes.map((c) => `${c.title} ${c.detail ?? ""}`).join(" ");

  it("is listed and dated the day it was built", () => {
    expect(release).toBeDefined();
    expect(release.date).toBe("2026-10-17");
  });

  it("names the report and its screen", () => {
    expect(release.changes.some((c) => c.title === "Balance Comparison" && c.route === "/reports/balance-comparison")).toBe(true);
  });

  it("says what the reviewer asked for: kept by date, the date in the heading, figures as printed", () => {
    expect(said).toMatch(/under that date/);
    expect(said).toMatch(/heading names the date and the other system/);
    expect(said).toMatch(/brackets or a minus/);
    expect(said).toMatch(/debits less credits/);
    expect(said).toMatch(/Staff save; viewers read/);
  });
});
