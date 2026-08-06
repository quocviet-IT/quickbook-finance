import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const dir = join(process.cwd(), "app", "(app)", "settings", "feedback");
const page = readFileSync(join(dir, "page.tsx"), "utf8");
const mine = readFileSync(join(dir, "MyReportsClient.tsx"), "utf8");

describe("the feedback screen serves two audiences", () => {
  it("asks whether this person may read the queue", () => {
    expect(page).toContain('"feedback.read"');
  });

  it("does not call the queue RPC for someone who cannot read it", () => {
    // acc_feedback_queue filters on the permission alone and returns zero rows
    // to a non-administrator, so calling it for them would show an empty screen
    // where their own reports belong.
    expect(page).toMatch(/if\s*\(!canRead\)/);
    expect(page.indexOf("listFeedbackImprovements(sb)")).toBeGreaterThan(
      page.indexOf("if (!canRead)"),
    );
  });

  it("renders the reporter's own view without triage controls", () => {
    expect(mine).not.toContain("setFeedbackStatusAction");
    expect(mine).not.toContain("nextStatuses");
  });

  it("keeps both screens under the file-size ceiling", () => {
    for (const [name, source] of [
      ["MyReportsClient.tsx", mine],
      ["FeedbackTriageClient.tsx", readFileSync(join(dir, "FeedbackTriageClient.tsx"), "utf8")],
    ] as const) {
      expect(source.split("\n").length, name).toBeLessThan(400);
    }
  });
});
