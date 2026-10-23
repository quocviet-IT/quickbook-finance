/**
 * A credit card statement's PDF, read for its balances (2.46).
 *
 * A card's transactions come in from its CSV (2.45); its PDF is what proves a
 * month. So only the summary every US card statement prints on its first page
 * is read — the layout the CARD Act sets, as Chase's own sample statement
 * prints it:
 *
 *   Previous Balance            $1,270.00
 *   Payment, Credits          - $25.00
 *   Purchases                 + $0.00
 *   Cash Advances                $0.00
 *   Balance Transfers            $0.00
 *   Fees Charged                 $0.00
 *   Interest Charged             $0.00
 *   New Balance                 $1,245.00
 *   Opening/Closing Date   12/03/18 - 01/01/19
 *   Credit Limit                $4,000.00
 *
 * The transaction pages are not read: their layout differs from card to card,
 * and a month here is proved on its balances, by the books' own lines. What is
 * read proves itself first — the previous balance, less the payments, plus the
 * charges, fees and interest, must be the new balance — and a summary that
 * does not add up is refused, never guessed at. Figures are as the statement
 * prints them: owed is positive (card-account.ts turns them round for the books).
 *
 * Pure: rows in (rowsFromGlyphs), a summary or null out.
 */
import type { PdfRow } from "./pdf-statement";

export interface CardStatementSummary {
  /** The billing cycle's first and last day, ISO; null when the statement prints none. */
  from: string | null;
  to: string | null;
  /** As printed: owed is positive, a credit balance negative. */
  previousMinor: number | null;
  newMinor: number | null;
  /** The summary's parts, each as a positive figure; null when not printed. */
  parts: {
    paymentsCredits: number | null;
    purchases: number | null;
    cashAdvances: number | null;
    balanceTransfers: number | null;
    fees: number | null;
    interest: number | null;
  };
  /** The card's last four digits, when the statement prints them. */
  accountLast4: string | null;
  /**
   * New balance less (previous − payments + purchases + cash advances +
   * balance transfers + fees + interest), when every part is printed; zero when
   * the summary adds up, null when it cannot be checked.
   */
  outByMinor: number | null;
}

const MONEY = /\(?-?\$?\d{1,3}(?:,\d{3})+\.\d\d\)?-?|\(?-?\$?\d+\.\d\d\)?-?/g;

function minor(text: string): number | null {
  let s = text.replace(/[$,\s]/g, "");
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.endsWith("-")) {
    negative = true;
    s = s.slice(0, -1);
  }
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  }
  const m = /^(\d+)\.(\d\d)$/.exec(s);
  if (!m) return null;
  const cents = Number(m[1]) * 100 + Number(m[2]);
  return negative && cents !== 0 ? -cents : cents;
}

/** The figure a summary row prints after its label: its last amount, a sign printed apart from it ("- $25.00") counted. */
function rowFigure(text: string, label: RegExp): number | null {
  const m = label.exec(text);
  if (!m) return null;
  const rest = text.slice(m.index + m[0].length);
  const amounts = rest.match(MONEY);
  if (!amounts?.length) return null;
  const last = amounts[amounts.length - 1];
  const value = minor(last);
  if (value === null) return null;
  // "- $25.00": the sign sits in a cell of its own, before the amount.
  const before = rest.slice(0, rest.lastIndexOf(last)).trim();
  return before.endsWith("-") && value > 0 ? -value : value;
}

/** The first row whose text starts with `label` and prints an amount: the summary comes before anything else that might. */
function firstFigure(rows: readonly PdfRow[], label: RegExp): number | null {
  for (const row of rows) {
    const value = rowFigure(row.text.trim(), label);
    if (value !== null) return value;
  }
  return null;
}

const LABELS = {
  previous: /^Previous Balance:?/i,
  newBalance: /^New Balance:?/i,
  paymentsCredits: /^Payments?,?\s*(?:and\s+(?:Other\s+)?)?Credits?:?/i,
  purchases: /^Purchases?:?(?!\S)/i,
  cashAdvances: /^Cash Advances?:?/i,
  balanceTransfers: /^Balance Transfers?:?/i,
  fees: /^Fees Charged:?/i,
  interest: /^Interest Charged:?/i,
} as const;

/** What only a card statement prints. */
const CARD_MARK = /Credit (?:Limit|Access Line)|Available Credit|Minimum Payment Due/i;

/** "12/03/18" or "12/03/2018" as ISO; a two-digit year is this century's. */
function isoDay(text: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(text.trim());
  if (!m) return null;
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const month = Number(m[1]);
  const day = Number(m[2]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

const DAY = String.raw`(\d{1,2}\/\d{1,2}\/(?:\d{4}|\d{2}))`;
const PERIOD = new RegExp(String.raw`(?:Opening\s*\/\s*Closing Date|Statement Period|Billing Period)\s*:?\s*${DAY}\s*(?:-|–|to|through)\s*${DAY}`, "i");
const CLOSING = new RegExp(String.raw`(?:Statement\s+)?Closing Date\s*:?\s*${DAY}`, "i");
const OPENING = new RegExp(String.raw`Opening Date\s*:?\s*${DAY}`, "i");
const ACCOUNT = /Account (?:Number|ending(?: in)?)\s*:?\s*([X\dx*•\s-]{4,})/i;

/**
 * The summary of a card statement, or null when these rows are not one: a card
 * statement prints a previous and a new balance and a credit limit (or its
 * minimum payment). Reads only the summary; the activity pages are left alone.
 */
export function readCardStatementSummary(rows: readonly PdfRow[]): CardStatementSummary | null {
  const previousMinor = firstFigure(rows, LABELS.previous);
  const newMinor = firstFigure(rows, LABELS.newBalance);
  if (previousMinor === null && newMinor === null) return null;
  if (!rows.some((row) => CARD_MARK.test(row.text))) return null;

  const all = rows.map((row) => row.text).join("\n");
  const period = PERIOD.exec(all);
  const from = period ? isoDay(period[1]) : (OPENING.exec(all) ? isoDay(OPENING.exec(all)![1]) : null);
  const to = period ? isoDay(period[2]) : (CLOSING.exec(all) ? isoDay(CLOSING.exec(all)![1]) : null);

  const magnitude = (label: RegExp) => {
    const value = firstFigure(rows, label);
    return value === null ? null : Math.abs(value);
  };
  const parts = {
    paymentsCredits: magnitude(LABELS.paymentsCredits),
    purchases: magnitude(LABELS.purchases),
    cashAdvances: magnitude(LABELS.cashAdvances),
    balanceTransfers: magnitude(LABELS.balanceTransfers),
    fees: magnitude(LABELS.fees),
    interest: magnitude(LABELS.interest),
  };
  const printed = Object.values(parts).every((p) => p !== null);
  const outByMinor =
    printed && previousMinor !== null && newMinor !== null
      ? newMinor -
        (previousMinor -
          (parts.paymentsCredits as number) +
          (parts.purchases as number) +
          (parts.cashAdvances as number) +
          (parts.balanceTransfers as number) +
          (parts.fees as number) +
          (parts.interest as number))
      : null;

  const account = ACCOUNT.exec(all);
  const digits = account ? account[1].replace(/\D/g, "") : "";
  return {
    from,
    to,
    previousMinor,
    newMinor,
    parts,
    accountLast4: digits.length >= 4 ? digits.slice(-4) : null,
    outByMinor,
  };
}

export const CARD_SUMMARY_PROBLEMS = {
  noNewBalance: "No new balance could be read on this statement",
  noPreviousBalance: "No previous balance could be read on this statement",
  noClosingDate: "No closing date could be read on this statement",
  doesNotAddUp: (outBy: string) =>
    `The statement's own summary does not add up (out by ${outBy}): previous balance, payments, purchases, fees and interest do not come to the new balance`,
} as const;

/** Why a card statement's summary cannot prove a month, or null when it can. */
export function cardSummaryProblem(summary: CardStatementSummary, money: (minor: number) => string): string | null {
  if (summary.newMinor === null) return CARD_SUMMARY_PROBLEMS.noNewBalance;
  if (summary.previousMinor === null) return CARD_SUMMARY_PROBLEMS.noPreviousBalance;
  if (!summary.to) return CARD_SUMMARY_PROBLEMS.noClosingDate;
  if (summary.outByMinor !== null && summary.outByMinor !== 0) {
    return CARD_SUMMARY_PROBLEMS.doesNotAddUp(money(Math.abs(summary.outByMinor)));
  }
  return null;
}
