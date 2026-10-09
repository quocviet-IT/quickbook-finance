"use client";

import { useCallback, useState } from "react";
import { Empty, Tag } from "antd";
import DataTable from "@/components/ui/DataTable";
import ReportTable, { SummaryCell, SummaryRow } from "@/components/ui/ReportTable";
import { flexColumn } from "@/components/ui/columns";
import { ReportFoot, StatRow, reportPaperStyles as styles } from "@/components/reports/ReportPaper";
import SimpleReport, { reportPagination } from "@/components/reports/SimpleReport";
import { COLUMN } from "@/lib/design/table-metrics";
import { formatMoney } from "@/lib/format";
import {
  NOTHING_BOUGHT_HINT,
  NOTHING_BOUGHT_TITLE,
  NOTHING_IN_PERIOD,
  purchasesInventorySheet,
  yearProofText,
  type MonthRow,
  type PurchaseYearRow,
  type PurchasesInventoryReport,
  type SupplierRow,
} from "@/lib/domain/purchases-inventory";
import type { PresetContext } from "@/lib/domain/report-presets";
import type { ReportRunResult, ReportWhen } from "@/lib/domain/report-run";

const PAGE_SIZE = 50;

const percent = (value: number | null) => (value === null ? "—" : `${value.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`);

/**
 * Purchases and Inventory: what was bought over the period, from whom and in
 * which months, and — over all the books — whether each year's stock adds up:
 * opening stock plus what was bought plus any count adjustment, less cost of
 * sales, is the closing stock.
 */
export default function PurchasesInventoryClient({
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
  load: (when: ReportWhen) => Promise<ReportRunResult<PurchasesInventoryReport>>;
}) {
  const [yearPageSize, setYearPageSize] = useState(PAGE_SIZE);
  const [supplierPageSize, setSupplierPageSize] = useState(PAGE_SIZE);
  const [monthPageSize, setMonthPageSize] = useState(PAGE_SIZE);
  const money = useCallback((minor: number) => formatMoney(minor, currencyCode, decimals), [currencyCode, decimals]);
  const sheet = useCallback(
    (report: PurchasesInventoryReport) => purchasesInventorySheet(report, { companyName, currencyCode, money }),
    [companyName, currencyCode, money],
  );
  const moneyCell = (minor: number) => <span className={minor < 0 ? styles.negative : undefined}>{money(minor)}</span>;

  return (
    <SimpleReport<PurchasesInventoryReport>
      companyName={companyName}
      title="Purchases and Inventory"
      currencyCode={currencyCode}
      period={{ kind: "range", ctx: presets, preset: "year" }}
      load={load}
      sheet={sheet}
      runningText="Adding up the purchases…"
      render={(report, _when, { printing }) => (
        <>
          <StatRow
            items={[
              { label: "Bought in this period", value: money(report.boughtMinor) },
              { label: "Purchases", value: report.purchases.toLocaleString("en-US") },
              { label: "Suppliers", value: report.suppliers.toLocaleString("en-US") },
              { label: "On the shelf at the To date", value: money(report.onShelfMinor) },
            ]}
          />

          {report.neverBought ? (
            <Empty description={<><strong>{NOTHING_BOUGHT_TITLE}</strong><div className={styles.muted}>{NOTHING_BOUGHT_HINT}</div></>} />
          ) : (
            <>
              <h3 className={styles.sectionTitle} style={{ margin: "16px 0 8px" }}>
                Year by year
              </h3>
              <DataTable<PurchaseYearRow>
                rowKey={(row) => String(row.fiscalYear)}
                dataSource={report.years}
                pagination={reportPagination(printing, yearPageSize, setYearPageSize, PAGE_SIZE)}
                emptyTitle="No years to show"
                emptyDescription="Nothing has been posted to cost of sales or inventory."
                columns={[
                  flexColumn<PurchaseYearRow>({ title: "Year", dataIndex: "label" }),
                  { title: "Opening stock", dataIndex: "openingMinor", width: COLUMN.MONEY_WIDE, align: "right", render: moneyCell },
                  { title: "Bought net of returns", dataIndex: "boughtMinor", width: COLUMN.MONEY_WIDE + 20, align: "right", render: moneyCell },
                  { title: "Count adjustment", dataIndex: "countAdjustmentMinor", width: COLUMN.MONEY_WIDE + 8, align: "right", render: moneyCell },
                  { title: "Cost of sales", dataIndex: "costOfSalesMinor", width: COLUMN.MONEY_WIDE, align: "right", render: moneyCell },
                  {
                    title: "Closing stock",
                    dataIndex: "closingMinor",
                    width: COLUMN.MONEY_WIDE + 60,
                    align: "right",
                    render: (minor: number, row: PurchaseYearRow) => (
                      <>
                        {row.offByMinor !== 0 ? (
                          <Tag color="red" style={{ marginInlineEnd: 6 }}>
                            off by {money(Math.abs(row.offByMinor))}
                          </Tag>
                        ) : null}
                        {moneyCell(minor)}
                      </>
                    ),
                  },
                ]}
              />
              <div className={styles.foot}>{yearProofText(report, money)}</div>

              <h3 className={styles.sectionTitle} style={{ margin: "24px 0 8px" }}>
                Who it was bought from
              </h3>
              <ReportTable<SupplierRow>
                rowKey={(row) => row.vendorId ?? "none"}
                dataSource={report.supplierRows}
                pagination={reportPagination(printing, supplierPageSize, setSupplierPageSize, PAGE_SIZE)}
                emptyTitle={NOTHING_IN_PERIOD}
                emptyDescription="Widen the dates."
                summary={() =>
                  report.supplierRows.length === 0 ? null : (
                    <SummaryRow>
                      <SummaryCell index={0}>
                        <b>Total</b>
                      </SummaryCell>
                      <SummaryCell index={1} align="right">
                        <b>{report.supplierTotal.purchases.toLocaleString("en-US")}</b>
                      </SummaryCell>
                      <SummaryCell index={2} align="right">
                        <b>{money(report.supplierTotal.amountMinor)}</b>
                      </SummaryCell>
                      <SummaryCell index={3} align="right">
                        <b>{report.supplierTotal.purchases === 0 ? "—" : "100%"}</b>
                      </SummaryCell>
                    </SummaryRow>
                  )
                }
                columns={[
                  flexColumn<SupplierRow>({
                    title: "Supplier",
                    key: "supplier",
                    render: (_: unknown, row: SupplierRow) => (row.vendorId ? row.name : <span className={styles.muted}>{row.name}</span>),
                  }),
                  { title: "Purchases", dataIndex: "purchases", width: COLUMN.QTY + 20, align: "right" },
                  { title: "Amount", dataIndex: "amountMinor", width: COLUMN.MONEY_WIDE, align: "right", render: moneyCell },
                  {
                    title: "Share",
                    dataIndex: "sharePercent",
                    width: COLUMN.QTY + 12,
                    align: "right",
                    render: (value: number | null) => <span className={styles.muted}>{percent(value)}</span>,
                  },
                ]}
              />

              {report.months.length > 0 ? (
                <>
                  <h3 className={styles.sectionTitle} style={{ margin: "24px 0 8px" }}>
                    Month by month
                  </h3>
                  <DataTable<MonthRow>
                    rowKey={(row) => row.month}
                    dataSource={report.months}
                    pagination={reportPagination(printing, monthPageSize, setMonthPageSize, PAGE_SIZE)}
                    columns={[
                      flexColumn<MonthRow>({ title: "Month", dataIndex: "label" }),
                      { title: "Bought", dataIndex: "amountMinor", width: COLUMN.MONEY_WIDE, align: "right", render: moneyCell },
                      {
                        title: "Share",
                        dataIndex: "sharePercent",
                        width: COLUMN.QTY + 12,
                        align: "right",
                        render: (value: number | null) => <span className={styles.muted}>{percent(value)}</span>,
                      },
                    ]}
                  />
                </>
              ) : null}
            </>
          )}

          <ReportFoot>
            <strong>How it counts.</strong> A purchase is a posting to a cost of sales account or an inventory account,
            in an entry that is neither an opening balance nor a stock count or adjustment; returns come off. Purchases
            counts entries, and an entry whose postings net to nothing, such as a sale in a perpetual book, is not one.
            Each year reads opening stock + bought + count adjustment − cost of sales = closing stock. The supplier is
            the one on the bill, expense, vendor credit, bill payment or goods receipt behind the entry; anything else
            is on the line {"“(No vendor)”"}. The year table covers every fiscal year in the books; the other figures
            cover the dates chosen.
          </ReportFoot>
        </>
      )}
    />
  );
}
