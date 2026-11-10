import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COLUMN, fitsBox } from "@/lib/design/table-metrics";
import { CUSTOMER_LIST_FIXED_WIDTHS } from "@/app/(app)/customers/CustomersClient";

const source = readFileSync(
  join(process.cwd(), "app", "(app)", "customers", "CustomersClient.tsx"),
  "utf8",
);
const sum = (widths: readonly number[]) => widths.reduce((a, b) => a + b, 0);

describe("the Customers list", () => {
  it("fits the 984px box with room left for the name", () => {
    expect(CUSTOMER_LIST_FIXED_WIDTHS).toHaveLength(7);
    expect(fitsBox(sum(CUSTOMER_LIST_FIXED_WIDTHS), COLUMN.TEXT_MIN)).toBe(true);
  });

  it("links each name to its customer page, on one line", () => {
    expect(source).toContain("href={`/customers/${row.id}`}");
    expect(source).not.toContain("secondaryLine(");
  });

  it("has an Overdue column and opens with the largest overdue first", () => {
    expect(source).toContain('title: "Overdue"');
    expect(source).toMatch(/overdueMinor/);
    expect(source).toMatch(/b\.overdue - a\.overdue|overdueOf\(b\) - overdueOf\(a\)/);
  });

  it("colours amounts with the list's own defined styles, not classes that do not exist", () => {
    expect(source).not.toContain("accounting-negative");
    expect(source).not.toContain("accounting-muted");
    expect(source).toContain("className={styles.overdue}");
    expect(source).toContain("styles.negative");
    expect(source).toContain("className={styles.muted}");
  });
});
