/**
 * Finding one document in a register of many — invoices, bills, payments.
 *
 * Two decisions live here so eight screens cannot each make them differently:
 * what a typed keyword matches, and what "overdue" means. The second is the
 * one with money on it. QuickBooks and Xero both lead their receivable and
 * payable queues with an overdue view, because "who is late" is the question
 * a bookkeeper opens those screens to answer — and if Invoices and Bills each
 * computed lateness themselves, one day they would disagree.
 */

/** True when any of the fields carries the keyword, case-insensitively. */
export function matchesDocumentKeyword(
  fields: readonly (string | null | undefined)[],
  keyword: string,
): boolean {
  const needle = keyword.trim().toLowerCase();
  if (!needle) return true;
  return fields.some((field) => typeof field === "string" && field.toLowerCase().includes(needle));
}

export interface OverdueInput {
  /** The document's own status union; only "draft" and "void" matter here. */
  status: string;
  /** YYYY-MM-DD, or null when no terms were set. */
  dueDate: string | null;
  balanceDueMinor: number;
}

/**
 * Money still owed past its due date.
 *
 * Balance-driven rather than status-driven, so the invoice union
 * (issued/partial) and the bill union (open/partial) both pass through
 * without this file naming either. Draft and void are the exceptions worth
 * naming: a draft is not yet a receivable, and a void never will be, whatever
 * their dates say.
 *
 * Due *today* is due, not late — the debtor has until midnight. Dates are
 * YYYY-MM-DD, so string comparison is date comparison.
 */
export function isOverdueDocument(input: OverdueInput, today: string): boolean {
  if (input.status === "draft" || input.status === "void") return false;
  if (input.balanceDueMinor <= 0) return false;
  return input.dueDate !== null && input.dueDate < today;
}
