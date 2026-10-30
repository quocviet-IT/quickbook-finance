import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every list goes through DataTable or ReportTable.
 *
 * A screen reaching for Ant Design's `Table` directly is how 61 tables ended up
 * with no pagination, 173 hand-written alignments and 25 different ways of
 * printing money. There was an allowlist here of the screens still to move:
 * 49 on 2026-08-14, 37 after the first batch of everyday screens (2.75), and
 * none since 2.91, when the last 37 moved and the list was deleted. A new raw
 * table now fails outright; there is no list to add it to.
 *
 * `components/ui/DataTable.tsx` and `components/ui/ReportTable.tsx` are the
 * implementations and are exempt by path.
 */
const OWN_IMPLEMENTATION = new Set([
  "components/ui/DataTable.tsx",
  "components/ui/ReportTable.tsx",
]);

/**
 * Matches `<Table `, `<Table>`, `<Table/>`, `<Table` at end of line, the
 * generic `<Table<Row>` this codebase mostly writes, and `<Table.Summary` —
 * but not `<TableOutlined`, which is an icon. A summary row goes through
 * ReportTable's SummaryRow and SummaryCell. Built fresh on each call: a `/g`
 * regex carries `lastIndex` between `.test()` calls and would report every
 * other file clean.
 */
function tablePattern(): RegExp {
  return /<Table(?!\w)/;
}

const ROOT = process.cwd();

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsxFiles(full));
    else if (entry.endsWith(".tsx")) out.push(full);
  }
  return out;
}

const files = [...tsxFiles(join(ROOT, "app")), ...tsxFiles(join(ROOT, "components"))].map(
  (file) => ({
    path: relative(ROOT, file).replaceAll("\\", "/"),
    source: readFileSync(file, "utf8"),
  }),
);

describe("table adoption", () => {
  it("finds files to check", () => {
    expect(files.length).toBeGreaterThan(150);
    // A broken walk would pass by checking nothing; these two must be in it.
    expect(files.map((file) => file.path)).toEqual(expect.arrayContaining([...OWN_IMPLEMENTATION]));
  });

  it("tells a table apart from the icon of one", () => {
    // The two mistakes this guard exists to avoid making itself.
    expect(tablePattern().test("<Table<InvoiceRow>")).toBe(true);
    expect(tablePattern().test("<Table\n  columns={cols}")).toBe(true);
    expect(tablePattern().test("<Table />")).toBe(true);
    expect(tablePattern().test("<Table.Summary.Row>")).toBe(true);
    expect(tablePattern().test("<TableOutlined />")).toBe(false);
  });

  it("renders Ant Design's Table nowhere outside DataTable and ReportTable", () => {
    const offenders = files
      .filter(({ path }) => !OWN_IMPLEMENTATION.has(path))
      .filter(({ source }) => tablePattern().test(source))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });
});
