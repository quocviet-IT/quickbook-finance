/**
 * Once, for 1.85: the bank lines of the months signed off before 1.85 are
 * matched in Bank Transactions, as Complete matches them from 1.85 on.
 *
 * For every company, every completed reconciliation that keeps statement lines
 * is paired by the same service Complete uses (lib/services/statement-bank-lines),
 * read with the service role, and handed to acc_match_reconciled_bank_lines as
 * the company's first active administrator — one transaction per company.
 *
 *   ONEBOOK_MATCH_SIGNED_MONTHS=dry    every call is made, then rolled back; it
 *                                      prints what would be matched and left. When
 *                                      0136 is not live yet it is applied inside
 *                                      that transaction and rolled back with it.
 *   ONEBOOK_MATCH_SIGNED_MONTHS=apply  the same, committed. Refused unless 0136 is live.
 *
 * Without the variable the file does nothing, so a run of the live checks never writes.
 *
 * Run (--silent=false shows what it did, line by line):
 *   ONEBOOK_MATCH_SIGNED_MONTHS=dry node --env-file=.env.local ./node_modules/vitest/vitest.mjs run
 *     --config vitest.live.config.ts --silent=false --reporter=verbose tests/live/match-signed-months.live.ts
 */
import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import pg from "pg";
import { describe, it } from "vitest";
import { planCompanySchema } from "@/lib/domain/schema-template";
import { NO_BANK_LINE_MATCHES, addMatchCounts, type BankLineMatchCounts } from "@/lib/domain/statement-bank-lines";
import { matchCountsOf, reconciledPairsOf } from "@/lib/services/statement-bank-lines";

const MODE = process.env.ONEBOOK_MATCH_SIGNED_MONTHS;
const FILE = "0136_match_reconciled_bank_lines.sql";

describe.skipIf(MODE !== "dry" && MODE !== "apply")("matching the bank lines of the months already signed off", () => {
  it(`${MODE === "apply" ? "matches" : "counts, without keeping anything,"} every company's signed months`, async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const auth = { persistSession: false };
    const control = createClient(url, serviceKey, { auth });
    const { data: companies, error } = await control
      .schema("onebook")
      .from("company")
      .select("schema_name,is_sample")
      .eq("status", "active")
      .order("display_order")
      .order("schema_name");
    if (error) throw new Error(`companies: ${error.message}`);

    const migration = readFileSync(new URL(`../../supabase/migrations/${FILE}`, import.meta.url), "utf8");
    const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
    await client.connect();
    let total: BankLineMatchCounts = NO_BANK_LINE_MATCHES;
    try {
      for (const { schema_name: schema, is_sample } of companies ?? []) {
        const sb = createClient(url, serviceKey, { auth, db: { schema } }) as unknown as SupabaseClient;
        await client.query("begin");
        try {
          await client.query("set local lock_timeout = '5s'");
          await client.query(`set local search_path = ${schema}, extensions`);
          const live = (await client.query(`select 1 from acc_schema_migrations where filename = $1`, [FILE])).rowCount! > 0;
          if (!live) {
            if (MODE === "apply") throw new Error(`${schema}: 0136 is not live; apply the migration first`);
            const statements = schema === "public" ? [migration] : planCompanySchema([{ file: FILE, sql: migration }], schema).statements;
            for (const statement of statements) await client.query(statement);
          }
          const { rows: recs } = await client.query<{ id: string; ending: string; bank: string }>(
            `select r.id, r.statement_ending_date::text as ending, g.account_code || ' ' || a.bank_name as bank
               from acc_statement_reconciliation r
               join acc_bank_account a on a.id = r.bank_account_id
               join acc_account g on g.id = a.account_id
              where r.status = 'completed'
                and exists (select 1 from acc_reconciliation_statement_line l where l.reconciliation_id = r.id)
              order by g.account_code, r.statement_ending_date`,
          );
          const label = `${schema.padEnd(14)} ${is_sample ? "sample" : "REAL  "}`;
          if (!recs.length) {
            console.log(`${label} no signed month keeps a statement`);
            await client.query("rollback");
            continue;
          }
          const admin = (await client.query<{ id: string }>(
            `select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`,
          )).rows[0];
          if (!admin) throw new Error(`${schema}: no active administrator to match as`);
          await client.query("set local role authenticated");
          await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: admin.id, role: "authenticated" })]);

          let company: BankLineMatchCounts = NO_BANK_LINE_MATCHES;
          for (const rec of recs) {
            const pairs = await reconciledPairsOf(sb, rec.id);
            const counts = pairs.length
              ? matchCountsOf((await client.query(`select acc_match_reconciled_bank_lines($1, $2::jsonb) as out`, [
                  rec.id,
                  JSON.stringify(pairs.map((p) => ({ bank_transaction_id: p.bankTransactionId, journal_line_id: p.journalLineId }))),
                ])).rows[0].out)
              : NO_BANK_LINE_MATCHES;
            console.log(`${label}   ${rec.bank} to ${rec.ending}: ${pairs.length} pairs → ${JSON.stringify(counts)}`);
            company = addMatchCounts(company, counts);
          }
          console.log(`${label} ${recs.length} signed months → ${JSON.stringify(company)}`);
          total = addMatchCounts(total, company);
          await client.query(MODE === "apply" ? "commit" : "rollback");
        } catch (e) {
          await client.query("rollback");
          throw e;
        }
      }
    } finally {
      await client.end();
    }
    console.log(`${MODE === "apply" ? "MATCHED" : "DRY RUN, nothing kept"}: ${JSON.stringify(total)}`);
  });
});
