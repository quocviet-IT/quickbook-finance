"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { Alert, Space, Spin, type TablePaginationConfig } from "antd";
import ReportBar, { ReportPrompt, type ReportDates } from "@/components/reports/ReportBar";
import { ReportPaper, reportPaperStyles as styles } from "@/components/reports/ReportPaper";
import { clientTablePagination, pageSizeOptionsFor } from "@/components/ui/table-pagination";
import { watchReportPrinting } from "@/lib/client/print-report";
import type { ReportExportSheet } from "@/lib/domain/report-export";
import {
  presetRange,
  type PeriodPreset,
  type PresetContext,
} from "@/lib/domain/report-presets";
import type { ReportRunResult, ReportWhen } from "@/lib/domain/report-run";

import { formatDate, formatDateRange } from "@/lib/format";
/** How a report is dated: as of a day, over a period, by fiscal year, or not at all. */
export type SimpleReportPeriod =
  | { kind: "asOf"; today: string }
  | { kind: "range"; ctx: PresetContext; preset: Exclude<PeriodPreset, "custom"> }
  | { kind: "fiscalYear"; current: number; /** "FY" unless the year is another kind, such as "Tax year". */ label?: string }
  | { kind: "none"; today: string; caption: string };

/** What the page is being drawn for: the screen, or the printer. */
export interface ReportView {
  /** True while the browser prints: every row is drawn, not one page of them. */
  printing: boolean;
}

/**
 * A report table's pagination: one page at a time on screen, every row while
 * printing — a printed report whose proof line states a total its rows do not
 * reach is worse than no print at all. `pageSize` is the caller's state.
 */
export function reportPagination(
  printing: boolean,
  pageSize: number,
  setPageSize: (pageSize: number) => void,
  defaultSize: number,
): TablePaginationConfig | false {
  return printing ? false : clientTablePagination(pageSize, setPageSize, pageSizeOptionsFor(defaultSize));
}

export interface SimpleReportProps<T> {
  companyName: string;
  /** The report's printed heading. */
  title: string;
  currencyCode: string;
  period: SimpleReportPeriod;
  /** The page's server action. */
  load: (when: ReportWhen) => Promise<ReportRunResult<T>>;
  /** Told about each answer the screen shows — never about one a newer run overtook. */
  onLoaded?: (data: T) => void;
  /** What the screen shows of the data — the filters the page keeps for itself. */
  view?: (data: T) => T;
  /** What Copy, CSV, PDF and Excel hand over; built from the same view as the screen. */
  sheet: (data: T, when: ReportWhen) => ReportExportSheet;
  /** The report itself, on the paper. */
  render: (data: T, when: ReportWhen, view: ReportView) => ReactNode;
  /** Filters of the page's own, beside the dates. */
  filters?: ReactNode;
  /** What the spinner says while the report is run. */
  runningText?: string;
  /** Changing this runs the report again over the dates it last ran, for a page whose own action changed its figures. */
  refreshKey?: number;
  /** The page's own actions, before the exports: Save, Manage budget. */
  actions?: ReactNode;
  /**
   * Set while the report needs a choice the page cannot make for the reader
   * (a customer, a vendor, an account): the report waits, Run report is off,
   * and the paper says what to choose instead of standing empty. Clearing it
   * runs the report.
   */
  waitFor?: { title: string; description: string } | null;
  /** The basis printed under the title; "Accrual basis" unless the report keeps another, such as 1099 on cash. */
  basis?: string;
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
      return `As of ${formatDate(when.to)}`;
    case "range":
      return formatDateRange(when.from, when.to);
    case "fiscalYear":
      return `${period.label && period.label !== "FY" ? period.label : "Fiscal year"} ${when.fiscalYear}`;
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
  const { period, load, onLoaded, view, sheet: buildSheet } = props;
  const first = useMemo(() => initialWhen(period), [period]);

  const [preset, setPreset] = useState<PeriodPreset>(period.kind === "range" ? period.preset : "custom");
  const [draft, setDraft] = useState<ReportWhen>(first);
  const [ran, setRan] = useState<ReportWhen>(first);
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  /** Counts runs, so only the newest one's answer is shown. */
  const latestRun = useRef(0);

  useEffect(() => {
    const stop = watchReportPrinting();
    // Synchronous on purpose: the browser takes its print snapshot right after
    // `beforeprint`, so every row must be in the page by the time it returns.
    const before = () => flushSync(() => setPrinting(true));
    const after = () => setPrinting(false);
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
      stop();
    };
  }, []);

  const run = useCallback(
    async (when: ReportWhen) => {
      if (when.from && when.from > when.to) {
        setError("The start date is after the end date.");
        return;
      }
      const thisRun = ++latestRun.current;
      // A newer run has started: its answer, not this one, is what the reader asked for.
      const overtaken = () => thisRun !== latestRun.current;
      setLoading(true);
      setError(null);
      try {
        const result = await load(when);
        if (overtaken()) return;
        if (!result.ok || result.data === undefined) {
          setError(result.error ?? "The report could not be produced.");
          return;
        }
        setData(result.data);
        setRan(when);
        onLoaded?.(result.data);
      } catch {
        if (overtaken()) return;
        setError("The report could not be produced. Check the connection and run it again.");
      } finally {
        if (!overtaken()) setLoading(false);
      }
    },
    [load, onLoaded],
  );

  const waiting = props.waitFor ?? null;
  useEffect(() => {
    if (waiting) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(false);
      return;
    }
    void run(draft);
    // Run on arrival, and again when a missing choice is made; afterwards a
    // period choice or Run report runs it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting === null]);

  const refreshKey = props.refreshKey;
  const lastRefresh = useRef(refreshKey);
  useEffect(() => {
    if (lastRefresh.current === refreshKey) return;
    lastRefresh.current = refreshKey;
    void run(ran);
    // Only a new key runs it again, over the dates last run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

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


  const paper = (
    <div className="report-print-area">
      <ReportPaper
        companyName={props.companyName}
        title={props.title}
        range={caption(period, ran)}
        currencyCode={props.currencyCode}
        basis={props.basis}
      >
        {waiting && shown === null ? (
          <ReportPrompt title={waiting.title} description={waiting.description} />
        ) : shown !== null ? (
          props.render(shown, ran, { printing })
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

  const dates: ReportDates =
    period.kind === "range"
      ? {
          kind: "range",
          preset,
          from: draft.from ?? draft.to,
          to: draft.to,
          onPreset: choosePreset,
          onFrom: (from) => {
            setDraft({ ...draft, from });
            setPreset("custom");
          },
          onTo: (to) => {
            setDraft({ ...draft, to });
            setPreset("custom");
          },
        }
      : period.kind === "asOf"
        ? { kind: "asOf", to: draft.to, onTo: (to) => setDraft({ ...draft, to }) }
        : period.kind === "fiscalYear"
          ? {
              kind: "year",
              label: period.label ?? "FY",
              year: draft.fiscalYear ?? period.current,
              onYear: (fiscalYear) => setDraft({ ...draft, fiscalYear }),
            }
          : { kind: "none" };

  return (
    <div>
      <ReportBar
        dates={dates}
        filters={props.filters}
        actions={props.actions}
        onRun={() => void run(draft)}
        loading={loading}
        runDisabled={waiting !== null}
        sheet={sheet}
      />

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
