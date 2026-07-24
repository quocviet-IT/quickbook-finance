// scripts/verify-cashflow.mjs
// E2E verify of the Cash Flow Statement + dashboard aggregations (migration
// 0030): post an operating (sales receipt), an investing (fixed-asset
// purchase) and a financing (owner contribution) manual journal in an open
// month, then confirm acc_cash_flow buckets them correctly, that the three
// categories tie out to the net bank-balance change over the window, and that
// acc_unreconciled_bank picks up the new (unreconciled) bank lines. Cleans up
// after itself (void-before-delete).
// Run: node --env-file=.env.local scripts/verify-cashflow.mjs
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const sb = createClient(url, key, { auth: { persistSession: false } });
const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });

let pass = 0, fail = 0;
const check = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " " + d : ""}`); };
const acctId = async (code) => (await db.query("select id from acc_account where account_code=$1", [code])).rows[0]?.id;

const FROM = "2026-09-01";
const TO = "2026-09-30";

async function main() {
  await db.connect();

  // A date with no acc_accounting_period row is never closed. Confirm 2026-09
  // has no period row so the posts below cannot be rejected by the guard.
  const periodRow = await db.query(
    "select status from acc_accounting_period where $1::date between period_start and period_end",
    [FROM]
  );
  check("2026-09 has no accounting-period row (guard inert)", periodRow.rowCount === 0, periodRow.rowCount ? `(found status=${periodRow.rows[0].status})` : "");

  const { data: auth, error: e1 } = await sb.auth.signInWithPassword({ email: "admin@ctyhp.vn", password: "Ctyhp@Ketoan2026" });
  if (e1) throw new Error("login: " + e1.message);
  const authed = createClient(url, key, { global: { headers: { Authorization: "Bearer " + auth.session.access_token } }, auth: { persistSession: false } });

  const bank = await acctId("1010");
  const income = await acctId("4000");
  const equity = await acctId("3000");

  // Find or create a posting fixed-asset account.
  let fixedAssetId = (await db.query(
    "select id from acc_account where account_type='fixed_asset' and is_posting_account and status='active' limit 1"
  )).rows[0]?.id;
  let createdFixedAsset = false;
  if (!fixedAssetId) {
    const ins = await db.query(
      "insert into acc_account(account_code,name,account_type,currency_code,is_posting_account,status) values('1500','Equipment','fixed_asset','USD',true,'active') returning id"
    );
    fixedAssetId = ins.rows[0].id;
    createdFixedAsset = true;
  }
  console.log(`  (fixed-asset account: ${fixedAssetId}${createdFixedAsset ? ", created 1500 Equipment" : ", reused existing"})`);

  const bankBal = async (to) => Number((await db.query(
    "select coalesce(sum(debit_minor-credit_minor),0) b from acc_journal_line l join acc_journal_entry e on e.id=l.journal_entry_id where l.account_id=$1 and e.status='posted' and e.entry_date<=$2",
    [bank, to]
  )).rows[0].b);

  const bankBefore = await bankBal("2026-08-31");

  // 1) Sales receipt: DR bank 300_00 / CR income 300_00 -> Operating +300.
  const { data: je1, error: e2 } = await authed.rpc("acc_post_manual_journal", {
    p_entry_date: "2026-09-05", p_description: "E2E sales receipt", p_source_ref: "CF-1", p_currency: "USD",
    p_lines: [
      { account_id: bank, debit_minor: 300_00, credit_minor: 0 },
      { account_id: income, debit_minor: 0, credit_minor: 300_00 },
    ],
  });
  if (e2) throw new Error("sales receipt: " + e2.message);

  // 2) Fixed-asset purchase: DR fixed_asset 100_00 / CR bank 100_00 -> Investing -100.
  const { data: je2, error: e3 } = await authed.rpc("acc_post_manual_journal", {
    p_entry_date: "2026-09-10", p_description: "E2E fixed-asset purchase", p_source_ref: "CF-2", p_currency: "USD",
    p_lines: [
      { account_id: fixedAssetId, debit_minor: 100_00, credit_minor: 0 },
      { account_id: bank, debit_minor: 0, credit_minor: 100_00 },
    ],
  });
  if (e3) throw new Error("fixed-asset purchase: " + e3.message);

  // 3) Owner contribution: DR bank 50_00 / CR equity 50_00 -> Financing +50.
  const { data: je3, error: e4 } = await authed.rpc("acc_post_manual_journal", {
    p_entry_date: "2026-09-20", p_description: "E2E owner contribution", p_source_ref: "CF-3", p_currency: "USD",
    p_lines: [
      { account_id: bank, debit_minor: 50_00, credit_minor: 0 },
      { account_id: equity, debit_minor: 0, credit_minor: 50_00 },
    ],
  });
  if (e4) throw new Error("owner contribution: " + e4.message);

  const jeIds = [je1, je2, je3];

  // Trial balance still balances (sum debit = sum credit over posted).
  const tb = (await db.query("select coalesce(sum(debit_minor),0) d, coalesce(sum(credit_minor),0) c from acc_journal_line l join acc_journal_entry e on e.id=l.journal_entry_id where e.status='posted'")).rows[0];
  check("trial balance balanced after the three JEs", Number(tb.d) === Number(tb.c), `(${tb.d}=${tb.c})`);

  // 4) acc_cash_flow bucketing.
  const { data: cf, error: e5 } = await authed.rpc("acc_cash_flow", { p_from: FROM, p_to: TO });
  if (e5) throw new Error("acc_cash_flow: " + e5.message);
  const byCat = Object.fromEntries((cf || []).map((r) => [r.category, Number(r.amount_minor)]));
  check("operating = 300_00", byCat.operating === 300_00, `(=${byCat.operating})`);
  check("investing = -100_00", byCat.investing === -100_00, `(=${byCat.investing})`);
  check("financing = 50_00", byCat.financing === 50_00, `(=${byCat.financing})`);

  // 5) Ties out to net bank-balance change over the window.
  const netCategories = (byCat.operating || 0) + (byCat.investing || 0) + (byCat.financing || 0);
  const netBankChange = (await bankBal(TO)) - bankBefore;
  check("operating+investing+financing == net bank change over window", netCategories === netBankChange && netBankChange === 250_00, `(${netCategories}=${netBankChange}=250_00 expected)`);

  // 6) acc_unreconciled_bank picks up the new (unreconciled) bank lines.
  const { data: unrec, error: e6 } = await authed.rpc("acc_unreconciled_bank", { p_as_of: TO });
  if (e6) throw new Error("acc_unreconciled_bank: " + e6.message);
  const unrecRow = Array.isArray(unrec) ? unrec[0] : unrec;
  check("acc_unreconciled_bank item_count >= 3", Number(unrecRow.item_count) >= 3, `(=${unrecRow.item_count})`);

  // Cleanup. Void entries BEFORE deleting lines: the acc_journal_line_immutable
  // trigger blocks deleting/updating lines while their entry is still 'posted'.
  await db.query("begin");
  await db.query("update acc_journal_entry set status='void' where id = any($1::uuid[])", [jeIds]);
  await db.query("delete from acc_journal_line where journal_entry_id = any($1::uuid[])", [jeIds]);
  await db.query("delete from acc_journal_entry where id = any($1::uuid[])", [jeIds]);
  if (createdFixedAsset) {
    await db.query("delete from acc_account where id=$1", [fixedAssetId]);
  }
  await db.query("update acc_sequence set next_value=1 where key='journal_entry'");
  await db.query("commit");
  console.log("  (cleanup done)");

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch(async (e) => {
  const parts = [e.code, e.message].filter(Boolean).join(" ");
  console.error("verify error:", parts || "(no message)");
  process.exitCode = 1;
}).finally(() => db.end());
