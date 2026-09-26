import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getExceptionReport } from "@/lib/services/exceptions";

/**
 * The `unavailable` mechanism, which is where this branch's worst bugs lived.
 *
 * `getExceptionReport` reads eight checks' worth of data behind `readOr`,
 * which is supposed to tag exactly the checks a failed read affects — no
 * more, no fewer — and let the rest of the report through untouched. Each
 * test here fails exactly one read and inspects what got tagged, because a
 * tag that is wrong in either direction is a report that lies: naming too few
 * checks hides a section rendering on bad data, and naming too many hides
 * working sections behind "could not run" for no reason.
 *
 * The stub Supabase client below answers every table and RPC this service
 * reads, each configurable independently to succeed with rows or fail with
 * an error — everything defaults to an empty, successful read, so a test only
 * has to say what is different.
 */

type Row = Record<string, unknown>;
type Source = Row[] | Error;

interface ReaderConfig {
  accounts: Source;
  ledgerBalances: Source;
  txnInRange: Source;
  txnAfterToday: Source;
  bankAccounts: Source;
  lastReconciled: Source;
  earliestEntry: Source;
  customerPayments: Source;
  vendorPayments: Source;
  undepositedLines: Source;
  monthlyBalances: Source;
}

function defaultConfig(): ReaderConfig {
  return {
    accounts: [],
    ledgerBalances: [],
    txnInRange: [],
    txnAfterToday: [],
    bankAccounts: [],
    lastReconciled: [],
    earliestEntry: [],
    customerPayments: [],
    vendorPayments: [],
    undepositedLines: [],
    monthlyBalances: [],
  };
}

function resultOf(source: Source): { data: Row[] | null; error: { message: string } | null } {
  if (source instanceof Error) return { data: null, error: { message: source.message } };
  return { data: source, error: null };
}

/** Every method this service calls on a query, chainable, resolving on `limit` or `range`. */
interface Chain {
  select: (columns?: string) => Chain;
  eq: (column: string, value: unknown) => Chain;
  not: (column: string, operator: string, value: unknown) => Chain;
  in: (column: string, values: readonly string[]) => Chain;
  lte: (column: string, value: unknown) => Chain;
  order: (column: string, options?: unknown) => Chain;
  limit: (count: number) => Promise<{ data: Row[] | null; error: { message: string } | null }>;
  range: (from: number, to: number) => Promise<{ data: Row[] | null; error: { message: string } | null }>;
}

function chainFor(source: Source): Chain {
  const builder: Chain = {
    select: () => builder,
    eq: () => builder,
    not: () => builder,
    in: () => builder,
    lte: () => builder,
    order: () => builder,
    limit: async () => resultOf(source),
    range: async () => resultOf(source),
  };
  return builder;
}

function fakeClient(overrides: Partial<ReaderConfig> = {}): SupabaseClient {
  const c: ReaderConfig = { ...defaultConfig(), ...overrides };

  const sb = {
    from(table: string): Chain {
      switch (table) {
        case "acc_account":
          return chainFor(c.accounts);
        case "acc_bank_account":
          return chainFor(c.bankAccounts);
        case "acc_statement_reconciliation":
          return chainFor(c.lastReconciled);
        case "acc_journal_entry":
          return chainFor(c.earliestEntry);
        case "acc_payment":
          return chainFor(c.customerPayments);
        case "acc_bill_payment":
          return chainFor(c.vendorPayments);
        case "acc_journal_line":
          return chainFor(c.undepositedLines);
        default:
          throw new Error(`fakeClient: unhandled table "${table}"`);
      }
    },
    rpc(name: string, args: Record<string, unknown>) {
      if (name === "acc_ledger_balances") return Promise.resolve(resultOf(c.ledgerBalances));
      if (name === "acc_transaction_list") {
        // The same RPC serves two different reads here — entries in range and
        // entries after today — told apart the only way the caller can: the
        // `p_to` it sent. The future-dated read is the one that runs to
        // "9999-12-31".
        return Promise.resolve(resultOf(args.p_to === "9999-12-31" ? c.txnAfterToday : c.txnInRange));
      }
      if (name === "acc_monthly_ledger_balances") return Promise.resolve(resultOf(c.monthlyBalances));
      throw new Error(`fakeClient: unhandled rpc "${name}"`);
    },
  };
  return sb as unknown as SupabaseClient;
}

const FROM = "2026-01-01";
const TO = "2026-09-26";
const TODAY = "2026-09-26";

describe("getExceptionReport: the unavailable mechanism", () => {
  it("tags both checkNumber and duplicates when the payment-references read fails", async () => {
    // Design §5 requires both. A payment reference feeds two checks: the
    // clash-by-check-number check directly, and the duplicate-entry check
    // through the reference it joins by. Losing either tag would mean one of
    // those two sections renders on data that silently fell back to blank.
    const sb = fakeClient({ customerPayments: new Error("acc_payment unreachable") });
    const report = await getExceptionReport(sb, FROM, TO, TODAY);
    expect(report.unavailable).toEqual(["checkNumber", "duplicates"]);
  });

  it("tags all four balance checks when the ledger-balances read fails", async () => {
    const sb = fakeClient({ ledgerBalances: new Error("acc_ledger_balances unreachable") });
    const report = await getExceptionReport(sb, FROM, TO, TODAY);
    expect(report.unavailable).toEqual(["undeposited", "wrongWay", "holding", "unreconciled"]);
  });

  it("tags only futureDated when the future-dated read fails, and the other checks still run", async () => {
    const sb = fakeClient({
      txnAfterToday: new Error("acc_transaction_list unreachable"),
      ledgerBalances: [
        {
          account_id: "h1",
          account_code: "9000",
          name: "Uncategorized Expense",
          account_type: "expense",
          debit_base: 250_000,
          credit_base: 0,
        },
      ],
    });
    const report = await getExceptionReport(sb, FROM, TO, TODAY);
    expect(report.unavailable).toEqual(["futureDated"]);
    // Proof that the other seven were not degraded by the same failure: this
    // one found exactly what its own data said to find.
    expect(report.holding).toHaveLength(1);
    expect(report.holding[0].balanceMinor).toBe(250_000);
  });

  it("reports the undeposited balance with entryCount null when only its detail read fails, and does not tag it", () => {
    const sb = fakeClient({
      ledgerBalances: [
        {
          account_id: "u1",
          account_code: "1210",
          name: "Undeposited Funds",
          account_type: "current_asset",
          debit_base: 500_000,
          credit_base: 0,
        },
      ],
      undepositedLines: new Error("acc_journal_line unreachable"),
    });
    return getExceptionReport(sb, FROM, TO, TODAY).then((report) => {
      // The balance is known regardless of whether the detail read worked, so
      // the check is not disabled — only the count and date it could not
      // read are absent, and absent is not the same answer as zero.
      expect(report.unavailable).toEqual([]);
      expect(report.undeposited).toHaveLength(1);
      expect(report.undeposited[0].balanceMinor).toBe(500_000);
      expect(report.undeposited[0].entryCount).toBeNull();
    });
  });

  it("names nothing as unavailable when every read succeeds", async () => {
    const sb = fakeClient();
    const report = await getExceptionReport(sb, FROM, TO, TODAY);
    expect(report.unavailable).toEqual([]);
    expect(report.checksRun).toBe(8);
  });
});
