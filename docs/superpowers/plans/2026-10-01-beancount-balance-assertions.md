# Balance Assertions in the Beancount Export — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every completed bank reconciliation adds a `balance` line to the Beancount file, carrying the book balance on the statement date as it stood when the reconciliation was completed.

**Architecture:** A new pure module (`lib/domain/beancount-balance.ts`) rebuilds each figure from the bank account's lines, their `posted_at` and `voided_at`, and the reconciliation's `completed_at`. The existing builder (`lib/domain/beancount.ts`) writes the section and moves `open` dates. The service (`lib/services/beancount.ts`) adds four paged reads. The page renders two new line kinds and two summary facts. No migration, nothing posted.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Supabase/PostgREST, Vitest, Ant Design 6, Beancount v3 (`bean-check`, used only in verification).

**Spec:** `docs/superpowers/specs/2026-09-30-beancount-balance-assertions-design.md`

## Global Constraints

- The figure is the book balance on the statement date **as it stood when the reconciliation was completed**: lines on the bank's GL account, entry dated ≤ statement date, `posted_at` ≤ `completed_at`, and not void at that moment (`voided_at` null or later than `completed_at`).
- The date of a `balance` line is the statement date **plus one day**.
- Only `status = 'completed'` reconciliations produce a line; in-progress (and reopened) ones produce nothing.
- No `balance` is ever guessed: a non-base bank account or a counted line in another currency, or a void entry without `voided_at` posted on or before completion in the period, gives a comment instead.
- Every read is paged (`readAllPages`) with a total order; any failed read fails the whole file.
- `lib/domain/beancount.ts` and `lib/domain/beancount-balance.ts` import nothing from `@/lib/db` or `@/lib/services`.
- US English UI. No hex colours outside the token block.
- No real client names or figures in repo files; test figures are invented.
- Stage files by name. No Co-Authored-By trailer. Write commit messages with `printf`.
- Run commands from `ctyhp-accounting/`.

---

## File structure

| File | Responsibility |
|---|---|
| `lib/domain/beancount-balance.ts` (new) | Row types, `nextDay`, `balanceAssertions` — pure figure rebuilding |
| `tests/unit/beancount-balance.test.ts` (new) | Its unit tests and purity check |
| `lib/domain/beancount.ts` | `assertions` on the input, two new line kinds, the section, `open` dates |
| `tests/unit/beancount.test.ts` | Fixture gains `assertions: []`; section tests |
| `lib/services/beancount.ts` | `readBalanceAssertionRows`, wiring into `readBeancountInput`, summary facts, sources |
| `tests/unit/beancount-service.test.ts` | Fake client learns `.in()`; read tests |
| `app/(app)/reports/beancount/BeancountClient.tsx` | Render the new kinds, the stat, the note |
| `lib/domain/report-catalog.ts` | Catalog description mentions balance lines |
| `lib/domain/changelog.ts` | Release 1.73 |

---

### Task 1: Rebuild each reconciled figure (pure domain)

**Files:**
- Create: `lib/domain/beancount-balance.ts`
- Test: `tests/unit/beancount-balance.test.ts`

**Interfaces:**
- Produces: `nextDay(isoDate: string): string`; `balanceAssertions(rows: BalanceAssertionRows, baseCurrency: string): BalanceAssertion[]`; types `CompletedReconciliation`, `ReconciledBankAccount`, `BankLedgerLine`, `ClearedLine`, `BalanceAssertionRows`, `BalanceAssertion` (exact shapes in Step 3).

- [ ] **Step 1: Write the failing tests**

`tests/unit/beancount-balance.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  balanceAssertions,
  nextDay,
  type BalanceAssertionRows,
  type BankLedgerLine,
  type CompletedReconciliation,
} from "@/lib/domain/beancount-balance";

const BANK = { id: "bank-1", glAccountId: "gl-1010", currencyCode: "USD" };

const recon = (over: Partial<CompletedReconciliation> = {}): CompletedReconciliation => ({
  id: "r-jul",
  bankAccountId: "bank-1",
  statementDate: "2026-07-31",
  statementMinor: 1248000,
  completedAt: "2026-08-03T10:00:00.000Z",
  ...over,
});

const line = (over: Partial<BankLedgerLine> = {}): BankLedgerLine => ({
  id: "l-1",
  accountId: "gl-1010",
  debitMinor: 0,
  creditMinor: 0,
  entryDate: "2026-07-10",
  currencyCode: "USD",
  status: "posted",
  postedAt: "2026-07-10T09:00:00.000Z",
  voidedAt: null,
  ...over,
});

// A July statement: a deposit and a payment cleared, one cheque still out.
// Statement 12,480.00; books 11,354.60.
const deposit = line({ id: "l-dep", debitMinor: 1500000, entryDate: "2026-07-02" });
const payment = line({ id: "l-pay", creditMinor: 252000, entryDate: "2026-07-12" });
const cheque = line({ id: "l-chq", creditMinor: 112540, entryDate: "2026-07-28" });

const rows = (over: Partial<BalanceAssertionRows> = {}): BalanceAssertionRows => ({
  reconciliations: [recon()],
  bankAccounts: [BANK],
  lines: [deposit, payment, cheque],
  cleared: [
    { reconciliationId: "r-jul", journalLineId: "l-dep" },
    { reconciliationId: "r-jul", journalLineId: "l-pay" },
  ],
  ...over,
});

describe("nextDay", () => {
  it("moves to the next calendar day across month, year and leap-day ends", () => {
    expect(nextDay("2026-07-31")).toBe("2026-08-01");
    expect(nextDay("2026-12-31")).toBe("2027-01-01");
    expect(nextDay("2028-02-28")).toBe("2028-02-29");
    expect(nextDay("2026-02-28")).toBe("2026-03-01");
  });
});

describe("balanceAssertions", () => {
  it("asserts the book balance on the statement date, dated the next day", () => {
    expect(balanceAssertions(rows(), "USD")).toEqual([
      {
        kind: "balance",
        reconciliationId: "r-jul",
        date: "2026-08-01",
        accountId: "gl-1010",
        statementDate: "2026-07-31",
        amountMinor: 1135460,
        currencyCode: "USD",
        statementMinor: 1248000,
        unclearedCount: 1,
      },
    ]);
  });

  it("does not count lines after the statement date or on other accounts", () => {
    const later = line({ id: "l-aug", debitMinor: 99900, entryDate: "2026-08-01", postedAt: "2026-08-01T09:00:00.000Z" });
    const elsewhere = line({ id: "l-other", accountId: "gl-1020", debitMinor: 50000 });
    const [a] = balanceAssertions(rows({ lines: [deposit, payment, cheque, later, elsewhere] }), "USD");
    expect(a.kind === "balance" && a.amountMinor).toBe(1135460);
  });

  it("does not count an entry posted after completion, even one dated inside the period", () => {
    const backdated = line({ id: "l-late", creditMinor: 5000, entryDate: "2026-07-20", postedAt: "2026-08-05T12:00:00.000Z" });
    const [a] = balanceAssertions(rows({ lines: [deposit, payment, cheque, backdated] }), "USD");
    expect(a.kind === "balance" && a.amountMinor).toBe(1135460);
  });

  it("counts an entry voided after completion, and not one voided before it", () => {
    const voidedLater = line({ id: "l-vl", creditMinor: 3000, status: "void", voidedAt: "2026-08-10T08:00:00.000Z" });
    const voidedEarlier = line({ id: "l-ve", creditMinor: 7000, status: "void", voidedAt: "2026-07-15T08:00:00.000Z" });
    const [a] = balanceAssertions(rows({ lines: [deposit, payment, cheque, voidedLater, voidedEarlier] }), "USD");
    expect(a.kind === "balance" && a.amountMinor).toBe(1135460 - 3000);
  });

  it("writes a skip rather than a guess when a void in the period has no void time", () => {
    const unknown = line({ id: "l-unk", creditMinor: 4000, status: "void", voidedAt: null });
    expect(balanceAssertions(rows({ lines: [deposit, unknown] }), "USD")).toEqual([
      {
        kind: "skipped",
        reason: "unknown-void",
        reconciliationId: "r-jul",
        date: "2026-08-01",
        accountId: "gl-1010",
        statementDate: "2026-07-31",
      },
    ]);
  });

  it("ignores a void without a void time when it was posted after completion", () => {
    const unknownLater = line({ id: "l-unk", creditMinor: 4000, status: "void", voidedAt: null, postedAt: "2026-08-06T09:00:00.000Z" });
    const [a] = balanceAssertions(rows({ lines: [deposit, payment, cheque, unknownLater] }), "USD");
    expect(a.kind).toBe("balance");
  });

  it("skips a bank account that is not in the base currency", () => {
    const [a] = balanceAssertions(rows({ bankAccounts: [{ ...BANK, currencyCode: "EUR" }] }), "USD");
    expect(a).toMatchObject({ kind: "skipped", reason: "currency", currencyCode: "EUR" });
  });

  it("skips when a counted line is in another currency", () => {
    const euroLine = line({ id: "l-eur", debitMinor: 1000, currencyCode: "EUR" });
    const [a] = balanceAssertions(rows({ lines: [deposit, euroLine] }), "USD");
    expect(a).toMatchObject({ kind: "skipped", reason: "currency", currencyCode: "EUR" });
  });

  it("writes one assertion per completed reconciliation, in date order", () => {
    const june = recon({ id: "r-jun", statementDate: "2026-06-30", statementMinor: 0, completedAt: "2026-07-02T10:00:00.000Z" });
    const out = balanceAssertions(rows({ reconciliations: [recon(), june] }), "USD");
    expect(out.map((a) => [a.reconciliationId, a.date])).toEqual([
      ["r-jun", "2026-07-01"],
      ["r-jul", "2026-08-01"],
    ]);
  });

  it("counts as uncleared only lines that neither this nor an earlier reconciliation cleared", () => {
    // A June cheque, still out in June, cleared in July.
    const juneCheque = line({ id: "l-jun", creditMinor: 10000, entryDate: "2026-06-25", postedAt: "2026-06-25T09:00:00.000Z" });
    const june = recon({ id: "r-jun", statementDate: "2026-06-30", statementMinor: 0, completedAt: "2026-07-02T10:00:00.000Z" });
    const out = balanceAssertions(
      rows({
        reconciliations: [june, recon()],
        lines: [juneCheque, deposit, payment, cheque],
        cleared: [
          { reconciliationId: "r-jul", journalLineId: "l-jun" },
          { reconciliationId: "r-jul", journalLineId: "l-dep" },
          { reconciliationId: "r-jul", journalLineId: "l-pay" },
        ],
      }),
      "USD",
    );
    const byId = new Map(out.map((a) => [a.reconciliationId, a]));
    expect(byId.get("r-jun")).toMatchObject({ kind: "balance", amountMinor: -10000, unclearedCount: 1 });
    expect(byId.get("r-jul")).toMatchObject({ kind: "balance", unclearedCount: 1 });
  });

  it("ignores clearing records of a reconciliation that is not completed", () => {
    const out = balanceAssertions(
      rows({ cleared: [...rows().cleared, { reconciliationId: "r-open", journalLineId: "l-chq" }] }),
      "USD",
    );
    expect(out[0]).toMatchObject({ unclearedCount: 1 });
  });

  it("refuses a reconciliation whose bank account was not read", () => {
    expect(() => balanceAssertions(rows({ bankAccounts: [] }), "USD")).toThrow(/bank account/);
  });
});

describe("the beancount-balance module", () => {
  it("imports nothing that could write to the books", () => {
    const source = readFileSync("lib/domain/beancount-balance.ts", "utf8");
    expect(source).not.toMatch(/@\/lib\/(db|services)\//);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/beancount-balance.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/domain/beancount-balance"`.

- [ ] **Step 3: Write the module**

`lib/domain/beancount-balance.ts`:

```ts
/**
 * Balance assertions for the Beancount file: one per completed bank
 * reconciliation, carrying the book balance on the statement date as it stood
 * when the reconciliation was completed.
 *
 * Not the statement balance: Beancount checks the whole account, and the books
 * differ from the statement by whatever has not cleared yet, so the statement
 * figure would fail correct books. Not today's balance either: the file is
 * built from today's books, so that figure would always pass and prove
 * nothing. The figure as it stood at completion is the one that was agreed,
 * and an entry added, voided or missed in that period since makes bean-check
 * refuse the file.
 *
 * Rebuilt from `posted_at` and `voided_at`, which is exact because posted lines
 * cannot change: the only change a posted entry can undergo is being voided.
 *
 * Pure: it imports nothing from `@/lib/db` or `@/lib/services`.
 */

export interface CompletedReconciliation {
  id: string;
  bankAccountId: string;
  /** YYYY-MM-DD. */
  statementDate: string;
  statementMinor: number;
  /** ISO timestamp. */
  completedAt: string;
}

export interface ReconciledBankAccount {
  id: string;
  /** The GL account the bank account posts to. */
  glAccountId: string;
  currencyCode: string;
}

/** A line on a bank's GL account, with what its entry was and when. Void entries included. */
export interface BankLedgerLine {
  id: string;
  accountId: string;
  debitMinor: number;
  creditMinor: number;
  entryDate: string;
  currencyCode: string;
  status: "posted" | "void";
  postedAt: string;
  voidedAt: string | null;
}

export interface ClearedLine {
  reconciliationId: string;
  journalLineId: string;
}

export interface BalanceAssertionRows {
  /** Completed reconciliations only. */
  reconciliations: readonly CompletedReconciliation[];
  bankAccounts: readonly ReconciledBankAccount[];
  lines: readonly BankLedgerLine[];
  cleared: readonly ClearedLine[];
}

interface AssertionBase {
  reconciliationId: string;
  /** The day after the statement: Beancount checks a balance at the start of its day. */
  date: string;
  /** The GL account. */
  accountId: string;
  statementDate: string;
}

export type BalanceAssertion =
  | (AssertionBase & {
      kind: "balance";
      amountMinor: number;
      currencyCode: string;
      statementMinor: number;
      /** Lines counted that neither this reconciliation nor an earlier completed one cleared. */
      unclearedCount: number;
    })
  | (AssertionBase & { kind: "skipped"; reason: "currency"; currencyCode: string })
  | (AssertionBase & { kind: "skipped"; reason: "unknown-void" });

/** The calendar day after an ISO date. */
export function nextDay(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

const at = (iso: string) => Date.parse(iso);

/** One assertion, or the reason there is none, per completed reconciliation; in date order. */
export function balanceAssertions(rows: BalanceAssertionRows, baseCurrency: string): BalanceAssertion[] {
  const bankById = new Map(rows.bankAccounts.map((b) => [b.id, b]));
  const reconById = new Map(rows.reconciliations.map((r) => [r.id, r]));
  // Which completed reconciliations cleared each line.
  const clearedBy = new Map<string, string[]>();
  for (const c of rows.cleared) {
    if (!reconById.has(c.reconciliationId)) continue;
    clearedBy.set(c.journalLineId, [...(clearedBy.get(c.journalLineId) ?? []), c.reconciliationId]);
  }

  const out: BalanceAssertion[] = [];
  for (const r of rows.reconciliations) {
    const bank = bankById.get(r.bankAccountId);
    if (!bank) throw new Error(`The reconciliation of ${r.statementDate} names a bank account that was not read`);
    const base: AssertionBase = {
      reconciliationId: r.id,
      date: nextDay(r.statementDate),
      accountId: bank.glAccountId,
      statementDate: r.statementDate,
    };
    const completed = at(r.completedAt);
    const inPeriod = rows.lines.filter((l) => l.accountId === bank.glAccountId && l.entryDate <= r.statementDate);

    if (inPeriod.some((l) => l.status === "void" && l.voidedAt === null && at(l.postedAt) <= completed)) {
      out.push({ ...base, kind: "skipped", reason: "unknown-void" });
      continue;
    }

    const counted = inPeriod.filter(
      (l) =>
        at(l.postedAt) <= completed &&
        (l.status === "posted" || (l.voidedAt !== null && at(l.voidedAt) > completed)),
    );

    const foreign =
      bank.currencyCode !== baseCurrency
        ? bank.currencyCode
        : counted.find((l) => l.currencyCode !== baseCurrency)?.currencyCode;
    if (foreign) {
      out.push({ ...base, kind: "skipped", reason: "currency", currencyCode: foreign });
      continue;
    }

    const clearedHereOrBefore = (reconId: string) => {
      if (reconId === r.id) return true;
      const other = reconById.get(reconId);
      return other !== undefined && other.bankAccountId === r.bankAccountId && other.statementDate < r.statementDate;
    };

    out.push({
      ...base,
      kind: "balance",
      amountMinor: counted.reduce((sum, l) => sum + l.debitMinor - l.creditMinor, 0),
      currencyCode: bank.currencyCode,
      statementMinor: r.statementMinor,
      unclearedCount: counted.filter((l) => !(clearedBy.get(l.id) ?? []).some(clearedHereOrBefore)).length,
    });
  }

  return out.sort((x, y) => x.date.localeCompare(y.date) || x.reconciliationId.localeCompare(y.reconciliationId));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/beancount-balance.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/domain/beancount-balance.ts tests/unit/beancount-balance.test.ts
git commit -m "$(printf 'feat(beancount): rebuild each reconciled bank balance as it stood at completion')"
```

---

### Task 2: Write the section in the file

**Files:**
- Modify: `lib/domain/beancount.ts` (input type ~239, line-kind union ~278, `buildBeancountLines` ~364–458)
- Test: `tests/unit/beancount.test.ts`

**Interfaces:**
- Consumes: `BalanceAssertion` from Task 1.
- Produces: `BeancountInput.assertions: readonly BalanceAssertion[]`; new `BeancountTextLine` kinds:
  - `{ kind: "reconciliation"; text: string; reconciliationId: string }`
  - `{ kind: "balance"; text: string; reconciliationId: string; accountId: string; accountStart: number; accountEnd: number }` (account name is `text.slice(accountStart, accountEnd)`).

- [ ] **Step 1: Add `assertions: []` to the test fixture, then write the failing tests**

In `tests/unit/beancount.test.ts`, add `type BalanceAssertion` to the imports (from `@/lib/domain/beancount-balance`), and add `assertions: [],` to the `input()` fixture after `prices: [],`. Then append:

```ts
describe("balance assertions", () => {
  const assertion = (over: Partial<Record<string, unknown>> = {}): BalanceAssertion =>
    ({
      kind: "balance",
      reconciliationId: "r-jan",
      date: "2025-02-01",
      accountId: "acc-bank",
      statementDate: "2025-01-31",
      amountMinor: 1135460,
      currencyCode: "USD",
      statementMinor: 1248000,
      unclearedCount: 1,
      ...over,
    }) as BalanceAssertion;

  const BANK_NAME = "Assets:Bank:1010-Operating-Checking";

  it("writes a section after the transactions, with the statement beside each figure", () => {
    const text = buildBeancountFile(input({ entries: [entry()], assertions: [assertion()] }));
    expect(text).toContain(
      [
        ";; --- Balance assertions ---",
        ";; One per completed bank reconciliation: the book balance on the statement",
        ";; date as it stood when the reconciliation was completed. Beancount checks a",
        ";; balance at the start of its day, so each is dated the day after the statement.",
        "",
        "; Statement of 2025-01-31: 12,480.00 USD. Books differ by -1,125.40 USD: 1 line not yet cleared.",
        `2025-02-01 balance ${BANK_NAME.padEnd(44)}${"11354.60".padStart(16)} USD`,
        "",
        ";; --- End of file ---",
        "",
      ].join("\n"),
    );
  });

  it("says the books agree when they do", () => {
    const text = buildBeancountFile(
      input({ entries: [entry()], assertions: [assertion({ amountMinor: 1248000, unclearedCount: 0 })] }),
    );
    expect(text).toContain("; Statement of 2025-01-31: 12,480.00 USD. Books agree with the statement.\n");
  });

  it("writes a comment and no balance when the account is in another currency", () => {
    const text = buildBeancountFile(
      input({
        entries: [entry()],
        assertions: [assertion({ kind: "skipped", reason: "currency", currencyCode: "EUR" })],
      }),
    );
    expect(text).toContain(
      `; Statement of 2025-01-31 not asserted: it is reconciled in USD, and ${BANK_NAME} holds EUR.\n`,
    );
    expect(text).not.toMatch(/^\d{4}-\d{2}-\d{2} balance /m);
  });

  it("writes a comment and no balance when a void time is unknown", () => {
    const text = buildBeancountFile(
      input({ entries: [entry()], assertions: [assertion({ kind: "skipped", reason: "unknown-void" })] }),
    );
    expect(text).toContain(
      `; Statement of 2025-01-31 not asserted: an entry on ${BANK_NAME} was voided at an unrecorded time, so its balance at completion cannot be rebuilt.\n`,
    );
    expect(text).not.toMatch(/^\d{4}-\d{2}-\d{2} balance /m);
  });

  it("orders assertions by date, then account name", () => {
    const savings = acct({ id: "acc-sav", code: "1020", name: "Savings", type: "bank" });
    const text = buildBeancountFile(
      input({
        accounts: [BANK, AR, SALES, savings],
        entries: [entry()],
        assertions: [
          assertion({ reconciliationId: "r-feb", date: "2025-03-01", statementDate: "2025-02-28" }),
          assertion({ reconciliationId: "r-sav", accountId: "acc-sav" }),
          assertion(),
        ],
      }),
    );
    const order = [...text.matchAll(/^(\d{4}-\d{2}-\d{2}) balance (\S+)/gm)].map((m) => `${m[1]} ${m[2]}`);
    expect(order).toEqual([
      "2025-02-01 Assets:Bank:1010-Operating-Checking",
      "2025-02-01 Assets:Bank:1020-Savings",
      "2025-03-01 Assets:Bank:1010-Operating-Checking",
    ]);
  });

  it("opens every account no later than its first assertion", () => {
    const text = buildBeancountFile(
      input({ entries: [entry()], assertions: [assertion({ date: "2024-12-01", statementDate: "2024-11-30" })] }),
    );
    expect(text).toContain("2024-12-01 open Assets:Bank:1010-Operating-Checking\n");
    expect(text).not.toContain("2025-01-15 open ");
  });

  it("writes no section when nothing was reconciled", () => {
    expect(buildBeancountFile(input({ entries: [entry()] }))).not.toContain("Balance assertions");
  });

  it("ties each balance line to its account and reconciliation", () => {
    const lines = buildBeancountLines(input({ entries: [entry()], assertions: [assertion()] }));
    const balance = lines.find((l) => l.kind === "balance");
    expect(balance?.kind === "balance" && balance.text.slice(balance.accountStart, balance.accountEnd)).toBe(BANK_NAME);
    expect(balance?.kind === "balance" && [balance.accountId, balance.reconciliationId]).toEqual(["acc-bank", "r-jan"]);
    const note = lines.find((l) => l.kind === "reconciliation");
    expect(note?.kind === "reconciliation" && note.reconciliationId).toBe("r-jan");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/beancount.test.ts`
Expected: FAIL — TypeScript/assertion failures in the new `balance assertions` block (no section written); the earlier tests still pass.

- [ ] **Step 3: Change the builder**

In `lib/domain/beancount.ts`:

1. After the existing imports add:

```ts
import type { BalanceAssertion } from "@/lib/domain/beancount-balance";
```

2. In `BeancountInput`, after `prices: readonly BeancountPrice[];` add:

```ts
  /** One per completed bank reconciliation, from `balanceAssertions`. */
  assertions: readonly BalanceAssertion[];
```

3. In the `BeancountTextLine` union, after the `txn | meta` member add:

```ts
  | { kind: "reconciliation"; text: string; reconciliationId: string }
  | {
      kind: "balance";
      text: string;
      reconciliationId: string;
      accountId: string;
      /** The account name is `text.slice(accountStart, accountEnd)`. */
      accountStart: number;
      accountEnd: number;
    }
```

4. After `formatAmount`, add:

```ts
/** Minor units with thousands separators, for comments a person reads. */
function formatGrouped(minor: number, decimals: number): string {
  const plain = formatAmount(minor, decimals);
  const negative = plain.startsWith("-");
  const [whole, fraction] = (negative ? plain.slice(1) : plain).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}${fraction === undefined ? "" : `.${fraction}`}`;
}
```

5. In `buildBeancountLines`, replace the two-line `openDate` block:

```ts
  // Every account opens on the book's first date, which is on or before any
  // posting to it by construction.
  const openDate = entries[0]?.entryDate ?? input.generatedAt.slice(0, 10);
```

with:

```ts
  // Every account opens on the book's first date, which is on or before any
  // posting to it by construction — or on an earlier assertion's date, since a
  // balance may not be checked on an account before it opens.
  const openDate =
    [entries[0]?.entryDate, ...input.assertions.map((a) => a.date)]
      .filter((d): d is string => d !== undefined)
      .sort()[0] ?? input.generatedAt.slice(0, 10);
```

6. Replace the final `comment(";; --- End of file ---");` with:

```ts
  if (input.assertions.length > 0) {
    const nameOf = (accountId: string) => {
      const name = names.get(accountId);
      if (!name) throw new BeancountError("A reconciled bank account is missing from the chart");
      return name;
    };
    comment(";; --- Balance assertions ---");
    comment(";; One per completed bank reconciliation: the book balance on the statement");
    comment(";; date as it stood when the reconciliation was completed. Beancount checks a");
    comment(";; balance at the start of its day, so each is dated the day after the statement.");
    blank();

    const ordered = [...input.assertions].sort(
      (x, y) => x.date.localeCompare(y.date) || nameOf(x.accountId).localeCompare(nameOf(y.accountId)),
    );
    for (const a of ordered) {
      const name = nameOf(a.accountId);
      if (a.kind === "skipped") {
        const why =
          a.reason === "currency"
            ? `it is reconciled in ${base.code}, and ${name} holds ${a.currencyCode}.`
            : `an entry on ${name} was voided at an unrecorded time, so its balance at completion cannot be rebuilt.`;
        out.push({
          kind: "reconciliation",
          text: `; Statement of ${a.statementDate} not asserted: ${why}`,
          reconciliationId: a.reconciliationId,
        });
      } else {
        const decimals = decimalsOf.get(a.currencyCode);
        if (decimals === undefined) {
          throw new BeancountError(`A reconciliation is in ${a.currencyCode}, which has no currency record`);
        }
        const diff = a.amountMinor - a.statementMinor;
        const uncleared = `${a.unclearedCount} line${a.unclearedCount === 1 ? "" : "s"} not yet cleared`;
        const agreement =
          diff === 0
            ? `Books agree with the statement.${a.unclearedCount > 0 ? ` ${uncleared} net to zero.` : ""}`
            : `Books differ by ${formatGrouped(diff, decimals)} ${a.currencyCode}${a.unclearedCount > 0 ? `: ${uncleared}.` : "."}`;
        out.push({
          kind: "reconciliation",
          text: `; Statement of ${a.statementDate}: ${formatGrouped(a.statementMinor, decimals)} ${a.currencyCode}. ${agreement}`,
          reconciliationId: a.reconciliationId,
        });
        const prefix = `${a.date} balance `;
        out.push({
          kind: "balance",
          text: `${prefix}${name.padEnd(nameWidth)}${formatAmount(a.amountMinor, decimals).padStart(16)} ${a.currencyCode}`,
          reconciliationId: a.reconciliationId,
          accountId: a.accountId,
          accountStart: prefix.length,
          accountEnd: prefix.length + name.length,
        });
      }
      blank();
    }
  }

  comment(";; --- End of file ---");
```

- [ ] **Step 4: Run the Beancount tests to verify they pass**

Run: `npx vitest run tests/unit/beancount.test.ts tests/unit/beancount-balance.test.ts`
Expected: PASS (all, including the earlier exact-file test, which has no assertions and so no section).

- [ ] **Step 5: Typecheck** — `BeancountInput` now requires `assertions`, so the service no longer compiles until Task 3:

Run: `npm run typecheck`
Expected: exactly one error, in `lib/services/beancount.ts`: property `assertions` is missing. (Fixed in Task 3; commit Tasks 2 and 3 together if a green commit is wanted — see Task 3 Step 5.)

---

### Task 3: Read the reconciliations and wire them in

**Files:**
- Modify: `lib/services/beancount.ts`
- Test: `tests/unit/beancount-service.test.ts`

**Interfaces:**
- Consumes: `balanceAssertions`, `BalanceAssertionRows` (Task 1); `BeancountInput.assertions` (Task 2).
- Produces: `readBalanceAssertionRows(sb: SupabaseClient): Promise<BalanceAssertionRows>`; `BeancountSummary` gains `reconciledStatements: number`, `bankAccountCount: number`, `bankAccountsUnreconciled: number`.

- [ ] **Step 1: Teach the fake client `.in()` and add the new tables, then write the failing tests**

In `tests/unit/beancount-service.test.ts`:

- In `matching`, replace `(op === "eq" ? r[col] === v : true)` with
  `(op === "eq" ? r[col] === v : op === "in" ? (v as unknown[]).includes(r[col]) : true)`.
- In the builder object, after `not:` add:

```ts
      in: (col: string, vs: unknown[]) => {
        filters.push(["in", col, vs]);
        return b;
      },
```

- In `baseTables`, add:

```ts
  acc_statement_reconciliation: { rows: [] },
  acc_bank_account: { rows: [] },
  acc_reconciliation_line: { rows: [] },
  acc_journal_line: { rows: [] },
```

Then append:

```ts
describe("balance assertion reads", () => {
  const reconciled = (tables: Record<string, Table>) => {
    tables.acc_bank_account.rows = [{ id: "bank-1", account_id: "acc-bank", currency_code: "USD" }];
    tables.acc_statement_reconciliation.rows = [
      {
        id: "r-jan",
        bank_account_id: "bank-1",
        statement_ending_date: "2025-01-31",
        statement_ending_balance_minor: "100",
        completed_at: "2025-02-02T10:00:00+00:00",
        status: "completed",
      },
      {
        id: "r-feb",
        bank_account_id: "bank-1",
        statement_ending_date: "2025-02-28",
        statement_ending_balance_minor: "0",
        completed_at: null,
        status: "in_progress",
      },
    ];
    tables.acc_reconciliation_line.rows = [{ id: "c1", reconciliation_id: "r-jan", journal_line_id: "jl-1" }];
    const entryOf = (over: Row) => ({
      entry_date: "2025-01-15",
      currency_code: "USD",
      status: "posted",
      posted_at: "2025-01-15T09:00:00+00:00",
      voided_at: null,
      ...over,
    });
    tables.acc_journal_line.rows = [
      { id: "jl-1", account_id: "acc-bank", debit_minor: "100", credit_minor: "0", acc_journal_entry: entryOf({}) },
      {
        id: "jl-2",
        account_id: "acc-bank",
        debit_minor: "0",
        credit_minor: "40",
        acc_journal_entry: entryOf({ status: "void", voided_at: "2025-03-01T09:00:00+00:00" }),
      },
      { id: "jl-3", account_id: "acc-sales", debit_minor: "0", credit_minor: "100", acc_journal_entry: entryOf({}) },
    ];
    return tables;
  };

  it("asserts each completed reconciliation, counting entries voided after it", async () => {
    const { sb } = fakeClient(reconciled(baseTables(entryRows(1))));
    const input = await readBeancountInput(sb, "2026-09-26T08:00:00.000Z");
    expect(input.assertions).toEqual([
      {
        kind: "balance",
        reconciliationId: "r-jan",
        date: "2025-02-01",
        accountId: "acc-bank",
        statementDate: "2025-01-31",
        amountMinor: 60,
        currencyCode: "USD",
        statementMinor: 100,
        unclearedCount: 1,
      },
    ]);
  });

  it("asks only for lines on reconciled bank accounts", async () => {
    const { sb, calls } = fakeClient(reconciled(baseTables(entryRows(1))));
    await readBeancountInput(sb, "2026-09-26T08:00:00.000Z");
    const lineCalls = calls.filter((c) => c.table === "acc_journal_line");
    expect(lineCalls.length).toBeGreaterThan(0);
    for (const c of lineCalls) expect(c.filters).toContainEqual(["in", "account_id", ["acc-bank"]]);
  });

  it("reads completed reconciliations only", async () => {
    const { sb, calls } = fakeClient(reconciled(baseTables(entryRows(1))));
    await readBeancountInput(sb, "2026-09-26T08:00:00.000Z");
    for (const c of calls.filter((x) => x.table === "acc_statement_reconciliation")) {
      expect(c.filters).toContainEqual(["eq", "status", "completed"]);
    }
  });

  it("reads no ledger lines when nothing is reconciled", async () => {
    const { sb, calls } = fakeClient(baseTables(entryRows(1)));
    const input = await readBeancountInput(sb, "2026-09-26T08:00:00.000Z");
    expect(input.assertions).toEqual([]);
    expect(calls.some((c) => c.table === "acc_journal_line")).toBe(false);
  });

  it("fails as a whole when the reconciliation read fails", async () => {
    const tables = reconciled(baseTables(entryRows(1)));
    tables.acc_statement_reconciliation.failOnPage = 1;
    const { sb } = fakeClient(tables);
    await expect(readBeancountInput(sb, "2026-09-26T08:00:00.000Z")).rejects.toThrow(/acc_statement_reconciliation/);
  });

  it("summarises reconciled statements and the bank accounts with none", async () => {
    const tables = reconciled(baseTables(entryRows(1)));
    tables.acc_bank_account.rows.push({ id: "bank-2", account_id: "acc-sav", currency_code: "USD" });
    const { sb } = fakeClient(tables);
    const summary = await readBeancountSummary(sb);
    expect(summary.reconciledStatements).toBe(1);
    expect(summary.bankAccountCount).toBe(2);
    expect(summary.bankAccountsUnreconciled).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/beancount-service.test.ts`
Expected: FAIL — `input.assertions` is undefined; summary fields undefined.

- [ ] **Step 3: Implement the reads**

In `lib/services/beancount.ts`:

1. Extend the domain import:

```ts
import { balanceAssertions, type BalanceAssertionRows } from "@/lib/domain/beancount-balance";
```

2. Add to `BEANCOUNT_SOURCES`, after `"acc_company_setting_version",`:

```ts
  "acc_statement_reconciliation",
  "acc_bank_account",
  "acc_reconciliation_line",
```

(`acc_journal_line` is already listed.)

3. After `readBeancountAccounts`, add:

```ts
interface ReconciliationRow {
  id: string;
  bank_account_id: string;
  statement_ending_date: string;
  statement_ending_balance_minor: number | string;
  completed_at: string | null;
}
interface BankAccountRow { id: string; account_id: string; currency_code: string }
interface ClearedRow { reconciliation_id: string; journal_line_id: string }
interface BankLineRow {
  id: string;
  account_id: string;
  debit_minor: number | string;
  credit_minor: number | string;
  acc_journal_entry: {
    entry_date: string;
    currency_code: string;
    status: "posted" | "void";
    posted_at: string;
    voided_at: string | null;
  } | null;
}

/**
 * Every completed bank reconciliation and the bank-account lines behind it,
 * void entries included: a balance as it stood at completion counts an entry
 * voided since. Throws if any read fails.
 */
export async function readBalanceAssertionRows(sb: SupabaseClient): Promise<BalanceAssertionRows> {
  const [reconciliations, bankAccounts, cleared] = await Promise.all([
    readAll<ReconciliationRow>("acc_statement_reconciliation", (f, t) =>
      sb
        .from("acc_statement_reconciliation")
        .select("id,bank_account_id,statement_ending_date,statement_ending_balance_minor,completed_at")
        .eq("status", "completed")
        .order("statement_ending_date")
        .order("id")
        .range(f, t)),
    readAll<BankAccountRow>("acc_bank_account", (f, t) =>
      sb.from("acc_bank_account").select("id,account_id,currency_code").order("id").range(f, t)),
    readAll<ClearedRow>("acc_reconciliation_line", (f, t) =>
      sb.from("acc_reconciliation_line").select("reconciliation_id,journal_line_id").order("id").range(f, t)),
  ]);

  const glOf = new Map(bankAccounts.map((b) => [b.id, b.account_id]));
  const glIds = [
    ...new Set(reconciliations.map((r) => glOf.get(r.bank_account_id)).filter((id): id is string => id !== undefined)),
  ];
  const lines =
    glIds.length === 0
      ? []
      : await readAll<BankLineRow>("acc_journal_line", (f, t) =>
          sb
            .from("acc_journal_line")
            .select("id,account_id,debit_minor,credit_minor,acc_journal_entry!inner(entry_date,currency_code,status,posted_at,voided_at)")
            .in("account_id", glIds)
            .order("id")
            .range(f, t));

  return {
    reconciliations: reconciliations.map((r) => {
      const statementDate = String(r.statement_ending_date).slice(0, 10);
      if (!r.completed_at) {
        throw new BeancountExportError(`The completed reconciliation of ${statementDate} has no completion time`);
      }
      return {
        id: r.id,
        bankAccountId: r.bank_account_id,
        statementDate,
        statementMinor: Number(r.statement_ending_balance_minor),
        completedAt: r.completed_at,
      };
    }),
    bankAccounts: bankAccounts.map((b) => ({ id: b.id, glAccountId: b.account_id, currencyCode: b.currency_code })),
    lines: lines.map((l) => {
      const e = l.acc_journal_entry;
      if (!e) throw new BeancountExportError("A bank-account line was read without its entry");
      return {
        id: l.id,
        accountId: l.account_id,
        debitMinor: Number(l.debit_minor),
        creditMinor: Number(l.credit_minor),
        entryDate: String(e.entry_date).slice(0, 10),
        currencyCode: e.currency_code,
        status: e.status,
        postedAt: e.posted_at,
        voidedAt: e.voided_at,
      };
    }),
    cleared: cleared.map((c) => ({ reconciliationId: c.reconciliation_id, journalLineId: c.journal_line_id })),
  };
}
```

4. In `readBeancountInput`, add `assertionRows` as the last element of the destructured array and `readBalanceAssertionRows(sb),` as the last element of `Promise.all([...])`. In the returned object, after `prices: …,` add:

```ts
    assertions: balanceAssertions(assertionRows, currencies.find((c) => c.is_base)?.code ?? ""),
```

5. In `BeancountSummary`, add:

```ts
  /** Completed bank reconciliations: each adds a balance line, or a comment saying why not. */
  reconciledStatements: number;
  bankAccountCount: number;
  /** Bank accounts with no completed reconciliation, so no balance line. */
  bankAccountsUnreconciled: number;
```

6. In `readBeancountSummary`, add two reads to its `Promise.all` (destructure them as `reconciled, banks`):

```ts
    readAll<{ bank_account_id: string }>("acc_statement_reconciliation", (f, t) =>
      sb.from("acc_statement_reconciliation").select("bank_account_id").eq("status", "completed").order("id").range(f, t)),
    readAll<{ id: string }>("acc_bank_account", (f, t) =>
      sb.from("acc_bank_account").select("id").order("id").range(f, t)),
```

then, above the `return`:

```ts
  const withReconciliation = new Set(reconciled.map((r) => r.bank_account_id));
```

and in the returned object:

```ts
    reconciledStatements: reconciled.length,
    bankAccountCount: banks.length,
    bankAccountsUnreconciled: banks.filter((b) => !withReconciliation.has(b.id)).length,
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `npx vitest run tests/unit/beancount-service.test.ts tests/unit/beancount.test.ts tests/unit/beancount-balance.test.ts && npm run typecheck`
Expected: all PASS; typecheck errors only in `BeancountClient.tsx` if its `switch` is flagged for the two new kinds (fixed in Task 4) — otherwise 0 errors.

- [ ] **Step 5: Commit Tasks 2 and 3**

```bash
git add lib/domain/beancount.ts tests/unit/beancount.test.ts lib/services/beancount.ts tests/unit/beancount-service.test.ts
git commit -m "$(printf 'feat(beancount): a balance line per completed bank reconciliation')"
```

---

### Task 4: The page, the catalog, the changelog

**Files:**
- Modify: `app/(app)/reports/beancount/BeancountClient.tsx`
- Modify: `lib/domain/report-catalog.ts:149`
- Modify: `lib/domain/changelog.ts` (top of `RELEASES`)
- Modify: `docs/superpowers/specs/2026-09-30-beancount-balance-assertions-design.md` (comment texts and stat label, to match what shipped)

**Interfaces:**
- Consumes: line kinds from Task 2; `BeancountSummary` fields from Task 3.

- [ ] **Step 1: Render the two new kinds**

In `BeancountClient.tsx`, inside `line()`'s `switch`, after the `case "posting":` block add:

```tsx
        case "reconciliation":
          return (
            <a
              className={styles.cm}
              href={`/banking/reconcile/${l.reconciliationId}`}
              target="_blank"
              rel="noopener"
              title="Open this reconciliation in a new tab"
            >
              {l.text}
            </a>
          );
        case "balance":
          return (
            <>
              <span className={styles.op}>{l.text.slice(0, l.accountStart)}</span>
              {account(l.accountId, l.text.slice(l.accountStart, l.accountEnd), `a${i}`)}
              <span className={styles.kw}>{l.text.slice(l.accountEnd)}</span>
            </>
          );
```

- [ ] **Step 2: Add the stat and the note**

In the `StatRow` `items`, after the `Currencies` item add:

```tsx
            { label: "Reconciled statements", value: summary.reconciledStatements.toLocaleString("en-US") },
```

After the `StatRow` block (still inside the `summary ?` branch's sibling chain — place it as its own block right after the `summaryError ? … : summary ? … : null` expression) add:

```tsx
      {summary && summary.bankAccountsUnreconciled > 0 ? (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          title={`${summary.bankAccountsUnreconciled} of ${summary.bankAccountCount} bank accounts have no completed reconciliation`}
          description={
            <>
              The file asserts a balance only for statements that were reconciled. Reconcile one under{" "}
              <a href="/banking/reconcile">Banking › Reconcile</a> to add its balance line.
            </>
          }
        />
      ) : null}
```

And extend the lede after "…open its ledger or its entry.":

```tsx
            {" "}Each reconciled bank statement adds a balance line, so bean-check refuses the file if that period changes.
```

- [ ] **Step 3: Catalog and changelog**

`lib/domain/report-catalog.ts`, the `beancount-export` description becomes:

```ts
    description: "Download the whole ledger as a Beancount v3 file, with a balance line per reconciled statement, for bean-check and Fava.",
```

`lib/domain/changelog.ts`, insert as the first element of `RELEASES`:

```ts
  {
    version: "1.73",
    date: "2026-10-01",
    headline: "The Beancount file now checks itself against every reconciled bank statement.",
    changes: [
      {
        kind: "added",
        title: "Balance lines from reconciled statements",
        detail:
          "Each completed bank reconciliation adds a balance line to the Beancount file: the book balance on the statement date as it stood when the reconciliation was completed, dated the day after. If an entry in that period is later added, voided or missed, bean-check refuses the file. A comment beside each line gives the statement balance and how many lines had not yet cleared.",
        route: "/reports/beancount",
      },
    ],
  },
```

- [ ] **Step 4: Bring the spec in line with what shipped**

In the spec's "When no `balance` is written" table, set the two comment texts to:
- `; Statement of <date> not asserted: it is reconciled in <base>, and <account> holds <ccy>.`
- `; Statement of <date> not asserted: an entry on <account> was voided at an unrecorded time, so its balance at completion cannot be rebuilt.`

and add to the unknown-void row: "only when that entry was posted on or before completion". In §5, change "The stat row adds "Balance assertions"" to "The stat row adds "Reconciled statements"".

- [ ] **Step 5: Run the four gates**

Run: `npm run typecheck && npm run lint && npm test`
Expected: 0 type errors, 0 lint errors, every test passing (paste the counts line).

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/reports/beancount/BeancountClient.tsx" lib/domain/report-catalog.ts lib/domain/changelog.ts ../docs/superpowers/specs/2026-09-30-beancount-balance-assertions-design.md
git commit -m "$(printf 'feat(beancount): show reconciled statements on the export page; changelog 1.73')"
```

---

### Task 5: Prove it on real books, then the page

**Files:** none committed. Harness and output live in the scratchpad.

- [ ] **Step 1: `bean-check` available**

Run (scratchpad): `python -m venv bean && bean/Scripts/pip install beancount==3.2.3` then `bean/Scripts/bean-check --version`.
Expected: prints a version.

- [ ] **Step 2: Build the file of the company with the completed reconciliation**

Write a temporary vitest harness (own config, `--pool=threads`) in `ctyhp-accounting/` that signs in with `smokeSession()` from `scripts/smoke-environment.mjs`, makes a client on schema `public`, calls `readBeancountInput` then `buildBeancountFile`, and writes the text to the scratchpad. Delete the harness and its config afterwards.
Expected: a file whose `;; --- Balance assertions ---` section has one `balance` line.

- [ ] **Step 3: `bean-check` the real file**

Run: `bean/Scripts/bean-check <file>`
Expected: no output (clean). Any `Balance failed` is a finding about the books since that reconciliation was completed — stop and report it to the user, do not adjust the code to pass.

- [ ] **Step 4: Prove it can fail**

Copy the file, add one invented transaction on the reconciled bank account dated inside the reconciled month (balanced against an expense account), and run `bean-check` on the copy.
Expected: `Balance failed for 'Assets:Bank:…'`.

- [ ] **Step 5: Build, start, smoke**

```
npm run build
(start detached with PowerShell: Start-Process npm.cmd start)
node --env-file=.env.local scripts/smoke-pages.mjs http://localhost:3000
```
Expected: every page OK.

- [ ] **Step 6: Screenshots, sample company only**

Screenshot Reports › Beancount on PC-Test, light and dark: the "Reconciled statements" stat and the "2 of 2 bank accounts" note. To show the section itself, ask the user before creating and completing a reconciliation on PC-Test's Sample Bank (completing posts nothing). Show the screenshots to the user before pushing.

- [ ] **Step 7: Push and report**

After the user approves the screenshots: `git push -u origin feat/beancount-balance`, then report to the user with the counts from every gate.
