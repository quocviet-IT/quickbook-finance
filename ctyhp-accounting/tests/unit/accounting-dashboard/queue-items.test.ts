import { describe, expect, it } from "vitest";
import {
  controlFailureItems,
  overduePeriodItem,
  recurringFailureItem,
  workQueueItemToPriority,
} from "@/lib/domain/accounting-dashboard/queue-items";
import {
  approvalsControl,
  subledgerControl,
  trialBalanceControl,
  unavailableControl,
} from "@/lib/domain/accounting-dashboard/control-status";
import type { WorkQueueItem } from "@/lib/domain/work-queue";

const AT = "2026-08-20T09:00:00Z";
const AS_OF = "2026-08-20";

describe("controlFailureItems", () => {
  it("raises one item per failing control and none for the healthy ones", () => {
    const items = controlFailureItems(
      [
        trialBalanceControl({ balanced: false, differenceMinor: 500, evaluatedAt: AT }),
        subledgerControl("ar-to-gl", { differenceMinor: 0, evaluatedAt: AT }),
        approvalsControl({ pendingCount: 2, oldestAgeDays: 3, evaluatedAt: AT }),
      ],
      AT,
    );
    expect(items.map((i) => i.key)).toEqual([
      "control:trial-balance",
      "control:pending-approvals",
    ]);
  });

  it("makes a blocked control critical and close-blocking, an attention control high", () => {
    const [blocked] = controlFailureItems(
      [trialBalanceControl({ balanced: false, differenceMinor: 1, evaluatedAt: AT })],
      AT,
    );
    expect(blocked).toMatchObject({ severity: "critical", blocksClose: true });

    const [attention] = controlFailureItems(
      [subledgerControl("ap-to-gl", { differenceMinor: 900, evaluatedAt: AT })],
      AT,
    );
    expect(attention).toMatchObject({ severity: "high", blocksClose: false });
  });

  it("raises an unavailable control as work too — an unchecked control is not a passed one", () => {
    const items = controlFailureItems(
      [unavailableControl("inventory-to-gl", "The valuation query failed.", AT)],
      AT,
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ severity: "medium", blocksClose: false });
    // Whatever the caller's wording, the item must end by saying the control
    // is unproven — that sentence is the whole point of raising it.
    expect(items[0].reason).toContain("The valuation query failed.");
    expect(items[0].reason).toMatch(/cannot be reported as passing/i);
  });

  it("carries the control's own difference and destination onto the item", () => {
    const [item] = controlFailureItems(
      [subledgerControl("ar-to-gl", { differenceMinor: 12_34, evaluatedAt: AT })],
      AT,
    );
    expect(item.amountMinor).toBe(1234);
    expect(item.href).toBe("/reports/gl-posting");
    expect(item.confirmedAt).toBe(AT);
  });
});

describe("workQueueItemToPriority", () => {
  const source: WorkQueueItem = {
    id: "overdue_invoice:abc",
    kind: "overdue_invoice",
    title: "INV-000123",
    subtitle: "Daniel Carter",
    eventDate: "2026-07-01",
    amountMinor: 250_00,
    href: "/invoices?queue=overdue&focus=abc",
    priority: "critical",
    timingLabel: "50 days overdue",
  };

  it("keeps the existing queue's title, amount and destination", () => {
    const item = workQueueItemToPriority(source, AS_OF, AT);
    expect(item).toMatchObject({
      sourceKind: "overdue-invoice",
      sourceId: "abc",
      title: "INV-000123",
      amountMinor: 25000,
      href: "/invoices?queue=overdue&focus=abc",
    });
  });

  it("translates the old three-step priority onto the four-step severity", () => {
    expect(workQueueItemToPriority({ ...source, priority: "critical" }, AS_OF, AT).severity).toBe(
      "critical",
    );
    expect(workQueueItemToPriority({ ...source, priority: "high" }, AS_OF, AT).severity).toBe("high");
    expect(workQueueItemToPriority({ ...source, priority: "normal" }, AS_OF, AT).severity).toBe(
      "medium",
    );
  });

  it("derives age from the event date and shows the timing label as the reason", () => {
    const item = workQueueItemToPriority(source, AS_OF, AT);
    expect(item.ageDays).toBe(50);
    expect(item.reason).toContain("50 days overdue");
    expect(item.reason).toContain("Daniel Carter");
  });

  it("never reports a negative age for work that is due in the future", () => {
    const future = { ...source, kind: "due_bill" as const, eventDate: "2026-09-01" };
    expect(workQueueItemToPriority(future, AS_OF, AT).ageDays).toBe(0);
  });

  it("gives each kind its own action label and destination shape", () => {
    const bank = workQueueItemToPriority(
      { ...source, kind: "unreconciled_transaction", id: "unreconciled_transaction:t1" },
      AS_OF,
      AT,
    );
    expect(bank.sourceKind).toBe("unmatched-bank");
    expect(bank.actionLabel).toMatch(/match/i);

    const approval = workQueueItemToPriority(
      { ...source, kind: "pending_approval", id: "pending_approval:p1" },
      AS_OF,
      AT,
    );
    expect(approval.sourceKind).toBe("pending-approval");
    expect(approval.actionLabel).toMatch(/review/i);
  });
});

describe("overduePeriodItem", () => {
  it("is high severity and points at the periods screen", () => {
    const item = overduePeriodItem(
      { label: "July 2026", periodEnd: "2026-07-31", id: "p-07" },
      AS_OF,
      AT,
    );
    expect(item).toMatchObject({
      sourceKind: "overdue-period",
      severity: "high",
      href: "/settings/periods",
      sourceId: "p-07",
    });
    expect(item.ageDays).toBe(20);
    expect(item.title).toContain("July 2026");
  });

  it("says how long the period has been open past its end, not a made-up deadline", () => {
    // The system holds no close deadline. The honest statement is how long the
    // period has been open past the last day it covers.
    const item = overduePeriodItem(
      { label: "June 2026", periodEnd: "2026-06-30", id: "p-06" },
      AS_OF,
      AT,
    );
    expect(item.reason).toMatch(/51 days past the last day it covers/);
  });
});

describe("recurringFailureItem", () => {
  it("is high severity and names the template", () => {
    const item = recurringFailureItem(
      { id: "r1", templateName: "Monthly rent", runDate: "2026-08-15" },
      AS_OF,
      AT,
    );
    expect(item).toMatchObject({ sourceKind: "recurring-failure", severity: "high", sourceId: "r1" });
    expect(item.title).toContain("Monthly rent");
    expect(item.ageDays).toBe(5);
  });
});
