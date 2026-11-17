/**
 * What the Dashboard's widgets say, worked out apart from how they look
 * (3.0.38). Pure, so each sentence and each choice of tone can be tested.
 *
 * Amounts are base-currency minor units unless a name says otherwise, and are
 * written by the `money` function the widget is given.
 */
import { listWords } from "@/lib/domain/dashboard-home/insights";
import { longMonthName, monthYearLabel } from "@/lib/domain/dashboard-home/ranges";
import type {
  HomeBank,
  HomeBankAccount,
  HomeDueDays,
  HomeDueWindow,
  HomeFigures,
  HomeHorizon,
  HomeMonth,
  HomeOpenSide,
  HomePeriodKey,
  HomeStatus,
  HomeTab,
  HomeTone,
} from "@/lib/domain/dashboard-home/types";
import type { StatusTone } from "@/lib/domain/status-label";
import { formatDate, plural, pluralWord } from "@/lib/format";

type Money = (minor: number) => string;

/* --------------------------------------------------------------------- tabs */

/** Each tab's key and label; `short` is what a phone shows, so all four fit across without a menu. */
export const HOME_TABS: readonly { key: HomeTab; label: string; short?: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "money-in", label: "Money in" },
  { key: "money-out", label: "Money out" },
  { key: "banking", label: "Banking and close", short: "Banking" },
];

/** The tab named in the address, Overview for anything else. */
export function homeTabOf(param: string | string[] | null | undefined): HomeTab {
  const value = Array.isArray(param) ? param[0] : param;
  return HOME_TABS.find((tab) => tab.key === value)?.key ?? "overview";
}

/** A tab's address. Overview is the default, so it carries no parameter. */
export function homeTabHref(tab: HomeTab): string {
  return tab === "overview" ? "/dashboard" : `/dashboard?tab=${tab}`;
}

/* ------------------------------------------------------------------ periods */

export const PERIOD_OPTIONS: readonly { value: HomePeriodKey; label: string }[] = [
  { value: "month", label: "This month" },
  { value: "lastMonth", label: "Last month" },
  { value: "last3", label: "Last 3 months" },
  { value: "quarter", label: "This quarter" },
  { value: "year", label: "This year" },
  { value: "last12", label: "Last 12 months" },
  { value: "lastYear", label: "Last year" },
];

/** A period's name in the select: "Last 12 months". */
export function periodLabel(key: HomePeriodKey): string {
  return PERIOD_OPTIONS.find((option) => option.value === key)?.label ?? key;
}

/** What a card says when the period chosen could not be read: "Last year could not be read." */
export function periodUnread(key: HomePeriodKey): string {
  return `${periodLabel(key)} could not be read.`;
}

/** How many months Cash flow charts (3.0.41); the footer says the same words. */
export const CASH_MONTH_OPTIONS: readonly { value: 6 | 12; label: string }[] = [
  { value: 6, label: "Last 6 months" },
  { value: 12, label: "Last 12 months" },
];

/** "Last 12 months": what Cash flow's footer says under the chart. */
export function cashMonthsLabel(months: 6 | 12): string {
  return CASH_MONTH_OPTIONS.find((option) => option.value === months)?.label ?? `Last ${months} months`;
}

/** How far ahead the cash forecast looks (3.0.41). */
export const HORIZON_OPTIONS: readonly { value: HomeHorizon; label: string }[] = [
  { value: 30, label: "Next 30 days" },
  { value: 60, label: "Next 60 days" },
  { value: 90, label: "Next 90 days" },
];

/** "Next 60 days": the words that open the forecast's sentence. */
export function horizonLabel(days: HomeHorizon): string {
  return `Next ${days} days`;
}

/** Change from a prior figure as a percentage of its size; null when there is nothing to compare with. */
export function percentChange(current: number, prior: number | null | undefined): number | null {
  if (prior === null || prior === undefined || prior === 0) return null;
  return ((current - prior) / Math.abs(prior)) * 100;
}

/** A change, signed and to one decimal: "+15.2%", "-3.0%". */
export function formatChange(percent: number): string {
  const rounded = Math.round(percent * 10) / 10;
  const text = `${Math.abs(rounded).toFixed(1)}%`;
  if (rounded > 0) return `+${text}`;
  if (rounded < 0) return `-${text}`;
  return text;
}

/* ------------------------------------------------------------------- months */

/** The last month on the charts that has been entered, or -1 when none has. */
export function lastPostedIndex(months: readonly HomeMonth[]): number {
  for (let i = months.length - 1; i >= 0; i--) if (months[i].posted) return i;
  return -1;
}

/** "October and November look empty because they are not entered yet." */
export function missingMonthsSentence(missing: readonly string[]): string {
  if (missing.length === 0) return "";
  return `${listWords(missing)} ${pluralWord(missing.length, "looks", "look")} empty because ${pluralWord(
    missing.length,
    "it is",
    "they are",
  )} not entered yet.`;
}

/* ---------------------------------------------------------- the status note */

export type BooksNote =
  | { kind: "first-use" }
  | { kind: "behind"; since: string | null; missing: string }
  | { kind: "current"; postedThrough: string; bankLinesThrough: string | null; lastClosed: string | null };

/** Which note heads the page: a first use, books that are behind, or how far everything reaches. */
export function booksNote(status: HomeStatus): BooksNote {
  if (status.firstUse) return { kind: "first-use" };
  if (status.behind || status.postedThrough === null) {
    return { kind: "behind", since: status.postedThrough, missing: missingMonthsSentence(status.missingMonths) };
  }
  return {
    kind: "current",
    postedThrough: status.postedThrough,
    bankLinesThrough: status.bankLinesThrough,
    lastClosed: status.lastClosed?.label ?? null,
  };
}

/* -------------------------------------------------------------- the figures */

/** A figure's line under it: an emphasised part (with its tone) and the rest of the sentence. */
export interface FigureLine {
  tone: "danger" | "warning" | null;
  lead: string;
  rest: string;
}

/** True when the open documents add up to the control account: the figure and the ledger then say the same thing. */
export function tiesToLedger(figure: { valueMinor: number; ledgerMinor: number }): boolean {
  return figure.valueMinor === figure.ledgerMinor;
}

/**
 * "Ledger shows $X": said under a figure whose open documents do not add up
 * to its control account, so nobody takes the smaller story for the whole one.
 * Something overdue is said first; this comes before the quiet lines.
 */
function ledgerLine(figure: { valueMinor: number; ledgerMinor: number }, money: Money): FigureLine | null {
  return tiesToLedger(figure) ? null : { tone: "warning", lead: `Ledger shows ${money(figure.ledgerMinor)}`, rest: "" };
}

/**
 * The sentence the Invoices and Bills cards print when the ledger and the
 * open documents disagree; null when they agree.
 */
export function ledgerDifference(account: string, totalMinor: number, ledgerMinor: number, money: Money): string | null {
  if (totalMinor === ledgerMinor) return null;
  const difference = ledgerMinor - totalMinor;
  return `${account} in the ledger is ${money(ledgerMinor)}, ${money(Math.abs(difference))} ${difference > 0 ? "more" : "less"} than what is listed here.`;
}

export function receivablesLine(figure: HomeFigures["receivables"], money: Money): FigureLine {
  if (figure.overdueMinor > 0) {
    return { tone: "danger", lead: `${money(figure.overdueMinor)} overdue`, rest: ` · ${plural(figure.overdueInvoices, "invoice")}` };
  }
  const ledger = ledgerLine(figure, money);
  if (ledger) return ledger;
  return { tone: null, lead: figure.valueMinor === 0 ? "No open invoices" : "Nothing overdue", rest: "" };
}

export function payablesLine(figure: HomeFigures["payables"], money: Money): FigureLine {
  if (figure.overdueMinor > 0) {
    return { tone: "danger", lead: `${money(figure.overdueMinor)} overdue`, rest: ` · ${plural(figure.overdueBills, "bill")}` };
  }
  if (figure.dueSoonMinor > 0) {
    return { tone: "warning", lead: `${money(figure.dueSoonMinor)} due in 7 days`, rest: ` · ${plural(figure.dueSoonBills, "bill")}` };
  }
  const ledger = ledgerLine(figure, money);
  if (ledger) return ledger;
  return { tone: null, lead: figure.valueMinor === 0 ? "No open bills" : "Nothing due in 7 days", rest: "" };
}

/**
 * "11 months of earlier years are still open, the oldest January 2025.": the
 * months the close checklist does not cover, said so they are not taken for closed.
 */
export function earlierOpenSentence(open: { count: number; oldestPeriodEnd: string }): string {
  if (open.count === 1) return `${monthYearLabel(open.oldestPeriodEnd)}, from an earlier year, is still open.`;
  return `${plural(open.count, "month")} of earlier years are still open, the oldest ${monthYearLabel(open.oldestPeriodEnd)}.`;
}

/** "Net income, November": the month the figure is for, by name. */
export function netIncomeLabel(months: readonly HomeMonth[]): string {
  const current = months[months.length - 1];
  return current ? `Net income, ${longMonthName(current.key)}` : "Net income";
}

/* ---------------------------------------------------- invoices and bills */

/** How far ahead the Invoices and Bills cards look for what falls due (3.0.41). */
export const DUE_OPTIONS: readonly { value: HomeDueDays; label: string }[] = [
  { value: 7, label: "Due in 7 days" },
  { value: 30, label: "Due in 30 days" },
];

/** "Due in 30 days": the middle figure's name on the Invoices and Bills cards. */
export function dueLabel(days: HomeDueDays): string {
  return `Due in ${days} days`;
}

/** What falls due within the chosen window, and after it: the 7-day fields, or `within30`. */
export function dueWindowOf(side: HomeOpenSide, days: HomeDueDays): HomeDueWindow {
  if (days === 30) return side.within30;
  return { dueMinor: side.dueSoonMinor, dueDocuments: side.dueSoonDocuments, laterMinor: side.laterMinor, laterDocuments: side.laterDocuments };
}

/** "97 days late", "1 day late". */
export function daysLate(days: number): string {
  return `${plural(days, "day")} late`;
}

/** How a bill's due date reads in the list of bills to pay, and its tone. */
export function billDueLook(daysUntilDue: number): { tone: StatusTone; label: string } {
  if (daysUntilDue < 0) return { tone: "danger", label: daysLate(-daysUntilDue) };
  if (daysUntilDue === 0) return { tone: "warning", label: "Due today" };
  const label = `Due in ${plural(daysUntilDue, "day")}`;
  return { tone: daysUntilDue <= 7 ? "warning" : "neutral", label };
}

/** "+ 2 in other currencies", or nothing when every payment was in the base currency. */
export function otherCurrencies(count: number): string {
  return count > 0 ? ` + ${count} in other ${pluralWord(count, "currency", "currencies")}` : "";
}

/* ------------------------------------------------------------ bank accounts */

const TONE_LOOK: Record<HomeTone, StatusTone> = {
  positive: "positive",
  warning: "warning",
  danger: "danger",
  neutral: "neutral",
};

export function bankTone(tone: HomeTone): StatusTone {
  return TONE_LOOK[tone];
}

/**
 * The bank accounts table, in the order it is drawn: the bank accounts, the
 * cash held in no bank account, then the cards. Only the first two add up to
 * Cash on hand; a card's balance is what is owed on it, so it is listed apart
 * and never added in.
 */
export function bankTable(bank: HomeBank): { banks: HomeBankAccount[]; cards: HomeBankAccount[]; otherCash: HomeBank["otherCash"]; cashMinor: number } {
  return {
    banks: bank.accounts.filter((account) => !account.isCard),
    cards: bank.accounts.filter((account) => account.isCard),
    otherCash: bank.otherCash,
    cashMinor: bank.totalBookMinor,
  };
}

/** A card's balance as a card statement says it: owed, or in credit when it has been overpaid. */
export function cardBalance(minor: number, money: Money): string {
  if (minor < 0) return `${money(-minor)} in credit`;
  return `${money(minor)} owed`;
}

/* -------------------------------------------------------------- the close */

/** "5 of 7 steps done" */
export function stepsDone(complete: number, applicable: number): string {
  return `${complete} of ${plural(applicable, "step")} done`;
}

/** The last day of the books, said as the figures' cut-off: "As of 09/30/2026, the last posted day". */
export function lastPostedDay(postedThrough: string | null): string {
  return postedThrough ? `As of ${formatDate(postedThrough)}, the last posted day` : "Nothing is posted yet";
}
