import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/services/access", () => ({
  searchAudit: vi.fn(),
}));

import {
  comparablePreviousMonthRange,
  describeAuditActivity,
  percentChange,
  trailingMonthRanges,
} from "@/lib/services/dashboard";
import type { AuditEntryRow } from "@/lib/db/types";

describe("dashboard analytics", () => {
  it("builds six complete month ranges ending with the current month to date", () => {
    expect(trailingMonthRanges("2026-07-25")).toEqual([
      { key: "2026-02", label: "Feb", from: "2026-02-01", to: "2026-02-28" },
      { key: "2026-03", label: "Mar", from: "2026-03-01", to: "2026-03-31" },
      { key: "2026-04", label: "Apr", from: "2026-04-01", to: "2026-04-30" },
      { key: "2026-05", label: "May", from: "2026-05-01", to: "2026-05-31" },
      { key: "2026-06", label: "Jun", from: "2026-06-01", to: "2026-06-30" },
      { key: "2026-07", label: "Jul", from: "2026-07-01", to: "2026-07-25" },
    ]);
  });

  it("compares month to date with the same available days in the prior month", () => {
    expect(comparablePreviousMonthRange("2026-07-25")).toEqual({
      key: "2026-06",
      label: "Jun",
      from: "2026-06-01",
      to: "2026-06-25",
    });
    expect(comparablePreviousMonthRange("2026-03-31")).toEqual({
      key: "2026-02",
      label: "Feb",
      from: "2026-02-01",
      to: "2026-02-28",
    });
  });

  it("calculates signed change without inventing a zero baseline", () => {
    expect(percentChange(125, 100)).toBe(25);
    expect(percentChange(75, 100)).toBe(-25);
    expect(percentChange(100, 0)).toBeNull();
  });

  it("turns an audit record into a safe drill-down activity", () => {
    const row: AuditEntryRow = {
      id: "audit-1",
      table_name: "acc_purchase_order",
      record_id: "po-1",
      action: "update",
      actor_id: "user-1",
      actor_email: "buyer@example.com",
      before_json: { po_number: "PO-1001", internal_note: "not displayed" },
      after_json: { po_number: "PO-1001", total_minor: 325000 },
      created_at: "2026-07-25T03:00:00.000Z",
    };

    expect(describeAuditActivity(row)).toEqual({
      id: "audit-1",
      occurredAt: "2026-07-25T03:00:00.000Z",
      actor: "buyer@example.com",
      verb: "Updated",
      entity: "Purchase order",
      reference: "PO-1001",
      href: "/purchase-orders/po-1",
      category: "purchases",
    });
  });

  it("falls back to the audit log for an unknown entity", () => {
    const activity = describeAuditActivity({
      id: "audit-2",
      table_name: "acc_custom_record",
      record_id: null,
      action: "archive",
      actor_id: null,
      actor_email: null,
      before_json: null,
      after_json: null,
      created_at: "2026-07-25T03:00:00.000Z",
    });

    expect(activity).toMatchObject({
      actor: "System",
      verb: "archive",
      entity: "custom record",
      reference: null,
      href: "/settings/audit",
      category: "other",
    });
  });
});
