import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * No table asks for horizontal scrolling.
 *
 * `components/ui/DataTable.tsx` handed Ant Design `scroll={{ x: "max-content" }}`
 * for every one of 38 tables, which is why one reader filed the same complaint
 * on four different screens between 2026-08-01 and 2026-08-22: each fix landed
 * on the screen that was reported, and the default kept producing the next one.
 *
 * This test is the boundary. A table that genuinely is a matrix — one whose
 * column count is data rather than design — goes on the list below with its
 * reason, and says so at its own call site.
 */
/**
 * Empty from 2026-09-28, when the two per-period statements that were matrices
 * (PnlTrendView, BalanceSheetTrendView) became columns of the statement table,
 * a plain table that scrolls inside its own box, until 1.83 moved the saved
 * file preview onto DataTable. A table added here needs its reason and
 * `fit={false}` at its call site.
 */
const MATRIX = new Map<string, string>([
  [
    "components/statement-file/StatementFileViewer.tsx",
    "A saved CSV shown as it arrived: its columns are the file's own, as many as the file has, so they cannot be designed to fit.",
  ],
]);

/**
 * Three more were candidates and none of them qualified, which is the point of
 * checking rather than listing: the permission grid reaches for Ant Design's
 * Table directly, so this boundary never covered it (see
 * tests/unit/table-adoption.test.ts), and the budget view turned out to pass
 * no `scroll.x` at all. The saved-report viewer was the third; since 1.83 its
 * preview is the matrix above.
 */

/** The implementation itself declares the default; it is exempt by path. */
const OWN_IMPLEMENTATION = new Set(["components/ui/DataTable.tsx"]);

function sourceFiles(dir: string, root: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, root, out);
    else if (entry.endsWith(".tsx")) out.push(relative(root, full).replaceAll("\\", "/"));
  }
  return out;
}

describe("the horizontal scroll boundary", () => {
  const root = process.cwd();
  const files = [
    ...sourceFiles(join(root, "app"), root),
    ...sourceFiles(join(root, "components"), root),
  ];

  it("finds the files it is supposed to be guarding", () => {
    // A broken walk would pass this suite by checking nothing at all.
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain("app/(app)/banking/BankTransactionsTable.tsx");
  });

  it("has no table asking for a horizontal scroll outside the matrix list", () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (OWN_IMPLEMENTATION.has(file) || MATRIX.has(file)) continue;
      const source = readFileSync(join(root, file), "utf8");
      if (!/DataTable|ReportTable/.test(source)) continue;
      // `x: "max-content"`, `x: 1450`, `x: true` — every shape that turns
      // sideways scrolling back on.
      if (/scroll=\{\{[^}]*\bx\s*:/.test(source)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it("only exempts a table that is really a matrix, and says why", () => {
    for (const [file, reason] of MATRIX) {
      expect(readFileSync(join(root, file), "utf8"), file).toMatch(/fit=\{false\}/);
      expect(reason.length, file).toBeGreaterThan(20);
    }
  });
});
