import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { snapshotDescription, snapshotHash } from "@/lib/domain/backup";
import { archivePathFor, type ExportControlTotals, type ExportDataset } from "@/lib/domain/company-export";
import { buildExportArchive } from "@/lib/services/company-export";
import { compareControlTotals, readSnapshotArchive, type TablePlan } from "@/lib/services/backup-restore";

/**
 * 2.98: the company export, read back through the code a restore runs, gives
 * back every cell it wrote and the same control totals — proved in CI, with no
 * database. The export is built by buildExportArchive (the bytes the button
 * and the nightly backup produce) and read by readSnapshotArchive (the checks
 * and the parse restoreBackupIntoNewCompany runs before it loads a row).
 * The load into Postgres itself is proved against a real database by
 * scripts/backup-restore-roundtrip.live.ts; this file proves everything up to
 * the INSERT, on every push.
 *
 * Made-up books only: no real company's names or figures.
 */

const GENERATED_AT = "2026-10-31T12:00:00.000Z";
const AS_OF = "2026-10-31";

const dataset = (table: string, rows: Array<Record<string, unknown>>, sensitive = false): ExportDataset => ({
  table,
  columns: rows.length === 0 ? [] : Object.keys(rows[0]),
  rows,
  sensitive,
});

const ACCOUNTS = [
  { id: "a-bank", account_code: "1010", name: "Operating Checking", account_type: "bank", description: "Main account, checks \"and\" deposits", is_posting_account: true, parent_account_id: null },
  { id: "a-ar", account_code: "1200", name: "Accounts Receivable", account_type: "accounts_receivable", description: null, is_posting_account: true, parent_account_id: null },
  { id: "a-ap", account_code: "2000", name: "Accounts Payable", account_type: "accounts_payable", description: "", is_posting_account: true, parent_account_id: null },
  { id: "a-inc", account_code: "4000", name: "Café sales — Ñ 東京", account_type: "income", description: "Line one\r\nline two", is_posting_account: true, parent_account_id: null },
  { id: "a-exp", account_code: "6000", name: "Office", account_type: "expense", description: "=HYPERLINK(\"x\")", is_posting_account: false, parent_account_id: null },
  { id: "a-sup", account_code: "6010", name: "Supplies", account_type: "expense", description: "@supplies, +tax", is_posting_account: true, parent_account_id: "a-exp" },
];

const ENTRIES = [
  { id: "je-1", entry_number: "JE-0001", entry_date: "2026-10-01", description: "Invoice INV-1", status: "posted" },
  { id: "je-2", entry_number: "JE-0002", entry_date: "2026-10-15", description: "=SUM(A1:A9)", status: "posted" },
  { id: "je-3", entry_number: "JE-0003", entry_date: "2026-10-20", description: "Voided, \"wrong\" account", status: "void" },
  // Dated after the export: the totals leave it out, and must again after the restore.
  { id: "je-4", entry_number: "JE-0004", entry_date: "2026-11-03", description: "Next month", status: "posted" },
];

const line = (id: string, entry: string, account: string, debit: number, credit: number, memo: string | null) => ({
  id,
  journal_entry_id: entry,
  account_id: account,
  debit_minor: debit,
  credit_minor: credit,
  amount_base_minor: debit || credit,
  tax_code_id: null,
  memo,
});

const LINES = [
  line("l-1", "je-1", "a-ar", 150_000, 0, "-net 30"),
  line("l-2", "je-1", "a-inc", 0, 150_000, null),
  line("l-3", "je-2", "a-sup", 42_517, 0, "+ freight, \"rush\""),
  line("l-4", "je-2", "a-ap", 0, 42_517, ""),
  line("l-5", "je-3", "a-sup", 9_999, 0, "@void me"),
  line("l-6", "je-3", "a-bank", 0, 9_999, null),
  line("l-7", "je-4", "a-bank", 123_456_789_012, 0, "big"),
  line("l-8", "je-4", "a-inc", 0, 123_456_789_012, "big"),
];

const INVOICES = [
  { id: "i-1", invoice_number: "INV-1", customer_id: "c-1", issue_date: "2026-10-01", total_minor: 150_000, balance_due_minor: 100_000, status: "partial", memo: "Thanks,\nsee terms" },
  { id: "i-2", invoice_number: "INV-2", customer_id: "c-1", issue_date: "2026-10-05", total_minor: 30_000, balance_due_minor: 0, status: "paid", memo: null },
  { id: "i-3", invoice_number: "INV-3", customer_id: "c-1", issue_date: "2026-10-06", total_minor: 7_000, balance_due_minor: 7_000, status: "void", memo: "-" },
  { id: "i-4", invoice_number: null, customer_id: "c-1", issue_date: "2026-10-07", total_minor: 5_000, balance_due_minor: 5_000, status: "draft", memo: null },
];

const INVOICE_LINES = [
  { id: "il-1", invoice_id: "i-1", line_order: 1, description: "Widgets", amount_minor: 151_500 },
  // A discount line: the formula guard writes "-1500" as "'-1500", and the read must undo it.
  { id: "il-2", invoice_id: "i-1", line_order: 2, description: "-1% early payment", amount_minor: -1_500 },
];

const BILLS = [
  { id: "b-1", bill_number: "B-1", vendor_id: "v-1", bill_date: "2026-10-15", total_minor: 42_517, balance_due_minor: 42_517, status: "open", discount_amount_minor: 0 },
  { id: "b-2", bill_number: "B-2", vendor_id: "v-1", bill_date: "2026-10-16", total_minor: 8_000, balance_due_minor: 2_500, status: "partial", discount_amount_minor: 160 },
];

const DATASETS: ExportDataset[] = [
  dataset("acc_company_setting_version", [
    { id: "s-1", settings: { fiscal_year_start_month: 1, company_name: "Sample, \"Co\"" }, effective_from: "2026-01-01" },
  ]),
  dataset("acc_period_event", []),
  // Exported, never restored: the copy's only user is whoever runs the restore.
  dataset("acc_app_user", [{ user_id: "u-1", email: "someone@example.com", role: "admin" }]),
  dataset("acc_account", ACCOUNTS),
  dataset("acc_journal_entry", ENTRIES),
  dataset("acc_journal_line", LINES),
  dataset("acc_customer", [{ id: "c-1", name: "O'Brien \"& Sons\", Ltd", email: null, is_active: false }]),
  dataset("acc_vendor", [{ id: "v-1", name: "Supplies Co.", email: "ap@example.com", is_active: true }]),
  dataset("acc_invoice", INVOICES),
  dataset("acc_invoice_line", INVOICE_LINES),
  dataset("acc_bill", BILLS),
  dataset("acc_document_attachment", [{ id: "d-1", file_name: "receipt, Oct.pdf", size_bytes: 2048, sha256: "ab".repeat(32) }]),
  dataset("acc_vendor_tax_profile", [{ id: "t-1", vendor_id: "v-1", tin: "12-3456789", tin_type: "EIN" }], true),
];

type Rows = (table: string) => Array<Record<string, unknown>>;

/**
 * The five control totals, from the columns the database's own figures read
 * (acc_ledger_balances, the AR and AP ageing, the journal line count): posted
 * entries up to the date, posting accounts only; open invoice and bill
 * balances. Takes raw rows, so it runs the same on the typed values before the
 * export and on the text cells after it — a cell that changed on the way
 * through moves a total.
 */
function controlTotalsOf(rows: Rows, asOf: string): ExportControlTotals {
  const yes = (value: unknown) => value === true || value === "true";
  const n = (value: unknown) => Number(value ?? 0);
  const posting = new Set(rows("acc_account").filter((a) => yes(a.is_posting_account)).map((a) => String(a.id)));
  const counted = new Set(
    rows("acc_journal_entry")
      .filter((e) => e.status === "posted" && String(e.entry_date) <= asOf)
      .map((e) => String(e.id)),
  );
  let debit = 0;
  let credit = 0;
  for (const l of rows("acc_journal_line")) {
    if (!counted.has(String(l.journal_entry_id)) || !posting.has(String(l.account_id))) continue;
    if (n(l.debit_minor) > 0) debit += n(l.amount_base_minor);
    if (n(l.credit_minor) > 0) credit += n(l.amount_base_minor);
  }
  const open = (status: unknown) => status !== "draft" && status !== "void" && status !== "paid";
  return {
    trialBalanceDebitMinor: debit,
    trialBalanceCreditMinor: credit,
    arTotalMinor: rows("acc_invoice")
      .filter((i) => open(i.status) && String(i.issue_date) <= asOf)
      .reduce((sum, i) => sum + n(i.balance_due_minor), 0),
    apTotalMinor: rows("acc_bill")
      .filter((b) => open(b.status) && String(b.bill_date) <= asOf)
      .reduce((sum, b) => sum + n(b.balance_due_minor), 0),
    journalLineCount: rows("acc_journal_line").length,
  };
}

const typedRows: Rows = (table) => DATASETS.find((d) => d.table === table)?.rows ?? [];

const plannedRows =
  (plans: TablePlan[]): Rows =>
  (table) => {
    const plan = plans.find((p) => p.table === table);
    if (!plan) return [];
    return plan.rows.map((cells) => Object.fromEntries(plan.columns.map((column, i) => [column, cells[i]])));
  };

/**
 * What a cell must read back as. The export writes null and "" the same way
 * (an empty cell), and the load decides between them by the column's
 * nullability, so both read back as null here; an object is its JSON.
 */
const asText = (value: unknown): string | null => {
  if (value === null || value === undefined || value === "") return null;
  return typeof value === "object" ? JSON.stringify(value) : String(value);
};

async function exportAndReadBack() {
  const controlTotals = controlTotalsOf(typedRows, AS_OF);
  const archive = await buildExportArchive({
    datasets: DATASETS,
    controlTotals,
    schemaVersion: "0185_example.sql",
    generatedAt: GENERATED_AT,
  });
  // The register row the nightly job writes beside the stored file.
  const register = {
    storagePath: "example/2026-10-31.zip",
    contentHash: await snapshotHash(snapshotDescription(archive.manifest)),
    controlTotals,
    takenAt: archive.manifest.controlTotalsAsOf,
  };
  const read = await readSnapshotArchive(archive.bytes, register);
  return { archive, controlTotals, ...read };
}

describe("a company export reads back whole (2.98)", () => {
  it("records the figures the books add up to as of the export's date", () => {
    // Posted, dated by 31 October, on posting accounts: JE-0001 and JE-0002.
    expect(controlTotalsOf(typedRows, AS_OF)).toEqual({
      trialBalanceDebitMinor: 192_517,
      trialBalanceCreditMinor: 192_517,
      arTotalMinor: 100_000,
      apTotalMinor: 45_017,
      journalLineCount: 8,
    });
  });

  it("gives back every cell of every restored table, in the export's column order", async () => {
    const { plans } = await exportAndReadBack();
    const restored = DATASETS.filter((d) => d.table !== "acc_app_user" && d.rows.length > 0);
    expect(plans.map((p) => p.table).sort()).toEqual(
      [...restored.map((d) => d.table), "acc_period_event"].sort(),
    );
    for (const d of restored) {
      const plan = plans.find((p) => p.table === d.table)!;
      expect(plan.columns, d.table).toEqual(d.columns);
      expect(plan.rows, d.table).toEqual(d.rows.map((row) => d.columns.map((column) => asText(row[column]))));
    }
  });

  it("keeps the values a spreadsheet would mangle: negatives, formulas, quotes, commas, line breaks, accents, JSON, large numbers", async () => {
    const rows = plannedRows((await exportAndReadBack()).plans);
    expect(rows("acc_invoice_line")[1].amount_minor).toBe("-1500");
    expect(rows("acc_invoice_line")[1].description).toBe("-1% early payment");
    expect(rows("acc_journal_entry")[1].description).toBe("=SUM(A1:A9)");
    expect(rows("acc_account")[4].description).toBe("=HYPERLINK(\"x\")");
    expect(rows("acc_account")[5].description).toBe("@supplies, +tax");
    expect(rows("acc_journal_line")[2].memo).toBe("+ freight, \"rush\"");
    expect(rows("acc_customer")[0].name).toBe("O'Brien \"& Sons\", Ltd");
    expect(rows("acc_account")[3]).toMatchObject({ name: "Café sales — Ñ 東京", description: "Line one\r\nline two" });
    expect(rows("acc_invoice")[0].memo).toBe("Thanks,\nsee terms");
    expect(rows("acc_journal_line")[6].amount_base_minor).toBe("123456789012");
    expect(JSON.parse(String(rows("acc_company_setting_version")[0].settings))).toEqual({
      fiscal_year_start_month: 1,
      company_name: "Sample, \"Co\"",
    });
    expect(rows("acc_customer")[0]).toMatchObject({ email: null, is_active: "false" });
  });

  it("reads the vendor tax file and the attachment list from their own places in the archive", async () => {
    const { archive, plans } = await exportAndReadBack();
    expect(archivePathFor("acc_vendor_tax_profile")).toBe("sensitive/vendor-tax.csv");
    expect(archivePathFor("acc_document_attachment")).toBe("attachments.csv");
    expect(archive.manifest.containsSensitiveData).toBe(true);
    expect(plans.find((p) => p.table === "acc_vendor_tax_profile")?.rows).toEqual([["t-1", "v-1", "12-3456789", "EIN"]]);
    expect(plans.find((p) => p.table === "acc_document_attachment")?.rows[0][1]).toBe("receipt, Oct.pdf");
  });

  it("adds up to the same control totals after the trip as before it", async () => {
    const { plans, manifest, controlTotals } = await exportAndReadBack();
    expect(manifest.controlTotals).toEqual(controlTotals);
    const after = controlTotalsOf(plannedRows(plans), manifest.controlTotalsAsOf);
    expect(compareControlTotals(manifest.controlTotals, after)).toEqual({ controlTotalsMatch: true, differences: [] });
  });

  it("names the figures that move when a single row goes missing", async () => {
    const { plans, manifest } = await exportAndReadBack();
    const lines = plans.find((p) => p.table === "acc_journal_line")!;
    const short = plans.map((p) => (p === lines ? { ...p, rows: p.rows.filter((row) => row[0] !== "l-3") } : p));
    expect(compareControlTotals(manifest.controlTotals, controlTotalsOf(plannedRows(short), AS_OF)).differences).toEqual([
      "trialBalanceDebitMinor: expected 192517, got 150000",
      "journalLineCount: expected 8, got 7",
    ]);
  });
});
