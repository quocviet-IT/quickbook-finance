/**
 * What changed after a reconciliation was signed off, in words.
 *
 * Pure: the rows of `acc_reconciliation_changes()` in, one group per completed
 * reconciliation out, and the sentences that describe each group. Imports only
 * the date helper, because the Exceptions screen ships this module to the
 * browser (`tests/unit/exceptions-lean-imports.test.ts` guards it).
 *
 * Money is base-currency minor units; the debit to the bank is positive.
 */
import { formatDate } from "@/lib/format";

export type ReconciliationChangeKind = "voided" | "reversed" | "added" | "drift";

export interface ReconciliationChange {
  changeKey: string;
  reconciliationId: string;
  bankAccountId: string;
  statementEndingDate: string;
  completedAt: string;
  kind: ReconciliationChangeKind;
  entryId: string | null;
  entryNumber: string | null;
  entryDate: string | null;
  /** The entry's net on the bank account; null for a drift. */
  signedMinor: number | null;
  reversalEntryId: string | null;
  reversalEntryNumber: string | null;
  /** The drift: saved ending less (beginning plus posted ticked lines); null for an entry. */
  differenceMinor: number | null;
}

const KINDS: readonly string[] = ["voided", "reversed", "added", "drift"];

function textOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function numberOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

/** Maps one RPC row (snake_case, bigint as a string) to a change. A kind the app does not know is refused. */
export function toReconciliationChange(row: Record<string, unknown>): ReconciliationChange {
  const kind = String(row.kind);
  if (!KINDS.includes(kind)) throw new Error(`Unknown reconciliation change: ${kind}`);
  return {
    changeKey: String(row.change_key),
    reconciliationId: String(row.reconciliation_id),
    bankAccountId: String(row.bank_account_id),
    statementEndingDate: String(row.statement_ending_date).slice(0, 10),
    completedAt: String(row.completed_at),
    kind: kind as ReconciliationChangeKind,
    entryId: textOrNull(row.entry_id),
    entryNumber: textOrNull(row.entry_number),
    entryDate: row.entry_date === null || row.entry_date === undefined ? null : String(row.entry_date).slice(0, 10),
    signedMinor: numberOrNull(row.signed_minor),
    reversalEntryId: textOrNull(row.reversal_entry_id),
    reversalEntryNumber: textOrNull(row.reversal_entry_number),
    differenceMinor: numberOrNull(row.difference_minor),
  };
}

/** One change to a signed-off reconciliation that has an entry behind it. */
export interface ChangeItem {
  kind: Exclude<ReconciliationChangeKind, "drift">;
  entryId: string | null;
  entryNumber: string | null;
  entryDate: string | null;
  /** The reversing entry, for a reversal. */
  reversalEntryNumber: string | null;
}

/** A completed reconciliation with at least one change. */
export interface ChangedReconciliation {
  reconciliationId: string;
  bankAccountId: string;
  statementEndingDate: string;
  items: ChangeItem[];
  /**
   * The part of the drift the voided entries do not explain, signed; 0 when
   * there is no drift or the voids explain all of it.
   */
  unexplainedDriftMinor: number;
}

const ITEM_ORDER: Record<ChangeItem["kind"], number> = { voided: 0, reversed: 1, added: 2 };

/**
 * Group the change rows per completed reconciliation, oldest statement first.
 *
 * A void takes a ticked line out of the sign-off sum, so the same void also
 * arrives as a `drift` row whose difference is exactly what the void removed.
 * Printing both would say the one thing twice, so the drift is reduced by the
 * voided entries' amounts and only the rest is kept. A reversal leaves the
 * original posted, so it never explains a drift.
 *
 * `asOf`, when given, leaves out reconciliations whose statement ends after it.
 */
export function groupReconciliationChanges(
  changes: readonly ReconciliationChange[],
  asOf?: string,
): ChangedReconciliation[] {
  const byId = new Map<string, ChangedReconciliation>();
  const drift = new Map<string, number>();
  const voidedMinor = new Map<string, number>();
  for (const c of changes) {
    if (asOf !== undefined && c.statementEndingDate > asOf) continue;
    let rec = byId.get(c.reconciliationId);
    if (!rec) {
      rec = {
        reconciliationId: c.reconciliationId,
        bankAccountId: c.bankAccountId,
        statementEndingDate: c.statementEndingDate,
        items: [],
        unexplainedDriftMinor: 0,
      };
      byId.set(c.reconciliationId, rec);
    }
    if (c.kind === "drift") {
      drift.set(c.reconciliationId, (drift.get(c.reconciliationId) ?? 0) + (c.differenceMinor ?? 0));
      continue;
    }
    if (c.kind === "voided") voidedMinor.set(c.reconciliationId, (voidedMinor.get(c.reconciliationId) ?? 0) + (c.signedMinor ?? 0));
    rec.items.push({
      kind: c.kind,
      entryId: c.entryId,
      entryNumber: c.entryNumber,
      entryDate: c.entryDate,
      reversalEntryNumber: c.reversalEntryNumber,
    });
  }
  for (const rec of byId.values()) {
    rec.unexplainedDriftMinor = (drift.get(rec.reconciliationId) ?? 0) - (voidedMinor.get(rec.reconciliationId) ?? 0);
    rec.items.sort(
      (a, b) =>
        ITEM_ORDER[a.kind] - ITEM_ORDER[b.kind] ||
        (a.entryDate ?? "").localeCompare(b.entryDate ?? "") ||
        (a.entryNumber ?? "").localeCompare(b.entryNumber ?? ""),
    );
  }
  return [...byId.values()]
    .filter((rec) => rec.items.length > 0 || rec.unexplainedDriftMinor !== 0)
    .sort(
    (a, b) =>
      a.statementEndingDate.localeCompare(b.statementEndingDate) ||
      a.reconciliationId.localeCompare(b.reconciliationId),
  );
}

/** How the screen and the export format an amount. */
export type ChangeMoney = (minor: number) => string;

const entryName = (number: string | null) => number ?? "An entry";

/** One change in words. */
export function changeSentence(item: ChangeItem): string {
  if (item.kind === "voided") return `${entryName(item.entryNumber)} was voided.`;
  if (item.kind === "reversed") {
    return item.reversalEntryNumber
      ? `${entryName(item.entryNumber)} was reversed by ${item.reversalEntryNumber}.`
      : `${entryName(item.entryNumber)} was reversed.`;
  }
  const dated = item.entryDate ? `, dated ${formatDate(item.entryDate)},` : "";
  return `${entryName(item.entryNumber)}${dated} was posted after the reconciliation was signed off.`;
}

/** The drift in words; the amount is shown without a sign, as how far out it is. */
export function driftSentence(unexplainedMinor: number, money: ChangeMoney): string {
  return `The reconciliation no longer adds up: it is out by ${money(Math.abs(unexplainedMinor))}.`;
}

/** Every sentence of one reconciliation, the entries first and the drift last. */
export function reconciliationChangeSentences(rec: ChangedReconciliation, money: ChangeMoney): string[] {
  const out = rec.items.map(changeSentence);
  if (rec.unexplainedDriftMinor !== 0) out.push(driftSentence(rec.unexplainedDriftMinor, money));
  return out;
}
