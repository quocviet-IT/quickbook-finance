"use client";
import { useMemo } from "react";
import dynamic from "next/dynamic";
import { Card } from "antd";
import type { AccountingDashboardData } from "@/lib/services/accounting-dashboard";
import styles from "./accounting-dashboard.module.css";
import AccountingStatusStrip from "./AccountingStatusStrip";
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
 * The Accounting Operations Cockpit.
 *
 * The order on this page is the design decision: context, then the work, then
 * the controls that say whether the books are safe, and only then the trends.
 * The page it replaced put four metric cards and a twelve-month chart first
 * and left an accountant scrolling for the queue.
 */
export default function AccountingDashboard({ data }: { data: AccountingDashboardData }) {
  const { context, controls, queue, secondary } = data;

  // Freshness is judged in the browser, against the reader's own clock: a
  // server-rendered page left open for an hour is stale even though nothing
  // about the payload changed.
  const { stale, unavailable, generatedAt } = useMemo(() => {
    const sections = [
      { name: "Controls", envelope: controls },
      { name: "Work queue", envelope: queue },
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
  }, [controls, queue, secondary]);

  return (
    <div className={styles.root}>
      <AccountingStatusStrip
        context={context}
        generatedAt={generatedAt}
        staleSections={stale}
        unavailableSections={unavailable}
      />

      <div className={styles.body}>
        <div className={styles.queueColumn}>
          <PriorityWorkQueue
            queue={queue}
            currencyCode={context.currencyCode}
            currencyDecimals={context.currencyDecimals}
            controlsEvaluated={controls.dataState !== "unavailable"}
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

      <SecondaryAnalysis
        secondary={secondary}
        currencyCode={context.currencyCode}
        currencyDecimals={context.currencyDecimals}
      />
    </div>
  );
}
