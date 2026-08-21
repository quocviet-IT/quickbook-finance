"use client";
import Link from "next/link";
import { Alert, Button, Card, Tag, Typography } from "antd";
import { ArrowRightOutlined } from "@ant-design/icons";
import { POLICY_FIELD_LABEL, ruleNeeds } from "@/lib/domain/accounting-dashboard/policy";
import type { QueueSeverity, SectionEnvelope } from "@/lib/domain/accounting-dashboard/types";
import type { InsightSection } from "@/lib/services/accounting-dashboard";
import styles from "./accounting-dashboard.module.css";
import { FreshnessNote, HealthyEmpty, UnavailableNote } from "./DataStateNote";

/**
 * What changed and why — and, where a rule cannot say, that it cannot.
 *
 * Every line here comes from a rule in `insight-rules.ts`, and every one shows
 * its evidence beside it. That pairing is the point: a reader who does not
 * believe a sentence can check the numbers it was built from without leaving
 * the page, and a sentence that could not be checked would not belong here.
 *
 * The sleeping-rules notice is not an apology. A rule that never fires because
 * nobody set its policy is invisible, and an invisible rule makes a page look
 * complete when it is not.
 */

const SEVERITY_TAG: Record<QueueSeverity, { color: string; label: string }> = {
  critical: { color: "red", label: "Critical" },
  high: { color: "orange", label: "High" },
  medium: { color: "blue", label: "Worth knowing" },
  low: { color: "default", label: "Minor" },
};

export default function AccountingInsightList({
  insights,
}: {
  insights: SectionEnvelope<InsightSection>;
}) {
  if (insights.dataState === "unavailable" || !insights.data) {
    return (
      <Card size="small" title="What changed and why">
        <UnavailableNote
          reason={insights.unavailableReason ?? "The explanations could not be worked out."}
        />
      </Card>
    );
  }

  const { insights: rows, sleeping } = insights.data;

  return (
    <Card size="small" title="What changed and why" className="accounting-insights">
      {rows.length === 0 ? (
        <HealthyEmpty
          title="Nothing has changed that needs explaining"
          evidence="Every rule ran and none of them found anything worth raising."
        />
      ) : (
        <ul className={styles.insightList}>
          {rows.map((insight) => (
            <li key={insight.id} className={styles.insightRow}>
              <div className={styles.insightHead}>
                <Tag color={SEVERITY_TAG[insight.severity].color}>
                  {SEVERITY_TAG[insight.severity].label}
                </Tag>
                <span className={styles.insightTitle}>{insight.title}</span>
                {/* The rule that said it, so a disagreement has something to
                    point at rather than being an argument with the screen. */}
                <span className={styles.insightRule}>{insight.ruleKey}</span>
              </div>

              <Typography.Paragraph className={styles.insightSummary}>
                {insight.summary}
              </Typography.Paragraph>

              <div className={styles.insightEvidence}>
                {insight.evidence.map((item, index) => (
                  <span key={index} className={styles.insightChip}>
                    <span className={styles.insightChipLabel}>{item.label}</span>
                    {item.href ? (
                      <Link href={item.href}>{item.value}</Link>
                    ) : (
                      <span>{item.value}</span>
                    )}
                  </span>
                ))}
                <Link href={insight.recommendedAction.href} className={styles.insightAction}>
                  <Button size="small" type="primary" ghost>
                    {insight.recommendedAction.label}{" "}
                    <ArrowRightOutlined aria-hidden="true" />
                  </Button>
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}

      {sleeping.length > 0 ? (
        <Alert
          className={styles.insightSleeping}
          type="info"
          showIcon
          message={`${sleeping.length} rule(s) cannot run yet`}
          description={
            <>
              {sleeping.map((ruleKey) => {
                const field = ruleNeeds(ruleKey);
                return (
                  <div key={ruleKey}>
                    <code>{ruleKey}</code> is waiting on{" "}
                    {field ? POLICY_FIELD_LABEL[field] : "a policy"}.
                  </div>
                );
              })}
              <div style={{ marginTop: 6 }}>
                <Link href="/settings/work-policy">Set the work policy</Link> and they will start
                reporting. Until then they say nothing, rather than judging by a number nobody
                chose.
              </div>
            </>
          }
        />
      ) : null}

      <FreshnessNote generatedAt={insights.generatedAt} dataState={insights.dataState} />
    </Card>
  );
}
