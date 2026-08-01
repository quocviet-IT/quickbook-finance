import { describe, expect, it } from "vitest";
import { GUIDE_FLOWS } from "@/lib/domain/system-guide";
import {
  describeContextForAssistant,
  normaliseRoute,
  screenContextFor,
  searchGuide,
  splitAnswerRoutes,
  suggestedQuestions,
} from "@/lib/domain/screen-context";

describe("normaliseRoute", () => {
  it("keeps a plain route as it is", () => {
    expect(normaliseRoute("/invoices")).toBe("/invoices");
    expect(normaliseRoute("/reports/ar-aging")).toBe("/reports/ar-aging");
  });

  it("drops the query string and the fragment", () => {
    expect(normaliseRoute("/bills?vendor=acme#top")).toBe("/bills");
  });

  it("drops a trailing slash", () => {
    expect(normaliseRoute("/invoices/")).toBe("/invoices");
    expect(normaliseRoute("/")).toBe("/");
  });

  it("treats a record page as its list screen — the guide describes the screen", () => {
    expect(normaliseRoute("/banking/reconcile/2f1c9d84-1a2b-4c3d-9e8f-0a1b2c3d4e5f")).toBe(
      "/banking/reconcile",
    );
  });
});

describe("screenContextFor", () => {
  it("finds the workflow that starts on this screen", () => {
    const context = screenContextFor("/invoices");
    expect(context.flowsStartingHere.length).toBeGreaterThan(0);
    expect(context.summary).toContain("/invoices");
  });

  it("finds a screen that a workflow only passes through", () => {
    // The AR ageing report is a step in the sales flow, not where it starts.
    const context = screenContextFor("/reports/ar-aging");
    expect(context.flowsStartingHere).toEqual([]);
    expect(context.flowsPassingThrough.length).toBeGreaterThan(0);
    expect(context.summary).toContain("part-way through");
  });

  it("carries only the steps that happen here, not the whole flow", () => {
    const context = screenContextFor("/reports/ar-aging");
    for (const entry of context.flowsPassingThrough) {
      for (const step of entry.steps) {
        expect(step.route).toBe("/reports/ar-aging");
      }
    }
  });

  it("says nothing rather than inventing a description for an unknown screen", () => {
    const context = screenContextFor("/nowhere-in-particular");
    expect(context.flowsStartingHere).toEqual([]);
    expect(context.flowsPassingThrough).toEqual([]);
    expect(context.summary).toBeNull();
  });

  it("describes every screen a workflow starts on", () => {
    for (const flow of GUIDE_FLOWS) {
      const context = screenContextFor(flow.route);
      expect(context.summary, `${flow.route} has no summary`).not.toBeNull();
    }
  });
});

describe("searchGuide", () => {
  it("finds a workflow by its title", () => {
    const matches = searchGuide("invoice");
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].score).toBeGreaterThan(0);
  });

  it("finds a workflow by the button someone can see", () => {
    // People search for the control in front of them, not the workflow name.
    const matches = searchGuide("void");
    expect(matches.length).toBeGreaterThan(0);
    const found = matches.flatMap((m) => m.steps).some((s) => /void/i.test(s.control));
    expect(found).toBe(true);
  });

  it("ranks a title match above a passing mention", () => {
    const matches = searchGuide("reconcile");
    expect(matches.length).toBeGreaterThan(1);
    expect(matches[0].score).toBeGreaterThanOrEqual(matches[1].score);
  });

  it("ignores noise words and punctuation", () => {
    expect(searchGuide("a, an")).toEqual([]);
    expect(searchGuide("")).toEqual([]);
  });

  it("returns nothing for something the guide does not cover", () => {
    expect(searchGuide("photosynthesis")).toEqual([]);
  });
});

describe("describeContextForAssistant", () => {
  const base = {
    route: "/invoices",
    companyName: "Aurora Fine Jewelry LLC",
    isSampleCompany: false,
    role: "accountant",
  };

  it("tells the assistant what screen the question came from", () => {
    const briefing = describeContextForAssistant(base);
    expect(briefing).toContain("Screen: /invoices");
    expect(briefing).toContain("Aurora Fine Jewelry LLC");
    expect(briefing).toContain("accountant");
  });

  it("names the controls on that screen, so the answer can point at one", () => {
    const briefing = describeContextForAssistant(base);
    expect(briefing).toContain('control "');
  });

  it("says plainly when the books are a sample", () => {
    const briefing = describeContextForAssistant({
      ...base,
      companyName: "North Star Bridal LLC",
      isSampleCompany: true,
    });
    expect(briefing).toContain("sample company, not real books");
  });

  it("still produces a briefing for a screen the guide does not cover", () => {
    const briefing = describeContextForAssistant({ ...base, route: "/nowhere" });
    expect(briefing).toContain("Screen: /nowhere");
    expect(briefing).not.toContain("undefined");
  });

  it("stays short enough to sit in front of every question", () => {
    for (const flow of GUIDE_FLOWS) {
      const briefing = describeContextForAssistant({ ...base, route: flow.route });
      expect(briefing.length, `${flow.route} briefing is too long`).toBeLessThan(4000);
    }
  });
});

describe("splitAnswerRoutes", () => {
  it("turns a bracketed route into something clickable", () => {
    const segments = splitAnswerRoutes("Open [/invoices] and press New invoice.");
    expect(segments).toEqual([
      { kind: "text", text: "Open " },
      { kind: "route", route: "/invoices" },
      { kind: "text", text: " and press New invoice." },
    ]);
  });

  it("refuses a route the guide has never heard of", () => {
    // A hallucinated path must stay as text, not become a link to nowhere.
    const segments = splitAnswerRoutes("Try [/magic-wizard] for that.");
    expect(segments.every((s) => s.kind === "text")).toBe(true);
    expect(segments.map((s) => (s.kind === "text" ? s.text : "")).join("")).toContain(
      "[/magic-wizard]",
    );
  });

  it("handles several routes in one answer", () => {
    const segments = splitAnswerRoutes("First [/bills], then [/pay-bills].");
    expect(segments.filter((s) => s.kind === "route")).toHaveLength(2);
  });

  it("leaves an answer with no routes alone", () => {
    expect(splitAnswerRoutes("Voiding does not delete anything.")).toEqual([
      { kind: "text", text: "Voiding does not delete anything." },
    ]);
  });
});

describe("suggestedQuestions", () => {
  it("offers questions the assistant can actually answer", () => {
    const questions = suggestedQuestions("/invoices");
    expect(questions.length).toBeGreaterThan(0);
    for (const question of questions) expect(question.endsWith("?")).toBe(true);
  });

  it("offers nothing on a screen the guide does not cover", () => {
    expect(suggestedQuestions("/nowhere")).toEqual([]);
  });

  it("never repeats itself", () => {
    const questions = suggestedQuestions("/invoices", 10);
    expect(new Set(questions).size).toBe(questions.length);
  });
});
