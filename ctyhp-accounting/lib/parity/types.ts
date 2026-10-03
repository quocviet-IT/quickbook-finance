/**
 * The shapes the prototype-parity harness passes between its parts: the
 * prototype's books as read from its own page, and the figures both systems
 * compute from them, in integer cents (debit positive).
 */

/** One posting of a prototype entry: positive is a debit, negative a credit. */
export interface ParityPosting {
  account: string;
  cents: number;
}

export interface ParityEntry {
  id: string;
  date: string;
  description: string;
  ref: string;
  /** The prototype leaves an entry flagged as closing out of every Profit and Loss view. */
  closing: boolean;
  postings: ParityPosting[];
}

export const PL_KEYS = ["income", "cogs", "gross", "opex", "netOperating", "otherIncome", "otherExpenses", "netOther", "net"] as const;
export type PlKey = (typeof PL_KEYS)[number];
export const BS_KEYS = ["assets", "liabilities", "equity", "liabilitiesAndEquity"] as const;
export type BsKey = (typeof BS_KEYS)[number];

/** A total as a report shows it; null when the report does not show that line at all. */
export type Totals<K extends string> = Record<K, number | null>;

export interface BookFigures {
  /** Month end → account → balance in cents. An account at zero may be absent. */
  balances: Record<string, Record<string, number>>;
  /** Fiscal year end → the Trial Balance's total debits and credits. */
  trialBalance: Record<string, { debit: number; credit: number }>;
  /** "from..to" of a fiscal year → Profit and Loss totals. */
  profitAndLoss: Record<string, Totals<PlKey>>;
  /** Fiscal year end → Balance Sheet totals. */
  balanceSheet: Record<string, Totals<BsKey>>;
}

export interface PrototypeBook {
  id: string;
  /** The company's name in the prototype — shown only in the local report. */
  name: string;
  /** Every account in the chart and every account a posting names. */
  accounts: string[];
  /** Every entry, the opening-balances entry included. */
  entries: ParityEntry[];
  monthEnds: string[];
  fiscalYears: { from: string; to: string }[];
  figures: BookFigures;
}
