import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  DerivedWorkItem,
  SectionEnvelope,
  SurfaceControl,
  SurfaceWorkItem,
} from "@/lib/domain/work-surface/types";
import type { WorkItemState } from "@/lib/domain/work-surface/lifecycle";
import { orderWork } from "@/lib/domain/work-surface/priority";
import { EMPTY_WORK_POLICY, type WorkPolicy } from "@/lib/domain/work-policy";
import {
  billDueItem,
  billsDueControl,
  DUE_SOON_DAYS,
  QUEUE_BILL_LIMIT,
  receivedNotBilledControl,
  receivedNotBilledItem,
  unappliedPaymentItem,
  unappliedPaymentsControl,
} from "@/lib/domain/purchases-surface/rules";
import { envelope, failed, withDecisions } from "@/lib/services/work-surface/envelope";
import {
  listWorkItemState,
  retireWorkItems,
} from "@/lib/services/work-surface/work-item-state";
import { getWorkPolicy } from "@/lib/services/work-policy";
import { listBillPayments, listBills } from "@/lib/services/payables";
import { getReceivedNotBilled } from "@/lib/services/purchasing";
import { getCurrentCompanySettings } from "@/lib/services/company";
import { todayInTimeZone } from "@/lib/services/dashboard";

/**
 * The Purchases surface: what must be paid, what has arrived, and what does not
 * add up.
 *
 * Three questions rather than one, which is why this screen is not Sales with
 * the arrows reversed. Money going out has a receiving side, and "we were
 * invoiced for something that never came" is a different problem from "we owe
 * this and it is late".
 *
 * Plan: docs/superpowers/plans/2026-08-22-accounting-cockpit-phase6.md
 */

export interface PurchasesContext {
  asOf: string;
  currencyCode: string;
  currencyDecimals: number;
  timeZone: string;
}

export interface PurchasesFacts {
  bills: {
    id: string;
    number: string | null;
    vendorName: string;
    dueDate: string;
    balanceMinor: number;
    daysPastDue: number;
  }[];
  receivedNotBilled: {
    lineId: string;
    poNumber: string | null;
    vendorName: string;
    description: string;
    qtyOutstanding: number;
    valueMinor: number;
    orderDate: string;
  }[];
  unapplied: {
    id: string;
    number: string | null;
    vendorName: string;
    paymentDate: string;
    unappliedMinor: number;
  }[];
}

export interface PurchasesSurfaceData {
  context: PurchasesContext;
  controls: SectionEnvelope<SurfaceControl[]>;
  queue: SectionEnvelope<SurfaceWorkItem[]>;
  policy: WorkPolicy;
}

const DAY_MS = 24 * 60 * 60 * 1_000;

function daysBetween(later: string, earlier: string): number {
  const a = Date.parse(`${later.slice(0, 10)}T00:00:00.000Z`);
  const b = Date.parse(`${earlier.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((a - b) / DAY_MS);
}

export async function getPurchasesContext(sb: SupabaseClient): Promise<PurchasesContext> {
  const company = await getCurrentCompanySettings(sb);
  const timeZone = company?.time_zone ?? "America/New_York";
  return {
    asOf: todayInTimeZone(timeZone),
    currencyCode: "USD",
    currencyDecimals: 2,
    timeZone,
  };
}

export async function getPurchasesFacts(
  sb: SupabaseClient,
  context: PurchasesContext,
): Promise<PurchasesFacts> {
  const [bills, payments, receiving] = await Promise.all([
    listBills(sb),
    listBillPayments(sb),
    getReceivedNotBilled(sb),
  ]);

  const open = bills
    .filter(
      (bill) =>
        (bill.status === "open" || bill.status === "partial") &&
        Number(bill.balance_due_minor) > 0,
    )
    .map((bill) => ({
      id: bill.id,
      number: bill.bill_number,
      vendorName: bill.vendor_name,
      // A bill with no due date is due on its own date: the terms said nothing,
      // so nothing extends it. Better than treating it as never due.
      dueDate: bill.due_date ?? bill.bill_date,
      balanceMinor: Number(bill.balance_due_minor),
      daysPastDue: daysBetween(context.asOf, bill.due_date ?? bill.bill_date),
    }));

  return {
    bills: open,
    receivedNotBilled: receiving.map((row) => ({
      lineId: row.purchase_order_line_id,
      poNumber: row.po_number,
      vendorName: row.vendor_name,
      description: row.description,
      qtyOutstanding: Number(row.qty_outstanding),
      valueMinor: Number(row.value_minor),
      orderDate: row.order_date,
    })),
    unapplied: payments
      .filter((payment) => payment.status !== "void" && Number(payment.unapplied_minor) > 0)
      .map((payment) => ({
        id: payment.id,
        number: payment.payment_number,
        vendorName: payment.vendor_name,
        paymentDate: payment.payment_date,
        unappliedMinor: Number(payment.unapplied_minor),
      })),
  };
}

export function purchasesControls(
  facts: PurchasesFacts,
  context: PurchasesContext,
  evaluatedAt: string,
): SurfaceControl[] {
  const overdue = facts.bills.filter((bill) => bill.daysPastDue > 0);
  const dueSoon = facts.bills.filter(
    (bill) => bill.daysPastDue <= 0 && bill.daysPastDue > -DUE_SOON_DAYS,
  );
  const oldestReceipt = facts.receivedNotBilled.reduce<number | null>((worst, row) => {
    const days = daysBetween(context.asOf, row.orderDate);
    return worst === null || days > worst ? days : worst;
  }, null);

  return [
    billsDueControl({
      overdueCount: overdue.length,
      overdueMinor: overdue.reduce((sum, bill) => sum + bill.balanceMinor, 0),
      dueSoonCount: dueSoon.length,
      dueSoonMinor: dueSoon.reduce((sum, bill) => sum + bill.balanceMinor, 0),
      evaluatedAt,
    }),
    receivedNotBilledControl({
      lineCount: facts.receivedNotBilled.length,
      valueMinor: facts.receivedNotBilled.reduce((sum, row) => sum + row.valueMinor, 0),
      oldestAgeDays: oldestReceipt,
      evaluatedAt,
    }),
    unappliedPaymentsControl({
      count: facts.unapplied.length,
      amountMinor: facts.unapplied.reduce((sum, row) => sum + row.unappliedMinor, 0),
      evaluatedAt,
    }),
  ];
}

export function purchasesWorkQueue(
  facts: PurchasesFacts,
  context: PurchasesContext,
  materialityMinor: number | null,
  confirmedAt: string,
): DerivedWorkItem[] {
  const items: DerivedWorkItem[] = [];

  // Only what is overdue or due soon. A bill due in six weeks is not work yet,
  // and putting it here would bury what is.
  const actionable = facts.bills
    .filter((bill) => bill.daysPastDue > -DUE_SOON_DAYS)
    .sort((a, b) => b.daysPastDue - a.daysPastDue)
    .slice(0, QUEUE_BILL_LIMIT);
  for (const bill of actionable) {
    items.push(billDueItem(bill, { daysPastDue: bill.daysPastDue, materialityMinor, confirmedAt }));
  }

  for (const line of facts.receivedNotBilled) {
    items.push(
      receivedNotBilledItem(line, {
        ageDays: daysBetween(context.asOf, line.orderDate),
        confirmedAt,
      }),
    );
  }

  for (const payment of facts.unapplied) {
    items.push(
      unappliedPaymentItem(payment, {
        ageDays: daysBetween(context.asOf, payment.paymentDate),
        confirmedAt,
      }),
    );
  }

  return orderWork(items);
}

export interface PurchasesSections {
  context: (sb: SupabaseClient) => Promise<PurchasesContext>;
  facts: (sb: SupabaseClient, context: PurchasesContext) => Promise<PurchasesFacts>;
  workState: (sb: SupabaseClient) => Promise<Map<string, WorkItemState>>;
  retire: (sb: SupabaseClient, liveKeys: readonly string[]) => Promise<number>;
  policy: (sb: SupabaseClient) => Promise<WorkPolicy>;
}

export const DEFAULT_PURCHASES_SECTIONS: PurchasesSections = {
  context: getPurchasesContext,
  facts: getPurchasesFacts,
  workState: listWorkItemState,
  retire: retireWorkItems,
  policy: getWorkPolicy,
};

export async function getPurchasesSurface(
  sb: SupabaseClient,
  sections: PurchasesSections = DEFAULT_PURCHASES_SECTIONS,
): Promise<PurchasesSurfaceData> {
  const context = await sections.context(sb);
  const [factsResult, stateResult, policyResult] = await Promise.allSettled([
    sections.facts(sb, context),
    sections.workState(sb),
    sections.policy(sb),
  ]);

  const policy = policyResult.status === "fulfilled" ? policyResult.value : EMPTY_WORK_POLICY;
  const state =
    stateResult.status === "fulfilled"
      ? stateResult.value
      : (console.error("reading work item state failed:", stateResult.reason),
        new Map<string, WorkItemState>());

  const at = new Date().toISOString();

  const controls = envelope(
    factsResult.status === "fulfilled"
      ? { status: "fulfilled" as const, value: purchasesControls(factsResult.value, context, at) }
      : factsResult,
    "The purchasing checks could not be evaluated. Nothing here should be read as passing.",
  );

  const queue: SectionEnvelope<SurfaceWorkItem[]> =
    factsResult.status === "fulfilled"
      ? {
          data: withDecisions(
            purchasesWorkQueue(factsResult.value, context, policy.materialityMinor, at),
            state,
            context,
          ),
          generatedAt: at,
          dataState: "fresh",
        }
      : failed(
          "The purchasing work could not be loaded, so this is not a statement that there is none.",
          factsResult.reason,
        );

  if (queue.data) {
    await sections.retire(sb, queue.data.map((item) => item.key));
  }

  return { context, controls, queue, policy };
}

/** Nothing on Purchases blocks: every check summarises work the queue itemises. */
export async function purchasesBlockingKeys(): Promise<ReadonlySet<string>> {
  return new Set<string>();
}
