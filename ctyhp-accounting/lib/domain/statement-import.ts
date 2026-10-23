/**
 * Reading a bank statement file.
 *
 * Pure. Banks export the same three facts — a date, a description and an
 * amount — under a dozen different headings and in two date orders, so the
 * rules for turning a parsed CSV row into a statement line live here, where
 * they can be tested against the shapes real banks actually produce.
 *
 * A row this cannot read is *skipped and counted*, never guessed at: a
 * statement line with the wrong date or amount is worse than a missing one.
 */
import { formatDate, plural } from "@/lib/format";

export interface StatementLine {
  txn_date: string;
  description: string;
  reference: string | null;
  amount_minor: number;
  running_balance_minor: number | null;
  raw_line: string;
  /** The bank's own id for the transaction (OFX FITID), when the file carries one. */
  external_id?: string | null;
}

export interface StatementParseResult {
  rows: StatementLine[];
  /** Rows that had no readable date or amount. */
  skipped: number;
}

const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** A two-digit year as the approved design reads one: over 70 is the 1900s. */
function fullYear(year: string): string {
  if (year.length === 4) return year;
  return Number(year) > 70 ? `19${year}` : `20${year}`;
}

function isoDay(year: string, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${fullYear(year)}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function monthOf(name: string): number {
  return MONTH_NAMES.indexOf(name.slice(0, 3).toLowerCase()) + 1;
}

/**
 * `2026-07-31`, `7/31/2026`, `31/07/2026`, `31.07.26`, `31 Jul 2026` and
 * `Jul 31, 2026` all reach the same day — the six shapes the approved design
 * reads. A month written as a word is never in doubt; only all-number dates
 * need the file's order.
 */
export function normalizeStatementDate(raw: string, order: "mdy" | "dmy" = "mdy"): string | null {
  const value = (raw ?? "").trim();
  const iso = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:$|[T ])/);
  if (iso) return isoDay(iso[1], Number(iso[2]), Number(iso[3]));

  const numeric = value.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (numeric) {
    const [, first, second, year] = numeric;
    // A value over 12 in the first position can only be a day, whatever the
    // chosen order says — that is the one case worth overriding.
    const dayFirst = order === "dmy" || Number(first) > 12;
    return dayFirst ? isoDay(year, Number(second), Number(first)) : isoDay(year, Number(first), Number(second));
  }

  const dayMonth = value.match(/^(\d{1,2})[ -]([A-Za-z]{3,})\.?,?[ -](\d{2}|\d{4})$/);
  if (dayMonth && monthOf(dayMonth[2]) > 0) return isoDay(dayMonth[3], monthOf(dayMonth[2]), Number(dayMonth[1]));

  const monthDay = value.match(/^([A-Za-z]{3,})\.?[ -](\d{1,2}),?[ -](\d{2}|\d{4})$/);
  if (monthDay && monthOf(monthDay[1]) > 0) return isoDay(monthDay[3], monthOf(monthDay[1]), Number(monthDay[2]));
  return null;
}

/**
 * `1,234.56`, `$1,234.56`, `(1,234.56)` and `1.234,56` all reach the same
 * number of minor units. Parentheses are the accounting minus sign; a European
 * decimal comma is recognised only when there is no dot to contradict it.
 */
export function parseStatementAmount(raw: string, decimals = 2): number | null {
  let value = (raw ?? "").trim();
  if (value === "") return null;

  let negative = false;
  if (/^\(.*\)$/.test(value)) {
    negative = true;
    value = value.slice(1, -1);
  }
  if (value.startsWith("-")) {
    negative = !negative;
    value = value.slice(1);
  }

  value = value.replace(/[^0-9.,]/g, "");
  if (value === "") return null;

  const lastDot = value.lastIndexOf(".");
  const lastComma = value.lastIndexOf(",");
  if (lastComma > lastDot) {
    // 1.234,56 — comma is the decimal separator.
    value = value.replace(/\./g, "").replace(",", ".");
  } else {
    value = value.replace(/,/g, "");
  }

  const amount = Number.parseFloat(value);
  if (!Number.isFinite(amount)) return null;
  const minor = Math.round(amount * 10 ** decimals);
  return negative ? -minor : minor;
}

/** The column a bank might have used, in the order they are tried. */
const DATE_KEYS = ["date", "transaction date", "posted date", "posting date", "txn date"];
const DESCRIPTION_KEYS = ["description", "memo", "details", "narrative", "payee", "name"];
const REFERENCE_KEYS = ["reference", "ref", "check number", "cheque number", "transaction id"];
const AMOUNT_KEYS = ["amount", "value"];
const DEBIT_KEYS = ["debit", "withdrawal", "withdrawals", "money out", "paid out"];
const CREDIT_KEYS = ["credit", "deposit", "deposits", "money in", "paid in"];
const BALANCE_KEYS = ["balance", "running balance", "closing balance"];

function pick(record: Record<string, string>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value.trim() !== "") return value;
  }
  return "";
}

export type DateOrder = "mdy" | "dmy";

/** Which heading holds what. Headings are lower-cased, as `parseCsv` gives them. */
export interface StatementColumnMap {
  date: string | null;
  description: string | null;
  amount: string | null;
  moneyOut: string | null;
  moneyIn: string | null;
  reference: string | null;
  balance: string | null;
}

/** Enough to read a line: a date, and an amount in one column or two. */
export function statementColumnsComplete(columns: StatementColumnMap): boolean {
  return Boolean(columns.date && (columns.amount || columns.moneyOut || columns.moneyIn));
}

/** The headings this file uses for each fact, as far as the usual names go. */
export function detectStatementColumns(headers: readonly string[]): { columns: StatementColumnMap; complete: boolean } {
  const find = (keys: readonly string[]) => keys.find((key) => headers.includes(key)) ?? null;
  const columns: StatementColumnMap = {
    date: find(DATE_KEYS),
    description: find(DESCRIPTION_KEYS),
    amount: find(AMOUNT_KEYS),
    moneyOut: find(DEBIT_KEYS),
    moneyIn: find(CREDIT_KEYS),
    reference: find(REFERENCE_KEYS),
    balance: find(BALANCE_KEYS),
  };
  return { columns, complete: statementColumnsComplete(columns) };
}

/**
 * Which way round a file writes its dates. A first number over 12 can only be
 * a day; a second one over 12 can only be a day too, so month comes first.
 * With nothing to tell, month first — the US form, and the prototype's.
 */
export function detectDateOrder(values: readonly string[]): DateOrder {
  let dotted = false;
  for (const value of values) {
    const parts = (value ?? "").trim().match(/^(\d{1,2})([/.-])(\d{1,2})[/.-](?:\d{2}|\d{4})$/);
    if (!parts) continue;
    if (Number(parts[1]) > 12) return "dmy";
    if (Number(parts[3]) > 12) return "mdy";
    if (parts[2] === ".") dotted = true;
  }
  // Dates written with dots (31.07.2026) are day first wherever they are
  // written, so a file of them that never shows a day over 12 is still dmy.
  return dotted ? "dmy" : "mdy";
}

/**
 * Turn parsed CSV records into statement lines.
 *
 * Handles both shapes banks export: a single signed `amount` column, or
 * separate debit and credit columns — where a debit is money leaving the
 * account and therefore negative. Chosen columns are read as chosen;
 * otherwise every usual heading is tried.
 */
export function parseStatementRows(
  records: readonly Record<string, string>[],
  options: { decimals?: number; dateOrder?: DateOrder; columns?: StatementColumnMap; flipSigns?: boolean } = {},
): StatementParseResult {
  const decimals = options.decimals ?? 2;
  const chosen = options.columns;
  const keys = (column: string | null | undefined, usual: readonly string[]) =>
    chosen ? (column ? [column] : []) : usual;
  const rows: StatementLine[] = [];
  let skipped = 0;

  for (const record of records) {
    const date = normalizeStatementDate(pick(record, keys(chosen?.date, DATE_KEYS)), options.dateOrder ?? "mdy");

    let amount = parseStatementAmount(pick(record, keys(chosen?.amount, AMOUNT_KEYS)), decimals);
    if (amount === null) {
      const debit = parseStatementAmount(pick(record, keys(chosen?.moneyOut, DEBIT_KEYS)), decimals);
      const credit = parseStatementAmount(pick(record, keys(chosen?.moneyIn, CREDIT_KEYS)), decimals);
      if (debit !== null && debit !== 0) amount = -Math.abs(debit);
      else if (credit !== null && credit !== 0) amount = Math.abs(credit);
    }

    if (!date || amount === null) {
      skipped += 1;
      continue;
    }
    if (options.flipSigns) amount = -amount;

    rows.push({
      txn_date: date,
      description: pick(record, keys(chosen?.description, DESCRIPTION_KEYS)),
      reference: pick(record, keys(chosen?.reference, REFERENCE_KEYS)) || null,
      amount_minor: amount,
      running_balance_minor: parseStatementAmount(pick(record, keys(chosen?.balance, BALANCE_KEYS)), decimals),
      raw_line: Object.values(record).join(","),
    });
  }

  return { rows, skipped };
}

/** What the import is about to do, in one sentence, before it does it. */
export function describeStatementParse(result: StatementParseResult): string {
  if (result.rows.length === 0) {
    return result.skipped > 0
      ? `No readable rows — ${plural(result.skipped, "row")} had no date or amount.`
      : "No rows found in this file.";
  }
  const dates = result.rows.map((row) => row.txn_date).sort();
  const money = result.rows.reduce((sum, row) => sum + row.amount_minor, 0);
  const net = `${money < 0 ? "-" : ""}$${Math.abs(money / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
  return (
    `${plural(result.rows.length, "transaction")} from ${formatDate(dates[0])} to ${formatDate(dates[dates.length - 1])}, net ${net}` +
    (result.skipped > 0 ? ` · ${plural(result.skipped, "unreadable row")} skipped` : "")
  );
}
