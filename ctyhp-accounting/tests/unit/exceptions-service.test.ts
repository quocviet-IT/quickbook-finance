import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getExceptionReport } from "@/lib/services/exceptions";

/**
 * The `unavailable` mechanism, which is where this branch's worst bugs lived.
 *
 * `getExceptionReport` reads twelve checks' worth of data behind `readOr`,
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
  journalLines: Source;
  monthlyBalances: Source;
  reconciliationLines: Source;
  bankStanding: Source;
  clearingStanding: Source;
  statementOverrides: Source;
  actors: Source;
  companySettings: Source;
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
    journalLines: [],
    monthlyBalances: [],
    reconciliationLines: [],
    bankStanding: [],
    clearingStanding: [],
    statementOverrides: [],
    actors: [],
    companySettings: [],
  };
}

function resultOf(source: Source): { data: Row[] | null; error: { message: string } | null } {
  if (source instanceof Error) return { data: null, error: { message: source.message } };
  return { data: source, error: null };
}

/**
 * One page of a source, the way `.range(from, to)` returns it: inclusive at
 * both ends. Returning the whole source regardless would make any paging loop
 * see a full page forever, so a fixture of a thousand rows or more would hang
 * the suite instead of failing it.
 */
function pageOf(source: Source, from: number, to: number) {
  return source instanceof Error ? resultOf(source) : resultOf(source.slice(from, to + 1));
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
  /** A read that never asks for a range, as `listBankAccounts` does: `await` gets everything. */
  then: (resolve: (value: { data: Row[] | null; error: { message: string } | null }) => unknown) => unknown;
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
    range: async (from: number, to: number) => pageOf(source, from, to),
    then: (resolve) => resolve(resultOf(source)),
  };
  return builder;
}

/** `getCurrentCompanySettings` reads the newest settings row with `.limit(1).maybeSingle()`. */
function settingsChain(source: Source) {
  const builder = {
    select: () => builder,
    order: () => builder,
    limit: () => builder,
    maybeSingle: async () => {
      if (source instanceof Error) return { data: null, error: { message: source.message } };
      return { data: source[0] ?? null, error: null };
    },
  };
  return builder as unknown as Chain;
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
          return chainFor(c.journalLines);
        case "acc_reconciliation_line":
          return chainFor(c.reconciliationLines);
        case "acc_company_setting_version":
          return settingsChain(c.companySettings);
        case "acc_journal_reversal_link":
          return chainFor([]);
        default:
          throw new Error(`fakeClient: unhandled table "${table}"`);
      }
    },
    rpc(name: string, args: Record<string, unknown>) {
      // `reports.ts` pages every set-returning RPC with `.range()`, which
      // supabase-js's builder allows on an rpc call as on a select. This stub
      // models only `.range()`, not a bare `await`: every RPC read in this
      // service goes through the paging helper, which always calls it.
      const paged = (source: Source) => ({
        range: async (from: number, to: number) => pageOf(source, from, to),
      });
      if (name === "acc_ledger_balances") return paged(c.ledgerBalances);
      if (name === "acc_transaction_list") {
        // The same RPC serves two different reads here — entries in range and
        // entries after today — told apart the only way the caller can: the
        // `p_to` it sent. The future-dated read is the one that runs to
        // "9999-12-31".
        return paged(args.p_to === "9999-12-31" ? c.txnAfterToday : c.txnInRange);
      }
      if (name === "acc_monthly_ledger_balances") return paged(c.monthlyBalances);
      if (name === "acc_statement_overrides") return { order: () => ({ order: () => paged(c.statementOverrides) }) };
      if (name === "acc_actor_directory") return resultOf(c.actors);
      if (name === "acc_clearing_standing") return { order: () => paged(c.clearingStanding) };
      if (name === "acc_bank_standing") {
        const ordered = { order: () => paged(c.bankStanding) };
        return ordered;
      }
      throw new Error(`fakeClient: unhandled rpc "${name}"`);
    },
  };
  return sb as unknown as SupabaseClient;
}

const CLEARING_ACCOUNT = { id: "u1", is_contra: false, is_clearing: true, detail_type: "undeposited_funds" };
const CLEARING_LEDGER = {
  account_id: "u1",
  account_code: "1250",
  name: "Card Settlements",
  account_type: "current_asset",
  debit_base: 500_000,
  credit_base: 0,
};
const CLEARING_STANDING = {
  account_id: "u1",
  balance_minor: "500000",
  last_movement_date: "2025-12-30",
  open_count: 7,
  open_oldest_date: "2025-12-05",
  open_minor: "500000",
};
const HOLDING_LEDGER = {
  account_id: "h1",
  account_code: "9000",
  name: "Uncategorized Expense",
  account_type: "expense",
  debit_base: 250_000,
  credit_base: 0,
};

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
    expect(report.unavailable).toEqual(["clearing", "wrongWay", "holding", "unreconciled"]);
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

  it("tags only the clearing check when the standing cannot be read, and the other checks still run", async () => {
    const sb = fakeClient({
      accounts: [CLEARING_ACCOUNT],
      ledgerBalances: [CLEARING_LEDGER, HOLDING_LEDGER],
      clearingStanding: new Error("acc_clearing_standing unreachable"),
    });
    const report = await getExceptionReport(sb, FROM, TO, TODAY);
    expect(report.unavailable).toEqual(["clearing"]);
    expect(report.clearing).toEqual([]);
    expect(report.holding).toHaveLength(1);
  });

  it("lists a ticked clearing account from its balance and its standing, and leaves out one that is not ticked", async () => {
    const sb = fakeClient({
      accounts: [CLEARING_ACCOUNT, { id: "u2", is_contra: false, is_clearing: false, detail_type: "undeposited_funds" }],
      ledgerBalances: [
        CLEARING_LEDGER,
        { ...CLEARING_LEDGER, account_id: "u2", account_code: "1211", name: "Undeposited Funds" },
      ],
      clearingStanding: [CLEARING_STANDING],
    });
    const report = await getExceptionReport(sb, FROM, TO, TODAY);
    expect(report.unavailable).toEqual([]);
    expect(report.clearing).toHaveLength(1);
    expect(report.clearing[0]).toMatchObject({
      accountId: "u1",
      accountCode: "1250",
      balanceMinor: 500_000,
      leftStanding: true,
      itemNoun: "receipts",
    });
    expect(report.clearing[0].standing).toMatchObject({ openCount: 7, openOldestDate: "2025-12-05" });
    expect(report.questionsRaised).toBe(1);
  });

  it("names nothing as unavailable when every read succeeds", async () => {
    const sb = fakeClient();
    const report = await getExceptionReport(sb, FROM, TO, TODAY);
    expect(report.unavailable).toEqual([]);
    expect(report.checksRun).toBe(12);
  });

  it("tags both statement checks, and only them, when the bank-account lines cannot be read", async () => {
    // The statement checks share one read of every bank account's lines, so
    // neither can claim "nothing found" when it fails, and no other check is
    // taken down with it.
    const sb = fakeClient({
      bankAccounts: [BANK],
      journalLines: new Error("acc_journal_line unreachable"),
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
    expect(report.unavailable).toEqual(["statementBalance", "belowZero"]);
    expect(report.holding).toHaveLength(1);
    expect(report.statementBalance).toEqual([]);
    expect(report.belowZero).toEqual([]);
  });

  it("finds a bank account below zero from its own lines", async () => {
    const sb = fakeClient({
      bankAccounts: [BANK],
      journalLines: [
        journalLine("l1", "e1", "2026-01-01", 1_000, 0),
        journalLine("l2", "e2", "2026-01-03", 0, 5_000),
      ],
    });
    const report = await getExceptionReport(sb, FROM, TO, TODAY);
    expect(report.unavailable).toEqual([]);
    expect(report.belowZero).toEqual([
      {
        bankAccountId: "bank-1",
        accountName: "Operating Checking",
        nowMinor: -4_000,
        worstMinor: null,
        worstDate: null,
        lastStatementDate: null,
        outstandingCount: 1,
      },
    ]);
    expect(report.statementBalance).toEqual([]);
    expect(report.questionsRaised).toBeGreaterThanOrEqual(1);
  });
});

const BANK = {
  id: "bank-1",
  account_id: "gl-1",
  bank_name: "First Test Bank",
  created_at: "2026-01-01T00:00:00Z",
  acc_account: { name: "Operating Checking" },
};

function journalLine(id: string, entryId: string, date: string, debit: number, credit: number): Row {
  return {
    id,
    debit_minor: debit,
    credit_minor: credit,
    amount_base_minor: debit || credit,
    acc_journal_entry: { id: entryId, entry_number: `JE-${id}`, entry_date: date, source_type: "manual" },
  };
}

describe("getExceptionReport: the bank standing read", () => {
  const LEDGER = {
    account_id: "gl-1",
    account_code: "1000",
    name: "Operating Checking",
    account_type: "bank",
    debit_base: 120_000,
    credit_base: 0,
  };
  const STANDING = {
    bank_account_id: "bank-1",
    since_count: 3,
    since_net_minor: -4_500,
    void_ticked_count: 2,
    void_ticked_minor: 9_900,
    void_reconciliation_date: "2026-06-30",
  };

  it("fills the voided-tick rows and the since figures from one standing read", async () => {
    const sb = fakeClient({ bankAccounts: [BANK], ledgerBalances: [LEDGER], bankStanding: [STANDING] });
    const report = await getExceptionReport(sb, FROM, TO, TODAY);
    expect(report.unavailable).toEqual([]);
    expect(report.noLongerAgree).toEqual([
      { bankAccountId: "bank-1", accountName: "Operating Checking", entryCount: 2, amountMinor: 9_900, reconciliationDate: "2026-06-30" },
    ]);
    expect(report.unreconciled).toHaveLength(1);
    expect(report.unreconciled[0]).toMatchObject({ sinceCount: 3, sinceNetMinor: -4_500 });
  });

  it("tags only the voided-tick check when the standing cannot be read, and keeps the not-agreed rows", async () => {
    const sb = fakeClient({
      bankAccounts: [BANK],
      ledgerBalances: [LEDGER],
      bankStanding: new Error("acc_bank_standing missing"),
    });
    const report = await getExceptionReport(sb, FROM, TO, TODAY);
    expect(report.unavailable).toEqual(["noLongerAgree"]);
    expect(report.noLongerAgree).toEqual([]);
    expect(report.unreconciled).toHaveLength(1);
    expect(report.unreconciled[0].sinceCount).toBeNull();
    expect(report.unreconciled[0].sinceNetMinor).toBeNull();
  });
});

describe("getExceptionReport: the statements imported out of balance read", () => {
  const OVERRIDE = (over: Row = {}): Row => ({
    batch_id: "batch-1",
    bank_account_id: "bank-1",
    filename: "example-june.csv",
    imported_at: "2026-09-10T02:30:00Z",
    overridden_by: "user-1",
    override_reason: "Bank confirmed the printed total is wrong",
    out_by_minor: "1250",
    statement_opening_minor: "100000",
    statement_closing_minor: "150000",
    first_line_date: "2026-09-01",
    last_line_date: "2026-09-30",
    settled_by_reconciliation_id: null,
    settled_through: null,
    ...over,
  });
  const ACTORS = [{ id: "user-1", email: "dana@example.test", full_name: "Dana Example" }];
  const SETTINGS = [{ time_zone: "America/Los_Angeles" }];

  it("lists an open override with its name and the company's clock, bigint strings read as numbers", async () => {
    const sb = fakeClient({ bankAccounts: [BANK], statementOverrides: [OVERRIDE()], actors: ACTORS, companySettings: SETTINGS });
    const report = await getExceptionReport(sb, FROM, TO, TODAY);
    expect(report.unavailable).toEqual([]);
    expect(report.statementOverride).toEqual([
      expect.objectContaining({
        accountName: "Operating Checking",
        byName: "Dana Example",
        outByMinor: 1250,
        importedDay: "2026-09-09",
        importedTime: "7:30 PM",
      }),
    ]);
  });

  it("leaves a settled override out", async () => {
    const settled = OVERRIDE({ settled_by_reconciliation_id: "rec-1", settled_through: "2026-09-30" });
    const sb = fakeClient({ bankAccounts: [BANK], statementOverrides: [settled], actors: ACTORS, companySettings: SETTINGS });
    expect((await getExceptionReport(sb, FROM, TO, TODAY)).statementOverride).toEqual([]);
  });

  it("tags only this check when the overrides cannot be read", async () => {
    const sb = fakeClient({ statementOverrides: new Error("permission denied") });
    const report = await getExceptionReport(sb, FROM, TO, TODAY);
    expect(report.unavailable).toEqual(["statementOverride"]);
  });

  it("names a person the directory cannot name, rather than dropping the override", async () => {
    const sb = fakeClient({ bankAccounts: [BANK], statementOverrides: [OVERRIDE()], actors: new Error("down"), companySettings: SETTINGS });
    const report = await getExceptionReport(sb, FROM, TO, TODAY);
    expect(report.statementOverride[0].byName).toBe("an unknown user");
  });
});
