"use client";

import type { ReactNode } from "react";
import { Tag } from "antd";
import { sourceLabel, sourceTone, type SourceTone } from "@/lib/domain/entry-detail";
import styles from "./report-paper.module.css";

/**
 * A report as the client's prototype lays one out: a sheet of paper headed by
 * the company, the report's name, the dates it covers, and its basis and
 * currency (`paperHead` in Accounting-System-v3.html).
 */
export function ReportPaper({
  companyName,
  title,
  range,
  basis = "Accrual basis",
  currencyCode,
  children,
}: {
  companyName: string;
  title: string;
  range: string;
  basis?: string;
  currencyCode: string;
  children?: ReactNode;
}) {
  return (
    <section className={styles.paper} aria-label={title}>
      <header className={styles.head}>
        <div className={styles.company}>{companyName}</div>
        <div className={styles.reportName}>{title}</div>
        <div className={styles.range}>{range}</div>
        <div className={styles.basis}>
          {basis} · {currencyCode}
        </div>
      </header>
      {children}
    </section>
  );
}

export interface StatItem {
  label: string;
  value: ReactNode;
  /** Shown in the danger colour, as the prototype does for questions raised. */
  danger?: boolean;
}

/** The figures that sit above a report, in one grey band. */
export function StatRow({ items }: { items: StatItem[] }) {
  return (
    <div className={styles.statRow}>
      {items.map((s) => (
        <div key={s.label} className={styles.stat}>
          <span className={styles.statLabel}>{s.label}</span>
          <span className={`${styles.statValue}${s.danger ? ` ${styles.statValueDanger}` : ""}`}>{s.value}</span>
        </div>
      ))}
    </div>
  );
}

export type SectionState = { kind: "found"; count: number } | { kind: "clear" } | { kind: "unavailable" };

/**
 * One check of a review report: its question, how many it found, why it
 * matters, then either what it found or a plain "No exceptions."
 */
export function ReportSection({
  title,
  note,
  state,
  why,
  children,
}: {
  title: string;
  note: ReactNode;
  state: SectionState;
  why: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={styles.section}>
      <div className={styles.sectionHead}>
        <strong className={styles.sectionTitle}>{title}</strong>
        <span className={styles.sectionNote}>{note}</span>
        {state.kind === "found" ? (
          <Tag color="orange">{state.count} to look at</Tag>
        ) : state.kind === "clear" ? (
          <Tag color="green">Nothing found</Tag>
        ) : (
          <Tag color="red">Could not run</Tag>
        )}
      </div>
      <p className={styles.why}>{why}</p>
      {state.kind === "found" ? (
        <div className={styles.det}>{children}</div>
      ) : state.kind === "clear" ? (
        <div className={styles.clear}>No exceptions.</div>
      ) : (
        <div className={styles.muted}>This check could not be run, so it is not saying the books are clear.</div>
      )}
    </div>
  );
}

/** The closing note under a report. */
export function ReportFoot({ children }: { children: ReactNode }) {
  return <div className={styles.foot}>{children}</div>;
}

const TONE_COLOR: Record<SourceTone, string | undefined> = {
  sales: "green",
  purchases: "volcano",
  cash: "cyan",
  ledger: undefined,
};

/** What kind of entry a row is, and its number: the prototype's `typeTag`. */
export function SourceTag({ sourceType, number }: { sourceType: string; number?: string | null }) {
  return (
    <span style={{ whiteSpace: "nowrap" }}>
      <Tag color={TONE_COLOR[sourceTone(sourceType)]} style={{ marginInlineEnd: 6 }}>
        {sourceLabel(sourceType)}
      </Tag>
      {number ? <span className={styles.mono}>{number}</span> : null}
    </span>
  );
}

export { styles as reportPaperStyles };
