import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { moveColumn } from "@/lib/domain/column-order";
import { COLUMN_WIDTH_STEP, stepColumnWidth } from "@/lib/domain/column-width";
import { RELEASES } from "@/lib/domain/changelog";

/**
 * 3.0.35 (UI audit A9): moving and resizing columns on Bank Transactions and
 * General Ledger took a drag, which a keyboard, a screen reader or a shaky
 * hand cannot do (WCAG 2.2, 2.5.7). A Columns dialog does the same with
 * buttons, one step a press, and says what each did.
 */
const ROOT = process.cwd();
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8").replace(/\r\n/g, "\n");

describe("moving a column one place (3.0.35)", () => {
  const order = ["date", "description", "amount", "category", "match"] as const;

  it("swaps it with its neighbour", () => {
    expect(moveColumn(order, "amount", -1)).toEqual(["date", "amount", "description", "category", "match"]);
    expect(moveColumn(order, "amount", 1)).toEqual(["date", "description", "category", "amount", "match"]);
  });

  it("leaves a column at the end where it is, and an unknown one too", () => {
    expect(moveColumn(order, "date", -1)).toEqual([...order]);
    expect(moveColumn(order, "match", 1)).toEqual([...order]);
    expect(moveColumn(order, "nope" as (typeof order)[number], 1)).toEqual([...order]);
  });
});

describe("a column one step narrower or wider (3.0.35)", () => {
  const budget = { box: 1000, chrome: 100, elasticFloor: 200 };

  it("moves by one step, from the width it has", () => {
    expect(COLUMN_WIDTH_STEP).toBe(20);
    expect(stepColumnWidth({ date: 120 }, "date", 120, 1, budget)).toEqual({ date: 140 });
    expect(stepColumnWidth({ date: 120 }, "date", 120, -1, budget)).toEqual({ date: 100 });
  });

  it("gives an elastic column the width the browser gave it, then a step", () => {
    expect(stepColumnWidth<"date" | "memo">({ date: 120 }, "memo", 233.6, 1, budget)).toEqual({ date: 120, memo: 254 });
  });

  it("keeps to the same floor and ceiling as a drag", () => {
    expect(stepColumnWidth({ date: 60 }, "date", 60, -1, budget)).toEqual({ date: 60 });
    // 1000 − 100 chrome − 200 elastic floor = 700 for measured columns; 600 is taken by the other.
    expect(stepColumnWidth<"date" | "amount">({ date: 100, amount: 600 }, "date", 100, 1, budget)).toEqual({ date: 100, amount: 600 });
  });
});

describe("the Columns dialog (3.0.35)", () => {
  const dialog = read("components", "ui", "ColumnsDialog.tsx");

  it("is a dialog, opened by a button that says so", () => {
    expect(dialog).toMatch(/<Modal\b/);
    expect(dialog).toMatch(/aria-haspopup="dialog"/);
    expect(dialog).toMatch(/>\s*Columns\s*</);
  });

  it("names every button after its column and what it does", () => {
    for (const name of ["`Move ${column.label} left`", "`Move ${column.label} right`", "`Make ${column.label} narrower`", "`Make ${column.label} wider`"]) {
      expect(dialog, name).toContain(name);
    }
  });

  it("says what each press did, to a screen reader too", () => {
    expect(dialog).toMatch(/role="status" aria-live="polite"/);
    expect(dialog).toMatch(/is now column \$\{position\} of \$\{movable\.length\}/);
    expect(dialog).toMatch(/is \$\{width\} pixels wide/);
    expect(dialog).toMatch(/Reset columns/);
  });

  it("finds a resizable heading to measure by a key on the cell", () => {
    expect(read("components", "ui", "useColumnResize.ts")).toMatch(/"data-column-key": `\$\{storageKey\}:\$\{key\}`/);
  });
});

describe("where it is offered (3.0.35)", () => {
  it("Bank Transactions: move and resize", () => {
    const table = read("app", "(app)", "banking", "BankTransactionsTable.tsx");
    expect(table).toMatch(/<ColumnsDialog\s+table="Bank Transactions"/);
    expect(table).toMatch(/onMove=\{move\}\s+onStep=\{step\}/);
    expect(table).toMatch(/onReset=\{\(\) => \{ resetOrder\(\); resetWidths\(\); \}\}/);
  });

  it("General Ledger: resize", () => {
    const ledger = read("app", "(app)", "reports", "general-ledger", "GeneralLedgerClient.tsx");
    expect(ledger).toMatch(/<ColumnsDialog\s+table="General Ledger"/);
    expect(ledger).toMatch(/movable: false, resizable: true/);
  });
});

describe("the release note (3.0.35)", () => {
  it("says the columns can be arranged without dragging", () => {
    const release = RELEASES.find((candidate) => candidate.version === "3.0.35");
    expect(release).toBeDefined();
    const said = (release?.changes ?? []).map((change) => `${change.title} ${change.detail ?? ""}`).join(" ");
    expect(said).toMatch(/Columns/);
    expect(said).toMatch(/keyboard/);
  });
});
