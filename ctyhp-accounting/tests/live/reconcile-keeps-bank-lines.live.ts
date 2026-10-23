/**
 * 2.44, from a bookkeeper's report: a month's lines came in from a CSV export
 * and were coded one by one; reconciling the month's PDF statement from
 * statement files then imported every PDF line again — worded the bank's other
 * way, so no line met its key — and they were coded a second time.
 *
 * This runs the very server action a run signs a month with
 * (reconcileRunMonthAction) and OneBook's own import and coding services, on
 * the real database, in a throwaway company built inside ONE transaction that
 * is always rolled back: nothing survives. Only the session is stood in for —
 * the signed-in user is the first active administrator, through the same JWT
 * claims PostgREST sets — and the screen's refresh.
 *
 * It records the books before reconciling and checks them after: the same bank
 * lines, the same statement imports, the same entries line for line; no line
 * coded again; the month completed. Then a month whose statement holds a fee
 * nobody recorded: that line alone goes into Bank Transactions, nothing is
 * posted, and the month waits for a person.
 *
 * Run (--silent=false prints the counts):
 *   node --env-file=.env.local ./node_modules/vitest/vitest.mjs run --config vitest.live.config.ts
 *     --silent=false tests/live/reconcile-keeps-bank-lines.live.ts
 */
import { randomBytes } from "node:crypto";
import pg from "pg";
import { describe, expect, it, vi } from "vitest";
import { pgSupabase } from "./support/pg-supabase";

const session = vi.hoisted(() => ({ sb: null as unknown }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth", async () => ({
  getUserRole: async () => "admin",
  canWrite: () => true,
  isAdmin: (await import("@/lib/domain/roles")).isAdmin,
  getSessionUser: async () => null,
}));
vi.mock("@/lib/db/server", () => ({ createSupabaseServerClient: async () => session.sb }));
// Only "is the month over yet?" reads the company's clock here.
vi.mock("@/lib/services/banking-surface/facts", () => ({ getBankingContext: async () => ({ asOf: "2026-10-23" }) }));

import { reconcileRunMonthAction } from "@/app/(app)/banking/reconcile/statement-actions";
import { loadMigrationSources } from "@/lib/db/migration-sources";
import { categoriseBankTransaction, importStatement, type ImportRow } from "@/lib/services/banking";
import { provisionCompany } from "@/lib/services/company-provisioning";

const row = (txn_date: string, amount_minor: number, description: string): ImportRow => ({
  txn_date,
  description,
  reference: null,
  amount_minor,
  running_balance_minor: null,
  raw_line: `${txn_date} ${description} ${amount_minor}`,
});
const proof = (openingMinor: number, rows: readonly ImportRow[]) => ({
  opening_minor: openingMinor,
  closing_minor: openingMinor + rows.reduce((sum, r) => sum + r.amount_minor, 0),
  opening_basis: "printed" as const,
  closing_basis: "printed" as const,
  set_aside: 0,
  override: null,
});

// August and September as the CSV export words them (invented names) …
const AUG_CSV = [
  row("2026-08-04", 125000, "ZELLE FROM EXAMPLE CUSTOMER A ON 08/04"),
  row("2026-08-12", 480000, "ZELLE FROM EXAMPLE CUSTOMER B ON 08/12"),
  row("2026-08-20", -45000, "ONLINE PAYMENT TO EXAMPLE SUPPLIER"),
  row("2026-08-27", 30000, "REMOTE ONLINE DEPOSIT 1"),
];
const SEP_CSV = [row("2026-09-03", 80000, "ZELLE FROM EXAMPLE CUSTOMER C ON 09/03"), row("2026-09-18", -12500, "CARD PURCHASE EXAMPLE SHOP")];
// … and as the bank's PDF statement words the same money.
const AUG_PDF = [
  row("2026-08-04", 125000, "Zelle Payment From Example Customer A 10000000001"),
  row("2026-08-12", 480000, "Zelle Payment From Example Customer B 10000000002"),
  row("2026-08-20", -45000, "Online Payment 1234567 To Example Supplier"),
  row("2026-08-27", 30000, "Remote Online Deposit 1"),
];
const SEP_FEE = row("2026-09-30", -1500, "Monthly Service Fee");
const SEP_PDF = [row("2026-09-03", 80000, "Zelle Payment From Example Customer C 10000000003"), row("2026-09-18", -12500, "Card Purchase 09/17 Example Shop"), SEP_FEE];

describe("reconciling from statement files keeps the books as they were", () => {
  it("imports and codes no line Bank Transactions already holds, and posts nothing", async () => {
    const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 30_000 });
    const killer = setTimeout(() => {
      console.error("reconcile-keeps-bank-lines: hard timeout");
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
      const slug = `recon_${randomBytes(4).toString("hex")}`;
      const { schema } = await provisionCompany(
        client,
        { slug, legalName: "Reconcile check", isSample: true, displayOrder: 9999, adminUserIds: [admin.id] },
        loadMigrationSources(process.cwd()),
      );
      await client.query(`set local search_path = ${schema}, extensions`);

      // A bank account of its own, and the account its money is coded to.
      const [base] = await q<{ code: string }>("select code from acc_currency where is_base limit 1");
      const [gl] = await q<{ id: string }>(
        "insert into acc_account (account_code, name, account_type) values ('1099', 'Statement Check Bank', 'bank') returning id",
      );
      const [bank] = await q<{ id: string }>(
        "insert into acc_bank_account (account_id, bank_name, account_number_masked, currency_code) values ($1, 'Example Bank', '****4321', $2) returning id",
        [gl.id, base.code],
      );
      const [income] = await q<{ id: string }>(
        "select id from acc_account where account_type = 'income' and status = 'active' order by account_code limit 1",
      );

      // From here on, the administrator — as a signed-in session reaches the database.
      await client.query("set local role authenticated");
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: admin.id, role: "authenticated" })]);
      const sb = pgSupabase(client);
      session.sb = sb;

      // The CSV export, imported as Import statement imports it, coded line by line —
      // all but the deposit of 08/27, entered by hand in the journal instead.
      await importStatement(sb, bank.id, "Activity_20261021.csv", [...AUG_CSV, ...SEP_CSV], proof(0, [...AUG_CSV, ...SEP_CSV]));
      const csvLines = await q<{ id: string; txn_date: string }>(
        "select id, txn_date from acc_bank_transaction where bank_account_id = $1 order by txn_date",
        [bank.id],
      );
      for (const line of csvLines.filter((l) => l.txn_date !== "2026-08-27")) await categoriseBankTransaction(sb, line.id, income.id);
      await q("select acc_post_manual_journal('2026-08-27', 'Deposit entered by hand', null, $1, $2::jsonb)", [
        base.code,
        JSON.stringify([
          { account_id: gl.id, debit_minor: 30000, credit_minor: 0, memo: null },
          { account_id: income.id, debit_minor: 0, credit_minor: 30000, memo: null },
        ]),
      ]);

      const books = async () => ({
        bankLines: await q(
          "select id, txn_date, amount_minor, description, import_batch_id, status from acc_bank_transaction where bank_account_id = $1 order by id",
          [bank.id],
        ),
        imports: await q("select id, filename, status from acc_bank_import_batch where bank_account_id = $1 order by id", [bank.id]),
        entries: await q(
          `select e.id, e.entry_number, e.entry_date, e.status, e.source_type, l.account_id, l.debit_minor, l.credit_minor
             from acc_journal_entry e join acc_journal_line l on l.journal_entry_id = e.id order by e.id, l.id`,
        ),
        matches: await q("select bank_transaction_id, journal_line_id, status from acc_reconciliation order by bank_transaction_id, journal_line_id"),
      });

      // August: every PDF line is already in Bank Transactions, worded the CSV's way.
      const before = await books();
      const august = await reconcileRunMonthAction({
        kind: "month",
        bank_account_id: bank.id,
        file_name: "20260831-statements-4321-.pdf",
        statement_date: "2026-08-31",
        lines: AUG_PDF,
        proof: proof(0, AUG_PDF),
        statement_file_id: null,
        sign: true,
      });
      const after = await books();
      console.log("August:", JSON.stringify(august.data ?? august.error));
      expect(august).toMatchObject({
        ok: true,
        data: { signed: true, differenceMinor: 0, lines: { added: 0, alreadyHere: 4 }, matched: { matched: 1, already: 3, elsewhere: 0 } },
      });
      expect(after.imports).toEqual(before.imports);
      expect(after.entries).toEqual(before.entries);
      // The one change: the CSV line of the deposit entered by hand is matched to that entry, so nobody codes it.
      const handDeposit = csvLines.find((l) => l.txn_date === "2026-08-27")!.id;
      expect(after.bankLines).toEqual(before.bankLines.map((l) => (l.id === handDeposit ? { ...l, status: "matched" } : l)));
      expect(after.matches.filter((m) => !before.matches.some((b) => b.bank_transaction_id === m.bank_transaction_id))).toEqual([
        expect.objectContaining({ bank_transaction_id: handDeposit, status: "approved" }),
      ]);
      const [rec] = await q<{ status: string; cleared: number }>(
        `select r.status, (select count(*) from acc_reconciliation_line l where l.reconciliation_id = r.id) as cleared
           from acc_statement_reconciliation r where r.id = $1`,
        [august.data!.id],
      );
      expect(rec).toEqual({ status: "completed", cleared: 4 });

      // September: the statement holds a fee nobody recorded. It alone goes into Bank Transactions.
      const beforeSep = await books();
      const september = await reconcileRunMonthAction({
        kind: "month",
        bank_account_id: bank.id,
        file_name: "20260930-statements-4321-.pdf",
        statement_date: "2026-09-30",
        lines: SEP_PDF,
        proof: proof(proof(0, AUG_PDF).closing_minor, SEP_PDF),
        statement_file_id: null,
        sign: true,
      });
      const afterSep = await books();
      console.log("September:", JSON.stringify(september.data ?? september.error));
      expect(september).toMatchObject({ ok: true, data: { signed: false, differenceMinor: -1500, lines: { added: 1, alreadyHere: 2 }, matched: null } });
      expect(afterSep.entries).toEqual(beforeSep.entries);
      const added = afterSep.bankLines.filter((l) => !beforeSep.bankLines.some((b) => b.id === l.id));
      expect(added).toEqual([expect.objectContaining({ txn_date: "2026-09-30", amount_minor: -1500, description: "Monthly Service Fee", status: "unmatched" })]);
      expect(afterSep.bankLines.filter((l) => l.id !== added[0].id)).toEqual(beforeSep.bankLines);
      expect(afterSep.imports).toHaveLength(beforeSep.imports.length + 1);
      console.log(
        `kept: ${before.bankLines.length} bank lines, ${new Set(before.entries.map((e) => e.id)).size} entries; ` +
          `after both months: ${afterSep.bankLines.length} bank lines, ${new Set(afterSep.entries.map((e) => e.id)).size} entries`,
      );
    } finally {
      await client.query("rollback").catch(() => undefined);
      await client.end();
      clearTimeout(killer);
    }
  });
});
