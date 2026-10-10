import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getZoom } from "@/lib/services/zoom";

type Row = Record<string, unknown>;
type Source = Row[] | Error;
const resultOf = (s: Source) => (s instanceof Error ? { data: null, error: { message: s.message } } : { data: s, error: null });
/** One page, the way `.range(from, to)` returns it: inclusive at both ends. */
const pageOf = (s: Source, from: number, to: number) => (s instanceof Error ? resultOf(s) : resultOf(s.slice(from, to + 1)));

interface Config {
  chart: Source;
  lines: Source;
  listed: Source;
  balances: Source;
  /** Balances by the start of the range asked for, when the test needs the range to matter. */
  balancesFor?: (from: string | null) => Source;
  /** The company's fiscal year start month; null for a company with no settings. */
  startMonth: number | null;
}

function fakeClient(c: Partial<Config>, rpcCalls: string[] = [], inSizes: number[] = []): SupabaseClient {
  const cfg: Config = { chart: [], lines: [], listed: [], balances: [], startMonth: null, ...c };
  const chain = (source: Source) => {
    const builder = {
      select: () => builder,
      in: (_column: string, values: unknown[]) => {
        inSizes.push(values.length);
        return builder;
      },
      eq: () => builder,
      gte: () => builder,
      lte: () => builder,
      order: () => builder,
      range: async (from: number, to: number) => pageOf(source, from, to),
    };
    return builder;
  };
  return {
    from(table: string) {
      if (table === "acc_account") return chain(cfg.chart);
      if (table === "acc_journal_line") return chain(cfg.lines);
      if (table === "acc_company_setting_version") {
        const builder = {
          select: () => builder,
          order: () => builder,
          limit: () => builder,
          maybeSingle: async () => ({
            data: cfg.startMonth === null ? null : { fiscal_year_start_month: cfg.startMonth, time_zone: "UTC" },
            error: null,
          }),
        };
        return builder;
      }
      throw new Error(`fakeClient: unhandled table "${table}"`);
    },
    rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push(`${name}:${String(args.p_from)}:${String(args.p_to)}`);
      const source =
        name === "acc_ledger_balances"
          ? cfg.balancesFor
            ? cfg.balancesFor(args.p_from as string | null)
            : cfg.balances
          : name === "acc_transaction_list" ? cfg.listed : new Error(name);
      return { range: async (from: number, to: number) => pageOf(source, from, to) };
    },
  } as unknown as SupabaseClient;
}

const CHART = [
  { id: "sales", account_code: "4000", name: "Sales", account_type: "income" },
  { id: "bank", account_code: "1000", name: "Operating Bank", account_type: "bank" },
];
const lineRow = (i: number, over: Row = {}): Row => ({
  id: `l${String(i).padStart(5, "0")}`,
  account_id: "sales",
  debit_minor: 0,
  credit_minor: 1,
  amount_base_minor: 1,
  acc_journal_entry: { id: `e${i}`, entry_number: `JE-${i}`, entry_date: "2026-04-10", source_type: "bank" },
  ...over,
});

describe("getZoom", () => {
  it("reads every line, past a thousand, and adds them up to the figure", async () => {
    const lines = Array.from({ length: 1_001 }, (_, i) => lineRow(i));
    const z = await getZoom(fakeClient({ chart: CHART, lines }), {
      title: "4000 Sales",
      accountIds: ["sales"],
      from: null,
      to: "2026-06-30",
      figure: 1_001,
    });
    expect(z.rows).toHaveLength(1_001);
    expect(z.total).toBe(1_001);
    expect(z.matches).toBe(true);
  });

  it("asks for a long list of accounts a hundred at a time", async () => {
    const sizes: number[] = [];
    const ids = Array.from({ length: 250 }, (_, i) => `a${i}`);
    await getZoom(fakeClient({ chart: CHART }, [], sizes), { title: "x", accountIds: ids, from: null, to: "2026-06-30", figure: 0 });
    expect(sizes).toEqual([100, 100, 50]);
  });

  it("reads the opening balance only for one account with a start date", async () => {
    const calls: string[] = [];
    await getZoom(fakeClient({ chart: CHART }, calls), { title: "x", accountIds: ["bank"], from: "2026-04-01", to: "2026-06-30", figure: 0 });
    expect(calls).toContain("acc_ledger_balances:null:2026-03-31");
    const many: string[] = [];
    await getZoom(fakeClient({ chart: CHART }, many), { title: "x", accountIds: ["sales", "bank"], from: "2026-04-01", to: "2026-06-30", figure: 0 });
    expect(many.some((c) => c.startsWith("acc_ledger_balances"))).toBe(false);
  });

  describe("the opening of a profit and loss account", () => {
    const ledgerRow = (id: string, type: string, debit: number, credit: number) => ({
      account_id: id,
      account_code: id,
      name: id,
      account_type: type,
      debit_base: debit,
      credit_base: credit,
    });
    // Sales took $9,000.00 in earlier years and $250.00 from Jan 1 to Mar 31, 2026.
    const balancesFor = (from: string | null): Source =>
      from === null ? [ledgerRow("sales", "income", 0, 9_250_00)] : [ledgerRow("sales", "income", 0, 250_00)];
    const salesLine = lineRow(1, { credit_minor: 1, amount_base_minor: 100_00, acc_journal_entry: { id: "e1", entry_number: "JE-1", entry_date: "2026-04-10", source_type: "bank" } });

    it("opens at zero, and reads no balances, from the first day of the fiscal year", async () => {
      const calls: string[] = [];
      const z = await getZoom(fakeClient({ chart: CHART, lines: [salesLine], balancesFor }, calls), {
        title: "4000 Sales",
        accountIds: ["sales"],
        from: "2026-01-01",
        to: "2026-12-31",
        figure: 100_00,
      });
      expect(calls.some((c) => c.startsWith("acc_ledger_balances"))).toBe(false);
      expect(z.opening).toBe(0);
      expect(z.rows.at(-1)?.balance).toBe(100_00);
      expect(z.matches).toBe(true);
    });

    it("opens at the year to date before a later start, leaving earlier years out", async () => {
      const calls: string[] = [];
      const z = await getZoom(fakeClient({ chart: CHART, lines: [salesLine], balancesFor }, calls), {
        title: "4000 Sales",
        accountIds: ["sales"],
        from: "2026-04-01",
        to: "2026-04-30",
        figure: 100_00,
      });
      expect(calls).toContain("acc_ledger_balances:2026-01-01:2026-03-31");
      expect(calls).not.toContain("acc_ledger_balances:null:2026-03-31");
      expect(z.opening).toBe(250_00);
      expect(z.rows.at(-1)?.balance).toBe(350_00);
    });

    it("counts the year from a company's own fiscal start month", async () => {
      const calls: string[] = [];
      const forApril = (from: string | null): Source => (from === "2026-04-01" ? [ledgerRow("sales", "income", 0, 80_00)] : []);
      const z = await getZoom(fakeClient({ chart: CHART, lines: [salesLine], balancesFor: forApril, startMonth: 4 }, calls), {
        title: "4000 Sales",
        accountIds: ["sales"],
        from: "2026-06-01",
        to: "2026-06-30",
        figure: 100_00,
      });
      expect(calls).toContain("acc_ledger_balances:2026-04-01:2026-05-31");
      expect(z.opening).toBe(80_00);
      // A start in the first month of that fiscal year opens at zero.
      const first: string[] = [];
      const o = await getZoom(fakeClient({ chart: CHART, lines: [salesLine], balancesFor: forApril, startMonth: 4 }, first), {
        title: "4000 Sales",
        accountIds: ["sales"],
        from: "2026-04-01",
        to: "2026-04-30",
        figure: 100_00,
      });
      expect(first.some((c) => c.startsWith("acc_ledger_balances"))).toBe(false);
      expect(o.opening).toBe(0);
    });

    it("keeps a balance sheet account's opening whole: everything since the books began", async () => {
      const calls: string[] = [];
      const bankBalances = (from: string | null): Source => (from === null ? [ledgerRow("bank", "bank", 7_000_00, 1_000_00)] : []);
      const z = await getZoom(fakeClient({ chart: CHART, balancesFor: bankBalances, startMonth: 4 }, calls), {
        title: "1000 Operating Bank",
        accountIds: ["bank"],
        from: "2026-06-01",
        to: "2026-06-30",
        figure: 6_000_00,
      });
      expect(calls).toContain("acc_ledger_balances:null:2026-05-31");
      expect(z.opening).toBe(6_000_00);
    });
  });

  it("names each line as the transaction list does", async () => {
    const z = await getZoom(
      fakeClient({
        chart: CHART,
        lines: [lineRow(1)],
        listed: [{ entry_id: "e1", entry_number: "JE-1", entry_date: "2026-04-10", description: "Zelle payment", source_type: "bank", party_name: null, amount_minor: 1, currency_code: "USD", account_ids: ["sales", "bank"] }],
      }),
      { title: "4000 Sales", accountIds: ["sales"], from: "2026-04-01", to: "2026-06-30", figure: 1 },
    );
    expect(z.rows[0]).toMatchObject({ name: "Zelle payment", detail: "1000 Operating Bank" });
  });

  it("fails whole when the lines cannot be read", async () => {
    await expect(
      getZoom(fakeClient({ chart: CHART, lines: new Error("timeout") }), { title: "x", accountIds: ["sales"], from: null, to: "2026-06-30", figure: 0 }),
    ).rejects.toThrow("timeout");
  });
});
