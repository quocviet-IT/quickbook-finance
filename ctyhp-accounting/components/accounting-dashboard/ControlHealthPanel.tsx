"use client";
import Link from "next/link";
import { Card, Typography } from "antd";
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  QuestionCircleOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import type {
  AccountingControl,
  ControlStatus,
  SectionEnvelope,
} from "@/lib/domain/accounting-dashboard/types";
import { formatMoney } from "@/lib/format";
import styles from "./accounting-dashboard.module.css";
import { FreshnessNote, UnavailableNote } from "./DataStateNote";

/**
 * Whether the books are safe, in the order an accountant asks.
 *
 * Every row carries an icon, the word for its state, the condition it passes
 * on, and the figure it found. Colour agrees with all of that; it never has to
 * carry it alone, which is the rule the design document sets for status.
 */

const STATUS_PRESENTATION: Record<
  ControlStatus,
  { icon: typeof CheckCircleOutlined; word: string; className: string }
> = {
  healthy: { icon: CheckCircleOutlined, word: "Passed", className: styles.healthy },
  attention: { icon: WarningOutlined, word: "Needs attention", className: styles.attention },
  blocked: { icon: CloseCircleOutlined, word: "Blocked", className: styles.blocked },
  unavailable: {
    icon: QuestionCircleOutlined,
    word: "Not evaluated",
    className: styles.unavailable,
  },
};

/** Failures first: the rail is read top-down and the top is the alarm. */
const STATUS_ORDER: Record<ControlStatus, number> = {
  blocked: 0,
  attention: 1,
  unavailable: 2,
  healthy: 3,
};

export default function ControlHealthPanel({
  controls,
  currencyCode,
  currencyDecimals,
}: {
  controls: SectionEnvelope<AccountingControl[]>;
  currencyCode: string;
  currencyDecimals: number;
}) {
  const rows = [...(controls.data ?? [])].sort(
    (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status],
  );

  return (
    <Card size="small" title="Control health" className="accounting-control-health">
      {controls.dataState === "unavailable" || !controls.data ? (
        <UnavailableNote
          reason={
            controls.unavailableReason ?? "The accounting controls could not be evaluated."
          }
        />
      ) : (
        <div className={styles.controlList}>
          {rows.map((control) => {
            const presentation = STATUS_PRESENTATION[control.status];
            const Icon = presentation.icon;
            return (
              <div
                key={control.key}
                className={`${styles.controlRow} ${presentation.className}`}
              >
                <Icon className={styles.controlIcon} aria-hidden="true" />
                <div className={styles.controlBody}>
                  <div className={styles.controlHead}>
                    <Link href={control.href} className={styles.controlName}>
                      {control.title}
                    </Link>
                    <span className={styles.controlDifference}>
                      {/* The word carries the state; the amount is evidence. */}
                      {presentation.word}
                      {control.differenceMinor !== undefined && control.differenceMinor !== 0
                        ? ` · ${formatMoney(control.differenceMinor, currencyCode, currencyDecimals)}`
                        : ""}
                    </span>
                  </div>
                  <Typography.Text className={styles.controlDetail}>
                    {control.detail}
                  </Typography.Text>
                  <Typography.Text className={styles.controlPass}>
                    Passes when: {control.passCondition}
                  </Typography.Text>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {controls.data ? (
        <FreshnessNote generatedAt={controls.generatedAt} dataState={controls.dataState} />
      ) : null}
    </Card>
  );
}
