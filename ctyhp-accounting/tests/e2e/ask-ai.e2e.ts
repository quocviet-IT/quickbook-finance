import { describe, expect, it } from "vitest";
import { askAiChapters, buildAskAiSystemPrompt } from "@/lib/ai/ask-prompt";
import { MANUAL_CONTEXT } from "@/lib/ai/manual-context.generated";
import { aiConfigured, askProvider } from "@/lib/ai/provider";

/**
 * A citation can name the file, the chapter number, or the heading the chapter
 * carries inside the document — the model reasonably prefers the last of those,
 * since that is what a reader would look for.
 */
function acceptedCitations(): string[] {
  const accepted: string[] = [];
  for (const file of askAiChapters()) {
    accepted.push(file);
    const number = file.match(/^(\d+)_/)?.[1];
    if (number) accepted.push(`chapter ${number}`);
    const block = MANUAL_CONTEXT.split(`<chapter file="${file}">`)[1] ?? "";
    const heading = block.match(/^\s*#\s+(.+)$/m)?.[1];
    if (heading) accepted.push(heading.trim());
  }
  return accepted;
}

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function citesAChapter(answer: string): boolean {
  const haystack = normalize(answer);
  return acceptedCitations().some((citation) => haystack.includes(normalize(citation)));
}

/**
 * Asks the configured provider a real question. Skipped when no provider is
 * configured, so the suite still runs on a machine without a key — but never
 * silently passes: aiConfigured() is asserted in its own test below.
 */
describe("Ask AI against the configured provider", () => {
  it("reports whether a provider is configured", () => {
    if (!aiConfigured()) {
      console.info(
        "AI_BASE_URL / AI_MODEL / AI_API_KEY are unset — the live ask below is skipped.",
      );
    }
    expect(typeof aiConfigured()).toBe("boolean");
  });

  it.skipIf(!aiConfigured())(
    "answers a workflow question from the manual and names its chapter",
    async () => {
      const answer = await askProvider({
        system: buildAskAiSystemPrompt(),
        question:
          "Why can't I post a journal entry into a closed accounting period, and what should I do instead?",
      });

      expect(answer.text.length).toBeGreaterThan(40);
      expect(citesAChapter(answer.text), `no chapter cited in:\n${answer.text}`).toBe(
        true,
      );

      // eslint-disable-next-line no-console
      console.info(`model: ${answer.model}\nusage: ${JSON.stringify(answer.usage)}`);
      // eslint-disable-next-line no-console
      console.info(`answer:\n${answer.text}`);
    },
    60_000,
  );

  it.skipIf(!aiConfigured())(
    "refuses to invent a figure it cannot see",
    async () => {
      const answer = await askProvider({
        system: buildAskAiSystemPrompt(),
        question: "What is our current accounts receivable balance in dollars?",
      });
      // It has no access to the ledger, so any specific dollar figure would be
      // fabricated. It must say it cannot see the data instead.
      expect(answer.text).not.toMatch(/\$\s?\d/);
      // eslint-disable-next-line no-console
      console.info(`balance question answer:\n${answer.text}`);
    },
    60_000,
  );
});
