import { describe, expect, it } from "vitest";
import { bankingControls, bankingWorkQueue } from "@/lib/services/banking-surface/sections";
import { previousMonthEnd } from "@/lib/services/banking-surface/facts";
import type {
  BankingContext,
  BankingFacts,
} from "@/lib/services/banking-surface/facts";
import type { BankTransactionRow, StatementReconciliationRow } from "@/lib/db/types";

const AT = "2026-08-22T09:00:00.000Z";

const CONTEXT: BankingContext = {
  asOf: "2026-08-22",
  currencyCode: "USD",
  currencyDecimals: 2,
  timeZone: "America/New_York",
};

function line(over: Partial<BankTransactionRow> & { id: string }): BankTransactionRow {
  return {
    bank_account_id: "acct-1",
    txn_date: "2026-08-01",
    description: "Card payment",
    amount_minor: -12_50,
    status: "unmatched",
    pending: false,
    provider_removed_at: null,
    ...over,
  } as BankTransactionRow;
}

function session(
  over: Partial<StatementReconciliationRow> & { id: string },
): StatementReconciliationRow {
  return {
    bank_account_id: "acct-1",
    statement_ending_date: "2026-07-31",
    status: "completed",
    completed_at: "2026-08-02T00:00:00.000Z",
    created_at: "2026-08-01T00:00:00.000Z",
    ...over,
  } as StatementReconciliationRow;
}

function facts(over: Partial<BankingFacts> = {}): BankingFacts {
  return {
    accounts: [{ id: "acct-1", name: "Operating" }],
    feeds: [],
    transactions: [],
    sessions: [],
    ...over,
  };
}

const controlBy = (rows: ReturnType<typeof bankingControls>, key: string) =>
  rows.find((row) => row.key === key)!;

describe("previousMonthEnd", () => {
  it("is the end of the month before, not thirty days ago", () => {
    // Statements arrive monthly. "Reconciled through last month end" is true on
    // the 1st and still true on the 28th; "within 30 days" quietly stops being
    // true halfway through a long month.
    expect(previousMonthEnd("2026-08-22")).toBe("2026-07-31");
    expect(previousMonthEnd("2026-03-01")).toBe("2026-02-28");
    expect(previousMonthEnd("2026-01-15")).toBe("2025-12-31");
  });
});

describe("bankingControls", () => {
  it("counts settled unmatched lines and excludes pending ones", () => {
    const rows = bankingControls(
      facts({
        transactions: [
          line({ id: "a" }),
          line({ id: "b", pending: true }),
          line({ id: "c", status: "matched" }),
        ],
      }),
      CONTEXT,
      AT,
    );
    const unmatched = controlBy(rows, "unmatched-activity");
    expect(unmatched.status).toBe("blocked");
    expect(unmatched.detail).toContain("1 line");
    expect(unmatched.detail).toContain("1 pending line excluded");
  });

  it("an in-progress session does not count as reconciled", () => {
    // Somebody started; nothing tied out. Treating it as done would report an
    // account as current on the strength of an intention.
    const rows = bankingControls(
      facts({ sessions: [session({ id: "s1", status: "in_progress" })] }),
      CONTEXT,
      AT,
    );
    const reconciliation = controlBy(rows, "statement-reconciliation");
    expect(reconciliation.status).toBe("attention");
    expect(reconciliation.detail).toContain("Operating");
  });

  it("passes when a completed session reaches last month end", () => {
    const rows = bankingControls(
      facts({ sessions: [session({ id: "s1", statement_ending_date: "2026-07-31" })] }),
      CONTEXT,
      AT,
    );
    expect(controlBy(rows, "statement-reconciliation").status).toBe("healthy");
  });

  it("a session that stops short of last month end leaves the account behind", () => {
    const rows = bankingControls(
      facts({ sessions: [session({ id: "s1", statement_ending_date: "2026-05-31" })] }),
      CONTEXT,
      AT,
    );
    expect(controlBy(rows, "statement-reconciliation").status).toBe("attention");
  });

  it("takes the furthest completed session, not the newest row", () => {
    const rows = bankingControls(
      facts({
        sessions: [
          session({ id: "s2", statement_ending_date: "2026-05-31" }),
          session({ id: "s1", statement_ending_date: "2026-07-31" }),
        ],
      }),
      CONTEXT,
      AT,
    );
    expect(controlBy(rows, "statement-reconciliation").status).toBe("healthy");
  });
});

describe("bankingWorkQueue", () => {
  it("itemises unmatched lines, oldest first", () => {
    const items = bankingWorkQueue(
      facts({
        transactions: [
          line({ id: "old", txn_date: "2026-01-05", description: "Old one" }),
          line({ id: "new", txn_date: "2026-08-20", description: "New one" }),
        ],
      }),
      CONTEXT,
      null,
      AT,
    );
    expect(items.map((item) => item.sourceId)).toEqual(["old", "new"]);
    expect(items[0].reason).toContain("Operating");
    expect(items[0].reason).toContain("2026-01-05");
  });

  it("never produces a control row, because every check here is a summary of these rows", () => {
    const items = bankingWorkQueue(
      facts({ transactions: [line({ id: "a" })] }),
      CONTEXT,
      null,
      AT,
    );
    expect(items.every((item) => item.sourceKind !== "control-failure")).toBe(true);
    // And nothing on this surface blocks, so everything can be dismissed.
    expect(items.every((item) => item.blocking === false)).toBe(true);
  });

  it("caps the rows and leaves the true total to the control", () => {
    const many = Array.from({ length: 120 }, (_, index) =>
      line({ id: `t${index}`, txn_date: "2026-02-01" }),
    );
    const items = bankingWorkQueue(facts({ transactions: many }), CONTEXT, null, AT);
    expect(items).toHaveLength(50);
    // The count a reader needs is not hidden: the control still says 120.
    const rows = bankingControls(facts({ transactions: many }), CONTEXT, AT);
    expect(controlBy(rows, "unmatched-activity").detail).toContain("120 lines");
  });

  it("the company's own limit decides what is late, and its absence decides nothing", () => {
    const stale = facts({ transactions: [line({ id: "a", txn_date: "2026-08-10" })] });
    expect(bankingWorkQueue(stale, CONTEXT, null, AT)[0].severity).toBe("low");
    expect(bankingWorkQueue(stale, CONTEXT, 7, AT)[0].severity).toBe("high");
    expect(bankingWorkQueue(stale, CONTEXT, 5, AT)[0].severity).toBe("critical");
  });

  it("uses the size of a line, not its direction", () => {
    // Money out is as unmatched as money in, and the queue's last tie-breaker
    // asks how much is at stake rather than which way it went.
    const items = bankingWorkQueue(
      facts({ transactions: [line({ id: "a", amount_minor: -500_00 })] }),
      CONTEXT,
      null,
      AT,
    );
    expect(items[0].amountMinor).toBe(500_00);
  });

  it("a broken feed and an unfinished reconciliation are work too", () => {
    const items = bankingWorkQueue(
      facts({
        feeds: [
          {
            id: "f1",
            institutionName: "First National",
            status: "error",
            lastError: "Login required",
            lastSyncAt: "2026-08-01T00:00:00.000Z",
            broken: true,
          },
        ],
        sessions: [session({ id: "s1", status: "in_progress" })],
      }),
      CONTEXT,
      null,
      AT,
    );
    expect(items.map((item) => item.sourceKind).sort()).toEqual([
      "broken-feed",
      "open-reconciliation",
    ]);
    expect(items.find((item) => item.sourceKind === "broken-feed")?.reason).toBe(
      "Login required",
    );
  });
});
