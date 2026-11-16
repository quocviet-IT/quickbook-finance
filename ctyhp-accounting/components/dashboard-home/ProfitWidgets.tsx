"use client";
import { useState } from "react";
import { Button } from "antd";
import { tokenVar } from "@/lib/design/tokens";
import { listWords } from "@/lib/domain/dashboard-home/insights";
import { longMonthName } from "@/lib/domain/dashboard-home/ranges";
import type { HomeMonth, HomePeriod, HomePeriodKey, HomeProfit, HomeStatus } from "@/lib/domain/dashboard-home/types";
import type { SectionEnvelope } from "@/lib/domain/work-surface/types";
import { formatDateRange } from "@/lib/format";
import Donut, { type DonutLine } from "./charts/Donut";
import GroupedBars from "./charts/GroupedBars";
import { sharePercent } from "./charts/geometry";
import styles from "./dashboard-home.module.css";
import { formatChange, lastPostedIndex, percentChange } from "./view";
import { Delta, Empty, LinkButton, PercentDelta, PeriodSelect, Swatch, TextLink, Unavailable, Widget } from "./Widget";

const INCOME = tokenVar("series.income");
const SECONDARY = tokenVar("series.secondary");
/** The ring's colors, in the order the lines come: the four largest accounts, then everything else. */
const DONUT_COLORS = [
  tokenVar("series.income"),
  tokenVar("series.secondary"),
  tokenVar("series.net"),
  tokenVar("series.governance"),
  tokenVar("series.other"),
];

type Money = (minor: number) => string;

interface ProfitProps {
  profit: SectionEnvelope<HomeProfit>;
  status: HomeStatus | null;
  money: Money;
  compact: Money;
}

/** "November 2026" */
function monthLabel(month: HomeMonth): string {
  return `${longMonthName(month.key)} ${month.year}`;
}

/** The month a one-month period is about, when it has not been entered yet; null for any other period. */
function unpostedMonth(months: readonly HomeMonth[], key: HomePeriodKey): HomeMonth | null {
  const month = key === "month" ? months[months.length - 1] : key === "lastMonth" ? months[months.length - 2] : undefined;
  return month && !month.posted ? month : null;
}

function rangeOf(period: HomePeriod): string {
  return formatDateRange(period.from, period.to);
}

function ChangeLine({ current, prior, period, good }: { current: number; prior: number | null; period: HomePeriod; good: "up" | "down" }) {
  const change = percentChange(current, prior);
  if (change === null) return null;
  return (
    <span className={styles.heroSub}>
      <PercentDelta percent={change} good={good} /> {period.compareLabel}
    </span>
  );
}

/* ------------------------------------------------------------ profit and loss */

/**
 * Profit and loss: net income for the chosen period against the same days of
 * the period before, six months of income and expenses, and each with its
 * change. A month not entered yet says so rather than reading as a zero.
 */
export function ProfitAndLossWidget({ profit, status, money, compact }: ProfitProps) {
  const [key, setKey] = useState<HomePeriodKey>("month");
  const extra = <PeriodSelect value={key} onChange={setKey} label="Period for Profit and loss" />;
  const footer = <TextLink href="/reports?report=pnl">Profit and loss</TextLink>;
  const data = profit.data;
  if (!data) {
    return (
      <Widget title="Profit and loss" extra={extra} footer={footer}>
        <Unavailable reason={profit.unavailableReason ?? "Profit and loss could not be read."} />
      </Widget>
    );
  }
  if (status?.firstUse) {
    return (
      <Widget title="Profit and loss" extra={extra}>
        <Empty title="Nothing posted yet" action={<LinkButton href="/banking?import=1">Import bank lines</LinkButton>}>
          Net income appears once invoices, bills or coded bank lines are posted.
        </Empty>
      </Widget>
    );
  }
  const period = data.periods[key];
  const hero = (
    <div className={styles.hero}>
      <span className={styles.heroValue}>{money(period.netMinor)}</span>
      <span className={styles.heroSub}>Net income · {rangeOf(period)}</span>
      {period.prior && !unpostedMonth(data.months, key) ? (
        <span className={styles.heroSub}>
          <Delta minor={period.netMinor - period.prior.netMinor} money={money} /> {period.compareLabel}
          {period.prior.netMinor < 0 ? ` (a loss of ${money(-period.prior.netMinor)})` : ""}
        </span>
      ) : null}
    </div>
  );

  const missing = unpostedMonth(data.months, key);
  if (missing) {
    const lastPosted = lastPostedIndex(data.months);
    const lastNet = lastPosted >= 0 ? data.incomeMinor[lastPosted] - data.expenseMinor[lastPosted] : null;
    const canShowLastMonth = key === "month" && data.months[data.months.length - 2]?.posted === true;
    return (
      <Widget title="Profit and loss" extra={extra} footer={footer}>
        {hero}
        <Empty
          title={`${longMonthName(missing.key)} is not posted`}
          action={
            canShowLastMonth ? (
              <Button size="small" onClick={() => setKey("lastMonth")}>
                Show last month
              </Button>
            ) : null
          }
        >
          {lastPosted >= 0 && lastNet !== null
            ? `The last posted month is ${monthLabel(data.months[lastPosted])}: ${
                lastNet < 0 ? `a loss of ${money(-lastNet)}` : `net income of ${money(lastNet)}`
              }.`
            : "No month on the chart is posted yet."}
        </Empty>
      </Widget>
    );
  }

  const income = period.incomeMinor;
  const expense = period.expenseMinor;
  const incomeChange = percentChange(income, period.prior?.incomeMinor);
  const expenseChange = percentChange(expense, period.prior?.expenseMinor);
  return (
    <Widget title="Profit and loss" extra={extra} footer={footer}>
      {hero}
      <GroupedBars
        months={data.months}
        series={[
          { key: "income", label: "Income", values: data.incomeMinor, color: INCOME },
          { key: "expenses", label: "Expenses", values: data.expenseMinor, color: SECONDARY },
        ]}
        money={money}
        compact={compact}
        label={`Income and expenses by month, for the last six months. ${period.label}: income ${money(income)}, expenses ${money(expense)}.`}
        caption="Income and expenses by month"
      />
      <div className={styles.legendGrid}>
        <Swatch color={INCOME} />
        <span>Income</span>
        <span className={styles.legendShare}>{incomeChange === null ? "" : formatChange(incomeChange)}</span>
        <span className={styles.legendAmount}>{money(income)}</span>
        <Swatch color={SECONDARY} />
        <span>Expenses</span>
        <span className={styles.legendShare}>{expenseChange === null ? "" : formatChange(expenseChange)}</span>
        <span className={styles.legendAmount}>{money(expense)}</span>
      </div>
    </Widget>
  );
}

/* ------------------------------------------------------------------ expenses */

/**
 * Expenses by account for the chosen period: the four largest accounts and
 * everything else, as a ring and a list. "Everything else" can be below zero
 * (a discount account larger than the small expenses): the ring draws only
 * what is above zero, the list shows every line, and the total is the real one.
 */
export function ExpensesWidget({ profit, status, money, compact }: ProfitProps) {
  const [key, setKey] = useState<HomePeriodKey>("month");
  const extra = <PeriodSelect value={key} onChange={setKey} label="Period for Expenses" />;
  const footer = <TextLink href="/reports?report=pnl">Profit and loss</TextLink>;
  const data = profit.data;
  if (!data) {
    return (
      <Widget title="Expenses" extra={extra} footer={footer}>
        <Unavailable reason="Expenses could not be read." />
      </Widget>
    );
  }
  if (status?.firstUse) {
    return (
      <Widget title="Expenses" extra={extra}>
        <Empty title="No spending recorded yet">Expenses are grouped by account as bills and bank lines are posted.</Empty>
      </Widget>
    );
  }
  const period = data.periods[key];
  const hero = (
    <div className={styles.hero}>
      <span className={styles.heroValue}>{money(period.expenseMinor)}</span>
      <span className={styles.heroSub}>Spent · {rangeOf(period)}</span>
      {unpostedMonth(data.months, key) ? null : (
        <ChangeLine current={period.expenseMinor} prior={period.prior?.expenseMinor ?? null} period={period} good="down" />
      )}
    </div>
  );
  const missing = unpostedMonth(data.months, key);
  if (missing) {
    const months = status && status.missingMonths.length > 0 ? listWords(status.missingMonths) : longMonthName(missing.key);
    return (
      <Widget title="Expenses" extra={extra} footer={footer}>
        {hero}
        <Empty title={key === "month" ? "Nothing posted this month" : "Nothing posted last month"}>
          Bills and bank lines for {months} are not entered yet.
        </Empty>
      </Widget>
    );
  }
  if (period.expenses.length === 0) {
    return (
      <Widget title="Expenses" extra={extra} footer={footer}>
        {hero}
        <Empty title="Nothing spent in this period">Expenses are grouped by account as bills and bank lines are posted.</Empty>
      </Widget>
    );
  }
  const lines: DonutLine[] = period.expenses.map((line, i) => ({
    key: line.accountId ?? `${line.name}-${i}`,
    name: line.name,
    amountMinor: line.amountMinor,
    color: DONUT_COLORS[i] ?? DONUT_COLORS[DONUT_COLORS.length - 1],
  }));
  const total = period.expenseMinor;
  return (
    <Widget title="Expenses" extra={extra} footer={footer}>
      {hero}
      <div className={styles.donutLayout}>
        <Donut
          lines={lines}
          totalMinor={total}
          money={money}
          compact={compact}
          word="spent"
          label={`Expenses by account, ${period.label.toLowerCase()}: ${lines
            .map((line) => `${line.name} ${money(line.amountMinor)}`)
            .join(", ")}. Total ${money(total)}.`}
          caption="Expenses by account"
        />
        <div className={styles.legendGrid}>
          {lines.map((line) => {
            const share = sharePercent(line.amountMinor, total);
            return (
              <LegendRow
                key={line.key}
                color={line.amountMinor > 0 ? line.color : undefined}
                name={line.name}
                share={share === null ? "" : `${share}%`}
                amount={money(line.amountMinor)}
              />
            );
          })}
          <span className={styles.legendTotal} />
          <span className={styles.legendTotal}>Total</span>
          <span className={styles.legendTotal} />
          <span className={`${styles.legendTotal} ${styles.legendAmount}`}>{money(total)}</span>
        </div>
      </div>
    </Widget>
  );
}

function LegendRow({ color, name, share, amount }: { color?: string; name: string; share: string; amount: string }) {
  return (
    <>
      <Swatch color={color} empty={!color} />
      <span className={styles.legendName}>{name}</span>
      <span className={styles.legendShare}>{share}</span>
      <span className={styles.legendAmount}>{amount}</span>
    </>
  );
}

/* --------------------------------------------------------------------- sales */

/** Sales: income from sales (other income left out) for the chosen period, and six months of it. */
export function SalesWidget({ profit, status, money, compact }: ProfitProps) {
  const [key, setKey] = useState<HomePeriodKey>("month");
  const extra = <PeriodSelect value={key} onChange={setKey} label="Period for Sales" />;
  const footer = <TextLink href="/reports/sales-by-customer">Sales by customer</TextLink>;
  const data = profit.data;
  if (!data) {
    return (
      <Widget title="Sales" extra={extra} footer={footer}>
        <Unavailable reason="Sales could not be read." />
      </Widget>
    );
  }
  if (status?.firstUse) {
    return (
      <Widget title="Sales" extra={extra}>
        <Empty title="No sales yet" action={<LinkButton href="/invoices?new=1">Create invoice</LinkButton>}>
          Sales are charted by month as invoices are posted.
        </Empty>
      </Widget>
    );
  }
  const period = data.periods[key];
  const missing = unpostedMonth(data.months, key);
  const change = missing ? null : percentChange(period.salesMinor, period.prior?.salesMinor);
  return (
    <Widget title="Sales" extra={extra} footer={footer}>
      <div className={styles.hero}>
        <span className={styles.heroValue}>{money(period.salesMinor)}</span>
        <span className={styles.heroSub}>
          {period.label} · {rangeOf(period)}
        </span>
        {missing ? (
          <span className={styles.heroSub}>
            <span className={styles.warning}>Not posted.</span> {longMonthName(missing.key)} is not entered yet.
          </span>
        ) : change === null ? null : (
          <span className={styles.heroSub}>
            <PercentDelta percent={change} /> {period.compareLabel}
          </span>
        )}
      </div>
      <GroupedBars
        months={data.months}
        series={[{ key: "sales", label: "Sales", values: data.salesMinor, color: INCOME }]}
        money={money}
        compact={compact}
        height={180}
        toDate
        label={`Sales by month, for the last six months; the last month is to date. ${period.label}: ${money(period.salesMinor)}.`}
        caption="Sales by month"
      />
    </Widget>
  );
}
