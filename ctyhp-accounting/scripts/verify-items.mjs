// End-to-end verify that items prefill/link into invoice lines (as admin).
// Creates an item, a draft invoice whose line references it, and asserts the
// line stored item_id and the snapshot values. Cleans up after itself.
// Run: node --env-file=.env.local scripts/verify-items.mjs
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const sb = createClient(url, key, { auth: { persistSession: false } });
const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });

let pass = 0, fail = 0;
const check = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " " + d : ""}`); };

async function acctId(code) {
  return (await db.query("select id from acc_account where account_code=$1", [code])).rows[0].id;
}

async function main() {
  await db.connect();
  const { data: auth, error: e1 } = await sb.auth.signInWithPassword({
    email: "admin@ctyhp.vn", password: "Ctyhp@Ketoan2026",
  });
  if (e1) throw new Error("login: " + e1.message);
  const authed = createClient(url, key, {
    global: { headers: { Authorization: "Bearer " + auth.session.access_token } },
    auth: { persistSession: false },
  });

  const income = await acctId("4000");

  const { data: item, error: e2 } = await authed.from("acc_item").insert({
    name: "E2E Item", description: "E2E item desc", is_sold: true,
    sales_price_minor: 12345, income_account_id: income,
  }).select("id").single();
  if (e2) throw new Error("item: " + e2.message);
  check("item created", !!item.id);

  const { data: cust, error: ec } = await authed.from("acc_customer")
    .insert({ name: "E2E Item Customer", currency_code: "USD" }).select("id").single();
  if (ec) throw new Error("customer: " + ec.message);

  const { data: inv, error: e3 } = await authed.from("acc_invoice").insert({
    customer_id: cust.id, currency_code: "USD",
    subtotal_minor: 12345, tax_total_minor: 0, total_minor: 12345, balance_due_minor: 12345,
  }).select("id").single();
  if (e3) throw new Error("invoice: " + e3.message);

  const { error: e4 } = await authed.from("acc_invoice_line").insert({
    invoice_id: inv.id, line_order: 0, description: "E2E item desc",
    quantity: 1, unit_price_minor: 12345, income_account_id: income,
    line_subtotal_minor: 12345, line_tax_minor: 0, line_total_minor: 12345,
    item_id: item.id,
  });
  if (e4) throw new Error("line: " + e4.message);

  const line = (await db.query(
    "select item_id, unit_price_minor, description from acc_invoice_line where invoice_id=$1", [inv.id])).rows[0];
  check("line stored item_id link", line.item_id === item.id);
  check("line kept snapshot unit price", Number(line.unit_price_minor) === 12345);

  // Cleanup
  await db.query("begin");
  await db.query("delete from acc_invoice_line where invoice_id=$1", [inv.id]);
  await db.query("delete from acc_invoice where id=$1", [inv.id]);
  await db.query("delete from acc_customer where id=$1", [cust.id]);
  await db.query("delete from acc_item where id=$1", [item.id]);
  await db.query("commit");
  console.log("  (cleanup done)");

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((e) => { console.error("verify error:", e.message); process.exitCode = 1; }).finally(() => db.end());
