/**
 * Stock Count, checked against every company's books — read-only.
 *
 * For every company the smoke user belongs to: the book value the screen shows
 * equals the inventory accounts' ledger balance; the default accounts resolve
 * to a cost-of-sales offset and one of the inventory accounts; the counts list
 * reads. Counts and agree/disagree are logged; names and amounts never are.
 * Nothing is written: every call is a select or a read-only RPC.
 *
 * Needs migration 0139 live (acc_stock_count_default_accounts).
 *
 * Run (never part of npm test):
 *   node --env-file=.env.local ./node_modules/vitest/vitest.mjs run --config vitest.live.config.ts tests/live/stock-count.live.ts --silent=false --reporter=verbose
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { smokeSession } from "../../scripts/smoke-environment.mjs";
import { getCurrentCompanySettings } from "@/lib/services/company";
import { todayInTimeZone } from "@/lib/services/dashboard";
import { getLedgerBalances } from "@/lib/services/reports";
import { getBookValue, listStockCounts } from "@/lib/services/stock-count";

interface Company {
  name: string;
  sb: SupabaseClient;
  today: string;
}

const companies: Company[] = [];

beforeAll(async () => {
  const s = await smokeSession();
  if (!s.session) throw new Error("The smoke sign-in returned no session.");
  const auth = { persistSession: false };
  const headers = { Authorization: `Bearer ${s.session.access_token}` };
  const control = createClient(s.supabaseUrl, s.anonKey, { db: { schema: "onebook" }, auth, global: { headers } });
  const { data, error } = await control.rpc("my_companies");
  if (error) throw new Error(`my_companies: ${error.message}`);
  for (const row of (data ?? []) as { legal_name: string; schema_name: string }[]) {
    const sb = createClient(s.supabaseUrl, s.anonKey, {
      db: { schema: row.schema_name },
      auth,
      global: { headers },
    }) as unknown as SupabaseClient;
    const settings = await getCurrentCompanySettings(sb);
    companies.push({ name: row.schema_name, sb, today: todayInTimeZone(settings?.time_zone ?? "UTC") });
  }
  if (companies.length === 0) throw new Error("The smoke user belongs to no company.");
});

/** The ids acc_inventory_account_ids() returns, whether PostgREST wraps each scalar or not. */
async function inventoryIds(sb: SupabaseClient): Promise<string[]> {
  const { data, error } = await sb.rpc("acc_inventory_account_ids");
  if (error) throw new Error(`acc_inventory_account_ids: ${error.message}`);
  return ((data ?? []) as unknown[]).map((row) =>
    typeof row === "string" ? row : String(Object.values(row as Record<string, unknown>)[0]),
  );
}

describe("Stock Count on every company's books", () => {
  it("the book value equals the inventory accounts' ledger balance", async () => {
    for (const c of companies) {
      const [ids, balances, book] = await Promise.all([
        inventoryIds(c.sb),
        getLedgerBalances(c.sb, null, c.today),
        getBookValue(c.sb, c.today),
      ]);
      const inventory = new Set(ids);
      let ledger = 0;
      for (const b of balances) if (inventory.has(b.accountId)) ledger += b.debitBase - b.creditBase;
      console.log(`${c.name}: ${ids.length} inventory accounts, book value ${book === ledger ? "agrees" : "DISAGREES"}`);
      expect(book, c.name).toBe(ledger);
    }
  });

  it("the default inventory and offset accounts resolve", async () => {
    for (const c of companies) {
      const [ids, defaults, accounts] = await Promise.all([
        inventoryIds(c.sb),
        c.sb.rpc("acc_stock_count_default_accounts"),
        c.sb.from("acc_account").select("id,account_type").limit(5000),
      ]);
      expect(defaults.error, c.name).toBeNull();
      expect(accounts.error, c.name).toBeNull();
      const row = (Array.isArray(defaults.data) ? defaults.data[0] : defaults.data) as
        | { inventory_account_id?: string | null; offset_account_id?: string | null }
        | null
        | undefined;
      const inventoryId = row?.inventory_account_id ?? null;
      const offsetId = row?.offset_account_id ?? null;
      const type = new Map(((accounts.data ?? []) as { id: string; account_type: string }[]).map((a) => [a.id, a.account_type]));
      const inventoryOk = inventoryId !== null && ids.includes(inventoryId);
      const offsetOk = offsetId !== null && type.get(offsetId) === "cost_of_goods_sold";
      console.log(`${c.name}: default inventory ${inventoryOk ? "resolves" : "DOES NOT resolve"}, offset ${offsetOk ? "resolves" : "DOES NOT resolve"}`);
      expect(inventoryOk, `${c.name} inventory account`).toBe(true);
      expect(offsetOk, `${c.name} offset account`).toBe(true);
    }
  });

  it("the counts list reads", async () => {
    for (const c of companies) {
      const counts = await listStockCounts(c.sb);
      console.log(`${c.name}: ${counts.length} counts`);
      expect(Array.isArray(counts), c.name).toBe(true);
    }
  });
});
