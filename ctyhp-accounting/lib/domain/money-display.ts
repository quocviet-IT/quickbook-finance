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
  decimals: number,
): MoneyDisplay {
  // -0 collapsed to 0 before anything reads it. `-0 === 0` is true, so this
  // changes no other input, but it keeps the sign and the string from
  // disagreeing: `-0 < 0` is false while Intl still formats -0 as "-$0.00".
  const amount = minor === 0 ? 0 : minor;
  const text = formatMoney(amount, currencyCode, decimals);
  const sign: MoneySign = amount < 0 ? "negative" : amount > 0 ? "positive" : "zero";
  return {
    text,
    // Spelled out rather than left to the leading dash. A dash is a single
    // character that several screen readers skip at speed, and a credit read
    // as a debit is the one mistake a ledger must not invite.
    ariaLabel: sign === "negative" ? `negative ${text.replace("-", "")}` : text,
    sign,
  };
}
