"use client";

import { useCallback, useState } from "react";
import DataTable from "@/components/ui/DataTable";
import { flexColumn } from "@/components/ui/columns";
import { TOTALS_STYLE } from "@/components/reports/OpenDocumentsReport";
import ProofLine from "@/components/reports/ProofLine";
import { StatRow, reportPaperStyles as styles } from "@/components/reports/ReportPaper";
import SimpleReport, { reportPagination } from "@/components/reports/SimpleReport";
import { COLUMN } from "@/lib/design/table-metrics";
import { formatMoney } from "@/lib/format";
import { partyBalancesSheet, type PartyBalanceLine } from "@/lib/domain/open-items";
import type { ReportRunResult, ReportWhen } from "@/lib/domain/report-run";
import type { PartyBalancesResult } from "@/lib/services/party-reports";

const PAGE_SIZE = 50;

/**
 * Customer Balance Summary and Vendor Balance Summary: what each customer owes
 * (or each vendor is owed) on the as-of date, credits netted, then the total
 * and whether it agrees with the control account.
 */
export default function PartyBalancesReport({
  kind,
  companyName,
  currencyCode,
  decimals,
  today,
  load,
}: {
  kind: "customer" | "vendor";
  companyName: string;
  currencyCode: string;
  decimals: number;
  today: string;
  load: (when: ReportWhen) => Promise<ReportRunResult<PartyBalancesResult>>;
}) {
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const money = useCallback((minor: number) => formatMoney(minor, currencyCode, decimals), [currencyCode, decimals]);
  const customers = kind === "customer";
  const sheet = useCallback(
    (data: PartyBalancesResult, when: ReportWhen) =>
      partyBalancesSheet(data.report, kind, { companyName, asOf: when.to, currencyCode, baseDecimals: decimals }),
    [kind, companyName, currencyCode, decimals],
  );

  return (
    <SimpleReport<PartyBalancesResult>
      companyName={companyName}
      title={customers ? "Customer Balance Summary" : "Vendor Balance Summary"}
      currencyCode={currencyCode}
      period={{ kind: "asOf", today }}
      load={load}
      sheet={sheet}
      runningText="Reading the balances…"
      render={({ report, control }, _when, { printing }) => (
        <>
          <StatRow
            items={[
              { label: customers ? "Customers with a balance" : "Vendors with a balance", value: report.lines.length.toLocaleString("en-US") },
              { label: "Total", value: money(report.totalMinor) },
            ]}
          />
          <DataTable<PartyBalanceLine>
            rowKey="partyId"
            dataSource={report.lines}
            pagination={reportPagination(printing, pageSize, setPageSize, PAGE_SIZE)}
            emptyTitle={customers ? "No customer owes anything" : "Nothing is owed to any vendor"}
            emptyDescription="Every document dated by this day is settled."
            columns={[
              flexColumn<PartyBalanceLine>({ title: customers ? "Customer" : "Vendor", dataIndex: "partyName" }),
              {
                title: "Balance",
                dataIndex: "balanceMinor",
                width: COLUMN.MONEY_WIDE,
                align: "right",
                render: (minor: number) => <span className={minor < 0 ? styles.negative : undefined}>{money(minor)}</span>,
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
            against={customers ? "the A/R control account" : "the A/P control account"}
            tie={control}
            money={money}
            whenOut={
              customers
                ? "An entry posted straight to the receivables account, with no invoice, credit memo or payment behind it, moves the account but not these balances. The A/R Aging shows the same gap."
                : "An entry posted straight to the payables account, with no bill, vendor credit or payment behind it, moves the account but not these balances. The A/P Aging shows the same gap."
            }
          />
        </>
      )}
    />
  );
}
