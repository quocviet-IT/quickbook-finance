"use client";

import { Fragment, useCallback } from "react";
import { ReportFoot, reportPaperStyles as styles } from "@/components/reports/ReportPaper";
import SimpleReport from "@/components/reports/SimpleReport";
import {
  RATIO_GROUPS,
  arrowText,
  financialRatiosSheet,
  formatRatio,
  workingsRows,
  type FinancialRatiosReport,
  type RatioArrow,
} from "@/lib/domain/financial-ratios";
import { formatMoney } from "@/lib/format";
import { rangeText, type PresetContext } from "@/lib/domain/report-presets";
import type { ReportRunResult, ReportWhen } from "@/lib/domain/report-run";

function arrowClass(arrow: RatioArrow | null): string {
  if (arrow?.kind !== "moved") return "";
  if (arrow.verdict === "better") return styles.favorable;
  if (arrow.verdict === "worse") return styles.unfavorable;
  return "";
}

/**
 * Financial Ratios: fifteen ratios in four groups, this period beside the
 * same dates a year earlier, with an arrow for how each moved, then the
 * figures every ratio is worked out from.
 */
export default function FinancialRatiosClient({
  companyName,
  currencyCode,
  decimals,
  presets,
  load,
}: {
  companyName: string;
  currencyCode: string;
  decimals: number;
  presets: PresetContext;
  load: (when: ReportWhen) => Promise<ReportRunResult<FinancialRatiosReport>>;
}) {
  const money = useCallback((minor: number) => formatMoney(minor, currencyCode, decimals), [currencyCode, decimals]);
  const sheet = useCallback(
    (report: FinancialRatiosReport) => financialRatiosSheet(report, { companyName, currencyCode, money }),
    [companyName, currencyCode, money],
  );

  return (
    <SimpleReport<FinancialRatiosReport>
      companyName={companyName}
      title="Financial Ratios"
      currencyCode={currencyCode}
      period={{ kind: "range", ctx: presets, preset: "year" }}
      load={load}
      sheet={sheet}
      runningText="Working out the ratios…"
      render={(report) => {
        const earlierText = rangeText(report.earlierFrom, report.earlierTo);
        return (
          <>
            <div className={styles.rptScroll}>
              <table className={styles.rpt} aria-label="Ratios">
                <thead>
                  <tr>
                    <th className={styles.l}>Ratio</th>
                    <th>
                      This period
                      <div className={styles.thSub}>{rangeText(report.from, report.to)}</div>
                    </th>
                    <th>
                      A year earlier
                      <div className={styles.thSub}>{earlierText}</div>
                    </th>
                    <th>Change</th>
                  </tr>
                </thead>
                <tbody>
                  {RATIO_GROUPS.map((group) => (
                    <Fragment key={group.id}>
                      <tr className={styles.rSection}>
                        <td colSpan={4}>{group.label}</td>
                      </tr>
                      {report.rows
                        .filter((row) => row.group === group.id)
                        .map((row) => (
                          <tr key={row.id}>
                            <td>
                              {row.name}
                              <div className={styles.muted}>{row.meaning}</div>
                            </td>
                            <td className={styles.r}>{formatRatio(row.format, row.current, money)}</td>
                            <td className={styles.r}>{formatRatio(row.format, row.earlier, money)}</td>
                            <td className={`${styles.r} ${arrowClass(row.arrow)}`}>
                              {row.arrow ? (
                                row.arrow.kind === "steady" ? (
                                  <span className={styles.muted}>steady</span>
                                ) : (
                                  arrowText(row.arrow)
                                )
                              ) : null}
                            </td>
                          </tr>
                        ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>

            <div className={styles.rptScroll} style={{ marginTop: 24 }}>
              <table className={styles.rpt} aria-label="The figures behind them">
                <thead>
                  <tr>
                    <th className={styles.l}>The figures behind them</th>
                    <th>This period</th>
                    <th>A year earlier</th>
                  </tr>
                </thead>
                <tbody>
                  {workingsRows(report.current, report.earlier).map((row) => (
                    <tr key={row.label}>
                      <td>{row.label}</td>
                      <td className={styles.r}>{row.kind === "money" ? money(row.current) : row.current.toLocaleString("en-US")}</td>
                      <td className={styles.r}>
                        {row.earlier === null ? "—" : row.kind === "money" ? money(row.earlier) : row.earlier.toLocaleString("en-US")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ReportFoot>
              {report.earlier === null ? (
                <>
                  <strong>No year-earlier column.</strong> The same dates a year earlier have no assets and no income on
                  the books, so there is nothing to compare with.{" "}
                </>
              ) : null}
              <strong>How it counts.</strong> Balances are taken at the To date, and income and costs over the period.
              Current and long-term follow the account type, as on the Balance Sheet. Treat it as a first read, not a
              covenant test. A dash means nothing to divide by.
            </ReportFoot>
          </>
        );
      }}
    />
  );
}
