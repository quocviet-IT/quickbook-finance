/**
 * The Overview tab as each person arranges it (3.0.39): which cards it shows,
 * in which order, and which of them are wide.
 *
 * Pure. A layout is saved per person per company (migration 0198) and read
 * back through `normalizeOverview`, so a layout saved before a card existed,
 * or one that is not a layout at all, still draws a sensible Overview.
 */

export type HomeWidgetKey =
  | "cash"
  | "needs"
  | "pnl"
  | "expenses"
  | "insights"
  | "bank"
  | "invoices"
  | "bills"
  | "close"
  | "watchlist"
  | "sales"
  | "payments"
  | "aging"
  | "activity";

/** Every card the Overview can show, with its title, in the Standard order. */
export const HOME_WIDGETS: readonly { key: HomeWidgetKey; title: string }[] = [
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
];

const KEYS: readonly HomeWidgetKey[] = HOME_WIDGETS.map((widget) => widget.key);
const KNOWN: ReadonlySet<string> = new Set(KEYS);

/** A card's title, as its own head says it. */
export function widgetTitle(key: HomeWidgetKey): string {
  return HOME_WIDGETS.find((widget) => widget.key === key)?.title ?? key;
}

/**
 * `order` holds every card once; `shown` and `wide` are cards of `order`,
 * listed in its order. A card left out of `shown` is not drawn.
 */
export interface OverviewLayout {
  order: HomeWidgetKey[];
  shown: HomeWidgetKey[];
  wide: HomeWidgetKey[];
}

export type HomePresetKey = "standard" | "owner" | "accountant";

export interface HomePreset {
  key: HomePresetKey;
  label: string;
  layout: OverviewLayout;
}

/**
 * The three layouts to start from. Standard is the Overview as it was before
 * it could be changed (3.0.38): cash flow wide, then Needs attention, profit
 * and loss, expenses and insights. Recent accounting activity is last in every
 * order and shown in none. Each preset fills its rows: a wide card beside a
 * narrow one, three narrow ones, so no row ends in a gap (the mockup's
 * Accountant put Bank accounts after two narrow cards, which left one).
 */
export const HOME_PRESETS: readonly HomePreset[] = [
  {
    key: "standard",
    label: "Standard",
    layout: {
      order: ["cash", "needs", "pnl", "expenses", "insights", "bank", "invoices", "bills", "close", "watchlist", "sales", "payments", "aging", "activity"],
      shown: ["cash", "needs", "pnl", "expenses", "insights"],
      wide: ["cash"],
    },
  },
  {
    key: "owner",
    label: "Owner",
    layout: {
      order: ["cash", "insights", "pnl", "expenses", "invoices", "bills", "sales", "needs", "bank", "close", "watchlist", "payments", "aging", "activity"],
      shown: ["cash", "insights", "pnl", "expenses", "sales"],
      wide: ["cash"],
    },
  },
  {
    key: "accountant",
    label: "Accountant",
    layout: {
      order: ["bank", "needs", "close", "watchlist", "aging", "pnl", "cash", "expenses", "insights", "invoices", "bills", "sales", "payments", "activity"],
      shown: ["bank", "needs", "close", "watchlist"],
      wide: ["bank", "watchlist"],
    },
  },
];

function copy(layout: OverviewLayout): OverviewLayout {
  return { order: [...layout.order], shown: [...layout.shown], wide: [...layout.wide] };
}

/** The Standard layout, a fresh copy. */
export function standardLayout(): OverviewLayout {
  return copy(HOME_PRESETS[0].layout);
}

/** A preset's layout, a fresh copy. */
export function presetLayout(key: HomePresetKey): OverviewLayout {
  return copy((HOME_PRESETS.find((preset) => preset.key === key) ?? HOME_PRESETS[0]).layout);
}

/** The known card keys of a list, each once, in the list's order. */
function knownKeys(list: readonly unknown[]): HomeWidgetKey[] {
  const out: HomeWidgetKey[] = [];
  for (const item of list) {
    if (typeof item === "string" && KNOWN.has(item) && !out.includes(item as HomeWidgetKey)) out.push(item as HomeWidgetKey);
  }
  return out;
}

/** The cards of `list` that are in `order`, in `order`'s order. */
function inOrder(order: readonly HomeWidgetKey[], list: readonly HomeWidgetKey[]): HomeWidgetKey[] {
  const set = new Set(list);
  return order.filter((key) => set.has(key));
}

/**
 * Whatever was stored, as a layout the Overview can draw. Anything that is not
 * an object of three lists is the Standard layout. Otherwise unknown cards and
 * repeats are dropped, a card missing from the order (one added in a later
 * release) goes at the end, hidden, and `shown` and `wide` keep only cards of
 * the order, in its order.
 */
export function normalizeOverview(raw: unknown): OverviewLayout {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return standardLayout();
  const value = raw as Record<string, unknown>;
  if (!Array.isArray(value.order) || !Array.isArray(value.shown) || !Array.isArray(value.wide)) return standardLayout();
  const listed = knownKeys(value.order);
  const order = [...listed, ...KEYS.filter((key) => !listed.includes(key))];
  return {
    order,
    shown: inOrder(order, knownKeys(value.shown)),
    wide: inOrder(order, knownKeys(value.wide)),
  };
}

/** The card moved one place earlier (-1) or later (1); at either end it stays. */
export function moveWidget(layout: OverviewLayout, key: HomeWidgetKey, by: -1 | 1): OverviewLayout {
  const from = layout.order.indexOf(key);
  const to = from + by;
  if (from < 0 || to < 0 || to >= layout.order.length) return copy(layout);
  const order = [...layout.order];
  [order[from], order[to]] = [order[to], order[from]];
  return { order, shown: inOrder(order, layout.shown), wide: inOrder(order, layout.wide) };
}

/** The card put just before `target`: where a dragged card lands when it is dropped on another. */
export function moveWidgetBefore(layout: OverviewLayout, key: HomeWidgetKey, target: HomeWidgetKey): OverviewLayout {
  if (key === target || !layout.order.includes(key) || !layout.order.includes(target)) return copy(layout);
  const order = layout.order.filter((item) => item !== key);
  order.splice(order.indexOf(target), 0, key);
  return { order, shown: inOrder(order, layout.shown), wide: inOrder(order, layout.wide) };
}

function toggle(order: readonly HomeWidgetKey[], list: readonly HomeWidgetKey[], key: HomeWidgetKey): HomeWidgetKey[] {
  return list.includes(key) ? list.filter((item) => item !== key) : inOrder(order, [...list, key]);
}

/** The card shown if it was hidden, hidden if it was shown. */
export function toggleShown(layout: OverviewLayout, key: HomeWidgetKey): OverviewLayout {
  return { order: [...layout.order], shown: toggle(layout.order, layout.shown, key), wide: [...layout.wide] };
}

/** The card made wide if it was narrow, narrow if it was wide. */
export function toggleWide(layout: OverviewLayout, key: HomeWidgetKey): OverviewLayout {
  return { order: [...layout.order], shown: [...layout.shown], wide: toggle(layout.order, layout.wide, key) };
}

function sameSet(a: readonly HomeWidgetKey[], b: readonly HomeWidgetKey[]): boolean {
  const set = new Set(a);
  return set.size === new Set(b).size && b.every((key) => set.has(key));
}

/** The same cards in the same order, shown and wide alike. */
export function sameLayout(a: OverviewLayout, b: OverviewLayout): boolean {
  return a.order.length === b.order.length && a.order.every((key, i) => b.order[i] === key) && sameSet(a.shown, b.shown) && sameSet(a.wide, b.wide);
}

export function isStandard(layout: OverviewLayout): boolean {
  return sameLayout(layout, HOME_PRESETS[0].layout);
}

/**
 * How many of the twelve columns a card takes: 8 for a wide card at desktop
 * and the whole row at tablet widths, 4 and half the row for a narrow one.
 * On a phone every card takes the row.
 */
export function overviewSpan(layout: OverviewLayout, key: HomeWidgetKey): { span: 4 | 8; mid: 6 | 12 } {
  return layout.wide.includes(key) ? { span: 8, mid: 12 } : { span: 4, mid: 6 };
}
