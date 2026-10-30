import type { ReactNode } from "react";
import {
  CheckCircleFilled,
  CloseCircleFilled,
  MinusCircleOutlined,
  QuestionCircleOutlined,
} from "@ant-design/icons";
import type { CloseStepStatus } from "@/lib/domain/accounting-dashboard/close-checklist";

/**
 * How a close checklist step's status looks, on the closing screen and in the
 * Month-End Close Log's record of a close (2.84), so the two read alike.
 */
export const CLOSE_STEP_ICON: Record<CloseStepStatus, ReactNode> = {
  complete: <CheckCircleFilled style={{ color: "var(--ob-intent-success)" }} />,
  outstanding: <CloseCircleFilled style={{ color: "var(--ob-intent-danger)" }} />,
  "not-applicable": <MinusCircleOutlined style={{ color: "var(--ob-text-muted)" }} />,
  unavailable: <QuestionCircleOutlined style={{ color: "var(--ob-intent-warning)" }} />,
};

export const CLOSE_STEP_LABEL: Record<CloseStepStatus, string> = {
  complete: "Done",
  outstanding: "Outstanding",
  "not-applicable": "Not applicable",
  unavailable: "Could not check",
};
