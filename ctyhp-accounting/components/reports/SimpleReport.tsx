"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Alert, App, Button, DatePicker, InputNumber, Select, Space, Spin } from "antd";
import { CopyOutlined, PrinterOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import FilterBar from "@/components/ui/FilterBar";
import ReportExportButtons from "@/components/reports/ReportExportButtons";
import { ReportPaper, reportPaperStyles as styles } from "@/components/reports/ReportPaper";
import { downloadTextFile } from "@/lib/client/download";
import { printReport, watchReportPrinting } from "@/lib/client/print-report";
import { csvFromExportSheet, tsvFromExportSheet, type ReportExportSheet } from "@/lib/domain/report-export";
import {
  PERIOD_PRESETS,
  longDate,
  presetRange,
  rangeText,
  type PeriodPreset,
  type PresetContext,
} from "@/lib/domain/report-presets";
import type { ReportRunResult, ReportWhen } from "@/lib/domain/report-run";

/** How a report is dated: as of a day, over a period, by fiscal year, or not at all. */
export type SimpleReportPeriod =
  | { kind: "asOf"; today: string }
  | { kind: "range"; ctx: PresetContext; preset: Exclude<PeriodPreset, "custom"> }
  | { kind: "fiscalYear"; current: number }
  | { kind: "none"; today: string; caption: string };

export interface SimpleReportProps<T> {
  companyName: string;
  /** The report's printed heading. */
  title: string;
  currencyCode: string;
  period: SimpleReportPeriod;
  /** The page's server action. */
  load: (when: ReportWhen) => Promise<ReportRunResult<T>>;
  /** What the screen shows of the data — the filters the page keeps for itself. */
  view?: (data: T) => T;
  /** What Copy, CSV, PDF and Excel hand over; built from the same view as the screen. */
  sheet: (data: T, when: ReportWhen) => ReportExportSheet;
  /** The report itself, on the paper. */
  render: (data: T, when: ReportWhen) => ReactNode;
  /** Filters of the page's own, beside the dates. */
  filters?: ReactNode;
  /** What the spinner says while the report is run. */
  runningText?: string;
}

function initialWhen(period: SimpleReportPeriod): ReportWhen {
  switch (period.kind) {
    case "asOf":
      return { from: null, to: period.today, fiscalYear: null };
    case "range": {
      const range = presetRange(period.preset, period.ctx);
      return { from: range.from, to: range.to, fiscalYear: null };
    }
    case "fiscalYear":
      return { from: null, to: "", fiscalYear: period.current };
    case "none":
      return { from: null, to: period.today, fiscalYear: null };
  }
}

function caption(period: SimpleReportPeriod, when: ReportWhen): string {
  switch (period.kind) {
    case "asOf":
      return `As of ${longDate(when.to)}`;
    case "range":
      return rangeText(when.from, when.to);
    case "fiscalYear":
      return `Fiscal year ${when.fiscalYear}`;
    case "none":
      return period.caption;
  }
}

/**
 * One report on paper, the way the client's prototype lays every report out:
 * the dates on the left of a bar, Run, then Copy, CSV, PDF, Excel and Print on
 * the right; under it the report on a sheet headed by the company, the
 * report's name and its dates. Runs once on arrival, then whenever a period is
 * chosen or Run is pressed. Every action hands over what the screen shows.
 */
export default function SimpleReport<T>(props: SimpleReportProps<T>) {
  const { message } = App.useApp();
  const { period, load, view, sheet: buildSheet } = props;
  const first = useMemo(() => initialWhen(period), [period]);

  const [preset, setPreset] = useState<PeriodPreset>(period.kind === "range" ? period.preset : "custom");
  const [draft, setDraft] = useState<ReportWhen>(first);
  const [ran, setRan] = useState<ReportWhen>(first);
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => watchReportPrinting(), []);

  const run = useCallback(
    async (when: ReportWhen) => {
      if (when.from && when.from > when.to) {
        setError("The start date is after the end date.");
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const result = await load(when);
        if (!result.ok || result.data === undefined) {
          setError(result.error ?? "The report could not be produced.");
          return;
        }
        setData(result.data);
        setRan(when);
      } catch {
        setError("The report could not be produced. Check the connection and run it again.");
      } finally {
        setLoading(false);
      }
    },
    [load],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void run(first);
    // Run once on arrival; afterwards a period choice or Run runs it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shown = useMemo(() => (data === null ? null : view ? view(data) : data), [data, view]);
  const sheet = useMemo(() => (shown === null ? null : buildSheet(shown, ran)), [shown, ran, buildSheet]);

  const choosePreset = (key: PeriodPreset) => {
    setPreset(key);
    if (key === "custom" || period.kind !== "range") return;
    const range = presetRange(key, period.ctx);
    const next = { from: range.from, to: range.to, fiscalYear: null };
    setDraft(next);
    void run(next);
  };

  const copy = async () => {
    if (!sheet) return;
    try {
      await navigator.clipboard.writeText(tsvFromExportSheet(sheet));
      message.success("Copied. Paste it into a spreadsheet and the columns stay.");
    } catch {
      message.error("The browser would not let this page copy. Use CSV instead.");
    }
  };

  const idle = !sheet || loading;
  const label = (text: string) => <span className={styles.muted}>{text}</span>;

  const paper = (
    <div className="report-print-area">
      <ReportPaper companyName={props.companyName} title={props.title} range={caption(period, ran)} currencyCode={props.currencyCode}>
        {shown !== null ? (
          props.render(shown, ran)
        ) : (
          <div style={{ textAlign: "center", padding: "48px 0" }}>
            {loading ? (
              <Space orientation="vertical" size={12}>
                <Spin size="large" />
                <span className={styles.muted}>{props.runningText ?? "Running the report…"}</span>
              </Space>
            ) : (
              <span className={styles.muted}>The report has not been run.</span>
            )}
          </div>
        )}
      </ReportPaper>
    </div>
  );

  return (
    <div>
      <FilterBar
        ariaLabel="Report dates, filters and exports"
        actions={
          <Space wrap>
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
        {period.kind === "range" ? (
          <>
            <Select<PeriodPreset>
              aria-label="Period"
              value={preset}
              onChange={choosePreset}
              options={PERIOD_PRESETS.map((p) => ({ value: p.key, label: p.label }))}
              style={{ width: 150 }}
            />
            <DatePicker
              aria-label="From"
              prefix={label("From")}
              value={draft.from ? dayjs(draft.from) : null}
              allowClear={false}
              onChange={(d) => {
                if (!d) return;
                setDraft({ ...draft, from: d.format("YYYY-MM-DD") });
                setPreset("custom");
              }}
            />
            <DatePicker
              aria-label="To"
              prefix={label("To")}
              value={dayjs(draft.to)}
              allowClear={false}
              onChange={(d) => {
                if (!d) return;
                setDraft({ ...draft, to: d.format("YYYY-MM-DD") });
                setPreset("custom");
              }}
            />
          </>
        ) : null}
        {period.kind === "asOf" ? (
          <DatePicker
            aria-label="As of"
            prefix={label("As of")}
            value={dayjs(draft.to)}
            allowClear={false}
            onChange={(d) => d && setDraft({ ...draft, to: d.format("YYYY-MM-DD") })}
          />
        ) : null}
        {period.kind === "fiscalYear" ? (
          <InputNumber
            aria-label="Fiscal year"
            prefix={label("FY")}
            min={2000}
            max={2100}
            value={draft.fiscalYear ?? period.current}
            onChange={(value) => setDraft({ ...draft, fiscalYear: Number(value ?? period.current) })}
            style={{ width: 120 }}
          />
        ) : null}
        {props.filters}
        <Button type="primary" onClick={() => void run(draft)} loading={loading}>
          Run
        </Button>
      </FilterBar>

      {error ? <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} /> : null}

      {shown !== null && loading ? (
        <Spin spinning description="Running the report again…">
          {paper}
        </Spin>
      ) : (
        paper
      )}
    </div>
  );
}
