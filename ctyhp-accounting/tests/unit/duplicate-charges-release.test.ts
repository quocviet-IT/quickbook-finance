import { describe, expect, it } from "vitest";
import { RELEASES } from "@/lib/domain/changelog";
import { GUIDE_FLOWS } from "@/lib/domain/system-guide";
import { duplicatePayeeKey } from "@/lib/domain/duplicate-charges";

describe("2.08 in the release notes and the Guide", () => {
  // Looked up by number: later releases sit above it.
  const release = RELEASES.find((r) => r.version === "2.08")!;
  const said = release.changes.map((c) => `${c.title} ${c.detail ?? ""}`).join(" ");

  it("is in the release notes, dated the day it was built", () => {
    expect(release).toBeDefined();
    expect(release.date).toBe("2026-10-16");
  });

  it("says what the person sees, and that nothing is removed for them", () => {
    for (const words of ["Possible duplicates", "Charged twice in 15 days: POS DEBIT SHOPMART #1234", "Review opens the entry", "Dismiss asks for a reason", "completed reconciliation", "12 months"]) {
      expect(said, words).toContain(words);
    }
  });

  it("quotes two texts that really are one payee", () => {
    expect(said).toContain("“SHOPMART.COM 8004” and “POS DEBIT SHOPMART #1234” are one payee");
    expect(duplicatePayeeKey("SHOPMART.COM 8004")).toBe(duplicatePayeeKey("POS DEBIT SHOPMART #1234"));
  });

  it("gives the Guide the queue's filter", () => {
    const step = GUIDE_FLOWS.flatMap((flow) => flow.steps).find((s) => s.control === "Possible duplicates");
    expect(step?.route).toBe("/banking/overview");
    expect(step?.note).toContain("nothing is removed for you");
  });
});
