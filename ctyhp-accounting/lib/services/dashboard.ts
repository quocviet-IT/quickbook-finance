/**
 * What the old Dashboard shared with the rest of the app, kept after the
 * Dashboard was rebuilt (3.0.38; its reads are in lib/services/dashboard-home):
 * the company's today, month ranges and their same-days comparison, a change
 * as a percentage, how an audit row reads as recent activity, and the chart
 * types the reports draw with.
 */
import type { AuditEntryRow } from "@/lib/db/types";
import {
  ACTIVITY_ENTITIES,
  ACTIVITY_VERBS,
  auditEntityLabel,
  type DashboardActivityCategory,
} from "@/lib/domain/audit-entities";

export interface AgingSnapshot {
  current: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90_plus: number;
}

export interface MonthlyPerformancePoint {
  key: string;
  label: string;
  incomeMinor: number;
  expenseMinor: number;
  netIncomeMinor: number;
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

export type { DashboardActivityCategory };

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

/** Moved to lib/format.ts so client screens read the same day; re-exported for the server callers. */
export { todayInTimeZone } from "@/lib/format";

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

const REFERENCE_KEYS = [
  "invoice_number",
  "payment_number",
  "credit_memo_number",
  "bill_number",
  "vendor_credit_number",
  "expense_number",
  "po_number",
  "receipt_number",
  "estimate_number",
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
    entity: auditEntityLabel(row.table_name),
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
