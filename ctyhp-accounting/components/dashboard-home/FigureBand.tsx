"use client";
import type { ReactNode } from "react";
import IntentLink from "@/components/IntentLink";
import { tokenVar } from "@/lib/design/tokens";
import { shortMonthName } from "@/lib/domain/dashboard-home/ranges";
import type { HomeFigures, HomeStatus } from "@/lib/domain/dashboard-home/types";
import type { SectionEnvelope } from "@/lib/domain/work-surface/types";
import Sparkline from "./charts/Sparkline";
import styles from "./dashboard-home.module.css";
import { lastPostedDay, lastPostedIndex, netIncomeLabel, payablesLine, receivablesLine, tiesToLedger, type FigureLine } from "./view";
import { Delta, Unavailable } from "./Widget";

const INCOME = tokenVar("series.income");
const SECONDARY = tokenVar("series.secondary");
const QUIET = tokenVar("series.other");

function Figure({
  label,
  value,
  line,
  href,
  spark,
}: {
  label: string;
  value: string;
  line: ReactNode;
  href: string;
  spark: ReactNode;
}) {
  return (
    <IntentLink href={href} className={styles.kpi}>
      <span className={styles.kpiGrid}>
        <span className={styles.kpiLabel}>{label}</span>
        <span className={styles.kpiRow}>
          <span className={styles.kpiValue}>{value}</span>
          <span className={styles.kpiSpark}>{spark}</span>
        </span>
        <span className={styles.kpiLine}>{line}</span>
      </span>
    </IntentLink>
  );
}

function Line({ line }: { line: FigureLine }) {
  const tone = line.tone === "danger" ? styles.danger : line.tone === "warning" ? styles.warning : undefined;
  return (
    <>
      <span className={tone}>{line.lead}</span>
      {line.rest}
    </>
  );
}

/**
 * The four figures above the tabs: Cash on hand, Net income this month, Owed
 * to you and You owe, each with six months beside it and one line under it,
 * each a link to its report. They read from one section, so they are there or
 * unavailable together; every other card on the page stands on its own.
 */
export default function FigureBand({
  figures,
  status,
  money,
}: {
  figures: SectionEnvelope<HomeFigures>;
  status: HomeStatus | null;
  money: (minor: number) => string;
}) {
  const data = figures.data;
  if (!data) {
    return (
      <div className={styles.bandBox}>
        <div className={styles.band}>
          <div className={styles.bandState}>
            <Unavailable reason={figures.unavailableReason ?? "The four figures could not be read."} />
          </div>
        </div>
      </div>
    );
  }
  const posted = data.months.map((month) => month.posted);
  const firstUse = status?.firstUse === true;
  const behind = status?.behind === true;
  const current = data.months[data.months.length - 1];
  const lastPosted = lastPostedIndex(data.months);

  const cashLine: ReactNode = firstUse ? (
    "Nothing posted yet"
  ) : behind ? (
    lastPostedDay(status?.postedThrough ?? null)
  ) : (
    <>
      <Delta minor={data.cash.changeThisMonthMinor} money={money} /> this month
    </>
  );

  const netLine: ReactNode = firstUse ? (
    "Nothing posted yet"
  ) : current && !current.posted ? (
    <>
      <span className={styles.warning}>Not posted.</span>
      {lastPosted >= 0 ? ` Last posted month: ${shortMonthName(data.months[lastPosted].key)}` : ""}
    </>
  ) : data.netIncome.priorSameDaysMinor === null ? (
    "Month to date"
  ) : (
    <>
      <Delta minor={data.netIncome.valueMinor - data.netIncome.priorSameDaysMinor} money={money} /> {data.netIncome.compareLabel}
    </>
  );

  return (
    <div className={styles.bandBox}>
      <div className={styles.band}>
        <Figure
          label="Cash on hand"
          value={money(data.cash.valueMinor)}
          line={cashLine}
          href="/reports/cash-flow"
          spark={<Sparkline values={data.cash.series} posted={posted} color={INCOME} />}
        />
        <Figure
          label={netIncomeLabel(data.months)}
          value={money(data.netIncome.valueMinor)}
          line={netLine}
          href="/reports?report=pnl"
          spark={<Sparkline values={data.netIncome.series} posted={posted} color={SECONDARY} />}
        />
        <Figure
          label="Owed to you"
          value={money(data.receivables.valueMinor)}
          line={<Line line={receivablesLine(data.receivables, money)} />}
          href="/reports/ar-aging"
          // The six months are the ledger's: beside a figure that does not tie to it they would tell another story.
          spark={tiesToLedger(data.receivables) ? <Sparkline values={data.receivables.series} posted={posted} color={QUIET} /> : null}
        />
        <Figure
          label="You owe"
          value={money(data.payables.valueMinor)}
          line={<Line line={payablesLine(data.payables, money)} />}
          href="/reports/ap-aging"
          spark={tiesToLedger(data.payables) ? <Sparkline values={data.payables.series} posted={posted} color={QUIET} /> : null}
        />
      </div>
    </div>
  );
}
