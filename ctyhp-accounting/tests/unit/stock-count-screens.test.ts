import { describe, expect, it } from "vitest";
import { fitsBox } from "@/lib/design/table-metrics";
import { EDITOR_FIXED_WIDTHS, NAME_FLOOR, READONLY_FIXED_WIDTHS } from "@/app/(app)/inventory/stock-count/StockCountDetailClient";
import { LIST_ELASTIC_FLOOR, LIST_FIXED_WIDTHS } from "@/app/(app)/inventory/stock-count/StockCountListClient";
import {
  AGREES_MESSAGE,
  FOOTNOTE,
  PASTE_HINT,
  SAVE_FIRST_MESSAGE,
  TRACKS_ITEMS_MESSAGE,
  adjustButtonLabel,
  adjustButtonState,
  appendCountLines,
  differenceTone,
  entryPreview,
  isLocked,
  parseCountSheet,
  pasteProblemText,
  pasteSummary,
  signedAmountText,
} from "@/lib/domain/stock-count";

const fmt = (m: number) => `$${(m / 100).toFixed(2)}`;
const base = { canAdjust: true, tracksItems: false, dirty: false, differenceMinor: 1200 };

describe("adjustButtonState", () => {
  it("is open when the difference is not zero and nothing is unsaved", () => {
    expect(adjustButtonState(base)).toEqual({ visible: true, disabled: false, reason: null });
  });
  it("is not drawn without inventory.adjust", () => {
    expect(adjustButtonState({ ...base, canAdjust: false }).visible).toBe(false);
  });
  it("explains a zero difference", () => {
    expect(adjustButtonState({ ...base, differenceMinor: 0 })).toEqual({
      visible: true,
      disabled: true,
      reason: AGREES_MESSAGE,
    });
  });
  it("explains item tracking before anything else", () => {
    const s = adjustButtonState({ ...base, tracksItems: true, dirty: true, differenceMinor: 0 });
    expect(s.reason).toBe(TRACKS_ITEMS_MESSAGE);
  });
  it("asks to save first, ahead of a zero difference", () => {
    expect(adjustButtonState({ ...base, dirty: true, differenceMinor: 0 }).reason).toBe(SAVE_FIRST_MESSAGE);
  });
});

describe("labels", () => {
  it("signs the amount", () => {
    expect(signedAmountText(1200, fmt)).toBe("+$12.00");
    expect(signedAmountText(-1200, fmt)).toBe("-$12.00");
    expect(signedAmountText(0, fmt)).toBe("$0.00");
  });
  it("words the button as the spec does", () => {
    expect(adjustButtonLabel(-505, "2026-06-30", fmt)).toBe("Adjust inventory by -$5.05 at 2026-06-30");
  });
  it("carries the hint and footnote verbatim", () => {
    expect(PASTE_HINT).toBe(
      "One line each: name, quantity, cost — and sells for, if you like. Pasting from a spreadsheet keeps the columns apart; in typed text leave out thousands separators.",
    );
    expect(FOOTNOTE).toBe(
      "Periodic, on purpose: purchases go to cost of sales as they are made and the count corrects the balance sheet. This is a count sheet, not perpetual stock, so it does not track units in and out.",
    );
  });
});

describe("entryPreview", () => {
  const inv = { code: "1200", name: "Inventory" };
  const off = { code: "5010", name: "Inventory Adjustment" };
  it("debits inventory for a positive difference", () => {
    expect(entryPreview(500, inv, off)).toEqual([
      { side: "Dr", accountLabel: "1200 Inventory", amountMinor: 500 },
      { side: "Cr", accountLabel: "5010 Inventory Adjustment", amountMinor: 500 },
    ]);
  });
  it("reverses for a negative difference", () => {
    const lines = entryPreview(-500, inv, off)!;
    expect(lines.map((l) => l.side)).toEqual(["Cr", "Dr"]);
    expect(lines.every((l) => l.amountMinor === 500)).toBe(true);
  });
  it("is null for a zero difference or a missing account", () => {
    expect(entryPreview(0, inv, off)).toBeNull();
    expect(entryPreview(5, null, off)).toBeNull();
    expect(entryPreview(5, inv, null)).toBeNull();
  });
});

describe("pasting", () => {
  it("appends the good lines and reports the bad ones by number", () => {
    const result = parseCountSheet("Bolt, 5, 2.00\nbroken\n\nNut, 3, 0.50");
    expect(result.lines).toHaveLength(2);
    expect(result.problems.map(pasteProblemText)).toEqual(["Line 2: Needs a name, a quantity and a cost each"]);
    expect(pasteSummary(result)).toBe("Added 2 lines. 1 line could not be read and was left out.");
    const existing = [{ name: "Old", sku: null, quantity: 1, unitCostMinor: 100, sellsForMinor: null }];
    expect(appendCountLines(existing, result.lines).map((l) => l.name)).toEqual(["Old", "Bolt", "Nut"]);
  });
  it("says when there was nothing to read", () => {
    expect(pasteSummary(parseCountSheet("  \n"))).toBe("Nothing to read. Paste one line for each item.");
  });
  it("uses the singular", () => {
    expect(pasteSummary(parseCountSheet("Bolt, 1, 1"))).toBe("Added 1 line.");
  });
});

describe("isLocked", () => {
  it("locks everything but a draft", () => {
    expect(isLocked("draft")).toBe(false);
    expect(isLocked("pending_approval")).toBe(true);
    expect(isLocked("posted")).toBe(true);
  });
});

describe("table fit", () => {
  const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
  it("fits the list at a 1280px window", () => {
    expect(fitsBox(sum(LIST_FIXED_WIDTHS), LIST_ELASTIC_FLOOR)).toBe(true);
  });
  it("fits the editable and the read-only lines tables at a 1280px window", () => {
    expect(fitsBox(sum(EDITOR_FIXED_WIDTHS), NAME_FLOOR)).toBe(true);
    expect(fitsBox(sum(READONLY_FIXED_WIDTHS), NAME_FLOOR)).toBe(true);
  });
});

describe("differenceTone", () => {
  it("is red only for a shortage", () => {
    expect(differenceTone(-1)).toBe("shortage");
    expect(differenceTone(177500)).toBe("neutral");
    expect(differenceTone(0)).toBe("neutral");
  });
});
