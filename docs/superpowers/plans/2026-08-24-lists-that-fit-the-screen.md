# Lists That Fit The Screen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No table in the application scrolls sideways at a viewport of 1280px or wider, and no column spends width on a value that repeats down every row.

**Architecture:** One shared set of pixel-width tokens for columns whose content has a known length, and one or two width-less "elastic" columns per table that absorb whatever room is left. `DataTable` stops handing Ant Design `scroll={{ x: "max-content" }}`, so `table-layout: fixed` pins the row total to the box. Values displaced by the narrowing move to a second, muted line inside the elastic cell rather than being deleted. The August resize gesture stays but becomes zero-sum: the room a widened column takes comes out of the table's last elastic column, which never takes a width of its own.

**Tech Stack:** Next.js 15 App Router, React 19, Ant Design 5 (`Table` via `components/ui/DataTable.tsx`), TypeScript, Vitest for unit and contract tests, Playwright for the runtime gate, Supabase for the signed-in session the gate needs.

## Global Constraints

- Every command in this plan runs from `ctyhp-accounting/`, never the repository root.
- The table box is `viewport - 296px` (248px `Sider` + 24px margin each side): 1174px at 1470, 984px at 1280.
- The floor: **no horizontal scrolling at viewport >= 1280**, i.e. a box of 984px. Below 1280 a table may scroll inside its own box.
- Every reworked table must satisfy `sum(measured widths) + chrome + sum(elastic floors) <= 984`, where `chrome` is the pinned action columns plus the selection checkbox.
- A column width is a token from `lib/design/table-metrics.ts`. Hand-picked pixel numbers are what this work is removing.
- Elastic columns pass **no** `width`. Exactly one elastic column per table — the declared last one — never receives a width even after a drag.
- No table passes `scroll.x` under `fit`. `fit={false}` is only for a genuine matrix and must carry a comment naming which one.
- UI copy stays US English. Money, date and status formatting is not changed by this work.
- Commit messages carry no `Co-Authored-By: Claude` line and no "Generated with Claude Code" line.
- Single test file: `npx vitest run tests/unit/<file>`. Whole suite: `npm test`.

---

### Task 1: The width tokens

**Files:**
- Create: `lib/design/table-metrics.ts`
- Create: `tests/unit/table-metrics.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `COLUMN` (a frozen record of pixel numbers: `DATE`, `MONEY`, `MONEY_WIDE`, `CODE`, `STATUS`, `QTY`, `PICKER`, `ACTION`, `SELECTION`, `TEXT_MIN`, `RICH_MIN`), `TABLE_BOX_AT_1280: number`, and `fitsBox(measured: number, elasticFloor: number, box?: number): boolean`. Every later task reads widths from `COLUMN` and asserts its own row with `fitsBox`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/table-metrics.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { COLUMN, TABLE_BOX_AT_1280, fitsBox } from "@/lib/design/table-metrics";

describe("the column width tokens", () => {
  it("are whole pixels above zero", () => {
    for (const [name, px] of Object.entries(COLUMN)) {
      expect(Number.isInteger(px), name).toBe(true);
      expect(px, name).toBeGreaterThan(0);
    }
  });

  it("knows the narrowest box this design supports", () => {
    // 1280 viewport, minus the 248px sidebar and the 24px margin each side.
    expect(TABLE_BOX_AT_1280).toBe(984);
  });

  it("leaves the banking row inside that box", () => {
    // Date, Amount, Category, two icon buttons and the selection checkbox are
    // measured; Description and Match are elastic and only have floors.
    const measured =
      COLUMN.DATE + COLUMN.MONEY + COLUMN.PICKER + COLUMN.ACTION * 2 + COLUMN.SELECTION;
    expect(fitsBox(measured, COLUMN.TEXT_MIN + COLUMN.RICH_MIN)).toBe(true);
  });

  it("reports a row that does not fit instead of rounding it down", () => {
    expect(fitsBox(700, 400)).toBe(false);
  });

  it("lets a caller ask about a wider box", () => {
    expect(fitsBox(700, 400, 1174)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/table-metrics.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/design/table-metrics"`.

- [ ] **Step 3: Write the module**

Create `lib/design/table-metrics.ts`:

```ts
/**
 * How wide a column is allowed to be, in one place.
 *
 * A reader filed the same complaint four times between 2026-08-01 and
 * 2026-08-22: the columns have gaps, and the useful ones are off the side of
 * the screen. Both halves were one fault. `/banking` spent 200px on an account
 * name identical on every row and 135px on a column of em dashes, and pushed
 * Match and Status past the right-hand edge to do it.
 *
 * So a width is no longer a number somebody picks per screen. A column whose
 * content has a known length takes a token from here; a column holding text
 * somebody typed takes no width at all and absorbs what is left.
 *
 * Plain numbers, no imports: `tests/unit/table-metrics.test.ts` asserts against
 * them directly, and `fitsBox` lets each screen assert its own row without
 * rendering a table.
 */
export const COLUMN = {
  /** A date as this app prints it: 2026-07-13. */
  DATE: 88,
  /** An amount with tabular figures, up to -327,089.13 — the largest on file. */
  MONEY: 116,
  /** A running balance, which carries one more digit than the amounts do. */
  MONEY_WIDE: 124,
  /** A document number, an account code, a prefix. */
  CODE: 110,
  /** One tag, such as "For review". */
  STATUS: 104,
  /** A count or a percentage. */
  QTY: 88,
  /** A select rendered inside the cell, which needs room for its arrow. */
  PICKER: 150,
  /** One icon button. A group of three is 120. */
  ACTION: 40,
  /** Ant Design's row-selection checkbox column. */
  SELECTION: 36,
  /**
   * The floor for an elastic column holding text. 200px still shows enough of
   * a wire description to tell two lines apart, and the whole value is one
   * hover away.
   */
  TEXT_MIN: 200,
  /**
   * The floor for an elastic column holding controls. Match carries a tag, a
   * line of text and up to three buttons; below 240 those stack into the
   * broken pile a reader screenshotted in August.
   */
  RICH_MIN: 240,
} as const;

/**
 * The table's own width at the narrowest viewport this design supports.
 *
 * 1280 - 248 (Sider, components/AppShell.tsx) - 48 (.app-shell__content
 * margin, app/globals.css) = 984. Every reworked table has to fit here, not
 * merely on the reporter's 1470px screen.
 */
export const TABLE_BOX_AT_1280 = 984;

/**
 * Whether a row of columns fits, given what its elastic columns need at their
 * narrowest.
 *
 * `measured` is every fixed width in the row including the pinned actions and
 * the selection checkbox; `elasticFloor` is the sum of the floors of the
 * columns that carry no width. A screen calls this in its own unit test, so a
 * column added later fails a test rather than a reader's screen.
 */
export function fitsBox(
  measured: number,
  elasticFloor: number,
  box: number = TABLE_BOX_AT_1280,
): boolean {
  return measured + elasticFloor <= box;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/table-metrics.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/design/table-metrics.ts tests/unit/table-metrics.test.ts
git commit -m "feat(tables): one place that says how wide a column may be"
```

---

### Task 2: The two column builders

**Files:**
- Modify: `components/ui/columns.tsx` (append after `textColumn`, around line 182)
- Modify: `tests/unit/columns.test.ts` (append a new `describe`)

**Interfaces:**
- Consumes: `COLUMN` from Task 1.
- Produces:
  - `flexColumn<T>(spec: { title: string; dataIndex?: Extract<keyof T, string>; render?: ColumnType<T>["render"]; key?: string; floor?: number }): ColumnType<T>` — returns a column with **no** `width`, `ellipsis: { showTitle: false }`, and a tooltip-wrapped renderer. Carries its floor as `minWidth` on the returned object for the screen's own arithmetic; Ant Design ignores unknown keys.
  - `secondaryLine(text: ReactNode): ReactElement` — the 12px muted single line used under an elastic cell's primary text.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/columns.test.ts`:

```ts
describe("flexColumn", () => {
  it("carries no width at all, which is what makes it elastic", () => {
    const column = flexColumn<Row>({ title: "Memo", dataIndex: "memo" });
    expect(column.width).toBeUndefined();
    // A fixed layout needs the cut declared on the column, or a long memo
    // widens the table instead of being truncated.
    expect(column.ellipsis).toEqual({ showTitle: false });
  });

  it("keeps its floor where the screen can read it", () => {
    expect(flexColumn<Row>({ title: "Memo", dataIndex: "memo" }).minWidth).toBe(COLUMN.TEXT_MIN);
    expect(flexColumn<Row>({ title: "Match", key: "match", floor: COLUMN.RICH_MIN }).minWidth).toBe(
      COLUMN.RICH_MIN,
    );
  });

  it("shows the whole value on hover, and an em dash when there is none", () => {
    const column = flexColumn<Row>({ title: "Memo", dataIndex: "memo" });
    const cell = asElement(column.render?.("a wire description", row, 0), "flex cell");
    expect(cell.props.title).toBe("a wire description");
    const empty = column.render?.(null, row, 0);
    expect(empty).toBe("—");
  });
});

describe("secondaryLine", () => {
  it("is one muted 12px line that cuts rather than wraps", () => {
    const line = asElement(secondaryLine("Bank of America · 121"), "secondary line");
    expect(line.props.style?.fontSize).toBe(12);
    expect(line.props.style?.whiteSpace).toBe("nowrap");
    expect(line.props.style?.textOverflow).toBe("ellipsis");
  });
});
```

Extend the existing import at the top of that file to
`import { actionsColumn, dateColumn, flexColumn, moneyColumn, secondaryLine, statusColumn, textColumn } from "@/components/ui/columns";`
and add `import { COLUMN } from "@/lib/design/table-metrics";`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/columns.test.ts`
Expected: FAIL — `flexColumn` is not exported.

- [ ] **Step 3: Write the builders**

Append to `components/ui/columns.tsx`:

```tsx
export interface FlexColumnSpec<T> {
  title: string;
  dataIndex?: Key<T>;
  key?: string;
  render?: ColumnType<T>["render"];
  /**
   * How narrow this column may get before the table stops giving room away.
   * Text columns take the default; a cell holding controls passes RICH_MIN.
   */
  floor?: number;
}

/**
 * A column with no width, which is the whole point of it.
 *
 * Under `table-layout: fixed` the columns that declare a width take it and the
 * rest share what is left. That is how a table ends up exactly as wide as its
 * box: every screen has one or two of these, and they absorb the remainder
 * instead of a scrollbar absorbing it.
 *
 * `minWidth` is not an Ant Design column property. It is carried here so the
 * screen's own unit test can add up its floors through `fitsBox`, and Ant
 * Design passes unknown keys through untouched.
 */
export function flexColumn<T>(spec: FlexColumnSpec<T>): ColumnType<T> & { minWidth: number } {
  const floor = spec.floor ?? COLUMN.TEXT_MIN;
  return {
    title: spec.title,
    ...(spec.dataIndex ? { dataIndex: spec.dataIndex } : null),
    ...(spec.key ? { key: spec.key } : null),
    minWidth: floor,
    // No width. See the note above.
    ellipsis: { showTitle: false },
    render:
      spec.render ??
      ((value: unknown) => {
        const text = typeof value === "string" ? value.trim() : "";
        if (text === "") return ABSENT;
        // `title` rather than Ant Design's own tooltip: this renders inside a
        // cell that is already truncating, and a Tooltip here would need a
        // wrapper element that breaks the ellipsis (see long-text-column.tsx).
        return <span title={text}>{text}</span>;
      }),
  };
}

/**
 * The muted line under an elastic cell's primary text.
 *
 * This is where a narrowed table puts what used to be its own column — the
 * account a line came from, the reference the bank sent, the journal entry it
 * posted to. One line, cut with an ellipsis, so a row never grows a third line
 * and the table keeps scrolling only downwards.
 */
export function secondaryLine(text: ReactNode): ReactElement {
  return (
    <span
      style={{
        display: "block",
        fontSize: 12,
        color: TOKENS.text.secondary,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </span>
  );
}
```

Add to that file's imports: `import type { ReactElement } from "react";` (merge with the existing `ReactNode` import) and `import { COLUMN } from "@/lib/design/table-metrics";`.

- [ ] **Step 4: Confirm the token exists on TOKENS**

Run: `node -e "const t=require('fs').readFileSync('lib/design/tokens.ts','utf8'); console.log(/secondary:/.test(t))"`
Expected: `true`. If it prints `false`, read `lib/design/tokens.ts` and use the muted text token it does define (do not introduce a hex value).

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/unit/columns.test.ts`
Expected: PASS, including the two new describes.

- [ ] **Step 6: Commit**

```bash
git add components/ui/columns.tsx tests/unit/columns.test.ts
git commit -m "feat(tables): a column with no width, and the line under it"
```

---

### Task 3: DataTable holds its box

**Files:**
- Modify: `components/ui/DataTable.tsx`
- Modify: `app/globals.css` (near the `.accounting-data-table` block, line 602 onwards)
- Create: `tests/unit/table-fit-contract.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `DataTableProps.fit?: boolean` (default `true`). Under `fit`, `DataTable` passes no `scroll.x` and sets `tableLayout="fixed"`, and its wrapper carries the class `accounting-table--fit`. Tasks 6, 8, 9 and 10 rely on both.

- [ ] **Step 1: Verify the Ant Design risk before writing anything**

The spec flags one unknown: `fixed: "right"` action columns with no `scroll.x`. Find out now.

Run: `grep -rn "fixed" node_modules/@rc-component/table/lib/hooks/useFixedInfo.js | head -20`
Then run: `grep -rn "horizonScroll\|scrollX" node_modules/@rc-component/table/lib/Table.js | head -20`

Expected: the fixed-column offsets are computed from the measured column widths and only take effect while horizontal scrolling is on. Record what you find in the commit message of Step 8. If pinning turns out to warn or to misplace a cell, drop `fixed: "right"` from the two banking action columns in Task 6 — with no horizontal scroll there is nothing for them to stick to.

- [ ] **Step 2: Write the failing contract test**

Create `tests/unit/table-fit-contract.test.ts`:

```ts
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * No table asks for horizontal scrolling.
 *
 * `components/ui/DataTable.tsx` handed Ant Design `scroll={{ x: "max-content" }}`
 * for every one of 38 tables, which is why one reader filed the same complaint
 * on four different screens: each fix landed on the screen that was reported
 * and the default kept producing the next one. This test is the boundary. A
 * table that genuinely is a matrix goes on the list below, with its reason.
 */
const MATRIX = new Map<string, string>([
  [
    "app/(app)/settings/permissions/PermissionMatrixClient.tsx",
    "permissions by role: a grid, and both axes are data",
  ],
  [
    "components/reports/BudgetVsActualView.tsx",
    "twelve months plus variance columns, chosen by the report not the screen",
  ],
  ["components/reports/PnlTrendView.tsx", "one column per period, count chosen by the reader"],
  [
    "components/reports/BalanceSheetTrendView.tsx",
    "one column per period, count chosen by the reader",
  ],
  [
    "app/(app)/reports/saved/SavedReportViewer.tsx",
    "columns come from a stored report definition, unknown at build time",
  ],
]);

/** The implementation itself declares the default; it is exempt by path. */
const OWN_IMPLEMENTATION = new Set(["components/ui/DataTable.tsx"]);

function sourceFiles(dir: string, root: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, root, out);
    else if (entry.endsWith(".tsx")) out.push(relative(root, full).replaceAll("\\", "/"));
  }
  return out;
}

describe("the horizontal scroll boundary", () => {
  const root = process.cwd();
  const files = [...sourceFiles(join(root, "app"), root), ...sourceFiles(join(root, "components"), root)];

  it("finds the files it is supposed to be guarding", () => {
    // A broken walk would pass this suite by checking nothing at all.
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain("app/(app)/banking/BankTransactionsTable.tsx");
  });

  it("has no table asking for a horizontal scroll outside the matrix list", () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (OWN_IMPLEMENTATION.has(file) || MATRIX.has(file)) continue;
      const source = readFileSync(join(root, file), "utf8");
      if (!/DataTable|ReportTable/.test(source)) continue;
      // `x: "max-content"`, `x: 1450`, `x: true` — every shape that turns
      // sideways scrolling back on.
      if (/scroll=\{\{[^}]*\bx\s*:/.test(source)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it("only exempts a table that is really a matrix, and says why", () => {
    for (const [file, reason] of MATRIX) {
      expect(readFileSync(join(root, file), "utf8"), file).toMatch(/fit=\{false\}/);
      expect(reason.length, file).toBeGreaterThan(20);
    }
  });
});
```

- [ ] **Step 3: Run it to see the real scale of the problem**

Run: `npx vitest run tests/unit/table-fit-contract.test.ts`
Expected: FAIL. The second test lists every file that still passes `scroll.x` — around 20 entries including `banking/BankTransactionsTable.tsx`, `fixed-assets/FixedAssetsClient.tsx`, `recurring/RecurringClient.tsx`. The third test fails too, because no file has `fit={false}` yet. This list is the work in Tasks 6 to 11; keep it.

- [ ] **Step 4: Add the `fit` prop to DataTable**

In `components/ui/DataTable.tsx`, add to the props type after `page`:

```tsx
  /**
   * Whether this table is held to the width of its box. Default: it is.
   *
   * `false` restores Ant Design's `x: "max-content"` and is only for a table
   * that genuinely is a matrix — a grid whose column count is data rather than
   * design. Every use is named in tests/unit/table-fit-contract.test.ts.
   */
  fit?: boolean;
```

Change the destructuring to include `fit = true, className, tableLayout,` and replace the `scroll` line in the returned `Table` with:

```tsx
        tableLayout={tableLayout ?? (fit ? "fixed" : undefined)}
        // Under `fit` the row total is the box, so there is nothing to scroll
        // sideways and `scroll.x` must not be set: a single `x` here is what
        // let 38 tables outgrow their container. A caller may still ask for a
        // vertical viewport.
        scroll={fit ? (scroll?.y === undefined ? undefined : { y: scroll.y }) : { x: "max-content", ...scroll }}
```

and the wrapper div:

```tsx
    <div className={`accounting-data-table${fit ? " accounting-table--fit" : ""}`}>
```

- [ ] **Step 5: Add the CSS floor**

In `app/globals.css`, after the `.accounting-data-table` rule that ends at line 609, insert:

```css
/*
 * A table held to its box.
 *
 * `fit` means the row total is the container width, so no horizontal scrollbar
 * is offered at all. Below the narrowest viewport this design supports (1280,
 * a 984px box) the columns would have to go under their floors, so the table
 * keeps a minimum and scrolls inside its own frame rather than squeezing the
 * amounts into two characters. That is a phone and tablet-portrait case only.
 */
.accounting-table--fit .ant-table table {
  min-width: 960px;
}

.accounting-table--fit .ant-table-content,
.accounting-table--fit .ant-table-body {
  overflow-x: auto;
}
```

- [ ] **Step 6: Restrict the old exact-widths override**

`.accounting-table--exact-widths` (line 639) exists to stop rc-table stretching a narrow table across a wide screen. Under `fit` that stretch is what we want. Change its selectors so it only applies outside `fit`, by prefixing each with `:not(.accounting-table--fit)`:

```css
.accounting-data-table:not(.accounting-table--fit).accounting-table--exact-widths .ant-table-header table,
.accounting-data-table:not(.accounting-table--fit).accounting-table--exact-widths .ant-table-body table,
.accounting-data-table:not(.accounting-table--fit).accounting-table--exact-widths .ant-table-content table {
  min-width: 0 !important;
}
```

- [ ] **Step 7: Run the existing table suites**

Run: `npx vitest run tests/unit/data-table-contract.test.ts tests/unit/table-adoption.test.ts tests/unit/table-pagination.test.ts`
Expected: PASS. These cover the props `DataTable` already had; a break here means the destructuring change dropped something.

- [ ] **Step 8: Commit**

```bash
git add components/ui/DataTable.tsx app/globals.css tests/unit/table-fit-contract.test.ts
git commit -m "feat(tables): hold a list to the width of its box"
```

The contract test still fails at this commit, and that is deliberate: it is the work list for Tasks 6 to 11. State that in the commit body, together with what Step 1 found about pinned columns.

---

### Task 4: The zero-sum arithmetic

**Files:**
- Modify: `lib/domain/column-width.ts`
- Modify: `tests/unit/column-width.test.ts`

**Interfaces:**
- Consumes: `MIN_COLUMN_WIDTH`, `clampColumnWidth` (already in that module).
- Produces:

```ts
export interface BoxBudget {
  /** The table's own width in pixels, measured from the DOM at pointer-down. */
  box: number;
  /** Pinned action columns plus the selection checkbox: room no drag reclaims. */
  chrome: number;
  /** The floors of the elastic columns that still carry no width. */
  elasticFloor: number;
}

export function resizeWithinBox<K extends string>(
  widths: Partial<Record<K, number>>,
  key: K,
  nextWidth: number,
  budget: BoxBudget,
  mins?: Partial<Record<K, number>>,
): Partial<Record<K, number>>;
```

Task 5 calls this from `useColumnResize`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/column-width.test.ts`:

```ts
describe("resizeWithinBox", () => {
  // Banking: date, amount and category are measured, description has been
  // dragged so it now carries a width too, and match is the last elastic
  // column and never does.
  const WIDTHS = { date: 88, amount: 116, category: 150, description: 300 };
  const BUDGET = { box: 984, chrome: 116, elasticFloor: 240 };

  it("lets a column widen while the elastic column can still pay for it", () => {
    const next = resizeWithinBox(WIDTHS, "description", 320, BUDGET);
    expect(next.description).toBe(320);
  });

  it("stops the drag where the elastic column would go under its floor", () => {
    // 984 - 116 chrome - 240 floor = 628 for the measured columns.
    // date+amount+category = 354, so description may reach 274 and no further.
    const next = resizeWithinBox(WIDTHS, "description", 900, BUDGET);
    expect(next.description).toBe(274);
  });

  it("keeps the row inside its box after every widening", () => {
    for (const attempt of [200, 274, 275, 600, 5000]) {
      const next = resizeWithinBox(WIDTHS, "description", attempt, BUDGET);
      const measured = Object.values(next).reduce((sum, px) => sum + (px ?? 0), 0);
      expect(measured + BUDGET.chrome + BUDGET.elasticFloor).toBeLessThanOrEqual(BUDGET.box);
    }
  });

  it("always allows narrowing, down to the column's own floor", () => {
    expect(resizeWithinBox(WIDTHS, "category", 90, BUDGET, { category: 150 }).category).toBe(150);
    expect(resizeWithinBox(WIDTHS, "description", 10, BUDGET).description).toBe(MIN_COLUMN_WIDTH);
  });

  it("never widens a column in a box too small for what is already declared", () => {
    // A 900px box cannot hold these widths at all. The drag holds still rather
    // than making it worse, and nothing shrinks behind the reader's back.
    const tight = { box: 700, chrome: 116, elasticFloor: 240 };
    const next = resizeWithinBox(WIDTHS, "description", 400, tight);
    expect(next.description).toBe(WIDTHS.description);
    expect(next.date).toBe(WIDTHS.date);
  });

  it("leaves every other column exactly as it was", () => {
    const next = resizeWithinBox(WIDTHS, "description", 250, BUDGET);
    expect(next).toEqual({ ...WIDTHS, description: 250 });
  });
});
```

Add `resizeWithinBox` to that file's import list from `@/lib/domain/column-width`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/column-width.test.ts`
Expected: FAIL — `resizeWithinBox is not a function`.

- [ ] **Step 3: Write the function**

Append to `lib/domain/column-width.ts`:

```ts
/**
 * What a table has to fit inside, for the arithmetic below.
 */
export interface BoxBudget {
  /** The table's own width, measured from the DOM once at pointer-down. */
  box: number;
  /**
   * Everything in the row that is not a resizable column: the pinned action
   * columns and Ant Design's selection checkbox. A drag can never reclaim it.
   */
  chrome: number;
  /** The floors of the elastic columns that still carry no width of their own. */
  elasticFloor: number;
}

/**
 * A column's new width, refused where it would push the row out of its box.
 *
 * This replaces the arithmetic that made the August resize gesture the thing
 * the reader complained about next. `totalColumnWidth` below adds the widths up
 * and hands the sum to `scroll.x`, so widening a column manufactured
 * horizontal scrolling — the exact fault being reported. Here the box is fixed
 * and the widths have to live inside it: widening takes room from the elastic
 * column, and stops when that column reaches its floor.
 *
 * Narrowing is never refused. Room given up goes straight back to the elastic
 * column, which is what makes the gesture zero-sum rather than a scrollbar
 * generator.
 *
 * Nothing here reads the DOM, so all five rules are asserted directly in
 * tests/unit/column-width.test.ts.
 */
export function resizeWithinBox<K extends string>(
  widths: Partial<Record<K, number>>,
  key: K,
  nextWidth: number,
  budget: BoxBudget,
  mins: Partial<Record<K, number>> = {},
): Partial<Record<K, number>> {
  const min = mins[key] ?? MIN_COLUMN_WIDTH;
  const wanted = clampColumnWidth(nextWidth, min);
  const current = widths[key] ?? min;

  // Room for the measured columns once the untouchable parts are taken out.
  const forMeasured = budget.box - budget.chrome - budget.elasticFloor;
  const others = (Object.keys(widths) as K[])
    .filter((other) => other !== key)
    .reduce((sum, other) => sum + (widths[other] ?? 0), 0);
  const ceiling = forMeasured - others;

  // Narrowing always goes through. Widening only as far as the ceiling, and
  // never below where the column already is: a box too small for what is
  // already declared must not shrink a column nobody dragged.
  const allowed = wanted <= current ? wanted : Math.max(current, Math.min(wanted, ceiling));
  return { ...widths, [key]: Math.max(min, allowed) };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/column-width.test.ts`
Expected: PASS, the six new tests plus everything already in the file.

- [ ] **Step 5: Commit**

```bash
git add lib/domain/column-width.ts tests/unit/column-width.test.ts
git commit -m "feat(tables): a resize that cannot manufacture a scrollbar"
```

---

### Task 5: The gesture becomes zero-sum

**Files:**
- Modify: `components/ui/useColumnResize.ts`
- Create: `tests/unit/column-width-storage.test.ts`

**Interfaces:**
- Consumes: `resizeWithinBox`, `BoxBudget`, `parseStoredWidths`, `serializeColumnWidths` (Task 4 and existing).
- Produces: `useColumnResize<K>(defaults: Partial<Record<K, number>>, storageKey: string, mins?: Partial<Record<K, number>>, budget?: { chrome: number; elasticFloor: number }, legacyStorageKey?: string)` returning `{ widths: Partial<Record<K, number>>, resizeHandleProps, guardHeaderDrag }`. `widths[key]` is now `number | undefined`: undefined means elastic. Tasks 6 and 10 pass `budget` and `legacyStorageKey`.

- [ ] **Step 1: Write the failing test for the storage migration**

The hook itself cannot run under `vitest` in this repo (see its module comment), so the migration is tested through the pure helper it calls. Create `tests/unit/column-width-storage.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { discardOversizeWidths, parseStoredWidths } from "@/lib/domain/column-width";

/**
 * The reader who filed the complaint had already dragged their columns, so
 * 1530px of August widths sit in their browser. Merged over the new defaults
 * those numbers put the horizontal scrollbar straight back for exactly the
 * person who reported it.
 */
describe("widths recovered from a browser", () => {
  it("drops a stored set that cannot fit the narrowest box", () => {
    const august = { date: 115, description: 320, account: 200, reference: 135, amount: 140 };
    expect(discardOversizeWidths(august, { box: 984, chrome: 116, elasticFloor: 240 })).toEqual({});
  });

  it("keeps a stored set that fits", () => {
    const mine = { date: 88, description: 300, amount: 116 };
    expect(discardOversizeWidths(mine, { box: 984, chrome: 116, elasticFloor: 240 })).toEqual(mine);
  });

  it("keeps working on a store holding keys the release removed", () => {
    const stored = parseStoredWidths('{"date":88,"gone":200}', ["date"] as const);
    expect(stored).toEqual({ date: 88 });
    expect(discardOversizeWidths(stored, { box: 984, chrome: 0, elasticFloor: 240 })).toEqual({
      date: 88,
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/column-width-storage.test.ts`
Expected: FAIL — `discardOversizeWidths is not exported`.

- [ ] **Step 3: Add the helper**

Append to `lib/domain/column-width.ts`:

```ts
/**
 * Stored widths, thrown away wholesale when they cannot fit.
 *
 * Not clamped one by one: the widths a reader dragged are a layout, and a
 * layout half-honoured is neither theirs nor the shipped one. If the set as a
 * whole no longer fits the narrowest box we support, the shipped defaults are
 * the better answer — they are guaranteed to fit — and the reader can drag
 * again from there.
 */
export function discardOversizeWidths<K extends string>(
  stored: Partial<Record<K, number>>,
  budget: BoxBudget,
): Partial<Record<K, number>> {
  const total = Object.values(stored).reduce((sum, px) => sum + (px ?? 0), 0);
  return total + budget.chrome + budget.elasticFloor <= budget.box ? stored : {};
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/unit/column-width-storage.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Rewire the hook**

In `components/ui/useColumnResize.ts`:

1. Widen the state and the result type from `Record<K, number>` to `Partial<Record<K, number>>` — an elastic column has no width until it is dragged.
2. Add the two new parameters:

```ts
export function useColumnResize<K extends string>(
  defaults: Partial<Record<K, number>>,
  storageKey: string,
  mins: Partial<Record<K, number>> = {},
  /**
   * What this table spends on things a drag cannot reclaim, and what its
   * elastic columns need at their narrowest. Without it the drag has no
   * ceiling and can put the scrollbar back — which is the whole complaint.
   */
  budget: { chrome: number; elasticFloor: number } = { chrome: 0, elasticFloor: 0 },
  /** A previous release's storage key, deleted on first read. */
  legacyStorageKey?: string,
): UseColumnResizeResult<K> {
```

3. In the mount effect, after `parseStoredWidths(...)`, pass the result through the new helper and clear the old key:

```ts
    const keys = Object.keys(defaults) as K[];
    const recovered = discardOversizeWidths(parseStoredWidths(stored, keys, mins), {
      box: measuredBox.current ?? TABLE_BOX_AT_1280,
      ...budget,
    });
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWidths(mergeColumnWidths(defaults, recovered));
    setHydrated(true);
    if (legacyStorageKey) {
      try {
        window.localStorage.removeItem(legacyStorageKey);
      } catch {
        // A profile that refuses storage also refuses removal. Nothing to do:
        // there is no stored layout to migrate on such a profile either.
      }
    }
```

`mergeColumnWidths` already spreads defaults then stored, so a key absent from both stays `undefined` — which is exactly "still elastic".

4. In `resizeHandleProps`, measure the box and the column from the DOM at pointer-down, and route the move through `resizeWithinBox`:

```ts
      onResizeStart: (event: ReactPointerEvent<HTMLElement>) => {
        event.preventDefault();
        event.stopPropagation();
        const cell = (event.target as HTMLElement).closest("th");
        const table = cell?.closest(".ant-table");
        // An elastic column has no width in state, so its starting width is
        // whatever the browser gave it; the box is read here, once, rather
        // than watched — a resize is a gesture, not a subscription.
        const startWidth = widths[key] ?? cell?.getBoundingClientRect().width ?? MIN_COLUMN_WIDTH;
        const box = table?.clientWidth ?? TABLE_BOX_AT_1280;
        dragRef.current = { key, startX: event.clientX, startWidth: Math.round(startWidth) };

        const move = (moveEvent: PointerEvent) => {
          const active = dragRef.current;
          if (!active) return;
          const wanted = active.startWidth + (moveEvent.clientX - active.startX);
          setWidths((current) =>
            resizeWithinBox(current, active.key, wanted, { box, ...budget }, mins),
          );
        };
```

5. Import what is now used: `resizeWithinBox`, `discardOversizeWidths` from `@/lib/domain/column-width`, `TABLE_BOX_AT_1280` from `@/lib/design/table-metrics`, and keep `MIN_COLUMN_WIDTH`. Add `budget` to the `useCallback` dependency list beside `widths` and `mins`. Add a `measuredBox` ref (`useRef<number | null>(null)`) set inside `onResizeStart` from `box`, so the mount effect has a box to judge stored widths against on a later render.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: errors only in the two current callers (`BankTransactionsTable.tsx`, `GeneralLedgerClient.tsx`) because `widths.date` is now `number | undefined` where `totalColumnWidth` wants `number`. Tasks 6 and 10 fix those. If any error is inside `useColumnResize.ts` itself, fix it here.

- [ ] **Step 7: Commit**

```bash
git add components/ui/useColumnResize.ts lib/domain/column-width.ts tests/unit/column-width-storage.test.ts
git commit -m "fix(tables): a dragged column takes room from the elastic one, not from the screen"
```

---

### Task 6: /banking, the reported screen

**Files:**
- Create: `app/(app)/banking/bank-transaction-columns.ts`
- Create: `tests/unit/bank-transaction-columns.test.ts`
- Modify: `app/(app)/banking/BankTransactionsTable.tsx`
- Modify: `app/(app)/banking/DescriptionCell.tsx`
- Modify: `app/(app)/banking/MatchCell.tsx`
- Modify: `tests/unit/bank-categories-ui-contract.test.ts` (it asserts the column order)

**Interfaces:**
- Consumes: `COLUMN`, `fitsBox` (Task 1); `flexColumn`, `secondaryLine` (Task 2); `fit` default (Task 3); `useColumnResize` with a budget (Task 5).
- Produces: `BANK_COLUMN_KEYS`, `BankColumnKey`, `BANK_MEASURED_WIDTHS`, `BANK_MIN_WIDTHS`, `BANK_BUDGET`, `BANK_WIDTH_STORAGE_KEY`, `BANK_WIDTH_STORAGE_KEY_V1` from the new `.ts` module. Nothing later depends on them.

- [ ] **Step 1: Write the failing test for the new column set**

Create `tests/unit/bank-transaction-columns.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  BANK_BUDGET,
  BANK_COLUMN_KEYS,
  BANK_MEASURED_WIDTHS,
  BANK_WIDTH_STORAGE_KEY,
  BANK_WIDTH_STORAGE_KEY_V1,
} from "@/app/(app)/banking/bank-transaction-columns";
import { COLUMN, fitsBox } from "@/lib/design/table-metrics";

/**
 * The screenshot on feedback a9c5b84b: Account source repeated "Bank Of
 * America - 121" on all 25 rows, Reference was an em dash on all 25, and Match
 * and Status were off the right-hand edge.
 */
describe("the bank transactions columns", () => {
  it("no longer carries the two columns that repeated", () => {
    expect(BANK_COLUMN_KEYS).not.toContain("account");
    expect(BANK_COLUMN_KEYS).not.toContain("reference");
  });

  it("keeps the five the reader needs, in reading order", () => {
    expect(BANK_COLUMN_KEYS).toEqual(["date", "description", "amount", "category", "match"]);
  });

  it("fits the narrowest box this design supports", () => {
    const measured = Object.values(BANK_MEASURED_WIDTHS).reduce((sum, px) => sum + px, 0);
    expect(fitsBox(measured + BANK_BUDGET.chrome, BANK_BUDGET.elasticFloor)).toBe(true);
  });

  it("counts the two pinned buttons and the checkbox as room no drag reclaims", () => {
    expect(BANK_BUDGET.chrome).toBe(COLUMN.ACTION * 2 + COLUMN.SELECTION);
  });

  it("reads its widths from a new key, and names the one it replaces", () => {
    // August's 1530px of widths are in this reader's browser. Merged over the
    // new defaults they would put the scrollbar straight back.
    expect(BANK_WIDTH_STORAGE_KEY).not.toBe(BANK_WIDTH_STORAGE_KEY_V1);
    expect(BANK_WIDTH_STORAGE_KEY).toContain("v2");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/bank-transaction-columns.test.ts`
Expected: FAIL — cannot resolve `bank-transaction-columns`.

- [ ] **Step 3: Write the column module**

Create `app/(app)/banking/bank-transaction-columns.ts`:

```ts
import { COLUMN } from "@/lib/design/table-metrics";

/**
 * Which columns this table has, how wide the measured ones are, and what it
 * spends on things a drag cannot reclaim.
 *
 * Feedback a9c5b84b (2026-08-22) came with a 1470x801 screenshot of this
 * screen. Eight data columns declared 1530px, the box was 1174px, and the
 * two widest columns held the same value on every row: "Bank Of America - 121"
 * in Account source, an em dash in Reference. Both are gone from the row and
 * are read on the second line of the description instead. Status went into the
 * first line of Match, which already says whether a line is matched, and which
 * the filter bar above already narrows by.
 *
 * A `.ts` module rather than numbers inside the component so the arithmetic
 * can be asserted without rendering Ant Design — the same reason
 * general-ledger-columns.ts exists.
 */
export const BANK_COLUMN_KEYS = ["date", "description", "amount", "category", "match"] as const;

export type BankColumnKey = (typeof BANK_COLUMN_KEYS)[number];

/**
 * The columns whose content has a known length. Everything not named here is
 * elastic: it carries no width and absorbs what these leave.
 */
export const BANK_MEASURED_WIDTHS: Partial<Record<BankColumnKey, number>> = {
  date: COLUMN.DATE,
  amount: COLUMN.MONEY,
  category: COLUMN.PICKER,
};

/**
 * Floors. `description` may be dragged and so needs one; `match` is the last
 * elastic column and never takes a width, but its floor is what stops the
 * other columns taking its room.
 */
export const BANK_MIN_WIDTHS: Partial<Record<BankColumnKey, number>> = {
  description: COLUMN.TEXT_MIN,
  category: COLUMN.PICKER,
};

/**
 * The delete button, the attachments button and the selection checkbox, plus
 * what Match needs at its narrowest.
 */
export const BANK_BUDGET = {
  chrome: COLUMN.ACTION * 2 + COLUMN.SELECTION,
  elasticFloor: COLUMN.RICH_MIN,
};

/** Where this reader's own widths are kept. */
export const BANK_WIDTH_STORAGE_KEY = "onebook.bank-transactions.column-widths.v2";

/**
 * The key this replaces. Removed on first read: it holds widths totalling
 * 1530px, which is the layout the complaint is about.
 */
export const BANK_WIDTH_STORAGE_KEY_V1 = "onebook.bank-transactions.column-widths";
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/unit/bank-transaction-columns.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Move the displaced values onto the second line**

In `app/(app)/banking/DescriptionCell.tsx`, replace the single `origin` line with the account, the reference and the origin, separated by a middot, using the shared builder so every table's second line looks the same:

```tsx
export default function DescriptionCell({ row }: { row: Row }) {
  const origin = row.transaction.category
    ? row.transaction.category.replaceAll("_", " ")
    : row.transaction.source === "bank_feed"
      ? "Direct bank feed"
      : "File upload";

  // Account source and Reference used to be columns of their own. Account
  // source held the same bank on every row — the one already chosen in the
  // filter bar — and Reference was an em dash on every row. They are facts
  // about this line, so they read here, under it (feedback a9c5b84b).
  const reference = row.transaction.reference?.trim();
  const under = [row.accountName, reference ? `Ref ${reference}` : null, origin]
    .filter(Boolean)
    .join(" · ");

  return (
    <Tooltip
      title={row.transaction.description}
      placement="topLeft"
      styles={{ root: { maxWidth: 640 } }}
    >
      <div style={{ minWidth: 0 }}>
        <span style={ONE_LINE}>{row.transaction.description}</span>
        {secondaryLine(under)}
      </div>
    </Tooltip>
  );
}
```

Import `secondaryLine` from `@/components/ui/columns` and drop the now-unused `Typography` import if nothing else in the file uses it.

- [ ] **Step 6: Put the status tag in the Match cell**

In `app/(app)/banking/MatchCell.tsx`, accept the tag as a prop and render it first on both paths:

```tsx
export interface MatchCellProps {
  row: Row;
  canWrite: boolean;
  busy: string | null;
  /**
   * The line's own status, which used to be a column of its own. The filter
   * bar above already narrows by status, so a column repeated the filter —
   * while Match itself was off the side of the screen (feedback a9c5b84b).
   */
  statusTag: ReactNode;
  onSettle: (row: Row) => void;
  onApprove: (suggestionId: string) => void;
  onReject: (suggestionId: string) => void;
}
```

and in both returns put `{statusTag}` as the first child of the `Space direction="vertical"`.

- [ ] **Step 7: Rewrite the table's columns**

In `app/(app)/banking/BankTransactionsTable.tsx`:

1. Delete the local `DATA_COLUMN_KEYS`, `DEFAULT_COLUMN_WIDTHS`, `MIN_COLUMN_WIDTHS`, `COLUMN_WIDTH_STORAGE_KEY` and `PINNED_COLUMN_WIDTH` constants; import them from `./bank-transaction-columns` instead, plus `COLUMN` from `@/lib/design/table-metrics` and `flexColumn` from `@/components/ui/columns`.
2. Call the hook with the budget and the old key:

```tsx
  const { widths, resizeHandleProps, guardHeaderDrag } = useColumnResize<BankColumnKey>(
    BANK_MEASURED_WIDTHS,
    BANK_WIDTH_STORAGE_KEY,
    BANK_MIN_WIDTHS,
    BANK_BUDGET,
    BANK_WIDTH_STORAGE_KEY_V1,
  );
```

3. Replace `dataColumns` with five entries — Date, Description, Amount, Category, Match — deleting the Account source, Reference and Status entries:

```tsx
  const dataColumns: TableColumnsType<BankReviewTableRow> = [
    {
      title: "Date",
      key: "date",
      dataIndex: ["transaction", "txn_date"],
      width: widths.date ?? COLUMN.DATE,
    },
    {
      // The elastic column: no width, so it takes whatever the measured
      // columns leave. Its second line carries the account and the reference.
      ...flexColumn<BankReviewTableRow>({
        title: "Description",
        key: "description",
        render: (_value: unknown, row: BankReviewTableRow) => <DescriptionCell row={row} />,
      }),
      ...(widths.description === undefined ? null : { width: widths.description }),
    },
    {
      title: "Amount",
      key: "amount",
      width: widths.amount ?? COLUMN.MONEY,
      align: "right",
      render: (_value: unknown, row: BankReviewTableRow) => (
        <span
          style={{
            color:
              row.transaction.amount_minor < 0 ? TOKENS.money.negative : TOKENS.money.positive,
          }}
        >
          {formatRowMoney(row)}
        </span>
      ),
    },
    {
      title: "Category",
      key: "category",
      width: widths.category ?? COLUMN.PICKER,
      render: (_value: unknown, row: BankReviewTableRow) => (
        <CategoriseCell
          transactionId={row.transaction.id}
          status={row.transaction.status}
          accounts={postableAccounts}
          posting={postings.get(row.transaction.id) ?? null}
          canWrite={canWrite}
          onChanged={onCategorised}
        />
      ),
    },
    {
      // The last elastic column: it never takes a width, which is what keeps
      // the row total pinned to the box whatever the reader drags.
      ...flexColumn<BankReviewTableRow>({
        title: "Match",
        key: "match",
        floor: COLUMN.RICH_MIN,
        render: (_value: unknown, row: BankReviewTableRow) => (
          <MatchCell
            row={row}
            canWrite={canWrite}
            busy={busy}
            statusTag={
              <Space size={4}>
                <Tag color={TXN_STATUS[row.transaction.status].color}>
                  {TXN_STATUS[row.transaction.status].text}
                </Tag>
                {row.transaction.pending ? <Tag>Pending</Tag> : null}
              </Space>
            }
            onSettle={onSettle}
            onApprove={onApprove}
            onReject={onReject}
          />
        ),
      }),
    },
  ];
```

4. Narrow the two pinned columns from `width: 56` to `width: COLUMN.ACTION`.
5. Delete the `scroll` and `className` props on `DataTable` — `tableLayout` and the absence of `scroll.x` now come from `DataTable` itself. Keep `components={{ header: { cell: ColumnHeaderCell } }}`, `sticky` and everything else.
6. Give Match no resize handle: in the `columns` assembly, skip `resizeHandleProps(key)` when `key === "match"` so the last elastic column keeps no width of its own.

- [ ] **Step 8: Update the column-order contract test**

`tests/unit/bank-categories-ui-contract.test.ts` asserts Category sits between Amount and Match by searching for `title: "Amount"`. Those titles now live inside `flexColumn({ title: ... })` for two of the three. Change that test to read the order from the module instead:

```ts
  it("shows the column between the amount and the match", () => {
    const table = read("BankTransactionsTable.tsx");
    expect(table).toContain("<CategoriseCell");
    const order = BANK_COLUMN_KEYS as readonly string[];
    expect(order.indexOf("category")).toBeGreaterThan(order.indexOf("amount"));
    expect(order.indexOf("category")).toBeLessThan(order.indexOf("match"));
  });
```

Import `BANK_COLUMN_KEYS` at the top of that file.

- [ ] **Step 9: Run every banking suite**

Run: `npx vitest run tests/unit/bank-transaction-columns.test.ts tests/unit/bank-categories-ui-contract.test.ts tests/unit/column-order.test.ts tests/unit/column-header-cell.test.ts tests/unit/banking-surface`
Expected: PASS. Then `npm run typecheck` — expected clean for this file; `GeneralLedgerClient.tsx` may still fail, and Task 10 fixes it.

- [ ] **Step 10: Commit**

```bash
git add "app/(app)/banking" tests/unit/bank-transaction-columns.test.ts tests/unit/bank-categories-ui-contract.test.ts
git commit -m "fix(banking): a bank line reads across one screen, not two"
```

---

### Task 7: The runtime gate

**Files:**
- Create: `scripts/verify-table-fit.mjs`
- Modify: `package.json` (scripts block)

**Interfaces:**
- Consumes: `smokeSession` from `scripts/smoke-environment.mjs`, `playwrightSessionCookies` from `scripts/quality/session-cookie.mjs`, `discoverStaticRoutes` from `scripts/quality/routes.mjs`.
- Produces: `npm run verify:table-fit [baseUrl] [--only=/a,/b]`, exit code 1 on any table wider than its box. Task 11 runs it across every route.

- [ ] **Step 1: Write the script**

Create `scripts/verify-table-fit.mjs`:

```js
/**
 * The gate on the complaint that arrived four times: a list that scrolls
 * sideways.
 *
 * Unit tests hold the arithmetic and the contract test holds the boundary, but
 * neither can see a rendered table. This walks every authenticated route at
 * the two viewports the design commits to and measures the table itself.
 *
 * Reads only: one sign-in, then a GET per route. Nothing is written, so it
 * needs no destructive-test flag.
 *
 * Run it against a built server (`npm run build && npm start`), not `npm run
 * dev`: a dev server compiles each route on its first request.
 *
 *   node --env-file=.env.local scripts/verify-table-fit.mjs [baseUrl] [--only=/banking]
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { smokeSession } from "./smoke-environment.mjs";
import { playwrightSessionCookies } from "./quality/session-cookie.mjs";
import { discoverStaticRoutes } from "./quality/routes.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const base = args.find((a) => a.startsWith("http")) ?? "http://localhost:3000";
const only = (args.find((a) => a.startsWith("--only="))?.split("=")[1] ?? "")
  .split(",")
  .map((r) => r.trim())
  .filter(Boolean)
  .map((r) => (r.startsWith("/") ? r : `/${r}`));

/**
 * The two viewports this design commits to. 1470 is the reporter's own screen,
 * from the feedback record; 1280 is the floor the spec sets.
 */
const VIEWPORTS = [
  { width: 1470, height: 801 },
  { width: 1280, height: 800 },
];

const routes = only.length ? only : discoverStaticRoutes(join(here, "..", "app", "(app)"));

const { session, user, supabaseUrl } = await smokeSession();
const browser = await chromium.launch();
let failed = 0;
let checked = 0;

for (const viewport of VIEWPORTS) {
  const context = await browser.newContext({ viewport });
  await context.addCookies(
    playwrightSessionCookies({ session, user, supabaseUrl, domain: new URL(base).hostname }),
  );
  const page = await context.newPage();
  console.log(`\n== ${viewport.width}x${viewport.height} ==`);

  for (const route of routes) {
    try {
      await page.goto(base + route, { waitUntil: "networkidle", timeout: 45_000 });
    } catch (err) {
      console.log(`  SKIP  ${route} — ${err.message.split("\n")[0]}`);
      continue;
    }
    // Every list renders inside this wrapper (components/ui/DataTable.tsx).
    const tables = await page.$$eval(".accounting-data-table", (nodes) =>
      nodes.map((node) => {
        // The element that would carry the scrollbar, which is not the wrapper.
        const scroller =
          node.querySelector(".ant-table-body") ??
          node.querySelector(".ant-table-content") ??
          node;
        const heading = node.closest("section, div")?.querySelector("h1, h2, h3")?.textContent;
        return {
          overflow: scroller.scrollWidth - scroller.clientWidth,
          fit: node.classList.contains("accounting-table--fit"),
          heading: (heading ?? "").trim().slice(0, 40),
        };
      }),
    );
    for (const [index, table] of tables.entries()) {
      checked++;
      // A matrix table opted out on purpose; it is allowed to scroll.
      if (!table.fit) {
        console.log(`  ---   ${route} [${index}] matrix, opted out`);
        continue;
      }
      // 1px of slack: a scaled display rounds a sub-pixel column boundary up.
      if (table.overflow > 1) {
        failed++;
        console.log(
          `  FAIL  ${route} [${index}] ${table.heading} overflows by ${table.overflow}px`,
        );
      } else {
        console.log(`  PASS  ${route} [${index}] ${table.heading}`);
      }
    }
  }
  await context.close();
}

await browser.close();
console.log(`\n${checked - failed} of ${checked} tables fit their box`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 2: Register the script**

In `package.json`, add beside the other verify entries:

```json
    "verify:table-fit": "node --env-file=.env.local scripts/verify-table-fit.mjs",
```

- [ ] **Step 3: Build and start the server**

Run: `npm run build`
Expected: build succeeds. Then, in a **separate** shell started detached (a foreground `npm start` from a tool call dies and produces a page of misleading "fetch failed" errors):

```powershell
Start-Process -FilePath "npm" -ArgumentList "start" -WorkingDirectory "C:\Users\pit010\QUICKBOOK_WEBAPP\ctyhp-accounting" -WindowStyle Hidden
```

- [ ] **Step 4: Run the gate against the reported screen only**

Run: `npm run verify:table-fit -- --only=banking`
Expected: `PASS /banking [0]` at both viewports, and `1 of 1`/`2 of 2` tables fit. If `/banking` fails, read the overflow number: it is exactly how much the column set is over, and Task 6's arithmetic test says it should be zero.

- [ ] **Step 5: Run it across every route to capture the work list**

Run: `npm run verify:table-fit > ../table-fit-before.txt; tail -40 ../table-fit-before.txt`
Expected: exit 1, with FAIL lines for the tables Tasks 8 to 10 still have to rework. Do not trim this output when reporting it — the pass/fail summary is its last line.

- [ ] **Step 6: Commit**

```bash
git add scripts/verify-table-fit.mjs package.json
git commit -m "test(tables): measure every list against its own box, at both viewports"
```

---

### Task 8: Five business listings

**Files:**
- Modify: `app/(app)/invoices/InvoicesClient.tsx`
- Modify: `app/(app)/bills/BillsClient.tsx`
- Modify: `app/(app)/expenses/ExpensesClient.tsx`
- Modify: `app/(app)/accounts/AccountsClient.tsx`
- Modify: `app/(app)/customers/CustomersClient.tsx`

**Interfaces:**
- Consumes: `COLUMN`, `fitsBox` (Task 1); `flexColumn`, `secondaryLine` (Task 2); `fit` default (Task 3).
- Produces: nothing other tasks read.

Column decisions, all five screens. "2nd line" means the value moves under the elastic column's primary text via `secondaryLine`.

| Screen | Elastic (no width) | Measured, from tokens | To the 2nd line | Removed outright |
|---|---|---|---|---|
| `/invoices` | Customer | Number `CODE`, Issue date `DATE`, Total `MONEY`, Balance due `MONEY`, Status `STATUS`, actions `ACTION`x3 | Created (date only), Journal entry, Paid, Age | — |
| `/bills` | Vendor | Bill Number `CODE`, Date `DATE`, Due `DATE`, Total `MONEY`, Balance `MONEY`, Status `STATUS`, actions `ACTION`x3 | Vendor Reference, Journal entry | — |
| `/expenses` | Vendor | Expense Number `CODE`, Date `DATE`, Total `MONEY`, Status `STATUS`, actions `ACTION`x2 | — | — |
| `/accounts` | Account name | Code `CODE`, Type `CODE`, Status `STATUS`, actions `ACTION`x2 | Detail, Cash flow, Normal (Dr/Cr), Statement | — |
| `/customers` | Customer | Credit limit `MONEY`, Owed now `MONEY`, Available `MONEY`, Credit status `STATUS`, Status `STATUS`, actions `ACTION`x2 | Location | — |

- [ ] **Step 1: Write the failing arithmetic test**

Create `tests/unit/listing-column-budgets.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { COLUMN, fitsBox } from "@/lib/design/table-metrics";

/**
 * Each row here is one screen's declared widths, added up the way the browser
 * adds them. A column added later without a second line to put something on
 * fails here rather than on a reader's screen.
 */
const SCREENS: Record<string, { measured: number; elasticFloor: number }> = {
  "/invoices": {
    measured: COLUMN.CODE + COLUMN.DATE + COLUMN.MONEY * 2 + COLUMN.STATUS + COLUMN.ACTION * 3,
    elasticFloor: COLUMN.TEXT_MIN,
  },
  "/bills": {
    measured:
      COLUMN.CODE + COLUMN.DATE * 2 + COLUMN.MONEY * 2 + COLUMN.STATUS + COLUMN.ACTION * 3,
    elasticFloor: COLUMN.TEXT_MIN,
  },
  "/expenses": {
    measured: COLUMN.CODE + COLUMN.DATE + COLUMN.MONEY + COLUMN.STATUS + COLUMN.ACTION * 2,
    elasticFloor: COLUMN.TEXT_MIN,
  },
  "/accounts": {
    measured: COLUMN.CODE * 2 + COLUMN.STATUS + COLUMN.ACTION * 2,
    elasticFloor: COLUMN.TEXT_MIN,
  },
  "/customers": {
    measured: COLUMN.MONEY * 3 + COLUMN.STATUS * 2 + COLUMN.ACTION * 2,
    elasticFloor: COLUMN.TEXT_MIN,
  },
};

describe("every listing fits the narrowest box", () => {
  for (const [route, budget] of Object.entries(SCREENS)) {
    it(route, () => {
      expect(fitsBox(budget.measured, budget.elasticFloor), route).toBe(true);
    });
  }
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run tests/unit/listing-column-budgets.test.ts`
Expected: PASS immediately — this is arithmetic on tokens, and it exists to fail later if a screen grows. If any row fails now, that screen needs one more column on its second line before you touch it.

- [ ] **Step 3: Rework `/invoices`**

In `app/(app)/invoices/InvoicesClient.tsx`, the columns array around line 440. Replace the Customer column with the elastic builder and move four values under it:

```tsx
    {
      ...flexColumn<InvoiceWithCustomer>({
        title: "Customer",
        key: "customer",
        render: (_: unknown, r: InvoiceWithCustomer) => (
          <div style={{ minWidth: 0 }}>
            <span>{r.customer_name}</span>
            {secondaryLine(
              [
                r.entry_number ? `Entry ${r.entry_number}` : null,
                r.paid_minor ? `Paid ${fmt(r.paid_minor, r.currency_code)}` : null,
                ageLabel(r),
                r.created_at?.slice(0, 10),
              ]
                .filter(Boolean)
                .join(" · "),
            )}
          </div>
        ),
      }),
    },
```

Extract the existing Age render body into a local `ageLabel(r): string` helper above the columns so both the second line and the removed column read the same rule; delete the `Paid`, `Age`, `Journal entry` and `Created` column objects. Give Number `width: COLUMN.CODE`, Issue date `COLUMN.DATE`, Total and Balance due `COLUMN.MONEY`, Status `COLUMN.STATUS`. Replace the 230px Actions column with `actionsColumn({ width: COLUMN.ACTION * 3, actions: ... })` using `IconActionButton` for each of the three actions the column already offers, keeping each action's existing label as the button's `label`.

- [ ] **Step 4: Run the invoice suites**

Run: `npx vitest run tests/unit/invoice`
Expected: PASS. Some suites assert on column titles; where one asserts a title you removed, change the assertion to look for the value on the second line rather than deleting the test.

- [ ] **Step 5: Commit /invoices**

```bash
git add "app/(app)/invoices/InvoicesClient.tsx" tests/unit/listing-column-budgets.test.ts
git commit -m "fix(invoices): the list reads across one screen"
```

- [ ] **Step 6: Rework `/bills`, `/expenses`, `/accounts`, `/customers` the same way**

For each screen: give every measured column its token width, wrap the name column in `flexColumn`, and move the values named in the table above under it with `secondaryLine`. `/bills` and `/expenses` currently declare no widths at all — every column there needs one from the token set except the elastic one. `/accounts` moves four values onto one second line; join them with a middot in the order Detail, Cash flow, Normal, Statement so the line reads as a sentence about the account.

- [ ] **Step 7: Verify the four screens in the browser**

With the built server running, run: `npm run verify:table-fit -- --only=bills,expenses,accounts,customers`
Expected: PASS for every table at both viewports.

- [ ] **Step 8: Commit**

```bash
git add "app/(app)/bills" "app/(app)/expenses" "app/(app)/accounts" "app/(app)/customers"
git commit -m "fix(lists): bills, expenses, accounts and customers fit their box"
```

---

### Task 9: Four more listings

**Files:**
- Modify: `app/(app)/items/ItemsClient.tsx`
- Modify: `app/(app)/recurring/RecurringClient.tsx`
- Modify: `app/(app)/fixed-assets/FixedAssetsClient.tsx`
- Modify: `app/(app)/pay-bills/PayBillsClient.tsx`
- Modify: `tests/unit/listing-column-budgets.test.ts`

**Interfaces:**
- Consumes: the same as Task 8.
- Produces: nothing other tasks read.

| Screen | Elastic | Measured | To the 2nd line | Notes |
|---|---|---|---|---|
| `/items` | Name | Code `CODE`, Sales price `MONEY`, Ledger cost `MONEY`, On hand `QTY`, Inventory value `MONEY`, Status `STATUS`, actions `ACTION`x3 | Purchase cost, Used for | headings shorten: "Purchase cost (card)" and "Ledger cost (average)" lose their parentheticals, which move to the column's `title` tooltip |
| `/recurring` | Schedule | Frequency `CODE`, Next occurrence `DATE`, Amount `MONEY`, Status `STATUS`, actions `ACTION`x3 | Last result | the runs table below it: Scheduled date `DATE`, Type `CODE`, Result `STATUS`, Completed `DATE`, Action `ACTION`, Schedule elastic |
| `/fixed-assets` | Asset | In service `DATE`, Cost `MONEY`, Accum. depreciation `MONEY`, Net book value `MONEY`, Status `STATUS`, actions `ACTION`x3 | Depreciation progress | the schedule table: Period `QTY`, From `DATE`, Through `DATE`, Planned `MONEY`, Recognized `MONEY`, Status `STATUS`, Journal to the 2nd line |
| `/pay-bills` | Vendor | Payment Number `CODE`, Date `DATE`, Amount `MONEY`, Unapplied `MONEY`, Status `STATUS`, actions `ACTION`x2 | — | the bill-selection table inside the drawer: Bill Number `CODE`, Date `DATE`, Balance `MONEY`, Discount `MONEY`, Payment `MONEY` |

- [ ] **Step 1: Add the four screens to the budget test**

Append to the `SCREENS` record in `tests/unit/listing-column-budgets.test.ts`:

```ts
  "/items": {
    measured:
      COLUMN.CODE + COLUMN.MONEY * 3 + COLUMN.QTY + COLUMN.STATUS + COLUMN.ACTION * 3,
    elasticFloor: COLUMN.TEXT_MIN,
  },
  "/recurring": {
    measured: COLUMN.CODE + COLUMN.DATE + COLUMN.MONEY + COLUMN.STATUS + COLUMN.ACTION * 3,
    elasticFloor: COLUMN.TEXT_MIN,
  },
  "/fixed-assets": {
    measured: COLUMN.DATE + COLUMN.MONEY * 3 + COLUMN.STATUS + COLUMN.ACTION * 3,
    elasticFloor: COLUMN.TEXT_MIN,
  },
  "/pay-bills": {
    measured: COLUMN.CODE + COLUMN.DATE + COLUMN.MONEY * 2 + COLUMN.STATUS + COLUMN.ACTION * 2,
    elasticFloor: COLUMN.TEXT_MIN,
  },
```

- [ ] **Step 2: Run it**

Run: `npx vitest run tests/unit/listing-column-budgets.test.ts`
Expected: PASS, 9 screens.

- [ ] **Step 3: Rework the four screens**

Each one: token widths on the measured columns, `flexColumn` on the name column, displaced values under it with `secondaryLine`. Delete the `scroll={{ x: 1450 }}`, `scroll={{ x: 780 }}`, `scroll={{ x: 1120 }}`, `scroll={{ x: 860 }}` and `x: "max-content"` props these files pass — the contract test in Task 3 fails while any remain.

- [ ] **Step 4: Run the suites for these screens**

Run: `npx vitest run tests/unit/items tests/unit/recurring tests/unit/fixed-assets tests/unit/payables`
Expected: PASS. Where a suite asserts a removed column title, move the assertion to the second line rather than deleting it.

- [ ] **Step 5: Verify in the browser**

Run: `npm run verify:table-fit -- --only=items,recurring,fixed-assets,pay-bills`
Expected: PASS at both viewports, including the secondary tables on `/recurring` and `/fixed-assets`.

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/items" "app/(app)/recurring" "app/(app)/fixed-assets" "app/(app)/pay-bills" tests/unit/listing-column-budgets.test.ts
git commit -m "fix(lists): items, recurring, fixed assets and bill payments fit their box"
```

---

### Task 10: Six report tables

**Files:**
- Modify: `app/(app)/reports/general-ledger/general-ledger-columns.ts`
- Modify: `app/(app)/reports/general-ledger/GeneralLedgerClient.tsx`
- Modify: `app/(app)/reports/transactions/TransactionListClient.tsx`
- Modify: `app/(app)/reports/gl-posting/GlPostingClient.tsx`
- Modify: `app/(app)/reports/number-sequence/NumberSequenceClient.tsx`
- Modify: `app/(app)/reports/cash-flow-forecast/CashFlowForecastClient.tsx`
- Modify: `app/(app)/settings/feedback/FeedbackTriageClient.tsx`
- Modify: `tests/unit/listing-column-budgets.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 2, 3 and — for the general ledger — Task 5's `useColumnResize` signature.
- Produces: nothing other tasks read.

| Screen | Elastic | Measured | To the 2nd line |
|---|---|---|---|
| `/reports/general-ledger` | Memo (last elastic, no width) | Date `DATE`, Entry `CODE`, Debit `MONEY`, Credit `MONEY`, Running `MONEY_WIDE` | Source, under the memo |
| `/reports/transactions` | Vendor/Customer Name, and Description as the last elastic | Date `DATE`, Amount `MONEY`, Reconciled `STATUS` | Account Type and Bank or Credit Card, under the description |
| `/reports/gl-posting` | Name; Control account in the second table | Type `CODE`, Document `CODE`, Date `DATE`, Status `STATUS`, Amount `MONEY`, Posting `STATUS`; Ledger account `CODE`, Subledger `MONEY`, Ledger balance `MONEY`, Variance `MONEY` | Journal entry, under the name |
| `/reports/number-sequence` | Document type; Documented reason in the gaps table | Prefix `QTY`, Issued `QTY`, On file `QTY`, Explained gaps `QTY`, Unaccounted for `CODE`, Next number `CODE`; Number `CODE`, State `STATUS`, Date `DATE`, Status `STATUS`, Action `ACTION` | — |
| `/reports/cash-flow-forecast` | Customer / vendor in the detail table | seven weekly columns at `MONEY` (`Cumulative` at `MONEY_WIDE`); Side `QTY`, Number `CODE`, Due `DATE`, Status `STATUS`, Balance `MONEY` | — |
| `/settings/feedback` | What happened | Filed `DATE`, Kind `STATUS`, Urgency `STATUS`, Screenshot `QTY`, Attachments `CODE`, Move to `PICKER` | Where and Reporter, under what happened |

- [ ] **Step 1: Add the six to the budget test and run it**

Append to `SCREENS`:

```ts
  "/reports/general-ledger": {
    measured: COLUMN.DATE + COLUMN.CODE + COLUMN.MONEY * 2 + COLUMN.MONEY_WIDE,
    elasticFloor: COLUMN.TEXT_MIN,
  },
  "/reports/transactions": {
    measured: COLUMN.DATE + COLUMN.MONEY + COLUMN.STATUS,
    elasticFloor: COLUMN.TEXT_MIN * 2,
  },
  "/reports/gl-posting": {
    measured: COLUMN.CODE * 2 + COLUMN.DATE + COLUMN.STATUS * 2 + COLUMN.MONEY,
    elasticFloor: COLUMN.TEXT_MIN,
  },
  "/reports/number-sequence": {
    measured: COLUMN.QTY * 4 + COLUMN.CODE * 2,
    elasticFloor: COLUMN.TEXT_MIN,
  },
  "/reports/cash-flow-forecast": {
    measured: COLUMN.DATE + COLUMN.MONEY * 5 + COLUMN.MONEY_WIDE,
    elasticFloor: 0,
  },
  "/settings/feedback": {
    measured: COLUMN.DATE + COLUMN.STATUS * 2 + COLUMN.QTY + COLUMN.CODE + COLUMN.PICKER,
    elasticFloor: COLUMN.TEXT_MIN,
  },
```

Run: `npx vitest run tests/unit/listing-column-budgets.test.ts`
Expected: PASS, 15 screens. `/reports/cash-flow-forecast` has an elastic floor of 0 because its weekly table is all money; the detail table below it is counted separately by the runtime gate.

- [ ] **Step 2: Rework the general ledger's column module**

In `app/(app)/reports/general-ledger/general-ledger-columns.ts`:

```ts
import { COLUMN } from "@/lib/design/table-metrics";

export const GENERAL_LEDGER_COLUMN_KEYS = ["date", "entry", "memo", "debit", "credit", "running"] as const;

export type GeneralLedgerColumnKey = (typeof GENERAL_LEDGER_COLUMN_KEYS)[number];

/**
 * `source` is no longer a column. It said where a line came from in 120px on
 * every row; it now reads under the memo, which is the column the reviewer was
 * dragging in the first place (REQ-01, and feedback a9c5b84b after it).
 *
 * `memo` is absent from this record on purpose: it is the last elastic column
 * and takes no width, so the row total is always the width of the box.
 */
export const GENERAL_LEDGER_MEASURED_WIDTHS: Partial<Record<GeneralLedgerColumnKey, number>> = {
  date: COLUMN.DATE,
  entry: COLUMN.CODE,
  debit: COLUMN.MONEY,
  credit: COLUMN.MONEY,
  running: COLUMN.MONEY_WIDE,
};

export const GENERAL_LEDGER_BUDGET = { chrome: 0, elasticFloor: COLUMN.TEXT_MIN };

export const GENERAL_LEDGER_WIDTH_STORAGE_KEY = "onebook.general-ledger.column-widths.v2";

/** Replaced: it holds a 1,010px layout from before the box was binding. */
export const GENERAL_LEDGER_WIDTH_STORAGE_KEY_V1 = "onebook.general-ledger.column-widths";
```

- [ ] **Step 3: Rework the general ledger client**

In `GeneralLedgerClient.tsx`: pass the new constants to `useColumnResize` (including the budget and the v1 key), delete the `totalColumnWidth` import and the `scroll={{ x: ... }}` prop, wrap Memo in `flexColumn` with the source under it via `secondaryLine`, and give the five measured columns `widths.<key> ?? COLUMN.<TOKEN>`.

- [ ] **Step 4: Run the report suites**

Run: `npx vitest run tests/unit/general-ledger tests/unit/column-width.test.ts tests/unit/reports`
Expected: PASS. Then `npm run typecheck` — expected clean now that both `useColumnResize` callers are updated.

- [ ] **Step 5: Rework the other five report screens**

Same recipe as Task 8 Step 6, using the table above. `FeedbackTriageClient.tsx` is the widest of them at 1660px of declared widths; its Where and Reporter columns become one second line reading `route · reporter email`.

- [ ] **Step 6: Verify in the browser**

Run: `npm run verify:table-fit -- --only=reports/general-ledger,reports/transactions,reports/gl-posting,reports/number-sequence,reports/cash-flow-forecast,settings/feedback`
Expected: PASS at both viewports for every table on those routes.

- [ ] **Step 7: Commit**

```bash
git add "app/(app)/reports" "app/(app)/settings/feedback" tests/unit/listing-column-budgets.test.ts
git commit -m "fix(reports): every report table fits the screen it is read on"
```

---

### Task 11: The matrix list, the full sweep, and the release note

**Files:**
- Modify: `app/(app)/settings/permissions/PermissionMatrixClient.tsx`
- Modify: `components/reports/BudgetVsActualView.tsx`
- Modify: `components/reports/PnlTrendView.tsx`
- Modify: `components/reports/BalanceSheetTrendView.tsx`
- Modify: `app/(app)/reports/saved/SavedReportViewer.tsx`
- Modify: `tests/unit/table-fit-contract.test.ts` (only if a candidate turns out to fit)
- Modify: `lib/domain/changelog.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: a green contract test and a green runtime gate.

- [ ] **Step 1: Check each matrix candidate before exempting it**

For each of the five files, count what it actually declares. A table that fits must be reworked like any other rather than exempted.

Run: `npm run verify:table-fit -- --only=settings/permissions,reports/saved`
Expected: FAIL or `matrix, opted out` lines. Whichever of the five genuinely cannot fit gets `fit={false}` with a one-line comment naming why; any that fits is reworked and **removed from the `MATRIX` map** in the contract test.

- [ ] **Step 2: Add `fit={false}` where it belongs**

For each confirmed matrix, on its `DataTable`/`ReportTable`:

```tsx
        // A matrix: the columns are data, not design — one per period, chosen
        // by the reader. Held to the box it would be unreadable, so this is
        // the one shape of table allowed to scroll sideways.
        fit={false}
```

- [ ] **Step 3: Run the contract test**

Run: `npx vitest run tests/unit/table-fit-contract.test.ts`
Expected: PASS, all three tests. A FAIL here names a file still passing `scroll.x` — finish that file before continuing.

- [ ] **Step 4: Run the whole unit suite and the static gates**

Run: `npm test`
Expected: PASS. Then `npm run typecheck` and `npm run lint` — both clean.

- [ ] **Step 5: Rebuild and run the full runtime gate**

Run: `npm run build`, restart the detached server, then `npm run verify:table-fit`
Expected: exit 0, and a final line reading `N of N tables fit their box`. Report that line verbatim — no trimming.

- [ ] **Step 6: Add the release note**

At the top of `RELEASES` in `lib/domain/changelog.ts` (current head is 1.60):

```ts
  {
    version: "1.61",
    date: "2026-08-24",
    headline: "Lists fit the screen they are read on.",
    changes: [
      {
        kind: "fixed",
        title: "No list scrolls sideways any more",
        detail:
          "Tables were allowed to grow wider than the screen, so the columns "
          + "at the right-hand end — an amount, a match, a status — could only "
          + "be reached by scrolling sideways. Every list is now held to the "
          + "width of the page: the columns that hold a date or an amount take "
          + "exactly what they need, and the column holding the description "
          + "takes the rest.",
      },
      {
        kind: "changed",
        title: "Columns no longer repeat what the filter already says",
        detail:
          "On Bank Transactions the account source repeated the same bank on "
          + "every row and the reference column was empty on most of them, "
          + "between them taking a third of the screen. Both now read on a "
          + "second line under the description, which leaves the room to the "
          + "columns a reader is comparing.",
        route: "/banking",
      },
      {
        kind: "changed",
        title: "Dragging a column no longer creates a sideways scroll",
        detail:
          "Widening a column still works and is still remembered. The room now "
          + "comes from the flexible column beside it rather than from the "
          + "width of the page, so a list stays readable end to end however "
          + "the columns are arranged.",
      },
    ],
  },
```

- [ ] **Step 7: Run the changelog test**

Run: `npx vitest run tests/unit/changelog.test.ts`
Expected: PASS. It checks version ordering and the shape of each entry.

- [ ] **Step 8: Commit**

```bash
git add "app/(app)/settings/permissions" components/reports "app/(app)/reports/saved" tests/unit/table-fit-contract.test.ts lib/domain/changelog.ts
git commit -m "feat(tables): close the boundary, and say so in the changelog"
```

- [ ] **Step 9: Answer the reporter**

The feedback record is `a9c5b84b` in schema `co_pc_49`, still `new`. Move it to `resolved` only after Step 5 exits 0, and only from the app's own triage screen (`/settings/feedback`) so the change is attributed and audited. Do not update the row directly with the service role.

---

## Self-Review

**Spec coverage.** Section 4's rule is Tasks 1 to 3; section 5's tokens are Task 1; 6.1 is Task 3; 6.2 is Tasks 4 and 5 including the stored-widths trap; 6.3 is Task 3 steps 5 and 6; 7.1 is Task 6; 7.2 is Tasks 8 and 9; 7.3 is Task 10; 8.1 is Tasks 1, 4, 5, 8, 9, 10; 8.2 is Task 3 step 2 and Task 11 step 3; 8.3 is Task 7; section 10's Ant Design risk is Task 3 step 1; section 11's acceptance list is Task 11 steps 3 to 5 plus Task 6 step 9.

**Naming consistency.** `COLUMN`, `TABLE_BOX_AT_1280`, `fitsBox` (Task 1) are used under those names in Tasks 2, 4, 5, 6, 8, 9, 10. `flexColumn`, `secondaryLine` (Task 2) likewise. `resizeWithinBox`, `BoxBudget`, `discardOversizeWidths` (Tasks 4 and 5) are called only from `useColumnResize`. `BANK_*` (Task 6) is read only by the banking table and its two tests. `GENERAL_LEDGER_MEASURED_WIDTHS` replaces `GENERAL_LEDGER_DEFAULT_WIDTHS` in Task 10, and the only consumer is updated in the same task.

**One deliberate red state.** The contract test committed in Task 3 fails until Task 11. That is the work list for Tasks 6 to 11 and is stated in Task 3's commit message; every other task ends green.
