import { describe, expect, it } from "vitest";
import {
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  clampColumnWidth,
  mergeColumnWidths,
  parseStoredWidths,
  resizedWidth,
  serializeColumnWidths,
  totalColumnWidth,
} from "@/lib/domain/column-width";

const KEYS = ["date", "description", "amount"] as const;
const DEFAULTS = { date: 115, description: 320, amount: 140 };

describe("clampColumnWidth", () => {
  it("keeps an ordinary width untouched", () => {
    expect(clampColumnWidth(200)).toBe(200);
  });

  it("refuses to let a column collapse out of reach", () => {
    // 60px still shows a truncated value and still leaves the handle itself
    // grabbable, which is what makes the narrowing reversible.
    expect(clampColumnWidth(10)).toBe(MIN_COLUMN_WIDTH);
    expect(clampColumnWidth(0)).toBe(MIN_COLUMN_WIDTH);
    expect(clampColumnWidth(-500)).toBe(MIN_COLUMN_WIDTH);
  });

  it("refuses to let one column take the whole screen", () => {
    expect(clampColumnWidth(5000)).toBe(MAX_COLUMN_WIDTH);
  });

  it("rounds to whole pixels, and rejects what is not a number at all", () => {
    // A pointer delta arrives fractional on a scaled display; a width of
    // 187.5px would re-render on every sub-pixel move for no visible gain.
    expect(clampColumnWidth(187.6)).toBe(188);
    expect(clampColumnWidth(Number.NaN)).toBe(MIN_COLUMN_WIDTH);
    expect(clampColumnWidth(Number.POSITIVE_INFINITY)).toBe(MAX_COLUMN_WIDTH);
  });
});

describe("resizedWidth", () => {
  it("widens by how far the pointer travelled right", () => {
    expect(resizedWidth(200, 45)).toBe(245);
  });

  it("narrows by how far the pointer travelled left", () => {
    expect(resizedWidth(200, -45)).toBe(155);
  });

  it("stops at the bounds instead of following the pointer past them", () => {
    // Dragging far past the edge must not bank negative width that the
    // pointer then has to travel back through before anything moves.
    expect(resizedWidth(100, -900)).toBe(MIN_COLUMN_WIDTH);
    expect(resizedWidth(700, 900)).toBe(MAX_COLUMN_WIDTH);
  });

  it("is measured from where the drag started, not from the last frame", () => {
    // The whole reason the caller passes a start width: accumulating frame
    // deltas drifts, and the column ends up somewhere the pointer is not.
    expect(resizedWidth(300, 0)).toBe(300);
  });
});

describe("parseStoredWidths", () => {
  it("reads back what was written", () => {
    const stored = serializeColumnWidths({ date: 115, description: 240, amount: 140 });
    expect(parseStoredWidths(stored, KEYS)).toEqual({ date: 115, description: 240, amount: 140 });
  });

  it("treats nothing stored as nothing to say", () => {
    expect(parseStoredWidths(null, KEYS)).toEqual({});
    expect(parseStoredWidths("", KEYS)).toEqual({});
  });

  it("survives a corrupted entry rather than taking the screen down", () => {
    // localStorage is editable by hand and shared with every other tab. A
    // table that throws on read would be a blank page, not a wide column.
    expect(parseStoredWidths("{not json", KEYS)).toEqual({});
    expect(parseStoredWidths("[1,2,3]", KEYS)).toEqual({});
    expect(parseStoredWidths('"a string"', KEYS)).toEqual({});
    expect(parseStoredWidths("null", KEYS)).toEqual({});
  });

  it("ignores a key this table does not have", () => {
    // A column removed in a later release leaves its width behind in storage.
    expect(parseStoredWidths('{"description":240,"ghost":900}', KEYS)).toEqual({
      description: 240,
    });
  });

  it("ignores a value that is not a usable number", () => {
    expect(parseStoredWidths('{"date":"115","description":null,"amount":240}', KEYS)).toEqual({
      amount: 240,
    });
  });

  it("clamps a stored width that is out of bounds", () => {
    // Bounds can tighten between releases, and storage still holds the old
    // number. The stored value is a preference, not an override.
    expect(parseStoredWidths('{"description":9000,"amount":1}', KEYS)).toEqual({
      description: MAX_COLUMN_WIDTH,
      amount: MIN_COLUMN_WIDTH,
    });
  });
});

describe("mergeColumnWidths", () => {
  it("uses the shipped width for any column the reader never resized", () => {
    expect(mergeColumnWidths(DEFAULTS, { description: 240 })).toEqual({
      date: 115,
      description: 240,
      amount: 140,
    });
  });

  it("returns the defaults untouched when nothing was stored", () => {
    expect(mergeColumnWidths(DEFAULTS, {})).toEqual(DEFAULTS);
  });

  it("does not mutate the defaults it was given", () => {
    const defaults = { ...DEFAULTS };
    mergeColumnWidths(defaults, { description: 240 });
    expect(defaults).toEqual(DEFAULTS);
  });
});

describe("totalColumnWidth", () => {
  it("adds the data columns to the fixed action columns beside them", () => {
    // This total becomes the table's scroll width. Too small and the pinned
    // Delete/attachment buttons overlap the last data column.
    expect(totalColumnWidth(DEFAULTS, 112)).toBe(115 + 320 + 140 + 112);
  });

  it("counts nothing extra when the reader has no action columns", () => {
    expect(totalColumnWidth(DEFAULTS, 0)).toBe(575);
  });
});

describe("per-column minimums", () => {
  it("clamps to a caller's own floor when one is given", () => {
    // The Match column holds a tag, a description and three buttons; at the
    // global 60px floor those stack into a broken pile, which is exactly what
    // a reader screenshotted. A column may declare it needs more room than
    // the global floor guarantees.
    expect(clampColumnWidth(100, 240)).toBe(240);
    expect(clampColumnWidth(300, 240)).toBe(300);
  });

  it("resizes against the caller's floor, not the global one", () => {
    expect(resizedWidth(300, -200, 240)).toBe(240);
  });

  it("re-clamps a stored width that predates the floor", () => {
    // The width store is older than the rule: somebody narrowed Match to 60
    // last week and that number is still in localStorage. The floor must
    // apply on the way in, or the broken layout survives the fix.
    expect(parseStoredWidths('{"match":60}', ["match"], { match: 240 })).toEqual({
      match: 240,
    });
  });

  it("leaves keys without a declared floor on the global one", () => {
    expect(parseStoredWidths('{"date":10,"match":60}', ["date", "match"], { match: 240 })).toEqual({
      date: MIN_COLUMN_WIDTH,
      match: 240,
    });
  });
});
