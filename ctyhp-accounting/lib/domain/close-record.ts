/**
 * The month-end checklist as it stood when a month was closed (2.84,
 * migration 0180): kept on the close's own event, and read back by the
 * Month-End Close Log.
 *
 * Only what a reader needs later is kept: which check, what it found, and
 * whether it stops a close. Links and work-queue keys belong to the screen of
 * the day and are left out.
 */
import { plural } from "@/lib/format";
import type { CloseStep, CloseStepStatus } from "./accounting-dashboard/close-checklist";

export interface RecordedCloseStep {
  key: string;
  title: string;
  status: CloseStepStatus;
  /** What the check found, in its own words at the time. */
  evidence: string;
  blocksClose: boolean;
}

const STATUSES: readonly CloseStepStatus[] = ["complete", "outstanding", "not-applicable", "unavailable"];
const EVIDENCE_MAX = 600;

/** The steps as they are kept with the close. */
export function checklistRecord(steps: readonly CloseStep[]): RecordedCloseStep[] {
  return steps.map((step) => ({
    key: step.key,
    title: step.title,
    status: step.status,
    evidence: step.evidence.length > EVIDENCE_MAX ? `${step.evidence.slice(0, EVIDENCE_MAX - 1)}…` : step.evidence,
    blocksClose: step.blocksClose,
  }));
}

/** A stored checklist read back; null when the close kept none, or kept something this cannot read. */
export function readChecklist(raw: unknown): RecordedCloseStep[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const steps: RecordedCloseStep[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const step = item as Record<string, unknown>;
    if (typeof step.key !== "string" || typeof step.title !== "string") return null;
    if (!STATUSES.includes(step.status as CloseStepStatus)) return null;
    steps.push({
      key: step.key,
      title: step.title,
      status: step.status as CloseStepStatus,
      evidence: typeof step.evidence === "string" ? step.evidence : "",
      blocksClose: step.blocksClose === true,
    });
  }
  return steps;
}

/** "9 of 11 complete, 2 outstanding": what the checklist said, in one line. */
export function checklistSummary(steps: readonly RecordedCloseStep[]): string {
  const count = (status: CloseStepStatus) => steps.filter((step) => step.status === status).length;
  const complete = count("complete");
  const outstanding = count("outstanding");
  const unchecked = count("unavailable");
  const applicable = complete + outstanding;
  const parts = [applicable === 0 ? "Nothing to check" : `${complete} of ${applicable} complete`];
  if (outstanding > 0) parts.push(`${outstanding} outstanding`);
  if (unchecked > 0) parts.push(`${plural(unchecked, "check")} could not run`);
  return parts.join(", ");
}

/** Said on a close that kept no checklist: one from before 2.84, or made without the closing screen. */
export const NO_CHECKLIST_KEPT = "No checklist kept";
