import type { ReactNode } from "react";
import { EditFilled, StopFilled } from "@ant-design/icons";
import { toneToken, type Tone } from "./tone";

/**
 * A document status, and the three things a reader needs to tell it apart.
 *
 * Colour alone fails anyone who cannot distinguish the hues, and it fails
 * everyone in a printed report. `void` and `draft` make that concrete here:
 * they deliberately share one muted colour, because a document that is off the
 * ledger reads the same either way — only the icon and the wording separate
 * them.
 *
 * `StatusBadge` below is therefore the way to show a status, and `statusToken`
 * is the exception for the few places that need a raw colour and nothing else
 * (a total tinted by whether it is overdue, say). Reaching for the token where
 * a badge would do is how a status ends up shown in colour alone.
 */
export const STATUS_KEYS = ["posted", "void", "draft", "overdue", "pending"] as const;

export type StatusKey = (typeof STATUS_KEYS)[number];

export interface StatusToken {
  color: string;
  icon: ReactNode;
  label: string;
}

/**
 * Each document status is one of the five tones, wearing its own word.
 *
 * Expressed this way rather than picking colours directly so the application
 * has one visual vocabulary. A status and a tone that disagreed about what
 * "danger" looks like would be the drift this whole wave exists to remove.
 */
const STATUS_TONE: Record<StatusKey, { tone: Tone; label: string; icon?: ReactNode }> = {
  posted: { tone: "positive", label: "Posted" },
  void: { tone: "muted", label: "Void", icon: <StopFilled /> },
  draft: { tone: "muted", label: "Draft", icon: <EditFilled /> },
  overdue: { tone: "danger", label: "Overdue" },
  pending: { tone: "warning", label: "Pending" },
};

const STATUS: Record<StatusKey, StatusToken> = Object.fromEntries(
  (Object.entries(STATUS_TONE) as [StatusKey, { tone: Tone; label: string; icon?: ReactNode }][])
    .map(([key, { tone, label, icon }]) => {
      const base = toneToken(tone);
      return [key, { color: base.color, icon: icon ?? base.icon, label }];
    }),
) as Record<StatusKey, StatusToken>;

export function statusToken(key: StatusKey): StatusToken {
  return STATUS[key];
}

/**
 * A status shown the way a status should be shown: icon, wording and colour
 * together.
 *
 * This exists so that showing a status correctly is less work than showing it
 * incorrectly. Composing the three parts by hand at every call site is what
 * lets one screen quietly drop the icon, and the reader who cannot tell the two
 * muted greys apart never learns which document was voided.
 *
 * Styled inline rather than through a class so the badge carries its own
 * appearance wherever it is dropped, and so this module keeps its single
 * dependency on the icon set.
 */
export function StatusBadge({ status }: { status: StatusKey }) {
  const { color, icon, label } = statusToken(status);
  return (
    <span style={{ color, display: "inline-flex", alignItems: "center", gap: 6 }}>
      {icon}
      {label}
    </span>
  );
}
