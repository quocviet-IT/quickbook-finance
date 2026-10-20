import { describe, expect, it } from "vitest";
import { APP_VERSION, RELEASES } from "@/lib/domain/changelog";

describe("the check titles release in the release notes", () => {
  const release = RELEASES.find((r) => r.changes.some((c) => c.title === "Checks titled by their result"))!;
  const said = release.changes.map((c) => `${c.title} ${c.detail ?? ""}`).join(" ");

  it("is listed, dated the day it was built, and newer releases sit above it", () => {
    expect(release).toBeDefined();
    expect(Number(APP_VERSION)).toBeGreaterThanOrEqual(Number(release.version));
    expect(release.date).toBe("2026-10-20");
  });

  it("quotes the contradictions a reader reported and what the checks say now", () => {
    for (const words of ["Nothing owed is late — Needs attention", "1 bill is overdue", "could not be checked", "Every line of stock is moving", "No bank feed is connected"]) {
      expect(said).toContain(words);
    }
  });
});
