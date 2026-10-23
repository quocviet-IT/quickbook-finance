/**
 * 2.45, from a bookkeeper's request: "add credit card under bank
 * reconciliation and bank transactions, I also need to add the transactions
 * from credit cards."
 *
 * A credit card, end to end, on the real database, in a throwaway company
 * built inside ONE transaction that is always rolled back — nothing survives.
 * The company is provisioned from the migrations in this tree, 0159 included.
 * OneBook's own services and actions do every step; only the session is stood
 * in for (the first active administrator, through the JWT claims PostgREST
 * sets) and the screen's refresh.
 *
 *  1. A card ledger account takes a bank account record; an expense account
 *     still does not.
 *  2. The checking account pays the card, and that line is coded to the card.
 *  3. The card's CSV comes in through the import dialog's own steps, its
 *     balances typed as the statement prints them (owed, positive); the
 *     server proves it the books' way round.
 *  4. Its two charges are coded; its payment line is matched to the entry the
 *     checking account already posted — no second entry.
 *  5. The card is reconciled to its balance owed: the difference is zero, and
 *     the report proves out, worded for a card.
 *  6. Card purchases teach the coding suggestions; the transfer does not.
 *  7. The card is never "below zero"; the checking account still is.
 *
 * Run: node --env-file=.env.local ./node_modules/vitest/vitest.mjs run --config vitest.live.config.ts
 *        tests/live/credit-card-bank-account.live.ts
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

import { reconciliationReportAction } from "@/app/(app)/banking/reconcile/[id]/report/actions";
import { loadMigrationSources } from "@/lib/db/migration-sources";
import { cardDetail, cardStatementLines, stored, storedProof } from "@/lib/domain/card-account";
import { buildReconciliationReport } from "@/lib/domain/reconciliation-report";
import { NO_MARKS, confirmStatement, statementDialogView } from "@/lib/domain/statement-import-dialog";
import type { StatementLine } from "@/lib/domain/statement-import";
import {
  approveReconciliation,
  categoriseBankTransaction,
  createBankAccount,
  generateSuggestions,
  importStatement,
} from "@/lib/services/banking";
import {
  completeReconciliation,
  createReconciliation,
  getReconciliationDetail,
  getReconciliationLines,
  setClearedMany,
} from "@/lib/services/bankrec";
import { provisionCompany } from "@/lib/services/company-provisioning";
import { getBelowZeroBankAccounts } from "@/lib/services/statement-alerts";

const line = (txn_date: string, amount_minor: number, description: string): StatementLine => ({
  txn_date,
  description,
  reference: null,
  amount_minor,
  running_balance_minor: null,
  raw_line: `${txn_date},${description},${amount_minor}`,
});
const money = (minor: number) => `${minor < 0 ? "-" : ""}$${(Math.abs(minor) / 100).toFixed(2)}`;

describe("a credit card in Bank Transactions and Bank Reconciliation", () => {
  it("is set up, imported, coded, matched and reconciled to its balance owed", async () => {
    const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 30_000 });
    const killer = setTimeout(() => {
      console.error("credit-card-bank-account: hard timeout");
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
        { slug: `card_${randomBytes(4).toString("hex")}`, legalName: "Card check", isSample: true, displayOrder: 9999, adminUserIds: [admin.id] },
        loadMigrationSources(process.cwd()),
      );
      await client.query(`set local search_path = ${schema}, extensions`);
      const [base] = await q<{ code: string }>("select code from acc_currency where is_base limit 1");
      const [checkingGl] = await q<{ id: string }>(
        "insert into acc_account (account_code, name, account_type, detail_type) values ('1099', 'Example Checking', 'bank', 'checking') returning id",
      );
      const [cardGl] = await q<{ id: string }>(
        "insert into acc_account (account_code, name, account_type) values ('2099', 'Example Credit Card', 'credit_card') returning id",
      );
      const [expense] = await q<{ id: string }>(
        "select id from acc_account where account_type = 'expense' and status = 'active' and is_posting_account order by account_code limit 1",
      );

      await client.query("set local role authenticated");
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: admin.id, role: "authenticated" })]);
      const sb = pgSupabase(client);
      session.sb = sb;

      // 1. The card takes a bank account record; an expense account does not.
      const checking = await createBankAccount(sb, { account_id: checkingGl.id, bank_name: "Example Bank", currency_code: base.code, detail_type: "checking" });
      const card = await createBankAccount(sb, {
        account_id: cardGl.id,
        bank_name: "Example Card Issuer",
        account_number_masked: "****0000",
        currency_code: base.code,
        detail_type: "credit_card",
      });
      const [cardLedger] = await q<{ detail_type: string | null }>("select detail_type from acc_account where id = $1", [cardGl.id]);
      expect(cardLedger.detail_type).toBeNull();
      await client.query("savepoint refused");
      await expect(createBankAccount(sb, { account_id: expense.id, bank_name: "Not a bank", currency_code: base.code })).rejects.toThrow(
        /Bank-type or Credit Card/,
      );
      await client.query("rollback to savepoint refused");

      // 2. The checking account pays the card; that line is coded to the card.
      const pay = [line("2026-09-14", -50000, "PAYMENT TO EXAMPLE CARD 0000")];
      await importStatement(sb, checking.id, "checking-sep.csv", pay, {
        opening_minor: 1000000,
        closing_minor: 950000,
        opening_basis: "printed",
        closing_basis: "printed",
        set_aside: 0,
        override: null,
      });
      const [checkingLine] = await q<{ id: string }>("select id from acc_bank_transaction where bank_account_id = $1", [checking.id]);
      await categoriseBankTransaction(sb, checkingLine.id, cardGl.id);

      // 3. The card's CSV, as Chase exports it, through the import dialog's own steps:
      //    previous balance 0.00 and new balance 76.00 typed as the statement prints them.
      const cardLines = [line("2026-09-04", -45600, "EXAMPLE STORE"), line("2026-09-10", -12000, "EXAMPLE CAFE"), line("2026-09-15", 50000, "PAYMENT THANK YOU")];
      const marks = { ...NO_MARKS, typedOpeningMinor: 0, typedClosingMinor: 7600 };
      const view = statementDialogView(
        { purpose: "import", kind: "csv", lines: cardStatementLines(cardLines, "card"), prior: null, marks, check: { present: [], otherSource: [] }, canOverride: false },
        money,
      );
      expect(view.proof.proves).toBe(true);
      const confirmed = confirmStatement(cardLines, marks, view, null);
      const imported = await importStatement(sb, card.id, "card-sep.csv", confirmed.rows, storedProof(confirmed.proof, "card"));
      expect(imported.inserted).toBe(3);

      // 4. The charges are coded; the payment line is matched to the checking account's entry.
      const cardBankLines = await q<{ id: string; amount_minor: number }>(
        "select id, amount_minor from acc_bank_transaction where bank_account_id = $1 order by txn_date",
        [card.id],
      );
      for (const charge of cardBankLines.filter((l) => Number(l.amount_minor) < 0)) await categoriseBankTransaction(sb, charge.id, expense.id);
      const entriesBefore = await q<{ n: number }>("select count(*)::int as n from acc_journal_entry where status = 'posted'");
      expect(await generateSuggestions(sb, card.id)).toBeGreaterThan(0);
      const paymentLine = cardBankLines.find((l) => Number(l.amount_minor) > 0)!;
      const [suggestion] = await q<{ id: string; journal_line_id: string }>(
        "select id, journal_line_id from acc_reconciliation where bank_transaction_id = $1 and status = 'suggested'",
        [paymentLine.id],
      );
      const [cardSideOfPayment] = await q<{ id: string }>(
        `select l.id from acc_journal_line l join acc_reconciliation r on r.journal_line_id <> l.id
          where l.account_id = $1 and l.debit_minor = 50000 and r.bank_transaction_id = $2 limit 1`,
        [cardGl.id, checkingLine.id],
      );
      expect(suggestion.journal_line_id).toBe(cardSideOfPayment.id);
      await approveReconciliation(sb, suggestion.id);
      const entriesAfter = await q<{ n: number }>("select count(*)::int as n from acc_journal_entry where status = 'posted'");
      expect(entriesAfter[0].n).toBe(entriesBefore[0].n);
      const [paid] = await q<{ status: string }>("select status from acc_bank_transaction where id = $1", [paymentLine.id]);
      expect(paid.status).toBe("matched");

      // 5. Reconciled to the balance owed typed as printed: 76.00.
      const recId = await createReconciliation(sb, {
        bank_account_id: card.id,
        statement_ending_date: "2026-09-30",
        statement_ending_balance_minor: stored(7600, "card"),
      });
      const book = await getReconciliationLines(sb, recId);
      expect(book.map((l) => l.signedMinor).sort((a, b) => a - b)).toEqual([-45600, -12000, 50000]);
      await setClearedMany(sb, recId, book.map((l) => l.journalLineId), true);
      const detail = await getReconciliationDetail(sb, recId);
      expect(detail.differenceMinor).toBe(0);
      expect(cardDetail(detail, "card")).toMatchObject({ beginningMinor: 0, statementEndingMinor: 7600, differenceMinor: 0 });
      await completeReconciliation(sb, recId);
      const report = await reconciliationReportAction(recId, { kind: "none" } as never);
      if (!report.ok || !report.data) throw new Error(report.ok ? "no report" : report.error);
      expect(report.data.side).toBe("card");
      expect(report.data.statementEndingMinor).toBe(7600);
      const built = buildReconciliationReport(report.data);
      expect(built.provesOut).toBe(true);
      expect(built.sections[0].title).toBe("Cleared charges");

      // 6. Card purchases teach the coding suggestions; the transfer from checking does not.
      const taught = await q<{ entry_id: string; direction: string; account_id: string }>("select * from acc_coding_history()");
      expect(taught.filter((r) => r.account_id === expense.id && r.direction === "out")).toHaveLength(2);
      expect(taught.some((r) => r.account_id === cardGl.id || r.account_id === checkingGl.id)).toBe(false);

      // 7. The card owes, so it is never "below zero"; the overdrawn checking account still is.
      const below = await getBelowZeroBankAccounts(sb, "2026-09-30");
      expect(below.map((b) => b.bankAccountId)).toEqual([checking.id]);
      console.log("card reconciled to 76.00 owed; 3 lines, 2 coded, 1 matched to the checking entry; report proves out");
    } finally {
      await client.query("rollback").catch(() => undefined);
      await client.end();
      clearTimeout(killer);
    }
  });
});
