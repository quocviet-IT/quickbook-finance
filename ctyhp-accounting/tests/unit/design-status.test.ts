import { isValidElement } from "react";
import { describe, expect, it } from "vitest";
import { STATUS_KEYS, statusToken } from "@/lib/design/status";
import { TOKENS } from "@/lib/design/tokens";

describe("status tokens", () => {
  it("returns a colour, an icon and a label for every status", () => {
    for (const key of STATUS_KEYS) {
      const token = statusToken(key);
      expect(token.color).toMatch(/^#[0-9a-f]{6}$/i);
      // Not `toBeTruthy`: under environment "node" any non-null value passes
      // that, including a stray string, so it would prove nothing.
      expect(isValidElement(token.icon)).toBe(true);
      expect(token.label.length).toBeGreaterThan(0);
    }
  });

  it("gives each status a distinct icon, which is what separates void from draft", () => {
    // Void and draft deliberately share text.secondary — a document that is
    // off the ledger reads the same either way. The icon and the label are
    // what tell them apart, so two statuses sharing an icon would leave a
    // reader with no way to distinguish them at all.
    const types = STATUS_KEYS.map((key) => {
      const icon = statusToken(key).icon;
      if (!isValidElement(icon)) throw new Error(`Status ${key} carries no icon element`);
      return icon.type;
    });
    expect(new Set(types).size).toBe(STATUS_KEYS.length);
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
