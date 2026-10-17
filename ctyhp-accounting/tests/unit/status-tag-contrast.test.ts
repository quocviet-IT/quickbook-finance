import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveToken, type ThemeName, type TokenPath } from "@/lib/design/tokens";
import { COLUMN } from "@/lib/design/table-metrics";

/**
 * A status tag writes its word in the tone's colour on a tint of the same
 * colour (app/globals.css, .status-tag). The tint is mixed over whatever is
 * behind it, so the word is checked on the tint laid over both surfaces a tag
 * sits on, in both themes, at the WCAG AA 4.5:1 its text needs.
 */
const TONE_COLOR: Record<string, TokenPath> = {
  positive: "intent.success",
  neutral: "intent.info",
  warning: "intent.warning",
  danger: "intent.danger",
  muted: "text.secondary",
};

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

function luminance([r, g, b]: number[]): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: number[], b: number[]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** color-mix(in srgb, tone N%, transparent) laid over a surface. */
const tint = (tone: number[], surface: number[], share: number) =>
  tone.map((c, i) => c * share + surface[i] * (1 - share));

/** The two mixes the stylesheet declares: the tint behind the word, and the word's step toward the heading colour. */
function mixes(): { tint: number; word: number } {
  const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");
  const block = css.slice(css.indexOf(".status-tag {"), css.indexOf("}", css.indexOf(".status-tag {")));
  const tintMatch = /background: color-mix\(in srgb, var\(--status-tone\) (\d+)%, transparent\)/.exec(block);
  const wordMatch = /\bcolor: color-mix\(in srgb, var\(--status-tone\) (\d+)%, var\(--ob-text-heading\)\)/.exec(block);
  if (!tintMatch || !wordMatch) throw new Error("the status tag's colours were not found in globals.css");
  return { tint: Number(tintMatch[1]) / 100, word: Number(wordMatch[1]) / 100 };
}

describe("a status tag in a column narrower than its word", () => {
  // At 104px the status column left "Partially paid" a pixel past the tag's
  // right border, and "Partially received" 23px past it.
  const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");
  const rule = (selector: string) => css.slice(css.indexOf(`${selector} {`), css.indexOf("}", css.indexOf(`${selector} {`)));

  it("keeps its border whole and shortens the word inside it", () => {
    expect(rule(".status-tag")).toMatch(/max-width: 100%;/);
    expect(rule(".status-tag")).toMatch(/overflow: hidden;/);
    expect(rule(".status-tag__label")).toMatch(/text-overflow: ellipsis;/);
    expect(rule(".status-tag__label")).toMatch(/min-width: 0;/);
  });

  it("has a column wide enough for the longest shared word, Partially received", () => {
    // A 93px word and 31px of icon, padding and border, measured on the page, plus the cell's 8px either side.
    expect(COLUMN.STATUS).toBeGreaterThanOrEqual(140);
  });
});

describe("a status tag's word on its own tint", () => {
  const { tint: share, word } = mixes();
  for (const theme of ["light", "dark"] as ThemeName[]) {
    for (const surface of ["surface.card", "surface.page"] as TokenPath[]) {
      it(`reads at 4.5:1 or better for every tone on ${surface} in ${theme}`, () => {
        const ground = rgb(resolveToken(surface, theme));
        const failing = Object.entries(TONE_COLOR)
          .map(([tone, path]) => {
            const color = rgb(resolveToken(path, theme));
            const text = tint(color, rgb(resolveToken("text.heading", theme)), word);
            return { tone, ratio: Math.floor(contrast(text, tint(color, ground, share)) * 100) / 100 };
          })
          .filter((row) => row.ratio < 4.5);
        expect(failing).toEqual([]);
      });
    }
  }
});
