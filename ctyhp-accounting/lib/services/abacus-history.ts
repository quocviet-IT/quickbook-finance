import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AiTurn } from "@/lib/ai/provider";
import { readAllPages } from "./paging";

/**
 * Abacus's conversation history (migration 0190).
 *
 * `sb` is the person's own client for schema `onebook`
 * (`createSupabaseServerClientForSchema("onebook")`): row-level security keeps
 * every read and write to the person's own rows, and each read also filters by
 * the open company explicitly. The browser never supplies earlier turns; the
 * route reads them from here.
 */

export class AbacusHistoryError extends Error {
  constructor(
    message: string,
    /** "not_found" when the conversation is not the person's (or is gone). */
    readonly code: "not_found" | "failed" = "failed",
  ) {
    super(message);
    this.name = "AbacusHistoryError";
  }
}

export interface AbacusExchange {
  id: string;
  question: string;
  answer: string;
  sourceKey: string | null;
  route: string;
  rating: -1 | 1 | null;
  askedAt: string;
}
export interface AbacusConversationSummary {
  id: string;
  title: string;
  route: string;
  updatedAt: string;
  createdAt: string;
  questionCount: number;
  lastQuestion: string;
}
export interface AbacusConversation extends AbacusConversationSummary {
  exchanges: AbacusExchange[];
}

/** How many conversations are kept per person per company (the database prunes to the same). */
export const ABACUS_KEPT_CONVERSATIONS = 20;

const CONVERSATION_COLUMNS = "id, title, route, created_at, updated_at";
const MESSAGE_COLUMNS = "id, conversation_id, question, answer, source, route, rating, asked_at";

type ConversationRow = {
  id: string;
  title: string;
  route: string;
  created_at: string;
  updated_at: string;
};
type MessageRow = {
  id: string;
  conversation_id: string;
  question: string;
  answer: string;
  source: string | null;
  route: string;
  rating: number | null;
  asked_at: string;
};

function fail(message: string): AbacusHistoryError {
  return new AbacusHistoryError(message);
}

function toExchange(row: MessageRow): AbacusExchange {
  return {
    id: row.id,
    question: row.question,
    answer: row.answer,
    sourceKey: row.source,
    route: row.route,
    rating: row.rating === 1 ? 1 : row.rating === -1 ? -1 : null,
    askedAt: row.asked_at,
  };
}

function toSummary(row: ConversationRow, messages: MessageRow[]): AbacusConversationSummary {
  return {
    id: row.id,
    title: row.title,
    route: row.route,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
    questionCount: messages.length,
    lastQuestion: messages.length > 0 ? messages[messages.length - 1].question : row.title,
  };
}

/** Every message of these conversations, oldest first (asked_at, id is a total order). */
async function readMessages(sb: SupabaseClient, conversationIds: string[]): Promise<MessageRow[]> {
  if (conversationIds.length === 0) return [];
  return readAllPages<MessageRow>(
    (from, to) =>
      sb
        .from("ai_message")
        .select(MESSAGE_COLUMNS)
        .in("conversation_id", conversationIds)
        .order("asked_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    fail,
  );
}

/** The person's conversations in this company, newest first, at most 20. */
export async function listAbacusConversations(
  sb: SupabaseClient,
  companyId: string,
): Promise<AbacusConversationSummary[]> {
  const { data, error } = await sb
    .from("ai_conversation")
    .select(CONVERSATION_COLUMNS)
    .eq("company_id", companyId)
    .order("updated_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(ABACUS_KEPT_CONVERSATIONS);
  if (error) throw fail(error.message);
  const conversations = (data ?? []) as ConversationRow[];

  const messages = await readMessages(
    sb,
    conversations.map((c) => c.id),
  );
  const byConversation = new Map<string, MessageRow[]>();
  for (const message of messages) {
    const list = byConversation.get(message.conversation_id) ?? [];
    list.push(message);
    byConversation.set(message.conversation_id, list);
  }
  return conversations.map((c) => toSummary(c, byConversation.get(c.id) ?? []));
}

/** One conversation with all its exchanges, or null when it is not the person's in this company. */
export async function readAbacusConversation(
  sb: SupabaseClient,
  companyId: string,
  id: string,
): Promise<AbacusConversation | null> {
  const { data, error } = await sb
    .from("ai_conversation")
    .select(CONVERSATION_COLUMNS)
    .eq("id", id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw fail(error.message);
  if (!data) return null;
  const messages = await readMessages(sb, [id]);
  return { ...toSummary(data as ConversationRow, messages), exchanges: messages.map(toExchange) };
}

/**
 * The last few exchanges of a conversation as the model should see them, oldest
 * first, one user turn then one assistant turn each. Throws `not_found` when the
 * conversation is not the person's in this company.
 */
export async function recentAbacusTurns(
  sb: SupabaseClient,
  companyId: string,
  id: string,
  exchanges = 3,
): Promise<AiTurn[]> {
  const owned = await sb
    .from("ai_conversation")
    .select("id")
    .eq("id", id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (owned.error) throw fail(owned.error.message);
  if (!owned.data) throw new AbacusHistoryError("That conversation is no longer in your history.", "not_found");

  const { data, error } = await sb
    .from("ai_message")
    .select("question, answer, asked_at, id")
    .eq("conversation_id", id)
    .order("asked_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(exchanges);
  if (error) throw fail(error.message);
  const rows = ((data ?? []) as { question: string; answer: string }[]).slice().reverse();
  return rows.flatMap((row): AiTurn[] => [
    { role: "user", content: row.question },
    { role: "assistant", content: row.answer },
  ]);
}

/** Saves one question and its answer (onebook.save_ai_exchange): a new conversation, or a turn in one the person owns. */
export async function saveAbacusExchange(
  sb: SupabaseClient,
  input: {
    conversationId: string | null;
    companyId: string;
    route: string;
    question: string;
    answer: string;
    sourceKey: string | null;
  },
): Promise<{ conversationId: string; messageId: string; askedAt: string }> {
  const { data, error } = await sb.rpc("save_ai_exchange", {
    p_conversation: input.conversationId,
    p_company: input.companyId,
    p_route: input.route,
    p_question: input.question,
    p_answer: input.answer,
    p_source: input.sourceKey,
  });
  if (error) throw fail(error.message);
  const saved = data as { conversation_id?: string; message_id?: string; asked_at?: string } | null;
  if (!saved?.conversation_id || !saved.message_id || !saved.asked_at) {
    throw fail("The conversation could not be saved.");
  }
  return { conversationId: saved.conversation_id, messageId: saved.message_id, askedAt: saved.asked_at };
}

export async function deleteAbacusConversation(sb: SupabaseClient, companyId: string, id: string): Promise<void> {
  const { error } = await sb.from("ai_conversation").delete().eq("id", id).eq("company_id", companyId);
  if (error) throw fail(error.message);
}

/** Deletes every conversation the person has in this company; returns how many. */
export async function clearAbacusHistory(sb: SupabaseClient, companyId: string): Promise<number> {
  const { data, error } = await sb.from("ai_conversation").delete().eq("company_id", companyId).select("id");
  if (error) throw fail(error.message);
  return (data ?? []).length;
}

/** Thumbs up (1), thumbs down (-1) or clear (null) on one answer. Only the rating can change. */
export async function rateAbacusAnswer(
  sb: SupabaseClient,
  messageId: string,
  rating: -1 | 1 | null,
): Promise<void> {
  const { error } = await sb.from("ai_message").update({ rating }).eq("id", messageId);
  if (error) throw fail(error.message);
}
