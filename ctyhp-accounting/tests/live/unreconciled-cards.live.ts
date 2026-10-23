/**
 * 2.47: a credit card's unreconciled activity reaches the dashboard, and the
 * month-end checklist checks the card as a card.
 *
 * On the real database, in a throwaway company built inside ONE transaction
 * that is always rolled back — nothing survives. The company is provisioned
 * from the migrations in this tree, 0160 included. OneBook's own services do
 * every step; only the session is stood in for.
 *
 *  1. A checking account and a card, each with a bank account record. The
 *     card's CSV brings two charges and a payment; the charges are coded, the
 *     payment is left unmatched.
 *  2. acc_unreconciled_cards counts the card and its two posted lines, debit
 *     positive as the books keep them; acc_unreconciled_bank never sees them.
 *  3. acc_bank_close_standing gives one row per record: the card as a card,
 *     never reconciled, its payment unmatched — and nothing unmatched before
 *     the payment's date.
 *  4. Once the card is reconciled, its lines leave the dashboard figure and its
 *     latest statement date reads back; the checking account stays as it was.
 *
 * Run: node --env-file=.env.local ./node_modules/vitest/vitest.mjs run --config vitest.live.config.ts
 *        tests/live/unreconciled-cards.live.ts
 */
import { randomBytes } from "node:crypto";
import pg from "pg";
import { describe, expect, it, vi } from "vitest";
import { pgSupabase } from "./support/pg-supabase";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { loadMigrationSources } from "@/lib/db/migration-sources";
import { cardsReconciledStep } from "@/lib/domain/accounting-dashboard/close-checklist";
import { shown, stored } from "@/lib/domain/card-account";
import type { StatementLine } from "@/lib/domain/statement-import";
import { categoriseBankTransaction, createBankAccount, importStatement } from "@/lib/services/banking";
import {
  completeReconciliation,
  createReconciliation,
  getReconciliationLines,
  setClearedMany,
} from "@/lib/services/bankrec";
import { provisionCompany } from "@/lib/services/company-provisioning";

const line = (txn_date: string, amount_minor: number, description: string): StatementLine => ({
  txn_date,
  description,
  reference: null,
  amount_minor,
  running_balance_minor: null,
  raw_line: `${txn_date},${description},${amount_minor}`,
});

interface StandingRow {
  bank_account_id: string;
  account_code: string;
  account_name: string;
  is_card: boolean;
  last_completed_on: string | null;
  unmatched_count: string | number;
}

describe("a credit card's unreconciled activity", () => {
  it("reaches the dashboard figure and the card's own close step", async () => {
    const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 30_000 });
    const killer = setTimeout(() => {
      console.error("unreconciled-cards: hard timeout");
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
        { slug: `cardrec_${randomBytes(4).toString("hex")}`, legalName: "Card close check", isSample: true, displayOrder: 9999, adminUserIds: [admin.id] },
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

      // 1. A checking account and a card; two charges coded, the payment left unmatched.
      const checking = await createBankAccount(sb, { account_id: checkingGl.id, bank_name: "Example Bank", currency_code: base.code, detail_type: "checking" });
      const card = await createBankAccount(sb, {
        account_id: cardGl.id,
        bank_name: "Example Card Issuer",
        account_number_masked: "****0000",
        currency_code: base.code,
        detail_type: "credit_card",
      });
      const cardLines = [line("2026-09-04", -45600, "EXAMPLE STORE"), line("2026-09-10", -12000, "EXAMPLE CAFE"), line("2026-09-15", 50000, "PAYMENT THANK YOU")];
      await importStatement(sb, card.id, "card-sep.csv", cardLines, {
        opening_minor: 0,
        closing_minor: -7600,
        opening_basis: "printed",
        closing_basis: "printed",
        set_aside: 0,
        override: null,
      });
      const bankLines = await q<{ id: string; amount_minor: number }>(
        "select id, amount_minor from acc_bank_transaction where bank_account_id = $1 order by txn_date",
        [card.id],
      );
      expect(bankLines).toHaveLength(3);
      for (const charge of bankLines.filter((l) => Number(l.amount_minor) < 0)) await categoriseBankTransaction(sb, charge.id, expense.id);

      // 2. The dashboard figure: one card, two posted lines, owed 576.00.
      const [cards] = await q<{ card_count: string; item_count: string; amount_minor: string }>("select * from acc_unreconciled_cards('2026-09-30')");
      expect(Number(cards.card_count)).toBe(1);
      expect(Number(cards.item_count)).toBe(2);
      expect(Number(cards.amount_minor)).toBe(-57600);
      expect(shown(Number(cards.amount_minor), "card")).toBe(57600);
      const [bank] = await q<{ item_count: string }>("select * from acc_unreconciled_bank('2026-09-30')");
      expect(Number(bank.item_count)).toBe(0);
      const [early] = await q<{ item_count: string }>("select * from acc_unreconciled_cards('2026-09-05')");
      expect(Number(early.item_count)).toBe(1);

      // 3. The close standing: one row each, the card as a card.
      const standing = async (asOf: string) =>
        Object.fromEntries(
          (await q<StandingRow & Record<string, unknown>>("select * from acc_bank_close_standing($1)", [asOf])).map((r) => [r.bank_account_id, r]),
        ) as Record<string, StandingRow>;
      const atEnd = await standing("2026-09-30");
      expect(Object.keys(atEnd)).toHaveLength(2);
      expect(atEnd[checking.id]).toMatchObject({ is_card: false, last_completed_on: null });
      expect(Number(atEnd[checking.id].unmatched_count)).toBe(0);
      expect(atEnd[card.id]).toMatchObject({ is_card: true, account_code: "2099", account_name: "Example Credit Card", last_completed_on: null });
      expect(Number(atEnd[card.id].unmatched_count)).toBe(1);
      expect(Number((await standing("2026-09-14"))[card.id].unmatched_count)).toBe(0);

      // Through the sb client, as the checklist reads it.
      const viaRpc = await sb.rpc("acc_bank_close_standing", { p_as_of: "2026-09-30" });
      expect(viaRpc.error).toBeNull();
      const cardRow = (viaRpc.data as StandingRow[]).find((r) => r.is_card)!;
      const step = cardsReconciledStep({
        periodEnd: "2026-09-30",
        cards: [{ label: `${cardRow.account_code} ${cardRow.account_name}`, lastCompletedOn: cardRow.last_completed_on, unmatchedCount: Number(cardRow.unmatched_count) }],
      });
      expect(step.status).toBe("outstanding");
      expect(step.evidence).toContain("2099 Example Credit Card (never reconciled)");

      // 4. Reconciled through 09/30: the lines leave the figure, the date reads back.
      const recId = await createReconciliation(sb, {
        bank_account_id: card.id,
        statement_ending_date: "2026-09-30",
        statement_ending_balance_minor: stored(57600, "card"),
      });
      const book = await getReconciliationLines(sb, recId);
      await setClearedMany(sb, recId, book.map((l) => l.journalLineId), true);
      await completeReconciliation(sb, recId);
      const [after] = await q<{ card_count: string; item_count: string; amount_minor: string }>("select * from acc_unreconciled_cards('2026-09-30')");
      expect(Number(after.item_count)).toBe(0);
      expect(Number(after.amount_minor)).toBe(0);
      const reconciled = await standing("2026-09-30");
      expect(reconciled[card.id].last_completed_on).toBe("2026-09-30");
      expect(Number(reconciled[card.id].unmatched_count)).toBe(1);
      expect(reconciled[checking.id].last_completed_on).toBeNull();
    } finally {
      clearTimeout(killer);
      await client.query("rollback").catch(() => undefined);
      await client.end();
    }
  }, 9 * 60_000);
});
