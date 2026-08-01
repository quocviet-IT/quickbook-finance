import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { describe, expect, it } from "vitest";

const MIGRATION_PATH = fileURLToPath(
  new URL("../../supabase/migrations/0081_cash_flow_indirect.sql", import.meta.url),
);
const FROM = "2199-11-01";
const TO = "2199-11-30";

type Account = { id: string };
type SummaryRow = {
  section: string;
  line_code: string;
  amount_minor: string | number;
  detail_count: string | number;
};

describe("indirect cash flow ledger contract", () => {
  it("reconciles classified activity and blocks an unclassified close", async () => {
    expect(existsSync(MIGRATION_PATH), "migration 0081 must exist").toBe(true);
    if (!existsSync(MIGRATION_PATH)) return;

    const databaseUrl = process.env.E2E_DATABASE_URL ?? process.env.SUPABASE_DB_URL;
    expect(databaseUrl, "E2E_DATABASE_URL or SUPABASE_DB_URL is required").toBeTruthy();
    if (!databaseUrl) return;

    const db = new pg.Client({
      connectionString: databaseUrl,
      ssl: { rejectUnauthorized: false },
    });
    await db.connect();
    await db.query("begin");

    try {
      const schema = `cash_flow_test_${Date.now()}`;
      await db.query(`create schema "${schema}"`);
      await db.query(`set local search_path = "${schema}", public`);
      for (const table of [
        "acc_account",
        "acc_item",
        "acc_journal_entry",
        "acc_journal_line",
        "acc_bill",
        "acc_bill_line",
        "acc_bill_payment",
        "acc_bill_payment_allocation",
        "acc_accounting_period",
        "acc_period_event",
        "acc_audit_log",
      ]) {
        await db.query(
          `create table "${schema}".${table} (like public.${table} including defaults including constraints including indexes)`,
        );
      }
      await db.query(`
        create function acc_current_role() returns acc_app_role
        language sql stable as $$ select 'admin'::acc_app_role $$;
        create function acc_is_admin() returns boolean
        language sql stable as $$ select true $$;
        create function acc_control_reconciliation(date)
        returns table (
          label text,
          has_subledger boolean,
          subledger_minor bigint,
          control_minor bigint
        ) language sql stable as $$
          select null::text, false, 0::bigint, 0::bigint where false
        $$;
      `);
      const isolatedMigration = readFileSync(MIGRATION_PATH, "utf8").replaceAll(
        "set search_path = public",
        `set search_path = "${schema}", public`,
      );
      await db.query(isolatedMigration);

      const marker = `ZCF${Date.now()}`;
      let accountSequence = 0;
      let entrySequence = 0;

      const account = async (
        name: string,
        accountType: string,
        cashFlowRole: string,
      ): Promise<string> => {
        accountSequence += 1;
        const result = await db.query<Account>(
          `insert into acc_account
             (account_code, name, account_type, currency_code,
              is_posting_account, status, cash_flow_role)
           values ($1, $2, $3::acc_account_type, 'USD', true, 'active', $4)
           returning id`,
          [`${marker}${accountSequence}`, `${marker} ${name}`, accountType, cashFlowRole],
        );
        return result.rows[0].id;
      };

      const post = async (
        entryDate: string,
        sourceType: string,
        lines: { accountId: string; debit: number; credit: number }[],
        sourceId: string | null = null,
      ): Promise<string> => {
        entrySequence += 1;
        const entry = await db.query<Account>(
          `insert into acc_journal_entry
             (entry_number, entry_date, description, source_type,
              currency_code, status)
           values ($1, $2, $3, $4::acc_journal_source, 'USD', 'posted')
           returning id`,
          [`${marker}-JE-${entrySequence}`, entryDate, `${marker} fixture`, sourceType],
        );
        if (sourceId) {
          await db.query("update acc_journal_entry set source_id = $1 where id = $2", [
            sourceId,
            entry.rows[0].id,
          ]);
        }
        for (const [lineOrder, line] of lines.entries()) {
          await db.query(
            `insert into acc_journal_line
               (journal_entry_id, account_id, debit_minor, credit_minor,
                amount_base_minor, line_order)
             values ($1, $2, $3, $4, $5, $6)`,
            [
              entry.rows[0].id,
              line.accountId,
              line.debit,
              line.credit,
              line.debit + line.credit,
              lineOrder,
            ],
          );
        }
        return entry.rows[0].id;
      };

      const cash = await account("Cash", "bank", "cash");
      const cashTwo = await account("Cash two", "bank", "cash");
      const receivable = await account(
        "Accounts receivable",
        "accounts_receivable",
        "operating_receivable",
      );
      const income = await account("Sales income", "income", "operating");
      const depreciationExpense = await account(
        "Depreciation expense",
        "expense",
        "operating",
      );
      const inventory = await account(
        "Inventory",
        "current_asset",
        "operating_inventory",
      );
      const payable = await account(
        "Accounts payable",
        "accounts_payable",
        "operating_payable",
      );
      const fixedAsset = await account("Equipment", "fixed_asset", "investing");
      const accumulatedDepreciation = await account(
        "Accumulated depreciation",
        "fixed_asset",
        "investing",
      );
      const disposalGain = await account(
        "Gain on disposal",
        "other_income",
        "operating",
      );
      const loan = await account("Loan payable", "current_liability", "financing");
      const equity = await account("Owner equity", "equity", "financing");
      const ambiguousLiability = await account(
        "Ambiguous liability",
        "current_liability",
        "unclassified",
      );

      await post("2199-11-02", "manual", [
        { accountId: receivable, debit: 300_00, credit: 0 },
        { accountId: income, debit: 0, credit: 300_00 },
      ]);
      await post("2199-11-03", "payment", [
        { accountId: cash, debit: 300_00, credit: 0 },
        { accountId: receivable, debit: 0, credit: 300_00 },
      ]);
      await post("2199-11-04", "depreciation", [
        { accountId: depreciationExpense, debit: 100_00, credit: 0 },
        { accountId: accumulatedDepreciation, debit: 0, credit: 100_00 },
      ]);
      await post("2199-11-05", "bill", [
        { accountId: inventory, debit: 200_00, credit: 0 },
        { accountId: payable, debit: 0, credit: 200_00 },
      ]);
      await post("2199-11-06", "bill_payment", [
        { accountId: payable, debit: 200_00, credit: 0 },
        { accountId: cash, debit: 0, credit: 200_00 },
      ]);
      await post("2199-11-07", "manual", [
        { accountId: fixedAsset, debit: 100_00, credit: 0 },
        { accountId: cash, debit: 0, credit: 100_00 },
      ]);
      await post("2199-11-08", "asset_disposal", [
        { accountId: cash, debit: 500_00, credit: 0 },
        { accountId: accumulatedDepreciation, debit: 600_00, credit: 0 },
        { accountId: fixedAsset, debit: 0, credit: 1_000_00 },
        { accountId: disposalGain, debit: 0, credit: 100_00 },
      ]);
      await post("2199-11-09", "manual", [
        { accountId: cash, debit: 400_00, credit: 0 },
        { accountId: loan, debit: 0, credit: 400_00 },
      ]);
      await post("2199-11-10", "manual", [
        { accountId: equity, debit: 50_00, credit: 0 },
        { accountId: cash, debit: 0, credit: 50_00 },
      ]);
      await post("2199-11-11", "manual", [
        { accountId: cashTwo, debit: 25_00, credit: 0 },
        { accountId: cash, debit: 0, credit: 25_00 },
      ]);

      // Capital asset acquired through A/P, then paid. The cash payment must
      // remain Investing instead of inheriting the A/P account's operating role.
      const billId = crypto.randomUUID();
      const vendorId = crypto.randomUUID();
      const capexBillEntry = await post(
        "2199-11-12",
        "bill",
        [
          { accountId: fixedAsset, debit: 100_00, credit: 0 },
          { accountId: payable, debit: 0, credit: 100_00 },
        ],
        billId,
      );
      await db.query(
        `insert into acc_bill
           (id, vendor_id, bill_date, currency_code, total_minor,
            balance_due_minor, status, journal_entry_id)
         values ($1, $2, '2199-11-12', 'USD', $3, 0, 'paid', $4)`,
        [billId, vendorId, 100_00, capexBillEntry],
      );
      await db.query(
        `insert into acc_bill_line
           (bill_id, line_order, description, expense_account_id, amount_minor)
         values ($1, 0, 'Capital equipment', $2, $3)`,
        [billId, fixedAsset, 100_00],
      );
      const capexPaymentEntry = await post("2199-11-13", "bill_payment", [
        { accountId: payable, debit: 100_00, credit: 0 },
        { accountId: cash, debit: 0, credit: 100_00 },
      ]);
      const billPayment = await db.query<Account>(
        `insert into acc_bill_payment
           (vendor_id, payment_date, currency_code, amount_minor,
            unapplied_minor, payment_account_id, status, journal_entry_id)
         values ($1, '2199-11-13', 'USD', $2, 0, $3, 'applied', $4)
         returning id`,
        [vendorId, 100_00, cash, capexPaymentEntry],
      );
      await db.query(
        `insert into acc_bill_payment_allocation
           (bill_payment_id, bill_id, amount_minor)
         values ($1, $2, $3)`,
        [billPayment.rows[0].id, billId, 100_00],
      );

      const readSummary = async (): Promise<SummaryRow[]> =>
        (
          await db.query<SummaryRow>(
            "select * from acc_cash_flow_indirect($1::date, $2::date)",
            [FROM, TO],
          )
        ).rows;
      const amount = (rows: SummaryRow[], code: string): number =>
        Number(rows.find((row) => row.line_code === code)?.amount_minor ?? 0);
      const sectionTotal = (rows: SummaryRow[], section: string): number =>
        rows
          .filter((row) => row.section === section)
          .reduce((sum, row) => sum + Number(row.amount_minor), 0);

      const classified = await readSummary();
      expect(amount(classified, "net_income")).toBe(300_00);
      expect(amount(classified, "depreciation")).toBe(100_00);
      expect(amount(classified, "asset_disposal_gain_loss")).toBe(-100_00);
      expect(amount(classified, "change_accounts_receivable")).toBe(0);
      expect(amount(classified, "change_inventory")).toBe(-200_00);
      expect(amount(classified, "change_accounts_payable")).toBe(0);
      expect(sectionTotal(classified, "operating")).toBe(100_00);
      expect(amount(classified, "capital_purchases")).toBe(-200_00);
      expect(amount(classified, "asset_sale_proceeds")).toBe(500_00);
      expect(sectionTotal(classified, "investing")).toBe(300_00);
      expect(amount(classified, "loan_proceeds")).toBe(400_00);
      expect(amount(classified, "owner_distributions")).toBe(-50_00);
      expect(sectionTotal(classified, "financing")).toBe(350_00);
      expect(
        amount(classified, "closing_cash") - amount(classified, "opening_cash"),
      ).toBe(750_00);
      expect(amount(classified, "unclassified")).toBe(0);
      expect(
        Number(
          classified.find((row) => row.line_code === "unclassified")?.detail_count ?? 0,
        ),
      ).toBe(0);
      const disposalDetails = await db.query<{ line_code: string; amount_minor: string | number }>(
        "select line_code, amount_minor from acc_cash_flow_indirect_detail($1::date, $2::date, $3)",
        [FROM, TO, "asset_sale_proceeds"],
      );
      expect(disposalDetails.rows).toHaveLength(1);
      expect(disposalDetails.rows[0].line_code).toBe("asset_sale_proceeds");
      expect(Number(disposalDetails.rows[0].amount_minor)).toBe(500_00);

      await post("2199-11-14", "manual", [
        { accountId: cash, debit: 25_00, credit: 0 },
        { accountId: ambiguousLiability, debit: 0, credit: 25_00 },
      ]);
      const incomplete = await readSummary();
      expect(amount(incomplete, "unclassified")).toBe(25_00);
      expect(
        Number(
          incomplete.find((row) => row.line_code === "unclassified")?.detail_count ?? 0,
        ),
      ).toBe(1);

      const period = await db.query<Account>(
        `insert into acc_accounting_period
           (fiscal_year, period_month, period_start, period_end, label, status)
         values (2199, 11, $1, $2, $3, 'open') returning id`,
        [FROM, TO, `${marker} period`],
      );
      const blocker = await db.query<{ blocker: string | null }>(
        "select acc_period_close_blockers($1) blocker",
        [period.rows[0].id],
      );
      expect(blocker.rows[0].blocker).toContain("cash flow");

      await db.query("select acc_close_period($1, $2, $3)", [
        period.rows[0].id,
        `${marker} close`,
        `${marker} acknowledges the unclassified cash flow`,
      ]);
      const snapshot = await db.query<{
        difference_minor: string | number;
        unclassified_count: string | number;
      }>(
        `select difference_minor, unclassified_count
           from acc_cash_flow_close_snapshot where period_id = $1`,
        [period.rows[0].id],
      );
      expect(Number(snapshot.rows[0].difference_minor)).toBe(25_00);
      expect(Number(snapshot.rows[0].unclassified_count)).toBe(1);
    } finally {
      await db.query("rollback");
      await db.end();
    }
  });
});
