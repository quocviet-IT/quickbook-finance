/**
 * The assistant's instructions. Pure and unit-tested: what the model is told
 * about this company's books is a product decision, not an implementation
 * detail buried in a fetch call.
 */
import { MANUAL_CHAPTERS, MANUAL_CONTEXT } from "./manual-context.generated";

export const ASK_AI_MAX_QUESTION_LENGTH = 1000;

/** What the panel prints under the input, and what the answer must honour. */
export const ASK_AI_GROUNDING_NOTE = "Answers come from the app's own rules and guides.";

export function askAiChapters(): readonly string[] {
  return MANUAL_CHAPTERS;
}

/**
 * The assistant's instructions.
 *
 * `screenBriefing` is what the person is looking at, built from the guide's own
 * data. Without it every question arrives from nowhere and the answer has to be
 * generic — "go to the invoices screen" said to somebody already standing on
 * it. With it the assistant can name the control in front of them.
 */
export function buildAskAiSystemPrompt(screenBriefing?: string): string {
  return [
    "You are the in-app assistant for One Book, a US accounting application.",
    "Answer staff questions about how the application works and about the accounting",
    "workflows it implements.",
    "",
    "Rules you must follow:",
    "- Answer only from the chapters below. They are this application\'s own rules and guides.",
    "- If the chapters do not cover the question, say so plainly and name who to ask. Never guess at how a feature behaves.",
    "- Name the chapter you answered from, so the reader can check you.",
    "- Be brief: a short paragraph, or a few steps when the question is procedural.",
    "- You explain the software. You do not give tax, legal, or accounting advice, and you",
    "  never state what the company must file or owe. Point those to a qualified professional.",
    "- Never invent figures, balances, or document numbers. You cannot see the company\'s data.",
    "  If asked what a balance is, say where in the application to read it instead.",
    "- When a step happens on another screen, write the route in square brackets, like",
    "  [/reports/ar-aging], so the reader can click it. Only routes that appear below.",
    "- Answer the question that was asked. Do not restate the screen they are on back at them.",
    "",
    screenBriefing ? `${screenBriefing}\n` : "",
    "Chapters:",
    MANUAL_CONTEXT,
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export interface AskAiValidation {
  ok: boolean;
  error?: string;
  question?: string;
}

export function validateAskAiQuestion(raw: unknown): AskAiValidation {
  if (typeof raw !== "string") return { ok: false, error: "Type a question first." };
  const question = raw.trim();
  if (!question) return { ok: false, error: "Type a question first." };
  if (question.length > ASK_AI_MAX_QUESTION_LENGTH) {
    return {
      ok: false,
      error: `Keep the question under ${ASK_AI_MAX_QUESTION_LENGTH} characters.`,
    };
  }
  return { ok: true, question };
}
