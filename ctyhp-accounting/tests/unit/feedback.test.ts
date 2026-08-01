import { describe, expect, it } from "vitest";
import {
  canTransition,
  describeFeedbackStatusChange,
  FEEDBACK_FREQUENCIES,
  FEEDBACK_IMPACTS,
  FEEDBACK_KINDS,
  FEEDBACK_STATUSES,
  feedbackExportFileName,
  feedbackFrequencyLabel,
  feedbackImpactLabel,
  feedbackKindLabel,
  newFeedbackReport,
  nextStatuses,
  queueCounts,
  sortNewestFirst,
  summarizePageContext,
  type FeedbackReport,
} from "@/lib/domain/feedback";

const page = {
  url: "https://one-book.example.com/invoices?report=open",
  route: "/invoices",
  title: "Invoices",
  viewport: { width: 1512, height: 982 },
};

function report(overrides: Partial<FeedbackReport> = {}): FeedbackReport {
  return {
    ...newFeedbackReport({
      kind: "broken",
      description: "Issue button did nothing",
      page,
      reporter: { email: "intern1@ctyhp.vn", role: "accountant" },
      screenshot: null,
      createdAt: "2026-07-30T02:00:00.000Z",
      id: "fb_1",
    }),
    ...overrides,
  };
}

describe("feedback kinds", () => {
  it("offers exactly the two kinds the report dialog shows", () => {
    expect(FEEDBACK_KINDS).toEqual(["broken", "suggestion"]);
  });

  it("labels each kind the way the dialog reads", () => {
    expect(feedbackKindLabel("broken")).toBe("Something is broken");
    expect(feedbackKindLabel("suggestion")).toBe("Suggestion for improvement");
  });
});

describe("newFeedbackReport", () => {
  it("starts every report in the New queue", () => {
    expect(report().status).toBe("new");
  });

  it("trims the description and keeps a whitespace-only one as null", () => {
    // Built through newFeedbackReport, not the helper's override spread — the
    // trimming is what's under test.
    const build = (description: string | null) =>
      newFeedbackReport({
        kind: "suggestion",
        description,
        page,
        reporter: null,
        screenshot: null,
        createdAt: "2026-07-30T02:00:00.000Z",
        id: "fb_2",
      }).description;

    expect(build("   ")).toBeNull();
    expect(build(null)).toBeNull();
    expect(build("  needs a filter  ")).toBe("needs a filter");
  });

  it("keeps the page context so IT can reproduce without asking", () => {
    expect(report().page).toEqual(page);
  });

  it("records whether a screenshot was attached", () => {
    expect(report().screenshot).toBeNull();
    expect(report({ screenshot: "data:image/png;base64,AAA" }).screenshot).toBe(
      "data:image/png;base64,AAA",
    );
  });
});

describe("status transitions", () => {
  it("lists the four queues in triage order", () => {
    expect(FEEDBACK_STATUSES).toEqual(["new", "reviewing", "resolved", "declined"]);
  });

  it("moves a new report into review, resolution, or decline", () => {
    expect(nextStatuses("new")).toEqual(["reviewing", "resolved", "declined"]);
  });

  it("lets a resolved or declined report be reopened for review", () => {
    expect(nextStatuses("resolved")).toEqual(["reviewing"]);
    expect(nextStatuses("declined")).toEqual(["reviewing"]);
  });

  it("never sends a report back to New — the queue is arrival order, not a state to re-enter", () => {
    for (const from of FEEDBACK_STATUSES) {
      if (from === "new") continue;
      expect(canTransition(from, "new")).toBe(false);
    }
  });

  it("rejects a transition to the status it already has", () => {
    expect(canTransition("reviewing", "reviewing")).toBe(false);
  });

  it("describes a change in words a reviewer can read in the audit trail", () => {
    expect(describeFeedbackStatusChange("new", "reviewing")).toBe(
      "Start reviewing this report",
    );
    expect(describeFeedbackStatusChange("reviewing", "declined")).toBe(
      "Decline this report — it will not be actioned",
    );
    expect(describeFeedbackStatusChange("resolved", "reviewing")).toBe(
      "Reopen this report for review",
    );
  });
});

describe("queueCounts", () => {
  it("counts every queue, including the empty ones", () => {
    const counts = queueCounts([
      report({ id: "a", status: "new" }),
      report({ id: "b", status: "new" }),
      report({ id: "c", status: "resolved" }),
    ]);
    expect(counts).toEqual({ new: 2, reviewing: 0, resolved: 1, declined: 0 });
  });
});

describe("sortNewestFirst", () => {
  it("puts the most recent report at the top of the queue", () => {
    const older = report({ id: "old", createdAt: "2026-07-29T00:00:00.000Z" });
    const newer = report({ id: "new", createdAt: "2026-07-30T00:00:00.000Z" });
    expect(sortNewestFirst([older, newer]).map((r) => r.id)).toEqual(["new", "old"]);
  });

  it("does not mutate the array it was given", () => {
    const input = [
      report({ id: "old", createdAt: "2026-07-29T00:00:00.000Z" }),
      report({ id: "new", createdAt: "2026-07-30T00:00:00.000Z" }),
    ];
    sortNewestFirst(input);
    expect(input.map((r) => r.id)).toEqual(["old", "new"]);
  });
});

describe("summarizePageContext", () => {
  it("reads as one line a developer can scan", () => {
    expect(summarizePageContext(page)).toBe("/invoices · Invoices · 1512×982");
  });
});

describe("feedbackExportFileName", () => {
  it("names the archive after the kind and date", () => {
    expect(feedbackExportFileName(report())).toBe("feedback-broken-2026-07-30-fb_1.zip");
  });
});

describe("the improvement vocabulary", () => {
  it("matches the values the database will accept (migration 0086)", () => {
    // A value the check constraint rejects would only fail on send, after the
    // reporter has typed everything out.
    expect(FEEDBACK_IMPACTS).toEqual(["blocking", "slows_work", "nice_to_have"]);
    expect(FEEDBACK_FREQUENCIES).toEqual(["every_time", "often", "sometimes", "rarely"]);
  });

  it("reads worst first, which is the order the buttons appear in", () => {
    expect(FEEDBACK_IMPACTS[0]).toBe("blocking");
    expect(FEEDBACK_FREQUENCIES[0]).toBe("every_time");
  });

  it("describes the cost as a working day, not as a backlog label", () => {
    // "Blocking" invites everybody to pick it; a sentence about their own work
    // does not.
    expect(feedbackImpactLabel("blocking")).toBe("I cannot finish the work");
    expect(feedbackImpactLabel("nice_to_have")).toBe("It works — this would just be better");
  });

  it("labels every value, so no option can render blank", () => {
    for (const impact of FEEDBACK_IMPACTS) expect(feedbackImpactLabel(impact)).toBeTruthy();
    for (const frequency of FEEDBACK_FREQUENCIES) {
      expect(feedbackFrequencyLabel(frequency)).toBeTruthy();
    }
  });
});
