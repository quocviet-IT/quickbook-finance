"use client";

import type { ReactNode } from "react";
import { App, Button, DatePicker, InputNumber, Select, Space } from "antd";
import { CopyOutlined, PrinterOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import FilterBar from "@/components/ui/FilterBar";
import ReportExportButtons from "@/components/reports/ReportExportButtons";
import { reportPaperStyles as styles } from "@/components/reports/ReportPaper";
import { downloadTextFile } from "@/lib/client/download";
import { printReport } from "@/lib/client/print-report";
import { csvFromExportSheet, tsvFromExportSheet, type ReportExportSheet } from "@/lib/domain/report-export";
import { PERIOD_PRESETS, type PeriodPreset } from "@/lib/domain/report-presets";

/**
 * The one report bar every report page uses.
 *
 * The UI review of 2026-10-17 found the report pages each built their own: a
 * run button called Run, Run report, Run review, Run statement or Apply; dates
 * picked from a preset and two labelled pickers on one page, a bare range that
 * opened empty on the next, an unlabelled single date on a third; and an export
 * set that was Copy, CSV, PDF, Excel and Print on some pages, CSV alone on
 * others, and nothing at all on Cash Flow, the statements and the General
 * Ledger.
 *
 * Left: the dates, the page's own filters, then Run report. Right: whatever the
 * page adds (Save, Manage budget), then Copy this report, CSV, PDF, Excel and
 * Print, always in that order, disabled until there is something to hand over.
 */

export const RUN_REPORT = "Run report";

/** How a report is dated. Every page picks one of these, so a date looks the same everywhere. */
export type ReportDates =
  | {
      /** A period: a preset, then From and To. */
      kind: "range";
      preset: PeriodPreset;
      from: string;
      to: string;
      onPreset: (preset: PeriodPreset) => void;
      onFrom: (date: string) => void;
      onTo: (date: string) => void;
      /** The From picker's own word, "Columns from" on a statement with a column per period. */
      fromLabel?: string;
      /** False when the To date alone matters, such as a Balance Sheet without columns. */
      showFrom?: boolean;
      /** "As of" on a statement struck at a date. */
      toLabel?: string;
    }
  | { kind: "asOf"; to: string; onTo: (date: string) => void }
  | { kind: "year"; label: string; year: number; onYear: (year: number) => void }
  | { kind: "none" };

const muted = (text: string) => <span className={styles.muted}>{text}</span>;

/** The date control for a report, in one of the four shapes. */
export function ReportDateControl({ dates }: { dates: ReportDates }) {
  switch (dates.kind) {
    case "range":
      return (
        <>
          <Select<PeriodPreset>
            aria-label="Period"
            value={dates.preset}
            onChange={dates.onPreset}
            options={PERIOD_PRESETS.map((p) => ({ value: p.key, label: p.label }))}
            style={{ width: 150 }}
          />
          {dates.showFrom === false ? null : (
            <DatePicker
              aria-label={dates.fromLabel ?? "From"}
              prefix={muted(dates.fromLabel ?? "From")}
              value={dates.from ? dayjs(dates.from) : null}
              allowClear={false}
              onChange={(d) => d && dates.onFrom(d.format("YYYY-MM-DD"))}
            />
          )}
          <DatePicker
            aria-label={dates.toLabel ?? "To"}
            prefix={muted(dates.toLabel ?? "To")}
            value={dayjs(dates.to)}
            allowClear={false}
            onChange={(d) => d && dates.onTo(d.format("YYYY-MM-DD"))}
          />
        </>
      );
    case "asOf":
      return (
        <DatePicker
          aria-label="As of"
          prefix={muted("As of")}
          value={dayjs(dates.to)}
          allowClear={false}
          onChange={(d) => d && dates.onTo(d.format("YYYY-MM-DD"))}
        />
      );
    case "year":
      return (
        <InputNumber
          aria-label={dates.label}
          prefix={muted(dates.label)}
          min={2000}
          max={2100}
          value={dates.year}
          onChange={(value) => dates.onYear(Number(value ?? dates.year))}
          style={{ width: dates.label.length > 3 ? 150 : 120 }}
        />
      );
    case "none":
      return null;
  }
}

/** The report's one run button: primary, and called the same thing on every page. */
export function RunReportButton({ onRun, loading, disabled }: { onRun: () => void; loading: boolean; disabled?: boolean }) {
  return (
    <Button type="primary" onClick={onRun} loading={loading} disabled={disabled}>
      {RUN_REPORT}
    </Button>
  );
}

/**
 * Copy this report, CSV, PDF, Excel and Print: what the screen shows, handed
 * over. All five are there before the report has run, disabled, so the bar
 * does not move when they come alive.
 */
export function ReportActions({
  sheet,
  loading,
  before,
}: {
  sheet: ReportExportSheet | null;
  loading: boolean;
  /** The page's own actions, which sit before the exports. */
  before?: ReactNode;
}) {
  const { message } = App.useApp();
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
  return (
    <Space wrap>
      {before}
      <Button icon={<CopyOutlined />} disabled={idle} onClick={() => void copy()}>
        Copy this report
      </Button>
      <Button disabled={idle} onClick={() => sheet && downloadTextFile(`${sheet.fileName}.csv`, csvFromExportSheet(sheet))}>
        CSV
      </Button>
      <ReportExportButtons sheet={sheet} disabled={loading} />
      <Button icon={<PrinterOutlined />} disabled={idle} onClick={printReport}>
        Print
      </Button>
    </Space>
  );
}

export interface ReportBarProps {
  dates: ReportDates;
  /** The page's own filters, between the dates and Run report. */
  filters?: ReactNode;
  onRun: () => void;
  loading: boolean;
  runDisabled?: boolean;
  /** What the exports hand over; null until the report has run. */
  sheet: ReportExportSheet | null;
  /** The page's own actions, before the exports. */
  actions?: ReactNode;
  /** Controls before the dates, such as which statement a page shows. */
  leading?: ReactNode;
  resultCount?: number;
  ariaLabel?: string;
}

/** The whole bar: dates, filters, Run report on the left; the page's actions and the exports on the right. */
export default function ReportBar(props: ReportBarProps) {
  return (
    <FilterBar
      ariaLabel={props.ariaLabel ?? "Report dates, filters and exports"}
      resultCount={props.resultCount}
      actions={<ReportActions sheet={props.sheet} loading={props.loading} before={props.actions} />}
    >
      {props.leading}
      <ReportDateControl dates={props.dates} />
      {props.filters}
      <RunReportButton onRun={props.onRun} loading={props.loading} disabled={props.runDisabled} />
    </FilterBar>
  );
}

/**
 * What the report area says before a report can run: what to choose, and
 * that Run report then shows it. For a report that needs a choice the page
 * cannot make for the reader, a customer, a vendor or an account, rather than
 * an empty page.
 */
export function ReportPrompt({ title, description }: { title: string; description: string }) {
  return (
    <div className={styles.prompt} role="status">
      <div className={styles.promptTitle}>{title}</div>
      <div className={styles.muted}>{description}</div>
    </div>
  );
}
