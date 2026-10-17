/**
 * What a reconciliation says about the statement it is reconciled against:
 * how each statement line stands with the books, and the sentences the start
 * dialog and the reconciliation show. Pure, so the wording is tested where it
 * is written.
 */
import { periodLabel } from "./pdf-statement-view";
import { matchStatement, type PairBookLine, type PairStatementLine } from "./statement-pairing";

import { formatDate, plural, pluralWord } from "@/lib/format";
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

/**
 * Whether the first reconciliation of an account can bring the earlier lines
 * forward, as the prototype does: the book balance on the day before the
 * statement's period must equal the opening balance the statement prints.
 * Null when there is nothing to say — the account has been reconciled before,
 * the statement prints no period start or no opening balance, or the books
 * hold nothing earlier and agree with the statement.
 */
export function bringForwardAdvice(
  preview: BroughtForwardPreview,
  statement: { from: string | null; openingMinor: number | null },
  money: (minor: number) => string,
): BringForwardAdvice | null {
  if (preview.hasReconciliations || !statement.from || statement.openingMinor === null) return null;
  const through = dayBefore(statement.from);
  const books = `The books hold ${money(preview.bookBalanceMinor)} on ${formatDate(through)}`;
  const opens = `the statement opens at ${money(statement.openingMinor)}`;
  if (preview.bookBalanceMinor === statement.openingMinor) {
    if (preview.openLines === 0) return null;
    const lines = `The ${plural(preview.openLines, "earlier line")}`;
    return { canBringForward: true, through, text: `${books} — ${opens}. ${lines} can be brought forward as reconciled.` };
  }
  if (preview.openLines === 0) {
    return {
      canBringForward: false,
      through,
      text: `${books}, and ${opens}. The books have nothing before this statement: the difference is an opening balance they do not hold yet.`,
    };
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

/** "1 entry", "1,204 entries". */
export function entriesCount(n: number): string {
  return plural(n, "entry", "entries");
}

// --- Bringing the history forward from inside a reconciliation (2.03) --------

/** Where a reconciliation in progress would bring its account's history forward to. */
export interface SessionHistoryStart {
  /** The day before the kept statement's period: the last day brought forward. */
  through: string;
  /** The balance the statement opens with: what the books must hold through `through`. */
  openingMinor: number;
}

/** A reconciliation as bringing its history forward reads it. */
export interface HistorySession {
  status: string;
  /** The kept statement file's period start; null when there is no file, or it names none. */
  periodStart: string | null;
  /** A statement file is kept with the reconciliation, but this person may not open it (saved files need documents.read). */
  fileUnreadable?: boolean;
  /** The balance the statement opens with; null when it prints none. */
  openingMinor: number | null;
  /** Where the reconciliation begins. */
  beginningMinor: number;
}

export const SESSION_HISTORY_REFUSAL = {
  notInProgress: "Only a reconciliation in progress can bring the history forward.",
  unreadFile:
    "You cannot open the statement file kept with this reconciliation, so the history cannot be brought forward from here.",
  noStart:
    "The statement file kept with this reconciliation names no period start or no opening balance, so the history cannot be brought forward from here.",
  begins: "This reconciliation already begins at the balance its statement opens with.",
} as const;

/** Why a reconciliation cannot bring its account's history forward, or null when it can ask. */
export function sessionHistoryRefusal(session: HistorySession): string | null {
  if (session.status !== "in_progress") return SESSION_HISTORY_REFUSAL.notInProgress;
  if (session.fileUnreadable) return SESSION_HISTORY_REFUSAL.unreadFile;
  if (!session.periodStart || session.openingMinor === null) return SESSION_HISTORY_REFUSAL.noStart;
  if (session.beginningMinor === session.openingMinor) return SESSION_HISTORY_REFUSAL.begins;
  return null;
}

/**
 * The day before the period of the statement file kept with a reconciliation in
 * progress, and the balance that statement opens with. Null when there is
 * nothing to offer: the session is not in progress, its statement file names no
 * period start or no opening balance, or the session already begins at that
 * opening (sessionHistoryRefusal says which).
 */
export function sessionHistoryStart(session: HistorySession): SessionHistoryStart | null {
  if (sessionHistoryRefusal(session) || !session.periodStart || session.openingMinor === null) return null;
  return { through: dayBefore(session.periodStart), openingMinor: session.openingMinor };
}

/** What the server reads for a reconciliation's offer to bring the history forward. */
export interface SessionHistoryFacts extends SessionHistoryStart {
  /** The posted lines on the account through `through`, as the books hold them. */
  bookBalanceMinor: number;
  /** How many posted lines through `through` bringing the history forward marks reconciled. */
  entries: number;
  /** The account already has a completed reconciliation: the history cannot be brought forward. */
  reconciled: boolean;
}

export interface SessionHistoryAdvice {
  /** Offer the button: the books agree with the statement's opening, and there is history to bring. */
  canBringForward: boolean;
  through: string;
  entries: number;
  text: string;
}

export const BRING_HISTORY_FORWARD = "Bring the history forward";
export const ALREADY_RECONCILED = "This account already has a completed reconciliation.";

/**
 * What a reconciliation says about bringing its account's history forward: the
 * books through the day before the statement must hold exactly the balance the
 * statement opens with, and the account must never have been reconciled. Null
 * when there is nothing to say (sessionHistoryStart). `money` is the screen's
 * own formatter.
 */
export function sessionHistoryAdvice(
  facts: SessionHistoryFacts | null,
  money: (minor: number) => string,
): SessionHistoryAdvice | null {
  if (!facts) return null;
  const { through, openingMinor, bookBalanceMinor, entries } = facts;
  const date = formatDate(through);
  if (facts.reconciled) return { canBringForward: false, through, entries, text: ALREADY_RECONCILED };
  if (bookBalanceMinor !== openingMinor) {
    return {
      canBringForward: false,
      through,
      entries,
      text:
        `The books on ${date} read ${money(bookBalanceMinor)}; the statement opens at ${money(openingMinor)}. ` +
        `Out by ${money(Math.abs(bookBalanceMinor - openingMinor))}.`,
    };
  }
  return {
    canBringForward: entries > 0,
    through,
    entries,
    text: `Everything in the books up to ${date} adds up to ${money(openingMinor)}, the balance this statement opens with.`,
  };
}

/** The question Bring the history forward asks before it marks anything. */
export function bringHistoryForwardConfirmation(entries: number, through: string): string {
  return `${entriesCount(entries)} up to ${formatDate(through)} will be marked reconciled. Nothing is posted to the books.`;
}

// --- Discarding a reconciliation in progress (2.03) --------------------------

export const DISCARD_RECONCILIATION = "Discard this reconciliation";
export const DISCARD_CONFIRMATION =
  "Its ticks and the statement lines kept with it are removed, along with any line set aside as not a transaction. The statement file and its bank lines stay, and any entries added to the books from it stay in the books.";
/** Where the person goes once the reconciliation is discarded: Reconcile, on the same account. */
export function discardedReturnPath(bankAccountId: string): string {
  return `/banking/reconcile?account=${encodeURIComponent(bankAccountId)}`;
}

/** Said once a reconciliation is discarded: "Reconciliation discarded, with its 12 ticks." */
export function discardedMessage(ticksRemoved: number): string {
  if (ticksRemoved <= 0) return "Reconciliation discarded.";
  const ticks = plural(ticksRemoved, "tick");
  return `Reconciliation discarded, with its ${ticks}.`;
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

/** A statement line as the standings take it: set aside, it is not a transaction and takes no part in pairing. */
export interface StandingStatementLine extends PairStatementLine {
  setAside?: boolean;
}

export type Standing =
  | { kind: "paired"; how: string; bookId: string; entryNumber: string | null; ticked: boolean }
  | { kind: "missing" }
  | { kind: "after" }
  /** Set aside as not a transaction (a misread line): never paired, never missing, never added. */
  | { kind: "aside" };

// --- A statement line set aside as not a transaction (2.03) ------------------

export const NOT_A_TRANSACTION = "Not a transaction";
export const RESTORE_LINE = "Restore";
export const PAIRED_LINE_REFUSAL = "This line is paired with the books, so it is a transaction.";
/**
 * Said once a line is set aside. Setting it aside changes the reconciliation
 * only: the bank line it was imported as stays waiting in Bank Transactions,
 * and the person is told so, since only they can say it is not real.
 */
export const SET_ASIDE_MESSAGE =
  "Set aside as not a transaction. Its line stays in Bank Transactions — exclude it there if it is not real.";

/**
 * Why a statement line cannot be set aside, or null when it can. A line the
 * books pair with is a transaction. Whether a line pairs is worked out here,
 * not stored, so this is the check the database cannot make. Bringing a line
 * back is always allowed.
 */
export function setAsideRefusal(standing: Standing | undefined, aside: boolean): string | null {
  return aside && standing?.kind === "paired" ? PAIRED_LINE_REFUSAL : null;
}

/** The one action a statement line offers on a reconciliation in progress, and what it asks for. */
export interface AsideAction {
  label: string;
  aside: boolean;
}

/**
 * What a statement line offers someone who can write: a line the books do not
 * have can be set aside as not a transaction, and a line set aside can be
 * restored. A paired line, or one dated after the statement, offers nothing.
 */
export function asideActionFor(standing: Standing | undefined): AsideAction | null {
  if (standing?.kind === "missing") return { label: NOT_A_TRANSACTION, aside: true };
  if (standing?.kind === "aside") return { label: RESTORE_LINE, aside: false };
  return null;
}

/**
 * How a pair was made, in the screen's words. The pairing keeps the
 * prototype's own names, and the prototype writes "cheque"; the screen is US
 * English.
 */
export function pairedHowLabel(how: string): string {
  return how === "cheque number" ? "check number" : how;
}

export interface StatementStandings {
  /** One per statement line, in the order given. */
  standings: Standing[];
  paired: number;
  missing: number;
  after: number;
  /** Lines set aside as not a transaction. */
  aside: number;
  flipped: boolean;
  /** Book lines not on the statement. */
  outstanding: string[];
}

/**
 * How each statement line stands with the books as they are now. A line set
 * aside is left out of the pairing altogether, so it can neither take a book
 * line nor be counted as missing.
 */
export function statementStandings(
  lines: readonly StandingStatementLine[],
  book: readonly StandingBookLine[],
  statementDate: string,
): StatementStandings {
  const taking = lines
    .filter((line) => !line.setAside)
    .map((line) => ({ lineNo: line.lineNo, date: line.date, amountMinor: line.amountMinor, reference: line.reference }));
  const match = matchStatement(taking, book, statementDate);
  const byLine = new Map(match.pairs.map((pair) => [pair.line.lineNo, pair]));
  const byId = new Map(book.map((entry) => [entry.id, entry]));
  const standings = lines.map((line): Standing => {
    if (line.setAside) return { kind: "aside" };
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
    aside: lines.length - taking.length,
    flipped: match.flipped,
    outstanding: match.unseen.map((entry) => entry.id),
  };
}

/** A reconciliation's kept statement and its book lines, in the shapes the screens and services hold them. */
export function reconciliationStandings(
  statement: {
    endingDate: string;
    lines: readonly { lineNo: number; txnDate: string; amountMinor: number; reference: string | null; setAside?: boolean }[];
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
    statement.lines.map((l) => ({
      lineNo: l.lineNo,
      date: l.txnDate,
      amountMinor: l.amountMinor,
      reference: l.reference,
      setAside: l.setAside ?? false,
    })),
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
    text += ` ${outcome.missing} not in the books — code ${pluralWord(outcome.missing, "it", "them")} in Bank Transactions, then Match again.`;
  }
  if (outcome.flipped) text += " The statement's amounts were read the other way around to pair them.";
  return text;
}
