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
export function resolveToken(path: string): string {
  const found = flattenTokens().find(([key]) => key === path);
  if (!found) throw new Error(`Unknown design token: ${path}`);
  return found[1];
}
