import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Source-contract tests: the route talks to the database and the provider, so
// what is pinned here is its shape and order, read as text (CRLF-normalised).
const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8").replace(/\r\n/g, "\n");
const route = read("app/api/ask/route.ts");
const actions = read("components/abacus/actions.ts");

describe("POST /api/ask (Abacus)", () => {
  it("no longer reads earlier turns from the browser", () => {
    expect(route).not.toMatch(/body\??\.history/);
    expect(route).not.toContain("readHistory");
    expect(route).not.toContain("HISTORY_TURNS");
  });

  it("reads earlier turns from the person's history, parses the answer and saves the exchange", () => {
    expect(route).toContain("recentAbacusTurns(");
    expect(route).toContain("parseAbacusAnswer(");
    expect(route).toContain("saveAbacusExchange(");
  });

  it("validates the conversation id as a UUID", () => {
    expect(route).toContain("conversationId");
    expect(route).toMatch(/UUID\.test\(rawConversation\)/);
  });

  it("counts the question before it asks the provider, and reads history before asking", () => {
    const quota = route.indexOf("takeAiTurn()");
    const earlier = route.indexOf("recentAbacusTurns(");
    const ask = route.indexOf("askProvider(");
    const save = route.indexOf("saveAbacusExchange(");
    expect(quota).toBeGreaterThan(-1);
    expect(quota).toBeLessThan(earlier);
    expect(earlier).toBeLessThan(ask);
    expect(ask).toBeLessThan(save);
  });

  it("answers 404 for a conversation that is gone and keeps the existing error statuses", () => {
    expect(route).toContain("status: 404");
    for (const status of ["401", "403", "400", "503", "502", "500"]) {
      expect(route).toContain(`status: ${status}`);
    }
    expect(route).toContain('allowance === "limit" ? 429 : 503');
  });

  it("still returns the answer when saving fails, and says it was not saved", () => {
    expect(route).toMatch(/catch \(err\) \{[^}]*console\.error\("saving the exchange failed:"/);
    expect(route).toContain("saved: saved !== null");
    expect(route).toContain("messageId: saved?.messageId ?? null");
  });

  it("returns the shape the panel reads", () => {
    for (const key of ["answer: parsed.body", "source: parsed.source", "covered: parsed.covered", "conversationId:", "askedAt:"]) {
      expect(route).toContain(key);
    }
  });
});

describe("Abacus server actions", () => {
  it("is a server-actions module exposing the five actions", () => {
    expect(actions.startsWith('"use server";')).toBe(true);
    for (const name of [
      "listAbacusConversationsAction",
      "readAbacusConversationAction",
      "deleteAbacusConversationAction",
      "clearAbacusHistoryAction",
      "rateAbacusAnswerAction",
    ]) {
      expect(actions).toContain(`export async function ${name}(`);
    }
  });

  it("resolves the person and company on the server, and never throws to the client", () => {
    expect(actions).toContain("resolveActiveCompany()");
    expect(actions).toContain("sb.auth.getUser()");
    expect(actions).toContain("return { ok: false, error: FAILED }");
  });

  it("validates ids as UUIDs and the rating as -1, 1 or null", () => {
    expect(actions).toContain("UUID.test(id)");
    expect(actions).toContain("UUID.test(messageId)");
    expect(actions).toContain("rating !== -1 && rating !== 1 && rating !== null");
  });
});
