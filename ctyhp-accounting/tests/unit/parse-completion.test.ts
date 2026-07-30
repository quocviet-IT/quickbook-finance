import { describe, expect, it } from "vitest";
import {
  normalizeCompletionBody,
  parseChatCompletion,
} from "@/lib/ai/parse-completion";

const openAiShape = {
  model: "gemini-2.0-flash",
  choices: [{ message: { content: "  Close the period in Settings → Periods.  " } }],
  usage: { prompt_tokens: 5200, completion_tokens: 90 },
};

describe("normalizeCompletionBody", () => {
  it("unwraps the array Gemini's compatibility layer returns", () => {
    // Measured against the live endpoint: an error body arrives as
    // [{ "error": { "message": "Please pass a valid API key" } }].
    expect(normalizeCompletionBody([{ error: { message: "Please pass a valid API key" } }]))
      .toEqual({ error: { message: "Please pass a valid API key" } });
  });

  it("passes a plain object through", () => {
    expect(normalizeCompletionBody(openAiShape)).toBe(openAiShape);
  });

  it("treats a null, string, or empty array body as unreadable", () => {
    expect(normalizeCompletionBody(null)).toBeNull();
    expect(normalizeCompletionBody("upstream timeout")).toBeNull();
    expect(normalizeCompletionBody([])).toBeNull();
  });
});

describe("parseChatCompletion", () => {
  it("reads the answer, model and usage from an OpenAI-shaped body", () => {
    expect(parseChatCompletion(openAiShape)).toEqual({
      text: "Close the period in Settings → Periods.",
      model: "gemini-2.0-flash",
      usage: { inputTokens: 5200, outputTokens: 90 },
      providerMessage: null,
    });
  });

  it("reads the same answer when the body is array-wrapped", () => {
    expect(parseChatCompletion([openAiShape]).text).toBe(
      "Close the period in Settings → Periods.",
    );
  });

  it("surfaces the provider's message from an array-wrapped error", () => {
    expect(
      parseChatCompletion([{ error: { message: "Please pass a valid API key" } }])
        .providerMessage,
    ).toBe("Please pass a valid API key");
  });

  it("reports no text rather than an empty answer", () => {
    expect(parseChatCompletion({ choices: [{ message: { content: "   " } }] }).text).toBeNull();
    expect(parseChatCompletion({ choices: [] }).text).toBeNull();
    expect(parseChatCompletion(null).text).toBeNull();
  });

  it("omits usage when the provider reports none", () => {
    expect(parseChatCompletion({ choices: [{ message: { content: "hi" } }] }).usage).toBeNull();
  });
});
