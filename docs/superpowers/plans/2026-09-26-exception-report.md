# Exception Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only Exception Report to OneBook that runs the eight checks a reviewer runs by hand, as specified in `docs/superpowers/specs/2026-09-25-exceptions-report-design.md`.

**Architecture:** A pure domain module holds all eight checks and knows nothing about the database. A service module performs the reads through RPCs the Trial Balance and Transaction List reports already use, and hands the results to the domain module. A server component renders a client component that calls one server action. No migration, no write path.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Ant Design 6, Supabase JS, Vitest.

## Global Constraints

- **Nothing in this work may change a figure.** No insert, update, delete, RPC that posts, or migration. Verified by Task 8's import-guard test and by `actions.ts` having exactly one verb.
- **No migration.** If a task appears to need SQL, stop and raise it rather than writing one.
- Interface language is **US English**. The user-facing prose in §6 of the spec is copied verbatim, not paraphrased.
- Money is **integer minor units** everywhere in domain and service code. Division by the currency scale happens only at the display edge, via `fromMinor(minor, baseDecimals)`.
- All amounts read from `acc_ledger_balances` and `acc_monthly_ledger_balances` are already **base currency**.
- **No real ledger data in `tests/`.** This repository is public. Fixtures are constructed with invented names and amounts. Never copy rows out of `Accounting-System-v3.html`.
- Commits carry **no `Co-Authored-By` trailer** in this repository.
- Stage files **individually**. Never `git add -A` or `git add .` — there are untracked files in this working tree holding real customer data.

## File Structure

| File | Responsibility |
|---|---|
| `ctyhp-accounting/lib/domain/exceptions.ts` | Pure. All eight checks, the input/output types, and `buildExceptionReport`. Imports only `@/lib/domain/*`. |
| `ctyhp-accounting/lib/services/exceptions.ts` | Five reads, assembled into `ExceptionReportInput`, then one call to the domain module. |
| `ctyhp-accounting/app/(app)/reports/exceptions/page.tsx` | Server shell: `PageHeader` + `ReportEntityBadge`. |
| `ctyhp-accounting/app/(app)/reports/exceptions/actions.ts` | One server action. |
| `ctyhp-accounting/app/(app)/reports/exceptions/ExceptionsClient.tsx` | Date range, eight sections, drill-through, CSV. |
| `ctyhp-accounting/lib/domain/report-catalog.ts` | One catalogue entry (modify). |
| `ctyhp-accounting/tests/unit/exceptions.test.ts` | One `describe` per check, plus the import guard. |

All paths below are relative to `ctyhp-accounting/` unless stated otherwise. Run all commands from `ctyhp-accounting/`.

---

### Task 1: Domain foundations and the wrong-way balance check

The first check, and the types every later task consumes. `naturalBalance` already exists in `lib/domain/accounts.ts` and returns a positive number when an account carries its normal balance — this check is `naturalBalance(...) < 0`. Do not re-derive the debit/credit type lists.

**Files:**
- Create: `lib/domain/exceptions.ts`
- Create: `tests/unit/exceptions.test.ts`

**Interfaces:**
- Consumes: `naturalBalance`, `AccountType` from `@/lib/domain/accounts`; `TransactionListRow` from `@/lib/domain/transaction-list`; `LedgerBalance` from `@/lib/domain/reports`
- Produces: `ExceptionAccount`, `ExceptionBankAccount`, `ExceptionPaymentRef`, `UndepositedDetail`, `YearTotals`, and `wrongWayBalances(accounts): WrongWayRow[]`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/exceptions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { wrongWayBalances, type ExceptionAccount } from "@/lib/domain/exceptions";

const account = (over: Partial<ExceptionAccount> = {}): ExceptionAccount => ({
  accountId: "a1",
  accountCode: "1000",
  name: "Cash on Hand",
  accountType: "bank",
  detailType: null,
  debitBase: 0,
  creditBase: 0,
  ...over,
});

describe("wrongWayBalances", () => {
  it("flags an expense account carrying a credit balance", () => {
    const rows = wrongWayBalances([
      account({ accountId: "e1", accountCode: "6100", name: "Payroll Taxes", accountType: "expense", creditBase: 7_334_72 }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].accountCode).toBe("6100");
    expect(rows[0].balanceMinor).toBe(-7_334_72);
  });

  it("leaves an account carrying its normal balance alone", () => {
    const rows = wrongWayBalances([account({ accountType: "expense", debitBase: 500_00 })]);
    expect(rows).toEqual([]);
  });

  it("does not flag a contra account, which is meant to point the other way", () => {
    const rows = wrongWayBalances([
      account({
        accountCode: "1590",
        name: "Accumulated Depreciation",
        accountType: "fixed_asset",
        detailType: "Contra fixed asset",
        creditBase: 42_000_00,
      }),
    ]);
    expect(rows).toEqual([]);
  });

  it("ignores an account with no balance at all", () => {
    const rows = wrongWayBalances([account({ accountType: "income" })]);
    expect(rows).toEqual([]);
  });

  it("puts the largest question first", () => {
    const rows = wrongWayBalances([
      account({ accountId: "s", accountCode: "6100", accountType: "expense", creditBase: 100_00 }),
      account({ accountId: "b", accountCode: "6200", accountType: "expense", creditBase: 900_00 }),
    ]);
    expect(rows.map((r) => r.accountCode)).toEqual(["6200", "6100"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/exceptions.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/domain/exceptions"`

- [ ] **Step 3: Write the module**

Create `lib/domain/exceptions.ts`:

```ts
/**
 * The eight checks a reviewer runs by hand.
 *
 * From the client's prototype: "None of these is proof of an error. Each is a
 * question worth answering." Nothing here accuses; each check raises a
 * question, and the value is that somebody looked and can say why.
 *
 * This module is pure. It receives data that has already been read and returns
 * an answer. It imports nothing from `@/lib/db` or `@/lib/services`, and a test
 * in `tests/unit/exceptions.test.ts` fails if that ever changes — because a
 * report that could write is a report nobody can safely run on live books.
 *
 * Money is integer minor units, base currency, throughout.
 */

import { naturalBalance, type AccountType } from "@/lib/domain/accounts";
import type { LedgerBalance } from "@/lib/domain/reports";
import type { TransactionListRow } from "@/lib/domain/transaction-list";

/** Re-exported so a caller needs one import to build the input, not three. */
export type { LedgerBalance, TransactionListRow };

/**
 * The eight, named once.
 *
 * The screen draws its section headings from here and the service names a
 * failed read from here, so a check cannot be called two different things in
 * two different places.
 */
export const CHECK_LABEL = {
  duplicates: "Entries recorded more than once",
  cheque: "A cheque number used twice on one account",
  undeposited: "Money received but not yet banked",
  wrongWay: "A balance pointing the wrong way",
  incomeNoCost: "A year with income and no costs",
  unreconciled: "Bank accounts not agreed to a statement",
  futureDated: "Entries dated in the future",
  holding: "Still sitting in a holding account",
} as const;

export type CheckKey = keyof typeof CHECK_LABEL;

/* ---------------------------------------------------------------- inputs */

/** An account with its cumulative balance and the classification the checks need. */
export interface ExceptionAccount {
  accountId: string;
  accountCode: string;
  name: string;
  accountType: AccountType;
  /**
   * OneBook records that an account is contra rather than guessing from its
   * name: migration 0046 creates "Accumulated Depreciation" with
   * `detail_type = 'Contra fixed asset'`.
   */
  detailType: string | null;
  debitBase: number;
  creditBase: number;
}

export interface ExceptionBankAccount {
  bankAccountId: string;
  /** The general-ledger account behind the bank account. */
  accountId: string;
  accountName: string;
  /** The latest completed reconciliation's statement date, or null for never. */
  lastReconciledDate: string | null;
}

/** A payment carrying the reference a statement is reconciled by. */
export interface ExceptionPaymentRef {
  paymentId: string;
  kind: "customer" | "vendor";
  paymentNumber: string | null;
  paymentDate: string;
  reference: string;
  /** The bank or credit-card account the money moved through. */
  accountId: string;
  accountName: string;
  partyName: string;
  amountMinor: number;
}

/** How long money has been sitting in a holding account, and in how many pieces. */
export interface UndepositedDetail {
  entryCount: number;
  oldestEntryDate: string | null;
}

export interface YearTotals {
  year: string;
  incomeMinor: number;
  costMinor: number;
}

/* --------------------------------------------------------------- outputs */

export interface WrongWayRow {
  accountId: string;
  accountCode: string;
  name: string;
  accountType: AccountType;
  /** Debit-positive, so a credit balance reads negative. */
  balanceMinor: number;
}

const CONTRA = /^\s*contra/i;

/**
 * An asset in credit, or a liability in debit.
 *
 * Sometimes right — an overdrawn account, a supplier overpaid — and sometimes a
 * posting on the wrong side. Contra accounts are left out, because pointing the
 * other way is their whole purpose.
 */
export function wrongWayBalances(accounts: readonly ExceptionAccount[]): WrongWayRow[] {
  const rows: WrongWayRow[] = [];
  for (const a of accounts) {
    if (CONTRA.test(a.detailType ?? "")) continue;
    if (naturalBalance(a.accountType, a.debitBase, a.creditBase) >= 0) continue;
    rows.push({
      accountId: a.accountId,
      accountCode: a.accountCode,
      name: a.name,
      accountType: a.accountType,
      balanceMinor: a.debitBase - a.creditBase,
    });
  }
  return rows.sort((x, y) => Math.abs(y.balanceMinor) - Math.abs(x.balanceMinor));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/exceptions.test.ts`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add ctyhp-accounting/lib/domain/exceptions.ts ctyhp-accounting/tests/unit/exceptions.test.ts
git commit -m "feat(exceptions): a balance that points the way its type does not"
```

---

### Task 2: Holding accounts, and money received but not banked

Two checks that share a shape: an account matched by what it is called, carrying a balance it should not be carrying.

**Files:**
- Modify: `lib/domain/exceptions.ts`
- Modify: `tests/unit/exceptions.test.ts`

**Interfaces:**
- Consumes: `ExceptionAccount`, `UndepositedDetail` from Task 1
- Produces: `holdingAccounts(accounts): HoldingRow[]`, `undepositedFunds(accounts, details): UndepositedRow[]`

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/exceptions.test.ts`:

```ts
import {
  holdingAccounts,
  undepositedFunds,
  type UndepositedDetail,
} from "@/lib/domain/exceptions";

describe("holdingAccounts", () => {
  it("flags anything left in Uncategorized", () => {
    const rows = holdingAccounts([
      account({ accountCode: "9000", name: "Uncategorized Expense", accountType: "expense", debitBase: 475_000_00 }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].balanceMinor).toBe(475_000_00);
  });

  it("matches Suspense and Ask My Accountant too", () => {
    const rows = holdingAccounts([
      account({ accountId: "s1", accountCode: "9100", name: "Suspense", accountType: "current_asset", debitBase: 10_00 }),
      account({ accountId: "s2", accountCode: "9200", name: "Ask My Accountant", accountType: "current_asset", debitBase: 20_00 }),
    ]);
    expect(rows).toHaveLength(2);
  });

  it("stays silent when the holding account has been cleared to zero", () => {
    expect(holdingAccounts([account({ name: "Uncategorized Income", accountType: "income" })])).toEqual([]);
  });

  it("does not flag an ordinary account", () => {
    expect(holdingAccounts([account({ name: "Sales Revenue", accountType: "income", creditBase: 900_00 })])).toEqual([]);
  });
});

describe("undepositedFunds", () => {
  const details = new Map<string, UndepositedDetail>([
    ["u1", { entryCount: 12, oldestEntryDate: "2026-01-04" }],
  ]);

  it("flags a balance sitting in Undeposited Funds", () => {
    const rows = undepositedFunds(
      [account({ accountId: "u1", accountCode: "1210", name: "Undeposited Funds", accountType: "current_asset", debitBase: 33_400_00 })],
      details,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].entryCount).toBe(12);
    expect(rows[0].oldestEntryDate).toBe("2026-01-04");
  });

  it("recognises the account by code when it has been renamed", () => {
    const rows = undepositedFunds(
      [account({ accountId: "u1", accountCode: "1210", name: "Takings not yet banked", accountType: "current_asset", debitBase: 500_00 })],
      details,
    );
    expect(rows).toHaveLength(1);
  });

  it("recognises a second one by name when it does not carry the code", () => {
    const rows = undepositedFunds(
      [account({ accountId: "u2", accountCode: "1211", name: "Undeposited Funds - Branch", accountType: "current_asset", debitBase: 500_00 })],
      new Map(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].entryCount).toBe(0);
    expect(rows[0].oldestEntryDate).toBeNull();
  });

  it("says nothing when the account has emptied, which is what should happen", () => {
    const rows = undepositedFunds(
      [account({ accountId: "u1", accountCode: "1210", name: "Undeposited Funds", accountType: "current_asset" })],
      details,
    );
    expect(rows).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/exceptions.test.ts`
Expected: FAIL — `holdingAccounts is not exported`

- [ ] **Step 3: Write the implementation**

Append to `lib/domain/exceptions.ts`:

```ts
export interface HoldingRow {
  accountId: string;
  accountCode: string;
  name: string;
  balanceMinor: number;
}

/**
 * Both spellings of "uncategorised" are matched. The interface writes the
 * American one, but a chart imported from elsewhere may not.
 */
const HOLDING = /uncategori[sz]ed|suspense|ask my accountant/i;

/**
 * Anything left in a holding account has not been given a real account yet, so
 * it is in the wrong place on both statements.
 */
export function holdingAccounts(accounts: readonly ExceptionAccount[]): HoldingRow[] {
  const rows: HoldingRow[] = [];
  for (const a of accounts) {
    const balanceMinor = a.debitBase - a.creditBase;
    if (balanceMinor === 0 || !HOLDING.test(a.name)) continue;
    rows.push({ accountId: a.accountId, accountCode: a.accountCode, name: a.name, balanceMinor });
  }
  return rows.sort((x, y) => Math.abs(y.balanceMinor) - Math.abs(x.balanceMinor));
}

export interface UndepositedRow {
  accountId: string;
  accountCode: string;
  name: string;
  balanceMinor: number;
  entryCount: number;
  oldestEntryDate: string | null;
}

const UNDEPOSITED_NAME = /undeposited/i;
/** The seeded chart's code for it; accepted alongside the name, never instead. */
const UNDEPOSITED_CODE = "1210";

/**
 * Undeposited funds should empty as takings reach the bank. A balance that
 * keeps growing means the sales are recorded but the deposits are not —
 * revenue is in the books, the cash is not.
 */
export function undepositedFunds(
  accounts: readonly ExceptionAccount[],
  details: ReadonlyMap<string, UndepositedDetail>,
): UndepositedRow[] {
  const rows: UndepositedRow[] = [];
  for (const a of accounts) {
    const balanceMinor = a.debitBase - a.creditBase;
    if (balanceMinor === 0) continue;
    if (!UNDEPOSITED_NAME.test(a.name) && a.accountCode !== UNDEPOSITED_CODE) continue;
    const detail = details.get(a.accountId);
    rows.push({
      accountId: a.accountId,
      accountCode: a.accountCode,
      name: a.name,
      balanceMinor,
      entryCount: detail?.entryCount ?? 0,
      oldestEntryDate: detail?.oldestEntryDate ?? null,
    });
  }
  return rows.sort((x, y) => Math.abs(y.balanceMinor) - Math.abs(x.balanceMinor));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/exceptions.test.ts`
Expected: PASS, 14 tests

- [ ] **Step 5: Commit**

```bash
git add ctyhp-accounting/lib/domain/exceptions.ts ctyhp-accounting/tests/unit/exceptions.test.ts
git commit -m "feat(exceptions): money still in a holding account, and money never banked"
```

---

### Task 3: Bank accounts nobody has agreed to a statement

**Files:**
- Modify: `lib/domain/exceptions.ts`
- Modify: `tests/unit/exceptions.test.ts`

**Interfaces:**
- Consumes: `ExceptionBankAccount` from Task 1
- Produces: `unreconciledBankAccounts(banks, balanceByAccountId, to): UnreconciledRow[]`

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/exceptions.test.ts`:

```ts
import { unreconciledBankAccounts, type ExceptionBankAccount } from "@/lib/domain/exceptions";

const bank = (over: Partial<ExceptionBankAccount> = {}): ExceptionBankAccount => ({
  bankAccountId: "b1",
  accountId: "a1",
  accountName: "Checking 3388",
  lastReconciledDate: null,
  ...over,
});

describe("unreconciledBankAccounts", () => {
  const balances = new Map<string, number>([["a1", 96_293_85]]);

  it("flags a bank account nobody has ever reconciled", () => {
    const rows = unreconciledBankAccounts([bank()], balances, "2026-09-30");
    expect(rows).toHaveLength(1);
    expect(rows[0].lastReconciledDate).toBeNull();
    expect(rows[0].balanceMinor).toBe(96_293_85);
  });

  it("flags one whose last reconciliation stops short of the report date", () => {
    const rows = unreconciledBankAccounts([bank({ lastReconciledDate: "2026-06-30" })], balances, "2026-09-30");
    expect(rows).toHaveLength(1);
  });

  it("leaves one reconciled exactly to the report date alone", () => {
    const rows = unreconciledBankAccounts([bank({ lastReconciledDate: "2026-09-30" })], balances, "2026-09-30");
    expect(rows).toEqual([]);
  });

  it("leaves one reconciled beyond the report date alone", () => {
    const rows = unreconciledBankAccounts([bank({ lastReconciledDate: "2026-10-31" })], balances, "2026-09-30");
    expect(rows).toEqual([]);
  });

  it("says nothing about a closed account with no balance to prove", () => {
    const rows = unreconciledBankAccounts([bank()], new Map([["a1", 0]]), "2026-09-30");
    expect(rows).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/exceptions.test.ts`
Expected: FAIL — `unreconciledBankAccounts is not exported`

- [ ] **Step 3: Write the implementation**

Append to `lib/domain/exceptions.ts`:

```ts
export interface UnreconciledRow {
  bankAccountId: string;
  accountId: string;
  accountName: string;
  balanceMinor: number;
  lastReconciledDate: string | null;
}

/**
 * A balance nobody has proved against the bank.
 *
 * An account with nothing in it is not asked about: there is no balance to
 * prove, and a closed account would otherwise stay on the list forever.
 */
export function unreconciledBankAccounts(
  banks: readonly ExceptionBankAccount[],
  balanceByAccountId: ReadonlyMap<string, number>,
  to: string,
): UnreconciledRow[] {
  const rows: UnreconciledRow[] = [];
  for (const b of banks) {
    const balanceMinor = balanceByAccountId.get(b.accountId) ?? 0;
    if (balanceMinor === 0) continue;
    if (b.lastReconciledDate !== null && b.lastReconciledDate >= to) continue;
    rows.push({
      bankAccountId: b.bankAccountId,
      accountId: b.accountId,
      accountName: b.accountName,
      balanceMinor,
      lastReconciledDate: b.lastReconciledDate,
    });
  }
  return rows.sort((x, y) => x.accountName.localeCompare(y.accountName));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/exceptions.test.ts`
Expected: PASS, 19 tests

- [ ] **Step 5: Commit**

```bash
git add ctyhp-accounting/lib/domain/exceptions.ts ctyhp-accounting/tests/unit/exceptions.test.ts
git commit -m "feat(exceptions): a bank balance nobody has proved against a statement"
```

---

### Task 4: A year that earned but never spent

Two functions: one folds the monthly balance map into per-year totals, the other judges them. Split because the folding is where the arithmetic lives and it deserves its own tests.

**Files:**
- Modify: `lib/domain/exceptions.ts`
- Modify: `tests/unit/exceptions.test.ts`

**Interfaces:**
- Consumes: `LedgerBalance` (re-exported by Task 1), `YearTotals` from Task 1
- Produces: `yearTotalsFromMonthly(byMonth): YearTotals[]`, `yearsWithIncomeAndNoCost(years): IncomeNoCostRow[]`

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/exceptions.test.ts`:

```ts
import {
  yearTotalsFromMonthly,
  yearsWithIncomeAndNoCost,
  type LedgerBalance,
} from "@/lib/domain/exceptions";

const bal = (over: Partial<LedgerBalance> = {}): LedgerBalance => ({
  accountId: "x",
  accountCode: "4000",
  name: "Sales Revenue",
  accountType: "income",
  debitBase: 0,
  creditBase: 0,
  ...over,
});

describe("yearTotalsFromMonthly", () => {
  it("sums income as credits less debits, and cost as debits less credits", () => {
    const byMonth = new Map<string, LedgerBalance[]>([
      ["2026-01", [bal({ creditBase: 100_00 }), bal({ accountCode: "6000", accountType: "expense", debitBase: 40_00 })]],
      ["2026-02", [bal({ creditBase: 50_00, debitBase: 10_00 })]],
    ]);
    expect(yearTotalsFromMonthly(byMonth)).toEqual([
      { year: "2026", incomeMinor: 140_00, costMinor: 40_00 },
    ]);
  });

  it("counts other income and other expense on the right sides", () => {
    const byMonth = new Map<string, LedgerBalance[]>([
      ["2026-01", [
        bal({ accountType: "other_income", creditBase: 30_00 }),
        bal({ accountType: "other_expense", debitBase: 7_00 }),
        bal({ accountType: "cost_of_goods_sold", debitBase: 3_00 }),
      ]],
    ]);
    expect(yearTotalsFromMonthly(byMonth)).toEqual([
      { year: "2026", incomeMinor: 30_00, costMinor: 10_00 },
    ]);
  });

  it("ignores balance sheet accounts entirely", () => {
    const byMonth = new Map<string, LedgerBalance[]>([
      ["2026-01", [bal({ accountType: "bank", debitBase: 900_00 })]],
    ]);
    expect(yearTotalsFromMonthly(byMonth)).toEqual([{ year: "2026", incomeMinor: 0, costMinor: 0 }]);
  });

  it("separates the years and returns them oldest first", () => {
    const byMonth = new Map<string, LedgerBalance[]>([
      ["2025-12", [bal({ creditBase: 10_00 })]],
      ["2024-06", [bal({ creditBase: 20_00 })]],
    ]);
    expect(yearTotalsFromMonthly(byMonth).map((y) => y.year)).toEqual(["2024", "2025"]);
  });
});

describe("yearsWithIncomeAndNoCost", () => {
  it("flags a year with revenue and nothing spent against it", () => {
    const rows = yearsWithIncomeAndNoCost([{ year: "2024", incomeMinor: 500_000_00, costMinor: 0 }]);
    expect(rows).toEqual([{ year: "2024", incomeMinor: 500_000_00, costMinor: 0 }]);
  });

  it("does not flag a year with even one cost in it", () => {
    expect(yearsWithIncomeAndNoCost([{ year: "2024", incomeMinor: 500_000_00, costMinor: 1 }])).toEqual([]);
  });

  it("does not flag a year with no income either — that is a quiet year, not a broken one", () => {
    expect(yearsWithIncomeAndNoCost([{ year: "2024", incomeMinor: 0, costMinor: 0 }])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/exceptions.test.ts`
Expected: FAIL — `yearTotalsFromMonthly is not exported`

- [ ] **Step 3: Write the implementation**

Append to `lib/domain/exceptions.ts`:

```ts
const INCOME_TYPES: ReadonlySet<AccountType> = new Set<AccountType>(["income", "other_income"]);
const COST_TYPES: ReadonlySet<AccountType> = new Set<AccountType>([
  "cost_of_goods_sold",
  "expense",
  "other_expense",
]);

/**
 * Fold the monthly balance map into one row per calendar year.
 *
 * The map's keys are `YYYY-MM`, so the year is the first four characters. Both
 * sides are netted: a credit note against income and a refund against a cost
 * both belong in the total they reduce.
 */
export function yearTotalsFromMonthly(
  byMonth: ReadonlyMap<string, readonly LedgerBalance[]>,
): YearTotals[] {
  const years = new Map<string, YearTotals>();
  for (const [monthKey, balances] of byMonth) {
    const year = monthKey.slice(0, 4);
    const totals = years.get(year) ?? { year, incomeMinor: 0, costMinor: 0 };
    for (const b of balances) {
      if (INCOME_TYPES.has(b.accountType)) totals.incomeMinor += b.creditBase - b.debitBase;
      else if (COST_TYPES.has(b.accountType)) totals.costMinor += b.debitBase - b.creditBase;
    }
    years.set(year, totals);
  }
  return [...years.values()].sort((x, y) => x.year.localeCompare(y.year));
}

export interface IncomeNoCostRow {
  year: string;
  incomeMinor: number;
  costMinor: number;
}

/**
 * Revenue with nothing spent against it almost always means the period is only
 * part-entered. The profit shown for that year is not a profit.
 */
export function yearsWithIncomeAndNoCost(years: readonly YearTotals[]): IncomeNoCostRow[] {
  return years
    .filter((y) => y.incomeMinor > 0 && y.costMinor === 0)
    .map((y) => ({ year: y.year, incomeMinor: y.incomeMinor, costMinor: y.costMinor }));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/exceptions.test.ts`
Expected: PASS, 26 tests

- [ ] **Step 5: Commit**

```bash
git add ctyhp-accounting/lib/domain/exceptions.ts ctyhp-accounting/tests/unit/exceptions.test.ts
git commit -m "feat(exceptions): a year that earned and never spent"
```

---

### Task 5: Entries recorded more than once

**Files:**
- Modify: `lib/domain/exceptions.ts`
- Modify: `tests/unit/exceptions.test.ts`

**Interfaces:**
- Consumes: `TransactionListRow` (re-exported by Task 1)
- Produces: `duplicateEntries(rows, referenceByEntryId): DuplicateGroup[]`

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/exceptions.test.ts`:

```ts
import { duplicateEntries, type TransactionListRow } from "@/lib/domain/exceptions";

const txn = (over: Partial<TransactionListRow> = {}): TransactionListRow => ({
  entryId: "t1",
  entryNumber: "JE-000001",
  entryDate: "2026-03-04",
  description: "Monthly rent",
  sourceType: "manual",
  partyName: "Harbour Property Ltd",
  categoryLabel: "Rent",
  moneyLabel: "Checking 3388",
  amountMinor: -4_500_00,
  currencyCode: "USD",
  reconciled: false,
  accountIds: ["rent", "checking"],
  ...over,
});

describe("duplicateEntries", () => {
  const noRefs = new Map<string, string>();

  it("groups two entries alike in date, party, accounts and amount", () => {
    const groups = duplicateEntries([txn(), txn({ entryId: "t2", entryNumber: "JE-000002" })], noRefs);
    expect(groups).toHaveLength(1);
    expect(groups[0].entries.map((e) => e.entryId)).toEqual(["t1", "t2"]);
  });

  it("reports nothing when the amounts differ", () => {
    expect(duplicateEntries([txn(), txn({ entryId: "t2", amountMinor: -4_500_01 })], noRefs)).toEqual([]);
  });

  it("reports nothing when the accounts differ", () => {
    expect(
      duplicateEntries([txn(), txn({ entryId: "t2", accountIds: ["rent", "savings"] })], noRefs),
    ).toEqual([]);
  });

  it("does not care what order the accounts arrive in", () => {
    const groups = duplicateEntries(
      [txn(), txn({ entryId: "t2", accountIds: ["checking", "rent"] })],
      noRefs,
    );
    expect(groups).toHaveLength(1);
  });

  it("separates two entries carrying different references", () => {
    const refs = new Map<string, string>([["t1", "1018"], ["t2", "1019"]]);
    expect(duplicateEntries([txn(), txn({ entryId: "t2" })], refs)).toEqual([]);
  });

  it("groups two entries carrying the same reference", () => {
    const refs = new Map<string, string>([["t1", "1018"], ["t2", "1018"]]);
    expect(duplicateEntries([txn(), txn({ entryId: "t2" })], refs)).toHaveLength(1);
  });

  it("treats a missing party the same as another missing party", () => {
    const groups = duplicateEntries(
      [txn({ partyName: null }), txn({ entryId: "t2", partyName: null })],
      noRefs,
    );
    expect(groups).toHaveLength(1);
  });

  it("returns the groups oldest first", () => {
    const groups = duplicateEntries(
      [
        txn({ entryId: "n1", entryDate: "2026-05-01" }),
        txn({ entryId: "n2", entryDate: "2026-05-01" }),
        txn({ entryId: "o1", entryDate: "2026-01-01" }),
        txn({ entryId: "o2", entryDate: "2026-01-01" }),
      ],
      noRefs,
    );
    expect(groups.map((g) => g.entries[0].entryDate)).toEqual(["2026-01-01", "2026-05-01"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/exceptions.test.ts`
Expected: FAIL — `duplicateEntries is not exported`

- [ ] **Step 3: Write the implementation**

Append to `lib/domain/exceptions.ts`:

```ts
export interface DuplicateGroup {
  /** Stable across renders, so the table can key rows by it. */
  key: string;
  entries: TransactionListRow[];
}

/**
 * Same date, same name, same reference, same accounts, same amount.
 *
 * The reference is the document's own — a cheque number, a wire reference —
 * never `entry_number`, which is unique by definition and would stop this check
 * ever firing.
 *
 * Repeated wages on one day are normal when several people are paid the same;
 * the same supplier paid twice usually is not.
 */
export function duplicateEntries(
  rows: readonly TransactionListRow[],
  referenceByEntryId: ReadonlyMap<string, string>,
): DuplicateGroup[] {
  const groups = new Map<string, TransactionListRow[]>();
  for (const r of rows) {
    const key = [
      r.entryDate,
      r.partyName ?? "",
      referenceByEntryId.get(r.entryId) ?? "",
      [...r.accountIds].sort().join(","),
      String(r.amountMinor),
    ].join("|");
    const bucket = groups.get(key);
    if (bucket) bucket.push(r);
    else groups.set(key, [r]);
  }
  return [...groups.entries()]
    .filter(([, entries]) => entries.length > 1)
    .map(([key, entries]) => ({ key, entries }))
    .sort((x, y) => x.entries[0].entryDate.localeCompare(y.entries[0].entryDate));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/exceptions.test.ts`
Expected: PASS, 34 tests

- [ ] **Step 5: Commit**

```bash
git add ctyhp-accounting/lib/domain/exceptions.ts ctyhp-accounting/tests/unit/exceptions.test.ts
git commit -m "feat(exceptions): entries that look posted twice"
```

---

### Task 6: Entries dated in the future

The service will only read entries after today, but the check re-filters anyway. A check that trusts its caller is a check that stops working the day the caller changes.

**Files:**
- Modify: `lib/domain/exceptions.ts`
- Modify: `tests/unit/exceptions.test.ts`

**Interfaces:**
- Consumes: `TransactionListRow`
- Produces: `futureDatedEntries(rows, today): TransactionListRow[]`

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/exceptions.test.ts`:

```ts
import { futureDatedEntries } from "@/lib/domain/exceptions";

describe("futureDatedEntries", () => {
  it("flags an entry dated after today", () => {
    const rows = futureDatedEntries([txn({ entryDate: "2027-01-04" })], "2026-09-26");
    expect(rows).toHaveLength(1);
  });

  it("leaves today's own entries alone", () => {
    expect(futureDatedEntries([txn({ entryDate: "2026-09-26" })], "2026-09-26")).toEqual([]);
  });

  it("leaves the past alone", () => {
    expect(futureDatedEntries([txn({ entryDate: "2026-09-25" })], "2026-09-26")).toEqual([]);
  });

  it("returns the soonest first", () => {
    const rows = futureDatedEntries(
      [txn({ entryId: "b", entryDate: "2027-05-01" }), txn({ entryId: "a", entryDate: "2026-12-01" })],
      "2026-09-26",
    );
    expect(rows.map((r) => r.entryId)).toEqual(["a", "b"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/exceptions.test.ts`
Expected: FAIL — `futureDatedEntries is not exported`

- [ ] **Step 3: Write the implementation**

Append to `lib/domain/exceptions.ts`:

```ts
/**
 * Dated after today. Usually a typing slip in the year.
 *
 * Re-filtered here even though the read is already windowed, so the check
 * stands on its own and cannot be widened by a change to its caller.
 */
export function futureDatedEntries(
  rows: readonly TransactionListRow[],
  today: string,
): TransactionListRow[] {
  return rows
    .filter((r) => r.entryDate > today)
    .sort((x, y) => x.entryDate.localeCompare(y.entryDate));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/exceptions.test.ts`
Expected: PASS, 38 tests

- [ ] **Step 5: Commit**

```bash
git add ctyhp-accounting/lib/domain/exceptions.ts ctyhp-accounting/tests/unit/exceptions.test.ts
git commit -m "feat(exceptions): entries dated after today"
```

---

### Task 7: A cheque number used twice on one account

**Files:**
- Modify: `lib/domain/exceptions.ts`
- Modify: `tests/unit/exceptions.test.ts`

**Interfaces:**
- Consumes: `ExceptionPaymentRef` from Task 1
- Produces: `chequeNumbersUsedTwice(payments): ChequeClash[]`

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/exceptions.test.ts`:

```ts
import { chequeNumbersUsedTwice, type ExceptionPaymentRef } from "@/lib/domain/exceptions";

const pay = (over: Partial<ExceptionPaymentRef> = {}): ExceptionPaymentRef => ({
  paymentId: "p1",
  kind: "vendor",
  paymentNumber: "BP-000001",
  paymentDate: "2026-04-02",
  reference: "1018",
  accountId: "checking",
  accountName: "Checking 3388",
  partyName: "Northwood Metals",
  amountMinor: 30_000_00,
  ...over,
});

describe("chequeNumbersUsedTwice", () => {
  it("flags one number against one account twice", () => {
    const rows = chequeNumbersUsedTwice([pay(), pay({ paymentId: "p2", partyName: "Someone else" })]);
    expect(rows).toHaveLength(1);
    expect(rows[0].reference).toBe("1018");
    expect(rows[0].payments).toHaveLength(2);
  });

  it("does not flag the same number in two different cheque books", () => {
    const rows = chequeNumbersUsedTwice([
      pay(),
      pay({ paymentId: "p2", accountId: "savings", accountName: "Savings 6764" }),
    ]);
    expect(rows).toEqual([]);
  });

  it("ignores payments carrying no reference", () => {
    const rows = chequeNumbersUsedTwice([
      pay({ reference: "" }),
      pay({ paymentId: "p2", reference: "   " }),
    ]);
    expect(rows).toEqual([]);
  });

  it("treats surrounding spaces as the same number", () => {
    const rows = chequeNumbersUsedTwice([pay(), pay({ paymentId: "p2", reference: " 1018 " })]);
    expect(rows).toHaveLength(1);
  });

  it("matches a customer payment against a vendor payment on one account", () => {
    const rows = chequeNumbersUsedTwice([pay(), pay({ paymentId: "p2", kind: "customer" })]);
    expect(rows).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/exceptions.test.ts`
Expected: FAIL — `chequeNumbersUsedTwice is not exported`

- [ ] **Step 3: Write the implementation**

Append to `lib/domain/exceptions.ts`:

```ts
export interface ChequeClash {
  accountId: string;
  accountName: string;
  reference: string;
  payments: ExceptionPaymentRef[];
}

/**
 * Counted per bank account on purpose, so the same number in two different
 * cheque books is not flagged. Two entries against one number on one account
 * means one of them is miscoded, or the cheque was reissued.
 */
export function chequeNumbersUsedTwice(
  payments: readonly ExceptionPaymentRef[],
): ChequeClash[] {
  const groups = new Map<string, ExceptionPaymentRef[]>();
  for (const p of payments) {
    const reference = p.reference.trim();
    if (reference === "") continue;
    const key = `${p.accountId}|${reference}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(p);
    else groups.set(key, [p]);
  }
  return [...groups.values()]
    .filter((ps) => ps.length > 1)
    .map((ps) => ({
      accountId: ps[0].accountId,
      accountName: ps[0].accountName,
      reference: ps[0].reference.trim(),
      payments: [...ps].sort((x, y) => x.paymentDate.localeCompare(y.paymentDate)),
    }))
    .sort(
      (x, y) =>
        x.accountName.localeCompare(y.accountName) || x.reference.localeCompare(y.reference),
    );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/exceptions.test.ts`
Expected: PASS, 43 tests

- [ ] **Step 5: Commit**

```bash
git add ctyhp-accounting/lib/domain/exceptions.ts ctyhp-accounting/tests/unit/exceptions.test.ts
git commit -m "feat(exceptions): one cheque number, used twice on one account"
```

---

### Task 8: Assemble the report, and prove the module cannot write

**Files:**
- Modify: `lib/domain/exceptions.ts`
- Modify: `tests/unit/exceptions.test.ts`

**Interfaces:**
- Consumes: every check function from Tasks 1–7
- Produces: `ExceptionReportInput`, `ExceptionReport`, `buildExceptionReport(input): ExceptionReport`

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/exceptions.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { buildExceptionReport, type ExceptionReportInput } from "@/lib/domain/exceptions";

const emptyInput = (over: Partial<ExceptionReportInput> = {}): ExceptionReportInput => ({
  to: "2026-09-30",
  today: "2026-09-26",
  accounts: [],
  undepositedDetails: new Map(),
  bankAccounts: [],
  yearTotals: [],
  entriesInRange: [],
  entriesAfterToday: [],
  paymentReferences: [],
  unavailable: [],
  ...over,
});

describe("buildExceptionReport", () => {
  it("runs eight checks and raises nothing on an empty book", () => {
    const report = buildExceptionReport(emptyInput());
    expect(report.checksRun).toBe(8);
    expect(report.questionsRaised).toBe(0);
    expect(report.entriesExamined).toBe(0);
    expect(report.unavailable).toEqual([]);
  });

  it("carries through the checks whose data could not be read", () => {
    const report = buildExceptionReport(
      emptyInput({
        unavailable: ["incomeNoCost"],
        accounts: [account({ accountCode: "9000", name: "Suspense", accountType: "current_asset", debitBase: 12_00 })],
      }),
    );
    expect(report.unavailable).toEqual(["incomeNoCost"]);
    // The other seven still ran.
    expect(report.holding).toHaveLength(1);
  });

  it("counts the entries it examined from the range, not from every read", () => {
    const report = buildExceptionReport(
      emptyInput({ entriesInRange: [txn(), txn({ entryId: "t2" })], entriesAfterToday: [txn({ entryId: "t3", entryDate: "2027-01-01" })] }),
    );
    expect(report.entriesExamined).toBe(2);
  });

  it("adds every check's findings into one count of questions", () => {
    const report = buildExceptionReport(
      emptyInput({
        accounts: [
          account({ accountId: "h", accountCode: "9000", name: "Uncategorized Expense", accountType: "expense", debitBase: 475_000_00 }),
        ],
        entriesAfterToday: [txn({ entryId: "f1", entryDate: "2027-01-01" })],
      }),
    );
    // one holding account, one wrong-way balance it is not, one future entry
    expect(report.holding).toHaveLength(1);
    expect(report.futureDated).toHaveLength(1);
    expect(report.questionsRaised).toBe(2);
  });

  it("derives the bank balance lookup from the accounts it was given", () => {
    const report = buildExceptionReport(
      emptyInput({
        accounts: [account({ accountId: "a1", accountType: "bank", debitBase: 96_293_85 })],
        bankAccounts: [{ bankAccountId: "b1", accountId: "a1", accountName: "Checking 3388", lastReconciledDate: null }],
      }),
    );
    expect(report.unreconciled).toHaveLength(1);
    expect(report.unreconciled[0].balanceMinor).toBe(96_293_85);
  });
});

describe("the exceptions module", () => {
  it("imports nothing that could write to the books", () => {
    const source = readFileSync("lib/domain/exceptions.ts", "utf8");
    const imported = [...source.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    expect(imported.filter((p) => p.startsWith("@/lib/db/") || p.startsWith("@/lib/services/"))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/exceptions.test.ts`
Expected: FAIL — `buildExceptionReport is not exported`

- [ ] **Step 3: Write the implementation**

Append to `lib/domain/exceptions.ts`:

```ts
/* ---------------------------------------------------------------- report */

export interface ExceptionReportInput {
  /** The as-of date every balance check reads at. */
  to: string;
  /** Supplied, never read from the clock, so the checks are deterministic. */
  today: string;
  accounts: readonly ExceptionAccount[];
  undepositedDetails: ReadonlyMap<string, UndepositedDetail>;
  bankAccounts: readonly ExceptionBankAccount[];
  yearTotals: readonly YearTotals[];
  entriesInRange: readonly TransactionListRow[];
  entriesAfterToday: readonly TransactionListRow[];
  paymentReferences: readonly ExceptionPaymentRef[];
  /**
   * Checks whose data could not be read. They are reported as unavailable
   * rather than as "nothing found", because a check that could not run and a
   * check that found nothing are opposite answers.
   */
  unavailable: readonly CheckKey[];
}

export interface ExceptionReport {
  entriesExamined: number;
  questionsRaised: number;
  checksRun: 8;
  unavailable: CheckKey[];
  duplicates: DuplicateGroup[];
  chequeClashes: ChequeClash[];
  undeposited: UndepositedRow[];
  wrongWay: WrongWayRow[];
  incomeNoCost: IncomeNoCostRow[];
  unreconciled: UnreconciledRow[];
  futureDated: TransactionListRow[];
  holding: HoldingRow[];
}

/**
 * The reference a duplicate is judged by, keyed on the entry that produced it.
 *
 * A payment's journal entry is the one the transaction list shows, so the
 * reference travels with the entry id.
 */
function referencesByEntry(
  payments: readonly ExceptionPaymentRef[],
  entries: readonly TransactionListRow[],
): Map<string, string> {
  const byNumber = new Map<string, string>();
  for (const p of payments) {
    if (p.paymentNumber) byNumber.set(p.paymentNumber, p.reference);
  }
  const out = new Map<string, string>();
  for (const e of entries) {
    const reference = byNumber.get(e.entryNumber);
    if (reference) out.set(e.entryId, reference);
  }
  return out;
}

/** Run all eight. Nothing here reads a clock, a database or a file. */
export function buildExceptionReport(input: ExceptionReportInput): ExceptionReport {
  const balanceByAccountId = new Map<string, number>(
    input.accounts.map((a) => [a.accountId, a.debitBase - a.creditBase]),
  );

  const duplicates = duplicateEntries(
    input.entriesInRange,
    referencesByEntry(input.paymentReferences, input.entriesInRange),
  );
  const chequeClashes = chequeNumbersUsedTwice(input.paymentReferences);
  const undeposited = undepositedFunds(input.accounts, input.undepositedDetails);
  const wrongWay = wrongWayBalances(input.accounts);
  const incomeNoCost = yearsWithIncomeAndNoCost(input.yearTotals);
  const unreconciled = unreconciledBankAccounts(input.bankAccounts, balanceByAccountId, input.to);
  const futureDated = futureDatedEntries(input.entriesAfterToday, input.today);
  const holding = holdingAccounts(input.accounts);

  return {
    entriesExamined: input.entriesInRange.length,
    questionsRaised:
      duplicates.length +
      chequeClashes.length +
      undeposited.length +
      wrongWay.length +
      incomeNoCost.length +
      unreconciled.length +
      futureDated.length +
      holding.length,
    checksRun: 8,
    unavailable: [...input.unavailable],
    duplicates,
    chequeClashes,
    undeposited,
    wrongWay,
    incomeNoCost,
    unreconciled,
    futureDated,
    holding,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/exceptions.test.ts`
Expected: PASS, 49 tests

- [ ] **Step 5: Run the type checker**

Run: `npm run typecheck`
Expected: no output, exit 0

- [ ] **Step 6: Commit**

```bash
git add ctyhp-accounting/lib/domain/exceptions.ts ctyhp-accounting/tests/unit/exceptions.test.ts
git commit -m "feat(exceptions): the eight checks in one report, and a test that it cannot write"
```

---

### Task 9: The service — five reads and nothing else

**Files:**
- Create: `lib/services/exceptions.ts`

**Interfaces:**
- Consumes: `buildExceptionReport` and the input types from Task 8; `listAccounts` from `@/lib/services/accounts`; `listBankAccounts` from `@/lib/services/banking`; `getLedgerBalances`, `getTransactionList`, `getMonthlyLedgerBalances` from `@/lib/services/reports`
- Produces: `getExceptionReport(sb, from, to, today): Promise<ExceptionReport>`, `ExceptionsError`

- [ ] **Step 1: Write the service**

Create `lib/services/exceptions.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildExceptionReport,
  yearTotalsFromMonthly,
  type CheckKey,
  type ExceptionAccount,
  type ExceptionBankAccount,
  type ExceptionPaymentRef,
  type ExceptionReport,
  type UndepositedDetail,
} from "@/lib/domain/exceptions";
import type { AccountRow } from "@/lib/db/types";
import type { LedgerBalance } from "@/lib/domain/reports";
import type { TransactionListRow } from "@/lib/domain/transaction-list";
import { listAccounts } from "@/lib/services/accounts";
import { listBankAccounts, type BankAccountWithGl } from "@/lib/services/banking";
import {
  getLedgerBalances,
  getMonthlyLedgerBalances,
  getTransactionList,
} from "@/lib/services/reports";

/**
 * Reading what the Exception Report needs.
 *
 * Every call in this file is a read. There is no insert, update, delete or
 * posting RPC here, and there must never be one: the report is designed to be
 * safe to run on live books at any time, including inside a closed period.
 */
export class ExceptionsError extends Error {}

const UNDEPOSITED_NAME = /undeposited/i;
const UNDEPOSITED_CODE = "1210";

/**
 * Run one read; if it fails, record which checks lose their data and carry on.
 *
 * Seven working checks are worth more than a blank page, and a reader must be
 * told which one is missing rather than left to read "nothing found" as an
 * answer. Failures are collected into `failed`, which the report carries.
 */
async function readOr<T>(
  failed: CheckKey[],
  checks: readonly CheckKey[],
  fallback: T,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch {
    for (const c of checks) if (!failed.includes(c)) failed.push(c);
    return fallback;
  }
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole months from `from` to `to` inclusive, which is what the RPC counts back. */
function monthSpan(from: string, to: string): number {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return Math.max((ty - fy) * 12 + (tm - fm) + 1, 1);
}

/** The latest completed statement date for each bank account, in one read. */
async function lastReconciledByBankAccount(
  sb: SupabaseClient,
): Promise<Map<string, string>> {
  const { data, error } = await sb
    .from("acc_statement_reconciliation")
    .select("bank_account_id,statement_ending_date")
    .eq("status", "completed");
  if (error) throw new ExceptionsError(error.message);
  const latest = new Map<string, string>();
  for (const r of (data ?? []) as { bank_account_id: string; statement_ending_date: string }[]) {
    const seen = latest.get(r.bank_account_id);
    if (!seen || r.statement_ending_date > seen) latest.set(r.bank_account_id, r.statement_ending_date);
  }
  return latest;
}

/** The earliest posted entry, which is where the per-year check has to start. */
async function earliestEntryDate(sb: SupabaseClient): Promise<string | null> {
  const { data, error } = await sb
    .from("acc_journal_entry")
    .select("entry_date")
    .eq("status", "posted")
    .order("entry_date", { ascending: true })
    .limit(1);
  if (error) throw new ExceptionsError(error.message);
  const rows = (data ?? []) as { entry_date: string }[];
  return rows.length > 0 ? rows[0].entry_date : null;
}

/** Every payment carrying the reference a statement is reconciled by. */
async function paymentReferences(sb: SupabaseClient): Promise<ExceptionPaymentRef[]> {
  // `acc_account` needs no disambiguating hint: each of these tables has
  // exactly one foreign key to it (`deposit_account_id`, `payment_account_id`).
  const [customer, vendor] = await Promise.all([
    sb
      .from("acc_payment")
      .select("id,payment_number,payment_date,reference,amount_minor,deposit_account_id,acc_customer(name),acc_account(name)")
      .not("reference", "is", null),
    sb
      .from("acc_bill_payment")
      .select("id,payment_number,payment_date,reference,amount_minor,payment_account_id,acc_vendor(name),acc_account(name)")
      .not("reference", "is", null),
  ]);
  if (customer.error) throw new ExceptionsError(customer.error.message);
  if (vendor.error) throw new ExceptionsError(vendor.error.message);

  const named = (v: unknown): string => (v as { name?: string } | null)?.name ?? "";

  const out: ExceptionPaymentRef[] = [];
  for (const r of (customer.data ?? []) as Record<string, unknown>[]) {
    out.push({
      paymentId: r.id as string,
      kind: "customer",
      paymentNumber: (r.payment_number as string | null) ?? null,
      paymentDate: r.payment_date as string,
      reference: (r.reference as string | null) ?? "",
      accountId: r.deposit_account_id as string,
      accountName: named(r.acc_account),
      partyName: named(r.acc_customer),
      amountMinor: Number(r.amount_minor),
    });
  }
  for (const r of (vendor.data ?? []) as Record<string, unknown>[]) {
    out.push({
      paymentId: r.id as string,
      kind: "vendor",
      paymentNumber: (r.payment_number as string | null) ?? null,
      paymentDate: r.payment_date as string,
      reference: (r.reference as string | null) ?? "",
      accountId: r.payment_account_id as string,
      accountName: named(r.acc_account),
      partyName: named(r.acc_vendor),
      amountMinor: Number(r.amount_minor),
    });
  }
  return out;
}

/**
 * How many entries have touched a holding account, and since when.
 *
 * Only asked about accounts that actually carry a balance, so the common case —
 * an undeposited funds account that empties as it should — costs nothing.
 */
async function undepositedDetails(
  sb: SupabaseClient,
  accountIds: readonly string[],
  to: string,
): Promise<Map<string, UndepositedDetail>> {
  const details = new Map<string, UndepositedDetail>();
  for (const accountId of accountIds) {
    const { data, error } = await sb
      .from("acc_journal_line")
      .select("journal_entry_id,acc_journal_entry!inner(entry_date,status)")
      .eq("account_id", accountId)
      .eq("acc_journal_entry.status", "posted")
      .lte("acc_journal_entry.entry_date", to);
    if (error) throw new ExceptionsError(error.message);
    const rows = (data ?? []) as { acc_journal_entry: { entry_date: string } }[];
    const dates = rows.map((r) => r.acc_journal_entry.entry_date).sort();
    details.set(accountId, {
      entryCount: rows.length,
      oldestEntryDate: dates.length > 0 ? dates[0] : null,
    });
  }
  return details;
}

/**
 * The whole report.
 *
 * `today` is passed in rather than read here, so a caller — and a test — can
 * say what "today" means.
 */
export async function getExceptionReport(
  sb: SupabaseClient,
  from: string,
  to: string,
  today: string,
): Promise<ExceptionReport> {
  const unavailable: CheckKey[] = [];
  /** The checks that read balances: without them there is nothing to judge. */
  const BALANCE_CHECKS: readonly CheckKey[] = ["undeposited", "wrongWay", "holding", "unreconciled"];

  const [accountRows, balances, entriesInRange, entriesAfterToday, banks, lastReconciled, earliest] =
    await Promise.all([
      readOr(unavailable, BALANCE_CHECKS, [] as AccountRow[], () => listAccounts(sb)),
      readOr(unavailable, BALANCE_CHECKS, [] as LedgerBalance[], () =>
        getLedgerBalances(sb, null, to),
      ),
      readOr(unavailable, ["duplicates"], [] as TransactionListRow[], () =>
        getTransactionList(sb, from, to),
      ),
      readOr(unavailable, ["futureDated"], [] as TransactionListRow[], () =>
        getTransactionList(sb, addDays(today, 1), "9999-12-31"),
      ),
      readOr(unavailable, ["unreconciled"], [] as BankAccountWithGl[], () => listBankAccounts(sb)),
      readOr(unavailable, ["unreconciled"], new Map<string, string>(), () =>
        lastReconciledByBankAccount(sb),
      ),
      readOr(unavailable, ["incomeNoCost"], null as string | null, () => earliestEntryDate(sb)),
    ]);

  const detailByAccountId = new Map(accountRows.map((a) => [a.id, a]));
  const accounts: ExceptionAccount[] = balances.map((b: LedgerBalance) => ({
    accountId: b.accountId,
    accountCode: b.accountCode,
    name: b.name,
    accountType: b.accountType,
    detailType: detailByAccountId.get(b.accountId)?.detail_type ?? null,
    debitBase: b.debitBase,
    creditBase: b.creditBase,
  }));

  const holdingIds = accounts
    .filter(
      (a) =>
        a.debitBase - a.creditBase !== 0 &&
        (UNDEPOSITED_NAME.test(a.name) || a.accountCode === UNDEPOSITED_CODE),
    )
    .map((a) => a.accountId);

  const [refs, details, byMonth] = await Promise.all([
    readOr(unavailable, ["cheque"], [] as ExceptionPaymentRef[], () => paymentReferences(sb)),
    readOr(unavailable, [], new Map<string, UndepositedDetail>(), () =>
      undepositedDetails(sb, holdingIds, to),
    ),
    readOr(unavailable, ["incomeNoCost"], new Map<string, LedgerBalance[]>(), () =>
      earliest === null
        ? Promise.resolve(new Map<string, LedgerBalance[]>())
        : getMonthlyLedgerBalances(sb, to, monthSpan(earliest, to)),
    ),
  ]);

  const bankAccounts: ExceptionBankAccount[] = banks.map((b) => ({
    bankAccountId: b.id,
    accountId: b.account_id,
    accountName: b.account_name || b.bank_name,
    lastReconciledDate: lastReconciled.get(b.id) ?? null,
  }));

  return buildExceptionReport({
    to,
    today,
    accounts,
    undepositedDetails: details,
    bankAccounts,
    yearTotals: yearTotalsFromMonthly(byMonth),
    entriesInRange,
    entriesAfterToday,
    paymentReferences: refs,
    unavailable,
  });
}
```

Note the empty check list on `undepositedDetails`: when it fails the check still runs, it simply shows no entry count or oldest date. A degraded row is honest; calling the whole check unavailable would not be.

- [ ] **Step 2: Type-check**

Run: `npm run typecheck`
Expected: no output, exit 0.

If the foreign-key hint names in `paymentReferences` are rejected at runtime later, the constraint names are visible with:
`grep -rn "deposit_account_id\|payment_account_id" supabase/migrations/0005_invoicing.sql supabase/migrations/0011_payables.sql`

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no errors for `lib/services/exceptions.ts`

- [ ] **Step 4: Commit**

```bash
git add ctyhp-accounting/lib/services/exceptions.ts
git commit -m "feat(exceptions): five reads, and no way to write"
```

---

### Task 10: The screen

**Files:**
- Create: `app/(app)/reports/exceptions/page.tsx`
- Create: `app/(app)/reports/exceptions/actions.ts`
- Create: `app/(app)/reports/exceptions/ExceptionsClient.tsx`
- Modify: `lib/domain/report-catalog.ts`

**Interfaces:**
- Consumes: `getExceptionReport`, `ExceptionsError` from Task 9
- Produces: `exceptionReportAction(from, to): Promise<ActionResult<ExceptionReport>>`

- [ ] **Step 1: Write the server action**

Create `app/(app)/reports/exceptions/actions.ts`:

```ts
"use server";
import { createSupabaseServerClient } from "@/lib/db/server";
import { ExceptionsError, getExceptionReport } from "@/lib/services/exceptions";
import type { ExceptionReport } from "@/lib/domain/exceptions";

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

function messageFrom(e: unknown): string {
  return e instanceof ExceptionsError || e instanceof Error
    ? e.message
    : "An unexpected error occurred";
}

/**
 * The only verb this screen has. It reads and returns; there is nothing here
 * that changes a figure, and nothing should ever be added that does.
 */
export async function exceptionReportAction(
  from: string,
  to: string,
): Promise<ActionResult<ExceptionReport>> {
  try {
    const sb = await createSupabaseServerClient();
    const today = new Date().toISOString().slice(0, 10);
    return { ok: true, data: await getExceptionReport(sb, from, to, today) };
  } catch (e) {
    return { ok: false, error: messageFrom(e) };
  }
}
```

- [ ] **Step 2: Write the page**

Create `app/(app)/reports/exceptions/page.tsx`:

```tsx
import { createSupabaseServerClient } from "@/lib/db/server";
import { listCurrencies } from "@/lib/services/reference";
import { getCurrentCompanySettings } from "@/lib/services/company";
import { resolveActiveCompany } from "@/lib/db/company";
import ReportEntityBadge from "@/components/reports/ReportEntityBadge";
import PageHeader from "@/components/PageHeader";
import ExceptionsClient from "./ExceptionsClient";

export const dynamic = "force-dynamic";

export default async function ExceptionsPage() {
  const sb = await createSupabaseServerClient();
  const entity = await resolveActiveCompany();
  const [currencies, company] = await Promise.all([
    listCurrencies(sb),
    getCurrentCompanySettings(sb),
  ]);
  const base = currencies.find((c) => c.is_base);
  return (
    <div>
      <PageHeader
        meta={
          <ReportEntityBadge
            companyName={entity.active?.dbaName || entity.active?.legalName || "No company selected"}
            isSample={entity.active?.isSample ?? false}
          />
        }
        title="Exception Report"
        description="The checks a reviewer runs by hand. Nothing here changes a figure."
      />
      <ExceptionsClient
        companyName={company?.legal_name ?? "Company name not set"}
        baseCurrency={base?.code ?? "USD"}
        baseDecimals={base?.decimal_places ?? 2}
      />
    </div>
  );
}
```

- [ ] **Step 3: Write the client**

Create `app/(app)/reports/exceptions/ExceptionsClient.tsx`:

```tsx
"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Alert, Button, DatePicker, Space, Statistic, Table, Tag, Typography } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { fromMinor } from "@/lib/domain/money";
import { ACCOUNT_TYPE_LABEL } from "@/lib/domain/accounts";
import { csvWithReportIdentity } from "@/lib/domain/report-export";
import {
  CHECK_LABEL,
  type CheckKey,
  type ExceptionReport,
  type TransactionListRow,
} from "@/lib/domain/exceptions";
import { exceptionReportAction } from "./actions";

/**
 * The Exception Report.
 *
 * Every section is drawn, including the ones with nothing in them: a reviewer
 * has to see that a check ran, not watch it disappear. Nothing on this screen
 * writes.
 */
export default function ExceptionsClient({
  companyName,
  baseCurrency,
  baseDecimals,
}: {
  companyName: string;
  baseCurrency: string;
  baseDecimals: number;
}) {
  const [from, setFrom] = useState<Dayjs>(dayjs().startOf("year"));
  const [to, setTo] = useState<Dayjs>(dayjs());
  const [report, setReport] = useState<ExceptionReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const money = useCallback(
    (minor: number) =>
      fromMinor(minor, baseDecimals).toLocaleString(undefined, {
        minimumFractionDigits: baseDecimals,
        maximumFractionDigits: baseDecimals,
      }),
    [baseDecimals],
  );

  const run = useCallback(async () => {
    if (from.isAfter(to)) {
      setError("The start date is after the end date.");
      return;
    }
    setLoading(true);
    setError(null);
    const result = await exceptionReportAction(from.format("YYYY-MM-DD"), to.format("YYYY-MM-DD"));
    setLoading(false);
    if (!result.ok || !result.data) {
      setError(result.error ?? "The report could not be produced.");
      setReport(null);
      return;
    }
    setReport(result.data);
  }, [from, to]);

  useEffect(() => {
    void run();
    // Run once on arrival; afterwards the button is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const entryLink = (row: TransactionListRow) => (
    <Link href={`/reports/journal?entry=${row.entryId}`}>{row.entryNumber}</Link>
  );

  const exportCsv = () => {
    if (!report) return;
    const lines: string[] = ["Check,Date,Reference,Name,Account,Amount"];
    const push = (check: string, date: string, ref: string, name: string, acct: string, amount: string) =>
      lines.push([check, date, ref, name, acct, amount].map((v) => (/[",\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v)).join(","));

    report.duplicates.forEach((g) =>
      g.entries.forEach((e) =>
        push("Recorded more than once", e.entryDate, e.entryNumber, e.partyName ?? "", e.categoryLabel ?? "", money(e.amountMinor)),
      ),
    );
    report.chequeClashes.forEach((c) =>
      c.payments.forEach((p) =>
        push("Cheque number used twice", p.paymentDate, p.reference, p.partyName, c.accountName, money(p.amountMinor)),
      ),
    );
    report.undeposited.forEach((u) =>
      push("Received but not banked", u.oldestEntryDate ?? "", "", "", u.name, money(u.balanceMinor)),
    );
    report.wrongWay.forEach((w) =>
      push("Balance pointing the wrong way", to.format("YYYY-MM-DD"), w.accountCode, ACCOUNT_TYPE_LABEL[w.accountType], w.name, money(w.balanceMinor)),
    );
    report.incomeNoCost.forEach((y) =>
      push("Income with no costs", `${y.year}-12-31`, y.year, "", "", money(y.incomeMinor)),
    );
    report.unreconciled.forEach((u) =>
      push("Not agreed to a statement", u.lastReconciledDate ?? "never", "", "", u.accountName, money(u.balanceMinor)),
    );
    report.futureDated.forEach((e) =>
      push("Dated in the future", e.entryDate, e.entryNumber, e.partyName ?? "", e.categoryLabel ?? "", money(e.amountMinor)),
    );
    report.holding.forEach((h) =>
      push("Still in a holding account", to.format("YYYY-MM-DD"), h.accountCode, "", h.name, money(h.balanceMinor)),
    );

    const csv = csvWithReportIdentity(lines.join("\n"), {
      companyName,
      title: "Exception Report",
      subtitle: `${from.format("YYYY-MM-DD")} to ${to.format("YYYY-MM-DD")}`,
      currencyCode: baseCurrency,
    });
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "exception-report.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  /**
   * One section.
   *
   * A check whose data could not be read says so. "Nothing found" would be a
   * different answer, and the wrong one.
   */
  const section = (
    check: CheckKey,
    count: number,
    why: string,
    body: React.ReactNode,
    allDates = false,
  ) => {
    const missing = report?.unavailable.includes(check) ?? false;
    return (
      <div key={check} style={{ marginBottom: 28 }}>
        <Space align="center" wrap style={{ marginBottom: 6 }}>
          <Typography.Text strong>{CHECK_LABEL[check]}</Typography.Text>
          {allDates ? <Tag>All dates</Tag> : null}
          {missing ? (
            <Tag color="orange">Could not run</Tag>
          ) : count > 0 ? (
            <Tag color="volcano">{count} to look at</Tag>
          ) : (
            <Tag color="green">Nothing found</Tag>
          )}
        </Space>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 10 }}>
          {why}
        </Typography.Paragraph>
        {missing ? (
          <Typography.Text type="secondary">
            This check could not be run, so it is not saying the books are clear.
          </Typography.Text>
        ) : count > 0 ? (
          body
        ) : (
          <Typography.Text type="secondary">No exceptions.</Typography.Text>
        )}
      </div>
    );
  };

  return (
    <div>
      <Space wrap style={{ marginBottom: 20 }}>
        <DatePicker value={from} onChange={(d) => d && setFrom(d)} allowClear={false} />
        <DatePicker value={to} onChange={(d) => d && setTo(d)} allowClear={false} />
        <Button type="primary" onClick={() => void run()} loading={loading}>
          Run
        </Button>
        <Button onClick={exportCsv} disabled={!report}>
          Export CSV
        </Button>
      </Space>

      {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 20 }} /> : null}

      {report && report.unavailable.length > 0 ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 20 }}
          message={`${report.unavailable.length} of 8 checks could not be run`}
          description={
            <>
              {report.unavailable.map((c) => CHECK_LABEL[c]).join("; ")}. The rest of the report is
              complete. A check that could not run is not saying the books are clear.
            </>
          }
        />
      ) : null}

      {report ? (
        <>
          <Space size="large" wrap style={{ marginBottom: 24 }}>
            <Statistic title="Entries examined" value={report.entriesExamined} />
            <Statistic
              title="Questions raised"
              value={report.questionsRaised}
              valueStyle={report.questionsRaised > 0 ? { color: "#cf1322" } : undefined}
            />
            <Statistic title="Checks run" value={report.checksRun} />
          </Space>

          {section(
            "duplicates",
            report.duplicates.length,
            "Same date, same name, same reference, same accounts, same amount. Repeated wages on one day are normal when several people are paid the same; the same supplier paid twice usually is not.",
            <Table
              size="small"
              pagination={false}
              rowKey={(r) => r.entryId}
              dataSource={report.duplicates.flatMap((g) => g.entries)}
              columns={[
                { title: "Date", dataIndex: "entryDate", width: 110 },
                { title: "Entry", render: (_, r) => entryLink(r), width: 130 },
                { title: "Name", dataIndex: "partyName", ellipsis: true },
                { title: "Split", dataIndex: "categoryLabel", ellipsis: true },
                { title: "Amount", align: "right" as const, width: 140, render: (_, r) => money(r.amountMinor) },
              ]}
            />,
          )}

          {section(
            "cheque",
            report.chequeClashes.length,
            "Counted per bank account, so the same number in two different cheque books is not flagged. Two entries against one number on one account means one of them is miscoded, or the cheque was reissued.",
            <Table
              size="small"
              pagination={false}
              rowKey={(r) => r.paymentId}
              dataSource={report.chequeClashes.flatMap((c) => c.payments)}
              columns={[
                { title: "Account", dataIndex: "accountName", ellipsis: true },
                { title: "Number", dataIndex: "reference", width: 120 },
                { title: "Date", dataIndex: "paymentDate", width: 110 },
                { title: "Name", dataIndex: "partyName", ellipsis: true },
                { title: "Amount", align: "right" as const, width: 140, render: (_, r) => money(r.amountMinor) },
              ]}
            />,
          )}

          {section(
            "undeposited",
            report.undeposited.length,
            "Undeposited funds should empty as takings reach the bank. A balance that keeps growing means the sales are recorded but the deposits are not — revenue is in the books, the cash is not.",
            <Table
              size="small"
              pagination={false}
              rowKey={(r) => r.accountId}
              dataSource={report.undeposited}
              columns={[
                { title: "Account", dataIndex: "name", ellipsis: true },
                { title: "Balance", align: "right" as const, width: 150, render: (_, r) => money(r.balanceMinor) },
                { title: "Entries", dataIndex: "entryCount", width: 90 },
                { title: "Oldest", dataIndex: "oldestEntryDate", width: 120 },
              ]}
            />,
          )}

          {section(
            "wrongWay",
            report.wrongWay.length,
            "An asset in credit or a liability in debit. Sometimes right — an overdrawn account, a supplier overpaid — and sometimes a posting on the wrong side. Contra accounts are left out of this check.",
            <Table
              size="small"
              pagination={false}
              rowKey={(r) => r.accountId}
              dataSource={report.wrongWay}
              columns={[
                { title: "Account", dataIndex: "name", ellipsis: true },
                { title: "Type", width: 180, render: (_, r) => ACCOUNT_TYPE_LABEL[r.accountType] },
                {
                  title: `Balance as of ${to.format("YYYY-MM-DD")}`,
                  align: "right" as const,
                  width: 190,
                  render: (_, r) => money(r.balanceMinor),
                },
              ]}
            />,
          )}

          {section(
            "incomeNoCost",
            report.incomeNoCost.length,
            "Revenue with nothing spent against it almost always means the period is only part-entered. The profit shown for that year is not a profit.",
            <Table
              size="small"
              pagination={false}
              rowKey={(r) => r.year}
              dataSource={report.incomeNoCost}
              columns={[
                { title: "Year", dataIndex: "year", width: 100 },
                { title: "Income", align: "right" as const, width: 170, render: (_, r) => money(r.incomeMinor) },
                { title: "Costs", align: "right" as const, width: 170, render: (_, r) => money(r.costMinor) },
              ]}
            />,
            true,
          )}

          {section(
            "unreconciled",
            report.unreconciled.length,
            "A balance nobody has proved against the bank. Reconcile it on the Banking screen.",
            <Table
              size="small"
              pagination={false}
              rowKey={(r) => r.bankAccountId}
              dataSource={report.unreconciled}
              columns={[
                { title: "Account", dataIndex: "accountName", ellipsis: true },
                { title: "Balance", align: "right" as const, width: 160, render: (_, r) => money(r.balanceMinor) },
                {
                  title: "Last reconciled",
                  width: 150,
                  render: (_, r) => (r.lastReconciledDate ? r.lastReconciledDate : <Tag color="volcano">never</Tag>),
                },
              ]}
            />,
          )}

          {section(
            "futureDated",
            report.futureDated.length,
            "Dated after today. Usually a typing slip in the year.",
            <Table
              size="small"
              pagination={false}
              rowKey={(r) => r.entryId}
              dataSource={report.futureDated}
              columns={[
                { title: "Date", dataIndex: "entryDate", width: 110 },
                { title: "Entry", render: (_, r) => entryLink(r), width: 130 },
                { title: "Name", dataIndex: "partyName", ellipsis: true },
                { title: "Split", dataIndex: "categoryLabel", ellipsis: true },
                { title: "Amount", align: "right" as const, width: 140, render: (_, r) => money(r.amountMinor) },
              ]}
            />,
            true,
          )}

          {section(
            "holding",
            report.holding.length,
            "Anything left in Uncategorized has not been given an account yet, so it is in the wrong place on both statements.",
            <Table
              size="small"
              pagination={false}
              rowKey={(r) => r.accountId}
              dataSource={report.holding}
              columns={[
                { title: "Account", dataIndex: "name", ellipsis: true },
                { title: "Balance", align: "right" as const, width: 170, render: (_, r) => money(r.balanceMinor) },
              ]}
            />,
          )}

          <Typography.Paragraph type="secondary" style={{ marginTop: 28 }}>
            <strong>Nothing here is proof of a mistake.</strong> Each line is a question a reviewer
            would ask, and most have an innocent answer — four wages of the same amount on one day, a
            cheque book that restarts at 1000. What matters is that somebody has looked and can say
            why.
          </Typography.Paragraph>
        </>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Add the catalogue entry**

In `lib/domain/report-catalog.ts`, add this object to `REPORT_CATALOG` immediately after the `gl-posting` entry:

```ts
  {
    id: "exception-report",
    title: "Exception Report",
    description:
      "Eight checks a reviewer runs by hand: entries posted twice, a cheque number reused, a balance pointing the wrong way, anything still uncoded.",
    href: "/reports/exceptions",
    group: "accounting",
  },
```

- [ ] **Step 5: Type-check and lint**

Run: `npm run typecheck && npm run lint`
Expected: exit 0 from both.

- [ ] **Step 6: Commit**

```bash
git add ctyhp-accounting/app/\(app\)/reports/exceptions/page.tsx ctyhp-accounting/app/\(app\)/reports/exceptions/actions.ts ctyhp-accounting/app/\(app\)/reports/exceptions/ExceptionsClient.tsx ctyhp-accounting/lib/domain/report-catalog.ts
git commit -m "feat(exceptions): the report on screen, with every check shown even when it is clear"
```

---

### Task 11: Gates

Nothing new is written here. This task proves the work holds, and it is the one a reviewer can reject on its own.

**Files:**
- Modify: `lib/domain/changelog.ts`

- [ ] **Step 1: Run the whole unit suite**

Run: `npm test`
Expected: all files pass. **Print the whole tail of the output, including the pass/fail summary line.** Do not trim it.

- [ ] **Step 2: Build, then start the server detached**

`scripts/smoke-pages.mjs` must run against a **built** server. A dev server compiles each route on first request and turns a two-minute sweep into half an hour.

Run: `npm run build`
Expected: build succeeds.

Then start it. Started from the Bash tool this server dies and every request fails with `fetch failed`, which reads like a regression and is not one. Start it from PowerShell instead:

```powershell
Start-Process -FilePath "npm" -ArgumentList "start" -WorkingDirectory "C:\Users\pit010\QUICKBOOK_WEBAPP\ctyhp-accounting" -WindowStyle Hidden
```

Wait for `http://localhost:3000` to answer. If it answers on 3001, use that port in the next step.

- [ ] **Step 3: Run the page smoke test**

Run: `node --env-file=.env.local scripts/smoke-pages.mjs http://localhost:3000 --only=/reports/exceptions`
Expected: `/reports/exceptions` returns 200 and does not render the error boundary.

The script discovers routes from `app/(app)`, so the new page is covered with no change to it. This is the gate that catches a server component reading a compound Ant Design export — a bug that passes build, typecheck and lint, and has broken this application before.

Then run the full sweep once: `node --env-file=.env.local scripts/smoke-pages.mjs http://localhost:3000`
Expected: every route 200. This proves the catalogue entry did not break the reports index.

- [ ] **Step 4: Run the table-fit gate**

Run: `npm run verify:table-fit`
Expected: pass. Four new tables were added; every table in this application must fit its frame without sideways scrolling.

If a column overflows, fix it by giving the measured columns explicit widths and letting the text column take the remainder — do not add a horizontal scrollbar.

- [ ] **Step 5: Add the changelog entry**

In `lib/domain/changelog.ts`, add this release to the top of `RELEASES` — the list is newest first, and the current top is `1.61`:

```ts
  {
    version: "1.62",
    date: "2026-09-26",
    headline: "The checks a reviewer runs by hand, in one report.",
    changes: [
      {
        kind: "added",
        title: "Exception Report",
        detail:
          "Eight checks over the books: entries recorded more than once, a cheque number used twice on one account, money received but not yet banked, a balance pointing the wrong way, a year with income and no costs, bank accounts not agreed to a statement, entries dated in the future, and anything still sitting in a holding account. Nothing here is proof of a mistake — each line is a question worth answering.",
        route: "/reports/exceptions",
      },
      {
        kind: "added",
        title: "Every check is shown, even when it finds nothing",
        detail:
          "A check that found nothing says so, and a check that could not run says that instead. The report never changes a figure.",
        route: "/reports/exceptions",
      },
    ],
  },
```

A test proves every `route` named in the changelog exists, so `/reports/exceptions` must be in place before this step.

- [ ] **Step 6: Commit**

```bash
git add ctyhp-accounting/lib/domain/changelog.ts
git commit -m "chore(changelog): 1.62, the Exception Report"
```

- [ ] **Step 7: Report the result**

State plainly: the test count, whether the smoke test and table-fit gate passed, and anything that did not. If a gate failed, say so with its output rather than describing the work as done.

---

## Notes for whoever executes this

- The design document is `docs/superpowers/specs/2026-09-25-exceptions-report-design.md`. Where this plan and that document disagree, the document wins — raise the disagreement rather than choosing.
- `Accounting-System-v3.html` at the repository root is the client's requirements prototype **and** holds real customer ledger data. Do not commit it, do not copy data out of it into tests, and never stage files with `git add -A`.
- These eight checks catch one of the ten problems found in the Pacific Four Nine ledger review. That is expected and is recorded in §1 of the design. Do not add extra checks to close the gap — the client chose this scope deliberately, and the other problems are a separate piece of work.
