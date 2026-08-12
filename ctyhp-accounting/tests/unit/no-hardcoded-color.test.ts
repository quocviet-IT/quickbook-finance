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
const ALLOWLIST = new Map<string, string>([
  [
    "app/globals.css",
    "225 hex predating the token wave, including #0f766e thirty times over — " +
      "the same hand-copied duplication the wave removed from TSX. Converting " +
      "3,300 lines of stylesheet is its own piece of work with real visual " +
      "regression risk, so it was left whole rather than done by halves.",
  ],
  [
    "components/work-areas/WorkAreaOverview.module.css",
    "84 hex, a dozen of which are in neither the palette nor the tokens. Goes " +
      "with the globals.css conversion.",
  ],
]);

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

  it("appears in no file outside the two stylesheets still to be converted", () => {
    const offenders = files
      .map((file) => ({ path: relativePath(file), source: readFileSync(file, "utf8") }))
      .filter(({ path }) => !ALLOWLIST.has(path))
      .filter(({ source }) => hexPattern().test(source))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
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
