import pg from "pg";
import { describe, expect, it } from "vitest";
import {
  buildProfitAndLoss,
  buildTrialBalance,
  type LedgerBalance,
} from "@/lib/domain/reports";

const databaseUrl = process.env.SUPABASE_DB_URL;

function ledgerRows(
  rows: Array<Record<string, unknown>>,
): LedgerBalance[] {
  return rows.map((row) => ({
    accountId: String(row.account_id),
    accountCode: String(row.account_code),
    name: String(row.name),
    accountType: row.account_type as LedgerBalance["accountType"],
    debitBase: Number(row.debit_base),
    creditBase: Number(row.credit_base),
  }));
}

function byAccount(rows: LedgerBalance[]): Map<string, LedgerBalance> {
  return new Map(rows.map((row) => [row.accountId, row]));
}

describe("document → journal → ledger → report", () => {
  it("posts one USD invoice through every authoritative accounting layer and rolls it back", async () => {
    if (!databaseUrl) {
      throw new Error(
        "SUPABASE_DB_URL is required. Run through npm run test:e2e:document-ledger-report.",
      );
    }

    const db = new pg.Client({
      connectionString: databaseUrl,
      ssl: { rejectUnauthorized: false },
    });
    const marker = `E2E-DOC-LEDGER-REPORT-${Date.now()}`;
    const amountMinor = 248_750;
    let transactionOpen = false;

    try {
      await db.connect();
      await db.query("begin isolation level repeatable read");
      transactionOpen = true;

      const admin = await db.query<{
        id: string;
      }>(`
        select id
          from acc_app_user
         where role = 'admin'
           and status = 'active'
         order by created_at
         limit 1
      `);
      expect(
        admin.rowCount,
        "An active administrator is required for the posting E2E",
      ).toBe(1);
      const adminId = admin.rows[0].id;
      await db.query(
        `select set_config(
          'request.jwt.claims',
          json_build_object('sub', $1::text, 'role', 'authenticated')::text,
          true
        )`,
        [adminId],
      );

      const period = await db.query(`
        update acc_accounting_period
           set status = 'open'
         where current_date between period_start and period_end
        returning id
      `);
      expect(
        period.rowCount,
        "The current accounting period must exist before a document can post",
      ).toBeGreaterThan(0);

      const income = await db.query<{
        id: string;
        account_code: string;
      }>(`
        select id, account_code
          from acc_account
         where account_type = 'income'
           and status = 'active'
           and is_posting_account
         order by account_code
         limit 1
      `);
      expect(income.rowCount, "An active posting income account is required").toBe(1);
      const incomeAccountId = income.rows[0].id;
      const asOf = (
        await db.query<{ value: string }>(
          `select to_char(current_date, 'YYYY-MM-DD') as value`,
        )
      ).rows[0].value;

      const loadLedger = async () => {
        const result = await db.query(
          `select *
             from acc_ledger_balances($1::date, $1::date)
            order by account_code`,
          [asOf],
        );
        return ledgerRows(result.rows);
      };
      const ledgerBefore = await loadLedger();
      const profitAndLossBefore = buildProfitAndLoss(ledgerBefore);

      const customer = await db.query<{ id: string }>(
        `insert into acc_customer (name, currency_code)
         values ($1, 'USD')
         returning id`,
        [marker],
      );
      const customerId = customer.rows[0].id;
      const invoiceLines = JSON.stringify([
        {
          description: "Jewelry appraisal and setting service",
          quantity: 1,
          unit_price_minor: amountMinor,
          income_account_id: incomeAccountId,
          tax_code_id: null,
          item_id: null,
        },
      ]);
      const invoice = await db.query<{ id: string }>(
        `select acc_create_draft_invoice(
           $1::uuid,
           current_date,
           current_date + 30,
           'USD',
           $2,
           $3::jsonb,
           null
         ) as id`,
        [customerId, marker, invoiceLines],
      );
      const invoiceId = invoice.rows[0].id;

      const atomicDraft = await db.query<{
        line_count: number;
        audit_count: number;
      }>(
        `select
           (select count(*)::int
              from acc_invoice_line
             where invoice_id = $1::uuid) as line_count,
           (select count(*)::int
              from acc_audit_log
             where table_name = 'acc_invoice'
               and record_id = $1::uuid
               and action = 'insert') as audit_count`,
        [invoiceId],
      );
      expect(atomicDraft.rows[0]).toEqual({ line_count: 1, audit_count: 1 });

      const failedMarker = `${marker}-EXPECTED-ROLLBACK`;
      await db.query("savepoint invalid_document");
      let invalidDocumentRejected = false;
      try {
        await db.query(
          `select acc_create_draft_invoice(
             $1::uuid,
             current_date,
             null,
             'USD',
             $2,
             jsonb_build_array(jsonb_build_object(
               'description', 'Invalid account must roll back',
               'quantity', 1,
               'unit_price_minor', 100,
               'income_account_id', gen_random_uuid()
             )),
             null
           )`,
          [customerId, failedMarker],
        );
      } catch {
        invalidDocumentRejected = true;
      } finally {
        await db.query("rollback to savepoint invalid_document");
      }
      expect(invalidDocumentRejected).toBe(true);
      const orphanedHeader = await db.query<{ count: number }>(
        `select count(*)::int as count from acc_invoice where memo = $1`,
        [failedMarker],
      );
      expect(orphanedHeader.rows[0].count).toBe(0);

      const posting = await db.query<{ journal_entry_id: string }>(
        `select acc_issue_invoice($1::uuid) as journal_entry_id`,
        [invoiceId],
      );
      const journalEntryId = posting.rows[0].journal_entry_id;
      expect(journalEntryId).toBeTruthy();

      const postAudit = await db.query<{ count: number }>(
        `select count(*)::int as count
           from acc_audit_log
          where table_name = 'acc_invoice'
            and record_id = $1::uuid
            and action = 'post'`,
        [invoiceId],
      );
      expect(postAudit.rows[0].count).toBe(1);

      // Force the database's deferred balanced-entry invariant now rather than
      // relying only on the application-side assertions below.
      await db.query("set constraints all immediate");

      const issued = await db.query<{
        status: string;
        invoice_number: string | null;
        balance_due_minor: string;
        journal_entry_id: string | null;
      }>(
        `select status, invoice_number, balance_due_minor, journal_entry_id
           from acc_invoice
          where id = $1::uuid`,
        [invoiceId],
      );
      expect(issued.rows[0]).toMatchObject({
        status: "issued",
        journal_entry_id: journalEntryId,
      });
      expect(issued.rows[0].invoice_number).toBeTruthy();
      expect(Number(issued.rows[0].balance_due_minor)).toBe(amountMinor);

      const journal = await db.query<{
        id: string;
        status: string;
        source_type: string;
        source_id: string;
        debit_minor: string;
        credit_minor: string;
        debit_base: string;
        credit_base: string;
      }>(
        `select
           e.id,
           e.status,
           e.source_type::text,
           e.source_id,
           sum(l.debit_minor)::bigint as debit_minor,
           sum(l.credit_minor)::bigint as credit_minor,
           sum(case when l.debit_minor > 0 then l.amount_base_minor else 0 end)::bigint
             as debit_base,
           sum(case when l.credit_minor > 0 then l.amount_base_minor else 0 end)::bigint
             as credit_base
         from acc_journal_entry e
         join acc_journal_line l on l.journal_entry_id = e.id
        where e.id = $1::uuid
        group by e.id`,
        [journalEntryId],
      );
      expect(journal.rowCount).toBe(1);
      expect(journal.rows[0]).toMatchObject({
        id: journalEntryId,
        status: "posted",
        source_type: "invoice",
        source_id: invoiceId,
      });
      expect(Number(journal.rows[0].debit_minor)).toBe(amountMinor);
      expect(Number(journal.rows[0].credit_minor)).toBe(amountMinor);
      expect(Number(journal.rows[0].debit_base)).toBe(amountMinor);
      expect(Number(journal.rows[0].credit_base)).toBe(amountMinor);

      const journalAccounts = await db.query<{
        account_id: string;
        account_type: string;
        debit_minor: string;
        credit_minor: string;
      }>(
        `select l.account_id, a.account_type::text, l.debit_minor, l.credit_minor
           from acc_journal_line l
           join acc_account a on a.id = l.account_id
          where l.journal_entry_id = $1::uuid`,
        [journalEntryId],
      );
      const receivableLine = journalAccounts.rows.find(
        (row) => row.account_type === "accounts_receivable",
      );
      const incomeLine = journalAccounts.rows.find(
        (row) => row.account_id === incomeAccountId,
      );
      expect(Number(receivableLine?.debit_minor)).toBe(amountMinor);
      expect(Number(incomeLine?.credit_minor)).toBe(amountMinor);

      const ledgerAfter = await loadLedger();
      const beforeByAccount = byAccount(ledgerBefore);
      const afterByAccount = byAccount(ledgerAfter);
      const receivableAccountId = receivableLine?.account_id;
      expect(receivableAccountId).toBeTruthy();
      expect(
        (afterByAccount.get(receivableAccountId!)?.debitBase ?? 0) -
          (beforeByAccount.get(receivableAccountId!)?.debitBase ?? 0),
      ).toBe(amountMinor);
      expect(
        (afterByAccount.get(incomeAccountId)?.creditBase ?? 0) -
          (beforeByAccount.get(incomeAccountId)?.creditBase ?? 0),
      ).toBe(amountMinor);

      const trialBalance = buildTrialBalance(ledgerAfter);
      expect(trialBalance.balanced).toBe(true);
      expect(trialBalance.totalDebit).toBe(trialBalance.totalCredit);

      const profitAndLossAfter = buildProfitAndLoss(ledgerAfter);
      expect(
        profitAndLossAfter.income.total - profitAndLossBefore.income.total,
      ).toBe(amountMinor);
      expect(
        profitAndLossAfter.netIncome - profitAndLossBefore.netIncome,
      ).toBe(amountMinor);

      await db.query("rollback");
      transactionOpen = false;

      const persisted = await db.query<{ count: number }>(
        `select count(*)::int as count
           from acc_customer
          where name = $1`,
        [marker],
      );
      expect(persisted.rows[0].count).toBe(0);

      console.log(
        JSON.stringify({
          verified: true,
          flow: ["invoice", "journal", "ledger", "trial_balance", "profit_and_loss"],
          amountMinor,
          currency: "USD",
          persisted: false,
        }),
      );
    } finally {
      if (transactionOpen) {
        await db.query("rollback").catch(() => undefined);
      }
      await db.end().catch(() => undefined);
    }
  });
});
