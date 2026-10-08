"use client";

import type { ReactNode } from "react";
import { Alert } from "antd";
import { CheckCircleOutlined } from "@ant-design/icons";
import { reportPaperStyles as styles } from "@/components/reports/ReportPaper";
import type { TieOut } from "@/lib/domain/tie-out";

/**
 * A report's proof line, under its total: what the total has to equal, and
 * either that it does or by how much it does not. A gap is shown as a warning,
 * with what usually causes it, never smoothed over.
 */
export default function ProofLine({
  against,
  tie,
  money,
  whenOut,
}: {
  /** What the total is held to: "the A/R control account", "Income on the Profit and Loss". */
  against: string;
  tie: TieOut;
  money: (minor: number) => string;
  /** What usually causes a gap, said under the warning. */
  whenOut: ReactNode;
}) {
  if (tie.agrees) {
    return (
      <div className={styles.foot}>
        <CheckCircleOutlined aria-hidden="true" style={{ marginInlineEnd: 6 }} />
        The total equals {against}: {money(tie.expectedMinor)}.
      </div>
    );
  }
  return (
    <Alert
      type="warning"
      showIcon
      style={{ marginTop: 16 }}
      title={`The total does not equal ${against} (${money(tie.expectedMinor)}): it is out by ${money(tie.differenceMinor)}.`}
      description={whenOut}
    />
  );
}
