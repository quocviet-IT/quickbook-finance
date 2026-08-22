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
  overdueReceivablesControl,
  unappliedReceiptsControl,
  unissuedInvoicesControl,
} from "@/lib/domain/sales-surface/controls";
import {
  DRAFT_STALE_AFTER_DAYS,
  overdueInvoiceItem,
  QUEUE_OVERDUE_LIMIT,
  staleDraftItem,
  unappliedReceiptItem,
} from "@/lib/domain/sales-surface/queue-items";
import { envelope, failed, withDecisions } from "@/lib/services/work-surface/envelope";
import {
  listWorkItemState,
  retireWorkItems,
} from "@/lib/services/work-surface/work-item-state";
import { getWorkPolicy } from "@/lib/services/work-policy";
import { getArAging } from "@/lib/services/aging";
import { listInvoices, listPayments } from "@/lib/services/invoicing";
import { getCurrentCompanySettings } from "@/lib/services/company";
import { todayInTimeZone } from "@/lib/services/dashboard";

/**
 * The Sales surface: who owes money, and what is being done about it.
 *
 * **Not the accounting composition with sales data in it.** That page answers
 * "are the books safe to close"; this one answers a collection question, and
 * everything on it is subordinate to that. There is no twelve-month revenue
 * chart, because a chart tells nobody who to ring.
 *
 * Plan: docs/superpowers/plans/2026-08-22-accounting-cockpit-phase6.md
 */

export class SalesSurfaceError extends Error {}

export interface SalesContext {
  asOf: string;
  currencyCode: string;
  currencyDecimals: number;
  timeZone: string;
}

export interface SalesFacts {
  /** Overdue rows only — the current bucket is not yet anybody's problem. */
  overdue: {
    /**
     * The document's own number, not a row id.
     *
     * An ageing row identifies a *customer* (`entityId`) and a document
     * (`docType` + `docNumber`); it carries no invoice id. Keying work on the
     * customer would collapse every overdue invoice they hold into one row, so
     * the key is the document number — which is write-once and never reused
     * (migration 0066), and is therefore a more stable identity than an id
     * anyway.
     */
    docType: string;
    docNumber: string | null;
    customerName: string;
    dueDate: string;
    balanceMinor: number;
  }[];
  overdueMinor: number;
  unapplied: {
    id: string;
    number: string | null;
    customerName: string;
    paymentDate: string;
    unappliedMinor: number;
  }[];
  unappliedMinor: number;
  drafts: {
    id: string;
    customerName: string;
    issueDate: string;
    totalMinor: number;
  }[];
  draftMinor: number;
}

export interface SalesSurfaceData {
  context: SalesContext;
  controls: SectionEnvelope<SurfaceControl[]>;
  queue: SectionEnvelope<SurfaceWorkItem[]>;
  policy: WorkPolicy;
}

const DAY_MS = 24 * 60 * 60 * 1_000;

export function daysBetween(later: string, earlier: string): number {
  const a = Date.parse(`${later.slice(0, 10)}T00:00:00.000Z`);
  const b = Date.parse(`${earlier.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((a - b) / DAY_MS));
}

export async function getSalesContext(sb: SupabaseClient): Promise<SalesContext> {
  const company = await getCurrentCompanySettings(sb);
  const timeZone = company?.time_zone ?? "America/New_York";
  return {
    asOf: todayInTimeZone(timeZone),
    currencyCode: "USD",
    currencyDecimals: 2,
    timeZone,
  };
}

export async function getSalesFacts(
  sb: SupabaseClient,
  context: SalesContext,
): Promise<SalesFacts> {
  const { asOf } = context;
  const [aging, invoices, payments] = await Promise.all([
    // `reconcileAsOf` is what stops this netting the control account at the
    // server's UTC date — see the Phase 5 record for what that cost last time.
    getArAging(sb, asOf, { reconcileAsOf: asOf }),
    listInvoices(sb),
    listPayments(sb),
  ]);

  // "Overdue" is the ageing report's answer, not a second one worked out here.
  // A negative balance is a credit sitting against the customer, not a debt —
  // it lands in `current` anyway, and excluding it explicitly says so.
  const overdue = aging.rows
    .filter((row) => row.bucket !== "current" && row.balanceMinor > 0)
    .map((row) => ({
      docType: row.docType,
      docNumber: row.docNumber,
      customerName: row.entityName,
      dueDate: row.dueDate,
      balanceMinor: row.balanceMinor,
    }));

  const unapplied = payments
    .filter((payment) => payment.status !== "void" && Number(payment.unapplied_minor) > 0)
    .map((payment) => ({
      id: payment.id,
      number: payment.payment_number,
      customerName: payment.customer_name,
      paymentDate: payment.payment_date,
      unappliedMinor: Number(payment.unapplied_minor),
    }));

  const drafts = invoices
    .filter((invoice) => invoice.status === "draft")
    .map((invoice) => ({
      id: invoice.id,
      customerName: invoice.customer_name,
      issueDate: invoice.issue_date,
      totalMinor: Number(invoice.total_minor),
    }));

  return {
    overdue,
    overdueMinor: overdue.reduce((sum, row) => sum + row.balanceMinor, 0),
    unapplied,
    unappliedMinor: unapplied.reduce((sum, row) => sum + row.unappliedMinor, 0),
    drafts,
    draftMinor: drafts.reduce((sum, row) => sum + row.totalMinor, 0),
  };
}

export function salesControls(
  facts: SalesFacts,
  context: SalesContext,
  evaluatedAt: string,
): SurfaceControl[] {
  const oldest = facts.overdue.reduce<number | null>((worst, row) => {
    const days = daysBetween(context.asOf, row.dueDate);
    return worst === null || days > worst ? days : worst;
  }, null);
  const staleDrafts = facts.drafts.filter(
    (draft) => daysBetween(context.asOf, draft.issueDate) > DRAFT_STALE_AFTER_DAYS,
  );

  return [
    overdueReceivablesControl({
      overdueCount: facts.overdue.length,
      overdueMinor: facts.overdueMinor,
      oldestDaysPastDue: oldest,
      evaluatedAt,
    }),
    unappliedReceiptsControl({
      count: facts.unapplied.length,
      amountMinor: facts.unappliedMinor,
      evaluatedAt,
    }),
    unissuedInvoicesControl({
      draftCount: facts.drafts.length,
      draftMinor: staleDrafts.reduce((sum, draft) => sum + draft.totalMinor, 0),
      staleCount: staleDrafts.length,
      staleAfterDays: DRAFT_STALE_AFTER_DAYS,
      evaluatedAt,
    }),
  ];
}

export function salesWorkQueue(
  facts: SalesFacts,
  context: SalesContext,
  materialityMinor: number | null,
  confirmedAt: string,
): DerivedWorkItem[] {
  const items: DerivedWorkItem[] = [];

  // Longest overdue first, then capped — capping before sorting would hand back
  // an arbitrary fifty rather than the fifty that have waited longest.
  const overdue = [...facts.overdue]
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, QUEUE_OVERDUE_LIMIT);
  for (const row of overdue) {
    items.push(
      overdueInvoiceItem(
        {
          docType: row.docType,
          docNumber: row.docNumber,
          customerName: row.customerName,
          dueDate: row.dueDate,
          balanceMinor: row.balanceMinor,
        },
        {
          daysPastDue: daysBetween(context.asOf, row.dueDate),
          materialityMinor,
          confirmedAt,
        },
      ),
    );
  }

  for (const payment of facts.unapplied) {
    items.push(
      unappliedReceiptItem(payment, {
        ageDays: daysBetween(context.asOf, payment.paymentDate),
        confirmedAt,
      }),
    );
  }

  for (const draft of facts.drafts) {
    const ageDays = daysBetween(context.asOf, draft.issueDate);
    if (ageDays <= DRAFT_STALE_AFTER_DAYS) continue;
    items.push(staleDraftItem(draft, { ageDays, confirmedAt }));
  }

  return orderWork(items);
}

export interface SalesSections {
  context: (sb: SupabaseClient) => Promise<SalesContext>;
  facts: (sb: SupabaseClient, context: SalesContext) => Promise<SalesFacts>;
  workState: (sb: SupabaseClient) => Promise<Map<string, WorkItemState>>;
  retire: (sb: SupabaseClient, liveKeys: readonly string[]) => Promise<number>;
  policy: (sb: SupabaseClient) => Promise<WorkPolicy>;
}

export const DEFAULT_SALES_SECTIONS: SalesSections = {
  context: getSalesContext,
  facts: getSalesFacts,
  workState: listWorkItemState,
  retire: retireWorkItems,
  policy: getWorkPolicy,
};

export async function getSalesSurface(
  sb: SupabaseClient,
  sections: SalesSections = DEFAULT_SALES_SECTIONS,
): Promise<SalesSurfaceData> {
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
      ? { status: "fulfilled" as const, value: salesControls(factsResult.value, context, at) }
      : factsResult,
    "The collection checks could not be evaluated. Nothing here should be read as passing.",
  );

  const queue: SectionEnvelope<SurfaceWorkItem[]> =
    factsResult.status === "fulfilled"
      ? {
          data: withDecisions(
            salesWorkQueue(factsResult.value, context, policy.materialityMinor, at),
            state,
            context,
          ),
          generatedAt: at,
          dataState: "fresh",
        }
      : failed(
          "The collection work could not be loaded, so this is not a statement that there is none.",
          factsResult.reason,
        );

  if (queue.data) {
    await sections.retire(sb, queue.data.map((item) => item.key));
  }

  return { context, controls, queue, policy };
}

/** Nothing on Sales blocks: every check summarises work the queue itemises. */
export async function salesBlockingKeys(): Promise<ReadonlySet<string>> {
  return new Set<string>();
}
