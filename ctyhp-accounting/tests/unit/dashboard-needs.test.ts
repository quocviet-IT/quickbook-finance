import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CHECKS_FAILED,
  clearLine,
  dashboardNeeds,
  NOTHING_WAITING,
  overBudgetAccounts,
  unavailableNote,
  type AttentionChecks,
} from "@/lib/domain/dashboard-needs";
import type { HoldingRow, NoLongerAgreeRow, UnreconciledRow } from "@/lib/domain/exceptions";
import type { TransactionListRow } from "@/lib/domain/transaction-list";
import { expectedBackupDate, FINAL_BACKUP_PASS, nightsMissed } from "@/lib/domain/backup-schedule";

const money = (minor: number) => `$${(minor / 100).toFixed(2)}`;
const none: AttentionChecks = {
  waitingLines: 0,
  recurringDue: [],
  neverReconciled: [],
  noLongerAgree: [],
  holding: [],
  futureDated: [],
  overBudget: null,
  unavailable: [],
};

const never = (accountName: string, balanceMinor: number) =>
  ({ bankAccountId: accountName, accountId: accountName, accountName, balanceMinor, lastReconciledDate: null, sinceCount: null, sinceNetMinor: null }) as UnreconciledRow;
const changed = (accountName: string, statementEndingDate: string) =>
  ({ reconciliationId: accountName, bankAccountId: accountName, statementEndingDate, items: [], unexplainedDriftMinor: 0, accountName }) as NoLongerAgreeRow;
const holding = (accountCode: string, name: string, balanceMinor: number): HoldingRow => ({ accountId: accountCode, accountCode, name, balanceMinor });
const future = (entryNumber: string, entryDate: string) => ({ entryNumber, entryDate }) as TransactionListRow;

describe("dashboardNeeds (2.88)", () => {
  it("lists what is waiting, in the order it matters, each with where to deal with it", () => {
    const needs = dashboardNeeds(
      {
        ...none,
        waitingLines: 14,
        neverReconciled: [never("Example Savings", 1_200_000)],
        noLongerAgree: [changed("Example Bank", "2026-08-31")],
        holding: [holding("6999", "Uncategorized Expense", 45_000), holding("4999", "Uncategorized Income", -12_000)],
        futureDated: [future("JE-000123", "2027-10-30")],
      },
      money,
    );
    expect(needs.map((n) => [n.key, n.count, n.tone, n.href])).toEqual([
      ["waiting", 14, "warning", "/banking?queue=unmatched"],
      ["neverReconciled", 1, "warning", "/banking/reconcile/history"],
      ["noLongerAgree", 1, "danger", "/reports/exceptions"],
      ["holding", 2, "warning", "/reports/exceptions"],
      ["futureDated", 1, "warning", "/reports/exceptions"],
    ]);
    expect(needs.map((n) => n.title)).toEqual([
      "Bank lines waiting to be coded",
      "Bank account never reconciled",
      "Reconciliation that no longer agrees",
      "Money in a holding account",
      "Entry dated in the future",
    ]);
    expect(needs[1].detail).toBe("A balance nobody has proved against a statement: Example Savings ($12000.00).");
    expect(needs[2].detail).toBe("Something ticked on Example Bank to 08/31/2026 has changed since it was signed off.");
    expect(needs[3].detail).toBe(
      "Still sitting in 6999 Uncategorized Expense ($450.00) and 4999 Uncategorized Income ($120.00) rather than where it belongs.",
    );
    expect(needs[4].detail).toBe("Usually a typing slip in the year: JE-000123 on 10/30/2027.");
  });

  it("names three and counts the rest", () => {
    const [need] = dashboardNeeds({ ...none, futureDated: ["1", "2", "3", "4", "5"].map((n) => future(`JE-00000${n}`, "2027-01-0" + n)) }, money);
    expect(need.title).toBe("Entries dated in the future");
    expect(need.detail).toBe("Usually a typing slip in the year: JE-000001 on 01/01/2027, JE-000002 on 01/02/2027, JE-000003 on 01/03/2027 and 2 more.");
  });

  it("says nothing of a check that could not run, and says it could not", () => {
    const checks: AttentionChecks = { ...none, waitingLines: 3, unavailable: ["waiting", "holding"] };
    expect(dashboardNeeds(checks, money)).toEqual([]);
    expect(unavailableNote(checks.unavailable)).toBe(
      "2 checks could not run just now, so lines waiting on Bank Transactions and holding accounts are not counted here.",
    );
    expect(clearLine(checks)).toBe("Nothing is waiting among the checks that ran.");
  });

  it("is clear only when every check ran, and failed when none did", () => {
    expect(dashboardNeeds(none, money)).toEqual([]);
    expect(clearLine(none)).toBe(NOTHING_WAITING);
    expect(unavailableNote([])).toBeNull();
    const allFailed: AttentionChecks["unavailable"] = [
      "waiting",
      "recurringDue",
      "neverReconciled",
      "noLongerAgree",
      "holding",
      "futureDated",
      "overBudget",
    ];
    // Without the backup check (no company.export), these seven failed is all of them.
    expect(clearLine({ unavailable: allFailed })).toBeNull();
    // With it, the backup check still ran.
    expect(clearLine({ unavailable: allFailed, backup: { lastBackup: "2026-10-29", expected: "2026-10-29" } })).toBe(
      "Nothing is waiting among the checks that ran.",
    );
    expect(CHECKS_FAILED).toContain("Exception report");
  });

  it("is streamed in after the rest of the Dashboard, so its reads never hold up the figures", () => {
    const page = readFileSync(join(process.cwd(), "app/(app)/dashboard/page.tsx"), "utf8");
    expect(page).toMatch(/<Suspense fallback=\{<NeedsAttention loading \/>\}>\s*<NeedsSection/);
  });
});

describe("recurring entries not posted, and accounts over budget (2.98)", () => {
  it("names the schedules the nightly run has not posted, after the bank lines and before the reconciliations", () => {
    const needs = dashboardNeeds(
      {
        ...none,
        waitingLines: 1,
        neverReconciled: [never("Example Savings", 100)],
        recurringDue: [{ name: "Office rent", nextRunDate: "2026-10-01" }],
      },
      money,
    );
    expect(needs.map((n) => n.key)).toEqual(["waiting", "recurringDue", "neverReconciled"]);
    expect(needs[1]).toEqual({
      key: "recurringDue",
      count: 1,
      tone: "warning",
      title: "Recurring entry not posted",
      detail: "Due and not posted by the nightly run: Office rent on 10/01/2026. The schedule says why when a run failed.",
      href: "/recurring",
    });
  });

  it("comes last with the accounts already over budget, spent of budgeted", () => {
    const needs = dashboardNeeds(
      {
        ...none,
        futureDated: [future("JE-000001", "2027-01-01")],
        overBudget: [{ accountCode: "6100", name: "Rent", actualMinor: 1_240_000, budgetMinor: 1_000_000 }],
      },
      money,
    );
    expect(needs.map((n) => n.key)).toEqual(["futureDated", "overBudget"]);
    expect(needs[1].title).toBe("Account over budget");
    expect(needs[1].detail).toBe("Spent more this fiscal year than budgeted to the end of this month: 6100 Rent ($12400.00 of $10000.00).");
    expect(needs[1].href).toBe("/reports?report=budget");
  });

  it("says nothing when there is no budget, or nothing over it", () => {
    expect(dashboardNeeds({ ...none, overBudget: null }, money)).toEqual([]);
    expect(dashboardNeeds({ ...none, overBudget: [] }, money)).toEqual([]);
  });

  it("finds only expense accounts that have gone past what is budgeted, biggest overrun first", () => {
    const budget = [
      { accountId: "rent", accountCode: "6100", name: "Rent", accountType: "expense", amountMinor: 1_000 },
      { accountId: "fuel", accountCode: "6200", name: "Fuel", accountType: "expense", amountMinor: 500 },
      { accountId: "cogs", accountCode: "5000", name: "Cost of sales", accountType: "cost_of_goods_sold", amountMinor: 2_000 },
      { accountId: "sales", accountCode: "4000", name: "Sales", accountType: "income", amountMinor: 100 },
      { accountId: "phone", accountCode: "6300", name: "Phone", accountType: "expense", amountMinor: 0 },
    ];
    const actual = [
      { accountId: "rent", debitBase: 1_200, creditBase: 0 },
      { accountId: "fuel", debitBase: 900, creditBase: 100 },
      { accountId: "cogs", debitBase: 1_000, creditBase: 0 },
      { accountId: "sales", debitBase: 0, creditBase: 5_000 },
      { accountId: "phone", debitBase: 50, creditBase: 0 },
    ];
    expect(overBudgetAccounts(budget, actual)).toEqual([
      { accountCode: "6200", name: "Fuel", actualMinor: 800, budgetMinor: 500 },
      { accountCode: "6100", name: "Rent", actualMinor: 1_200, budgetMinor: 1_000 },
    ]);
  });

  it("reads recurring schedules dated before today only, and the budget for the fiscal year to the end of this month", () => {
    const service = readFileSync(join(process.cwd(), "lib/services/exceptions.ts"), "utf8");
    expect(service).toMatch(/\.eq\("status", "active"\)\s*\.lt\("next_run_date", today\)/);
    expect(service).toMatch(/getBudgetAccountAmounts\(sb, fiscalYearForDate\(today, startMonth\), yearStart, monthEnd\)/);
    expect(service).toMatch(/getLedgerBalances\(sb, yearStart, today\)/);
  });
});

describe("Backup overdue (2.90)", () => {
  it("comes first, red, with the nights missed and the dates, linking to Backups", () => {
    const needs = dashboardNeeds({ ...none, waitingLines: 2, backup: { lastBackup: "2026-10-28", expected: "2026-10-30" } }, money);
    expect(needs[0]).toEqual({
      key: "backup",
      count: 2,
      tone: "danger",
      title: "Backup overdue",
      detail: "The last snapshot of these books is from 10/28/2026; one was due on 10/30/2026.",
      href: "/settings/backups",
    });
    expect(needs[1].key).toBe("waiting");
  });

  it("says so when the books were never backed up", () => {
    const [need] = dashboardNeeds({ ...none, backup: { lastBackup: null, expected: "2026-10-30" } }, money);
    expect([need.count, need.detail]).toEqual([1, "These books have never been backed up by the nightly run."]);
  });

  it("says nothing when the latest is on time, or to someone who may not see the backups", () => {
    expect(dashboardNeeds({ ...none, backup: { lastBackup: "2026-10-30", expected: "2026-10-30" } }, money)).toEqual([]);
    expect(dashboardNeeds({ ...none, backup: undefined }, money)).toEqual([]);
    expect(dashboardNeeds({ ...none, backup: null, unavailable: ["backup"] }, money)).toEqual([]);
  });
});

describe("when a snapshot is due (backup-schedule.ts)", () => {
  it("expects today's once the night's runs are over at 12:30 UTC, and yesterday's before", () => {
    expect(expectedBackupDate(new Date("2026-10-30T12:29:59Z"))).toBe("2026-10-29");
    expect(expectedBackupDate(new Date("2026-10-30T12:30:00Z"))).toBe("2026-10-30");
    expect(expectedBackupDate(new Date("2026-11-01T03:00:00Z"))).toBe("2026-10-31");
  });
  it("counts the nights missed", () => {
    expect(nightsMissed("2026-10-29", "2026-10-29")).toBe(0);
    expect(nightsMissed("2026-10-28", "2026-10-29")).toBe(1);
    expect(nightsMissed("2026-10-28", "2026-11-02")).toBe(5);
    expect(nightsMissed(null, "2026-10-29")).toBe(1);
  });
  it("names the night's last run as vercel.json calls it", () => {
    const crons = (JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8")) as { crons: { path: string }[] }).crons;
    const backups = crons.filter((c) => c.path.startsWith("/api/backups/run"));
    expect(new URL(backups[backups.length - 1].path, "http://x").searchParams.get("pass")).toBe(FINAL_BACKUP_PASS);
  });
});
