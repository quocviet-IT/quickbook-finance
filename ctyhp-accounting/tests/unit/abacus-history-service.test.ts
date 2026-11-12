import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));

import {
  AbacusHistoryError,
  clearAbacusHistory,
  deleteAbacusConversation,
  listAbacusConversations,
  rateAbacusAnswer,
  readAbacusConversation,
  recentAbacusTurns,
  saveAbacusExchange,
} from "@/lib/services/abacus-history";

type Pair = [string, unknown];
interface Call {
  table: string;
  op: "select" | "delete" | "update";
  select: string;
  update: unknown;
  eq: Pair[];
  in: Pair[];
  order: Pair[];
  limit: number | null;
  range: [number, number][];
}

function fakeClient(
  tables: Record<string, unknown[]>,
  opts: { error?: string; rpc?: { data?: unknown; error?: { message: string } | null } } = {},
) {
  const calls: Call[] = [];
  const from = vi.fn((table: string) => {
    const call: Call = { table, op: "select", select: "", update: null, eq: [], in: [], order: [], limit: null, range: [] };
    calls.push(call);
    const builder: Record<string, unknown> = {};
    builder.select = (columns: string) => {
      call.select = columns;
      return builder;
    };
    builder.delete = () => ((call.op = "delete"), builder);
    builder.update = (values: unknown) => ((call.op = "update"), (call.update = values), builder);
    builder.eq = (c: string, v: unknown) => (call.eq.push([c, v]), builder);
    builder.in = (c: string, v: unknown) => (call.in.push([c, v]), builder);
    builder.order = (c: string, o?: { ascending?: boolean }) => (call.order.push([c, o?.ascending ?? true]), builder);
    builder.limit = (n: number) => ((call.limit = n), builder);
    builder.range = (a: number, b: number) => (call.range.push([a, b]), builder);
    const rows = () => (tables[table] ?? []).slice();
    builder.maybeSingle = async () => ({ data: rows()[0] ?? null, error: opts.error ? { message: opts.error } : null });
    builder.then = (resolve: (v: unknown) => unknown) =>
      resolve({ data: rows(), error: opts.error ? { message: opts.error } : null });
    return builder;
  });
  const rpc = vi.fn(async () => ({ data: opts.rpc?.data ?? null, error: opts.rpc?.error ?? null }));
  const sb = { from, rpc } as unknown as SupabaseClient;
  return Object.assign(sb, { calls, rpc });
}

const CONVERSATION = { id: "c1", title: "How do I record a payment?", route: "/invoices", created_at: "2026-11-10T10:00:00Z", updated_at: "2026-11-10T10:05:00Z" };
const message = (id: string, question: string, extra: Record<string, unknown> = {}) => ({
  id,
  conversation_id: "c1",
  question,
  answer: `Answer to ${question}`,
  source: "get-paid",
  route: "/invoices",
  rating: null,
  asked_at: "2026-11-10T10:00:00Z",
  ...extra,
});

describe("listAbacusConversations", () => {
  it("reads the company's conversations newest first, at most 20, then their questions in one read", async () => {
    const sb = fakeClient({ ai_conversation: [CONVERSATION], ai_message: [message("m1", "First?"), message("m2", "Second?")] });
    const list = await listAbacusConversations(sb, "co1");
    expect(list).toEqual([
      {
        id: "c1",
        title: CONVERSATION.title,
        route: "/invoices",
        createdAt: CONVERSATION.created_at,
        updatedAt: CONVERSATION.updated_at,
        questionCount: 2,
        lastQuestion: "Second?",
      },
    ]);
    const [conversations, messages] = sb.calls;
    expect(conversations.eq).toContainEqual(["company_id", "co1"]);
    expect(conversations.order).toEqual([["updated_at", false], ["id", false]]);
    expect(conversations.limit).toBe(20);
    expect(messages.table).toBe("ai_message");
    expect(messages.in).toEqual([["conversation_id", ["c1"]]]);
    // A total order and a range, so no message straddles a page (readAllPages).
    expect(messages.order).toEqual([["asked_at", true], ["id", true]]);
    expect(messages.range).toEqual([[0, 999]]);
    expect(sb.calls).toHaveLength(2);
  });

  it("skips the second read when there is nothing", async () => {
    const sb = fakeClient({ ai_conversation: [] });
    await expect(listAbacusConversations(sb, "co1")).resolves.toEqual([]);
    expect(sb.calls).toHaveLength(1);
  });

  it("throws an AbacusHistoryError when the read fails", async () => {
    const sb = fakeClient({}, { error: "boom" });
    await expect(listAbacusConversations(sb, "co1")).rejects.toBeInstanceOf(AbacusHistoryError);
  });
});

describe("readAbacusConversation", () => {
  it("returns the whole thread, filtered by id and company", async () => {
    const sb = fakeClient({ ai_conversation: [CONVERSATION], ai_message: [message("m1", "First?", { rating: 1 }), message("m2", "Second?", { rating: 5 })] });
    const thread = await readAbacusConversation(sb, "co1", "c1");
    expect(thread?.exchanges.map((e) => [e.id, e.sourceKey, e.rating])).toEqual([["m1", "get-paid", 1], ["m2", "get-paid", null]]);
    expect(sb.calls[0].eq).toEqual([["id", "c1"], ["company_id", "co1"]]);
  });

  it("returns null for a conversation that is not there", async () => {
    await expect(readAbacusConversation(fakeClient({ ai_conversation: [] }), "co1", "x")).resolves.toBeNull();
  });
});

describe("recentAbacusTurns", () => {
  it("gives the last exchanges oldest first as user and assistant turns", async () => {
    // The database returns newest first; the model must see oldest first.
    const sb = fakeClient({ ai_conversation: [{ id: "c1" }], ai_message: [message("m2", "Second?"), message("m1", "First?")] });
    const turns = await recentAbacusTurns(sb, "co1", "c1", 2);
    expect(turns).toEqual([
      { role: "user", content: "First?" },
      { role: "assistant", content: "Answer to First?" },
      { role: "user", content: "Second?" },
      { role: "assistant", content: "Answer to Second?" },
    ]);
    const read = sb.calls[1];
    expect(read.order).toEqual([["asked_at", false], ["id", false]]);
    expect(read.limit).toBe(2);
    expect(read.eq).toEqual([["conversation_id", "c1"]]);
  });

  it("defaults to three exchanges", async () => {
    const sb = fakeClient({ ai_conversation: [{ id: "c1" }], ai_message: [] });
    await recentAbacusTurns(sb, "co1", "c1");
    expect(sb.calls[1].limit).toBe(3);
  });

  it("says not_found for a conversation that is not the person's", async () => {
    const sb = fakeClient({ ai_conversation: [] });
    await expect(recentAbacusTurns(sb, "co1", "c1")).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("saveAbacusExchange", () => {
  const input = { conversationId: null, companyId: "co1", route: "/invoices", question: "Q?", answer: "A.", sourceKey: "get-paid" };

  it("saves through the database function and returns the ids", async () => {
    const sb = fakeClient({}, { rpc: { data: { conversation_id: "c1", message_id: "m1", asked_at: "2026-11-10T10:00:00Z" } } });
    await expect(saveAbacusExchange(sb, input)).resolves.toEqual({ conversationId: "c1", messageId: "m1", askedAt: "2026-11-10T10:00:00Z" });
    expect(sb.rpc).toHaveBeenCalledWith("save_ai_exchange", {
      p_conversation: null,
      p_company: "co1",
      p_route: "/invoices",
      p_question: "Q?",
      p_answer: "A.",
      p_source: "get-paid",
    });
  });

  it("throws when the function refuses or answers nothing", async () => {
    await expect(saveAbacusExchange(fakeClient({}, { rpc: { error: { message: "That conversation is not yours" } } }), input)).rejects.toThrow("That conversation is not yours");
    await expect(saveAbacusExchange(fakeClient({}, { rpc: { data: {} } }), input)).rejects.toBeInstanceOf(AbacusHistoryError);
  });
});

describe("deleting and rating", () => {
  it("deletes one conversation of this company", async () => {
    const sb = fakeClient({});
    await deleteAbacusConversation(sb, "co1", "c1");
    expect(sb.calls[0]).toMatchObject({ table: "ai_conversation", op: "delete", eq: [["id", "c1"], ["company_id", "co1"]] });
  });

  it("clears the company's history and counts what went", async () => {
    const sb = fakeClient({ ai_conversation: [{ id: "a" }, { id: "b" }] });
    await expect(clearAbacusHistory(sb, "co1")).resolves.toBe(2);
    expect(sb.calls[0]).toMatchObject({ op: "delete", eq: [["company_id", "co1"]], select: "id" });
  });

  it("changes only the rating", async () => {
    const sb = fakeClient({});
    await rateAbacusAnswer(sb, "m1", -1);
    expect(sb.calls[0]).toMatchObject({ table: "ai_message", op: "update", update: { rating: -1 }, eq: [["id", "m1"]] });
    await rateAbacusAnswer(sb, "m1", null);
    expect(sb.calls[1].update).toEqual({ rating: null });
  });

  it("throws on a failed write", async () => {
    await expect(deleteAbacusConversation(fakeClient({}, { error: "nope" }), "co1", "c1")).rejects.toBeInstanceOf(AbacusHistoryError);
  });
});
