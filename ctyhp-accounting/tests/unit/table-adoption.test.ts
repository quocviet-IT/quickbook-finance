import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every list goes through DataTable or ReportTable.
 *
 * A screen reaching for Ant Design's `Table` directly is how 61 tables ended up
 * with no pagination, 173 hand-written alignments and 25 different ways of
 * printing money. The allowlist below is the work still outstanding: it shrinks
 * with each migration batch and is deleted with the last one.
 *
 * `components/ui/DataTable.tsx` and `components/ui/ReportTable.tsx` are the
 * implementations and are exempt by path, not by list.
 */
const OWN_IMPLEMENTATION = new Set([
  "components/ui/DataTable.tsx",
  "components/ui/ReportTable.tsx",
]);

/**
 * Matches `<Table `, `<Table>`, `<Table/>`, `<Table` at end of line, and the
 * generic `<Table<Row>` this codebase mostly writes — but not `<TableOutlined`,
 * which is an icon. Built fresh on each call: a `/g` regex carries `lastIndex`
 * between `.test()` calls and would report every other file clean.
 */
function tablePattern(): RegExp {
  return /<Table(?!\w)/;
}

/**
 * Screens still rendering Ant Design's Table directly. 49 as of 2026-08-14.
 *
 * Two of these — ReportsClient.tsx and BudgetVsActualView.tsx — carry no bare
 * `<Table `, only a hand-rolled `summary` built from `<Table.Summary.Row>` and
 * `<Table.Summary.Cell>` bolted onto `DataTable`. That is still Ant Design's
 * Table reached into directly, and it is exactly what ReportTable exists to
 * own instead, so it belongs on this list like any other.
 */
const RAW_TABLE = new Set<string>([
  "app/(app)/approvals/ApprovalsClient.tsx",
  "app/(app)/banking/BankImportList.tsx",
  "app/(app)/banking/reconcile/ReconcileListClient.tsx",
  "app/(app)/banking/reconcile/[id]/ReconcileWorkspaceClient.tsx",
  "app/(app)/credit-memos/CreditMemosClient.tsx",
  "app/(app)/invoices/InvoicesClient.tsx",
  "app/(app)/items/ItemMovementsModal.tsx",
  "app/(app)/journal/JournalClient.tsx",
  "app/(app)/opening-balances/OpeningBalancesClient.tsx",
  "app/(app)/pay-bills/PayBillsClient.tsx",
  "app/(app)/payments/PaymentDetailDrawer.tsx",
  "app/(app)/payments/PaymentsClient.tsx",
  "app/(app)/payments/ReceivePaymentModal.tsx",
  "app/(app)/purchase-orders/[id]/BillFromPoModal.tsx",
  "app/(app)/purchase-orders/[id]/PurchaseOrderDetailClient.tsx",
  "app/(app)/purchase-orders/[id]/ReceiveModal.tsx",
  "app/(app)/reports/1099/Report1099Client.tsx",
  "app/(app)/reports/ReportsClient.tsx",
  "app/(app)/reports/cash-flow-forecast/CashFlowForecastClient.tsx",
  "app/(app)/reports/gl-posting/GlPostingClient.tsx",
  "app/(app)/reports/inventory-review/InventoryReviewClient.tsx",
  "app/(app)/reports/journal/JournalReportClient.tsx",
  "app/(app)/reports/number-sequence/NumberSequenceClient.tsx",
  "app/(app)/reports/saved/SavedReportViewer.tsx",
  "app/(app)/reports/saved/SavedReportsClient.tsx",
  "app/(app)/sales-tax/SalesTaxClient.tsx",
  "app/(app)/settings/approvals/ApprovalPoliciesClient.tsx",
  "app/(app)/settings/audit/AuditClient.tsx",
  "app/(app)/settings/companies/CompaniesClient.tsx",
  "app/(app)/settings/company/CompanySettingsClient.tsx",
  "app/(app)/settings/import/AccountTypeReview.tsx",
  "app/(app)/settings/import/ImportColumnsTable.tsx",
  "app/(app)/settings/import/ImportPreflightPanel.tsx",
  "app/(app)/settings/import/ImportPreviewPanel.tsx",
  "app/(app)/settings/import/LedgerBatchList.tsx",
  "app/(app)/settings/import/LedgerImportPanel.tsx",
  "app/(app)/settings/import/UnresolvedAccountsTable.tsx",
  "app/(app)/settings/periods/PeriodsClient.tsx",
  "app/(app)/settings/permissions/PermissionMatrixClient.tsx",
  "app/(app)/settings/users/UsersClient.tsx",
  "app/(app)/vendor-credits/VendorCreditsClient.tsx",
  "app/(app)/vendors/VendorTaxDrawer.tsx",
  "components/audit/DocumentAuditTrail.tsx",
  "components/banking/SettleFromBankModal.tsx",
  "components/payables/PayRunPanel.tsx",
  "components/reports/AgingByPartyTable.tsx",
  "components/reports/AllowanceForDoubtfulAccounts.tsx",
  "components/reports/BudgetVsActualView.tsx",
  "components/settlements/SettlementHistory.tsx",
]);

const ROOT = process.cwd();

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsxFiles(full));
    else if (entry.endsWith(".tsx")) out.push(full);
  }
  return out;
}

const files = [...tsxFiles(join(ROOT, "app")), ...tsxFiles(join(ROOT, "components"))].map(
  (file) => ({
    path: relative(ROOT, file).replaceAll("\\", "/"),
    source: readFileSync(file, "utf8"),
  }),
);

describe("table adoption", () => {
  it("finds files to check", () => {
    expect(files.length).toBeGreaterThan(150);
  });

  it("tells a table apart from the icon of one", () => {
    // The two mistakes this guard exists to avoid making itself.
    expect(tablePattern().test("<Table<InvoiceRow>")).toBe(true);
    expect(tablePattern().test("<Table\n  columns={cols}")).toBe(true);
    expect(tablePattern().test("<Table />")).toBe(true);
    expect(tablePattern().test("<TableOutlined />")).toBe(false);
  });

  it("renders Ant Design's Table nowhere outside the shrinking list", () => {
    const offenders = files
      .filter(({ path }) => !OWN_IMPLEMENTATION.has(path) && !RAW_TABLE.has(path))
      .filter(({ source }) => tablePattern().test(source))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it("lists no file that has already been migrated", () => {
    // Keeps the list honest. Migrate a screen and forget to delete its entry and
    // this fails, so the list cannot inflate into a record of work already done.
    const byPath = new Map(files.map((file) => [file.path, file.source]));
    const stale = [...RAW_TABLE].filter(
      (path) => !tablePattern().test(byPath.get(path) ?? ""),
    );
    expect(stale, "already migrated off Table").toEqual([]);
  });

  it("names a file that exists for every entry", () => {
    // A path typo would otherwise sit in the list forever, silently exempting
    // nothing and making the outstanding count look smaller than it is.
    const known = new Set(files.map((file) => file.path));
    const missing = [...RAW_TABLE].filter((path) => !known.has(path));
    expect(missing, "listed but not found on disk").toEqual([]);
  });
});
