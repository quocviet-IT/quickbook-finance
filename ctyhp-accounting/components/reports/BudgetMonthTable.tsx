"use client";

import type { MonthResult } from "@/lib/domain/budget-grid";
import { reportPaperStyles as styles } from "@/components/reports/ReportPaper";

/**
 * The result of each month against its budget. A result is income less
 * expenses, so being above budget is good news here.
 */
export default function BudgetMonthTable({
  months,
  money,
}: {
  months: readonly MonthResult[];
  money: (minor: number) => string;
}) {
  if (months.length < 2) return null;
  const total = months.reduce(
    (sum, month) => ({ actual: sum.actual + month.actual, budget: sum.budget + month.budget }),
    { actual: 0, budget: 0 },
  );
  const toneOf = (variance: number): string | undefined =>
    variance === 0 ? undefined : variance > 0 ? styles.favorable : styles.unfavorable;
  const cell = (variance: number) => `${styles.r}${toneOf(variance) ? ` ${toneOf(variance)}` : ""}`;

  return (
    <section aria-label="Month by month" style={{ marginTop: 24 }}>
      <h3 style={{ fontSize: 13, fontWeight: 700, margin: "0 0 8px" }}>Month by month</h3>
      <div className={styles.rptScroll}>
        <table className={styles.rpt}>
          <thead>
            <tr>
              <th className={styles.l}>Month</th>
              <th>Actual result</th>
              <th>Budgeted result</th>
              <th>Over / Under</th>
            </tr>
          </thead>
          <tbody>
            {months.map((month) => (
              <tr key={month.start}>
                <td>{month.label}</td>
                <td className={styles.r}>{money(month.actual)}</td>
                <td className={styles.r}>{money(month.budget)}</td>
                <td className={cell(month.variance)}>{money(month.variance)}</td>
              </tr>
            ))}
            <tr className={styles.rTotal}>
              <td>Total</td>
              <td className={styles.r}>{money(total.actual)}</td>
              <td className={styles.r}>{money(total.budget)}</td>
              <td className={cell(total.actual - total.budget)}>{money(total.actual - total.budget)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
