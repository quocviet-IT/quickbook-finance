/**
 * 2.48, from a bookkeeper's review of their books: "right now there is already
 * bank transactions for Checking and CC; once we connect the bank the
 * transactions from the connection would be synced ... can you make sure that
 * would not be happening?"
 *
 * On the real database, in a throwaway company built inside ONE transaction
 * that is always rolled back — nothing survives. The company is provisioned
 * from the migrations in this tree, 0161 included. The statement is imported
 * by OneBook's own service; the bank's side is played by the sync functions
 * themselves, fed the rows the sync service would send them (Plaid itself is
 * not called).
 *
 *  1. A statement is imported: a store charge, two identical cafe charges, a
 *     deposit, and a charge the bank still shows as pending.
 *  2. Connect bank offers the date of the account's last line in OneBook.
 *  3. The feed starts on 09/10: the 09/04 charge is skipped as before the
 *     start; the two cafe charges and the deposit (dated two days later by the
 *     bank) are skipped as already here; a third cafe charge, a new charge and
 *     the pending one are brought in.
 *  4. A skipped transaction the bank later changes stays skipped; one never
 *     seen is brought in.
 *  5. The syncs list counts the skips.
 *  6. Connected again after a disconnect (new provider ids for the same
 *     transactions), the lines the first connection brought in are already
 *     here too.
 *
 * Run: node --env-file=.env.local ./node_modules/vitest/vitest.mjs run --config vitest.live.config.ts
 *        tests/live/bank-feed-skips-lines-already-here.live.ts
 */
import { randomBytes } from "node:crypto";
import pg from "pg";
import { describe, expect, it, vi } from "vitest";
import { pgSupabase } from "./support/pg-supabase";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { loadMigrationSources } from "@/lib/db/migration-sources";
import type { StatementLine } from "@/lib/domain/statement-import";
import { createBankAccount, getBankFeedStartDefaults, importStatement } from "@/lib/services/banking";
import { listBankFeedSyncs } from "@/lib/services/bank-feeds";
import { provisionCompany } from "@/lib/services/company-provisioning";

const line = (txn_date: string, amount_minor: number, description: string): StatementLine => ({
  txn_date,
  description,
  reference: null,
  amount_minor,
  running_balance_minor: null,
  raw_line: `${txn_date},${description},${amount_minor}`,
});

/** One transaction as the sync service sends it to acc_apply_bank_feed_page. */
const feed = (id: string, account: string, txn_date: string, amount_minor: number, description: string, pending = false) => ({
  external_transaction_id: id,
  provider_account_id: account,
  txn_date,
  authorized_date: null,
  description,
  merchant_name: null,
  category: null,
  reference: null,
  amount_minor,
  pending,
  running_balance_minor: null,
  raw_line: JSON.stringify({ id, txn_date, amount_minor }),
  raw_hash: `hash-${id}`,
});

describe("a bank feed connected to an account that already holds statement lines", () => {
  it("skips what is already in OneBook and brings in the rest", async () => {
    const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 30_000 });
    const killer = setTimeout(() => {
      console.error("bank-feed-skips: hard timeout");
      process.exit(2);
    }, 8 * 60_000);
    await client.connect();
    const q = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows as T[];
    try {
      await client.query("begin");
      await client.query("set local lock_timeout = '10s'");
      await client.query("set local statement_timeout = '120s'");
      const [admin] = await q<{ id: string }>("select id from public.acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1");
      if (!admin) throw new Error("no active administrator to sign in as");
      const { schema } = await provisionCompany(
        client,
        { slug: `feed_${randomBytes(4).toString("hex")}`, legalName: "Feed skip check", isSample: true, displayOrder: 9999, adminUserIds: [admin.id] },
        loadMigrationSources(process.cwd()),
      );
      await client.query(`set local search_path = ${schema}, extensions`);
      const [base] = await q<{ code: string }>("select code from acc_currency where is_base limit 1");
      const [checkingGl] = await q<{ id: string }>(
        "insert into acc_account (account_code, name, account_type, detail_type) values ('1099', 'Example Checking', 'bank', 'checking') returning id",
      );
      await client.query("set local role authenticated");
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: admin.id, role: "authenticated" })]);
      const sb = pgSupabase(client);

      // 1. The statement, imported as a bookkeeper would.
      const checking = await createBankAccount(sb, { account_id: checkingGl.id, bank_name: "Example Bank", currency_code: base.code, detail_type: "checking" });
      const statement = [
        line("2026-09-04", -45600, "EXAMPLE STORE"),
        line("2026-09-10", -1200, "EXAMPLE CAFE A"),
        line("2026-09-10", -1200, "EXAMPLE CAFE B"),
        line("2026-09-12", -777, "EXAMPLE GAS"),
        line("2026-09-28", 250000, "EXAMPLE DEPOSIT"),
      ];
      await importStatement(sb, checking.id, "checking-sep.csv", statement, {
        opening_minor: 0,
        closing_minor: 201223,
        opening_basis: "printed",
        closing_basis: "printed",
        set_aside: 0,
        override: null,
      });
      const imported = await q<{ id: string; txn_date: string; amount_minor: string; description: string }>(
        "select id, txn_date::text, amount_minor, description from acc_bank_transaction where bank_account_id = $1 order by txn_date, description",
        [checking.id],
      );
      expect(imported).toHaveLength(5);

      // 2. What Connect bank offers: the date of the account's last line in OneBook.
      expect((await getBankFeedStartDefaults(sb))[checking.id]).toBe("2026-09-28");

      // 3. Connected, the feed starting on 09/10.
      const [{ id: connection }] = await q<{ id: string }>(
        "select acc_save_bank_connection($1, $2, $3, $4, $5::jsonb) as id",
        [
          "item-one",
          "ins_example",
          "Example Bank",
          "not-a-real-token",
          JSON.stringify([
            { bank_account_id: checking.id, provider_account_id: "acct-one", account_name: "Checking", currency_code: base.code, feed_starts_on: "2026-09-10" },
          ]),
        ],
      );
      const [mapping] = await q<{ feed_starts_on: string }>(
        "select feed_starts_on::text from acc_bank_feed_account where connection_id = $1",
        [connection],
      );
      expect(mapping.feed_starts_on).toBe("2026-09-10");

      const [{ run }] = await q<{ run: string }>("select acc_begin_bank_feed_sync($1) as run", [connection]);
      const page = async (added: unknown[], modified: unknown[] = []) =>
        (
          await q<{ out: Record<string, number> }>("select acc_apply_bank_feed_page($1, $2, $3::jsonb, $4::jsonb, '[]'::jsonb) as out", [
            connection,
            run,
            JSON.stringify(added),
            JSON.stringify(modified),
          ])
        )[0].out;

      const first = await page([
        feed("tx-store", "acct-one", "2026-09-04", -45600, "Example Store"),
        feed("tx-cafe-1", "acct-one", "2026-09-10", -1200, "Example Cafe"),
        feed("tx-cafe-2", "acct-one", "2026-09-11", -1200, "Example Cafe"),
        feed("tx-cafe-3", "acct-one", "2026-09-11", -1200, "Example Cafe"),
        feed("tx-gas-pending", "acct-one", "2026-09-12", -777, "Example Gas", true),
        feed("tx-deposit", "acct-one", "2026-09-30", 250000, "Deposit"),
        feed("tx-new", "acct-one", "2026-10-02", -999, "Example Bookstore"),
      ]);
      expect(first).toMatchObject({ added: 3, modified: 0, removed: 0, skipped_before_start: 1, skipped_already_here: 3 });

      const skips = await q<{ external_transaction_id: string; reason: string; twin: string | null }>(
        `select s.external_transaction_id, s.reason, t.description as twin
           from acc_bank_feed_skip s left join acc_bank_transaction t on t.id = s.twin_bank_transaction_id
          where s.run_id = $1 order by s.external_transaction_id`,
        [run],
      );
      expect(skips).toEqual([
        { external_transaction_id: "tx-cafe-1", reason: "already_here", twin: expect.stringMatching(/^EXAMPLE CAFE [AB]$/) },
        { external_transaction_id: "tx-cafe-2", reason: "already_here", twin: expect.stringMatching(/^EXAMPLE CAFE [AB]$/) },
        { external_transaction_id: "tx-deposit", reason: "already_here", twin: "EXAMPLE DEPOSIT" },
        { external_transaction_id: "tx-store", reason: "before_start", twin: null },
      ]);
      // Each line already here stands for one feed line: the two cafe charges are two lines.
      expect(new Set(skips.filter((s) => s.external_transaction_id.startsWith("tx-cafe")).map((s) => s.twin)).size).toBe(2);

      const fromFeed = await q<{ external_transaction_id: string }>(
        "select external_transaction_id from acc_bank_transaction where bank_account_id = $1 and source = 'bank_feed' order by external_transaction_id",
        [checking.id],
      );
      expect(fromFeed.map((r) => r.external_transaction_id)).toEqual(["tx-cafe-3", "tx-gas-pending", "tx-new"]);

      // 4. A skipped transaction the bank changes stays skipped; one never seen comes in; one sent again is not doubled.
      const second = await page(
        [feed("tx-cafe-1", "acct-one", "2026-09-10", -1200, "Example Cafe")],
        [feed("tx-cafe-1", "acct-one", "2026-09-10", -1200, "EXAMPLE CAFE #22"), feed("tx-late", "acct-one", "2026-10-03", -500, "Example Late Charge")],
      );
      expect(second).toMatchObject({ added: 0, modified: 1, skipped_before_start: 0, skipped_already_here: 0 });
      const [{ n: feedLines }] = await q<{ n: number }>(
        "select count(*)::int as n from acc_bank_transaction where bank_account_id = $1 and source = 'bank_feed'",
        [checking.id],
      );
      expect(feedLines).toBe(4);

      // 5. The syncs list counts what the sync skipped.
      await client.query("select acc_finish_bank_feed_sync($1, 'cursor-1', 3, 1, 0, 0, null)", [run]);
      const syncs = await listBankFeedSyncs(sb, checking.id);
      expect(syncs).toHaveLength(1);
      expect(syncs[0]).toMatchObject({ added: 3, modified: 1, skipped: 4 });

      // 6. Disconnected and connected again: the same transactions under new ids,
      //    and the lines the first connection brought in are already here.
      await client.query("select acc_disconnect_bank_connection($1, 'Connected again for the check', null)", [connection]);
      const [{ id: again }] = await q<{ id: string }>(
        "select acc_save_bank_connection($1, $2, $3, $4, $5::jsonb) as id",
        [
          "item-two",
          "ins_example",
          "Example Bank",
          "not-a-real-token",
          JSON.stringify([{ bank_account_id: checking.id, provider_account_id: "acct-two", account_name: "Checking", currency_code: base.code }]),
        ],
      );
      const [{ run: run2 }] = await q<{ run: string }>("select acc_begin_bank_feed_sync($1) as run", [again]);
      const [{ out: third }] = await q<{ out: Record<string, number> }>(
        "select acc_apply_bank_feed_page($1, $2, $3::jsonb, '[]'::jsonb, '[]'::jsonb) as out",
        [
          again,
          run2,
          JSON.stringify([
            feed("two-new", "acct-two", "2026-10-02", -999, "Example Bookstore"),
            feed("two-cafe", "acct-two", "2026-09-11", -1200, "Example Cafe"),
            feed("two-store", "acct-two", "2026-09-04", -45600, "Example Store"),
          ]),
        ],
      );
      // No start date this time: the 09/04 store charge is caught as already here instead.
      expect(third).toMatchObject({ added: 0, skipped_before_start: 0, skipped_already_here: 3 });
    } finally {
      clearTimeout(killer);
      await client.query("rollback").catch(() => undefined);
      await client.end();
    }
  }, 9 * 60_000);
});
