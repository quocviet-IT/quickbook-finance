"use client";
import { Alert, Typography } from "antd";
import { DIFFERENCE_LABELS, differenceHeading, linesCount, type DifferenceExplained } from "@/lib/domain/reconcile-difference";
import styles from "./difference.module.css";

/**
 * The difference a reconciliation is out by, in its parts (2.03): where the
 * statement opens against where this reconciliation begins, the statement
 * lines the books do not have, the ticks the statement does not have, and what
 * is left to explain. A line part with nothing in it is not shown; what is
 * left always is. The figures and sentences are explainDifference's.
 */
export default function DifferenceAlert({
  explained,
  money,
}: {
  explained: DifferenceExplained;
  money: (minor: number) => string;
}) {
  const { opening, onStatement, tickedNotOnStatement, leftMinor, hint } = explained;
  return (
    <Alert
      type="warning"
      showIcon
      title={differenceHeading(explained.differenceMinor, money)}
      description={
        <>
          <dl className={styles.parts}>
            {opening ? (
              <>
                <dt>{DIFFERENCE_LABELS.opening}</dt>
                <dd>{money(opening.amountMinor)}</dd>
                <dd className={styles.note}>
                  <Typography.Text type="secondary">{opening.text}</Typography.Text>
                </dd>
              </>
            ) : null}
            {onStatement && onStatement.count > 0 ? (
              <>
                <dt>
                  {DIFFERENCE_LABELS.onStatement} · {linesCount(onStatement.count)}
                </dt>
                <dd>{money(onStatement.amountMinor)}</dd>
              </>
            ) : null}
            {tickedNotOnStatement && tickedNotOnStatement.count > 0 ? (
              <>
                <dt>
                  {DIFFERENCE_LABELS.tickedNotOnStatement} · {linesCount(tickedNotOnStatement.count)}
                </dt>
                <dd>{money(tickedNotOnStatement.amountMinor)}</dd>
              </>
            ) : null}
            <dt className={styles.left}>{DIFFERENCE_LABELS.left}</dt>
            <dd className={styles.left}>{money(leftMinor)}</dd>
          </dl>
          {hint ? <Typography.Text className={styles.hint}>{hint}</Typography.Text> : null}
        </>
      }
    />
  );
}
