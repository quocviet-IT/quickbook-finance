"use client";

import type { ReactNode } from "react";
import { App, Button, DatePicker, InputNumber, Select, Space, Switch, Tooltip } from "antd";
import { CopyOutlined, PrinterOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import FilterBar from "@/components/ui/FilterBar";
import { ReportAudienceToggle } from "@/components/reports/ReportAudience";
import ReportExportButtons from "@/components/reports/ReportExportButtons";
import { reportPaperStyles as styles } from "@/components/reports/ReportPaper";
import { downloadTextFile } from "@/lib/client/download";
import { printReport } from "@/lib/client/print-report";
import type { FiscalMonth } from "@/lib/domain/fiscal";
import type { InternalReportId } from "@/lib/domain/report-catalog";
import { csvFromExportSheet, tsvFromExportSheet, type ReportExportSheet } from "@/lib/domain/report-export";
import { PERIOD_PRESETS, type PeriodPreset } from "@/lib/domain/report-presets";
import { PERCENT_OF_INCOME_TOOLTIP } from "@/lib/domain/reports";
import { COMPARE_OPTIONS, type CompareMode } from "@/lib/domain/statement-columns";

export const REPORT_OPTIONS: { value: InternalReportId; label: string }[] = [
  { value: "pnl", label: "Profit and Loss" },
  { value: "balance", label: "Balance Sheet" },
  { value: "trial", label: "Trial Balance" },
  { value: "budget", label: "Budget vs Actual" },
  { value: "equity", label: "Statement of Equity" },
];

export type ToolbarDates =
  | {
      /** "point": the To date is As of, and From is Columns from (shown only for a column per period). */
      kind: "range" | "point";
      preset: PeriodPreset;
      from: string;
      to: string;
      showFrom: boolean;
      onPreset: (preset: PeriodPreset) => void;
      onFrom: (date: string) => void;
      onTo: (date: string) => void;
    }
  | {
      /** A budget is kept by fiscal month. */
      kind: "budget";
      fiscalYear: number;
      months: FiscalMonth[];
      fromPeriod: number;
      toPeriod: number;
      onFiscalYear: (year: number) => void;
      onFromPeriod: (period: number) => void;
      onToPeriod: (period: number) => void;
    };

export interface ReportToolbarProps {
  report: InternalReportId;
  onReportChange: (next: InternalReportId) => void;
  dates: ToolbarDates;
  compare: { value: CompareMode; onChange: (mode: CompareMode) => void } | null;
  percent: { value: boolean; onChange: (show: boolean) => void } | null;
  extraActions?: ReactNode;
  onRun: () => void;
  loading: boolean;
  /** What the actions hand over; null while there is nothing to hand over. */
  sheet: ReportExportSheet | null;
}

/**
 * The report toolbar of the client's prototype (`renderReports`): which
 * statement, the period, the dates, Compare, then the actions — Copy this
 * report, CSV, PDF, Excel, Print.
 */
export default function ReportToolbar(props: ReportToolbarProps) {
  const { message } = App.useApp();
  const { dates, sheet, loading } = props;
  const idle = !sheet || loading;

  const copy = async () => {
    if (!sheet) return;
    try {
      await navigator.clipboard.writeText(tsvFromExportSheet(sheet));
      message.success("Copied. Paste it into a spreadsheet and the columns stay.");
    } catch {
      message.error("The browser would not let this page copy. Use CSV instead.");
    }
  };

  const label = (text: string) => <span className={styles.muted}>{text}</span>;

  return (
    <FilterBar
      ariaLabel="Report options and actions"
      actions={
        <Space wrap>
          {props.extraActions}
          <Button icon={<CopyOutlined />} disabled={idle} onClick={() => void copy()}>
            Copy this report
          </Button>
          <Button disabled={idle} onClick={() => sheet && downloadTextFile(`${sheet.fileName}.csv`, csvFromExportSheet(sheet))}>
            CSV
          </Button>
          {sheet ? <ReportExportButtons sheet={sheet} disabled={loading} /> : null}
          <Button icon={<PrinterOutlined />} disabled={idle} onClick={printReport}>
            Print
          </Button>
        </Space>
      }
    >
      <ReportAudienceToggle />
      <Select<InternalReportId>
        aria-label="Report"
        value={props.report}
        onChange={props.onReportChange}
        options={REPORT_OPTIONS}
        style={{ width: 190 }}
      />
      {dates.kind === "budget" ? (
        <>
          <InputNumber
            aria-label="Fiscal year"
            prefix={label("FY")}
            min={2000}
            max={2100}
            value={dates.fiscalYear}
            onChange={(value) => dates.onFiscalYear(Number(value ?? dates.fiscalYear))}
            style={{ width: 120 }}
          />
          <Select<number>
            aria-label="Budget start period"
            value={dates.fromPeriod}
            onChange={dates.onFromPeriod}
            options={dates.months.map((m) => ({ value: m.period, label: `From ${m.label}` }))}
            style={{ width: 145 }}
          />
          <Select<number>
            aria-label="Budget end period"
            value={dates.toPeriod}
            onChange={dates.onToPeriod}
            options={dates.months.map((m) => ({ value: m.period, label: `To ${m.label}` }))}
            style={{ width: 135 }}
          />
        </>
      ) : (
        <>
          <Select<PeriodPreset>
            aria-label="Period"
            value={dates.preset}
            onChange={dates.onPreset}
            options={PERIOD_PRESETS.map((p) => ({ value: p.key, label: p.label }))}
            style={{ width: 150 }}
          />
          {dates.showFrom ? (
            <DatePicker
              aria-label={dates.kind === "point" ? "Columns from" : "From"}
              prefix={label(dates.kind === "point" ? "Columns from" : "From")}
              value={dayjs(dates.from)}
              allowClear={false}
              onChange={(d) => d && dates.onFrom(d.format("YYYY-MM-DD"))}
            />
          ) : null}
          <DatePicker
            aria-label={dates.kind === "point" ? "As of" : "To"}
            prefix={label(dates.kind === "point" ? "As of" : "To")}
            value={dayjs(dates.to)}
            allowClear={false}
            onChange={(d) => d && dates.onTo(d.format("YYYY-MM-DD"))}
          />
        </>
      )}
      {props.compare ? (
        <Select<CompareMode>
          aria-label="Compare"
          value={props.compare.value}
          onChange={props.compare.onChange}
          options={COMPARE_OPTIONS.map((o) => ({ value: o.key, label: o.label }))}
          style={{ width: 180 }}
        />
      ) : null}
      {props.percent ? (
        <Tooltip title={PERCENT_OF_INCOME_TOOLTIP}>
          <Space size={6}>
            <Switch size="small" checked={props.percent.value} onChange={props.percent.onChange} aria-label="Show % of income" />
            {label("% of income")}
          </Space>
        </Tooltip>
      ) : null}
      <Button type="primary" onClick={props.onRun} loading={loading}>
        Run
      </Button>
    </FilterBar>
  );
}
