"use client";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { maskAmounts, PRIVATE_AMOUNT, PRIVATE_COMPACT } from "@/lib/domain/dashboard-home/privacy";
import { formatCompactMoney, formatMoney } from "@/lib/format";

/**
 * Privacy on the Dashboard (3.0.39): every amount the page writes goes through
 * here, so one switch masks them all. The cards are handed `money` and
 * `compact` from this context; the two cards streamed in from the server
 * (Needs attention and Month-end close) read it themselves.
 */
export interface Privacy {
  on: boolean;
  /** An amount in the base currency, or the masked amount. */
  money: (minor: number) => string;
  /** A short amount for an axis or a ring's middle, or the short mask. */
  compact: (minor: number) => string;
  /** An amount in its own currency (a payment's), or the masked amount. */
  own: (minor: number, code: string, decimals: number) => string;
  /** A sentence built on the server, with its amounts masked while Privacy is on. */
  text: (sentence: string) => string;
}

/** The formatters for one state of the switch, in the company's base currency. */
export function privacyFormatters(on: boolean, currency: { code: string; decimals: number }): Privacy {
  return {
    on,
    money: (minor) => (on ? PRIVATE_AMOUNT : formatMoney(minor, currency.code, currency.decimals)),
    compact: (minor) => (on ? PRIVATE_COMPACT : formatCompactMoney(minor, currency.code, currency.decimals)),
    own: (minor, code, decimals) => (on ? PRIVATE_AMOUNT : formatMoney(minor, code, decimals)),
    text: (sentence) => (on ? maskAmounts(sentence) : sentence),
  };
}

/** Outside a provider nothing is masked; the Dashboard always provides one, with its own currency. */
const PrivacyContext = createContext<Privacy>(privacyFormatters(false, { code: "USD", decimals: 2 }));

export function PrivacyProvider({
  on,
  currency,
  children,
}: {
  on: boolean;
  currency: { code: string; decimals: number };
  children: ReactNode;
}) {
  const { code, decimals } = currency;
  const value = useMemo(() => privacyFormatters(on, { code, decimals }), [on, code, decimals]);
  return <PrivacyContext value={value}>{children}</PrivacyContext>;
}

export function usePrivacy(): Privacy {
  return useContext(PrivacyContext);
}
