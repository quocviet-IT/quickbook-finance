"use client";
import { Alert, Typography } from "antd";
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import type { SectionDataState } from "@/lib/domain/accounting-dashboard/types";
import styles from "./accounting-dashboard.module.css";

/**
 * How fresh a section is, and what to say when it is not there at all.
 *
 * Shared by every section so that "computed a moment ago", "this is old", and
 * "we could not look" can never be rendered as the same thing — which is
 * exactly what a bare zero used to do.
 */

/** A section older than this is worth flagging; the figures may have moved. */
const STALE_AFTER_MS = 10 * 60 * 1000;

export function freshnessOf(generatedAt: string, now: number = Date.now()): SectionDataState {
  return now - Date.parse(generatedAt) > STALE_AFTER_MS ? "stale" : "fresh";
}

export function timeOnly(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

/** The one-line freshness note that sits under a section's own content. */
export function FreshnessNote({
  generatedAt,
  dataState,
}: {
  generatedAt: string;
  dataState: SectionDataState;
}) {
  const stale = dataState === "stale";
  return (
    <div className={styles.note}>
      {stale ? (
        <ClockCircleOutlined aria-hidden="true" />
      ) : (
        <CheckCircleOutlined aria-hidden="true" />
      )}
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {stale ? "Last computed" : "Computed"} at {timeOnly(generatedAt)}
        {stale ? " — refresh before relying on it." : ""}
      </Typography.Text>
    </div>
  );
}

/** A section that could not be computed. Never rendered as an empty result. */
export function UnavailableNote({ reason }: { reason: string }) {
  return (
    <Alert
      type="warning"
      showIcon
      icon={<WarningOutlined />}
      message="This section is unavailable"
      description={reason}
    />
  );
}

/**
 * Nothing to do — and the reason that is good news, not an empty screen.
 *
 * `evidence` names what was actually checked, because "no exceptions" is only
 * believable when the reader can see what looked for them. The time it was
 * checked comes from the FreshnessNote directly below it.
 */
export function HealthyEmpty({ title, evidence }: { title: string; evidence: string }) {
  return (
    <div className={styles.emptyState}>
      <CheckCircleOutlined
        aria-hidden="true"
        style={{ fontSize: 22, color: "var(--ob-intent-success)" }}
      />
      <div className={styles.emptyTitle}>{title}</div>
      <div className={styles.emptyDetail}>{evidence}</div>
    </div>
  );
}
