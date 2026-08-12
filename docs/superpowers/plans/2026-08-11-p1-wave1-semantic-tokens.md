# P1 Wave 1 — Semantic Tokens: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish `lib/design/tokens.ts` as the source of truth for colour, then move **the Ant Design theme and every colour written inline in TSX** onto it.

**Actual scope — corrected after the whole-branch review.** The first draft of this line said "all of One Book's colour", which was an overstatement. This wave removes 71 hex literals from 21 `.tsx` files plus 18 in `providers.tsx`. It does **not** touch the **309 hex literals living in CSS** inside those same two directories:

| File | Hex remaining |
|---|---|
| `app/globals.css` | 225 (excluding the 32 new `:root` lines) |
| `components/work-areas/WorkAreaOverview.module.css` | 84 |

And they are exactly the kind of duplication this wave exists to remove — `#0f766e` alone appears 30 times in `globals.css`. The cause of the miss: the initial survey measured six custom properties in `globals.css` and concluded tokens barely existed, without ever **counting the hex literals in the same file**.

Both files are now in the allowlist of `tests/unit/no-hardcoded-color.test.ts` with counts and reasons, and the guard walks `.css` — before that it matched only `.ts`/`.tsx`, which left the easiest bypass wide open (put the colour in a CSS Module beside the component) and **one component was already using it**.

**Also out of scope:** 64 `<Tag color="red">` call sites use Ant Design's preset scale, generated independently of `colorError`. So `CustomerCreditClient` now renders `#b91c1c` beside `#cf1322` — two reds meaning the same thing on one screen. The "three different reds" problem is half solved; the other half belongs to wave 2's `statusColumn()`.

**Architecture:** A pure module in three layers — palette (raw colour) → semantics (accounting meaning) → emitters (`antdThemeTokens()` for Ant Design, `cssVariableBlock()` for CSS). No I/O, no React, so unit tests hold all of it. Drift is prevented by an equality test rather than by review discipline.

**Tech Stack:** TypeScript 5, Vitest 4 (`environment: "node"`, `include: ["tests/**/*.test.ts"]`), Ant Design 6 `ConfigProvider`, Next.js 16.

## Global Constraints

- The working directory is `ctyhp-accounting/`. Every path below is relative to it.
- Money is integer minor units; this wave does not touch money logic.
- User-facing prose is US English. Code, identifiers and comments are English.
- Comments explain **why**, in the prose style the codebase already uses.
- Never swallow an error (no empty `catch {}`).
- Four mandatory gates before declaring the wave done: `npm run build`, `npm test`, `npm run typecheck`, `npm run lint`.
- Any UI change requires `scripts/smoke-pages.mjs` **against the built server**, not `npm run dev`.
- No force-push. No commits to `main` unless asked — branch first.

## Scope, and the pixel changes that are deliberate

Tasks 1–6 (the foundation) change **no pixels**, because no component is touched.

Tasks 7–10 (the migration) **do** change pixels wherever two colours currently mean the same thing. That is intended, and this is the complete list:

| Current hex | Sites | Consolidated to | Note |
|---|---|---|---|
| `#cf1322` | 11 | `intent.danger` = `#b91c1c` | Ant Design's default red, mixed in with the theme's own |
| `#b42318` | 1 | `intent.danger` = `#b91c1c` | A third red for the same meaning |
| `#389e0d` | 2 | `intent.success` = `#15803d` | Ant Design's default green |
| `#3f8600` | 1 | `intent.success` = `#15803d` | A third green for the same meaning |
| `#047857` | 1 | `intent.success` = `#15803d` | A fourth green for the same meaning |
| `#8c8c8c`, `#999`, `#f5f5f5` | 4 | `text.secondary` / `surface.muted` | Ant Design's default greys |

Chart **series** colours (`series.*`) are carried across unchanged, not consolidated. Choosing a validated categorical scale is a separate decision and is **out of scope for this wave**, because it changes how the charts look rather than fixing drift.

## File Structure

| File | Responsibility |
|---|---|
| `lib/design/palette.ts` (create) | Raw colour values only. No meaning. Nothing outside `tokens.ts` may import it |
| `lib/design/tokens.ts` (create) | The semantic mapping plus the emitters. This is the public API |
| `lib/design/status.tsx` (create) | `statusToken()` returning colour, icon and label. Separate from `tokens.ts` because it holds JSX |
| `tests/unit/design-tokens.test.ts` (create) | Resolution, contrast, `:root` equality, `providers.tsx` free of hex |
| `tests/unit/no-hardcoded-color.test.ts` (create) | The regression guard and its shrinking allowlist |
| `app/providers.tsx` (modify) | Reads `antdThemeTokens()` instead of 18 hex literals |
| `app/globals.css` (modify) | Gains the `:root` block at the top |

**A deliberate divergence from the spec.** Spec section 5 describes `lib/design/tokens.ts` as one file. This plan splits it into three, for two technical reasons that only surfaced while writing the tests:

- `palette.ts` is split out so the assertion "every semantic token resolves to a palette entry" has two genuinely independent sides. In one file, that assertion would only be confirming itself.
- `status.tsx` is split out because it contains JSX, and `tokens.ts` must stay pure to run under the `environment: "node"` Vitest is configured with.

The spec's semantic boundary is unchanged: still one source of truth, just across three files.

**About the "add to the test file" steps:** Tasks 2, 3 and 4 all append to the same `tests/unit/design-tokens.test.ts`. Each task shows the `import` line its new case needs — **merge those into the import block at the top of the file**, do not insert them mid-file. A duplicate import of the same module turns `npm run typecheck` red.

---

### Task 1: Palette and semantic tokens

**Files:**
- Create: `lib/design/palette.ts`
- Create: `lib/design/tokens.ts`
- Test: `tests/unit/design-tokens.test.ts`

**Interfaces:**
- Consumes: nothing (first task)
- Produces:
  - `PALETTE: Record<string, string>` from `lib/design/palette.ts`
  - `TOKENS` with the branches `money`, `intent`, `text`, `surface`, `border`, `series` from `lib/design/tokens.ts`
  - `type TokenPath = string` — a flat key such as `"money.negative"`
  - `resolveToken(path: TokenPath): string`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/design-tokens.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PALETTE } from "@/lib/design/palette";
import { TOKENS, flattenTokens, resolveToken } from "@/lib/design/tokens";

describe("design tokens", () => {
  it("resolves every semantic token to a palette entry", () => {
    // Widened on purpose: PALETTE is `as const`, so an inferred Set would be
    // typed to the literal hexes and refuse the plain string a token carries.
    const paletteValues = new Set<string>(Object.values(PALETTE));
    const orphans = flattenTokens(TOKENS)
      .filter(([, value]) => !paletteValues.has(value))
      .map(([path, value]) => `${path} → ${value}`);
    expect(orphans).toEqual([]);
  });

  it("resolves a token by its dotted path", () => {
    expect(resolveToken("money.negative")).toBe(PALETTE.red700);
    expect(resolveToken("intent.primary")).toBe(PALETTE.teal700);
  });

  it("throws on an unknown token path rather than returning undefined", () => {
    expect(() => resolveToken("money.sideways")).toThrow(/money\.sideways/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/design-tokens.test.ts`
Expected: FAIL — `Cannot find module '@/lib/design/palette'`

- [ ] **Step 3: Write the palette**

Create `lib/design/palette.ts`:

```ts
/**
 * Raw colour values. These carry no meaning on their own — `red700` says what
 * the colour is, never what it is for. Meaning is assigned once, in tokens.ts,
 * so a screen that wants "an overdue amount" cannot pick a different red from
 * the one every other screen uses.
 *
 * To ensure all screens use consistent meanings, application code must import
 * colours only through tokens.ts. This module's tests are exempt: they import
 * from here to verify that every semantic token resolves to a palette entry.
 */
export const PALETTE = {
  // Brand and chrome
  teal700: "#0f766e",
  slate900: "#0f172a",
  slate600: "#475569",
  slate400: "#94a3b8",
  slate200: "#e2e8f0",
  slate100: "#f1f5f9",
  slate50: "#f6f7f9",
  white: "#ffffff",

  // Intent
  red700: "#b91c1c",
  green700: "#15803d",
  amber700: "#b45309",
  orange700: "#c2410c",
  blue700: "#1d4ed8",
  violet600: "#7c3aed",
  sky700: "#0369a1",
} as const;

export type PaletteKey = keyof typeof PALETTE;
```

- [ ] **Step 4: Write the semantic layer**

Create `lib/design/tokens.ts`:

```ts
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/design-tokens.test.ts`
Expected: PASS — 3 tests

- [ ] **Step 6: Commit**

```bash
git add lib/design/palette.ts lib/design/tokens.ts tests/unit/design-tokens.test.ts
git commit -m "feat(design): add palette and semantic colour tokens"
```

---

### Task 2: WCAG AA contrast check

**Files:**
- Modify: `lib/design/tokens.ts` (add `TEXT_ON_SURFACE_PAIRS`)
- Test: `tests/unit/design-tokens.test.ts` (add cases)

**Interfaces:**
- Consumes: `TOKENS`, `resolveToken` (Task 1)
- Produces: `TEXT_ON_SURFACE_PAIRS: readonly [TokenPath, TokenPath][]` — the `[textPath, surfacePath]` pairs that must meet AA

Contrast applies only to **text on a background**. `series.axis` and `series.grid` are decorative strokes, not text; holding them to 4.5:1 would darken the chart furniture without helping anyone read it.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/design-tokens.test.ts`:

```ts
import { TEXT_ON_SURFACE_PAIRS } from "@/lib/design/tokens";

/** WCAG 2.1 relative luminance. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const linear = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("colour contrast", () => {
  it("meets WCAG AA 4.5:1 for every text-on-surface pair", () => {
    const failures = TEXT_ON_SURFACE_PAIRS.map(([textPath, surfacePath]) => {
      const ratio = contrastRatio(resolveToken(textPath), resolveToken(surfacePath));
      // Compare the true ratio and round only for the message. Rounding first
      // would let a pair at 4.4951 read as 4.50 and pass, quietly lowering the
      // one threshold this test exists to hold.
      return { pair: `${textPath} on ${surfacePath}`, ratio, shown: ratio.toFixed(2) };
    }).filter((row) => row.ratio < 4.5);
    expect(failures).toEqual([]);
  });

  it("checks a meaningful number of pairs", () => {
    expect(TEXT_ON_SURFACE_PAIRS.length).toBeGreaterThanOrEqual(10);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/design-tokens.test.ts`
Expected: FAIL — `TEXT_ON_SURFACE_PAIRS` is not exported yet

- [ ] **Step 3: Declare the pairs**

Add to the end of `lib/design/tokens.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/design-tokens.test.ts`
Expected: PASS — 5 tests

If a pair fails, **do not loosen the threshold**. Darken the value in `palette.ts` and record why in a comment.

- [ ] **Step 5: Commit**

```bash
git add lib/design/tokens.ts tests/unit/design-tokens.test.ts
git commit -m "test(design): hold every text-on-surface pair to WCAG AA"
```

---

### Task 3: Emit CSS custom properties and keep globals.css in step

**Files:**
- Modify: `lib/design/tokens.ts` (add `cssVariableBlock`)
- Modify: `app/globals.css` (insert the `:root` block at the top)
- Test: `tests/unit/design-tokens.test.ts`

**Interfaces:**
- Consumes: `flattenTokens` (Task 1)
- Produces: `cssVariableBlock(): string` — the complete `:root` block, ending in a newline

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/design-tokens.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cssVariableBlock } from "@/lib/design/tokens";

describe("CSS custom properties", () => {
  it("names every token as --ob-group-name", () => {
    const block = cssVariableBlock();
    expect(block).toContain("--ob-money-negative: #b91c1c;");
    expect(block).toContain("--ob-intent-primary: #0f766e;");
    expect(block.startsWith(":root {")).toBe(true);
    expect(block.endsWith("}\n")).toBe(true);
  });

  it("matches the block committed in globals.css, value for value", () => {
    const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");
    // Newlines are normalised before comparing. This repository is developed on
    // Windows with core.autocrlf=true, so a fresh clone rewrites globals.css
    // with CRLF while the emitter always produces \n — and the drift this guard
    // exists to catch is a changed colour, not a changed line ending.
    expect(css.replace(/\r\n/g, "\n")).toContain(cssVariableBlock());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/design-tokens.test.ts`
Expected: FAIL — `cssVariableBlock` is not exported yet

- [ ] **Step 3: Write the emitter**

Add to the end of `lib/design/tokens.ts`:

```ts
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
```

- [ ] **Step 4: Paste the block into globals.css**

Insert at the **top** of `app/globals.css`, above the `html, body {` rule. This is the exact output of `cssVariableBlock()` given Task 1's `TOKENS` — 32 lines, in declaration order:

```css
/* Generated from lib/design/tokens.ts. Do not edit by hand — a unit test
   asserts this block still matches cssVariableBlock() exactly, so changing a
   colour means changing the token and copying the new block over. */
:root {
  --ob-money-positive: #15803d;
  --ob-money-negative: #b91c1c;
  --ob-money-zero: #475569;
  --ob-intent-primary: #0f766e;
  --ob-intent-success: #15803d;
  --ob-intent-warning: #b45309;
  --ob-intent-danger: #b91c1c;
  --ob-intent-info: #1d4ed8;
  --ob-text-heading: #0f172a;
  --ob-text-body: #0f172a;
  --ob-text-secondary: #475569;
  --ob-text-onDark: #ffffff;
  --ob-surface-page: #f6f7f9;
  --ob-surface-card: #ffffff;
  --ob-surface-muted: #f1f5f9;
  --ob-surface-sider: #0f172a;
  --ob-border-default: #e2e8f0;
  --ob-border-subtle: #f1f5f9;
  --ob-series-sales: #0f766e;
  --ob-series-purchases: #7c3aed;
  --ob-series-inventory: #0369a1;
  --ob-series-banking: #1d4ed8;
  --ob-series-close: #c2410c;
  --ob-series-governance: #475569;
  --ob-series-other: #94a3b8;
  --ob-series-income: #0f766e;
  --ob-series-expense: #c2410c;
  --ob-series-net: #1d4ed8;
  --ob-series-receivable: #0f766e;
  --ob-series-payable: #7c3aed;
  --ob-series-axis: #94a3b8;
  --ob-series-grid: #e2e8f0;
}
```

If Step 5 reports a mismatch, **do not hand-edit the CSS to chase it**. Run the test with a verbose reporter and replace the whole block with the expected string Vitest prints:

```bash
npx vitest run tests/unit/design-tokens.test.ts --reporter=verbose
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/design-tokens.test.ts`
Expected: PASS — 7 tests

- [ ] **Step 6: Commit**

```bash
git add lib/design/tokens.ts app/globals.css tests/unit/design-tokens.test.ts
git commit -m "feat(design): emit tokens as CSS custom properties, guarded by test"
```

---

### Task 4: Wire providers.tsx to the tokens

**Files:**
- Modify: `app/providers.tsx:17-53`
- Modify: `lib/design/tokens.ts` (add `antdThemeTokens`)
- Test: `tests/unit/design-tokens.test.ts`

**Interfaces:**
- Consumes: `TOKENS` (Task 1)
- Produces: `antdThemeTokens(): { token: Record<string, unknown>; components: Record<string, unknown> }`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/design-tokens.test.ts`:

```ts
import { antdThemeTokens } from "@/lib/design/tokens";

describe("Ant Design theme", () => {
  it("derives its colours from the tokens", () => {
    const theme = antdThemeTokens();
    expect(theme.token.colorPrimary).toBe(resolveToken("intent.primary"));
    expect(theme.token.colorError).toBe(resolveToken("intent.danger"));
    expect(theme.components.Layout.siderBg).toBe(resolveToken("surface.sider"));
  });

  it("leaves no literal colour in providers.tsx", () => {
    const source = readFileSync(join(process.cwd(), "app", "providers.tsx"), "utf8");
    expect(source.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
  });

  it("keeps the theme settings that are not colours and so live only there", () => {
    const source = readFileSync(join(process.cwd(), "app", "providers.tsx"), "utf8");
    // Dimensions and typography are deliberately outside antdThemeTokens(),
    // which governs colour alone. That leaves providers.tsx as their only
    // home, so a rewrite can drop one and nothing else notices: moving the
    // theme onto tokens silently lost headerHeight and every page rendered
    // fine with the wrong header height.
    for (const setting of [
      "borderRadius: 8",
      "fontSize: 14",
      "wireframe: false",
      "headerHeight: 56",
      "borderRadiusLG: 12",
      "fontFamily: SANS",
    ]) {
      expect(source).toContain(setting);
    }

    // The mirror of the same bug. Restoring headerHeight means writing a
    // `Layout` key, and a `Layout` key written without spreading the token one
    // drops siderBg, triggerBg and headerBg instead — silently, because every
    // page still renders and the settings above are all still present.
    expect(source).toContain("...components.Layout");
    expect(source).toContain("...components,");
    expect(source).toContain("...token,");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/design-tokens.test.ts`
Expected: FAIL — `antdThemeTokens` is not exported, and `providers.tsx` still holds 18 hex literals

- [ ] **Step 3: Write the emitter**

Add to the end of `lib/design/tokens.ts`:

```ts
/**
 * The colour half of the Ant Design theme.
 *
 * Only colour lives here. Radius, font and size stay in providers.tsx because
 * they are not tokens this module governs, and moving them would make this the
 * home of settings it has nothing to say about.
 */
export function antdThemeTokens() {
  return {
    token: {
      colorPrimary: TOKENS.intent.primary,
      colorInfo: TOKENS.intent.primary,
      colorSuccess: TOKENS.intent.success,
      colorWarning: TOKENS.intent.warning,
      colorError: TOKENS.intent.danger,
      colorBgLayout: TOKENS.surface.page,
      colorTextHeading: TOKENS.text.heading,
    },
    components: {
      Layout: {
        siderBg: TOKENS.surface.sider,
        triggerBg: TOKENS.surface.sider,
        headerBg: TOKENS.surface.card,
      },
      Menu: {
        darkItemBg: TOKENS.surface.sider,
        darkSubMenuItemBg: TOKENS.surface.sider,
        darkItemSelectedBg: TOKENS.intent.primary,
        darkItemColor: TOKENS.border.default,
        darkItemHoverBg: TOKENS.text.secondary,
      },
      Table: {
        headerBg: TOKENS.surface.muted,
        headerColor: TOKENS.text.secondary,
        borderColor: TOKENS.border.subtle,
      },
    },
  };
}
```

**Pixel changes — FIVE values, not three.** This plan's first inventory undercounted; the Task 4 review found the remaining two. All five were one-off shades belonging to no scale:

| Property | Old | New | Effect |
|---|---|---|---|
| `Layout.triggerBg` | `#0b1220` | `surface.sider` `#0f172a` | Was already all but identical to siderBg (1.05:1) |
| `Menu.darkItemColor` | `#cbd5e1` | `border.default` `#e2e8f0` | 14.5:1 against the sider |
| `Menu.darkItemHoverBg` | `#1e293b` | `text.secondary` `#475569` | Hover is now **clearer** than before (2.4:1 versus 1.2:1) |
| `Table.headerColor` | `#334155` | `text.secondary` `#475569` | Contrast 9.5:1 → 6.9:1, still comfortably AA |
| `Table.borderColor` | `#eef2f6` | `border.subtle` `#f1f5f9` | 3/255 per channel; invisible |

All five were accepted deliberately. The reasoning for `Table.headerColor`: a column heading is a secondary label, so `text.secondary` is the semantically correct token; the old `#334155` was an arbitrary shade. **Do not** add new palette entries merely to preserve an old shade — that is exactly what this wave removes.

**One thing `antdThemeTokens()` must not carry: non-colour values.** `Layout.headerHeight: 56` was lost for exactly this reason when the theme moved onto tokens, and every page still rendered fine with the wrong header height. Keep them in `providers.tsx`, and spread over `components.Layout` so the colours survive:

```tsx
components: {
  ...components,
  Layout: { ...components.Layout, headerHeight: 56 },
  Card: { borderRadiusLG: 12 },
},
```

- [ ] **Step 4: Rewrite providers.tsx**

Replace `app/providers.tsx` with:

```tsx
"use client";
import { App, ConfigProvider, theme as antdTheme } from "antd";
import enUS from "antd/locale/en_US";
import { antdThemeTokens } from "@/lib/design/tokens";

const SANS =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/**
 * App-wide Ant Design context: English locale, a disciplined enterprise theme
 * (teal primary, slate chrome), and App context for message/modal.
 * Uses a native font stack — zero web-font requests keeps first paint fast.
 *
 * Every colour comes from lib/design/tokens.ts. A literal here would be a
 * second source of truth for a colour the rest of the app reads from there,
 * and a unit test refuses one.
 */
export default function Providers({ children }: { children: React.ReactNode }) {
  const { token, components } = antdThemeTokens();
  return (
    <ConfigProvider
      locale={enUS}
      theme={{
        algorithm: antdTheme.defaultAlgorithm,
        token: { ...token, borderRadius: 8, fontFamily: SANS, fontSize: 14, wireframe: false },
        components: {
          ...components,
          // The tokens give Layout its colours; the header's height is a
          // dimension, so it stays here with the other non-colour settings
          // rather than moving into a module that governs colour alone.
          // Spreading over components.Layout keeps those colours.
          Layout: { ...components.Layout, headerHeight: 56 },
          Card: { borderRadiusLG: 12 },
        },
      }}
    >
      <App>{children}</App>
    </ConfigProvider>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/design-tokens.test.ts`
Expected: PASS — 10 tests

- [ ] **Step 6: Verify the app still renders**

```bash
npm run build
npm start
node --env-file=.env.local scripts/smoke-pages.mjs http://localhost:3000
```

Expected: every page renders, 0 failures. Stop the server afterwards.

Note: `npm start` launched from an agent's shell dies mid-sweep. Start it detached (on Windows, PowerShell `Start-Process`) and pass `--concurrency=2`. A run of `fetch failed` results means the server died, not that the pages regressed.

- [ ] **Step 7: Commit**

```bash
git add lib/design/tokens.ts app/providers.tsx tests/unit/design-tokens.test.ts
git commit -m "refactor(design): derive the Ant Design theme from tokens"
```

---

### Task 5: statusToken — colour never travels alone

**Files:**
- Create: `lib/design/status.tsx`
- Test: `tests/unit/design-status.test.ts`

**Interfaces:**
- Consumes: `TOKENS` (Task 1)
- Produces:
  - `type StatusKey = "posted" | "void" | "draft" | "overdue" | "pending"`
  - `statusToken(key: StatusKey): { color: string; icon: ReactNode; label: string }`
  - `StatusBadge({ status }: { status: StatusKey })`

This is where the accessibility rule becomes structure. Note the correction recorded in the spec: returning a triple from `statusToken` is a *convention*, not structure, because `.color` is still a one-liner. `StatusBadge` is the structural answer, and it is the default path for screens.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/design-status.test.ts`:

```ts
import { isValidElement } from "react";
import { describe, expect, it } from "vitest";
import { STATUS_KEYS, StatusBadge, statusToken } from "@/lib/design/status";
import { TOKENS } from "@/lib/design/tokens";

describe("status tokens", () => {
  it("returns a colour, an icon and a label for every status", () => {
    for (const key of STATUS_KEYS) {
      const token = statusToken(key);
      expect(token.color).toMatch(/^#[0-9a-f]{6}$/i);
      // Not `toBeTruthy`: under environment "node" any non-null value passes
      // that, including a stray string, so it would prove nothing.
      expect(isValidElement(token.icon)).toBe(true);
      expect(token.label.length).toBeGreaterThan(0);
    }
  });

  it("gives each status a distinct icon, which is what separates void from draft", () => {
    const types = STATUS_KEYS.map((key) => {
      const icon = statusToken(key).icon;
      if (!isValidElement(icon)) throw new Error(`Status ${key} carries no icon element`);
      return icon.type;
    });
    expect(new Set(types).size).toBe(STATUS_KEYS.length);
  });

  it("gives overdue the danger colour and void a muted one", () => {
    expect(statusToken("overdue").color).toBe(TOKENS.intent.danger);
    expect(statusToken("void").color).toBe(TOKENS.text.secondary);
  });

  it("gives each status a distinct label so colour is never the only signal", () => {
    const labels = STATUS_KEYS.map((key) => statusToken(key).label);
    expect(new Set(labels).size).toBe(STATUS_KEYS.length);
  });
});

describe("StatusBadge", () => {
  it("carries the icon and the wording, not the colour alone", () => {
    for (const key of STATUS_KEYS) {
      const badge = StatusBadge({ status: key });
      const [icon, label] = badge.props.children as [unknown, string];
      expect(isValidElement(icon)).toBe(true);
      expect(label).toBe(statusToken(key).label);
      expect(badge.props.style.color).toBe(statusToken(key).color);
    }
  });

  it("tells void and draft apart even though they share a colour", () => {
    const voidBadge = StatusBadge({ status: "void" });
    const draftBadge = StatusBadge({ status: "draft" });
    expect(voidBadge.props.style.color).toBe(draftBadge.props.style.color);

    const [voidIcon, voidLabel] = voidBadge.props.children as [{ type: unknown }, string];
    const [draftIcon, draftLabel] = draftBadge.props.children as [{ type: unknown }, string];
    expect(voidIcon.type).not.toBe(draftIcon.type);
    expect(voidLabel).not.toBe(draftLabel);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/design-status.test.ts`
Expected: FAIL — `Cannot find module '@/lib/design/status'`

- [ ] **Step 3: Write the implementation**

Create `lib/design/status.tsx`:

```tsx
import type { ReactNode } from "react";
import {
  CheckCircleFilled,
  ClockCircleFilled,
  EditFilled,
  ExclamationCircleFilled,
  StopFilled,
} from "@ant-design/icons";
import { TOKENS } from "./tokens";

/**
 * A document status, and the three things a reader needs to tell it apart.
 *
 * Colour alone fails anyone who cannot distinguish the hues, and it fails
 * everyone in a printed report. `void` and `draft` make that concrete here:
 * they deliberately share one muted colour, because a document that is off the
 * ledger reads the same either way — only the icon and the wording separate
 * them.
 *
 * `StatusBadge` below is therefore the way to show a status, and `statusToken`
 * is the exception for the few places that need a raw colour and nothing else
 * (a total tinted by whether it is overdue, say). Reaching for the token where
 * a badge would do is how a status ends up shown in colour alone.
 */
export const STATUS_KEYS = ["posted", "void", "draft", "overdue", "pending"] as const;

export type StatusKey = (typeof STATUS_KEYS)[number];

export interface StatusToken {
  color: string;
  icon: ReactNode;
  label: string;
}

const STATUS: Record<StatusKey, StatusToken> = {
  posted: { color: TOKENS.intent.success, icon: <CheckCircleFilled />, label: "Posted" },
  void: { color: TOKENS.text.secondary, icon: <StopFilled />, label: "Void" },
  draft: { color: TOKENS.text.secondary, icon: <EditFilled />, label: "Draft" },
  overdue: { color: TOKENS.intent.danger, icon: <ExclamationCircleFilled />, label: "Overdue" },
  pending: { color: TOKENS.intent.warning, icon: <ClockCircleFilled />, label: "Pending" },
};

export function statusToken(key: StatusKey): StatusToken {
  return STATUS[key];
}

/**
 * A status shown the way a status should be shown: icon, wording and colour
 * together.
 *
 * This exists so that showing a status correctly is less work than showing it
 * incorrectly. Composing the three parts by hand at every call site is what
 * lets one screen quietly drop the icon, and the reader who cannot tell the two
 * muted greys apart never learns which document was voided.
 *
 * Styled inline rather than through a class so the badge carries its own
 * appearance wherever it is dropped, and so this module keeps its single
 * dependency on the icon set.
 */
export function StatusBadge({ status }: { status: StatusKey }) {
  const { color, icon, label } = statusToken(status);
  return (
    <span style={{ color, display: "inline-flex", alignItems: "center", gap: 6 }}>
      {icon}
      {label}
    </span>
  );
}
```

- [ ] **Step 4: Allow JSX in the test transform**

`vitest.config.ts` has no JSX handling, and this is the first `.tsx` file a unit test imports. This Vite builds with Rolldown, where the `esbuild` config block is a deprecated shim whose types come from a package that is not installed — setting it needs an `as any` that switches off checking for the whole block. Use the natively-typed `oxc` field instead:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  oxc: {
    // lib/design/status.tsx carries JSX. React 19's automatic runtime means no
    // React import is needed in the source file.
    //
    // Configured through `oxc`, not `esbuild`: this Vite builds with Rolldown,
    // where the `esbuild` block is a deprecated shim it converts internally —
    // and whose types come from a package that is not even installed here.
    jsx: { runtime: "automatic" },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
```

`vitest.config.ts` is shared by every test file. After changing it, run the **full** suite, not just this test, and confirm the count did not drop.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/design-status.test.ts`
Expected: PASS — 6 tests

- [ ] **Step 6: Commit**

```bash
git add lib/design/status.tsx tests/unit/design-status.test.ts vitest.config.ts
git commit -m "feat(design): pair every status colour with an icon and a label"
```

---

### Task 6: The regression guard and its allowlist

**Files:**
- Create: `tests/unit/no-hardcoded-color.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: the allowlist that Tasks 7–10 shrink

The guard goes on **now**, while 21 files are still in debt, so the gate stays green throughout and the remaining debt is a readable list.

- [ ] **Step 1: Write the test with the current offenders listed**

Create `tests/unit/no-hardcoded-color.test.ts`:

```ts
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Colour belongs in lib/design/tokens.ts and nowhere else.
 *
 * Every hex below is a hand-copied duplicate of a value the theme already
 * defines, which is how three different reds all came to mean "error". The
 * allowlist is the work still outstanding: it shrinks with each migration
 * batch. A file may not be added back.
 *
 * Stylesheets are in scope too, and that is not a formality: walking only .ts
 * and .tsx leaves the easiest bypass wide open — put the colour in a CSS Module
 * beside the component.
 *
 * Excluded on purpose, and not listed: lib/client/invoice-pdf.ts and
 * lib/client/report-export.ts. Colours inside a generated PDF or an XLSX cell
 * are not CSS and never derive from the theme.
 */
const ALLOWLIST = new Set([
  "app/(app)/dashboard/DashboardClient.tsx",
  "components/charts/FinancialCharts.tsx",
  "components/payables/PayRunPanel.tsx",
  "app/(app)/reports/transactions/TransactionListClient.tsx",
  "components/feedback/ReportDialog.tsx",
  "app/(app)/reports/inventory-review/InventoryReviewClient.tsx",
  "app/(app)/reports/gl-posting/GlPostingClient.tsx",
  "app/(app)/reports/customer-credit/CustomerCreditClient.tsx",
  "app/(app)/reports/cash-flow-forecast/CashFlowForecastClient.tsx",
  "app/(app)/fixed-assets/FixedAssetsClient.tsx",
  "app/(auth)/login/page.tsx",
  "app/(app)/settings/import/ImportPreviewPanel.tsx",
  "app/(app)/reports/saved/SavedReportsClient.tsx",
  "app/(app)/reports/saved/SaveReportModal.tsx",
  "app/(app)/reports/number-sequence/NumberSequenceClient.tsx",
  "app/(app)/reports/fixed-assets/FixedAssetReportClient.tsx",
  "app/(app)/reports/1099/Report1099Client.tsx",
  "app/(app)/recurring/RecurringClient.tsx",
  "app/(app)/banking/BankingClient.tsx",
  "app/(app)/banking/BankTransactionsTable.tsx",
  "app/(app)/accounts/AccountsClient.tsx",
  // The two stylesheets this wave does not convert. Listed rather than skipped,
  // because debt nobody can see is debt nobody pays.
  "app/globals.css",
  "components/work-areas/WorkAreaOverview.module.css",
]);

/**
 * Built fresh on each use, never shared.
 *
 * A regex literal with the `g` flag carries `lastIndex` between calls, so
 * `.test()` on the same pattern alternates true and false across files and
 * quietly clears half the offenders. This guard exists to be trusted, so it
 * does not reuse one.
 */
const hexPattern = () => /#[0-9a-fA-F]{3,8}\b/;
const ROOT = process.cwd();

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(tsx?|css)$/.test(entry)) out.push(full);
  }
  return out;
}

const files = [...sourceFiles(join(ROOT, "app")), ...sourceFiles(join(ROOT, "components"))];

function relativePath(file: string): string {
  return relative(ROOT, file).replaceAll("\\", "/");
}

describe("hard-coded colour", () => {
  it("finds files to check", () => {
    expect(files.length).toBeGreaterThan(150);
  });

  it("walks stylesheets, not only TypeScript", () => {
    expect(files.some((file) => file.endsWith(".css"))).toBe(true);
  });

  it("appears in no file outside the shrinking allowlist", () => {
    const offenders = files
      .map((file) => ({ path: relativePath(file), source: readFileSync(file, "utf8") }))
      .filter(({ path }) => !ALLOWLIST.has(path))
      .filter(({ source }) => hexPattern().test(source))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it("lists no file that has already been converted", () => {
    const stale = [...ALLOWLIST].filter(
      (path) => !hexPattern().test(readFileSync(join(ROOT, path), "utf8")),
    );
    expect(stale).toEqual([]);
  });
});
```

The last case is the important one: it **forces the allowlist to shrink**. Clean a file but forget to delete its entry and the test goes red, so the list cannot inflate into a lie.

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run tests/unit/no-hardcoded-color.test.ts`
Expected: PASS. `providers.tsx` was cleaned in Task 4, so it is correctly absent from the list.

- [ ] **Step 3: Prove the guard bites**

Temporarily add a hex literal to any file NOT on the allowlist, confirm the test fails and names that file, then revert. Confirm `git status` is clean before committing.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/no-hardcoded-color.test.ts
git commit -m "test(design): guard against hard-coded colour, with a shrinking allowlist"
```

---

## Tasks 7–10: Migration by area

The four remaining tasks share **one procedure**. It is written out in full here because the implementer may read the tasks out of order.

### The procedure, per file

1. Open the file and find every hex with `#[0-9a-fA-F]{3,8}\b`
2. Look the value up in the mapping table below
3. Replace with `TOKENS.<group>.<name>`, adding `import { TOKENS } from "@/lib/design/tokens";`
4. If the hex marks a **document status**, use `StatusBadge` rather than a bare colour, so the icon and the wording come with it
5. Delete the file's path from `ALLOWLIST` in `tests/unit/no-hardcoded-color.test.ts`
6. Run `npx vitest run tests/unit/no-hardcoded-color.test.ts` — it must PASS
7. Commit

### The complete mapping

| Hex | Token | Note |
|---|---|---|
| `#b91c1c`, `#cf1322`, `#b42318` | `TOKENS.intent.danger` | Three reds consolidated |
| `#15803d`, `#389e0d`, `#3f8600`, `#047857` | `TOKENS.intent.success` | Four greens consolidated |
| `#b45309`, `#d46b08` | `TOKENS.intent.warning` | |
| `#7c3aed` | `TOKENS.series.purchases` | |
| `#0369a1` | `TOKENS.series.inventory` | |
| `#475569`, `#8c8c8c`, `#999` | `TOKENS.text.secondary` | |
| `#f1f5f9`, `#f5f5f5` | `TOKENS.surface.muted` | |
| `#e5e7eb` | `TOKENS.border.default` | |

A signed amount uses `TOKENS.money.negative` / `TOKENS.money.positive`, **not** `intent.danger` / `intent.success`. A negative number is not an error, and the name is what carries that meaning.

### Where one hex means two different things

These values appear in several places with different meanings, so they have no single mapping. Here is the exact address of each, so nothing has to be guessed:

| File:line | Hex | Token |
|---|---|---|
| `DashboardClient.tsx:281` | `#0f766e` | `TOKENS.intent.primary` |
| `DashboardClient.tsx:566` | `#0f766e` | `TOKENS.series.sales` |
| `FinancialCharts.tsx:12` | `#0f766e` | `TOKENS.series.income` |
| `FinancialCharts.tsx:15` | `#0f766e` | `TOKENS.series.receivable` |
| `DashboardClient.tsx:293` | `#1d4ed8` | `TOKENS.intent.info` |
| `DashboardClient.tsx:569` | `#1d4ed8` | `TOKENS.series.banking` |
| `FinancialCharts.tsx:14` | `#1d4ed8` | `TOKENS.series.net` |
| `DashboardClient.tsx:287` | `#c2410c` | `TOKENS.intent.warning` |
| `DashboardClient.tsx:570` | `#c2410c` | `TOKENS.series.close` |
| `FinancialCharts.tsx:13` | `#c2410c` | `TOKENS.series.expense` |
| `DashboardClient.tsx:572` | `#94a3b8` | `TOKENS.series.other` |
| `FinancialCharts.tsx:138` | `#94a3b8` | `TOKENS.series.axis` |
| `FinancialCharts.tsx:125` | `#e2e8f0` | `TOKENS.series.grid` |
| `FinancialCharts.tsx:188` | `#ffffff` | `TOKENS.text.onDark` |

Line numbers were taken before the wave began; if they have drifted, match on the hex value and its surrounding context rather than editing blind by line number.

Every other hex is unambiguous and resolves from the mapping table above.

### Task 7: Charts and dashboard

**Files:**
- Modify: `app/(app)/dashboard/DashboardClient.tsx` (13 hex, lines 281–323 and 566–572)
- Modify: `components/charts/FinancialCharts.tsx` (11 hex, lines 12–19, 125, 138, 188)
- Test: `tests/unit/no-hardcoded-color.test.ts` (remove 2 entries from the allowlist)

These two files keep **their own overlapping category maps** — `sales: #0f766e` in one and `income: #0f766e` in the other. After the migration both read from `TOKENS.series`, and the duplication becomes visible for a later decision.

- [ ] **Step 1:** Migrate `DashboardClient.tsx` following the procedure above
- [ ] **Step 2:** Migrate `FinancialCharts.tsx` following the procedure above
- [ ] **Step 3:** Remove both paths from `ALLOWLIST`
- [ ] **Step 4:** Run: `npx vitest run tests/unit/no-hardcoded-color.test.ts` — Expected: PASS
- [ ] **Step 5:** Commit

```bash
git add app/\(app\)/dashboard/DashboardClient.tsx components/charts/FinancialCharts.tsx tests/unit/no-hardcoded-color.test.ts
git commit -m "refactor(design): read chart and dashboard colour from tokens"
```

### Task 8: Reports

**Files:** ten paths under `app/(app)/reports/` — `transactions`, `inventory-review`, `gl-posting`, `customer-credit`, `cash-flow-forecast`, `saved/SavedReportsClient`, `saved/SaveReportModal`, `number-sequence`, `fixed-assets`, `1099`. Roughly 18 hex literals; two of them are ternaries carrying two hexes on one line, so a count by location gives a smaller number than a count by literal.

- [ ] **Step 1:** Migrate each file. `TransactionListClient.tsx:249` (`amount < 0 ? "#b91c1c" : "#15803d"`) becomes `TOKENS.money.negative` / `TOKENS.money.positive`, **not** `intent.*`
- [ ] **Step 2:** Remove the cleaned paths from `ALLOWLIST`
- [ ] **Step 3:** Run: `npx vitest run tests/unit/no-hardcoded-color.test.ts` — Expected: PASS
- [ ] **Step 4:** Commit `refactor(design): read report colour from tokens`

### Task 9: Operational screens

**Files:** `components/payables/PayRunPanel.tsx`, `app/(app)/fixed-assets/FixedAssetsClient.tsx`, `app/(app)/recurring/RecurringClient.tsx`, `app/(app)/banking/BankingClient.tsx`, `app/(app)/banking/BankTransactionsTable.tsx`, `app/(app)/accounts/AccountsClient.tsx` — nine locations, eleven literals.

- [ ] **Step 1:** Migrate each file. `PayRunPanel.tsx:80` is the overdue total: a `Statistic`'s `valueStyle` cannot hold JSX, but its `prefix` prop can, so pass `statusToken("overdue").icon` there rather than showing colour alone
- [ ] **Step 2:** Remove the six paths from `ALLOWLIST`
- [ ] **Step 3:** Run: `npx vitest run tests/unit/no-hardcoded-color.test.ts` — Expected: PASS
- [ ] **Step 4:** Commit `refactor(design): read operational screen colour from tokens`

### Task 10: The last files, and retiring the TSX half of the allowlist

**Files:** `components/feedback/ReportDialog.tsx` (2), `app/(auth)/login/page.tsx` (1), `app/(app)/settings/import/ImportPreviewPanel.tsx` (1)

- [ ] **Step 1:** Migrate the last three files
- [ ] **Step 2:** Remove their three paths from `ALLOWLIST`, leaving only the two stylesheets
- [ ] **Step 3:** Run: `npx vitest run tests/unit/no-hardcoded-color.test.ts` — Expected: PASS
- [ ] **Step 4:** Run all four gates

```bash
npm run typecheck && npm test && npm run lint && npm run build
```

Expected: all four green. **Paste the output verbatim, never trimmed** — the pass/fail line is usually at the end.

- [ ] **Step 5:** Confirm against the real app

```bash
npm start
node --env-file=.env.local scripts/smoke-pages.mjs http://localhost:3000 --concurrency=2
```

Expected: every page renders, 0 failures.

- [ ] **Step 6:** Re-measure quality

```bash
npm run quality:bundle
```

Expected: within budget (10% or 20 KB gzip). This wave does not aim to reduce the bundle; the measurement is to be sure it did not **grow**.

- [ ] **Step 7:** Commit

```bash
git add -A
git commit -m "refactor(design): finish the colour migration and retire the allowlist"
```

---

## Wave 1 acceptance criteria

- [ ] No hex literal in `app/` or `components/` outside the two allowlisted stylesheets
- [ ] The allowlist holds exactly `app/globals.css` and `components/work-areas/WorkAreaOverview.module.css`, each with its count and reason
- [ ] The guard walks `.ts`, `.tsx` **and** `.css`, and has been shown to fail when a new file carries a hex
- [ ] The WCAG AA contrast test green over ≥ 10 pairs
- [ ] The `:root` block in `globals.css` matches `cssVariableBlock()`
- [ ] All four gates green, output pasted verbatim
- [ ] `scripts/smoke-pages.mjs` green against the built server
- [ ] `npm run quality:bundle` within budget
