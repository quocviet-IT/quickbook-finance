"use client";
import { Tag, Typography } from "antd";
import { CalendarOutlined, ClockCircleOutlined, WarningOutlined } from "@ant-design/icons";
import type { AccountingDashboardContext } from "@/lib/services/accounting-dashboard";
import styles from "./accounting-dashboard.module.css";
import { timeOnly } from "./DataStateNote";

/**
 * Where the reader is, in one strip: which period, which day, which basis,
 * and how fresh the page is.
 *
 * Deliberately not cards. The old page spent its first screen on four metric
 * cards, two of which nobody can act on, and pushed the work below the fold.
 * Metadata gets a strip; the work gets the space.
 */
export default function AccountingStatusStrip({
  context,
  generatedAt,
  staleSections,
  unavailableSections,
}: {
  context: AccountingDashboardContext;
  generatedAt: string;
  staleSections: string[];
  unavailableSections: string[];
}) {
  const period = context.currentPeriod;
  return (
    <section className={styles.strip} aria-label="Accounting status">
      <div className={styles.stripPeriod}>
        <CalendarOutlined aria-hidden="true" />
        <span>{period ? period.label : `Fiscal year ${context.fiscalYear}`}</span>
        {period ? (
          <Tag color={period.status === "open" ? "blue" : "green"}>{period.status}</Tag>
        ) : (
          <Tag>no period defined</Tag>
        )}
        {period ? (
          // The last day the period covers — never called a close deadline,
          // because the system holds no such date. See the Phase 0 gap record.
          <Typography.Text type="secondary" style={{ fontWeight: 400 }}>
            covers through {period.periodEnd}
          </Typography.Text>
        ) : null}
        {context.overduePeriods.length > 0 ? (
          <Tag
            color="orange"
            icon={<WarningOutlined />}
            title={`${context.overduePeriods
              .map((p) => p.label)
              .join(", ")} — still open after the last day covered`}
          >
            {context.overduePeriods.length} still open
          </Tag>
        ) : null}
      </div>

      <div className={styles.stripFacts}>
        <span className={styles.stripFact}>As of {context.asOf}</span>
        <span className={styles.stripFact}>{context.accountingBasis}</span>
        <span className={styles.stripFact}>{context.currencyCode}</span>
        <span className={styles.stripFact}>{context.timeZone}</span>
        <span className={styles.stripFact}>
          <ClockCircleOutlined aria-hidden="true" /> {timeOnly(generatedAt)}
        </span>
        {unavailableSections.length > 0 ? (
          <Tag color="warning" icon={<WarningOutlined />}>
            {unavailableSections.join(", ")} unavailable
          </Tag>
        ) : null}
        {staleSections.length > 0 ? (
          <Tag icon={<ClockCircleOutlined />}>{staleSections.join(", ")} stale</Tag>
        ) : null}
      </div>
    </section>
  );
}
