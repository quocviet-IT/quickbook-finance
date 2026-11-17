/**
 * Which bills need attention first, and what the Bills list says about them
 * (3.0.44).
 *
 * Pure. Bills used to open in whatever order they were read, so the bill
 * longest past due could sit anywhere. It now opens as Invoices has since
 * 3.0.11: overdue (oldest due date first), then due within a week, then drafts
 * waiting to be posted, then everything else, newest number first. The rule is
 * the invoices' own (documentAttention), not a copy of it.
 */
import type { BillStatus } from "@/lib/db/types";
import {
  documentAttention,
  sortDocumentsByAttention,
  type AttentionDocument,
  type DocumentAttention,
} from "@/lib/domain/invoice-attention";

export interface AttentionBill extends AttentionDocument {
  id: string;
  status: BillStatus;
  bill_number: string | null;
  total_minor: number;
}

export function billAttention(bill: AttentionBill, today: string): DocumentAttention {
  return documentAttention(bill, today);
}

/** A sorted copy: overdue, then due within a week, then drafts, then the rest by number, newest first. */
export function sortBillsByAttention<T extends AttentionBill>(bills: readonly T[], today: string): T[] {
  return sortDocumentsByAttention(bills, today, (bill) => bill.bill_number);
}

export type BillStatusTab = "all" | "overdue" | BillStatus;

/** How many bills each status tab holds, by the rule its filter applies. */
export function billStatusCounts(bills: readonly AttentionBill[], today: string): Record<BillStatusTab, number> {
  const counts: Record<BillStatusTab, number> = {
    all: bills.length,
    overdue: 0,
    draft: 0,
    open: 0,
    partial: 0,
    paid: 0,
    void: 0,
  };
  for (const bill of bills) {
    counts[bill.status] += 1;
    if (billAttention(bill, today).kind === "overdue") counts.overdue += 1;
  }
  return counts;
}
