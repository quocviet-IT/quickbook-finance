/**
 * 2.46: a credit card reconciled from its PDF statements, on their balances.
 *
 * On the real database, in a throwaway company built from this tree's
 * migrations inside ONE transaction that is always rolled back. A card's CSV
 * is imported and coded through OneBook's own services; then two months of
 * PDF statements — printed here with invented figures, in the summary layout a
 * card issuer publishes — are read by the card summary reader, previewed by
 * previewRunAction and signed by reconcileRunMonthAction, the actions
 * Reconcile from statement files calls. Only the session and the company's
 * clock are stood in for.
 *
 * Run: node --env-file=.env.local ./node_modules/vitest/vitest.mjs run --config vitest.live.config.ts
 *        tests/live/card-statement-run.live.ts
 */
import { randomBytes } from "node:crypto";
import { jsPDF } from "jspdf";
import pg from "pg";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
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
vi.mock("@/lib/services/banking-surface/facts", () => ({ getBankingContext: async () => ({ asOf: "2026-10-23" }) }));

import { previewRunAction, reconcileRunMonthAction } from "@/app/(app)/banking/reconcile/statement-actions";
import { loadMigrationSources } from "@/lib/db/migration-sources";
import { readCardStatementSummary } from "@/lib/domain/card-statement-pdf";
import { glyphsFromDocument } from "@/lib/domain/pdf-glyphs";
import { rowsFromGlyphs } from "@/lib/domain/pdf-statement";
import { cardRunStatement, checkRun, type RunStatement } from "@/lib/domain/statement-run";
import { categoriseBankTransaction, createBankAccount, importStatement, type ImportRow } from "@/lib/services/banking";
import { provisionCompany } from "@/lib/services/company-provisioning";

const money = (minor: number) => `${minor < 0 ? "-" : ""}$${(Math.abs(minor) / 100).toFixed(2)}`;
const usd = (minor: number) => `$${(Math.abs(minor) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

/** Page one of an invented card statement, in the summary layout card issuers publish. */
async function cardStatementPdf(s: {
  previous: number; credits: number; purchases: number; fees: number; next: number; opening: string; closing: string;
}): Promise<RunStatement> {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  doc.setFontSize(9);
  const rows: [string, string, string?][] = [
    ["ACCOUNT SUMMARY", ""],
    ["Account Number: XXXX XXXX XXXX 0000", ""],
    ["Previous Balance", usd(s.previous)],
    ["Payment, Credits", usd(s.credits), "-"],
    ["Purchases", usd(s.purchases), "+"],
    ["Cash Advances", "$0.00"],
    ["Balance Transfers", "$0.00"],
    ["Fees Charged", usd(s.fees)],
    ["Interest Charged", "$0.00"],
    ["New Balance", usd(s.next)],
    ["Opening/Closing Date", `${s.opening} - ${s.closing}`],
    ["Credit Limit", "$5,000.00"],
  ];
  rows.forEach(([label, figure, sign], i) => {
    doc.text(label, 40, 80 + i * 14);
    if (sign) doc.text(sign, 220, 80 + i * 14);
    if (figure) doc.text(figure, 235, 80 + i * 14);
  });
  const task = getDocument({ data: new Uint8Array(doc.output("arraybuffer")), verbosity: 0 });
  try {
    const summary = readCardStatementSummary(rowsFromGlyphs(await glyphsFromDocument(await task.promise)));
    if (!summary) throw new Error("the printed statement was not read as a card statement");
    return cardRunStatement(`card-${s.closing.replace(/\//g, "")}.pdf`, summary, "****0000", money);
  } finally {
    await task.destroy();
  }
}

const row = (txn_date: string, amount_minor: number, description: string): ImportRow => ({
  txn_date, description, reference: null, amount_minor, running_balance_minor: null, raw_line: `${txn_date},${description},${amount_minor}`,
});

describe("a credit card reconciled from its PDF statements", () => {
  it("signs each month whose books come to its new balance, and stops at one that does not", async () => {
    const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 30_000 });
    const killer = setTimeout(() => {
      console.error("card-statement-run: hard timeout");
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
        { slug: `cardrun_${randomBytes(4).toString("hex")}`, legalName: "Card run check", isSample: true, displayOrder: 9999, adminUserIds: [admin.id] },
        loadMigrationSources(process.cwd()),
      );
      await client.query(`set local search_path = ${schema}, extensions`);
      const [base] = await q<{ code: string }>("select code from acc_currency where is_base limit 1");
      const [cardGl] = await q<{ id: string }>("insert into acc_account (account_code, name, account_type) values ('2099', 'Example Card', 'credit_card') returning id");
      const [expense] = await q<{ id: string }>(
        "select id from acc_account where account_type = 'expense' and status = 'active' and is_posting_account order by account_code limit 1",
      );
      await client.query("set local role authenticated");
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: admin.id, role: "authenticated" })]);
      const sb = pgSupabase(client);
      session.sb = sb;

      const card = await createBankAccount(sb, { account_id: cardGl.id, bank_name: "Example Card Issuer", account_number_masked: "****0000", currency_code: base.code });
      // The card's CSV for August and September, coded line by line — September's fee is left out of the books.
      const csv = [
        row("2026-08-04", -45600, "EXAMPLE STORE"),
        row("2026-09-10", -12000, "EXAMPLE CAFE"),
        row("2026-09-15", 50000, "PAYMENT THANK YOU"),
      ];
      await importStatement(sb, card.id, "card-activity.csv", csv, {
        opening_minor: 0, closing_minor: -7600, opening_basis: "typed", closing_basis: "typed", set_aside: 0, override: null,
      });
      const lines = await q<{ id: string; amount_minor: number }>("select id, amount_minor from acc_bank_transaction where bank_account_id = $1", [card.id]);
      for (const line of lines) await categoriseBankTransaction(sb, line.id, expense.id);

      // Two PDF statements: August owes 456.00; September adds a 20.00 fee the books do not have.
      const august = await cardStatementPdf({ previous: 0, credits: 0, purchases: 45600, fees: 0, next: 45600, opening: "07/30/26", closing: "08/29/26" });
      const september = await cardStatementPdf({ previous: 45600, credits: 50000, purchases: 12000, fees: 2000, next: 9600, opening: "08/30/26", closing: "09/29/26" });
      expect([august.problem, september.problem]).toEqual([null, null]);
      const context = { lastCompleted: null, completedDates: [], inProgress: null, today: "2026-10-23" };
      const check = checkRun([august, september], context, money);
      expect(check.stops).toEqual([]);

      const preview = await previewRunAction({
        bank_account_id: card.id,
        statements: check.usable.map((s) => ({
          key: s.key, from: s.from, to: s.to, opening_minor: s.openingMinor, closing_minor: s.closingMinor, lines: [], balances_only: true,
        })),
      });
      if (!preview.ok || !preview.data) throw new Error(preview.ok ? "no preview" : preview.error);
      expect(preview.data.toSign).toBe(1);
      expect(preview.data.months.map((m) => [m.statementDate, m.beginningMinor, m.closingMinor, m.outcome])).toEqual([
        ["2026-08-29", 0, 45600, { kind: "agreesOnBalance", lines: 1 }],
        ["2026-09-29", 45600, 9600, { kind: "outBy", differenceMinor: 2000, missing: 0 }],
      ]);

      const signAugust = await reconcileRunMonthAction({
        kind: "card_month", bank_account_id: card.id, file_name: august.fileName, statement_date: "2026-08-29",
        period_from: august.from, previous_minor: 0, new_minor: 45600, statement_file_id: null, sign: true,
      });
      expect(signAugust).toMatchObject({ ok: true, data: { signed: true, differenceMinor: 0 } });
      const startSeptember = await reconcileRunMonthAction({
        kind: "card_month", bank_account_id: card.id, file_name: september.fileName, statement_date: "2026-09-29",
        period_from: september.from, previous_minor: 45600, new_minor: 9600, statement_file_id: null, sign: false,
      });
      expect(startSeptember).toMatchObject({ ok: true, data: { signed: false, differenceMinor: -2000 } });

      const recs = await q<{ statement_ending_date: string; status: string; beginning_balance_minor: number; statement_ending_balance_minor: number; statement_opening_minor: number; ticked: number }>(
        `select r.statement_ending_date::text, r.status, r.beginning_balance_minor, r.statement_ending_balance_minor, r.statement_opening_minor,
                (select count(*)::int from acc_reconciliation_line l where l.reconciliation_id = r.id) as ticked
           from acc_statement_reconciliation r where r.bank_account_id = $1 order by r.statement_ending_date`,
        [card.id],
      );
      expect(recs.map((r) => ({ ...r, beginning_balance_minor: Number(r.beginning_balance_minor), statement_ending_balance_minor: Number(r.statement_ending_balance_minor), statement_opening_minor: Number(r.statement_opening_minor) }))).toEqual([
        { statement_ending_date: "2026-08-29", status: "completed", beginning_balance_minor: 0, statement_ending_balance_minor: -45600, statement_opening_minor: 0, ticked: 1 },
        { statement_ending_date: "2026-09-29", status: "in_progress", beginning_balance_minor: -45600, statement_ending_balance_minor: -9600, statement_opening_minor: -45600, ticked: 2 },
      ]);
      // Nothing imported, coded or posted by reconciling.
      const [counts] = await q<{ bank_lines: number; entries: number }>(
        "select (select count(*)::int from acc_bank_transaction) as bank_lines, (select count(*)::int from acc_journal_entry where status = 'posted') as entries",
      );
      expect(counts).toEqual({ bank_lines: 3, entries: 3 });
    } finally {
      await client.query("rollback").catch(() => undefined);
      await client.end();
      clearTimeout(killer);
    }
  });
});
