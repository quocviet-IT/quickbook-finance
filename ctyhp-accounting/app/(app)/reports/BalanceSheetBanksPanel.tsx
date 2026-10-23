"use client";

import Link from "next/link";
import { Button } from "antd";
import { ToneBadge } from "@/lib/design/tone";
import {
  describeStanding,
  bankPanelHeading,
  ghostEntriesSentence,
  withBelowZero,
  type BalanceSheetBank,
  type Money,
} from "@/lib/domain/bank-standing";
import { describeCashStanding, type CashStanding } from "@/lib/domain/cash-count";
import { reconcileHref } from "@/lib/domain/statement-alerts";
import styles from "./balance-sheet-banks.module.css";

/** What the panel shows of the company's cash on hand accounts. */
export interface CashPanel {
  lines: readonly CashStanding[];
  /** Whether this person may count cash. */
  canCount: boolean;
}

/**
 * How each bank account stands against its statements on the Balance Sheet's
 * end date, one line per account, with a link to Reconcile on it; and, under
 * them, when each cash on hand account was last counted, with a button to
 * count it. It sits under the sheet, outside the printed paper and the export:
 * a help beside the statement, not part of it.
 */
export default function BalanceSheetBanksPanel({
  banks,
  asOf,
  money,
  cash = null,
  cashUnavailable = false,
  onCount,
}: {
  banks: readonly BalanceSheetBank[];
  asOf: string;
  money: Money;
  /** The cash lines; null when they are not read (yet). */
  cash?: CashPanel | null;
  /** True when the cash read failed: the panel says so in a line and keeps the banks. */
  cashUnavailable?: boolean;
  onCount?: (account: { id: string; name: string }) => void;
}) {
  const cashLines = cash?.lines ?? [];
  if (banks.length === 0 && cashLines.length === 0 && !cashUnavailable) return null;
  return (
    <section className={styles.panel} aria-labelledby="balance-sheet-banks-heading">
      <h2 id="balance-sheet-banks-heading" className={styles.heading}>
        {bankPanelHeading(cashLines.length > 0, banks.some((bank) => bank.isCard))}
      </h2>
      <ul className={styles.list}>
        {banks.map((bank) => {
          const view = describeStanding(bank.standing, asOf, money);
          const text = bank.belowZero ? withBelowZero(view.text, asOf) : view.text;
          return (
            <li key={bank.bankAccountId} className={styles.row}>
              <Link href={reconcileHref(bank.bankAccountId)} className={styles.name}>
                {bank.accountName}
              </Link>
              <div className={styles.lines}>
                <p className={styles.line}>
                  <ToneBadge tone={view.tone}>{text}</ToneBadge>
                </p>
                {bank.belowZero && bank.ghostEntries > 0 ? (
                  <p className={`${styles.line} ${styles.note}`}>{ghostEntriesSentence(bank.ghostEntries)}</p>
                ) : null}
                {view.noLongerAgrees ? (
                  <p className={styles.line}>
                    <ToneBadge tone="danger">{view.noLongerAgrees}</ToneBadge>
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
        {cashLines.map((account) => {
          const view = describeCashStanding(account, asOf, money);
          return (
            <li key={account.accountId} className={styles.cashRow}>
              <p className={styles.cashText}>
                <ToneBadge tone={view.tone}>{view.text}</ToneBadge>
              </p>
              {cash?.canCount && onCount ? (
                <Button size="small" onClick={() => onCount({ id: account.accountId, name: account.accountName })}>
                  Count cash
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {cashUnavailable ? (
        <p className={styles.cashProblem}>When cash on hand was last counted could not be read.</p>
      ) : null}
    </section>
  );
}
