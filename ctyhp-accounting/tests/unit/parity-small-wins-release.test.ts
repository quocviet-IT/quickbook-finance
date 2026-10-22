import { describe, expect, it } from "vitest";
import { APP_VERSION, RELEASES } from "@/lib/domain/changelog";

describe("the New menu, no-balance accounts and guide search release in the release notes", () => {
  const release = RELEASES.find((r) => r.changes.some((c) => c.title === "Show accounts with no balance"))!;
  const said = release.changes.map((c) => `${c.title} ${c.detail ?? ""}`).join(" ");

  it("is listed, dated the day it was built, and newer releases sit above it", () => {
    expect(release).toBeDefined();
    expect(Number(APP_VERSION)).toBeGreaterThanOrEqual(Number(release.version));
    expect(release.date).toBe("2026-10-22");
  });

  it("says what each of the three does, in the screen's own words", () => {
    for (const words of [
      "Pay bills",
      "Import a bank statement",
      "asks which account the statement is for",
      "every account that has been posted to, at 0.00",
      "Typing a version",
    ]) {
      expect(said).toContain(words);
    }
  });
});
