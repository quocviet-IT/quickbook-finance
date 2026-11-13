import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { theme as antdTheme } from "antd";
import { antdThemeTokens, resolveToken, TEXT_ON_SURFACE_PAIRS, TOKENS, type TokenPath } from "@/lib/design/tokens";
import { RELEASES } from "@/lib/domain/changelog";

/**
 * 3.0.30: what the UI audit of 13 November 2026 still measured below 4.5:1, or
 * without a name, when it was run again on 3.0.28 — the primary button in the
 * dark theme, every placeholder, small print, the preset tags on some seventy
 * screens, links told apart by colour alone, and unnamed pickers and switches.
 *
 * The colours are checked as Ant Design actually derives them from this app's
 * theme, not as the token file declares them: the dark primary the button is
 * filled with is Ant Design's #29b7a5, not the token's #2dd4bf.
 */
const ROOT = process.cwd();
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8").replace(/\r\n/g, "\n");

function luminance(hex: string): number {
  const h = hex.replace("#", "").slice(0, 6);
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The design token set Ant Design derives for one theme, as the app configures it. */
function derived(theme: "light" | "dark") {
  const { token, components } = antdThemeTokens(theme);
  const map = antdTheme.getDesignToken({
    algorithm: theme === "dark" ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token,
  }) as unknown as Record<string, string>;
  return { map, components };
}

const PRESETS = ["blue", "purple", "cyan", "green", "magenta", "red", "orange", "yellow", "volcano", "geekblue", "lime", "gold"];
const TAG_TOKENS = TOKENS.tag;

describe("each preset tag is lettered from the app's tokens (3.0.30)", () => {
  // Ant Design re-derives its palettes from their seeds, so a step-7 token given
  // to it never reaches the page: the override has to be CSS, on the tag itself.
  const css = read("app", "globals.css");
  for (const hue of Object.keys(TAG_TOKENS)) {
    it(hue, () => {
      expect(css).toContain(`.ant-tag.ant-tag-${hue} {\n  --ant-${hue}-7: var(--ob-tag-${hue});\n}`);
    });
  }
});

describe("contrast in both themes (3.0.30)", () => {
  for (const theme of ["light", "dark"] as const) {
    const { map, components } = derived(theme);

    it(`${theme}: a primary button's label reads on its fill, at rest, under the pointer and pressed`, () => {
      const ink = (components.Button as { primaryColor: string }).primaryColor;
      for (const fill of [map.colorPrimary, map.colorPrimaryHover, map.colorPrimaryActive]) {
        expect(ratio(ink, fill), `${ink} on ${fill}`).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`${theme}: every preset tag colour reads on its own tint`, () => {
      // A hue with a `tag` token is lettered in it (globals.css); the rest keep Ant Design's step 7.
      const letters = (p: string) =>
        p in TAG_TOKENS ? resolveToken(`tag.${p}` as TokenPath, theme) : map[`${p}7`];
      const failing = PRESETS.map((p) => ({ p, r: ratio(letters(p), map[`${p}1`]) }))
        .filter((x) => x.r < 4.5)
        .map((x) => `${x.p} ${x.r.toFixed(2)}`);
      expect(failing).toEqual([]);
    });

    it(`${theme}: placeholders and Ant Design's tertiary grey are the app's own small print, which reads`, () => {
      const faint = resolveToken("text.faint", theme);
      expect(map.colorTextPlaceholder).toBe(faint);
      expect(map.colorTextTertiary).toBe(faint);
      for (const surface of ["surface.page", "surface.card", "surface.muted"] as const) {
        expect(ratio(faint, resolveToken(surface, theme)), `${theme} faint on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  it("holds the new pairs in the token file's own checked list", () => {
    const pairs = TEXT_ON_SURFACE_PAIRS.map(([t, s]) => `${t} on ${s}`);
    expect(pairs).toEqual(expect.arrayContaining(["intent.onPrimary on intent.primary", "text.faint on surface.page", "text.caption on surface.card"]));
  });
});

describe("telling a link from the words around it (3.0.30)", () => {
  const css = read("app", "globals.css");
  it("underlines a link inside a sentence, and only there", () => {
    expect(css).toMatch(/:is\(p, li, dd, \.ant-typography, [^)]*\) a:not\(\.ant-btn\) \{\n  text-decoration: underline;/);
    // A name in a table, the menu, a button: no underline.
    expect(css).toMatch(/^a \{\n  text-decoration: none;\n\}/m);
  });
});

describe("something to press is big enough (3.0.30)", () => {
  const css = read("app", "globals.css");
  it("gives a small link button 24px", () => {
    expect(css).toMatch(/\.ant-btn\.ant-btn-variant-link\.ant-btn-sm \{\n  min-height: 24px;/);
    expect(read("app", "(app)", "settings", "periods", "PeriodsClient.tsx")).toMatch(/<ul className="accounting-link-list">/);
  });
});

describe("every control has a name (3.0.30)", () => {
  it("names Banking's account pickers after the line they code", () => {
    expect(read("app", "(app)", "banking", "CategoriseCell.tsx")).toMatch(/aria-label=\{`\$\{placeholder\.replace/);
    expect(read("app", "(app)", "banking", "BankTransactionsTable.tsx")).toMatch(/lineLabel=\{row\.transaction\.description\}/);
  });

  it("names the filters, the year, the opening balance pickers and the rule switches", () => {
    expect(read("app", "(app)", "fixed-assets", "FixedAssetsClient.tsx")).toMatch(/aria-label="Filter assets by status"/);
    const recurring = read("app", "(app)", "recurring", "RecurringClient.tsx");
    expect(recurring).toMatch(/aria-label="Filter by transaction type"/);
    expect(recurring).toMatch(/aria-label="Filter by status"/);
    expect(read("app", "(app)", "settings", "periods", "PeriodsClient.tsx")).toMatch(/<InputNumber aria-label="Fiscal year"/);
    expect(read("app", "(app)", "opening-balances", "OpeningBalancesClient.tsx")).toMatch(/aria-label=\{`Account, line \$\{index \+ 1\}`\}/);
    expect(read("app", "(app)", "banking", "rules", "RulesClient.tsx")).toMatch(/aria-label=\{`Rule for “\$\{rule\.matchText\}”`\}/);
  });

  it("gives the cash flow bars a role their name is allowed on", () => {
    expect(read("components", "charts", "FinancialCharts.tsx")).toMatch(/className="cash-flow-component__scale"[\s\S]{0,200}role="img"/);
  });
});

describe("the release note (3.0.30)", () => {
  it("says what got easier to read", () => {
    const release = RELEASES.find((candidate) => candidate.version === "3.0.30");
    expect(release).toBeDefined();
    const said = (release?.changes ?? []).map((change) => `${change.title} ${change.detail ?? ""}`).join(" ");
    expect(said).toMatch(/dark/i);
    expect(said).toMatch(/placeholder/i);
    expect(said).toMatch(/underline/i);
  });
});
