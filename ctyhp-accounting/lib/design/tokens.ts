import { PALETTE } from "./palette";

/**
 * What each colour is *for*, in both themes. This is the single definition the
 * Ant Design theme, the CSS custom properties and every component all derive
 * from.
 *
 * Every token carries a `light` and a `dark` value. They are not computed from
 * one another: a dark theme is not an inverted light one. `intent.primary`
 * reads at 5.4:1 on white and would be 2.3:1 on a dark surface — under AA —
 * so dark names a lighter teal instead. Which pairs must clear AA is asserted
 * in TEXT_ON_SURFACE_PAIRS below, for both themes.
 *
 * **Every light value is unchanged from before the theme switch.** The light
 * theme works; a conversion that shifted it would have traded a feature for a
 * defect. `scripts/verify-theme.mjs --compare` holds that to the colours the
 * app actually paints, route by route.
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
    // Between body and secondary. The shell's buttons and account name use it.
    strong: PALETTE.slate700,
    secondary: PALETTE.slate600,
    faint: PALETTE.slate500,
    caption: PALETTE.neutral500,
    onDark: PALETTE.white,
  },
  surface: {
    page: PALETTE.slate50,
    card: PALETTE.white,
    muted: PALETTE.slate100,
    subtle: PALETTE.slate25,
    sider: PALETTE.slate900,
    siderFocus: PALETTE.ink850,
  },
  border: {
    default: PALETTE.slate200,
    subtle: PALETTE.slate100,
    muted: PALETTE.mist250,
    soft: PALETTE.mist350,
    softAlt: PALETTE.mist360,
    neutral: PALETTE.neutral300,
    cool: PALETTE.mist320,
    coolSoft: PALETTE.mist330,
    coolTint: PALETTE.mist340,
  },
  /**
   * The application shell's own furniture: the sider, and the header rule
   * beneath it.
   *
   * A group of its own because the sider is dark in BOTH themes. What reads
   * on it does not change when the rest of the app inverts, so these tokens
   * mostly carry the same value twice — and saying that once, here, is what
   * stops someone "fixing" them later by darkening a surface that was never
   * light. `headerBorder` is the exception: it is drawn on the header, which
   * does invert.
   */
  chrome: {
    text: PALETTE.slate50Bright,
    textMuted: PALETTE.slate400,
    border: PALETTE.slate800,
    scrollbar: PALETTE.slate700,
    submenu: PALETTE.slate800Blue,
    headerBorder: PALETTE.mist300,
  },
  /**
   * Brand tints: the washes, rings and glows drawn *from* the primary teal
   * rather than in it. Light uses near-white teals; dark cannot, because a
   * near-white wash on a dark card is a white box. Each one answers with a
   * deep teal of its own.
   */
  accent: {
    wash: PALETTE.teal50,
    hover: PALETTE.teal100,
    tint: PALETTE.teal150,
    bright: PALETTE.teal200,
    softRing: PALETTE.teal250,
    ring: PALETTE.teal300,
    line: PALETTE.teal350,
    deep: PALETTE.teal900,
    glow: PALETTE.teal400,
    lineSoft: PALETTE.teal320,
    lineHover: PALETTE.teal340,
    lineMuted: PALETTE.teal360,
    lineHoverAlt: PALETTE.teal380,
    iconBg: PALETTE.teal120,
    iconSoft: PALETTE.teal130,
    activeBg: PALETTE.teal140,
    onDeep: PALETTE.teal180,
    strong: PALETTE.teal750,
    strongHover: PALETTE.teal600,
    strongActive: PALETTE.teal650,
  },
  /**
   * The dashboard's own green-tinted greys. They are in neither the slate ramp
   * nor the teal one, and they were the largest group of colour in the
   * stylesheet that no token could name.
   */
  panel: {
    ink: PALETTE.sage950,
    borderStrong: PALETTE.sage250,
    soft: PALETTE.sage75,
    bg: PALETTE.sage50,
    border: PALETTE.sage100,
    borderSoft: PALETTE.sage150,
    line: PALETTE.sage200,
    text: PALETTE.sage600,
    textStrong: PALETTE.sage700,
    textSoft: PALETTE.sage500,
    textDeep: PALETTE.sage800,
    textMid: PALETTE.sage520,
    textFaint: PALETTE.sage480,
    textLineage: PALETTE.sage540,
    icon: PALETTE.sage450,
    iconSoft: PALETTE.sage460,
    onDeep: PALETTE.sage300,
    lineFaint: PALETTE.sage220,
    lineSoft: PALETTE.sage230,
    lineTint: PALETTE.sage240,
    edge: PALETTE.sage350,
  },
  /** Tinted backgrounds and borders for a state, as opposed to its text. */
  feedback: {
    negative: PALETTE.red600,
    negativeBorder: PALETTE.red100,
    negativeBg: PALETTE.red50,
    positiveOnDark: PALETTE.green200,
    infoBorder: PALETTE.blue100,
    infoBg: PALETTE.blue50,
    warning: PALETTE.orange600,
    favorite: PALETTE.gold600,
    cautionBorder: PALETTE.gold300,
    cautionBg: PALETTE.gold50,
    positiveBg: PALETTE.mintGreen50,
    positiveBgAlt: PALETTE.mintGreen100,
    purpleBg: PALETTE.violet50,
    infoBgAlt: PALETTE.skyBlue50,
    warningText: PALETTE.amberText,
    warningBg: PALETTE.amber50,
    warningBgAlt: PALETTE.orange50,
  },
  // Chart series. Values are carried across unchanged from the two maps that
  // previously defined them by hand (DashboardClient and FinancialCharts);
  // choosing a validated categorical scale is a separate decision. The dark
  // entries lift each hue off a dark canvas without changing which hue means
  // what, so a reader who learned the light chart can read the dark one.
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

/**
 * What each token becomes in the dark theme.
 *
 * A separate map rather than a second field on every token, because `TOKENS`
 * has to keep handing out a plain string. Two callers need a real colour and
 * cannot take a CSS variable: Ant Design derives a whole palette from
 * `colorPrimary` and needs a value it can compute on, and Recharts passes
 * `fill` as an SVG presentation attribute, where `var()` is not resolved.
 *
 * Same keys as TOKENS, enforced by the type — a token added without a dark
 * value fails to compile rather than falling back to its light one.
 */
export const DARK_TOKENS: { [G in keyof Tokens]: { [K in keyof Tokens[G]]: string } } = {
  money: {
    positive: PALETTE.green400,
    negative: PALETTE.red400,
    zero: PALETTE.mist400,
  },
  intent: {
    primary: PALETTE.teal400,
    success: PALETTE.green400,
    warning: PALETTE.amber400,
    danger: PALETTE.red400,
    info: PALETTE.blue400,
  },
  text: {
    heading: PALETTE.mist100,
    body: PALETTE.mist200,
    strong: PALETTE.mist200,
    secondary: PALETTE.mist400,
    faint: PALETTE.mist400,
    caption: PALETTE.mist400,
    // The sider is dark in both themes, so what reads on it does not change.
    onDark: PALETTE.white,
  },
  surface: {
    page: PALETTE.ink900,
    card: PALETTE.ink800,
    muted: PALETTE.ink700,
    subtle: PALETTE.ink700,
    sider: PALETTE.ink950,
    siderFocus: PALETTE.ink850,
  },
  border: {
    default: PALETTE.ink600,
    subtle: PALETTE.ink700,
    muted: PALETTE.ink600,
    soft: PALETTE.ink600,
    softAlt: PALETTE.ink600,
    neutral: PALETTE.ink600,
    cool: PALETTE.ink600,
    coolSoft: PALETTE.ink700,
    coolTint: PALETTE.ink700,
  },
  chrome: {
    // The sider is dark in both themes, so its furniture does not move.
    text: PALETTE.slate50Bright,
    textMuted: PALETTE.slate400,
    border: PALETTE.slate800,
    scrollbar: PALETTE.slate700,
    submenu: PALETTE.slate800Blue,
    // Drawn on the header, which does invert.
    headerBorder: PALETTE.ink600,
  },
  accent: {
    wash: PALETTE.teal950,
    hover: PALETTE.teal900,
    tint: PALETTE.teal850,
    // Bright tints already read on a dark surface; they were built for one.
    bright: PALETTE.teal200,
    softRing: PALETTE.teal250,
    ring: PALETTE.teal300,
    line: PALETTE.teal800,
    deep: PALETTE.teal900,
    glow: PALETTE.teal400,
    lineSoft: PALETTE.teal800,
    lineHover: PALETTE.teal800,
    lineMuted: PALETTE.teal800,
    lineHoverAlt: PALETTE.teal800,
    iconBg: PALETTE.teal950,
    iconSoft: PALETTE.teal950,
    activeBg: PALETTE.teal850,
    onDeep: PALETTE.teal180,
    strong: PALETTE.teal300,
    strongHover: PALETTE.teal400,
    strongActive: PALETTE.teal300,
  },
  panel: {
    ink: PALETTE.mist100,
    borderStrong: PALETTE.ink600,
    soft: PALETTE.ink700,
    bg: PALETTE.ink800,
    border: PALETTE.ink700,
    borderSoft: PALETTE.ink700,
    line: PALETTE.ink600,
    text: PALETTE.mist400,
    textStrong: PALETTE.mist200,
    textSoft: PALETTE.mist400,
    textDeep: PALETTE.mist200,
    textMid: PALETTE.mist400,
    textFaint: PALETTE.mist400,
    textLineage: PALETTE.mist400,
    icon: PALETTE.mist400,
    iconSoft: PALETTE.mist400,
    onDeep: PALETTE.sage300,
    lineFaint: PALETTE.ink600,
    lineSoft: PALETTE.ink700,
    lineTint: PALETTE.ink700,
    edge: PALETTE.ink600,
  },
  feedback: {
    negative: PALETTE.red400,
    negativeBorder: PALETTE.red900,
    negativeBg: PALETTE.red950,
    positiveOnDark: PALETTE.green200,
    infoBorder: PALETTE.blue950,
    infoBg: PALETTE.blue900,
    warning: PALETTE.amber400,
    favorite: PALETTE.amber400,
    cautionBorder: PALETTE.gold800,
    cautionBg: PALETTE.gold900,
    positiveBg: PALETTE.ink700,
    positiveBgAlt: PALETTE.ink700,
    purpleBg: PALETTE.ink700,
    infoBgAlt: PALETTE.blue900,
    warningText: PALETTE.amber400,
    warningBg: PALETTE.gold900,
    warningBgAlt: PALETTE.gold900,
  },
  series: {
    sales: PALETTE.teal400,
    purchases: PALETTE.violet400,
    inventory: PALETTE.sky400,
    banking: PALETTE.blue400,
    close: PALETTE.orange400,
    governance: PALETTE.mist400,
    other: PALETTE.mist400,
    income: PALETTE.teal400,
    expense: PALETTE.orange400,
    net: PALETTE.blue400,
    receivable: PALETTE.teal400,
    payable: PALETTE.violet400,
    axis: PALETTE.mist400,
    grid: PALETTE.ink600,
  },
};

export type Tokens = typeof TOKENS;
export type ThemeName = "light" | "dark";

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

/** The same paths, valued for whichever theme is asked for. */
export function flattenTheme(theme: ThemeName): [string, string][] {
  return flattenTokens(theme === "dark" ? (DARK_TOKENS as unknown as Tokens) : TOKENS);
}

/**
 * Look a token up by its dotted path. Throws rather than returning undefined:
 * an unknown path is a typo, and a silent `undefined` reaches the DOM as a
 * missing colour that nobody notices until a screenshot looks wrong.
 */
export function resolveToken(path: TokenPath, theme: ThemeName = "light"): string {
  const found = flattenTheme(theme).find(([key]) => key === path);
  if (!found) throw new Error(`Unknown design token: ${path}`);
  return found[1];
}

/**
 * Which colours are read as text against which background.
 *
 * Only text belongs here. `series.axis` and `series.grid` are decorative
 * strokes on a chart: holding them to a text contrast ratio would darken the
 * chart furniture without making anything more readable.
 *
 * Every pair is checked in both themes, which is the point of the dark entries
 * existing at all — a token set that named dark colours without proving they
 * could be read would be a guess wearing a type.
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
 * The tokens as CSS, one block per theme.
 *
 * Emitted into globals.css as static text rather than injected at runtime: a
 * runtime style block costs bytes on every response and cannot be inspected in
 * a diff. A unit test asserts the committed CSS still matches this output, so
 * editing one without the other fails the build instead of drifting quietly.
 *
 * Dark is selected by `:root[data-theme="dark"]` and nothing else. Not a media
 * query: the reader's choice has to be able to beat the operating system's,
 * and a media query cannot be overridden by a click. Following the system is
 * done by writing `dark` into that attribute, so there is exactly one thing
 * that decides which block applies.
 */
export function cssVariableBlock(): string {
  const declare = (theme: ThemeName) =>
    flattenTheme(theme)
      .map(([path, value]) => `  --ob-${path.replace(".", "-")}: ${value};`)
      .join("\n");
  return `:root {\n${declare("light")}\n}\n\n:root[data-theme="dark"] {\n${declare("dark")}\n}\n`;
}

/**
 * The colour half of the Ant Design theme, for one theme.
 *
 * Only colour lives here. Radius, font and size stay in providers.tsx because
 * they are not tokens this module governs, and moving them would make this the
 * home of settings it has nothing to say about.
 */
export function antdThemeTokens(theme: ThemeName = "light") {
  const t = (path: TokenPath) => resolveToken(path, theme);
  return {
    token: {
      colorPrimary: t("intent.primary"),
      colorInfo: t("intent.primary"),
      colorSuccess: t("intent.success"),
      colorWarning: t("intent.warning"),
      colorError: t("intent.danger"),
      colorBgLayout: t("surface.page"),
      colorTextHeading: t("text.heading"),
    },
    components: {
      Layout: {
        siderBg: t("surface.sider"),
        triggerBg: t("surface.sider"),
        headerBg: t("surface.card"),
      },
      Menu: {
        darkItemBg: t("surface.sider"),
        darkSubMenuItemBg: t("surface.sider"),
        darkItemSelectedBg: t("intent.primary"),
        darkItemColor: t("border.default"),
        darkItemHoverBg: t("text.secondary"),
      },
      Table: {
        headerBg: t("surface.muted"),
        headerColor: t("text.secondary"),
        borderColor: t("border.subtle"),
      },
    },
  };
}
