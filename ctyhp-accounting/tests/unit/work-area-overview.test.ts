import { describe, expect, it } from "vitest";
import {
  monthStart,
  overdueAmount,
  trailingMonthWindows,
  within,
} from "@/lib/domain/work-area-overview";

describe("work area overview date windows", () => {
  it("builds chronological month windows across a year boundary", () => {
    expect(trailingMonthWindows("2026-02-12", 4)).toEqual([
      {
        key: "2025-11",
        label: "Nov",
        from: "2025-11-01",
        to: "2025-11-30",
      },
      {
        key: "2025-12",
        label: "Dec",
        from: "2025-12-01",
        to: "2025-12-31",
      },
      {
        key: "2026-01",
        label: "Jan",
        from: "2026-01-01",
        to: "2026-01-31",
      },
      {
        key: "2026-02",
        label: "Feb",
        from: "2026-02-01",
        to: "2026-02-12",
      },
    ]);
  });

  it("uses inclusive boundaries for operational activity", () => {
    expect(monthStart("2026-07-28")).toBe("2026-07-01");
    expect(within("2026-07-01", "2026-07-01", "2026-07-28")).toBe(true);
    expect(within("2026-07-28", "2026-07-01", "2026-07-28")).toBe(true);
    expect(within("2026-07-29", "2026-07-01", "2026-07-28")).toBe(false);
  });
});

describe("work area overview ageing", () => {
  it("excludes the current bucket from overdue balances", () => {
    expect(
      overdueAmount({
        current: 12_500,
        "1-30": 4_000,
        "31-60": 2_500,
        "61-90": 1_000,
        "90+": 500,
      }),
    ).toBe(8_000);
  });
});
