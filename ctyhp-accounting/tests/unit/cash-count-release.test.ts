import { describe, expect, it } from "vitest";
import { RELEASES } from "@/lib/domain/changelog";

describe("2.16 in the release notes", () => {
  const release = RELEASES.find((r) => r.version === "2.16")!;
  const said = release.changes.map((c) => `${c.title} ${c.detail ?? ""}`).join(" ");

  it("is dated the day it was built", () => {
    expect(release.version).toBe("2.16");
    expect(release.date).toBe("2026-10-17");
  });

  it("names the button, the account, the policy and where they are, in the screens' words", () => {
    for (const words of [
      "Count cash",
      "Record count",
      "7510 Cash Over and Short",
      "Cash count policy",
      "Chart of Accounts",
      "Balance Sheet",
      "never overwrites the balance",
      "a count that agrees posts nothing but is still dated",
      "90 days after the last count",
    ]) {
      expect(said, words).toContain(words);
    }
  });

  it("says the approval policy starts off", () => {
    expect(said).toContain("stays off until an administrator turns it on");
  });
});
