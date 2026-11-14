"use client";
import { Skeleton } from "antd";
import StatusTag from "@/components/ui/StatusTag";
import type { HomeClose, HomeCloseStep } from "@/lib/domain/dashboard-home/types";
import type { StatusLook } from "@/lib/domain/status-label";
import styles from "./dashboard-home.module.css";
import { stepsDone } from "./view";
import { Empty, LinkButton, Spacer, TextLink, Unavailable, Widget } from "./Widget";

/** How each step's state reads: a word and a tone, never a colour alone. */
const STEP_LOOKS: Record<HomeCloseStep["status"], StatusLook> = {
  complete: { tone: "positive", label: "Done" },
  outstanding: { tone: "warning", label: "To do" },
  "not-applicable": { tone: "muted", label: "Not applicable" },
  unavailable: { tone: "warning", label: "Could not check" },
};

const CLOSE_HREF = "/accounting?mode=close";

/**
 * Month-end close: the real checklist of the month a close is about (the
 * oldest month that has ended and is still open, else this one), each step
 * with its state and where it is dealt with. Read on the server after the
 * rest of the page has been sent, so it never holds up the figures.
 */
export default function MonthEndClose({
  close = null,
  failure = null,
  loading = false,
}: {
  close?: HomeClose | null;
  /** The safe sentence when the checklist could not be read. */
  failure?: string | null;
  loading?: boolean;
}) {
  const footer = (
    <>
      <TextLink href={CLOSE_HREF}>Close checklist</TextLink>
      <Spacer />
      {close ? (
        <LinkButton href={CLOSE_HREF} primary>
          Continue
        </LinkButton>
      ) : null}
    </>
  );
  if (loading) {
    return (
      <Widget title="Month-end close" footer={footer}>
        <Skeleton active title={false} paragraph={{ rows: 5 }} />
      </Widget>
    );
  }
  if (failure) {
    return (
      <Widget title="Month-end close" footer={footer}>
        <Unavailable reason={failure} />
      </Widget>
    );
  }
  if (!close) {
    return (
      <Widget title="Month-end close" footer={footer}>
        <Empty title="No accounting period covers today." action={<TextLink href={CLOSE_HREF}>Go to period close</TextLink>} />
      </Widget>
    );
  }
  const share = close.applicable > 0 ? (close.complete / close.applicable) * 100 : 0;
  const done = stepsDone(close.complete, close.applicable);
  return (
    <Widget title="Month-end close" footer={footer}>
      <div className={styles.hero}>
        <span className={`${styles.heroValue} ${styles.heroValueSmall}`}>{close.periodLabel}</span>
        <span className={styles.heroSub}>
          {done} · {close.lastClosedLabel ? `last closed ${close.lastClosedLabel}` : "no month closed yet"}
        </span>
      </div>
      <div className={styles.progress} role="img" aria-label={done}>
        <i className={styles.progressFill} style={{ width: `${share}%` }} />
      </div>
      <ul className={styles.rows}>
        {close.steps.map((step) => (
          <li key={step.key} className={`${styles.stepRow} ${step.status === "not-applicable" ? styles.stepAside : ""}`}>
            <span className={styles.stepTitle}>
              <TextLink href={step.href}>{step.title}</TextLink>
            </span>
            <StatusTag status={step.status} looks={STEP_LOOKS} />
          </li>
        ))}
      </ul>
    </Widget>
  );
}
