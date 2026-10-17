import { describe, expect, it } from "vitest";
import { APP_VERSION, RELEASES } from "@/lib/domain/changelog";
import { GUIDE_FLOWS } from "@/lib/domain/system-guide";

describe("2.19 in the release notes", () => {
  const release = RELEASES.find((r) => r.version === "2.19")!;
  const said = release.changes.map((c) => `${c.title} ${c.detail ?? ""}`).join(" ");

  it("is listed, dated the day it was built, and newer releases sit above it", () => {
    expect(release).toBeDefined();
    expect(RELEASES.indexOf(release)).toBeGreaterThanOrEqual(0);
    expect(Number(APP_VERSION)).toBeGreaterThanOrEqual(2.19);
    expect(release.date).toBe("2026-10-17");
  });

  it("names the three things the review asked for, in the screens' words", () => {
    for (const words of ["Partially paid", "Not enrolled", "Stock count", "Status, not State", "New journal entry"]) {
      expect(said).toContain(words);
    }
  });
});

describe("the guide names the buttons on screen", () => {
  const controls = GUIDE_FLOWS.flatMap((flow) => flow.steps.map((step) => step.control));

  it("says Receive payment, Refund, Add user and New rate", () => {
    for (const control of ["Receive payment", "Refund", "Add user", "New rate"]) expect(controls).toContain(control);
  });

  it("no longer names buttons that do not exist", () => {
    for (const control of ["New payment", "New refund", "New user", "New tax code"]) expect(controls).not.toContain(control);
  });
});
