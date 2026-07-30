/**
 * Reading a chat-completion body, defensively.
 *
 * Providers that advertise an OpenAI-compatible endpoint are not byte-compatible
 * with it. Gemini's compatibility layer, for one, wraps the payload in a JSON
 * array — `[{ "error": … }]` — so reading `body.error` on the parsed object
 * silently finds nothing. Normalising here, in a tested pure function, keeps
 * that class of surprise out of the request path.
 */

export interface ParsedCompletion {
  text: string | null;
  model: string | null;
  usage: { inputTokens?: number; outputTokens?: number } | null;
  providerMessage: string | null;
}

interface RawCompletion {
  model?: string;
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

/** Unwraps an array-wrapped body; anything unrecognisable becomes null. */
export function normalizeCompletionBody(body: unknown): RawCompletion | null {
  const candidate = Array.isArray(body) ? body[0] : body;
  return candidate && typeof candidate === "object" ? (candidate as RawCompletion) : null;
}

export function parseChatCompletion(body: unknown): ParsedCompletion {
  const raw = normalizeCompletionBody(body);
  const text = raw?.choices?.[0]?.message?.content?.trim();
  return {
    text: text || null,
    model: raw?.model ?? null,
    usage: raw?.usage
      ? {
          inputTokens: raw.usage.prompt_tokens,
          outputTokens: raw.usage.completion_tokens,
        }
      : null,
    providerMessage: raw?.error?.message?.trim() || null,
  };
}
