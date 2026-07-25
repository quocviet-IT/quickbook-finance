import type { SupabaseClient } from "@supabase/supabase-js";
import { getLedgerBalances } from "./reports";
import { getArAgeing, getApAgeing, type AgeingReport } from "./ageing";
import { searchAudit } from "./access";
import { buildProfitAndLoss } from "@/lib/domain/reports";
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

export interface DashboardActivity {
  id: string;
  occurredAt: string;
  actor: string;
  verb: string;
  entity: string;
  reference: string | null;
  href: string;
}

export interface DashboardAnalytics {
  asOf: string;
  metrics: DashboardMetrics;
  monthlyPerformance: MonthlyPerformancePoint[];
  recentActivity: DashboardActivity[];
}

const AGEING_KEYS = ["current", "d1_30", "d31_60", "d61_90", "d90_plus"] as const;

function ageingSnapshot(report: AgeingReport): AgeingSnapshot {
  return Object.fromEntries(AGEING_KEYS.map((key) => [key, Number(report.buckets[key] ?? 0)])) as unknown as AgeingSnapshot;
}

function monthStart(asOf: string): string {
  return `${asOf.slice(0, 7)}-01`;
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
): Promise<DashboardMetrics> {
  const [bal, ar, ap, unrecon, periods, mtdRows, approvals] = await Promise.all([
    getLedgerBalances(sb, null, asOf),
    getArAgeing(sb, asOf),
    getApAgeing(sb, asOf),
    sb.rpc("acc_unreconciled_bank", { p_as_of: asOf }),
    sb.from("acc_accounting_period").select("id", { count: "exact", head: true }).eq("status", "open").lt("period_end", asOf),
    getLedgerBalances(sb, monthStart(asOf), asOf),
    sb.from("acc_approval_request").select("id", { count: "exact", head: true }).eq("status", "pending"),
  ]);
  if (unrecon.error) throw new DashboardError(unrecon.error.message);
  if (periods.error) throw new DashboardError(periods.error.message);
  if (approvals.error) throw new DashboardError(approvals.error.message);

  const cashMinor = bal.filter((r) => r.accountType === "bank").reduce((s, r) => s + (r.debitBase - r.creditBase), 0);
  // Overdue = total minus the "current" bucket (current = not yet overdue).
  const overdue = (rep: AgeingReport) =>
    Object.entries(rep.buckets).filter(([k]) => k !== "current").reduce((s, [, v]) => s + v, 0);
  const u = (unrecon.data ?? [])[0] as { item_count: number; amount_minor: number } | undefined;
  const pnl = buildProfitAndLoss(mtdRows);

  return {
    cashMinor,
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

const ACTIVITY_ENTITIES: Record<string, { entity: string; href: string }> = {
  acc_invoice: { entity: "Invoice", href: "/invoices" },
  acc_payment: { entity: "Customer payment", href: "/payments" },
  acc_credit_memo: { entity: "Credit memo", href: "/credit-memos" },
  acc_bill: { entity: "Bill", href: "/bills" },
  acc_bill_payment: { entity: "Bill payment", href: "/pay-bills" },
  acc_vendor_credit: { entity: "Vendor credit", href: "/vendor-credits" },
  acc_expense: { entity: "Expense", href: "/expenses" },
  acc_purchase_order: { entity: "Purchase order", href: "/purchase-orders" },
  acc_goods_receipt: { entity: "Goods receipt", href: "/purchase-orders" },
  acc_inventory_txn: { entity: "Inventory movement", href: "/items" },
  acc_journal_entry: { entity: "Journal entry", href: "/journal" },
  acc_statement_reconciliation: { entity: "Bank reconciliation", href: "/banking/reconcile" },
  acc_approval_request: { entity: "Approval request", href: "/approvals" },
  acc_accounting_period: { entity: "Accounting period", href: "/settings/periods" },
  acc_company_setting: { entity: "Company settings", href: "/settings/company" },
  acc_vendor_tax_profile: { entity: "Vendor tax profile", href: "/vendors" },
  acc_budget: { entity: "Budget", href: "/reports" },
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
  };
}

async function getMonthlyPerformance(
  sb: SupabaseClient,
  asOf: string,
): Promise<MonthlyPerformancePoint[]> {
  const ranges = trailingMonthRanges(asOf);
  const balances = await Promise.all(
    ranges.map((range) => getLedgerBalances(sb, range.from, range.to)),
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
    limit: 10,
  });
  return rows.map(describeAuditActivity);
}

export async function getDashboardAnalytics(
  sb: SupabaseClient,
  asOf = new Date().toISOString().slice(0, 10),
): Promise<DashboardAnalytics> {
  const [metrics, monthlyPerformance, recentActivity] = await Promise.all([
    getDashboardMetrics(sb, asOf),
    getMonthlyPerformance(sb, asOf),
    getRecentActivity(sb),
  ]);
  return { asOf, metrics, monthlyPerformance, recentActivity };
}
