import { describe, expect, it } from "vitest";
import {
  matchesFilter,
  transitionProblem,
  type QueueFilter,
} from "@/lib/domain/accounting-dashboard/lifecycle";
import type { PriorityQueueItem } from "@/lib/domain/accounting-dashboard/types";

const ORDINARY = { blocksClose: false };
const BLOCKER = { blocksClose: true };

describe("transitionProblem", () => {
  it("lets a person pick work up and get on with it", () => {
    expect(transitionProblem("new", "acknowledged", ORDINARY, null)).toBeNull();
    expect(transitionProblem("acknowledged", "in_progress", ORDINARY, null)).toBeNull();
    expect(transitionProblem("new", "in_progress", ORDINARY, null)).toBeNull();
  });

  it("lets a person put work back down", () => {
    // Acknowledging then thinking better of it is a normal thing to do, and a
    // queue that only moves forwards makes people avoid touching it at all.
    expect(transitionProblem("in_progress", "acknowledged", ORDINARY, null)).toBeNull();
    expect(transitionProblem("acknowledged", "new", ORDINARY, null)).toBeNull();
  });

  it("refuses a dismissal with no reason", () => {
    expect(transitionProblem("new", "dismissed", ORDINARY, null)).toMatch(/why/i);
    expect(transitionProblem("new", "dismissed", ORDINARY, "   ")).toMatch(/why/i);
    expect(transitionProblem("new", "dismissed", ORDINARY, "Duplicate of INV-9")).toBeNull();
  });

  it("refuses to dismiss something that blocks the close", () => {
    // The one rule the design document states outright: a control that stops a
    // period closing is not a matter of opinion, and dismissing it would hide
    // the reason the close will fail.
    expect(transitionProblem("new", "dismissed", BLOCKER, "Not now")).toMatch(/blocks/i);
  });

  it("refuses to let a person declare something resolved", () => {
    // Resolution belongs to the books. An item goes when its exception goes,
    // and a person saying otherwise would be a claim the ledger contradicts.
    expect(transitionProblem("in_progress", "resolved", ORDINARY, null)).toMatch(
      /books|source|ledger/i,
    );
  });

  it("refuses to reopen something already resolved", () => {
    expect(transitionProblem("resolved", "in_progress", ORDINARY, null)).toMatch(/resolved/i);
  });

  it("lets a dismissal be taken back", () => {
    // Dismissing is a judgement, and a judgement can be wrong.
    expect(transitionProblem("dismissed", "new", ORDINARY, null)).toBeNull();
  });
});

const base: PriorityQueueItem = {
  key: "k",
  sourceKind: "overdue-invoice",
  sourceId: "a",
  title: "INV-1",
  reason: "",
  severity: "high",
  ageDays: 4,
  href: "/invoices",
  actionLabel: "Collect",
  confirmedAt: "2026-08-21T00:00:00Z",
  blocksClose: false,
  lifecycle: "new",
  ownerId: null,
  ownerName: null,
  dueDate: null,
  dismissReason: null,
  stateUpdatedAt: null,
};

const TODAY = "2026-08-21";
const check = (item: Partial<PriorityQueueItem>, filter: QueueFilter, viewer: string | null) =>
  matchesFilter({ ...base, ...item }, filter, viewer, TODAY);

describe("matchesFilter", () => {
  it("shows everything under All, except what has been dismissed", () => {
    expect(check({}, "all", "u1")).toBe(true);
    expect(check({ lifecycle: "dismissed" }, "all", "u1")).toBe(false);
  });

  it("shows a dismissed item only under Dismissed", () => {
    // Hidden from the work, never hidden from the reader.
    expect(check({ lifecycle: "dismissed" }, "dismissed", "u1")).toBe(true);
    expect(check({}, "dismissed", "u1")).toBe(false);
    expect(check({ lifecycle: "dismissed" }, "critical", "u1")).toBe(false);
  });

  it("Mine is the viewer's own work, and nobody else's", () => {
    expect(check({ ownerId: "u1" }, "mine", "u1")).toBe(true);
    expect(check({ ownerId: "u2" }, "mine", "u1")).toBe(false);
    expect(check({ ownerId: null }, "mine", "u1")).toBe(false);
  });

  it("Mine matches nothing when nobody is signed in to be", () => {
    expect(check({ ownerId: "u1" }, "mine", null)).toBe(false);
  });

  it("Unassigned is work nobody has picked up", () => {
    expect(check({ ownerId: null }, "unassigned", "u1")).toBe(true);
    expect(check({ ownerId: "u1" }, "unassigned", "u1")).toBe(false);
  });

  it("Overdue is past the due date somebody set — due today is not late", () => {
    expect(check({ dueDate: "2026-08-20" }, "overdue", "u1")).toBe(true);
    expect(check({ dueDate: TODAY }, "overdue", "u1")).toBe(false);
    expect(check({ dueDate: "2026-08-22" }, "overdue", "u1")).toBe(false);
    // No due date is not overdue. Nobody promised a date, so nothing is late.
    expect(check({ dueDate: null }, "overdue", "u1")).toBe(false);
  });

  it("the source filters read the item's own kind", () => {
    expect(check({ severity: "critical" }, "critical", "u1")).toBe(true);
    expect(check({ severity: "high" }, "critical", "u1")).toBe(false);
    expect(check({ sourceKind: "unmatched-bank" }, "reconciliation", "u1")).toBe(true);
    expect(check({ sourceKind: "pending-approval" }, "approvals", "u1")).toBe(true);
    expect(check({ sourceKind: "overdue-period" }, "period_close", "u1")).toBe(true);
    expect(check({ sourceKind: "control-failure" }, "period_close", "u1")).toBe(false);
  });
});
