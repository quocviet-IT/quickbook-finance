/**
 * Reading a bank's CSV whatever its layout, as the approved design reads one
 * (`trimPreamble`, `guessColumns`, `balanceColumn`).
 *
 * Banks put a title, an account summary or a date range above the headings;
 * some export no headings at all; and the headings they do write are in a
 * dozen wordings. The usual names are tried first and anything they found is
 * kept as found. What they leave open is decided by what the column holds:
 * dates, signed amounts, words, bare whole numbers, or a running balance —
 * which is never read as the money that moved.
 *
 * Pure, so every shape can be tested without a browser.
 */
import { parseCsvGrid } from "@/lib/csv";
import {
  detectStatementColumns,
  normalizeStatementDate,
  parseStatementAmount,
  type StatementColumnMap,
} from "./statement-import";

/** A heading that starts like one of these means that field (the design's `COL_HINTS`). */
const HINTS: Record<keyof StatementColumnMap, RegExp> = {
  date: /^(date|posted|post date|posting date|transaction date|trans date|txn date|value date|booking)/,
  description: /^(desc|description|payee|name|memo|details|narrative|particulars|transaction(?! ?id))/,
  amount: /^(amount|value|net)/,
  moneyOut: /^(debit|withdrawal|withdrawals|money out|paid out|charge)/,
  moneyIn: /^(credit|deposit|deposits|money in|paid in)/,
  reference: /^(check|cheque|chk|serial|ref)/,
  balance: /^(balance|running|ledger balance|closing balance)/,
};

/** The fields a row of headings names; two of them, one a date, make it the headings. */
const HEADING_FIELDS: (keyof StatementColumnMap)[] = ["date", "description", "amount", "moneyOut", "moneyIn"];

/** How many rows down the headings may sit before the file is taken to have none. */
const PREAMBLE_LIMIT = 40;
/** The rows a column is judged on. */
const PROBE_ROWS = 40;

const cellOf = (value: string | undefined) => (value ?? "").trim();
const isDate = (value: string) => normalizeStatementDate(value, "mdy") !== null || normalizeStatementDate(value, "dmy") !== null;

/** A figure and nothing else: `1,234.56`, `-$12.00`, `(40.00)`, `1.234,56`. A date is not a figure. */
function figureOf(value: string): number | null {
  if (!value || isDate(value)) return null;
  if (!/^[\s$€£+(-]*\d[\d.,\s]*\)?\s*-?$/.test(value)) return null;
  return parseStatementAmount(value);
}

function headingHits(row: readonly string[]): { hits: number; date: boolean } {
  const cells = row.map((cell) => cellOf(cell).toLowerCase());
  const hits = HEADING_FIELDS.filter((field) => cells.some((cell) => HINTS[field].test(cell))).length;
  return { hits, date: cells.some((cell) => HINTS.date.test(cell)) };
}

/** A data row: it has a date in it. */
const hasDate = (row: readonly string[]) => row.some((cell) => isDate(cellOf(cell)));

export interface StatementCsv {
  /** Lower-cased and trimmed; blank or repeated headings are given a name of their own. */
  headers: string[];
  records: Record<string, string>[];
  /** Rows above the headings that were set aside: a title, a summary, a date range. */
  preambleRows: number;
  /** The file had no headings, so its columns are named by position. */
  headerless: boolean;
}

function uniqueHeaders(row: readonly string[], width: number): string[] {
  const seen = new Map<string, number>();
  return Array.from({ length: width }, (_, i) => {
    const base = cellOf(row[i]).toLowerCase() || `column ${i + 1}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base} (${count})`;
  });
}

const DELIMITERS = [",", ";", "\t", "|"] as const;

/**
 * Which character separates the fields: the one that appears most often on
 * most lines, outside quotes (the design's `sniffDelim`). Banks in Europe write
 * `;` because their decimal mark is the comma. A comma when nothing else is clearer.
 */
export function sniffDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).filter((line) => line.trim()).slice(0, 10);
  if (!lines.length) return ",";
  const outsideQuotes = (line: string) => line.replace(/"[^"]*"/g, "");
  const typical = (delimiter: string) => {
    const counts = lines.map((line) => outsideQuotes(line).split(delimiter).length - 1).sort((a, b) => a - b);
    return counts[Math.floor(counts.length / 2)];
  };
  let best: string = ",";
  let bestCount = typical(",");
  for (const delimiter of DELIMITERS.slice(1)) {
    const count = typical(delimiter);
    if (count > bestCount) {
      best = delimiter;
      bestCount = count;
    }
  }
  return best;
}

/**
 * The file's rows as records keyed by heading, with anything above the
 * headings set aside, and positional names when it has no headings at all.
 */
export function readStatementCsv(text: string): StatementCsv {
  const clean = String(text ?? "").replace(/^﻿/, "");
  const grid = parseCsvGrid(clean, sniffDelimiter(clean));
  if (grid.length === 0) return { headers: [], records: [], preambleRows: 0, headerless: false };

  // The headings are the first row naming a date and one more field, with dates in the rows under it.
  let start = -1;
  for (let i = 0; i < Math.min(grid.length - 1, PREAMBLE_LIMIT); i++) {
    const { hits, date } = headingHits(grid[i]);
    if (hits >= 2 && date && grid.slice(i + 1, i + 4).some(hasDate)) {
      start = i;
      break;
    }
  }

  let preambleRows = 0;
  let headerless = false;
  let body: string[][];
  let headingRow: string[] | null;
  if (start >= 0) {
    preambleRows = start;
    headingRow = grid[start];
    body = grid.slice(start + 1);
  } else {
    // No headings in words it knows: data from the first row that has a date in it.
    const first = grid.findIndex(hasDate);
    const above = first > 0 ? grid[first - 1] : null;
    if (first < 0) {
      // No dates at all: read it as the file says, and let the person choose.
      headingRow = grid[0];
      body = grid.slice(1);
    } else if (above && !hasDate(above) && above.filter((cell) => cellOf(cell)).length >= 2) {
      // Headings are language-specific; a row of words just above the first
      // dated row is the headings, whatever language they are in.
      preambleRows = first - 1;
      headingRow = above;
      body = grid.slice(first);
    } else {
      preambleRows = first;
      headerless = true;
      headingRow = null;
      body = grid.slice(first);
    }
  }

  const width = Math.max(headingRow?.length ?? 0, ...body.map((row) => row.length));
  const headers = headingRow ? uniqueHeaders(headingRow, width) : Array.from({ length: width }, (_, i) => `column ${i + 1}`);
  const records = body.map((row) => Object.fromEntries(headers.map((header, i) => [header, cellOf(row[i])])));
  return { headers, records, preambleRows, headerless };
}

/**
 * A running balance has a tell that does not depend on its heading: each value
 * is the one beside it plus a figure in another column of one of the two rows.
 * Either row, so a file listed newest first is read as well as oldest first.
 */
function runningBalanceColumn(headers: readonly string[], rows: readonly Record<string, string>[], skip: ReadonlySet<string>): string | null {
  const probe = rows.slice(0, PROBE_ROWS);
  if (probe.length < 4) return null;
  for (const column of headers) {
    if (skip.has(column)) continue;
    const values = probe.map((row) => figureOf(row[column] ?? ""));
    if (values.filter((value) => value !== null).length < 4) continue;
    let pairs = 0;
    let hits = 0;
    for (let k = 1; k < values.length; k++) {
      const before = values[k - 1];
      const now = values[k];
      if (before === null || now === null || now === before) continue;
      pairs += 1;
      const moved = Math.abs(now - before);
      const nearby = [probe[k], probe[k - 1]];
      if (nearby.some((row) => headers.some((other) => other !== column && Math.abs(figureOf(row[other] ?? "") ?? 0) === moved))) hits += 1;
    }
    if (pairs >= 3 && hits / pairs >= 0.75) return column;
  }
  return null;
}

/**
 * Which column holds what. The usual headings first, kept as found; then the
 * design's heading hints; then, for whatever is still open, the shape of what
 * the column holds.
 */
export function guessStatementColumns(headers: readonly string[], records: readonly Record<string, string>[]): StatementColumnMap {
  const columns: StatementColumnMap = { ...detectStatementColumns(headers).columns };
  const taken = () => new Set(Object.values(columns).filter((value): value is string => Boolean(value)));

  for (const field of Object.keys(HINTS) as (keyof StatementColumnMap)[]) {
    if (columns[field]) continue;
    const found = headers.find((header) => HINTS[field].test(header) && !taken().has(header));
    if (found) columns[field] = found;
  }

  const probe = records.slice(0, 12);
  const shape = headers.map((header) => {
    const values = probe.map((row) => cellOf(row[header])).filter(Boolean);
    const figures = values.map(figureOf).filter((value): value is number => value !== null);
    return {
      header,
      dates: values.filter(isDate).length,
      figures: figures.length,
      negatives: figures.filter((value) => value < 0).length,
      words: values.filter((value) => /[A-Za-z]{3}/.test(value)).length,
      wholeNumbers: values.length > 0 && values.every((value) => /^\d{2,7}$/.test(value)),
      decimals: values.some((value) => /\d[.,]\d{2}\)?$/.test(value)),
      mean: figures.length ? figures.reduce((sum, value) => sum + Math.abs(value), 0) / figures.length : 0,
    };
  });

  if (!columns.date) {
    const best = shape.filter((s) => s.dates > 0).sort((a, b) => b.dates - a.dates)[0];
    if (best) columns.date = best.header;
  }

  // A column of bare whole numbers beside a column of decimal amounts is the check number.
  if (!columns.reference) {
    const decimalElsewhere = (header: string) => shape.some((s) => s.header !== header && s.header !== columns.date && s.decimals);
    const check = shape.find((s) => !taken().has(s.header) && s.wholeNumbers && decimalElsewhere(s.header));
    if (check) columns.reference = check.header;
  }

  if (!columns.balance) {
    columns.balance = runningBalanceColumn(headers, records, taken());
  }

  if (!columns.amount && !columns.moneyOut && !columns.moneyIn) {
    const numbers = shape.filter((s) => !taken().has(s.header) && s.figures > 0 && s.words === 0);
    const signed = numbers.filter((s) => s.negatives > 0).sort((a, b) => a.mean - b.mean);
    if (signed.length) {
      // A running balance is a figure too, and usually far larger than what moved.
      columns.amount = signed[0].header;
    } else if (numbers.length >= 2) {
      columns.moneyOut = numbers[0].header;
      columns.moneyIn = numbers[1].header;
    } else if (numbers.length === 1) {
      columns.amount = numbers[0].header;
    }
  }

  // Never read the balance as the money that moved, however either was found.
  if (columns.balance) {
    if (columns.amount === columns.balance) columns.amount = null;
    if (columns.moneyOut === columns.balance) columns.moneyOut = null;
    if (columns.moneyIn === columns.balance) columns.moneyIn = null;
  }

  if (!columns.description) {
    const best = shape.filter((s) => !taken().has(s.header) && s.words > 0).sort((a, b) => b.words - a.words)[0];
    if (best) columns.description = best.header;
  }
  return columns;
}

/** What was set aside, in a sentence, when anything was. */
export function statementCsvNote(csv: StatementCsv): string | null {
  const parts: string[] = [];
  if (csv.preambleRows > 0) {
    parts.push(`${csv.preambleRows === 1 ? "1 row" : `${csv.preambleRows} rows`} above the ${csv.headerless ? "first line" : "headings"} set aside`);
  }
  if (csv.headerless) parts.push("the file has no headings, so its columns were read by what they hold");
  if (!parts.length) return null;
  const text = parts.join("; ");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}
