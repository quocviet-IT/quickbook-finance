export type ReportGroupId =
  | "business-overview"
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
}

export const REPORT_GROUPS: ReportGroupDefinition[] = [
  {
    id: "business-overview",
    label: "Business Overview",
    description: "Core financial statements and performance comparisons.",
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
    id: "journal-report",
    title: "Journal Report",
    description: "Review journal entries and their debit and credit lines.",
    href: "/reports/journal",
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
