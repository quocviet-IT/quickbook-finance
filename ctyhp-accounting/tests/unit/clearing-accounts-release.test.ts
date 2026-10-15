import { describe, expect, it } from "vitest";
import { RELEASES } from "@/lib/domain/changelog";
import { CLEARING_FIFO_NOTE, CLEARING_TYPE_MESSAGE, LEFT_STANDING } from "@/lib/domain/clearing-accounts";
import { CHECK_LABEL } from "@/lib/domain/exceptions";
import { GUIDE_FLOWS } from "@/lib/domain/system-guide";

describe("2.06 in the release notes and the Guide", () => {
  const release = RELEASES[0];
  const said = release.changes.map((c) => `${c.title} ${c.detail ?? ""}`).join(" ");

  it("is the newest release, dated the day it was built", () => {
    expect(release.version).toBe("2.06");
    expect(release.date).toBe("2026-10-15");
  });

  it("says what the person sees, in the screen's words", () => {
    for (const words of [
      CHECK_LABEL.clearing,
      "Money received but not yet banked",
      "$1,750.00 across 14 receipts, oldest Nov 19, 2025",
      "No movement for 245 days, since Nov 28, 2025",
      LEFT_STANDING,
      CLEARING_FIFO_NOTE,
      "Clearing account",
      CLEARING_TYPE_MESSAGE,
    ]) {
      expect(said, words).toContain(words);
    }
  });

  it("says the check's figures change, and why", () => {
    const changed = release.changes.find((c) => c.route === "/reports/exceptions");
    expect(changed?.detail).toContain("different from before");
  });

  it("gives the Guide the clearing check", () => {
    const step = GUIDE_FLOWS.flatMap((flow) => flow.steps).find((s) => s.control === CHECK_LABEL.clearing);
    expect(step?.route).toBe("/reports/exceptions");
    expect(step?.note).toContain("Clearing account");
    expect(step?.note).toContain(LEFT_STANDING);
  });
});
