/**
 * A transfer between two bank accounts, checked on both statements.
 *
 * Pure: the rows of `acc_transfer_legs()` in, a verdict per transfer out. Each
 * transfer has two legs, one per bank account, and each clears on its own
 * account's statement. A leg is OPEN when its other leg cleared and it did not,
 * although its account's statements already reach the entry date.
 *
 * Imports nothing, because the Exceptions screen ships this module to the
 * browser (`tests/unit/exceptions-lean-imports.test.ts` guards it).
 *
 * Money is base-currency minor units; the debit to the bank is positive.
 */
import { plural } from "@/lib/format";

/** An open leg is only raised once its entry is older than this many days. */
export const TRANSFER_AGE_DAYS = 30;
/** A correcting entry counts when it is dated within this many days of the transfer. */
export const TRANSFER_CORRECTION_DAYS = 7;

export type TransferRowKind = "leg" | "candidate" | "skipped";

/** One row of `acc_transfer_legs()`. */
export interface TransferRow {
  rowKey: string;
  rowKind: TransferRowKind;
  entryId: string;
  entryNumber: string;
  entryDate: string;
  /** The leg's bank account; for a candidate, the open leg's. Null for a skipped entry. */
  bankAccountId: string | null;
  journalLineId: string | null;
  /** The leg's signed amount; for a candidate, the open leg's. */
  signedMinor: number | null;
  tickedReconciliationId: string | null;
  tickedStatementDate: string | null;
  /** The latest completed statement date of the leg's account. */
  coveredThrough: string | null;
  candidateSource: "statement_line" | "ledger_line" | null;
  candidateId: string | null;
  candidateBankAccountId: string | null;
  candidateDate: string | null;
  candidateEntryId: string | null;
  candidateEntryNumber: string | null;
  /** The posted entry that reverses this one, when there is one. */
  reversedByEntryId: string | null;
  reversedByEntryNumber: string | null;
  /** The entry this one reverses, when it is itself a reversal. */
  reversalOfEntryId: string | null;
}

const KINDS: readonly string[] = ["leg", "candidate", "skipped"];

function textOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function dayOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value).slice(0, 10);
}

/** Maps one RPC row (snake_case, bigint as a string) to a transfer row. */
export function toTransferRow(row: Record<string, unknown>): TransferRow {
  const kind = String(row.row_kind);
  if (!KINDS.includes(kind)) throw new Error(`Unknown transfer row: ${kind}`);
  const source = textOrNull(row.candidate_source);
  return {
    rowKey: String(row.row_key),
    rowKind: kind as TransferRowKind,
    entryId: String(row.entry_id),
    entryNumber: String(row.entry_number),
    entryDate: String(row.entry_date).slice(0, 10),
    bankAccountId: textOrNull(row.bank_account_id),
    journalLineId: textOrNull(row.journal_line_id),
    signedMinor: row.signed_minor === null || row.signed_minor === undefined ? null : Number(row.signed_minor),
    tickedReconciliationId: textOrNull(row.ticked_reconciliation_id),
    tickedStatementDate: dayOrNull(row.ticked_statement_date),
    coveredThrough: dayOrNull(row.covered_through),
    candidateSource: source === "statement_line" || source === "ledger_line" ? source : null,
    candidateId: textOrNull(row.candidate_id),
    candidateBankAccountId: textOrNull(row.candidate_bank_account_id),
    candidateDate: dayOrNull(row.candidate_date),
    candidateEntryId: textOrNull(row.candidate_entry_id),
    candidateEntryNumber: textOrNull(row.candidate_entry_number),
    reversedByEntryId: textOrNull(row.reversed_by_entry_id),
    reversedByEntryNumber: textOrNull(row.reversed_by_entry_number),
    reversalOfEntryId: textOrNull(row.reversal_of_entry_id),
  };
}

/** Where the money most likely went. */
export interface TransferDestination {
  bankAccountId: string;
  source: "statement_line" | "ledger_line";
  date: string;
  /** The ledger entry, when the evidence is a ledger line. */
  entryNumber: string | null;
}

/** A transfer cleared on one side only. */
export interface FlaggedTransfer {
  entryId: string;
  entryNumber: string;
  entryDate: string;
  /** The amount, unsigned. */
  amountMinor: number;
  clearedBankAccountId: string;
  clearedStatementDate: string;
  openBankAccountId: string;
  /** Best first; null when no other account shows the amount. */
  destination: TransferDestination | null;
  /** How many places the amount was found on other accounts. */
  candidateCount: number;
}

/** A transfer whose open leg was answered by a later entry that moved the money on. */
export interface CorrectedTransfer {
  entryId: string;
  entryNumber: string;
  entryDate: string;
  amountMinor: number;
  openBankAccountId: string;
  correctingEntryId: string;
  correctingEntryNumber: string;
  correctingEntryDate: string;
  /** The third bank account the correcting entry moved the money to; null when the correcting entry is a reversal. */
  movedToBankAccountId: string | null;
}

export interface TransferCheck {
  flagged: FlaggedTransfer[];
  /** Transfers with an open leg whose statements do not yet reach the entry date. */
  notYetCheckable: number;
  corrected: CorrectedTransfer[];
  /** Entries with more than two lines on bank accounts, which are not judged. */
  skipped: number;
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);
}

interface Leg {
  row: TransferRow;
  bankAccountId: string;
  signedMinor: number;
}

function asLeg(row: TransferRow): Leg | null {
  if (row.bankAccountId === null || row.signedMinor === null) return null;
  return { row, bankAccountId: row.bankAccountId, signedMinor: row.signedMinor };
}

const bySourceThenNearest =
  (entryDate: string) =>
  (a: TransferRow, b: TransferRow): number => {
    const rank = (r: TransferRow) => (r.candidateSource === "statement_line" ? 0 : 1);
    const gap = (r: TransferRow) => Math.abs(daysBetween(entryDate, r.candidateDate ?? entryDate));
    return rank(a) - rank(b) || gap(a) - gap(b) || a.rowKey.localeCompare(b.rowKey);
  };

/**
 * Judge every transfer.
 *
 * `today` is the company's today, never the machine's. A leg is open when the
 * other leg is ticked on a completed reconciliation, it is not ticked itself,
 * its account's statements reach the entry date, and the entry is more than
 * 30 days old. When the statements do not reach it yet it is counted, not
 * flagged. When a later entry on the same account moves the amount on to a
 * third bank account within 7 days, it is reported as corrected.
 */
export function checkTransfers(rows: readonly TransferRow[], today: string): TransferCheck {
  const legsByEntry = new Map<string, Leg[]>();
  const candidatesByLine = new Map<string, TransferRow[]>();
  let skipped = 0;
  for (const row of rows) {
    if (row.rowKind === "skipped") {
      skipped += 1;
    } else if (row.rowKind === "leg") {
      // An entry that reverses another is not a transfer of its own.
      if (row.reversalOfEntryId !== null) continue;
      const leg = asLeg(row);
      if (leg) legsByEntry.set(row.entryId, [...(legsByEntry.get(row.entryId) ?? []), leg]);
    } else if (row.journalLineId !== null) {
      candidatesByLine.set(row.journalLineId, [...(candidatesByLine.get(row.journalLineId) ?? []), row]);
    }
  }

  const allLegs = [...legsByEntry.values()].flat();
  const flagged: FlaggedTransfer[] = [];
  const corrected: CorrectedTransfer[] = [];
  let notYetCheckable = 0;

  for (const legs of legsByEntry.values()) {
    if (legs.length !== 2) continue;
    const ticked = legs.filter((l) => l.row.tickedReconciliationId !== null);
    if (ticked.length !== 1) continue;
    const cleared = ticked[0];
    const open = legs.find((l) => l !== cleared);
    if (!open || open.bankAccountId === cleared.bankAccountId) continue;
    const entry = open.row;
    if (daysBetween(entry.entryDate, today) <= TRANSFER_AGE_DAYS) continue;
    // A posted reversal cancels the transfer, including its open leg.
    const reversal = legs.find((l) => l.row.reversedByEntryId !== null)?.row;
    if (reversal) {
      corrected.push({
        entryId: entry.entryId,
        entryNumber: entry.entryNumber,
        entryDate: entry.entryDate,
        amountMinor: Math.abs(open.signedMinor),
        openBankAccountId: open.bankAccountId,
        correctingEntryId: reversal.reversedByEntryId as string,
        correctingEntryNumber: reversal.reversedByEntryNumber ?? "its reversal",
        correctingEntryDate: entry.entryDate,
        movedToBankAccountId: null,
      });
      continue;
    }
    if (open.row.coveredThrough === null || open.row.coveredThrough < entry.entryDate) {
      notYetCheckable += 1;
      continue;
    }

    // An entry on the open leg's account for the opposite amount, shortly after,
    // whose other leg is on a third bank account: the money was moved on.
    const correction = allLegs
      .filter(
        (l) =>
          l.row.entryId !== entry.entryId &&
          l.bankAccountId === open.bankAccountId &&
          l.signedMinor === -open.signedMinor &&
          Math.abs(daysBetween(entry.entryDate, l.row.entryDate)) <= TRANSFER_CORRECTION_DAYS,
      )
      .map((l) => ({
        leg: l,
        other: (legsByEntry.get(l.row.entryId) ?? []).find((o) => o !== l && o.bankAccountId !== open.bankAccountId),
      }))
      .filter((c) => c.other !== undefined && c.other.bankAccountId !== cleared.bankAccountId)
      .sort((a, b) => a.leg.row.entryDate.localeCompare(b.leg.row.entryDate) || a.leg.row.entryNumber.localeCompare(b.leg.row.entryNumber))[0];
    if (correction?.other) {
      corrected.push({
        entryId: entry.entryId,
        entryNumber: entry.entryNumber,
        entryDate: entry.entryDate,
        amountMinor: Math.abs(open.signedMinor),
        openBankAccountId: open.bankAccountId,
        correctingEntryId: correction.leg.row.entryId,
        correctingEntryNumber: correction.leg.row.entryNumber,
        correctingEntryDate: correction.leg.row.entryDate,
        movedToBankAccountId: correction.other.bankAccountId,
      });
      continue;
    }

    // The ticked leg's own account is not "somewhere else".
    const evidence = (candidatesByLine.get(open.row.journalLineId ?? "") ?? [])
      .filter((c) => c.candidateSource !== null && c.candidateBankAccountId !== null && c.candidateBankAccountId !== cleared.bankAccountId)
      .sort(bySourceThenNearest(entry.entryDate));
    const best = evidence[0];
    flagged.push({
      entryId: entry.entryId,
      entryNumber: entry.entryNumber,
      entryDate: entry.entryDate,
      amountMinor: Math.abs(open.signedMinor),
      clearedBankAccountId: cleared.bankAccountId,
      clearedStatementDate: cleared.row.tickedStatementDate ?? "",
      openBankAccountId: open.bankAccountId,
      destination: best
        ? {
            bankAccountId: best.candidateBankAccountId as string,
            source: best.candidateSource as "statement_line" | "ledger_line",
            date: best.candidateDate ?? entry.entryDate,
            entryNumber: best.candidateEntryNumber,
          }
        : null,
      candidateCount: evidence.length,
    });
  }

  const byEntry = (a: { entryDate: string; entryNumber: string }, b: { entryDate: string; entryNumber: string }) =>
    a.entryDate.localeCompare(b.entryDate) || a.entryNumber.localeCompare(b.entryNumber);
  flagged.sort(byEntry);
  corrected.sort(byEntry);
  return { flagged, notYetCheckable, corrected, skipped };
}

/** "Likely went to {account}" or "No other account shows it". */
export function destinationSentence(destinationName: string | null): string {
  return destinationName === null ? "No other account shows it" : `Likely went to ${destinationName}`;
}

/** How many places the amount was found, or null when it was found nowhere. */
export function candidateNote(count: number): string | null {
  if (count <= 0) return null;
  return `${plural(count, "candidate")} found`;
}

/** A corrected transfer in words. It only names the correcting entry; nothing is offered. */
export function correctedSentence(
  c: Pick<CorrectedTransfer, "entryNumber" | "correctingEntryNumber" | "amountMinor">,
  movedToName: string | null, money: (minor: number) => string): string {
  if (movedToName === null) return `${c.entryNumber} was reversed by ${c.correctingEntryNumber}.`;
  const where = movedToName ? ` and moved ${money(c.amountMinor)} to ${movedToName}` : "";
  return `${c.entryNumber} was corrected by ${c.correctingEntryNumber}${where}.`;
}

/** The section's note: how many rows, then what was set aside and why. */
export function transferNote(check: {
  flagged: readonly unknown[];
  notYetCheckable: number;
  corrected: readonly unknown[];
  skipped: number;
}): string {
  const n = check.flagged.length;
  const parts = [plural(n, "transfer")];
  parts.push(`${check.notYetCheckable} could not be checked yet`);
  parts.push(`${check.corrected.length} corrected`);
  parts.push(`${check.skipped} skipped`);
  return parts.join(" · ");
}
