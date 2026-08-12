import { PALETTE } from "./palette";

/**
 * What each colour is *for*. This is the single definition the Ant Design
 * theme, the CSS custom properties and every component all derive from.
 *
 * The three groups answer different questions and must not be collapsed:
 *   * `money` / `intent` / `text` / `surface` / `border` carry meaning, so two
 *     of them may share a palette entry only when they genuinely mean the same
 *     thing.
 *   * `series` is a categorical scale for charts. Its entries are told apart
 *     from each other, not read for meaning, so contrast rules that apply to
 *     text do not apply here.
 */
export const TOKENS = {
  money: {
    positive: PALETTE.green700,
    negative: PALETTE.red700,
    zero: PALETTE.slate600,
  },
  intent: {
    primary: PALETTE.teal700,
    success: PALETTE.green700,
    warning: PALETTE.amber700,
    danger: PALETTE.red700,
    info: PALETTE.blue700,
  },
  text: {
    heading: PALETTE.slate900,
    body: PALETTE.slate900,
    secondary: PALETTE.slate600,
    onDark: PALETTE.white,
  },
  surface: {
    page: PALETTE.slate50,
    card: PALETTE.white,
    muted: PALETTE.slate100,
    sider: PALETTE.slate900,
  },
  border: {
    default: PALETTE.slate200,
    subtle: PALETTE.slate100,
  },
  // Chart series. Values are carried across unchanged from the two maps that
  // previously defined them by hand (DashboardClient and FinancialCharts);
  // choosing a validated categorical scale is a separate decision.
  series: {
    sales: PALETTE.teal700,
    purchases: PALETTE.violet600,
    inventory: PALETTE.sky700,
    banking: PALETTE.blue700,
    close: PALETTE.orange700,
    governance: PALETTE.slate600,
    other: PALETTE.slate400,
    income: PALETTE.teal700,
    expense: PALETTE.orange700,
    net: PALETTE.blue700,
    receivable: PALETTE.teal700,
    payable: PALETTE.violet600,
    axis: PALETTE.slate400,
    grid: PALETTE.slate200,
  },
} as const;

export type Tokens = typeof TOKENS;

/**
 * The dotted form a token is looked up by, such as `"money.negative"`. A bare
 * `string` at a call site says nothing about what shape it must take; this
 * names it, so a signature reads as the intent rather than as free text.
 */
export type TokenPath = string;

/** Every token as a `["group.name", value]` pair, in declaration order. */
export function flattenTokens(tokens: Tokens = TOKENS): [string, string][] {
  const out: [string, string][] = [];
  for (const [group, entries] of Object.entries(tokens)) {
    for (const [name, value] of Object.entries(entries as Record<string, string>)) {
      out.push([`${group}.${name}`, value]);
    }
  }
  return out;
}

/**
 * Look a token up by its dotted path. Throws rather than returning undefined:
 * an unknown path is a typo, and a silent `undefined` reaches the DOM as a
 * missing colour that nobody notices until a screenshot looks wrong.
 */
export function resolveToken(path: TokenPath): string {
  const found = flattenTokens().find(([key]) => key === path);
  if (!found) throw new Error(`Unknown design token: ${path}`);
  return found[1];
}

/**
 * Which colours are read as text against which background.
 *
 * Only text belongs here. `series.axis` and `series.grid` are decorative
 * strokes on a chart: holding them to a text contrast ratio would darken the
 * chart furniture without making anything more readable.
 */
export const TEXT_ON_SURFACE_PAIRS: readonly [TokenPath, TokenPath][] = [
  ["text.heading", "surface.page"],
  ["text.heading", "surface.card"],
  ["text.body", "surface.page"],
  ["text.body", "surface.card"],
  ["text.secondary", "surface.page"],
  ["text.secondary", "surface.card"],
  ["text.onDark", "surface.sider"],
  ["money.positive", "surface.card"],
  ["money.negative", "surface.card"],
  ["money.zero", "surface.card"],
  ["intent.primary", "surface.card"],
  ["intent.success", "surface.card"],
  ["intent.warning", "surface.card"],
  ["intent.danger", "surface.card"],
  ["intent.info", "surface.card"],
];

/**
 * The tokens as a `:root` block.
 *
 * Emitted into globals.css as static text rather than injected at runtime: a
 * runtime style block costs bytes on every response and cannot be inspected in
 * a diff. A unit test asserts the committed CSS still matches this output, so
 * editing one without the other fails the build instead of drifting quietly.
 */
export function cssVariableBlock(): string {
  const lines = flattenTokens().map(
    ([path, value]) => `  --ob-${path.replace(".", "-")}: ${value};`,
  );
  return `:root {\n${lines.join("\n")}\n}\n`;
}
