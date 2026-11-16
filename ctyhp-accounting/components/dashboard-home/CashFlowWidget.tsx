"use client";
import { tokenVar } from "@/lib/design/tokens";
import { listWords } from "@/lib/domain/dashboard-home/insights";
import { longMonthName } from "@/lib/domain/dashboard-home/ranges";
import type { HomeCash, HomeStatus } from "@/lib/domain/dashboard-home/types";
import type { SectionEnvelope } from "@/lib/domain/work-surface/types";
import { formatDate } from "@/lib/format";
import CashFlowChart from "./charts/CashFlowChart";
import styles from "./dashboard-home.module.css";
import { lastPostedDay } from "./view";
import { Delta, Empty, LinkButton, Spacer, Swatch, TextLink, Unavailable, Widget } from "./Widget";

const TITLE = "Cash flow";
const INCOME = tokenVar("series.income");
const SECONDARY = tokenVar("series.secondary");

/** What the projection leaves out, said in the sentence above it. */
function leftOut(invoicesMinor: number, billsMinor: number, money: (minor: number) => string): string {
  if (invoicesMinor > 0 && billsMinor > 0) {
    return ` Overdue invoices (${money(invoicesMinor)}) and overdue bills (${money(billsMinor)}) are left out.`;
  }
  if (invoicesMinor > 0) return ` Overdue invoices (${money(invoicesMinor)}) are left out.`;
  if (billsMinor > 0) return ` Overdue bills (${money(billsMinor)}) are left out.`;
  return "";
}

/**
 * Cash flow, the wide card of Overview: cash today and its change this month,
 * six months of month-end cash with money in and out under it, and the next
 * 30 days if customers pay on their due dates. No forecast while the books are
 * behind: it would start from a balance that is out of date.
 */
export default function CashFlowWidget({
  cash,
  status,
  money,
  compact,
}: {
  cash: SectionEnvelope<HomeCash>;
  status: HomeStatus | null;
  money: (minor: number) => string;
  compact: (minor: number) => string;
}) {
  const footer = (
    <>
      <TextLink href="/reports/cash-flow">Cash flow report</TextLink>
      <Spacer />
      <span className={styles.caption}>Last 6 months</span>
    </>
  );
  const data = cash.data;
  if (!data) {
    return (
      <Widget title={TITLE} footer={footer}>
        <Unavailable reason={cash.unavailableReason ?? "Cash flow could not be read."} />
      </Widget>
    );
  }
  if (status?.firstUse) {
    return (
      <Widget title={TITLE}>
        <Empty title="No cash movement yet" action={<LinkButton href="/banking" primary>Connect a bank</LinkButton>}>
          Money in and money out are charted by month from the bank accounts.
        </Empty>
      </Widget>
    );
  }
  const last = data.months.length - 1;
  const today = data.balanceMinor[last] ?? 0;
  const change = last > 0 ? today - data.balanceMinor[last - 1] : 0;
  const behind = status?.behind === true;
  const projection = data.projection;
  const month = data.months[last];

  return (
    <Widget title={TITLE} footer={footer}>
      <div className={styles.hero}>
        <span className={styles.heroValue}>{money(today)}</span>
        <span className={styles.heroSub}>
          {behind || !month?.posted ? (
            status?.postedThrough ? (
              `Cash as of ${formatDate(status.postedThrough)}, the last posted day`
            ) : (
              lastPostedDay(null)
            )
          ) : (
            <>
              Cash today · <Delta minor={change} money={money} /> so far in {longMonthName(month.key)} · in {money(data.inMinor[last])}, out{" "}
              {money(data.outMinor[last])}
            </>
          )}
        </span>
      </div>
      <div className={styles.legend}>
        <span>
          <Swatch line color={INCOME} />
          Cash balance
        </span>
        <span>
          <Swatch color={INCOME} />
          Money in
        </span>
        <span>
          <Swatch color={SECONDARY} />
          Money out
        </span>
        {projection ? (
          <span>
            <Swatch line dashed color={INCOME} />
            Projected
          </span>
        ) : null}
      </div>
      <CashFlowChart
        months={data.months}
        balance={data.balanceMinor}
        inflow={data.inMinor}
        outflow={data.outMinor}
        projection={projection ? { date: projection.through, valueMinor: projection.projectedMinor } : null}
        money={money}
        compact={compact}
      />
      {data.transfersExcluded ? null : <p className={styles.caption}>Transfers between your own accounts count on both sides.</p>}
      {projection ? (
        <div>
          <p className={styles.caption} style={{ marginBottom: 6 }}>
            <b>Next 30 days</b>, to {formatDate(projection.through)}, if customers pay on their due dates.
            {leftOut(projection.overdueLeftOutMinor, projection.overdueBillsLeftOutMinor, money)}
          </p>
          <div className={styles.forecast}>
            <div className={styles.forecastItem}>
              <span>Cash today</span>
              <strong>{money(today)}</strong>
            </div>
            <span className={styles.forecastSign} aria-hidden="true">
              +
            </span>
            <div className={styles.forecastItem}>
              <span>Invoices due</span>
              <strong>{money(projection.invoicesDueMinor)}</strong>
            </div>
            <span className={styles.forecastSign} aria-hidden="true">
              −
            </span>
            <div className={styles.forecastItem}>
              <span>Bills due</span>
              <strong>{money(projection.billsDueMinor)}</strong>
            </div>
            <span className={styles.forecastSign} aria-hidden="true">
              =
            </span>
            <Spacer />
            <div className={`${styles.forecastItem} ${styles.forecastTotal}`}>
              <span>Projected cash</span>
              <strong>{money(projection.projectedMinor)}</strong>
            </div>
          </div>
        </div>
      ) : (
        <Empty title="No forecast while the books are behind">
          {status && status.missingMonths.length > 0
            ? `Import ${listWords(status.missingMonths)} to see the next 30 days.`
            : "Bring the books up to date to see the next 30 days."}
        </Empty>
      )}
    </Widget>
  );
}
