import { describe, expect, it } from "vitest";
import { RELEASES } from "@/lib/domain/changelog";
import { CHECK_LABEL } from "@/lib/domain/exceptions";

describe("2.12 in the release notes", () => {
  // Looked up by number: later releases sit above it.
  const release = RELEASES.find((r) => r.version === "2.12")!;
  const said = release.changes.map((c) => `${c.title} ${c.detail ?? ""}`).join(" ");

  it("is in the release notes, dated the day it was built", () => {
    expect(release).toBeDefined();
    expect(release.date).toBe("2026-10-17");
  });

  it("names both checks in the screen's words", () => {
    expect(said).toContain(CHECK_LABEL.noLongerAgree);
    expect(said).toContain(CHECK_LABEL.transferOneSide);
    expect(said).toContain("thirteenth check");
  });

  it("says what is now caught, and that nothing is blocked", () => {
    for (const words of [
      "reversed after it was ticked",
      "posted after sign-off but dated inside the signed-off period",
      "no longer equals its beginning plus its ticked lines",
      "Nothing is blocked",
      "not yet checkable",
      "nothing offers to reverse it",
    ]) {
      expect(said, words).toContain(words);
    }
  });

  it("lists one changed and one added", () => {
    expect(release.changes.map((c) => c.kind)).toEqual(["changed", "added"]);
  });
});
