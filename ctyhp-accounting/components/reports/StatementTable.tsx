"use client";

import { Fragment, type ReactNode } from "react";
import { formatPercent } from "@/lib/format";
import type { Statement, StatementRow, ZoomSpec } from "@/lib/domain/statement";
import styles from "./report-paper.module.css";

const ROW_CLASS: Record<StatementRow["kind"], string | undefined> = {
  section: styles.rSection,
  classhead: styles.rClasshead,
  account: undefined,
  subtotal: styles.rSub,
  total: styles.rTotal,
  grand: styles.rGrand,
  spacer: styles.rSpacer,
  note: styles.rNote,
};

const INDENT = [styles.ind0, styles.ind1, styles.ind2, styles.ind3];

const TONE_CLASS = { favorable: styles.favorable, unfavorable: styles.unfavorable } as const;

/** A percentage cell: blank when there is no percentage to give (nothing to divide by). */
const percentText = (value: number | null | undefined): string => (value == null ? "" : formatPercent(value));

/**
 * The class for a cell holding a signed value: the row's tone when it has one
 * (Budget vs Actual — already coloured favourable/unfavourable, so nothing is
 * added on top of it), the danger colour when it has no tone but the value is
 * itself below zero, nothing otherwise.
 */
const signClass = (value: number | null | undefined, toneClass?: string): string =>
  toneClass ? ` ${toneClass}` : value != null && value < 0 ? ` ${styles.negative}` : "";

/**
 * A statement as the client's prototype prints one (`table.rpt`): sections in
 * small capitals, accounts indented under their parent, a rule over each total
 * and a double rule under the last. Every figure with something behind it is a
 * QuickZoom; an account's name opens its General Ledger in a new tab.
 */
export default function StatementTable({
  statement,
  money,
  onZoom,
}: {
  statement: Statement;
  money: (minor: number) => string;
  onZoom: (spec: ZoomSpec) => void;
}) {
  const { columns, percent, changeLabels } = statement;
  const width = 1 + columns.length * (percent ? 2 : 1) + (changeLabels ? 2 : 0);
  const first = columns[0];
  const ledgerHref = (accountId: string) =>
    `/reports/general-ledger?account=${accountId}${first.from ? `&from=${first.from}` : ""}&to=${first.to}`;

  const amount = (row: StatementRow, i: number): ReactNode => {
    const cell = row.cells[i];
    if (cell.amount === null) return "";
    const text = money(cell.amount);
    const negative = cell.amount < 0;
    if (!cell.zoom) return <span className={negative ? styles.negative : undefined}>{text}</span>;
    const zoom = cell.zoom;
    return (
      <button
        type="button"
        className={`${styles.zoom}${negative ? ` ${styles.zoomNeg}` : ""}`}
        onClick={() => onZoom(zoom)}
        title="Open the entries behind this figure"
        aria-label={`${row.label}, ${columns[i].label}: ${text}. Open the entries behind it.`}
      >
        {text}
      </button>
    );
  };

  return (
    <div className={styles.rptScroll}>
      <table className={styles.rpt}>
        <thead>
          <tr>
            <th className={styles.l}>Account</th>
            {columns.map((c) => (
              <Fragment key={c.key}>
                <th>
                  {c.label}
                  {c.sub ? <div className={styles.thSub}>{c.sub}</div> : null}
                </th>
                {percent ? <th>%</th> : null}
              </Fragment>
            ))}
            {changeLabels ? (
              <>
                <th>{changeLabels[0]}</th>
                <th>{changeLabels[1]}</th>
              </>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {statement.rows.map((row) => {
            if (row.kind === "spacer") {
              return (
                <tr key={row.key} className={styles.rSpacer} aria-hidden>
                  <td colSpan={width} />
                </tr>
              );
            }
            if (row.kind === "section") {
              return (
                <tr key={row.key} className={styles.rSection}>
                  <td colSpan={width}>{row.label}</td>
                </tr>
              );
            }
            const label =
              row.kind === "account" && row.accountId ? (
                <a
                  className={styles.accountLink}
                  href={ledgerHref(row.accountId)}
                  target="_blank"
                  rel="noopener"
                  title="Open this account's ledger in a new tab"
                >
                  {row.label}
                </a>
              ) : (
                row.label
              );
            const toneClass = row.tone ? TONE_CLASS[row.tone] : undefined;
            return (
              <tr key={row.key} className={ROW_CLASS[row.kind]}>
                <td className={INDENT[row.depth]}>{label}</td>
                {columns.map((c, i) => (
                  <Fragment key={c.key}>
                    <td className={styles.r}>{amount(row, i)}</td>
                    {percent ? (
                      <td className={`${styles.pct}${signClass(row.percent?.[i])}`}>{percentText(row.percent?.[i])}</td>
                    ) : null}
                  </Fragment>
                ))}
                {changeLabels ? (
                  <>
                    <td className={`${styles.r}${signClass(row.change?.amount, toneClass)}`}>
                      {row.change ? money(row.change.amount) : ""}
                    </td>
                    <td className={`${styles.pct}${signClass(row.change?.percent, toneClass)}`}>
                      {percentText(row.change?.percent)}
                    </td>
                  </>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
