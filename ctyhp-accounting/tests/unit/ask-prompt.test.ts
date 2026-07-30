import { describe, expect, it } from "vitest";
import {
  ASK_AI_GROUNDING_NOTE,
  ASK_AI_MAX_QUESTION_LENGTH,
  askAiChapters,
  buildAskAiSystemPrompt,
  validateAskAiQuestion,
} from "@/lib/ai/ask-prompt";
import {
  buildManualContext,
  generateModule,
  readManualChapters,
} from "../../scripts/build-manual-context.mjs";
import { MANUAL_CHAPTERS, MANUAL_CONTEXT } from "@/lib/ai/manual-context.generated";

describe("manual grounding context", () => {
  it("is in sync with the manual on disk", () => {
    // The generated module is committed so the app needs no filesystem at
    // runtime; this test is what stops it drifting from the manual.
    const chapters = readManualChapters();
    const expected = generateModule(
      buildManualContext(chapters),
      chapters.map((c) => c.file),
    );
    const actual = generateModule(MANUAL_CONTEXT, [...MANUAL_CHAPTERS]);
    expect(
      actual,
      "run `node scripts/build-manual-context.mjs` — the manual changed",
    ).toBe(expected);
  });

  it("carries every chapter of the manual", () => {
    expect(askAiChapters().length).toBeGreaterThanOrEqual(12);
    expect(askAiChapters()).toContain("05_Banking_and_Reconciliation.md");
  });

  it("tags each chapter so an answer can cite where it came from", () => {
    for (const file of askAiChapters()) {
      expect(MANUAL_CONTEXT).toContain(`<chapter file="${file}">`);
    }
  });
});

describe("buildAskAiSystemPrompt", () => {
  const prompt = buildAskAiSystemPrompt();

  it("grounds the answer in the manual rather than the model's own knowledge", () => {
    expect(prompt).toContain("Answer only from the chapters below");
    expect(prompt).toContain(MANUAL_CONTEXT);
  });

  it("tells the assistant to admit when the manual does not cover the question", () => {
    expect(prompt).toMatch(/do not cover the question, say so/i);
  });

  it("refuses to let the assistant give tax or accounting advice", () => {
    expect(prompt).toMatch(/do not give tax, legal, or accounting advice/i);
  });

  it("forbids inventing figures, because the assistant cannot see the ledger", () => {
    expect(prompt).toMatch(/Never invent figures/i);
  });
});

describe("validateAskAiQuestion", () => {
  it("rejects an empty or whitespace-only question", () => {
    expect(validateAskAiQuestion("")).toEqual({ ok: false, error: "Type a question first." });
    expect(validateAskAiQuestion("   ").ok).toBe(false);
  });

  it("rejects a non-string payload", () => {
    expect(validateAskAiQuestion(undefined).ok).toBe(false);
    expect(validateAskAiQuestion(42).ok).toBe(false);
  });

  it("trims what it accepts", () => {
    expect(validateAskAiQuestion("  how do I close a period?  ")).toEqual({
      ok: true,
      question: "how do I close a period?",
    });
  });

  it("caps the question length", () => {
    const long = "a".repeat(ASK_AI_MAX_QUESTION_LENGTH + 1);
    expect(validateAskAiQuestion(long).ok).toBe(false);
    expect(validateAskAiQuestion("a".repeat(ASK_AI_MAX_QUESTION_LENGTH)).ok).toBe(true);
  });
});

describe("grounding note", () => {
  it("is the sentence the panel prints under the input", () => {
    expect(ASK_AI_GROUNDING_NOTE).toBe("Answers come from the app's own rules and guides.");
  });
});
