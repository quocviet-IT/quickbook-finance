/**
 * Batch selection and batch Category/Account assignment on Bank Transactions
 * (RQ-03 and RQ-05, built as one connected flow: filter, select, assign).
 *
 * The fact that shapes everything here: setting a Category posts a journal
 * entry (`acc_categorise_bank_transaction`, migration 0111). Category is an
 * account, not a label, so "assign Category to 100 selected rows" is "post up
 * to 100 journal entries in one click" — not tagging 100 rows. That is why a
 * batch result is a list of per-row outcomes rather than a single yes/no, and
 * why "skipped" is counted and explained rather than silently dropped: a row
 * that already carries an entry is left alone, on purpose, and the reader is
 * told so rather than left to wonder why nothing happened to it.
 *
 * The change request (RQ-05, section 3) names two batch actions — "Set
 * Category" and "Set Account" — as if they assign two different things, the
 * way the PaySched reference screen it points to does. On this screen they
 * are the same operation: `acc_categorise_bank_transaction` takes one account
 * id and posts one entry, and there is no second field left after migration
 * 0098 removed the free-text label the old "Category" column held. Both
 * batch actions call the same server action with the same account picker;
 * only the button label and modal copy differ, to give the two entry points
 * the video pointed at without inventing a distinction the schema does not
 * have.
 */

// --- Selection (RQ-03) -------------------------------------------------------

/**
 * Drop any selected id that is no longer part of the filtered result set.
 *
 * Section 8 fixed the scope: `Select all` covers the current page after
 * filters, nothing more — no cross-page "select all results". Ant Design's
 * own header checkbox already limits itself to the rows on screen, so no
 * custom logic is needed for that half. This is the other half: a row
 * selected before a filter or account/status change narrowed the result set
 * must not stay silently selected once it can no longer be seen anywhere in
 * the table, filtered or not — that is exactly the "invisible rows acted on"
 * failure RQ-03 exists to prevent.
 *
 * Deliberately does *not* drop a selected id just because it sits on a
 * different page of the *same* filtered set. Turning the page is not
 * narrowing the result — the row is still reachable by turning back — so a
 * reader who checks rows on page 1, pages to 2 and checks more is doing the
 * ordinary, predictable thing a checkbox table does everywhere else. The
 * "N selected" count shown beside the batch buttons is what keeps that
 * visible rather than surprising.
 */
export function pruneSelection(
  selectedIds: readonly string[],
  visibleIds: readonly string[],
): string[] {
  const visible = new Set(visibleIds);
  return selectedIds.filter((id) => visible.has(id));
}

// --- Eligibility (RQ-05) ------------------------------------------------------

export interface BatchEligibilityRow {
  id: string;
  /** BankTxnStatus, kept as a bare string so this stays a dependency-free .ts file. */
  status: string;
}

export interface BatchEligibility<T extends BatchEligibilityRow> {
  /** Still awaiting review — nothing posted, safe to categorise. */
  eligible: T[];
  /** Already carries a journal entry — left exactly as it is. */
  skipped: T[];
}

/**
 * Split a selection into what a batch Category/Account assignment may change
 * and what it must leave alone.
 *
 * "unmatched" is the one status this screen shows for a line with no journal
 * entry behind it yet — the same condition `CategoriseCell` already uses to
 * decide whether to offer the picker at all, and `acc_categorise_bank_transaction`
 * itself enforces server-side (`v_txn.status <> 'unmatched'` refuses). Every
 * other status — matched by categorising, by approving a suggested match, or
 * by settling an invoice or bill from the line — already posted an entry.
 * Changing that would mean reversing it and posting a new one, which is a
 * closed-period, reversal-history operation the video never asked for; section
 * 8 of the change request says explicitly not to do it from here.
 */
export function splitBatchEligibility<T extends BatchEligibilityRow>(
  rows: readonly T[],
): BatchEligibility<T> {
  const eligible: T[] = [];
  const skipped: T[] = [];
  for (const row of rows) {
    (row.status === "unmatched" ? eligible : skipped).push(row);
  }
  return { eligible, skipped };
}

/**
 * The sentence a confirmation dialog reads before anything is saved — the
 * count of records that will change and the count that will be skipped
 * because they are already posted, which RQ-05 requires be shown together,
 * not just the total selected.
 */
export function describeBatchPreview(eligibleCount: number, skippedCount: number): string {
  const change = `${eligibleCount} transaction${eligibleCount === 1 ? "" : "s"}`;
  if (skippedCount === 0) return `This will change ${change}.`;
  const skip = `${skippedCount} transaction${skippedCount === 1 ? "" : "s"}`;
  return `This will change ${change} and skip ${skip} already posted to the ledger.`;
}

// --- Result reporting (RQ-05) -------------------------------------------------

export interface BatchActionOutcome {
  id: string;
  ok: boolean;
  /** The reason this row's post failed, verbatim from the database — a closed
   *  period, a row someone else posted while the dialog was open, and so on.
   *  Never a generic "failed": see the module doc for why that matters here. */
  error?: string;
}

export interface BatchActionSummary {
  successCount: number;
  failureCount: number;
  skippedCount: number;
  failures: { id: string; error: string }[];
}

/**
 * Turn per-row outcomes plus the skip count decided before saving into the
 * numbers a result screen reports. Kept apart from `describeBatchResult` and
 * `batchResultSeverity` below so each can be asserted on its own numbers
 * rather than only through rendered text.
 */
export function summarizeBatchResults(
  outcomes: readonly BatchActionOutcome[],
  skippedCount: number,
): BatchActionSummary {
  const failures = outcomes
    .filter((outcome) => !outcome.ok)
    .map((outcome) => ({ id: outcome.id, error: outcome.error ?? "Unknown error" }));
  return {
    successCount: outcomes.length - failures.length,
    failureCount: failures.length,
    skippedCount,
    failures,
  };
}

/**
 * One line for the result notification. Successes, failures and skips are
 * all named — RQ-05 requires a partial failure never read as complete
 * success, which a notification that only ever says "Done" would risk the
 * moment even one row in a hundred fails.
 */
export function describeBatchResult(summary: BatchActionSummary): string {
  const parts = [`${summary.successCount} updated`];
  if (summary.failureCount > 0) {
    parts.push(`${summary.failureCount} failed`);
  }
  if (summary.skippedCount > 0) {
    parts.push(`${summary.skippedCount} skipped (already posted)`);
  }
  return parts.join(", ");
}

/**
 * Which alert styling a result deserves. Skips alone are not a problem — they
 * were counted and disclosed before the reader confirmed — so only actual
 * failures push this past "success". Zero successes with at least one failure
 * is the one case that must never read as anything but an error: every row
 * the reader asked to change was refused.
 */
export function batchResultSeverity(summary: BatchActionSummary): "success" | "warning" | "error" {
  if (summary.failureCount === 0) return "success";
  return summary.successCount === 0 ? "error" : "warning";
}
