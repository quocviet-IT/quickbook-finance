"use client";

import { sourceLabel } from "@/lib/domain/entry-detail";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  App,
  Alert,
  Space,
  Spin,
  Tag,
  Typography,
} from "antd";
import { ComparisonBars, chartColors } from "@/components/charts/FinancialCharts";
import { ReportBody } from "@/components/reports/ReportAudience";
import DataTable from "@/components/ui/DataTable";
import ReportBar from "@/components/reports/ReportBar";
import { fromMinor } from "@/lib/domain/money";
import { sanitizeExportFileName, type ReportExportSheet } from "@/lib/domain/report-export";
import { presetRange, type PeriodPreset, type PresetContext } from "@/lib/domain/report-presets";
import { formatDate, formatDateRange, formatMoney, plural } from "@/lib/format";
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

/** The statement as the screen shows it: section, line, how many journals back it, amount. */
function cashFlowSheet(
  report: CashFlowReport,
  range: ReportRange,
  companyName: string,
  currencyCode: string,
  decimals: number,
): ReportExportSheet {
  return {
    fileName: sanitizeExportFileName(`cash-flow-${range.from}-to-${range.to}`),
    companyName,
    title: "Statement of Cash Flows",
    subtitle: formatDateRange(range.from, range.to),
    currencyCode,
    columns: [
      { key: "section", header: "Section", kind: "text" },
      { key: "label", header: "Cash flow line", kind: "text" },
      { key: "evidence", header: "Evidence (journals)", kind: "number" },
      { key: "amount", header: "Amount", kind: "money" },
    ],
    rows: reportRows(report).map((row) => ({
      section: row.section,
      label: row.label,
      evidence: row.detailCount ?? null,
      amount: fromMinor(row.amount, decimals),
    })),
  };
}

export default function CashFlowClient({
  baseCurrency,
  baseDecimals,
  companyName,
  presets,
}: {
  baseCurrency: string;
  baseDecimals: number;
  /** Whose books these are. A statement that does not name its entity is one
   *  somebody will eventually file against the wrong company. */
  companyName: string;
  /** The fiscal year and today for the period presets. */
  presets: PresetContext;
}) {
  const { message } = App.useApp();
  const first = useMemo(() => presetRange("year", presets), [presets]);
  const [preset, setPreset] = useState<PeriodPreset>("year");
  const [range, setRange] = useState<ReportRange>({ from: first.from, to: first.to });
  const [reportRange, setReportRange] = useState<ReportRange | null>(null);
  const [report, setReport] = useState<CashFlowReport | null>(null);
  const [details, setDetails] = useState<Record<string, DetailState>>({});
  const [loading, setLoading] = useState(true);
  const fmt = (amount: number) => formatMoney(amount, baseCurrency, baseDecimals);

  const run = async (selected: ReportRange = range) => {
    if (selected.from > selected.to) {
      message.warning("The start date is after the end date.");
      return;
    }
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

  useEffect(() => {
    void run();
    // Runs once on arrival, for this year; afterwards a period or Run report does it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const choosePreset = (key: PeriodPreset) => {
    setPreset(key);
    if (key === "custom") return;
    const next = presetRange(key, presets);
    setRange(next);
    void run(next);
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
  const sheet = useMemo(
    () => (report && reportRange ? cashFlowSheet(report, reportRange, companyName, baseCurrency, baseDecimals) : null),
    [report, reportRange, companyName, baseCurrency, baseDecimals],
  );

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="large">
      <ReportBar
        dates={{
          kind: "range",
          preset,
          from: range.from,
          to: range.to,
          onPreset: choosePreset,
          onFrom: (from) => {
            setRange({ ...range, from });
            setPreset("custom");
          },
          onTo: (to) => {
            setRange({ ...range, to });
            setPreset("custom");
          },
        }}
        onRun={() => void run()}
        loading={loading}
        sheet={sheet}
        resultCount={report ? rows.length : undefined}
      />

      {report && (
        <div className="report-print-area">
        <Space direction="vertical" style={{ width: "100%" }} size="large">
          {/* The statement names its entity, and says which method produced
              it — both belong at the top of anything that gets filed. */}
          <div className="report-result__heading">
            <div className="report-result__entity">{companyName}</div>
            <Typography.Title level={4} style={{ margin: 0 }}>
              Statement of Cash Flows
            </Typography.Title>
            <Typography.Text type="secondary">
              Base currency {baseCurrency} · Indirect method · Accrual basis
            </Typography.Text>
          </div>
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
                ? `${fmt(report.openingMinor)} + CFO ${fmt(report.operating)} + CFI ${fmt(report.investing)} + CFF ${fmt(report.financing)} = ${fmt(report.balanceSheetCashMinor)}`
                : `Difference ${fmt(report.differenceMinor)} · ${plural(report.unclassifiedCount, "unclassified journal entry", "unclassified journal entries")}. Assign cash-flow roles and investigate before closing the period.`
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
                          { title: "Date", dataIndex: "entryDate", width: 110, render: (v: string) => formatDate(v) },
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
                            render: (value: string) => <Tag>{sourceLabel(value)}</Tag>,
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
                            render: (_, detail) => fmt(detail.amountMinor),
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
                      count ? <Tag>{plural(count, "journal")}</Tag> : "—",
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
                formatMoney={fmt}
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
        </Space>
        </div>
      )}
    </Space>
  );
}
