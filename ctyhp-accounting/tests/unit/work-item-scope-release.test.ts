import { describe, expect, it } from "vitest";
import { RELEASES } from "@/lib/domain/changelog";

describe("2.09 in the release notes", () => {
  const release = RELEASES[0];
  const said = release.changes.map((c) => `${c.title} ${c.detail ?? ""}`).join(" ");

  it("is the newest release, dated the day it was built", () => {
    expect(release.version).toBe("2.09");
    expect(release.date).toBe("2026-10-16");
  });

  it("names the five pages, what was lost and what keeps it now", () => {
    for (const words of [
      "Accounting, Sales, Purchases, Inventory and Banking overview pages",
      "came back once Sales had been opened",
      "owner, due date or in progress tag",
      "Each page now clears only its own items",
      "until you put the item back",
    ]) {
      expect(said, words).toContain(words);
    }
  });

  it("says the computed time follows the company's zone, as the As of date does", () => {
    expect(said).toContain("“Computed at” is in the company’s time zone");
    expect(said).toContain("as the “As of” date is");
  });

  it("lists both as fixes", () => {
    expect(release.changes.map((c) => c.kind)).toEqual(["fixed", "fixed"]);
  });
});
