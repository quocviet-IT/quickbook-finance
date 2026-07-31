import { describe, expect, it } from "vitest";
import {
  addIsoDays,
  buildWorkQueueItems,
  calendarDayDifference,
  type WorkQueueSource,
} from "@/lib/domain/work-queue";

describe("accounting work queue", () => {
  it("uses calendar dates without local-time drift", () => {
    expect(addIsoDays("2026-07-28", 7)).toBe("2026-08-04");
    expect(addIsoDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(calendarDayDifference("2026-08-04", "2026-07-28")).toBe(7);
  });

  it("prioritizes aging and preserves an actionable timing label", () => {
    const sources: WorkQueueSource[] = [
      {
        id: "bill-upcoming",
        kind: "due_bill",
        title: "BILL-105",
        subtitle: "Gemstone Supply",
        eventDate: "2026-08-02",
        amountMinor: 100_00,
        href: "/bills",
      },
      {
        id: "approval",
        kind: "pending_approval",
        title: "Manual journal entry",
        subtitle: "manual journal entry",
        eventDate: "2026-07-25",
        amountMinor: 500_00,
        href: "/approvals",
      },
      {
        id: "bank",
        kind: "unreconciled_transaction",
        title: "Card settlement",
        subtitle: "Operating account",
        eventDate: "2026-07-18",
        amountMinor: 850_00,
        href: "/banking",
      },
      {
        id: "invoice",
        kind: "overdue_invoice",
        title: "INV-101",
        subtitle: "Jewelry House",
        eventDate: "2026-06-20",
        amountMinor: 2_500_00,
        href: "/invoices",
      },
      {
        id: "bill-overdue",
        kind: "due_bill",
        title: "BILL-104",
        subtitle: "Gold Vendor",
        eventDate: "2026-07-27",
        amountMinor: 700_00,
        href: "/bills",
      },
    ];

    const items = buildWorkQueueItems(sources, "2026-07-28");

    expect(items.map((item) => item.id)).toEqual([
      "invoice",
      "bank",
      "approval",
      "bill-overdue",
      "bill-upcoming",
    ]);
    expect(items.map(({ id, priority, timingLabel }) => ({
      id,
      priority,
      timingLabel,
    }))).toEqual([
      {
        id: "invoice",
        priority: "critical",
        timingLabel: "38 days overdue",
      },
      {
        id: "bank",
        priority: "high",
        timingLabel: "Unmatched for 10 days",
      },
      {
        id: "approval",
        priority: "high",
        timingLabel: "Waiting 3 days",
      },
      {
        id: "bill-overdue",
        priority: "high",
        timingLabel: "1 day overdue",
      },
      {
        id: "bill-upcoming",
        priority: "normal",
        timingLabel: "Due in 5 days",
      },
    ]);
  });

  it("marks same-day operational work clearly", () => {
    const items = buildWorkQueueItems(
      [
        {
          id: "bank-today",
          kind: "unreconciled_transaction",
          title: "Deposit",
          subtitle: "Checking",
          eventDate: "2026-07-28",
          amountMinor: 100,
          href: "/banking",
        },
        {
          id: "bill-today",
          kind: "due_bill",
          title: "BILL-106",
          subtitle: "Vendor",
          eventDate: "2026-07-28",
          amountMinor: 100,
          href: "/bills",
        },
        {
          id: "approval-today",
          kind: "pending_approval",
          title: "Adjustment",
          subtitle: "inventory adjustment",
          eventDate: "2026-07-28",
          amountMinor: 0,
          href: "/approvals",
        },
      ],
      "2026-07-28",
    );

    expect(items.find((item) => item.id === "bank-today")?.timingLabel).toBe(
      "New bank activity",
    );
    expect(items.find((item) => item.id === "bill-today")?.timingLabel).toBe(
      "Due today",
    );
    expect(items.find((item) => item.id === "approval-today")?.timingLabel).toBe(
      "Submitted today",
    );
  });
});
