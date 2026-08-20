import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  BankTransactionRow,
  InventoryTxnRow,
  StatementReconciliationRow,
} from "@/lib/db/types";
import {
  monthStart,
  overdueAmount,
  trailingMonthWindows,
  within,
  type WorkAreaActivity,
  type WorkAreaBreakdownPoint,
  type WorkAreaOverviewData,
  type WorkAreaTrendPoint,
} from "@/lib/domain/work-area-overview";
import { getArAging, getApAging } from "./aging";
import { listBankAccounts, listBankConnections } from "./banking";
import { todayInTimeZone } from "./dashboard";
import { getCurrentCompanySettings } from "./company";
import { listFixedAssets } from "./fixed-assets";
import { listCustomers, listInvoices, listPayments } from "./invoicing";
import { getInventoryValuation } from "./inventory";
import { listItems } from "./items";
import {
  listBillPayments,
  listBills,
  listExpenses,
  listVendors,
} from "./payables";
import { getReceivedNotBilled, listPurchaseOrders } from "./purchasing";
import { getLedgerBalances } from "./reports";

export interface WorkAreaOverviewContext {
  asOf: string;
  currencyCode: string;
  currencyDecimals: number;
  fiscalYearStartMonth: number;
}

export class WorkAreaOverviewError extends Error {}

/**
 * The application currently operates in USD only. Company time zone still
 * determines the operational cut-off date so every work area shares one
 * consistent "as of" context.
 */
export async function getWorkAreaOverviewContext(
  sb: SupabaseClient,
): Promise<WorkAreaOverviewContext> {
  const company = await getCurrentCompanySettings(sb);
  return {
    asOf: todayInTimeZone(company?.time_zone ?? "America/New_York"),
    currencyCode: "USD",
    currencyDecimals: 2,
    fiscalYearStartMonth: company?.fiscal_year_start_month ?? 1,
  };
}

function statusLabel(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function latestActivities(rows: WorkAreaActivity[], limit = 8): WorkAreaActivity[] {
  return rows
    .sort((a, b) => b.occurredOn.localeCompare(a.occurredOn))
    .slice(0, limit);
}

function monthTrend(
  asOf: string,
  primary: (from: string, to: string) => number,
  secondary: (from: string, to: string) => number,
): WorkAreaTrendPoint[] {
  return trailingMonthWindows(asOf, 12).map((window) => ({
    key: window.key,
    label: window.label,
    primary: primary(window.from, window.to),
    secondary: secondary(window.from, window.to),
  }));
}

const AGING_BREAKDOWN = [
  { key: "current", label: "Current", tone: "positive" },
  { key: "d1_30", label: "1-30 days", tone: "warning" },
  { key: "d31_60", label: "31-60 days", tone: "warning" },
  { key: "d61_90", label: "61-90 days", tone: "negative" },
  { key: "d90_plus", label: "90+ days", tone: "negative" },
] as const;

function agingBreakdownPoints(
  buckets: Record<string, number>,
  href: string,
): WorkAreaBreakdownPoint[] {
  return AGING_BREAKDOWN.map((bucket) => ({
    key: bucket.key,
    label: bucket.label,
    value: Number(buckets[bucket.key] ?? 0),
    href,
    tone: bucket.tone,
  }));
}

function moneyLabel(
  minor: number,
  currencyCode: string,
  currencyDecimals: number,
): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currencyCode,
    minimumFractionDigits: currencyDecimals,
    maximumFractionDigits: currencyDecimals,
  }).format(minor / 10 ** currencyDecimals);
}

export async function getSalesOverview(
  sb: SupabaseClient,
  context: WorkAreaOverviewContext,
): Promise<WorkAreaOverviewData> {
  const { asOf, currencyCode, currencyDecimals } = context;
  const [customers, invoices, payments, aging] = await Promise.all([
    listCustomers(sb),
    listInvoices(sb),
    listPayments(sb),
    getArAging(sb, asOf),
  ]);
  const mtdFrom = monthStart(asOf);
  const issued = invoices.filter((invoice) => !["draft", "void"].includes(invoice.status));
  const open = invoices.filter(
    (invoice) =>
      ["issued", "partial"].includes(invoice.status) && Number(invoice.balance_due_minor) > 0,
  );
  const overdueRows = aging.rows.filter((row) => row.bucket !== "current");
  const validPayments = payments.filter((payment) => payment.status !== "void");
  const mtdInvoices = issued.filter((invoice) => within(invoice.issue_date, mtdFrom, asOf));
  const mtdPayments = validPayments.filter((payment) =>
    within(payment.payment_date, mtdFrom, asOf),
  );
  const unapplied = validPayments.filter((payment) => Number(payment.unapplied_minor) > 0);

  const activities: WorkAreaActivity[] = [
    ...invoices.slice(0, 12).map((invoice) => ({
      key: `invoice:${invoice.id}`,
      title: invoice.invoice_number
        ? `Invoice ${invoice.invoice_number}`
        : "Draft invoice",
      detail: invoice.customer_name,
      occurredOn: invoice.issue_date,
      valueMinor: Number(invoice.total_minor),
      href: "/invoices",
      status: statusLabel(invoice.status),
    })),
    ...payments.slice(0, 12).map((payment) => ({
      key: `payment:${payment.id}`,
      title: payment.payment_number
        ? `Payment ${payment.payment_number}`
        : "Customer payment",
      detail: payment.customer_name,
      occurredOn: payment.payment_date,
      valueMinor: Number(payment.amount_minor),
      href: "/payments",
      status: statusLabel(payment.status),
    })),
  ];

  return {
    area: "sales",
    title: "Sales overview",
    description:
      "Monitor customer billing, collections, overdue balances, and Accounts Receivable control.",
    asOf,
    currencyCode,
    currencyDecimals,
    primaryAction: { label: "New invoice", href: "/invoices?new=1" },
    metrics: [
      {
        key: "open-receivables",
        label: "Open receivables",
        value: aging.total,
        valueType: "money",
        caption: `${open.length} open invoices`,
        href: "/reports/ar-aging",
        tone: aging.reconciled ? "neutral" : "warning",
        icon: "receivable",
      },
      {
        key: "overdue",
        label: "Overdue",
        value: overdueAmount(aging.buckets),
        valueType: "money",
        caption: `${overdueRows.length} invoices past due`,
        href: "/reports/ar-aging",
        tone: overdueRows.length > 0 ? "negative" : "positive",
        icon: "overdue",
      },
      {
        key: "invoiced-mtd",
        label: "Invoiced this month",
        value: mtdInvoices.reduce((sum, invoice) => sum + Number(invoice.total_minor), 0),
        valueType: "money",
        caption: `${mtdInvoices.length} issued invoices`,
        href: "/invoices",
        tone: "neutral",
        icon: "sales",
      },
      {
        key: "collected-mtd",
        label: "Collected this month",
        value: mtdPayments.reduce((sum, payment) => sum + Number(payment.amount_minor), 0),
        valueType: "money",
        caption: `${mtdPayments.length} customer payments`,
        href: "/payments",
        tone: "positive",
        icon: "cash",
      },
    ],
    trend: {
      title: "Billing and collections",
      description: "Issued invoices compared with customer payments for the selected trend window.",
      primaryLabel: "Invoiced",
      secondaryLabel: "Collected",
      valueType: "money",
      points: monthTrend(
        asOf,
        (from, to) =>
          issued
            .filter((invoice) => within(invoice.issue_date, from, to))
            .reduce((sum, invoice) => sum + Number(invoice.total_minor), 0),
        (from, to) =>
          validPayments
            .filter((payment) => within(payment.payment_date, from, to))
            .reduce((sum, payment) => sum + Number(payment.amount_minor), 0),
      ),
    },
    breakdowns: [
      {
        key: "receivables-aging",
        title: "Receivables aging",
        description: "Open customer balances grouped by due-date risk.",
        valueType: "money",
        points: agingBreakdownPoints(aging.buckets, "/reports/ar-aging"),
      },
      {
        key: "invoice-status",
        title: "Invoice status mix",
        description: "Invoice volume by current workflow status.",
        valueType: "number",
        points: [
          {
            key: "draft",
            label: "Draft",
            value: invoices.filter((invoice) => invoice.status === "draft").length,
            href: "/invoices",
            tone: "neutral",
          },
          {
            key: "open",
            label: "Awaiting payment",
            value: open.length,
            href: "/invoices",
            tone: "warning",
          },
          {
            key: "paid",
            label: "Paid",
            value: invoices.filter((invoice) => invoice.status === "paid").length,
            href: "/invoices",
            tone: "positive",
          },
          {
            key: "void",
            label: "Void",
            value: invoices.filter((invoice) => invoice.status === "void").length,
            href: "/invoices",
            tone: "negative",
          },
        ],
      },
    ],
    stages: [
      {
        key: "draft",
        label: "Draft",
        count: invoices.filter((invoice) => invoice.status === "draft").length,
        valueMinor: invoices
          .filter((invoice) => invoice.status === "draft")
          .reduce((sum, invoice) => sum + Number(invoice.total_minor), 0),
        href: "/invoices",
        tone: "neutral",
      },
      {
        key: "open",
        label: "Awaiting payment",
        count: open.length,
        valueMinor: open.reduce(
          (sum, invoice) => sum + Number(invoice.balance_due_minor),
          0,
        ),
        href: "/invoices",
        tone: "warning",
      },
      {
        key: "paid",
        label: "Paid",
        count: invoices.filter((invoice) => invoice.status === "paid").length,
        valueMinor: invoices
          .filter((invoice) => invoice.status === "paid")
          .reduce((sum, invoice) => sum + Number(invoice.total_minor), 0),
        href: "/invoices",
        tone: "positive",
      },
    ],
    exceptions: [
      {
        key: "overdue",
        title: "Overdue customer balances",
        detail: "Prioritize collections by due-date risk.",
        count: overdueRows.length,
        valueMinor: overdueAmount(aging.buckets),
        href: "/reports/ar-aging",
        severity: "high",
      },
      {
        key: "unapplied",
        title: "Unapplied customer payments",
        detail: "Allocate receipts to eligible customer invoices.",
        count: unapplied.length,
        valueMinor: unapplied.reduce(
          (sum, payment) => sum + Number(payment.unapplied_minor),
          0,
        ),
        href: "/payments",
        severity: "medium",
      },
      {
        key: "ar-control",
        title: "Accounts Receivable control",
        detail: aging.reconciled
          ? "Aging agrees with the Accounts Receivable control account."
          : "Aging differs from the Accounts Receivable control account.",
        count: aging.reconciled ? 0 : 1,
        valueMinor: Math.abs(aging.total - aging.controlBalanceMinor),
        href: "/reports/ar-aging",
        severity: aging.reconciled ? "low" : "high",
      },
    ],
    activities: latestActivities(activities),
    links: [
      {
        key: "customers",
        label: "Customers",
        description: `${customers.filter((customer) => customer.is_active).length} active customer records`,
        href: "/customers",
      },
      {
        key: "statements",
        label: "Customer statements",
        description: "Review invoice, payment, credit, and running-balance history.",
        href: "/reports/customer-statement",
      },
      {
        key: "credits",
        label: "Credit memos",
        description: "Review credits, applications, write-offs, and refunds.",
        href: "/credit-memos",
      },
      {
        key: "sales-tax",
        label: "Sales tax",
        description: "Review liability, configured tax codes, and payments.",
        href: "/sales-tax",
      },
    ],
    control: {
      title: "Accounts Receivable reconciliation",
      detail: aging.reconciled
        ? "Open customer balances reconcile to the ledger control account."
        : `Review a ${moneyLabel(
            Math.abs(aging.total - aging.controlBalanceMinor),
            currencyCode,
            currencyDecimals,
          )} difference.`,
      href: "/reports/ar-aging",
      status: aging.reconciled ? "healthy" : "attention",
    },
  };
}

export async function getPurchasesOverview(
  sb: SupabaseClient,
  context: WorkAreaOverviewContext,
): Promise<WorkAreaOverviewData> {
  const { asOf, currencyCode, currencyDecimals } = context;
  const [vendors, bills, expenses, payments, purchaseOrders, receivedNotBilled, aging] =
    await Promise.all([
      listVendors(sb),
      listBills(sb),
      listExpenses(sb),
      listBillPayments(sb),
      listPurchaseOrders(sb),
      getReceivedNotBilled(sb),
      getApAging(sb, asOf),
    ]);
  const mtdFrom = monthStart(asOf);
  const postedBills = bills.filter((bill) => !["draft", "void"].includes(bill.status));
  const openBills = bills.filter(
    (bill) => ["open", "partial"].includes(bill.status) && Number(bill.balance_due_minor) > 0,
  );
  const validPayments = payments.filter((payment) => payment.status !== "void");
  const openOrders = purchaseOrders.filter((order) =>
    ["open", "partial", "received"].includes(order.status),
  );
  const overdueRows = aging.rows.filter((row) => row.bucket !== "current");
  const draftBills = bills.filter((bill) => bill.status === "draft");
  const activities: WorkAreaActivity[] = [
    ...bills.slice(0, 10).map((bill) => ({
      key: `bill:${bill.id}`,
      title: bill.bill_number ? `Bill ${bill.bill_number}` : "Draft bill",
      detail: bill.vendor_name,
      occurredOn: bill.bill_date,
      valueMinor: Number(bill.total_minor),
      href: "/bills",
      status: statusLabel(bill.status),
    })),
    ...purchaseOrders.slice(0, 10).map((order) => ({
      key: `po:${order.id}`,
      title: order.po_number ? `Purchase order ${order.po_number}` : "Draft purchase order",
      detail: order.vendor_name,
      occurredOn: order.order_date,
      valueMinor: Number(order.total_minor),
      href: `/purchase-orders/${order.id}`,
      status: statusLabel(order.status),
    })),
    ...expenses.slice(0, 8).map((expense) => ({
      key: `expense:${expense.id}`,
      title: expense.expense_number ? `Expense ${expense.expense_number}` : "Expense",
      detail: expense.vendor_name,
      occurredOn: expense.expense_date,
      valueMinor: Number(expense.total_minor),
      href: "/expenses",
      status: statusLabel(expense.status),
    })),
  ];

  return {
    area: "purchases",
    title: "Purchases overview",
    description:
      "Manage vendor commitments, bills, payments, receiving, and Accounts Payable exceptions.",
    asOf,
    currencyCode,
    currencyDecimals,
    primaryAction: { label: "New bill", href: "/bills?new=1" },
    metrics: [
      {
        key: "open-payables",
        label: "Open payables",
        value: aging.total,
        valueType: "money",
        caption: `${openBills.length} unpaid bills`,
        href: "/reports/ap-aging",
        tone: aging.reconciled ? "neutral" : "warning",
        icon: "payable",
      },
      {
        key: "overdue",
        label: "Overdue bills",
        value: overdueAmount(aging.buckets),
        valueType: "money",
        caption: `${overdueRows.length} bills past due`,
        href: "/reports/ap-aging",
        tone: overdueRows.length > 0 ? "negative" : "positive",
        icon: "overdue",
      },
      {
        key: "open-orders",
        label: "Open commitments",
        value: openOrders.reduce((sum, order) => sum + Number(order.total_minor), 0),
        valueType: "money",
        caption: `${openOrders.length} purchase orders`,
        href: "/purchase-orders",
        tone: "neutral",
        icon: "purchase-order",
      },
      {
        key: "bills-mtd",
        label: "Bills this month",
        value: postedBills
          .filter((bill) => within(bill.bill_date, mtdFrom, asOf))
          .reduce((sum, bill) => sum + Number(bill.total_minor), 0),
        valueType: "money",
        caption: `${postedBills.filter((bill) => within(bill.bill_date, mtdFrom, asOf)).length} posted bills`,
        href: "/bills",
        tone: "neutral",
        icon: "payable",
      },
    ],
    trend: {
      title: "Bills and vendor payments",
      description: "Posted vendor bills compared with cash paid for the selected trend window.",
      primaryLabel: "Bills",
      secondaryLabel: "Paid",
      valueType: "money",
      points: monthTrend(
        asOf,
        (from, to) =>
          postedBills
            .filter((bill) => within(bill.bill_date, from, to))
            .reduce((sum, bill) => sum + Number(bill.total_minor), 0),
        (from, to) =>
          validPayments
            .filter((payment) => within(payment.payment_date, from, to))
            .reduce((sum, payment) => sum + Number(payment.amount_minor), 0),
      ),
    },
    breakdowns: [
      {
        key: "payables-aging",
        title: "Payables aging",
        description: "Open vendor balances grouped by payment urgency.",
        valueType: "money",
        points: agingBreakdownPoints(aging.buckets, "/reports/ap-aging"),
      },
      {
        key: "purchase-order-status",
        title: "Purchase order pipeline",
        description: "Purchase orders grouped by receiving progress.",
        valueType: "number",
        points: [
          {
            key: "draft",
            label: "Draft",
            value: purchaseOrders.filter((order) => order.status === "draft").length,
            href: "/purchase-orders",
            tone: "neutral",
          },
          {
            key: "open",
            label: "Open or partial",
            value: purchaseOrders.filter((order) =>
              ["open", "partial"].includes(order.status),
            ).length,
            href: "/purchase-orders",
            tone: "warning",
          },
          {
            key: "received",
            label: "Received",
            value: purchaseOrders.filter((order) => order.status === "received").length,
            href: "/purchase-orders",
            tone: "positive",
          },
          {
            key: "closed",
            label: "Closed",
            value: purchaseOrders.filter((order) => order.status === "closed").length,
            href: "/purchase-orders",
            tone: "positive",
          },
        ],
      },
    ],
    stages: [
      {
        key: "draft",
        label: "Draft purchase orders",
        count: purchaseOrders.filter((order) => order.status === "draft").length,
        valueMinor: purchaseOrders
          .filter((order) => order.status === "draft")
          .reduce((sum, order) => sum + Number(order.total_minor), 0),
        href: "/purchase-orders",
        tone: "neutral",
      },
      {
        key: "open",
        label: "Open / partial",
        count: purchaseOrders.filter((order) => ["open", "partial"].includes(order.status))
          .length,
        valueMinor: purchaseOrders
          .filter((order) => ["open", "partial"].includes(order.status))
          .reduce((sum, order) => sum + Number(order.total_minor), 0),
        href: "/purchase-orders",
        tone: "warning",
      },
      {
        key: "received",
        label: "Received / closed",
        count: purchaseOrders.filter((order) => ["received", "closed"].includes(order.status))
          .length,
        valueMinor: purchaseOrders
          .filter((order) => ["received", "closed"].includes(order.status))
          .reduce((sum, order) => sum + Number(order.total_minor), 0),
        href: "/purchase-orders",
        tone: "positive",
      },
    ],
    exceptions: [
      {
        key: "overdue",
        title: "Overdue vendor balances",
        detail: "Review payment timing and available credits.",
        count: overdueRows.length,
        valueMinor: overdueAmount(aging.buckets),
        href: "/reports/ap-aging",
        severity: "high",
      },
      {
        key: "received-not-billed",
        title: "Received, not billed",
        detail: "Goods received without a matching vendor bill.",
        count: receivedNotBilled.length,
        valueMinor: receivedNotBilled.reduce(
          (sum, row) => sum + Number(row.value_minor),
          0,
        ),
        href: "/purchase-orders/received-not-billed",
        severity: "medium",
      },
      {
        key: "draft-bills",
        title: "Draft bills",
        detail: "Bills still waiting for review and posting.",
        count: draftBills.length,
        valueMinor: draftBills.reduce((sum, bill) => sum + Number(bill.total_minor), 0),
        href: "/bills",
        severity: "low",
      },
      {
        key: "ap-control",
        title: "Accounts Payable control",
        detail: aging.reconciled
          ? "Aging agrees with the Accounts Payable control account."
          : "Aging differs from the Accounts Payable control account.",
        count: aging.reconciled ? 0 : 1,
        valueMinor: Math.abs(aging.total - aging.controlBalanceMinor),
        href: "/reports/ap-aging",
        severity: aging.reconciled ? "low" : "high",
      },
    ],
    activities: latestActivities(activities),
    links: [
      {
        key: "vendors",
        label: "Vendors",
        description: `${vendors.filter((vendor) => vendor.is_active).length} active vendor records`,
        href: "/vendors",
      },
      {
        key: "pay-bills",
        label: "Pay bills",
        description: "Prepare and record vendor payments against open balances.",
        href: "/pay-bills",
      },
      {
        key: "vendor-credits",
        label: "Vendor credits",
        description: "Apply eligible credits without overstating payments.",
        href: "/vendor-credits",
      },
      {
        key: "vendor-statements",
        label: "Vendor statements",
        description: "Reconcile bills, credits, payments, and closing balances.",
        href: "/reports/vendor-statement",
      },
    ],
    control: {
      title: "Accounts Payable reconciliation",
      detail: aging.reconciled
        ? "Open vendor balances reconcile to the ledger control account."
        : `Review a ${moneyLabel(
            Math.abs(aging.total - aging.controlBalanceMinor),
            currencyCode,
            currencyDecimals,
          )} difference.`,
      href: "/reports/ap-aging",
      status: aging.reconciled ? "healthy" : "attention",
    },
  };
}

export async function getBankingOverview(
  sb: SupabaseClient,
  context: WorkAreaOverviewContext,
): Promise<WorkAreaOverviewData> {
  const { asOf, currencyCode, currencyDecimals } = context;
  const [bankAccounts, connections, ledger, transactionResult, reconciliationResult] =
    await Promise.all([
      listBankAccounts(sb),
      listBankConnections(sb),
      getLedgerBalances(sb, null, asOf),
      sb
        .from("acc_bank_transaction")
        .select("*")
        .is("provider_removed_at", null)
        .lte("txn_date", asOf)
        .order("txn_date", { ascending: false }),
      sb
        .from("acc_statement_reconciliation")
        .select("*")
        .order("statement_ending_date", { ascending: false }),
    ]);
  if (transactionResult.error) throw new WorkAreaOverviewError(transactionResult.error.message);
  if (reconciliationResult.error) {
    throw new WorkAreaOverviewError(reconciliationResult.error.message);
  }
  const transactions = (transactionResult.data ?? []) as unknown as BankTransactionRow[];
  const reconciliations = (reconciliationResult.data ??
    []) as unknown as StatementReconciliationRow[];
  const unmatched = transactions.filter((transaction) => transaction.status === "unmatched");
  const matched = transactions.filter((transaction) => transaction.status === "matched");
  const ignored = transactions.filter((transaction) => transaction.status === "ignored");
  const cashBalance = ledger
    .filter((row) => bankAccounts.some((account) => account.account_id === row.accountId))
    .reduce((sum, row) => sum + row.debitBase - row.creditBase, 0);
  const attentionConnections = connections.filter(
    (connection) => connection.status !== "active" || Boolean(connection.last_error),
  );
  const pendingTransactions = transactions.filter((transaction) => transaction.pending);
  const readyForReview = unmatched.filter((transaction) => !transaction.pending);
  const inProgress = reconciliations.filter(
    (reconciliation) => reconciliation.status === "in_progress",
  );
  const completed = reconciliations.filter(
    (reconciliation) => reconciliation.status === "completed",
  );

  return {
    area: "banking",
    title: "Banking overview",
    description:
      "Review imported activity, feed health, matching progress, and statement reconciliation.",
    asOf,
    currencyCode,
    currencyDecimals,
    primaryAction: { label: "Review transactions", href: "/banking" },
    metrics: [
      {
        key: "cash",
        label: "Ledger cash",
        value: cashBalance,
        valueType: "money",
        caption: `${bankAccounts.length} mapped bank accounts`,
        href: "/reports/cash-flow",
        tone: cashBalance >= 0 ? "positive" : "negative",
        icon: "bank",
      },
      {
        key: "for-review",
        label: "For review",
        value: unmatched.length,
        valueType: "number",
        caption: `${unmatched.length} transactions require review`,
        href: "/banking",
        tone: unmatched.length > 0 ? "warning" : "positive",
        icon: "review",
      },
      {
        key: "matched",
        label: "Matched transactions",
        value: matched.length,
        valueType: "number",
        caption: `${ignored.length} excluded from posting`,
        href: "/banking",
        tone: "positive",
        icon: "cash",
      },
      {
        key: "feed-health",
        label: "Feed connections",
        value: connections.filter((connection) => connection.status === "active").length,
        valueType: "number",
        caption:
          attentionConnections.length > 0
            ? `${attentionConnections.length} require attention`
            : "All connected feeds are healthy",
        href: "/banking",
        tone: attentionConnections.length > 0 ? "negative" : "positive",
        icon: "connection",
      },
    ],
    trend: {
      title: "Bank activity",
      description: "Imported inflows and outflows for the selected trend window.",
      primaryLabel: "Inflows",
      secondaryLabel: "Outflows",
      valueType: "money",
      points: monthTrend(
        asOf,
        (from, to) =>
          transactions
            .filter(
              (transaction) =>
                within(transaction.txn_date, from, to) &&
                Number(transaction.amount_minor) > 0,
            )
            .reduce((sum, transaction) => sum + Number(transaction.amount_minor), 0),
        (from, to) =>
          transactions
            .filter(
              (transaction) =>
                within(transaction.txn_date, from, to) &&
                Number(transaction.amount_minor) < 0,
            )
            .reduce((sum, transaction) => sum + Math.abs(Number(transaction.amount_minor)), 0),
      ),
    },
    breakdowns: [
      {
        key: "transaction-review-status",
        title: "Transaction review status",
        description: "Imported activity grouped by matching disposition.",
        valueType: "number",
        points: [
          {
            key: "unmatched",
            label: "For review",
            value: readyForReview.length,
            href: "/banking",
            tone: "warning",
          },
          {
            key: "matched",
            label: "Matched",
            value: matched.length,
            href: "/banking",
            tone: "positive",
          },
          {
            key: "ignored",
            label: "Excluded",
            value: ignored.length,
            href: "/banking",
            tone: "neutral",
          },
          {
            key: "pending",
            label: "Provider pending",
            value: pendingTransactions.length,
            href: "/banking",
            tone: "warning",
          },
        ],
      },
      {
        key: "reconciliation-status",
        title: "Reconciliation sessions",
        description: "Statement reconciliations grouped by completion status.",
        valueType: "number",
        points: [
          {
            key: "in-progress",
            label: "In progress",
            value: inProgress.length,
            href: "/banking/reconcile",
            tone: "warning",
          },
          {
            key: "completed",
            label: "Completed",
            value: completed.length,
            href: "/banking/reconcile",
            tone: "positive",
          },
        ],
      },
    ],
    stages: [
      {
        key: "unmatched",
        label: "For review",
        count: unmatched.length,
        valueMinor: unmatched.reduce(
          (sum, transaction) => sum + Math.abs(Number(transaction.amount_minor)),
          0,
        ),
        href: "/banking",
        tone: "warning",
      },
      {
        key: "matched",
        label: "Matched",
        count: matched.length,
        valueMinor: matched.reduce(
          (sum, transaction) => sum + Math.abs(Number(transaction.amount_minor)),
          0,
        ),
        href: "/banking",
        tone: "positive",
      },
      {
        key: "ignored",
        label: "Excluded",
        count: ignored.length,
        valueMinor: ignored.reduce(
          (sum, transaction) => sum + Math.abs(Number(transaction.amount_minor)),
          0,
        ),
        href: "/banking",
        tone: "neutral",
      },
    ],
    exceptions: [
      {
        key: "unmatched",
        title: "Unreviewed bank transactions",
        detail: "Match, categorize, transfer, split, or exclude each item.",
        count: unmatched.length,
        valueMinor: unmatched.reduce(
          (sum, transaction) => sum + Math.abs(Number(transaction.amount_minor)),
          0,
        ),
        href: "/banking",
        severity: "high",
      },
      {
        key: "feeds",
        title: "Bank-feed connections",
        detail: "Resolve expired consent, provider errors, or disconnected feeds.",
        count: attentionConnections.length,
        href: "/banking",
        severity: "high",
      },
      {
        key: "pending",
        title: "Pending bank activity",
        detail: "Pending provider transactions may still change before posting.",
        count: pendingTransactions.length,
        valueMinor: pendingTransactions.reduce(
          (sum, transaction) => sum + Math.abs(Number(transaction.amount_minor)),
          0,
        ),
        href: "/banking",
        severity: "medium",
      },
      {
        key: "reconciliation",
        title: "Reconciliations in progress",
        detail: "Complete statement sessions and resolve remaining differences.",
        count: inProgress.length,
        href: "/banking/reconcile",
        severity: "medium",
      },
    ],
    activities: transactions.slice(0, 8).map((transaction) => ({
      key: `bank:${transaction.id}`,
      title: transaction.merchant_name || transaction.description,
      detail: `${transaction.source === "bank_feed" ? "Bank feed" : "Statement import"} · ${statusLabel(transaction.status)}`,
      occurredOn: transaction.txn_date,
      valueMinor: Number(transaction.amount_minor),
      href: "/banking",
      status: transaction.pending ? "Pending" : statusLabel(transaction.status),
    })),
    links: [
      {
        key: "transactions",
        label: "Bank transactions",
        description: "Review imported statement and bank-feed activity.",
        href: "/banking",
      },
      {
        key: "reconcile",
        label: "Reconcile",
        description: "Tie cleared ledger activity to a statement ending balance.",
        href: "/banking/reconcile",
      },
      {
        key: "cash-flow",
        label: "Cash flow statement",
        description: "Review operating, investing, and financing cash movement.",
        href: "/reports/cash-flow",
      },
      {
        key: "general-ledger",
        label: "General Ledger",
        description: "Drill into the posted activity behind cash account balances.",
        href: "/reports/general-ledger",
      },
    ],
    control: {
      title: "Statement reconciliation",
      detail:
        inProgress.length > 0
          ? `${inProgress.length} reconciliation sessions are still in progress.`
          : `${completed.length} completed sessions are locked and reproducible.`,
      href: "/banking/reconcile",
      status: inProgress.length > 0 ? "attention" : completed.length > 0 ? "healthy" : "neutral",
    },
  };
}

export async function getInventoryOverview(
  sb: SupabaseClient,
  context: WorkAreaOverviewContext,
): Promise<WorkAreaOverviewData> {
  const { asOf, currencyCode, currencyDecimals } = context;
  const twelveMonthsAgo = trailingMonthWindows(asOf, 12)[0].from;
  const [items, valuation, assets, movementResult] = await Promise.all([
    listItems(sb),
    getInventoryValuation(sb, asOf),
    listFixedAssets(sb),
    sb
      .from("acc_inventory_txn")
      .select("*")
      .gte("txn_date", twelveMonthsAgo)
      .lte("txn_date", asOf)
      .order("txn_date", { ascending: false }),
  ]);
  if (movementResult.error) throw new WorkAreaOverviewError(movementResult.error.message);
  const movements = (movementResult.data ?? []) as unknown as InventoryTxnRow[];
  const inventoryItems = items.filter((item) => item.is_inventory && item.is_active);
  const zeroStock = valuation.rows.filter((row) => Number(row.qty_on_hand) === 0);
  const negativeStock = valuation.rows.filter((row) => Number(row.qty_on_hand) < 0);
  const dueAssets = assets.filter((asset) => Number(asset.due_depreciation_minor) > 0);
  const activeAssets = assets.filter((asset) => asset.status !== "disposed");
  const netBookValue = activeAssets.reduce(
    (sum, asset) => sum + Number(asset.net_book_value_minor),
    0,
  );
  const topInventory = [...valuation.rows]
    .filter((row) => Number(row.value_minor) > 0)
    .sort((left, right) => Number(right.value_minor) - Number(left.value_minor))
    .slice(0, 5);

  return {
    area: "inventory",
    title: "Inventory & assets overview",
    description:
      "Monitor jewelry stock, valuation controls, inventory movement, and fixed-asset depreciation.",
    asOf,
    currencyCode,
    currencyDecimals,
    primaryAction: { label: "Products & services", href: "/items" },
    metrics: [
      {
        key: "valuation",
        label: "Inventory value",
        value: valuation.subledgerValueMinor,
        valueType: "money",
        caption: `${valuation.rows.length} valued items`,
        href: "/reports/inventory-valuation",
        tone: valuation.tiesOut ? "positive" : "negative",
        icon: "inventory",
      },
      {
        key: "quantity",
        label: "Quantity on hand",
        value: valuation.rows.reduce((sum, row) => sum + Number(row.qty_on_hand), 0),
        valueType: "number",
        caption: `${zeroStock.length} zero-stock items`,
        href: "/items",
        tone: negativeStock.length > 0 ? "negative" : "neutral",
        icon: "quantity",
      },
      {
        key: "asset-book-value",
        label: "Fixed-asset book value",
        value: netBookValue,
        valueType: "money",
        caption: `${activeAssets.length} active assets`,
        href: "/fixed-assets",
        tone: "neutral",
        icon: "asset",
      },
      {
        key: "depreciation-due",
        label: "Depreciation due",
        value: dueAssets.reduce(
          (sum, asset) => sum + Number(asset.due_depreciation_minor),
          0,
        ),
        valueType: "money",
        caption: `${dueAssets.length} assets require posting`,
        href: "/fixed-assets",
        tone: dueAssets.length > 0 ? "warning" : "positive",
        icon: "overdue",
      },
    ],
    trend: {
      title: "Inventory movement",
      description: "Receipt value compared with issues and adjustments for the selected trend window.",
      primaryLabel: "Inbound value",
      secondaryLabel: "Outbound value",
      valueType: "money",
      points: monthTrend(
        asOf,
        (from, to) =>
          movements
            .filter(
              (movement) =>
                within(movement.txn_date, from, to) &&
                Number(movement.cost_delta_minor) > 0,
            )
            .reduce((sum, movement) => sum + Number(movement.cost_delta_minor), 0),
        (from, to) =>
          movements
            .filter(
              (movement) =>
                within(movement.txn_date, from, to) &&
                Number(movement.cost_delta_minor) < 0,
            )
            .reduce(
              (sum, movement) => sum + Math.abs(Number(movement.cost_delta_minor)),
              0,
            ),
      ),
    },
    breakdowns: [
      {
        key: "inventory-concentration",
        title: "Jewelry value concentration",
        description: "Highest-value jewelry holdings at the reporting date.",
        valueType: "money",
        points: topInventory.map((row) => ({
          key: row.item_id,
          label: row.item_code ? `${row.item_code} - ${row.name}` : row.name,
          value: Number(row.value_minor),
          href: "/reports/inventory-valuation",
          tone: "neutral",
        })),
      },
      {
        key: "stock-availability",
        title: "Stock availability",
        description: "Active jewelry items grouped by quantity position.",
        valueType: "number",
        points: [
          {
            key: "in-stock",
            label: "In stock",
            value: valuation.rows.filter((row) => Number(row.qty_on_hand) > 0).length,
            href: "/items",
            tone: "positive",
          },
          {
            key: "zero-stock",
            label: "Out of stock",
            value: zeroStock.length,
            href: "/items",
            tone: "warning",
          },
          {
            key: "negative-stock",
            label: "Negative stock",
            value: negativeStock.length,
            href: "/items",
            tone: "negative",
          },
        ],
      },
    ],
    stages: [
      {
        key: "active-items",
        label: "Active inventory items",
        count: inventoryItems.length,
        valueMinor: valuation.subledgerValueMinor,
        href: "/items",
        tone: "neutral",
      },
      {
        key: "zero-stock",
        label: "Zero stock",
        count: zeroStock.length,
        valueMinor: zeroStock.reduce((sum, row) => sum + Number(row.value_minor), 0),
        href: "/items",
        tone: zeroStock.length > 0 ? "warning" : "positive",
      },
      {
        key: "fixed-assets",
        label: "Fixed assets in service",
        count: assets.filter((asset) => asset.status === "in_service").length,
        valueMinor: netBookValue,
        href: "/fixed-assets",
        tone: "positive",
      },
    ],
    exceptions: [
      {
        key: "tieout",
        title: "Inventory control reconciliation",
        detail: valuation.tiesOut
          ? "Inventory subledger agrees with the ledger control accounts."
          : "Inventory subledger differs from the ledger control accounts.",
        count: valuation.tiesOut ? 0 : 1,
        valueMinor: Math.abs(
          valuation.subledgerValueMinor - valuation.controlBalanceMinor,
        ),
        href: "/reports/inventory-valuation",
        severity: valuation.tiesOut ? "low" : "high",
      },
      {
        key: "negative",
        title: "Negative inventory",
        detail: "Review backdated issues, receipts, and adjustment policy.",
        count: negativeStock.length,
        href: "/items",
        severity: "high",
      },
      {
        key: "zero",
        title: "Out-of-stock jewelry",
        detail: "Review replenishment requirements for active items.",
        count: zeroStock.length,
        href: "/items",
        severity: "medium",
      },
      {
        key: "depreciation",
        title: "Depreciation awaiting posting",
        detail: "Post due schedules through the approved fixed-asset workflow.",
        count: dueAssets.length,
        valueMinor: dueAssets.reduce(
          (sum, asset) => sum + Number(asset.due_depreciation_minor),
          0,
        ),
        href: "/fixed-assets",
        severity: "medium",
      },
    ],
    activities: movements.slice(0, 8).map((movement) => {
      const item = items.find((candidate) => candidate.id === movement.item_id);
      return {
        key: `inventory:${movement.id}`,
        title: item?.name ?? "Inventory movement",
        detail: `${statusLabel(movement.source)} · ${Number(movement.qty_delta) > 0 ? "+" : ""}${Number(movement.qty_delta).toLocaleString("en-US")} units`,
        occurredOn: movement.txn_date,
        valueMinor: Number(movement.cost_delta_minor),
        href: "/items",
        status: statusLabel(movement.source),
      };
    }),
    links: [
      {
        key: "items",
        label: "Products & services",
        description: "Maintain jewelry SKUs, pricing, cost, taxability, and accounts.",
        href: "/items",
      },
      {
        key: "valuation",
        label: "Inventory valuation",
        description: "Tie quantity and weighted-average value to ledger controls.",
        href: "/reports/inventory-valuation",
      },
      {
        key: "assets",
        label: "Fixed assets",
        description: "Manage the asset register, depreciation, and disposals.",
        href: "/fixed-assets",
      },
      {
        key: "purchasing",
        label: "Purchase orders",
        description: "Trace ordered, received, and billed jewelry purchases.",
        href: "/purchase-orders",
      },
    ],
    control: {
      title: "Inventory subledger reconciliation",
      detail: valuation.tiesOut
        ? "Inventory quantity and value reconcile to ledger control accounts."
        : `Resolve a ${moneyLabel(
            Math.abs(valuation.subledgerValueMinor - valuation.controlBalanceMinor),
            currencyCode,
            currencyDecimals,
          )} difference.`,
      href: "/reports/inventory-valuation",
      status: valuation.tiesOut ? "healthy" : "attention",
    },
  };
}
