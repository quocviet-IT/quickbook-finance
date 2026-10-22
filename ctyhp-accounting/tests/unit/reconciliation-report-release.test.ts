import { describe, expect, it } from "vitest";
import { APP_VERSION, RELEASES } from "@/lib/domain/changelog";

describe("the reconciliation report release in the release notes", () => {
  const release = RELEASES.find((r) => r.changes.some((c) => c.title === "The reconciliation report bridges the statement to the books"))!;
  const said = release.changes.map((c) => `${c.title} ${c.detail ?? ""}`).join(" ");

  it("is listed, dated the day it was built, and newer releases sit above it", () => {
    expect(release).toBeDefined();
    expect(Number(APP_VERSION)).toBeGreaterThanOrEqual(Number(release.version));
    expect(release.date).toBe("2026-10-22");
  });

  it("says what the report proves, the two buttons, and the list's new marks", () => {
    for (const words of [
      "the balance in the books on the statement date",
      "whether the reconciliation still proves out",
      "cleared on a later one now stays on the older statement's report",
      "Tick everything shown",
      "Clear the ticks",
      "Report link beside Open",
      "Adjusted",
    ]) {
      expect(said).toContain(words);
    }
  });
});
