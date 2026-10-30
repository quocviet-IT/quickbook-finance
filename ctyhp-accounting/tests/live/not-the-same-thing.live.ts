/**
 * 2.79: "Not the same thing, add it" on Review import (migration 0177).
 *
 * In a throwaway company built from this tree inside ONE transaction that is
 * always rolled back; nothing survives. A statement brings in four charges of
 * the same kind. One is categorised first, and the matcher's suggestions for
 * the others point at its entry: the sharpest case, because Undo on a line
 * added anew must void that line's own entry and never the one it was
 * wrongly matched to.
 *
 *  1. A line with a suggested match still cannot be categorised directly.
 *  2. A match from another line, a viewer, and an accountant without
 *     banking.match are refused, and change nothing.
 *  3. Posted as not the same thing: every match on offer for the line is turned
 *     down (each in the audit log), and the line is posted as its own entry.
 *     Sent again, it is refused as already decided.
 *  4. A line whose only match was turned down on Banking can be categorised.
 *  5. Undo voids the line's own entry; the entry it was matched to stays.
 *
 * Run: node --env-file=.env.local ./node_modules/vitest/vitest.mjs run --config vitest.live.config.ts
 *        tests/live/not-the-same-thing.live.ts
 */
import { randomBytes } from "node:crypto";
import pg from "pg";
import { describe, expect, it, vi } from "vitest";
import { pgSupabase } from "./support/pg-supabase";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { loadMigrationSources } from "@/lib/db/migration-sources";
import type { StatementLine } from "@/lib/domain/statement-import";
import {
  categoriseBankTransaction,
  createBankAccount,
  importStatement,
  rejectReconciliation,
  uncategoriseBankTransaction,
} from "@/lib/services/banking";
import { provisionCompany } from "@/lib/services/company-provisioning";
import { postReviewItems } from "@/lib/services/statement-review";

const line = (txn_date: string, amount_minor: number, description: string): StatementLine => ({
  txn_date,
  description,
  reference: null,
  amount_minor,
  running_balance_minor: null,
  raw_line: `${txn_date},${description},${amount_minor}`,
});

describe("a line proposed as already in the books that is not the same thing", () => {
  it("is posted as its own entry, and the match is turned down", async () => {
    const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 30_000 });
    const killer = setTimeout(() => {
      console.error("not-the-same-thing: hard timeout");
      process.exit(2);
    }, 8 * 60_000);
    await client.connect();
    const q = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows as T[];
    const attempt = async (sql: string, params: unknown[] = []) => {
      await client.query("savepoint attempt");
      try {
        const rows = (await client.query(sql, params)).rows;
        await client.query("release savepoint attempt");
        return { error: null as string | null, rows };
      } catch (err) {
        await client.query("rollback to savepoint attempt");
        return { error: (err as Error).message, rows: [] };
      }
    };
    const as = async (userId: string) => {
      await client.query("reset role");
      await client.query("set local role authenticated");
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
    };
    try {
      await client.query("begin");
      await client.query("set local lock_timeout = '10s'");
      await client.query("set local statement_timeout = '120s'");
      const [admin] = await q<{ id: string }>("select id from public.acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1");
      if (!admin) throw new Error("no active administrator to sign in as");
      const others = await q<{ id: string }>("select id from auth.users where id <> $1 and email is not null order by created_at limit 2", [admin.id]);
      expect(others).toHaveLength(2);
      const [accountant, viewer] = others;
      const { schema } = await provisionCompany(
        client,
        { slug: `notsame_${randomBytes(4).toString("hex")}`, legalName: "Not the same check", isSample: true, displayOrder: 9999, adminUserIds: [admin.id] },
        loadMigrationSources(process.cwd()),
      );
      await client.query(`set local search_path = ${schema}, extensions`);
      await client.query(
        "insert into acc_app_user (id, full_name, role, status) values ($1, 'Example Accountant', 'accountant', 'active'), ($2, 'Example Viewer', 'viewer', 'active')",
        [accountant.id, viewer.id],
      );
      const [base] = await q<{ code: string }>("select code from acc_currency where is_base limit 1");
      const [checkingGl] = await q<{ id: string }>(
        "insert into acc_account (account_code, name, account_type, detail_type) values ('1099', 'Example Checking', 'bank', 'checking') returning id",
      );
      const [expense] = await q<{ id: string }>(
        `select id from acc_account where account_type = 'expense' and status = 'active' and is_posting_account
            and coalesce(detail_type, '') not in ('uncategorized_income', 'uncategorized_expense')
          order by account_code limit 1`,
      );
      const [holdingOut] = await q<{ id: string }>(
        "select id from acc_account where detail_type = 'uncategorized_expense' and status = 'active' order by account_code limit 1",
      );
      const addTo = holdingOut?.id ?? expense.id;
      await as(admin.id);
      expect((await attempt("select acc_generate_periods(2026)")).error).toBeNull();
      const sb = pgSupabase(client);

      const checking = await createBankAccount(sb, { account_id: checkingGl.id, bank_name: "Example Bank", currency_code: base.code, detail_type: "checking" });
      const imported = await importStatement(
        sb,
        checking.id,
        "checking-sep.csv",
        [
          line("2026-09-03", -12500, "EXAMPLE SUPPLIER D"),
          line("2026-09-10", -12500, "EXAMPLE SUPPLIER A"),
          line("2026-09-17", -12500, "EXAMPLE SUPPLIER B"),
          line("2026-09-20", -12500, "EXAMPLE SUPPLIER C"),
        ],
        { opening_minor: 0, closing_minor: -50000, opening_basis: "printed", closing_basis: "printed", set_aside: 0, override: null },
      );
      expect(imported.batchId).toBeTruthy();
      const ids = Object.fromEntries(
        (await q<{ id: string; description: string }>("select id, description from acc_bank_transaction where bank_account_id = $1", [checking.id])).map((r) => [
          r.description.slice(-1),
          r.id,
        ]),
      ) as Record<"A" | "B" | "C" | "D", string>;

      // D is categorised first; the matcher's suggestions for A, B and C point at its entry.
      const posted = await categoriseBankTransaction(sb, ids.D, expense.id);
      const [entryD] = await q<{ id: string; bank_line: string; other_line: string }>(
        `select e.id,
                (select id from acc_journal_line where journal_entry_id = e.id and account_id = $2) as bank_line,
                (select id from acc_journal_line where journal_entry_id = e.id and account_id <> $2) as other_line
           from acc_journal_entry e where e.entry_number = $1`,
        [posted.entry_number, checkingGl.id],
      );
      const suggest = (bank_transaction_id: string, journal_line_id: string, confidence: number) => ({
        bank_transaction_id,
        journal_line_id,
        rule_applied: "amount_date",
        confidence,
      });
      await q("select acc_upsert_bank_match_suggestions($1::jsonb)", [
        JSON.stringify([
          suggest(ids.A, entryD.bank_line, 0.95),
          suggest(ids.A, entryD.other_line, 0.6),
          suggest(ids.B, entryD.bank_line, 0.9),
          suggest(ids.C, entryD.bank_line, 0.5),
        ]),
      ]);
      const matchOf = async (txn: string, journalLine: string) =>
        (await q<{ id: string }>("select id from acc_reconciliation where bank_transaction_id = $1 and journal_line_id = $2", [txn, journalLine]))[0].id;
      const matchA = await matchOf(ids.A, entryD.bank_line);
      const matchB = await matchOf(ids.B, entryD.bank_line);
      const matchC = await matchOf(ids.C, entryD.bank_line);

      // 1. A suggested match still blocks categorising the line directly.
      expect((await attempt("select acc_categorise_bank_transaction($1, $2)", [ids.A, addTo])).error).toMatch(/already matched to the ledger/);

      // 2. Refusals that change nothing.
      const instead = "select acc_categorise_instead_of_match($1, $2, $3) as out";
      expect((await attempt(instead, [ids.A, matchB, addTo])).error).toMatch(/not on this line/);
      await as(viewer.id);
      expect((await attempt(instead, [ids.C, matchC, addTo])).error).toMatch(/Not authorized to categorise/);
      await client.query("reset role");
      await client.query("update acc_role_permission set allowed = false where role = 'accountant' and permission_key = 'banking.match'");
      await as(accountant.id);
      expect((await attempt(instead, [ids.C, matchC, addTo])).error).toMatch(/permission to review bank matches/);
      await client.query("reset role");
      const [stateC] = await q<{ status: string; offer: string }>(
        "select t.status::text as status, (select status::text from acc_reconciliation where id = $2) as offer from acc_bank_transaction t where t.id = $1",
        [ids.C, matchC],
      );
      expect(stateC).toEqual({ status: "unmatched", offer: "suggested" });
      await as(admin.id);

      // 3. Not the same thing: both of A's matches turned down, A posted as its own entry.
      const outcomes = await postReviewItems(sb, [{ transactionId: ids.A, kind: "account", accountId: addTo, instead: matchA }]);
      expect(outcomes).toEqual([{ id: ids.A, ok: true, detail: expect.stringMatching(/\S/) }]);
      const entryA = outcomes[0].detail as string;
      expect(entryA).not.toBe(posted.entry_number);
      const rowsA = await q<{ status: string; entry: string | null }>(
        `select r.status::text as status, e.entry_number as entry
           from acc_reconciliation r
           left join acc_journal_line l on l.id = r.journal_line_id
           left join acc_journal_entry e on e.id = l.journal_entry_id
          where r.bank_transaction_id = $1 order by r.status, r.confidence`,
        [ids.A],
      );
      expect(rowsA).toEqual([
        { status: "approved", entry: entryA },
        { status: "rejected", entry: posted.entry_number },
        { status: "rejected", entry: posted.entry_number },
      ]);
      expect((await q<{ status: string }>("select status::text as status from acc_bank_transaction where id = $1", [ids.A]))[0].status).toBe("matched");
      const [{ n: refusals }] = await q<{ n: number }>(
        `select count(*)::int as n from acc_audit_log
          where table_name = 'acc_reconciliation' and after_json ->> 'status' = 'rejected'
            and after_json ->> 'bank_transaction_id' = $1 and actor_id = $2`,
        [ids.A, admin.id],
      );
      expect(refusals).toBe(2);
      expect((await attempt(instead, [ids.A, matchA, addTo])).error).toMatch(/already decided/);

      // 4. A match turned down on Banking no longer blocks categorising the line.
      await rejectReconciliation(sb, matchB);
      const postedB = await categoriseBankTransaction(sb, ids.B, expense.id);
      expect(postedB.entry_number).toBeTruthy();

      // 5. Undo on A voids A's own entry; D's entry, and D, stay as they were.
      expect(await uncategoriseBankTransaction(sb, ids.A, "Checked against the statement")).toBe(1);
      const entries = await q<{ entry_number: string; status: string }>(
        "select entry_number, status::text as status from acc_journal_entry where entry_number = any($1::text[]) order by entry_number",
        [[posted.entry_number, entryA]],
      );
      expect(Object.fromEntries(entries.map((e) => [e.entry_number, e.status]))).toEqual({ [posted.entry_number as string]: "posted", [entryA]: "void" });
      const lineStatus = async (id: string) => (await q<{ status: string }>("select status::text as status from acc_bank_transaction where id = $1", [id]))[0].status;
      expect(await lineStatus(ids.A)).toBe("unmatched");
      expect(await lineStatus(ids.D)).toBe("matched");
    } finally {
      clearTimeout(killer);
      await client.query("rollback").catch(() => undefined);
      await client.end();
    }
  }, 9 * 60_000);
});
