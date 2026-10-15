import { describe, expect, it } from "vitest";
import { RELEASES } from "@/lib/domain/changelog";
import { CHECK_LABEL } from "@/lib/domain/exceptions";
import { GUIDE_FLOWS } from "@/lib/domain/system-guide";

describe("2.05 in the release notes and the Guide", () => {
  // Looked up by number: later releases sit above it.
  const release = RELEASES.find((r) => r.version === "2.05")!;
  const said = release.changes.map((c) => `${c.title} ${c.detail ?? ""}`).join(" ");

  it("is in the release notes, dated the day it was built", () => {
    expect(release).toBeDefined();
    expect(release.date).toBe("2026-10-15");
  });

  it("says what the person sees, in the screen's words", () => {
    for (const words of [
      "Bank accounts",
      "Agreed to Sep 30, 2026 at $12,000.00 · nothing since",
      "Never reconciled · 40 entries, $3,100.00 not on a statement",
      "Reconciled to Sep 30, 2026; nothing new since.",
      "has never been reconciled. 40 entries, $3,100.00, are waiting on a statement. Start with the oldest statement you have.",
      "No longer agrees: 2 entries ticked on the Aug 31, 2026 reconciliation were voided ($150.00)",
      CHECK_LABEL.noLongerAgree,
      CHECK_LABEL.unreconciled,
      "First – last",
      "below zero at",
    ]) {
      expect(said, words).toContain(words);
    }
  });

  it("says the dashboard figure changes, and why", () => {
    const fixed = release.changes.find((c) => c.kind === "fixed" && c.route === "/dashboard");
    expect(fixed?.detail).toContain("lower than before");
    expect(fixed?.detail).toContain("Cash on Hand");
  });

  it("gives the Guide each account's standing", () => {
    const steps = GUIDE_FLOWS.flatMap((flow) => flow.steps);
    const step = steps.find((s) => s.control === "Bank accounts");
    expect(step?.route).toBe("/banking/reconcile");
    expect(step?.note).toContain("Reconciliations that no longer agree");
    expect(step?.note).toContain("start with the oldest statement you have");
  });
});
