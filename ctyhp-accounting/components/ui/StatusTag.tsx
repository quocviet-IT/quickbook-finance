"use client";
import type { HTMLAttributes, ReactNode, Ref } from "react";
import {
  CheckCircleFilled,
  ClockCircleFilled,
  EditFilled,
  ExclamationCircleFilled,
  InfoCircleFilled,
  MinusCircleFilled,
  StopFilled,
} from "@ant-design/icons";
import { statusLook, type StatusOverrides, type StatusTone } from "@/lib/domain/status-label";

const TONE_ICON: Record<StatusTone, ReactNode> = {
  positive: <CheckCircleFilled />,
  neutral: <InfoCircleFilled />,
  warning: <ClockCircleFilled />,
  danger: <ExclamationCircleFilled />,
  muted: <MinusCircleFilled />,
};

/** Draft and void share the muted tone; their icons are what tell them apart. */
const CODE_ICON: Record<string, ReactNode> = {
  draft: <EditFilled />,
  void: <StopFilled />,
};

/**
 * A status, the one way every screen shows one: an icon, the word with its
 * first letter capitalized, and the tone's colour on a tint of itself.
 *
 * The word comes from lib/domain/status-label.ts, so a code no screen has
 * named still reads as words ("Not requested"), never as the code. The colours
 * are the theme's variables, so the tag reads in dark mode as well as light;
 * Ant Design's preset tag colours did not.
 *
 * `looks` and `labels` carry a screen's own reading of its domain, such as
 * "Partially received" for a purchase order's `partial`.
 */
export default function StatusTag({
  status,
  looks,
  labels,
  ref,
  ...rest
}: { status: string | null | undefined; ref?: Ref<HTMLSpanElement> } & StatusOverrides &
  Omit<HTMLAttributes<HTMLSpanElement>, "children" | "className">) {
  // The rest of the props reach the span, so a Tooltip or a title can sit on a tag.
  if (!status) return <span ref={ref} {...rest} className="status-tag status-tag--muted">—</span>;
  const { tone, label } = statusLook(status, { looks, labels });
  // The word sits in its own span so a column narrower than the tag shortens
  // the word inside a whole border, never the border around a whole word; the
  // title gives the full word back on hover.
  return (
    <span ref={ref} title={label} {...rest} className={`status-tag status-tag--${tone}`}>
      <span className="status-tag__icon" aria-hidden="true">
        {CODE_ICON[status] ?? TONE_ICON[tone]}
      </span>
      <span className="status-tag__label">{label}</span>
    </span>
  );
}
