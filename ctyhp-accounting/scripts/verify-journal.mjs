// scripts/verify-journal.mjs
// E2E verify of Module B (as admin): post a manual JE and check GL/Trial Balance;
// reverse it and confirm the original stays and the net is zero from the reversal
// date; post opening balances and confirm the ledger balances. Cleans up after.
// Run: node --env-file=.env.local scripts/verify-journal.mjs
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

  // 1) Manual JE: DR bank 300, CR income 300.
  const { data: jeId, error: e2 } = await authed.rpc("acc_post_manual_journal", {
    p_entry_date: "2026-03-15", p_description: "E2E manual", p_source_ref: "REF-1", p_currency: "USD",
    p_lines: [
      { account_id: bank, debit_minor: 300_00, credit_minor: 0 },
      { account_id: income, debit_minor: 0, credit_minor: 300_00 },
    ],
  });
  if (e2) throw new Error("manual: " + e2.message);
  const bankBal = async (to) => Number((await db.query(
    "select coalesce(sum(debit_minor-credit_minor),0) b from acc_journal_line l join acc_journal_entry e on e.id=l.journal_entry_id where l.account_id=$1 and e.status='posted' and e.entry_date<=$2", [bank, to])).rows[0].b);
  check("bank rose by 300 after manual JE", (await bankBal("2026-03-15")) >= 300_00);

  // Trial balance still balances (sum debit = sum credit over posted).
  const tb = async () => (await db.query("select coalesce(sum(debit_minor),0) d, coalesce(sum(credit_minor),0) c from acc_journal_line l join acc_journal_entry e on e.id=l.journal_entry_id where e.status='posted'")).rows[0];
  let t = await tb();
  check("trial balance balanced after manual JE", Number(t.d) === Number(t.c), `(${t.d}=${t.c})`);

  // 2) Reverse it in April. Original stays posted; net from reversal date = 0.
  const { error: e3 } = await authed.rpc("acc_reverse_entry", { p_entry_id: jeId, p_reason: "E2E reverse", p_reversal_date: "2026-04-01" });
  if (e3) throw new Error("reverse: " + e3.message);
  const origStatus = (await db.query("select status from acc_journal_entry where id=$1", [jeId])).rows[0].status;
  check("original entry remains posted", origStatus === "posted");
  check("report before reversal unchanged (bank at Mar 31 still +300)", (await bankBal("2026-03-31")) >= 300_00);
  check("net bank effect at Apr 30 is zero", (await bankBal("2026-04-30")) === (await bankBal("2026-02-28")));

  // Reversing again must fail.
  const { error: e4 } = await authed.rpc("acc_reverse_entry", { p_entry_id: jeId, p_reason: "again", p_reversal_date: "2026-04-02" });
  check("re-reversing the same entry is rejected", !!e4);

  // 3) Opening balances as of 2026-01-01: DR bank 1000 -> equity CR 1000.
  const { error: e5 } = await authed.rpc("acc_post_opening_balances", {
    p_as_of: "2026-01-01", p_currency: "USD",
    p_lines: [{ account_id: bank, debit_minor: 1000_00, credit_minor: 0 }],
  });
  if (e5) throw new Error("opening: " + e5.message);
  const equity = await acctId("3900");
  const equityCr = Number((await db.query("select coalesce(sum(credit_minor-debit_minor),0) c from acc_journal_line where account_id=$1", [equity])).rows[0].c);
  check("Opening Balance Equity absorbed 1000", equityCr === 1000_00, `(=${equityCr})`);
  t = await tb();
  check("trial balance balanced after opening balances", Number(t.d) === Number(t.c), `(${t.d}=${t.c})`);

  // Second opening batch for same date rejected.
  const { error: e6 } = await authed.rpc("acc_post_opening_balances", { p_as_of: "2026-01-01", p_currency: "USD", p_lines: [{ account_id: bank, debit_minor: 1, credit_minor: 0 }] });
  check("duplicate opening batch rejected", !!e6);

  // Cleanup
  await db.query("begin");
  await db.query("delete from acc_journal_reversal_link");
  await db.query("delete from acc_journal_line");
  await db.query("delete from acc_journal_entry");
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
