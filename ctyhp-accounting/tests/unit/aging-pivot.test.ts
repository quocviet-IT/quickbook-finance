import { describe, expect, it } from "vitest";
import { pivotAgingByParty } from "@/lib/domain/aging";

const row = (
  entityName: string,
  bucket: string,
  balanceMinor: number,
  dueDate = "2026-06-01",
  entityId = entityName,
) => ({ entityId, entityName, bucket, dueDate, balanceMinor });

describe("pivotAgingByParty", () => {
  it("puts one line per party with a column per bucket", () => {
    const pivot = pivotAgingByParty([
      row("Gemstone Partners", "current", 500_00, "2026-08-15"),
      row("Gemstone Partners", "d31_60", 200_00, "2026-06-10"),
      row("Metal Supply Co", "d1_30", 150_00, "2026-07-15"),
    ]);

    expect(pivot.rows).toHaveLength(2);
    const gemstone = pivot.rows.find((r) => r.entityName === "Gemstone Partners")!;
    expect(gemstone.buckets.current).toBe(500_00);
    expect(gemstone.buckets.d31_60).toBe(200_00);
    expect(gemstone.buckets.d61_90).toBe(0);
    expect(gemstone.totalMinor).toBe(700_00);
  });

  it("counts everything outside Current as overdue, and names the oldest due date", () => {
    const pivot = pivotAgingByParty([
      row("Gemstone Partners", "current", 500_00, "2026-08-15"),
      row("Gemstone Partners", "d31_60", 200_00, "2026-06-10"),
      row("Gemstone Partners", "d90_plus", 100_00, "2026-02-01"),
    ]);
    const gemstone = pivot.rows[0];
    expect(gemstone.overdueMinor).toBe(300_00);
    expect(gemstone.oldestDueDate).toBe("2026-02-01");
  });

  it("leaves oldestDueDate null for a party with nothing late", () => {
    const pivot = pivotAgingByParty([row("Metal Supply Co", "current", 90_00)]);
    expect(pivot.rows[0].overdueMinor).toBe(0);
    expect(pivot.rows[0].oldestDueDate).toBeNull();
  });

  it("orders the accounts that need a call first", () => {
    const pivot = pivotAgingByParty([
      row("No trouble", "current", 900_00),
      row("Slightly late", "d1_30", 100_00),
      row("Very late", "d90_plus", 400_00),
    ]);
    expect(pivot.rows.map((r) => r.entityName)).toEqual([
      "Very late",
      "Slightly late",
      "No trouble",
    ]);
  });

  it("falls back to total, then to name, when overdue amounts tie", () => {
    const pivot = pivotAgingByParty([
      row("Beta", "current", 100_00),
      row("Alpha", "current", 100_00),
      row("Gamma", "current", 300_00),
    ]);
    expect(pivot.rows.map((r) => r.entityName)).toEqual(["Gamma", "Alpha", "Beta"]);
  });

  it("totals every column and the report as a whole", () => {
    const pivot = pivotAgingByParty([
      row("A", "current", 100_00),
      row("B", "current", 250_00),
      row("B", "d61_90", 75_00),
    ]);
    expect(pivot.bucketTotals.current).toBe(350_00);
    expect(pivot.bucketTotals.d61_90).toBe(75_00);
    expect(pivot.totalMinor).toBe(425_00);
    expect(pivot.overdueMinor).toBe(75_00);
  });

  it("keeps a credit on account as a negative rather than dropping it", () => {
    const pivot = pivotAgingByParty([
      row("Elena Brooks", "current", 500_00),
      row("Elena Brooks", "current", -120_00),
    ]);
    expect(pivot.rows[0].buckets.current).toBe(380_00);
    expect(pivot.totalMinor).toBe(380_00);
  });

  it("keeps two parties apart even when they share a name", () => {
    const pivot = pivotAgingByParty([
      { ...row("Sophia", "current", 100_00), entityId: "one" },
      { ...row("Sophia", "current", 200_00), entityId: "two" },
    ]);
    expect(pivot.rows).toHaveLength(2);
  });

  it("reports nothing for an empty aging run", () => {
    const pivot = pivotAgingByParty([]);
    expect(pivot.rows).toEqual([]);
    expect(pivot.totalMinor).toBe(0);
    expect(pivot.bucketTotals.current).toBe(0);
  });
});
