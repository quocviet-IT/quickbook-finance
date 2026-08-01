import "server-only";
import { parseChatCompletion } from "./parse-completion";

/**
 * The one place that talks to an AI provider.
 *
 * The provider is configured, not hard-coded: most hosted models expose an
 * OpenAI-compatible chat-completions endpoint, so that shape is the default and
 * a different provider means writing one more branch here — not touching the
 * route, the prompt, or the UI.
 *
 * The API key is read from the server environment and never leaves it.
 */

export type AiProviderKind = "openai-compatible";

export interface AiConfig {
  kind: AiProviderKind;
  baseUrl: string;
  model: string;
  apiKey: string;
  /** Header the provider expects the key in. */
  authHeader: "authorization-bearer" | "x-api-key";
}

export class AiNotConfiguredError extends Error {}
export class AiProviderError extends Error {}

/**
 * Reads configuration without throwing, so a page can show "the assistant is
 * not configured yet" instead of failing to render.
 */
export function readAiConfig(): AiConfig | null {
  const baseUrl = process.env.AI_BASE_URL?.trim();
  const model = process.env.AI_MODEL?.trim();
  const apiKey = process.env.AI_API_KEY?.trim();
  if (!baseUrl || !model || !apiKey) return null;

  return {
    kind: (process.env.AI_PROVIDER?.trim() as AiProviderKind) || "openai-compatible",
    baseUrl: baseUrl.replace(/\/+$/, ""),
    model,
    apiKey,
    authHeader:
      process.env.AI_AUTH_HEADER?.trim() === "x-api-key"
        ? "x-api-key"
        : "authorization-bearer",
  };
}

export function aiConfigured(): boolean {
  return readAiConfig() !== null;
}

export interface AiAnswer {
  text: string;
  model: string;
  /** Whatever the provider reported; absent when it reports nothing. */
  usage: { inputTokens?: number; outputTokens?: number } | null;
}

/**
 * One question, one answer. No conversation state is kept server-side: each ask
 * carries its own system prompt, so an answer can never be shaped by another
 * user's earlier question.
 */
export interface AiTurn {
  role: "user" | "assistant";
  content: string;
}

export async function askProvider(input: {
  system: string;
  question: string;
  /**
   * What was said before, oldest first. Without it every follow-up starts
   * again from nothing, and "why?" is unanswerable.
   */
  history?: readonly AiTurn[];
  maxOutputTokens?: number;
  signal?: AbortSignal;
}): Promise<AiAnswer> {
  const config = readAiConfig();
  if (!config) {
    throw new AiNotConfiguredError(
      "The assistant is not configured yet. Set AI_BASE_URL, AI_MODEL and AI_API_KEY.",
    );
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.authHeader === "x-api-key") headers["x-api-key"] = config.apiKey;
  else headers.Authorization = `Bearer ${config.apiKey}`;

  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      signal: input.signal,
      body: JSON.stringify({
        model: config.model,
        max_tokens: input.maxOutputTokens ?? 1200,
        messages: [
          { role: "system", content: input.system },
          ...(input.history ?? []).map((turn) => ({ role: turn.role, content: turn.content })),
          { role: "user", content: input.question },
        ],
      }),
    });
  } catch (err) {
    throw new AiProviderError(
      err instanceof Error ? `Could not reach the model: ${err.message}` : "Could not reach the model",
    );
  }

  const parsed = parseChatCompletion(await response.json().catch(() => null));
  if (!response.ok) {
    // The provider's own wording is the useful part (a bad key, a model the key
    // cannot use); the request body is not echoed back, because it carries the
    // company's own guides.
    throw new AiProviderError(
      parsed.providerMessage
        ? `The model rejected the request (${response.status}): ${parsed.providerMessage}`
        : `The model returned ${response.status}.`,
    );
  }
  if (!parsed.text) throw new AiProviderError("The model returned an empty answer.");

  return {
    text: parsed.text,
    model: parsed.model ?? config.model,
    usage: parsed.usage,
  };
}
