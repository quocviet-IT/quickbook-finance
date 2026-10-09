"use client";

import { useCallback, useState } from "react";
import { Segmented, Tag } from "antd";
import DataTable from "@/components/ui/DataTable";
import { flexColumn } from "@/components/ui/columns";
import ForecastChart from "@/components/reports/ForecastChart";
import { ReportFoot, StatRow, reportPaperStyles as paper } from "@/components/reports/ReportPaper";
import SimpleReport, { reportPagination } from "@/components/reports/SimpleReport";
import { COLUMN } from "@/lib/design/table-metrics";
import { cutName, describeForecastBasis, monthDay, type CashForecast, type ForecastMode, type OpenItem } from "@/lib/domain/forecast";
import { fromMinor } from "@/lib/domain/money";
import { longDate, shortDate } from "@/lib/domain/report-presets";
import type { ReportExportSheet } from "@/lib/domain/report-export";
import type { ReportRunResult, ReportWhen } from "@/lib/domain/report-run";
import { outstandingAge } from "@/lib/domain/settlement";
import { formatMoney } from "@/lib/format";
import type { CashForecastData } from "@/lib/services/forecast";
import styles from "./cash-forecast.module.css";

const PAGE_SIZE = 50;

const MODE_OPTIONS: { label: string; value: ForecastMode }[] = [
  { label: "By due date", value: "due" },
  { label: "As they usually pay", value: "usual" },
];

/** The sum of a week column across the thirteen weeks. */
function total(forecast: CashForecast, pick: (week: CashForecast["weeks"][number]) => number): number {
  return forecast.weeks.reduce((sum, week) => sum + pick(week), 0);
}

/**
 * The 13 Week Cash Forecast: cash in the bank today, then what is already
 * committed — issued invoices, received bills and recurring templates — laid
 * onto thirteen weeks. "By due date" is the default; "As they usually pay"
 * moves only the customer and supplier columns.
 */
export default function CashForecastReport({
  companyName,
  currencyCode,
  decimals,
  today,
  load,
}: {
  companyName: string;
  currencyCode: string;
  decimals: number;
  today: string;
  load: (when: ReportWhen) => Promise<ReportRunResult<CashForecastData>>;
}) {
  const [mode, setMode] = useState<ForecastMode>("due");
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const money = useCallback((minor: number) => formatMoney(minor, currencyCode, decimals), [currencyCode, decimals]);
  const compact = useCallback(
    (minor: number) =>
      new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(fromMinor(minor, decimals)),
    [decimals],
  );

  const sheet = useCallback(
    (data: CashForecastData): ReportExportSheet => {
      const forecast = mode === "due" ? data.due : data.usual;
      const amount = (minor: number) => fromMinor(minor, decimals);
      return {
        fileName: `13-week-cash-forecast-${forecast.today}`,
        companyName,
        title: "13 Week Cash Forecast",
        subtitle: `From ${forecast.today} · ${mode === "due" ? "By due date" : "As they usually pay"}`,
        currencyCode,
        columns: [
          { key: "week", header: "Week", kind: "text", width: 14 },
          { key: "range", header: "Dates", kind: "text", width: 24 },
          { key: "customers", header: "From customers", kind: "money", width: 16 },
          { key: "suppliers", header: "To suppliers", kind: "money", width: 16 },
          { key: "recurring", header: "Recurring", kind: "money", width: 16 },
          { key: "names", header: "Recurring templates", kind: "text", width: 40 },
          { key: "net", header: "Net", kind: "money", width: 16 },
          { key: "closing", header: "Cash at week end", kind: "money", width: 18 },
        ],
        rows: [
          ...forecast.weeks.map((week) => ({
            week: week.label,
            range: `${week.start} to ${week.end}`,
            customers: amount(week.fromCustomersMinor),
            suppliers: amount(week.toSuppliersMinor),
            recurring: amount(week.recurringMinor),
            names: week.recurringNames.map((n) => cutName(n)).join("; "),
            net: amount(week.netMinor),
            closing: amount(week.closingMinor),
          })),
          {
            week: "Over 13 weeks",
            range: "",
            customers: amount(total(forecast, (w) => w.fromCustomersMinor)),
            suppliers: amount(total(forecast, (w) => w.toSuppliersMinor)),
            recurring: amount(total(forecast, (w) => w.recurringMinor)),
            names: "",
            net: amount(total(forecast, (w) => w.netMinor)),
            closing: amount(forecast.closingMinor),
          },
        ],
      };
    },
    [mode, companyName, currencyCode, decimals],
  );

  return (
    <SimpleReport<CashForecastData>
      companyName={companyName}
      title="13 Week Cash Forecast"
      currencyCode={currencyCode}
      period={{ kind: "none", today, caption: `The thirteen weeks from ${longDate(today)}` }}
      load={load}
      sheet={sheet}
      runningText="Reading cash, open invoices and bills, and recurring templates…"
      filters={
        <Segmented<ForecastMode>
          aria-label="When open invoices and bills are expected to be settled"
          value={mode}
          onChange={setMode}
          options={MODE_OPTIONS}
        />
      }
      render={(data, _when, { printing }) => {
        const forecast = mode === "due" ? data.due : data.usual;
        const overdue = forecast.overdueInMinor > 0 || forecast.overdueOutMinor > 0;
        const below = forecast.closingMinor < 0;
        const grand = {
          customers: total(forecast, (w) => w.fromCustomersMinor),
          suppliers: total(forecast, (w) => w.toSuppliersMinor),
          recurring: total(forecast, (w) => w.recurringMinor),
          net: total(forecast, (w) => w.netMinor),
        };
        return (
          <>
            <StatRow
              items={[
                { label: "Cash today", value: money(forecast.openingMinor) },
                { label: "Due in", value: money(forecast.dueInMinor) },
                { label: "Due out", value: money(forecast.dueOutMinor) },
                { label: "In 13 weeks", value: money(forecast.closingMinor), danger: below },
                ...(forecast.lowest
                  ? [{ label: "Lowest point", value: `${money(forecast.lowest.minor)} · ${forecast.lowest.label}`, danger: forecast.lowest.minor < 0 }]
                  : []),
              ]}
            />

            {overdue ? (
              <div className={styles.note} role="note">
                <strong>Already past due and counted in week one:</strong> {money(forecast.overdueInMinor)} receivable and{" "}
                {money(forecast.overdueOutMinor)} payable. That makes week one the optimistic case.
              </div>
            ) : null}

            <ForecastChart forecast={forecast} formatCompact={compact} formatMoney={money} />

            <div className={paper.rptScroll}>
              <table className={paper.rpt} aria-label="Cash by week">
                <thead>
                  <tr>
                    <th className={paper.l}>Week</th>
                    <th>From customers</th>
                    <th>To suppliers</th>
                    <th style={{ minWidth: 150 }}>Recurring</th>
                    <th>Net</th>
                    <th>Cash at week end</th>
                  </tr>
                </thead>
                <tbody>
                  {forecast.weeks.map((week) => (
                    <tr key={week.index} className={week.closingMinor < 0 ? styles.warnRow : undefined}>
                      <td>
                        <strong>{week.label}</strong>
                        <span className={styles.weekRange}>
                          {monthDay(week.start)} – {monthDay(week.end)}
                        </span>
                      </td>
                      <td className={paper.r}>{money(week.fromCustomersMinor)}</td>
                      <td className={paper.r}>{money(week.toSuppliersMinor)}</td>
                      <td className={paper.r}>
                        {money(week.recurringMinor)}
                        {week.recurringNames.length > 0 ? (
                          <span className={styles.names}>{week.recurringNames.map((n) => cutName(n)).join(", ")}</span>
                        ) : null}
                      </td>
                      <td className={`${paper.r}${week.netMinor < 0 ? ` ${paper.negative}` : ""}`}>{money(week.netMinor)}</td>
                      <td className={`${paper.r}${week.closingMinor < 0 ? ` ${paper.negative}` : ""}`}>
                        <strong>{money(week.closingMinor)}</strong>
                      </td>
                    </tr>
                  ))}
                  <tr className={paper.rGrand}>
                    <td>Over 13 weeks</td>
                    <td className={paper.r}>{money(grand.customers)}</td>
                    <td className={paper.r}>{money(grand.suppliers)}</td>
                    <td className={paper.r}>{money(grand.recurring)}</td>
                    <td className={paper.r}>{money(grand.net)}</td>
                    <td className={paper.r}>{money(forecast.closingMinor)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {forecast.beyondHorizonInMinor > 0 || forecast.beyondHorizonOutMinor > 0 ? (
              <p className={paper.muted} style={{ marginTop: 10 }}>
                Beyond the thirteen weeks and not counted: {money(forecast.beyondHorizonInMinor)} from customers and{" "}
                {money(forecast.beyondHorizonOutMinor)} to suppliers.
              </p>
            ) : null}

            {forecast.templatesBehind > 0 ? (
              <p className={paper.muted} style={{ marginTop: 10 }}>
                {forecast.templatesBehind} recurring {forecast.templatesBehind === 1 ? "template is" : "templates are"} behind schedule: the
                next run date has passed, so the runs that were missed are not counted here.
              </p>
            ) : null}

            {forecast.foreignCurrencyTemplates > 0 ? (
              <p className={paper.muted} style={{ marginTop: 10 }}>
                {forecast.foreignCurrencyTemplates} recurring {forecast.foreignCurrencyTemplates === 1 ? "template names" : "templates name"} a
                currency other than {currencyCode} and {forecast.foreignCurrencyTemplates === 1 ? "is" : "are"} left out.
              </p>
            ) : null}

            {mode === "usual" ? <p className={paper.muted} style={{ marginTop: 10 }}>{describeForecastBasis(forecast)}</p> : null}

            <ReportFoot>
              <strong>Only what is already committed:</strong> issued invoices, received bills and recurring templates. Nothing is
              guessed about sales not yet made.{" "}
              {forecast.firstBelowZero ? (
                <>
                  Cash goes below zero in the week beginning {longDate(forecast.firstBelowZero.start)}, at {money(forecast.firstBelowZero.minor)}.
                </>
              ) : (
                <>Cash stays positive throughout.</>
              )}
            </ReportFoot>

            <h3 style={{ margin: "28px 0 8px", fontSize: 14 }}>Open items behind the forecast</h3>
            <DataTable<OpenItem>
              rowKey={(row) => `${row.side}:${row.documentId}`}
              dataSource={data.openItems}
              pagination={reportPagination(printing, pageSize, setPageSize, PAGE_SIZE)}
              emptyTitle="Nothing is open"
              emptyDescription="No invoice or bill is waiting to be settled."
              columns={[
                {
                  title: "Side",
                  dataIndex: "side",
                  width: COLUMN.STATUS + 16,
                  render: (side: string) => (
                    <Tag color={side === "receivable" ? "green" : "volcano"}>{side === "receivable" ? "Receivable" : "Payable"}</Tag>
                  ),
                },
                { title: "Num", dataIndex: "documentNumber", width: COLUMN.CODE, render: (n: string | null) => <span className={paper.mono}>{n ?? "—"}</span> },
                flexColumn<OpenItem>({ title: "Customer / vendor", dataIndex: "partyName" }),
                { title: "Due", dataIndex: "dueDate", width: COLUMN.DATE + 20, render: (d: string) => shortDate(d) },
                {
                  title: "Status",
                  key: "age",
                  width: COLUMN.STATUS + 16,
                  render: (_: unknown, row: OpenItem) => {
                    const age = outstandingAge({ issueDate: row.dueDate, dueDate: row.dueDate, asOf: data.today });
                    return age.isOverdue ? <span className={paper.negative}>{age.overdueDays} d overdue</span> : <span className={paper.muted}>Not yet due</span>;
                  },
                },
                {
                  title: "Balance",
                  dataIndex: "balanceMinor",
                  width: COLUMN.MONEY_WIDE,
                  align: "right",
                  render: (minor: number) => money(minor),
                },
              ]}
            />
          </>
        );
      }}
    />
  );
}
