// scripts/verify-vendor-tax.mjs
// E2E verify of Module G3 — vendor tax profile + 1099 review (as admin):
// saving a profile versions it and keeps history; the taxpayer identifier never
// reaches the audit log; an override needs its own reason; an eligible vendor
// needs a box; enabling the vendor_tax_profile policy refuses a direct save and
// routes it through Module C's approval; and a vendor paid $700 across a bill
// payment and an expense in one year reports $700 that year and $100 the next,
// with the control total tying. Cleans up after itself.
// Run: node --env-file=.env.local scripts/verify-vendor-tax.mjs
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
const check = (n, ok, d = "") => { if (ok) { pass++; } else { fail++; } console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " " + d : ""}`); };
const num = (v) => Number(v);
const acctId = async (code) => (await db.query("select id from acc_account where account_code=$1", [code])).rows[0].id;

const TIN = "12-3456789";

/** The full argument list, so each test only varies what it cares about. */
function profileArgs(vendorId, patch = {}) {
  return {
    p_vendor_id: vendorId,
    p_w9_status: "on_file",
    p_w9_received_date: "2026-01-15",
    p_w9_expires_date: null,
    p_classification: "llc",
    p_reporting_name: "E2E Tax Vendor LLC",
    p_tin_ref: TIN,
    p_tin_type: "ein",
    p_address_line1: "1 Market St",
    p_address_line2: null,
    p_city: "San Jose",
    p_region: "CA",
    p_postal_code: "95113",
    p_country: "US",
    p_is_1099_eligible: true,
    p_box_code: "NEC-1",
    p_eligibility_override: false,
    p_override_reason: null,
    p_reason: "W-9 received",
    ...patch,
  };
}

async function summaryRow(authed, year, vendorId) {
  const { data, error } = await authed.rpc("acc_1099_summary", { p_year: year });
  if (error) throw new Error("summary: " + error.message);
  return (data ?? []).find((r) => r.vendor_id === vendorId) ?? null;
}

async function main() {
  await db.connect();
  const { data: auth, error: eLogin } = await sb.auth.signInWithPassword({
    email, password,
  });
  if (eLogin) throw new Error("login: " + eLogin.message);
  const authed = createClient(url, key, {
    global: { headers: { Authorization: "Bearer " + auth.session.access_token } },
    auth: { persistSession: false },
  });

  const bank = await acctId("1010");
  const expenseAcct = await acctId("6000");
  const base = (await db.query("select code from acc_currency where is_base")).rows[0].code;

  const vendorId = (await db.query(
    "insert into acc_vendor (name, currency_code) values ('E2E Tax Vendor', $1) returning id", [base],
  )).rows[0].id;
  // A second vendor that is paid nothing and is not eligible: it must not appear.
  const quietVendorId = (await db.query(
    "insert into acc_vendor (name, currency_code) values ('E2E Quiet Vendor', $1) returning id", [base],
  )).rows[0].id;

  // ---- 1) Saving versions the profile -----------------------------------
  const { error: eNoReason } = await authed.rpc("acc_save_vendor_tax_profile", profileArgs(vendorId, { p_reason: "  " }));
  check("a save without a change reason is refused", !!eNoReason && /reason/i.test(eNoReason.message));

  const { error: eNoBox } = await authed.rpc("acc_save_vendor_tax_profile",
    profileArgs(vendorId, { p_box_code: null }));
  check("an eligible vendor without a box is refused", !!eNoBox && /reporting box/i.test(eNoBox.message));

  const { error: eNoOverrideReason } = await authed.rpc("acc_save_vendor_tax_profile",
    profileArgs(vendorId, { p_eligibility_override: true }));
  check("an override without its own reason is refused",
    !!eNoOverrideReason && /override/i.test(eNoOverrideReason.message));

  const { data: v1, error: e1 } = await authed.rpc("acc_save_vendor_tax_profile", profileArgs(vendorId));
  if (e1) throw new Error("save v1: " + e1.message);
  const row1 = (await db.query("select version, tin_ref, is_1099_eligible from acc_vendor_tax_profile where id=$1", [v1])).rows[0];
  check("the first save is version 1", num(row1.version) === 1);
  check("the identifier is stored", row1.tin_ref === TIN);

  const { error: e2 } = await authed.rpc("acc_save_vendor_tax_profile",
    profileArgs(vendorId, { p_w9_status: "expired", p_reason: "W-9 went stale" }));
  if (e2) throw new Error("save v2: " + e2.message);
  const versions = (await db.query(
    "select version, w9_status, change_reason from acc_vendor_tax_profile where vendor_id=$1 order by version", [vendorId],
  )).rows;
  check("the second save is version 2 and version 1 is kept", versions.length === 2 && num(versions[1].version) === 2);
  check("each version keeps its own reason",
    versions[0].change_reason === "W-9 received" && versions[1].change_reason === "W-9 went stale");
  const current = (await db.query("select version from acc_vendor_tax_profile_current($1)", [vendorId])).rows[0];
  check("the current profile is the highest version", num(current.version) === 2);

  // ---- 2) The identifier never reaches the audit log ---------------------
  const auditText = JSON.stringify((await db.query(
    "select before_json, after_json from acc_audit_log where table_name='acc_vendor_tax_profile'",
  )).rows);
  check("the audit log does not contain the taxpayer identifier", !auditText.includes(TIN));
  check("the audit log records which fields changed", /changed_fields/.test(auditText) && /w9_status/.test(auditText));

  // Restore a usable profile for the reporting checks.
  const { error: e3 } = await authed.rpc("acc_save_vendor_tax_profile",
    profileArgs(vendorId, { p_reason: "W-9 refreshed" }));
  if (e3) throw new Error("save v3: " + e3.message);

  // ---- 3) The approval gate ---------------------------------------------
  await db.query("update acc_approval_policy set enabled=true, require_segregation=false where action_key='vendor_tax_profile'");
  const { error: eGated } = await authed.rpc("acc_save_vendor_tax_profile",
    profileArgs(vendorId, { p_reason: "should be gated" }));
  check("with the policy on, a direct save is refused",
    !!eGated && /requires approval/i.test(eGated.message));

  const { data: reqId, error: eSubmit } = await authed.rpc("acc_submit_for_approval", {
    p_action_key: "vendor_tax_profile",
    p_title: "E2E tax profile change",
    p_amount_minor: 0,
    p_payload: {
      vendor_id: vendorId, w9_status: "on_file", w9_received_date: "2026-01-15",
      w9_expires_date: "", classification: "llc", reporting_name: "E2E Tax Vendor LLC",
      tin_ref: TIN, tin_type: "ein", address_line1: "1 Market St", address_line2: "",
      city: "San Jose", region: "CA", postal_code: "95113", country: "US",
      is_1099_eligible: true, box_code: "NEC-1", eligibility_override: false, override_reason: "",
    },
    p_reason: "Approved change of reporting details",
  });
  if (eSubmit) throw new Error("submit: " + eSubmit.message);
  const { data: approvedId, error: eApprove } = await authed.rpc("acc_approve_request", {
    p_request_id: reqId, p_note: "checked",
  });
  if (eApprove) throw new Error("approve: " + eApprove.message);
  const approvedVersion = (await db.query("select version from acc_vendor_tax_profile where id=$1", [approvedId])).rows[0];
  check("approval performs the tax profile change", num(approvedVersion.version) === 4, `(v=${approvedVersion?.version})`);
  await db.query("update acc_approval_policy set enabled=false, require_segregation=true where action_key='vendor_tax_profile'");

  // ---- 4) Cash-basis totals across two years ----------------------------
  // $600 bill payment + $100 expense in 2026, $100 expense in 2027.
  const payId = (await db.query(
    `insert into acc_bill_payment (vendor_id, payment_date, currency_code, amount_minor,
       unapplied_minor, payment_account_id, status)
     values ($1, '2026-03-10', $2, 60000, 60000, $3, 'unapplied') returning id`,
    [vendorId, base, bank],
  )).rows[0].id;
  const exp2026 = (await db.query(
    `insert into acc_expense (vendor_id, payment_account_id, expense_date, currency_code, total_minor, status)
     values ($1, $2, '2026-06-01', $3, 10000, 'posted') returning id`,
    [vendorId, bank, base],
  )).rows[0].id;
  await db.query(
    `insert into acc_expense (vendor_id, payment_account_id, expense_date, currency_code, total_minor, status)
     values ($1, $2, '2027-02-01', $3, 10000, 'posted')`,
    [vendorId, bank, base],
  );
  await db.query(
    "insert into acc_expense_line (expense_id, line_order, description, expense_account_id, amount_minor) values ($1, 0, 'E2E', $2, 10000)",
    [exp2026, expenseAcct],
  );

  const r2026 = await summaryRow(authed, 2026, vendorId);
  check("the year reports the payment plus the expense", r2026 && num(r2026.paid_minor) === 70000, `(=${r2026?.paid_minor})`);
  check("the vendor is reportable over the threshold", r2026?.is_1099_eligible === true && num(r2026.paid_minor) >= num(r2026.threshold_minor));
  check("the report says a TIN is on file without returning it",
    r2026?.tin_on_file === true && !Object.values(r2026 ?? {}).some((v) => String(v).includes(TIN)));
  check("the report says the address is complete", r2026?.address_complete === true);

  const r2027 = await summaryRow(authed, 2027, vendorId);
  check("the next year reports only its own payment", r2027 && num(r2027.paid_minor) === 10000, `(=${r2027?.paid_minor})`);
  check("under the threshold it is not over the reporting line", num(r2027.paid_minor) < num(r2027.threshold_minor));

  const quiet = await summaryRow(authed, 2026, quietVendorId);
  check("a vendor with no payments and no eligibility does not appear", quiet === null);

  const { data: control, error: eControl } = await authed.rpc("acc_1099_control_total", { p_year: 2026 });
  if (eControl) throw new Error("control total: " + eControl.message);
  const { data: all2026 } = await authed.rpc("acc_1099_summary", { p_year: 2026 });
  const rowsTotal = (all2026 ?? []).reduce((s, r) => s + num(r.paid_minor), 0);
  check("the rows tie to the control total", rowsTotal === num(control), `(rows=${rowsTotal} control=${control})`);

  // A voided payment leaves the dataset.
  await db.query("update acc_bill_payment set status='void' where id=$1", [payId]);
  const r2026Void = await summaryRow(authed, 2026, vendorId);
  check("a voided payment is excluded", num(r2026Void.paid_minor) === 10000, `(=${r2026Void.paid_minor})`);

  // ---- Cleanup ---------------------------------------------------------
  // Sweep by name, not only by the ids created in this run, so a previous
  // aborted run leaves nothing behind either.
  const TEST_VENDORS = "select id from acc_vendor where name like 'E2E %Vendor'";
  await db.query("begin");
  await db.query("delete from acc_approval_request where title like 'E2E%'");
  await db.query(`delete from acc_vendor_tax_profile where vendor_id in (${TEST_VENDORS})`);
  await db.query(`delete from acc_expense_line where expense_id in (select id from acc_expense where vendor_id in (${TEST_VENDORS}))`);
  await db.query(`delete from acc_expense where vendor_id in (${TEST_VENDORS})`);
  await db.query(`delete from acc_bill_payment where vendor_id in (${TEST_VENDORS})`);
  await db.query(`delete from acc_vendor where id in (${TEST_VENDORS})`);
  await db.query("delete from acc_audit_log where table_name in ('acc_vendor_tax_profile','acc_approval_request','acc_approval_policy')");
  await db.query("commit");

  const leftProfiles = (await db.query("select count(*)::int c from acc_vendor_tax_profile")).rows[0].c;
  const leftVendors = (await db.query("select count(*)::int c from acc_vendor where name like 'E2E %Vendor'")).rows[0].c;
  const policyOff = (await db.query("select count(*)::int c from acc_approval_policy where enabled")).rows[0].c;
  check("cleanup left no tax profiles", leftProfiles === 0, `(=${leftProfiles})`);
  check("cleanup left no test vendors", leftVendors === 0, `(=${leftVendors})`);
  check("cleanup left every approval policy disabled", policyOff === 0, `(=${policyOff})`);
  console.log("  (cleanup done)");

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((e) => {
  const parts = [e.code, e.message].filter(Boolean).join(" ");
  console.error("verify error:", parts || "(no message)");
  process.exitCode = 1;
}).finally(() => db.end());
