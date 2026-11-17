/**
 * What each Dashboard card shows, as each person chose it (3.0.41): the period
 * of Profit and loss, Expenses and Sales, Cash flow's months and forecast
 * horizon, and the due window of Invoices and Bills.
 *
 * Pure. The choices are kept per person per company (migration 0200) and read
 * back through `normalizeCardChoices`, so choices saved by an older or newer
 * screen, or anything that is not choices at all, still give a screen to draw.
 */
import type { HomeDueDays, HomeHorizon, HomePeriodKey } from "./types";

export interface CardChoices {
  pnl: HomePeriodKey;
  /** One choice for Expenses on Overview and on Money out. */
  expenses: HomePeriodKey;
  sales: HomePeriodKey;
  cashMonths: 6 | 12;
  horizon: HomeHorizon;
  invoicesDue: HomeDueDays;
  billsDue: HomeDueDays;
}

/** Every period a card offers, in the order the select lists them. */
export const HOME_PERIOD_KEYS: readonly HomePeriodKey[] = ["month", "lastMonth", "last3", "quarter", "year", "last12", "lastYear"];
const CASH_MONTHS: readonly CardChoices["cashMonths"][] = [6, 12];
const HORIZONS: readonly HomeHorizon[] = [30, 60, 90];
const DUE_DAYS: readonly HomeDueDays[] = [7, 30];

/** The Dashboard as it was before choices were kept: this month, six months, 30 days ahead, 7 days due. */
export const DEFAULT_CARD_CHOICES: Readonly<CardChoices> = Object.freeze({
  pnl: "month",
  expenses: "month",
  sales: "month",
  cashMonths: 6,
  horizon: 30,
  invoicesDue: 7,
  billsDue: 7,
});

/** `value` when it is one of `allowed`, exactly (6, never "6"); otherwise `fallback`. */
function oneOf<T>(value: unknown, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly unknown[]).includes(value) ? (value as T) : fallback;
}

/**
 * Choices to draw from whatever was stored or sent: each known key with a
 * value the screen offers is kept, anything else is dropped, and every card
 * left without a choice gets its default.
 */
export function normalizeCardChoices(raw: unknown): CardChoices {
  const source: Record<string, unknown> = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const own = (key: keyof CardChoices): unknown => (Object.prototype.hasOwnProperty.call(source, key) ? source[key] : undefined);
  return {
    pnl: oneOf(own("pnl"), HOME_PERIOD_KEYS, DEFAULT_CARD_CHOICES.pnl),
    expenses: oneOf(own("expenses"), HOME_PERIOD_KEYS, DEFAULT_CARD_CHOICES.expenses),
    sales: oneOf(own("sales"), HOME_PERIOD_KEYS, DEFAULT_CARD_CHOICES.sales),
    cashMonths: oneOf(own("cashMonths"), CASH_MONTHS, DEFAULT_CARD_CHOICES.cashMonths),
    horizon: oneOf(own("horizon"), HORIZONS, DEFAULT_CARD_CHOICES.horizon),
    invoicesDue: oneOf(own("invoicesDue"), DUE_DAYS, DEFAULT_CARD_CHOICES.invoicesDue),
    billsDue: oneOf(own("billsDue"), DUE_DAYS, DEFAULT_CARD_CHOICES.billsDue),
  };
}
