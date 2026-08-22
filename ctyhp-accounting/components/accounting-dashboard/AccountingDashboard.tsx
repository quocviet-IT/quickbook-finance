"use client";
import { useMemo } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Alert, Card } from "antd";
import type { AccountingDashboardData } from "@/lib/services/accounting-dashboard";
import type { Assignee } from "@/components/work-surface/WorkItemActions";
import styles from "./accounting-dashboard.module.css";
import AccountingStatusStrip from "./AccountingStatusStrip";
import AccountingInsightList from "./AccountingInsightList";
import ControlHealthPanel from "./ControlHealthPanel";
import PriorityWorkQueue from "./PriorityWorkQueue";
import { freshnessOf } from "./DataStateNote";

/**
 * Loaded only when someone scrolls to it. The design document asks for exactly
 * this — secondary analysis must not be paid for by the first view — and it is
 * the section that carries the table engine and the twelve-month figures.
 */
const SecondaryAnalysis = dynamic(() => import("./SecondaryAnalysis"), {
  loading: () => <Card size="small" title="Secondary analysis" loading />,
});

/**
 * Only ever drawn in close mode, and never fetched in daily mode either — so
 * the common view pays for this section neither in bytes nor in queries.
 */
const ClosePanel = dynamic(() => import("./ClosePanel"), {
  loading: () => <Card size="small" title="Period close" loading />,
});

/**
 * The Accounting Operations Cockpit.
 *
 * The order on this page is the design decision: context, then the work, then
 * the controls that say whether the books are safe, and only then the trends.
 * The page it replaced put four metric cards and a twelve-month chart first
 * and left an accountant scrolling for the queue.
 */
export default function AccountingDashboard({
  data,
  viewerId,
  canManage,
  canClose,
  assignees,
}: {
  data: AccountingDashboardData;
  /** Who is looking, so "Mine" can mean somebody. */
  viewerId: string | null;
  /** A viewer reads the queue and changes nothing. */
  canManage: boolean;
  /** Only an admin may close or reopen; the database enforces it regardless. */
  canClose: boolean;
  assignees: Assignee[];
}) {
  const { context, controls, queue, insights, secondary, close, recommendation, mode } = data;
  // Who holds each blocking control, so the close panel can put the person on
  // the same row as the problem. Taken from the work the queue already carries
  // rather than fetched again — the close step and the queue item are two
  // views of one thing, and two reads could disagree about who owns it.
  const owners = useMemo(() => {
    const byKey: Record<string, string> = {};
    for (const item of queue.data ?? []) {
      if (item.ownerName) byKey[item.key] = item.ownerName;
    }
    return byKey;
  }, [queue]);

  // Freshness is judged in the browser, against the reader's own clock: a
  // server-rendered page left open for an hour is stale even though nothing
  // about the payload changed.
  const { stale, unavailable, generatedAt } = useMemo(() => {
    const sections = [
      { name: "Controls", envelope: controls },
      { name: "Work queue", envelope: queue },
      { name: "Explanations", envelope: insights },
      { name: "Analysis", envelope: secondary },
    ];
    return {
      stale: sections
        .filter(
          (s) =>
            s.envelope.dataState !== "unavailable" &&
            freshnessOf(s.envelope.generatedAt) === "stale",
        )
        .map((s) => s.name),
      unavailable: sections
        .filter((s) => s.envelope.dataState === "unavailable")
        .map((s) => s.name),
      generatedAt: sections
        .map((s) => s.envelope.generatedAt)
        .sort()
        .at(-1) as string,
    };
  }, [controls, queue, insights, secondary]);

  return (
    <div className={styles.root}>
      <AccountingStatusStrip
        context={context}
        generatedAt={generatedAt}
        staleSections={stale}
        unavailableSections={unavailable}
      />

      <div className={styles.modeBar}>
        {/* Links, not a control. The mode lives in the URL, so it is already a
            place rather than a state — and a link is bookmarkable, shareable,
            openable in a new tab, and needs no JavaScript to work. A Segmented
            here would have been a button pretending to be a link. */}
        <nav className={styles.modeToggle} aria-label="Dashboard mode">
          <Link
            href="/accounting"
            className={styles.modeOption}
            aria-current={mode === "daily" ? "page" : undefined}
          >
            Daily
          </Link>
          <Link
            href="/accounting?mode=close"
            className={styles.modeOption}
            aria-current={mode === "close" ? "page" : undefined}
          >
            Period close
          </Link>
        </nav>
        {/* Recommended, never forced. The screen does not know what somebody
            came here to do, and switching the layout under them because a date
            passed would be the page deciding that for them. */}
        {mode === "daily" && recommendation.recommended ? (
          <Alert
            className={styles.modeHint}
            type="warning"
            showIcon
            message={recommendation.reason}
            action={
              <Link href="/accounting?mode=close" className={styles.modeStart}>
                Start the close
              </Link>
            }
          />
        ) : null}
        {mode === "close" && recommendation.sleepingOn ? (
          <Alert
            className={styles.modeHint}
            type="info"
            showIcon
            message={
              <>
                Nothing is overdue, and this company has not said how many days before a period
                ends to start closing it — so nothing here was going to prompt you.{" "}
                <Link href="/settings/work-policy">Set that</Link> and it will.
              </>
            }
          />
        ) : null}
      </div>

      {mode === "close" && close ? (
        <ClosePanel close={close} canClose={canClose} owners={owners} />
      ) : null}

      <div className={styles.body}>
        <div className={styles.queueColumn}>
          {/* No currency props: each item arrives with its amount already
              written, formatted on the server where the currency is known. */}
          <PriorityWorkQueue
            queue={queue}
            controlsEvaluated={controls.dataState !== "unavailable"}
            viewerId={viewerId}
            canManage={canManage}
            assignees={assignees}
            today={context.asOf}
          />
        </div>
        <div className={styles.controlColumn}>
          <ControlHealthPanel
            controls={controls}
            currencyCode={context.currencyCode}
            currencyDecimals={context.currencyDecimals}
          />
        </div>
      </div>

      <AccountingInsightList insights={insights} />

      <SecondaryAnalysis
        secondary={secondary}
        currencyCode={context.currencyCode}
        currencyDecimals={context.currencyDecimals}
      />
    </div>
  );
}
