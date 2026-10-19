import { describe, expect, it } from "vitest";
import { APP_VERSION, RELEASES } from "@/lib/domain/changelog";

describe("the text fit release in the release notes", () => {
  const release = RELEASES.find((r) => r.changes.some((c) => c.title === "Words no longer break in half"))!;
  const said = release.changes.map((c) => `${c.title} ${c.detail ?? ""}`).join(" ");

  it("is listed, dated the day it was built, and newer releases sit above it", () => {
    expect(release).toBeDefined();
    expect(Number(APP_VERSION)).toBeGreaterThanOrEqual(Number(release.version));
    expect(release.date).toBe("2026-10-19");
  });

  it("names the examples a reader reported and what each heading is called now", () => {
    for (const words of ["Requested read Requeste", "Approvals read Apprc", "Dismissed read Dismissec", "Expense Number and Payment Number are Number", "one hover away"]) {
      expect(said).toContain(words);
    }
  });
});
