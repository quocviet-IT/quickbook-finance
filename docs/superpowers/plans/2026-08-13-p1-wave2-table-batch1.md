# P1 Wave 2 — Table, batch 1: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the column kit, the URL-state hook and the two-mode `DataTable` contract that the 49 files still using a raw Ant Design `Table` will later migrate onto — without changing a single screen in this batch.

**Architecture:** The reuse lives in the columns, not the table. Rules that can be decided without JSX — how money reads, what a status tone means, what a URL parameter parses to — are pure modules under `lib/domain/`; the JSX builders are thin wrappers in `components/ui/columns.tsx`. `DataTable` gains a two-mode data contract so a later move to server-side paging changes the data source and not the screen.

**Tech Stack:** TypeScript 5, Vitest 4 (`environment: "node"`, no DOM), Ant Design 6, Next.js 16 App Router, Zod 4.

## Global Constraints

- The working directory is `ctyhp-accounting/`. Every path below is relative to it.
- Money is integer minor units end-to-end; only the display edge converts.
- User-facing prose is US English. Code, identifiers, comments and documentation are English.
- Comments explain **why**, in the prose style the codebase already uses.
- Never swallow an error. Validating untrusted input is not swallowing.
- No hard-coded colour. `tests/unit/no-hardcoded-color.test.ts` fails on a hex literal under `app/` or `components/`; take colour from `@/lib/design/tokens`.
- A Server Component must never read an Ant Design sub-component. Everything built here is for Client Components.
- Four mandatory gates before declaring done: `npm run build`, `npm test`, `npm run typecheck`, `npm run lint`.
- No Claude/AI attribution in commit messages. No force-push. Stage files individually, never `git add -A`.

### What this project's test setup will and will not do

All three were verified by running them before this plan was written. They are
not preferences; each one silently produces a wrong result if ignored.

- **Test files must be `.ts`.** `vitest.config.ts` includes `tests/**/*.test.ts`,
  so a `.tsx` test is not run at all — vitest prints "No test files found", which
  reads like a tooling hiccup rather than a skipped suite. No JSX in any test
  here. Build elements with `createElement` if one is ever needed.
- **Never import an Ant Design *runtime* module into a test.** Importing
  `components/ui/DataTable.tsx` costs **55 seconds**; a module whose Ant Design
  import is `import type` costs **0.4**. This is why `resolveTableData` gets its
  own file in Task 6. `@ant-design/icons` is separate and cheap (2.8s), which is
  what makes `lib/design/status.tsx` and the new `tone.tsx` testable as they are.
- **React 19 narrows `isValidElement` to `props: unknown`.** Reading
  `element.props.style` after an `isValidElement` guard fails `npm run typecheck`.
  Task 3 carries an `asElement` helper that types the props through the
  narrowing; copy it rather than reinventing a cast.

## Measured before this plan was written

| Fact | Value |
|---|---|
| Files using a raw `<Table>` rather than `DataTable` | 49 (measured as 47 here; the survey pattern missed `<Table.Summary>` — see Task 7) |
| `formatMoney` call sites | 119, across 25 files |
| `align: "right"` written by hand | 173 |
| `<Tag color="…">` using Ant Design's preset scale | 64 |
| `pagination={false}` | 61 |
| Files reading `useSearchParams` | 1 — URL state effectively does not exist |
| Date helper in `lib/` | none; dates render as raw ISO strings |
| Distinct status **types** in `lib/db/types.ts` | 23, carrying roughly 40 distinct values |

Two of these shaped the design:

**Money carries its currency per row.** The existing shape is
`render: (v, r) => fmt(v, r.currency_code)` — the currency comes off the record,
not from a global. A column builder that assumed one company currency would be
wrong on every multi-currency screen.

**There is no single status vocabulary, and there cannot be one.** The 23 status
types belong to different domains — an invoice's `partial`, a user's
`offboarded`, a bank connection's `attention_required`. Spec §6 said
`statusColumn()` would use `statusToken()`, but that knows five document
statuses. So the kit defines a small set of visual **tones** and each screen
declares which of its own statuses reads as which tone.

## File Structure

| File | Responsibility |
|---|---|
| `lib/domain/money-display.ts` (create) | Pure: what a money cell says, how it is spoken, and whether it is negative |
| `lib/design/tone.tsx` (create) | The visual vocabulary: five tones, each with a colour, an icon and a label |
| `lib/design/status.tsx` (modify) | Re-expressed on top of tones, so there is one visual language rather than two |
| `lib/domain/table-url-state.ts` (create) | Pure: parse and serialise table state to and from URL parameters |
| `lib/client/use-table-url-state.ts` (create) | The hook, and the client/server difference in how the URL is written |
| `components/ui/columns.tsx` (create) | The column builders — where the duplication actually is |
| `components/ui/table-data.ts` (create) | The two-mode rule, kept free of Ant Design's runtime so it can be tested |
| `components/ui/DataTable.tsx` (modify) | The component, wired to that rule |
| `components/ui/ReportTable.tsx` (create) | The variant for the six report tables that carry a summary row |
| `tests/unit/money-display.test.ts` (create) | The money rules |
| `tests/unit/tone.test.ts` (create) | The tone vocabulary, and that status still behaves as before |
| `tests/unit/table-url-state.test.ts` (create) | Parsing, serialising, and junk falling back |
| `tests/unit/columns.test.ts` (create) | The builders, by inspecting the elements they return |
| `tests/unit/data-table-contract.test.ts` (create) | The two-mode rule, and that `dataSource` still works |
| `tests/unit/table-adoption.test.ts` (create) | The shrinking allowlist of screens still on a raw table |

**No screen changes in this batch.** Every task here ends with the app rendering
exactly as it does now. Migration is batches 2 onward.

### Deliberate deviations from spec §6

Seven, each with its reason. None changes what the wave delivers; they change how
the pieces are cut.

1. **`statusColumn` takes a per-screen tone map, not `statusToken()`.** The spec
   assumed one status vocabulary. There are 23 status types carrying about 40
   values across different domains, and `statusToken` knows five. Approved as a
   change of shape before this plan was written.
2. **A `tone` module is added, and `status.tsx` is re-expressed on it.** Not in
   the spec. Without it the application would carry two visual vocabularies —
   the five statuses and the new tones — which is the drift this programme
   exists to remove.
3. **The pure rules are split out of the hook.** The spec listed one
   `lib/client/table-url-state.ts`; this plan puts the parsing in
   `lib/domain/table-url-state.ts` and the hook in
   `lib/client/use-table-url-state.ts`, because this project has no DOM in its
   test environment and only the pure half can be tested.
4. **The `pagination={false}` guard moves to batch 2.** The spec put both guards
   in batch 1. But that allowlist needs a written reason per entry — 61 of them
   — and a reason can only be written by someone reading what the table
   actually holds. Writing 61 reasons for code nobody is touching would produce
   61 guesses. Batch 2 migrates those screens and can judge each one, so the
   guard lands with the judgement. Batch 1 lands the raw-`<Table>` guard, which
   needs no per-file reasoning.

The last three were not written here when the batch was planned. The
whole-branch review found them, and found this list presenting itself as
complete while three more existed — which is the more useful finding of the two.

5. **`actionsColumn` does not route through `IconActionButton`.** The spec
   promised it would, inheriting a 44×44 target from wave 3. The shipped shape —
   `actions: (record) => ReactNode[]` — is the better design, because screens
   need `Popconfirm`, `Dropdown` and plain buttons too. But it makes the 44×44
   guarantee each caller's problem on 47 screens, and nothing said so until now.
   Task 3's `Consumes` line named `IconActionButton` as a dependency the code
   never had; that line has been corrected.
6. **A negative amount is marked by sign and colour, not sign and icon.** The
   spec asked for an icon. The minus sign in the text satisfies the underlying
   rule — it survives a printout and a colour-blind reader — and an icon in every
   money cell would be noise. Recorded, not changed.
7. **Sorting runs through `useTableUrlState` only as of Task 8.** Batch 1
   originally shipped the URL vocabulary for sort with nothing to produce or
   consume it; Task 8's Step 6 closes that.

**Testing constraint that shapes every test below:** this project has no
`jsdom`, no `happy-dom` and no `@testing-library/react` — Vitest runs with
`environment: "node"`. So a column's `render` is tested by **inspecting the React
element it returns**, not by rendering it to HTML. `tests/unit/design-status.test.ts`
already does this; follow it. Do not add a DOM dependency for this.

---

### Task 1: What a money cell says

**Files:**
- Create: `lib/domain/money-display.ts`
- Test: `tests/unit/money-display.test.ts`

**Interfaces:**
- Consumes: `formatMoney` from `@/lib/format` (existing, `formatMoney(minor, currencyCode, decimals)`)
- Produces:
  - `type MoneySign = "negative" | "zero" | "positive"`
  - `interface MoneyDisplay { text: string; ariaLabel: string; sign: MoneySign }`
  - `moneyDisplay(minor: number, currencyCode: string, decimals: number): MoneyDisplay`

**`decimals` is required, deliberately.** `formatMoney` has no default either,
and the reason is arithmetic: `formatMoney` computes `minor / 10 ** decimals`,
so a wrong `decimals` moves the decimal point. Measured — `moneyDisplay(500,
"VND")` under a default of 2 renders **`₫5.00`** where the truth is `₫500`:
wrong by a factor of a hundred, with invented cents on a currency that has
none, and no error, warning or type failure anywhere. This codebase supports
`decimal_places = 0` (see `lib/domain/money.ts`), so that is a live case rather
than a hypothetical. A caller must say what it means.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/money-display.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { moneyDisplay } from "@/lib/domain/money-display";

describe("a money cell", () => {
  it("shows the same string formatMoney has always produced", () => {
    // The formatting itself is not being changed. What this adds is the reading
    // and the sign, so a column can align and colour without each screen
    // deciding for itself.
    expect(moneyDisplay(123456, "USD", 2).text).toBe("$1,234.56");
    expect(moneyDisplay(-123456, "USD", 2).text).toBe("-$1,234.56");
  });

  it("reports the sign, so a caller never has to test the string", () => {
    expect(moneyDisplay(-1, "USD", 2).sign).toBe("negative");
    expect(moneyDisplay(0, "USD", 2).sign).toBe("zero");
    expect(moneyDisplay(1, "USD", 2).sign).toBe("positive");
  });

  it("spells a negative out loud, because a leading dash is easy to miss", () => {
    // A screen reader announcing "$1,234.56" for a credit is the accounting
    // equivalent of dropping a minus sign, and colour is no help at all here.
    expect(moneyDisplay(-123456, "USD", 2).ariaLabel).toBe("negative $1,234.56");
    expect(moneyDisplay(123456, "USD", 2).ariaLabel).toBe("$1,234.56");
  });

  it("honours a currency with no minor unit", () => {
    // Not every currency has cents; the decimal places come from the currency
    // record, which is why this argument is required rather than defaulted.
    expect(moneyDisplay(1234, "JPY", 0).text).toBe("¥1,234");
  });

  it("falls back to a readable string when the currency code is unknown", () => {
    // formatMoney already catches this; the point is that it does not throw and
    // a table cell never renders empty.
    expect(moneyDisplay(123456, "ZZZ", 2).text.length).toBeGreaterThan(0);
  });

  it("treats negative zero as zero, in the text as well as the sign", () => {
    // `Math.sign(v) * Math.round(...)` in lib/domain/money.ts yields -0 for any
    // small negative amount that rounds to nothing, so this is a value the
    // ledger really produces. Left alone it splits in two: `-0 < 0` is false so
    // the sign says "zero", while Intl formats -0 as "-$0.00". The cell would
    // then show a minus sign that nothing accounts for, and — because only a
    // "negative" sign triggers the spoken word — read aloud as an unexplained
    // dash. Whatever a reader concludes from that, it is not what the number
    // means.
    const negativeZero = moneyDisplay(-0, "USD", 2);
    expect(negativeZero.sign).toBe("zero");
    expect(negativeZero.text).toBe("$0.00");
    expect(negativeZero.ariaLabel).toBe("$0.00");
    expect(negativeZero).toEqual(moneyDisplay(0, "USD", 2));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/money-display.test.ts`
Expected: FAIL — `Cannot find module '@/lib/domain/money-display'`

- [ ] **Step 3: Write the implementation**

Create `lib/domain/money-display.ts`:

```ts
import { formatMoney } from "@/lib/format";

/**
 * What a money cell says, and how it is heard.
 *
 * `formatMoney` already produces the string; this adds the two things every
 * table cell was deciding for itself — which way the figure points, and what a
 * screen reader should say about it.
 *
 * Pure, so the rules can be held to account without rendering anything.
 */
export type MoneySign = "negative" | "zero" | "positive";

export interface MoneyDisplay {
  text: string;
  ariaLabel: string;
  sign: MoneySign;
}

export function moneyDisplay(
  minor: number,
  currencyCode: string,
  decimals: number,
): MoneyDisplay {
  // -0 collapsed to 0 before anything reads it. `-0 === 0` is true, so this
  // changes no other input, but it keeps the sign and the string from
  // disagreeing: `-0 < 0` is false while Intl still formats -0 as "-$0.00".
  const amount = minor === 0 ? 0 : minor;
  const text = formatMoney(amount, currencyCode, decimals);
  const sign: MoneySign = amount < 0 ? "negative" : amount > 0 ? "positive" : "zero";
  return {
    text,
    // Spelled out rather than left to the leading dash. A dash is a single
    // character that several screen readers skip at speed, and a credit read
    // as a debit is the one mistake a ledger must not invite.
    ariaLabel: sign === "negative" ? `negative ${text.replace("-", "")}` : text,
    sign,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/money-display.test.ts`
Expected: PASS — 6 tests

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: exit 0. Vitest only transpiles; it does not check types.

- [ ] **Step 6: Commit**

```bash
git add lib/domain/money-display.ts tests/unit/money-display.test.ts
git commit -m "feat(table): decide once what a money cell says and how it is heard"
```

---

### Task 2: One visual vocabulary

**Files:**
- Create: `lib/design/tone.tsx`
- Modify: `lib/design/status.tsx`
- Test: `tests/unit/tone.test.ts`

**Interfaces:**
- Consumes: `TOKENS` from `@/lib/design/tokens`
- Produces:
  - `TONES: readonly ["positive", "neutral", "warning", "danger", "muted"]`
  - `type Tone = (typeof TONES)[number]`
  - `interface ToneToken { color: string; icon: ReactNode; label: string }`
  - `toneToken(tone: Tone): ToneToken`
  - `ToneBadge({ tone, children }: { tone: Tone; children: string })`

`lib/design/status.tsx` keeps its existing exports — `STATUS_KEYS`, `StatusKey`, `StatusToken`, `statusToken`, `StatusBadge` — and every existing test in `tests/unit/design-status.test.ts` must still pass unchanged. Its five statuses are re-expressed as tones so the app has one visual language instead of two overlapping ones.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/tone.test.ts`:

```ts
import { isValidElement } from "react";
import { describe, expect, it } from "vitest";
import { TONES, ToneBadge, toneToken } from "@/lib/design/tone";
import { STATUS_KEYS, statusToken } from "@/lib/design/status";

describe("the tone vocabulary", () => {
  it("gives every tone a colour, an icon and a label", () => {
    for (const tone of TONES) {
      const token = toneToken(tone);
      expect(token.color, tone).toMatch(/^#[0-9a-f]{6}$/i);
      expect(isValidElement(token.icon), tone).toBe(true);
      expect(token.label.length, tone).toBeGreaterThan(0);
    }
  });

  it("gives every tone a distinct icon and a distinct label", () => {
    // Two tones that differ only in colour are one tone to anyone who cannot
    // tell the colours apart, and to anyone reading a printout.
    const icons = TONES.map((tone) => {
      const icon = toneToken(tone).icon;
      if (!isValidElement(icon)) throw new Error(`${tone} carries no icon element`);
      return icon.type;
    });
    expect(new Set(icons).size).toBe(TONES.length);
    expect(new Set(TONES.map((tone) => toneToken(tone).label)).size).toBe(TONES.length);
  });
});

describe("ToneBadge", () => {
  it("carries the icon and the caller's wording, not the colour alone", () => {
    const badge = ToneBadge({ tone: "danger", children: "Overdue" });
    const [icon, label] = badge.props.children as [unknown, string];
    expect(isValidElement(icon)).toBe(true);
    expect(label).toBe("Overdue");
    expect(badge.props.style.color).toBe(toneToken("danger").color);
  });
});

describe("document statuses now sit on the tone vocabulary", () => {
  it("still answers for all five, unchanged", () => {
    // status.tsx is being re-expressed, not re-specified. Its own test file
    // pins the behaviour; this pins that the two systems agree rather than
    // drifting into a second palette.
    for (const key of STATUS_KEYS) {
      const token = statusToken(key);
      const tones = TONES.map((tone) => toneToken(tone).color);
      expect(tones, key).toContain(token.color);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/tone.test.ts`
Expected: FAIL — `Cannot find module '@/lib/design/tone'`

- [ ] **Step 3: Write the tone module**

Create `lib/design/tone.tsx`:

```tsx
import type { ReactNode } from "react";
import {
  CheckCircleFilled,
  ClockCircleFilled,
  ExclamationCircleFilled,
  InfoCircleFilled,
  MinusCircleFilled,
} from "@ant-design/icons";
import { TOKENS } from "./tokens";

/**
 * The whole visual vocabulary for "how is this thing doing".
 *
 * There are 23 status types in this application carrying roughly 40 values —
 * an invoice's `partial`, a user's `offboarded`, a bank connection's
 * `attention_required`. They belong to different domains and will never
 * collapse into one enum, so trying to name them all in one place would only
 * produce a list nobody could keep true.
 *
 * What they do share is how they should look. Five tones cover it, and each
 * screen says which of its own statuses reads as which tone. One visual
 * language, without pretending the domains are one domain.
 *
 * Every tone carries an icon and a label as well as a colour, for the same
 * reason as everywhere else: colour alone fails anyone who cannot separate the
 * hues, and fails everyone on a printout.
 */
export const TONES = ["positive", "neutral", "warning", "danger", "muted"] as const;

export type Tone = (typeof TONES)[number];

export interface ToneToken {
  color: string;
  icon: ReactNode;
  label: string;
}

const TONE: Record<Tone, ToneToken> = {
  positive: { color: TOKENS.intent.success, icon: <CheckCircleFilled />, label: "Good" },
  neutral: { color: TOKENS.intent.info, icon: <InfoCircleFilled />, label: "In progress" },
  warning: { color: TOKENS.intent.warning, icon: <ClockCircleFilled />, label: "Needs attention" },
  danger: { color: TOKENS.intent.danger, icon: <ExclamationCircleFilled />, label: "Problem" },
  muted: { color: TOKENS.text.secondary, icon: <MinusCircleFilled />, label: "Inactive" },
};

export function toneToken(tone: Tone): ToneToken {
  return TONE[tone];
}

/**
 * A tone shown with the caller's own wording.
 *
 * The label on the tone itself is a fallback for describing the tone; what a
 * reader should see is the screen's own word — "Paid", "Offboarded",
 * "Awaiting review" — with the tone supplying only the colour and the icon.
 */
export function ToneBadge({ tone, children }: { tone: Tone; children: string }) {
  const { color, icon } = toneToken(tone);
  return (
    <span style={{ color, display: "inline-flex", alignItems: "center", gap: 6 }}>
      {icon}
      {children}
    </span>
  );
}
```

- [ ] **Step 4: Re-express the five document statuses on top of it**

In `lib/design/status.tsx`, replace the `STATUS` constant with one built from
tones, and add the import. Everything else in the file — `STATUS_KEYS`,
`StatusKey`, `StatusToken`, `statusToken`, `StatusBadge` and its docstring —
stays exactly as it is.

```tsx
import { toneToken, type Tone } from "./tone";

/**
 * Each document status is one of the five tones, wearing its own word.
 *
 * Expressed this way rather than picking colours directly so the application
 * has one visual vocabulary. A status and a tone that disagreed about what
 * "danger" looks like would be the drift this whole wave exists to remove.
 */
const STATUS_TONE: Record<StatusKey, { tone: Tone; label: string }> = {
  posted: { tone: "positive", label: "Posted" },
  void: { tone: "muted", label: "Void" },
  draft: { tone: "muted", label: "Draft" },
  overdue: { tone: "danger", label: "Overdue" },
  pending: { tone: "warning", label: "Pending" },
};

const STATUS: Record<StatusKey, StatusToken> = Object.fromEntries(
  (Object.entries(STATUS_TONE) as [StatusKey, { tone: Tone; label: string }][]).map(
    ([key, { tone, label }]) => [key, { ...toneToken(tone), label }],
  ),
) as Record<StatusKey, StatusToken>;
```

Note what this changes and what it does not. `void` and `draft` still share one
muted colour, as before — but they now also share the muted icon, where before
they had `StopFilled` and `EditFilled`. `tests/unit/design-status.test.ts`
asserts every status has a **distinct** icon, so that test will fail. That test
is right and this arrangement is wrong: two statuses sharing both colour and
icon leaves only the label, which is exactly the collapse the icon was added to
prevent.

So keep a per-status icon override alongside the tone:

```tsx
import {
  EditFilled,
  StopFilled,
} from "@ant-design/icons";

const STATUS_TONE: Record<StatusKey, { tone: Tone; label: string; icon?: ReactNode }> = {
  posted: { tone: "positive", label: "Posted" },
  void: { tone: "muted", label: "Void", icon: <StopFilled /> },
  draft: { tone: "muted", label: "Draft", icon: <EditFilled /> },
  overdue: { tone: "danger", label: "Overdue" },
  pending: { tone: "warning", label: "Pending" },
};

const STATUS: Record<StatusKey, StatusToken> = Object.fromEntries(
  (Object.entries(STATUS_TONE) as [StatusKey, { tone: Tone; label: string; icon?: ReactNode }][])
    .map(([key, { tone, label, icon }]) => {
      const base = toneToken(tone);
      return [key, { color: base.color, icon: icon ?? base.icon, label }];
    }),
) as Record<StatusKey, StatusToken>;
```

- [ ] **Step 5: Run both test files to verify they pass**

Run: `npx vitest run tests/unit/tone.test.ts tests/unit/design-status.test.ts`
Expected: PASS — 3 tone tests and the 6 existing status tests, unchanged.

If a status test fails, the re-expression is wrong, not the test. Do not edit
`tests/unit/design-status.test.ts`.

- [ ] **Step 6: Typecheck and the colour guard**

Run: `npm run typecheck && npx vitest run tests/unit/no-hardcoded-color.test.ts`
Expected: typecheck exit 0; the guard passes.

- [ ] **Step 7: Commit**

```bash
git add lib/design/tone.tsx lib/design/status.tsx tests/unit/tone.test.ts
git commit -m "feat(table): give the app one tone vocabulary instead of two"
```

---

### Task 3: The column kit

**Files:**
- Create: `components/ui/columns.tsx`
- Test: `tests/unit/columns.test.ts`

**Interfaces:**
- Consumes: `moneyDisplay` (Task 1), `toneToken`/`ToneBadge`/`Tone` (Task 2), `TOKENS` from `@/lib/design/tokens`
- Produces:
  - `moneyColumn<T>(spec): ColumnType<T>`
  - `dateColumn<T>(spec): ColumnType<T>`
  - `statusColumn<T>(spec): ColumnType<T>`
  - `textColumn<T>(spec): ColumnType<T>`
  - `actionsColumn<T>(spec): ColumnType<T>`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/columns.test.ts`.

**Two constraints from this project's test setup, both verified before this plan
was written — do not work around them, they are why the test looks like this:**

1. **`vitest.config.ts` includes `tests/**/*.test.ts` only.** A `.tsx` test file
   is silently *not run* — vitest reports "No test files found", which is easy to
   mistake for a passing run. So this file is `.ts` and contains no JSX. Nothing
   here needs any: the elements under test come from `columns.tsx`.
2. **React 19's `isValidElement` narrows `props` to `unknown`.** The wave 1
   pattern of `if (!isValidElement(x)) throw` then reading `x.props.style` fails
   `npm run typecheck` with *"'cell.props' is of type 'unknown'"*. It typechecked
   in `design-status.test.ts` only because that file calls `StatusBadge(...)`
   directly and never narrows. Here the values come out of `column.render`, whose
   return type is `ReactNode | RenderedCell<T>`, so narrowing is unavoidable and
   the helper below carries the prop types through it.

```ts
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { actionsColumn, dateColumn, moneyColumn, statusColumn, textColumn } from "@/components/ui/columns";
import { TOKENS } from "@/lib/design/tokens";
import { ToneBadge, toneToken, type Tone } from "@/lib/design/tone";

/** The props these cells actually carry. See constraint 2 above. */
interface CellProps {
  style?: { color?: string; fontVariantNumeric?: string };
  children?: ReactNode;
  "aria-label"?: string;
  dateTime?: string;
  tone?: Tone;
  [key: string]: unknown;
}

function asElement(node: unknown, what: string): ReactElement<CellProps> {
  // The cast target is read off `isValidElement` itself rather than written out
  // as `{} | null | undefined`. Same type, but the literal form trips this
  // repo's `no-empty-object-type` lint rule, and silencing a rule to restate a
  // type the compiler can already name is the worse of the two.
  if (!isValidElement<CellProps>(node as Parameters<typeof isValidElement>[0])) {
    throw new Error(`${what} rendered no element`);
  }
  return node as ReactElement<CellProps>;
}

/** `children` is `ReactNode`, so an icon-plus-label pair needs naming to read. */
function pair(cell: ReactElement<CellProps>): [ReactNode, string] {
  return cell.props.children as [ReactNode, string];
}

interface Row {
  total_minor: number;
  currency_code: string;
  currency_decimals: number;
  due_date: string | null;
  status: "paid" | "void";
  memo: string | null;
}

const row: Row = {
  total_minor: -123456,
  currency_code: "USD",
  currency_decimals: 2,
  due_date: "2026-08-13",
  status: "void",
  memo: null,
};

/** The per-row declaration, written once because seven tests use it. */
const perRow = { title: "Total", dataIndex: "total_minor", currency: "currency_code", decimals: "currency_decimals" } as const;

describe("moneyColumn", () => {
  it("aligns right and uses tabular figures, so columns of money line up", () => {
    const column = moneyColumn<Row>({ ...perRow });
    expect(column.align).toBe("right");
    const cell = asElement(column.render!(row.total_minor, row, 0), "moneyColumn");
    expect(cell.props.style?.fontVariantNumeric).toBe("tabular-nums");
  });

  it("takes the currency AND its decimal places off the row", () => {
    // Both come from the row because both belong to the currency. A column
    // holding USD and JPY needs two places on one row and none on the next;
    // one number pinned to the column would be wrong on whichever rows are not
    // the majority, and wrong quietly.
    const column = moneyColumn<Row>({ ...perRow });
    const cell = asElement(
      column.render!(123456, { ...row, currency_code: "JPY", currency_decimals: 0 }, 0),
      "moneyColumn",
    );
    expect(cell.props.children).toBe("¥123,456");
  });

  it("accepts a fixed currency and fixed places where the screen has only one", () => {
    const column = moneyColumn<Row>({
      title: "Total",
      dataIndex: "total_minor",
      currency: { fixed: "USD" },
      decimals: { fixed: 2 },
    });
    const cell = asElement(column.render!(123456, row, 0), "moneyColumn");
    expect(cell.props.children).toBe("$1,234.56");
  });

  it("colours a negative from the money token, and says so out loud too", () => {
    // The minus sign is the signal that survives a printout and a colour-blind
    // reader; the colour and the spoken label reinforce it.
    const column = moneyColumn<Row>({ ...perRow });
    const cell = asElement(column.render!(row.total_minor, row, 0), "moneyColumn");
    expect(cell.props.style?.color).toBe(TOKENS.money.negative);
    expect(cell.props["aria-label"]).toBe("negative $1,234.56");
    expect(cell.props.children).toContain("-");
  });

  it("leaves zero uncoloured, because nothing is being signalled", () => {
    const column = moneyColumn<Row>({ ...perRow });
    const cell = asElement(column.render!(0, row, 0), "moneyColumn");
    expect(cell.props.style?.color).toBeUndefined();
  });

  it("shows an em dash for a missing amount, because absent is not zero", () => {
    // The ledger tells "no amount recorded" and "zero" apart, so a screen
    // reading from it must too. A rendered $0.00 here would state a fact the
    // row never carried. The test above pins the other half: a real zero is
    // still money and still renders.
    const column = moneyColumn<Row>({ ...perRow });
    expect(column.render!(null, row, 0)).toBe("—");
  });

  it("shows an em dash when the row carries no currency, rather than assuming dollars", () => {
    // An assumed "USD" puts a dollar sign on a dong amount, and a dollar sign
    // reads as a fact rather than as a gap in the data.
    const column = moneyColumn<Row>({ ...perRow });
    const broken = { ...row, currency_code: null as unknown as string };
    expect(column.render!(123456, broken, 0)).toBe("—");
  });

  it("shows an em dash when the row carries no decimal places, rather than assuming two", () => {
    // The assumption this replaces turned ₫500 into ₫5.00 — off by a hundred,
    // with invented cents, and nothing logged anywhere. The JPY test above is
    // the reason the guard asks whether the value is null and never whether it
    // is falsy: zero places is a real declaration on a real currency.
    const column = moneyColumn<Row>({ ...perRow });
    const broken = { ...row, currency_decimals: null as unknown as number };
    expect(column.render!(123456, broken, 0)).toBe("—");
  });
});

describe("dateColumn", () => {
  it("marks the date up as a date, keeping the text it already showed", () => {
    // The displayed string is unchanged on purpose: this batch adds semantics
    // and one code path, not a new date format across every screen.
    const column = dateColumn<Row>({ title: "Due", dataIndex: "due_date" });
    const cell = asElement(column.render!(row.due_date, row, 0), "dateColumn");
    expect(cell.type).toBe("time");
    expect(cell.props.dateTime).toBe("2026-08-13");
    expect(cell.props.children).toBe("2026-08-13");
  });

  it("shows an em dash for no date, rather than an empty cell", () => {
    const column = dateColumn<Row>({ title: "Due", dataIndex: "due_date" });
    expect(column.render!(null, row, 0)).toBe("—");
  });
});

describe("statusColumn", () => {
  it("renders the screen's own word in the tone the screen chose", () => {
    const column = statusColumn<Row>({
      title: "Status",
      dataIndex: "status",
      tones: { paid: { tone: "positive", label: "Paid" }, void: { tone: "muted", label: "Void" } },
    });
    const cell = asElement(column.render!(row.status, row, 0), "statusColumn");
    // The column's own job is choosing the tone and the wording; the badge owns
    // how that looks. Asserting the element IS the badge is what keeps the two
    // from drifting into separate copies of the same markup.
    expect(cell.type).toBe(ToneBadge);
    expect(cell.props.tone).toBe("muted");
    expect(cell.props.children).toBe("Void");

    // And once through the badge, the chosen tone really does reach the colour —
    // so the composition is proven, not just the wiring.
    const rendered = asElement(
      ToneBadge(cell.props as { tone: Tone; children: string }),
      "ToneBadge",
    );
    expect(rendered.props.style?.color).toBe(toneToken("muted").color);
    const [icon, label] = pair(rendered);
    expect(isValidElement(icon)).toBe(true);
    expect(label).toBe("Void");
  });

  it("shows an unmapped status as its raw value rather than swallowing it", () => {
    // A status nobody mapped is a gap in the screen's declaration. Rendering
    // nothing would hide a row's state; rendering the raw value shows both the
    // state and the gap.
    const column = statusColumn<Row>({
      title: "Status",
      dataIndex: "status",
      tones: { paid: { tone: "positive", label: "Paid" } },
    });
    const cell = asElement(column.render!("void" as Row["status"], row, 0), "statusColumn");
    expect(cell.props.tone).toBe("muted");
    expect(cell.props.children).toBe("void");
  });
});

describe("textColumn", () => {
  it("shows an em dash for an empty value", () => {
    const column = textColumn<Row>({ title: "Memo", dataIndex: "memo" });
    expect(column.render!(null, row, 0)).toBe("—");
    expect(column.render!("  ", row, 0)).toBe("—");
    expect(column.render!("Paid in full", row, 0)).toBe("Paid in full");
  });
});

describe("actionsColumn", () => {
  it("keeps actions out of the sort order and off the right edge", () => {
    const column = actionsColumn<Row>({ actions: () => [] });
    expect(column.align).toBe("right");
    expect(column.sorter).toBeUndefined();
    expect(column.title).toBe("");
  });

  it("renders whatever the screen supplies for that row", () => {
    const column = actionsColumn<Row>({ actions: (record) => [String(record.status)] });
    const cell = asElement(column.render!(undefined, row, 0), "actionsColumn");
    expect(cell.props.children).toEqual(["void"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/columns.test.ts`
Expected: FAIL — `Cannot find module '@/components/ui/columns'`

- [ ] **Step 3: Write the column kit**

Create `components/ui/columns.tsx`:

```tsx
"use client";

import type { ReactNode } from "react";
import type { ColumnType } from "antd/es/table";
import { moneyDisplay } from "@/lib/domain/money-display";
import { TOKENS } from "@/lib/design/tokens";
import { ToneBadge, type Tone } from "@/lib/design/tone";

/**
 * The column builders.
 *
 * This is where the duplication actually was. The tables in this application
 * are mostly flat — one carries a row selection, five are expandable — but
 * money is formatted by hand in 25 files and `align: "right"` is written out
 * 173 times. So the reuse belongs in the columns, not in a cleverer table.
 *
 * Every builder returns a plain Ant Design column, so a screen can still reach
 * for anything the library offers by spreading the result.
 */

/** Shown where a value is absent, so an empty cell never reads as a zero. */
const ABSENT = "—";

type Key<T> = Extract<keyof T, string>;

export interface MoneyColumnSpec<T> {
  title: string;
  dataIndex: Key<T>;
  /**
   * Where the currency comes from: the name of a field on the row, or a fixed
   * code for a screen that only ever shows one. Per-row is the default because
   * the ledger is multi-currency and a column that assumed otherwise would be
   * wrong wherever it mattered most.
   */
  currency: Key<T> | { fixed: string };
  /**
   * Where the decimal places come from, declared the same way as the currency
   * and for the same reason: they are a property of the currency, not of the
   * column. A column carrying USD and JPY rows needs two and zero on different
   * rows, so pinning one number per column would be wrong on the rows that are
   * not the majority. Required — `formatMoney` has no default either, and a
   * silent fallback to 2 renders ₫500 as ₫5.00 with no error anywhere.
   */
  decimals: Key<T> | { fixed: number };
  width?: number;
}

export function moneyColumn<T>(spec: MoneyColumnSpec<T>): ColumnType<T> {
  return {
    title: spec.title,
    dataIndex: spec.dataIndex,
    width: spec.width,
    align: "right",
    render: (value: unknown, record: T) => {
      // `value` is `unknown` because that is the truth at this boundary: Ant
      // Design hands the render whatever sits at `dataIndex`, and nothing
      // upstream proves it is a number.
      //
      // A cell shows money only when the row carries all three facts it needs.
      // Any one of them missing means the row is broken, and the honest cell is
      // the em dash rather than a guess. An assumed currency puts a dollar sign
      // on a dong amount; assumed places turn ₫500 into ₫5.00, off by a hundred
      // with invented cents and nothing logged; and a missing amount is not a
      // zero — the ledger tells those two apart, so the screen must as well.
      //
      // Every check asks whether the value is absent, never whether it is
      // falsy: zero places is how JPY and VND are declared, and a zero amount
      // is a real balance.
      const code: unknown =
        typeof spec.currency === "object" ? spec.currency.fixed : record[spec.currency];
      const places: unknown =
        typeof spec.decimals === "object" ? spec.decimals.fixed : record[spec.decimals];
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        typeof code !== "string" ||
        code.trim() === "" ||
        typeof places !== "number" ||
        !Number.isInteger(places) ||
        places < 0
      ) {
        return ABSENT;
      }
      const { text, ariaLabel, sign } = moneyDisplay(value, code, places);
      return (
        <span
          aria-label={ariaLabel}
          style={{
            // Tabular figures so digits occupy the same width down the column.
            // Proportional figures make a column of money ragged, which is the
            // one thing a column of money must not be.
            fontVariantNumeric: "tabular-nums",
            color:
              sign === "negative"
                ? TOKENS.money.negative
                : sign === "positive"
                  ? TOKENS.money.positive
                  : undefined,
          }}
        >
          {text}
        </span>
      );
    },
  };
}

export interface DateColumnSpec<T> {
  title: string;
  dataIndex: Key<T>;
  width?: number;
}

export function dateColumn<T>(spec: DateColumnSpec<T>): ColumnType<T> {
  return {
    title: spec.title,
    dataIndex: spec.dataIndex,
    width: spec.width,
    render: (value: string | null) => {
      if (!value) return ABSENT;
      // The text is deliberately what these screens already showed. This batch
      // buys the semantic element and one code path; changing how every date
      // in the application reads is a visible change nobody asked for.
      return <time dateTime={value}>{value}</time>;
    },
  };
}

export interface StatusColumnSpec<T> {
  title: string;
  dataIndex: Key<T>;
  /**
   * The screen's own statuses, each mapped to a tone and the word a reader
   * should see. Declared per screen because this application has 23 status
   * types across different domains, and one enum could never hold them.
   */
  tones: Record<string, { tone: Tone; label: string }>;
  width?: number;
}

export function statusColumn<T>(spec: StatusColumnSpec<T>): ColumnType<T> {
  return {
    title: spec.title,
    dataIndex: spec.dataIndex,
    width: spec.width,
    render: (value: string) => {
      const mapped = spec.tones[value];
      // An unmapped status shows its raw value in the muted tone. Rendering
      // nothing would hide the row's state; this shows the state and the gap
      // in the screen's declaration at the same time.
      //
      // Rendered through ToneBadge rather than by repeating its markup here.
      // The two would be identical spans, and two copies of one appearance is
      // exactly the drift this kit exists to end — a change to the badge that
      // did not reach the column would leave a table looking unlike every
      // other place the same status is shown.
      return <ToneBadge tone={mapped?.tone ?? "muted"}>{mapped?.label ?? value}</ToneBadge>;
    },
  };
}

export interface TextColumnSpec<T> {
  title: string;
  dataIndex: Key<T>;
  width?: number;
  ellipsis?: boolean;
}

export function textColumn<T>(spec: TextColumnSpec<T>): ColumnType<T> {
  return {
    title: spec.title,
    dataIndex: spec.dataIndex,
    width: spec.width,
    ellipsis: spec.ellipsis,
    render: (value: string | null) => (value?.trim() ? value : ABSENT),
  };
}

export interface ActionsColumnSpec<T> {
  actions: (record: T) => ReactNode[];
  width?: number;
}

export function actionsColumn<T>(spec: ActionsColumnSpec<T>): ColumnType<T> {
  return {
    // No heading: a column of buttons has no name worth a column of width, and
    // "Actions" read out on every row is noise.
    title: "",
    key: "actions",
    align: "right",
    width: spec.width,
    render: (_: unknown, record: T) => (
      <span style={{ display: "inline-flex", gap: 4, justifyContent: "flex-end" }}>
        {spec.actions(record)}
      </span>
    ),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/columns.test.ts`
Expected: PASS — 15 tests

- [ ] **Step 5: Typecheck, lint and the colour guard**

Run: `npm run typecheck && npm run lint && npx vitest run tests/unit/no-hardcoded-color.test.ts`
Expected: typecheck exit 0; lint 0 errors (11 pre-existing warnings in `scripts/verify-*.mjs`); the guard passes.

- [ ] **Step 6: Commit**

```bash
git add components/ui/columns.tsx tests/unit/columns.test.ts
git commit -m "feat(table): put the reuse in the columns, where the duplication is"
```

---

### Task 4: Table state in the URL

**Files:**
- Create: `lib/domain/table-url-state.ts`
- Test: `tests/unit/table-url-state.test.ts`

**Interfaces:**
- Consumes: `zod` (existing dependency)
- Produces:
  - `interface TableState { page: number; pageSize: number; sort: string | null; order: "ascend" | "descend" | null; search: string }`
  - `DEFAULT_TABLE_STATE: TableState`
  - `parseTableState(params: URLSearchParams | string, defaults?: TableState): TableState`
  - `serialiseTableState(state: TableState, defaults?: TableState): string`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/table-url-state.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  DEFAULT_TABLE_STATE,
  parseTableState,
  serialiseTableState,
  type TableState,
} from "@/lib/domain/table-url-state";

describe("reading table state from a URL", () => {
  it("reads a complete set of parameters", () => {
    const state = parseTableState("page=3&size=50&sort=due_date&order=descend&q=acme");
    expect(state).toEqual({
      page: 3,
      pageSize: 50,
      sort: "due_date",
      order: "descend",
      search: "acme",
    });
  });

  it("falls back to the defaults when nothing is there", () => {
    expect(parseTableState("")).toEqual(DEFAULT_TABLE_STATE);
  });

  it("falls back rather than throwing on junk, because a stale link must still open", () => {
    // Somebody's bookmark from three releases ago, or a hand-edited address.
    // Refusing to render the page would be a worse answer than showing page 1.
    for (const query of ["page=abc", "page=-4", "page=0", "size=999999", "order=sideways", "size=nope"]) {
      expect(() => parseTableState(query), query).not.toThrow();
    }
    expect(parseTableState("page=abc").page).toBe(DEFAULT_TABLE_STATE.page);
    expect(parseTableState("page=-4").page).toBe(DEFAULT_TABLE_STATE.page);
    expect(parseTableState("order=sideways").order).toBe(null);
    expect(parseTableState("size=999999").pageSize).toBe(DEFAULT_TABLE_STATE.pageSize);
  });

  it("keeps an unknown parameter out of the state rather than carrying it", () => {
    expect(parseTableState("page=2&colour=red")).toEqual({ ...DEFAULT_TABLE_STATE, page: 2 });
  });
});

describe("writing table state back to a URL", () => {
  it("writes only what differs from the defaults, so a plain view has a plain address", () => {
    expect(serialiseTableState(DEFAULT_TABLE_STATE)).toBe("");
    expect(serialiseTableState({ ...DEFAULT_TABLE_STATE, page: 2 })).toBe("page=2");
  });

  it("round-trips every field", () => {
    const state = {
      page: 4,
      pageSize: 100,
      sort: "issue_date",
      order: "ascend" as const,
      search: "north star",
    };
    expect(parseTableState(serialiseTableState(state))).toEqual(state);
  });

  it("drops a sort order with no column to sort by", () => {
    // An order without a column says nothing, and carrying it would let a link
    // restore half a sort.
    const written = serialiseTableState({ ...DEFAULT_TABLE_STATE, sort: null, order: "descend" });
    expect(written).toBe("");
  });
});

describe("a screen's own defaults", () => {
  // Every field reads from these, not from the module-level default. A screen
  // that declares its own list order and page size means it, and a stale link
  // is exactly when that declaration matters most.
  const screenDefaults: TableState = {
    ...DEFAULT_TABLE_STATE,
    pageSize: 50,
    sort: "due_date",
    order: "ascend",
  };

  it("takes the screen's default sort when the address carries none", () => {
    const state = parseTableState("", screenDefaults);
    expect(state).toEqual(screenDefaults);
  });

  it("falls back to the screen's default, not the global one, when a value is junk", () => {
    // Reverting to the global 20 on a screen that declared 50 would read as the
    // screen forgetting its own mind, and nothing would say why.
    expect(parseTableState("size=999999", screenDefaults).pageSize).toBe(50);
    expect(parseTableState("order=sideways", screenDefaults).order).toBe("ascend");
  });

  it("writes nothing for a view that is already the screen's default", () => {
    expect(serialiseTableState(screenDefaults, screenDefaults)).toBe("");
  });

  it("writes only the half of the sort that differs, and reads it back whole", () => {
    const state: TableState = { ...screenDefaults, order: "descend" };
    expect(serialiseTableState(state, screenDefaults)).toBe("order=descend");
    expect(parseTableState(serialiseTableState(state, screenDefaults), screenDefaults)).toEqual(state);
  });

  it("returns the reader to the screen's default sort when the sort is cleared", () => {
    // The limitation this pins rather than hides: on a screen that declares a
    // default sort, an address has no way to say "no sort at all", because an
    // absent parameter already means the default. Clearing the sort returns the
    // reader to that default rather than to an unsorted list. No screen needs
    // the difference today, and a sentinel value would make every ordinary link
    // stranger to read for the sake of a case nobody has.
    const cleared: TableState = { ...screenDefaults, sort: null, order: null };
    const reread = parseTableState(serialiseTableState(cleared, screenDefaults), screenDefaults);
    expect(reread.sort).toBe("due_date");
    expect(reread.order).toBe("ascend");
  });

  it("gives a sort with no direction the screen's direction, for the same reason", () => {
    // The half of that limitation easier to miss, because it survives even when
    // the column does change: the direction is written only when it differs, so
    // a state carrying a column and no direction writes nothing for it, and an
    // absent direction reads back as the screen's. A link naming another column
    // therefore arrives sorted the way this screen sorts.
    //
    // Pinned because it is silent, not because it is wrong. The alternative is
    // to drop a sort the address named outright, and no interface here produces
    // a directionless sort anyway — Ant Design clears a column and its
    // direction together.
    const foreign: TableState = { ...screenDefaults, sort: "customer_name", order: null };
    const reread = parseTableState(serialiseTableState(foreign, screenDefaults), screenDefaults);
    expect(reread.sort).toBe("customer_name");
    expect(reread.order).toBe("ascend");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/table-url-state.test.ts`
Expected: FAIL — `Cannot find module '@/lib/domain/table-url-state'`

- [ ] **Step 3: Write the implementation**

Create `lib/domain/table-url-state.ts`:

```ts
import { z } from "zod";

/**
 * Which page of which sort a reader is looking at, expressed as URL parameters.
 *
 * It goes in the address so that going back, sharing a link and reloading all
 * return the reader to what they were looking at. Before this, a filtered list
 * was lost the moment anybody navigated away.
 *
 * Pure. The hook that decides how to write the address lives in
 * lib/client/use-table-url-state.ts; the rules for what a parameter means
 * belong here, where a test can hold them.
 */
export interface TableState {
  page: number;
  pageSize: number;
  sort: string | null;
  order: "ascend" | "descend" | null;
  search: string;
}

export const DEFAULT_TABLE_STATE: TableState = {
  page: 1,
  pageSize: 20,
  sort: null,
  order: null,
  search: "",
};

/** The sizes the page-size control offers. Anything else is somebody guessing. */
const PAGE_SIZES = [10, 20, 50, 100] as const;

/**
 * Every field falls back rather than failing, and falls back to the screen's
 * own default rather than to this module's.
 *
 * These parameters arrive from a bookmark, a pasted link or a hand-edited
 * address, so they are untrusted input. Validating them is not swallowing an
 * error: refusing to render a list because a stale link says `page=abc` would
 * be a worse answer than showing the first page.
 *
 * Built per call rather than once for the module, which is the only way the
 * fallback can be the caller's. A single shared schema could fall back only to
 * `DEFAULT_TABLE_STATE`, so a screen that declares fifty rows a page would
 * quietly show twenty the moment a stale link carried a bad size — the screen
 * appearing to forget its own mind, with nothing saying why.
 */
function schemaFor(defaults: TableState) {
  return z.object({
    page: z.coerce.number().int().positive().catch(defaults.page),
    // Not a type predicate: the TableState interface above types pageSize as
    // plain number, so narrowing this to the literal 10 | 20 | 50 | 100 union
    // makes the .catch() fallback no longer assignable, and `npm run typecheck`
    // fails. Nothing downstream reads the narrowed type, and the runtime check
    // is the same either way.
    size: z.coerce
      .number()
      .int()
      .refine((value) => (PAGE_SIZES as readonly number[]).includes(value))
      .catch(defaults.pageSize),
    sort: z.string().min(1).nullable().catch(defaults.sort),
    order: z.enum(["ascend", "descend"]).nullable().catch(defaults.order),
    q: z.string().catch(defaults.search),
  });
}

export function parseTableState(
  params: URLSearchParams | string,
  defaults: TableState = DEFAULT_TABLE_STATE,
): TableState {
  const search = typeof params === "string" ? new URLSearchParams(params) : params;
  // All five read the same way: the address if it says anything, the screen's
  // default if it does not. Sort and order are not exceptions — a screen that
  // declares the order its list opens in means it, and an address that says
  // nothing about sorting is not the same as an address asking for none.
  const parsed = schemaFor(defaults).parse({
    page: search.get("page") ?? defaults.page,
    size: search.get("size") ?? defaults.pageSize,
    sort: search.get("sort") ?? defaults.sort,
    order: search.get("order") ?? defaults.order,
    q: search.get("q") ?? defaults.search,
  });

  // An order with no column to sort by describes half a sort, so neither half
  // is kept.
  const sort = parsed.sort;
  return {
    page: parsed.page,
    pageSize: parsed.size,
    sort,
    order: sort ? parsed.order : null,
    search: parsed.q,
  };
}

export function serialiseTableState(
  state: TableState,
  defaults: TableState = DEFAULT_TABLE_STATE,
): string {
  const params = new URLSearchParams();
  // Only what differs from the default is written, so an ordinary view has an
  // ordinary address and a shared link carries only what the sender changed.
  if (state.page !== defaults.page) params.set("page", String(state.page));
  if (state.pageSize !== defaults.pageSize) params.set("size", String(state.pageSize));
  // Sort and order follow the same rule as the other three, and each half is
  // written on its own: changing only the direction of a screen's default sort
  // should put one parameter in the address, not two.
  //
  // The consequence, pinned by tests rather than left to be discovered: on a
  // screen that declares a default sort, an address cannot say "no sort at
  // all", because an absent parameter already means the default. Clearing the
  // sort returns the reader to that default rather than to an unsorted list.
  //
  // The same holds for the direction on its own, which is the half easier to
  // miss: a state naming a column but no direction writes no `order`, and an
  // absent `order` reads back as the screen's. So a link naming another column
  // arrives sorted the way this screen sorts. That is the friendlier of the two
  // answers available — the alternative is to drop a sort the address asked for
  // by name — and no interface here produces a directionless sort anyway, since
  // Ant Design clears a column and its direction together.
  //
  // Both cases would need a sentinel value to express, which would make every
  // ordinary link stranger to read for the sake of states nobody has. Page,
  // size and search have no such gap: they compare with `!==` and nothing else,
  // so even their empty values survive the round trip.
  if (state.sort && state.sort !== defaults.sort) params.set("sort", state.sort);
  if (state.sort && state.order && state.order !== defaults.order) {
    params.set("order", state.order);
  }
  if (state.search !== defaults.search) params.set("q", state.search);
  return params.toString();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/table-url-state.test.ts`
Expected: PASS — 13 tests

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: exit 0

- [ ] **Step 6: Commit**

```bash
git add lib/domain/table-url-state.ts tests/unit/table-url-state.test.ts
git commit -m "feat(table): decide what a table's address means, and make junk harmless"
```

---

### Task 5: The hook, and the performance trap in it

**Files:**
- Create: `lib/client/use-table-url-state.ts`

**Interfaces:**
- Consumes: `TableState`, `DEFAULT_TABLE_STATE`, `parseTableState`, `serialiseTableState` (Task 4)
- Produces: `useTableUrlState(options?: { mode?: "client" | "server"; defaults?: TableState }): [TableState, (patch: Partial<TableState>) => void]`

There is no unit test for this file. It is a hook over `useSearchParams`, and this project has no DOM environment to render a hook in — a test would have to mock Next's router and would then assert the shape of the mock. The rules it applies are all in Task 4 and are tested there. The behaviour that cannot be unit-tested here is verified for real when the first screen migrates in batch 2.

- [ ] **Step 1: Write the hook**

Create `lib/client/use-table-url-state.ts`:

```ts
"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  DEFAULT_TABLE_STATE,
  parseTableState,
  serialiseTableState,
  type TableState,
} from "@/lib/domain/table-url-state";

export interface TableUrlStateOptions {
  /**
   * `client` when the whole list is already in the browser and the table
   * pages it locally; `server` when changing the page has to fetch.
   *
   * Know this before building on it: **in client mode the returned state is
   * not re-derived after `update`.** The address is written with
   * `history.replaceState`, which the router deliberately does not see, so
   * `useSearchParams` never yields a new value and nothing schedules a render.
   * A table rendering straight from the returned state would sit still while
   * its own controls were clicked, and no test, lint rule or type would say
   * why. In client mode this hook seeds a caller's own state and mirrors
   * changes back into the address; it is not the state a client-mode table
   * renders from. In server mode the returned state is live, because there the
   * navigation is real.
   */
  mode?: "client" | "server";
  /**
   * The same object on every render — a module-level constant, or memoized.
   *
   * An inline object literal is a new identity each render, and both the parse
   * and the updater below are memoized on that identity, so an inline one
   * redoes the whole hook every render and quietly undoes the reason this file
   * exists. Nothing catches it: React's exhaustive-deps rule checks dependency
   * arrays, not the stability of a custom hook's own arguments.
   */
  defaults?: TableState;
}

/**
 * Keep a table's page, sort and search in the address.
 *
 * The two modes differ in one thing, and it matters more than it looks. 59 of
 * this application's 60 pages are `force-dynamic`, so `router.replace` re-runs
 * the server component. In client mode — where the rows are already in the
 * browser — that would mean a server round trip on every keystroke of a search
 * box, turning a fix for lost filters into a performance regression. So client
 * mode writes the address with `history.replaceState`, which the router never
 * sees: the link is still shareable and the back button still works, and
 * nothing is fetched.
 *
 * Server mode uses `router.replace`, because there the round trip is the point.
 *
 * The client-mode trick is load-bearing and narrower than it looks: passing the
 * existing `window.history.state` back in is what keeps it invisible. Next marks
 * its own history entries and its patched `replaceState` returns early on them,
 * so reusing that state reaches the router as a no-op — whereas passing `null`
 * or `{}` would resync `useSearchParams` and undo the whole point.
 *
 * When the first screen migrates in batch 2, that migration is the first real
 * test of this file, and it has two halves. That no request fires is one.
 * That the rows actually change when a control is clicked is the other, and it
 * is the half this file cannot give a client-mode caller by itself — see the
 * note on `mode` above.
 */
export function useTableUrlState(
  options: TableUrlStateOptions = {},
): [TableState, (patch: Partial<TableState>) => void] {
  const { mode = "client", defaults = DEFAULT_TABLE_STATE } = options;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const state = useMemo(
    () => parseTableState(searchParams.toString(), defaults),
    [searchParams, defaults],
  );

  const update = useCallback(
    (patch: Partial<TableState>) => {
      const next = { ...state, ...patch };
      // Any change to what is being shown returns to the first page. Leaving
      // the reader on page 7 of a result set that now has two pages shows them
      // an empty table and no reason for it.
      if (patch.search !== undefined || patch.sort !== undefined || patch.pageSize !== undefined) {
        next.page = patch.page ?? DEFAULT_TABLE_STATE.page;
      }

      const query = serialiseTableState(next, defaults);
      const url = query ? `${pathname}?${query}` : pathname;

      if (mode === "server") {
        router.replace(url, { scroll: false });
        return;
      }
      window.history.replaceState(window.history.state, "", url);
    },
    [state, defaults, pathname, mode, router],
  );

  return [state, update];
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: typecheck exit 0; lint 0 errors (11 pre-existing warnings).

Lint matters more than usual here: this is a hook, and the React rules are the
only automated check on its dependency arrays.

- [ ] **Step 3: Commit**

```bash
git add lib/client/use-table-url-state.ts
git commit -m "feat(table): keep table state in the address without a round trip per keystroke"
```

---

### Task 6: The two-mode DataTable, and ReportTable

**Files:**
- Create: `components/ui/table-data.ts`
- Modify: `components/ui/DataTable.tsx`
- Create: `components/ui/ReportTable.tsx`
- Test: `tests/unit/data-table-contract.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces:
  - `ServerPage<T>`, `DataTableCoreProps<T>` and `resolveTableData<T>(props): { data: readonly T[]; pagination: TablePaginationConfig | false }` from `components/ui/table-data.ts`
  - `DataTableProps<T>` gaining `rows?: T[]` and `page?: ServerPage<T>`
  - `ReportTable<T>(props): JSX.Element`

`resolveTableData` is exported so the contract can be tested without a DOM. The existing `dataSource`, `emptyTitle`, `emptyDescription`, `emptyAction` props and the `size="small"` default all keep working exactly as they do now — 33 files already use them.

**Why the rule lives in its own file rather than in `DataTable.tsx`.** Measured
before this plan was written: a unit test that imports `DataTable.tsx` takes
**55 seconds**, because the import pulls Ant Design's runtime into a
`environment: "node"` process. The same test against a module whose only Ant
Design import is `import type` takes **0.4 seconds**. Fifty-five seconds on
`npm test` is how a suite stops being run. So `table-data.ts` holds the rule with
a type-only import, `DataTable.tsx` imports the rule, and the test imports
`table-data.ts` — never `DataTable`. Keep `ColumnType`/`TablePaginationConfig`
imports in the kit `import type` for the same reason; a plain `import` reinstates
the 55 seconds silently, because the code still works.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/data-table-contract.test.ts`:

```ts
// Imports table-data, never DataTable. See the note above: importing DataTable
// costs 55 seconds because it pulls Ant Design's runtime into a node process.
import { describe, expect, it } from "vitest";
import { resolveTableData } from "@/components/ui/table-data";

interface Row {
  id: string;
}

const rows: Row[] = [{ id: "a" }, { id: "b" }];

describe("the two-mode data contract", () => {
  it("pages locally when given rows", () => {
    const resolved = resolveTableData<Row>({ rows });
    expect(resolved.data).toEqual(rows);
    expect(resolved.pagination).toMatchObject({ pageSize: 20 });
    // No total: antd counts the rows it was given.
    expect((resolved.pagination as { total?: number }).total).toBeUndefined();
  });

  it("pages on the server when given a page", () => {
    const resolved = resolveTableData<Row>({
      page: { rows, total: 240, pageIndex: 3, pageSize: 50 },
    });
    expect(resolved.data).toEqual(rows);
    expect(resolved.pagination).toMatchObject({ total: 240, current: 3, pageSize: 50 });
  });

  it("still accepts dataSource, because 33 screens already pass it", () => {
    // This contract is being added, not swapped in. A change that broke the
    // existing callers would have to migrate 33 files in the same commit.
    const resolved = resolveTableData<Row>({ dataSource: rows });
    expect(resolved.data).toEqual(rows);
  });

  it("honours pagination={false} on a list bounded by construction", () => {
    expect(resolveTableData<Row>({ rows, pagination: false }).pagination).toBe(false);
  });

  it("refuses both modes at once rather than silently preferring one", () => {
    // Two sources of truth for what is on screen is exactly the bug this
    // contract exists to prevent, so it fails loudly at the call site.
    expect(() =>
      resolveTableData<Row>({ rows, page: { rows, total: 2, pageIndex: 1, pageSize: 20 } }),
    ).toThrow(/rows.*page|page.*rows/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/data-table-contract.test.ts`
Expected: FAIL — `resolveTableData` is not exported

- [ ] **Step 3: Write the rule, in a file the test can import cheaply**

Create `components/ui/table-data.ts`. Note there is **no `"use client"`** and no
JSX — it is a rule, not a component — and the only Ant Design import is a type.

```ts
import type { TablePaginationConfig } from "antd/es/table";

export interface ServerPage<RecordType> {
  rows: RecordType[];
  total: number;
  /** 1-based, as antd counts pages. */
  pageIndex: number;
  pageSize: number;
}

/** The subset of DataTable's props that decides what is on screen. */
export interface DataTableCoreProps<RecordType> {
  /** Client mode: the whole list, paged in the browser. */
  rows?: RecordType[];
  /** Server mode: one page, and how many there are altogether. */
  page?: ServerPage<RecordType>;
  dataSource?: readonly RecordType[];
  pagination?: TablePaginationConfig | false;
}

/**
 * Where the rows come from, and what the pager should say about them.
 *
 * Lives apart from `DataTable.tsx` so the contract can be tested without paying
 * for Ant Design's runtime: this project runs Vitest with `environment: "node"`,
 * and importing the component costs 55 seconds against this file's 0.4.
 *
 * The two modes exist so that moving a screen to server-side paging later
 * changes its data source and nothing else: the columns, the markup and the
 * URL state all stay as they are.
 */
export function resolveTableData<RecordType>(
  props: DataTableCoreProps<RecordType>,
): { data: readonly RecordType[]; pagination: TablePaginationConfig | false } {
  if (props.rows && props.page) {
    throw new Error(
      "DataTable was given both `rows` and `page`. Pass one: `rows` pages in the browser, `page` pages on the server.",
    );
  }

  const data = props.page?.rows ?? props.rows ?? props.dataSource ?? [];

  if (props.pagination === false) return { data, pagination: false };

  const shared = {
    showSizeChanger: true,
    showTotal: (total: number) => `${total.toLocaleString("en-US")} records`,
  };

  const pagination: TablePaginationConfig = props.page
    ? {
        ...shared,
        total: props.page.total,
        current: props.page.pageIndex,
        pageSize: props.page.pageSize,
        ...props.pagination,
      }
    : { ...shared, pageSize: 20, ...props.pagination };

  return { data, pagination };
}
```

- [ ] **Step 4: Wire DataTable to it**

Replace `components/ui/DataTable.tsx` with:

```tsx
"use client";

import type { ReactNode } from "react";
import { Empty, Table, Typography, type TableProps } from "antd";
import { resolveTableData, type ServerPage } from "./table-data";

export type { ServerPage };

export type DataTableProps<RecordType extends object> = TableProps<RecordType> & {
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
  /** Client mode: the whole list, paged in the browser. */
  rows?: RecordType[];
  /** Server mode: one page, and how many there are altogether. */
  page?: ServerPage<RecordType>;
};

export default function DataTable<RecordType extends object>({
  emptyTitle = "No records yet",
  emptyDescription,
  emptyAction,
  rows,
  page,
  pagination,
  dataSource,
  locale,
  scroll,
  // Accounting work means comparing many rows at once, so lists default to the
  // dense row height; a page can still opt into a roomier table.
  size = "small",
  ...props
}: DataTableProps<RecordType>) {
  const resolved = resolveTableData<RecordType>({ rows, page, dataSource, pagination });

  return (
    <div className="accounting-data-table">
      <Table<RecordType>
        {...props}
        size={size}
        dataSource={resolved.data as RecordType[]}
        pagination={resolved.pagination}
        scroll={{ x: "max-content", ...scroll }}
        locale={{
          ...locale,
          emptyText: locale?.emptyText ?? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={null}>
              <Typography.Text strong>{emptyTitle}</Typography.Text>
              {emptyDescription && (
                <Typography.Paragraph type="secondary" className="accounting-empty-description">
                  {emptyDescription}
                </Typography.Paragraph>
              )}
              {emptyAction && <div className="accounting-empty-action">{emptyAction}</div>}
            </Empty>
          ),
        }}
      />
    </div>
  );
}
```

- [ ] **Step 5: Write ReportTable**

Create `components/ui/ReportTable.tsx`:

```tsx
"use client";

import type { ReactNode } from "react";
import { Table } from "antd";
import DataTable, { type DataTableProps } from "./DataTable";

export type ReportTableProps<RecordType extends object> = DataTableProps<RecordType> & {
  /** The figures that close the report, rendered as a sticky summary row. */
  summary?: (rows: readonly RecordType[]) => ReactNode;
};

/**
 * A table that ends in a total.
 *
 * Six reports carry a summary row, and a report without its total is a list of
 * numbers rather than a statement. They also never paginate: a trial balance
 * split across pages does not add up on screen, which is the one thing a reader
 * is there to check.
 *
 * Everything else — the columns, the empty state, the dense rows — is
 * DataTable's, so the two cannot drift apart.
 */
export default function ReportTable<RecordType extends object>({
  summary,
  pagination = false,
  ...props
}: ReportTableProps<RecordType>) {
  return (
    <DataTable<RecordType>
      {...props}
      pagination={pagination}
      summary={summary ? (rows) => <Table.Summary fixed>{summary(rows)}</Table.Summary> : undefined}
    />
  );
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/unit/data-table-contract.test.ts`
Expected: PASS — 5 tests.

**Check the reported duration.** Under about two seconds means the test is
reading `table-data.ts` as intended. Tens of seconds means something reached
`DataTable` — most likely an `import` that should have been `import type` — and
the fix is that import, not a longer timeout.

- [ ] **Step 7: Prove no existing screen broke**

Run: `npm test`
Expected: every test passes. 33 files already render `DataTable`; this task
changed how it resolves its data, so the suite is the check that none of them
changed behaviour.

Then run: `npm run typecheck && npm run lint && npm run build`
Expected: typecheck exit 0; lint 0 errors; build clean.

The build matters here specifically: `DataTable` is rendered by 33 screens, and
a type error in its props surfaces at build time on all of them.

- [ ] **Step 8: Commit**

```bash
git add components/ui/table-data.ts components/ui/DataTable.tsx components/ui/ReportTable.tsx tests/unit/data-table-contract.test.ts
git commit -m "feat(table): let a table take its rows from the browser or from the server"
```

---

### Task 7: The raw-table guard

**Files:**
- Create: `tests/unit/table-adoption.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: one allowlist that batches 2 onward shrink

The guard goes on now, while 49 files are still on a raw table, so the gate stays
green throughout and the remaining work is a readable list rather than a feeling.
This is the same mechanism wave 1 used.

**Match the generic form or the guard is a lie.** This codebase writes
`<Table<InvoiceRow>` far more often than `<Table `, so a pattern of
`<Table[\s/>]` finds 16 of them and reports the rest as clean. It must also
*not* match `<TableOutlined`, which is an icon appearing in dozens of files with
no table at all. Those two mistakes are why the wave 2 survey's figure was
wrong.

**And there is a third, which cost this task two files.** A survey pattern must
match every character that can follow `Table` in a real element, not a list of
the ones that came to mind. An earlier draft of the command below spelled the
class `[[:space:]>/<]` and so missed `<Table.Summary.Row>` — two report screens
that already use `DataTable` but hand-roll their totals row from raw
`Table.Summary`. The guard's own pattern, `/<Table(?!\w)/`, caught them, because
it says what it means: anything but a word character. The command below now says
the same thing, so the human survey and the automated guard cannot disagree.

- [ ] **Step 1: Confirm the inventory still matches**

Run:

```bash
grep -rlE '<Table([^[:alnum:]_]|$)' --include=*.tsx app components | sort
```

Expected: 51 paths — the 49 in `RAW_TABLE` below, plus `DataTable.tsx` and
`ReportTable.tsx`, which are the implementations and are exempt by path.
`ReportTable` matches because it is what owns `<Table.Summary>` on the app's
behalf.

Compare set to set, not by count: two lists of 49 can differ and still both
have 49 entries.

If the output differs, the tree has moved since this plan was written. Correct
the list in Step 2 to the real output rather than the other way round; the
staleness case will fail otherwise, which is the guard doing its job.

- [ ] **Step 2: Write the test**

Create `tests/unit/table-adoption.test.ts`:

```ts
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every list goes through DataTable or ReportTable.
 *
 * A screen reaching for Ant Design's `Table` directly is how 61 tables ended up
 * with no pagination, 173 hand-written alignments and 25 different ways of
 * printing money. The allowlist below is the work still outstanding: it shrinks
 * with each migration batch and is deleted with the last one.
 *
 * `components/ui/DataTable.tsx` and `components/ui/ReportTable.tsx` are the
 * implementations and are exempt by path, not by list.
 */
const OWN_IMPLEMENTATION = new Set([
  "components/ui/DataTable.tsx",
  "components/ui/ReportTable.tsx",
]);

/**
 * Matches `<Table `, `<Table>`, `<Table/>`, `<Table` at end of line, and the
 * generic `<Table<Row>` this codebase mostly writes — but not `<TableOutlined`,
 * which is an icon. Built fresh on each call: a `/g` regex carries `lastIndex`
 * between `.test()` calls and would report every other file clean.
 */
function tablePattern(): RegExp {
  return /<Table(?!\w)/;
}

/**
 * Screens still rendering Ant Design's Table directly. 49 as of 2026-08-14.
 *
 * Two of these — ReportsClient.tsx and BudgetVsActualView.tsx — carry no bare
 * `<Table `, only a hand-rolled `summary` built from `<Table.Summary.Row>` and
 * `<Table.Summary.Cell>` bolted onto `DataTable`. That is still Ant Design's
 * Table reached into directly, and it is exactly what ReportTable exists to
 * own instead, so it belongs on this list like any other.
 */
const RAW_TABLE = new Set<string>([
  "app/(app)/approvals/ApprovalsClient.tsx",
  "app/(app)/banking/BankImportList.tsx",
  "app/(app)/banking/reconcile/ReconcileListClient.tsx",
  "app/(app)/banking/reconcile/[id]/ReconcileWorkspaceClient.tsx",
  "app/(app)/credit-memos/CreditMemosClient.tsx",
  "app/(app)/invoices/InvoicesClient.tsx",
  "app/(app)/items/ItemMovementsModal.tsx",
  "app/(app)/journal/JournalClient.tsx",
  "app/(app)/opening-balances/OpeningBalancesClient.tsx",
  "app/(app)/pay-bills/PayBillsClient.tsx",
  "app/(app)/payments/PaymentDetailDrawer.tsx",
  "app/(app)/payments/PaymentsClient.tsx",
  "app/(app)/payments/ReceivePaymentModal.tsx",
  "app/(app)/purchase-orders/[id]/BillFromPoModal.tsx",
  "app/(app)/purchase-orders/[id]/PurchaseOrderDetailClient.tsx",
  "app/(app)/purchase-orders/[id]/ReceiveModal.tsx",
  "app/(app)/reports/1099/Report1099Client.tsx",
  "app/(app)/reports/ReportsClient.tsx",
  "app/(app)/reports/cash-flow-forecast/CashFlowForecastClient.tsx",
  "app/(app)/reports/gl-posting/GlPostingClient.tsx",
  "app/(app)/reports/inventory-review/InventoryReviewClient.tsx",
  "app/(app)/reports/journal/JournalReportClient.tsx",
  "app/(app)/reports/number-sequence/NumberSequenceClient.tsx",
  "app/(app)/reports/saved/SavedReportViewer.tsx",
  "app/(app)/reports/saved/SavedReportsClient.tsx",
  "app/(app)/sales-tax/SalesTaxClient.tsx",
  "app/(app)/settings/approvals/ApprovalPoliciesClient.tsx",
  "app/(app)/settings/audit/AuditClient.tsx",
  "app/(app)/settings/companies/CompaniesClient.tsx",
  "app/(app)/settings/company/CompanySettingsClient.tsx",
  "app/(app)/settings/import/AccountTypeReview.tsx",
  "app/(app)/settings/import/ImportColumnsTable.tsx",
  "app/(app)/settings/import/ImportPreflightPanel.tsx",
  "app/(app)/settings/import/ImportPreviewPanel.tsx",
  "app/(app)/settings/import/LedgerBatchList.tsx",
  "app/(app)/settings/import/LedgerImportPanel.tsx",
  "app/(app)/settings/import/UnresolvedAccountsTable.tsx",
  "app/(app)/settings/periods/PeriodsClient.tsx",
  "app/(app)/settings/permissions/PermissionMatrixClient.tsx",
  "app/(app)/settings/users/UsersClient.tsx",
  "app/(app)/vendor-credits/VendorCreditsClient.tsx",
  "app/(app)/vendors/VendorTaxDrawer.tsx",
  "components/audit/DocumentAuditTrail.tsx",
  "components/banking/SettleFromBankModal.tsx",
  "components/payables/PayRunPanel.tsx",
  "components/reports/AgingByPartyTable.tsx",
  "components/reports/AllowanceForDoubtfulAccounts.tsx",
  "components/reports/BudgetVsActualView.tsx",
  "components/settlements/SettlementHistory.tsx",
]);

const ROOT = process.cwd();

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsxFiles(full));
    else if (entry.endsWith(".tsx")) out.push(full);
  }
  return out;
}

const files = [...tsxFiles(join(ROOT, "app")), ...tsxFiles(join(ROOT, "components"))].map(
  (file) => ({
    path: relative(ROOT, file).replaceAll("\\", "/"),
    source: readFileSync(file, "utf8"),
  }),
);

describe("table adoption", () => {
  it("finds files to check", () => {
    expect(files.length).toBeGreaterThan(150);
  });

  it("tells a table apart from the icon of one", () => {
    // The two mistakes this guard exists to avoid making itself.
    expect(tablePattern().test("<Table<InvoiceRow>")).toBe(true);
    expect(tablePattern().test("<Table\n  columns={cols}")).toBe(true);
    expect(tablePattern().test("<Table />")).toBe(true);
    expect(tablePattern().test("<TableOutlined />")).toBe(false);
  });

  it("renders Ant Design's Table nowhere outside the shrinking list", () => {
    const offenders = files
      .filter(({ path }) => !OWN_IMPLEMENTATION.has(path) && !RAW_TABLE.has(path))
      .filter(({ source }) => tablePattern().test(source))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it("lists no file that has already been migrated", () => {
    // Keeps the list honest. Migrate a screen and forget to delete its entry and
    // this fails, so the list cannot inflate into a record of work already done.
    const byPath = new Map(files.map((file) => [file.path, file.source]));
    const stale = [...RAW_TABLE].filter(
      (path) => !tablePattern().test(byPath.get(path) ?? ""),
    );
    expect(stale, "already migrated off Table").toEqual([]);
  });

  it("names a file that exists for every entry", () => {
    // A path typo would otherwise sit in the list forever, silently exempting
    // nothing and making the outstanding count look smaller than it is.
    const known = new Set(files.map((file) => file.path));
    const missing = [...RAW_TABLE].filter((path) => !known.has(path));
    expect(missing, "listed but not found on disk").toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it passes**

Run: `npx vitest run tests/unit/table-adoption.test.ts`
Expected: PASS — 5 tests, with the allowlist matching the inventory exactly.

If *"renders Ant Design's Table nowhere"* fails, an entry is missing from the
list. If *"lists no file that has already been migrated"* fails, the list names a
file that no longer qualifies. If *"names a file that exists"* fails, a path is
misspelled.

- [ ] **Step 4: Prove the guard bites**

Temporarily add `<Table<Row> />` — the generic form, because that is the one the
old pattern missed — to a `.tsx` file under `app/` that is not on the list.
Confirm the test fails and names that file, then revert. Confirm `git status` is
clean before committing.

- [ ] **Step 5: Run the four gates**

```bash
npm run typecheck && npm test && npm run lint && npm run build
```

Expected: all four green. **Paste the output verbatim, never trimmed** — the
pass/fail line is usually at the end.

- [ ] **Step 6: Commit**

```bash
git add tests/unit/table-adoption.test.ts
git commit -m "test(table): name the 49 screens still on a raw table, so the list can only shrink"
```

---

### Task 8: What the whole-branch review found

**Files:**
- Modify: `lib/client/use-table-url-state.ts`, `components/ui/columns.tsx`,
  `components/ui/table-data.ts`, `components/ui/ReportTable.tsx`,
  `lib/domain/money-display.ts`
- Modify: `tests/unit/columns.test.ts`, `tests/unit/design-status.test.ts`,
  `tests/unit/table-adoption.test.ts`
- Create: `components/ui/table-change.ts`, `tests/unit/table-change.test.ts`

**Interfaces:**
- Produces: `tableStateFromAntdChange(pagination, sorter): Partial<TableState>`

Added after Tasks 1–7 were each reviewed and approved. **Where this task's code
touches a block pinned earlier in this plan, this task's version is the one that
shipped.** Each change below is a finding a task-scoped review could not have
seen, because each is about how two tasks meet.

- [ ] **Step 1: The address is the live record in client mode**

`lib/client/use-table-url-state.ts` — **the batch's one Critical.**

The file already documents that in client mode the returned state is never
re-derived: the address is written with `history.replaceState`, the router never
updates, `useSearchParams` keeps its identity, and the `useMemo` returns its
first value forever. The consequence recorded at the time was that a table
rendering from that state would sit still.

That was the smaller half. `update` merges its patch onto that frozen state and
then rebuilds the **whole** query string from the result, so a second change to
a different control does not merely fail to appear — it erases the first:

```
update({ pageSize: 50 })                     ?size=50
update({ search: "acme" })                   ?q=acme          size=50 is gone
update({ sort: "due_date", order: "desc" })  ?sort=…&order=…
update({ page: 2 })                          ?page=2          the sort is gone
```

The link then disagrees with the screen, which is the exact failure this module
exists to prevent — "going back, sharing a link and reloading all return the
reader to what they were looking at" — in the mode that is the default.

Replace the first line of `update`'s body:

```ts
      // In client mode the address is the only live record. `state` above is
      // frozen at the last real navigation, because the router never sees the
      // writes below — so merging onto it would rebuild the query string from
      // a stale reading and drop whatever an earlier update wrote. Read the
      // address back instead: it is what those updates actually changed.
      const current =
        mode === "client" && typeof window !== "undefined"
          ? parseTableState(window.location.search, defaults)
          : state;
      const next = { ...current, ...patch };
```

`parseTableState` accepts the leading `?` — `URLSearchParams` strips it.

Server mode keeps using `state`: there the navigation is real, so the state is
already live and reading the address back would be the same value by a longer
route.

- [ ] **Step 2: A status a row does not carry**

`components/ui/columns.tsx` — `statusColumn` is the one builder in the file with
no absent path. `moneyColumn` has a six-clause guard, `dateColumn` has
`if (!value) return ABSENT`, `textColumn` has `value?.trim() ? value : ABSENT`.
`statusColumn` has none, so a null status renders `<ToneBadge tone="muted">` with
`null` for children: a grey icon and **no word at all** — a status communicated
by icon alone, in the file whose tone module exists to stop exactly that.

This is not the settled `Key<T>` ruling, which is about a `dataIndex` pointing at
the wrong *type*. This is a correctly typed, legitimately nullable column, and
the schema has one: `last_run_status` is `RecurringRunStatus | null`, and
`RecurringClient` renders it today behind an explicit null guard. That screen is
already on `DataTable` and is a likely early adopter, so adopting `statusColumn`
would silently delete its guard.

Add, as the first line of `statusColumn`'s `render`:

```ts
      // A row that carries no status has nothing to say, and the badge would
      // say it with a grey icon and no word — colour and shape alone, which is
      // what this tone vocabulary exists to prevent. The em dash is the same
      // answer the date and text builders give.
      if (value == null || value === "") return ABSENT;
```

and a test beside the unmapped-status one:

```ts
  it("shows an em dash for a row with no status, rather than a wordless icon", () => {
    const column = statusColumn<Row>({
      title: "Status",
      dataIndex: "status",
      tones: { paid: { tone: "positive", label: "Paid" } },
    });
    expect(column.render!(null, row, 0)).toBe("—");
    expect(column.render!("", row, 0)).toBe("—");
  });
```

- [ ] **Step 3: One page size, declared once**

`components/ui/table-data.ts` pins `pageSize: 20` and
`lib/domain/table-url-state.ts` pins `pageSize: 20`, with nothing keeping them in
step. A screen declaring `defaults = { ...DEFAULT_TABLE_STATE, pageSize: 50 }`
and reading `state.pageSize` from the hook still gets a 20-row table, because
`DataTable` never hears about it. Each task assumed the other owned the number.

Import it instead of repeating it:

```ts
import { DEFAULT_TABLE_STATE } from "@/lib/domain/table-url-state";
```

```ts
    pageSize: DEFAULT_TABLE_STATE.pageSize,
```

and add to the module's doc comment:

```
 * A screen driving its table from the address owns the other half of this:
 * pass `pagination={{ current: state.page, pageSize: state.pageSize }}`, or the
 * table pages by this default while the address says something else.
```

- [ ] **Step 4: The allowlist is a ratchet, not a list**

`tests/unit/table-adoption.test.ts` says the allowlist "shrinks with each
migration batch", and nothing makes that true. A new screen written with a raw
`<Table>` turns the guard green again by adding one line, and the count in the
comment goes stale without a word. Batches 2..n are run by different people, so
that is a road, not a cliff.

```ts
  it("only ever shrinks, so a new raw table cannot be waved through", () => {
    // The allowlist is the outstanding work. Adding to it is how a guard
    // quietly stops guarding, and it reads in a diff exactly like a migration.
    // Lowering this number is the migration; raising it has to be argued for.
    expect(RAW_TABLE.size).toBeLessThanOrEqual(49);
  });
```

- [ ] **Step 5: Three one-line corrections**

`lib/domain/money-display.ts` — anchor the strip. `text.replace("-", "")` is
unanchored and safe only because `formatMoney` hardcodes `en-US`, which never
puts a hyphen anywhere but a leading minus. `text.replace(/^-/, "")` puts that
invariant in the code rather than in a report.

`tests/unit/design-status.test.ts` — pin all five statuses, not three. The file
constrains `overdue` and `void` to a token directly and `draft` transitively;
`posted` and `pending` are checked for structure only, so either could move
silently. This module was just re-expressed onto a new foundation, which is
precisely when that happens:

```ts
    expect(statusToken("posted").color).toBe(TOKENS.intent.success);
    expect(statusToken("pending").color).toBe(TOKENS.intent.warning);
```

`tests/unit/columns.test.ts` — assert the positive branch, which nothing does:
swapping `TOKENS.money.positive` for the negative token passes all 16 tests
today. Add to the JPY test, which already renders a positive:

```ts
    expect(cell.props.style?.color).toBe(TOKENS.money.positive);
```

And replace the dangling `/** The props these cells actually carry. See
constraint 2 above. */` — "constraint 2" lives in a brief, not in the committed
file, so a reader has nothing to look at, and this plan tells batch-2 authors to
copy this helper:

```ts
/**
 * The props these cells actually carry. Named because React 19 narrows
 * `isValidElement` to `props: unknown`, so reading `.props.style` after the
 * guard needs a type the compiler can carry through it.
 */
```

`components/ui/ReportTable.tsx` — the doc comment over-claims twice. It says the
summary is "rendered as a sticky summary row", but `<Table.Summary fixed>` only
sticks when `scroll.y` or `sticky` is set and `DataTable` sets only `scroll.x`;
and it says reports "never paginate", which is a default a caller can override.
Say what is true: the summary row is rendered by `Table.Summary`, and pagination
is off unless a caller turns it on.

- [ ] **Step 6: The adapter, so 47 screens do not each invent one**

Create `components/ui/table-change.ts`. Spec §6 says sorting runs through
`useTableUrlState`, and nothing in the batch converts Ant Design's `onChange`
into a `TableState` — so the first sortable column in batch 2 gets a
hand-written adapter, and the second screen copies it slightly differently.
That is the duplication this wave exists to end.

```ts
import type { SorterResult } from "antd/es/table/interface";
import type { TablePaginationConfig } from "antd/es/table";
import { DEFAULT_TABLE_STATE, type TableState } from "@/lib/domain/table-url-state";

/**
 * What a table interaction means, in the vocabulary the address uses.
 *
 * Ant Design reports a page change and a sort change through the same
 * `onChange`, in its own shapes. Converting that in one place is what keeps 47
 * screens from each writing the same ten lines slightly differently.
 *
 * Ant Design is `import type` only, so a test of this file costs no runtime
 * import — the same reason `table-data.ts` exists separately from `DataTable`.
 */
export function tableStateFromAntdChange<T>(
  pagination: TablePaginationConfig,
  sorter: SorterResult<T> | SorterResult<T>[],
): Partial<TableState> {
  // An array only arrives for a multi-column sort. These screens sort by one
  // column, so the first entry is the whole story.
  const single = Array.isArray(sorter) ? sorter[0] : sorter;

  // A sort exists only where Ant Design reports a direction. This is the part
  // worth stating: clearing a sort does NOT clear `field` — Ant Design empties
  // `order` and `column` and leaves `field` and `columnKey` behind. Reading the
  // column name on its own would keep a table sorted for good after the reader
  // asked it to stop.
  const order = single?.order ?? null;
  const column = order ? (single?.columnKey ?? single?.field) : null;

  return {
    // The page comes from Ant Design rather than resetting to the first, and
    // that is deliberate: it already recomputes the page when the size changes,
    // and re-ordering a list does not change how many pages it has. The
    // return-to-page-one rule exists for a search box, which narrows the list
    // and does not come through here.
    page: pagination.current ?? DEFAULT_TABLE_STATE.page,
    pageSize: pagination.pageSize ?? DEFAULT_TABLE_STATE.pageSize,
    sort: typeof column === "string" ? column : null,
    order,
  };
}
```

Create `tests/unit/table-change.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { tableStateFromAntdChange } from "@/components/ui/table-change";
import { DEFAULT_TABLE_STATE } from "@/lib/domain/table-url-state";

interface Row {
  due_date: string;
}

describe("reading a table interaction as table state", () => {
  it("takes the page and the page size from the pager", () => {
    const patch = tableStateFromAntdChange<Row>({ current: 3, pageSize: 50 }, {});
    expect(patch.page).toBe(3);
    expect(patch.pageSize).toBe(50);
  });

  it("takes the sorted column and its direction", () => {
    const patch = tableStateFromAntdChange<Row>(
      { current: 1, pageSize: 20 },
      { columnKey: "due_date", field: "due_date", order: "descend" },
    );
    expect(patch.sort).toBe("due_date");
    expect(patch.order).toBe("descend");
  });

  it("reads a cleared sort as no sort, even though the column name is still there", () => {
    // This is the case that decides whether a table can ever stop being
    // sorted. Ant Design empties `order` and leaves `field` behind, so a
    // reading based on the column name would sort for good.
    const patch = tableStateFromAntdChange<Row>(
      { current: 1, pageSize: 20 },
      { columnKey: "due_date", field: "due_date", order: undefined },
    );
    expect(patch.sort).toBeNull();
    expect(patch.order).toBeNull();
  });

  it("takes the first column of a multi-column sort, because these screens sort by one", () => {
    const patch = tableStateFromAntdChange<Row>({ current: 1, pageSize: 20 }, [
      { columnKey: "due_date", order: "ascend" },
      { columnKey: "amount", order: "descend" },
    ]);
    expect(patch.sort).toBe("due_date");
    expect(patch.order).toBe("ascend");
  });

  it("falls back to the defaults when the pager says nothing", () => {
    const patch = tableStateFromAntdChange<Row>({}, {});
    expect(patch.page).toBe(DEFAULT_TABLE_STATE.page);
    expect(patch.pageSize).toBe(DEFAULT_TABLE_STATE.pageSize);
  });
});
```

- [ ] **Step 7: Correct the record of what this batch deviated from**

This plan lists four deliberate deviations from spec §6 and presents that list as
complete. Three more exist and were never written down. Add them:

- **`actionsColumn` does not route through `IconActionButton`.** The spec
  promised it would, inheriting a 44×44 target from wave 3. The shipped shape —
  `actions: (record) => ReactNode[]` — is the better design, because screens need
  `Popconfirm`, `Dropdown` and plain buttons too. But it makes the 44×44
  guarantee each caller's problem on 47 screens, and nothing said so. Remove
  `IconActionButton` from Task 3's `Consumes` line, which names a dependency the
  code never had.
- **A negative amount is marked by sign and colour, not sign and icon.** The
  spec asked for an icon. The minus sign in the text satisfies the underlying
  rule — it survives a printout and a colour-blind reader — and an icon in every
  money cell would be noise. Recorded, not changed.
- **Sorting runs through `useTableUrlState` only as of Task 8.** Batch 1
  originally shipped the URL vocabulary for sort with nothing to produce or
  consume it; Step 6 above closes that.

- [ ] **Step 8: Gates and commit**

Run: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`.
Expected: all green. The build binds — `DataTable` and `ReportTable` are on the
graph of 33 screens.

Commit each concern separately rather than as one wave, so the Critical is
readable on its own in the log.

---

## Batch 1 acceptance criteria

- [ ] `moneyColumn` takes its currency **and its decimal places** from the row, aligns right, uses tabular figures, and gives a negative both a colour token and a spoken label
- [ ] `moneyDisplay` requires `decimals` — no default — and `-0` reads identically to `0` in the sign, the text and the spoken label
- [ ] `statusColumn` accepts a per-screen tone map, and shows an unmapped status rather than hiding it
- [ ] `dateColumn` emits `<time dateTime>` and shows the same text these screens already showed
- [ ] `DataTable` accepts `rows`, `page` or `dataSource`, and throws if given two at once
- [ ] `ReportTable` renders a summary row and does not paginate
- [ ] `lib/design/status.tsx` sits on the tone vocabulary, and its six existing tests pass unchanged
- [ ] The allowlist matches the real inventory at 49 files, its pattern matches the generic `<Table<Row>` form and `<Table.Summary>` but not `<TableOutlined`, and the guard has been shown to fail when a new raw table appears
- [ ] **No screen changed.** `git diff --stat main..HEAD` touches nothing under `app/` except the guard's own temporary probe, reverted
- [ ] All four gates green, output pasted verbatim
