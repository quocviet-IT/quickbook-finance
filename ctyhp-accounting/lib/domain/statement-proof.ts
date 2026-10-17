/**
 * Proving a statement against the balances it prints (2.04, OB-2).
 *
 * A statement proves itself when its opening balance plus the sum of its lines
 * comes to its closing balance, to the cent. Pure, so the rule, its order of
 * trust and every sentence the import dialog says about it are tested where
 * they are written. The dialog runs `proveStatement` on the file it read; each
 * server action runs `proveStatementPayload` on what it is sent — the same
 * arithmetic (`settle`) — and refuses before the database is asked; the
 * database then checks a third time.
 *
 * Which lines count: every line read except those marked Not a transaction.
 * A line skipped as already in Bank Transactions from another source still
 * counts: the proof is about the statement, not about what is new.
 *
 * The closing, in order of trust:
 *   1. printed on a PDF (or, with no total printed, its last running balance);
 *   2. the balance on the last line of a CSV, the file put oldest first;
 *   3. an OFX LEDGERBAL, only when it is as of the file's end day (one as of a
 *      later day is not used);
 *   4. typed by the person.
 *
 * The opening, in order of trust:
 *   1. printed on a PDF, or worked out from its first running balance; a QIF
 *      "Opening Balance" record;
 *   2. the first balance of a CSV less the lines up to it;
 *   3. the closing of the account's last completed reconciliation — taken
 *      when the statement's start is known and is the day after it, or, for a
 *      CSV that prints no balance, when every line falls after it; offered
 *      when the start is not known, and neither when a line falls on or before
 *      that reconciliation's date;
 *   4. typed by the person.
 *
 * Never from the books: a figure worked out from the books agrees with the
 * books whatever the truth is, so it would prove nothing.
 */
import {
  CLOSING_BASES,
  OPENING_BASES,
  statementOverrideSchema,
  statementProofPayloadSchema,
  type ClosingBasis,
  type OpeningBasis,
  type StatementOverride,
  type StatementProofPayload,
} from "./statement-proof-schema";
import type { PdfStatement } from "./pdf-statement";
import { shortDate } from "./pdf-statement-view";
import { statementLineName } from "./reconcile-difference";
import type { StatementFileResult } from "./statement-files";
import type { StatementLine } from "./statement-import";

// The schemas live apart (statement-proof-schema.ts) so the forms' schemas.ts
// does not pull this module into the bundle every page shares.
export { CLOSING_BASES, OPENING_BASES, statementOverrideSchema, statementProofPayloadSchema };
export type { ClosingBasis, OpeningBasis, StatementOverride, StatementProofPayload };

export type StatementKind = "pdf" | "csv" | "ofx" | "qif";

/** A statement line as the proof reads it. */
export interface ProofLine {
  txn_date: string;
  amount_minor: number;
  /** Names the line in the one-line hint; absent on a line read only for its date and amount. */
  description?: string;
  /** The balance a CSV prints beside the line; read only for a CSV. */
  running_balance_minor?: number | null;
}

/** What a file says about its own balances and period. Every part is optional: most files say little. */
export interface StatementFigures {
  openingMinor?: number | null;
  /** Absent means printed. */
  openingBasis?: OpeningBasis | null;
  closingMinor?: number | null;
  /** Absent means printed. */
  closingBasis?: ClosingBasis | null;
  /** An OFX LEDGERBAL and the day it is as of. */
  ledgerMinor?: number | null;
  ledgerAsOf?: string | null;
  /** The first day the statement covers (a PDF period, OFX DTSTART). */
  start?: string | null;
  /** The last day it covers (a PDF period, OFX DTEND). */
  end?: string | null;
}

/** The account's last completed reconciliation: the prior statement's closing. */
export interface PriorClosing {
  /** Its statement ending date. */
  date: string;
  /** Its statement ending balance. */
  endingMinor: number;
}

export interface StatementProofInput {
  kind: StatementKind;
  /** Every line read, in file order. */
  lines: readonly ProofLine[];
  /** Indexes into `lines` of the lines marked Not a transaction. */
  aside?: Iterable<number>;
  /** What the file says about its balances; nothing for a CSV, whose balances are its lines'. */
  figures?: StatementFigures;
  /** The account's last completed reconciliation, or null when it has none. */
  prior?: PriorClosing | null;
  /** The person pressed "Use $X (the closing of the reconciliation to …)". */
  usePrior?: boolean;
  /** Typed into "Opening balance printed on the statement"; used only when nothing above gives the opening. */
  typedOpeningMinor?: number | null;
  /** Typed into "Closing balance printed on the statement"; used only when nothing above gives the closing. */
  typedClosingMinor?: number | null;
}

/**
 * What the proof did with the last completed reconciliation's closing:
 * - none: the account has none, or the file gives the opening itself;
 * - auto: taken, because the statement starts the day after it;
 * - offered: on offer with "Use $X (…)", not taken;
 * - taken: on offer, and the person took it;
 * - refused: not usable — the statement starts on another day, or a line falls on or before its date.
 */
export type PriorStatus = "none" | "auto" | "offered" | "taken" | "refused";

/** Where a line points, by its index in the lines read. */
export interface LinePointer {
  index: number;
  text: string;
}

export interface ProofSentences {
  /**
   * "Opening $X (printed) + 42 lines −$Y = $Z, the closing balance the statement prints ✓" when it adds up,
   * "Out by $V. The opening $X and the 42 lines come to $W; the statement closes at $Z." when it does not;
   * null when a balance is missing.
   */
  summary: string | null;
  /** The chain break, else the one-line hint, when the statement is out. */
  detail: string | null;
  /** "Import is blocked until the statement adds up." whenever it does not (a balance missing included); null when it adds up. */
  blocked: string | null;
  /** "Use $X (the closing of the reconciliation to Feb 28, 2026)" while a prior closing is on offer or taken. */
  usePrior: string | null;
  /** The opening's basis in words: printed / from the running balance / from the reconciliation to {date} / typed. */
  openingBasis: string | null;
}

export interface StatementProof {
  openingMinor: number | null;
  closingMinor: number | null;
  openingBasis: OpeningBasis | null;
  closingBasis: ClosingBasis | null;
  /** The sum of the lines that count. */
  linesMinor: number;
  /** How many lines count: every line read but those marked Not a transaction. */
  lineCount: number;
  /** How many lines are marked Not a transaction. */
  setAside: number;
  /** opening + lines − closing, signed as the database keeps it (`out_by_minor`); null when a balance is missing. */
  differenceMinor: number | null;
  proves: boolean;
  missing: "opening" | "closing" | "both" | null;
  /** A CSV's first balance that does not follow the one before it plus the line: the line it jumps after. */
  chainBreak: LinePointer | null;
  /** The one line the statement is out by exactly, when only one line is that amount: possibly misread. */
  hint: LinePointer | null;
  prior: { status: PriorStatus; date: string | null; endingMinor: number | null };
  sentences: ProofSentences;
}

// --- The words -----------------------------------------------------------------

export const PROOF_TEXT = {
  blocked: "Import is blocked until the statement adds up.",
  adminCanOverride: "An administrator can import it anyway, with a reason.",
  importAnyway: "Import anyway…",
  openingField: "Opening balance printed on the statement",
  closingField: "Closing balance printed on the statement",
  /** Said when the file chosen to attach does not add up: nothing is imported, so nothing can be imported anyway. */
  attachBlocked: "Attaching is blocked until the statement adds up.",
} as const;

/** What a server action says when it refuses a statement before the database is asked. */
export const PROOF_REFUSAL = {
  noOpening: "The statement has no opening balance; enter the one printed on the statement.",
  noClosing: "The statement has no closing balance; enter the one printed on the statement.",
  noBalances: "The statement has no opening or closing balance; enter the ones printed on the statement.",
  /** A screen from before 2.04, still open after the update, sends no proof. */
  noProof: "The statement was sent without its opening and closing balances. Reload the page and try again.",
  /** An override sent by someone who is not an administrator: the database's own words (0143). */
  notAdmin: "Only an administrator can import a statement that does not add up",
} as const;

/** "Import 42 lines": the button, one click, when the statement adds up. */
export function importLinesLabel(count: number): string {
  return `Import ${count.toLocaleString("en-US")} line${count === 1 ? "" : "s"}`;
}

const lines = (n: number) => `${n.toLocaleString("en-US")} line${n === 1 ? "" : "s"}`;

/** A line's amount as the statement prints it: "−412.30", "1,250.00". `money` is the screen's own formatter. */
export function plainAmount(minor: number, money: (minor: number) => string): string {
  return `${minor < 0 ? "−" : ""}${money(Math.abs(minor)).replace(/[^\d.,]/g, "")}`;
}

/** "−$412.30" for money out, "$412.30" for money in. */
function signedMoney(minor: number, money: (minor: number) => string): string {
  return minor < 0 ? `−${money(-minor)}` : money(minor);
}

/** printed / from the running balance / from the reconciliation to {date} / typed. */
export function openingBasisWords(basis: OpeningBasis, priorDate: string | null): string {
  switch (basis) {
    case "printed":
      return "printed";
    case "running":
      return "from the running balance";
    case "prior":
      return priorDate ? `from the reconciliation to ${shortDate(priorDate, true)}` : "from the last reconciliation";
    case "typed":
      return "typed";
  }
}

/** "Use $X (the closing of the reconciliation to Feb 28, 2026)". */
export function priorOfferLabel(prior: PriorClosing, money: (minor: number) => string): string {
  return `Use ${money(prior.endingMinor)} (the closing of the reconciliation to ${shortDate(prior.date, true)})`;
}

/** "The balance jumps after the line of Mar 14, 2026 (−412.30)." */
export function chainBreakText(line: ProofLine, money: (minor: number) => string): string {
  return `The balance jumps after the line of ${shortDate(line.txn_date, true)} (${plainAmount(line.amount_minor, money)}).`;
}

/** "It equals the statement line “SERVICE FEE” of Mar 14, 2026 (−12.50), which may have been misread. …" */
export function oneLineHintText(line: ProofLine, money: (minor: number) => string): string {
  const name = statementLineName({ description: line.description ?? "", txnDate: line.txn_date });
  return (
    `It equals ${name} (${plainAmount(line.amount_minor, money)}), which may have been misread. ` +
    "Mark it Not a transaction if it is not one."
  );
}

// --- What each kind of file says about itself ---------------------------------

/** A PDF's printed (or running) balances and its period. */
export function pdfFigures(
  statement: Pick<PdfStatement, "openingMinor" | "closingMinor" | "openingBasis" | "closingBasis" | "from" | "to">,
): StatementFigures {
  return {
    openingMinor: statement.openingMinor,
    openingBasis: statement.openingMinor === null ? null : (statement.openingBasis ?? "printed"),
    closingMinor: statement.closingMinor,
    closingBasis: statement.closingMinor === null ? null : (statement.closingBasis ?? "printed"),
    start: statement.from,
    end: statement.to,
  };
}

/** An OFX's LEDGERBAL and DTSTART/DTEND, or a QIF's Opening Balance record. */
export function fileFigures(result: StatementFileResult): StatementFigures {
  const opening = result.openingMinor ?? null;
  return {
    openingMinor: opening,
    openingBasis: opening === null ? null : "printed",
    ledgerMinor: result.ledger?.minor ?? null,
    ledgerAsOf: result.ledger?.asOf ?? null,
    start: result.periodStart ?? null,
    end: result.periodEnd ?? null,
  };
}

// --- The rule ------------------------------------------------------------------

interface Counted {
  line: ProofLine;
  /** Its index in the lines read. */
  index: number;
}

interface Figure<B> {
  minor: number;
  basis: B;
}

/** The ISO day after `iso`. */
export function dayAfter(iso: string): string {
  const day = new Date(`${iso}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 1);
  return day.toISOString().slice(0, 10);
}

const known = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value);

/** A CSV listed newest first is read oldest first; lines of one day keep the file's order (as monthsFromCsv). */
function oldestFirst(counted: readonly Counted[]): Counted[] {
  if (counted.length < 2) return [...counted];
  const newestFirst = counted[0].line.txn_date > counted[counted.length - 1].line.txn_date;
  return (newestFirst ? [...counted].reverse() : [...counted])
    .map((entry, order) => ({ entry, order }))
    .sort((a, b) =>
      a.entry.line.txn_date < b.entry.line.txn_date ? -1 : a.entry.line.txn_date > b.entry.line.txn_date ? 1 : a.order - b.order,
    )
    .map(({ entry }) => entry);
}

/**
 * A CSV's own balances: it opens at its first balance less the lines up to and
 * including that one, and closes at its last balance plus the lines after it,
 * as a PDF whose last rows print no balance closes (pdf-statement.ts). Each
 * balance must be the one before it plus the lines between; the first that is
 * not is named by the line it jumps after.
 */
function csvBalances(counted: readonly Counted[], money: (minor: number) => string) {
  const ordered = oldestFirst(counted);
  const balanceOf = (entry: Counted) => entry.line.running_balance_minor ?? null;

  let opening: Figure<OpeningBasis> | null = null;
  let upTo = 0;
  for (const entry of ordered) {
    upTo += entry.line.amount_minor;
    const balance = balanceOf(entry);
    if (balance !== null) {
      opening = { minor: balance - upTo, basis: "running" };
      break;
    }
  }
  // The last balance holds nothing below it: the lines after it that carry none
  // are added, so a month whose last rows print no balance closes where those
  // lines take it, and a run of months does not stop there.
  let closing: Figure<ClosingBasis> | null = null;
  let trailing = 0;
  for (let k = ordered.length - 1; k >= 0; k--) {
    const balance = balanceOf(ordered[k]);
    if (balance !== null) {
      closing = { minor: balance + trailing, basis: "running" };
      break;
    }
    trailing += ordered[k].line.amount_minor;
  }

  let chainBreak: LinePointer | null = null;
  let balance: number | null = null;
  let after: Counted | null = null;
  let since = 0;
  for (const entry of ordered) {
    const printed = balanceOf(entry);
    if (balance === null || after === null) {
      if (printed !== null) {
        balance = printed;
        after = entry;
        since = 0;
      }
      continue;
    }
    since += entry.line.amount_minor;
    if (printed === null) continue;
    if (printed !== balance + since) {
      chainBreak = { index: after.index, text: chainBreakText(after.line, money) };
      break;
    }
    balance = printed;
    after = entry;
    since = 0;
  }
  return { opening, closing, chainBreak };
}

/**
 * The proof the import dialog shows: the opening and closing taken in their
 * order of trust, and whether the lines that count join them. `money` formats
 * minor units for the account, as the reconcile screens do.
 */
export function proveStatement(input: StatementProofInput, money: (minor: number) => string): StatementProof {
  const aside = new Set(input.aside ?? []);
  const counted: Counted[] = input.lines.flatMap((line, index) => (aside.has(index) ? [] : [{ line, index }]));
  const setAside = input.lines.length - counted.length;
  const figures = input.figures ?? {};

  let opening: Figure<OpeningBasis> | null = null;
  let closing: Figure<ClosingBasis> | null = null;
  let chainBreak: LinePointer | null = null;

  if (input.kind === "csv") {
    ({ opening, closing, chainBreak } = csvBalances(counted, money));
  } else {
    if (known(figures.openingMinor)) opening = { minor: figures.openingMinor, basis: figures.openingBasis ?? "printed" };
    if (known(figures.closingMinor)) closing = { minor: figures.closingMinor, basis: figures.closingBasis ?? "printed" };
  }

  // An OFX ledger balance closes the statement only when it is as of the
  // file's end day — DTEND, else its last line's day — compared as days, not
  // timestamps. A balance from before the end leaves lines out of it; one from
  // a later day can hold lines posted after the file ends, and taken as the
  // closing it would block a statement that adds up while hiding the field to
  // type the right one.
  if (closing === null && known(figures.ledgerMinor) && figures.ledgerAsOf) {
    const dates = input.lines.map((line) => line.txn_date).sort();
    const end = figures.end ?? dates[dates.length - 1] ?? null;
    if (end && figures.ledgerAsOf === end) closing = { minor: figures.ledgerMinor, basis: "ledger" };
  }

  const prior = input.prior ?? null;
  let status: PriorStatus = "none";
  if (opening === null && prior) {
    const start = figures.start ?? null;
    if (counted.some(({ line }) => line.txn_date <= prior.date)) status = "refused";
    else if (start) status = start === dayAfter(prior.date) ? "auto" : "refused";
    // A CSV that prints no balance has no start day to compare: every counted
    // line falling after the prior end is what says the statement follows it.
    else if (input.kind === "csv" && counted.length > 0) status = "auto";
    else status = input.usePrior ? "taken" : "offered";
    if (status === "auto" || status === "taken") opening = { minor: prior.endingMinor, basis: "prior" };
  }

  if (opening === null && known(input.typedOpeningMinor)) opening = { minor: input.typedOpeningMinor, basis: "typed" };
  if (closing === null && known(input.typedClosingMinor)) closing = { minor: input.typedClosingMinor, basis: "typed" };

  return settle(
    counted,
    setAside,
    opening,
    closing,
    { status, date: prior?.date ?? null, endingMinor: prior?.endingMinor ?? null },
    chainBreak,
    money,
  );
}

/**
 * The arithmetic, and what is said about it. Shared by the dialog's proof and
 * the server's, so the two can never disagree on whether a statement adds up.
 */
function settle(
  counted: readonly Counted[],
  setAside: number,
  opening: Figure<OpeningBasis> | null,
  closing: Figure<ClosingBasis> | null,
  prior: StatementProof["prior"],
  chainBreak: LinePointer | null,
  money: (minor: number) => string,
): StatementProof {
  const linesMinor = counted.reduce((sum, { line }) => sum + line.amount_minor, 0);
  const differenceMinor = opening && closing ? opening.minor + linesMinor - closing.minor : null;
  const proves = differenceMinor === 0;
  const missing = !opening && !closing ? "both" : !opening ? "opening" : !closing ? "closing" : null;

  let hint: LinePointer | null = null;
  if (differenceMinor !== null && differenceMinor !== 0) {
    const theOne = counted.filter(({ line }) => line.amount_minor === differenceMinor);
    if (theOne.length === 1) hint = { index: theOne[0].index, text: oneLineHintText(theOne[0].line, money) };
  }

  const basisWords = opening ? openingBasisWords(opening.basis, prior.date) : null;
  let summary: string | null = null;
  if (opening && closing) {
    summary = proves
      ? `Opening ${money(opening.minor)} (${basisWords}) + ${lines(counted.length)} ${signedMoney(linesMinor, money)} = ` +
        `${money(closing.minor)}, the closing balance the statement prints ✓`
      : `Out by ${money(Math.abs(differenceMinor as number))}. The opening ${money(opening.minor)} and the ` +
        `${lines(counted.length)} come to ${money(opening.minor + linesMinor)}; the statement closes at ${money(closing.minor)}.`;
  }
  const onOffer = prior.status === "offered" || prior.status === "taken";

  return {
    openingMinor: opening?.minor ?? null,
    closingMinor: closing?.minor ?? null,
    openingBasis: opening?.basis ?? null,
    closingBasis: closing?.basis ?? null,
    linesMinor,
    lineCount: counted.length,
    setAside,
    differenceMinor,
    proves,
    missing,
    chainBreak: differenceMinor === null || proves ? null : chainBreak,
    hint,
    prior,
    sentences: {
      summary,
      detail: proves || differenceMinor === null ? null : (chainBreak?.text ?? hint?.text ?? null),
      blocked: proves ? null : PROOF_TEXT.blocked,
      usePrior:
        onOffer && prior.date !== null && prior.endingMinor !== null
          ? priorOfferLabel({ date: prior.date, endingMinor: prior.endingMinor }, money)
          : null,
      openingBasis: basisWords,
    },
  };
}

// --- What the dialog sends, and what the server makes of it -------------------

/**
 * A payload a screen from before 2.04 sent — still open after the update — with
 * no proof in it. The actions answer it with PROOF_REFUSAL.noProof rather than
 * with the schema's own words.
 */
export function sentWithoutProof(raw: unknown): boolean {
  return typeof raw === "object" && raw !== null && (raw as { proof?: unknown }).proof == null;
}

/** The proof as the import sends it. The override is sent only by "Import anyway…". */
export function proofPayload(proof: StatementProof, override: StatementOverride | null = null): StatementProofPayload {
  return {
    opening_minor: proof.openingMinor,
    closing_minor: proof.closingMinor,
    opening_basis: proof.openingBasis,
    closing_basis: proof.closingBasis,
    set_aside: proof.setAside,
    override: override ? { reason: override.reason.trim() } : null,
  };
}

/** A line as the import sends it: `skip` marks one already in Bank Transactions from another source. */
export interface StatementImportLine extends StatementLine {
  skip?: boolean;
}

/**
 * The lines an import sends: every line read except those marked Not a
 * transaction, in file order, those skipped as already here from another
 * source marked `skip` — counted in the proof, not imported.
 */
export function statementImportRows(
  lines: readonly StatementLine[],
  aside: Iterable<number> = [],
  skip: Iterable<number> = [],
): StatementImportLine[] {
  const setAside = new Set(aside);
  const skipped = new Set(skip);
  return lines.flatMap((line, index) => {
    if (setAside.has(index)) return [];
    return [skipped.has(index) ? { ...line, skip: true } : { ...line }];
  });
}

/**
 * The server's proof: the lines it was sent (every one counts, those marked
 * skip included) between the opening and closing it was sent. The same
 * arithmetic as the dialog's.
 */
export function proveStatementPayload(
  rows: readonly ProofLine[],
  payload: StatementProofPayload,
  money: (minor: number) => string,
): StatementProof {
  const counted = rows.map((line, index) => ({ line, index }));
  const opening =
    payload.opening_minor !== null && payload.opening_basis !== null
      ? { minor: payload.opening_minor, basis: payload.opening_basis }
      : null;
  const closing =
    payload.closing_minor !== null && payload.closing_basis !== null
      ? { minor: payload.closing_minor, basis: payload.closing_basis }
      : null;
  return settle(counted, payload.set_aside, opening, closing, { status: "none", date: null, endingMinor: null }, null, money);
}

/**
 * Why a server action refuses the statement before the database is asked, or
 * null when it may go on. A missing balance is always refused; a statement
 * that does not add up is refused unless it carries an override — whether the
 * person may override is not this one's to say: see `needsAdministrator`.
 */
export function proofRefusal(
  proof: StatementProof,
  override: StatementOverride | null,
  blocked: string = PROOF_TEXT.blocked,
): string | null {
  if (proof.missing === "both") return PROOF_REFUSAL.noBalances;
  if (proof.missing === "opening") return PROOF_REFUSAL.noOpening;
  if (proof.missing === "closing") return PROOF_REFUSAL.noClosing;
  if (proof.proves || override) return null;
  return `${proof.sentences.summary} ${blocked}`;
}

/**
 * Whether the statement goes in only on an administrator's override: it does
 * not add up, and an override came with it. The screen offers "Import anyway…"
 * to an administrator alone, so anyone else sending one sent it by hand. Each
 * action asks the person's role before it writes anything — keeping the
 * statement or starting a reconciliation comes before the import the database
 * would refuse — and answers PROOF_REFUSAL.notAdmin; the database asks again.
 */
export function needsAdministrator(proof: StatementProof, override: StatementOverride | null): boolean {
  return !proof.proves && override !== null;
}
