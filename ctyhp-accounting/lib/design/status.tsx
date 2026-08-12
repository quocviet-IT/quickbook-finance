import type { ReactNode } from "react";
import {
  CheckCircleFilled,
  ClockCircleFilled,
  EditFilled,
  ExclamationCircleFilled,
  StopFilled,
} from "@ant-design/icons";
import { TOKENS } from "./tokens";

/**
 * A document status, and the three things a reader needs to tell it apart.
 *
 * The colour is never returned on its own. Colour alone fails anyone who cannot
 * distinguish the hues, and it fails everyone in a printed report — so asking
 * this module for a status colour hands back the icon and the wording with it,
 * and a caller cannot take the colour while leaving the other two behind.
 */
export const STATUS_KEYS = ["posted", "void", "draft", "overdue", "pending"] as const;

export type StatusKey = (typeof STATUS_KEYS)[number];

export interface StatusToken {
  color: string;
  icon: ReactNode;
  label: string;
}

const STATUS: Record<StatusKey, StatusToken> = {
  posted: { color: TOKENS.intent.success, icon: <CheckCircleFilled />, label: "Posted" },
  void: { color: TOKENS.text.secondary, icon: <StopFilled />, label: "Void" },
  draft: { color: TOKENS.text.secondary, icon: <EditFilled />, label: "Draft" },
  overdue: { color: TOKENS.intent.danger, icon: <ExclamationCircleFilled />, label: "Overdue" },
  pending: { color: TOKENS.intent.warning, icon: <ClockCircleFilled />, label: "Pending" },
};

export function statusToken(key: StatusKey): StatusToken {
  return STATUS[key];
}
