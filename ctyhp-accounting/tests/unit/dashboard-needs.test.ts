import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CHECKS_FAILED,
  clearLine,
  dashboardNeeds,
  NOTHING_WAITING,
  unavailableNote,
  type AttentionChecks,
} from "@/lib/domain/dashboard-needs";
import type { HoldingRow, NoLongerAgreeRow, UnreconciledRow } from "@/lib/domain/exceptions";
import type { TransactionListRow } from "@/lib/domain/transaction-list";

const money = (minor: number) => `$${(minor / 100).toFixed(2)}`;
const none: AttentionChecks = { waitingLines: 0, neverReconciled: [], noLongerAgree: [], holding: [], futureDated: [], unavailable: [] };

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
    expect(clearLine(checks.unavailable)).toBe("Nothing is waiting among the checks that ran.");
  });

  it("is clear only when every check ran, and failed when none did", () => {
    expect(dashboardNeeds(none, money)).toEqual([]);
    expect(clearLine([])).toBe(NOTHING_WAITING);
    expect(unavailableNote([])).toBeNull();
    expect(clearLine(["waiting", "neverReconciled", "noLongerAgree", "holding", "futureDated"])).toBeNull();
    expect(CHECKS_FAILED).toContain("Exception report");
  });

  it("is streamed in after the rest of the Dashboard, so its reads never hold up the figures", () => {
    const page = readFileSync(join(process.cwd(), "app/(app)/dashboard/page.tsx"), "utf8");
    expect(page).toMatch(/<Suspense fallback=\{<NeedsAttention loading \/>\}>\s*<NeedsSection/);
  });
});
