import { describe, expect, it } from "vitest";
import { RELEASES } from "@/lib/domain/changelog";

describe("2.07 in the release notes", () => {
  // Looked up by number: later releases sit above it.
  const release = RELEASES.find((r) => r.version === "2.07")!;
  const said = release.changes.map((c) => `${c.title} ${c.detail ?? ""}`).join(" ");

  it("is in the release notes, dated the day it was built", () => {
    expect(release).toBeDefined();
    expect(release.date).toBe("2026-10-15");
  });

  it("says both fixes, and that the screen does not change for the second", () => {
    expect(said).toContain("closes at its last balance plus the lines after it, as a PDF already did");
    expect(said).toContain("a run of months stopped at that month");
    expect(said).toContain("can no longer be called directly");
    expect(said).toContain("nothing on the screen changes");
    expect(release.changes.every((c) => c.kind === "fixed")).toBe(true);
  });
});
