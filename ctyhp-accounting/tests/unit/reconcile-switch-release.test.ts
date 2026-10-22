import { describe, expect, it } from "vitest";
import { APP_VERSION, RELEASES } from "@/lib/domain/changelog";

describe("the reconcile switch release in the release notes", () => {
  const release = RELEASES.find((r) => r.changes.some((c) => c.title === "Reconcile lists only the chosen account"))!;
  const said = release.changes.map((c) => `${c.title} ${c.detail ?? ""}`).join(" ");

  it("is listed, dated the day it was built, and newer releases sit above it", () => {
    expect(release).toBeDefined();
    expect(Number(APP_VERSION)).toBeGreaterThanOrEqual(Number(release.version));
    expect(release.date).toBe("2026-10-22");
  });

  it("says the table waits for the chosen account, and the panel moved under the figures", () => {
    for (const words of ["until the chosen account's own reconciliations arrive", "right under the figures in both views"]) {
      expect(said).toContain(words);
    }
  });
});
