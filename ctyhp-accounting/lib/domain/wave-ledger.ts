/**
 * Reading Wave's "Account Transactions" report.
 *
 * The file is a complete general ledger: every row is *one side* of a double
 * entry and the other side is a row in another account's section. No column
 * mapping can read it, which is why this parser exists.
 *
 * Three things about the layout catch people out, and all three are handled by
 * the same small set of rules below:
 *
 *   * the first account's name sits in column 0, every later one in column 1
 *     (the DATE column);
 *   * `Starting Balance`, `Totals and Ending Balance` and `Balance Change` sit
 *     in column 0, where an account name also sits;
 *   * one account repeats its own name on every data row.
 *
 * Rows are grouped into one entry per date. That is not a convenience: in the
 * real file all 554 dates balance exactly, so grouping by date needs no
 * guesswork about which two halves belong together — and guessing is the one
 * thing that would produce books that balance while describing a transaction
 * that never happened.
 */

import { parseCsvGrid } from "@/lib/csv";

/** Long bank reference strings are truncated; the original is kept in Saved Reports. */
export const LEDGER_DESCRIPTION_LIMIT = 200;

const MARKERS = new Set(["starting balance", "totals and ending balance", "balance change"]);
const DATE_PATTERN = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

export interface WaveLedgerSection {
  account: string;
  debitMinor: number;
  creditMinor: number;
  rows: number;
  /** What the file's own "Totals and Ending Balance" row claims, when it has one. */
  reportedDebitMinor: number | null;
  reportedCreditMinor: number | null;
}

export interface WaveLedgerLine {
  account: string;
  /** Positive debits, negative credits — the convention the transactions import uses. */
  signedMinor: number;
  description: string;
}

export interface WaveLedgerEntry {
  date: string;
  lines: WaveLedgerLine[];
}

export interface WaveLedgerParse {
  sections: WaveLedgerSection[];
  entries: WaveLedgerEntry[];
  balances: { account: string; signedMinor: number }[];
  unbalancedDates: { date: string; differenceMinor: number }[];
  /** Accounts where our sums disagree with the file's own totals: the parser is wrong. */
  sectionMismatches: string[];
  skippedZeroRows: number;
  lineCount: number;
  totalDebitMinor: number;
  fromDate: string | null;
  toDate: string | null;
}

export function parseLedgerMoney(text: string): number {
  const raw = (text ?? "").trim();
  if (!raw) return 0;
  const negative = raw.startsWith("(") || raw.startsWith("-");
  const digits = raw.replace(/[()\-$,\s]/g, "");
  if (!digits) return 0;
  const value = Number(digits);
  if (!Number.isFinite(value)) return 0;
  return (negative ? -1 : 1) * Math.round(value * 100);
}

export function parseLedgerDate(text: string): string | null {
  const match = DATE_PATTERN.exec((text ?? "").trim());
  if (!match) return null;
  const [, month, day, year] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

/** Does this grid look like the Account Transactions report at all? */
export function isWaveLedgerGrid(grid: string[][]): boolean {
  const header = (grid[0] ?? []).map((cell) => cell.trim().toLowerCase());
  const has = (needle: string) => header.some((cell) => cell.includes(needle));
  return has("account") && has("debit") && has("credit") && has("balance");
}

export function parseWaveLedger(grid: string[][]): WaveLedgerParse {
  const sections: WaveLedgerSection[] = [];
  const byDate = new Map<string, WaveLedgerLine[]>();
  const netByAccount = new Map<string, number>();
  const order: string[] = [];
  let current: WaveLedgerSection | null = null;
  let skippedZeroRows = 0;

  for (const raw of grid.slice(1)) {
    const cells = [0, 1, 2, 3, 4, 5].map((index) => (raw[index] ?? "").trim());
    const [first, second, description, debit, credit] = cells;
    if (cells.every((cell) => cell === "")) continue;

    if (MARKERS.has(first.toLowerCase())) {
      if (current && first.toLowerCase() === "totals and ending balance") {
        current.reportedDebitMinor = parseLedgerMoney(debit);
        current.reportedCreditMinor = parseLedgerMoney(credit);
      }
      continue;
    }

    const date = parseLedgerDate(second);
    if (!date) {
      // A row naming an account: exactly one cell has anything in it, and it is
      // in column 0 for the first account or column 1 for every later one.
      const named = first || second;
      const others = cells.filter((cell) => cell !== "" && cell !== named);
      if (named && others.length === 0) {
        current = {
          account: named,
          debitMinor: 0,
          creditMinor: 0,
          rows: 0,
          reportedDebitMinor: null,
          reportedCreditMinor: null,
        };
        sections.push(current);
      }
      continue;
    }

    // A data row. Column 0 may repeat the account name; the section owns it.
    if (!current) continue;
    const debitMinor = parseLedgerMoney(debit);
    const creditMinor = parseLedgerMoney(credit);
    const signedMinor = debitMinor - creditMinor;
    if (signedMinor === 0) {
      skippedZeroRows += 1;
      continue;
    }

    current.debitMinor += debitMinor;
    current.creditMinor += creditMinor;
    current.rows += 1;

    const line: WaveLedgerLine = {
      account: current.account,
      signedMinor,
      description: description.slice(0, LEDGER_DESCRIPTION_LIMIT),
    };
    const lines = byDate.get(date);
    if (lines) lines.push(line);
    else {
      byDate.set(date, [line]);
      order.push(date);
    }
    netByAccount.set(current.account, (netByAccount.get(current.account) ?? 0) + signedMinor);
  }

  const dates = [...order].sort();
  const entries = dates.map((date) => ({ date, lines: byDate.get(date) ?? [] }));
  const unbalancedDates = entries
    .map((entry) => ({
      date: entry.date,
      differenceMinor: entry.lines.reduce((sum, line) => sum + line.signedMinor, 0),
    }))
    .filter((entry) => entry.differenceMinor !== 0);

  const sectionMismatches = sections
    .filter(
      (section) =>
        (section.reportedDebitMinor !== null &&
          section.reportedDebitMinor !== section.debitMinor) ||
        (section.reportedCreditMinor !== null &&
          section.reportedCreditMinor !== section.creditMinor),
    )
    .map((section) => section.account);

  return {
    sections,
    entries,
    balances: sections
      .filter((section) => netByAccount.has(section.account))
      .map((section) => ({
        account: section.account,
        signedMinor: netByAccount.get(section.account) ?? 0,
      })),
    unbalancedDates,
    sectionMismatches,
    skippedZeroRows,
    lineCount: entries.reduce((sum, entry) => sum + entry.lines.length, 0),
    totalDebitMinor: sections.reduce((sum, section) => sum + section.debitMinor, 0),
    fromDate: dates[0] ?? null,
    toDate: dates[dates.length - 1] ?? null,
  };
}

/** What actually goes to the server, given the mode the person chose. */
export function waveLedgerPayload(
  parse: WaveLedgerParse,
  mode: "history" | "balances",
  asOf: string,
): WaveLedgerEntry[] {
  if (mode === "history") return parse.entries;
  return [
    {
      date: asOf,
      lines: parse.balances.map((balance) => ({
        account: balance.account,
        signedMinor: balance.signedMinor,
        description: "Closing balance",
      })),
    },
  ];
}

/** Convenience for callers holding text rather than a grid. */
export function parseWaveLedgerText(text: string): WaveLedgerParse {
  return parseWaveLedger(parseCsvGrid(text));
}
