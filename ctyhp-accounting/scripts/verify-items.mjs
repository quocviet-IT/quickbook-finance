// End-to-end verify that items prefill/link into invoice lines (as admin).
// Creates an item, a draft invoice whose line references it, and asserts the
// line stored item_id and the snapshot values. Cleans up after itself.
// Run: node --env-file=.env.local scripts/verify-items.mjs
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { requireDestructiveE2eEnvironment } from "./e2e-environment.mjs";

const { databaseUrl, supabaseUrl, anonKey, email, password } =
  requireDestructiveE2eEnvironment();

const url = supabaseUrl;
const key = anonKey;
const sb = createClient(url, key, { auth: { persistSession: false } });
const db = new pg.Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });

let pass = 0, fail = 0;
const check = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " " + d : ""}`); };

async function acctId(code) {
  return (await db.query("select id from acc_account where account_code=$1", [code])).rows[0].id;
}

async function main() {
  await db.connect();
  const { data: auth, error: e1 } = await sb.auth.signInWithPassword({
    email, password,
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

  // Through the function the screen uses; the tables are read-only to a session since 0165.
  const { data: invId, error: e3 } = await authed.rpc("acc_create_draft_invoice", {
    p_customer_id: cust.id, p_issue_date: null, p_due_date: null, p_currency: "USD", p_memo: null,
    p_lines: [{
      description: "E2E item desc", quantity: 1, unit_price_minor: 12345,
      income_account_id: income, tax_code_id: null, item_id: item.id,
    }],
    p_recurring_run_id: null,
  });
  if (e3) throw new Error("invoice: " + e3.message);
  const inv = { id: invId };

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

main().catch((e) => {
  // Surface the real cause: pg timeout/aggregate errors carry an empty .message.
  const parts = [e.code, e.message].filter(Boolean).join(" ");
  const inner = (e.errors || []).map((x) => `${x.code} ${x.address}:${x.port}`).join(", ");
  console.error("verify error:", parts || "(no message)", inner ? `| ${inner}` : "");
  process.exitCode = 1;
}).finally(() => db.end());
