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
}

function fakeClient(c: Partial<Config>, rpcCalls: string[] = [], inSizes: number[] = []): SupabaseClient {
  const cfg: Config = { chart: [], lines: [], listed: [], balances: [], ...c };
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
      throw new Error(`fakeClient: unhandled table "${table}"`);
    },
    rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push(`${name}:${String(args.p_from)}:${String(args.p_to)}`);
      const source = name === "acc_ledger_balances" ? cfg.balances : name === "acc_transaction_list" ? cfg.listed : new Error(name);
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
    await getZoom(fakeClient({ chart: CHART }, calls), { title: "x", accountIds: ["sales"], from: "2026-04-01", to: "2026-06-30", figure: 0 });
    expect(calls).toContain("acc_ledger_balances:null:2026-03-31");
    const many: string[] = [];
    await getZoom(fakeClient({ chart: CHART }, many), { title: "x", accountIds: ["sales", "bank"], from: "2026-04-01", to: "2026-06-30", figure: 0 });
    expect(many.some((c) => c.startsWith("acc_ledger_balances"))).toBe(false);
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
