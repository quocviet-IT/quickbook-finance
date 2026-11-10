/**
 * When an invoice or a bill can be voided.
 *
 * Pure. acc_void_invoice and acc_void_bill (0169) share one rule: a draft is
 * marked void with nothing to reverse; a posted document has its journal entry
 * voided; and a posted document whose balance due differs from its total — a
 * payment, a credit or a write-off applied — is refused. The menus follow the
 * same rule, so nobody confirms a void only to be told no.
 */

export interface SettledDocument {
  status: string;
  total_minor: number;
  balance_due_minor: number;
}

export type VoidOption =
  | { offered: false }
  /** Offered; when `blockedReason` is set, shown disabled with that reason. */
  | { offered: true; blockedReason: string | null };

export const VOID_BLOCKED_BY_SETTLEMENT = "Payments or credits are applied to it, so it cannot be voided";

export function documentVoidOption(document: SettledDocument): VoidOption {
  if (document.status === "void" || document.status === "paid") return { offered: false };
  if (document.status !== "draft" && document.balance_due_minor !== document.total_minor) {
    return { offered: true, blockedReason: VOID_BLOCKED_BY_SETTLEMENT };
  }
  return { offered: true, blockedReason: null };
}

/** What a draft's void question says, for either kind of document. */
export const DRAFT_VOID_CONTENT =
  "Nothing has been posted for a draft, so the ledger does not change. The draft stays in the list, marked Void.";
