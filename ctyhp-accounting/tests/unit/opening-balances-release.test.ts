import { describe, expect, it } from "vitest";
import { APP_VERSION, RELEASES } from "@/lib/domain/changelog";

describe("the opening balances release in the release notes", () => {
  const release = RELEASES.find((r) => r.changes.some((c) => c.title === "An empty form is not Balanced"))!;
  const said = release.changes.map((c) => `${c.title} ${c.detail ?? ""}`).join(" ");

  it("is listed, dated the day it was built, and newer releases sit above it", () => {
    expect(release).toBeDefined();
    expect(Number(APP_VERSION)).toBeGreaterThanOrEqual(Number(release.version));
    expect(release.date).toBe("2026-10-20");
  });

  it("says what the empty form said, what Post waits for, and that nothing typed is dropped", () => {
    for (const words of ["nothing has been entered yet", "an as-of date, at least one balance, and an account for every balance", "no longer dropped"]) {
      expect(said).toContain(words);
    }
  });
});
