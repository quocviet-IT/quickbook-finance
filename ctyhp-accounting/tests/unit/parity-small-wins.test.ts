import { describe, expect, it } from "vitest";
import { importOnArrival } from "@/lib/domain/import-on-arrival";
import { RELEASE_SEARCH_LIMIT, searchCountLine, searchReleases } from "@/lib/domain/screen-context";
import type { Release } from "@/lib/domain/changelog";
import { buildBalanceSheet, buildTrialBalance, withAccountsUsed, type LedgerBalance } from "@/lib/domain/reports";
import { indexAccounts, trialBalanceStatement, type AccountRef } from "@/lib/domain/statement";

describe("opening Banking to import a statement", () => {
  const base = { requested: true, canWrite: true, requestedAccountId: null };

  it("opens the dialog when there is only one account it could be for", () => {
    expect(importOnArrival({ ...base, bankAccountIds: ["a"] })).toBe("open");
  });

  it("opens it for the account the link named", () => {
    expect(importOnArrival({ ...base, bankAccountIds: ["a", "b"], requestedAccountId: "b" })).toBe("open");
  });

  it("asks for the account when there are several and none was named, rather than guess the first", () => {
    expect(importOnArrival({ ...base, bankAccountIds: ["a", "b"] })).toBe("choose-account");
    expect(importOnArrival({ ...base, bankAccountIds: ["a", "b"], requestedAccountId: "gone" })).toBe("choose-account");
  });

  it("offers nothing when it was not asked for, cannot be written, or has no account to go into", () => {
    expect(importOnArrival({ ...base, requested: false, bankAccountIds: ["a"] })).toBe("none");
    expect(importOnArrival({ ...base, canWrite: false, bankAccountIds: ["a"] })).toBe("none");
    expect(importOnArrival({ ...base, bankAccountIds: [] })).toBe("none");
  });
});

describe("searching the release notes from the guide", () => {
  const releases: Release[] = [
    {
      version: "3.02",
      date: "2026-11-02",
      headline: "Undo moves into the row menu.",
      changes: [
        { kind: "changed", title: "Undo is in the row menu", detail: "It sat beside the import." },
        { kind: "fixed", title: "Dates read the same way" },
      ],
    },
    {
      version: "3.01",
      date: "2026-11-01",
      headline: "Statements prove themselves.",
      changes: [{ kind: "added", title: "A statement must add up", detail: "Before it is imported." }],
    },
  ];

  it("finds the release that moved a control, keeping only the changes that mention it", () => {
    const found = searchReleases("where did undo go", releases);
    expect(found.map((r) => r.version)).toEqual(["3.02"]);
    expect(found[0].changes.map((c) => c.title)).toEqual(["Undo is in the row menu"]);
  });

  it("keeps every change of a release that names the words only in its headline", () => {
    const found = searchReleases("prove", releases);
    expect(found[0].version).toBe("3.01");
    expect(found[0].changes).toHaveLength(1);
  });

  it("finds a release whole by its version", () => {
    expect(searchReleases("3.01", releases)).toEqual([releases[1]]);
    expect(searchReleases("version 3.02", releases)).toEqual([releases[0]]);
  });

  it("counts what it found without naming what it did not", () => {
    expect(searchCountLine(2, 3, "undo")).toBe("2 workflows and 3 release notes mention “undo”");
    expect(searchCountLine(0, 1, "2.38")).toBe("1 release note mentions “2.38”");
    expect(searchCountLine(1, 0, "void")).toBe("1 workflow mentions “void”");
    expect(searchCountLine(0, 0, "payroll")).toBe("0 workflows mention “payroll”");
  });

  it("finds nothing for nothing, and lists no more than the limit", () => {
    expect(searchReleases("the", releases)).toEqual([]);
    expect(searchReleases("payroll", releases)).toEqual([]);
    const many = Array.from({ length: 20 }, (_, i) => ({ ...releases[0], version: `4.${i}` }));
    expect(searchReleases("undo", many)).toHaveLength(RELEASE_SEARCH_LIMIT);
  });
});

describe("Show accounts with no balance", () => {
  const row = (accountId: string, accountType: LedgerBalance["accountType"], debitBase: number, creditBase: number): LedgerBalance => ({
    accountId,
    accountCode: accountId,
    name: accountId,
    accountType,
    debitBase,
    creditBase,
  });
  // An emptied bank account, a card paid off, an account with a balance.
  const rows = [row("1000", "bank", 500, 500), row("2100", "credit_card", 80, 80), row("1100", "accounts_receivable", 300, 0)];

  it("leaves an account that holds nothing out unless asked, as before", () => {
    expect(buildTrialBalance(rows).lines.map((l) => l.accountId)).toEqual(["1100"]);
    expect(buildBalanceSheet(rows).assets.lines.map((l) => l.accountId)).toEqual(["1100"]);
  });

  it("keeps it, at nothing, in its own section when asked", () => {
    const tb = buildTrialBalance(rows, { keepZero: true });
    expect(tb.lines.map((l) => [l.accountId, l.debit, l.credit])).toEqual([
      ["1000", 0, 0],
      ["2100", 0, 0],
      ["1100", 300, 0],
    ]);
    expect(tb.totalDebit).toBe(300);
    const sheet = buildBalanceSheet(rows, { keepZero: true });
    expect(sheet.assets.lines.map((l) => [l.accountId, l.amount])).toEqual([
      ["1000", 0],
      ["1100", 300],
    ]);
    expect(sheet.liabilities.lines.map((l) => [l.accountId, l.amount])).toEqual([["2100", 0]]);
    expect(sheet.balanced).toBe(buildBalanceSheet(rows).balanced);
  });

  it("brings in an account first posted to after the date, at nothing", () => {
    const later = [...rows, row("1200", "current_asset", 900, 0)];
    const padded = withAccountsUsed(rows, later);
    expect(padded.find((r) => r.accountId === "1200")).toMatchObject({ debitBase: 0, creditBase: 0 });
    expect(padded).toHaveLength(4);
    expect(withAccountsUsed(rows, rows)).toEqual(rows);
  });

  it("prints 0.00 on the side the account's balance normally sits, never two blanks", () => {
    const accounts: AccountRef[] = [
      { id: "1000", code: "1000", name: "Bank", type: "bank", parentId: null },
      { id: "2100", code: "2100", name: "Card", type: "credit_card", parentId: null },
      { id: "1100", code: "1100", name: "Receivable", type: "accounts_receivable", parentId: null },
    ];
    const statement = trialBalanceStatement({
      columns: [{ key: "c", label: "Oct 31", sub: "", from: null, to: "2026-10-31", isTotal: false }],
      tbs: [buildTrialBalance(rows, { keepZero: true })],
      accounts: indexAccounts(accounts),
      showZero: true,
    });
    const amounts = (id: string) => statement.rows.find((r) => r.accountId === id)!.cells.map((c) => c.amount);
    expect(amounts("1000")).toEqual([0, null]); // a debit-normal account: Debit 0.00
    expect(amounts("2100")).toEqual([null, 0]); // a credit-normal account: Credit 0.00
    expect(amounts("1100")).toEqual([300, null]); // a balance's empty side stays blank
  });
});
