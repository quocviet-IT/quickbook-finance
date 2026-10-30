"use client";
import { useCallback } from "react";
import { Alert, Space, Tag, Tooltip } from "antd";
import DataTable from "@/components/ui/DataTable";
import StatusTag from "@/components/ui/StatusTag";
import { flexColumn, secondaryLine } from "@/components/ui/columns";
import { COLUMN } from "@/lib/design/table-metrics";
import { ReportFoot, StatRow } from "@/components/reports/ReportPaper";
import SimpleReport from "@/components/reports/SimpleReport";
import { humanizeStatus } from "@/lib/domain/status-label";
import { review1099Sheet } from "@/lib/domain/ledger-report-sheets";
import type { ReportRunResult, ReportWhen } from "@/lib/domain/report-run";
import { formatMoney } from "@/lib/format";
import type { Report1099, Vendor1099Assessed } from "@/lib/services/vendorTax";
import { report1099Action } from "../../vendors/tax-actions";

/**
 * W-9, TIN, Box, Paid, Reportable, Exceptions. Vendor takes what is left, at
 * least COLUMN.TEXT_MIN, with the reporting name and classification under it.
 * As columns of their own, the two names had 192px between them at 1280.
 */
export const REPORT_1099_FIXED_WIDTHS = [
  COLUMN.STATUS,
  COLUMN.CODE,
  COLUMN.QTY,
  COLUMN.MONEY,
  COLUMN.QTY,
  COLUMN.STATUS,
] as const;

export default function Report1099Client({
  defaultYear,
  baseCurrency,
  baseDecimals,
  companyName,
}: {
  defaultYear: number;
  baseCurrency: string;
  baseDecimals: number;
  /** Whose books the exported file belongs to. */
  companyName: string;
}) {
  const money = useCallback((m: number) => formatMoney(m, baseCurrency, baseDecimals), [baseCurrency, baseDecimals]);
  const load = useCallback(
    (when: ReportWhen): Promise<ReportRunResult<Report1099>> => report1099Action({ year: when.fiscalYear }),
    [],
  );
  const sheet = useCallback(
    (rep: Report1099) => review1099Sheet(rep, { companyName, currencyCode: baseCurrency, baseDecimals }),
    [companyName, baseCurrency, baseDecimals],
  );

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Alert
        type="warning"
        showIcon
        message="Review data, not a filing"
        description="Have a qualified professional review it before filing. A vendor's box applies to all of its payments, so one paid for both services and goods is overstated. Backup withholding is not modeled."
      />

      <SimpleReport<Report1099>
        companyName={companyName}
        title="1099 Review"
        basis="Cash basis"
        currencyCode={baseCurrency}
        period={{ kind: "fiscalYear", current: defaultYear, label: "Tax year" }}
        load={load}
        sheet={sheet}
        runningText="Adding up the year's payments…"
        render={(rep) => (
          <>
            <StatRow
              items={[
                { label: "Vendors reportable", value: rep.reportableCount.toLocaleString("en-US") },
                { label: `Reportable total (${baseCurrency})`, value: money(rep.reportableTotalMinor) },
                { label: "Vendors with blockers", value: rep.blockerCount.toLocaleString("en-US"), danger: rep.blockerCount > 0 },
              ]}
            />

            <DataTable<Vendor1099Assessed>
              rowKey="vendor_id"
              rows={rep.rows}
              pagination={false}
              emptyTitle="No vendor was paid and none is marked eligible for this year"
              columns={[
                flexColumn<Vendor1099Assessed>({
                  title: "Vendor",
                  dataIndex: "vendor_name",
                  render: (_: unknown, r: Vendor1099Assessed) => {
                    // The name the form will carry, and how the vendor is
                    // classified: read against the vendor, not scanned down.
                    const reportsAs = [
                      r.reporting_name ? `Reports as ${r.reporting_name}` : "No reporting name",
                      r.classification ? humanizeStatus(r.classification) : null,
                    ]
                      .filter(Boolean)
                      .join(" · ");
                    return (
                      <>
                        <span title={r.vendor_name}>{r.vendor_name}</span>
                        {secondaryLine(reportsAs)}
                      </>
                    );
                  },
                }),
                {
                  title: "W-9",
                  dataIndex: "w9_status",
                  width: REPORT_1099_FIXED_WIDTHS[0],
                  render: (v: string) => <StatusTag status={v} />,
                },
                {
                  title: "TIN",
                  dataIndex: "tin_on_file",
                  width: REPORT_1099_FIXED_WIDTHS[1],
                  render: (v: boolean) => (v ? <StatusTag status="on_file" /> : <StatusTag status="missing" />),
                },
                {
                  title: "Box",
                  dataIndex: "box_code",
                  width: REPORT_1099_FIXED_WIDTHS[2],
                  render: (v: string | null, r) =>
                    v ? <Tooltip title={r.box_label ?? ""}>{v}</Tooltip> : "—",
                },
                {
                  title: `Paid (${baseCurrency})`,
                  dataIndex: "paid_minor",
                  width: REPORT_1099_FIXED_WIDTHS[3],
                  align: "right",
                  render: (v: number) => money(Number(v)),
                },
                {
                  title: "Reportable",
                  dataIndex: "reportable",
                  width: REPORT_1099_FIXED_WIDTHS[4],
                  render: (v: boolean) => (v ? <Tag color="blue">Yes</Tag> : <Tag>No</Tag>),
                },
                {
                  title: "Exceptions",
                  key: "exceptions",
                  width: REPORT_1099_FIXED_WIDTHS[5],
                  render: (_, r) =>
                    r.exceptions.length === 0 ? (
                      <Tag color="green">Clean</Tag>
                    ) : (
                      <Space direction="vertical" size={2}>
                        {r.exceptions.map((e) => (
                          <Tooltip key={e.code} title={e.message}>
                            <Tag color={e.severity === "blocker" ? "red" : "orange"}>{humanizeStatus(e.code)}</Tag>
                          </Tooltip>
                        ))}
                      </Space>
                    ),
                },
              ]}
            />

            <Alert
              style={{ marginTop: 16 }}
              type={rep.tiesOut ? "success" : "warning"}
              showIcon
              message={
                `Rows total ${money(rep.rowsTotalMinor)} vs payments recorded ${money(rep.controlTotalMinor)}` +
                (rep.tiesOut ? " ✓ reconciled" : " — does not reconcile, investigate")
              }
              description={
                rep.tiesOut
                  ? "Every payment made to a vendor in the year is represented in the rows above."
                  : "Some payment is not represented in the rows above; do not use this dataset until it reconciles."
              }
            />
            <ReportFoot>
              Cash basis — payments made between {rep.year}-01-01 and {rep.year}-12-31, in {baseCurrency}.
            </ReportFoot>
          </>
        )}
      />
    </Space>
  );
}
