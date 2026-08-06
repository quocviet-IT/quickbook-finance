# Wave General Ledger Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A General ledger tab on `/settings/import` that reads Wave's *Account Transactions* report — the file behind feedback `428ca4db` — and posts it either as one journal entry per date or as a single closing-balances entry, in one atomic action that can be undone.

**Architecture:** A pure parser turns the section-grouped grid into date-grouped balanced entries and per-account nets in one pass. One `security definer` RPC takes the whole file as jsonb and posts every entry through `acc_post_entry` inside a single transaction. An import batch records the file's `sha256` and every entry it created, which is what makes a second import refusable and the first one undoable.

**Tech Stack:** Next.js 16 App Router and Server Actions, React 19, TypeScript, Ant Design 5, Supabase/PostgreSQL PL/pgSQL, Vitest, Node `pg` rollback verification.

**Spec:** `docs/superpowers/specs/2026-08-06-wave-ledger-import-design.md`

## Global Constraints

- Product name in user-visible copy is **One Book**. All UI copy is US English; currency is USD; "Sales Tax", never "VAT".
- Money is minor units end-to-end; convert only at the UI edge.
- **A positive `signed_minor` debits, a negative one credits** — the same convention slice 2 uses.
- Posting happens **only** through `acc_post_entry(p_entry_date, p_description, p_source_type, p_source_id, p_currency, p_lines)`. History mode uses source type `'manual'`, balances mode `'opening_balance'`. Both values already exist in `acc_journal_source`; **do not add an enum value**.
- **All or nothing.** One RPC call, one transaction. A closed period, an unknown account or an unbalanced entry rolls the whole file back.
- **Never create an account from a ledger row.** A missing account refuses the whole file, listing what is missing.
- **Never trust client-sent totals** — the RPC resolves accounts and computes balance itself.
- A file already imported (live batch with the same `sha256`) is refused **whatever mode is chosen**.
- Undo voids; it never deletes. `acc_void_import_batch` flips entries to `status = 'void'`, and the existing trigger from migration 0029 refuses to void an entry dated in a closed period.
- Never set `created_by` / `created_at` / `updated_by` / `updated_at` from application code — `acc_stamp_actor()` owns them.
- No SQL in components. Writes go through `lib/services/ledger-import.ts` into the RPCs.
- Every migration must reach every company schema; `scripts/migrate.mjs` loops the register.
- **Do not commit the real file** `Pacific Four Nine (2.0) Account Transactions 2026-08-04-18_20 (1).csv` — it is a customer's bank history. Tests use hand-written fixtures.
- A Server Component must not read an Ant Design *sub*-component (`Typography.Title`, `Form.Item`, …).
- Keep every touched TS/TSX file under 400 lines. `ImportClient.tsx` is 336 today.
- Read the checked-in Next.js 16 docs in `node_modules/next/dist/docs/` before writing route or Server Action code.
- Verification gates, all with real pasted output: `npm test`, `npm run typecheck`, `npm run lint`, `npm run security:check-source`, `npm run build`, plus `scripts/smoke-pages.mjs` against the built server.
- All npm and node commands run with the working directory `ctyhp-accounting`. Git commands run from the repository root, `c:\Users\pit010\QUICKBOOK_WEBAPP`.

## File Map

| File | Responsibility |
|---|---|
| `ctyhp-accounting/lib/domain/wave-ledger.ts` | Create. Parse the grid into sections, date-grouped entries and per-account nets. Pure. |
| `ctyhp-accounting/tests/fixtures/wave-account-transactions.csv` | Create. A synthetic file carrying every layout trap. |
| `ctyhp-accounting/tests/fixtures/wave-account-transactions-unbalanced.csv` | Create. One date that does not balance. |
| `ctyhp-accounting/lib/domain/import-mapping.ts` | Modify. `general_ledger` target, label, empty field list. |
| `ctyhp-accounting/lib/domain/import-shape.ts` | Modify. Point the Wave detection at the new tab. |
| `ctyhp-accounting/supabase/migrations/0102_import_ledger_batches.sql` | Create. Batch tables, three functions, dash-tolerant account matching. |
| `ctyhp-accounting/scripts/verify-ledger-import.mjs` | Create. Rollback-only behavioural proof. |
| `ctyhp-accounting/lib/services/ledger-import.ts` | Create. Import, list, void, link the saved copy. |
| `ctyhp-accounting/app/(app)/settings/import/actions.ts` | Modify. Four new actions. |
| `ctyhp-accounting/app/(app)/settings/import/LedgerImportPanel.tsx` | Create. Upload, preview, mode, import. |
| `ctyhp-accounting/app/(app)/settings/import/LedgerBatchList.tsx` | Create. Past imports and undo. |
| `ctyhp-accounting/app/(app)/settings/import/ImportClient.tsx` | Modify. Route the new tab to the panel. |
| `ctyhp-accounting/package.json` | Modify. `verify:ledger-import` script. |

---

### Task 1: The parser

**Files:**
- Create: `ctyhp-accounting/lib/domain/wave-ledger.ts`
- Create: `ctyhp-accounting/tests/fixtures/wave-account-transactions.csv`
- Create: `ctyhp-accounting/tests/fixtures/wave-account-transactions-unbalanced.csv`
- Test: `ctyhp-accounting/tests/unit/wave-ledger.test.ts`

**Interfaces:**
- Consumes: `parseCsvGrid(text: string): string[][]` from `@/lib/csv`.
- Produces:

```ts
export interface WaveLedgerSection {
  account: string;
  debitMinor: number;
  creditMinor: number;
  rows: number;
  reportedDebitMinor: number | null;
  reportedCreditMinor: number | null;
}
export interface WaveLedgerLine { account: string; signedMinor: number; description: string }
export interface WaveLedgerEntry { date: string; lines: WaveLedgerLine[] }
export interface WaveLedgerParse {
  sections: WaveLedgerSection[];
  entries: WaveLedgerEntry[];
  balances: { account: string; signedMinor: number }[];
  unbalancedDates: { date: string; differenceMinor: number }[];
  sectionMismatches: string[];
  skippedZeroRows: number;
  lineCount: number;
  totalDebitMinor: number;
  fromDate: string | null;
  toDate: string | null;
}
export const LEDGER_DESCRIPTION_LIMIT: 200;
export function parseLedgerMoney(text: string): number;
export function parseLedgerDate(text: string): string | null;
export function isWaveLedgerGrid(grid: string[][]): boolean;
export function parseWaveLedger(grid: string[][]): WaveLedgerParse;
export function waveLedgerPayload(
  parse: WaveLedgerParse,
  mode: "history" | "balances",
  asOf: string,
): WaveLedgerEntry[];
```

- [ ] **Step 1: Write the fixtures**

Create `ctyhp-accounting/tests/fixtures/wave-account-transactions.csv`. Every trap from the real file is here: the first account named in column 0, later accounts named in column 1, an account repeating its name on every row, all three markers, a zero-amount row, money with commas and parentheses, and an en dash in an account name.

```csv
ACCOUNT NUMBER,DATE,DESCRIPTION,DEBIT (In Business Currency),CREDIT (In Business Currency),BALANCE (In Business Currency)
121 - Checking,,,,,
,,,,,$0.00
,1/2/2023,Beginning Balance,"$1,200.00",,"$1,200.00"
,1/3/2023,Card payment,,$300.00,$900.00
,1/4/2023,Fee waiver,$0.00,,$900.00
,2/1/2023,Refund received,$50.00,,$950.00
Totals and Ending Balance,,,"$1,250.00",$300.00,$950.00
Balance Change,,,$950.00,,
,,,,,
,Opening Balance Equity,,,,
Starting Balance,,,,,$0.00
,1/2/2023,Beginning Balance,,"$1,200.00","$1,200.00"
Totals and Ending Balance,,,$0.00,"$1,200.00","$1,200.00"
Balance Change,,,"$1,200.00",,
,,,,,
,Taxes – Corporate Tax,,,,
Starting Balance,,,,,$0.00
,1/3/2023,Quarterly filing,$300.00,,$300.00
Totals and Ending Balance,,,$300.00,$0.00,$300.00
Balance Change,,,$300.00,,
,,,,,
,Sales,,,,
Starting Balance,,,,,$0.00
Sales,2/1/2023,Product refund,,$50.00,$50.00
Totals and Ending Balance,,,$0.00,$50.00,$50.00
Balance Change,,,$50.00,,
```

Create `ctyhp-accounting/tests/fixtures/wave-account-transactions-unbalanced.csv`:

```csv
ACCOUNT NUMBER,DATE,DESCRIPTION,DEBIT (In Business Currency),CREDIT (In Business Currency),BALANCE (In Business Currency)
121 - Checking,,,,,
,3/1/2023,Deposit,$100.00,,$100.00
Totals and Ending Balance,,,$100.00,$0.00,$100.00
,,,,,
,Sales,,,,
,3/1/2023,Sale,,$60.00,$60.00
Totals and Ending Balance,,,$0.00,$60.00,$60.00
```

- [ ] **Step 2: Write the failing test**

Create `ctyhp-accounting/tests/unit/wave-ledger.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCsvGrid } from "@/lib/csv";
import {
  isWaveLedgerGrid,
  parseLedgerDate,
  parseLedgerMoney,
  parseWaveLedger,
  waveLedgerPayload,
} from "@/lib/domain/wave-ledger";

function fixture(name: string): string[][] {
  return parseCsvGrid(readFileSync(join(process.cwd(), "tests", "fixtures", name), "utf8"));
}

const grid = fixture("wave-account-transactions.csv");
const parse = parseWaveLedger(grid);

describe("parseLedgerMoney", () => {
  it("reads the shapes Wave writes", () => {
    expect(parseLedgerMoney("$1,200.00")).toBe(120000);
    expect(parseLedgerMoney("$0.00")).toBe(0);
    expect(parseLedgerMoney("")).toBe(0);
    expect(parseLedgerMoney("($45.50)")).toBe(-4550);
    expect(parseLedgerMoney("-$45.50")).toBe(-4550);
  });
});

describe("parseLedgerDate", () => {
  it("turns a US date into an ISO one", () => {
    expect(parseLedgerDate("8/29/2024")).toBe("2024-08-29");
    expect(parseLedgerDate("12/31/2022")).toBe("2022-12-31");
  });

  it("refuses anything that is not a date", () => {
    expect(parseLedgerDate("Totals and Ending Balance")).toBeNull();
    expect(parseLedgerDate("")).toBeNull();
  });
});

describe("isWaveLedgerGrid", () => {
  it("recognises the report by its header", () => {
    expect(isWaveLedgerGrid(grid)).toBe(true);
  });

  it("does not claim a plain transactions export", () => {
    expect(isWaveLedgerGrid([["Date", "Description", "Amount"], ["1/1/2023", "x", "1"]])).toBe(
      false,
    );
  });
});

describe("parseWaveLedger sections", () => {
  it("finds every account however the file names it", () => {
    expect(parse.sections.map((section) => section.account)).toEqual([
      "121 - Checking",
      "Opening Balance Equity",
      "Taxes – Corporate Tax",
      "Sales",
    ]);
  });

  it("ignores an account name repeated on a data row", () => {
    const sales = parse.sections.find((section) => section.account === "Sales");
    expect(sales?.rows).toBe(1);
    expect(sales?.creditMinor).toBe(5000);
  });

  it("agrees with the totals the file reports for itself", () => {
    expect(parse.sectionMismatches).toEqual([]);
    const checking = parse.sections.find((section) => section.account === "121 - Checking");
    expect(checking?.debitMinor).toBe(125000);
    expect(checking?.reportedDebitMinor).toBe(125000);
  });
});

describe("parseWaveLedger entries", () => {
  it("groups the rows by date", () => {
    expect(parse.entries.map((entry) => entry.date)).toEqual(["2023-01-02", "2023-01-03", "2023-02-01"]);
  });

  it("makes every entry balance", () => {
    for (const entry of parse.entries) {
      expect(entry.lines.reduce((sum, line) => sum + line.signedMinor, 0)).toBe(0);
    }
    expect(parse.unbalancedDates).toEqual([]);
  });

  it("debits with a positive amount and credits with a negative one", () => {
    const january2 = parse.entries[0];
    expect(january2.lines).toEqual([
      { account: "121 - Checking", signedMinor: 120000, description: "Beginning Balance" },
      { account: "Opening Balance Equity", signedMinor: -120000, description: "Beginning Balance" },
    ]);
  });

  it("leaves out a row carrying no money and counts it", () => {
    expect(parse.skippedZeroRows).toBe(1);
    expect(parse.lineCount).toBe(6);
  });

  it("reports the range it covers", () => {
    expect(parse.fromDate).toBe("2023-01-02");
    expect(parse.toDate).toBe("2023-02-01");
    expect(parse.totalDebitMinor).toBe(155000);
  });
});

describe("parseWaveLedger balances", () => {
  it("nets each account, and the nets cancel out", () => {
    expect(parse.balances).toEqual([
      { account: "121 - Checking", signedMinor: 95000 },
      { account: "Opening Balance Equity", signedMinor: -120000 },
      { account: "Taxes – Corporate Tax", signedMinor: 30000 },
      { account: "Sales", signedMinor: -5000 },
    ]);
    expect(parse.balances.reduce((sum, line) => sum + line.signedMinor, 0)).toBe(0);
  });
});

describe("an unbalanced date", () => {
  it("is named rather than guessed at", () => {
    const bad = parseWaveLedger(fixture("wave-account-transactions-unbalanced.csv"));
    expect(bad.unbalancedDates).toEqual([{ date: "2023-03-01", differenceMinor: 4000 }]);
  });
});

describe("waveLedgerPayload", () => {
  it("sends the dated entries for the whole history", () => {
    const payload = waveLedgerPayload(parse, "history", "2023-12-31");
    expect(payload).toHaveLength(3);
    expect(payload[0].date).toBe("2023-01-02");
  });

  it("sends one entry as of the chosen date for balances", () => {
    const payload = waveLedgerPayload(parse, "balances", "2023-12-31");
    expect(payload).toHaveLength(1);
    expect(payload[0].date).toBe("2023-12-31");
    expect(payload[0].lines).toHaveLength(4);
    expect(payload[0].lines[0]).toEqual({
      account: "121 - Checking",
      signedMinor: 95000,
      description: "Closing balance",
    });
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

```
cd ctyhp-accounting
npx vitest run tests/unit/wave-ledger.test.ts
```

Expected: FAIL — `Failed to resolve import "@/lib/domain/wave-ledger"`.

- [ ] **Step 4: Write the parser**

Create `ctyhp-accounting/lib/domain/wave-ledger.ts`:

```ts
/**
 * Reading Wave's "Account Transactions" report.
 *
 * The file is a complete general ledger: every row is *one side* of a double
 * entry and the other side is a row in another account's section. No column
 * mapping can read it, which is why this parser exists.
 *
 * Three things about the layout catch people out, and all three are handled by
 * the same small set of rules below:
 *
 *   * the first account's name sits in column 0, every later one in column 1
 *     (the DATE column);
 *   * `Starting Balance`, `Totals and Ending Balance` and `Balance Change` sit
 *     in column 0, where an account name also sits;
 *   * one account repeats its own name on every data row.
 *
 * Rows are grouped into one entry per date. That is not a convenience: in the
 * real file all 554 dates balance exactly, so grouping by date needs no
 * guesswork about which two halves belong together — and guessing is the one
 * thing that would produce books that balance while describing a transaction
 * that never happened.
 */

import { parseCsvGrid } from "@/lib/csv";

/** Long bank reference strings are truncated; the original is kept in Saved Reports. */
export const LEDGER_DESCRIPTION_LIMIT = 200;

const MARKERS = new Set(["starting balance", "totals and ending balance", "balance change"]);
const DATE_PATTERN = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

export interface WaveLedgerSection {
  account: string;
  debitMinor: number;
  creditMinor: number;
  rows: number;
  /** What the file's own "Totals and Ending Balance" row claims, when it has one. */
  reportedDebitMinor: number | null;
  reportedCreditMinor: number | null;
}

export interface WaveLedgerLine {
  account: string;
  /** Positive debits, negative credits — the convention the transactions import uses. */
  signedMinor: number;
  description: string;
}

export interface WaveLedgerEntry {
  date: string;
  lines: WaveLedgerLine[];
}

export interface WaveLedgerParse {
  sections: WaveLedgerSection[];
  entries: WaveLedgerEntry[];
  balances: { account: string; signedMinor: number }[];
  unbalancedDates: { date: string; differenceMinor: number }[];
  /** Accounts where our sums disagree with the file's own totals: the parser is wrong. */
  sectionMismatches: string[];
  skippedZeroRows: number;
  lineCount: number;
  totalDebitMinor: number;
  fromDate: string | null;
  toDate: string | null;
}

export function parseLedgerMoney(text: string): number {
  const raw = (text ?? "").trim();
  if (!raw) return 0;
  const negative = raw.startsWith("(") || raw.startsWith("-");
  const digits = raw.replace(/[()\-$,\s]/g, "");
  if (!digits) return 0;
  const value = Number(digits);
  if (!Number.isFinite(value)) return 0;
  return (negative ? -1 : 1) * Math.round(value * 100);
}

export function parseLedgerDate(text: string): string | null {
  const match = DATE_PATTERN.exec((text ?? "").trim());
  if (!match) return null;
  const [, month, day, year] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

/** Does this grid look like the Account Transactions report at all? */
export function isWaveLedgerGrid(grid: string[][]): boolean {
  const header = (grid[0] ?? []).map((cell) => cell.trim().toLowerCase());
  const has = (needle: string) => header.some((cell) => cell.includes(needle));
  return has("account") && has("debit") && has("credit") && has("balance");
}

export function parseWaveLedger(grid: string[][]): WaveLedgerParse {
  const sections: WaveLedgerSection[] = [];
  const byDate = new Map<string, WaveLedgerLine[]>();
  const netByAccount = new Map<string, number>();
  const order: string[] = [];
  let current: WaveLedgerSection | null = null;
  let skippedZeroRows = 0;

  for (const raw of grid.slice(1)) {
    const cells = [0, 1, 2, 3, 4, 5].map((index) => (raw[index] ?? "").trim());
    const [first, second, description, debit, credit] = cells;
    if (cells.every((cell) => cell === "")) continue;

    const marker = MARKERS.has(first.toLowerCase());
    if (marker) {
      if (current && first.toLowerCase() === "totals and ending balance") {
        current.reportedDebitMinor = parseLedgerMoney(debit);
        current.reportedCreditMinor = parseLedgerMoney(credit);
      }
      continue;
    }

    const date = parseLedgerDate(second);
    if (!date) {
      // A row naming an account: exactly one cell has anything in it, and it is
      // in column 0 for the first account or column 1 for every later one.
      const named = first || second;
      const others = cells.filter((cell) => cell !== "" && cell !== named);
      if (named && others.length === 0) {
        current = {
          account: named,
          debitMinor: 0,
          creditMinor: 0,
          rows: 0,
          reportedDebitMinor: null,
          reportedCreditMinor: null,
        };
        sections.push(current);
      }
      continue;
    }

    // A data row. Column 0 may repeat the account name; the section owns it.
    if (!current) continue;
    const debitMinor = parseLedgerMoney(debit);
    const creditMinor = parseLedgerMoney(credit);
    const signedMinor = debitMinor - creditMinor;
    if (signedMinor === 0) {
      skippedZeroRows += 1;
      continue;
    }

    current.debitMinor += debitMinor;
    current.creditMinor += creditMinor;
    current.rows += 1;

    const lines = byDate.get(date);
    const line: WaveLedgerLine = {
      account: current.account,
      signedMinor,
      description: description.slice(0, LEDGER_DESCRIPTION_LIMIT),
    };
    if (lines) lines.push(line);
    else {
      byDate.set(date, [line]);
      order.push(date);
    }
    netByAccount.set(current.account, (netByAccount.get(current.account) ?? 0) + signedMinor);
  }

  const dates = [...order].sort();
  const entries = dates.map((date) => ({ date, lines: byDate.get(date) ?? [] }));
  const unbalancedDates = entries
    .map((entry) => ({
      date: entry.date,
      differenceMinor: entry.lines.reduce((sum, line) => sum + line.signedMinor, 0),
    }))
    .filter((entry) => entry.differenceMinor !== 0);

  const sectionMismatches = sections
    .filter(
      (section) =>
        (section.reportedDebitMinor !== null && section.reportedDebitMinor !== section.debitMinor) ||
        (section.reportedCreditMinor !== null &&
          section.reportedCreditMinor !== section.creditMinor),
    )
    .map((section) => section.account);

  return {
    sections,
    entries,
    balances: sections
      .filter((section) => netByAccount.has(section.account))
      .map((section) => ({
        account: section.account,
        signedMinor: netByAccount.get(section.account) ?? 0,
      })),
    unbalancedDates,
    sectionMismatches,
    skippedZeroRows,
    lineCount: entries.reduce((sum, entry) => sum + entry.lines.length, 0),
    totalDebitMinor: sections.reduce((sum, section) => sum + section.debitMinor, 0),
    fromDate: dates[0] ?? null,
    toDate: dates[dates.length - 1] ?? null,
  };
}

/** What actually goes to the server, given the mode the person chose. */
export function waveLedgerPayload(
  parse: WaveLedgerParse,
  mode: "history" | "balances",
  asOf: string,
): WaveLedgerEntry[] {
  if (mode === "history") return parse.entries;
  return [
    {
      date: asOf,
      lines: parse.balances.map((balance) => ({
        account: balance.account,
        signedMinor: balance.signedMinor,
        description: "Closing balance",
      })),
    },
  ];
}

/** Convenience for callers holding text rather than a grid. */
export function parseWaveLedgerText(text: string): WaveLedgerParse {
  return parseWaveLedger(parseCsvGrid(text));
}
```

- [ ] **Step 5: Run the tests and watch them pass**

```
cd ctyhp-accounting
npx vitest run tests/unit/wave-ledger.test.ts
```

Expected: PASS, 16 tests. If `sections` includes a phantom account, the section-detection rule is matching a data row — fix the rule, not the test.

- [ ] **Step 6: Commit**

```bash
cd /c/Users/pit010/QUICKBOOK_WEBAPP
git add ctyhp-accounting/lib/domain/wave-ledger.ts ctyhp-accounting/tests/fixtures ctyhp-accounting/tests/unit/wave-ledger.test.ts
git commit -m "Read a general ledger whose rows are each half a transaction"
```

---

### Task 2: The tab exists and the detection points at it

**Files:**
- Modify: `ctyhp-accounting/lib/domain/import-mapping.ts`
- Modify: `ctyhp-accounting/lib/domain/import-shape.ts`
- Test: `ctyhp-accounting/tests/unit/import-shape.test.ts` (append)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `ImportTarget` gains `"general_ledger"`; `TARGET_LABEL.general_ledger === "General ledger"`; `fieldsFor("general_ledger")` returns `[]`; `detectFileShape` returns `target: "general_ledger"` for a Wave ledger header.

- [ ] **Step 1: Write the failing test**

Append to `ctyhp-accounting/tests/unit/import-shape.test.ts`:

```ts
describe("a Wave Account Transactions header", () => {
  const headers = [
    "ACCOUNT NUMBER",
    "DATE",
    "DESCRIPTION",
    "DEBIT (In Business Currency)",
    "CREDIT (In Business Currency)",
    "BALANCE (In Business Currency)",
  ];

  it("is sent to the general ledger tab, not the chart of accounts", () => {
    const detection = detectFileShape(headers);
    expect(detection.looksLikeWaveAccountTransactions).toBe(true);
    expect(detection.target).toBe("general_ledger");
  });

  it("offers to switch when it lands on the wrong tab", () => {
    const message = describeShapeMismatch("chart_of_accounts", detectFileShape(headers));
    expect(message).toMatch(/general ledger/i);
  });

  it("says nothing once it is on the right tab", () => {
    expect(describeShapeMismatch("general_ledger", detectFileShape(headers))).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```
cd ctyhp-accounting
npx vitest run tests/unit/import-shape.test.ts
```

Expected: FAIL — `expected 'chart_of_accounts' to be 'general_ledger'`.

- [ ] **Step 3: Register the target**

In `ctyhp-accounting/lib/domain/import-mapping.ts`, extend the union (around line 23):

```ts
export type ImportTarget =
  | "chart_of_accounts"
  | "customers"
  | "vendors"
  | "items"
  | "invoices"
  | "transactions"
  | "general_ledger";
```

Add to `TARGET_LABEL` (around line 368):

```ts
  general_ledger: "General ledger",
```

Add to `fieldsFor` (around line 351), before the closing brace of the switch:

```ts
    // A general ledger is read by its own parser: the file has no columns to
    // agree on, because a row's meaning comes from the section it sits in.
    case "general_ledger":
      return [];
```

- [ ] **Step 4: Point the detection at the tab**

In `ctyhp-accounting/lib/domain/import-shape.ts`, inside `detectFileShape`, replace the `return` object's `target` line so the Wave report wins over the best column match. The function currently ends:

```ts
  return {
    target: best?.target ?? null,
    matchedRequired: best?.matched ?? 0,
    requiredTotal: best?.total ?? 0,
    looksLikeLedgerDetail,
    looksLikeWaveAccountTransactions: looksLikeLedgerDetail && hasAccount && hasRunningBalance,
  };
```

Replace that with:

```ts
  const looksLikeWaveAccountTransactions = looksLikeLedgerDetail && hasAccount && hasRunningBalance;
  return {
    // The Wave report is recognised by shape rather than by column coverage:
    // its columns match a chart of accounts well enough to win on points, and
    // that is exactly the mistake this detection exists to prevent.
    target: looksLikeWaveAccountTransactions ? "general_ledger" : (best?.target ?? null),
    matchedRequired: looksLikeWaveAccountTransactions ? 0 : (best?.matched ?? 0),
    requiredTotal: looksLikeWaveAccountTransactions ? 0 : (best?.total ?? 0),
    looksLikeLedgerDetail,
    looksLikeWaveAccountTransactions,
  };
```

And rewrite the Wave branch of `describeShapeMismatch` (around line 159):

```ts
  if (detection.looksLikeWaveAccountTransactions) {
    return (
      "This file is a general ledger: one row per transaction, grouped into sections per " +
      "account, with a running balance. Every row is one side of a double entry, so no column " +
      `mapping can read it. Switch to ${TARGET_LABEL.general_ledger} — that tab reads this file ` +
      "whole, every account in one go."
    );
  }
```

- [ ] **Step 5: Run the tests and watch them pass**

```
cd ctyhp-accounting
npx vitest run tests/unit/import-shape.test.ts tests/unit/import-mapping.test.ts
npm run typecheck
```

Expected: both suites pass and typecheck is clean. Typecheck is the point of this step: `fieldsFor` and `TARGET_LABEL` are exhaustive over `ImportTarget`, so a missed case fails here rather than at runtime.

- [ ] **Step 6: Commit**

```bash
cd /c/Users/pit010/QUICKBOOK_WEBAPP
git add ctyhp-accounting/lib/domain/import-mapping.ts ctyhp-accounting/lib/domain/import-shape.ts ctyhp-accounting/tests/unit/import-shape.test.ts
git commit -m "Send a general ledger to the tab that can read it"
```

---

### Task 3: The migration, and the proof it posts and unposts

**Files:**
- Create: `ctyhp-accounting/supabase/migrations/0102_import_ledger_batches.sql`
- Create: `ctyhp-accounting/scripts/verify-ledger-import.mjs`
- Modify: `ctyhp-accounting/package.json`
- Test: `ctyhp-accounting/tests/unit/ledger-import-migration.test.ts`

**Interfaces:**
- Consumes: `acc_post_entry`, `acc_to_base_minor`, `acc_is_staff`, `acc_resolve_account_ref` (migration 0100).
- Produces:
  - `acc_import_ledger_entries(p_source text, p_mode text, p_file_name text, p_sha256 text, p_entries jsonb) returns jsonb` — `{batch_id, entries, lines}`
  - `acc_void_import_batch(p_batch_id uuid, p_reason text) returns int`
  - `acc_link_import_batch_report(p_batch_id uuid, p_report_id uuid) returns void`
  - tables `acc_import_batch`, `acc_import_batch_entry`

- [ ] **Step 1: Write the failing test**

Create `ctyhp-accounting/tests/unit/ledger-import-migration.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(process.cwd(), "supabase", "migrations", "0102_import_ledger_batches.sql"),
  "utf8",
);
const code = sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");

describe("0102_import_ledger_batches", () => {
  it("posts only through acc_post_entry", () => {
    expect(code).toMatch(/acc_post_entry\(/);
    expect(code).not.toMatch(/insert\s+into\s+acc_journal_line/i);
    expect(code).not.toMatch(/insert\s+into\s+acc_journal_entry/i);
  });

  it("uses source types that already exist, adding no enum value", () => {
    expect(code).toMatch(/'manual'/);
    expect(code).toMatch(/'opening_balance'/);
    expect(code).not.toMatch(/alter type acc_journal_source/i);
  });

  it("refuses anyone who is not staff", () => {
    expect((code.match(/acc_is_staff\(\)/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("keeps one live batch per file", () => {
    expect(code).toMatch(
      /create unique index[\s\S]{0,60}acc_import_batch_sha_idx[\s\S]{0,120}where status = 'active'/,
    );
  });

  it("gives the batch tables no write policy", () => {
    expect(code).not.toMatch(/on acc_import_batch\s+for (insert|update|delete)/i);
    expect(code).not.toMatch(/on acc_import_batch_entry\s+for (insert|update|delete)/i);
  });

  it("undoes by voiding, never by deleting", () => {
    expect(code).toMatch(/status = 'void'/);
    expect(code).not.toMatch(/delete\s+from\s+acc_journal/i);
  });

  it("teaches account matching about the dash Wave writes", () => {
    expect(code).toMatch(/acc_normalize_ref/);
    expect(code).toMatch(/translate\(/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```
cd ctyhp-accounting
npx vitest run tests/unit/ledger-import-migration.test.ts
```

Expected: FAIL — `ENOENT: no such file or directory … 0102_import_ledger_batches.sql`.

- [ ] **Step 3: Write the migration**

Create `ctyhp-accounting/supabase/migrations/0102_import_ledger_batches.sql`:

```sql
-- ============================================================================
-- 0102  Importing a general ledger from another product
--
-- The file behind feedback 428ca4db is Wave's "Account Transactions" report: a
-- complete general ledger where every row is one side of a double entry and
-- the other side is a row in another account's section.
--
-- Pairing the halves would be guesswork. The client groups the rows by date
-- instead — in the real file all 554 dates balance exactly — and sends the
-- whole file here in one call, so it posts inside one transaction and a closed
-- period or an unknown account rolls all of it back.
--
-- Two things this migration exists to make possible:
--
--   * a file cannot be imported twice, whichever mode is chosen, because the
--     batch holds its sha256;
--   * an import can be undone, because the batch remembers every entry it
--     created. Nothing else in One Book can void a plain journal entry, and
--     three years of ledger with no way back is a button nobody dares press.
-- ============================================================================

set search_path = public;

-- ----------------------------------------------------------------------------
-- Matching an account reference the way a person reads it.
--
-- Wave writes "Taxes – Corporate Tax" with an EN DASH. A chart holding a plain
-- hyphen would not match, and the import would refuse a file for a difference
-- nobody can see. Every dash character becomes a hyphen before comparison.
-- ----------------------------------------------------------------------------
create or replace function acc_normalize_ref(p_ref text) returns text
language sql immutable as $$
  select lower(btrim(translate(coalesce(p_ref, ''), '‐‑‒–—―', '------')));
$$;

revoke all on function acc_normalize_ref(text) from public, anon;
grant execute on function acc_normalize_ref(text) to authenticated, service_role;

create or replace function acc_resolve_account_ref(p_ref text) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare
  v_ref text := acc_normalize_ref(p_ref);
  v_id  uuid;
begin
  if v_ref = '' then return null; end if;

  select id into v_id from acc_account
   where acc_normalize_ref(account_code) = v_ref and status <> 'archived'
   limit 1;
  if v_id is not null then return v_id; end if;

  select id into v_id from acc_account
   where acc_normalize_ref(account_code || ' - ' || name) = v_ref and status <> 'archived'
   limit 1;
  if v_id is not null then return v_id; end if;

  select id into v_id from acc_account
   where acc_normalize_ref(name) = v_ref and status <> 'archived'
   limit 1;
  return v_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- What was imported, and what it created.
-- ----------------------------------------------------------------------------
create table if not exists acc_import_batch (
  id              uuid primary key default gen_random_uuid(),
  source          text not null check (source in ('wave_ledger')),
  mode            text not null check (mode in ('history', 'balances')),
  file_name       text not null check (length(btrim(file_name)) > 0),
  sha256          text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  entry_count     int  not null check (entry_count >= 0),
  line_count      int  not null check (line_count >= 0),
  from_date       date,
  to_date         date,
  -- Total debits posted, so a batch can be recognised at a glance without
  -- reading its entries back.
  total_minor     bigint not null check (total_minor >= 0),
  saved_report_id uuid references acc_saved_report (id),
  status          text not null default 'active' check (status in ('active', 'voided')),
  imported_by     uuid references auth.users (id),
  imported_at     timestamptz not null default now(),
  voided_by       uuid references auth.users (id),
  voided_at       timestamptz,
  void_reason     text
);

-- One live import per file. Voiding frees the hash, so a corrected export of
-- the same ledger can be brought in after the mistake is undone.
create unique index if not exists acc_import_batch_sha_idx
  on acc_import_batch (sha256) where status = 'active';

create table if not exists acc_import_batch_entry (
  batch_id         uuid not null references acc_import_batch (id) on delete cascade,
  journal_entry_id uuid not null references acc_journal_entry (id),
  primary key (batch_id, journal_entry_id)
);

alter table acc_import_batch       enable row level security;
alter table acc_import_batch_entry enable row level security;

drop policy if exists acc_import_batch_sel on acc_import_batch;
create policy acc_import_batch_sel on acc_import_batch
  for select using (acc_has_permission('documents.read'));

drop policy if exists acc_import_batch_entry_sel on acc_import_batch_entry;
create policy acc_import_batch_entry_sel on acc_import_batch_entry
  for select using (acc_has_permission('documents.read'));

revoke all on table acc_import_batch, acc_import_batch_entry from public, anon;
grant select on table acc_import_batch, acc_import_batch_entry to authenticated;
grant all    on table acc_import_batch, acc_import_batch_entry to service_role;

/**
 * Post a whole general ledger file.
 *
 * p_entries is [{"date": "2023-01-03",
 *                "lines": [{"account": "121 - …", "signed_minor": 100,
 *                           "description": "…"}, …]}, …]
 * where a positive signed_minor debits and a negative one credits.
 *
 * The account references are resolved here and not taken on trust from the
 * screen: the server is the authority on what a name means.
 */
create or replace function acc_import_ledger_entries(
  p_source    text,
  p_mode      text,
  p_file_name text,
  p_sha256    text,
  p_entries   jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_batch     uuid;
  v_entry     jsonb;
  v_line      jsonb;
  v_date      date;
  v_account   uuid;
  v_signed    bigint;
  v_sum       bigint;
  v_lines     jsonb;
  v_currency  text;
  v_source    acc_journal_source;
  v_equity    uuid;
  v_entry_id  uuid;
  v_entries   int := 0;
  v_count     int := 0;
  v_total     bigint := 0;
  v_from      date;
  v_to        date;
  v_existing  record;
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to import a ledger';
  end if;
  if p_mode not in ('history', 'balances') then
    raise exception 'Unknown import mode "%"', p_mode;
  end if;

  select b.imported_at, coalesce(u.full_name, 'another user') as who
    into v_existing
    from acc_import_batch b
    left join acc_app_user u on u.id = b.imported_by
   where b.sha256 = p_sha256 and b.status = 'active'
   limit 1;
  if found then
    raise exception 'This file was already imported on % by %. Undo that import first.',
      to_char(v_existing.imported_at, 'YYYY-MM-DD'), v_existing.who;
  end if;

  select code into v_currency from acc_currency where is_base limit 1;
  if v_currency is null then raise exception 'No base currency is configured'; end if;

  v_source := case when p_mode = 'history' then 'manual' else 'opening_balance' end;

  insert into acc_import_batch
    (source, mode, file_name, sha256, entry_count, line_count, total_minor, imported_by)
  values (p_source, p_mode, btrim(p_file_name), p_sha256, 0, 0, 0, auth.uid())
  returning id into v_batch;

  for v_entry in select * from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb))
  loop
    v_date := (v_entry->>'date')::date;
    v_from := least(coalesce(v_from, v_date), v_date);
    v_to   := greatest(coalesce(v_to, v_date), v_date);
    v_lines := '[]'::jsonb;
    v_sum := 0;

    for v_line in select * from jsonb_array_elements(v_entry->'lines')
    loop
      v_signed := (v_line->>'signed_minor')::bigint;
      if v_signed = 0 then continue; end if;
      v_account := acc_resolve_account_ref(v_line->>'account');
      if v_account is null then
        raise exception 'Account not found for "%"', coalesce(v_line->>'account', '(none)');
      end if;
      v_sum := v_sum + v_signed;
      v_total := v_total + greatest(v_signed, 0);
      v_count := v_count + 1;
      v_lines := v_lines || jsonb_build_object(
        'account_id', v_account,
        'debit_minor',  case when v_signed > 0 then  v_signed else 0 end,
        'credit_minor', case when v_signed < 0 then -v_signed else 0 end,
        'amount_base_minor', acc_to_base_minor(abs(v_signed), v_currency, v_date),
        'memo', left(coalesce(v_line->>'description', ''), 200));
    end loop;

    if jsonb_array_length(v_lines) = 0 then continue; end if;

    -- A closing-balances file that does not net to zero is normal: it is a
    -- slice of somebody's books. The difference goes to Opening Balance
    -- Equity, which is what that account is for. A history file that does not
    -- balance is a parsing failure and must not post.
    if v_sum <> 0 then
      if p_mode <> 'balances' then
        raise exception 'The entries for % do not balance (% off)', v_date, v_sum;
      end if;
      select id into v_equity from acc_account where account_code = '3900' limit 1;
      if v_equity is null then
        raise exception 'Opening Balance Equity account (3900) is missing';
      end if;
      v_lines := v_lines || jsonb_build_object(
        'account_id', v_equity,
        'debit_minor',  case when v_sum < 0 then -v_sum else 0 end,
        'credit_minor', case when v_sum > 0 then  v_sum else 0 end,
        'amount_base_minor', acc_to_base_minor(abs(v_sum), v_currency, v_date),
        'memo', 'Opening balance difference');
      v_count := v_count + 1;
    end if;

    v_entry_id := acc_post_entry(
      v_date,
      case when p_mode = 'history'
        then 'Wave general ledger — ' || btrim(p_file_name)
        else 'Wave closing balances — ' || btrim(p_file_name) end,
      v_source, null, v_currency, v_lines);

    insert into acc_import_batch_entry (batch_id, journal_entry_id)
    values (v_batch, v_entry_id);
    v_entries := v_entries + 1;
  end loop;

  update acc_import_batch
     set entry_count = v_entries,
         line_count  = v_count,
         total_minor = v_total,
         from_date   = v_from,
         to_date     = v_to
   where id = v_batch;

  return jsonb_build_object('batch_id', v_batch, 'entries', v_entries, 'lines', v_count);
end;
$$;

/**
 * Undo an import.
 *
 * It voids the entries this batch created and nothing else — this is not a
 * general "void any journal entry" door. Voiding an entry dated in a closed
 * period is refused by the trigger from migration 0029, which is correct: a
 * closed period is corrected by a reversal, not by rewriting history.
 */
create or replace function acc_void_import_batch(p_batch_id uuid, p_reason text)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_voided int;
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to undo an import';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'Say why this import is being undone';
  end if;
  if not exists (select 1 from acc_import_batch where id = p_batch_id and status = 'active') then
    raise exception 'Import not found, or already undone';
  end if;

  update acc_journal_entry e
     set status = 'void', voided_at = now()
   where e.status = 'posted'
     and e.id in (select journal_entry_id from acc_import_batch_entry where batch_id = p_batch_id);
  get diagnostics v_voided = row_count;

  update acc_import_batch
     set status = 'voided', voided_by = auth.uid(), voided_at = now(),
         void_reason = btrim(p_reason)
   where id = p_batch_id;

  return v_voided;
end;
$$;

/** Attach the copy of the original file that was kept under Saved Reports. */
create or replace function acc_link_import_batch_report(p_batch_id uuid, p_report_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to change an import';
  end if;
  update acc_import_batch set saved_report_id = p_report_id where id = p_batch_id;
  if not found then raise exception 'Import not found'; end if;
end;
$$;

revoke all on function acc_import_ledger_entries(text, text, text, text, jsonb) from public, anon;
grant execute on function acc_import_ledger_entries(text, text, text, text, jsonb)
  to authenticated, service_role;

revoke all on function acc_void_import_batch(uuid, text) from public, anon;
grant execute on function acc_void_import_batch(uuid, text) to authenticated, service_role;

revoke all on function acc_link_import_batch_report(uuid, uuid) from public, anon;
grant execute on function acc_link_import_batch_report(uuid, uuid) to authenticated, service_role;
```

- [ ] **Step 4: Run the migration test and watch it pass**

```
cd ctyhp-accounting
npx vitest run tests/unit/ledger-import-migration.test.ts
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Write the rollback-only harness**

Create `ctyhp-accounting/scripts/verify-ledger-import.mjs`:

```js
/**
 * Behavioural verification of the general ledger import.
 *
 * Everything happens inside ONE transaction that is always rolled back: 0102 is
 * applied, real entries are posted into a real company, and none of it
 * survives. That is what makes this safe to run against a database holding real
 * books.
 *
 * Run: node --env-file=.env.local scripts/verify-ledger-import.mjs
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const client = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 30_000,
});

let passed = 0;
let failed = 0;

function check(label, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const one = async (sql, params = []) => (await client.query(sql, params)).rows[0];

async function scenario(name, body) {
  console.log(`\n== ${name}`);
  await client.query("savepoint case_start");
  try {
    await body();
  } catch (error) {
    failed += 1;
    console.log(`  FAIL  scenario threw — ${error.message}`);
  } finally {
    await client.query("rollback to savepoint case_start");
  }
}

async function attempt(sql, params) {
  try {
    await client.query(sql, params);
    return null;
  } catch (error) {
    await client.query("rollback to savepoint before_call");
    return error.message;
  }
}

const hash = (seed) => seed.padEnd(64, "0").slice(0, 64);

await client.connect();
await client.query("begin");
try {
  const migration = await readFile(
    join(projectRoot, "supabase", "migrations", "0102_import_ledger_batches.sql"),
    "utf8",
  );
  await client.query(migration);
  console.log("Applied 0102 inside the transaction (never committed).");

  const admin = await one(
    `select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`,
  );
  if (!admin) throw new Error("no active admin to authenticate as");
  const asUser = (id) =>
    client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: id, role: "authenticated" }),
    ]);
  await asUser(admin.id);

  // Two posting accounts in an open period. The date is deliberately recent so
  // a closed historical period cannot make the happy path fail.
  const bank = await one(
    `select account_code, name from acc_account
      where account_type = 'bank' and is_posting_account and status = 'active'
      order by account_code limit 1`,
  );
  const expense = await one(
    `select account_code, name from acc_account
      where account_type = 'expense' and is_posting_account and status = 'active'
      order by account_code limit 1`,
  );
  if (!bank || !expense) throw new Error("need a bank and an expense account to post between");

  const entries = (day) =>
    JSON.stringify([
      {
        date: `2026-07-0${day}`,
        lines: [
          { account: expense.name, signed_minor: 25000, description: "Ledger import check" },
          { account: bank.account_code, signed_minor: -25000, description: "Ledger import check" },
        ],
      },
      {
        date: `2026-07-1${day}`,
        lines: [
          { account: expense.name, signed_minor: 1000, description: "Second day" },
          { account: bank.account_code, signed_minor: -1000, description: "Second day" },
        ],
      },
    ]);

  const importIt = (sha, mode = "history") =>
    client.query(
      `select acc_import_ledger_entries('wave_ledger', $1, 'ledger.csv', $2, $3::jsonb) as out`,
      [mode, sha, entries(1)],
    );

  await scenario("a two-entry file posts, and every entry balances", async () => {
    const result = (await importIt(hash("aaaa1111"))).rows[0].out;
    check("two entries were posted", result.entries === 2, JSON.stringify(result));
    check("four lines were written", result.lines === 4, JSON.stringify(result));

    const unbalanced = await one(
      `select count(*)::int as n
         from acc_import_batch_entry be
         join acc_journal_line l on l.journal_entry_id = be.journal_entry_id
        where be.batch_id = $1
        group by be.journal_entry_id
       having sum(l.debit_minor) <> sum(l.credit_minor)`,
      [result.batch_id],
    );
    check("no entry is out of balance", !unbalanced);

    const posted = await one(
      `select count(*)::int as n from acc_journal_entry e
        join acc_import_batch_entry be on be.journal_entry_id = e.id
       where be.batch_id = $1 and e.status = 'posted' and e.source_type = 'manual'`,
      [result.batch_id],
    );
    check("both entries are posted as manual journals", posted.n === 2, String(posted.n));
  });

  await scenario("the same file cannot be imported twice", async () => {
    await importIt(hash("bbbb2222"));
    const before = await one(`select count(*)::int as n from acc_journal_entry`);
    await client.query("savepoint before_call");
    const refusal = await attempt(
      `select acc_import_ledger_entries('wave_ledger', 'balances', 'ledger.csv', $1, $2::jsonb)`,
      [hash("bbbb2222"), entries(2)],
    );
    const after = await one(`select count(*)::int as n from acc_journal_entry`);
    check("it is refused", /already imported/i.test(refusal ?? ""), refusal ?? "none");
    check("even in the other mode", /already imported/i.test(refusal ?? ""));
    check("and nothing new was posted", before.n === after.n, `${before.n} -> ${after.n}`);
  });

  await scenario("an account the chart does not have refuses the whole file", async () => {
    const before = await one(`select count(*)::int as n from acc_journal_entry`);
    await client.query("savepoint before_call");
    const refusal = await attempt(
      `select acc_import_ledger_entries('wave_ledger', 'history', 'ledger.csv', $1, $2::jsonb)`,
      [
        hash("cccc3333"),
        JSON.stringify([
          {
            date: "2026-07-02",
            lines: [
              { account: "No Such Account Anywhere", signed_minor: 100, description: "x" },
              { account: bank.account_code, signed_minor: -100, description: "x" },
            ],
          },
        ]),
      ],
    );
    const after = await one(`select count(*)::int as n from acc_journal_entry`);
    check("it is refused", /Account not found/i.test(refusal ?? ""), refusal ?? "none");
    check("and no entry survived", before.n === after.n, `${before.n} -> ${after.n}`);
    const batches = await one(
      `select count(*)::int as n from acc_import_batch where sha256 = $1`,
      [hash("cccc3333")],
    );
    check("and no batch was left behind", batches.n === 0, String(batches.n));
  });

  await scenario("an unbalanced history entry is refused", async () => {
    await client.query("savepoint before_call");
    const refusal = await attempt(
      `select acc_import_ledger_entries('wave_ledger', 'history', 'ledger.csv', $1, $2::jsonb)`,
      [
        hash("dddd4444"),
        JSON.stringify([
          {
            date: "2026-07-03",
            lines: [
              { account: expense.name, signed_minor: 100, description: "x" },
              { account: bank.account_code, signed_minor: -60, description: "x" },
            ],
          },
        ]),
      ],
    );
    check("it is refused", /do not balance/i.test(refusal ?? ""), refusal ?? "none");
  });

  await scenario("balances mode plugs the difference to Opening Balance Equity", async () => {
    const result = (
      await client.query(
        `select acc_import_ledger_entries('wave_ledger', 'balances', 'ledger.csv', $1, $2::jsonb) as out`,
        [
          hash("eeee5555"),
          JSON.stringify([
            {
              date: "2026-07-04",
              lines: [{ account: expense.name, signed_minor: 7000, description: "Closing balance" }],
            },
          ]),
        ],
      )
    ).rows[0].out;
    const equity = await one(
      `select l.credit_minor from acc_journal_line l
         join acc_account a on a.id = l.account_id
         join acc_import_batch_entry be on be.journal_entry_id = l.journal_entry_id
        where be.batch_id = $1 and a.account_code = '3900'`,
      [result.batch_id],
    );
    check("the plug was posted", Number(equity?.credit_minor) === 7000, JSON.stringify(equity));
  });

  await scenario("undo voids every entry the import created", async () => {
    const result = (await importIt(hash("ffff6666"))).rows[0].out;
    const voided = await one(`select acc_void_import_batch($1, 'Wrong chart of accounts') as n`, [
      result.batch_id,
    ]);
    check("both entries were voided", voided.n === 2, String(voided.n));
    const stillPosted = await one(
      `select count(*)::int as n from acc_journal_entry e
        join acc_import_batch_entry be on be.journal_entry_id = e.id
       where be.batch_id = $1 and e.status = 'posted'`,
      [result.batch_id],
    );
    check("none is still posted", stillPosted.n === 0, String(stillPosted.n));
    const batch = await one(`select status, void_reason from acc_import_batch where id = $1`, [
      result.batch_id,
    ]);
    check("the batch records why", batch?.status === "voided");
    check("and keeps the reason", batch?.void_reason === "Wrong chart of accounts");

    await client.query("savepoint before_call");
    const again = await attempt(
      `select acc_import_ledger_entries('wave_ledger', 'history', 'ledger.csv', $1, $2::jsonb)`,
      [hash("ffff6666"), entries(1)],
    );
    check("the file can be imported again once undone", again === null, again ?? "");
  });

  await scenario("a viewer can do neither", async () => {
    const result = (await importIt(hash("77778888"))).rows[0].out;
    const viewer = await one(
      `select id from acc_app_user where role = 'viewer' and status = 'active' limit 1`,
    );
    if (!viewer) {
      console.log("  SKIP  no active viewer to authenticate as");
      return;
    }
    await asUser(viewer.id);
    await client.query("savepoint before_call");
    const importing = await attempt(
      `select acc_import_ledger_entries('wave_ledger', 'history', 'ledger.csv', $1, $2::jsonb)`,
      [hash("99990000"), entries(1)],
    );
    check("importing is refused", /Not authorized/i.test(importing ?? ""), importing ?? "none");
    await client.query("savepoint before_call");
    const undoing = await attempt(`select acc_void_import_batch($1, 'no')`, [result.batch_id]);
    check("undoing is refused", /Not authorized/i.test(undoing ?? ""), undoing ?? "none");
    await asUser(admin.id);
  });
} catch (error) {
  failed += 1;
  console.log(`  FAIL  verification threw — ${error.message}`);
} finally {
  await client.query("rollback");
  console.log("\nROLLBACK — no entry and no batch was kept.");
  await client.end();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 6: Register the script**

In `ctyhp-accounting/package.json`, after the `"verify:saved-report-bucket"` line, add:

```json
    "verify:ledger-import": "node --env-file=.env.local scripts/verify-ledger-import.mjs",
```

- [ ] **Step 7: Run the harness against the live database**

```
cd ctyhp-accounting
npm run verify:ledger-import
```

Expected: every scenario PASS, then `ROLLBACK — no entry and no batch was kept.` A failure here is a defect in the migration, not in the harness. If the happy-path dates fall in a closed period, move them forward — do not weaken a guard to make a test pass.

- [ ] **Step 8: Commit**

```bash
cd /c/Users/pit010/QUICKBOOK_WEBAPP
git add ctyhp-accounting/supabase/migrations/0102_import_ledger_batches.sql ctyhp-accounting/scripts/verify-ledger-import.mjs ctyhp-accounting/package.json ctyhp-accounting/tests/unit/ledger-import-migration.test.ts
git commit -m "Post a whole ledger in one transaction, and keep the way back"
```

---

### Task 4: The service layer

**Files:**
- Create: `ctyhp-accounting/lib/services/ledger-import.ts`
- Test: `ctyhp-accounting/tests/unit/ledger-import-service.test.ts`

**Interfaces:**
- Consumes: `WaveLedgerEntry` from Task 1; the three RPCs from Task 3.
- Produces:

```ts
export class LedgerImportError extends Error {}
export interface ImportBatchRow {
  id: string; source: string; mode: "history" | "balances"; file_name: string; sha256: string;
  entry_count: number; line_count: number; from_date: string | null; to_date: string | null;
  total_minor: number; saved_report_id: string | null; status: "active" | "voided";
  imported_by: string | null; imported_at: string; voided_at: string | null; void_reason: string | null;
}
export async function importLedgerBatch(
  sb: SupabaseClient,
  input: { mode: "history" | "balances"; fileName: string; sha256: string; entries: WaveLedgerEntry[] },
): Promise<{ batchId: string; entries: number; lines: number }>;
export async function listImportBatches(sb: SupabaseClient): Promise<ImportBatchRow[]>;
export async function voidImportBatch(sb: SupabaseClient, batchId: string, reason: string): Promise<number>;
export async function linkImportBatchReport(sb: SupabaseClient, batchId: string, reportId: string): Promise<void>;
```

- [ ] **Step 1: Write the failing test**

Create `ctyhp-accounting/tests/unit/ledger-import-service.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  LedgerImportError,
  importLedgerBatch,
  voidImportBatch,
} = await import("@/lib/services/ledger-import");

function stubClient(response: { data?: unknown; error?: { message: string } }) {
  const rpc = vi.fn(async () => ({ data: response.data ?? null, error: response.error ?? null }));
  return { client: { rpc } as never, rpc };
}

const entries = [
  {
    date: "2023-01-02",
    lines: [
      { account: "121 - Checking", signedMinor: 120000, description: "Beginning Balance" },
      { account: "Opening Balance Equity", signedMinor: -120000, description: "Beginning Balance" },
    ],
  },
];

describe("importLedgerBatch", () => {
  it("sends snake_case lines, because that is what the function reads", async () => {
    const { client, rpc } = stubClient({ data: { batch_id: "b1", entries: 1, lines: 2 } });
    const result = await importLedgerBatch(client, {
      mode: "history",
      fileName: "ledger.csv",
      sha256: "a".repeat(64),
      entries,
    });
    expect(result).toEqual({ batchId: "b1", entries: 1, lines: 2 });
    const payload = rpc.mock.calls[0][1] as { p_entries: { lines: unknown[] }[]; p_mode: string };
    expect(payload.p_mode).toBe("history");
    expect(payload.p_entries[0].lines[0]).toEqual({
      account: "121 - Checking",
      signed_minor: 120000,
      description: "Beginning Balance",
    });
  });

  it("refuses an empty file before troubling the database", async () => {
    const { client, rpc } = stubClient({ data: null });
    await expect(
      importLedgerBatch(client, {
        mode: "history",
        fileName: "ledger.csv",
        sha256: "a".repeat(64),
        entries: [],
      }),
    ).rejects.toThrow(LedgerImportError);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("passes the database's own refusal through", async () => {
    const { client } = stubClient({ error: { message: "This file was already imported on 2026-08-06" } });
    await expect(
      importLedgerBatch(client, {
        mode: "history",
        fileName: "ledger.csv",
        sha256: "a".repeat(64),
        entries,
      }),
    ).rejects.toThrow("This file was already imported on 2026-08-06");
  });
});

describe("voidImportBatch", () => {
  it("returns how many entries were voided", async () => {
    const { client } = stubClient({ data: 554 });
    await expect(voidImportBatch(client, "b1", "Wrong chart")).resolves.toBe(554);
  });

  it("does not swallow a refusal", async () => {
    const { client } = stubClient({ error: { message: "Cannot void an entry in a closed period" } });
    await expect(voidImportBatch(client, "b1", "Wrong chart")).rejects.toThrow(
      "Cannot void an entry in a closed period",
    );
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```
cd ctyhp-accounting
npx vitest run tests/unit/ledger-import-service.test.ts
```

Expected: FAIL — `Cannot find package '@/lib/services/ledger-import'`.

- [ ] **Step 3: Write the service**

Create `ctyhp-accounting/lib/services/ledger-import.ts`:

```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WaveLedgerEntry } from "@/lib/domain/wave-ledger";

export class LedgerImportError extends Error {}

export interface ImportBatchRow {
  id: string;
  source: string;
  mode: "history" | "balances";
  file_name: string;
  sha256: string;
  entry_count: number;
  line_count: number;
  from_date: string | null;
  to_date: string | null;
  total_minor: number;
  saved_report_id: string | null;
  status: "active" | "voided";
  imported_by: string | null;
  imported_at: string;
  voided_at: string | null;
  void_reason: string | null;
}

const COLUMNS =
  "id,source,mode,file_name,sha256,entry_count,line_count,from_date,to_date,total_minor," +
  "saved_report_id,status,imported_by,imported_at,voided_at,void_reason";

export async function importLedgerBatch(
  sb: SupabaseClient,
  input: {
    mode: "history" | "balances";
    fileName: string;
    sha256: string;
    entries: WaveLedgerEntry[];
  },
): Promise<{ batchId: string; entries: number; lines: number }> {
  if (input.entries.length === 0) {
    throw new LedgerImportError("There is nothing in this file to import");
  }
  const { data, error } = await sb.rpc("acc_import_ledger_entries", {
    p_source: "wave_ledger",
    p_mode: input.mode,
    p_file_name: input.fileName,
    p_sha256: input.sha256,
    // The function reads snake_case keys. Converting here keeps the domain
    // module in the language the rest of the TypeScript speaks.
    p_entries: input.entries.map((entry) => ({
      date: entry.date,
      lines: entry.lines.map((line) => ({
        account: line.account,
        signed_minor: line.signedMinor,
        description: line.description,
      })),
    })),
  });
  if (error) throw new LedgerImportError(error.message);
  const result = data as { batch_id: string; entries: number; lines: number };
  return { batchId: result.batch_id, entries: result.entries, lines: result.lines };
}

export async function listImportBatches(sb: SupabaseClient): Promise<ImportBatchRow[]> {
  const { data, error } = await sb
    .from("acc_import_batch")
    .select(COLUMNS)
    .order("imported_at", { ascending: false })
    .limit(20);
  if (error) throw new LedgerImportError(error.message);
  return (data ?? []) as unknown as ImportBatchRow[];
}

export async function voidImportBatch(
  sb: SupabaseClient,
  batchId: string,
  reason: string,
): Promise<number> {
  const { data, error } = await sb.rpc("acc_void_import_batch", {
    p_batch_id: batchId,
    p_reason: reason,
  });
  if (error) throw new LedgerImportError(error.message);
  return Number(data ?? 0);
}

export async function linkImportBatchReport(
  sb: SupabaseClient,
  batchId: string,
  reportId: string,
): Promise<void> {
  const { error } = await sb.rpc("acc_link_import_batch_report", {
    p_batch_id: batchId,
    p_report_id: reportId,
  });
  if (error) throw new LedgerImportError(error.message);
}
```

- [ ] **Step 4: Run the tests and watch them pass**

```
cd ctyhp-accounting
npx vitest run tests/unit/ledger-import-service.test.ts
npm run typecheck
```

Expected: PASS, 5 tests, and typecheck clean.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/pit010/QUICKBOOK_WEBAPP
git add ctyhp-accounting/lib/services/ledger-import.ts ctyhp-accounting/tests/unit/ledger-import-service.test.ts
git commit -m "Carry a parsed ledger to the one function that posts it"
```

---

### Task 5: The screen

**Files:**
- Modify: `ctyhp-accounting/app/(app)/settings/import/actions.ts`
- Create: `ctyhp-accounting/app/(app)/settings/import/LedgerImportPanel.tsx`
- Create: `ctyhp-accounting/app/(app)/settings/import/LedgerBatchList.tsx`
- Create: `ctyhp-accounting/app/(app)/settings/import/saveLedgerCopy.ts`
- Modify: `ctyhp-accounting/app/(app)/settings/import/ImportClient.tsx`

**Interfaces:**
- Consumes: `parseCsvGrid`; `parseWaveLedger`, `isWaveLedgerGrid`, `waveLedgerPayload`, `WaveLedgerParse` from Task 1; the service from Task 4; `calculateFileSha256` from `@/lib/client/documents`; from slice 3, `createSavedReportUploadTicketAction` and `registerSavedReportAction` in `app/(app)/reports/saved/actions.ts`, plus `SAVED_REPORT_BUCKET` and `savedReportPreview` are **not** needed here.
- Produces:
  - `importLedgerAction(mode, fileName, sha256, entries): Promise<ActionResult<{ batchId: string; entries: number; lines: number }>>`
  - `listImportBatchesAction(): Promise<ActionResult<ImportBatchRow[]>>`
  - `voidImportBatchAction(batchId, reason): Promise<ActionResult<{ voided: number }>>`
  - `linkImportBatchReportAction(batchId, reportId): Promise<ActionResult>`
  - `LedgerImportPanel` props `{ companyName: string; isSampleCompany: boolean; baseDecimals: number; canManage: boolean }`
  - `saveLedgerCopy(file: File, parse: WaveLedgerParse): Promise<{ ok: boolean; reportId?: string; error?: string }>`
  - `LedgerBatchList` props `{ batches: ImportBatchRow[]; canManage: boolean; onChanged: () => void }`

- [ ] **Step 1: Add the actions**

In `ctyhp-accounting/app/(app)/settings/import/actions.ts`, add these imports at the top alongside the existing ones:

```ts
import {
  importLedgerBatch,
  linkImportBatchReport,
  listImportBatches,
  voidImportBatch,
  type ImportBatchRow,
} from "@/lib/services/ledger-import";
import type { WaveLedgerEntry } from "@/lib/domain/wave-ledger";
```

and append these actions at the end of the file. `guard()` and `ActionResult` already exist in this file — reuse them rather than writing new ones:

`guard` in this file takes the target (`guard("general_ledger")` falls through to
`canWrite`), and `msg` already turns any `Error` into its message. Use both — do
not add a second error helper.

```ts
export async function importLedgerAction(
  mode: "history" | "balances",
  fileName: string,
  sha256: string,
  entries: WaveLedgerEntry[],
): Promise<ActionResult<{ batchId: string; entries: number; lines: number }>> {
  const denied = await guard("general_ledger");
  if (denied) return { ok: false, error: denied };
  try {
    const sb = await createSupabaseServerClient();
    const result = await importLedgerBatch(sb, { mode, fileName, sha256, entries });
    revalidatePath("/reports");
    revalidatePath("/journal");
    return { ok: true, data: result };
  } catch (error) {
    return { ok: false, error: msg(error) };
  }
}

export async function listImportBatchesAction(): Promise<ActionResult<ImportBatchRow[]>> {
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await listImportBatches(sb) };
  } catch (error) {
    return { ok: false, error: msg(error) };
  }
}

export async function voidImportBatchAction(
  batchId: string,
  reason: string,
): Promise<ActionResult<{ voided: number }>> {
  const denied = await guard("general_ledger");
  if (denied) return { ok: false, error: denied };
  try {
    const sb = await createSupabaseServerClient();
    const voided = await voidImportBatch(sb, batchId, reason);
    revalidatePath("/reports");
    revalidatePath("/journal");
    return { ok: true, data: { voided } };
  } catch (error) {
    return { ok: false, error: msg(error) };
  }
}

export async function linkImportBatchReportAction(
  batchId: string,
  reportId: string,
): Promise<ActionResult> {
  const denied = await guard("general_ledger");
  if (denied) return { ok: false, error: denied };
  try {
    const sb = await createSupabaseServerClient();
    await linkImportBatchReport(sb, batchId, reportId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: msg(error) };
  }
}
```

`msg` already covers `LedgerImportError`, so do not import that class here — an
unused import fails lint.

- [ ] **Step 2: Write the past-imports list**

Create `ctyhp-accounting/app/(app)/settings/import/LedgerBatchList.tsx`:

```tsx
"use client";
import { useState } from "react";
import { App, Button, Input, Modal, Table, Tag } from "antd";
import type { ImportBatchRow } from "@/lib/services/ledger-import";
import { voidImportBatchAction } from "./actions";

export interface LedgerBatchListProps {
  batches: ImportBatchRow[];
  canManage: boolean;
  onChanged: () => void;
}

/**
 * What has been imported, and the way back out.
 *
 * Undo is the reason this list exists. Nothing else in One Book can void a
 * plain journal entry, so without it a three-year ledger imported against the
 * wrong chart would have to be unpicked by hand.
 */
export default function LedgerBatchList({ batches, canManage, onChanged }: LedgerBatchListProps) {
  const { message } = App.useApp();
  const [undoing, setUndoing] = useState<ImportBatchRow | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const confirmUndo = async () => {
    if (!undoing) return;
    setBusy(true);
    const result = await voidImportBatchAction(undoing.id, reason);
    setBusy(false);
    if (!result.ok || !result.data) {
      message.error(result.error ?? "Could not undo that import");
      return;
    }
    message.success(`${result.data.voided} entries voided`);
    setUndoing(null);
    setReason("");
    onChanged();
  };

  return (
    <>
      <Table<ImportBatchRow>
        size="small"
        rowKey="id"
        pagination={false}
        dataSource={batches}
        locale={{ emptyText: "No ledger has been imported into this company yet." }}
        columns={[
          { title: "File", dataIndex: "file_name" },
          {
            title: "Mode",
            dataIndex: "mode",
            width: 110,
            render: (mode: string) => (
              <Tag>{mode === "history" ? "Whole history" : "Balances"}</Tag>
            ),
          },
          {
            title: "Covers",
            width: 200,
            render: (_, row) =>
              row.from_date ? `${row.from_date} → ${row.to_date ?? row.from_date}` : "—",
          },
          { title: "Entries", dataIndex: "entry_count", width: 90, align: "right" },
          { title: "Lines", dataIndex: "line_count", width: 90, align: "right" },
          {
            title: "Imported",
            dataIndex: "imported_at",
            width: 120,
            render: (value: string) => value.slice(0, 10),
          },
          {
            title: "",
            width: 120,
            render: (_, row) =>
              row.status === "voided" ? (
                <Tag color="default">undone</Tag>
              ) : canManage ? (
                <Button size="small" danger onClick={() => setUndoing(row)}>
                  Undo
                </Button>
              ) : null,
          },
        ]}
      />

      <Modal
        open={Boolean(undoing)}
        title={`Undo the import of "${undoing?.file_name ?? ""}"?`}
        okText="Undo the import"
        okButtonProps={{ danger: true }}
        confirmLoading={busy}
        onOk={confirmUndo}
        onCancel={() => {
          setUndoing(null);
          setReason("");
        }}
      >
        <p>
          This voids the {undoing?.entry_count ?? 0} entries this import created. Voided entries
          stay in the ledger and drop out of every report, exactly as a voided invoice does. An
          entry dated in a closed period cannot be voided — reverse it instead.
        </p>
        <Input
          placeholder="Imported against the wrong chart of accounts"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </Modal>
    </>
  );
}
```

- [ ] **Step 3: Write the import panel**

Create `ctyhp-accounting/app/(app)/settings/import/LedgerImportPanel.tsx`:

```tsx
"use client";
import { useCallback, useEffect, useState } from "react";
import { Alert, App, Button, Card, DatePicker, Radio, Space, Statistic, Table, Tag, Upload } from "antd";
import { UploadOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { parseCsvGrid } from "@/lib/csv";
import { calculateFileSha256 } from "@/lib/client/documents";
import { fromMinor } from "@/lib/domain/money";
import {
  isWaveLedgerGrid,
  parseWaveLedger,
  waveLedgerPayload,
  type WaveLedgerParse,
} from "@/lib/domain/wave-ledger";
import type { ImportBatchRow } from "@/lib/services/ledger-import";
import {
  importLedgerAction,
  linkImportBatchReportAction,
  listImportBatchesAction,
} from "./actions";
import { saveLedgerCopy } from "./saveLedgerCopy";
import LedgerBatchList from "./LedgerBatchList";

export interface LedgerImportPanelProps {
  companyName: string;
  isSampleCompany: boolean;
  baseDecimals: number;
  canManage: boolean;
}

/**
 * The tab for a general ledger export.
 *
 * There is no column mapping here, and that is the point: a row's meaning comes
 * from the section it sits in, not from a header. The file is read in the
 * browser, checked, and only then sent — once, whole, in one transaction.
 */
export default function LedgerImportPanel({
  companyName,
  isSampleCompany,
  baseDecimals,
  canManage,
}: LedgerImportPanelProps) {
  const { message } = App.useApp();
  const [file, setFile] = useState<File | null>(null);
  const [parse, setParse] = useState<WaveLedgerParse | null>(null);
  const [mode, setMode] = useState<"history" | "balances">("history");
  const [asOf, setAsOf] = useState(dayjs());
  const [busy, setBusy] = useState(false);
  const [batches, setBatches] = useState<ImportBatchRow[]>([]);

  const refresh = useCallback(() => {
    void listImportBatchesAction().then((result) => {
      if (result.ok && result.data) setBatches(result.data);
    });
  }, []);

  useEffect(refresh, [refresh]);

  const money = (minor: number) =>
    fromMinor(minor, baseDecimals).toLocaleString(undefined, {
      minimumFractionDigits: baseDecimals,
    });

  function readFile(candidate: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const grid = parseCsvGrid(String(reader.result));
      if (!isWaveLedgerGrid(grid)) {
        message.error(
          "That does not look like an Account Transactions report. It needs account, date, debit, credit and balance columns.",
        );
        return;
      }
      const result = parseWaveLedger(grid);
      setParse(result);
      setFile(candidate);
      if (result.toDate) setAsOf(dayjs(result.toDate));
      message.info(
        `${result.sections.length} accounts, ${result.entries.length} dates, ${result.lineCount} lines.`,
      );
    };
    reader.readAsText(candidate);
    return false;
  }

  const blocked =
    !parse ||
    parse.unbalancedDates.length > 0 ||
    parse.sectionMismatches.length > 0 ||
    parse.entries.length === 0;

  async function runImport() {
    if (!parse || !file) return;
    setBusy(true);
    try {
      const entries = waveLedgerPayload(parse, mode, asOf.format("YYYY-MM-DD"));
      const sha256 = await calculateFileSha256(file);
      const imported = await importLedgerAction(mode, file.name, sha256, entries);
      if (!imported.ok || !imported.data) {
        throw new Error(imported.error ?? "The import was refused");
      }
      message.success(
        `${imported.data.entries} entries and ${imported.data.lines} lines posted into ${companyName}.`,
      );

      // The ledger is the important half. A failed copy is worth a warning, not
      // an undo of an import that worked.
      const copy = await saveLedgerCopy(file, parse);
      if (copy.ok && copy.reportId) {
        await linkImportBatchReportAction(imported.data.batchId, copy.reportId);
      } else {
        message.warning(`The ledger posted, but the original file was not kept: ${copy.error}`);
      }
      setFile(null);
      setParse(null);
      refresh();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "The import was refused");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Alert
        type="info"
        showIcon
        message="One file, every account"
        description={
          "A general ledger export holds every account already — there is nothing to import " +
          "separately. Each row is one side of a double entry, so One Book groups the rows by " +
          "date and posts one balanced journal entry per date."
        }
      />

      <Upload.Dragger accept=".csv" maxCount={1} beforeUpload={readFile} showUploadList={false}>
        <p>
          <UploadOutlined /> {file ? file.name : "Drop the Account Transactions export here"}
        </p>
      </Upload.Dragger>

      {parse ? (
        <Card size="small">
          <Space size="large" wrap>
            <Statistic title="Accounts" value={parse.sections.length} />
            <Statistic title="Entries" value={parse.entries.length} />
            <Statistic title="Lines" value={parse.lineCount} />
            <Statistic title="Total debits" value={money(parse.totalDebitMinor)} />
            <Statistic
              title="Covers"
              value={parse.fromDate ? `${parse.fromDate} → ${parse.toDate}` : "—"}
            />
          </Space>

          {parse.skippedZeroRows > 0 ? (
            <Alert
              style={{ marginTop: 12 }}
              type="info"
              showIcon
              message={`${parse.skippedZeroRows} row(s) carry no money and will be left out.`}
            />
          ) : null}

          {parse.unbalancedDates.length > 0 ? (
            <Alert
              style={{ marginTop: 12 }}
              type="error"
              showIcon
              message="Some dates do not balance"
              description={
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {parse.unbalancedDates.slice(0, 8).map((day) => (
                    <li key={day.date}>
                      {day.date}: off by {money(day.differenceMinor)}
                    </li>
                  ))}
                </ul>
              }
            />
          ) : null}

          {parse.sectionMismatches.length > 0 ? (
            <Alert
              style={{ marginTop: 12 }}
              type="error"
              showIcon
              message="One Book read this file differently from the file's own totals"
              description={`${parse.sectionMismatches.join(", ")}. Nothing will be imported — send this file to support rather than working around it.`}
            />
          ) : null}

          <Table
            style={{ marginTop: 12 }}
            size="small"
            rowKey="account"
            pagination={false}
            scroll={{ y: 320 }}
            dataSource={parse.sections}
            columns={[
              { title: "Account", dataIndex: "account" },
              { title: "Rows", dataIndex: "rows", width: 80, align: "right" },
              {
                title: "Debit",
                dataIndex: "debitMinor",
                width: 140,
                align: "right",
                render: (value: number) => money(value),
              },
              {
                title: "Credit",
                dataIndex: "creditMinor",
                width: 140,
                align: "right",
                render: (value: number) => money(value),
              },
            ]}
          />
        </Card>
      ) : null}

      {parse ? (
        <Card size="small" title="What to bring across">
          <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            <Radio.Group value={mode} onChange={(event) => setMode(event.target.value)}>
              <Space direction="vertical">
                <Radio value="history">
                  The whole history — {parse.entries.length} entries, {parse.lineCount} lines,
                  dated as the file dates them
                </Radio>
                <Radio value="balances">
                  Closing balances only — one entry, {parse.balances.length} lines
                </Radio>
              </Space>
            </Radio.Group>
            {mode === "balances" ? (
              <Space>
                <span>as of</span>
                <DatePicker value={asOf} onChange={(date) => date && setAsOf(date)} allowClear={false} />
              </Space>
            ) : null}
            {!isSampleCompany ? (
              <Alert
                type="warning"
                showIcon
                message="These are live books"
                description={`Everything posts into ${companyName} in one transaction. It can be undone from the list below, but an entry in a closed period cannot be voided.`}
              />
            ) : null}
            <Button type="primary" loading={busy} disabled={blocked || !canManage} onClick={runImport}>
              Import {mode === "history" ? parse.entries.length : 1} entr
              {mode === "history" && parse.entries.length !== 1 ? "ies" : "y"}
            </Button>
          </Space>
        </Card>
      ) : null}

      <Card size="small" title="Ledgers imported before">
        <LedgerBatchList batches={batches} canManage={canManage} onChanged={refresh} />
      </Card>
    </Space>
  );
}
```

- [ ] **Step 4: Write the saved-copy helper**

Create `ctyhp-accounting/app/(app)/settings/import/saveLedgerCopy.ts`:

```ts
"use client";
import { createSupabaseBrowserClient } from "@/lib/db/client";
import { calculateFileSha256 } from "@/lib/client/documents";
import type { WaveLedgerParse } from "@/lib/domain/wave-ledger";
import {
  createSavedReportUploadTicketAction,
  registerSavedReportAction,
} from "@/app/(app)/reports/saved/actions";

/**
 * Keep the file that was imported, so the ledger can be checked against its
 * source later. Slice 3 already owns every part of this; nothing here is new
 * except the title.
 */
export async function saveLedgerCopy(
  file: File,
  parse: WaveLedgerParse,
): Promise<{ ok: boolean; reportId?: string; error?: string }> {
  try {
    const ticket = await createSavedReportUploadTicketAction("text/csv");
    if (!ticket.ok || !ticket.data) throw new Error(ticket.error ?? "no upload ticket");

    const sb = createSupabaseBrowserClient();
    const upload = await sb.storage
      .from(ticket.data.bucket)
      .uploadToSignedUrl(ticket.data.path, ticket.data.token, file);
    if (upload.error) throw new Error(upload.error.message);

    const registered = await registerSavedReportAction({
      title: `Wave general ledger ${parse.fromDate ?? ""} to ${parse.toDate ?? ""}`.trim(),
      source: "wave",
      period_start: parse.fromDate,
      period_end: parse.toDate,
      notes: `Imported into One Book: ${parse.entries.length} entries, ${parse.lineCount} lines.`,
      file_name: file.name,
      storage_path: ticket.data.path,
      mime_type: "text/csv",
      size_bytes: file.size,
      sha256: await calculateFileSha256(file),
    });
    if (!registered.ok || !registered.data) throw new Error(registered.error ?? "not registered");
    return { ok: true, reportId: registered.data.id };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "unknown error" };
  }
}
```

- [ ] **Step 5: Route the tab**

In `ctyhp-accounting/app/(app)/settings/import/ImportClient.tsx`:

Add `"general_ledger"` to the `TARGETS` array at the top of the file, after
`"transactions"`, and add the import:

```tsx
import LedgerImportPanel from "./LedgerImportPanel";
```

Declare one guard beside the other derived values, next to `const fields = fieldsFor(target);`:

```tsx
  // The ledger tab has no columns to agree on, so none of the three steps apply.
  const ledgerTab = target === "general_ledger";
```

Then make exactly four edits inside the returned JSX:

1. Wrap the `<Steps … />` element: `{ledgerTab ? null : (<Steps … />)}`.
2. Immediately **after** the `<Space wrap>` block holding the `Segmented` and the
   bank picker, insert:

```tsx
      {ledgerTab ? (
        <LedgerImportPanel
          companyName={companyName}
          isSampleCompany={isSampleCompany}
          baseDecimals={baseDecimals}
          canManage
        />
      ) : null}
```

3. Wrap the `<ImportGuidance … />` element and the `<Upload … >` block in
   `{ledgerTab ? null : ( … )}`.
4. Wrap the `<ImportColumnsTable … />` element and the
   `{preview ? <ImportPreviewPanel … /> : null}` block the same way.

Nothing else in the file changes. `canManage` is passed as a literal `true`
because reaching `/settings/import` at all already requires admin or accountant
(`requireSettingsAccess`), and the action and the RPC each check again.

- [ ] **Step 6: Check the types and the line count**

```
cd ctyhp-accounting
npm run typecheck
npx wc -l "app/(app)/settings/import/ImportClient.tsx" "app/(app)/settings/import/LedgerImportPanel.tsx" "app/(app)/settings/import/LedgerBatchList.tsx"
```

Expected: typecheck clean and every file under 400 lines. If `LedgerImportPanel.tsx` is over, move the section table's `columns` array into a `sectionColumns(money)` function in the same file.

- [ ] **Step 7: Commit**

```bash
cd /c/Users/pit010/QUICKBOOK_WEBAPP
git add "ctyhp-accounting/app/(app)/settings/import"
git commit -m "Give the general ledger a tab that reads it whole"
```

---

### Task 6: Gates, the real file, and the honest report

**Files:**
- Modify: `docs/superpowers/plans/2026-08-06-wave-ledger-import.md` (tick the boxes)

- [ ] **Step 1: Run every gate**

```
cd ctyhp-accounting
npm test
npm run typecheck
npm run lint
npm run security:check-source
npm run build
```

Expected: tests pass; typecheck silent; lint 0 errors (the 11 pre-existing warnings in `scripts/verify-*.mjs` are known); the credential check prints nothing; the build completes. Paste the real output. Do not proceed past a failure.

- [ ] **Step 2: Run the parser over the real file, and check it against Wave's own numbers**

The real file lives at the repository root and must not be committed. The domain
modules are TypeScript behind an `@/` alias, so plain `node` cannot import them —
run the check through vitest, which resolves both. Create a temporary
`ctyhp-accounting/tests/unit/zz-realfile.test.ts`:

```ts
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCsvGrid } from "@/lib/csv";
import { parseWaveLedger } from "@/lib/domain/wave-ledger";

describe("the real Wave export", () => {
  it("parses to the numbers Wave itself reports", () => {
    const path = join(
      process.cwd(),
      "..",
      "Pacific Four Nine (2.0) Account Transactions 2026-08-04-18_20 (1).csv",
    );
    const parse = parseWaveLedger(parseCsvGrid(readFileSync(path, "utf8")));
    writeFileSync(
      "realfile.txt",
      JSON.stringify(
        {
          sections: parse.sections.length,
          entries: parse.entries.length,
          lines: parse.lineCount,
          skipped: parse.skippedZeroRows,
          totalDebit: parse.totalDebitMinor,
          unbalanced: parse.unbalancedDates.length,
          mismatches: parse.sectionMismatches,
          from: parse.fromDate,
          to: parse.toDate,
        },
        null,
        2,
      ),
    );
    expect(parse.sections).toHaveLength(26);
    expect(parse.entries).toHaveLength(554);
    expect(parse.lineCount).toBe(2956);
    expect(parse.skippedZeroRows).toBe(198);
    expect(parse.totalDebitMinor).toBe(5_318_290_972);
    expect(parse.unbalancedDates).toEqual([]);
    expect(parse.sectionMismatches).toEqual([]);
  });
});
```

Run it, read `realfile.txt`, then **delete both the test and `realfile.txt`** — the test depends on a file that is not in the repository and would fail for everyone else.

```
cd ctyhp-accounting
npx vitest run tests/unit/zz-realfile.test.ts
cat realfile.txt
rm tests/unit/zz-realfile.test.ts realfile.txt
```

Expected: PASS. A mismatch here means the parser is wrong about the real file even though the fixtures pass — fix the parser and add whatever the real file does to the fixture.

- [ ] **Step 3: Re-run the behavioural harness**

```
cd ctyhp-accounting
npm run verify:ledger-import
```

Expected: all scenarios PASS, then `ROLLBACK`.

- [ ] **Step 4: Smoke the built server**

Start the built server detached from PowerShell — `npm start` dies when launched from the Bash tool, and a wall of `fetch failed` means the server is gone rather than the pages being broken:

```
node --env-file=.env.local scripts/smoke-pages.mjs http://localhost:3000
```

Expected: 56 of 56 pages, including `/settings/import`. Stop the server afterwards.

- [ ] **Step 5: Apply 0102 to every company schema**

```
cd ctyhp-accounting
node --env-file=.env.local scripts/migrate.mjs
```

Expected: `0102_import_ledger_batches.sql` applied to `public`, `co_pc_49`, `co_north_star`, `co_harbor_gems` and `co_cascade_metals`. Then confirm:

```
cd ctyhp-accounting
node --env-file=.env.local -e "const pg=require('pg');(async()=>{const c=new pg.Client({connectionString:process.env.SUPABASE_DB_URL,ssl:{rejectUnauthorized:false}});await c.connect();const r=await c.query(\"select n.nspname, p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname in ('acc_import_ledger_entries','acc_void_import_batch','acc_normalize_ref') order by 1,2\");console.table(r.rows);await c.end();})()"
```

Expected: all three functions in all five schemas, fifteen rows.

- [ ] **Step 6: Tick the plan and commit**

```bash
cd /c/Users/pit010/QUICKBOOK_WEBAPP
git add docs/superpowers/plans/2026-08-06-wave-ledger-import.md
git commit -m "Record the ledger import plan as executed"
```

- [ ] **Step 7: Report to the user, in Vietnamese**

State plainly:

- What the tab does, and the measured numbers from the real file.
- That the whole file posts in **one transaction**, and that an import can be **undone** — but that an entry in a **closed period cannot be voided**, so undo has a window.
- That the history mode posts into past periods, which is what a migration means.
- Which feedback report this closes: `428ca4db`. Resolve it **by hand** in `/settings/feedback`, never from a script — and only after the user agrees the file now has somewhere to go.
- That all four slices of the import work are now done.
