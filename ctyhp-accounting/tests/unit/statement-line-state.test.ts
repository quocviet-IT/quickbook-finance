import { describe, expect, it } from "vitest";
import {
  STATEMENT_LINE_STATES,
  statementLineState,
  summariseStatementLines,
} from "@/lib/domain/bankrec";

describe("statementLineState", () => {
  it("calls an approved link matched", () => {
    expect(statementLineState("matched", false)).toBe("matched");
  });

  it("still calls it matched when a stale suggestion is also present", () => {
    // The approved link is the answer; a leftover guess does not downgrade it.
    expect(statementLineState("matched", true)).toBe("matched");
  });

  it("separates a waiting suggestion from nothing at all", () => {
    // This is the distinction the screen was missing. A suggestion is a guess
    // nobody has accepted, and in a reconciliation that must not look settled.
    expect(statementLineState("unmatched", true)).toBe("requires_review");
    expect(statementLineState("unmatched", false)).toBe("unmatched");
  });

  it("keeps an excluded line out of both", () => {
    expect(statementLineState("ignored", false)).toBe("excluded");
    expect(statementLineState("ignored", true)).toBe("excluded");
  });

  it("treats an unknown status as needing a human", () => {
    // Failing towards "look at this" is the safe direction in a reconciliation.
    expect(statementLineState("something_new", false)).toBe("unmatched");
  });

  it("gives every state a label and a colour", () => {
    for (const state of ["matched", "requires_review", "unmatched", "excluded"] as const) {
      expect(STATEMENT_LINE_STATES[state].label).toBeTruthy();
      expect(STATEMENT_LINE_STATES[state].color).toBeTruthy();
    }
  });
});

describe("summariseStatementLines", () => {
  it("counts each state and what is still open", () => {
    const summary = summariseStatementLines([
      { status: "matched", hasSuggestion: false },
      { status: "matched", hasSuggestion: false },
      { status: "unmatched", hasSuggestion: true },
      { status: "unmatched", hasSuggestion: false },
      { status: "ignored", hasSuggestion: false },
    ]);
    expect(summary.matched).toBe(2);
    expect(summary.requiresReview).toBe(1);
    expect(summary.unmatched).toBe(1);
    expect(summary.excluded).toBe(1);
    expect(summary.total).toBe(5);
  });

  it("counts exceptions as everything not settled or deliberately excluded", () => {
    // What the accountant has to clear before completing.
    const summary = summariseStatementLines([
      { status: "matched", hasSuggestion: false },
      { status: "unmatched", hasSuggestion: true },
      { status: "unmatched", hasSuggestion: false },
      { status: "ignored", hasSuggestion: false },
    ]);
    expect(summary.outstanding).toBe(2);
  });

  it("is all zeros for an empty statement", () => {
    expect(summariseStatementLines([])).toEqual({
      total: 0,
      matched: 0,
      requiresReview: 0,
      unmatched: 0,
      excluded: 0,
      outstanding: 0,
    });
  });
});
