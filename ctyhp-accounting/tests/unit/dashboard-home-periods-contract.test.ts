import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * What the Dashboard's third release (3.0.41) must keep, read from its
 * source: more periods, a year of cash flow, a forecast up to 90 days ahead,
 * and each card's choice kept for the person. Line endings are normalized:
 * this repository is checked out with CRLF on Windows, and a pattern spanning
 * lines must not depend on that.
 */
const ROOT = process.cwd();

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");
}

const profit = read("components/dashboard-home/ProfitWidgets.tsx");
const css = read("components/dashboard-home/dashboard-home.module.css");

describe("more periods on Profit and loss, Expenses and Sales", () => {
  it("says a period that could not be read by name, with Retry, and keeps the select in the head", () => {
    const missing = profit.match(/if \(!period\) \{[\s\S]*?<Widget title="([^"]+)" extra=\{extra\} footer=\{footer\}>\s*<Unavailable reason=\{periodUnread\(key\)\} \/>/g) ?? [];
    expect(missing).toHaveLength(3);
    for (const title of ["Profit and loss", "Expenses", "Sales"]) expect(missing.some((block) => block.includes(`title="${title}"`)), title).toBe(true);
    // Unavailable carries the Retry button that reads the page again.
    expect(read("components/dashboard-home/Widget.tsx")).toMatch(/export function Unavailable[\s\S]*?<RetryButton \/>/);
  });

  it("captions the bars as the last six months, whatever the period chosen", () => {
    expect(profit).toContain("<p className={styles.caption}>Income and expenses by month, last 6 months</p>");
    expect(profit).toContain("<p className={styles.caption}>Sales by month, last 6 months</p>");
  });

  it("makes the select wide enough for Last 12 months", () => {
    expect(css).toMatch(/\.period \{\s*width: 148px;\s*\}/);
  });
});
