import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { flexColumn } from "@/components/ui/columns";
import {
  COLUMN,
  ELASTIC_COLUMN_MIN,
  EXPAND_COLUMN_WIDTH,
  TABLE_BOX_AT_1280,
  tableFloorWidth,
  tableMinimumWidth,
} from "@/lib/design/table-metrics";
import {
  SALES_RECEIPT_COLUMN_WIDTH,
  SALES_RECEIPT_CUSTOMER_FLOOR,
  SALES_RECEIPT_DEPOSIT_FLOOR,
} from "@/app/(app)/sales-receipts/sales-receipt-columns";

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

describe("tableFloorWidth: the phone's minimum", () => {
  it("adds every declared width and every elastic column's floor", () => {
    const columns = [
      { title: "Number", width: COLUMN.CODE },
      flexColumn({ title: "Customer", dataIndex: "customer" as never }),
      { title: "Total", width: COLUMN.MONEY },
    ];
    expect(tableFloorWidth(columns)).toBe(COLUMN.CODE + COLUMN.TEXT_MIN + COLUMN.MONEY);
  });

  it("counts a column with neither as nothing, and a width that is not a number as nothing", () => {
    const columns = [{ title: "A" }, { width: "30%" }, { width: 88 }];
    expect(tableFloorWidth(columns)).toBe(88);
  });

  it("skips a hidden column and adds up a group's own columns", () => {
    const columns = [
      { width: 100, hidden: true },
      { title: "Amounts", children: [{ width: 116 }, { width: 116 }, { minWidth: 200 }] },
    ];
    expect(tableFloorWidth(columns)).toBe(116 + 116 + 200);
  });

  it("makes room for the selection checkbox and the expand button", () => {
    expect(tableFloorWidth([{ width: 100 }], { selection: true })).toBe(100 + COLUMN.SELECTION);
    expect(tableFloorWidth([{ width: 100 }], { expandable: true })).toBe(100 + EXPAND_COLUMN_WIDTH);
    expect(tableFloorWidth(undefined)).toBe(0);
  });

  it("is wider than a phone for Sales Receipts, so the frame scrolls and Customer keeps its floor", () => {
    const floor = sum(Object.values(SALES_RECEIPT_COLUMN_WIDTH)) + SALES_RECEIPT_CUSTOMER_FLOOR + SALES_RECEIPT_DEPOSIT_FLOOR;
    expect(floor).toBeGreaterThan(390);
  });
});

describe("tableMinimumWidth: the computer's minimum", () => {
  it("gives every column without a width a few letters, floor or no floor", () => {
    const columns = [
      { width: 110 },
      flexColumn({ title: "Customer", dataIndex: "customer" as never }),
      { title: "Note" },
      { width: "30%" },
    ];
    expect(tableMinimumWidth(columns)).toBe(110 + 3 * ELASTIC_COLUMN_MIN);
    expect(ELASTIC_COLUMN_MIN).toBeGreaterThanOrEqual(40);
  });

  it("is never more than the floor of a column that has one", () => {
    const columns = [{ width: 110 }, flexColumn({ title: "Customer", dataIndex: "customer" as never })];
    expect(tableMinimumWidth(columns)).toBeLessThanOrEqual(tableFloorWidth(columns));
  });

  it("leaves Sales Receipts' row inside its box at 1280, even less the page scrollbar", () => {
    const minimum = sum(Object.values(SALES_RECEIPT_COLUMN_WIDTH)) + 2 * ELASTIC_COLUMN_MIN;
    expect(minimum).toBeLessThanOrEqual(TABLE_BOX_AT_1280 - 15);
  });
});

describe("DataTable holds a fitted table to the right minimum", () => {
  it("works both widths out from its own columns and hands them to the stylesheet", () => {
    const source = read("components", "ui", "DataTable.tsx");
    expect(source).toMatch(/selection: Boolean\(props\.rowSelection\)/);
    expect(source).toContain('"--table-floor-width": `${tableFloorWidth(columns, extras)}px`');
    expect(source).toContain('"--table-min-width": `${tableMinimumWidth(columns, extras)}px`');
  });

  it("applies the computer's minimum everywhere and the floor below 768px, over rc-table's inline 100%", () => {
    const css = read("app", "globals.css").replace(/\r\n/g, "\n");
    const selectors =
      ".accounting-table--fit .ant-table-content > table,\n" +
      "  .accounting-table--fit .ant-table-header > table,\n" +
      "  .accounting-table--fit .ant-table-body > table {\n" +
      "    min-width: max(100%, var(--table-floor-width, 0px)) !important;";
    expect(css).toContain("min-width: max(100%, var(--table-min-width, 0px)) !important;");
    const phone = css.indexOf("@media (max-width: 767px) {\n  .accounting-table--fit .ant-table-content > table");
    expect(phone, "the phone rule").toBeGreaterThan(-1);
    expect(css.slice(phone)).toContain(selectors);
  });
});
