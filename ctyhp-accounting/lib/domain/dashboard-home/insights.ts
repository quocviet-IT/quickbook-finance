/**
 * Insights: a few sentences worked out from the books by fixed rules, each
 * carrying the figures it rests on, so a reader can check it.
 *
 * Pure. At most three, in this order of priority:
 *
 * 1. books behind: "N months are missing from the books";
 * 2. a loss in the last full posted month;
 * 3. what is overdue, owed mostly by a few customers (never all of them);
 * 4. how many months of expenses cash covers;
 * 5. a change in gross margin of a point or more.
 *
 * Money is formatted by the caller's `money`, as `dashboardNeeds` does.
 */
import type { ProfitAndLoss } from "@/lib/domain/reports";
import { formatDate, plural, pluralWord } from "@/lib/format";
import { totalExpenses } from "./expenses";
import type { OverdueParty } from "./open-items";
import { longMonthName, monthsAfter } from "./ranges";
import type { HomeInsight, HomeMonth } from "./types";

export const MAX_INSIGHTS = 3;
/** The most full months the cash runway averages over, and the fewest it needs. */
export const RUNWAY_MONTHS = { most: 5, fewest: 2 } as const;
/** The smallest change in gross margin worth a sentence, in percentage points. */
export const MARGIN_CHANGE_POINTS = 1;
/** The most customers the receivables sentence names. */
export const CONCENTRATION_CUSTOMERS = 3;

export interface HomeInsightFacts {
  asOf: string;
  postedThrough: string | null;
  behind: boolean;
  /** Consecutive months, oldest first; the last is the current month to date. */
  months: readonly HomeMonth[];
  /** Each month's Profit and Loss, aligned with `months`. */
  pnl: readonly ProfitAndLoss[];
  cashTodayMinor: number;
  /** The customers with something overdue; null when receivables could not be read, which leaves that rule out. */
  overdueParties: readonly OverdueParty[] | null;
}

type Money = (minor: number) => string;

/** "A", "A and B", "A, B and C". */
export function listWords(words: readonly string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

const PNL_LINK = { label: "Profit and loss", href: "/reports?report=pnl" };

function incomeOf(pnl: ProfitAndLoss): number {
  return pnl.income.total + pnl.otherIncome.total;
}

function grossMargin(pnl: ProfitAndLoss): number {
  return (pnl.grossProfit / pnl.income.total) * 100;
}

/** Indexes of the full months (every month but the current one) that are posted, oldest first. */
function fullPostedMonths(months: readonly HomeMonth[]): number[] {
  const out: number[] = [];
  for (let index = 0; index < months.length - 1; index += 1) if (months[index].posted) out.push(index);
  return out;
}

function booksBehindInsight(facts: HomeInsightFacts): HomeInsight | null {
  if (!facts.behind || facts.postedThrough === null) return null;
  const missing = monthsAfter(facts.postedThrough, facts.asOf);
  if (missing.length === 0) return null;
  const names = missing.map(longMonthName);
  const notEntered = names.length <= 3 ? ` ${listWords(names)} ${pluralWord(names.length, "is", "are")} not entered yet.` : "";
  return {
    key: "books-behind",
    kind: "Books",
    headline: `${plural(missing.length, "month")} ${pluralWord(missing.length, "is", "are")} missing from the books`,
    detail: `Nothing is posted after ${formatDate(facts.postedThrough)}, so every figure stops there.${notEntered}`,
    link: { label: "Import bank lines", href: "/banking" },
  };
}

function lossInsight(facts: HomeInsightFacts, money: Money): HomeInsight | null {
  const index = fullPostedMonths(facts.months).at(-1);
  if (index === undefined) return null;
  const pnl = facts.pnl[index];
  if (!(pnl.netIncome < 0)) return null;
  return {
    key: "loss-last-month",
    kind: "Profit",
    headline: `${longMonthName(facts.months[index].key)} ran a loss of ${money(-pnl.netIncome)}`,
    detail: `Expenses of ${money(totalExpenses(pnl))} against income of ${money(incomeOf(pnl))}.`,
    link: PNL_LINK,
  };
}

function concentrationInsight(facts: HomeInsightFacts, money: Money): HomeInsight | null {
  const parties = facts.overdueParties;
  if (parties === null || parties.length < 2) return null;
  const totalMinor = parties.reduce((sum, party) => sum + party.overdueMinor, 0);
  if (totalMinor <= 0) return null;
  // Always fewer than everyone who is overdue: "2 customers owe 100%" says nothing.
  const top = [...parties]
    .sort((a, b) => b.overdueMinor - a.overdueMinor || a.name.localeCompare(b.name))
    .slice(0, Math.min(CONCENTRATION_CUSTOMERS, parties.length - 1));
  const topMinor = top.reduce((sum, party) => sum + party.overdueMinor, 0);
  const owe = pluralWord(top.length, "owes", "owe");
  return {
    key: "receivables-concentration",
    kind: "Receivables",
    headline: `${plural(top.length, "customer")} ${owe} ${Math.round((topMinor / totalMinor) * 100)}% of what is overdue`,
    detail: `${listWords(top.map((party) => party.name))} ${owe} ${money(topMinor)} of ${money(totalMinor)}.`,
    link: { label: "Review overdue", href: `/invoices?queue=overdue&asOf=${facts.asOf}` },
  };
}

function runwayInsight(facts: HomeInsightFacts, money: Money): HomeInsight | null {
  const used = fullPostedMonths(facts.months).slice(-RUNWAY_MONTHS.most);
  if (used.length < RUNWAY_MONTHS.fewest || facts.cashTodayMinor <= 0) return null;
  const average = used.reduce((sum, index) => sum + totalExpenses(facts.pnl[index]), 0) / used.length;
  if (!(average > 0)) return null;
  const first = longMonthName(facts.months[used[0]].key);
  const last = longMonthName(facts.months[used[used.length - 1]].key);
  return {
    key: "cash-runway",
    kind: "Cash",
    headline: `Cash covers ${(facts.cashTodayMinor / average).toFixed(1)} months of expenses`,
    detail: `${money(facts.cashTodayMinor)} on hand against an average of ${money(Math.round(average))} in expenses a month, ${first} to ${last}.`,
    link: { label: "Cash flow report", href: "/reports/cash-flow" },
  };
}

function marginInsight(facts: HomeInsightFacts, money: Money): HomeInsight | null {
  const index = fullPostedMonths(facts.months).at(-1);
  if (index === undefined) return null;
  const current = facts.pnl[facts.pnl.length - 1];
  const previous = facts.pnl[index];
  const measurable = (pnl: ProfitAndLoss) => pnl.income.total > 0 && pnl.costOfGoodsSold.total > 0;
  if (!current || !measurable(current) || !measurable(previous)) return null;
  const now = grossMargin(current);
  const before = grossMargin(previous);
  if (Math.abs(now - before) < MARGIN_CHANGE_POINTS) return null;
  return {
    key: "gross-margin",
    kind: "Margin",
    headline: `Gross margin is ${now.toFixed(1)}%, ${now < before ? "down" : "up"} from ${before.toFixed(1)}% in ${longMonthName(
      facts.months[index].key,
    )}`,
    detail: `Cost of goods sold is ${money(current.costOfGoodsSold.total)} on sales of ${money(current.income.total)}.`,
    link: PNL_LINK,
  };
}

/** The insights that apply, in priority order, at most three. */
export function homeInsights(facts: HomeInsightFacts, money: Money): HomeInsight[] {
  return [
    booksBehindInsight(facts),
    lossInsight(facts, money),
    concentrationInsight(facts, money),
    runwayInsight(facts, money),
    marginInsight(facts, money),
  ]
    .filter((insight): insight is HomeInsight => insight !== null)
    .slice(0, MAX_INSIGHTS);
}
