// Does the database refuse what the screens hide? A check from outside, as a
// real low-privilege user, through the same API the browser uses.
//
// The 2.56–2.61 releases rest on one claim: the database checks every action
// itself, so a person without a permission is refused even when they skip the
// screen and call the API directly. This proves it the way an auditor would,
// with a dedicated account and no one else's credentials, on a SAMPLE company:
//
//   1. In Settings › Users on the sample company (PC-Test), Add user with the
//      Sales role, for this purpose only. Put its sign-in in the environment:
//        ACCESS_PROBE_EMAIL, ACCESS_PROBE_PASSWORD
//      (and optionally ACCESS_PROBE_SCHEMA, default co_pc; ACCESS_PROBE_OTHER_SCHEMA,
//      another company's schema to try to read, default public, the original books).
//   2. node --env-file=.env.local scripts/verify-access-denials.mjs
//      Nine actions the role may not take, called directly; direct writes to the
//      tables; another company's books. Every one must be refused, and nothing
//      may change. The session is kept for step 4.
//   3. Suspend the account in Settings › Users.
//   4. Within the hour: node --env-file=.env.local scripts/verify-access-denials.mjs --after-suspend
//      The session from step 2, still signed in, must read nothing at once.
//   5. Offboard the account.
//
// It writes nothing it is allowed to write: every call it makes is one that
// must be refused. It stops before trying anything if the account turns out to
// be an admin or accountant, or the company is not a sample.
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const email = process.env.ACCESS_PROBE_EMAIL;
const password = process.env.ACCESS_PROBE_PASSWORD;
const schema = process.env.ACCESS_PROBE_SCHEMA ?? "co_pc";
const other = process.env.ACCESS_PROBE_OTHER_SCHEMA ?? "public";
const afterSuspend = process.argv.includes("--after-suspend");
const SESSION = join(tmpdir(), "onebook-access-probe-session.json");

if (!url || !anon) throw new Error("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required");
const as = (token, db) =>
  createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: db },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

const results = [];
/** A pass is a refusal: an error, from the database's own checks. */
function refused(name, error, note = "") {
  const ok = Boolean(error) && (error.code === "42501" || /not authori[sz]ed|permission|not a member/i.test(error.message ?? ""));
  results.push({ name, ok, detail: error ? `${error.code ?? ""} ${error.message}`.trim() : "WENT THROUGH" + (note ? ` ${note}` : "") });
}
function empty(name, { data, error }) {
  const ok = Boolean(error) || (Array.isArray(data) ? data.length === 0 : data == null);
  results.push({ name, ok, detail: error ? `${error.code ?? ""} ${error.message}`.trim() : `${Array.isArray(data) ? data.length : 1} row(s) returned` });
}
function report() {
  const width = Math.max(...results.map((r) => r.name.length));
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name.padEnd(width)}  ${r.detail}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}

if (afterSuspend) {
  if (!existsSync(SESSION)) throw new Error("Run the first step first: there is no saved session to try");
  const { token } = JSON.parse(readFileSync(SESSION, "utf8"));
  const books = as(token, schema);
  empty("suspended: read customers", await books.from("acc_customer").select("id").limit(5));
  empty("suspended: read journal entries", await books.from("acc_journal_entry").select("id").limit(5));
  const today = new Date().toISOString().slice(0, 10);
  const { error } = await books.rpc("acc_gl_posting_report", { p_from: "2020-01-01", p_to: today });
  refused("suspended: run a ledger report", error);
  report();
} else {
  if (!email || !password) throw new Error("ACCESS_PROBE_EMAIL and ACCESS_PROBE_PASSWORD are required (see the top of this file)");
  const signIn = createClient(url, anon, { auth: { persistSession: false } });
  const { data: auth, error: authError } = await signIn.auth.signInWithPassword({ email, password });
  if (authError) throw new Error(`sign-in failed: ${authError.message}`);
  const token = auth.session.access_token;

  // Safety first: a sample company, and an account that should be refused.
  const { data: companies } = await as(token, "onebook").rpc("my_companies");
  const company = (companies ?? []).find((c) => c.schema_name === schema);
  if (!company?.is_sample) throw new Error(`${schema} is not a sample company this account belongs to; stopping`);
  const books = as(token, schema);
  const { data: me } = await books.from("acc_app_user").select("role,status").eq("id", auth.user.id).maybeSingle();
  if (!me || ["admin", "accountant"].includes(me.role)) {
    throw new Error(`the account is ${me?.role ?? "not a member"}; use a Sales or Viewer account, which must be refused`);
  }
  console.log(`Signed in as a ${me.role} on ${company.slug}. Every call below must be refused.\n`);
  writeFileSync(SESSION, JSON.stringify({ token, at: new Date().toISOString() }));

  // What to aim at: real records where the company has them.
  const first = async (table, filter) => {
    let query = books.from(table).select("id,status").limit(1);
    for (const [k, v] of Object.entries(filter)) query = query.eq(k, v);
    return (await query).data?.[0] ?? null;
  };
  const none = "00000000-0000-0000-0000-000000000000";
  const draftInvoice = await first("acc_invoice", { status: "draft" });
  const issuedInvoice = await first("acc_invoice", { status: "issued" });
  const draftBill = await first("acc_bill", { status: "draft" });
  const postedBill = await first("acc_bill", { status: "open" });
  const manualEntry = (await books.from("acc_journal_entry").select("id,status").eq("source_type", "manual").eq("status", "posted").limit(1)).data?.[0] ?? null;
  const reconciliation = await first("acc_statement_reconciliation", { status: "in_progress" });
  const period = (await books.from("acc_accounting_period").select("id,status").limit(1)).data?.[0] ?? null;
  const draftOrder = await first("acc_purchase_order", { status: "draft" });
  const openOrder = (await books.from("acc_purchase_order").select("id,status").in("status", ["open", "partial", "received"]).limit(1)).data?.[0] ?? null;
  const today = new Date().toISOString().slice(0, 10);
  const target = (row) => row?.id ?? none;

  const calls = [
    ["issue an invoice", "acc_issue_invoice", { p_invoice_id: target(draftInvoice), p_override_reason: null }, draftInvoice, "acc_invoice"],
    ["void an invoice", "acc_void_invoice", { p_invoice_id: target(issuedInvoice) }, issuedInvoice, "acc_invoice"],
    ["post a bill", "acc_post_bill", { p_bill_id: target(draftBill) }, draftBill, "acc_bill"],
    ["void a bill", "acc_void_bill", { p_bill_id: target(postedBill) }, postedBill, "acc_bill"],
    ["reverse a journal entry", "acc_reverse_entry", { p_entry_id: target(manualEntry), p_reason: "access probe", p_reversal_date: today }, manualEntry, "acc_journal_entry"],
    ["complete a reconciliation", "acc_complete_reconciliation", { p_reconciliation_id: target(reconciliation) }, reconciliation, "acc_statement_reconciliation"],
    ["close a period", "acc_close_period", { p_period_id: target(period), p_reason: "access probe", p_variance_note: "access probe" }, period, "acc_accounting_period"],
    ["approve a purchase order", "acc_approve_purchase_order", { p_po_id: target(draftOrder) }, draftOrder, "acc_purchase_order"],
    ["bill an order past tolerance", "acc_create_bill_from_po", {
      p_po_id: target(openOrder), p_bill_date: today, p_due_date: null, p_vendor_ref: "access probe", p_memo: null, p_lines: [], p_variance_reason: "access probe",
    }, openOrder, "acc_purchase_order"],
  ];
  for (const [name, fn, args, row, table] of calls) {
    const { error } = await books.rpc(fn, args);
    refused(name, error, row ? "" : "(no such record here; aimed at a made-up id)");
    if (row) {
      const { data: after } = await books.from(table).select("status").eq("id", row.id).maybeSingle();
      results.push({ name: `  ${name}: record unchanged`, ok: after?.status === row.status, detail: `${row.status} → ${after?.status}` });
    }
  }

  // Straight at the tables, around every function.
  refused("insert a customer directly", (await books.from("acc_customer").insert({ name: "Access probe" })).error);
  refused("insert a vendor directly", (await books.from("acc_vendor").insert({ name: "Access probe" })).error);
  if (draftInvoice) refused("edit an invoice directly", (await books.from("acc_invoice").update({ memo: "access probe" }).eq("id", draftInvoice.id)).error);
  if (manualEntry) refused("delete a journal entry directly", (await books.from("acc_journal_entry").delete().eq("id", manualEntry.id)).error);
  refused("change the permission matrix directly", (await books.from("acc_role_permission").update({ allowed: true }).eq("role", me.role)).error);
  refused("give itself a permission", (await books.rpc("acc_set_role_permission", { p_role: me.role, p_key: "invoice.issue", p_allowed: true })).error);

  // Another company's books, from a session that belongs only to this one.
  const elsewhere = as(token, other);
  empty(`read ${other} customers`, await elsewhere.from("acc_customer").select("id").limit(5));
  empty(`read ${other} journal entries`, await elsewhere.from("acc_journal_entry").select("id").limit(5));
  refused(`run ${other} ledger report`, (await elsewhere.rpc("acc_gl_posting_report", { p_from: "2020-01-01", p_to: today })).error);

  report();
  console.log(`\nNext: suspend ${email} in Settings › Users, then run this again with --after-suspend within the hour.`);
}
