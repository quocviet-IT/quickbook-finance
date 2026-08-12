import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PALETTE } from "@/lib/design/palette";
import { TOKENS, antdThemeTokens, cssVariableBlock, flattenTokens, resolveToken, TEXT_ON_SURFACE_PAIRS } from "@/lib/design/tokens";

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

describe("Ant Design theme", () => {
  it("derives its colours from the tokens", () => {
    const theme = antdThemeTokens();
    expect(theme.token.colorPrimary).toBe(resolveToken("intent.primary"));
    expect(theme.token.colorError).toBe(resolveToken("intent.danger"));
    expect(theme.components.Layout.siderBg).toBe(resolveToken("surface.sider"));
  });

  it("leaves no literal colour in providers.tsx", () => {
    const source = readFileSync(join(process.cwd(), "app", "providers.tsx"), "utf8");
    expect(source.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
  });

  it("keeps the theme settings that are not colours and so live only there", () => {
    const source = readFileSync(join(process.cwd(), "app", "providers.tsx"), "utf8");
    // Dimensions and typography are deliberately outside antdThemeTokens(),
    // which governs colour alone. That leaves providers.tsx as their only
    // home, so a rewrite can drop one and nothing else notices: moving the
    // theme onto tokens silently lost headerHeight and every page rendered
    // fine with the wrong header height.
    for (const setting of [
      "borderRadius: 8",
      "fontSize: 14",
      "wireframe: false",
      "headerHeight: 56",
      "borderRadiusLG: 12",
      "fontFamily: SANS",
    ]) {
      expect(source).toContain(setting);
    }
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
      // Compare the true ratio and round only for the message. Rounding first
      // would let a pair at 4.4951 read as 4.50 and pass, quietly lowering the
      // one threshold this test exists to hold.
      return { pair: `${textPath} on ${surfacePath}`, ratio, shown: ratio.toFixed(2) };
    }).filter((row) => row.ratio < 4.5);
    expect(failures).toEqual([]);
  });

  it("checks a meaningful number of pairs", () => {
    expect(TEXT_ON_SURFACE_PAIRS.length).toBeGreaterThanOrEqual(10);
  });
});

describe("CSS custom properties", () => {
  it("names every token as --ob-group-name", () => {
    const block = cssVariableBlock();
    expect(block).toContain("--ob-money-negative: #b91c1c;");
    expect(block).toContain("--ob-intent-primary: #0f766e;");
    expect(block.startsWith(":root {")).toBe(true);
    expect(block.endsWith("}\n")).toBe(true);
  });

  it("matches the block committed in globals.css, value for value", () => {
    const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");
    // Newlines are normalised before comparing. This repository is developed on
    // Windows with core.autocrlf=true, so a fresh clone rewrites globals.css
    // with CRLF while the emitter always produces \n — and the drift this guard
    // exists to catch is a changed colour, not a changed line ending. The same
    // platform difference has already broken tests here twice.
    expect(css.replace(/\r\n/g, "\n")).toContain(cssVariableBlock());
  });
});
