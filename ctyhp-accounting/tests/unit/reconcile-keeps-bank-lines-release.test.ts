import { describe, expect, it } from "vitest";
import { APP_VERSION, RELEASES } from "@/lib/domain/changelog";

describe("the reconcile-without-reimporting release in the release notes", () => {
  const release = RELEASES.find((r) =>
    r.changes.some((c) => c.title === "A statement reconciled after its lines came in another way is not imported again"),
  )!;
  const said = release.changes.map((c) => `${c.title} ${c.detail ?? ""}`).join(" ");

  it("is listed, dated the day it was built, and newer releases sit above it", () => {
    expect(release).toBeDefined();
    expect(Number(APP_VERSION)).toBeGreaterThanOrEqual(Number(release.version));
    expect(release.date).toBe("2026-10-23");
  });

  it("says what was wrong, what is left as it was, and that nothing is posted", () => {
    for (const words of [
      "imported the PDF statement's lines a second time",
      "left exactly as it is",
      "only lines Bank Transactions does not hold go in",
      "nothing is posted",
      "how many lines were already there",
      "not coded twice",
    ]) {
      expect(said).toContain(words);
    }
  });
});
