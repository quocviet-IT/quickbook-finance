/**
 * The difference a reconciliation is out by, split into the parts that explain
 * it (2.03). It replaces the one figure "Unexplained difference":
 *
 *   difference = statement ending − (beginning + cleared)
 *
 * and when the statement was read in full (its opening plus its lines is its
 * closing), every term can be named:
 *
 *   opening part            the statement's opening − where this reconciliation begins;
 *   on the statement,       the statement lines the books do not have (standing
 *   not in the books        "missing"; a line set aside or dated after the
 *                           statement is not one);
 *   ticked here, not        ticked book lines no statement line pairs with;
 *   on the statement
 *   left to explain         difference − opening part − on the statement
 *                           + ticked here, not on the statement.
 *
 * What is left is, by construction, the paired lines whose book line is not
 * ticked, plus whatever the statement itself does not account for. When exactly
 * one line is that size, it is named. Pure: the screen holds every figure.
 */
import type { Standing } from "./reconcile-statement";

import { formatDate, plural } from "@/lib/format";
export const DIFFERENCE_LABELS = {
  opening: "Opening",
  onStatement: "On the statement, not in the books",
  tickedNotOnStatement: "Ticked here, not on the statement",
  left: "Left to explain",
} as const;

export interface DifferenceDetail {
  beginningMinor: number;
  clearedTotalMinor: number;
  statementEndingMinor: number;
  differenceMinor: number;
}

export interface DifferenceStatementLine {
  lineNo: number;
  txnDate: string;
  description: string;
  /** Positive is money in. */
  amountMinor: number;
  setAside?: boolean;
}

export interface DifferenceBookLine {
  journalLineId: string;
  entryNumber: string | null;
  entryDate: string;
  /** Positive is money into the bank. */
  signedMinor: number;
  cleared: boolean;
}

export interface OpeningPart {
  beginningMinor: number;
  openingMinor: number;
  /** The statement's opening − where this reconciliation begins. */
  amountMinor: number;
  text: string;
}

export interface LinesPart<Id> {
  count: number;
  /** Signed: positive is money in. */
  amountMinor: number;
  ids: Id[];
}

export interface DifferenceExplained {
  differenceMinor: number;
  /** Null when the statement's opening is not known or is where this reconciliation begins. */
  opening: OpeningPart | null;
  /** Null without a statement that has lines. The count may be 0. */
  onStatement: LinesPart<number> | null;
  /** Null without a statement that has lines. The count may be 0. */
  tickedNotOnStatement: LinesPart<string> | null;
  leftMinor: number;
  /** "It equals … Check that one first." when exactly one line is the size of what is left. */
  hint: string | null;
}

/** The heading over the parts: "The difference of $135.75, explained". */
export function differenceHeading(differenceMinor: number, money: (minor: number) => string): string {
  return `The difference of ${money(differenceMinor)}, explained`;
}

/** How many lines a part holds: "1 line", "1,204 lines". */
export function linesCount(n: number): string {
  return plural(n, "line");
}

/** "This reconciliation begins at {Y}; the statement opens at {X}." */
export function openingPartText(beginningMinor: number, openingMinor: number, money: (minor: number) => string): string {
  return `This reconciliation begins at ${money(beginningMinor)}; the statement opens at ${money(openingMinor)}.`;
}

/** A statement line, named short: the statement line “SERVICE FEE” of 09/05/2026. */
export function statementLineName(line: { description: string; txnDate: string }): string {
  const words = line.description.trim();
  const date = formatDate(line.txnDate);
  return words ? `the statement line “${words}” of ${date}` : `the statement line of ${date}`;
}

/** A book line, named short: JE-000123 of 09/05/2026. */
export function bookLineName(line: { entryNumber: string | null; entryDate: string }): string {
  return `${line.entryNumber ?? "the entry"} of ${formatDate(line.entryDate)}`;
}

/** "It equals {line} ({amount}). Check that one first." */
export function differenceHint(name: string, amountMinor: number, money: (minor: number) => string): string {
  return `It equals ${name} (${money(amountMinor)}). Check that one first.`;
}

/**
 * The difference split into its parts. Null when there is no difference.
 * `standings` is one per statement line, in the same order
 * (reconciliationStandings). Without statement lines, only the opening part
 * (when the statement's opening is known) and what is left.
 */
export function explainDifference(
  input: {
    detail: DifferenceDetail;
    statement: { openingMinor: number | null; lines: readonly DifferenceStatementLine[] } | null;
    standings: readonly Standing[] | null;
    book: readonly DifferenceBookLine[];
  },
  money: (minor: number) => string,
): DifferenceExplained | null {
  const { detail, statement, book } = input;
  if (detail.differenceMinor === 0) return null;

  const openingMinor = statement?.openingMinor ?? null;
  const opening: OpeningPart | null =
    openingMinor !== null && openingMinor !== detail.beginningMinor
      ? {
          beginningMinor: detail.beginningMinor,
          openingMinor,
          amountMinor: openingMinor - detail.beginningMinor,
          text: openingPartText(detail.beginningMinor, openingMinor, money),
        }
      : null;

  const lines = statement?.lines ?? [];
  const standings = input.standings ?? [];
  let onStatement: LinesPart<number> | null = null;
  let tickedNotOnStatement: LinesPart<string> | null = null;
  if (lines.length) {
    const missing = lines.filter((_, i) => standings[i]?.kind === "missing");
    onStatement = {
      count: missing.length,
      amountMinor: missing.reduce((sum, line) => sum + line.amountMinor, 0),
      ids: missing.map((line) => line.lineNo),
    };
    const pairedIds = new Set(standings.flatMap((s) => (s.kind === "paired" ? [s.bookId] : [])));
    const unpaired = book.filter((line) => line.cleared && !pairedIds.has(line.journalLineId));
    tickedNotOnStatement = {
      count: unpaired.length,
      amountMinor: unpaired.reduce((sum, line) => sum + line.signedMinor, 0),
      ids: unpaired.map((line) => line.journalLineId),
    };
  }

  const leftMinor =
    detail.differenceMinor -
    (opening?.amountMinor ?? 0) -
    (onStatement?.amountMinor ?? 0) +
    (tickedNotOnStatement?.amountMinor ?? 0);

  let hint: string | null = null;
  if (leftMinor !== 0) {
    const size = Math.abs(leftMinor);
    const candidates = [
      ...lines
        .filter((line) => !line.setAside && Math.abs(line.amountMinor) === size)
        .map((line) => ({ name: statementLineName(line), amountMinor: line.amountMinor })),
      ...book
        .filter((line) => line.cleared && Math.abs(line.signedMinor) === size)
        .map((line) => ({ name: bookLineName(line), amountMinor: line.signedMinor })),
    ];
    if (candidates.length === 1) hint = differenceHint(candidates[0].name, candidates[0].amountMinor, money);
  }

  return { differenceMinor: detail.differenceMinor, opening, onStatement, tickedNotOnStatement, leftMinor, hint };
}
