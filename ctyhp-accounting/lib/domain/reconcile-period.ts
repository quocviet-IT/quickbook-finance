/**
 * A statement period already reconciled is not reconciled again (3.0.36).
 *
 * The database refuses a new reconciliation that ends on or before the
 * account's latest completed one, and refuses to complete one when another is
 * already completed to that date or later (migration 0197). New reconciliation
 * says so before anything is sent: the dates it cannot take are greyed out in
 * the date picker, and the field says where the account is reconciled to.
 *
 * A dependency-free .ts file, so a test holds it without Ant Design.
 */
import { formatDate } from "@/lib/format";

interface ReconciliationLike {
  status: string;
  statement_ending_date: string;
}

/** The latest completed reconciliation's ending date (YYYY-MM-DD), or null when the account has none. */
export function lastCompletedEnding(rows: readonly ReconciliationLike[]): string | null {
  let last: string | null = null;
  for (const row of rows) {
    if (row.status !== "completed") continue;
    if (last === null || row.statement_ending_date > last) last = row.statement_ending_date;
  }
  return last;
}

/** Whether a statement ending on `date` (YYYY-MM-DD) is a period already reconciled. */
export function endsWithinReconciled(date: string, last: string | null): boolean {
  return last !== null && date <= last;
}

/** Under Statement ending date, when the account has been reconciled. */
export function reconciledToNote(last: string): string {
  return `Reconciled to ${formatDate(last)}. The statement must end after that date.`;
}

/** The field's refusal, for a date typed rather than picked. */
export function reconciledToRefusal(last: string): string {
  return `This account is already reconciled to ${formatDate(last)}. Choose a statement that ends after that date.`;
}
