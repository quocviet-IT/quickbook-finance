import { describe, expect, it } from "vitest";
import { APP_VERSION, RELEASES } from "@/lib/domain/changelog";

describe("the bank-as-category release in the release notes", () => {
  const release = RELEASES.find((r) => r.changes.some((c) => c.title === "No transaction posted back into its own bank"))!;
  const said = release.changes.map((c) => `${c.title} ${c.detail ?? ""}`).join(" ");

  it("is listed, dated the day it was built, and newer releases sit above it", () => {
    expect(release).toBeDefined();
    expect(Number(APP_VERSION)).toBeGreaterThanOrEqual(Number(release.version));
    expect(release.date).toBe("2026-10-22");
  });

  it("says the file is stopped, the import refuses it, and where to bring it in instead", () => {
    for (const words of ["stopped before the columns are agreed", "the import itself refuses it", "Banking → Import statement", "listed once"]) {
      expect(said).toContain(words);
    }
  });
});
