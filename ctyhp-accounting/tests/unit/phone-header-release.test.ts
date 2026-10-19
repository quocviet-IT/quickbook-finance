import { describe, expect, it } from "vitest";
import { APP_VERSION, RELEASES } from "@/lib/domain/changelog";

describe("2.26 in the release notes", () => {
  const release = RELEASES.find((r) => r.version === "2.26")!;
  const said = release.changes.map((c) => `${c.title} ${c.detail ?? ""}`).join(" ");

  it("is listed, dated the day it was built, and newer releases sit above it", () => {
    expect(release).toBeDefined();
    expect(RELEASES.indexOf(release)).toBeGreaterThanOrEqual(0);
    expect(Number(APP_VERSION)).toBeGreaterThanOrEqual(2.26);
    expect(release.date).toBe("2026-10-19");
  });

  it("names both fixes in the screens' words", () => {
    for (const words of ["header on a phone", "search takes the whole row below", "Pay Bills", "Review rather than Apply"]) {
      expect(said).toContain(words);
    }
  });
});
