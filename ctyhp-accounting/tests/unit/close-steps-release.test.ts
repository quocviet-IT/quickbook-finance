import { describe, expect, it } from "vitest";
import { APP_VERSION, RELEASES } from "@/lib/domain/changelog";

describe("the month-end checks release in the release notes", () => {
  const release = RELEASES.find((r) => r.changes.some((c) => c.title === "Six more checks before a month is closed"))!;
  const said = release.changes.map((c) => `${c.title} ${c.detail ?? ""}`).join(" ");

  it("is listed, dated the day it was built, and newer releases sit above it", () => {
    expect(release).toBeDefined();
    expect(Number(APP_VERSION)).toBeGreaterThanOrEqual(Number(release.version));
    expect(release.date).toBe("2026-10-22");
  });

  it("names the six checks, and that none of them stops the close", () => {
    for (const words of [
      "left in Uncategorized",
      "recurring entries due by the period end",
      "depreciation posted to the period end",
      "past reconciliations still agree",
      "recorded twice in the period",
      "dated after today",
      "None of them stops the close",
    ]) {
      expect(said).toContain(words);
    }
  });
});
