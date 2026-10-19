import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { RUN_REPORT } from "@/components/reports/ReportBar";

/**
 * Every report page has the one report bar (components/reports/ReportBar.tsx),
 * through SimpleReport or on its own.
 *
 * The UI review of 2026-10-17 found:
 * - the run button called Run, Run report, Run review, Run statement and Apply;
 * - pages that opened onto an empty screen with no word of what to do;
 * - dates as a preset with labelled pickers on one page, a bare range that
 *   opened empty on the next, an unlabelled single date on a third;
 * - exports that were Copy, CSV, PDF, Excel and Print on some pages, CSV alone
 *   on others, and nothing on Cash Flow, the statements or the General Ledger.
 *
 * This test is the boundary for each of those shapes.
 */
const ROOTS = ["app/(app)/reports", "components/reports"];
/** Not report pages: the saved-files list, a redirect, and the shared pieces themselves. */
const NOT_REPORTS = [
  /^app\/\(app\)\/reports\/saved\//,
  /^app\/\(app\)\/reports\/beancount\//,
  /^components\/reports\/ReportBar\.tsx$/,
  /^components\/reports\/ReportExportButtons\.tsx$/,
];

function sourceFiles(dir: string, root: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, root, out);
    else if (/\.tsx$/.test(entry)) out.push(relative(root, full).replaceAll("\\", "/"));
  }
  return out;
}

describe("the report bar", () => {
  const root = process.cwd();
  const files = ROOTS.flatMap((dir) => sourceFiles(join(root, dir), root)).filter(
    (file) => !NOT_REPORTS.some((skip) => skip.test(file)),
  );
  const sources = new Map(files.map((file) => [file, readFileSync(join(root, file), "utf8")]));
  const offenders = (pattern: RegExp) =>
    [...sources].flatMap(([file, source]) =>
      source
        .split("\n")
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => !/^\s*(\/\/|\*|\/\*)/.test(line) && pattern.test(line))
        .map(({ line, index }) => `${file}:${index + 1}  ${line.trim()}`),
    );

  it("finds the files it is supposed to be guarding", () => {
    expect(files).toContain("app/(app)/reports/ap-aging/ApAgingClient.tsx");
    expect(files).toContain("components/reports/SimpleReport.tsx");
  });

  it("calls the run button one thing, Run report", () => {
    expect(RUN_REPORT).toBe("Run report");
    // A label written in a page is how five names came about.
    // Inline (`>Run<`) or on a line of its own inside the button.
    expect(offenders(/>\s*(Run|Run report|Run review|Run statement|Apply)\s*<|^\s*(Run|Run report|Run review|Run statement|Apply)\s*$/)).toEqual([]);
  });

  it("dates every report with the shared control, not a bare range picker", () => {
    expect(offenders(/DatePicker\.RangePicker|<RangePicker\b/)).toEqual([]);
  });

  it("exports through the shared actions, not a page's own button", () => {
    expect(offenders(/import ReportExportButtons from/)).toEqual([]);
    expect(offenders(/["'>]\s*Export CSV\s*["'<]/)).toEqual([]);
  });

  it("puts every report page's bar together from the shared pieces", () => {
    const clients = files.filter((file) => /^app\/\(app\)\/reports\/[^/]+\/[A-Z][A-Za-z0-9]*Client\.tsx$/.test(file));
    const bespoke = clients.filter((file) => {
      const source = sources.get(file)!;
      return !/<SimpleReport\b|<ReportBar\b|<OpenDocumentsReport\b|<PartyBalancesReport\b|<PartyActivityReport\b|<CashForecastReport\b/.test(source);
    });
    expect(bespoke).toEqual([]);
  });
});
