import { describe, expect, it } from "vitest";
import { APP_VERSION, RELEASES } from "@/lib/domain/changelog";

describe("the from-files fix in the release notes", () => {
  const release = RELEASES.find((r) =>
    r.changes.some((c) => c.title === "Reconcile from statement files no longer says Page not found"),
  )!;
  const said = release.changes.map((c) => `${c.title} ${c.detail ?? ""}`).join(" ");

  it("is listed, dated the day it was built, and newer releases sit above it", () => {
    expect(release).toBeDefined();
    expect(Number(APP_VERSION)).toBeGreaterThanOrEqual(Number(release.version));
    expect(release.date).toBe("2026-10-17");
  });

  it("says where a bare address now goes", () => {
    expect(said).toContain("/banking/reconcile/from-files");
    expect(said).toContain("Bank Reconciliation to choose the account");
  });
});
