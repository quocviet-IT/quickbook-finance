import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  RUN_TABLE_MIN_WIDTH,
  RUN_TABLE_READ_FLOOR,
  RUN_TABLE_WIDTH,
} from "@/app/(app)/banking/reconcile/from-files/run-table-columns";

/**
 * The statements table of Reconcile > From statement files on a phone: its
 * column widths are one set of figures, and the stylesheet draws with them.
 */
const DIR = join(process.cwd(), "app", "(app)", "banking", "reconcile", "from-files");
const read = (name: string) => readFileSync(join(DIR, name), "utf8").replace(/\r\n/g, "\n");
const css = read("run-table.module.css");
const phone = css.slice(css.indexOf("@media"));

describe("the statements table on a phone", () => {
  it("is held to its measured widths plus Read's floor", () => {
    const measured = Object.values(RUN_TABLE_WIDTH).reduce((a, b) => a + b, 0);
    expect(RUN_TABLE_MIN_WIDTH).toBe(measured + RUN_TABLE_READ_FLOOR);
    // Read has room for its tag and proof sentence on a few lines, not a word to a line.
    expect(RUN_TABLE_READ_FLOOR).toBeGreaterThanOrEqual(320);
  });

  it("draws with the figures in run-table-columns.ts", () => {
    expect(phone).toContain(`min-width: ${RUN_TABLE_MIN_WIDTH}px;`);
    const columns = ["file", "period", "opening", "closing"] as const;
    columns.forEach((key, i) => {
      expect(phone, key).toContain(
        `.runTable :global(.ant-table-thead) > tr > th:nth-child(${i + 1}) {\n    width: ${RUN_TABLE_WIDTH[key]}px;`,
      );
    });
  });

  it("changes nothing at 1280 and uses no colour", () => {
    expect(css.slice(0, css.indexOf("@media")).replace(/\/\*[\s\S]*?\*\//g, "")).not.toContain("{");
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|\bcolor\s*:/);
  });

  it("lets Read wrap on a phone, where every other DataTable cell keeps to one line", () => {
    const media = css.slice(css.indexOf("@media"));
    expect(media).toMatch(/\.runTable :global\(\.ant-table-tbody\) > tr > td:nth-child\(5\) \{\s*white-space: normal;\s*\}/);
  });

  it("puts the table under its rule and sets no scroll.x", () => {
    const client = read("FromFilesClient.tsx");
    expect(client).toContain("<div className={styles.runTable}>");
    expect(client).not.toMatch(/scroll=\{\{[^}]*\bx\s*:/);
  });
});
