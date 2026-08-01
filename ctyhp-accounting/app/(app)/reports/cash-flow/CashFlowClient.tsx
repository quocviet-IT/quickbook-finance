"use client";

import { useState } from "react";
import Link from "next/link";
import {
  App,
  Alert,
  Button,
  DatePicker,
  Space,
  Spin,
  Tag,
  Typography,
} from "antd";
import type { Dayjs } from "dayjs";
import { ComparisonBars, chartColors } from "@/components/charts/FinancialCharts";
import { ReportBody } from "@/components/reports/ReportAudience";
import DataTable from "@/components/ui/DataTable";
import FilterBar from "@/components/ui/FilterBar";
import { fromMinor } from "@/lib/domain/money";
import { cashFlowAction, cashFlowDetailAction } from "./actions";
import type { CashFlowDetail, CashFlowReport } from "@/lib/services/cashflow";

type ReportRange = { from: string; to: string };
type DisplayRow = {
  key: string;
  kind: "line" | "total" | "meta" | "warning";
  section: string;
  label: string;
  amount: number;
  lineCode?: string;
  detailCount?: number;
};
type DetailState = {
  loading: boolean;
  rows: CashFlowDetail[];
  error?: string;
};

const SECTION_LABELS = {
  operating: "Operating",
  investing: "Investing",
  financing: "Financing",
  unclassified: "Review",
} as const;

function reportRows(report: CashFlowReport): DisplayRow[] {
  const rows: DisplayRow[] = [
    {
      key: "opening_cash",
      kind: "meta",
      section: "Cash",
      label: "Beginning cash",
      amount: report.openingMinor,
    },
  ];

  for (const section of ["operating", "investing", "financing"] as const) {
    for (const line of report.lines.filter((item) => item.section === section)) {
      rows.push({
        key: line.lineCode,
        kind: "line",
        section: SECTION_LABELS[section],
        label: line.label,
        amount: line.amountMinor,
        lineCode: line.lineCode,
        detailCount: line.detailCount,
      });
    }
    rows.push({
      key: `net_${section}`,
      kind: "total",
      section: SECTION_LABELS[section],
      label: `Net cash from ${section} activities`,
      amount: report[section],
    });
  }

  if (!report.classificationComplete) {
    const line = report.lines.find((item) => item.section === "unclassified");
    rows.push({
      key: "unclassified",
      kind: "warning",
      section: "Review",
      label: "Unclassified cash flow",
      amount: report.unclassifiedMinor,
      lineCode: "unclassified",
      detailCount: line?.detailCount ?? report.unclassifiedCount,
    });
  }

  rows.push(
    {
      key: "net_change",
      kind: "total",
      section: "Cash",
      label: "Net change in cash",
      amount: report.operating + report.investing + report.financing,
    },
    {
      key: "ending_statement",
      kind: "total",
      section: "Cash",
      label: "Ending cash per cash flow statement",
      amount: report.endingCashStatementMinor,
    },
    {
      key: "balance_sheet_cash",
      kind: "meta",
      section: "Cash",
      label: "Balance Sheet cash",
      amount: report.balanceSheetCashMinor,
    },
    {
      key: "difference",
      kind: report.differenceMinor === 0 ? "total" : "warning",
      section: "Control",
      label: "Reconciliation difference",
      amount: report.differenceMinor,
    },
  );
  return rows;
}

export default function CashFlowClient({
  baseCurrency,
  baseDecimals,
}: {
  baseCurrency: string;
  baseDecimals: number;
}) {
  const { message } = App.useApp();
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [reportRange, setReportRange] = useState<ReportRange | null>(null);
  const [report, setReport] = useState<CashFlowReport | null>(null);
  const [details, setDetails] = useState<Record<string, DetailState>>({});
  const [loading, setLoading] = useState(false);
  const fmt = (amount: number) =>
    fromMinor(amount, baseDecimals).toLocaleString(undefined, {
      minimumFractionDigits: baseDecimals,
      maximumFractionDigits: baseDecimals,
    });
  const fmtMoney = (amount: number) => `${fmt(amount)} ${baseCurrency}`;

  const run = async () => {
    if (!range) {
      message.warning("Pick a date range");
      return;
    }
    const selected = {
      from: range[0].format("YYYY-MM-DD"),
      to: range[1].format("YYYY-MM-DD"),
    };
    setLoading(true);
    try {
      const result = await cashFlowAction(selected);
      if (result.ok && result.data) {
        setReport(result.data);
        setReportRange(selected);
        setDetails({});
      } else {
        message.error(result.error ?? "Failed to run Cash Flow Statement");
      }
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : "Failed to run Cash Flow Statement",
      );
    } finally {
      setLoading(false);
    }
  };

  const loadDetails = async (lineCode: string) => {
    if (!reportRange || details[lineCode]) return;
    setDetails((current) => ({
      ...current,
      [lineCode]: { loading: true, rows: [] },
    }));
    try {
      const result = await cashFlowDetailAction({ ...reportRange, lineCode });
      setDetails((current) => ({
        ...current,
        [lineCode]: result.ok
          ? { loading: false, rows: result.data ?? [] }
          : { loading: false, rows: [], error: result.error ?? "Failed to load journal evidence" },
      }));
    } catch (error) {
      setDetails((current) => ({
        ...current,
        [lineCode]: {
          loading: false,
          rows: [],
          error: error instanceof Error ? error.message : "Failed to load journal evidence",
        },
      }));
    }
  };

  const rows = report ? reportRows(report) : [];

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="large">
      <FilterBar
        resultCount={report ? rows.length : undefined}
        ariaLabel="Cash Flow Statement filters"
        actions={
          <Button type="primary" loading={loading} onClick={run}>
            Run report
          </Button>
        }
      >
        <DatePicker.RangePicker
          value={range}
          onChange={(value) => setRange(value as [Dayjs, Dayjs] | null)}
        />
      </FilterBar>

      {report && (
        <>
          <Typography.Text type="secondary">
            Base currency {baseCurrency} · Indirect method · Accrual basis
          </Typography.Text>
          <Alert
            type={report.tiesOut ? "success" : "warning"}
            showIcon
            message={
              report.tiesOut
                ? "Cash Flow Statement reconciles to the Balance Sheet"
                : "Cash Flow Statement requires review"
            }
            description={
              report.tiesOut
                ? `${fmtMoney(report.openingMinor)} + CFO ${fmtMoney(report.operating)} + CFI ${fmtMoney(report.investing)} + CFF ${fmtMoney(report.financing)} = ${fmtMoney(report.balanceSheetCashMinor)}`
                : `Difference ${fmtMoney(report.differenceMinor)} · ${report.unclassifiedCount} unclassified journal entr${report.unclassifiedCount === 1 ? "y" : "ies"}. Assign cash-flow roles and investigate before closing the period.`
            }
          />
          <ReportBody
            numbers={
              <DataTable<DisplayRow>
                rowKey="key"
                pagination={false}
                dataSource={rows}
                emptyTitle="No cash activity"
                emptyDescription="No cash movements were found for this date range."
                rowClassName={(row) =>
                  row.kind === "warning"
                    ? "cash-flow-row--warning"
                    : row.kind === "total"
                      ? "cash-flow-row--total"
                      : ""
                }
                expandable={{
                  rowExpandable: (row) =>
                    row.kind !== "total" && Boolean(row.lineCode && row.detailCount),
                  onExpand: (expanded, row) => {
                    if (expanded && row.lineCode) void loadDetails(row.lineCode);
                  },
                  expandedRowRender: (row) => {
                    if (!row.lineCode) return null;
                    const state = details[row.lineCode];
                    if (!state || state.loading) return <Spin size="small" />;
                    if (state.error) return <Alert type="error" message={state.error} />;
                    return (
                      <DataTable<CashFlowDetail>
                        rowKey={(detail) => `${detail.journalEntryId}:${detail.accountId}`}
                        pagination={false}
                        dataSource={state.rows}
                        emptyTitle="No journal evidence"
                        columns={[
                          { title: "Date", dataIndex: "entryDate", width: 110 },
                          {
                            title: "Journal",
                            render: (_, detail) => (
                              <Link href={`/journal?entry=${detail.journalEntryId}`}>
                                {detail.entryNumber}
                              </Link>
                            ),
                          },
                          { title: "Description", dataIndex: "description" },
                          {
                            title: "Source",
                            dataIndex: "sourceType",
                            render: (value: string) => <Tag>{value.replaceAll("_", " ")}</Tag>,
                          },
                          {
                            title: "Account",
                            render: (_, detail) =>
                              `${detail.accountCode} — ${detail.accountName}`,
                          },
                          { title: "Classification basis", dataIndex: "classificationBasis" },
                          {
                            title: "Amount",
                            align: "right",
                            render: (_, detail) => fmtMoney(detail.amountMinor),
                          },
                        ]}
                      />
                    );
                  },
                }}
                columns={[
                  { title: "Section", dataIndex: "section", width: 120 },
                  {
                    title: "Cash flow line",
                    dataIndex: "label",
                    render: (label: string, row) =>
                      row.kind === "total" || row.kind === "warning" ? (
                        <Typography.Text strong>{label}</Typography.Text>
                      ) : (
                        label
                      ),
                  },
                  {
                    title: "Evidence",
                    dataIndex: "detailCount",
                    width: 100,
                    align: "right",
                    render: (count?: number) =>
                      count ? <Tag>{count.toLocaleString()} journal{count === 1 ? "" : "s"}</Tag> : "—",
                  },
                  {
                    title: `Amount (${baseCurrency})`,
                    align: "right",
                    render: (_, row) =>
                      row.kind === "total" || row.kind === "warning" ? (
                        <Typography.Text strong>{fmt(row.amount)}</Typography.Text>
                      ) : (
                        fmt(row.amount)
                      ),
                  },
                ]}
              />
            }
            chart={
              <ComparisonBars
                title="Cash movement by activity"
                description="Indirect operating cash flow plus investing and financing movements."
                formatMoney={fmtMoney}
                data={[
                  {
                    key: "operating",
                    label: "Operating activities",
                    value: report.operating,
                    color: chartColors.income,
                  },
                  {
                    key: "investing",
                    label: "Investing activities",
                    value: report.investing,
                    color: chartColors.payable,
                  },
                  {
                    key: "financing",
                    label: "Financing activities",
                    value: report.financing,
                    color: chartColors.expense,
                  },
                  {
                    key: "net",
                    label: "Net classified cash change",
                    value: report.operating + report.investing + report.financing,
                    color: report.differenceMinor === 0 ? chartColors.net : chartColors.negative,
                  },
                ]}
              />
            }
          />
        </>
      )}
    </Space>
  );
}
