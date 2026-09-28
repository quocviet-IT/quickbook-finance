import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { WorkingTrialBalanceError, getWorkingTrialBalance } from "@/lib/services/working-trial-balance";

type Row = Record<string, unknown>;
type Source = Row[] | Error;

const resultOf = (s: Source) =>
  s instanceof Error ? { data: null, error: { message: s.message } } : { data: s, error: null };
/** One page, the way `.range(from, to)` returns it: inclusive at both ends. */
const pageOf = (s: Source, from: number, to: number) => (s instanceof Error ? resultOf(s) : resultOf(s.slice(from, to + 1)));

interface Config {
  before: Source;
  movements: Source;
  marks: Source;
  listed: Source;
}

function fakeClient(c: Partial<Config>, rpcCalls: [string, Record<string, unknown>][] = []): SupabaseClient {
  const cfg: Config = { before: [], movements: [], marks: [], listed: [], ...c };
  const chain = {
    select: () => chain,
    eq: () => chain,
    gte: () => chain,
    lte: () => chain,
    order: () => chain,
    range: async (from: number, to: number) => pageOf(cfg.marks, from, to),
  };
  return {
    from(table: string) {
      if (table !== "acc_adjusting_entry") throw new Error(`fakeClient: unhandled table "${table}"`);
      return chain;
    },
    rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push([name, args]);
      const source =
        name === "acc_ledger_balances"
          ? args.p_from === null
            ? cfg.before
            : cfg.movements
          : name === "acc_transaction_list"
            ? cfg.listed
            : new Error(`fakeClient: unhandled rpc "${name}"`);
      return { range: async (from: number, to: number) => pageOf(source, from, to) };
    },
  } as unknown as SupabaseClient;
}

const ledgerRow = (id: string, code: string, type: string, debit: number, credit: number): Row => ({
  account_id: id,
  account_code: code,
  name: `Account ${code}`,
  account_type: type,
  debit_base: debit,
  credit_base: credit,
});

/** A marked entry as PostgREST returns it: the entry embedded, its lines embedded in that. */
const mark = (id: string, note: string | null, lines: Row[]): Row => ({
  journal_entry_id: id,
  note,
  acc_journal_entry: {
    id,
    entry_number: `JE-${id}`,
    entry_date: "2026-03-31",
    description: "Quarter-end accrual",
    status: "posted",
    acc_journal_line: lines,
  },
});

const line = (accountId: string, code: string, type: string, debit: number, credit: number, base: number, order: number): Row => ({
  account_id: accountId,
  debit_minor: debit,
  credit_minor: credit,
  amount_base_minor: base,
  line_order: order,
  acc_account: { account_code: code, name: `Account ${code}`, account_type: type },
});

describe("getWorkingTrialBalance", () => {
  it("reads the balances before the range up to the day before it starts", async () => {
    const calls: [string, Record<string, unknown>][] = [];
    await getWorkingTrialBalance(fakeClient({}, calls), "2026-03-01", "2026-03-31");
    expect(calls).toContainEqual(["acc_ledger_balances", { p_from: null, p_to: "2026-02-28" }]);
    expect(calls).toContainEqual(["acc_ledger_balances", { p_from: "2026-03-01", p_to: "2026-03-31" }]);
  });

  it("counts an adjusting line at its base amount, on the side it was posted", async () => {
    const r = await getWorkingTrialBalance(
      fakeClient({
        movements: [ledgerRow("rent", "6100", "expense", 11_000, 0), ledgerRow("accrued", "2100", "current_liability", 0, 11_000)],
        marks: [
          mark("a1", "Accrued in euros", [
            line("rent", "6100", "expense", 10_000, 0, 11_000, 0),
            line("accrued", "2100", "current_liability", 0, 10_000, 11_000, 1),
          ]),
        ],
      }),
      "2026-01-01",
      "2026-03-31",
    );
    expect(r.rows.find((x) => x.key === "rent")).toMatchObject({ unadjusted: 0, adjustment: 11_000, adjusted: 11_000 });
    expect(r.rows.find((x) => x.key === "accrued")).toMatchObject({ unadjusted: 0, adjustment: -11_000 });
  });

  it("names an adjusting entry as the transaction list does", async () => {
    const r = await getWorkingTrialBalance(
      fakeClient({
        marks: [mark("a1", null, [line("rent", "6100", "expense", 100, 0, 100, 0), line("accrued", "2100", "current_liability", 0, 100, 100, 1)])],
        listed: [{ entry_id: "a1", entry_number: "JE-a1", entry_date: "2026-03-31", description: "Quarter-end accrual", source_type: "manual", party_name: "Harbour Property Ltd", amount_minor: 100, currency_code: "USD" }],
      }),
      "2026-01-01",
      "2026-03-31",
    );
    expect(r.adjustments[0]).toMatchObject({ name: "Harbour Property Ltd", why: "Quarter-end accrual" });
  });

  it("reads every adjusting entry, past a thousand", async () => {
    const marks = Array.from({ length: 1_001 }, (_, i) =>
      mark(`m${i}`, null, [line("rent", "6100", "expense", 1, 0, 1, 0), line("accrued", "2100", "current_liability", 0, 1, 1, 1)]),
    );
    const r = await getWorkingTrialBalance(fakeClient({ marks }), "2026-01-01", "2026-03-31");
    expect(r.adjustingEntryCount).toBe(1_001);
  });

  it("fails the whole report when the marks cannot be read", async () => {
    await expect(
      getWorkingTrialBalance(fakeClient({ marks: new Error("connection reset") }), "2026-01-01", "2026-03-31"),
    ).rejects.toThrow(WorkingTrialBalanceError);
  });

  it("fails the whole report when a balance cannot be read", async () => {
    await expect(
      getWorkingTrialBalance(fakeClient({ before: new Error("timeout") }), "2026-01-01", "2026-03-31"),
    ).rejects.toThrow("timeout");
  });
});
