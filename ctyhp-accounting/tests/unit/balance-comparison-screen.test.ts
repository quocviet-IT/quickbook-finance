import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  COMPARISON_ACCOUNT_FLOOR,
  COMPARISON_FIXED_WIDTHS,
  COMPARISON_MIN_WIDTH,
} from "@/app/(app)/reports/balance-comparison/comparison-columns";
import { COLUMN, TABLE_BOX_AT_1280, fitsBox } from "@/lib/design/table-metrics";
import { REPORT_CATALOG, canOpenReport } from "@/lib/domain/report-catalog";

const ROOT = process.cwd();
const DIR = join("app", "(app)", "reports", "balance-comparison");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const client = read(join(DIR, "BalanceComparisonClient.tsx"));
const page = read(join(DIR, "page.tsx"));
const css = read(join(DIR, "balance-comparison.module.css"));

describe("the Balance Comparison report in the Report Center", () => {
  const entry = REPORT_CATALOG.find((r) => r.id === "balance-comparison");

  it("sits in the accounting group beside the Trial Balance, with the same permissions, on a page that exists", () => {
    const trial = REPORT_CATALOG.find((r) => r.id === "trial-balance")!;
    expect(entry).toMatchObject({ title: "Balance Comparison", href: "/reports/balance-comparison", group: "accounting" });
    expect(entry?.anyPermissions).toEqual(trial.anyPermissions);
    expect(existsSync(join(ROOT, DIR, "page.tsx"))).toBe(true);
    expect(canOpenReport(entry!, null)).toBe(true);
  });
});

describe("the comparison table fits the screen", () => {
  it("fits the 984px box of a 1280px window, with the account name at its floor", () => {
    const measured = COMPARISON_FIXED_WIDTHS.reduce((a, b) => a + b, 0);
    expect(fitsBox(measured, COMPARISON_ACCOUNT_FLOOR)).toBe(true);
    expect(measured + COMPARISON_ACCOUNT_FLOOR).toBeLessThanOrEqual(TABLE_BOX_AT_1280);
    expect(COMPARISON_ACCOUNT_FLOOR).toBeGreaterThanOrEqual(COLUMN.TEXT_MIN);
  });

  it("draws the fixed widths it adds up and gives the account name no width of its own", () => {
    for (const name of [
      "COMPARISON_CODE_WIDTH",
      "COMPARISON_ONEBOOK_WIDTH",
      "COMPARISON_OTHER_WIDTH",
      "COMPARISON_DIFFERENCE_WIDTH",
    ]) {
      expect(client, name).toContain(`width: ${name}`);
    }
    expect(client.match(/width: COMPARISON_\w+_WIDTH/g)).toHaveLength(COMPARISON_FIXED_WIDTHS.length);
    expect(client).toContain("floor: COMPARISON_ACCOUNT_FLOOR");
    expect(client).not.toMatch(/scroll=\{\{\s*x/);
  });

  it("holds its measured width on a phone and scrolls inside its own box", () => {
    expect(css).toContain(`min-width: ${COMPARISON_MIN_WIDTH}px;`);
    expect(css).toMatch(/@media \(max-width: 640px\)/);
    expect(client).toContain("styles.comparisonTable");
  });

  it("never cuts the sentence under an account", () => {
    expect(client).toMatch(/ellipsis: false/);
    expect(css).toMatch(/\.note\s*\{[^}]*white-space: normal/);
  });
});

describe("the screen follows the project's rules", () => {
  it("lists through DataTable and never imports Ant Design's Table", () => {
    expect(client).toContain('import DataTable from "@/components/ui/DataTable"');
    expect(client).not.toMatch(/<Table(?!\w)/);
    expect(client).not.toMatch(/\bTable,|\bTable }/);
    expect(client).not.toMatch(/pageSize/);
  });

  it("shows money through formatMoney and writes no money format of its own", () => {
    expect(client).toContain("formatMoney(minor, currencyCode, decimals)");
    expect(client).not.toMatch(/toFixed\(/);
  });

  it("keeps each figure box uncontrolled, so typing never re-renders it", () => {
    const box = client.slice(client.indexOf("function FigureBox"), client.indexOf("/** The form that adds"));
    expect(box).toContain("defaultValue={initialText}");
    expect(box).not.toMatch(/\bvalue=\{/);
    expect(box).not.toMatch(/onChange=/);
    expect(box).toContain("onBlur=");
  });

  it("warns before leaving with unsaved figures, and before changing the date", () => {
    expect(client).toContain("useUnsavedGuard(dirty, modal");
    expect(client).toContain("Leave without saving?");
  });

  it("takes the default date from the company's clock and keeps Ant Design sub-components out of the page", () => {
    expect(page).toContain("reportPageContext");
    expect(page).not.toContain("toISOString");
    expect(page).not.toMatch(/Typography\.|Form\.Item|Space\.Compact/);
  });

  it("shows a failed read as a small warning, not a broken page", () => {
    expect(page).toMatch(/catch \(e\)/);
    expect(client).toContain('type="warning"');
    expect(client).toContain("LOAD_FAILED");
    expect(page).toContain("console.error(");
    expect(page).not.toMatch(/loadError = e instanceof Error/);
  });

  it("reads every box as it stands when Save is pressed, and says when Only differences has nothing", () => {
    expect(client).toContain("boxes.current.get(row.key)");
    expect(client).toContain("withRef.current?.input?.value");
    expect(client).toContain("NO_DIFFERENCES");
    expect(client).toContain("new Set(Object.keys(errors))");
  });

  it("imports no PDF reader into the browser", () => {
    expect(client).not.toMatch(/pdf-statement/);
  });

  it("says the words the report was specified with", () => {
    expect(client).toContain("Add an account the other system has");
    expect(client).toContain("Only differences");
    // The As of date is the shared report bar's own; Run report goes to it.
    expect(client).toContain('kind: "asOf"');
    expect(client).toContain('aria-label="Compared with"');
    expect(client).toContain('aria-label="Note"');
    expect(client).toContain("Save");
  });
});
