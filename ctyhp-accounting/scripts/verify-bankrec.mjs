// scripts/verify-bankrec.mjs
// E2E verify of bank reconciliation sessions (as admin): record a payment,
// open a reconciliation, clear its bank line, complete the session; open a
// second session and confirm the cleared line is no longer offered; open a
// third session and post an adjustment for a residual difference, complete
// it; exercise the reopen chain guard (reopening an older completed session
// while a later one exists is rejected, reopening the latest succeeds); void
// a reconciled entry and confirm it surfaces as a discrepancy. Cleans up
// after itself (void-before-delete, mirroring scripts/verify-journal.mjs).
// Run: node --env-file=.env.local scripts/verify-bankrec.mjs
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
  const expense = (await db.query(
    "select id from acc_account where account_type='expense' and is_posting_account and status='active' limit 1")).rows[0].id;

  // --- Ensure a bank account row exists for the GL bank account. ----------
  let bankAccountId = (await db.query("select id from acc_bank_account where account_id=$1", [bank])).rows[0]?.id;
  let createdBankAccount = false;
  if (!bankAccountId) {
    bankAccountId = (await db.query(
      "insert into acc_bank_account (account_id, bank_name, currency_code) values ($1,'E2E Test Bank','USD') returning id",
      [bank])).rows[0].id;
    createdBankAccount = true;
  }

  // --- Seed a customer and record a payment of 500 (DR bank / CR AR). -----
  const custId = (await db.query(
    "insert into acc_customer (name, currency_code) values ('E2E BankRec Customer','USD') returning id")).rows[0].id;

  const { data: paymentId, error: e2 } = await authed.rpc("acc_record_payment", {
    p_customer_id: custId, p_payment_date: "2026-06-10", p_currency: "USD", p_amount_minor: 500_00,
    p_deposit_account_id: bank, p_method: "bank_transfer", p_memo: "E2E bankrec payment", p_allocations: [],
  });
  if (e2) throw new Error("record payment: " + e2.message);

  const paymentEntryId = (await db.query("select journal_entry_id from acc_payment where id=$1", [paymentId])).rows[0].journal_entry_id;
  const bankLineId = (await db.query(
    "select l.id from acc_journal_line l join acc_journal_entry e on e.id=l.journal_entry_id where e.id=$1 and l.account_id=$2",
    [paymentEntryId, bank])).rows[0].id;

  // --- 1) First session: ending balance 500, nothing cleared yet. --------
  const { data: session1, error: e3 } = await authed.rpc("acc_create_reconciliation", {
    p_bank_account_id: bankAccountId, p_ending_date: "2026-06-10", p_ending_balance_minor: 500_00,
  });
  if (e3) throw new Error("create reconciliation: " + e3.message);

  let detail = (await authed.rpc("acc_reconciliation_detail", { p_reconciliation_id: session1 })).data[0];
  check("session1 difference is 500_00 before clearing", Number(detail.difference_minor) === 500_00, `(=${detail.difference_minor})`);

  const { error: e4 } = await authed.rpc("acc_set_cleared", { p_reconciliation_id: session1, p_journal_line_id: bankLineId, p_cleared: true });
  if (e4) throw new Error("set cleared: " + e4.message);
  detail = (await authed.rpc("acc_reconciliation_detail", { p_reconciliation_id: session1 })).data[0];
  check("session1 difference is 0 after clearing the payment line", Number(detail.difference_minor) === 0, `(=${detail.difference_minor})`);

  // --- 2) Complete session1; a NEW session no longer offers that line. ---
  const { error: e5 } = await authed.rpc("acc_complete_reconciliation", { p_reconciliation_id: session1 });
  if (e5) throw new Error("complete session1: " + e5.message);
  const s1status = (await db.query("select status from acc_statement_reconciliation where id=$1", [session1])).rows[0].status;
  check("session1 status is completed", s1status === "completed", `(=${s1status})`);

  const { data: session2, error: e6 } = await authed.rpc("acc_create_reconciliation", {
    p_bank_account_id: bankAccountId, p_ending_date: "2026-06-15", p_ending_balance_minor: 500_00,
  });
  if (e6) throw new Error("create reconciliation 2: " + e6.message);
  const lines2 = (await authed.rpc("acc_reconciliation_lines", { p_reconciliation_id: session2 })).data;
  check("session2 no longer lists the line reconciled by the completed session1", !lines2.some((l) => l.journal_line_id === bankLineId));

  // --- 4) Adjustment path: session2's ending = beginning + 3_00, clear nothing, adjust. ---
  detail = (await authed.rpc("acc_reconciliation_detail", { p_reconciliation_id: session2 })).data[0];
  check("session2 beginning balance carried from session1's ending (500_00)", Number(detail.beginning_minor) === 500_00, `(=${detail.beginning_minor})`);

  // Reset session2's ending balance to beginning+3 so the only difference is the adjustment.
  await db.query("update acc_statement_reconciliation set statement_ending_balance_minor=$1 where id=$2", [500_00 + 3_00, session2]);
  detail = (await authed.rpc("acc_reconciliation_detail", { p_reconciliation_id: session2 })).data[0];
  check("session2 difference is 3_00 before adjustment", Number(detail.difference_minor) === 3_00, `(=${detail.difference_minor})`);

  const { error: e7 } = await authed.rpc("acc_record_reconciliation_adjustment", {
    p_reconciliation_id: session2, p_offset_account_id: expense, p_reason: "E2E bank fee",
  });
  if (e7) throw new Error("record adjustment: " + e7.message);
  detail = (await authed.rpc("acc_reconciliation_detail", { p_reconciliation_id: session2 })).data[0];
  check("session2 difference is 0 after the adjustment", Number(detail.difference_minor) === 0, `(=${detail.difference_minor})`);

  const { error: e8 } = await authed.rpc("acc_complete_reconciliation", { p_reconciliation_id: session2 });
  if (e8) throw new Error("complete session2: " + e8.message);
  const s2status = (await db.query("select status from acc_statement_reconciliation where id=$1", [session2])).rows[0].status;
  check("session2 status is completed", s2status === "completed", `(=${s2status})`);

  // --- 5) Reopen chain guard. ----------------------------------------------
  const { error: e9 } = await authed.rpc("acc_reopen_reconciliation", { p_reconciliation_id: session1, p_reason: "E2E reopen attempt" });
  check("reopening session1 while session2 (later) is completed is rejected", !!e9);

  const { error: e10 } = await authed.rpc("acc_reopen_reconciliation", { p_reconciliation_id: session2, p_reason: "E2E reopen latest" });
  if (e10) throw new Error("reopen session2: " + e10.message);
  const s2status2 = (await db.query("select status from acc_statement_reconciliation where id=$1", [session2])).rows[0].status;
  check("session2 status is in_progress after reopening the latest session", s2status2 === "in_progress", `(=${s2status2})`);

  // --- 6) Discrepancy: void the reconciled payment entry. ------------------
  await db.query("update acc_journal_entry set status='void' where id=$1", [paymentEntryId]);
  const discrepancies = (await db.query("select * from acc_reconciliation_discrepancies($1)", [bankAccountId])).rows;
  check("voided reconciled payment line surfaces as a discrepancy", discrepancies.some((d) => d.journal_line_id === bankLineId));

  // --- Cleanup. Void-before-delete, mirroring scripts/verify-journal.mjs. --
  await db.query("begin");
  await db.query("delete from acc_reconciliation_line where reconciliation_id in ($1,$2)", [session1, session2]);
  await db.query("delete from acc_statement_reconciliation where id in ($1,$2)", [session1, session2]);
  await db.query("delete from acc_payment where id=$1", [paymentId]);
  await db.query("update acc_journal_entry set status='void'");
  await db.query("delete from acc_journal_line");
  await db.query("delete from acc_journal_entry");
  await db.query("delete from acc_customer where id=$1", [custId]);
  if (createdBankAccount) {
    await db.query("delete from acc_bank_account where id=$1", [bankAccountId]);
  }
  await db.query("update acc_sequence set next_value=1");
  await db.query("commit");
  console.log("  (cleanup done)");

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((e) => {
  const parts = [e.code, e.message].filter(Boolean).join(" ");
  console.error("verify error:", parts || "(no message)");
  process.exitCode = 1;
}).finally(() => db.end());
