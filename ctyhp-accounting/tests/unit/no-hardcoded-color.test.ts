import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Colour belongs in lib/design/tokens.ts and nowhere else.
 *
 * Every hex the migration removed was a hand-copied duplicate of a value the
 * theme already defines, which is how three different reds all came to mean
 * "error". This test guards the finished state directly: no file under app/ or
 * components/ may reintroduce one.
 *
 * Stylesheets are in scope too, and that is not a formality. The first version
 * of this guard walked only .ts and .tsx, which left the easiest way to defeat
 * it wide open — put the colour in a CSS Module beside the component — and one
 * component was already doing exactly that without anyone noticing.
 *
 * The two files below are the colour this wave did NOT convert. They are listed
 * rather than skipped, because debt nobody can see is debt nobody pays.
 *
 * Excluded on purpose, and not listed: lib/client/invoice-pdf.ts and
 * lib/client/report-export.ts. Colours inside a generated PDF or an XLSX cell
 * are not CSS and never derive from the theme.
 */
/**
 * Empty, and that is the point.
 *
 * It held two entries for months: app/globals.css with "225 hex predating the
 * token wave", and WorkAreaOverview.module.css with 84 more, both explained
 * rather than skipped because "debt nobody can see is debt nobody pays". The
 * light/dark conversion is what paid them. Every colour in both files now
 * reads a token.
 *
 * Left as an empty map rather than deleted: the next stylesheet to arrive with
 * colour in it should have to write down why, in the place the last two did.
 */
const ALLOWLIST = new Map<string, string>([]);

/**
 * Built fresh on each use, never shared.
 *
 * A regex literal with the `g` flag carries `lastIndex` between calls, so
 * `.test()` on the same pattern alternates true and false across files and
 * quietly clears half the offenders. This guard exists to be trusted, so it
 * does not reuse one.
 */
const hexPattern = () => /#[0-9a-fA-F]{3,8}\b/;
const ROOT = process.cwd();

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(tsx?|css)$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * The generated `:root` blocks removed.
 *
 * Colour has to be written down somewhere, and after the light/dark
 * conversion that somewhere is lib/design/tokens.ts, emitted into these two
 * blocks. Exempting the blocks rather than the file is what keeps this guard
 * sharp: a hex anywhere else in globals.css still fails, which is the whole
 * point of having converted it.
 */
function withoutTokenBlocks(source: string): string {
  return source.replace(/:root(\[data-theme="dark"\])? \{[^}]*--ob-[^}]*\}/g, "");
}

const files = [...sourceFiles(join(ROOT, "app")), ...sourceFiles(join(ROOT, "components"))];

function relativePath(file: string): string {
  return relative(ROOT, file).replaceAll("\\", "/");
}

describe("hard-coded colour", () => {
  it("finds files to check", () => {
    expect(files.length).toBeGreaterThan(150);
  });

  it("walks stylesheets, not only TypeScript", () => {
    // The bypass this guard missed once. If the walk ever stops matching .css,
    // a component can carry any colour it likes in a module stylesheet.
    expect(files.some((file) => file.endsWith(".css"))).toBe(true);
  });

  it("appears in no file at all", () => {
    const offenders = files
      .map((file) => ({ path: relativePath(file), source: withoutTokenBlocks(readFileSync(file, "utf8")) }))
      .filter(({ path }) => !ALLOWLIST.has(path))
      .filter(({ source }) => hexPattern().test(source))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it("still catches a colour written outside the token blocks", () => {
    // The exemption above is narrow on purpose, and a guard nobody has seen
    // fail is a guard nobody should trust. This proves the hole is exactly
    // the size of the generated blocks and no larger.
    const css = readFileSync(join(ROOT, "app", "globals.css"), "utf8");
    expect(hexPattern().test(withoutTokenBlocks(css))).toBe(false);
    expect(hexPattern().test(withoutTokenBlocks(`${css}\n.rogue { color: #ff0000; }\n`))).toBe(true);
  });

  it("lists no file that has already been converted", () => {
    // Keeps the list honest in the other direction: convert one of these and
    // forget to delete its entry, and this fails rather than leaving a stale
    // record of debt that no longer exists.
    const stale = [...ALLOWLIST.keys()].filter(
      (path) => !hexPattern().test(readFileSync(join(ROOT, path), "utf8")),
    );
    expect(stale).toEqual([]);
  });
});
