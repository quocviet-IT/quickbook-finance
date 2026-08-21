import { describe, expect, it } from "vitest";
import { orderQueue } from "@/lib/domain/accounting-dashboard/priority";
import type { DerivedQueueItem } from "@/lib/domain/accounting-dashboard/types";

const base = {
  sourceId: null,
  title: "",
  reason: "",
  href: "/x",
  actionLabel: "Open",
  confirmedAt: "2026-08-20T00:00:00Z",
  blocksClose: false,
} satisfies Omit<DerivedQueueItem, "key" | "sourceKind" | "severity" | "ageDays">;

describe("orderQueue", () => {
  it("puts a close-blocking control failure first, whatever its age", () => {
    const out = orderQueue([
      {
        ...base,
        key: "old",
        sourceKind: "overdue-invoice",
        severity: "critical",
        ageDays: 90,
        amountMinor: 1,
      },
      {
        ...base,
        key: "tb",
        sourceKind: "control-failure",
        severity: "high",
        ageDays: 0,
        blocksClose: true,
      },
    ]);
    expect(out.map((i) => i.key)).toEqual(["tb", "old"]);
  });

  it("orders by severity, then age descending, then amount descending", () => {
    const out = orderQueue([
      { ...base, key: "a", sourceKind: "bill-due", severity: "high", ageDays: 3, amountMinor: 100 },
      { ...base, key: "b", sourceKind: "bill-due", severity: "critical", ageDays: 1, amountMinor: 5 },
      { ...base, key: "c", sourceKind: "bill-due", severity: "high", ageDays: 9, amountMinor: 1 },
      { ...base, key: "d", sourceKind: "bill-due", severity: "high", ageDays: 9, amountMinor: 700 },
    ]);
    expect(out.map((i) => i.key)).toEqual(["b", "d", "c", "a"]);
  });

  it("treats a non-blocking control failure by severity like anything else", () => {
    // Only a control that can block the close jumps the queue. A control that
    // merely needs attention takes its turn on severity, or the rule would
    // hand every advisory check the top of the page.
    const out = orderQueue([
      {
        ...base,
        key: "critical-invoice",
        sourceKind: "overdue-invoice",
        severity: "critical",
        ageDays: 5,
      },
      {
        ...base,
        key: "advisory-control",
        sourceKind: "control-failure",
        severity: "medium",
        ageDays: 5,
        blocksClose: false,
      },
    ]);
    expect(out.map((i) => i.key)).toEqual(["critical-invoice", "advisory-control"]);
  });

  it("is stable for identical rank — the same input twice gives the same output", () => {
    const items: DerivedQueueItem[] = [
      { ...base, key: "x", sourceKind: "bill-due", severity: "high", ageDays: 2 },
      { ...base, key: "y", sourceKind: "bill-due", severity: "high", ageDays: 2 },
    ];
    expect(orderQueue(items).map((i) => i.key)).toEqual(orderQueue(items).map((i) => i.key));
  });

  it("never mutates its input", () => {
    const items: DerivedQueueItem[] = [
      { ...base, key: "x", sourceKind: "bill-due", severity: "low", ageDays: 1 },
      { ...base, key: "y", sourceKind: "bill-due", severity: "critical", ageDays: 1 },
    ];
    orderQueue(items);
    expect(items[0].key).toBe("x");
  });

  it("sorts an item with no amount below one that has an amount, all else equal", () => {
    // An amount is supporting information, never the reason something is
    // urgent — but between two otherwise identical rows, the one carrying
    // money is the one worth reading first.
    const out = orderQueue([
      { ...base, key: "no-amount", sourceKind: "pending-approval", severity: "high", ageDays: 4 },
      {
        ...base,
        key: "with-amount",
        sourceKind: "pending-approval",
        severity: "high",
        ageDays: 4,
        amountMinor: 50_00,
      },
    ]);
    expect(out.map((i) => i.key)).toEqual(["with-amount", "no-amount"]);
  });
});
