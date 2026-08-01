import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

/**
 * The claim the whole multi-company design rests on: one company cannot see
 * another's books.
 *
 * It is asserted the hard way — by signing in as a real user, opening each
 * company in turn, and checking that what comes back belongs to that company
 * and only that company. A design is not isolated because it was meant to be.
 */

function url() {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!value) throw new Error("NEXT_PUBLIC_SUPABASE_URL is required");
  return value;
}

function anonKey() {
  const value = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!value) throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY is required");
  return value;
}

/**
 * A signed-in client bound to one schema, exactly as the application makes one.
 *
 * Deliberately no service-role client anywhere in this file: a test that proves
 * isolation by bypassing row-level security proves nothing. Everything here
 * runs as a real user with real permissions.
 */
async function signedInTo(schema: string) {
  const sb = createClient(url(), anonKey(), {
    auth: { persistSession: false },
    db: { schema },
  });
  const { error } = await sb.auth.signInWithPassword({
    email: process.env.E2E_EMAIL ?? "admin@ctyhp.vn",
    password: process.env.E2E_PASSWORD ?? "Ctyhp@Ketoan2026",
  });
  if (error) throw new Error(`sign-in failed: ${error.message}`);
  return sb;
}

describe("company isolation over HTTPS", () => {
  it("registers every company with its own schema", async () => {
    const control = await signedInTo("onebook");
    const { data, error } = await control
      .from("company")
      .select("slug,schema_name,is_sample,status")
      .order("display_order");
    expect(error, error?.message).toBeNull();

    const companies = (data ?? []) as { slug: string; schema_name: string; is_sample: boolean }[];
    expect(companies.length, "at least the live books and one sample").toBeGreaterThan(1);

    // Every company must have a schema of its own; two sharing one would make
    // the whole arrangement a fiction.
    const schemas = companies.map((c) => c.schema_name);
    expect(new Set(schemas).size).toBe(schemas.length);
    expect(companies.find((c) => c.slug === "ctyhp")?.is_sample).toBe(false);
  });

  it("shows each company only its own ledger", async () => {
    const control = await signedInTo("onebook");
    const { data } = await control
      .from("company")
      .select("slug,schema_name,legal_name")
      .order("display_order");
    const companies = (data ?? []) as { slug: string; schema_name: string; legal_name: string }[];

    const counts = new Map<string, { entries: number; invoices: number; accounts: number }>();
    for (const company of companies) {
      const sb = await signedInTo(company.schema_name);
      const [entries, invoices, accounts] = await Promise.all([
        sb.from("acc_journal_entry").select("id", { count: "exact", head: true }),
        sb.from("acc_invoice").select("id", { count: "exact", head: true }),
        sb.from("acc_account").select("id", { count: "exact", head: true }),
      ]);
      expect(entries.error, `${company.slug}: ${entries.error?.message}`).toBeNull();
      counts.set(company.slug, {
        entries: entries.count ?? 0,
        invoices: invoices.count ?? 0,
        accounts: accounts.count ?? 0,
      });
      // Every company is a complete accounting system, not an empty shell.
      expect(accounts.count ?? 0, `${company.slug} has no chart of accounts`).toBeGreaterThan(0);
    }

    const live = counts.get("ctyhp")!;
    expect(live.entries, "the live books have history").toBeGreaterThan(0);

    // Not "the samples are empty" — they may well have data of their own once
    // something has been imported into one. The claim is stronger and narrower:
    // no document belonging to the live books appears in any other company.
    // By identity, not by number. Numbers legitimately repeat across companies
    // — every entity is entitled to its own INV-000001, which is the point of
    // numbering them separately. Identity is what must never be shared.
    const liveInvoices = await signedInTo("public");
    const { data: liveRows } = await liveInvoices.from("acc_invoice").select("id").limit(5);
    const ids = ((liveRows ?? []) as { id: string }[]).map((r) => r.id);
    expect(ids.length, "the live books have invoices to look for").toBeGreaterThan(0);

    for (const company of companies) {
      if (company.slug === "ctyhp") continue;
      const sb = await signedInTo(company.schema_name);
      const { data: found } = await sb.from("acc_invoice").select("id").in("id", ids);
      expect(found ?? [], `a live invoice is visible from ${company.slug}`).toHaveLength(0);
    }
  });

  it("keeps a document written in one company out of every other", async () => {
    const control = await signedInTo("onebook");
    const { data } = await control
      .from("company")
      .select("slug,schema_name,is_sample")
      .eq("is_sample", true)
      .order("display_order")
      .limit(2);
    const samples = (data ?? []) as { slug: string; schema_name: string; is_sample: boolean }[];
    if (samples.length < 2) return; // Nothing to compare against.

    const [first, second] = samples;
    // This is the only test in the suite that writes anything, so it carries
    // its own guarantee rather than relying on an environment flag: the probe
    // is only ever written to a company explicitly marked as a sample. Real
    // books are never touched, on any database.
    expect(first.is_sample, `${first.slug} is not a sample company`).toBe(true);
    const marker = `isolation-probe-${Date.now()}`;

    try {
      const writer = await signedInTo(first.schema_name);
      const { error: writeError } = await writer.from("acc_customer").insert({ name: marker });
      expect(writeError, writeError?.message).toBeNull();

      // The company it was written to can see it.
      const here = await writer.from("acc_customer").select("id").eq("name", marker);
      expect(here.data ?? []).toHaveLength(1);

      // No other company can, including the live books.
      for (const other of [second.schema_name, "public"]) {
        const reader = await signedInTo(other);
        const { data: leaked } = await reader.from("acc_customer").select("id").eq("name", marker);
        expect(leaked ?? [], `${marker} leaked into ${other}`).toHaveLength(0);
      }
    } finally {
      const cleaner = await signedInTo(first.schema_name);
      await cleaner.from("acc_customer").delete().eq("name", marker);
    }
  });

  it("gives each company its own document numbering", async () => {
    // Numbering per company is one of the things the schema layout buys for
    // free, and one of the things a shared table would have made hard: every
    // entity is entitled to its own INV-000001.
    const control = await signedInTo("onebook");
    const { data } = await control.from("company").select("schema_name").order("display_order");

    // Read it the way the sequence report does. The table itself is not
    // readable by an application session, which is correct — the number a
    // company will issue next is not application data.
    const nextInvoiceIn = async (schema: string) => {
      const sb = await signedInTo(schema);
      const { data: catalog, error } = await sb.rpc("acc_sequence_catalog");
      expect(error, `${schema}: ${error?.message}`).toBeNull();
      const rows = (catalog ?? []) as { sequence_key: string; next_value: number }[];
      expect(rows.length, `${schema} has no sequences of its own`).toBeGreaterThan(0);
      return Number(rows.find((r) => r.sequence_key === "invoice")?.next_value ?? 0);
    };

    const schemas = ((data ?? []) as { schema_name: string }[]).map((s) => s.schema_name);
    const live = await nextInvoiceIn("public");
    expect(live, "the live books have issued invoices").toBeGreaterThan(1);

    // Each company counts on its own. A sample that has issued a few opening
    // invoices is still nowhere near the live books' sequence, and two
    // companies sharing a counter would show up here immediately.
    for (const schema of schemas.filter((s) => s !== "public")) {
      const next = await nextInvoiceIn(schema);
      expect(next, `${schema} must number independently of the live books`).toBeLessThan(live);
      expect(next, `${schema} must have its own counter`).toBeGreaterThanOrEqual(1);
    }
  });
});
