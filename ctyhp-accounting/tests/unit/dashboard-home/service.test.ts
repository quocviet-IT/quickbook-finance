import { describe, expect, it } from "vitest";
import { chartFigures } from "@/lib/domain/chart-groups";
import { listAccounts } from "@/lib/services/accounts";
import { getDashboardHome, type DashboardHome } from "@/lib/services/dashboard-home";
import { getLedgerBalances } from "@/lib/services/reports";
import { fakeSupabase, filterValue, type Answer, type FakeHandlers } from "./fake-supabase";

/**
 * getDashboardHome against a fake PostgREST: one sample company, read the way
 * the service reads it. Every figure below is worked out by hand from the rows.
 */
const AS_OF = "2026-11-13";
const INPUT = { asOf: AS_OF, fiscalStartMonth: 1, baseCurrency: { code: "USD", decimals: 2 }, watchlist: [] as string[] | null };

type Type = "bank" | "accounts_receivable" | "current_asset" | "accounts_payable" | "credit_card" | "income" | "cost_of_goods_sold" | "expense";
const ACCOUNTS: Record<string, { name: string; type: Type; detail?: string }> = {
  "1000": { name: "Cash on Hand", type: "bank", detail: "cash_on_hand" },
  "1010": { name: "Sample Checking", type: "bank", detail: "checking" },
  "1030": { name: "Sample Savings", type: "bank", detail: "savings" },
  "1100": { name: "Accounts Receivable", type: "accounts_receivable" },
  "1210": { name: "Undeposited Funds", type: "current_asset", detail: "undeposited_funds" },
  "2000": { name: "Accounts Payable", type: "accounts_payable" },
  "2050": { name: "Sample Card", type: "credit_card" },
  "4000": { name: "Sales", type: "income" },
  "5000": { name: "Cost of Goods Sold", type: "cost_of_goods_sold" },
  "6100": { name: "Rent", type: "expense" },
};

/** One ledger row as acc_ledger_balances returns it. */
const ledgerRow = (code: string, debit: number, credit: number) => ({
  account_id: `a-${code}`,
  account_code: code,
  name: ACCOUNTS[code].name,
  account_type: ACCOUNTS[code].type,
  debit_base: debit,
  credit_base: credit,
});

/** Every account, as the left join returns them: those with nothing at zero. */
const ledger = (moves: Record<string, [number, number]>) =>
  Object.keys(ACCOUNTS).map((code) => ledgerRow(code, moves[code]?.[0] ?? 0, moves[code]?.[1] ?? 0));

// The day before the 14-month window opens (2025-10-01).
const OPENING = ledger({
  "1000": [500_00, 0],
  "1010": [100_000_00, 40_000_00],
  "1030": [20_000_00, 0],
  "1100": [30_000_00, 20_000_00],
  "1210": [1_000_00, 600_00],
  "2000": [5_000_00, 12_000_00],
  "2050": [1_000_00, 3_000_00],
});

const FULL_MONTH: Record<string, [number, number]> = {
  "4000": [0, 50_000_00],
  "5000": [20_000_00, 0],
  "6100": [25_000_00, 0],
  "1010": [48_000_00, 44_000_00],
  "1100": [50_000_00, 48_000_00],
  "2000": [44_000_00, 45_000_00],
};
const MONTHS: Record<string, Record<string, [number, number]>> = {
  "2026-01": { "4000": [0, 10_000_00], "6100": [2_000_00, 0] },
  "2026-06": FULL_MONTH,
  "2026-07": FULL_MONTH,
  "2026-08": FULL_MONTH,
  "2026-09": FULL_MONTH,
  "2026-10": FULL_MONTH,
  "2026-11": { "4000": [0, 20_000_00], "5000": [8_800_00, 0], "6100": [9_000_00, 0], "1010": [18_000_00, 15_000_00], "1210": [300_00, 0] },
};
const MONTHLY = Object.entries(MONTHS).flatMap(([month, moves]) =>
  Object.entries(moves).map(([code, [debit, credit]]) => ({ month_key: month, ...ledgerRow(code, debit, credit) })),
);

const AR_ROWS = [
  { customer_id: "c1", customer_name: "Sample Retail Co.", doc_type: "invoice", doc_number: "INV-1", doc_date: "2026-07-09", due_date: "2026-08-08", balance_minor: 7_400_00 },
  { customer_id: "c2", customer_name: "Demo Boutique LLC", doc_type: "invoice", doc_number: "INV-2", doc_date: "2026-08-23", due_date: "2026-09-22", balance_minor: 5_150_00 },
  { customer_id: "c3", customer_name: "Example Gifts Inc.", doc_type: "invoice", doc_number: "INV-3", doc_date: "2026-10-17", due_date: "2026-11-16", balance_minor: 3_000_00 },
  { customer_id: "c3", customer_name: "Example Gifts Inc.", doc_type: "invoice", doc_number: "INV-4", doc_date: "2026-11-05", due_date: "2026-12-20", balance_minor: 4_700_00 },
  // A credit memo, negative as acc_ar_ageing returns it.
  { customer_id: "c2", customer_name: "Demo Boutique LLC", doc_type: "credit_memo", doc_number: "CM-1", doc_date: "2026-10-01", due_date: "2026-10-01", balance_minor: -250_00 },
];
const AP_ROWS = [
  { vendor_id: "v1", vendor_name: "Demo Metals Supply", doc_type: "bill", doc_number: "B-1", doc_date: "2026-10-02", due_date: "2026-11-01", balance_minor: 2_800_00 },
  { vendor_id: "v2", vendor_name: "Sample Packaging Co.", doc_type: "bill", doc_number: "B-2", doc_date: "2026-10-17", due_date: "2026-11-16", balance_minor: 2_750_00 },
  { vendor_id: "v3", vendor_name: "Example Insurance LLC", doc_type: "bill", doc_number: null, doc_date: "2026-11-05", due_date: "2026-12-05", balance_minor: 6_450_00 },
];

const STANDING = (id: string, book: number, closing: number | null, completed: string | null) => ({
  bank_account_id: id,
  last_completed_id: completed ? `r-${id}` : null,
  last_completed_date: completed,
  last_closing_minor: closing,
  last_brought_forward: false,
  since_count: 0,
  since_net_minor: 0,
  earlier_open_count: 0,
  earlier_open_net_minor: 0,
  void_ticked_count: 0,
  void_ticked_minor: 0,
  void_reconciliation_date: null,
  book_minor: book,
});

const LAST_LINE: Record<string, string> = { "b-checking": "2026-11-12", "b-savings": "2026-09-01", "b-card": "2026-11-10" };

/** The ranges no month of the window holds: the year before the last twelve months, last year, and the year before it. */
const LAST_12_PRIOR = { from: "2024-11-01", to: "2025-10-31" };
const LAST_YEAR = { from: "2025-01-01", to: "2025-12-31" };
const LAST_YEAR_PRIOR = { from: "2024-01-01", to: "2024-12-31" };

function handlers(over: { rpc?: FakeHandlers["rpc"]; tables?: FakeHandlers["tables"] } = {}): FakeHandlers {
  const ledgerBalances = (args: Record<string, unknown>): Answer => {
    if (args.p_from === null && args.p_to === "2025-09-30") return { data: OPENING };
    // The aging reports' control read: the ledger as of asOf.
    if (args.p_from === null && args.p_to === AS_OF) {
      const merged = OPENING.map((row) => {
        const moves = MONTHLY.filter((m) => m.account_code === row.account_code);
        return {
          ...row,
          debit_base: row.debit_base + moves.reduce((s, m) => s + m.debit_base, 0),
          credit_base: row.credit_base + moves.reduce((s, m) => s + m.credit_base, 0),
        };
      });
      return { data: merged };
    }
    // October 1-13: the same days of last month.
    if (args.p_from === "2026-10-01" && args.p_to === "2026-10-13") return { data: ledger({ "4000": [0, 18_000_00], "5000": [7_000_00, 0], "6100": [9_000_00, 0] }) };
    if (args.p_from === "2026-07-01" && args.p_to === "2026-08-13") return { data: ledger({ "4000": [0, 70_000_00], "5000": [28_000_00, 0], "6100": [36_000_00, 0] }) };
    if (args.p_from === "2025-01-01" && args.p_to === "2025-11-13") return { data: ledger({}) };
    // The periods of whole months that reach back past the window (3.0.41).
    if (args.p_from === LAST_12_PRIOR.from && args.p_to === LAST_12_PRIOR.to) return { data: ledger({ "4000": [0, 300_000_00], "6100": [250_000_00, 0] }) };
    if (args.p_from === LAST_YEAR.from && args.p_to === LAST_YEAR.to) {
      return { data: ledger({ "4000": [0, 400_000_00], "5000": [150_000_00, 0], "6100": [200_000_00, 0] }) };
    }
    if (args.p_from === LAST_YEAR_PRIOR.from && args.p_to === LAST_YEAR_PRIOR.to) return { data: ledger({ "4000": [0, 320_000_00], "6100": [300_000_00, 0] }) };
    throw new Error(`unexpected ledger read ${JSON.stringify(args)}`);
  };
  return {
    rpc: {
      acc_ledger_balances: ledgerBalances,
      acc_monthly_ledger_balances: (args) => {
        expect(args).toEqual({ p_to: AS_OF, p_months: 14 });
        return { data: MONTHLY };
      },
      // No entry in MONTHLY moves money between two bank accounts.
      acc_monthly_bank_transfers: (args) => {
        expect(args).toEqual({ p_to: AS_OF, p_months: 14 });
        return { data: [] };
      },
      acc_ar_ageing: () => ({ data: AR_ROWS }),
      acc_ap_ageing: () => ({ data: AP_ROWS }),
      acc_period_close_history: () => ({ data: [{ period_id: "p9", period_label: "2026-09", period_end: "2026-09-30", closed_at: "2026-10-08T15:00:00Z" }] }),
      acc_bank_standing: () => ({
        data: [
          STANDING("b-checking", 83_000_00, 80_214_11, "2026-10-31"),
          STANDING("b-savings", 20_000_00, 20_000_00, "2026-10-31"),
          // A card, debit positive in the books: owing 2,000.00 is -2,000.00.
          STANDING("b-card", -2_000_00, -1_500_00, "2026-09-30"),
        ],
      }),
      acc_bank_close_standing: () => ({
        data: [
          { bank_account_id: "b-checking", account_code: "1010", account_name: "Sample Checking", is_card: false, last_completed_on: "2026-10-31", unmatched_count: "37" },
          { bank_account_id: "b-savings", account_code: "1030", account_name: "Sample Savings", is_card: false, last_completed_on: "2026-10-31", unmatched_count: 0 },
          { bank_account_id: "b-card", account_code: "2050", account_name: "Sample Card", is_card: true, last_completed_on: "2026-09-30", unmatched_count: 0 },
        ],
      }),
      acc_has_permission: () => ({ data: true }),
      acc_audit_search: () => ({
        data: [
          { id: "e1", table_name: "acc_backup", record_id: null, action: "company.backup", actor_id: null, actor_email: null, before_json: null, after_json: null, created_at: "2026-11-13T07:00:00Z" },
          { id: "e2", table_name: "acc_invoice", record_id: "i1", action: "insert", actor_id: "u1", actor_email: "owner@example.com", before_json: null, after_json: { invoice_number: "INV-4" }, created_at: "2026-11-12T15:00:00Z" },
          { id: "e3", table_name: "acc_bill", record_id: "bl1", action: "update", actor_id: "u1", actor_email: "owner@example.com", before_json: null, after_json: { bill_number: "B-3" }, created_at: "2026-11-11T15:00:00Z" },
        ],
      }),
      ...over.rpc,
    },
    tables: {
      acc_account: () => ({
        data: Object.entries(ACCOUNTS).map(([code, a]) => ({ id: `a-${code}`, account_code: code, name: a.name, account_type: a.type, detail_type: a.detail ?? null })),
      }),
      acc_journal_entry: () => ({ data: [{ entry_date: "2026-11-12" }] }),
      acc_bank_account: () => ({
        data: [
          { id: "b-checking", account_id: "a-1010", bank_name: "Sample Checking", account_number_masked: "4821", currency_code: "USD", created_at: "2026-01-01", acc_account: { account_code: "1010", name: "Sample Checking", account_type: "bank" } },
          { id: "b-card", account_id: "a-2050", bank_name: "", account_number_masked: "3333", currency_code: "USD", created_at: "2026-01-02", acc_account: { account_code: "2050", name: "Sample Card", account_type: "credit_card" } },
          { id: "b-savings", account_id: "a-1030", bank_name: "Sample Savings", account_number_masked: null, currency_code: "USD", created_at: "2026-01-03", acc_account: { account_code: "1030", name: "Sample Savings", account_type: "bank" } },
        ],
      }),
      acc_bank_transaction: (q) => {
        const date = LAST_LINE[String(filterValue(q, "eq", "bank_account_id"))];
        return { data: date ? [{ txn_date: date }] : [] };
      },
      acc_payment: (q) => {
        if (q.select.includes("acc_customer")) {
          expect(q.limit).toBe(8);
          return {
            data: [
              { id: "p1", payment_date: "2026-11-10", amount_minor: 1_500_00, currency_code: "USD", acc_customer: { name: "Sample Retail Co." } },
              { id: "p2", payment_date: "2026-11-01", amount_minor: 900_00, currency_code: "EUR", acc_customer: { name: "Demo Boutique LLC" } },
            ],
          };
        }
        expect(filterValue(q, "gte", "payment_date")).toBe("2026-10-15");
        expect(filterValue(q, "neq", "status")).toBe("void");
        return {
          data: [
            { id: "p1", amount_minor: 1_500_00, currency_code: "USD" },
            { id: "p2", amount_minor: 900_00, currency_code: "EUR" },
            { id: "p3", amount_minor: 2_500_00, currency_code: "USD" },
          ],
        };
      },
      acc_bill_payment: () => ({ data: [{ id: "bp1", amount_minor: 3_000_00, currency_code: "USD" }] }),
      acc_currency: () => ({ data: [{ code: "EUR", decimal_places: 2 }] }),
      ...over.tables,
    },
  };
}

async function load(
  over: Parameters<typeof handlers>[0] = {},
  watchlist: string[] | null = [],
): Promise<{ home: DashboardHome; requests: string[] }> {
  const { sb, requests } = fakeSupabase(handlers(over));
  const home = await getDashboardHome(sb, { ...INPUT, watchlist });
  return { home, requests };
}

const SECTIONS = ["status", "figures", "cash", "profit", "receivables", "payables", "payments", "bank", "activity", "insights"] as const;
const states = (home: DashboardHome) => Object.fromEntries(SECTIONS.map((key) => [key, home[key].dataState]));

/** Cash at the end of November 2025, the month before the twelve Cash flow returns: the opening's 80,500, nothing moved since. */
const CASH_BEFORE_CHART = 80_500_00;
/** December 2025 to May 2026, the first six of Cash flow's twelve months: no bank account moved. */
const QUIET = [0, 0, 0, 0, 0, 0];
/** Cash at each of those six month ends. */
const QUIET_CASH = [80_500_00, 80_500_00, 80_500_00, 80_500_00, 80_500_00, 80_500_00];

/** Each month's money in minus money out, beside its change in cash on hand. */
function flowAgainstBalance(cash: NonNullable<DashboardHome["cash"]["data"]>): { flow: number[]; change: number[] } {
  const before = [CASH_BEFORE_CHART, ...cash.balanceMinor.slice(0, -1)];
  return {
    flow: cash.inMinor.map((value, index) => value - cash.outMinor[index]),
    change: cash.balanceMinor.map((value, index) => value - before[index]),
  };
}

/**
 * MONTHLY with 5,000 moved from Sample Checking to Sample Savings in October:
 * one entry, a credit to checking and a debit to savings.
 */
const WITH_TRANSFER = [
  ...MONTHLY.map((row) => (row.month_key === "2026-10" && row.account_code === "1010" ? { ...row, credit_base: row.credit_base + 5_000_00 } : row)),
  { month_key: "2026-10", ...ledgerRow("1030", 5_000_00, 0) },
];

describe("getDashboardHome", () => {
  it("reads every section fresh from one pass of shared reads", async () => {
    const { home } = await load();
    expect(states(home)).toEqual(Object.fromEntries(SECTIONS.map((key) => [key, "fresh"])));
    expect(home.asOf).toBe(AS_OF);
  });

  it("counts cash on hand as every bank-type account, and the bank widget's total is the same figure", async () => {
    const { home } = await load();
    // Opening 500 + 60,000 + 20,000; five months of +4,000 on checking; November +3,000.
    const cash = home.figures.data!.cash;
    expect(cash.valueMinor).toBe(103_500_00);
    expect(cash.series).toEqual([84_500_00, 88_500_00, 92_500_00, 96_500_00, 100_500_00, 103_500_00]);
    expect(cash.changeThisMonthMinor).toBe(3_000_00);
    const bank = home.bank.data!;
    expect(bank.totalBookMinor).toBe(cash.valueMinor);
    // Cash on Hand has no bank account record: it is in the total and named apart.
    expect(bank.otherCash).toEqual({ accounts: 1, bookMinor: 500_00 });
    const listed = bank.accounts.filter((a) => !a.isCard).reduce((sum, a) => sum + a.bookMinor, 0);
    expect(listed + bank.otherCash!.bookMinor).toBe(bank.totalBookMinor);
    // Cash flow returns twelve months (3.0.41); its last six are the figure's series.
    expect(home.cash.data!.balanceMinor).toEqual([...QUIET_CASH, ...cash.series]);
    expect(home.cash.data!.months.map((m) => m.key)).toEqual([
      "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11",
    ]);
  });

  it("charts money in and out of the bank-type accounts, and says transfers between them are left out", async () => {
    const { home } = await load();
    // Nothing here moved between two bank accounts: money in and out are the bank debits and credits.
    expect(home.cash.data).toMatchObject({
      inMinor: [...QUIET, 48_000_00, 48_000_00, 48_000_00, 48_000_00, 48_000_00, 18_000_00],
      outMinor: [...QUIET, 44_000_00, 44_000_00, 44_000_00, 44_000_00, 44_000_00, 15_000_00],
      transfersExcluded: true,
    });
    const { flow, change } = flowAgainstBalance(home.cash.data!);
    expect(flow).toEqual(change);
  });

  it("leaves a transfer between two of the company's own bank accounts out of both money in and money out", async () => {
    const { home } = await load({
      rpc: {
        acc_monthly_ledger_balances: () => ({ data: WITH_TRANSFER }),
        // PostgREST may send a bigint as text.
        acc_monthly_bank_transfers: () => ({ data: [{ month_key: "2026-10", transfer_base: "500000" }] }),
      },
    });
    const cash = home.cash.data!;
    expect(home.cash.dataState).toBe("fresh");
    // October's bank debits are 53,000 and credits 49,000; the 5,000 transfer comes off both.
    expect(cash).toMatchObject({
      inMinor: [...QUIET, 48_000_00, 48_000_00, 48_000_00, 48_000_00, 48_000_00, 18_000_00],
      outMinor: [...QUIET, 44_000_00, 44_000_00, 44_000_00, 44_000_00, 44_000_00, 15_000_00],
      transfersExcluded: true,
    });
    // Moving money between two bank accounts does not change cash on hand.
    expect(cash.balanceMinor).toEqual([...QUIET_CASH, 84_500_00, 88_500_00, 92_500_00, 96_500_00, 100_500_00, 103_500_00]);
    const { flow, change } = flowAgainstBalance(cash);
    expect(flow).toEqual(change);
  });

  it("charts the gross figures when the transfers cannot be read, and says they count on both sides", async () => {
    const { home } = await load({
      rpc: {
        acc_monthly_ledger_balances: () => ({ data: WITH_TRANSFER }),
        acc_monthly_bank_transfers: () => ({ error: { message: "statement timeout" } }),
      },
    });
    // Only the footnote changes: every section is read.
    expect(states(home)).toEqual(Object.fromEntries(SECTIONS.map((key) => [key, "fresh"])));
    const cash = home.cash.data!;
    expect(cash).toMatchObject({
      inMinor: [...QUIET, 48_000_00, 48_000_00, 48_000_00, 48_000_00, 53_000_00, 18_000_00],
      outMinor: [...QUIET, 44_000_00, 44_000_00, 44_000_00, 44_000_00, 49_000_00, 15_000_00],
      transfersExcluded: false,
    });
    const { flow, change } = flowAgainstBalance(cash);
    expect(flow).toEqual(change);
    expect(JSON.stringify(home)).not.toContain("statement timeout");
  });

  it("charts the gross figures, and says transfers count on both sides, when a month's transfers exceed its bank debits or credits", async () => {
    // A transfer posted between the ledger read and the transfers read: never a wrong net, never a blank card.
    const { home } = await load({ rpc: { acc_monthly_bank_transfers: () => ({ data: [{ month_key: "2026-11", transfer_base: 15_000_01 }] }) } });
    expect(states(home)).toEqual(Object.fromEntries(SECTIONS.map((key) => [key, "fresh"])));
    const cash = home.cash.data!;
    expect(cash.transfersExcluded).toBe(false);
    const { flow, change } = flowAgainstBalance(cash);
    expect(flow).toEqual(change);
  });

  it("makes the figures and the tabs agree: receivables and payables are the aging totals", async () => {
    const { home } = await load();
    const figures = home.figures.data!;
    const receivables = home.receivables.data!;
    const payables = home.payables.data!;
    expect(figures.receivables.valueMinor).toBe(receivables.totalMinor);
    expect(figures.receivables.valueMinor).toBe(20_000_00);
    expect(figures.receivables).toMatchObject({ overdueMinor: receivables.overdueMinor, overdueInvoices: receivables.overdueDocuments });
    expect(receivables).toMatchObject({ overdueMinor: 12_550_00, overdueDocuments: 2, dueSoonMinor: 3_000_00, laterMinor: 4_700_00, creditsMinor: -250_00, documents: 4 });
    expect(figures.payables.valueMinor).toBe(payables.totalMinor);
    expect(figures.payables).toMatchObject({ valueMinor: 12_000_00, overdueMinor: 2_800_00, overdueBills: 1, dueSoonMinor: 2_750_00, dueSoonBills: 1 });
    // The ledger's month-end balances: receivables debit positive, payables shown positive.
    expect(figures.receivables.series).toEqual([12_000_00, 14_000_00, 16_000_00, 18_000_00, 20_000_00, 20_000_00]);
    expect(figures.payables.series).toEqual([8_000_00, 9_000_00, 10_000_00, 11_000_00, 12_000_00, 12_000_00]);
    // The control accounts' balances today, from the read both aging reports share: here the open documents add up to them.
    expect([figures.receivables.ledgerMinor, receivables.ledgerMinor]).toEqual([20_000_00, 20_000_00]);
    expect([figures.payables.ledgerMinor, payables.ledgerMinor]).toEqual([12_000_00, 12_000_00]);
  });

  it("sums only base-currency payments and counts the others apart", async () => {
    const { home } = await load();
    expect(home.receivables.data!.receivedLast30).toEqual({ baseMinor: 4_000_00, count: 2, otherCurrencyCount: 1 });
    expect(home.payables.data!.paidLast30).toEqual({ baseMinor: 3_000_00, count: 1, otherCurrencyCount: 0 });
    // The list keeps each payment in its own currency.
    expect(home.payments.data).toEqual([
      { id: "p1", date: "2026-11-10", customerName: "Sample Retail Co.", amountMinor: 1_500_00, currencyCode: "USD", decimals: 2 },
      { id: "p2", date: "2026-11-01", customerName: "Demo Boutique LLC", amountMinor: 900_00, currencyCode: "EUR", decimals: 2 },
    ]);
  });

  it("finds what is waiting to be deposited, who owes longest and the bills to pay next", async () => {
    const { home } = await load();
    const receivables = home.receivables.data!;
    // 400 before the window and 300 in November.
    expect(receivables.undepositedMinor).toBe(700_00);
    expect(receivables.owesLongest.map((r) => [r.name, r.daysLate, r.overdueMinor])).toEqual([
      ["Sample Retail Co.", 97, 7_400_00],
      ["Demo Boutique LLC", 52, 5_150_00],
    ]);
    expect(home.payables.data!.nextBills.map((b) => [b.vendorName, b.daysUntilDue])).toEqual([
      ["Demo Metals Supply", -12],
      ["Sample Packaging Co.", 3],
      ["Example Insurance LLC", 22],
    ]);
  });

  it("projects cash 30, 60 and 90 days ahead from invoices and bills due, leaving out what is already late", async () => {
    const { home } = await load();
    const late = { overdueLeftOutMinor: 12_550_00, overdueBillsLeftOutMinor: 2_800_00 };
    expect(home.cash.data!.projections).toEqual({
      30: { through: "2026-12-13", invoicesDueMinor: 3_000_00, billsDueMinor: 9_200_00, projectedMinor: 103_500_00 + 3_000_00 - 9_200_00, ...late },
      // INV-4, due December 20, comes in at 60 days; nothing more falls due before February 11.
      60: { through: "2027-01-12", invoicesDueMinor: 7_700_00, billsDueMinor: 9_200_00, projectedMinor: 103_500_00 + 7_700_00 - 9_200_00, ...late },
      90: { through: "2027-02-11", invoicesDueMinor: 7_700_00, billsDueMinor: 9_200_00, projectedMinor: 103_500_00 + 7_700_00 - 9_200_00, ...late },
    });
  });

  it("builds the four periods from the monthly read and the comparisons from their own reads", async () => {
    const { home } = await load();
    const profit = home.profit.data!;
    expect(profit.salesMinor).toEqual([50_000_00, 50_000_00, 50_000_00, 50_000_00, 50_000_00, 20_000_00]);
    expect(profit.expenseMinor).toEqual([45_000_00, 45_000_00, 45_000_00, 45_000_00, 45_000_00, 17_800_00]);
    expect(profit.periods.month).toMatchObject({
      from: "2026-11-01",
      to: AS_OF,
      incomeMinor: 20_000_00,
      expenseMinor: 17_800_00,
      netMinor: 2_200_00,
      grossMarginPercent: expect.closeTo(56, 9),
      prior: { incomeMinor: 18_000_00, expenseMinor: 16_000_00, netMinor: 2_000_00, salesMinor: 18_000_00 },
      compareLabel: "vs same days in Oct",
    });
    expect(profit.periods.lastMonth).toMatchObject({ incomeMinor: 50_000_00, netMinor: 5_000_00, prior: { netMinor: 5_000_00 } });
    expect(profit.periods.quarter).toMatchObject({ incomeMinor: 70_000_00, expenseMinor: 62_800_00, prior: { incomeMinor: 70_000_00, netMinor: 6_000_00 } });
    // January's 10,000, five months of 50,000 and November's 20,000; nothing posted in the same days last year.
    expect(profit.periods.year).toMatchObject({ from: "2026-01-01", incomeMinor: 280_000_00, prior: null });
    const expenses = profit.periods.month!.expenses;
    expect(expenses.map((e) => [e.name, e.amountMinor])).toEqual([
      ["Rent", 9_000_00],
      ["Cost of Goods Sold", 8_800_00],
    ]);
    expect(expenses.reduce((s, e) => s + e.amountMinor, 0)).toBe(profit.periods.month!.expenseMinor);
    expect(home.figures.data!.netIncome).toEqual({
      valueMinor: 2_200_00,
      series: [5_000_00, 5_000_00, 5_000_00, 5_000_00, 5_000_00, 2_200_00],
      priorSameDaysMinor: 2_000_00,
      compareLabel: "vs same days in Oct",
    });
  });

  it("builds the three periods of whole months from the window where it holds them, and from a read of their own where it does not (3.0.41)", async () => {
    const { home } = await load();
    const { last3, last12, lastYear } = home.profit.data!.periods;
    // August to October: three months of 50,000 in and 45,000 out; compared with May to July, of which June and July are posted.
    expect(last3).toMatchObject({
      key: "last3",
      label: "Last 3 months",
      from: "2026-08-01",
      to: "2026-10-31",
      incomeMinor: 150_000_00,
      expenseMinor: 135_000_00,
      netMinor: 15_000_00,
      salesMinor: 150_000_00,
      prior: { incomeMinor: 100_000_00, expenseMinor: 90_000_00, netMinor: 10_000_00, salesMinor: 100_000_00 },
      compareLabel: "vs May – Jul 2026",
    });
    // November 2025 to October 2026, November's month to date left out: January's 10,000 less 2,000 of rent, and five whole months.
    expect(last12).toMatchObject({
      from: "2025-11-01",
      to: "2026-10-31",
      incomeMinor: 260_000_00,
      expenseMinor: 227_000_00,
      netMinor: 33_000_00,
      salesMinor: 260_000_00,
      prior: { incomeMinor: 300_000_00, expenseMinor: 250_000_00, netMinor: 50_000_00, salesMinor: 300_000_00 },
      compareLabel: "vs Nov 2024 – Oct 2025",
    });
    // 2025 and 2024, each read on its own: the window starts in October 2025.
    expect(lastYear).toMatchObject({
      from: "2025-01-01",
      to: "2025-12-31",
      incomeMinor: 400_000_00,
      expenseMinor: 350_000_00,
      netMinor: 50_000_00,
      grossMarginPercent: 62.5,
      prior: { incomeMinor: 320_000_00, expenseMinor: 300_000_00, netMinor: 20_000_00, salesMinor: 320_000_00 },
      compareLabel: "vs 2024",
    });
    // Every period carries its expenses by account, adding up to its total.
    for (const period of [last3, last12, lastYear]) expect(period!.expenses.reduce((s, e) => s + e.amountMinor, 0)).toBe(period!.expenseMinor);
    expect(lastYear!.expenses.map((e) => [e.name, e.amountMinor])).toEqual([
      ["Rent", 200_000_00],
      ["Cost of Goods Sold", 150_000_00],
    ]);
  });

  it("sums last year from the window when the window holds it, and reads a range two periods share once", async () => {
    // January 20, 2027: the window runs from December 2025, so all of 2026 is in it; last year and
    // the last twelve months are both 2026, and both are compared with 2025.
    const asOf = "2027-01-20";
    const reads: string[] = [];
    const base = handlers();
    const { sb } = fakeSupabase({
      rpc: {
        ...base.rpc,
        acc_monthly_ledger_balances: () => ({ data: MONTHLY }),
        acc_monthly_bank_transfers: () => ({ data: [] }),
        acc_ledger_balances: (args) => {
          reads.push(`${args.p_from}..${args.p_to}`);
          return { data: args.p_from === null ? OPENING : ledger({}) };
        },
      },
      tables: { ...base.tables, acc_payment: () => ({ data: [] }) },
    });
    const home = await getDashboardHome(sb, { ...INPUT, asOf });
    const { last12, lastYear } = home.profit.data!.periods;
    // January's 10,000, five months of 50,000 and November's 20,000; 2,000, 225,000 and 17,800 spent.
    expect(lastYear).toMatchObject({ from: "2026-01-01", to: "2026-12-31", incomeMinor: 280_000_00, expenseMinor: 244_800_00, netMinor: 35_200_00, prior: null });
    expect(last12).toMatchObject({ from: "2026-01-01", to: "2026-12-31", incomeMinor: 280_000_00, expenseMinor: 244_800_00, netMinor: 35_200_00, prior: null });
    expect(reads).not.toContain("2026-01-01..2026-12-31");
    expect(reads.filter((read) => read === "2025-01-01..2025-12-31")).toHaveLength(1);
  });

  it("says how far the books are posted and what each bank account needs", async () => {
    const { home } = await load();
    expect(home.status.data).toEqual({
      asOf: AS_OF,
      postedThrough: "2026-11-12",
      bankLinesThrough: "2026-11-12",
      lastClosed: { label: "September 2026", periodEnd: "2026-09-30" },
      behind: false,
      missingMonths: [],
      firstUse: false,
    });
    expect(home.figures.data!.months.map((m) => [m.label, m.posted])).toEqual([
      ["Jun", true], ["Jul", true], ["Aug", true], ["Sep", true], ["Oct", true], ["Nov", true],
    ]);
    expect(home.bank.data!.accounts.map((a) => [a.name, a.isCard, a.bookMinor, a.statusText, a.tone])).toEqual([
      ["Sample Checking", false, 83_000_00, "37 lines to code", "warning"],
      ["Sample Savings", false, 20_000_00, "No bank lines since 09/01/2026", "danger"],
      // A card's balance owed is shown positive, as the Banking screens show it; its name falls back to the ledger account's.
      ["Sample Card", true, 2_000_00, "Reconciled through 09/30/2026", "positive"],
    ]);
  });

  it("keeps recent activity to people's own changes", async () => {
    const { home } = await load();
    expect(home.activity.data!.map((a) => a.id)).toEqual(["e2", "e3"]);
  });

  it("works out the insights from the same reads", async () => {
    const { home } = await load();
    expect(home.insights.data!.map((i) => i.headline)).toEqual([
      // Two overdue customers: the larger one is named, never both (afaf1806).
      "1 customer owes 59% of what is overdue",
      "Cash covers 2.3 months of expenses",
      "Gross margin is 56.0%, down from 60.0% in October",
    ]);
  });

  it("makes the requests it is budgeted for: 23 plus one per bank account, one more for a payment in another currency", async () => {
    const { requests } = await load();
    // 3 bank accounts and one euro payment among the recent ones.
    expect(requests).toHaveLength(27);
    // The opening, the three "same days" comparisons, the year before the last twelve months, last year and
    // the year before it (3.0.41), and the ledger as of asOf, read once for both aging reports' control balance.
    expect(requests.filter((r) => r === "rpc:acc_ledger_balances")).toHaveLength(8);
    const tally = requests.reduce<Record<string, number>>((all, r) => ({ ...all, [r]: (all[r] ?? 0) + 1 }), {});
    expect(tally).toEqual({
      "rpc:acc_ledger_balances": 8,
      "rpc:acc_monthly_ledger_balances": 1,
      "rpc:acc_monthly_bank_transfers": 1,
      "rpc:acc_ar_ageing": 1,
      "rpc:acc_ap_ageing": 1,
      "from:acc_account": 1,
      "from:acc_journal_entry": 1,
      "rpc:acc_period_close_history": 1,
      "from:acc_bank_account": 1,
      "rpc:acc_bank_standing": 1,
      "rpc:acc_bank_close_standing": 1,
      "from:acc_bank_transaction": 3,
      "from:acc_payment": 2,
      "from:acc_bill_payment": 1,
      "from:acc_currency": 1,
      "rpc:acc_has_permission": 1,
      "rpc:acc_audit_search": 1,
    });
  });
});

describe("one failing read costs only the sections built on it", () => {
  it("the monthly ledger read: the figures, cash, profit, bank and insights go; the rest stay", async () => {
    const { home } = await load({ rpc: { acc_monthly_ledger_balances: () => ({ error: { message: "statement timeout" } }) } });
    expect(states(home)).toEqual({
      status: "fresh",
      figures: "unavailable",
      cash: "unavailable",
      profit: "unavailable",
      receivables: "fresh",
      payables: "fresh",
      payments: "fresh",
      bank: "unavailable",
      activity: "fresh",
      insights: "unavailable",
    });
    // The undeposited line is left out rather than guessed; the rest of the invoices widget stands.
    expect(home.receivables.data).toMatchObject({ undepositedMinor: null, totalMinor: 20_000_00 });
    // The database's words never reach the screen.
    expect(home.figures.unavailableReason).toBe("The four figures could not be read.");
    expect(JSON.stringify(home)).not.toContain("statement timeout");
  });

  it("the receivables aging: the figures, invoices and the projection go; payables and the insights stay", async () => {
    const { home } = await load({ rpc: { acc_ar_ageing: () => ({ error: { message: "boom" } }) } });
    expect(states(home)).toMatchObject({
      figures: "unavailable",
      receivables: "unavailable",
      cash: "unavailable",
      payables: "fresh",
      profit: "fresh",
      bank: "fresh",
      insights: "fresh",
    });
    // Without receivables the concentration rule is left out; the others stand.
    expect(home.insights.data!.map((i) => i.key)).toEqual(["cash-runway", "gross-margin"]);
  });

  it("a comparison read: only that comparison is left out", async () => {
    const { home } = await load({
      rpc: {
        acc_ledger_balances: (args) => {
          if (args.p_from === "2026-07-01") return { error: { message: "boom" } };
          return handlers().rpc!.acc_ledger_balances(args);
        },
      },
    });
    expect(home.profit.dataState).toBe("fresh");
    expect(home.profit.data!.periods.quarter!.prior).toBeNull();
    expect(home.profit.data!.periods.month!.prior).not.toBeNull();
  });

  it("a whole-month period's own read: only that period, or only its comparison, is left out (3.0.41)", async () => {
    const failing = (range: { from: string; to: string }): Parameters<typeof load>[0] => ({
      rpc: {
        acc_ledger_balances: (args) =>
          args.p_from === range.from && args.p_to === range.to ? { error: { message: "statement timeout" } } : handlers().rpc!.acc_ledger_balances(args),
      },
    });
    const current = await load(failing(LAST_YEAR));
    expect(states(current.home)).toEqual(Object.fromEntries(SECTIONS.map((key) => [key, "fresh"])));
    expect(current.home.profit.data!.periods.lastYear).toBeNull();
    expect(current.home.profit.data!.periods.last12).toMatchObject({ incomeMinor: 260_000_00, prior: { netMinor: 50_000_00 } });
    expect(JSON.stringify(current.home)).not.toContain("statement timeout");

    const lastYearPrior = await load(failing(LAST_YEAR_PRIOR));
    expect(lastYearPrior.home.profit.data!.periods.lastYear).toMatchObject({ incomeMinor: 400_000_00, prior: null });

    const last12Prior = await load(failing(LAST_12_PRIOR));
    expect(last12Prior.home.profit.data!.periods.last12).toMatchObject({ incomeMinor: 260_000_00, prior: null });
    expect(last12Prior.home.profit.data!.periods.lastYear).toMatchObject({ prior: { netMinor: 20_000_00 } });
  });

  it("the bank standing: only the bank widget goes", async () => {
    const { home } = await load({ rpc: { acc_bank_standing: () => ({ error: { message: "Not authorized to read bank standing" } }) } });
    expect(Object.entries(states(home)).filter(([, state]) => state !== "fresh")).toEqual([["bank", "unavailable"]]);
  });

  it("the audit feed: only recent activity goes", async () => {
    const { home } = await load({ rpc: { acc_audit_search: () => ({ error: { message: "boom" } }) } });
    expect(Object.entries(states(home)).filter(([, state]) => state !== "fresh")).toEqual([["activity", "unavailable"]]);
  });
});

describe("books behind and a new company", () => {
  it("marks the months not entered, says so, and makes no projection", async () => {
    const { home } = await load({ tables: { acc_journal_entry: () => ({ data: [{ entry_date: "2026-09-30" }] }) } });
    expect(home.status.data).toMatchObject({ postedThrough: "2026-09-30", behind: true, missingMonths: ["October", "November"] });
    // With the books behind no projection is made.
    expect(home.cash.data!.projections).toBeNull();
    expect(home.insights.data![0].key).toBe("books-behind");
  });

  it("is a first use only when nothing is posted on any date", async () => {
    const none = await load({ tables: { acc_journal_entry: () => ({ data: [] }) } });
    expect(none.home.status.data).toMatchObject({ postedThrough: null, firstUse: true, behind: false });
    const later = await load({
      tables: { acc_journal_entry: (q) => ({ data: q.filters.some(([op]) => op === "lte") ? [] : [{ id: "je-future" }] }) },
    });
    expect(later.home.status.data).toMatchObject({ postedThrough: null, firstUse: false });
  });
});

describe("the account watchlist", () => {
  /** The chart as listAccounts reads it, with the status and contra flag the watchlist needs; Cash on Hand is inactive. */
  const chart = (): FakeHandlers["tables"] => ({
    acc_account: () => ({
      data: Object.entries(ACCOUNTS).map(([code, a]) => ({
        id: `a-${code}`,
        account_code: code,
        name: a.name,
        account_type: a.type,
        detail_type: a.detail ?? null,
        is_contra: false,
        status: code === "1000" ? "inactive" : "active",
      })),
    }),
  });
  const WATCHED = ["a-4000", "a-1010", "a-2000", "a-6100"];

  it("is built from the reads already made: not one request more", async () => {
    const { requests: without } = await load({ tables: chart() });
    const { home, requests } = await load({ tables: chart() }, WATCHED);
    expect(home.watchlist.dataState).toBe("fresh");
    expect(requests).toHaveLength(27);
    expect([...requests].sort()).toEqual([...without].sort());
  });

  it("gives each account this month, last month and its Chart of Accounts balance, in the person's order", async () => {
    const { home } = await load({ tables: chart() }, WATCHED);
    expect(home.watchlist.data!.rows.map((r) => [r.code, r.typeLabel, r.thisMonthMinor, r.lastMonthMinor, r.balanceMinor])).toEqual([
      // Income: the fiscal year to date, January's 10,000, five months of 50,000 and November's 20,000.
      ["4000", "Income", 20_000_00, 50_000_00, 280_000_00],
      // A bank account: everything since the books began.
      ["1010", "Bank", 3_000_00, 4_000_00, 83_000_00],
      // A liability reads positive when it is owed.
      ["2000", "Accounts Payable", 0, 1_000_00, 12_000_00],
      ["6100", "Expense", 9_000_00, 25_000_00, 136_000_00],
    ]);
  });

  it("makes Balance exactly what chartFigures gives for the ledger as of asOf and the fiscal year to date", async () => {
    const { sb } = fakeSupabase(handlers({ tables: chart() }));
    const home = await getDashboardHome(sb, { ...INPUT, watchlist: Object.keys(ACCOUNTS).map((code) => `a-${code}`) });
    const accounts = (await listAccounts(sb)).map((a) => ({ ...a }));
    const asOf = await getLedgerBalances(sb, null, AS_OF);
    const year = MONTHLY.filter((m) => m.month_key >= "2026-01").map((m) => ({ accountId: m.account_id, debitBase: m.debit_base, creditBase: m.credit_base }));
    const yearByAccount = [...new Set(year.map((row) => row.accountId))].map((accountId) => ({
      accountId,
      debitBase: year.filter((row) => row.accountId === accountId).reduce((s, row) => s + row.debitBase, 0),
      creditBase: year.filter((row) => row.accountId === accountId).reduce((s, row) => s + row.creditBase, 0),
    }));
    const expected = chartFigures(accounts, asOf, yearByAccount);
    const rows = home.watchlist.data!.rows;
    expect(rows).toHaveLength(10);
    for (const row of rows) expect(row.balanceMinor + 0, row.code).toBe(expected[row.accountId] + 0);
  });

  it("offers the active accounts by code, and leaves out an id no longer in the chart", async () => {
    const { home } = await load({ tables: chart() }, ["a-gone", "a-4000"]);
    expect(home.watchlist.data!.rows.map((r) => r.accountId)).toEqual(["a-4000"]);
    const choices = home.watchlist.data!.choices;
    expect(choices.map((c) => c.code)).toEqual(["1010", "1030", "1100", "1210", "2000", "2050", "4000", "5000", "6100"]);
    expect(choices[0]).toEqual({ id: "a-1010", code: "1010", name: "Sample Checking", typeLabel: "Bank" });
  });

  it("when the watchlist could not be read, only that card is unavailable, and it says so", async () => {
    const { home, requests } = await load({ tables: chart() }, null);
    expect(states(home)).toEqual(Object.fromEntries(SECTIONS.map((key) => [key, "fresh"])));
    expect(home.watchlist).toMatchObject({ dataState: "unavailable", data: null, unavailableReason: "Your watchlist could not be read." });
    expect(requests).toHaveLength(27);
  });

  it("goes with the ledger: when the monthly read fails, it is unavailable too", async () => {
    const { home } = await load({ tables: chart(), rpc: { acc_monthly_ledger_balances: () => ({ error: { message: "statement timeout" } }) } }, WATCHED);
    expect(home.watchlist).toMatchObject({ dataState: "unavailable", unavailableReason: "The account watchlist could not be read." });
    expect(JSON.stringify(home.watchlist)).not.toContain("statement timeout");
  });
});
