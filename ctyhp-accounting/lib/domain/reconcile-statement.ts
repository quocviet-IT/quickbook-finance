/**
 * What a reconciliation says about the statement it is reconciled against:
 * how each statement line stands with the books, and the sentences the start
 * dialog and the reconciliation show. Pure, so the wording is tested where it
 * is written.
 */
import { periodLabel, shortDate } from "./pdf-statement-view";
import { matchStatement, type PairBookLine, type PairStatementLine } from "./statement-pairing";

/** What bringing an account forward through a day would sign off. */
export interface BroughtForwardPreview {
  hasReconciliations: boolean;
  bookBalanceMinor: number;
  /** Posted lines up to that day. */
  openLines: number;
}

export interface BringForwardAdvice {
  canBringForward: boolean;
  /** The day before the statement's period: the last day brought forward. */
  through: string;
  text: string;
}

/** The ISO day before `iso`. */
export function dayBefore(iso: string): string {
  const day = new Date(`${iso}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - 1);
  return day.toISOString().slice(0, 10);
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Whether the first reconciliation of an account can bring the earlier lines
 * forward, as the prototype does: the book balance on the day before the
 * statement's period must equal the opening balance the statement prints.
 * Null when there is nothing to say — the account has been reconciled before,
 * the statement prints no period start or no opening balance, or the books
 * hold nothing earlier.
 */
export function bringForwardAdvice(
  preview: BroughtForwardPreview,
  statement: { from: string | null; openingMinor: number | null },
  money: (minor: number) => string,
): BringForwardAdvice | null {
  if (preview.hasReconciliations || !statement.from || statement.openingMinor === null) return null;
  const through = dayBefore(statement.from);
  const books = `The books hold ${money(preview.bookBalanceMinor)} on ${shortDate(through, true)}`;
  const opens = `the statement opens at ${money(statement.openingMinor)}`;
  if (preview.bookBalanceMinor === statement.openingMinor) {
    if (preview.openLines === 0) return null;
    const lines = preview.openLines === 1 ? "The 1 earlier line" : `The ${preview.openLines} earlier lines`;
    return { canBringForward: true, through, text: `${books} — ${opens}. ${lines} can be brought forward as reconciled.` };
  }
  const apart = money(Math.abs(preview.bookBalanceMinor - statement.openingMinor));
  return {
    canBringForward: false,
    through,
    text: `${books}, and ${opens}: ${apart} apart. The earlier lines stay open and are reconciled with this statement.`,
  };
}

/** The note a brought-forward reconciliation keeps. */
export function broughtForwardNote(from: string | null, to: string | null): string {
  return `Brought forward, proved by the opening balance on the statement for ${periodLabel(from, to)}`;
}

/** Said when the statement's closing balance is not the reconciliation's ending balance. */
export function closingAdvice(closingMinor: number | null, endingMinor: number, money: (minor: number) => string): string | null {
  if (closingMinor === null || closingMinor === endingMinor) return null;
  return `The statement closes at ${money(closingMinor)}; this reconciliation says ${money(endingMinor)}.`;
}

/** Said when the statement's opening balance is not where the reconciliation begins. */
export function openingAdvice(openingMinor: number | null, beginningMinor: number, money: (minor: number) => string): string | null {
  if (openingMinor === null || openingMinor === beginningMinor) return null;
  return (
    `The statement opens at ${money(openingMinor)}; this reconciliation begins at ${money(beginningMinor)}. ` +
    "A statement may be missing, or the last reconciliation closed on a different figure."
  );
}

export interface StandingBookLine extends PairBookLine {
  entryNumber: string | null;
  cleared: boolean;
}

export type Standing =
  | { kind: "paired"; how: string; bookId: string; entryNumber: string | null; ticked: boolean }
  | { kind: "missing" }
  | { kind: "after" };

export interface StatementStandings {
  /** One per statement line, in the order given. */
  standings: Standing[];
  paired: number;
  missing: number;
  after: number;
  flipped: boolean;
  /** Book lines not on the statement. */
  outstanding: string[];
}

/** How each statement line stands with the books as they are now. */
export function statementStandings(
  lines: readonly PairStatementLine[],
  book: readonly StandingBookLine[],
  statementDate: string,
): StatementStandings {
  const match = matchStatement(lines, book, statementDate);
  const byLine = new Map(match.pairs.map((pair) => [pair.line.lineNo, pair]));
  const byId = new Map(book.map((entry) => [entry.id, entry]));
  const standings = lines.map((line): Standing => {
    if (line.date > statementDate) return { kind: "after" };
    const pair = byLine.get(line.lineNo);
    if (!pair) return { kind: "missing" };
    const entry = byId.get(pair.book.id);
    return {
      kind: "paired",
      how: pair.how,
      bookId: pair.book.id,
      entryNumber: entry?.entryNumber ?? null,
      ticked: entry?.cleared ?? false,
    };
  });
  return {
    standings,
    paired: match.pairs.length,
    missing: match.missing.length,
    after: match.ignored,
    flipped: match.flipped,
    outstanding: match.unseen.map((entry) => entry.id),
  };
}

/** A reconciliation's kept statement and its book lines, in the shapes the screens and services hold them. */
export function reconciliationStandings(
  statement: {
    endingDate: string;
    lines: readonly { lineNo: number; txnDate: string; amountMinor: number; reference: string | null }[];
  },
  book: readonly {
    journalLineId: string;
    entryDate: string;
    signedMinor: number;
    reference: string | null;
    entryNumber: string | null;
    cleared: boolean;
  }[],
): StatementStandings {
  return statementStandings(
    statement.lines.map((l) => ({ lineNo: l.lineNo, date: l.txnDate, amountMinor: l.amountMinor, reference: l.reference })),
    book.map((b) => ({
      id: b.journalLineId,
      date: b.entryDate,
      amountMinor: b.signedMinor,
      reference: b.reference,
      entryNumber: b.entryNumber,
      cleared: b.cleared,
    })),
    statement.endingDate,
  );
}

export interface PairingOutcome {
  /** Statement lines kept with the reconciliation. */
  lines: number;
  paired: number;
  /** Book lines ticked by this pairing; pairs already ticked are not counted. */
  ticked: number;
  missing: number;
  after: number;
  flipped: boolean;
}

/** What importing or matching again says when it is done. */
export function pairingMessage(outcome: PairingOutcome): string {
  let text = `${outcome.paired} of ${plural(outcome.lines, "statement line")} paired with the books; ${outcome.ticked} newly ticked.`;
  if (outcome.missing > 0) {
    text += ` ${outcome.missing} not in the books — code ${outcome.missing === 1 ? "it" : "them"} in Bank Transactions, then Match again.`;
  }
  if (outcome.flipped) text += " The statement's amounts were read the other way round to pair them.";
  return text;
}
