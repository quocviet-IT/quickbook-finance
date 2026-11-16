import { describe, expect, it } from "vitest";
import {
  HOME_PRESETS,
  HOME_WIDGETS,
  isStandard,
  moveWidget,
  moveWidgetBefore,
  normalizeOverview,
  overviewSpan,
  presetLayout,
  sameLayout,
  standardLayout,
  toggleShown,
  toggleWide,
  widgetTitle,
  type HomeWidgetKey,
  type OverviewLayout,
} from "@/lib/domain/dashboard-home/layout";

const ALL: HomeWidgetKey[] = HOME_WIDGETS.map((widget) => widget.key);

/** Every list of a layout holds known cards once, and shown and wide are in the order's order. */
function wellFormed(layout: OverviewLayout) {
  expect([...layout.order].sort()).toEqual([...ALL].sort());
  for (const list of [layout.shown, layout.wide]) {
    expect(new Set(list).size).toBe(list.length);
    const positions = list.map((key) => layout.order.indexOf(key));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  }
}

describe("the Overview's cards", () => {
  it("are the fourteen, with their titles, in the Standard order", () => {
    expect(HOME_WIDGETS).toEqual([
      { key: "cash", title: "Cash flow" },
      { key: "needs", title: "Needs attention" },
      { key: "pnl", title: "Profit and loss" },
      { key: "expenses", title: "Expenses" },
      { key: "insights", title: "Insights" },
      { key: "bank", title: "Bank accounts" },
      { key: "invoices", title: "Invoices" },
      { key: "bills", title: "Bills" },
      { key: "close", title: "Month-end close" },
      { key: "watchlist", title: "Account watchlist" },
      { key: "sales", title: "Sales" },
      { key: "payments", title: "Recent payments" },
      { key: "aging", title: "Receivables and payables aging" },
      { key: "activity", title: "Recent accounting activity" },
    ]);
    expect(widgetTitle("aging")).toBe("Receivables and payables aging");
  });
});

describe("the presets", () => {
  it("are Standard, Owner and Accountant, each a whole layout", () => {
    expect(HOME_PRESETS.map((preset) => [preset.key, preset.label])).toEqual([
      ["standard", "Standard"],
      ["owner", "Owner"],
      ["accountant", "Accountant"],
    ]);
    for (const preset of HOME_PRESETS) {
      wellFormed(preset.layout);
      // Recent accounting activity comes last everywhere and is shown nowhere.
      expect(preset.layout.order.at(-1)).toBe("activity");
      expect(preset.layout.shown).not.toContain("activity");
    }
  });

  it("make Standard exactly the Overview before it could be changed", () => {
    const standard = standardLayout();
    expect(standard.shown).toEqual(["cash", "needs", "pnl", "expenses", "insights"]);
    expect(standard.wide).toEqual(["cash"]);
    expect(standard.order).toEqual(ALL);
    expect(isStandard(standard)).toBe(true);
  });

  it("fill every row: no preset leaves a gap at the end of a row", () => {
    for (const preset of HOME_PRESETS) {
      const { order, shown, wide } = preset.layout;
      let used = 0;
      for (const key of order.filter((k) => shown.includes(k))) {
        const span = wide.includes(key) ? 8 : 4;
        // A card that does not fit what is left of the row starts a new one, leaving a gap.
        expect(used === 0 || used + span <= 12, `${preset.key}: ${key} leaves a gap`).toBe(true);
        used = (used + span) % 12;
      }
      expect(used, `${preset.key}: the last row is not full`).toBe(0);
    }
  });

  it("take Owner and Accountant from the approved mockup, Accountant reordered to fill its rows", () => {
    expect(presetLayout("owner")).toEqual({
      order: ["cash", "insights", "pnl", "expenses", "invoices", "bills", "sales", "needs", "bank", "close", "watchlist", "payments", "aging", "activity"],
      shown: ["cash", "insights", "pnl", "expenses", "sales"],
      wide: ["cash"],
    });
    expect(presetLayout("accountant")).toEqual({
      order: ["bank", "needs", "close", "watchlist", "aging", "pnl", "cash", "expenses", "insights", "invoices", "bills", "sales", "payments", "activity"],
      shown: ["bank", "needs", "close", "watchlist"],
      wide: ["bank", "watchlist"],
    });
  });

  it("hand out copies, so editing one never changes the preset", () => {
    const one = standardLayout();
    one.shown.push("bank");
    expect(standardLayout().shown).not.toContain("bank");
  });
});

describe("normalizeOverview", () => {
  it("makes anything that is not a layout the Standard one", () => {
    for (const raw of [null, undefined, 3, "cash", [], ["cash"], {}, { order: ["cash"] }, { order: "cash", shown: [], wide: [] }]) {
      expect(normalizeOverview(raw)).toEqual(standardLayout());
    }
  });

  it("keeps a valid layout as it is", () => {
    const owner = presetLayout("owner");
    expect(normalizeOverview(JSON.parse(JSON.stringify(owner)))).toEqual(owner);
  });

  it("drops unknown cards and repeats, and keeps shown and wide inside the order", () => {
    const layout = normalizeOverview({
      order: ["needs", "cash", "needs", "forecast", 7, ...ALL],
      shown: ["cash", "cash", "forecast", "needs", null],
      wide: ["cash", "retired"],
    });
    wellFormed(layout);
    expect(layout.order.slice(0, 2)).toEqual(["needs", "cash"]);
    // In the order's order, whatever order they were saved in.
    expect(layout.shown).toEqual(["needs", "cash"]);
    expect(layout.wide).toEqual(["cash"]);
  });

  it("puts a card the saved layout never knew at the end, hidden: a layout saved before a card existed keeps working", () => {
    const old = { order: ["cash", "needs", "pnl"], shown: ["pnl", "cash"], wide: ["pnl"] };
    const layout = normalizeOverview(old);
    wellFormed(layout);
    expect(layout.order.slice(0, 3)).toEqual(["cash", "needs", "pnl"]);
    expect(layout.order.slice(3)).toEqual(ALL.filter((key) => !["cash", "needs", "pnl"].includes(key)));
    expect(layout.shown).toEqual(["cash", "pnl"]);
    expect(layout.wide).toEqual(["pnl"]);
  });
});

describe("editing a layout", () => {
  it("moves a card one place, and leaves it at either end", () => {
    const standard = standardLayout();
    expect(moveWidget(standard, "needs", -1).order.slice(0, 3)).toEqual(["needs", "cash", "pnl"]);
    expect(moveWidget(standard, "needs", 1).order.slice(0, 3)).toEqual(["cash", "pnl", "needs"]);
    expect(moveWidget(standard, "cash", -1)).toEqual(standard);
    expect(moveWidget(standard, "activity", 1)).toEqual(standard);
    // Shown follows the new order.
    expect(moveWidget(standard, "needs", -1).shown).toEqual(["needs", "cash", "pnl", "expenses", "insights"]);
    // The layout it was given is left alone.
    expect(standard).toEqual(standardLayout());
  });

  it("drops a dragged card just before the card it lands on, forwards or back", () => {
    const standard = standardLayout();
    expect(moveWidgetBefore(standard, "insights", "needs").order.slice(0, 5)).toEqual(["cash", "insights", "needs", "pnl", "expenses"]);
    expect(moveWidgetBefore(standard, "cash", "insights").order.slice(0, 5)).toEqual(["needs", "pnl", "expenses", "cash", "insights"]);
    expect(moveWidgetBefore(standard, "cash", "cash")).toEqual(standard);
    wellFormed(moveWidgetBefore(standard, "activity", "cash"));
  });

  it("shows and hides a card, and makes it wide or narrow, keeping the order's order", () => {
    const standard = standardLayout();
    const withBank = toggleShown(standard, "bank");
    expect(withBank.shown).toEqual(["cash", "needs", "pnl", "expenses", "insights", "bank"]);
    expect(toggleShown(withBank, "bank").shown).toEqual(standard.shown);
    const watchFirst = toggleShown(moveWidgetBefore(standard, "watchlist", "cash"), "watchlist");
    expect(watchFirst.shown[0]).toBe("watchlist");
    expect(toggleWide(standard, "cash").wide).toEqual([]);
    expect(toggleWide(standard, "pnl").wide).toEqual(["cash", "pnl"]);
  });

  it("knows the same layout, and Standard, by cards rather than by how the lists were built", () => {
    const a = standardLayout();
    const b = { ...standardLayout(), shown: [...a.shown].reverse() };
    expect(sameLayout(a, b)).toBe(true);
    expect(sameLayout(a, moveWidget(a, "needs", 1))).toBe(false);
    expect(sameLayout(a, toggleWide(a, "needs"))).toBe(false);
    expect(isStandard(presetLayout("owner"))).toBe(false);
    expect(isStandard(toggleShown(toggleShown(a, "bank"), "bank"))).toBe(true);
  });
});

describe("overviewSpan", () => {
  it("gives a wide card 8 of 12 columns and the row at tablet widths, a narrow one 4 and half the row", () => {
    const standard = standardLayout();
    expect(overviewSpan(standard, "cash")).toEqual({ span: 8, mid: 12 });
    expect(overviewSpan(standard, "needs")).toEqual({ span: 4, mid: 6 });
  });
});
