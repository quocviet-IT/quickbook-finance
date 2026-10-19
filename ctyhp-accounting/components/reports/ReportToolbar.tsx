"use client";

import type { ReactNode } from "react";
import { InputNumber, Select, Space, Switch, Tooltip } from "antd";
import FilterBar from "@/components/ui/FilterBar";
import { ReportAudienceToggle } from "@/components/reports/ReportAudience";
import { REPORT_BAR_CLASS, ReportActions, ReportDateControl, RunReportButton } from "@/components/reports/ReportBar";
import { reportPaperStyles as styles } from "@/components/reports/ReportPaper";
import type { FiscalMonth } from "@/lib/domain/fiscal";
import type { InternalReportId } from "@/lib/domain/report-catalog";
import type { ReportExportSheet } from "@/lib/domain/report-export";
import type { PeriodPreset } from "@/lib/domain/report-presets";
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
  const { dates, sheet, loading } = props;
  const label = (text: string) => <span className={styles.muted}>{text}</span>;

  return (
    <FilterBar
      ariaLabel="Report options and actions"
      className={REPORT_BAR_CLASS}
      actions={<ReportActions sheet={sheet} loading={loading} before={props.extraActions} />}
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
        <ReportDateControl
          dates={{
            kind: "range",
            preset: dates.preset,
            from: dates.from,
            to: dates.to,
            onPreset: dates.onPreset,
            onFrom: dates.onFrom,
            onTo: dates.onTo,
            showFrom: dates.showFrom,
            fromLabel: dates.kind === "point" ? "Columns from" : "From",
            toLabel: dates.kind === "point" ? "As of" : "To",
          }}
        />
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
      <RunReportButton onRun={props.onRun} loading={loading} />
    </FilterBar>
  );
}
