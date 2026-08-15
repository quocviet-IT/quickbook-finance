"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  App,
  Button,
  DatePicker,
  InputNumber,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { EditOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import DataTable from "@/components/ui/DataTable";
import FilterBar from "@/components/ui/FilterBar";
import { ComparisonBars, chartColors } from "@/components/charts/FinancialCharts";
import BudgetEditorDrawer from "@/components/reports/BudgetEditorDrawer";
import BudgetVsActualView from "@/components/reports/BudgetVsActualView";
import { ReportAudienceToggle, ReportBody } from "@/components/reports/ReportAudience";
import StatementOfEquityView from "@/components/reports/StatementOfEquityView";
import BalanceSheetTrendView, {
  type TrendPeriod,
} from "@/components/reports/BalanceSheetTrendView";
import PnlTrendView, { type PnlTrendPeriod } from "@/components/reports/PnlTrendView";
import ReportExportButtons from "@/components/reports/ReportExportButtons";
import { formatMoney, formatPercent } from "@/lib/format";
import { fiscalMonths, fiscalYearForDate } from "@/lib/domain/fiscal";
import { periodColumnLabel } from "@/lib/domain/period-label";
import { fromMinor } from "@/lib/domain/money";
import type { ReportExportSheet } from "@/lib/domain/report-export";
import type { InternalReportId } from "@/lib/domain/report-catalog";
import {
  buildBalanceSheet,
  buildProfitAndLoss,
  buildTrialBalance,
  compareReportLines,
  percentOfIncome,
  PERCENT_OF_INCOME_TOOLTIP,
  previousPeriodRange,
  type BalanceSheet,
  type BudgetVsActual,
  type LedgerBalance,
  type ReportSection,
  type StatementOfEquity,
} from "@/lib/domain/reports";
import {
  COMPARISON_BASES,
  comparisonBasisLabel,
  comparisonDate,
  MAX_TREND_COLUMNS,
  monthlyColumns,
  quarterlyColumns,
  trailingMonthEnds,
  trailingYearEnds,
  trendColumnLimitMessage,
  type ComparisonBasis,
} from "@/lib/domain/report-periods";
import {
  getBudgetVsActualAction,
  getLedgerBalancesAction,
  getStatementOfEquityAction,
} from "./actions";

interface ReportsClientProps {
  initialReportType: InternalReportId;
  baseCurrency: string;
  baseDecimals: number;
  companyName: string;
  fiscalStartMonth: number;
  canManageBudget: boolean;
}

export default function ReportsClient({
  initialReportType,
  baseCurrency,
  baseDecimals,
  companyName,
  fiscalStartMonth,
  canManageBudget,
}: ReportsClientProps) {
  const { message } = App.useApp();
  const router = useRouter();
  const today = dayjs();
  const initialFiscalYear = fiscalYearForDate(today.format("YYYY-MM-DD"), fiscalStartMonth);
  const [type, setType] = useState<InternalReportId>(initialReportType);
  const [asOf, setAsOf] = useState<Dayjs>(today);
  const [range, setRange] = useState<[Dayjs, Dayjs]>([today.startOf("year"), today]);
  const [rows, setRows] = useState<LedgerBalance[]>([]);
  const [priorRows, setPriorRows] = useState<LedgerBalance[]>([]);
  // Balance sheet presentation: what it is compared with, whether the
  // variance columns are shown, and whether it runs as a period trend.
  const [comparisonBasis, setComparisonBasis] = useState<ComparisonBasis>("prior_month");
  // `single` and `comparison` are one balance sheet read; `months` and `years`
  // are a trend, which is a different query and a different view. Anything
  // added here has to be sorted into one of those two families below, not
  // tested for by "is not comparison".
  const [balanceColumns, setBalanceColumns] = useState<
    "single" | "comparison" | "months" | "years"
  >(
    "comparison",
  );
  const [showVariance, setShowVariance] = useState(false);
  /**
   * How the profit and loss lays its columns out.
   *
   * Defaults to the comparison, which is what this report has always shown, so
   * nobody's saved link changes meaning. A reader who wants the statement on
   * its own — to hand to a bank, or to read without four columns of arithmetic
   * — asks for one period and gets one column. `month`/`quarter` are a
   * different query shape entirely (one read per column, like the balance
   * sheet trend below), which is why they get their own state — `pnlRows` —
   * rather than reusing `rows`/`priorRows`.
   */
  const [pnlColumns, setPnlColumns] = useState<"single" | "comparison" | "month" | "quarter">(
    "comparison",
  );
  /**
   * Whether each P&L line also carries its share of that column's income.
   *
   * Defaults on for one or two columns, where a percent beside each figure
   * costs nothing to read. Defaults off for a period-by-period view, where it
   * would double an already-wide table — but stays a click away rather than
   * being disabled there, because a reader who wants both may still ask for
   * both.
   */
  const [showPercentOfIncome, setShowPercentOfIncome] = useState(true);
  const [trendPeriods, setTrendPeriods] = useState<TrendPeriod[]>([]);
  const [pnlTrendPeriods, setPnlTrendPeriods] = useState<PnlTrendPeriod[]>([]);
  /**
   * Set instead of running the query, when the chosen range would need more
   * columns than a reader could scan. Refusing and naming the fix beats
   * fetching sixty columns nobody will read one at a time.
   */
  const [pnlTrendLimitMessage, setPnlTrendLimitMessage] = useState<string | null>(null);
  const [budgetReport, setBudgetReport] = useState<BudgetVsActual | null>(null);
  const [equityReport, setEquityReport] = useState<StatementOfEquity | null>(null);
  const [fiscalYear, setFiscalYear] = useState(initialFiscalYear);
  const months = useMemo(
    () => fiscalMonths(fiscalYear, fiscalStartMonth),
    [fiscalYear, fiscalStartMonth],
  );
  const initialPeriod = Math.max(
    1,
    months.findIndex((month) => today.format("YYYY-MM-DD") >= month.start && today.format("YYYY-MM-DD") <= month.end) + 1,
  );
  const [budgetFromPeriod, setBudgetFromPeriod] = useState(1);
  const [budgetToPeriod, setBudgetToPeriod] = useState(initialPeriod || 12);
  const [budgetEditorOpen, setBudgetEditorOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  function handleReportTypeChange(nextType: InternalReportId) {
    setType(nextType);
    router.replace(`/reports?report=${nextType}`, { scroll: false });
  }

  function handlePnlColumnsChange(next: "single" | "comparison" | "month" | "quarter") {
    setPnlColumns(next);
    setShowPercentOfIncome(next === "single" || next === "comparison");
  }

  const money = useCallback(
    (minor: number) => formatMoney(minor, baseCurrency, baseDecimals),
    [baseCurrency, baseDecimals],
  );

  const run = useCallback(async () => {
    setLoading(true);
    try {
      if (type === "budget") {
        if (budgetFromPeriod > budgetToPeriod) {
          message.warning("The first budget period must not be after the last period");
          return;
        }
        const from = months[budgetFromPeriod - 1].start;
        const to = months[budgetToPeriod - 1].end;
        const result = await getBudgetVsActualAction(fiscalYear, from, to);
        if (!result.ok || !result.data) throw new Error(result.error ?? "Failed to load Budget vs Actual");
        setBudgetReport(result.data);
        return;
      }
      if (type === "equity") {
        const from = range[0].format("YYYY-MM-DD");
        const to = range[1].format("YYYY-MM-DD");
        const result = await getStatementOfEquityAction(from, to);
        if (!result.ok || !result.data) throw new Error(result.error ?? "Failed to load Statement of Equity");
        setEquityReport(result.data);
        return;
      }

      if (type === "balance" && (balanceColumns === "months" || balanceColumns === "years")) {
        // A trend runs one balance sheet per column; they are independent
        // reads, so they go out together.
        const asOfIso = asOf.format("YYYY-MM-DD");
        const columns =
          balanceColumns === "months" ? trailingMonthEnds(asOfIso, 12) : trailingYearEnds(asOfIso, 3);
        const results = await Promise.all(
          columns.map((column) => getLedgerBalancesAction(null, column.date)),
        );
        const failed = results.find((result) => !result.ok || !result.data);
        if (failed) throw new Error(failed.error ?? "Failed to load the period trend");
        setTrendPeriods(
          columns.map((column, index) => ({
            ...column,
            sheet: buildBalanceSheet(results[index].data ?? []),
          })),
        );
        return;
      }

      if (type === "pnl" && (pnlColumns === "month" || pnlColumns === "quarter")) {
        // A period-by-period P&L is the same shape as the balance sheet trend
        // above: one independent read per column, run together. The one thing
        // it adds is the column count itself can be unbounded — a hand-picked
        // range, not a fixed trailing count — so it gets checked before any
        // query goes out rather than after.
        const currentFrom = range[0].format("YYYY-MM-DD");
        const currentTo = range[1].format("YYYY-MM-DD");
        const limitMessage = trendColumnLimitMessage(pnlColumns, currentFrom, currentTo);
        if (limitMessage) {
          setPnlTrendLimitMessage(limitMessage);
          setPnlTrendPeriods([]);
          return;
        }
        setPnlTrendLimitMessage(null);
        const columns =
          pnlColumns === "month"
            ? monthlyColumns(currentFrom, currentTo)
            : quarterlyColumns(currentFrom, currentTo);
        const results = await Promise.all(
          columns.map((column) => getLedgerBalancesAction(column.from, column.to)),
        );
        const failed = results.find((result) => !result.ok || !result.data);
        if (failed) throw new Error(failed.error ?? "Failed to load the period columns");
        setPnlTrendPeriods(
          columns.map((column, index) => ({
            ...column,
            pnl: buildProfitAndLoss(results[index].data ?? []),
          })),
        );
        return;
      }

      const currentFrom = type === "pnl" ? range[0].format("YYYY-MM-DD") : null;
      const currentTo = type === "pnl" ? range[1].format("YYYY-MM-DD") : asOf.format("YYYY-MM-DD");
      let priorFrom: string | null = null;
      let priorTo: string | null = null;
      // A report asked for on its own reads one period. Leaving priorTo null is
      // what skips the second query below, so asking for one period costs one
      // read rather than two.
      if (type === "pnl" && pnlColumns === "comparison") {
        const prior = previousPeriodRange(currentFrom!, currentTo);
        priorFrom = prior.from;
        priorTo = prior.to;
      } else if (type === "balance" && balanceColumns === "comparison") {
        priorTo = comparisonDate(currentTo, comparisonBasis);
      }
      const [currentResult, priorResult] = await Promise.all([
        getLedgerBalancesAction(currentFrom, currentTo),
        priorTo ? getLedgerBalancesAction(priorFrom, priorTo) : Promise.resolve(null),
      ]);
      if (!currentResult.ok || !currentResult.data) {
        throw new Error(currentResult.error ?? "Failed to load report");
      }
      if (priorResult && (!priorResult.ok || !priorResult.data)) {
        throw new Error(priorResult.error ?? "Failed to load prior-period comparison");
      }
      setRows(currentResult.data);
      setPriorRows(priorResult?.data ?? []);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "Failed to load report");
    } finally {
      setLoading(false);
    }
  }, [
    type,
    range,
    asOf,
    comparisonBasis,
    balanceColumns,
    pnlColumns,
    fiscalYear,
    budgetFromPeriod,
    budgetToPeriod,
    months,
    message,
  ]);

  useEffect(() => {
    // Data-synchronization effect: report filters intentionally trigger a server load.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void run();
  }, [run]);

  const resultCount =
    type === "budget"
      ? budgetReport?.lines.length
      : type === "equity"
        ? equityReport?.lines.length
        : type === "pnl" && (pnlColumns === "month" || pnlColumns === "quarter")
          ? pnlTrendPeriods.length
          : rows.length;
  const budgetFrom = months[budgetFromPeriod - 1]?.start ?? months[0].start;
  const budgetTo = months[budgetToPeriod - 1]?.end ?? months[11].end;

  return (
    <div>
      <FilterBar
        resultCount={resultCount}
        ariaLabel="Financial report filters and actions"
        actions={
          <>
            {type === "budget" && canManageBudget && (
              <Button icon={<EditOutlined />} onClick={() => setBudgetEditorOpen(true)}>
                Manage budget
              </Button>
            )}
            <Button type="primary" onClick={() => void run()} loading={loading}>
              Run report
            </Button>
          </>
        }
      >
        <ReportAudienceToggle />
        <Select
          aria-label="Report type"
          value={type}
          style={{ width: 230 }}
          onChange={handleReportTypeChange}
          options={[
            { label: "Trial Balance", value: "trial" },
            { label: "Profit & Loss Comparison", value: "pnl" },
            { label: "Balance Sheet Comparison", value: "balance" },
            { label: "Budget vs Actual", value: "budget" },
            { label: "Statement of Equity", value: "equity" },
          ]}
        />
        {(type === "pnl" || type === "equity") && (
          <DatePicker.RangePicker
            aria-label="Report date range"
            value={range}
            allowClear={false}
            onChange={(value) => value && setRange([value[0]!, value[1]!])}
          />
        )}
        {type === "pnl" && (
          <>
            <Select
              aria-label="Profit and loss columns"
              value={pnlColumns}
              style={{ width: 185 }}
              onChange={handlePnlColumnsChange}
              options={[
                { value: "single", label: "One period" },
                { value: "comparison", label: "Two periods" },
                { value: "month", label: "By month" },
                { value: "quarter", label: "By quarter" },
              ]}
            />
            <Space>
              <Switch
                size="small"
                checked={showPercentOfIncome}
                onChange={setShowPercentOfIncome}
                aria-label="Show % of Income"
              />
              <Typography.Text type="secondary">% of Income</Typography.Text>
            </Space>
          </>
        )}
        {(type === "trial" || type === "balance") && (
          <Space>
            <Typography.Text type="secondary">As of</Typography.Text>
            <DatePicker value={asOf} allowClear={false} onChange={(value) => value && setAsOf(value)} />
          </Space>
        )}
        {type === "balance" && (
          <>
            <Select
              aria-label="Balance sheet columns"
              value={balanceColumns}
              style={{ width: 185 }}
              onChange={setBalanceColumns}
              options={[
                { value: "single", label: "One period" },
                { value: "comparison", label: "Two periods" },
                { value: "months", label: "Last 12 months" },
                { value: "years", label: "Last 3 years" },
              ]}
            />
            {balanceColumns === "comparison" && (
              <>
                <Select
                  aria-label="Compared with"
                  value={comparisonBasis}
                  style={{ width: 210 }}
                  onChange={setComparisonBasis}
                  options={COMPARISON_BASES.map((basis) => ({
                    value: basis,
                    label: `vs ${comparisonBasisLabel(basis).toLowerCase()}`,
                  }))}
                />
                <Space>
                  <Switch
                    size="small"
                    checked={showVariance}
                    onChange={setShowVariance}
                    aria-label="Show variance columns"
                  />
                  <Typography.Text type="secondary">Variance</Typography.Text>
                </Space>
              </>
            )}
          </>
        )}
        {type === "budget" && (
          <>
            <Space>
              <Typography.Text type="secondary">Fiscal year</Typography.Text>
              <InputNumber
                aria-label="Fiscal year"
                min={2000}
                max={2100}
                value={fiscalYear}
                onChange={(value) => setFiscalYear(Number(value ?? initialFiscalYear))}
              />
            </Space>
            <Select
              aria-label="Budget start period"
              value={budgetFromPeriod}
              style={{ width: 145 }}
              options={months.map((month) => ({ value: month.period, label: `From ${month.label}` }))}
              onChange={setBudgetFromPeriod}
            />
            <Select
              aria-label="Budget end period"
              value={budgetToPeriod}
              style={{ width: 135 }}
              options={months.map((month) => ({ value: month.period, label: `To ${month.label}` }))}
              onChange={setBudgetToPeriod}
            />
          </>
        )}
      </FilterBar>

      <Spin spinning={loading}>
        <div aria-live="polite" aria-busy={loading}>
          {type === "trial" && (
            <TrialBalanceView
              rows={rows}
              asOf={asOf}
              companyName={companyName}
              baseCurrency={baseCurrency}
              baseDecimals={baseDecimals}
              money={money}
            />
          )}
          {type === "pnl" && (pnlColumns === "single" || pnlColumns === "comparison") && (
            <PnlComparisonView
              rows={rows}
              priorRows={priorRows}
              range={range}
              companyName={companyName}
              baseCurrency={baseCurrency}
              baseDecimals={baseDecimals}
              money={money}
              showPrior={pnlColumns === "comparison"}
              showPercentOfIncome={showPercentOfIncome}
            />
          )}
          {type === "pnl" &&
            (pnlColumns === "month" || pnlColumns === "quarter") &&
            (pnlTrendLimitMessage ? (
              <PnlTrendLimitNotice
                message={pnlTrendLimitMessage}
                companyName={companyName}
                baseCurrency={baseCurrency}
                onSwitchToQuarter={
                  pnlColumns === "month" &&
                  quarterlyColumns(range[0].format("YYYY-MM-DD"), range[1].format("YYYY-MM-DD"))
                    .length <= MAX_TREND_COLUMNS
                    ? () => handlePnlColumnsChange("quarter")
                    : undefined
                }
              />
            ) : (
              <PnlTrendView
                periods={pnlTrendPeriods}
                showPercentOfIncome={showPercentOfIncome}
                companyName={companyName}
                baseCurrency={baseCurrency}
                baseDecimals={baseDecimals}
                money={money}
              />
            ))}
          {type === "balance" && (balanceColumns === "comparison" || balanceColumns === "single") && (
            <BalanceSheetComparisonView
              rows={rows}
              priorRows={priorRows}
              asOf={asOf}
              comparisonBasis={comparisonBasis}
              showVariance={showVariance}
              companyName={companyName}
              baseCurrency={baseCurrency}
              baseDecimals={baseDecimals}
              money={money}
              showPrior={balanceColumns === "comparison"}
            />
          )}
          {type === "balance" && (balanceColumns === "months" || balanceColumns === "years") && (
            <BalanceSheetTrendView
              periods={trendPeriods}
              companyName={companyName}
              baseCurrency={baseCurrency}
              baseDecimals={baseDecimals}
              money={money}
            />
          )}
          {type === "budget" && budgetReport && (
            <BudgetVsActualView
              report={budgetReport}
              fiscalYear={fiscalYear}
              from={budgetFrom}
              to={budgetTo}
              companyName={companyName}
              baseCurrency={baseCurrency}
              baseDecimals={baseDecimals}
              money={money}
            />
          )}
          {type === "equity" && equityReport && (
            <StatementOfEquityView
              report={equityReport}
              from={range[0].format("YYYY-MM-DD")}
              to={range[1].format("YYYY-MM-DD")}
              companyName={companyName}
              baseCurrency={baseCurrency}
              baseDecimals={baseDecimals}
              money={money}
            />
          )}
        </div>
      </Spin>

      {type === "budget" && canManageBudget && (
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
      )}
    </div>
  );
}

function ReportHeading({
  title,
  subtitle,
  companyName,
  exportSheet,
  disabled = false,
}: {
  title: string;
  subtitle: string;
  /** Whose books these are. A statement that does not name its entity is one
   *  somebody will eventually file against the wrong company. */
  companyName?: string;
  exportSheet: ReportExportSheet;
  disabled?: boolean;
}) {
  return (
    <div className="report-result__heading">
      <div>
        {companyName ? (
          <Typography.Text strong className="report-result__entity">
            {companyName}
          </Typography.Text>
        ) : null}
        <Typography.Title level={4}>{title}</Typography.Title>
        <Typography.Text type="secondary">{subtitle}</Typography.Text>
      </div>
      <ReportExportButtons sheet={exportSheet} disabled={disabled} />
    </div>
  );
}

/**
 * What a period-by-period P&L shows instead of a table, when the chosen
 * range would need more columns than `MAX_TREND_COLUMNS`.
 *
 * Refuses rather than fetching and rendering a table nobody would read
 * column by column, and names both ways out — narrowing the range is always
 * an option, switching to quarters only when `onSwitchToQuarter` is given,
 * which the caller only does once it has confirmed quarters would actually
 * fit under the same limit. Never switches on its own: a reader who asked
 * for months and got quarters without being told has been handed a
 * different report than the one they think they are reading.
 */
function PnlTrendLimitNotice({
  message,
  companyName,
  baseCurrency,
  onSwitchToQuarter,
}: {
  message: string;
  companyName: string;
  baseCurrency: string;
  onSwitchToQuarter?: () => void;
}) {
  return (
    <div className="report-result">
      <ReportHeading
        companyName={companyName}
        title="Profit and Loss by Period"
        subtitle="Choose a narrower range to see the columns"
        exportSheet={{
          fileName: "profit-and-loss-by-period",
          companyName,
          title: "Profit and Loss by Period",
          subtitle: "",
          currencyCode: baseCurrency,
          columns: [],
          rows: [],
        }}
        disabled
      />
      <DataTable
        rowKey="key"
        dataSource={[]}
        pagination={false}
        columns={[{ title: "Account", dataIndex: "label" }]}
        emptyTitle="That range has too many columns to read at once"
        emptyDescription={message}
        emptyAction={
          onSwitchToQuarter ? <Button onClick={onSwitchToQuarter}>Show it by quarter</Button> : undefined
        }
      />
    </div>
  );
}

function TrialBalanceView({
  rows,
  money,
  asOf,
  companyName,
  baseCurrency,
  baseDecimals,
}: {
  rows: LedgerBalance[];
  money: (value: number) => string;
  asOf: Dayjs;
  companyName: string;
  baseCurrency: string;
  baseDecimals: number;
}) {
  const report = buildTrialBalance(rows);
  const to = asOf.format("YYYY-MM-DD");
  const exportSheet: ReportExportSheet = {
    fileName: `trial-balance-${to}`,
    companyName,
    title: "Trial Balance",
    subtitle: `As of ${to}`,
    currencyCode: baseCurrency,
    columns: [
      { key: "account", header: "Account", width: 40 },
      { key: "debit", header: "Debit", kind: "money", width: 18 },
      { key: "credit", header: "Credit", kind: "money", width: 18 },
    ],
    rows: report.lines.map((line) => ({
      account: `${line.accountCode} — ${line.name}`,
      debit: fromMinor(line.debit, baseDecimals),
      credit: fromMinor(line.credit, baseDecimals),
    })),
  };
  return (
    <div className="report-result">
      <ReportHeading
        companyName={companyName}
        title="Trial Balance"
        subtitle={`As of ${asOf.format("MMM D, YYYY")}`}
        exportSheet={exportSheet}
        disabled={report.lines.length === 0}
      />
      <DataTable
        rowKey="accountId"
        pagination={false}
        dataSource={report.lines}
        emptyTitle="No balances for this date"
        emptyDescription="Choose another date or confirm that transactions have been posted."
        columns={[
          {
            title: "Account",
            render: (_, line) => (
              <Link href={`/reports/general-ledger?account=${line.accountId}&to=${to}`}>
                {line.accountCode} — {line.name}
              </Link>
            ),
          },
          { title: "Debit", align: "right", width: 160, render: (_, line) => line.debit ? money(line.debit) : "" },
          { title: "Credit", align: "right", width: 160, render: (_, line) => line.credit ? money(line.credit) : "" },
        ]}
        summary={() => (
          <Table.Summary.Row className="report-summary-row">
            <Table.Summary.Cell index={0}>Total</Table.Summary.Cell>
            <Table.Summary.Cell index={1} align="right">{money(report.totalDebit)}</Table.Summary.Cell>
            <Table.Summary.Cell index={2} align="right">{money(report.totalCredit)}</Table.Summary.Cell>
          </Table.Summary.Row>
        )}
      />
      <div className="report-balance-status">
        <Tag color={report.balanced ? "green" : "red"}>{report.balanced ? "Balanced" : "Out of balance"}</Tag>
      </div>
    </div>
  );
}

interface ComparisonRow {
  key: string;
  label: string;
  accountId: string | null;
  current: number;
  prior: number;
  variance: number;
  variancePercent: number | null;
  kind: "section" | "line" | "total";
}

function sectionRows(current: ReportSection, prior: ReportSection): ComparisonRow[] {
  const lines = compareReportLines(current.lines, prior.lines);
  return [
    {
      key: `section:${current.key}`,
      label: current.title,
      accountId: null,
      current: 0,
      prior: 0,
      variance: 0,
      variancePercent: null,
      kind: "section",
    },
    ...lines.map((line) => ({
      key: `${current.key}:${line.accountId ?? `${line.accountCode}:${line.name}`}`,
      label: `${line.accountCode ? `${line.accountCode} — ` : ""}${line.name}`,
      accountId: line.accountId,
      current: line.current,
      prior: line.prior,
      variance: line.variance,
      variancePercent: line.variancePercent,
      kind: "line" as const,
    })),
    totalRow(`total:${current.key}`, `Total ${current.title}`, current.total, prior.total),
  ];
}

function totalRow(key: string, label: string, current: number, prior: number): ComparisonRow {
  const variance = current - prior;
  return {
    key,
    label,
    accountId: null,
    current,
    prior,
    variance,
    variancePercent: prior === 0 ? null : (variance / Math.abs(prior)) * 100,
    kind: "total",
  };
}

function PnlComparisonView({
  rows,
  priorRows,
  money,
  range,
  companyName,
  baseCurrency,
  baseDecimals,
  showPrior,
  showPercentOfIncome,
}: {
  rows: LedgerBalance[];
  priorRows: LedgerBalance[];
  money: (value: number) => string;
  range: [Dayjs, Dayjs];
  companyName: string;
  baseCurrency: string;
  baseDecimals: number;
  showPrior: boolean;
  showPercentOfIncome: boolean;
}) {
  const current = buildProfitAndLoss(rows);
  const prior = buildProfitAndLoss(priorRows);
  const currentFrom = range[0].format("YYYY-MM-DD");
  const currentTo = range[1].format("YYYY-MM-DD");
  const priorRange = previousPeriodRange(currentFrom, currentTo);
  const comparisonRows = [
    ...sectionRows(current.income, prior.income),
    ...sectionRows(current.costOfGoodsSold, prior.costOfGoodsSold),
    totalRow("gross-profit", "Gross Profit", current.grossProfit, prior.grossProfit),
    ...sectionRows(current.operatingExpenses, prior.operatingExpenses),
    ...sectionRows(current.otherIncome, prior.otherIncome),
    ...sectionRows(current.otherExpenses, prior.otherExpenses),
    totalRow("net-income", "Net Income", current.netIncome, prior.netIncome),
  ];
  const percentOfIncomeTotals = showPercentOfIncome
    ? { current: current.income.total, prior: prior.income.total }
    : undefined;
  const title = showPrior ? "Profit & Loss Comparison" : "Profit & Loss";
  const period = `${range[0].format("MMM D, YYYY")} – ${range[1].format("MMM D, YYYY")}`;
  const exportSheet = comparisonExportSheet({
    fileName: showPrior
      ? `profit-and-loss-comparison-${currentFrom}-${currentTo}`
      : `profit-and-loss-${currentFrom}-${currentTo}`,
    companyName,
    title,
    subtitle: showPrior
      ? `${currentFrom} to ${currentTo} compared with ${priorRange.from} to ${priorRange.to}`
      : `${currentFrom} to ${currentTo}`,
    currencyCode: baseCurrency,
    baseDecimals,
    currentLabel: periodColumnLabel(currentFrom, currentTo),
    priorLabel: periodColumnLabel(priorRange.from, priorRange.to),
    rows: comparisonRows,
    showPrior,
    percentOfIncomeTotals,
  });
  return (
    <div className="report-result">
      <ReportHeading
        companyName={companyName}
        title={title}
        subtitle={
          showPrior ? `${period} · Prior ${priorRange.from} – ${priorRange.to}` : period
        }
        exportSheet={exportSheet}
      />
      <ReportBody
        numbers={
          <ComparisonTable
            rows={comparisonRows}
            // The periods themselves, not "Current" and "Prior". Those two say
            // only which came first, leaving the reader to carry the dates from
            // the subtitle in their head — and a printed page loses even that.
            // The balance sheet beside this one has always headed its columns
            // with the date they were struck at.
            currentLabel={periodColumnLabel(currentFrom, currentTo)}
            priorLabel={periodColumnLabel(priorRange.from, priorRange.to)}
            currentRange={{ from: currentFrom, to: currentTo }}
            priorRange={priorRange}
            money={money}
            showPrior={showPrior}
            percentOfIncomeTotals={percentOfIncomeTotals}
          />
        }
        chart={
          <ComparisonBars
            title="Period performance"
            description="Current period profitability compared with the immediately preceding period."
            formatMoney={money}
            data={[
              { key: "current-income", label: "Current income", value: current.income.total + current.otherIncome.total, color: chartColors.income },
              { key: "prior-income", label: "Prior income", value: prior.income.total + prior.otherIncome.total, color: chartColors.receivable },
              { key: "current-net", label: "Current net income", value: current.netIncome, color: current.netIncome < 0 ? chartColors.negative : chartColors.net },
              { key: "prior-net", label: "Prior net income", value: prior.netIncome, color: chartColors.neutral },
            ]}
          />
        }
      />
    </div>
  );
}

function BalanceSheetComparisonView({
  rows,
  priorRows,
  money,
  asOf,
  comparisonBasis,
  showVariance,
  companyName,
  baseCurrency,
  baseDecimals,
  showPrior,
}: {
  rows: LedgerBalance[];
  priorRows: LedgerBalance[];
  money: (value: number) => string;
  asOf: Dayjs;
  comparisonBasis: ComparisonBasis;
  showVariance: boolean;
  companyName: string;
  baseCurrency: string;
  baseDecimals: number;
  showPrior: boolean;
}) {
  const current = buildBalanceSheet(rows);
  const prior = buildBalanceSheet(priorRows);
  const currentTo = asOf.format("YYYY-MM-DD");
  const priorTo = comparisonDate(currentTo, comparisonBasis);
  const comparisonRows = balanceComparisonRows(current, prior);
  const title = showPrior ? "Balance Sheet Comparison" : "Balance Sheet";
  const exportSheet = comparisonExportSheet({
    fileName: showPrior ? `balance-sheet-comparison-${currentTo}` : `balance-sheet-${currentTo}`,
    companyName,
    title,
    subtitle: showPrior ? `As of ${currentTo} compared with ${priorTo}` : `As of ${currentTo}`,
    currencyCode: baseCurrency,
    baseDecimals,
    currentLabel: currentTo,
    priorLabel: priorTo,
    rows: comparisonRows,
    showPrior,
  });
  return (
    <div className="report-result">
      <ReportHeading
        companyName={companyName}
        title={title}
        subtitle={
          showPrior
            ? `As of ${asOf.format("MMM D, YYYY")} · ${comparisonBasisLabel(comparisonBasis)} ${priorTo}`
            : `As of ${asOf.format("MMM D, YYYY")}`
        }
        exportSheet={exportSheet}
      />
      <ReportBody
        numbers={
          <>
            <ComparisonTable
              rows={comparisonRows}
              currentLabel={currentTo}
              priorLabel={priorTo}
              currentRange={{ from: "", to: currentTo }}
              priorRange={{ from: "", to: priorTo }}
              money={money}
              showVariance={showVariance}
              showPrior={showPrior}
            />
            <div className="report-balance-status">
              <Tag color={current.balanced ? "green" : "red"}>
                {current.balanced ? "Balanced" : "Out of balance"}
              </Tag>
            </div>
          </>
        }
        chart={
          <ComparisonBars
            title="Financial position comparison"
            description={`Current assets, liabilities, and equity compared with ${comparisonBasisLabel(comparisonBasis).toLowerCase()} ${priorTo}.`}
            formatMoney={money}
            data={[
              { key: "assets", label: "Current assets", value: current.totalAssets, color: chartColors.receivable },
              { key: "prior-assets", label: "Prior assets", value: prior.totalAssets, color: chartColors.income },
              { key: "liabilities", label: "Current liabilities", value: current.totalLiabilities, color: chartColors.expense },
              { key: "equity", label: "Current equity", value: current.totalEquity, color: chartColors.net },
            ]}
          />
        }
      />
    </div>
  );
}

function balanceComparisonRows(current: BalanceSheet, prior: BalanceSheet): ComparisonRow[] {
  return [
    ...sectionRows(current.assets, prior.assets),
    ...sectionRows(current.liabilities, prior.liabilities),
    ...sectionRows(current.equity, prior.equity),
    totalRow(
      "liabilities-equity",
      "Total Liabilities + Equity",
      current.totalLiabilities + current.totalEquity,
      prior.totalLiabilities + prior.totalEquity,
    ),
  ];
}

function ComparisonTable({
  rows,
  currentLabel,
  priorLabel,
  currentRange,
  priorRange,
  money,
  showVariance = true,
  showPrior = true,
  percentOfIncomeTotals,
}: {
  rows: ComparisonRow[];
  currentLabel: string;
  priorLabel: string;
  currentRange: { from: string; to: string };
  priorRange: { from: string; to: string };
  money: (value: number) => string;
  /** Off by default on the balance sheet: the reader can subtract two columns. */
  showVariance?: boolean;
  /**
   * Off when the reader asked for one period. The prior figures are still in
   * `rows` — they are simply all zero, because nothing was fetched for them —
   * so the columns are dropped here rather than the rows being rebuilt. The
   * variance columns go with them: a variance against nothing is the current
   * figure repeated, which would read as a fact rather than as a blank.
   */
  showPrior?: boolean;
  /**
   * The income each column's % of Income is measured against. Undefined
   * turns the feature off entirely — this table is shared with the balance
   * sheet, where a percentage of income has no meaning at all.
   */
  percentOfIncomeTotals?: { current: number; prior: number };
}) {
  const percentCell = (amount: number, income: number) => {
    const pct = percentOfIncome(amount, income);
    return pct === null ? "—" : formatPercent(pct);
  };
  const percentHeader = (
    <Tooltip title={PERCENT_OF_INCOME_TOOLTIP}>
      <span>% of Income</span>
    </Tooltip>
  );

  return (
    <DataTable
      rowKey="key"
      dataSource={rows}
      pagination={false}
      columns={[
        {
          title: "Account",
          width: 260,
          render: (_, row) => {
            if (row.kind === "section") return <strong>{row.label}</strong>;
            if (row.accountId) {
              const from = currentRange.from ? `&from=${currentRange.from}` : "";
              return (
                <Link href={`/reports/general-ledger?account=${row.accountId}${from}&to=${currentRange.to}`}>
                  {row.label}
                </Link>
              );
            }
            return row.label;
          },
        },
        {
          title: currentLabel,
          width: 145,
          align: "right",
          render: (_, row) =>
            row.kind === "section"
              ? ""
              : row.accountId
                ? <LedgerAmountLink accountId={row.accountId} range={currentRange} label={money(row.current)} />
                : money(row.current),
        },
        ...(percentOfIncomeTotals
          ? [
              {
                title: percentHeader,
                width: 100,
                align: "right" as const,
                render: (_: unknown, row: ComparisonRow) =>
                  row.kind === "section" ? "" : percentCell(row.current, percentOfIncomeTotals.current),
              },
            ]
          : []),
        ...(showPrior
          ? [
              {
                title: priorLabel,
                width: 145,
                align: "right" as const,
                render: (_: unknown, row: ComparisonRow) =>
                  row.kind === "section"
                    ? ""
                    : row.accountId
                      ? <LedgerAmountLink accountId={row.accountId} range={priorRange} label={money(row.prior)} />
                      : money(row.prior),
              },
            ]
          : []),
        ...(showPrior && percentOfIncomeTotals
          ? [
              {
                title: percentHeader,
                width: 100,
                align: "right" as const,
                render: (_: unknown, row: ComparisonRow) =>
                  row.kind === "section" ? "" : percentCell(row.prior, percentOfIncomeTotals.prior),
              },
            ]
          : []),
        ...(showPrior && showVariance
          ? [
              {
                title: "Variance",
                width: 145,
                align: "right" as const,
                render: (_: unknown, row: ComparisonRow) =>
                  row.kind === "section" ? "" : money(row.variance),
              },
              {
                title: "Variance %",
                width: 110,
                align: "right" as const,
                render: (_: unknown, row: ComparisonRow) =>
                  row.kind === "section" || row.variancePercent === null
                    ? ""
                    : formatPercent(row.variancePercent),
              },
            ]
          : []),
      ]}
      rowClassName={(row) =>
        row.kind === "section"
          ? "report-table-row--section"
          : row.kind === "total"
            ? "report-table-row--emphasis"
            : ""
      }
    />
  );
}

function LedgerAmountLink({
  accountId,
  range,
  label,
}: {
  accountId: string;
  range: { from: string; to: string };
  label: string;
}) {
  const from = range.from ? `&from=${range.from}` : "";
  return (
    <Link href={`/reports/general-ledger?account=${accountId}${from}&to=${range.to}`}>
      {label}
    </Link>
  );
}

function comparisonExportSheet({
  fileName,
  companyName,
  title,
  subtitle,
  currencyCode,
  baseDecimals,
  currentLabel,
  priorLabel,
  rows,
  showPrior = true,
  percentOfIncomeTotals,
}: {
  fileName: string;
  companyName: string;
  title: string;
  subtitle: string;
  currencyCode: string;
  baseDecimals: number;
  currentLabel: string;
  priorLabel: string;
  rows: ComparisonRow[];
  /** Matches the table on screen: one period exports one column of figures. */
  showPrior?: boolean;
  /** Matches the table on screen: present only when the % of Income switch is on. */
  percentOfIncomeTotals?: { current: number; prior: number };
}): ReportExportSheet {
  const percentCell = (amount: number, income: number, isSection: boolean) =>
    isSection ? null : percentOfIncome(amount, income);
  return {
    fileName,
    companyName,
    title,
    subtitle,
    currencyCode,
    columns: [
      { key: "account", header: "Account", width: 40 },
      { key: "current", header: currentLabel, kind: "money", width: 18 },
      ...(percentOfIncomeTotals
        ? ([{ key: "currentPercentOfIncome", header: "% of Income", kind: "percent", width: 14 }] as const)
        : []),
      ...(showPrior
        ? ([
            { key: "prior", header: priorLabel, kind: "money", width: 18 },
            ...(percentOfIncomeTotals
              ? ([{ key: "priorPercentOfIncome", header: "% of Income", kind: "percent", width: 14 }] as const)
              : []),
            { key: "variance", header: "Variance", kind: "money", width: 18 },
            { key: "variancePercent", header: "Variance %", kind: "percent", width: 14 },
          ] as const)
        : []),
    ],
    rows: rows.map((row) => {
      const isSection = row.kind === "section";
      return {
        account: row.label,
        current: isSection ? null : fromMinor(row.current, baseDecimals),
        ...(percentOfIncomeTotals
          ? { currentPercentOfIncome: percentCell(row.current, percentOfIncomeTotals.current, isSection) }
          : {}),
        prior: isSection ? null : fromMinor(row.prior, baseDecimals),
        ...(percentOfIncomeTotals
          ? { priorPercentOfIncome: percentCell(row.prior, percentOfIncomeTotals.prior, isSection) }
          : {}),
        variance: isSection ? null : fromMinor(row.variance, baseDecimals),
        variancePercent: row.variancePercent,
      };
    }),
  };
}
