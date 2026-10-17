import { describe, expect, it } from "vitest";
import { APP_VERSION, RELEASES } from "@/lib/domain/changelog";

describe("2.24 in the release notes", () => {
  const release = RELEASES.find((r) => r.version === "2.24")!;
  const said = release.changes.map((c) => `${c.title} ${c.detail ?? ""}`).join(" ");

  it("is listed, dated the day it was built, and newer releases sit above it", () => {
    expect(release).toBeDefined();
    expect(RELEASES.indexOf(release)).toBeGreaterThanOrEqual(0);
    expect(Number(APP_VERSION)).toBeGreaterThanOrEqual(2.24);
    expect(release.date).toBe("2026-10-19");
  });

  it("names the four overviews and the time printed once", () => {
    for (const words of ["Sales, Purchases, Banking and Inventory", "under each overview’s subtitle", "printed once"]) {
      expect(said).toContain(words);
    }
  });
});
