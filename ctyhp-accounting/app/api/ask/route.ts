import { createSupabaseServerClient, createSupabaseServerClientForSchema } from "@/lib/db/server";
import { resolveActiveCompany } from "@/lib/db/company";
import { buildAskAiSystemPrompt, validateAskAiQuestion } from "@/lib/ai/ask-prompt";
import { describeContextForAssistant } from "@/lib/domain/screen-context";
import { AiNotConfiguredError, AiProviderError, askProvider, type AiTurn } from "@/lib/ai/provider";
import { parseAbacusAnswer } from "@/lib/domain/abacus-answer";
import { AbacusHistoryError, recentAbacusTurns, saveAbacusExchange } from "@/lib/services/abacus-history";
import { AI_TURN_REFUSAL, takeAiTurn } from "@/lib/ai/quota";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Ask the in-app assistant.
 *
 * Server-side only: the provider key never reaches the browser, and the caller
 * must be signed in — the grounding context is the company's own guides, not
 * public documentation.
 *
 * The question now arrives with the screen it was asked from and the company
 * that is open, so the answer can name the control in front of the person
 * rather than describing the application in general. Neither is taken on trust:
 * the company comes from the server's own resolution, never from the browser,
 * and the route only ever selects which part of the guide to quote.
 *
 * Earlier turns are never taken from the browser. A follow-up names its
 * conversation, and the server reads the last exchanges from the person's own
 * history; each answer is saved there, and the answer is parsed for the
 * `Source:` line the assistant ends with (Abacus).
 *
 * Only someone who belongs to the open company may ask, and each question is
 * counted against an hourly allowance before it is sent (2.94).
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

  const body = payload as { question?: unknown; route?: unknown; conversationId?: unknown };
  const check = validateAskAiQuestion(body?.question);
  if (!check.ok) return Response.json({ error: check.error }, { status: 400 });

  const rawConversation = body?.conversationId;
  if (rawConversation !== undefined && rawConversation !== null && (typeof rawConversation !== "string" || !UUID.test(rawConversation))) {
    return Response.json({ error: "That conversation could not be found." }, { status: 400 });
  }
  const conversationId = typeof rawConversation === "string" ? rawConversation : null;

  const route = typeof body?.route === "string" ? body.route.slice(0, 200) : "/";

  const [{ active }, profile] = await Promise.all([
    resolveActiveCompany(),
    sb.from("acc_app_user").select("role").eq("id", user.id).maybeSingle(),
  ]);
  if (!active) {
    return Response.json({ error: "Open a company you belong to before asking." }, { status: 403 });
  }

  const allowance = await takeAiTurn();
  if (allowance !== "granted") {
    return Response.json({ error: AI_TURN_REFUSAL[allowance] }, { status: allowance === "limit" ? 429 : 503 });
  }

  const history = await createSupabaseServerClientForSchema("onebook");
  let earlier: AiTurn[] = [];
  if (conversationId) {
    try {
      earlier = await recentAbacusTurns(history, active.id, conversationId);
    } catch (err) {
      if (err instanceof AbacusHistoryError && err.code === "not_found") {
        return Response.json({ error: "That conversation is no longer in your history." }, { status: 404 });
      }
      console.error("reading the conversation failed:", err instanceof Error ? err.message : err);
      return Response.json({ error: "Your conversation could not be read. Try again in a moment." }, { status: 500 });
    }
  }

  const briefing = describeContextForAssistant({
    route,
    companyName: active.legalName,
    isSampleCompany: active.isSample,
    role: (profile.data?.role as string | undefined) ?? null,
  });

  try {
    const answer = await askProvider({
      system: buildAskAiSystemPrompt(briefing),
      question: check.question as string,
      history: earlier,
    });
    const parsed = parseAbacusAnswer(answer.text);
    let saved: { conversationId: string; messageId: string; askedAt: string } | null = null;
    try {
      saved = await saveAbacusExchange(history, {
        conversationId,
        companyId: active.id,
        route,
        question: check.question as string,
        answer: parsed.body,
        sourceKey: parsed.sourceKey,
      });
    } catch (err) {
      // The answer was paid for: show it, and say it was not kept.
      console.error("saving the exchange failed:", err instanceof Error ? err.message : err);
    }
    return Response.json({
      answer: parsed.body,
      source: parsed.source,
      covered: parsed.covered,
      conversationId: saved?.conversationId ?? conversationId,
      messageId: saved?.messageId ?? null,
      askedAt: saved?.askedAt ?? new Date().toISOString(),
      saved: saved !== null,
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
