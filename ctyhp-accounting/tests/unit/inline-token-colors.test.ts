import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { cssVariableBlock, flattenTokens, tokenVar, tokenVariable } from "@/lib/design/tokens";

/**
 * A colour written into a screen comes from the page's variables, not from
 * TOKENS.
 *
 * TOKENS holds the light values and nothing else. Written into a style, a
 * light colour stayed light in dark mode: the muted line under list rows read
 * at 2.2:1 (2.70), and some sixty more colours across 23 files did the same,
 * among them red and green amounts, chart bars and the sign-in page's
 * background. tokenVar names the variable, which the dark block redefines.
 */
const ROOT = process.cwd();

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const files = [...sourceFiles(join(ROOT, "app")), ...sourceFiles(join(ROOT, "components"))].map((file) => ({
  path: relative(ROOT, file).replaceAll("\\", "/"),
  source: readFileSync(file, "utf8"),
}));

describe("colours on screens", () => {
  it("finds the screens to check", () => {
    expect(files.length).toBeGreaterThan(150);
  });

  it("never reads the light-only TOKENS object", () => {
    const offenders = files.filter(({ source }) => /\bTOKENS\./.test(source)).map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it("puts a token colour on an SVG shape through its style, which resolves var() in every browser", () => {
    const offenders = files
      .filter(({ source }) => /\b(fill|stroke)=\{(tokenVar|PALETTE)\b/.test(source))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });
});

describe("tokenVar", () => {
  it("names the variable the stylesheet declares, in both themes, for every token", () => {
    const [light, dark] = cssVariableBlock().split(':root[data-theme="dark"]');
    for (const [path] of flattenTokens()) {
      expect(light, path).toContain(`${tokenVariable(path)}:`);
      expect(dark, path).toContain(`${tokenVariable(path)}:`);
    }
  });

  it("is the var() of that variable", () => {
    expect(tokenVar("money.negative")).toBe("var(--ob-money-negative)");
    expect(tokenVar("text.secondary")).toBe("var(--ob-text-secondary)");
  });
});
