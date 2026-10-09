export type ReportGroupId =
  | "business-overview"
  | "analysis"
  | "receivables"
  | "payables"
  | "accounting"
  | "inventory-tax";

export type InternalReportId = "trial" | "pnl" | "balance" | "budget" | "equity";

export const INTERNAL_REPORT_HREFS: Record<InternalReportId, string> = {
  trial: "/reports?report=trial",
  pnl: "/reports?report=pnl",
  balance: "/reports?report=balance",
  budget: "/reports?report=budget",
  equity: "/reports?report=equity",
};

export interface ReportGroupDefinition {
  id: ReportGroupId;
  label: string;
  description: string;
}

export interface ReportDefinition {
  id: string;
  title: string;
  description: string;
  href: string;
  group: ReportGroupId;
  internalReport?: InternalReportId;
  /**
   * Permissions any one of which opens the report, as a sidebar item declares
   * them. Absent: anybody in the company may open it. The page enforces the
   * same rule on the server; the Report Center only hides what would refuse.
   */
  anyPermissions?: readonly string[];
}

/** The Change Log reads the audit log, which only these permissions may read. */
export const CHANGE_LOG_PERMISSIONS = ["audit.read"] as const;

export const REPORT_GROUPS: ReportGroupDefinition[] = [
  {
    id: "business-overview",
    label: "Business Overview",
    description: "Core financial statements and performance comparisons.",
  },
  {
    id: "analysis",
    label: "Analysis",
    description: "What-if scenarios and frozen analysis reports. Nothing here posts to the books.",
  },
  {
    id: "receivables",
    label: "Receivables",
    description: "Customer balances, aging, and collection details.",
  },
  {
    id: "payables",
    label: "Payables",
    description: "Vendor obligations, aging, and tax reporting.",
  },
  {
    id: "accounting",
    label: "Accounting",
    description: "Ledger activity, journal detail, and account balances.",
  },
  {
    id: "inventory-tax",
    label: "Inventory & Tax",
    description: "Inventory value and sales tax obligations.",
  },
];

export const REPORT_CATALOG: ReportDefinition[] = [
  {
    id: "profit-and-loss",
    title: "Profit and Loss",
    description: "Review income, expenses, and net profit with prior-period comparison.",
    href: INTERNAL_REPORT_HREFS.pnl,
    group: "business-overview",
    internalReport: "pnl",
  },
  {
    id: "balance-sheet",
    title: "Balance Sheet",
    description: "Compare assets, liabilities, and equity as of a selected date.",
    href: INTERNAL_REPORT_HREFS.balance,
    group: "business-overview",
    internalReport: "balance",
  },
  {
    id: "cash-flow",
    title: "Statement of Cash Flows",
    description: "Analyze operating, investing, and financing cash movements.",
    href: "/reports/cash-flow",
    group: "business-overview",
  },
  {
    id: "cash-flow-forecast",
    title: "Cash Flow Forecast",
    description: "Project receipts and payments over the next 13 weeks from open invoices and bills.",
    href: "/reports/cash-flow-forecast",
    group: "business-overview",
  },
  {
    id: "statement-of-equity",
    title: "Statement of Equity",
    description: "Track opening equity, period activity, and closing balances.",
    href: INTERNAL_REPORT_HREFS.equity,
    group: "business-overview",
    internalReport: "equity",
  },
  {
    id: "budget-vs-actual",
    title: "Budget vs. Actual",
    description: "Compare budget targets with posted financial results.",
    href: INTERNAL_REPORT_HREFS.budget,
    group: "business-overview",
    internalReport: "budget",
  },
  {
    id: "inventory-review",
    title: "Inventory Review",
    description:
      "Slow-moving and obsolete stock, and anything carried above net realisable value.",
    href: "/reports/inventory-review",
    group: "inventory-tax",
  },
  {
    id: "gl-posting",
    title: "General Ledger Posting",
    description:
      "Prove every document reached the ledger, and every control account still ties to its subledger.",
    href: "/reports/gl-posting",
    group: "accounting",
  },
  {
    id: "working-trial-balance",
    title: "Working Trial Balance",
    description:
      "The trial balance in three column pairs — unadjusted, adjustments, adjusted — with every adjusting entry and the reason for it.",
    href: "/reports/working-trial-balance",
    group: "accounting",
  },
  {
    id: "exception-report",
    title: "Exception Report",
    description:
      "Eight checks a reviewer runs by hand: entries posted twice, a check number reused, a balance pointing the wrong way, anything still uncoded.",
    href: "/reports/exceptions",
    group: "accounting",
  },
  {
    id: "accounts-receivable-aging",
    title: "Accounts Receivable Aging",
    description: "Prioritize collections by customer and overdue age.",
    href: "/reports/ar-aging",
    group: "receivables",
  },
  {
    id: "customer-credit",
    title: "Customer Credit Exposure",
    description: "Credit limits, balances owed, overdue exposure, and days sales outstanding.",
    href: "/reports/customer-credit",
    group: "receivables",
  },
  {
    id: "customer-statements",
    title: "Customer Statements",
    description: "Review customer invoices, payments, credits, and balances.",
    href: "/reports/customer-statement",
    group: "receivables",
  },
  {
    id: "open-invoices",
    title: "Open Invoices",
    description: "Every invoice still open on a date, by customer and due date, with how long it is past due.",
    href: "/reports/open-invoices",
    group: "receivables",
  },
  {
    id: "customer-balances",
    title: "Customer Balances",
    description: "What each customer owes on a date, credits netted, held to the receivables account.",
    href: "/reports/customer-balances",
    group: "receivables",
  },
  {
    id: "sales-by-customer",
    title: "Sales by Customer",
    description: "A period's income by customer, largest first, adding up to Income on the Profit and Loss.",
    href: "/reports/sales-by-customer",
    group: "receivables",
  },
  {
    id: "accounts-payable-aging",
    title: "Accounts Payable Aging",
    description: "Monitor vendor balances by due date and overdue age.",
    href: "/reports/ap-aging",
    group: "payables",
  },
  {
    id: "vendor-statements",
    title: "Vendor Statements",
    description: "Review bills, credits, payments, and vendor balances.",
    href: "/reports/vendor-statement",
    group: "payables",
  },
  {
    id: "unpaid-bills",
    title: "Unpaid Bills",
    description: "Every bill still unpaid on a date, by vendor and due date, with how long it is past due.",
    href: "/reports/unpaid-bills",
    group: "payables",
  },
  {
    id: "vendor-balances",
    title: "Vendor Balances",
    description: "What is owed to each vendor on a date, credits netted, held to the payables account.",
    href: "/reports/vendor-balances",
    group: "payables",
  },
  {
    id: "expenses-by-vendor",
    title: "Expenses by Vendor",
    description: "A period's spending by vendor, largest first, adding up to cost of sales, expenses and other expenses on the Profit and Loss.",
    href: "/reports/expenses-by-vendor",
    group: "payables",
  },
  {
    id: "1099-review",
    title: "1099 Review",
    description: "Review reportable vendor payments and filing readiness.",
    href: "/reports/1099",
    group: "payables",
  },
  {
    id: "trial-balance",
    title: "Trial Balance",
    description: "Validate debit and credit balances across the chart of accounts.",
    href: INTERNAL_REPORT_HREFS.trial,
    group: "accounting",
    internalReport: "trial",
  },
  {
    id: "general-ledger",
    title: "General Ledger",
    description: "Inspect posted transactions and running balances by account.",
    href: "/reports/general-ledger",
    group: "accounting",
  },
  {
    id: "saved-reports",
    title: "Saved Reports",
    description:
      "Keep a report from QuickBooks, Wave, or a bank and read it here later. Saved reports never affect a balance.",
    href: "/reports/saved",
    group: "accounting",
  },
  {
    id: "what-if-analysis",
    title: "What-If Analysis",
    description:
      "Lay hypothetical adjustments over real numbers and freeze the result as a report. Analysis never posts to the books.",
    href: "/reports/analysis",
    group: "analysis",
  },
  {
    id: "journal-report",
    title: "Journal Report",
    description: "Review journal entries and their debit and credit lines.",
    href: "/reports/journal",
    group: "accounting",
  },
  {
    id: "transaction-list",
    title: "Transaction List by Date",
    description:
      "Every posted transaction in a date range, one row each, with counterparty, account, bank or card, and reconciled status.",
    href: "/reports/transactions",
    group: "accounting",
  },
  {
    id: "fixed-assets",
    title: "Fixed Asset Register & Depreciation",
    description: "Review asset cost, book value, depreciation schedules, and disposal results.",
    href: "/reports/fixed-assets",
    group: "accounting",
  },
  {
    id: "number-sequence",
    title: "Document Number Sequence",
    description: "Reconcile issued document numbers and flag any break in the sequence.",
    href: "/reports/number-sequence",
    group: "accounting",
  },
  {
    id: "reconciliation-report",
    title: "Reconciliation Report",
    description: "Every bank reconciliation that was signed off, and whether it still agrees with the books.",
    href: "/reports/reconciliations",
    group: "accounting",
  },
  {
    id: "change-log",
    title: "Change Log",
    description: "What changed in the books, when, and by whom, from the audit log.",
    href: "/reports/change-log",
    group: "accounting",
    anyPermissions: CHANGE_LOG_PERMISSIONS,
  },
  {
    id: "month-end-close-log",
    title: "Month-End Close Log",
    description: "Every close and reopen of a fiscal year's months, with when, by whom and why.",
    href: "/reports/close-log",
    group: "accounting",
  },
  {
    id: "voided-entries",
    title: "Voided and Reversed Entries",
    description: "Every entry voided or reversed in a period. Nothing is deleted in OneBook, so nothing is lost.",
    href: "/reports/voided-entries",
    group: "accounting",
  },
  {
    id: "inventory-valuation",
    title: "Inventory Valuation",
    description: "Analyze jewelry quantities, unit costs, and inventory value.",
    href: "/reports/inventory-valuation",
    group: "inventory-tax",
  },
  {
    id: "sales-tax",
    title: "Sales Tax",
    description: "Review taxable sales, collected tax, and filing liabilities.",
    href: "/sales-tax",
    group: "inventory-tax",
  },
];

const INTERNAL_REPORT_IDS: InternalReportId[] = [
  "trial",
  "pnl",
  "balance",
  "budget",
  "equity",
];

export function isInternalReportId(value: unknown): value is InternalReportId {
  return typeof value === "string" && INTERNAL_REPORT_IDS.includes(value as InternalReportId);
}

/**
 * Whether a reader may open a report. A permission list that could not be read
 * (null) refuses a report that asks for one: a hidden card costs a click, a
 * card that opens onto a refusal costs trust.
 */
export function canOpenReport(
  report: Pick<ReportDefinition, "anyPermissions">,
  permissionKeys: readonly string[] | null,
): boolean {
  if (!report.anyPermissions?.length) return true;
  return permissionKeys !== null && report.anyPermissions.some((key) => permissionKeys.includes(key));
}

export function getReportGroup(groupId: ReportGroupId) {
  return REPORT_GROUPS.find((group) => group.id === groupId);
}

export function findReportByLocation(pathname: string, reportParam?: string | null) {
  if (pathname === "/reports" && isInternalReportId(reportParam)) {
    return REPORT_CATALOG.find((report) => report.internalReport === reportParam);
  }

  return REPORT_CATALOG.find((report) => {
    const [reportPath] = report.href.split("?");
    return reportPath !== "/reports" && reportPath === pathname;
  });
}
