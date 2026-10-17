/**
 * Counting cash on hand, in words and in a tone.
 *
 * Pure: a row of `acc_cash_accounts_standing(p_as_of)` in, a sentence and a
 * colour out; the count dialog's variance and the typed amount's parsing. It
 * ships to the browser, so it imports no PDF module and only the small date
 * helpers.
 */
import { daysFromTo, type Money, type StandingTone } from "@/lib/domain/bank-standing";
import { formatDate } from "@/lib/format";
import { parseStatementAmount } from "@/lib/domain/statement-import";

/** Days after the last count at which cash on hand turns amber. */
export const CASH_COUNT_AMBER_DAYS = 90;

/** The code of the account a count's difference goes to unless another is chosen. */
export const CASH_OVER_AND_SHORT_CODE = "7510";

/** The longest memo the database accepts. */
export const CASH_COUNT_MEMO_MAX = 500;

export type CashCountStatus = "posted" | "pending_approval" | "rejected";

/** One cash on hand account, as `acc_cash_accounts_standing` reads it. */
export interface CashStanding {
  accountId: string;
  accountCode: string;
  accountName: string;
  /** Book balance at the date read, base-currency minor units. */
  balanceMinor: number;
  /** The latest posted count on or before the date; null when never counted. */
  lastCountedOn: string | null;
  countedMinor: number | null;
  differenceMinor: number | null;
  daysSince: number | null;
}

function numberOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function stringOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

/** Maps one RPC row (snake_case, bigint as number or string) to a standing. */
export function toCashStanding(row: Record<string, unknown>): CashStanding {
  return {
    accountId: String(row.account_id),
    accountCode: String(row.account_code ?? ""),
    accountName: String(row.account_name ?? ""),
    balanceMinor: Number(row.balance_minor ?? 0),
    lastCountedOn: stringOrNull(row.last_counted_on),
    countedMinor: numberOrNull(row.counted_minor),
    differenceMinor: numberOrNull(row.difference_minor),
    daysSince: numberOrNull(row.days_since),
  };
}

/** What the count says about the books: counted minus book. Below zero is a shortage. */
export function cashVariance(countedMinor: number, bookMinor: number): number {
  return countedMinor - bookMinor;
}

/* ------------------------------------------------------------------- lines */

/** The Balance Sheet panel's line for one cash account. */
export interface CashLineView {
  tone: StandingTone;
  /** The whole sentence, naming the account. */
  text: string;
  /** True when the account is overdue for a count (amber): the panel offers the button either way. */
  overdue: boolean;
}

/**
 * Amber after 90 days since the last count, or when the account was never
 * counted and holds a balance. Age is measured to the report date passed in.
 */
export function describeCashStanding(s: CashStanding, asOf: string, money: Money): CashLineView {
  if (s.lastCountedOn === null) {
    const holds = s.balanceMinor !== 0;
    return {
      tone: holds ? "warning" : "neutral",
      text: `${s.accountName}: never counted · ${money(s.balanceMinor)}`,
      overdue: holds,
    };
  }
  const age = daysFromTo(s.lastCountedOn, asOf);
  // A date that does not parse can never read as a healthy account.
  const overdue = age === null || age > CASH_COUNT_AMBER_DAYS;
  return {
    tone: overdue ? "warning" : "positive",
    text: `${s.accountName}: last counted ${formatDate(s.lastCountedOn)} (${money(s.countedMinor ?? 0)}). Count it again.`,
    overdue,
  };
}

/** The Chart of Accounts row's small line. */
export function lastCountedLabel(lastCountedOn: string | null): string {
  return lastCountedOn ? `Last counted ${formatDate(lastCountedOn)}` : "Never counted";
}

/* ------------------------------------------------------------------ dialog */

export interface VarianceView {
  /** `short`: cash is below the books; `over`: above; `none`: they agree. */
  kind: "short" | "over" | "none";
  text: string;
}

/** The dialog's live line under the amount. */
export function varianceView(differenceMinor: number, money: Money): VarianceView {
  if (differenceMinor < 0) return { kind: "short", text: `Short by ${money(-differenceMinor)}` };
  if (differenceMinor > 0) return { kind: "over", text: `Over by ${money(differenceMinor)}` };
  return { kind: "none", text: "No difference" };
}

export const WAITS_FOR_APPROVAL_NOTE = "This count will wait for approval.";

export type CountedAmount = { ok: true; minor: number } | { ok: false; error: string };

/** A US-style amount: optional $ and thousands commas, at most `decimals` places. */
function amountPattern(decimals: number): RegExp {
  const places = decimals > 0 ? `(\\.\\d{1,${decimals}})?` : "";
  return new RegExp(`^(\\d{1,3}(,\\d{3})+|\\d+)${places}$`);
}

/**
 * The amount typed in the dialog, in minor units. An empty or unreadable value
 * is an error and never zero: a count of nothing is typed as 0.
 */
export function parseCountedAmount(raw: string, decimals: number): CountedAmount {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") return { ok: false, error: "Enter the amount counted" };
  if (trimmed.startsWith("-") || /^\(.*\)$/.test(trimmed)) {
    return { ok: false, error: "The amount counted cannot be negative" };
  }
  const bare = trimmed.replace(/^\$\s*/, "");
  if (!amountPattern(decimals).test(bare)) {
    return { ok: false, error: "Enter the amount as a number, for example 1,250.00" };
  }
  // The commas are thousands separators here; parseStatementAmount would read a lone one as a decimal point.
  const minor = parseStatementAmount(bare.replace(/,/g, ""), decimals);
  if (minor === null || !Number.isSafeInteger(minor)) {
    return { ok: false, error: "Enter the amount as a number, for example 1,250.00" };
  }
  return { ok: true, minor };
}

/** The count's day: today at most, as the database checks. */
export function countDateProblem(date: string | null, today: string): string | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return "Enter the date of the count";
  if (date > today) return "A cash count cannot be dated after today";
  return null;
}

/* ----------------------------------------------------------------- results */

/** What `acc_post_cash_count` returned. */
export interface CashCountResult {
  cashCountId: string;
  status: "posted" | "pending_approval";
  journalEntryId: string | null;
  approvalRequestId: string | null;
  bookMinor: number;
  differenceMinor: number;
}

export function toCashCountResult(json: Record<string, unknown>): CashCountResult {
  return {
    cashCountId: String(json.cash_count_id),
    status: json.status === "pending_approval" ? "pending_approval" : "posted",
    journalEntryId: stringOrNull(json.journal_entry_id),
    approvalRequestId: stringOrNull(json.approval_request_id),
    bookMinor: Number(json.book_minor ?? 0),
    differenceMinor: Number(json.difference_minor ?? 0),
  };
}

/** The message after a count is recorded. */
export function cashCountMessage(result: CashCountResult, entryNumber: string | null, money: Money): string {
  if (result.status === "pending_approval") {
    const way = result.differenceMinor < 0 ? "shortage" : "overage";
    return `Count saved. The ${way} of ${money(Math.abs(result.differenceMinor))} waits for approval before it posts.`;
  }
  if (result.differenceMinor === 0 || !result.journalEntryId) return "No difference; the count is recorded.";
  const way = result.differenceMinor < 0 ? "shortage" : "overage";
  const entry = entryNumber ?? "the entry";
  return `Count recorded. Entry ${entry} posts the ${way} of ${money(Math.abs(result.differenceMinor))}.`;
}

/* ------------------------------------------------------------------- list */

/** One row of an account's counts. */
export interface CashCountRow {
  id: string;
  countedOn: string;
  countedMinor: number;
  bookMinor: number;
  differenceMinor: number;
  status: CashCountStatus;
  journalEntryId: string | null;
  /** The entry's number; null when no entry was posted. */
  entryNumber: string | null;
  /** Who recorded it; empty when unknown. */
  byName: string;
}

export const COUNT_STATUS_LABEL: Record<CashCountStatus, string> = {
  posted: "Recorded",
  pending_approval: "Waiting",
  rejected: "Rejected",
};

/** Maps one `acc_cash_count` row, with the entry numbers and names already looked up. */
export function toCashCountRow(
  row: Record<string, unknown>,
  entryNumbers: ReadonlyMap<string, string>,
  names: ReadonlyMap<string, string>,
): CashCountRow {
  const entryId = stringOrNull(row.journal_entry_id);
  const by = stringOrNull(row.created_by);
  const status = row.status === "pending_approval" || row.status === "rejected" ? row.status : "posted";
  return {
    id: String(row.id),
    countedOn: String(row.counted_on),
    countedMinor: Number(row.counted_minor),
    bookMinor: Number(row.book_minor),
    differenceMinor: Number(row.difference_minor),
    status,
    journalEntryId: entryId,
    entryNumber: entryId ? (entryNumbers.get(entryId) ?? null) : null,
    byName: by ? (names.get(by) ?? "") : "",
  };
}
