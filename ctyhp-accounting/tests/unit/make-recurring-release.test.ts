import { describe, expect, it } from "vitest";
import { APP_VERSION, RELEASES } from "@/lib/domain/changelog";

describe("the make it recurring release in the release notes", () => {
  const release = RELEASES.find((r) => r.changes.some((c) => c.title === "Make it recurring"))!;
  const said = release.changes.map((c) => `${c.title} ${c.detail ?? ""}`).join(" ");

  it("is listed, dated the day it was built, and newer releases sit above it", () => {
    expect(release).toBeDefined();
    expect(Number(APP_VERSION)).toBeGreaterThanOrEqual(Number(release.version));
    expect(release.date).toBe("2026-10-22");
  });

  it("says where it is, what it sets up, and what it refuses", () => {
    for (const words of [
      "Invoices, Bills, Expenses and Journal Entries",
      "on the next such day after today",
      "never a date already past",
      "not set up twice",
      "currency other than US dollars is refused",
      "Void expense last",
    ]) {
      expect(said).toContain(words);
    }
  });
});
