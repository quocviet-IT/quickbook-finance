"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert, App, Button, Spin } from "antd";
import { EditOutlined } from "@ant-design/icons";
import { ComparisonBars, chartColors, type ComparisonBarDatum } from "@/components/charts/FinancialCharts";
import BudgetEditorDrawer from "@/components/reports/BudgetEditorDrawer";
import { ReportBody } from "@/components/reports/ReportAudience";
import { ReportFoot, ReportPaper, StatRow, reportPaperStyles as styles, type StatItem } from "@/components/reports/ReportPaper";
import ReportToolbar from "@/components/reports/ReportToolbar";
import StatementTable from "@/components/reports/StatementTable";
import ZoomSheet from "@/components/reports/ZoomSheet";
import { watchReportPrinting } from "@/lib/client/print-report";
import { formatMoney } from "@/lib/format";
import { dayBefore, fiscalMonths, fiscalYearForDate } from "@/lib/domain/fiscal";
import type { InternalReportId } from "@/lib/domain/report-catalog";
import { longDate, presetRange, rangeText, type PeriodPreset } from "@/lib/domain/report-presets";
import {
  buildBalanceSheet,
  buildProfitAndLoss,
  buildTrialBalance,
  netIncomeOf,
  sumProfitAndLoss,
  type BalanceSheet,
  type LedgerBalance,
  type ProfitAndLoss,
} from "@/lib/domain/reports";
import {
  balanceSheetStatement,
  budgetStatement,
  equityStatement,
  indexAccounts,
  pnlStatement,
  statementSheet,
  trialBalanceStatement,
  type AccountRef,
  type Statement,
  type StatementColumn,
  type ZoomSpec,
} from "@/lib/domain/statement";
import { fiscalYearStartOf, pointColumns, rangeColumns, type CompareMode } from "@/lib/domain/statement-columns";
import { getBudgetVsActualAction, getLedgerBalancesAction, getStatementOfEquityAction } from "./actions";

interface ReportsClientProps {
  initialReportType: InternalReportId;
  baseCurrency: string;
  baseDecimals: number;
  companyName: string;
  fiscalStartMonth: number;
  canManageBudget: boolean;
  /** The chart, for nesting accounts under their parent and for what a total opens. */
  accounts: AccountRef[];
  today: string;
  /** The first and last posted entry, for "All dates" and "Last 3 years". */
  firstEntryDate: string | null;
  lastEntryDate: string | null;
}

const TITLES: Record<InternalReportId, string> = {
  pnl: "Profit and Loss",
  balance: "Balance Sheet",
  trial: "Trial Balance",
  budget: "Budget vs Actual",
  equity: "Statement of Equity",
};

interface ChartSpec {
  title: string;
  description: string;
  data: ComparisonBarDatum[];
}

/** The Management view's chart for a Profit and Loss: as before, income and net per column, or net alone across many. */
function pnlChart(columns: readonly StatementColumn[], pnls: readonly ProfitAndLoss[]): ChartSpec {
  const shown = columns.map((c, i) => ({ c, p: pnls[i] })).filter(({ c }) => !c.isTotal);
  const net = (p: ProfitAndLoss) => (p.netIncome < 0 ? chartColors.negative : chartColors.net);
  if (shown.length <= 2) {
    return {
      title: "Period performance",
      description: "Income and net income for each column shown.",
      data: shown.flatMap(({ c, p }) => [
        { key: `${c.key}-income`, label: `${c.label} income`, value: p.income.total + p.otherIncome.total, color: chartColors.income },
        { key: `${c.key}-net`, label: `${c.label} net income`, value: p.netIncome, color: net(p) },
      ]),
    };
  }
  return {
    title: "Net income by period",
    description: "Net income for each column shown, oldest to newest.",
    data: shown.map(({ c, p }) => ({ key: c.key, label: c.label, value: p.netIncome, color: net(p) })),
  };
}

/** The Management view's chart for a Balance Sheet. */
function balanceChart(columns: readonly StatementColumn[], sheets: readonly BalanceSheet[]): ChartSpec {
  if (columns.length <= 2) {
    return {
      title: "Financial position",
      description: "Assets, liabilities and equity for each column shown.",
      data: columns.flatMap((c, i) => [
        { key: `${c.key}-assets`, label: `${c.label} assets`, value: sheets[i].totalAssets, color: chartColors.receivable },
        { key: `${c.key}-liabilities`, label: `${c.label} liabilities`, value: sheets[i].totalLiabilities, color: chartColors.expense },
        { key: `${c.key}-equity`, label: `${c.label} equity`, value: sheets[i].totalEquity, color: chartColors.net },
      ]),
    };
  }
  return {
    title: "Total assets over the periods shown",
    description: "Each bar is the balance sheet total for that date.",
    data: columns.map((c, i) => ({ key: c.key, label: c.label, value: sheets[i].totalAssets, color: chartColors.receivable })),
  };
}

/**
 * The five financial statements, laid out as the client's prototype lays a
 * statement out (`renderReports`, `reportPL`, `reportBS`, `reportTB`,
 * `reportBudget`): the toolbar, the report on paper, the statement, and a
 * footer saying every figure opens onto the entries behind it.
 *
 * Every figure comes from the builders in lib/domain/reports.ts, from the same
 * reads as before; lib/domain/statement.ts only arranges them.
 */
export default function ReportsClient({
  initialReportType: type,
  baseCurrency,
  baseDecimals,
  companyName,
  fiscalStartMonth,
  canManageBudget,
  accounts,
  today,
  firstEntryDate,
  lastEntryDate,
}: ReportsClientProps) {
  const { message } = App.useApp();
  const router = useRouter();
  const point = type === "balance" || type === "trial";
  const index = useMemo(() => indexAccounts(accounts), [accounts]);
  const presetContext = useMemo(
    () => ({ today, fiscalStartMonth, firstEntryDate, lastEntryDate }),
    [today, fiscalStartMonth, firstEntryDate, lastEntryDate],
  );
  const initialRange = useMemo(() => presetRange("year", presetContext), [presetContext]);

  const [preset, setPreset] = useState<PeriodPreset>("year");
  const [from, setFrom] = useState(initialRange.from);
  const [to, setTo] = useState(initialRange.to);
  // What each statement opens with. The P&L sits beside the same dates a year
  // earlier: it opens on the year to date, and the "previous period" of Jan 1 –
  // Sep 28 is the same number of days before it (Apr 5 – Dec 31), which nobody
  // reads a year to date against. The Balance Sheet sits beside the previous
  // month end; the Trial Balance stands on its own.
  const [compare, setCompare] = useState<CompareMode>(
    type === "pnl" ? "year" : type === "balance" ? "prev" : "none",
  );
  // % of income is on for one or two columns and off for a column per period —
  // until the reader flips it; from then on it is theirs (as `nextShowPercentOfIncome` has it).
  const [showPercent, setShowPercent] = useState(true);
  const [percentTouched, setPercentTouched] = useState(false);
  const changeCompare = (mode: CompareMode) => {
    setCompare(mode);
    if (!percentTouched) setShowPercent(mode === "none" || mode === "prev" || mode === "year");
  };

  const initialFiscalYear = fiscalYearForDate(today, fiscalStartMonth);
  const [fiscalYear, setFiscalYear] = useState(initialFiscalYear);
  const months = useMemo(() => fiscalMonths(fiscalYear, fiscalStartMonth), [fiscalYear, fiscalStartMonth]);
  const [budgetFromPeriod, setBudgetFromPeriod] = useState(1);
  const [budgetToPeriod, setBudgetToPeriod] = useState(() => {
    const current = fiscalMonths(initialFiscalYear, fiscalStartMonth).findIndex((m) => today >= m.start && today <= m.end);
    return current === -1 ? 12 : current + 1;
  });
  const [budgetEditorOpen, setBudgetEditorOpen] = useState(false);

  const [statement, setStatement] = useState<Statement | null>(null);
  // What a Profit and Loss read produced, kept apart from the Statement built from
  // it: flipping "% of income" only rebuilds this into a Statement (see the
  // pnlShown memo below); it never triggers another read of the books.
  const [pnlData, setPnlData] = useState<{
    columns: readonly StatementColumn[];
    pnls: readonly ProfitAndLoss[];
    change: boolean;
  } | null>(null);
  const [chart, setChart] = useState<ChartSpec | null>(null);
  const [stats, setStats] = useState<StatItem[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [ran, setRan] = useState(initialRange);
  const [loading, setLoading] = useState(true);
  const [zoom, setZoom] = useState<ZoomSpec | null>(null);
  // A run-generation guard: a slower, older read that finishes after a newer one
  // has already started must not call show/refuse/message.error and replace the
  // statement, or the reader's later request, with the earlier one's result.
  const latestRun = useRef(0);

  const money = useCallback((minor: number) => formatMoney(minor, baseCurrency, baseDecimals), [baseCurrency, baseDecimals]);

  const run = useCallback(async () => {
    const id = ++latestRun.current;
    const current = () => id === latestRun.current;
    const read = async (f: string | null, t: string): Promise<LedgerBalance[]> => {
      const result = await getLedgerBalancesAction(f, t);
      if (!result.ok || !result.data) throw new Error(result.error ?? "The ledger could not be read.");
      return result.data;
    };
    const show = (next: Statement, nextChart: ChartSpec | null, nextStats: StatItem[] | null, range: { from: string; to: string }) => {
      if (!current()) return;
      setStatement(next);
      setChart(nextChart);
      setStats(nextStats);
      setRan(range);
      setNotice(null);
    };
    const refuse = (text: string) => {
      if (!current()) return;
      setNotice(text);
      setStatement(null);
      setPnlData(null);
      setChart(null);
      setStats(null);
    };

    setLoading(true);
    try {
      if (type === "budget") {
        if (budgetFromPeriod > budgetToPeriod) return refuse("The first budget period is after the last.");
        const bFrom = months[budgetFromPeriod - 1].start;
        const bTo = months[budgetToPeriod - 1].end;
        const result = await getBudgetVsActualAction(fiscalYear, bFrom, bTo);
        if (!result.ok || !result.data) throw new Error(result.error ?? "Budget vs Actual could not be read.");
        const bva = result.data;
        const actualIncome = bva.actual.income.total + bva.actual.otherIncome.total;
        const budgetIncome = bva.budget.income.total + bva.budget.otherIncome.total;
        const actualExpenses = bva.actual.costOfGoodsSold.total + bva.actual.operatingExpenses.total + bva.actual.otherExpenses.total;
        const netVariance = bva.actual.netIncome - bva.budget.netIncome;
        show(
          budgetStatement({ bva, from: bFrom, to: bTo, accounts: index }),
          null,
          [
            { label: "Actual income", value: money(actualIncome) },
            { label: "Budget income", value: money(budgetIncome) },
            { label: "Actual expenses", value: money(actualExpenses) },
            { label: "Net income variance", value: money(netVariance), danger: netVariance < 0 },
          ],
          { from: bFrom, to: bTo },
        );
        return;
      }

      if (type === "equity") {
        if (from > to) return refuse("The start date is after the end date.");
        const result = await getStatementOfEquityAction(from, to);
        if (!result.ok || !result.data) throw new Error(result.error ?? "The Statement of Equity could not be read.");
        const soe = result.data;
        show(
          equityStatement({ soe, from, to, accounts: index }),
          {
            title: "Equity movement",
            description: "Beginning equity plus direct equity activity and net income equals ending equity.",
            data: [
              { key: "opening", label: "Beginning equity", value: soe.openingEquity, color: chartColors.neutral },
              { key: "activity", label: "Direct equity activity", value: soe.equityActivity, color: chartColors.payable },
              { key: "income", label: "Net income", value: soe.netIncome, color: soe.netIncome < 0 ? chartColors.negative : chartColors.income },
              { key: "closing", label: "Ending equity", value: soe.closingEquity, color: chartColors.net },
            ],
          },
          null,
          { from, to },
        );
        return;
      }

      if (type === "pnl") {
        const plan = rangeColumns(compare, from, to, fiscalStartMonth);
        if (!plan.ok) return refuse(plan.message);
        const detail = plan.columns.filter((c) => !c.isTotal);
        const detailPnls = (await Promise.all(detail.map((c) => read(c.from, c.to)))).map(buildProfitAndLoss);
        const pnls = plan.columns.map((c) => (c.isTotal ? sumProfitAndLoss(detailPnls) : detailPnls[detail.indexOf(c)]));
        if (!current()) return;
        // The Statement itself is built by the pnlShown memo below, from this plus
        // showPercent: toggling "% of income" must not read the books again.
        setPnlData({ columns: plan.columns, pnls, change: plan.change });
        setChart(pnlChart(plan.columns, pnls));
        setStats(null);
        setRan({ from, to });
        setNotice(null);
        return;
      }

      // The Balance Sheet and the Trial Balance: columns are dates.
      const plan = pointColumns(compare, to, from, fiscalStartMonth);
      if (!plan.ok) return refuse(plan.message);
      const balances = await Promise.all(plan.columns.map((c) => read(null, c.to)));
      if (type === "trial") {
        show(trialBalanceStatement({ columns: plan.columns, tbs: balances.map(buildTrialBalance), accounts: index }), null, null, { from, to });
        return;
      }
      const fiscalYearStarts = plan.columns.map((c) => fiscalYearStartOf(c.to, fiscalStartMonth));
      // Twelve month-end columns share one fiscal year: read each year's earlier profit once.
      const starts = [...new Set(fiscalYearStarts)];
      const earlier = new Map(
        await Promise.all(starts.map(async (start) => [start, netIncomeOf(await read(null, dayBefore(start)))] as const)),
      );
      const sheets = balances.map(buildBalanceSheet);
      show(
        balanceSheetStatement({
          columns: plan.columns,
          sheets,
          priorEarnings: fiscalYearStarts.map((start) => earlier.get(start) ?? 0),
          fiscalYearStarts,
          accounts: index,
          change: plan.change,
        }),
        balanceChart(plan.columns, sheets),
        null,
        { from, to },
      );
    } catch (error) {
      if (current()) message.error(error instanceof Error ? error.message : "The report could not be produced.");
    } finally {
      if (current()) setLoading(false);
    }
  }, [
    type,
    from,
    to,
    compare,
    fiscalYear,
    budgetFromPeriod,
    budgetToPeriod,
    months,
    index,
    fiscalStartMonth,
    money,
    message,
  ]);

  useEffect(() => {
    // Data-synchronization effect: a change of period or comparison reads the books again.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void run();
  }, [run]);

  // Ctrl+P prints the report alone too, not only the Print button.
  useEffect(() => watchReportPrinting(), []);

  // The P&L Statement, rebuilt from the last read whenever showPercent changes —
  // a display-only redraw, never another trip to the books (see pnlData above).
  const pnlShown = useMemo(
    () =>
      pnlData ? pnlStatement({ columns: pnlData.columns, pnls: pnlData.pnls, accounts: index, showPercent, change: pnlData.change }) : null,
    [pnlData, index, showPercent],
  );
  // The statement actually on screen: the P&L's own memo for that report, the
  // plain read result for every other statement.
  const shownStatement = type === "pnl" ? pnlShown : statement;

  // While a notice is showing, the paper's own read never ran for the dates
  // currently asked for, so the header must not keep quoting the last
  // successful run's range — it heads with what is asked for instead. A budget
  // is asked for by fiscal month, not by the From/To dates.
  const askedRange =
    type === "budget"
      ? { from: months[budgetFromPeriod - 1].start, to: months[budgetToPeriod - 1].end }
      : { from, to };
  const shownRange = notice ? askedRange : ran;
  const paperRange = point ? `As of ${longDate(shownRange.to)}` : rangeText(shownRange.from, shownRange.to);
  const sheet = useMemo(
    () =>
      shownStatement && !shownStatement.empty
        ? statementSheet(shownStatement, {
            companyName,
            currencyCode: baseCurrency,
            decimals: baseDecimals,
            subtitle: paperRange,
            fileName: `${TITLES[type]} ${ran.from} to ${ran.to}`,
          })
        : null,
    [shownStatement, companyName, baseCurrency, baseDecimals, paperRange, type, ran],
  );

  // A month-by-month request that is too wide may still fit by quarter.
  const quarterFits =
    compare === "month" &&
    (point ? pointColumns("quarter", to, from, fiscalStartMonth) : rangeColumns("quarter", from, to, fiscalStartMonth)).ok;

  const body = notice ? (
    <div className={styles.empty}>
      {notice}
      {quarterFits ? (
        <div style={{ marginTop: 12 }}>
          <Button size="small" onClick={() => changeCompare("quarter")}>
            Show it by quarter
          </Button>
        </div>
      ) : null}
    </div>
  ) : !shownStatement ? (
    <div className={styles.empty}>{loading ? "Reading the books…" : "The report has not been run."}</div>
  ) : shownStatement.empty ? (
    <div className={styles.empty}>
      No entries fall in this period.
      <br />
      Add entries on the <Link href="/journal">Journal screen</Link>, or widen the date range.
    </div>
  ) : (
    <>
      {stats ? <StatRow items={stats} /> : null}
      <StatementTable statement={shownStatement} money={money} onZoom={setZoom} />
      {shownStatement.outOfBalance !== null ? (
        <Alert
          type="error"
          showIcon
          className={styles.outOfBalance}
          title={`${type === "trial" ? "Debits and credits" : "Assets, and liabilities plus equity,"} differ by ${money(Math.abs(shownStatement.outOfBalance))}.`}
          description="This should not happen while every entry balances. The General Ledger Posting report shows which document did not reach the ledger."
        />
      ) : null}
      <ReportFoot>
        <strong>Every figure is a QuickZoom.</strong> Click any amount to open the entries behind it, then click a line to
        open the full double entry.
      </ReportFoot>
    </>
  );

  const paper = (
    <div className="report-print-area">
      <ReportPaper companyName={companyName} title={TITLES[type]} range={paperRange} currencyCode={baseCurrency}>
        {body}
      </ReportPaper>
    </div>
  );

  return (
    <div>
      <ReportToolbar
        report={type}
        onReportChange={(next) => router.replace(`/reports?report=${next}`, { scroll: false })}
        dates={
          type === "budget"
            ? {
                kind: "budget",
                fiscalYear,
                months,
                fromPeriod: budgetFromPeriod,
                toPeriod: budgetToPeriod,
                onFiscalYear: setFiscalYear,
                onFromPeriod: setBudgetFromPeriod,
                onToPeriod: setBudgetToPeriod,
              }
            : {
                kind: point ? "point" : "range",
                preset,
                from,
                to,
                showFrom: !point || compare === "month" || compare === "quarter" || compare === "years",
                onPreset: (next) => {
                  setPreset(next);
                  if (next === "custom") return;
                  const range = presetRange(next, presetContext);
                  setFrom(range.from);
                  setTo(range.to);
                },
                onFrom: (date) => {
                  setFrom(date);
                  setPreset("custom");
                },
                onTo: (date) => {
                  setTo(date);
                  setPreset("custom");
                },
              }
        }
        compare={type === "pnl" || point ? { value: compare, onChange: changeCompare } : null}
        percent={
          type === "pnl"
            ? {
                value: showPercent,
                onChange: (show) => {
                  setShowPercent(show);
                  setPercentTouched(true);
                },
              }
            : null
        }
        extraActions={
          type === "budget" && canManageBudget ? (
            <Button icon={<EditOutlined />} onClick={() => setBudgetEditorOpen(true)}>
              Manage budget
            </Button>
          ) : null
        }
        onRun={() => void run()}
        loading={loading}
        sheet={sheet}
      />

      <Spin spinning={loading && shownStatement !== null} description="Reading the books again…">
        <div aria-live="polite" aria-busy={loading}>
          {chart ? (
            <ReportBody
              numbers={paper}
              chart={<ComparisonBars title={chart.title} description={chart.description} formatMoney={money} data={chart.data} />}
            />
          ) : (
            paper
          )}
        </div>
      </Spin>

      <ZoomSheet spec={zoom} onClose={() => setZoom(null)} money={money} />

      {type === "budget" && canManageBudget ? (
        <BudgetEditorDrawer
          key={fiscalYear}
          open={budgetEditorOpen}
          onClose={() => setBudgetEditorOpen(false)}
          onSaved={() => {
            setBudgetEditorOpen(false);
            void run();
          }}
          fiscalYear={fiscalYear}
          months={months}
          baseCurrency={baseCurrency}
          baseDecimals={baseDecimals}
        />
      ) : null}
    </div>
  );
}
