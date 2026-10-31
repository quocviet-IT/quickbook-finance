import { createSupabaseServerClient } from "@/lib/db/server";
import { resolveActiveCompany } from "@/lib/db/company";
import { buildAskAiSystemPrompt, validateAskAiQuestion } from "@/lib/ai/ask-prompt";
import { describeContextForAssistant } from "@/lib/domain/screen-context";
import { AiNotConfiguredError, AiProviderError, askProvider, type AiTurn } from "@/lib/ai/provider";
import { AI_TURN_REFUSAL, takeAiTurn } from "@/lib/ai/quota";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** How much of the conversation is carried. Enough for a follow-up, not a transcript. */
const HISTORY_TURNS = 6;

function readHistory(raw: unknown): AiTurn[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (turn): turn is AiTurn =>
        typeof turn === "object" &&
        turn !== null &&
        ["user", "assistant"].includes((turn as AiTurn).role) &&
        typeof (turn as AiTurn).content === "string",
    )
    .slice(-HISTORY_TURNS)
    .map((turn) => ({ role: turn.role, content: turn.content.slice(0, 4000) }));
}

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

  const body = payload as { question?: unknown; route?: unknown; history?: unknown };
  const check = validateAskAiQuestion(body?.question);
  if (!check.ok) return Response.json({ error: check.error }, { status: 400 });

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
      history: readHistory(body?.history),
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
