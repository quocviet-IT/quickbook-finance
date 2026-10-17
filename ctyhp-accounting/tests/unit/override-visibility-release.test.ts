import { describe, expect, it } from "vitest";
import { RELEASES } from "@/lib/domain/changelog";
import { CHECK_LABEL } from "@/lib/domain/exceptions";

describe("2.11 in the release notes", () => {
  const release = RELEASES[0];
  const said = release.changes.map((c) => `${c.title} ${c.detail ?? ""}`).join(" ");

  it("is the newest release, dated the day it was built", () => {
    expect(release.version).toBe("2.11");
    expect(release.date).toBe("2026-10-16");
  });

  it("names the tag, the check and the places it shows, in the screens' words", () => {
    for (const words of [
      "Statement imports",
      "Imported out of balance",
      CHECK_LABEL.statementOverride,
      "twelfth check",
      "completing that reconciliation settles it",
      "how much it was out by, who imported it, when, and the reason they gave",
    ]) {
      expect(said, words).toContain(words);
    }
  });

  it("says a CSV's prior opening still needs its closing typed", () => {
    expect(said).toContain("prints no running balance");
    expect(said).toContain("Its closing is still typed");
  });

  it("lists one added, one changed and one fixed", () => {
    expect(release.changes.map((c) => c.kind)).toEqual(["added", "changed", "fixed"]);
  });
});
