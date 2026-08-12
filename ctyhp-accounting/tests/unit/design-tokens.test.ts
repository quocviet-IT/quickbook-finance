import { describe, expect, it } from "vitest";
import { PALETTE } from "@/lib/design/palette";
import { TOKENS, flattenTokens, resolveToken, TEXT_ON_SURFACE_PAIRS } from "@/lib/design/tokens";

describe("design tokens", () => {
  it("resolves every semantic token to a palette entry", () => {
    // Widened on purpose: PALETTE is `as const`, so an inferred Set would be
    // typed to the literal hexes and refuse the plain string a token carries.
    const paletteValues = new Set<string>(Object.values(PALETTE));
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

/** WCAG 2.1 relative luminance. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const linear = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("colour contrast", () => {
  it("meets WCAG AA 4.5:1 for every text-on-surface pair", () => {
    const failures = TEXT_ON_SURFACE_PAIRS.map(([textPath, surfacePath]) => {
      const ratio = contrastRatio(resolveToken(textPath), resolveToken(surfacePath));
      return { pair: `${textPath} on ${surfacePath}`, ratio: Number(ratio.toFixed(2)) };
    }).filter((row) => row.ratio < 4.5);
    expect(failures).toEqual([]);
  });

  it("checks a meaningful number of pairs", () => {
    expect(TEXT_ON_SURFACE_PAIRS.length).toBeGreaterThanOrEqual(10);
  });
});
