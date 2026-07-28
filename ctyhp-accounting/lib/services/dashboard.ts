import type { SupabaseClient } from "@supabase/supabase-js";
import { getLedgerBalances } from "./reports";
import { getArAgeing, getApAgeing, type AgeingReport } from "./ageing";
import { searchAudit } from "./access";
import { getCashFlow } from "./cashflow";
import { getInventoryValuation } from "./inventory";
import { getDashboardWorkQueue } from "./work-queue";
import { buildProfitAndLoss } from "@/lib/domain/reports";
import type { DashboardWorkQueue } from "@/lib/domain/work-queue";
import type { AuditEntryRow } from "@/lib/db/types";

export class DashboardError extends Error {}

export interface AgeingSnapshot {
  current: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90_plus: number;
}

export interface DashboardMetrics {
  cashMinor: number;
  currentAssetsMinor: number;
  currentLiabilitiesMinor: number;
  workingCapitalMinor: number;
  currentRatio: number | null;
  overdueArMinor: number;
  overdueApMinor: number;
  overdueArCount: number;
  overdueApCount: number;
  arAgeing: AgeingSnapshot;
  apAgeing: AgeingSnapshot;
  unreconciledCount: number;
  unreconciledMinor: number;
  openPastPeriods: number;
  mtdNetIncomeMinor: number;
  pendingApprovals: number;
}

export interface MonthlyPerformancePoint {
  key: string;
  label: string;
  incomeMinor: number;
  expenseMinor: number;
  netIncomeMinor: number;
}

export interface PerformanceSnapshot {
  revenueMinor: number;
  cogsMinor: number;
  grossProfitMinor: number;
  operatingExpenseMinor: number;
  totalExpenseMinor: number;
  netIncomeMinor: number;
  grossMarginPercent: number | null;
  netMarginPercent: number | null;
}

export interface PeriodComparison {
  currentLabel: string;
  priorLabel: string;
  current: PerformanceSnapshot;
  prior: PerformanceSnapshot;
  revenueChangePercent: number | null;
  expenseChangePercent: number | null;
  netIncomeChangeMinor: number;
  grossMarginChangePoints: number | null;
}

export interface CashMovementSnapshot {
  operatingMinor: number;
  investingMinor: number;
  financingMinor: number;
  netChangeMinor: number;
  openingMinor: number;
  closingMinor: number;
  tiesOut: boolean;
}

export interface InventoryHolding {
  itemId: string;
  code: string | null;
  name: string;
  quantity: number;
  valueMinor: number;
  sharePercent: number;
}

export interface InventoryDashboardSnapshot {
  valueMinor: number;
  quantity: number;
  itemCount: number;
  zeroStockCount: number;
  slowMovingCount: number;
  slowMovingValueMinor: number;
  tiesOut: boolean;
  topHoldings: InventoryHolding[];
}

export interface OperatingPulse {
  invoices: { count: number; amountMinor: number };
  customerPayments: { count: number; amountMinor: number };
  bills: { count: number; amountMinor: number };
  goodsReceipts: { count: number };
}

export type DashboardActivityCategory =
  | "sales"
  | "purchases"
  | "inventory"
  | "banking"
  | "close"
  | "governance"
  | "other";

export interface DashboardActivity {
  id: string;
  occurredAt: string;
  actor: string;
  verb: string;
  entity: string;
  reference: string | null;
  href: string;
  category: DashboardActivityCategory;
}

export interface DashboardAnalytics {
  asOf: string;
  metrics: DashboardMetrics;
  workQueue: DashboardWorkQueue;
  monthlyPerformance: MonthlyPerformancePoint[];
  periodComparison: PeriodComparison;
  cashMovement: CashMovementSnapshot;
  inventory: InventoryDashboardSnapshot;
  operatingPulse: OperatingPulse;
  recentActivity: DashboardActivity[];
}

const AGEING_KEYS = ["current", "d1_30", "d31_60", "d61_90", "d90_plus"] as const;

function ageingSnapshot(report: AgeingReport): AgeingSnapshot {
  return Object.fromEntries(AGEING_KEYS.map((key) => [key, Number(report.buckets[key] ?? 0)])) as unknown as AgeingSnapshot;
}

function monthStart(asOf: string): string {
  return `${asOf.slice(0, 7)}-01`;
}

function isoDate(year: number, monthIndex: number, day: number): string {
  return new Date(Date.UTC(year, monthIndex, day)).toISOString().slice(0, 10);
}

export function comparablePreviousMonthRange(asOf: string): MonthRange {
  const [year, month, day] = asOf.split("-").map(Number);
  const previousMonthEnd = new Date(Date.UTC(year, month - 1, 0));
  const comparableDay = Math.min(day, previousMonthEnd.getUTCDate());
  const key = isoDate(previousMonthEnd.getUTCFullYear(), previousMonthEnd.getUTCMonth(), 1).slice(0, 7);
  return {
    key,
    label: previousMonthEnd.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }),
    from: `${key}-01`,
    to: isoDate(previousMonthEnd.getUTCFullYear(), previousMonthEnd.getUTCMonth(), comparableDay),
  };
}

export function percentChange(current: number, prior: number): number | null {
  return prior === 0 ? null : ((current - prior) / Math.abs(prior)) * 100;
}

function performanceSnapshot(rows: Awaited<ReturnType<typeof getLedgerBalances>>): PerformanceSnapshot {
  const pnl = buildProfitAndLoss(rows);
  const revenueMinor = pnl.income.total + pnl.otherIncome.total;
  const totalExpenseMinor =
    pnl.costOfGoodsSold.total + pnl.operatingExpenses.total + pnl.otherExpenses.total;
  return {
    revenueMinor,
    cogsMinor: pnl.costOfGoodsSold.total,
    grossProfitMinor: pnl.grossProfit,
    operatingExpenseMinor: pnl.operatingExpenses.total,
    totalExpenseMinor,
    netIncomeMinor: pnl.netIncome,
    grossMarginPercent:
      pnl.income.total === 0 ? null : (pnl.grossProfit / Math.abs(pnl.income.total)) * 100,
    netMarginPercent:
      revenueMinor === 0 ? null : (pnl.netIncome / Math.abs(revenueMinor)) * 100,
  };
}

type LedgerRows = Awaited<ReturnType<typeof getLedgerBalances>>;

interface DashboardLedgerPromises {
  asOf: Promise<LedgerRows>;
  monthToDate: Promise<LedgerRows>;
  priorComparable: Promise<LedgerRows>;
}

function cashFromLedger(rows: LedgerRows): number {
  return rows
    .filter((row) => row.accountType === "bank")
    .reduce((sum, row) => sum + row.debitBase - row.creditBase, 0);
}

export function todayInTimeZone(timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

interface MonthRange {
  key: string;
  label: string;
  from: string;
  to: string;
}

export function trailingMonthRanges(asOf: string, count = 6): MonthRange[] {
  const [year, month, day] = asOf.split("-").map(Number);
  return Array.from({ length: count }, (_, index) => {
    const offset = index - (count - 1);
    const start = new Date(Date.UTC(year, month - 1 + offset, 1));
    const isCurrent = offset === 0;
    const end = isCurrent
      ? new Date(Date.UTC(year, month - 1, day))
      : new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
    const key = start.toISOString().slice(0, 7);
    return {
      key,
      label: start.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }),
      from: `${key}-01`,
      to: end.toISOString().slice(0, 10),
    };
  });
}

export async function getDashboardMetrics(
  sb: SupabaseClient,
  asOf = new Date().toISOString().slice(0, 10),
  ledger?: Pick<DashboardLedgerPromises, "asOf" | "monthToDate">,
): Promise<DashboardMetrics> {
  const [bal, ar, ap, unrecon, periods, mtdRows, approvals] = await Promise.all([
    ledger?.asOf ?? getLedgerBalances(sb, null, asOf),
    getArAgeing(sb, asOf),
    getApAgeing(sb, asOf),
    sb.rpc("acc_unreconciled_bank", { p_as_of: asOf }),
    sb.from("acc_accounting_period").select("id", { count: "exact", head: true }).eq("status", "open").lt("period_end", asOf),
    ledger?.monthToDate ?? getLedgerBalances(sb, monthStart(asOf), asOf),
    sb.from("acc_approval_request").select("id", { count: "exact", head: true }).eq("status", "pending"),
  ]);
  if (unrecon.error) throw new DashboardError(unrecon.error.message);
  if (periods.error) throw new DashboardError(periods.error.message);
  if (approvals.error) throw new DashboardError(approvals.error.message);

  const naturalAsset = (row: (typeof bal)[number]) => row.debitBase - row.creditBase;
  const naturalLiability = (row: (typeof bal)[number]) => row.creditBase - row.debitBase;
  const cashMinor = cashFromLedger(bal);
  const currentAssetsMinor = bal
    .filter((r) => ["bank", "accounts_receivable", "current_asset"].includes(r.accountType))
    .reduce((s, r) => s + naturalAsset(r), 0);
  const currentLiabilitiesMinor = bal
    .filter((r) => ["accounts_payable", "credit_card", "current_liability"].includes(r.accountType))
    .reduce((s, r) => s + naturalLiability(r), 0);
  // Overdue = total minus the "current" bucket (current = not yet overdue).
  const overdue = (rep: AgeingReport) =>
    Object.entries(rep.buckets).filter(([k]) => k !== "current").reduce((s, [, v]) => s + v, 0);
  const u = (unrecon.data ?? [])[0] as { item_count: number; amount_minor: number } | undefined;
  const pnl = buildProfitAndLoss(mtdRows);

  return {
    cashMinor,
    currentAssetsMinor,
    currentLiabilitiesMinor,
    workingCapitalMinor: currentAssetsMinor - currentLiabilitiesMinor,
    currentRatio: currentLiabilitiesMinor === 0 ? null : currentAssetsMinor / currentLiabilitiesMinor,
    overdueArMinor: overdue(ar),
    overdueApMinor: overdue(ap),
    overdueArCount: ar.rows.filter((row) => row.bucket !== "current").length,
    overdueApCount: ap.rows.filter((row) => row.bucket !== "current").length,
    arAgeing: ageingSnapshot(ar),
    apAgeing: ageingSnapshot(ap),
    unreconciledCount: Number(u?.item_count ?? 0),
    unreconciledMinor: Number(u?.amount_minor ?? 0),
    openPastPeriods: periods.count ?? 0,
    mtdNetIncomeMinor: pnl.netIncome,
    pendingApprovals: approvals.count ?? 0,
  };
}

const ACTIVITY_ENTITIES: Record<string, { entity: string; href: string; category: DashboardActivityCategory }> = {
  acc_invoice: { entity: "Invoice", href: "/invoices", category: "sales" },
  acc_payment: { entity: "Customer payment", href: "/payments", category: "sales" },
  acc_credit_memo: { entity: "Credit memo", href: "/credit-memos", category: "sales" },
  acc_bill: { entity: "Bill", href: "/bills", category: "purchases" },
  acc_bill_payment: { entity: "Bill payment", href: "/pay-bills", category: "purchases" },
  acc_vendor_credit: { entity: "Vendor credit", href: "/vendor-credits", category: "purchases" },
  acc_expense: { entity: "Expense", href: "/expenses", category: "purchases" },
  acc_purchase_order: { entity: "Purchase order", href: "/purchase-orders", category: "purchases" },
  acc_goods_receipt: { entity: "Goods receipt", href: "/purchase-orders", category: "inventory" },
  acc_inventory_txn: { entity: "Inventory movement", href: "/items", category: "inventory" },
  acc_journal_entry: { entity: "Journal entry", href: "/journal", category: "close" },
  acc_statement_reconciliation: { entity: "Bank reconciliation", href: "/banking/reconcile", category: "banking" },
  acc_approval_request: { entity: "Approval request", href: "/approvals", category: "governance" },
  acc_accounting_period: { entity: "Accounting period", href: "/settings/periods", category: "close" },
  acc_company_setting: { entity: "Company settings", href: "/settings/company", category: "governance" },
  acc_vendor_tax_profile: { entity: "Vendor tax profile", href: "/vendors", category: "governance" },
  acc_budget: { entity: "Budget", href: "/reports", category: "close" },
};

const ACTIVITY_VERBS: Record<string, string> = {
  insert: "Created",
  update: "Updated",
  post: "Posted",
  void: "Voided",
  reverse: "Reversed",
  delete: "Deleted",
};

const REFERENCE_KEYS = [
  "invoice_number",
  "payment_number",
  "credit_memo_number",
  "bill_number",
  "vendor_credit_number",
  "expense_number",
  "po_number",
  "receipt_number",
  "entry_number",
  "label",
] as const;

function referenceFromAudit(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  for (const key of REFERENCE_KEYS) {
    const candidate = row[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  }
  return null;
}

export function describeAuditActivity(row: AuditEntryRow): DashboardActivity {
  const meta = ACTIVITY_ENTITIES[row.table_name] ?? {
    entity: row.table_name.replace(/^acc_/, "").replaceAll("_", " "),
    href: "/settings/audit",
    category: "other" as const,
  };
  const exactHref =
    row.table_name === "acc_purchase_order" && row.record_id
      ? `/purchase-orders/${row.record_id}`
      : meta.href;
  return {
    id: row.id,
    occurredAt: row.created_at,
    actor: row.actor_email ?? "System",
    verb: ACTIVITY_VERBS[row.action] ?? row.action,
    entity: meta.entity,
    reference: referenceFromAudit(row.after_json) ?? referenceFromAudit(row.before_json),
    href: exactHref,
    category: meta.category,
  };
}

async function getMonthlyPerformance(
  sb: SupabaseClient,
  asOf: string,
  currentRows?: Promise<LedgerRows>,
): Promise<MonthlyPerformancePoint[]> {
  const ranges = trailingMonthRanges(asOf, 12);
  const balances = await Promise.all(
    ranges.map((range, index) =>
      index === ranges.length - 1 && currentRows
        ? currentRows
        : getLedgerBalances(sb, range.from, range.to),
    ),
  );
  return ranges.map((range, index) => {
    const pnl = buildProfitAndLoss(balances[index]);
    return {
      key: range.key,
      label: range.label,
      incomeMinor: pnl.income.total + pnl.otherIncome.total,
      expenseMinor:
        pnl.costOfGoodsSold.total + pnl.operatingExpenses.total + pnl.otherExpenses.total,
      netIncomeMinor: pnl.netIncome,
    };
  });
}

async function getRecentActivity(sb: SupabaseClient): Promise<DashboardActivity[]> {
  const permission = await sb.rpc("acc_has_permission", { p_key: "audit.read" });
  if (permission.error) throw new DashboardError(permission.error.message);
  if (!permission.data) return [];
  const rows = await searchAudit(sb, {
    table_name: null,
    record_id: null,
    actor_id: null,
    action: null,
    from: null,
    to: null,
    limit: 24,
  });
  return rows.map(describeAuditActivity);
}

async function getPeriodComparison(
  sb: SupabaseClient,
  asOf: string,
  currentRowsPromise?: Promise<LedgerRows>,
  priorComparableRows?: Promise<LedgerRows>,
): Promise<PeriodComparison> {
  const previous = comparablePreviousMonthRange(asOf);
  const [currentRows, priorRows] = await Promise.all([
    currentRowsPromise ?? getLedgerBalances(sb, monthStart(asOf), asOf),
    priorComparableRows ?? getLedgerBalances(sb, previous.from, previous.to),
  ]);
  const current = performanceSnapshot(currentRows);
  const prior = performanceSnapshot(priorRows);
  return {
    currentLabel: `${asOf.slice(0, 7)} MTD`,
    priorLabel: `${previous.label} 1-${Number(previous.to.slice(-2))}`,
    current,
    prior,
    revenueChangePercent: percentChange(current.revenueMinor, prior.revenueMinor),
    expenseChangePercent: percentChange(current.totalExpenseMinor, prior.totalExpenseMinor),
    netIncomeChangeMinor: current.netIncomeMinor - prior.netIncomeMinor,
    grossMarginChangePoints:
      current.grossMarginPercent === null || prior.grossMarginPercent === null
        ? null
        : current.grossMarginPercent - prior.grossMarginPercent,
  };
}

async function getInventoryDashboard(
  sb: SupabaseClient,
  asOf: string,
): Promise<InventoryDashboardSnapshot> {
  const staleCutoff = new Date(`${asOf}T00:00:00.000Z`);
  staleCutoff.setUTCDate(staleCutoff.getUTCDate() - 90);
  const staleCutoffIso = staleCutoff.toISOString().slice(0, 10);
  const [valuation, movements] = await Promise.all([
    getInventoryValuation(sb, asOf),
    sb
      .from("acc_inventory_txn")
      .select("item_id")
      .gte("txn_date", staleCutoffIso)
      .lte("txn_date", asOf)
  ]);
  if (movements.error) throw new DashboardError(movements.error.message);

  const recentlyMoved = new Set((movements.data ?? []).map((row) => String(row.item_id)));
  const staleRows = valuation.rows.filter(
    (row) => row.qty_on_hand > 0 && !recentlyMoved.has(row.item_id),
  );
  const sorted = [...valuation.rows].sort((a, b) => b.value_minor - a.value_minor);

  return {
    valueMinor: valuation.subledgerValueMinor,
    quantity: valuation.rows.reduce((sum, row) => sum + row.qty_on_hand, 0),
    itemCount: valuation.rows.length,
    zeroStockCount: valuation.rows.filter((row) => row.qty_on_hand === 0).length,
    slowMovingCount: staleRows.length,
    slowMovingValueMinor: staleRows.reduce((sum, row) => sum + row.value_minor, 0),
    tiesOut: valuation.tiesOut,
    topHoldings: sorted.slice(0, 5).map((row) => ({
      itemId: row.item_id,
      code: row.item_code,
      name: row.name,
      quantity: row.qty_on_hand,
      valueMinor: row.value_minor,
      sharePercent:
        valuation.subledgerValueMinor === 0
          ? 0
          : (row.value_minor / Math.abs(valuation.subledgerValueMinor)) * 100,
    })),
  };
}

async function getOperatingPulse(sb: SupabaseClient, asOf: string): Promise<OperatingPulse> {
  const from = monthStart(asOf);
  const [invoices, payments, bills, receipts] = await Promise.all([
    sb.from("acc_invoice").select("status,total_minor").gte("issue_date", from).lte("issue_date", asOf),
    sb.from("acc_payment").select("status,amount_minor").gte("payment_date", from).lte("payment_date", asOf),
    sb.from("acc_bill").select("status,total_minor").gte("bill_date", from).lte("bill_date", asOf),
    sb.from("acc_goods_receipt").select("status").gte("receipt_date", from).lte("receipt_date", asOf),
  ]);
  for (const result of [invoices, payments, bills, receipts]) {
    if (result.error) throw new DashboardError(result.error.message);
  }
  const issuedInvoices = (invoices.data ?? []).filter((row) => !["draft", "void"].includes(String(row.status)));
  const receivedPayments = (payments.data ?? []).filter((row) => String(row.status) !== "void");
  const postedBills = (bills.data ?? []).filter((row) => !["draft", "void"].includes(String(row.status)));
  const postedReceipts = (receipts.data ?? []).filter((row) => String(row.status) === "posted");
  return {
    invoices: {
      count: issuedInvoices.length,
      amountMinor: issuedInvoices.reduce((sum, row) => sum + Number(row.total_minor), 0),
    },
    customerPayments: {
      count: receivedPayments.length,
      amountMinor: receivedPayments.reduce((sum, row) => sum + Number(row.amount_minor), 0),
    },
    bills: {
      count: postedBills.length,
      amountMinor: postedBills.reduce((sum, row) => sum + Number(row.total_minor), 0),
    },
    goodsReceipts: { count: postedReceipts.length },
  };
}

export async function getDashboardAnalytics(
  sb: SupabaseClient,
  asOf = new Date().toISOString().slice(0, 10),
): Promise<DashboardAnalytics> {
  const previous = comparablePreviousMonthRange(asOf);
  const ledger: DashboardLedgerPromises = {
    asOf: getLedgerBalances(sb, null, asOf),
    monthToDate: getLedgerBalances(sb, monthStart(asOf), asOf),
    priorComparable: getLedgerBalances(sb, previous.from, previous.to),
  };
  const [
    metrics,
    workQueue,
    monthlyPerformance,
    periodComparison,
    cashFlow,
    inventory,
    operatingPulse,
    recentActivity,
  ] = await Promise.all([
    getDashboardMetrics(sb, asOf, ledger),
    getDashboardWorkQueue(sb, asOf),
    getMonthlyPerformance(sb, asOf, ledger.monthToDate),
    getPeriodComparison(sb, asOf, ledger.monthToDate, ledger.priorComparable),
    getCashFlow(sb, monthStart(asOf), asOf, {
      closingMinor: ledger.asOf.then(cashFromLedger),
    }),
    getInventoryDashboard(sb, asOf),
    getOperatingPulse(sb, asOf),
    getRecentActivity(sb),
  ]);
  return {
    asOf,
    metrics,
    workQueue,
    monthlyPerformance,
    periodComparison,
    cashMovement: {
      operatingMinor: cashFlow.operating,
      investingMinor: cashFlow.investing,
      financingMinor: cashFlow.financing,
      netChangeMinor: cashFlow.netChange,
      openingMinor: cashFlow.openingMinor,
      closingMinor: cashFlow.closingMinor,
      tiesOut: cashFlow.tiesOut,
    },
    inventory,
    operatingPulse,
    recentActivity,
  };
}
