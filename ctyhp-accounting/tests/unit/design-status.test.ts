import { describe, expect, it } from "vitest";
import { STATUS_KEYS, statusToken } from "@/lib/design/status";
import { TOKENS } from "@/lib/design/tokens";

describe("status tokens", () => {
  it("returns a colour, an icon and a label for every status", () => {
    for (const key of STATUS_KEYS) {
      const token = statusToken(key);
      expect(token.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(token.icon).toBeTruthy();
      expect(token.label.length).toBeGreaterThan(0);
    }
  });

  it("gives overdue the danger colour and void a muted one", () => {
    expect(statusToken("overdue").color).toBe(TOKENS.intent.danger);
    expect(statusToken("void").color).toBe(TOKENS.text.secondary);
  });

  it("gives each status a distinct label so colour is never the only signal", () => {
    const labels = STATUS_KEYS.map((key) => statusToken(key).label);
    expect(new Set(labels).size).toBe(STATUS_KEYS.length);
  });
});
