import { describe, expect, it } from "vitest";
import { APP_VERSION, RELEASES } from "@/lib/domain/changelog";

describe("the CSV layouts release in the release notes", () => {
  const release = RELEASES.find((r) => r.changes.some((c) => c.title === "Statement CSVs in more layouts"))!;
  const said = release.changes.map((c) => `${c.title} ${c.detail ?? ""}`).join(" ");

  it("is listed, dated the day it was built, and newer releases sit above it", () => {
    expect(release).toBeDefined();
    expect(Number(APP_VERSION)).toBeGreaterThanOrEqual(Number(release.version));
    expect(release.date).toBe("2026-10-22");
  });

  it("says what is set aside, what is read by its shape, and what stays as before", () => {
    for (const words of [
      "above the headings is set aside",
      "read by what each column holds",
      "never taken for the money that moved",
      "semicolons or tabs",
      "31 Jul 2026",
      "read exactly as before",
    ]) {
      expect(said).toContain(words);
    }
  });
});
