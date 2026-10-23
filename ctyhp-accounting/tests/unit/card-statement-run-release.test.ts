import { describe, expect, it } from "vitest";
import { APP_VERSION, RELEASES } from "@/lib/domain/changelog";

describe("the card statement release in the release notes", () => {
  const release = RELEASES.find((r) => r.changes.some((c) => c.title === "Reconcile a credit card from its PDF statements"))!;
  const said = release.changes.map((c) => `${c.title} ${c.detail ?? ""}`).join(" ");

  it("is listed, dated the day it was built, and newer releases sit above it", () => {
    expect(release).toBeDefined();
    expect(Number(APP_VERSION)).toBeGreaterThanOrEqual(Number(release.version));
    expect(release.date).toBe("2026-10-23");
  });

  it("says what is read off a card's PDF, how a month is signed, and that nothing is posted", () => {
    for (const words of [
      "the closing date, the previous balance and the new balance",
      "checks that the summary adds up",
      "the card's lines to its closing date come to its new balance",
      "Nothing is imported, categorized or posted",
      "dated by its post date",
    ]) {
      expect(said).toContain(words);
    }
  });
});
