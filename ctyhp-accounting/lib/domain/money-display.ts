import { formatMoney } from "@/lib/format";

/**
 * What a money cell says, and how it is heard.
 *
 * `formatMoney` already produces the string; this adds the two things every
 * table cell was deciding for itself — which way the figure points, and what a
 * screen reader should say about it.
 *
 * Pure, so the rules can be held to account without rendering anything.
 */
export type MoneySign = "negative" | "zero" | "positive";

export interface MoneyDisplay {
  text: string;
  ariaLabel: string;
  sign: MoneySign;
}

export function moneyDisplay(
  minor: number,
  currencyCode: string,
  decimals = 2,
): MoneyDisplay {
  const text = formatMoney(minor, currencyCode, decimals);
  const sign: MoneySign = minor < 0 ? "negative" : minor > 0 ? "positive" : "zero";
  return {
    text,
    // Spelled out rather than left to the leading dash. A dash is a single
    // character that several screen readers skip at speed, and a credit read
    // as a debit is the one mistake a ledger must not invite.
    ariaLabel: sign === "negative" ? `negative ${text.replace("-", "")}` : text,
    sign,
  };
}
