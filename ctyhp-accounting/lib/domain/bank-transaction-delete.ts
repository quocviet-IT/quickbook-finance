/**
 * Whether a bank line may be deleted, and what to do instead (3.0.23).
 *
 * Item C of the defect report of 11 Nov 2026: any bank line could be deleted
 * through a warning. Delete on a line Banking had coded voided its entry and
 * removed the line in one click (RQ-06's correction, 0114); a warning a person
 * can click through is not a control. Now a line is deleted only when it is
 * unposted, unmatched and unreconciled, such as a duplicate import, and the
 * database says how every other line stands (acc_bank_line_delete_state,
 * migration 0192): the screen asks it when Delete is pressed, never guesses
 * from what the table happens to have loaded, because whether a line's entry
 * is ticked on a completed reconciliation is not something the table reads.
 *
 * Every refusal names the way out:
 *   - posted here       void that entry (it stays in the journal, marked Void),
 *                       then the line can be deleted;
 *   - matched elsewhere unmatch it (the entry stays posted), then delete;
 *   - reconciled        reopen that reconciliation, on its own page;
 *   - the rest          say what owns the line (a settlement, an import, a
 *                       suggested match, the bank feed).
 *
 * A dependency-free .ts file, so a test holds this without Ant Design.
 */

export const BANK_LINE_DELETE_KINDS = [
  "deletable",
  "suggested",
  "ignored",
  "settled",
  "reconciled",
  "import_batch",
  "posted",
  "matched",
] as const;
export type BankLineDeleteKind = (typeof BANK_LINE_DELETE_KINDS)[number];

/** How one bank line stands with deletion, as acc_bank_line_delete_state answers. */
export interface BankLineDeleteState {
  kind: BankLineDeleteKind;
  /** Why it is not deleted, in the database's own words; null when it may be. */
  message: string | null;
  /** The entry the line was posted with or matched to, when there is one. */
  entryNumber: string | null;
  /** The completed reconciliation it is ticked on, for a reconciled line. */
  reconciliationId: string | null;
  /** That reconciliation's statement ending date (YYYY-MM-DD). */
  reconciledTo: string | null;
}

/** Said when the answer is not one this screen knows how to read: nothing is offered. */
export const UNREADABLE_STATE = "This line's state could not be read, so nothing is offered. Close this and try again.";

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value : null);

/** The database's answer, read strictly: an answer this screen does not know is an error, never a delete. */
export function bankLineDeleteStateOf(raw: unknown): BankLineDeleteState {
  const value = (raw ?? {}) as Record<string, unknown>;
  const kind = value.kind;
  if (typeof kind !== "string" || !(BANK_LINE_DELETE_KINDS as readonly string[]).includes(kind)) {
    throw new Error(UNREADABLE_STATE);
  }
  const message = text(value.message);
  if (kind !== "deletable" && !message) throw new Error(UNREADABLE_STATE);
  return {
    kind: kind as BankLineDeleteKind,
    message: kind === "deletable" ? null : message,
    entryNumber: text(value.entry_number),
    reconciliationId: text(value.reconciliation_id),
    reconciledTo: text(value.reconciled_to),
  };
}

/** What the dialog offers for a line, in place of deleting it or as the delete itself. */
export type BankLineDeleteStep =
  | { kind: "delete" }
  | { kind: "void"; label: string; note: string }
  | { kind: "unmatch"; label: string; note: string }
  | { kind: "open"; label: string; href: string; note: string }
  | { kind: "none" };

/** The words the dialog uses, kept here so a test reads them where they are written. */
export const DELETE_DIALOG = {
  deleteTitle: "Delete this bank transaction?",
  refusedTitle: "This bank transaction is not deleted",
  deleteNote:
    "The line is removed from the bank register. Nothing in the ledger changes, because the line was never posted, and the whole line is kept in the audit log.",
  deleteLabel: "Delete it",
  reasonPlaceholder: "Why? A sentence, at least. It is kept in the audit log.",
  reasonMin: 10,
  checking: "Checking how this line stands…",
  noPermission: "Your role is not allowed to delete bank lines. An administrator can change that in Settings › Permissions.",
  deleted: "Bank transaction deleted",
  voided: "Entry voided. It stays in the journal, marked Void, and the line is back in For review.",
  unmatched: "Unmatched. The entry stays posted, and the line is back in For review.",
} as const;

/**
 * Under a refusal that has a way out: the message above it already says what
 * Void or Unmatch keeps, so this says only what can follow.
 */
export const AFTER_TAKING_BACK = "Once that is done, the line can be deleted here if it should not be in the register at all.";

/** What the dialog offers for this state. */
export function deleteStep(state: BankLineDeleteState): BankLineDeleteStep {
  const entry = state.entryNumber ?? "the entry";
  switch (state.kind) {
    case "deletable":
      return { kind: "delete" };
    case "posted":
      return { kind: "void", label: `Void ${entry}`, note: AFTER_TAKING_BACK };
    case "matched":
      return { kind: "unmatch", label: "Unmatch", note: AFTER_TAKING_BACK };
    case "reconciled":
      return state.reconciliationId
        ? {
            kind: "open",
            label: "Open the reconciliation",
            href: `/banking/reconcile/${state.reconciliationId}`,
            note: "Reopening a completed reconciliation is for an administrator, on its own page.",
          }
        : { kind: "none" };
    default:
      return { kind: "none" };
  }
}

/** Whether a reason is long enough for a delete, a void or an unmatch: the database asks for a sentence. */
export function reasonIsEnough(reason: string): boolean {
  return reason.trim().length >= DELETE_DIALOG.reasonMin;
}
