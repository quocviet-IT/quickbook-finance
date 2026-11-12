/**
 * The statement matching window (3.0.24, item E of the defect report of
 * 11 Nov 2026): how many days apart a statement line and a book entry of the
 * same amount, on the same account, may be dated and still pair. It was 5,
 * written into the pairing; the company now sets it on Banking › Rules, and
 * every pairing reads the saved figure (acc_statement_match_window, 0193).
 *
 * Pure, so the settings card and the server check the same rule.
 */
import { plural } from "@/lib/format";
import { PAIRING_WINDOW_DAYS } from "./statement-pairing";

/** What a company starts with: the 5 days the pairing always used. */
export const MATCH_WINDOW_DEFAULT = PAIRING_WINDOW_DAYS;
/** The widest window the database takes. */
export const MATCH_WINDOW_MAX = 31;
/** What the card offers. */
export const MATCH_WINDOW_OPTIONS = [0, 1, 2, 3, 5, 7, 10, 14] as const;

/** Why a window will not do, in the database's own words, or null when it will. */
export function matchWindowProblem(days: number): string | null {
  return Number.isInteger(days) && days >= 0 && days <= MATCH_WINDOW_MAX ? null : "Choose a window from 0 to 31 days";
}

/** "Same day", "1 day", "5 days". */
export function matchWindowLabel(days: number): string {
  return days === 0 ? "Same day" : plural(days, "day");
}

/** The card's words, and the sentence the reconciliation shows under its statement lines. */
export const MATCH_WINDOW_CARD = {
  heading: "Statement matching",
  lede:
    "A statement line pairs with an entry in the books on the same bank account, for the same amount, dated within this many days. " +
    "A line that fits more than one entry is left for you to choose; nothing is guessed.",
  label: "Pair within",
  saved: "Statement matching saved",
} as const;

/** Under a reconciliation's statement lines: the rule its pairs were made by. */
export function matchRuleSentence(days: number): string {
  const within = days === 0 ? "dated the same day" : `dated within ${plural(days, "day")}`;
  return `Lines pair with entries of the same amount ${within}, or with the same check number. Change the window on Banking › Rules.`;
}
