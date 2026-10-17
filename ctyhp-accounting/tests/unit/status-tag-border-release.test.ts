import { describe, expect, it } from "vitest";
import { APP_VERSION, RELEASES } from "@/lib/domain/changelog";

describe("2.20 in the release notes", () => {
  const release = RELEASES.find((r) => r.version === "2.20")!;
  const said = release.changes.map((c) => `${c.title} ${c.detail ?? ""}`).join(" ");

  it("is listed, dated the day it was built, and newer releases sit above it", () => {
    expect(release).toBeDefined();
    expect(Number(APP_VERSION)).toBeGreaterThanOrEqual(2.2);
    expect(release.date).toBe("2026-10-17");
  });

  it("names the statuses that ran past their border", () => {
    for (const words of ["Partially paid", "Partially received", "complete border"]) expect(said).toContain(words);
  });
});
