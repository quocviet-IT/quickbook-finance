import { describe, expect, it } from "vitest";
import { APP_VERSION, RELEASES, compareVersions } from "@/lib/domain/changelog";

describe("the button placement release in the release notes", () => {
  const release = RELEASES.find((r) => r.changes.some((c) => c.title === "The main button in the same place"))!;
  const said = release.changes.map((c) => `${c.title} ${c.detail ?? ""}`).join(" ");

  it("is listed, dated the day it was built, and newer releases sit above it", () => {
    expect(release).toBeDefined();
    expect(compareVersions(APP_VERSION, release.version)).toBeGreaterThanOrEqual(0);
    expect(release.date).toBe("2026-10-19");
  });

  it("names where the main button now is, the one Save changes, and what the icon buttons say", () => {
    for (const words of ["right end of the bar above the table", "Save changes", "More actions", "a sun in the light theme"]) {
      expect(said).toContain(words);
    }
  });
});
