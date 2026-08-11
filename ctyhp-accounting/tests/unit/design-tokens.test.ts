import { describe, expect, it } from "vitest";
import { PALETTE } from "@/lib/design/palette";
import { TOKENS, flattenTokens, resolveToken } from "@/lib/design/tokens";

describe("design tokens", () => {
  it("resolves every semantic token to a palette entry", () => {
    const paletteValues = new Set(Object.values(PALETTE));
    const orphans = flattenTokens(TOKENS)
      .filter(([, value]) => !paletteValues.has(value))
      .map(([path, value]) => `${path} → ${value}`);
    expect(orphans).toEqual([]);
  });

  it("resolves a token by its dotted path", () => {
    expect(resolveToken("money.negative")).toBe(PALETTE.red700);
    expect(resolveToken("intent.primary")).toBe(PALETTE.teal700);
  });

  it("throws on an unknown token path rather than returning undefined", () => {
    expect(() => resolveToken("money.sideways")).toThrow(/money\.sideways/);
  });
});
