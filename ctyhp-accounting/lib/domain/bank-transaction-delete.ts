/**
 * Whether — and how — a bank line's Delete control may act.
 *
 * Correction to RQ-06, 2026-08-17: the first Delete control only ever worked
 * on an `unmatched` row. Pacific Four Nine holds 289 bank transactions, all
 * `matched` — every one categorised, and categorising posts a journal entry
 * (`acc_categorise_bank_transaction`, migration 0111). So that control
 * appeared on no row at all for the company that asked for it. The fix is a
 * Delete on every row that, when the row still carries the journal entry
 * Banking itself posted, voids that entry first — the same thing the
 * Category cell's own "Change" link already does — and only then deletes
 * the line.
 *
 * Where the books genuinely refuse, this says why rather than hiding the
 * control:
 *   - a transactions-import batch owns the entry (its own Undo reverses it);
 *   - the line was settled against an invoice or bill, which points its
 *     reconciliation at a payment instead of a journal line;
 *   - the line was matched to an entry something else posted (a manually
 *     approved suggestion against a pre-existing entry);
 *   - the line was removed by the bank feed (`ignored`) and is not part of
 *     the register the reader is looking at;
 *   - a suggested match is still open against an otherwise-unmatched line.
 *
 * One case is deliberately NOT decided here: a closed period. That answer
 * lives in the database (the void trigger raises `Cannot void an entry in a
 * closed period…`) and reaches the reader as the server's own error message
 * after a confirmed click, because the period a journal entry was posted in
 * is not data this screen loads for every row up front.
 *
 * A dependency-free .ts file on purpose, so a test can hold this contract
 * without paying for Ant Design's runtime.
 */

export type BankTxnDeleteStatus = "unmatched" | "matched" | "ignored";

/** What a matched line was posted to — the same shape `BankPostingRow`
 *  already carries, trimmed to what this decision needs. */
export interface BankTransactionDeletePosting {
  /** Whether the journal entry is one Banking posted itself (via
   *  Categorise) and may therefore also take back. `false` covers both an
   *  entry a transactions import posted and an entry something else — an
   *  invoice, a bill, a manual journal — posted and this line was only
   *  matched against. */
  ownEntry: boolean;
  entryNumber: string | null;
  /** The enum value from `acc_journal_entry.source_type`, e.g. "manual" —
   *  named in the refusal so "matched by something else" is not a mystery. */
  sourceType: string;
}

export interface BankTransactionDeleteInput {
  status: BankTxnDeleteStatus;
  /** Set only by the Import Transactions feature (migration 0108). */
  transactionBatchId: string | null;
  /** `acc_bank_transaction_postings` for this line, or null when status is
   *  "matched" but no journal-line-based reconciliation exists at all —
   *  which is what a settlement against an invoice or bill looks like: its
   *  reconciliation points at a payment, not a journal line. */
  posting: BankTransactionDeletePosting | null;
  /** A suggested (not yet approved) ledger match still open against this
   *  line. `acc_delete_bank_transaction` refuses any row that carries a
   *  reconciliation row of any status, approved or not. */
  hasOpenSuggestion: boolean;
}

export type BankTransactionDeleteEligibility =
  | { kind: "delete_only" }
  | { kind: "void_then_delete"; entryNumber: string | null }
  | { kind: "blocked"; reason: string };

/** Enum values read better as words: "ar_payment" -> "ar payment". */
function humanize(sourceType: string): string {
  return sourceType.replaceAll("_", " ");
}

export function evaluateBankTransactionDelete(
  input: BankTransactionDeleteInput,
): BankTransactionDeleteEligibility {
  if (input.status === "ignored") {
    return {
      kind: "blocked",
      reason:
        "This line was removed by the bank feed and is excluded from the register; there is nothing here to delete.",
    };
  }

  if (input.status === "unmatched") {
    if (input.hasOpenSuggestion) {
      return {
        kind: "blocked",
        reason: "This line has a match against it. Reject the match first, then delete the line.",
      };
    }
    return { kind: "delete_only" };
  }

  // status === "matched" from here.
  if (input.transactionBatchId) {
    return {
      kind: "blocked",
      reason: "This line came from a transactions import. Undo that import instead — it owns the entry.",
    };
  }
  if (!input.posting) {
    return {
      kind: "blocked",
      reason: "This line was settled against an invoice or bill. Remove that payment first, then delete the line.",
    };
  }
  if (!input.posting.ownEntry) {
    return {
      kind: "blocked",
      reason: `This line's entry was posted by ${humanize(input.posting.sourceType)}, not by categorising it here. Undo that match first, then delete the line.`,
    };
  }
  return { kind: "void_then_delete", entryNumber: input.posting.entryNumber };
}
