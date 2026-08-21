import { calendarDayDifference, type WorkQueueItem } from "@/lib/domain/work-queue";
import type { AccountingControl, DerivedQueueItem, QueueSeverity } from "./types";

/**
 * Turning each kind of source into one queue item.
 *
 * The queue's job is to be the single place an accountant looks, so items
 * arrive here from four different worlds — failing controls, the existing
 * dashboard work queue, periods left open, and recurring runs that failed —
 * and leave as one shape. Every builder is pure: what a screen shows is
 * decided here, where it can be tested, rather than in JSX.
 *
 * Nothing invents urgency. An item's severity comes from what its source
 * already proves, and its reason repeats a fact rather than a judgement.
 */

/** A control that needs a person is work; a healthy one is not. */
export function controlFailureItems(
  controls: readonly AccountingControl[],
  confirmedAt: string,
): DerivedQueueItem[] {
  return controls
    .filter((control) => control.status !== "healthy")
    .map((control) => ({
      key: `control:${control.key}`,
      sourceKind: "control-failure" as const,
      sourceId: control.key,
      title: control.title,
      reason:
        control.status === "unavailable"
          ? `${control.detail} Until it runs, this control cannot be reported as passing.`
          : control.detail,
      severity: controlSeverity(control),
      amountMinor: control.differenceMinor,
      // A control describes a state, not an event, so it has no age of its
      // own. Zero keeps it out of the age tie-break rather than pretending.
      ageDays: 0,
      href: control.href,
      actionLabel: "Review",
      confirmedAt,
      blocksClose: control.status === "blocked",
    }));
}

function controlSeverity(control: AccountingControl): QueueSeverity {
  if (control.status === "blocked") return "critical";
  if (control.status === "attention") return "high";
  // Unavailable is real work — someone must find out why the check could not
  // run — but it is not evidence that anything is wrong, so it sits below a
  // control that actually found a difference.
  return "medium";
}

const KIND_MAP = {
  overdue_invoice: {
    sourceKind: "overdue-invoice" as const,
    actionLabel: "Collect",
  },
  due_bill: {
    sourceKind: "bill-due" as const,
    actionLabel: "Pay",
  },
  unreconciled_transaction: {
    sourceKind: "unmatched-bank" as const,
    actionLabel: "Match",
  },
  pending_approval: {
    sourceKind: "pending-approval" as const,
    actionLabel: "Review",
  },
};

/** The existing dashboard queue item, in the cockpit's vocabulary. */
export function workQueueItemToPriority(
  item: WorkQueueItem,
  asOf: string,
  confirmedAt: string,
): DerivedQueueItem {
  const mapped = KIND_MAP[item.kind];
  return {
    key: item.id,
    sourceKind: mapped.sourceKind,
    // The existing queue prefixes its id with the kind; the record's own id is
    // what a destination needs.
    sourceId: item.id.includes(":") ? item.id.slice(item.id.indexOf(":") + 1) : item.id,
    title: item.title,
    reason: `${item.timingLabel} · ${item.subtitle}`,
    // The old queue had three steps and this one has four. `normal` is not
    // low: it is ordinary work that still has to be done, so it maps to
    // medium and leaves low for things that can genuinely wait.
    severity: item.priority === "normal" ? "medium" : item.priority,
    amountMinor: item.amountMinor,
    ageDays: Math.max(0, calendarDayDifference(asOf, item.eventDate)),
    href: item.href,
    actionLabel: mapped.actionLabel,
    confirmedAt,
    blocksClose: false,
  };
}

export function overduePeriodItem(
  period: { id: string; label: string; periodEnd: string },
  asOf: string,
  confirmedAt: string,
): DerivedQueueItem {
  const ageDays = Math.max(0, calendarDayDifference(asOf, period.periodEnd));
  return {
    key: `period:${period.id}`,
    sourceKind: "overdue-period",
    sourceId: period.id,
    title: `${period.label} is still open`,
    // Deliberately not "overdue by": the system holds no close deadline, so
    // the only honest measure is how long the period has been open past the
    // last day it covers.
    reason: `Open ${ageDays} days past the last day it covers.`,
    severity: "high",
    ageDays,
    href: "/settings/periods",
    actionLabel: "Close",
    confirmedAt,
    blocksClose: false,
  };
}

export function recurringFailureItem(
  run: { id: string; templateName: string; runDate: string },
  asOf: string,
  confirmedAt: string,
): DerivedQueueItem {
  return {
    key: `recurring:${run.id}`,
    sourceKind: "recurring-failure",
    sourceId: run.id,
    title: `${run.templateName} did not run`,
    reason: `The scheduled run on ${run.runDate} failed and posted nothing.`,
    severity: "high",
    ageDays: Math.max(0, calendarDayDifference(asOf, run.runDate)),
    href: "/recurring",
    actionLabel: "Open",
    confirmedAt,
    blocksClose: false,
  };
}
