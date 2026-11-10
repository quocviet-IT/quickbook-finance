/**
 * When a bill can be voided, and what the question says before it is.
 *
 * Pure. The rule is shared with invoices (document-void.ts, after
 * acc_void_bill in 0169); this file holds the bill's own words.
 */
import type { BillStatus } from "@/lib/db/types";
import { DRAFT_VOID_CONTENT, documentVoidOption, type VoidOption } from "@/lib/domain/document-void";

export interface VoidableBill {
  status: BillStatus;
  bill_number: string | null;
  vendor_name: string;
  total_minor: number;
  balance_due_minor: number;
  /** The journal entry posting made; none on a draft. */
  entry_number: string | null;
}

export function billVoidOption(bill: VoidableBill): VoidOption {
  return documentVoidOption(bill);
}

/** The confirmation's title and body, naming the bill and what voiding does to it. */
export function billVoidConfirm(bill: VoidableBill): { title: string; content: string } {
  if (bill.status === "draft" || !bill.bill_number) {
    return {
      title: `Void the draft bill from ${bill.vendor_name}?`,
      content: DRAFT_VOID_CONTENT,
    };
  }
  const entry = bill.entry_number ? `journal entry ${bill.entry_number}` : "its journal entry";
  return {
    title: `Void ${bill.bill_number}?`,
    content: `This reverses ${entry}, so the bill comes off the ledger and is no longer owed to ${bill.vendor_name}.`,
  };
}
