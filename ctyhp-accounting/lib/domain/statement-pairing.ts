/**
 * Pairing a bank statement's lines with the books — a port of the client's
 * prototype (Accounting System 2.28, src/p24.html: recPair and recMatch), in
 * integer cents.
 *
 * Three passes, strongest evidence first, so an exact date-and-amount pair is
 * never taken by a looser match tried sooner: the same date and amount; the same
 * amount and the statement's cheque number equal to the book line's reference;
 * the same amount within a few days. Each statement line and each book line is
 * used once. A statement that writes money the other way round is read both
 * ways, and the reading that pairs more lines is kept.
 *
 * 3.0.24 (item E of the defect report of 11 Nov 2026): a statement line that
 * fits more than one entry is left for a person rather than guessed. A pair is
 * a guess when another entry nobody else took fits the line as well as the one
 * taken, by the same evidence or stronger: two deposits of $500 on the day the
 * bank shows one, a payment within the window on either side of it. Such a
 * line is not paired; it is `ambiguous`, with every entry it fits, and the
 * entries stay outstanding. A person's tick settles it: an entry already
 * ticked on the reconciliation is taken before any other, and a pair with a
 * ticked entry is never a guess. The window is the company's to set (0193).
 *
 * Pure: the reconciliation reads its statement lines and book lines, and ticks
 * the pairs (lib/services/bankrec.ts). Nothing here ticks or posts.
 */

export interface PairStatementLine {
  lineNo: number;
  /** ISO date. */
  date: string;
  /** Positive is money in. */
  amountMinor: number;
  /** The cheque number the statement prints, when it prints one. */
  reference: string | null;
}

export interface PairBookLine {
  /** The journal line. */
  id: string;
  date: string;
  /** Positive is money into the bank. */
  amountMinor: number;
  reference: string | null;
  /** Ticked on the reconciliation already: a person's choice, taken before any other entry (3.0.24). */
  cleared?: boolean;
}

export interface StatementPair {
  line: PairStatementLine;
  book: PairBookLine;
  how: string;
}

/** A statement line that fits more than one entry (3.0.24): left for a person to choose, never guessed. */
export interface AmbiguousLine {
  line: PairStatementLine;
  /** Every entry it fits as well as the one a guess would have taken, that one first. */
  candidates: PairBookLine[];
  how: string;
}

export interface Pairing {
  pairs: StatementPair[];
  /** On the statement, fitting more than one entry: a person ticks the one the bank paid. */
  ambiguous: AmbiguousLine[];
  /** On the statement, not in the books. */
  missing: PairStatementLine[];
  /** In the books, not on the statement: outstanding. An ambiguous line's entries are among them. */
  unseen: PairBookLine[];
}

export interface StatementMatch extends Pairing {
  /** The statement's signs were read the other way round. */
  flipped: boolean;
  /** Statement lines dated after the statement date, left out. */
  ignored: number;
}

/** The prototype's window, in days, for the third pass; a company can set its own (0193). */
export const PAIRING_WINDOW_DAYS = 5;

const DAY_MS = 86_400_000;

/** A day as a whole number, so the window is a subtraction. */
function dayNumber(iso: string): number {
  return Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);
}

/** A cheque number as the prototype keeps it: letters, digits and hyphens only. */
export function cleanReference(reference: string | null): string {
  return (reference ?? "").replace(/[^0-9A-Za-z-]/g, "");
}

export function pairStatement(
  lines: readonly PairStatementLine[],
  book: readonly PairBookLine[],
  windowDays = PAIRING_WINDOW_DAYS,
): Pairing {
  // Every pass asks for the same amount, so a statement line looks only at the
  // book lines of its amount, kept in book order: the first free one that fits
  // is the one the prototype's scan of the whole book finds. A statement of
  // thousands of lines then costs thousands of steps, not millions.
  const byAmount = new Map<number, number[]>();
  book.forEach((entry, index) => {
    const same = byAmount.get(entry.amountMinor);
    if (same) same.push(index);
    else byAmount.set(entry.amountMinor, [index]);
  });
  const bookDays = book.map((entry) => dayNumber(entry.date));
  const usedLines = new Set<number>();
  const usedBook = new Set<number>();
  const made: { line: PairStatementLine; index: number; pass: number }[] = [];
  const passes: { how: string; fits: (line: PairStatementLine, index: number) => boolean }[] = [
    { how: "date and amount", fits: (line, index) => book[index].date === line.date },
    {
      how: "cheque number",
      fits: (line, index) => {
        const check = cleanReference(line.reference);
        return check !== "" && (book[index].reference ?? "") === check;
      },
    },
    {
      how: `amount, within ${windowDays} days`,
      fits: (line, index) => Math.abs(bookDays[index] - dayNumber(line.date)) <= windowDays,
    },
  ];
  passes.forEach((pass, p) => {
    for (const line of lines) {
      if (usedLines.has(line.lineNo)) continue;
      const fitting = (byAmount.get(line.amountMinor) ?? []).filter(
        (candidate) => !usedBook.has(candidate) && pass.fits(line, candidate),
      );
      if (!fitting.length) continue;
      // An entry ticked already is the one a person chose.
      const index = fitting.find((candidate) => book[candidate].cleared) ?? fitting[0];
      usedLines.add(line.lineNo);
      usedBook.add(index);
      made.push({ line, index, pass: p });
    }
  });

  // A pair is a guess when an entry nobody took fits the line by the same
  // evidence or stronger. Only an entry left over can make it one: two lines
  // and two entries alike are each paired, whichever way round.
  const strongest = (line: PairStatementLine, candidate: number) => passes.findIndex((pass) => pass.fits(line, candidate));
  const pairs: StatementPair[] = [];
  const ambiguous: AmbiguousLine[] = [];
  const released = new Set<number>();
  for (const { line, index, pass } of made) {
    const others = book[index].cleared
      ? []
      : (byAmount.get(line.amountMinor) ?? []).filter((candidate) => {
          if (candidate === index || usedBook.has(candidate)) return false;
          const by = strongest(line, candidate);
          return by !== -1 && by <= pass;
        });
    if (others.length) {
      ambiguous.push({ line, candidates: [book[index], ...others.map((candidate) => book[candidate])], how: passes[pass].how });
      released.add(index);
    } else {
      pairs.push({ line, book: book[index], how: passes[pass].how });
    }
  }
  return {
    pairs,
    ambiguous,
    missing: lines.filter((line) => !usedLines.has(line.lineNo)),
    unseen: book.filter((_, index) => !usedBook.has(index) || released.has(index)),
  };
}

/**
 * A statement against the books up to the statement date: lines dated after it
 * are left out and counted; the statement is read as written and with its signs
 * turned round, and whichever pairs more lines is kept (as written on a tie).
 */
export function matchStatement(
  lines: readonly PairStatementLine[],
  book: readonly PairBookLine[],
  statementDate: string,
  windowDays = PAIRING_WINDOW_DAYS,
): StatementMatch {
  const within = lines.filter((line) => line.date <= statementDate);
  const asWritten = pairStatement(within, book, windowDays);
  const turned = pairStatement(
    within.map((line) => ({ ...line, amountMinor: -line.amountMinor })),
    book,
    windowDays,
  );
  const flipped = turned.pairs.length > asWritten.pairs.length;
  return { ...(flipped ? turned : asWritten), flipped, ignored: lines.length - within.length };
}
