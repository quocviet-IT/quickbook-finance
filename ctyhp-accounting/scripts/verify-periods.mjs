// scripts/verify-periods.mjs
// E2E verify of Module: Company Settings + Accounting Periods (as admin):
// generate 2026 periods, post a manual JE into 2026-03, close the period and
// confirm both new postings and voiding the existing entry are rejected,
// reverse the entry into open April, reopen the period and confirm posting
// works again, then verify company-settings versioning and that the EIN is
// never written to the audit log. Cleans up after itself.
// Run: node --env-file=.env.local scripts/verify-periods.mjs
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const sb = createClient(url, key, { auth: { persistSession: false } });
const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });

let pass = 0, fail = 0;
const check = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " " + d : ""}`); };
const acctId = async (code) => (await db.query("select id from acc_account where account_code=$1", [code])).rows[0].id;

async function main() {
  await db.connect();
  const { data: auth, error: e1 } = await sb.auth.signInWithPassword({ email: "admin@ctyhp.vn", password: "Ctyhp@Ketoan2026" });
  if (e1) throw new Error("login: " + e1.message);
  const authed = createClient(url, key, { global: { headers: { Authorization: "Bearer " + auth.session.access_token } }, auth: { persistSession: false } });

  const bank = await acctId("1010");
  const income = await acctId("4000");

  // 1) Ensure a company settings row exists so acc_generate_periods has a
  // fiscal start, then generate the 2026 periods.
  const existingSettings = (await db.query("select count(*)::int c from acc_company_setting_version")).rows[0].c;
  if (existingSettings === 0) {
    const { error: eSeed } = await authed.rpc("acc_save_company_settings", {
      p_legal_name: "CTYHP E2E Test Co", p_dba_name: null, p_ein_ref: "12-3456789",
      p_address_line1: null, p_address_line2: null, p_city: null, p_region: null, p_postal_code: null, p_country: "US",
      p_fiscal_year_start_month: 1, p_base_currency_code: "USD", p_time_zone: "America/New_York",
      p_accounting_basis: "accrual", p_default_payment_terms_days: 30,
    });
    if (eSeed) throw new Error("save settings (seed): " + eSeed.message);
  }

  const { error: eGen } = await authed.rpc("acc_generate_periods", { p_fiscal_year: 2026 });
  if (eGen) throw new Error("generate periods: " + eGen.message);
  const periodCount2026 = (await db.query("select count(*)::int c from acc_accounting_period where fiscal_year=2026")).rows[0].c;
  check("2026 has 12 periods", periodCount2026 === 12, `(=${periodCount2026})`);

  // 2) Post a manual JE dated 2026-03-15: DR bank 100, CR income 100.
  const { data: jeId, error: e2 } = await authed.rpc("acc_post_manual_journal", {
    p_entry_date: "2026-03-15", p_description: "E2E periods manual", p_source_ref: "REF-PERIOD-1", p_currency: "USD",
    p_lines: [
      { account_id: bank, debit_minor: 100_00, credit_minor: 0 },
      { account_id: income, debit_minor: 0, credit_minor: 100_00 },
    ],
  });
  if (e2) throw new Error("manual (open period): " + e2.message);
  check("manual JE posted into open 2026-03", !!jeId);

  // 3) Close the 2026-03 period.
  const marPeriodId = (await db.query("select id from acc_accounting_period where fiscal_year=2026 and label='2026-03'")).rows[0].id;
  const { error: e3 } = await authed.rpc("acc_close_period", { p_period_id: marPeriodId, p_reason: "E2E close" });
  if (e3) throw new Error("close period: " + e3.message);
  const marStatusAfterClose = (await db.query("select status from acc_accounting_period where id=$1", [marPeriodId])).rows[0].status;
  check("2026-03 period is closed", marStatusAfterClose === "closed");

  // 4) New posting into the closed period must fail.
  const { error: e4a } = await authed.rpc("acc_post_manual_journal", {
    p_entry_date: "2026-03-20", p_description: "E2E should fail", p_source_ref: "REF-PERIOD-2", p_currency: "USD",
    p_lines: [
      { account_id: bank, debit_minor: 50_00, credit_minor: 0 },
      { account_id: income, debit_minor: 0, credit_minor: 50_00 },
    ],
  });
  check("posting into closed period is rejected", !!e4a);

  // Attempt to void the existing entry via the authed client. There is no RLS
  // update policy on acc_journal_entry (all voiding goes through security-
  // definer RPCs), so this is blocked unconditionally at the API layer: no
  // error, zero rows affected.
  const { data: voidData, error: e4b } = await authed.from("acc_journal_entry").update({ status: "void" }).eq("id", jeId).select();
  check("direct client void of a journal entry is blocked by RLS (defense in depth)", !e4b && Array.isArray(voidData) && voidData.length === 0);

  // The closed-period void trigger itself: attempt the same update through the
  // raw DB client (bypasses RLS like a security-definer function would) and
  // confirm the trigger rejects it because the entry's date is in a closed period.
  let triggerRejected = false;
  try {
    await db.query("update acc_journal_entry set status='void' where id=$1", [jeId]);
  } catch (err) {
    triggerRejected = /closed period/i.test(err.message);
  }
  check("closed-period void trigger rejects voiding a closed-period entry", triggerRejected);

  const jeStatusAfterVoidAttempt = (await db.query("select status from acc_journal_entry where id=$1", [jeId])).rows[0].status;
  check("entry remains posted after rejected void", jeStatusAfterVoidAttempt === "posted");

  // 5) Reverse the entry into the open April period.
  const { error: e5 } = await authed.rpc("acc_reverse_entry", { p_entry_id: jeId, p_reason: "correction", p_reversal_date: "2026-04-01" });
  if (e5) throw new Error("reverse: " + e5.message);
  check("reversal into open period succeeds", true);

  // 6) Reopen the period, then posting succeeds again.
  const { error: e6a } = await authed.rpc("acc_reopen_period", { p_period_id: marPeriodId, p_reason: "E2E reopen" });
  if (e6a) throw new Error("reopen period: " + e6a.message);
  const marStatusAfterReopen = (await db.query("select status from acc_accounting_period where id=$1", [marPeriodId])).rows[0].status;
  check("2026-03 period is open again", marStatusAfterReopen === "open");

  const { data: jeId2, error: e6b } = await authed.rpc("acc_post_manual_journal", {
    p_entry_date: "2026-03-21", p_description: "E2E after reopen", p_source_ref: "REF-PERIOD-3", p_currency: "USD",
    p_lines: [
      { account_id: bank, debit_minor: 25_00, credit_minor: 0 },
      { account_id: income, debit_minor: 0, credit_minor: 25_00 },
    ],
  });
  if (e6b) throw new Error("manual (reopened period): " + e6b.message);
  check("manual JE posts after reopen", !!jeId2);

  // 7) Company settings versioning: save again with a different legal name.
  const { error: e7 } = await authed.rpc("acc_save_company_settings", {
    p_legal_name: "CTYHP E2E Test Co (Renamed)", p_dba_name: null, p_ein_ref: "12-3456789",
    p_address_line1: null, p_address_line2: null, p_city: null, p_region: null, p_postal_code: null, p_country: "US",
    p_fiscal_year_start_month: 1, p_base_currency_code: "USD", p_time_zone: "America/New_York",
    p_accounting_basis: "accrual", p_default_payment_terms_days: 30,
  });
  if (e7) throw new Error("save settings (v2): " + e7.message);

  const versionCount = (await db.query("select count(*)::int c from acc_company_setting_version")).rows[0].c;
  check("at least two company setting versions exist", versionCount >= 2, `(=${versionCount})`);
  const current = (await db.query(
    "select legal_name from acc_company_setting_version order by effective_from desc, version desc limit 1",
  )).rows[0];
  check("current settings is the most recently saved version", current.legal_name === "CTYHP E2E Test Co (Renamed)");

  const auditRows = (await db.query(
    "select before_json, after_json from acc_audit_log where table_name='acc_company_setting_version' order by created_at desc limit 1",
  )).rows;
  check("audit log row exists for the settings insert", auditRows.length === 1);
  const auditText = JSON.stringify(auditRows[0] ?? {});
  check("audit log does not contain the EIN", auditRows[0] && auditRows[0].before_json == null && auditRows[0].after_json == null && !auditText.includes("12-3456789"));

  // Cleanup. Periods must be deleted BEFORE voiding/deleting journal entries so
  // the closed-period void trigger and post guard don't block cleanup.
  await db.query("begin");
  await db.query("delete from acc_period_event");
  await db.query("delete from acc_accounting_period where fiscal_year=2026");
  await db.query("delete from acc_company_setting_version");
  await db.query("delete from acc_journal_reversal_link");
  await db.query("update acc_journal_entry set status='void'");
  await db.query("delete from acc_journal_line");
  await db.query("delete from acc_journal_entry");
  await db.query("delete from acc_audit_log where table_name in ('acc_company_setting_version','acc_accounting_period')");
  await db.query("update acc_sequence set next_value=1");
  await db.query("commit");

  const remainingPeriods = (await db.query("select count(*)::int c from acc_accounting_period")).rows[0].c;
  const remainingSettings = (await db.query("select count(*)::int c from acc_company_setting_version")).rows[0].c;
  const remainingEntries = (await db.query("select count(*)::int c from acc_journal_entry")).rows[0].c;
  check("cleanup left no periods", remainingPeriods === 0, `(=${remainingPeriods})`);
  check("cleanup left no company setting versions", remainingSettings === 0, `(=${remainingSettings})`);
  check("cleanup left no journal entries", remainingEntries === 0, `(=${remainingEntries})`);
  console.log("  (cleanup done)");

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((e) => {
  const parts = [e.code, e.message].filter(Boolean).join(" ");
  console.error("verify error:", parts || "(no message)");
  process.exitCode = 1;
}).finally(() => db.end());
