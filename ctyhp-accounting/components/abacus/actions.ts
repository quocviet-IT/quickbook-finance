"use server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClientForSchema } from "@/lib/db/server";
import { resolveActiveCompany } from "@/lib/db/company";
import {
  clearAbacusHistory,
  deleteAbacusConversation,
  listAbacusConversations,
  rateAbacusAnswer,
  readAbacusConversation,
  type AbacusConversation,
  type AbacusConversationSummary,
} from "@/lib/services/abacus-history";

/**
 * Abacus's history, for the panel.
 *
 * Thin wrappers: each resolves the signed-in person and the open company on the
 * server, never from the browser, then calls the history service. None throws
 * to the client; a failure comes back as `{ ok: false, error }`.
 */

export type AbacusActionResult<T extends object = Record<never, never>> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SIGNED_OUT = "Sign in to see your conversations.";
const NO_COMPANY = "Open a company to see your conversations.";
const FAILED = "Your conversations could not be reached. Try again in a moment.";

async function withHistory<T extends object>(
  run: (sb: SupabaseClient, companyId: string) => Promise<T>,
): Promise<AbacusActionResult<T>> {
  try {
    const sb = await createSupabaseServerClientForSchema("onebook");
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (!user) return { ok: false, error: SIGNED_OUT };
    const { active } = await resolveActiveCompany();
    if (!active) return { ok: false, error: NO_COMPANY };
    return { ok: true, ...(await run(sb, active.id)) };
  } catch (err) {
    console.error("Abacus history failed:", err instanceof Error ? err.message : err);
    return { ok: false, error: FAILED };
  }
}

export async function listAbacusConversationsAction(): Promise<
  AbacusActionResult<{ conversations: AbacusConversationSummary[] }>
> {
  return withHistory(async (sb, companyId) => ({ conversations: await listAbacusConversations(sb, companyId) }));
}

export async function readAbacusConversationAction(
  id: string,
): Promise<AbacusActionResult<{ conversation: AbacusConversation }>> {
  if (typeof id !== "string" || !UUID.test(id)) return { ok: false, error: "That conversation could not be found." };
  const result = await withHistory(async (sb, companyId) => ({
    conversation: await readAbacusConversation(sb, companyId, id),
  }));
  if (!result.ok) return result;
  if (!result.conversation) return { ok: false, error: "That conversation is no longer in your history." };
  return { ok: true, conversation: result.conversation };
}

export async function deleteAbacusConversationAction(id: string): Promise<AbacusActionResult> {
  if (typeof id !== "string" || !UUID.test(id)) return { ok: false, error: "That conversation could not be found." };
  return withHistory(async (sb, companyId) => {
    await deleteAbacusConversation(sb, companyId, id);
    return {};
  });
}

export async function clearAbacusHistoryAction(): Promise<AbacusActionResult<{ deleted: number }>> {
  return withHistory(async (sb, companyId) => ({ deleted: await clearAbacusHistory(sb, companyId) }));
}

export async function rateAbacusAnswerAction(
  messageId: string,
  rating: -1 | 1 | null,
): Promise<AbacusActionResult> {
  if (typeof messageId !== "string" || !UUID.test(messageId)) return { ok: false, error: "That answer could not be found." };
  if (rating !== -1 && rating !== 1 && rating !== null) return { ok: false, error: "That rating is not valid." };
  return withHistory(async (sb) => {
    await rateAbacusAnswer(sb, messageId, rating);
    return {};
  });
}
