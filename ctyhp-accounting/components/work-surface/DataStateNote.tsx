"use client";
import { Alert, Typography } from "antd";
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import type { SectionDataState } from "@/lib/domain/work-surface/types";
import { freshnessOf } from "@/lib/domain/work-surface/freshness";
import styles from "./work-surface.module.css";

/**
 * How fresh a section is, what to say when it is not there at all, and what to
 * say when there is genuinely nothing to do.
 *
 * Shared by every section on every surface so that "computed a moment ago",
 * "this is old", and "we could not look" can never be rendered as the same
 * thing — which is exactly what a bare zero used to do.
 */

// The rule itself is in lib/domain/work-surface/freshness.ts, where it can be
// read and tested without a browser. Re-exported so the components that draw it
// keep importing from one place.
export { freshnessOf };

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
