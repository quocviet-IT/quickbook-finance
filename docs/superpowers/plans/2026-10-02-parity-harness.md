# Phase 0 — Parity Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A harness that lets the prototype *Accounting System 2.28* compute its own figures in a headless browser, posts the same entries into a throwaway OneBook company inside one rolled-back transaction, compares every figure to the cent, tags each difference, lists the entries a live copy lacks, and captures every prototype screen — writing all results outside the repository.

**Architecture:** Pure modules in `lib/parity/` (account typing, cents, comparison, drift matching, the HTML report) are unit-tested with invented data. Glue in `tests/parity/` drives Playwright (the prototype) and `pg` (the throwaway company and the read-only data pass), and runs under its own Vitest config so `@/` imports resolve; it is never part of `npm test`. OneBook's figures come from `acc_ledger_balances` and the same pure builders the Reports screen uses.

**Tech Stack:** TypeScript, Vitest 4, Playwright (Chromium), `pg`, Postgres functions already in OneBook.

**Spec:** `docs/superpowers/specs/2026-10-02-parity-harness-design.md`.

## Global Constraints

- Phase 0 changes no figure in OneBook. The only change to application code is extracting `ledgerBalanceFromRow` in `lib/services/reports.ts`, with no behaviour change.
- The throwaway company exists only inside ONE transaction that is rolled back in `finally`, on every path. Never `commit`. The data pass opens `begin read only` and is rolled back.
- No real name, account number or figure enters the repository. The prototype file, the account map and every output stay on the local machine (default output folder `C:/Users/pit010/OneBook-parity-2.28`). Unit tests use invented accounts and amounts ("Example", "Expenses:Rent").
- The console prints counts only — never names, accounts or amounts.
- The script injected into the prototype page is plain ES2017 JavaScript in its own `.js` file, injected with `page.addScriptTag`, and every `page.evaluate` call passes a string — never a TypeScript function (Vitest's transform adds `__name(...)` helpers that do not exist in the page).
- `lib/parity/*.ts` use relative `.ts` imports.
- Stage files by name; never `git add -A`. No Co-Authored-By trailer. Write commit messages with `printf` in Git Bash to `../.superpowers/sdd/commit-msg.txt` (never with PowerShell — it writes a BOM), then `git commit -F ../.superpowers/sdd/commit-msg.txt`.
- Run everything from `ctyhp-accounting/`.
- Never pipe test output through `head`/`tail`; read the pass/fail lines.

## File Structure

| File | Responsibility |
|---|---|
| `lib/services/reports.ts` (modify) | Export `ledgerBalanceFromRow`, used by `getLedgerBalances` and the harness. |
| `tests/unit/ledger-balance-row.test.ts` (new) | Its test. |
| `lib/parity/types.ts` (new) | Shapes shared by the harness: entries, figures, books. |
| `lib/parity/account-types.ts` (new) | `prototypeAccountType(name)` — the prototype's own classes mapped to OneBook types. |
| `lib/parity/cents.ts` (new) | `toCents`, `journalLines`. |
| `lib/parity/compare.ts` (new) | `pairFigures`, `tagDifference`, `compareFigures`. |
| `lib/parity/drift.ts` (new) | `driftKey`, `compareEntries`. |
| `lib/parity/report-html.ts` (new) | `dollars`, `renderParityReport`. |
| `tests/unit/parity-*.test.ts` (new) | One per pure module. |
| `vitest.parity.config.ts` (new) | Runs `tests/parity/**/*.parity.ts` only. |
| `package.json` (modify) | `npm run parity`. |
| `tests/parity/prototype-inpage.js` (new) | Plain JS injected into the prototype: reads books and figures, switches screens. |
| `tests/parity/prototype.ts` (new) | Opens the prototype, reads it, captures screens. |
| `tests/parity/onebook.ts` (new) | Loads a book into a throwaway company; reads OneBook's figures. |
| `tests/parity/drift-live.ts` (new) | Reads a live company's posted entries for the data pass. |
| `tests/parity/prototype-parity.parity.ts` (new) | The harness: puts the parts together and writes the report. |

---

### Task 1: One way to read a ledger-balance row

**Files:**
- Modify: `lib/services/reports.ts` (`getLedgerBalances`, lines 34–51)
- Create: `tests/unit/ledger-balance-row.test.ts`

**Interfaces:**
- Produces: `ledgerBalanceFromRow(r: Record<string, unknown>): LedgerBalance` exported from `@/lib/services/reports`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/ledger-balance-row.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ledgerBalanceFromRow } from "@/lib/services/reports";

describe("ledgerBalanceFromRow", () => {
  it("reads one acc_ledger_balances row the way every report does", () => {
    expect(
      ledgerBalanceFromRow({
        account_id: "a1",
        account_code: "1000",
        name: "Example Bank",
        account_type: "bank",
        debit_base: "12345",
        credit_base: 0,
      }),
    ).toEqual({ accountId: "a1", accountCode: "1000", name: "Example Bank", accountType: "bank", debitBase: 12345, creditBase: 0 });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/unit/ledger-balance-row.test.ts`
Expected: FAIL — `ledgerBalanceFromRow is not a function` (or not exported).

- [ ] **Step 3: Extract the mapping**

In `lib/services/reports.ts`, directly above `export async function getLedgerBalances(`, add:

```ts
/** One row of acc_ledger_balances, as every report reads it. */
export function ledgerBalanceFromRow(r: Record<string, unknown>): LedgerBalance {
  return {
    accountId: r.account_id as string,
    accountCode: r.account_code as string,
    name: r.name as string,
    accountType: r.account_type as LedgerBalance["accountType"],
    debitBase: Number(r.debit_base),
    creditBase: Number(r.credit_base),
  };
}
```

and replace the body's `return data.map((r: Record<string, unknown>) => ({ … }));` (the object literal with the six fields) with:

```ts
  return data.map(ledgerBalanceFromRow);
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `npx vitest run tests/unit/ledger-balance-row.test.ts`
Expected: PASS.
Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add lib/services/reports.ts tests/unit/ledger-balance-row.test.ts
printf 'refactor(reports): one function reads a ledger-balance row\n\nThe parity harness reads balances the way every report does.\n' > ../.superpowers/sdd/commit-msg.txt
git commit -F ../.superpowers/sdd/commit-msg.txt
```

---

### Task 2: Shared shapes, account types and cents

**Files:**
- Create: `lib/parity/types.ts`, `lib/parity/account-types.ts`, `lib/parity/cents.ts`
- Create: `tests/unit/parity-account-types.test.ts`, `tests/unit/parity-cents.test.ts`

**Interfaces:**
- Produces (`lib/parity/types.ts`): `ParityPosting { account: string; cents: number }`; `ParityEntry { id; date; description; ref; closing: boolean; postings: ParityPosting[] }`; `PL_KEYS`/`PlKey`; `BS_KEYS`/`BsKey`; `Totals<K>`; `BookFigures`; `PrototypeBook`.
- Produces (`lib/parity/account-types.ts`): `prototypeAccountType(name: string): AccountType | null`.
- Produces (`lib/parity/cents.ts`): `toCents(dollars: number): number`; `JournalLineInput`; `journalLines(postings, accountIds): { lines: JournalLineInput[] } | { problem: string }`.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/parity-account-types.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { prototypeAccountType } from "@/lib/parity/account-types";

describe("prototypeAccountType", () => {
  it("types assets by the prototype's own classes, long-lived first", () => {
    expect(prototypeAccountType("Assets:FixedAssets:Equipment")).toBe("fixed_asset");
    expect(prototypeAccountType("Assets:AccumulatedDepreciation")).toBe("fixed_asset");
    expect(prototypeAccountType("Assets:Bank:Example-1234")).toBe("bank");
    expect(prototypeAccountType("Assets:PettyCash")).toBe("bank");
    expect(prototypeAccountType("Assets:AccountsReceivable")).toBe("accounts_receivable");
    expect(prototypeAccountType("Assets:Inventory")).toBe("current_asset");
  });
  it("types liabilities: long-term, then credit cards, then accounts payable, then current", () => {
    expect(prototypeAccountType("Liabilities:NotePayable:Example")).toBe("long_term_liability");
    expect(prototypeAccountType("Liabilities:LongTerm:ExampleLoan")).toBe("long_term_liability");
    expect(prototypeAccountType("Liabilities:CreditCard:Example-4321")).toBe("credit_card");
    expect(prototypeAccountType("Liabilities:AccountsPayable")).toBe("accounts_payable");
    expect(prototypeAccountType("Liabilities:SalesTaxPayable")).toBe("current_liability");
    expect(prototypeAccountType("Liabilities:GiftCards")).toBe("current_liability");
  });
  it("splits income and expenses into the prototype's Profit and Loss sections", () => {
    expect(prototypeAccountType("Income:Sales")).toBe("income");
    expect(prototypeAccountType("Income:InterestIncome")).toBe("other_income");
    expect(prototypeAccountType("Income:OtherIncome:Misc")).toBe("other_income");
    expect(prototypeAccountType("Expenses:CostOfGoodsSold:Materials")).toBe("cost_of_goods_sold");
    expect(prototypeAccountType("Expenses:InterestExpense")).toBe("other_expense");
    expect(prototypeAccountType("Expenses:TaxExpense")).toBe("other_expense");
    expect(prototypeAccountType("Expenses:Rent")).toBe("expense");
    expect(prototypeAccountType("Equity:OpeningBalances")).toBe("equity");
  });
  it("refuses a name outside the five roots", () => {
    expect(prototypeAccountType("Misc:Thing")).toBeNull();
  });
});
```

Create `tests/unit/parity-cents.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { journalLines, toCents } from "@/lib/parity/cents";

describe("toCents", () => {
  it("turns the prototype's two-decimal dollars into integer cents, either sign", () => {
    expect(toCents(12.34)).toBe(1234);
    expect(toCents(-12.34)).toBe(-1234);
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents(1234567.89)).toBe(123456789);
    expect(toCents(0)).toBe(0);
    expect(Object.is(toCents(-0), 0)).toBe(true);
  });
});

describe("journalLines", () => {
  const ids = new Map([
    ["Assets:Bank:Example", "a1"],
    ["Expenses:Rent", "a2"],
    ["Income:Sales", "a3"],
  ]);
  it("makes a positive posting a debit and a negative one a credit, dropping zeros", () => {
    expect(
      journalLines(
        [
          { account: "Expenses:Rent", cents: 50000 },
          { account: "Assets:Bank:Example", cents: -50000 },
          { account: "Income:Sales", cents: 0 },
        ],
        ids,
      ),
    ).toEqual({
      lines: [
        { account_id: "a2", debit_minor: 50000, credit_minor: 0, memo: null },
        { account_id: "a1", debit_minor: 0, credit_minor: 50000, memo: null },
      ],
    });
  });
  it("refuses an entry that names an unknown account, has fewer than two lines, or does not balance", () => {
    expect(journalLines([{ account: "Expenses:Unknown", cents: 100 }, { account: "Assets:Bank:Example", cents: -100 }], ids)).toEqual({
      problem: "no account for Expenses:Unknown",
    });
    expect(journalLines([{ account: "Expenses:Rent", cents: 0 }], ids)).toEqual({ problem: "fewer than two non-zero postings" });
    expect(journalLines([{ account: "Expenses:Rent", cents: 100 }, { account: "Assets:Bank:Example", cents: -99 }], ids)).toEqual({
      problem: "does not balance by 1 cent(s)",
    });
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/unit/parity-account-types.test.ts tests/unit/parity-cents.test.ts`
Expected: FAIL — the modules do not resolve.

- [ ] **Step 3: Write the modules**

Create `lib/parity/types.ts`:

```ts
/**
 * The shapes the prototype-parity harness passes between its parts: the
 * prototype's books as read from its own page, and the figures both systems
 * compute from them, in integer cents (debit positive).
 */

/** One posting of a prototype entry: positive is a debit, negative a credit. */
export interface ParityPosting {
  account: string;
  cents: number;
}

export interface ParityEntry {
  id: string;
  date: string;
  description: string;
  ref: string;
  /** The prototype leaves an entry flagged as closing out of every Profit and Loss view. */
  closing: boolean;
  postings: ParityPosting[];
}

export const PL_KEYS = ["income", "cogs", "gross", "opex", "netOperating", "otherIncome", "otherExpenses", "netOther", "net"] as const;
export type PlKey = (typeof PL_KEYS)[number];
export const BS_KEYS = ["assets", "liabilities", "equity", "liabilitiesAndEquity"] as const;
export type BsKey = (typeof BS_KEYS)[number];

/** A total as a report shows it; null when the report does not show that line at all. */
export type Totals<K extends string> = Record<K, number | null>;

export interface BookFigures {
  /** Month end → account → balance in cents. An account at zero may be absent. */
  balances: Record<string, Record<string, number>>;
  /** Fiscal year end → the Trial Balance's total debits and credits. */
  trialBalance: Record<string, { debit: number; credit: number }>;
  /** "from..to" of a fiscal year → Profit and Loss totals. */
  profitAndLoss: Record<string, Totals<PlKey>>;
  /** Fiscal year end → Balance Sheet totals. */
  balanceSheet: Record<string, Totals<BsKey>>;
}

export interface PrototypeBook {
  id: string;
  /** The company's name in the prototype — shown only in the local report. */
  name: string;
  /** Every account in the chart and every account a posting names. */
  accounts: string[];
  /** Every entry, the opening-balances entry included. */
  entries: ParityEntry[];
  monthEnds: string[];
  fiscalYears: { from: string; to: string }[];
  figures: BookFigures;
}
```

Create `lib/parity/account-types.ts`:

```ts
/**
 * The OneBook type a prototype account is posted to, by the prototype's own
 * rules: its Balance Sheet classes (p13 assetClass / liabClass) and its Profit
 * and Loss sections (p4 COGS_RE / OTHER_INCOME / OTHER_EXPENSE), so both
 * systems put each account in the same section. Within each root the first
 * rule wins, in the prototype's own order for assets: long-lived, cash,
 * receivable.
 */
import type { AccountType } from "../domain/accounts.ts";

const LONG_ASSET = /FixedAsset|Equipment|Furniture|Vehicle|Property|Building|Land|Intangible|Goodwill|Depreciation|Amorti/i;
const CASH = /^Assets:(Bank|Cash)|Cash/i;
const RECEIVABLE = /Receivable/i;
const LONG_LIABILITY = /LongTerm|Mortgage|NotePayable|LoansPayable|Debenture|Bond/i;
const CREDIT_CARD = /CreditCard/i;
const ACCOUNTS_PAYABLE = /AccountsPayable/i;
const OTHER_INCOME = /^Income:(InterestIncome|OtherIncome)/;
const COGS = /^Expenses:CostOfGoodsSold/;
const OTHER_EXPENSE = /^Expenses:(InterestExpense|TaxExpense|OtherExpense)/;

export function prototypeAccountType(name: string): AccountType | null {
  switch (name.split(":")[0]) {
    case "Assets":
      if (LONG_ASSET.test(name)) return "fixed_asset";
      if (CASH.test(name)) return "bank";
      if (RECEIVABLE.test(name)) return "accounts_receivable";
      return "current_asset";
    case "Liabilities":
      if (LONG_LIABILITY.test(name)) return "long_term_liability";
      if (CREDIT_CARD.test(name)) return "credit_card";
      if (ACCOUNTS_PAYABLE.test(name)) return "accounts_payable";
      return "current_liability";
    case "Equity":
      return "equity";
    case "Income":
      return OTHER_INCOME.test(name) ? "other_income" : "income";
    case "Expenses":
      if (COGS.test(name)) return "cost_of_goods_sold";
      if (OTHER_EXPENSE.test(name)) return "other_expense";
      return "expense";
    default:
      return null;
  }
}
```

Create `lib/parity/cents.ts`:

```ts
/**
 * Cents, once: the prototype keeps two-decimal floating-point dollars; the
 * harness and OneBook work in integer cents.
 */
import type { ParityPosting } from "./types.ts";

export function toCents(dollars: number): number {
  const cents = Math.round(Math.abs(dollars) * 100 + 1e-6);
  if (cents === 0) return 0;
  return dollars < 0 ? -cents : cents;
}

/** One line of acc_post_manual_journal's p_lines. */
export interface JournalLineInput {
  account_id: string;
  debit_minor: number;
  credit_minor: number;
  memo: string | null;
}

/** A prototype entry's postings as manual-journal lines, or why they cannot be posted. */
export function journalLines(
  postings: readonly ParityPosting[],
  accountIds: ReadonlyMap<string, string>,
): { lines: JournalLineInput[] } | { problem: string } {
  const lines: JournalLineInput[] = [];
  let net = 0;
  for (const posting of postings) {
    if (posting.cents === 0) continue;
    const accountId = accountIds.get(posting.account);
    if (!accountId) return { problem: `no account for ${posting.account}` };
    lines.push({
      account_id: accountId,
      debit_minor: posting.cents > 0 ? posting.cents : 0,
      credit_minor: posting.cents < 0 ? -posting.cents : 0,
      memo: null,
    });
    net += posting.cents;
  }
  if (lines.length < 2) return { problem: "fewer than two non-zero postings" };
  if (net !== 0) return { problem: `does not balance by ${net} cent(s)` };
  return { lines };
}
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `npx vitest run tests/unit/parity-account-types.test.ts tests/unit/parity-cents.test.ts`
Expected: PASS.
Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add lib/parity/types.ts lib/parity/account-types.ts lib/parity/cents.ts tests/unit/parity-account-types.test.ts tests/unit/parity-cents.test.ts
printf 'feat(parity): shapes, the prototype account types, and cents\n\nAccounts are typed by the prototype'"'"'s own Balance Sheet classes and Profit\nand Loss sections; postings become manual-journal lines, or say why not.\n' > ../.superpowers/sdd/commit-msg.txt
git commit -F ../.superpowers/sdd/commit-msg.txt
```

---

### Task 3: Pairing figures and tagging differences

**Files:**
- Create: `lib/parity/compare.ts`
- Create: `tests/unit/parity-compare.test.ts`

**Interfaces:**
- Consumes: `BookFigures`, `PL_KEYS`, `BS_KEYS` from `lib/parity/types.ts` (Task 2).
- Produces: `FigureKind`, `DifferenceTag`, `FigurePair`, `Difference`, `BookContext`, `Comparison`; `pairFigures(prototype: BookFigures, onebook: BookFigures): FigurePair[]`; `tagDifference(pair, diffCents, context): DifferenceTag`; `compareFigures(pairs, context): Comparison`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/parity-compare.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { compareFigures, pairFigures, tagDifference, type FigurePair } from "@/lib/parity/compare";
import type { BookFigures } from "@/lib/parity/types";

const empty = (): BookFigures => ({ balances: {}, trialBalance: {}, profitAndLoss: {}, balanceSheet: {} });
const pl = (over: Partial<BookFigures["profitAndLoss"][string]> = {}) => ({
  income: 100000,
  cogs: 0,
  gross: null,
  opex: 40000,
  netOperating: 60000,
  otherIncome: 0,
  otherExpenses: 0,
  netOther: 0,
  net: 60000,
  ...over,
});
const bs = () => ({ assets: 500000, liabilities: 200000, equity: 300000, liabilitiesAndEquity: 500000 });

describe("pairFigures", () => {
  it("pairs every account either side shows at a month end, an absent one as zero", () => {
    const p = empty();
    const o = empty();
    p.balances["2026-01-31"] = { "Assets:Bank:Example": 1000, "Expenses:Rent": 500 };
    o.balances["2026-01-31"] = { "Assets:Bank:Example": 1000, "Income:Sales": -1500 };
    expect(pairFigures(p, o)).toEqual([
      { kind: "balance", from: null, to: "2026-01-31", key: "Assets:Bank:Example", prototypeCents: 1000, onebookCents: 1000 },
      { kind: "balance", from: null, to: "2026-01-31", key: "Expenses:Rent", prototypeCents: 500, onebookCents: 0 },
      { kind: "balance", from: null, to: "2026-01-31", key: "Income:Sales", prototypeCents: 0, onebookCents: -1500 },
    ]);
  });
  it("pairs the totals of each statement, skipping a line the prototype's report does not show", () => {
    const p = empty();
    const o = empty();
    p.trialBalance["2025-12-31"] = { debit: 900, credit: 900 };
    o.trialBalance["2025-12-31"] = { debit: 900, credit: 901 };
    p.profitAndLoss["2025-01-01..2025-12-31"] = pl();
    o.profitAndLoss["2025-01-01..2025-12-31"] = pl({ gross: 100000 });
    p.balanceSheet["2025-12-31"] = bs();
    o.balanceSheet["2025-12-31"] = bs();
    const pairs = pairFigures(p, o);
    expect(pairs.filter((x) => x.kind === "trial_balance")).toEqual([
      { kind: "trial_balance", from: null, to: "2025-12-31", key: "debit", prototypeCents: 900, onebookCents: 900 },
      { kind: "trial_balance", from: null, to: "2025-12-31", key: "credit", prototypeCents: 900, onebookCents: 901 },
    ]);
    const plPairs = pairs.filter((x) => x.kind === "profit_and_loss");
    expect(plPairs.map((x) => x.key)).not.toContain("gross");
    expect(plPairs).toHaveLength(8);
    expect(plPairs[0]).toMatchObject({ from: "2025-01-01", to: "2025-12-31" });
    expect(pairs.filter((x) => x.kind === "balance_sheet")).toHaveLength(4);
  });
});

describe("tagDifference and compareFigures", () => {
  const pair = (over: Partial<FigurePair>): FigurePair => ({
    kind: "balance",
    from: null,
    to: "2026-03-31",
    key: "Expenses:Rent",
    prototypeCents: 1000,
    onebookCents: 1000,
    ...over,
  });
  const none = { notLoaded: [], closingDates: [] };
  it("counts agreement and tags each difference", () => {
    const result = compareFigures([pair({}), pair({ onebookCents: 1001 }), pair({ key: "Income:Sales", onebookCents: 5000 })], none);
    expect(result.compared).toBe(3);
    expect(result.agreed).toBe(1);
    expect(result.differences.map((d) => [d.key, d.diffCents, d.tag])).toEqual([
      ["Expenses:Rent", 1, "rounding"],
      ["Income:Sales", 4000, "new"],
    ]);
  });
  it("blames entries not loaded only for the accounts and dates they touch", () => {
    const ctx = { notLoaded: [{ date: "2026-02-10", accounts: ["Expenses:Rent", "Assets:Bank:Example"] }], closingDates: [] };
    expect(tagDifference(pair({}), 8000, ctx)).toBe("not loaded");
    expect(tagDifference(pair({ key: "Income:Sales" }), 8000, ctx)).toBe("new");
    expect(tagDifference(pair({ to: "2026-01-31" }), 8000, ctx)).toBe("new");
    expect(tagDifference(pair({ kind: "balance_sheet", key: "assets", to: "2026-12-31" }), 8000, ctx)).toBe("not loaded");
    expect(tagDifference(pair({ kind: "profit_and_loss", key: "net", from: "2025-01-01", to: "2025-12-31" }), 8000, ctx)).toBe("new");
  });
  it("blames a closing entry only in a Profit and Loss whose range holds one", () => {
    const ctx = { notLoaded: [], closingDates: ["2025-12-31"] };
    expect(tagDifference(pair({ kind: "profit_and_loss", key: "net", from: "2025-01-01", to: "2025-12-31" }), 500, ctx)).toBe("closing entry");
    expect(tagDifference(pair({ kind: "profit_and_loss", key: "net", from: "2026-01-01", to: "2026-12-31" }), 500, ctx)).toBe("new");
    expect(tagDifference(pair({ kind: "balance_sheet", key: "equity", to: "2025-12-31" }), 500, ctx)).toBe("new");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/unit/parity-compare.test.ts`
Expected: FAIL — `@/lib/parity/compare` does not resolve.

- [ ] **Step 3: Write the module**

Create `lib/parity/compare.ts`:

```ts
/**
 * Every figure both systems report, paired, compared to the cent, and each
 * difference tagged with the known reason it matches — or "new", which is a
 * finding. First matching reason wins: entries that could not be loaded, then
 * the prototype's closing entries, then a one-cent rounding difference.
 */
import { BS_KEYS, PL_KEYS, type BookFigures } from "./types.ts";

export type FigureKind = "balance" | "trial_balance" | "profit_and_loss" | "balance_sheet";
export type DifferenceTag = "not loaded" | "closing entry" | "rounding" | "new";

export interface FigurePair {
  kind: FigureKind;
  /** Start of the range for a Profit and Loss; null for a figure at a date. */
  from: string | null;
  to: string;
  /** An account name for a balance; the total's key otherwise. */
  key: string;
  prototypeCents: number;
  onebookCents: number;
}

export interface Difference extends FigurePair {
  /** OneBook minus the prototype. */
  diffCents: number;
  tag: DifferenceTag;
}

export interface BookContext {
  /** Entries that could not be loaded into OneBook: their dates and the accounts they touch. */
  notLoaded: readonly { date: string; accounts: readonly string[] }[];
  /** Dates of the prototype's entries flagged as closing. */
  closingDates: readonly string[];
}

export interface Comparison {
  compared: number;
  agreed: number;
  differences: Difference[];
}

/** Every figure the two systems both report, paired. A line the prototype's report does not show is not compared. */
export function pairFigures(prototype: BookFigures, onebook: BookFigures): FigurePair[] {
  const pairs: FigurePair[] = [];
  for (const to of Object.keys(prototype.balances).sort()) {
    const p = prototype.balances[to] ?? {};
    const o = onebook.balances[to] ?? {};
    const accounts = [...new Set([...Object.keys(p), ...Object.keys(o)])].sort();
    for (const key of accounts) {
      pairs.push({ kind: "balance", from: null, to, key, prototypeCents: p[key] ?? 0, onebookCents: o[key] ?? 0 });
    }
  }
  for (const to of Object.keys(prototype.trialBalance).sort()) {
    const p = prototype.trialBalance[to];
    const o = onebook.trialBalance[to] ?? { debit: 0, credit: 0 };
    pairs.push({ kind: "trial_balance", from: null, to, key: "debit", prototypeCents: p.debit, onebookCents: o.debit });
    pairs.push({ kind: "trial_balance", from: null, to, key: "credit", prototypeCents: p.credit, onebookCents: o.credit });
  }
  for (const range of Object.keys(prototype.profitAndLoss).sort()) {
    const [from, to] = range.split("..");
    const p = prototype.profitAndLoss[range];
    const o = onebook.profitAndLoss[range];
    for (const key of PL_KEYS) {
      const value = p[key];
      if (value === null) continue;
      pairs.push({ kind: "profit_and_loss", from, to, key, prototypeCents: value, onebookCents: o?.[key] ?? 0 });
    }
  }
  for (const to of Object.keys(prototype.balanceSheet).sort()) {
    const p = prototype.balanceSheet[to];
    const o = onebook.balanceSheet[to];
    for (const key of BS_KEYS) {
      const value = p[key];
      if (value === null) continue;
      pairs.push({ kind: "balance_sheet", from: null, to, key, prototypeCents: value, onebookCents: o?.[key] ?? 0 });
    }
  }
  return pairs;
}

const inRange = (date: string, from: string | null, to: string) => (from === null || date >= from) && date <= to;

/** Why a figure differs, by the known rules; first match wins. */
export function tagDifference(pair: FigurePair, diffCents: number, context: BookContext): DifferenceTag {
  const unloaded = context.notLoaded.filter((entry) => inRange(entry.date, pair.from, pair.to));
  const touched = pair.kind === "balance" ? unloaded.some((entry) => entry.accounts.includes(pair.key)) : unloaded.length > 0;
  if (touched) return "not loaded";
  if (pair.kind === "profit_and_loss" && context.closingDates.some((date) => inRange(date, pair.from, pair.to))) {
    return "closing entry";
  }
  if (Math.abs(diffCents) === 1) return "rounding";
  return "new";
}

export function compareFigures(pairs: readonly FigurePair[], context: BookContext): Comparison {
  const differences: Difference[] = [];
  for (const pair of pairs) {
    const diffCents = pair.onebookCents - pair.prototypeCents;
    if (diffCents !== 0) differences.push({ ...pair, diffCents, tag: tagDifference(pair, diffCents, context) });
  }
  return { compared: pairs.length, agreed: pairs.length - differences.length, differences };
}
```

- [ ] **Step 4: Run the test and the typecheck**

Run: `npx vitest run tests/unit/parity-compare.test.ts`
Expected: PASS.
Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add lib/parity/compare.ts tests/unit/parity-compare.test.ts
printf 'feat(parity): pair every figure and tag each difference\n\nNot loaded, closing entry, one-cent rounding, or new.\n' > ../.superpowers/sdd/commit-msg.txt
git commit -F ../.superpowers/sdd/commit-msg.txt
```

---

### Task 4: Matching two copies of the books

**Files:**
- Create: `lib/parity/drift.ts`
- Create: `tests/unit/parity-drift.test.ts`

**Interfaces:**
- Produces: `DriftEntry { id; date; amounts: number[]; accounts: string[] | null; label: string }`; `DriftResult { matched; onlyPrototype; onlyOnebook; accountsDiffer: { prototype; onebook }[] }`; `driftKey(entry): string`; `compareEntries(prototype, onebook): DriftResult`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/parity-drift.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { compareEntries, driftKey, type DriftEntry } from "@/lib/parity/drift";

const entry = (id: string, date: string, amounts: number[], accounts: string[] | null = null): DriftEntry => ({
  id,
  date,
  amounts,
  accounts,
  label: `Entry ${id}`,
});

describe("driftKey", () => {
  it("is the date and the sorted non-zero amounts", () => {
    expect(driftKey(entry("1", "2026-01-05", [500, -500, 0]))).toBe("2026-01-05|-500,500");
  });
});

describe("compareEntries", () => {
  it("matches entries by date and amounts, and lists what only one side has", () => {
    const result = compareEntries(
      [entry("p1", "2026-01-05", [500, -500]), entry("p2", "2026-01-06", [700, -700])],
      [entry("o1", "2026-01-05", [-500, 500]), entry("o2", "2026-01-07", [700, -700])],
    );
    expect(result.matched).toBe(1);
    expect(result.onlyPrototype.map((e) => e.id)).toEqual(["p2"]);
    expect(result.onlyOnebook.map((e) => e.id)).toEqual(["o2"]);
    expect(result.accountsDiffer).toEqual([]);
  });
  it("counts duplicates rather than remembering them", () => {
    const twice = [entry("p1", "2026-01-05", [500, -500]), entry("p2", "2026-01-05", [500, -500])];
    const result = compareEntries(twice, [entry("o1", "2026-01-05", [500, -500])]);
    expect(result.matched).toBe(1);
    expect(result.onlyPrototype.map((e) => e.id)).toEqual(["p2"]);
  });
  it("matches same accounts first, then reports matching amounts on other accounts apart", () => {
    const result = compareEntries(
      [entry("p1", "2026-01-05", [500, -500], ["6100", "1000"]), entry("p2", "2026-01-05", [500, -500], ["6200", "1000"])],
      [entry("o1", "2026-01-05", [500, -500], ["6200", "1000"]), entry("o2", "2026-01-05", [500, -500], ["6300", "1000"])],
    );
    expect(result.matched).toBe(1);
    expect(result.accountsDiffer.map((d) => [d.prototype.id, d.onebook.id])).toEqual([["p1", "o2"]]);
    expect(result.onlyPrototype).toEqual([]);
    expect(result.onlyOnebook).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/unit/parity-drift.test.ts`
Expected: FAIL — `@/lib/parity/drift` does not resolve.

- [ ] **Step 3: Write the module**

Create `lib/parity/drift.ts`:

```ts
/**
 * Matching two copies of the same books entry by entry: the prototype's newest
 * copy against the one OneBook holds. Entries are matched by date and the
 * sorted list of their posting amounts. When both sides know each posting's
 * account, an entry with the same accounts is matched first; one whose amounts
 * match but whose accounts differ is reported apart. Duplicates are counted,
 * never remembered.
 */
export interface DriftEntry {
  id: string;
  date: string;
  /** Signed cents per posting (debit positive). */
  amounts: number[];
  /** The account of each posting, in the order of `amounts`, when known. */
  accounts: string[] | null;
  /** What the report shows for the entry. */
  label: string;
}

export interface DriftResult {
  matched: number;
  onlyPrototype: DriftEntry[];
  onlyOnebook: DriftEntry[];
  accountsDiffer: { prototype: DriftEntry; onebook: DriftEntry }[];
}

export function driftKey(entry: Pick<DriftEntry, "date" | "amounts">): string {
  const amounts = entry.amounts.filter((amount) => amount !== 0).sort((a, b) => a - b);
  return `${entry.date}|${amounts.join(",")}`;
}

function postingsKey(entry: DriftEntry): string | null {
  if (entry.accounts === null) return null;
  const accounts = entry.accounts;
  return entry.amounts
    .map((amount, i) => ({ amount, account: accounts[i] }))
    .filter((posting) => posting.amount !== 0)
    .map((posting) => `${posting.account}|${posting.amount}`)
    .sort()
    .join(";");
}

function push(pool: Map<string, DriftEntry[]>, key: string, entry: DriftEntry): void {
  const list = pool.get(key);
  if (list) list.push(entry);
  else pool.set(key, [entry]);
}

export function compareEntries(prototype: readonly DriftEntry[], onebook: readonly DriftEntry[]): DriftResult {
  const result: DriftResult = { matched: 0, onlyPrototype: [], onlyOnebook: [], accountsDiffer: [] };
  const exactKey = (entry: DriftEntry) => `${driftKey(entry)}#${postingsKey(entry) ?? ""}`;

  // First: the same date, amounts and accounts.
  const exact = new Map<string, DriftEntry[]>();
  for (const entry of onebook) push(exact, exactKey(entry), entry);
  const unmatched: DriftEntry[] = [];
  for (const entry of prototype) {
    if (exact.get(exactKey(entry))?.shift()) result.matched += 1;
    else unmatched.push(entry);
  }

  // Then: the same date and amounts, other accounts.
  const leftovers = new Map<string, DriftEntry[]>();
  for (const list of exact.values()) for (const entry of list) push(leftovers, driftKey(entry), entry);
  for (const entry of unmatched) {
    const other = leftovers.get(driftKey(entry))?.shift();
    if (!other) result.onlyPrototype.push(entry);
    else if (postingsKey(entry) !== null && postingsKey(other) !== null) result.accountsDiffer.push({ prototype: entry, onebook: other });
    else result.matched += 1;
  }
  for (const list of leftovers.values()) result.onlyOnebook.push(...list);
  result.onlyOnebook.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  return result;
}
```

- [ ] **Step 4: Run the test and the typecheck**

Run: `npx vitest run tests/unit/parity-drift.test.ts`
Expected: PASS.
Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add lib/parity/drift.ts tests/unit/parity-drift.test.ts
printf 'feat(parity): match two copies of the books entry by entry\n\nBy date and amounts, same accounts first; duplicates counted.\n' > ../.superpowers/sdd/commit-msg.txt
git commit -F ../.superpowers/sdd/commit-msg.txt
```

---

### Task 5: The report

**Files:**
- Create: `lib/parity/report-html.ts`
- Create: `tests/unit/parity-report-html.test.ts`

**Interfaces:**
- Consumes: `Comparison`, `Difference`, `DifferenceTag` (Task 3); `DriftEntry`, `DriftResult` (Task 4).
- Produces: `BookReport`, `ShotRecord`, `ParityReport`; `dollars(cents: number): string`; `renderParityReport(report: ParityReport): string`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/parity-report-html.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { dollars, renderParityReport, type ParityReport } from "@/lib/parity/report-html";

const report = (over: Partial<ParityReport> = {}): ParityReport => ({
  generatedAt: "2026-10-02T10:00:00.000Z",
  prototypeFile: "C:/local/accounting-system.html",
  books: [
    {
      name: "Example <Co>",
      accounts: 3,
      entries: 10,
      loaded: 9,
      notLoaded: [{ id: "t9", date: "2026-01-05", problem: "does not balance by 1 cent(s)" }],
      months: 2,
      fiscalYears: 1,
      comparison: {
        compared: 4,
        agreed: 2,
        differences: [
          { kind: "balance", from: null, to: "2026-01-31", key: "Expenses:Rent", prototypeCents: 1000, onebookCents: 1001, diffCents: 1, tag: "rounding" },
          { kind: "profit_and_loss", from: "2026-01-01", to: "2026-12-31", key: "net", prototypeCents: -250, onebookCents: 125075, diffCents: 125325, tag: "new" },
        ],
      },
    },
  ],
  drift: null,
  shots: [],
  ...over,
});

describe("dollars", () => {
  it("prints cents as signed dollars with thousands separators", () => {
    expect(dollars(123456789)).toBe("1,234,567.89");
    expect(dollars(-250)).toBe("-2.50");
    expect(dollars(5)).toBe("0.05");
  });
});

describe("renderParityReport", () => {
  it("escapes every name and shows each difference with its tag", () => {
    const html = renderParityReport(report());
    expect(html).toContain("Example &lt;Co&gt;");
    expect(html).not.toContain("Example <Co>");
    expect(html).toContain("rounding");
    expect(html).toContain("1,250.75");
    expect(html).toContain("does not balance by 1 cent(s)");
    expect(html).not.toContain("Data pass");
  });
  it("lists the data pass when there is one", () => {
    const html = renderParityReport(
      report({
        drift: {
          schema: "co_example",
          book: "Example",
          result: {
            matched: 5,
            onlyPrototype: [{ id: "p1", date: "2026-01-05", amounts: [500, -500], accounts: null, label: "Rent <January>" }],
            onlyOnebook: [],
            accountsDiffer: [],
          },
        },
      }),
    );
    expect(html).toContain("Data pass");
    expect(html).toContain("Rent &lt;January&gt;");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/unit/parity-report-html.test.ts`
Expected: FAIL — `@/lib/parity/report-html` does not resolve.

- [ ] **Step 3: Write the module**

Create `lib/parity/report-html.ts`:

```ts
/**
 * The parity report: one self-contained HTML page, kept on the local machine
 * (it names real accounts). Every text is escaped; every figure is in dollars;
 * a difference is OneBook minus the prototype.
 */
import type { Comparison, Difference, DifferenceTag } from "./compare.ts";
import type { DriftEntry, DriftResult } from "./drift.ts";

export interface BookReport {
  name: string;
  accounts: number;
  entries: number;
  loaded: number;
  notLoaded: { id: string; date: string; problem: string }[];
  months: number;
  fiscalYears: number;
  comparison: Comparison;
}

export interface ShotRecord {
  book: string;
  name: string;
  theme: "light" | "dark";
  /** Relative to the report, e.g. "shots/book1-light-tab-today.png"; empty when the capture failed. */
  file: string;
  error: string | null;
}

export interface ParityReport {
  generatedAt: string;
  prototypeFile: string;
  books: BookReport[];
  drift: { schema: string; book: string; result: DriftResult } | null;
  shots: ShotRecord[];
}

const TAG_ORDER: DifferenceTag[] = ["new", "not loaded", "closing entry", "rounding"];
const KIND_LABEL: Record<Difference["kind"], string> = {
  balance: "Account balance",
  trial_balance: "Trial Balance",
  profit_and_loss: "Profit and Loss",
  balance_sheet: "Balance Sheet",
};
const MAX_DIFFERENCES = 2000;
const MAX_DRIFT = 500;

const esc = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function dollars(cents: number): string {
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toLocaleString("en-US");
  return `${cents < 0 ? "-" : ""}${whole}.${String(abs % 100).padStart(2, "0")}`;
}

const period = (d: Difference) => (d.from ? `${d.from} → ${d.to}` : d.to);
const count = (differences: readonly Difference[], tag: DifferenceTag) => differences.filter((d) => d.tag === tag).length;

function summary(books: readonly BookReport[]): string {
  const rows = books
    .map(
      (b) =>
        `<tr><td>${esc(b.name)}</td><td class="r">${b.loaded} of ${b.entries}</td><td class="r">${b.months}</td>` +
        `<td class="r">${b.fiscalYears}</td><td class="r">${b.comparison.compared}</td><td class="r">${b.comparison.agreed}</td>` +
        TAG_ORDER.map((tag) => `<td class="r">${count(b.comparison.differences, tag)}</td>`).join("") +
        "</tr>",
    )
    .join("");
  return (
    `<h2>Summary</h2><table><thead><tr><th>Book</th><th>Entries loaded</th><th>Month ends</th><th>Fiscal years</th>` +
    `<th>Figures compared</th><th>Agree</th>${TAG_ORDER.map((t) => `<th>${esc(t)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>`
  );
}

function bookSection(book: BookReport): string {
  const sorted = [...book.comparison.differences].sort(
    (a, b) =>
      TAG_ORDER.indexOf(a.tag) - TAG_ORDER.indexOf(b.tag) ||
      a.kind.localeCompare(b.kind) ||
      a.to.localeCompare(b.to) ||
      a.key.localeCompare(b.key),
  );
  const shown = sorted.slice(0, MAX_DIFFERENCES);
  const rows = shown
    .map(
      (d) =>
        `<tr class="tag-${d.tag.replace(/\s+/g, "-")}"><td>${esc(d.tag)}</td><td>${esc(KIND_LABEL[d.kind])}</td><td>${esc(period(d))}</td>` +
        `<td>${esc(d.key)}</td><td class="r">${dollars(d.prototypeCents)}</td><td class="r">${dollars(d.onebookCents)}</td>` +
        `<td class="r">${dollars(d.diffCents)}</td></tr>`,
    )
    .join("");
  const more = sorted.length > shown.length ? `<p class="note">${sorted.length - shown.length} more not shown; see parity-result.json.</p>` : "";
  const notLoaded = book.notLoaded.length
    ? `<h3>Entries not loaded (${book.notLoaded.length})</h3><table><thead><tr><th>Entry</th><th>Date</th><th>Why</th></tr></thead><tbody>` +
      book.notLoaded.map((e) => `<tr><td>${esc(e.id)}</td><td>${esc(e.date)}</td><td>${esc(e.problem)}</td></tr>`).join("") +
      "</tbody></table>"
    : "";
  const differences = book.comparison.differences.length
    ? `<table><thead><tr><th>Tag</th><th>Figure</th><th>Period</th><th>Account or total</th><th>Prototype</th><th>OneBook</th><th>Difference</th></tr></thead><tbody>${rows}</tbody></table>${more}`
    : `<p class="ok">Every figure agrees.</p>`;
  return `<h2>${esc(book.name)}</h2>${differences}${notLoaded}`;
}

function driftList(title: string, entries: readonly DriftEntry[]): string {
  if (!entries.length) return "";
  const shown = entries.slice(0, MAX_DRIFT);
  const rows = shown
    .map((e) => `<tr><td>${esc(e.date)}</td><td>${esc(e.label)}</td><td class="r">${e.amounts.map(dollars).join(" / ")}</td></tr>`)
    .join("");
  const more = entries.length > shown.length ? `<p class="note">${entries.length - shown.length} more not shown.</p>` : "";
  return `<h3>${esc(title)} (${entries.length})</h3><table><thead><tr><th>Date</th><th>Description</th><th>Amounts</th></tr></thead><tbody>${rows}</tbody></table>${more}`;
}

function driftSection(drift: NonNullable<ParityReport["drift"]>): string {
  const r = drift.result;
  const differ = r.accountsDiffer.length
    ? `<h3>Same amounts, other accounts (${r.accountsDiffer.length})</h3><table><thead><tr><th>Date</th><th>Description</th><th>Prototype accounts</th><th>OneBook accounts</th></tr></thead><tbody>` +
      r.accountsDiffer
        .slice(0, MAX_DRIFT)
        .map(
          (d) =>
            `<tr><td>${esc(d.prototype.date)}</td><td>${esc(d.prototype.label)}</td><td>${esc((d.prototype.accounts ?? []).join(", "))}</td><td>${esc((d.onebook.accounts ?? []).join(", "))}</td></tr>`,
        )
        .join("") +
      "</tbody></table>"
    : "";
  return (
    `<h2>Data pass — ${esc(drift.book)} against ${esc(drift.schema)}</h2>` +
    `<p>${r.matched} entries match; ${r.onlyPrototype.length} are only in the prototype; ${r.onlyOnebook.length} are only in OneBook; ${r.accountsDiffer.length} have the same amounts on other accounts.</p>` +
    driftList("Only in the prototype", r.onlyPrototype) +
    driftList("Only in OneBook", r.onlyOnebook) +
    differ
  );
}

function shotsSection(shots: readonly ShotRecord[]): string {
  const rows = shots
    .map(
      (s) =>
        `<tr><td>${esc(s.book)}</td><td>${esc(s.name)}</td><td>${esc(s.theme)}</td><td>${
          s.file ? `<a href="${esc(s.file)}">${esc(s.file)}</a>` : `<span class="bad">${esc(s.error ?? "failed")}</span>`
        }</td></tr>`,
    )
    .join("");
  return `<h2>Prototype screens (${shots.length})</h2><table><thead><tr><th>Book</th><th>Screen</th><th>Theme</th><th>File</th></tr></thead><tbody>${rows}</tbody></table>`;
}

const CSS =
  ":root{--bg:#f6f7f8;--fg:#14202b;--muted:#4b5a67;--card:#ffffff;--line:#d9e0e6;--bad:#a4262c;--ok:#1d6b3a}" +
  "@media (prefers-color-scheme: dark){:root{--bg:#0e141a;--fg:#e4eaef;--muted:#a9b6c1;--card:#151d25;--line:#2a3743;--bad:#ff8a8a;--ok:#7bd69a}}" +
  "body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif}" +
  "main{max-width:1400px;margin:0 auto;padding:24px 16px 48px}h1{font-size:22px;margin:0 0 4px}h2{margin:28px 0 8px;font-size:18px}" +
  ".lede,.note{color:var(--muted)}table{width:100%;border-collapse:collapse;background:var(--card);margin:8px 0}" +
  "th,td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}td.r,th.r{text-align:right;font-variant-numeric:tabular-nums}" +
  ".tag-new td:first-child{color:var(--bad);font-weight:600}.ok{color:var(--ok);font-weight:600}.bad{color:var(--bad)}a{color:inherit}";

export function renderParityReport(report: ParityReport): string {
  const body =
    `<h1>Prototype parity</h1><p class="lede">Generated ${esc(report.generatedAt)} from ${esc(report.prototypeFile)}. ` +
    `Figures in dollars; a difference is OneBook minus the prototype. Tags: <strong>new</strong> is a finding; ` +
    `<strong>not loaded</strong>, <strong>closing entry</strong> and <strong>rounding</strong> match a known reason.</p>` +
    summary(report.books) +
    report.books.map(bookSection).join("") +
    (report.drift ? driftSection(report.drift) : "") +
    (report.shots.length ? shotsSection(report.shots) : "");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Prototype parity</title><style>${CSS}</style></head><body><main>${body}</main></body></html>`;
}
```

- [ ] **Step 4: Run the test and the typecheck**

Run: `npx vitest run tests/unit/parity-report-html.test.ts`
Expected: PASS.
Run: `npm run typecheck && npm run lint`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add lib/parity/report-html.ts tests/unit/parity-report-html.test.ts
printf 'feat(parity): the parity report page\n\nSummary per book, every difference by tag, entries not loaded, the data\npass and the screenshots; all text escaped.\n' > ../.superpowers/sdd/commit-msg.txt
git commit -F ../.superpowers/sdd/commit-msg.txt
```

---

### Task 6: Reading the prototype, and its screens

**Files:**
- Create: `vitest.parity.config.ts`
- Modify: `package.json` (scripts: add `"parity"` after `"test:watch"`)
- Create: `tests/parity/prototype-inpage.js`
- Create: `tests/parity/prototype.ts`
- Create: `tests/parity/prototype-parity.parity.ts` (first version: the prototype half)

**Interfaces:**
- Consumes: `PrototypeBook` (Task 2); `ShotRecord` (Task 5).
- Produces: `openPrototype(browser, htmlPath): Promise<Page>`; `readPrototype(page): Promise<PrototypeBook[]>`; `captureScreens(page, outDir): Promise<ShotRecord[]>`; `npm run parity`.

- [ ] **Step 1: The config and the script**

Create `vitest.parity.config.ts`:

```ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * The prototype-parity harness (tests/parity). Never part of `npm test`: it
 * needs the prototype's file on this machine, a browser and the database, and
 * takes minutes. Run with `npm run parity` (see docs/superpowers/plans/2026-10-02-parity-harness.md).
 */
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      // Supplied by the Next.js bundler; unresolvable in a plain vitest run.
      "server-only": fileURLToPath(new URL("./tests/e2e/support/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/parity/**/*.parity.ts"],
    fileParallelism: false,
    testTimeout: 3_600_000,
    hookTimeout: 120_000,
  },
});
```

In `package.json`, directly after the line `"test:watch": "vitest",` add:

```json
    "parity": "node --env-file=.env.local ./node_modules/vitest/vitest.mjs run --config vitest.parity.config.ts",
```

- [ ] **Step 2: The script that runs inside the prototype**

Create `tests/parity/prototype-inpage.js` with the Write tool (it contains regular expressions; never through a bash heredoc):

```js
/* eslint-disable */
/* Injected into the prototype's own page after it has booted (see prototype.ts).
   Reads each book and the figures the prototype itself computes — its own
   balancesFor/view and its own rendered reports — in integer cents, and puts
   the active book back as it was. It changes no book. Plain ES2017 on
   purpose: it is injected as a script, never bundled. Its free names (DB, S,
   UI, useBook, allTxns, view, balancesFor, fyStartMonth, reportPL, reportBS,
   reportTB, render, TABS, REPORTS) are the prototype's globals. */
(function () {
  "use strict";

  function cents(v) {
    var x = Number(v) || 0;
    var n = Math.round(Math.abs(x) * 100 + 1e-6);
    return x < 0 && n !== 0 ? -n : n;
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function monthEnd(y, m) {
    return y + "-" + pad(m) + "-" + pad(new Date(Date.UTC(y, m, 0)).getUTCDate());
  }
  function monthEndsBetween(first, last) {
    var out = [];
    var y = +first.slice(0, 4), m = +first.slice(5, 7);
    var ly = +last.slice(0, 4), lm = +last.slice(5, 7);
    while (y < ly || (y === ly && m <= lm)) {
      out.push(monthEnd(y, m));
      m += 1;
      if (m > 12) { m = 1; y += 1; }
    }
    return out;
  }
  function fiscalYearsBetween(first, last, startMonth) {
    var y = +first.slice(0, 4);
    if (+first.slice(5, 7) < startMonth) y -= 1;
    var out = [];
    for (;;) {
      var from = y + "-" + pad(startMonth) + "-01";
      if (from > last) break;
      var endY = startMonth === 1 ? y : y + 1;
      var endM = startMonth === 1 ? 12 : startMonth - 1;
      out.push({ from: from, to: monthEnd(endY, endM) });
      y += 1;
    }
    return out;
  }
  function labelOf(cell) {
    var copy = cell.cloneNode(true);
    var subs = copy.querySelectorAll(".pct-sub");
    for (var i = 0; i < subs.length; i++) subs[i].parentNode.removeChild(subs[i]);
    return copy.textContent.replace(/\s+/g, " ").trim();
  }
  var AMOUNT = /^\(?[0-9,]+\.[0-9]{2}\)?$/;
  function amountOf(text) {
    var n = Math.round(parseFloat(text.replace(/[(),]/g, "")) * 100);
    return text.charAt(0) === "(" ? -n : n;
  }
  /* Label → the figures on that row, for every row of a rendered report. */
  function rowsOf(html) {
    var box = document.createElement("div");
    box.innerHTML = html;
    var out = {};
    var rows = box.querySelectorAll("tr");
    for (var r = 0; r < rows.length; r++) {
      var cells = rows[r].querySelectorAll("td");
      if (cells.length < 2) continue;
      var label = labelOf(cells[0]);
      var values = [];
      for (var c = 1; c < cells.length; c++) {
        var t = cells[c].textContent.replace(/\s+/g, "");
        if (AMOUNT.test(t)) values.push(amountOf(t));
      }
      if (values.length && !(label in out)) out[label] = values;
    }
    return out;
  }
  function first(rows, label) { return rows[label] ? rows[label][0] : null; }
  function orZero(v) { return v === null ? 0 : v; }

  function readBook(book) {
    useBook(book.id);
    UI.basis = "accrual";
    UI.compare = "none";
    UI.showPct = false;
    var all = allTxns();
    var names = {};
    (S.accounts || []).forEach(function (a) { names[a.name] = 1; });
    var entries = all.map(function (t) {
      return {
        id: String(t.id),
        date: t.date,
        description: String(t.payee || t.narration || ""),
        ref: String(t.ref || ""),
        closing: !!t.closing,
        postings: (t.postings || []).map(function (p) {
          names[p.account] = 1;
          return { account: p.account, cents: cents(p.amount) };
        })
      };
    });
    var dates = all.map(function (t) { return t.date; }).sort();
    var figures = { balances: {}, trialBalance: {}, profitAndLoss: {}, balanceSheet: {} };
    var monthEnds = dates.length ? monthEndsBetween(dates[0], dates[dates.length - 1]) : [];
    monthEnds.forEach(function (d) {
      var o = {};
      balancesFor(view("", d)).forEach(function (v, k) {
        var c = cents(v);
        if (c !== 0) o[k] = c;
      });
      figures.balances[d] = o;
    });
    var years = dates.length ? fiscalYearsBetween(dates[0], dates[dates.length - 1], fyStartMonth()) : [];
    years.forEach(function (y) {
      UI.from = y.from;
      UI.to = y.to;
      var pl = rowsOf(reportPL());
      figures.profitAndLoss[y.from + ".." + y.to] = {
        income: orZero(first(pl, "Total Income")),
        cogs: orZero(first(pl, "Total Cost of Goods Sold")),
        gross: first(pl, "Gross Profit"),
        opex: orZero(first(pl, "Total Expenses")),
        netOperating: first(pl, "Net Operating Income"),
        otherIncome: orZero(first(pl, "Total Other Income")),
        otherExpenses: orZero(first(pl, "Total Other Expenses")),
        netOther: orZero(first(pl, "Net Other Income")),
        net: first(pl, "Net Income")
      };
      var bs = rowsOf(reportBS());
      figures.balanceSheet[y.to] = {
        assets: first(bs, "Total Assets"),
        liabilities: first(bs, "Total Liabilities"),
        equity: first(bs, "Total Equity"),
        liabilitiesAndEquity: first(bs, "Total Liabilities and Equity")
      };
      var total = rowsOf(reportTB())["Total"] || [0, 0];
      figures.trialBalance[y.to] = { debit: total[0] || 0, credit: total[1] || 0 };
    });
    return {
      id: String(book.id),
      name: String((book.company && book.company.name) || "Book"),
      accounts: Object.keys(names).sort(),
      entries: entries,
      monthEnds: monthEnds,
      fiscalYears: years,
      figures: figures
    };
  }

  function bookById(id) {
    var book = DB.books.filter(function (b) { return String(b.id) === id; })[0];
    if (!book) throw new Error("no such book");
    return book;
  }

  window.__parity = {
    read: function () {
      var before = DB.activeId;
      try { return DB.books.map(readBook); }
      finally { useBook(before); }
    },
    books: function () {
      return DB.books.map(function (b) {
        return { id: String(b.id), name: String((b.company && b.company.name) || "Book") };
      });
    },
    tabs: function () { return TABS.map(function (t) { return { key: t.k, name: t.n }; }); },
    reports: function () { return REPORTS.map(function (r) { return { key: r.k, name: r.n }; }); },
    show: function (bookId, tab, report, theme) {
      useBook(bookById(bookId).id);
      document.documentElement.setAttribute("data-theme", theme);
      UI.tab = tab;
      if (report) UI.report = report;
      render();
      window.scrollTo(0, 0);
    }
  };
})();
```

- [ ] **Step 3: Opening, reading and capturing**

Create `tests/parity/prototype.ts`:

```ts
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Browser, Page } from "playwright";
import type { ShotRecord } from "@/lib/parity/report-html";
import type { PrototypeBook } from "@/lib/parity/types";

/**
 * The prototype side of the harness: open the built single file from disk in
 * a fresh browser profile (so it seeds its books as for any new visitor),
 * inject prototype-inpage.js, and let the prototype compute its own figures.
 * Every evaluate passes a string: a TypeScript function would carry
 * transform helpers the page does not have.
 */
const INPAGE = fileURLToPath(new URL("./prototype-inpage.js", import.meta.url));

export async function openPrototype(browser: Browser, htmlPath: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load", timeout: 120_000 });
  await page.waitForFunction(
    "typeof DB !== 'undefined' && DB.books && DB.books.length > 0 && typeof useBook === 'function' && typeof reportPL === 'function'",
    undefined,
    { timeout: 120_000 },
  );
  await page.addScriptTag({ path: INPAGE });
  await page.waitForFunction("typeof window.__parity === 'object'", undefined, { timeout: 10_000 });
  return page;
}

export async function readPrototype(page: Page): Promise<PrototypeBook[]> {
  return (await page.evaluate("window.__parity.read()")) as PrototypeBook[];
}

/** Every top-level tab and every report, for every book, in light and dark, at the window's 1440 × 900. */
export async function captureScreens(page: Page, outDir: string): Promise<ShotRecord[]> {
  mkdirSync(outDir, { recursive: true });
  const books = (await page.evaluate("window.__parity.books()")) as { id: string; name: string }[];
  const tabs = (await page.evaluate("window.__parity.tabs()")) as { key: string; name: string }[];
  const reports = (await page.evaluate("window.__parity.reports()")) as { key: string; name: string }[];
  const views = [
    ...tabs.filter((t) => t.key !== "reports").map((t) => ({ tab: t.key, report: null as string | null, name: t.name })),
    ...reports.map((r) => ({ tab: "reports", report: r.key, name: `Reports › ${r.name}` })),
  ];
  const shots: ShotRecord[] = [];
  for (const [index, book] of books.entries()) {
    for (const theme of ["light", "dark"] as const) {
      for (const view of views) {
        const file = `book${index + 1}-${theme}-${view.report ? `report-${view.report}` : `tab-${view.tab}`}.png`;
        try {
          await page.evaluate(
            `window.__parity.show(${JSON.stringify(book.id)}, ${JSON.stringify(view.tab)}, ${JSON.stringify(view.report)}, ${JSON.stringify(theme)})`,
          );
          await page.waitForTimeout(150);
          await page.screenshot({ path: join(outDir, file) });
          shots.push({ book: book.name, name: view.name, theme, file: `shots/${file}`, error: null });
        } catch (error) {
          shots.push({ book: book.name, name: view.name, theme, file: "", error: error instanceof Error ? error.message : String(error) });
        }
      }
    }
  }
  return shots;
}
```

- [ ] **Step 4: The harness, prototype half**

Create `tests/parity/prototype-parity.parity.ts`:

```ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { describe, expect, it } from "vitest";
import type { ShotRecord } from "@/lib/parity/report-html";
import type { PrototypeBook } from "@/lib/parity/types";
import { captureScreens, openPrototype, readPrototype } from "./prototype";

/**
 * The prototype-parity harness (docs/superpowers/specs/2026-10-02-parity-harness-design.md).
 *
 *   PARITY_PROTOTYPE_HTML  the built prototype, accounting-system.html (required)
 *   PARITY_OUT_DIR         where results go (default C:/Users/pit010/OneBook-parity-2.28 — outside the repository)
 *   PARITY_SKIP_SHOTS=1    skip the screenshots
 *
 * Run: npm run parity
 */
const HOUR = 60 * 60 * 1000;
const env = (name: string): string | null => {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : null;
};

describe("prototype 2.28 parity", () => {
  it(
    "reads every book the prototype holds, and its screens",
    async () => {
      const htmlPath = env("PARITY_PROTOTYPE_HTML");
      if (!htmlPath) throw new Error("Set PARITY_PROTOTYPE_HTML to the prototype's accounting-system.html");
      const outDir = env("PARITY_OUT_DIR") ?? "C:/Users/pit010/OneBook-parity-2.28";
      mkdirSync(outDir, { recursive: true });
      const killer = setTimeout(() => {
        console.error("parity: hard timeout");
        process.exit(2);
      }, HOUR - 60_000);
      try {
        const browser = await chromium.launch();
        let books: PrototypeBook[] = [];
        let shots: ShotRecord[] = [];
        try {
          const page = await openPrototype(browser, htmlPath);
          books = await readPrototype(page);
          if (env("PARITY_SKIP_SHOTS") !== "1") shots = await captureScreens(page, join(outDir, "shots"));
        } finally {
          await browser.close();
        }
        for (const [i, book] of books.entries()) {
          console.log(
            `parity: book ${i + 1}: ${book.accounts.length} accounts, ${book.entries.length} entries, ` +
              `${book.monthEnds.length} month ends, ${book.fiscalYears.length} fiscal years`,
          );
        }
        console.log(`parity: ${shots.length} screenshot(s), ${shots.filter((s) => s.error).length} failed`);
        writeFileSync(join(outDir, "prototype-books.json"), JSON.stringify({ books, shots }, null, 2), "utf8");
        expect(books.length).toBeGreaterThan(0);
      } finally {
        clearTimeout(killer);
      }
    },
    HOUR,
  );
});
```

- [ ] **Step 5: Run it against the prototype on this machine**

Run (Git Bash, from `ctyhp-accounting/`; the Bash tool's timeout at least 900000 ms):

```bash
PARITY_PROTOTYPE_HTML="C:/Users/pit010/Accounting System 2.28 - source/accounting-system.html" npm run parity
```

Expected: `1 passed`; two `parity: book N: …` lines with non-zero accounts, entries, month ends and fiscal years; a screenshot count with few or no failures; `C:/Users/pit010/OneBook-parity-2.28/prototype-books.json` and `shots/*.png` written. Open two or three screenshots with the Read tool and confirm they show the prototype's screens (light and dark). Report the counts only — never names or amounts.

If the page never reaches the `waitForFunction` condition, report what `page.evaluate("typeof DB")` and the console show; do not change the prototype file.

- [ ] **Step 6: Typecheck, lint, commit**

Run: `npm run typecheck && npm run lint`
Expected: 0 errors (lint warnings that existed before are fine; report any in the new files).

```bash
git add vitest.parity.config.ts package.json tests/parity/prototype-inpage.js tests/parity/prototype.ts tests/parity/prototype-parity.parity.ts
printf 'feat(parity): read the prototype and capture its screens\n\nThe prototype runs in a headless browser and reports its own figures; every\ntab and report is captured in light and dark. Results stay outside the repo.\n' > ../.superpowers/sdd/commit-msg.txt
git commit -F ../.superpowers/sdd/commit-msg.txt
```

---

### Task 7: The throwaway company, OneBook's figures, and the report

**Files:**
- Create: `tests/parity/onebook.ts`
- Modify: `tests/parity/prototype-parity.parity.ts` (replace the whole file with the version below)

**Interfaces:**
- Consumes: `ledgerBalanceFromRow` (Task 1); `prototypeAccountType`, `journalLines`, `PrototypeBook`, `BookFigures` (Task 2); `pairFigures`, `compareFigures` (Task 3); `renderParityReport`, `BookReport`, `ParityReport` (Task 5); `openPrototype`, `readPrototype`, `captureScreens` (Task 6); `provisionCompany` (`@/lib/services/company-provisioning`, `provisionCompany(client, { slug, legalName, isSample, displayOrder, adminUserIds, chartTemplate? }, sources)` → `{ companyId, schema, statementCount }`); `loadMigrationSources(root)` (`@/lib/db/migration-sources`); `buildProfitAndLoss`, `buildBalanceSheet`, `buildTrialBalance` (`@/lib/domain/reports`); the database function `acc_post_manual_journal(p_entry_date date, p_description text, p_source_ref text, p_currency text, p_lines jsonb)`.
- Produces: `LoadedBook`; `loadIntoThrowaway(client, book, sources, adminUserId): Promise<LoadedBook>`; `readOnebookFigures(client, book, loaded): Promise<BookFigures>`.

- [ ] **Step 1: Loading and reading**

Create `tests/parity/onebook.ts`:

```ts
import { randomBytes } from "node:crypto";
import type pg from "pg";
import type { MigrationSource } from "@/lib/db/migration-sources";
import { buildBalanceSheet, buildProfitAndLoss, buildTrialBalance, type LedgerBalance } from "@/lib/domain/reports";
import { prototypeAccountType } from "@/lib/parity/account-types";
import { journalLines, type JournalLineInput } from "@/lib/parity/cents";
import type { BookFigures, ParityEntry, PrototypeBook } from "@/lib/parity/types";
import { provisionCompany } from "@/lib/services/company-provisioning";
import { ledgerBalanceFromRow } from "@/lib/services/reports";

/**
 * The OneBook side of the harness. Everything here runs inside the caller's
 * transaction, which the caller always rolls back: a throwaway company is
 * built, the prototype's book is posted into it exactly, and OneBook's
 * figures are read on the same connection, so they see the uncommitted
 * entries. Nothing survives.
 */
export interface LoadedBook {
  schema: string;
  /** Prototype account name → OneBook account id. */
  accountIds: Map<string, string>;
  loaded: number;
  notLoaded: { id: string; date: string; problem: string; accounts: string[] }[];
}

const BATCH = 200;
const POST = `select acc_post_manual_journal((x.e->>'date')::date, x.e->>'description', nullif(x.e->>'ref', ''), $2, x.e->'lines') as id
  from jsonb_array_elements($1::jsonb) as x(e)`;

type Ready = { entry: ParityEntry; lines: JournalLineInput[] };
const payload = (items: readonly Ready[]) =>
  JSON.stringify(
    items.map(({ entry, lines }) => ({
      date: entry.date,
      description: entry.description.slice(0, 500) || "Prototype entry",
      ref: entry.ref.slice(0, 100),
      lines,
    })),
  );
const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

export async function loadIntoThrowaway(
  client: pg.Client,
  book: PrototypeBook,
  sources: readonly MigrationSource[],
  adminUserId: string,
): Promise<LoadedBook> {
  const slug = `parity_${randomBytes(4).toString("hex")}`;
  const taken = await client.query("select 1 from onebook.company where slug = $1", [slug]);
  if (taken.rowCount) throw new Error("the temporary company name is already taken; run again");
  const { schema } = await provisionCompany(
    client,
    { slug, legalName: "Parity check", isSample: true, displayOrder: 9999, adminUserIds: [adminUserId] },
    sources,
  );
  await client.query(`set local search_path = ${schema}, extensions`);
  const base = (await client.query("select code from acc_currency where is_base limit 1")).rows[0]?.code as string | undefined;
  if (!base) throw new Error("the throwaway company has no base currency");

  // One account per prototype account, typed by the prototype's own classes; P-codes never meet the template's.
  const accountIds = new Map<string, string>();
  for (const [i, name] of book.accounts.entries()) {
    const type = prototypeAccountType(name);
    if (!type) continue;
    const { rows } = await client.query(
      `insert into acc_account (account_code, name, account_type, currency_code, is_posting_account)
       values ($1, $2, $3, $4, true) returning id`,
      [`P${String(i + 1).padStart(4, "0")}`, name, type, base],
    );
    accountIds.set(name, rows[0].id as string);
  }

  const notLoaded: LoadedBook["notLoaded"] = [];
  const ready: Ready[] = [];
  for (const entry of [...book.entries].sort((a, b) => a.date.localeCompare(b.date))) {
    const result = journalLines(entry.postings, accountIds);
    const accounts = entry.postings.map((p) => p.account);
    if ("problem" in result) notLoaded.push({ id: entry.id, date: entry.date, problem: result.problem, accounts });
    else ready.push({ entry, lines: result.lines });
  }

  // Post as the company's administrator, in batches; a batch that refuses is retried one entry at a time.
  await client.query("set local role authenticated");
  await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: adminUserId, role: "authenticated" })]);
  let loaded = 0;
  for (let i = 0; i < ready.length; i += BATCH) {
    const batch = ready.slice(i, i + BATCH);
    await client.query("savepoint parity_batch");
    try {
      await client.query(POST, [payload(batch), base]);
      await client.query("release savepoint parity_batch");
      loaded += batch.length;
    } catch {
      await client.query("rollback to savepoint parity_batch");
      for (const item of batch) {
        await client.query("savepoint parity_one");
        try {
          await client.query(POST, [payload([item]), base]);
          await client.query("release savepoint parity_one");
          loaded += 1;
        } catch (error) {
          await client.query("rollback to savepoint parity_one");
          notLoaded.push({ id: item.entry.id, date: item.entry.date, problem: reason(error), accounts: item.entry.postings.map((p) => p.account) });
        }
      }
    }
  }
  await client.query("reset role");
  return { schema, accountIds, loaded, notLoaded };
}

/** OneBook's figures for the same dates and years the prototype reported, from the builders the Reports screen uses. */
export async function readOnebookFigures(client: pg.Client, book: PrototypeBook, loaded: LoadedBook): Promise<BookFigures> {
  await client.query(`set local search_path = ${loaded.schema}, extensions`);
  const nameOf = new Map([...loaded.accountIds].map(([name, id]) => [id, name]));
  const read = async (from: string | null, to: string): Promise<LedgerBalance[]> =>
    (await client.query("select * from acc_ledger_balances($1, $2)", [from, to])).rows.map(ledgerBalanceFromRow);
  const figures: BookFigures = { balances: {}, trialBalance: {}, profitAndLoss: {}, balanceSheet: {} };
  for (const to of book.monthEnds) {
    const balances: Record<string, number> = {};
    for (const row of await read(null, to)) {
      const net = row.debitBase - row.creditBase;
      if (net !== 0) balances[nameOf.get(row.accountId) ?? `(not from the prototype) ${row.accountCode} ${row.name}`] = net;
    }
    figures.balances[to] = balances;
  }
  for (const { from, to } of book.fiscalYears) {
    const pl = buildProfitAndLoss(await read(from, to));
    figures.profitAndLoss[`${from}..${to}`] = {
      income: pl.income.total,
      cogs: pl.costOfGoodsSold.total,
      gross: pl.grossProfit,
      opex: pl.operatingExpenses.total,
      netOperating: pl.grossProfit - pl.operatingExpenses.total,
      otherIncome: pl.otherIncome.total,
      otherExpenses: pl.otherExpenses.total,
      netOther: pl.otherIncome.total - pl.otherExpenses.total,
      net: pl.netIncome,
    };
    const atEnd = await read(null, to);
    const sheet = buildBalanceSheet(atEnd);
    figures.balanceSheet[to] = {
      assets: sheet.totalAssets,
      liabilities: sheet.totalLiabilities,
      equity: sheet.totalEquity,
      liabilitiesAndEquity: sheet.totalLiabilities + sheet.totalEquity,
    };
    const trial = buildTrialBalance(atEnd);
    figures.trialBalance[to] = { debit: trial.totalDebit, credit: trial.totalCredit };
  }
  return figures;
}
```

- [ ] **Step 2: The harness, both halves and the report**

Replace the whole of `tests/parity/prototype-parity.parity.ts` with:

```ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { chromium } from "playwright";
import { describe, expect, it } from "vitest";
import { loadMigrationSources } from "@/lib/db/migration-sources";
import { compareFigures, pairFigures } from "@/lib/parity/compare";
import { renderParityReport, type BookReport, type ParityReport, type ShotRecord } from "@/lib/parity/report-html";
import type { PrototypeBook } from "@/lib/parity/types";
import { loadIntoThrowaway, readOnebookFigures } from "./onebook";
import { captureScreens, openPrototype, readPrototype } from "./prototype";

/**
 * The prototype-parity harness (docs/superpowers/specs/2026-10-02-parity-harness-design.md).
 *
 *   PARITY_PROTOTYPE_HTML  the built prototype, accounting-system.html (required)
 *   PARITY_OUT_DIR         where results go (default C:/Users/pit010/OneBook-parity-2.28 — outside the repository)
 *   PARITY_SKIP_SHOTS=1    skip the screenshots
 *
 * Each book is posted into a throwaway company inside ONE transaction that is
 * always rolled back. The console prints counts only.
 *
 * Run: npm run parity
 */
const HOUR = 60 * 60 * 1000;
const env = (name: string): string | null => {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : null;
};

describe("prototype 2.28 parity", () => {
  it(
    "measures every book against OneBook, and writes the report outside the repository",
    async () => {
      const htmlPath = env("PARITY_PROTOTYPE_HTML");
      if (!htmlPath) throw new Error("Set PARITY_PROTOTYPE_HTML to the prototype's accounting-system.html");
      const outDir = env("PARITY_OUT_DIR") ?? "C:/Users/pit010/OneBook-parity-2.28";
      mkdirSync(outDir, { recursive: true });
      const killer = setTimeout(() => {
        console.error("parity: hard timeout");
        process.exit(2);
      }, HOUR - 60_000);
      try {
        const browser = await chromium.launch();
        let books: PrototypeBook[] = [];
        let shots: ShotRecord[] = [];
        try {
          const page = await openPrototype(browser, htmlPath);
          books = await readPrototype(page);
          if (env("PARITY_SKIP_SHOTS") !== "1") shots = await captureScreens(page, join(outDir, "shots"));
        } finally {
          await browser.close();
        }
        console.log(`parity: read ${books.length} book(s); ${shots.length} screenshot(s), ${shots.filter((s) => s.error).length} failed`);

        const client = new pg.Client({
          connectionString: process.env.SUPABASE_DB_URL,
          ssl: { rejectUnauthorized: false },
          connectionTimeoutMillis: 30_000,
        });
        await client.connect();
        const reports: BookReport[] = [];
        const drift: ParityReport["drift"] = null;
        try {
          const admin = (
            await client.query("select id from public.acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1")
          ).rows[0] as { id: string } | undefined;
          if (!admin) throw new Error("no active administrator to post as");
          const sources = loadMigrationSources(process.cwd());
          for (const book of books) {
            await client.query("begin");
            try {
              await client.query("set local lock_timeout = '10s'");
              const loaded = await loadIntoThrowaway(client, book, sources, admin.id);
              const onebook = await readOnebookFigures(client, book, loaded);
              const comparison = compareFigures(pairFigures(book.figures, onebook), {
                notLoaded: loaded.notLoaded.map((e) => ({ date: e.date, accounts: e.accounts })),
                closingDates: book.entries.filter((e) => e.closing).map((e) => e.date),
              });
              reports.push({
                name: book.name,
                accounts: book.accounts.length,
                entries: book.entries.length,
                loaded: loaded.loaded,
                notLoaded: loaded.notLoaded.map(({ id, date, problem }) => ({ id, date, problem })),
                months: book.monthEnds.length,
                fiscalYears: book.fiscalYears.length,
                comparison,
              });
              console.log(
                `parity: book ${reports.length}: ${loaded.loaded} of ${book.entries.length} entries loaded; ` +
                  `${comparison.compared} figures, ${comparison.agreed} agree, ${comparison.differences.length} differ`,
              );
            } finally {
              await client.query("rollback");
            }
          }
        } finally {
          await client.end();
        }

        const report: ParityReport = { generatedAt: new Date().toISOString(), prototypeFile: htmlPath, books: reports, drift, shots };
        writeFileSync(join(outDir, "parity-report.html"), renderParityReport(report), "utf8");
        writeFileSync(join(outDir, "parity-result.json"), JSON.stringify(report, null, 2), "utf8");
        console.log(`parity: report written to ${join(outDir, "parity-report.html")}`);
        expect(reports).toHaveLength(books.length);
      } finally {
        clearTimeout(killer);
      }
    },
    HOUR,
  );
});
```

- [ ] **Step 3: Run it — the throwaway company, rolled back**

Run (Git Bash, from `ctyhp-accounting/`; the Bash tool's timeout at least 1800000 ms; never in the background, never through head/tail):

```bash
PARITY_SKIP_SHOTS=1 PARITY_PROTOTYPE_HTML="C:/Users/pit010/Accounting System 2.28 - source/accounting-system.html" npm run parity
```

Expected: `1 passed`; for each book a line `parity: book N: L of E entries loaded; F figures, A agree, D differ`; `parity-report.html` and `parity-result.json` written in `C:/Users/pit010/OneBook-parity-2.28`. Then confirm nothing was kept:

```bash
node --env-file=.env.local -e "const {Client}=require('pg');const c=new Client({connectionString:process.env.SUPABASE_DB_URL,ssl:{rejectUnauthorized:false}});c.connect().then(()=>c.query(\"select count(*)::int n from onebook.company where slug like 'parity_%'\")).then(r=>{console.log('parity companies left:',r.rows[0].n);return c.end()})"
```

Expected: `parity companies left: 0`.

If a book reports many entries not loaded, open `parity-report.html` and report the distinct `problem` texts (they are error messages, not client data). Do not change OneBook's database functions; a refusal is a finding.

- [ ] **Step 4: Typecheck, lint, the unit suite, commit**

Run: `npm run typecheck && npm run lint && npm test`
Expected: 0 type errors, 0 lint errors, the unit suite green (it does not include `tests/parity`).

```bash
git add tests/parity/onebook.ts tests/parity/prototype-parity.parity.ts
printf 'feat(parity): post each book into a throwaway company and compare\n\nInside one transaction that is always rolled back: a company is built, the\nprototype'"'"'s entries are posted exactly, OneBook'"'"'s figures are read with the\nReports builders, and every figure is compared and tagged in the report.\n' > ../.superpowers/sdd/commit-msg.txt
git commit -F ../.superpowers/sdd/commit-msg.txt
```

---

### Task 8: The data pass

**Files:**
- Create: `tests/parity/drift-live.ts`
- Modify: `tests/parity/prototype-parity.parity.ts` (three edits below)

**Interfaces:**
- Consumes: `DriftEntry`, `compareEntries` (Task 4); the harness of Task 7.
- Produces: `readLiveEntries(client, schema, withAccounts): Promise<DriftEntry[]>`; environment variables `PARITY_LIVE_SCHEMA`, `PARITY_LIVE_BOOK`, `PARITY_ACCOUNT_MAP`.

- [ ] **Step 1: Reading a live company's entries**

Create `tests/parity/drift-live.ts`:

```ts
import type pg from "pg";
import type { DriftEntry } from "@/lib/parity/drift";

/**
 * Every posted entry of a live company, for the data pass. Called inside a
 * read-only transaction the caller rolls back. With `withAccounts`, each
 * posting carries its account code, so it can be compared with the prototype's
 * accounts through a local map.
 */
export async function readLiveEntries(client: pg.Client, schema: string, withAccounts: boolean): Promise<DriftEntry[]> {
  if (!/^co_[a-z0-9_]+$/.test(schema)) throw new Error("PARITY_LIVE_SCHEMA must be a company schema name");
  const { rows } = await client.query(
    `select e.id::text as id, e.entry_date::text as date, coalesce(e.description, '') as description,
            a.account_code as code, (l.debit_minor - l.credit_minor)::bigint as cents
       from ${schema}.acc_journal_entry e
       join ${schema}.acc_journal_line l on l.journal_entry_id = e.id
       join ${schema}.acc_account a on a.id = l.account_id
      where e.status = 'posted'
      order by e.entry_date, e.id, l.line_order`,
  );
  const entries = new Map<string, DriftEntry>();
  for (const row of rows as { id: string; date: string; description: string; code: string; cents: string }[]) {
    const cents = Number(row.cents);
    if (cents === 0) continue;
    let entry = entries.get(row.id);
    if (!entry) {
      entry = { id: row.id, date: row.date, amounts: [], accounts: withAccounts ? [] : null, label: row.description };
      entries.set(row.id, entry);
    }
    entry.amounts.push(cents);
    entry.accounts?.push(row.code);
  }
  return [...entries.values()];
}
```

- [ ] **Step 2: Wire it into the harness**

In `tests/parity/prototype-parity.parity.ts`:

1. Change the first import line `import { mkdirSync, writeFileSync } from "node:fs";` to:

```ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
```

and, after `import { compareFigures, pairFigures } from "@/lib/parity/compare";`, add:

```ts
import { compareEntries, type DriftEntry } from "@/lib/parity/drift";
```

and, after `import type { PrototypeBook } from "@/lib/parity/types";`, add:

```ts
import { readLiveEntries } from "./drift-live";
```

2. In the doc comment, after the `PARITY_SKIP_SHOTS=1` line, add:

```ts
 *   PARITY_LIVE_SCHEMA     a live company's schema (co_…) to compare entry by entry (optional; read-only)
 *   PARITY_LIVE_BOOK       which prototype book it holds: the book's id, or part of its name (with PARITY_LIVE_SCHEMA)
 *   PARITY_ACCOUNT_MAP     a local JSON file { "<prototype account>": "<OneBook account code>" } (optional)
```

3. Replace `const drift: ParityReport["drift"] = null;` with `let drift: ParityReport["drift"] = null;`, and directly after the closing `}` of the `for (const book of books) { … }` loop (still inside the `try` that ends with `await client.end()`), add:

```ts
          const liveSchema = env("PARITY_LIVE_SCHEMA");
          const liveBook = env("PARITY_LIVE_BOOK");
          if (liveSchema && liveBook) {
            const book = books.find((b) => b.id === liveBook || b.name.toLowerCase().includes(liveBook.toLowerCase()));
            if (!book) throw new Error("PARITY_LIVE_BOOK names no book in the prototype");
            const mapPath = env("PARITY_ACCOUNT_MAP");
            const codes = mapPath
              ? new Map(Object.entries(JSON.parse(readFileSync(mapPath, "utf8")) as Record<string, string>))
              : null;
            await client.query("begin read only");
            try {
              const live = await readLiveEntries(client, liveSchema, codes !== null);
              const prototype: DriftEntry[] = book.entries.map((entry) => {
                const postings = entry.postings.filter((p) => p.cents !== 0);
                return {
                  id: entry.id,
                  date: entry.date,
                  amounts: postings.map((p) => p.cents),
                  accounts: codes ? postings.map((p) => codes.get(p.account) ?? `?${p.account}`) : null,
                  label: entry.description,
                };
              });
              drift = { schema: liveSchema, book: book.name, result: compareEntries(prototype, live) };
              console.log(
                `parity: data pass: ${drift.result.matched} matched, ${drift.result.onlyPrototype.length} only in the prototype, ` +
                  `${drift.result.onlyOnebook.length} only in OneBook, ${drift.result.accountsDiffer.length} on other accounts`,
              );
            } finally {
              await client.query("rollback");
            }
          }
```

- [ ] **Step 3: Run the data pass**

The controller gives you, in the dispatch message, the schema of the live company that holds the prototype's jewelry book and a word from that book's name. Use them only on the command line below — never write them into any repository file, commit message or report you commit.

Run (Git Bash, from `ctyhp-accounting/`; timeout at least 1800000 ms), with the two values from the dispatch message in place of `$LIVE_SCHEMA` and `$LIVE_BOOK`:

```bash
PARITY_SKIP_SHOTS=1 PARITY_LIVE_SCHEMA="$LIVE_SCHEMA" PARITY_LIVE_BOOK="$LIVE_BOOK" PARITY_PROTOTYPE_HTML="C:/Users/pit010/Accounting System 2.28 - source/accounting-system.html" npm run parity
```

Expected: `1 passed`; the two book lines as in Task 7; a `parity: data pass: …` line; the report's "Data pass" section written.

- [ ] **Step 4: Typecheck, lint, commit**

Run: `npm run typecheck && npm run lint`
Expected: 0 errors.

```bash
git add tests/parity/drift-live.ts tests/parity/prototype-parity.parity.ts
printf 'feat(parity): the read-only data pass\n\nThe prototype'"'"'s newest copy of a book against the live company holding it,\nentry by entry; names come from the command line, never the repository.\n' > ../.superpowers/sdd/commit-msg.txt
git commit -F ../.superpowers/sdd/commit-msg.txt
```

---

### Task 9: The baseline (controller)

No new code.

- [ ] **Step 1: The full run.** With screenshots, both books, and the data pass:

```bash
PARITY_LIVE_SCHEMA="$LIVE_SCHEMA" PARITY_LIVE_BOOK="$LIVE_BOOK" PARITY_PROTOTYPE_HTML="C:/Users/pit010/Accounting System 2.28 - source/accounting-system.html" npm run parity
```

`$LIVE_SCHEMA` and `$LIVE_BOOK` are the live company's schema and a word from its prototype book's name, kept in the local notes. If the account map used for the 29 September load is available, also set `PARITY_ACCOUNT_MAP` to a JSON file built from it, kept outside the repository (the map lives in the untracked seed script of that load).

- [ ] **Step 2: Read the report.** Open `C:/Users/pit010/OneBook-parity-2.28/parity-report.html`; for every *new* difference, find its cause (a calculation rule from the roadmap's section 4, a mapping question, or a real defect).
- [ ] **Step 3: Tell the user**, in counts and causes: figures compared and agreeing per book; each *new* difference group and its cause; entries not loaded and why; the data pass (matched / only in the prototype / only in OneBook / other accounts); screenshots taken. Nothing pushed until the user says so.
- [ ] **Step 4: Gates.** `npm run typecheck && npm run lint && npm test` — 0 errors and the unit suite green.

---

## Self-review notes

- Spec 2 (figures): Tasks 6 (prototype) and 7 (OneBook), paired and compared by Task 3.
- Spec 3.1 (reading the prototype): Task 6. 3.2 (throwaway company): Task 7. 3.3 (tags): Task 3. 3.4 (data pass): Tasks 4 and 8. 3.5 (screenshots): Task 6. 3.6 (output): Tasks 5 and 7.
- Spec 4 (software): `ledgerBalanceFromRow` Task 1; `lib/parity/*` Tasks 2–5; `tests/parity/*`, config and script Tasks 6–8.
- Spec 5 (safety): rollback in `finally` (Task 7, Task 8), random slug checked (Task 7), read-only data pass (Task 8), counts-only console (Tasks 6–8), a check that no `parity_%` company remains (Task 7 Step 3).
- Spec 6 (proving it): unit tests Tasks 1–5; full run Task 9.
