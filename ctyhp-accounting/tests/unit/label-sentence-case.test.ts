import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 3.0.45, audit items L7 and T1. Several kinds of label copied the
 * prototype's small tracked capitals (10–11px, `text-transform: uppercase`,
 * letter-spacing up to 0.1em): a report's basis line ("ACCRUAL BASIS · USD"),
 * the figures above a report, report column headings, the Settings group
 * titles, the Chart of Accounts headings, and the open-item statement. The
 * owner chose sentence case at 12px, as QuickBooks writes "Accrual basis".
 * Section rows in a report are 13px bold, the size of the rows under them.
 */
// A Windows checkout has CRLF line endings; CI's has LF.
const read = (...parts: string[]) =>
  readFileSync(join(process.cwd(), ...parts), "utf8").replace(/\r\n/g, "\n");

function filesUnder(dir: string, ext: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === "node_modules" ? [] : filesUnder(full, ext);
    return ext.test(name) ? [full] : [];
  });
}

function rule(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, selector).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("}", start));
}

describe("labels are written in sentence case", () => {
  it("no stylesheet or component turns text into capitals", () => {
    const root = process.cwd();
    const offenders = [
      ...filesUnder(join(root, "app"), /\.css$/),
      ...filesUnder(join(root, "components"), /\.css$/),
    ].filter((file) => /text-transform:\s*uppercase/.test(readFileSync(file, "utf8")));
    const inline = [
      ...filesUnder(join(root, "app"), /\.tsx$/),
      ...filesUnder(join(root, "components"), /\.tsx$/),
    ].filter((file) => /textTransform:\s*["']uppercase["']/.test(readFileSync(file, "utf8")));
    expect([...offenders, ...inline].map((file) => relative(root, file))).toEqual([]);
  });

  it("prints the report's basis, its figures' labels and its column headings at 12px", () => {
    const css = read("components", "reports", "report-paper.module.css");
    for (const selector of [".basis", ".statLabel", ".eyebrow", ".rpt th", ".detTable th"]) {
      const body = rule(css, selector);
      expect(body, selector).toContain("font-size: 12px;");
      expect(body, selector).not.toContain("letter-spacing");
    }
    expect(rule(css, ".rSection td")).toContain("font-size: 13px;");
  });

  it("keeps the labels' own words in sentence case now that capitals no longer hide them", () => {
    expect(read("components", "reports", "ReportPaper.tsx")).toContain('basis = "Accrual basis"');
    expect(read("components", "charts", "FinancialCharts.tsx")).toContain("<small>Net change</small>");
  });
});
