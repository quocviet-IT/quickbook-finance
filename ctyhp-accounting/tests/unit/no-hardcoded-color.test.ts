import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Colour belongs in lib/design/tokens.ts and nowhere else.
 *
 * Every hex below is a hand-copied duplicate of a value the theme already
 * defines, which is how three different reds all came to mean "error". The
 * allowlist is the work still outstanding: it shrinks with each migration
 * batch and is deleted with the last one. A file may not be added back.
 *
 * Scope is app/ and components/. lib/client/invoice-pdf.ts and
 * lib/client/report-export.ts are excluded on purpose: colours inside a
 * generated PDF are not CSS and do not derive from the theme.
 */
const ALLOWLIST = new Set([
  "components/feedback/ReportDialog.tsx",
  "app/(auth)/login/page.tsx",
  "app/(app)/settings/import/ImportPreviewPanel.tsx",
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
    else if (entry.endsWith(".tsx") || entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

const files = [...sourceFiles(join(ROOT, "app")), ...sourceFiles(join(ROOT, "components"))];

describe("hard-coded colour", () => {
  it("finds files to check", () => {
    expect(files.length).toBeGreaterThan(150);
  });

  it("appears in no file outside the shrinking allowlist", () => {
    const offenders = files
      .map((file) => ({ path: relative(ROOT, file).replaceAll("\\", "/"), source: readFileSync(file, "utf8") }))
      .filter(({ path }) => !ALLOWLIST.has(path))
      .filter(({ source }) => hexPattern().test(source))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it("lists no file that has already been cleaned", () => {
    const stale = [...ALLOWLIST].filter((path) => {
      const source = readFileSync(join(ROOT, path), "utf8");
      return !hexPattern().test(source);
    });
    expect(stale).toEqual([]);
  });
});
