"use client";

import { useCallback, useState } from "react";
import DataTable from "@/components/ui/DataTable";
import { flexColumn } from "@/components/ui/columns";
import { clientTablePagination, pageSizeOptionsFor } from "@/components/ui/table-pagination";
import { TOTALS_STYLE } from "@/components/reports/OpenDocumentsReport";
import ProofLine from "@/components/reports/ProofLine";
import { ReportFoot, StatRow, reportPaperStyles as styles } from "@/components/reports/ReportPaper";
import SimpleReport from "@/components/reports/SimpleReport";
import { COLUMN } from "@/lib/design/table-metrics";
import { formatMoney } from "@/lib/format";
import { partyActivitySheet, type PartyActivityLine } from "@/lib/domain/party-activity";
import type { PresetContext } from "@/lib/domain/report-presets";
import type { ReportRunResult, ReportWhen } from "@/lib/domain/report-run";
import type { PartyActivityResult } from "@/lib/services/party-reports";

const PAGE_SIZE = 50;

const percent = (value: number | null) => (value === null ? "—" : `${value.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`);

/**
 * Sales by Customer Summary and Expenses by Vendor Summary: the period's income
 * (or spending) by who it was with, largest first, with the lines no customer
 * or vendor document stands behind on a row of their own — so the total is the
 * Profit and Loss's, and the proof line says so.
 */
export default function PartyActivityReport({
  kind,
  companyName,
  currencyCode,
  decimals,
  presets,
  load,
}: {
  kind: "sales" | "expenses";
  companyName: string;
  currencyCode: string;
  decimals: number;
  presets: PresetContext;
  load: (when: ReportWhen) => Promise<ReportRunResult<PartyActivityResult>>;
}) {
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const money = useCallback((minor: number) => formatMoney(minor, currencyCode, decimals), [currencyCode, decimals]);
  const sales = kind === "sales";
  const sheet = useCallback(
    (data: PartyActivityResult, when: ReportWhen) =>
      partyActivitySheet(data.report, kind, { companyName, from: when.from ?? when.to, to: when.to, currencyCode, baseDecimals: decimals }),
    [kind, companyName, currencyCode, decimals],
  );

  return (
    <SimpleReport<PartyActivityResult>
      companyName={companyName}
      title={sales ? "Sales by Customer Summary" : "Expenses by Vendor Summary"}
      currencyCode={currencyCode}
      period={{ kind: "range", ctx: presets, preset: "year" }}
      load={load}
      sheet={sheet}
      runningText={sales ? "Adding up the sales…" : "Adding up the spending…"}
      render={({ report, proof }) => (
        <>
          <StatRow
            items={[
              {
                label: sales ? "Customers" : "Vendors",
                value: report.lines.filter((line) => line.partyId !== null).length.toLocaleString("en-US"),
              },
              { label: sales ? "Sales" : "Spending", value: money(report.totalMinor) },
            ]}
          />
          <DataTable<PartyActivityLine>
            rowKey={(line) => line.partyId ?? "none"}
            dataSource={report.lines}
            pagination={clientTablePagination(pageSize, setPageSize, pageSizeOptionsFor(PAGE_SIZE))}
            emptyTitle={sales ? "No sales in this period" : "No spending in this period"}
            emptyDescription="Widen the dates."
            columns={[
              flexColumn<PartyActivityLine>({
                title: sales ? "Customer" : "Vendor",
                key: "party",
                render: (_: unknown, line: PartyActivityLine) =>
                  line.partyId ? line.partyName : <span className={styles.muted}>{line.partyName}</span>,
              }),
              {
                title: sales ? "Documents" : "Entries",
                key: "count",
                width: COLUMN.QTY + 20,
                align: "right",
                // Postings with no customer have no invoice to count: a dash, not a zero.
                render: (_: unknown, line: PartyActivityLine) => (sales && line.partyId === null ? "—" : line.count),
              },
              {
                title: "Total",
                dataIndex: "totalMinor",
                width: COLUMN.MONEY_WIDE,
                align: "right",
                render: (minor: number) => <span className={minor < 0 ? styles.negative : undefined}>{money(minor)}</span>,
              },
              {
                title: sales ? "% of sales" : "% of spend",
                dataIndex: "percent",
                width: COLUMN.QTY + 12,
                align: "right",
                render: (value: number | null) => <span className={styles.muted}>{percent(value)}</span>,
              },
            ]}
          />
          <table className={styles.rpt} style={TOTALS_STYLE} aria-label="Total">
            <tbody>
              <tr className={styles.rGrand}>
                <td>Total</td>
                <td className={styles.r}>{money(report.totalMinor)}</td>
              </tr>
            </tbody>
          </table>
          <ProofLine
            against={sales ? "Income on the Profit and Loss" : "cost of sales and expenses on the Profit and Loss"}
            tie={proof}
            money={money}
            whenOut="Run the Profit and Loss for the same dates; the two read the same posted entries, so a gap is a fault in this report. Please report it."
          />
          <ReportFoot>
            {sales ? (
              <>
                <strong>How it counts.</strong> Every posting to an income account in the period, in base currency, so
                sales tax is never in it. A posting from an invoice, credit memo or customer payment counts for that
                customer; Documents counts their invoices. Postings from anything else — a bank deposit coded to income,
                a journal entry — are on the line &quot;(No customer)&quot;.
              </>
            ) : (
              <>
                <strong>How it counts.</strong> Every posting to a cost of sales, expense or other expense account in the
                period, in base currency. A posting from a bill, expense, vendor credit or bill payment counts for that
                vendor; Entries counts each entry once per account it touches. Postings from anything else — bank lines
                coded to an expense, journal entries, depreciation — are on the line &quot;(No vendor)&quot;.
              </>
            )}
          </ReportFoot>
        </>
      )}
    />
  );
}
