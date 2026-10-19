import { describe, expect, it } from "vitest";
import { APP_VERSION, RELEASES } from "@/lib/domain/changelog";

describe("the reconcile-with-no-account fix in the release notes", () => {
  const release = RELEASES.find((r) =>
    r.changes.some((c) => c.title === "Bank Reconciliation with no bank account says so"),
  )!;
  const said = release.changes.map((c) => `${c.title} ${c.detail ?? ""}`).join(" ");

  it("is listed, dated the day it was built, and newer releases sit above it", () => {
    expect(release).toBeDefined();
    expect(Number(APP_VERSION)).toBeGreaterThanOrEqual(Number(release.version));
    expect(release.date).toBe("2026-10-19");
  });

  it("says what the screen did and where it sends you now", () => {
    expect(said).toContain("kept loading");
    expect(said).toContain("Add bank account");
  });
});
