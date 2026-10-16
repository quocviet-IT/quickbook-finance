/**
 * A statement imported out of balance stays in sight until a reconciliation
 * settles it (2.11).
 *
 * An administrator may import a statement that does not add up, with a reason.
 * The record of it is kept by the database (`acc_statement_overrides()`, 0149):
 * who, when, why and by how much. The database also says whether a completed
 * reconciliation of the same account has reached the override's last line since;
 * this module only reads that answer and words it. It never recomputes
 * settlement, so the screen and the database cannot disagree about it.
 *
 * Pure: money is formatted by the caller's helper, and the moment is printed in
 * the company's time zone, passed in — never the machine's.
 */
import { shortDate } from "./pdf-statement-view";
import { stampInTimeZone } from "./stamp";

/** Formats minor units for the company, as the reconcile screens do. */
type Money = (minor: number) => string;

/** One row of `acc_statement_overrides()`, in the app's own names; money in minor units. */
export interface StatementOverride {
  batchId: string;
  bankAccountId: string;
  filename: string;
  /** When it was imported (the override is made in the same statement), as stored. */
  importedAt: string;
  /** The user who overrode. */
  overriddenBy: string;
  reason: string;
  /** How far the statement was out. */
  outByMinor: number;
  openingMinor: number;
  closingMinor: number;
  /** The dates the import covers; null for a batch with no lines. */
  firstLineDate: string | null;
  lastLineDate: string | null;
  /** The earliest completed reconciliation that reached the last line; null while open. */
  settledByReconciliationId: string | null;
  /** That reconciliation's statement ending date; null while open. */
  settledThrough: string | null;
}

/** An override with the name of the person who made it, from the actor directory. */
export interface NamedStatementOverride extends StatementOverride {
  overriddenByName: string;
}

export type OverrideStatus = "open" | "settled";

/** Open or settled, from what the database computed. A batch with no lines is never settled. */
export function overrideStatus(
  override: Pick<StatementOverride, "settledByReconciliationId" | "settledThrough">,
): OverrideStatus {
  return override.settledByReconciliationId !== null && override.settledThrough !== null ? "settled" : "open";
}

/** The date and time of a stored moment as the company's clock reads it: `{ date: "Oct 8, 2026", time: "11:47" }`. */
export function overrideMoment(importedAt: string, timeZone: string): { date: string; time: string } {
  const [day, time] = stampInTimeZone(importedAt, timeZone).split(" ");
  return { date: shortDate(day, true), time };
}

/** The calendar day of a stored moment in the company's time zone: `2026-10-08`. */
export function overrideDay(importedAt: string, timeZone: string): string {
  return stampInTimeZone(importedAt, timeZone).slice(0, 10);
}

/** What the sentences say about one override. `date` and `time` are already in the company's zone. */
export interface OverrideFacts {
  outByMinor: number;
  name: string;
  date: string;
  time: string;
  reason: string;
}

/** Facts for a sentence, from an override, its person's name and the company's time zone. */
export function overrideFacts(override: NamedStatementOverride, timeZone: string): OverrideFacts {
  return {
    outByMinor: override.outByMinor,
    name: override.overriddenByName,
    ...overrideMoment(override.importedAt, timeZone),
    reason: override.reason,
  };
}

/**
 * The import record's detail:
 * "Out by $12.00. Imported by Dana Reyes on Oct 8, 2026 at 11:47: “reason”. Open until a reconciliation through Sep 30, 2026 is completed."
 */
export function importRecordDetail(
  facts: OverrideFacts,
  settle: { status: "open"; lastLineDate: string | null } | { status: "settled"; settledThrough: string },
  money: Money,
): string {
  const head = `Out by ${money(facts.outByMinor)}. Imported by ${facts.name} on ${facts.date} at ${facts.time}: “${facts.reason}”.`;
  if (settle.status === "settled") return `${head} Settled by the reconciliation to ${shortDate(settle.settledThrough, true)}.`;
  const through = settle.lastLineDate ? ` through ${shortDate(settle.lastLineDate, true)}` : "";
  return `${head} Open until a reconciliation${through} is completed.`;
}

/** The import record's detail for one override, in the company's time zone. */
export function importRecordDetailOf(override: NamedStatementOverride, timeZone: string, money: Money): string {
  const facts = overrideFacts(override, timeZone);
  return override.settledThrough !== null && overrideStatus(override) === "settled"
    ? importRecordDetail(facts, { status: "settled", settledThrough: override.settledThrough }, money)
    : importRecordDetail(facts, { status: "open", lastLineDate: override.lastLineDate }, money);
}

/** The notice above the lines of a reconciliation in progress whose period holds the override's last line. */
export function reconciliationNotice(facts: OverrideFacts, money: Money): string {
  return (
    `A statement in this period was imported out of balance: out by ${money(facts.outByMinor)}, ` +
    `by ${facts.name} on ${facts.date}, “${facts.reason}”. Completing this reconciliation settles it.`
  );
}

/** The line in the report of the completed reconciliation that settled the override. */
export function reconciliationReportLine(facts: OverrideFacts, money: Money): string {
  return `Settles a statement imported out of balance: out by ${money(facts.outByMinor)}, by ${facts.name} on ${facts.date}, “${facts.reason}”.`;
}

/** Where a reconciliation in progress sits: its account, its statement end date, and the end of the one completed before it. */
export interface ReconciliationPeriod {
  bankAccountId: string;
  /** This reconciliation's statement ending date. */
  endingDate: string;
  /** The statement ending date of the account's newest completed reconciliation before this one; null when it has none. */
  previousEndingDate: string | null;
}

/**
 * The open overrides a reconciliation in progress will settle: the same account,
 * a last line on or before this statement's end and after the previous
 * completed reconciliation's end. Oldest import first.
 */
export function overridesForReconciliation<T extends StatementOverride>(
  overrides: readonly T[],
  period: ReconciliationPeriod,
): T[] {
  return overrides.filter(
    (o) =>
      o.bankAccountId === period.bankAccountId &&
      overrideStatus(o) === "open" &&
      o.lastLineDate !== null &&
      o.lastLineDate <= period.endingDate &&
      (period.previousEndingDate === null || o.lastLineDate > period.previousEndingDate),
  );
}

/** The overrides a completed reconciliation settled. */
export function overridesSettledBy<T extends StatementOverride>(overrides: readonly T[], reconciliationId: string): T[] {
  return overrides.filter((o) => o.settledByReconciliationId === reconciliationId);
}
