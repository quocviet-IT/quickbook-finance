import { describe, expect, it } from "vitest";
import { RELEASES } from "@/lib/domain/changelog";
import { transitionProblem } from "@/lib/domain/work-surface/lifecycle";

describe("2.10 in the release notes", () => {
  const release = RELEASES[0];
  const said = release.changes.map((c) => `${c.title} ${c.detail ?? ""}`).join(" ");

  it("is the newest release, dated the day it was built", () => {
    expect(release.version).toBe("2.10");
    expect(release.date).toBe("2026-10-16");
  });

  it("quotes the refusal the person saw, word for word", () => {
    // The screen's own sentence, plus the full stop the release note ends its quote with.
    const refusal = transitionProblem("resolved", "acknowledged", { blocking: false }, null);
    expect(refusal).not.toBeNull();
    expect(said).toContain(`“${refusal}`.replace(/\.$/, ""));
  });

  it("names the actions that work again, in the menu's words", () => {
    for (const words of ["Acknowledge", "Start work", "Assign to…", "Set a due date…", "Dismiss…", "no owner or due date from before"]) {
      expect(said, words).toContain(words);
    }
  });
});
