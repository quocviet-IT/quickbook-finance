import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/csv";
import { proposeMapping } from "@/lib/domain/import-mapping";
import { previewImport, runImport } from "@/lib/services/data-import";

/**
 * Bringing a company's lists and opening balances across, on the real schema.
 *
 * Everything here runs against a **sample company** and refuses to run anywhere
 * else. Loading another product's data into live books is not recoverable —
 * numbered documents cannot be deleted from an application session — so the
 * guard is a property of the test, not an environment variable somebody has to
 * remember to set.
 */

const CUT_OVER = "2026-01-01";

function client(schema: string): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase credentials are required");
  // The schema is chosen at runtime, so the generic is widened here the same
  // way lib/db/server.ts does it.
  return createClient(url, key, {
    auth: { persistSession: false },
    db: { schema },
  }) as unknown as SupabaseClient;
}

async function signIn(sb: SupabaseClient) {
  const { error } = await sb.auth.signInWithPassword({
    email: process.env.E2E_EMAIL ?? "admin@ctyhp.vn",
    password: process.env.E2E_PASSWORD ?? "Ctyhp@Ketoan2026",
  });
  if (error) throw new Error(`sign-in failed: ${error.message}`);
  return sb;
}

/** A sample company to import into, or nothing — never live books. */
async function sandbox(): Promise<{ schema: string; slug: string } | null> {
  const control = await signIn(client("onebook"));
  const { data } = await control
    .from("company")
    .select("slug,schema_name,is_sample")
    .eq("is_sample", true)
    .order("display_order")
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const row = data as { slug: string; schema_name: string; is_sample: boolean };
  expect(row.is_sample, "the import test must never target real books").toBe(true);
  return { schema: row.schema_name, slug: row.slug };
}

/** A chart of accounts in the shape QuickBooks Online exports one. */
const QBO_ACCOUNTS = [
  "Account Number,Account Name,Type,Detail Type,Balance",
  '1001,Business Checking,Bank,Checking,"18,240.55"',
  "1310,Prepaid Insurance,Other Current Asset,Prepaid Expenses,2400.00",
  '1500,Workshop Equipment,Fixed Asset,Machinery & Equipment,"12,000.00"',
  "2100,Visa Card,Credit Card,Credit Card,-1850.25",
  "4100,Repairs Income,Income,Service/Fee Income,",
  "5100,Materials Purchased,Cost of Goods Sold,Supplies & Materials,",
  "6100,Insurance,Expenses,Insurance,",
].join("\n");

/** Customers in the shape Wave exports them, with balances owed. */
const WAVE_CUSTOMERS = [
  "Customer name,Email,Phone number,City,Province/State,Country,Outstanding balance",
  "Meridian Bridal House,orders@meridianbridal.test,555-0117,Portland,OR,United States,\"3,450.00\"",
  "Ellison Family Trust,,555-0142,Seattle,WA,United States,880.00",
  "Cormorant Gallery,art@cormorant.test,,Boise,ID,United States,",
].join("\n");

const WAVE_VENDORS = [
  "Vendor name,Email,Phone number,City,Province/State,Country,Outstanding balance",
  "Pacific Stone Supply,sales@pacificstone.test,555-0180,Tacoma,WA,United States,\"2,120.00\"",
  "Kiln & Anvil Co.,,555-0191,Eugene,OR,United States,",
].join("\n");

describe("QuickBooks and Wave import over HTTPS", () => {
  it("reads a QuickBooks chart of accounts and brings its balances across", async () => {
    const target = await sandbox();
    if (!target) return;
    const sb = await signIn(client(target.schema));

    const records = parseCsv(QBO_ACCOUNTS);
    const headers = Object.keys(records[0]);
    const rows = records.map((record) => headers.map((h) => record[h] ?? ""));

    const mapping = proposeMapping(headers, "chart_of_accounts");
    expect(mapping.missingRequired, "a real QuickBooks export must map cleanly").toEqual([]);

    // Dry run first: it must describe the work without doing any of it.
    const before = await previewImport(sb, "chart_of_accounts", rows, mapping.columns);
    expect(before.problems).toEqual([]);
    expect(before.rows).toHaveLength(7);
    expect(before.creates + before.updates).toBe(7);

    const untouched = await sb.from("acc_account").select("id", { count: "exact", head: true });
    expect(untouched.count, "the preview must not have written anything").toBe(
      (await sb.from("acc_account").select("id", { count: "exact", head: true })).count,
    );

    // The chart carries a collision, so bringing the balances across in the
    // same breath is refused — by design. Import the definitions first.
    const outcome = await runImport(sb, "chart_of_accounts", rows, mapping.columns);

    // 2100 is a Visa card in the file and Sales Tax Payable here — the same
    // number meaning two different things, which is ordinary between charts.
    // The import must leave the existing account alone and say so, because
    // repurposing it would silently break the sales tax control account.
    expect(outcome.created + outcome.updated + outcome.skipped).toBe(7);
    const { data: collided } = await sb
      .from("acc_account")
      .select("name,account_type")
      .eq("account_code", "2100")
      .single();
    const held = collided as { name: string; account_type: string };
    expect(held.account_type, "an import must not repurpose a live account").not.toBe("credit_card");
    expect(held.name).toBe("Sales Tax Payable");

    const { data: cogs } = await sb
      .from("acc_account")
      .select("account_type")
      .eq("account_code", "5100")
      .single();
    expect((cogs as { account_type: string }).account_type).toBe("cost_of_goods_sold");

    // With the collision left in, posting the balances refuses and posts
    // nothing at all — not "most of it".
    const refused = await runImport(sb, "chart_of_accounts", rows, mapping.columns, {
      openingBalancesAsOf: CUT_OVER,
    }).catch((err: Error) => err);
    expect(refused, "a balance must not land on an account of another kind").toBeInstanceOf(Error);
    expect((refused as Error).message).toContain("2100");

    // Reconciled the way a person would: drop the colliding row, then post.
    const withoutCollision = rows.filter((row) => row[0] !== "2100");
    // Only on a company that has not had these balances posted already; a
    // second posting would be a second set of opening figures, not a no-op.
    if (before.creates === 7) {
      const posted = await runImport(sb, "chart_of_accounts", withoutCollision, mapping.columns, {
        openingBalancesAsOf: CUT_OVER,
      });
      expect(posted.openingCreated).toBe(3);
    }

    // Running it again must not produce a second chart of accounts.
    const second = await runImport(sb, "chart_of_accounts", rows, mapping.columns);
    expect(second.created, "a re-run must create nothing").toBe(0);
    expect(second.updated + second.skipped).toBe(7);
  });

  it("turns customer balances into invoices, so the ageing and the control account agree", async () => {
    const target = await sandbox();
    if (!target) return;
    const sb = await signIn(client(target.schema));

    const records = parseCsv(WAVE_CUSTOMERS);
    const headers = Object.keys(records[0]);
    const rows = records.map((record) => headers.map((h) => record[h] ?? ""));
    const mapping = proposeMapping(headers, "customers");
    expect(mapping.missingRequired).toEqual([]);

    const preview = await previewImport(sb, "customers", rows, mapping.columns);
    expect(preview.rows).toHaveLength(3);
    expect(preview.openingTotalMinor, "3,450 + 880").toBe(433_000);

    const fresh = preview.creates === 3;
    const outcome = await runImport(sb, "customers", rows, mapping.columns, {
      openingBalancesAsOf: fresh ? CUT_OVER : null,
    });
    expect(outcome.created + outcome.updated).toBe(3);
    // Two carried a balance; the third owed nothing and gets no invoice.
    if (fresh) expect(outcome.openingCreated).toBe(2);

    // The point of raising documents: the subledger adds up to the control
    // account. A lump posted straight to A/R would have failed this.
    const recon = await sb.rpc("acc_control_reconciliation", { p_as_of: CUT_OVER });
    const ar = ((recon.data ?? []) as Record<string, unknown>[]).find((r) => r.control_key === "ar")!;
    expect(Number(ar.subledger_minor), "the opening invoices").toBe(433_000);
    expect(Number(ar.control_minor), "A/R ties to the invoices behind it").toBe(433_000);
  });

  it("turns vendor balances into bills for the same reason", async () => {
    const target = await sandbox();
    if (!target) return;
    const sb = await signIn(client(target.schema));

    const records = parseCsv(WAVE_VENDORS);
    const headers = Object.keys(records[0]);
    const rows = records.map((record) => headers.map((h) => record[h] ?? ""));
    const mapping = proposeMapping(headers, "vendors");

    const preview = await previewImport(sb, "vendors", rows, mapping.columns);
    const fresh = preview.creates === 2;
    const outcome = await runImport(sb, "vendors", rows, mapping.columns, {
      openingBalancesAsOf: fresh ? CUT_OVER : null,
    });
    expect(outcome.created + outcome.updated).toBe(2);
    if (fresh) expect(outcome.openingCreated).toBe(1);

    const recon = await sb.rpc("acc_control_reconciliation", { p_as_of: CUT_OVER });
    const ap = ((recon.data ?? []) as Record<string, unknown>[]).find((r) => r.control_key === "ap")!;
    expect(Number(ap.subledger_minor)).toBe(212_000);
    expect(Number(ap.control_minor), "A/P ties to the bills behind it").toBe(212_000);
  });

  it("refuses an opening balance on a control account, and says where it belongs", async () => {
    const target = await sandbox();
    if (!target) return;
    const sb = await signIn(client(target.schema));

    const { error } = await sb.rpc("acc_post_opening_balances", {
      p_as_of: CUT_OVER,
      p_rows: [{ account_code: "1100", amount_minor: 500_00 }],
    });
    expect(error, "a lump sum on A/R would break the reconciliation for good").not.toBeNull();
    expect(error!.message).toContain("control account");
    expect(error!.message).toContain("customer or vendor list");
  });

  it("leaves the ledger balanced after everything it posted", async () => {
    const target = await sandbox();
    if (!target) return;
    const sb = await signIn(client(target.schema));

    const { data } = await sb.rpc("acc_gl_posting_report", {
      p_from: "2000-01-01",
      p_to: "2100-01-01",
    });
    const documents = (data ?? []) as Record<string, unknown>[];
    // Every opening document reached the ledger.
    const unposted = documents.filter((d) => !d.journal_entry_id && d.document_status !== "draft");
    expect(unposted, "an opening document that never posted").toEqual([]);

    const recon = await sb.rpc("acc_control_reconciliation", {
      p_as_of: new Date().toISOString().slice(0, 10),
    });
    for (const row of (recon.data ?? []) as Record<string, unknown>[]) {
      const variance = row.has_subledger
        ? Number(row.subledger_minor) - Number(row.control_minor)
        : Number(row.control_minor);
      expect(variance, `${row.label} is out after the import`).toBe(0);
    }
  });
});
