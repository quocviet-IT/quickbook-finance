/**
 * Needs attention on the rebuilt Dashboard: the eight checks the Dashboard
 * already makes (lib/domain/dashboard-needs.ts), each placed on a tab with the
 * word on its button, and six more from the money in and out.
 *
 * Pure. Amounts are base currency, from the aging reports, never a document's
 * own currency. Danger comes first, then warning, then info; inside a tone the
 * rows keep the order they arrive in: the existing checks first, as
 * `dashboardNeeds` orders them, then the new ones in the order listed here.
 */
import type { AttentionKey, DashboardNeed } from "@/lib/domain/dashboard-needs";
import { NOTHING_WAITING } from "@/lib/domain/dashboard-needs";
import { addIsoDays } from "@/lib/domain/work-queue";
import { formatDate, plural, pluralWord } from "@/lib/format";
import { DUE_SOON_DAYS } from "./open-items";
import { listWords } from "./insights";
import { monthYearLabel } from "./ranges";
import type { HomeNeed, HomeTab } from "./types";

export type HomeNeedKey =
  | AttentionKey
  | "overdueInvoices"
  | "billsOverdue"
  | "billsDueSoon"
  | "cardActivity"
  | "approvals"
  | "monthsOpen";

/** The facts behind the six new rows. A null fact shows nothing; a check whose read failed is listed in `unavailable`. */
export interface HomeNeedFacts {
  asOf: string;
  overdueInvoices: { count: number; amountMinor: number; oldestDaysLate: number } | null;
  billsOverdue: { count: number; amountMinor: number; oldestDaysLate: number } | null;
  billsDueSoon: { count: number; amountMinor: number; firstDueDate: string } | null;
  /** Card lines no completed reconciliation has ticked, as the card statement says them (charges positive). */
  cardActivity: { cards: number; lines: number; amountMinor: number } | null;
  /** Approval requests waiting for a decision. */
  approvals: number | null;
  /**
   * Open periods whose last day has passed; the oldest one's last day, and
   * whether it belongs to an earlier fiscal year (the period close screen then
   * cannot show it, Accounting periods can).
   */
  monthsOpen: { count: number; oldestPeriodEnd: string; earlierYear: boolean } | null;
  unavailable: HomeNeedKey[];
}

const EXISTING: Record<AttentionKey, { tab: HomeTab; action: string }> = {
  waiting: { tab: "banking", action: "Code" },
  neverReconciled: { tab: "banking", action: "Reconcile" },
  noLongerAgree: { tab: "banking", action: "Review" },
  backup: { tab: "banking", action: "Review" },
  recurringDue: { tab: "overview", action: "Post" },
  holding: { tab: "overview", action: "Review" },
  futureDated: { tab: "overview", action: "Review" },
  overBudget: { tab: "overview", action: "Review" },
};

const TONE_ORDER: Record<HomeNeed["tone"], number> = { danger: 0, warning: 1, info: 2 };

function newRows(facts: HomeNeedFacts, money: (minor: number) => string): HomeNeed[] {
  const rows: HomeNeed[] = [];
  const dueThrough = addIsoDays(facts.asOf, DUE_SOON_DAYS);
  const { overdueInvoices, billsOverdue, billsDueSoon, cardActivity, approvals, monthsOpen } = facts;
  if (overdueInvoices && overdueInvoices.count > 0) {
    rows.push({
      key: "overdueInvoices",
      tab: "money-in",
      count: overdueInvoices.count,
      tone: "danger",
      title: overdueInvoices.count === 1 ? "Invoice overdue" : "Invoices overdue",
      detail: `${money(overdueInvoices.amountMinor)} · oldest ${plural(overdueInvoices.oldestDaysLate, "day")} late`,
      href: `/invoices?queue=overdue&asOf=${facts.asOf}`,
      action: "Review",
    });
  }
  if (billsOverdue && billsOverdue.count > 0) {
    rows.push({
      key: "billsOverdue",
      tab: "money-out",
      count: billsOverdue.count,
      tone: "danger",
      title: billsOverdue.count === 1 ? "Bill overdue" : "Bills overdue",
      detail: `${money(billsOverdue.amountMinor)} · oldest ${plural(billsOverdue.oldestDaysLate, "day")} late`,
      href: `/bills?queue=due&through=${dueThrough}`,
      action: "Pay",
    });
  }
  if (billsDueSoon && billsDueSoon.count > 0) {
    rows.push({
      key: "billsDueSoon",
      tab: "money-out",
      count: billsDueSoon.count,
      tone: "warning",
      title: billsDueSoon.count === 1 ? "Bill due in the next 7 days" : "Bills due in the next 7 days",
      detail: `${money(billsDueSoon.amountMinor)} · first on ${formatDate(billsDueSoon.firstDueDate)}`,
      href: `/bills?queue=due&through=${dueThrough}`,
      action: "Pay",
    });
  }
  if (cardActivity && cardActivity.cards > 0 && cardActivity.lines > 0) {
    rows.push({
      key: "cardActivity",
      tab: "banking",
      count: cardActivity.lines,
      tone: "warning",
      title: "Card activity not reconciled",
      detail: `${money(cardActivity.amountMinor)} on ${plural(cardActivity.cards, "card")}, not yet on a completed reconciliation`,
      href: "/banking/reconcile",
      action: "Reconcile",
    });
  }
  if (approvals !== null && approvals > 0) {
    rows.push({
      key: "approvals",
      tab: "overview",
      count: approvals,
      tone: "info",
      title: approvals === 1 ? "Approval waiting" : "Approvals waiting",
      detail: `${plural(approvals, "request")} ${pluralWord(approvals, "waits", "wait")} for a decision`,
      href: "/approvals",
      action: "Approve",
    });
  }
  if (monthsOpen && monthsOpen.count > 0) {
    rows.push({
      key: "monthsOpen",
      tab: "banking",
      count: monthsOpen.count,
      tone: "info",
      title: monthsOpen.count === 1 ? "Month not closed" : "Months not closed",
      detail:
        monthsOpen.count === 1
          ? `${monthYearLabel(monthsOpen.oldestPeriodEnd)} has ended and is still open`
          : `The oldest is ${monthYearLabel(monthsOpen.oldestPeriodEnd)}`,
      href: monthsOpen.earlierYear ? "/settings/periods" : "/accounting?mode=close",
      action: monthsOpen.earlierYear ? "Review" : "Continue",
    });
  }
  return rows;
}

/**
 * The rows, each on its tab with its button's word: the existing checks as
 * `dashboardNeeds` built them, then the new ones; danger first, then warning,
 * then info, keeping that order inside each tone.
 */
export function homeNeeds(existing: readonly DashboardNeed[], extra: HomeNeedFacts, money: (minor: number) => string): HomeNeed[] {
  const mapped: HomeNeed[] = existing.map((need) => ({ ...need, ...EXISTING[need.key] }));
  return [...mapped, ...newRows(extra, money)]
    .map((need, index) => ({ need, index }))
    .sort((a, b) => TONE_ORDER[a.need.tone] - TONE_ORDER[b.need.tone] || a.index - b.index)
    .map(({ need }) => need);
}

/** The count beside each tab: Overview counts every row, the others their own. */
export function needsByTab(needs: readonly HomeNeed[]): Record<HomeTab, number> {
  const count = (tab: HomeTab) => needs.filter((need) => need.tab === tab).length;
  return { overview: needs.length, "money-in": count("money-in"), "money-out": count("money-out"), banking: count("banking") };
}

const UNAVAILABLE_WORDS: Record<HomeNeedKey, string> = {
  backup: "the last backup",
  waiting: "lines waiting on Bank Transactions",
  recurringDue: "recurring entries not posted",
  neverReconciled: "bank accounts never reconciled",
  noLongerAgree: "reconciliations that no longer agree",
  holding: "holding accounts",
  futureDated: "entries dated in the future",
  overBudget: "accounts over budget",
  overdueInvoices: "overdue invoices",
  billsOverdue: "overdue bills",
  billsDueSoon: "bills due in the next 7 days",
  cardActivity: "card activity not reconciled",
  approvals: "approvals waiting",
  monthsOpen: "months not closed",
};

/** Said under the list when checks could not run: they are neither clear nor counted. */
export function homeUnavailableNote(unavailable: readonly HomeNeedKey[]): string | null {
  if (unavailable.length === 0) return null;
  const words = unavailable.map((key) => UNAVAILABLE_WORDS[key]);
  const shown = words.length > 3 ? [...words.slice(0, 3), `${words.length - 3} more`] : words;
  return `${plural(unavailable.length, "check")} could not run just now, so ${listWords(shown)} ${pluralWord(
    unavailable.length,
    "is",
    "are",
  )} not counted here.`;
}

/**
 * The line shown when nothing is waiting: clear when every check ran, a
 * narrower sentence when some could not, and null when none could.
 * `checksMade` is how many checks were attempted.
 */
export function homeClearLine(unavailable: readonly HomeNeedKey[], checksMade: number): string | null {
  if (unavailable.length === 0) return NOTHING_WAITING;
  return unavailable.length < checksMade ? "Nothing is waiting among the checks that ran." : null;
}
