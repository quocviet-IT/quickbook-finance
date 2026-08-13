import type { ReactNode } from "react";
import {
  CheckCircleFilled,
  ClockCircleFilled,
  ExclamationCircleFilled,
  InfoCircleFilled,
  MinusCircleFilled,
} from "@ant-design/icons";
import { TOKENS } from "./tokens";

/**
 * The whole visual vocabulary for "how is this thing doing".
 *
 * There are 23 status types in this application carrying roughly 40 values —
 * an invoice's `partial`, a user's `offboarded`, a bank connection's
 * `attention_required`. They belong to different domains and will never
 * collapse into one enum, so trying to name them all in one place would only
 * produce a list nobody could keep true.
 *
 * What they do share is how they should look. Five tones cover it, and each
 * screen says which of its own statuses reads as which tone. One visual
 * language, without pretending the domains are one domain.
 *
 * Every tone carries an icon and a label as well as a colour, for the same
 * reason as everywhere else: colour alone fails anyone who cannot separate the
 * hues, and fails everyone on a printout.
 */
export const TONES = ["positive", "neutral", "warning", "danger", "muted"] as const;

export type Tone = (typeof TONES)[number];

export interface ToneToken {
  color: string;
  icon: ReactNode;
  label: string;
}

const TONE: Record<Tone, ToneToken> = {
  positive: { color: TOKENS.intent.success, icon: <CheckCircleFilled />, label: "Good" },
  neutral: { color: TOKENS.intent.info, icon: <InfoCircleFilled />, label: "In progress" },
  warning: { color: TOKENS.intent.warning, icon: <ClockCircleFilled />, label: "Needs attention" },
  danger: { color: TOKENS.intent.danger, icon: <ExclamationCircleFilled />, label: "Problem" },
  muted: { color: TOKENS.text.secondary, icon: <MinusCircleFilled />, label: "Inactive" },
};

export function toneToken(tone: Tone): ToneToken {
  return TONE[tone];
}

/**
 * A tone shown with the caller's own wording.
 *
 * The label on the tone itself is a fallback for describing the tone; what a
 * reader should see is the screen's own word — "Paid", "Offboarded",
 * "Awaiting review" — with the tone supplying only the colour and the icon.
 */
export function ToneBadge({ tone, children }: { tone: Tone; children: string }) {
  const { color, icon } = toneToken(tone);
  return (
    <span style={{ color, display: "inline-flex", alignItems: "center", gap: 6 }}>
      {icon}
      {children}
    </span>
  );
}
