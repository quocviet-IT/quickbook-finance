import { describe, expect, it } from "vitest";
import { APP_VERSION, RELEASES } from "@/lib/domain/changelog";

describe("the Change Log release in the release notes", () => {
  const release = RELEASES.find((r) => r.changes.some((c) => c.title === "Change Log details in plain sentences"))!;
  const said = release.changes.map((c) => `${c.title} ${c.detail ?? ""}`).join(" ");

  it("is listed, dated the day it was built, and newer releases sit above it", () => {
    expect(release).toBeDefined();
    expect(Number(APP_VERSION)).toBeGreaterThanOrEqual(Number(release.version));
    expect(release.date).toBe("2026-10-17");
  });

  it("names the sentences and the switch in the screen's words", () => {
    for (const words of ["Status changed from Draft to Void", "$4,265.00", "Show system activity", "hidden by default"]) {
      expect(said).toContain(words);
    }
  });
});
