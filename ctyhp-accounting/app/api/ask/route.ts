import { createSupabaseServerClient } from "@/lib/db/server";
import {
  buildAskAiSystemPrompt,
  validateAskAiQuestion,
} from "@/lib/ai/ask-prompt";
import { AiNotConfiguredError, AiProviderError, askProvider } from "@/lib/ai/provider";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Ask the in-app assistant. Server-side only: the provider key never reaches the
 * browser, and the caller must be signed in — the grounding context is the
 * company's own guides, not public documentation.
 */
export async function POST(request: Request) {
  const sb = await createSupabaseServerClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) {
    return Response.json({ error: "Sign in to ask a question." }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Send a JSON body." }, { status: 400 });
  }

  const check = validateAskAiQuestion((payload as { question?: unknown })?.question);
  if (!check.ok) return Response.json({ error: check.error }, { status: 400 });

  try {
    const answer = await askProvider({
      system: buildAskAiSystemPrompt(),
      question: check.question as string,
    });
    return Response.json({
      answer: answer.text,
      model: answer.model,
      usage: answer.usage,
    });
  } catch (err) {
    if (err instanceof AiNotConfiguredError) {
      return Response.json({ error: err.message }, { status: 503 });
    }
    if (err instanceof AiProviderError) {
      return Response.json({ error: err.message }, { status: 502 });
    }
    return Response.json({ error: "The assistant failed to answer." }, { status: 500 });
  }
}
