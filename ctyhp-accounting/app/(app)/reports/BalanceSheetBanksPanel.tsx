"use client";

import Link from "next/link";
import { ToneBadge } from "@/lib/design/tone";
import {
  describeStanding,
  ghostEntriesSentence,
  withBelowZero,
  type BalanceSheetBank,
  type Money,
} from "@/lib/domain/bank-standing";
import { reconcileHref } from "@/lib/domain/statement-alerts";
import styles from "./balance-sheet-banks.module.css";

/**
 * How each bank account stands against its statements on the Balance Sheet's
 * end date, one line per account, with a link to Reconcile on it. It sits under
 * the sheet, outside the printed paper and the export: a help beside the
 * statement, not part of it.
 */
export default function BalanceSheetBanksPanel({
  banks,
  asOf,
  money,
}: {
  banks: readonly BalanceSheetBank[];
  asOf: string;
  money: Money;
}) {
  if (banks.length === 0) return null;
  return (
    <section className={styles.panel} aria-labelledby="balance-sheet-banks-heading">
      <h2 id="balance-sheet-banks-heading" className={styles.heading}>
        Bank accounts
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
      </ul>
    </section>
  );
}
