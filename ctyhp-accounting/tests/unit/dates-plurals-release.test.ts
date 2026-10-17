import { describe, expect, it } from "vitest";
import { APP_VERSION, RELEASES } from "@/lib/domain/changelog";

describe("2.17 in the release notes", () => {
  const release = RELEASES.find((r) => r.version === "2.17")!;
  const said = release.changes.map((c) => `${c.title} ${c.detail ?? ""}`).join(" ");

  it("is listed, dated the day it was built, and newer releases sit above it", () => {
    expect(release).toBeDefined();
    expect(RELEASES.indexOf(release)).toBeGreaterThanOrEqual(0);
    expect(Number(APP_VERSION)).toBeGreaterThanOrEqual(2.17);
    expect(release.date).toBe("2026-10-17");
  });

  it("shows the date style it describes, and says what exports keep", () => {
    expect(said).toContain("10/16/2026");
    expect(said).toContain("CSV and Excel keep 2026-10-16");
  });

  it("names the three things the review asked for", () => {
    for (const words of ["company's today", "1 bill or 2 bills", "Accountant | Management", "Contra"]) {
      expect(said).toContain(words);
    }
  });
});
