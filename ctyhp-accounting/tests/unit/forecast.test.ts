import { describe, expect, it } from "vitest";
import {
  addDays,
  buildCashFlowForecast,
  describeForecastBasis,
  medianLagDays,
  weekStart,
  type OpenItem,
  type SettlementLagSample,
} from "@/lib/domain/forecast";

const AS_OF = "2026-07-31"; // a Friday

const receivable = (over: Partial<OpenItem> = {}): OpenItem => ({
  side: "receivable",
  documentId: "inv-1",
  documentNumber: "INV-000010",
  partyName: "Elena Brooks",
  dueDate: "2026-08-05",
  balanceMinor: 1_000_00,
  ...over,
});

const payable = (over: Partial<OpenItem> = {}): OpenItem => ({
  ...receivable({
    documentId: "bill-1",
    documentNumber: "BILL-000004",
    partyName: "Gem Supply Co",
    ...over,
  }),
  side: "payable",
});

const lag = (
  side: "receivable" | "payable",
  dueDate: string,
  settledOn: string,
): SettlementLagSample => ({ side, dueDate, settledOn, amountMinor: 100_00 });

describe("week helpers", () => {
  it("opens a week on Monday, whatever day it is handed", () => {
    expect(weekStart("2026-07-31")).toBe("2026-07-27"); // Friday → Monday
    expect(weekStart("2026-07-27")).toBe("2026-07-27"); // Monday stays
    expect(weekStart("2026-08-02")).toBe("2026-07-27"); // Sunday belongs to the week before
  });

  it("adds days across a month boundary", () => {
    expect(addDays("2026-07-31", 1)).toBe("2026-08-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("medianLagDays", () => {
  it("takes the middle value, not the average, so one outlier cannot move it", () => {
    const samples = [
      lag("receivable", "2026-01-10", "2026-01-12"), // 2
      lag("receivable", "2026-02-10", "2026-02-15"), // 5
      lag("receivable", "2026-03-10", "2027-03-10"), // 365
    ];
    expect(medianLagDays(samples)).toBe(5);
  });

  it("averages the two middle values on an even sample", () => {
    expect(
      medianLagDays([
        lag("receivable", "2026-01-10", "2026-01-14"), // 4
        lag("receivable", "2026-02-10", "2026-02-20"), // 10
      ]),
    ).toBe(7);
  });

  it("keeps early payment as a negative lag", () => {
    expect(medianLagDays([lag("receivable", "2026-01-10", "2026-01-05")])).toBe(-5);
  });

  it("has no answer with nothing to learn from", () => {
    expect(medianLagDays([])).toBeNull();
  });
});

describe("buildCashFlowForecast", () => {
  it("puts money in the week its due date falls in when nothing is known about lag", () => {
    const forecast = buildCashFlowForecast({
      asOf: AS_OF,
      weeks: 4,
      openItems: [receivable({ dueDate: "2026-08-05", balanceMinor: 500_00 })],
    });

    expect(forecast.buckets).toHaveLength(4);
    expect(forecast.buckets[0].weekStart).toBe("2026-07-27");
    expect(forecast.receivableLagDays).toBeNull();
    // 2026-08-05 is in the week beginning 2026-08-03 — the second bucket.
    expect(forecast.buckets[1].expectedInMinor).toBe(500_00);
    expect(forecast.buckets[1].scheduledInMinor).toBe(500_00);
    expect(forecast.buckets[0].expectedInMinor).toBe(0);
  });

  it("shifts the expected line by the observed lag, leaving the scheduled line alone", () => {
    const forecast = buildCashFlowForecast({
      asOf: AS_OF,
      weeks: 6,
      openItems: [receivable({ dueDate: "2026-08-05", balanceMinor: 900_00 })],
      // Customers settle a median 11 days late → expected 2026-08-16.
      lagSamples: [
        lag("receivable", "2026-06-01", "2026-06-12"),
        lag("receivable", "2026-06-10", "2026-06-21"),
        lag("receivable", "2026-07-01", "2026-07-12"),
      ],
    });

    expect(forecast.receivableLagDays).toBe(11);
    expect(forecast.buckets[1].scheduledInMinor).toBe(900_00);
    expect(forecast.buckets[1].expectedInMinor).toBe(0);
    // 2026-08-16 falls in the week beginning 2026-08-10 — the third bucket.
    expect(forecast.buckets[2].expectedInMinor).toBe(900_00);
  });

  it("expects overdue money now, not in the past, and marks it as overdue", () => {
    const forecast = buildCashFlowForecast({
      asOf: AS_OF,
      weeks: 3,
      openItems: [receivable({ dueDate: "2026-04-21", balanceMinor: 759_07 })],
    });
    expect(forecast.buckets[0].expectedInMinor).toBe(759_07);
    expect(forecast.buckets[0].overdueInMinor).toBe(759_07);
  });

  it("nets payables against receivables and carries a running total", () => {
    const forecast = buildCashFlowForecast({
      asOf: AS_OF,
      weeks: 3,
      openItems: [
        receivable({ dueDate: "2026-08-05", balanceMinor: 1_000_00 }),
        payable({ dueDate: "2026-08-06", balanceMinor: 400_00 }),
        receivable({ documentId: "inv-2", dueDate: "2026-08-12", balanceMinor: 250_00 }),
      ],
    });

    expect(forecast.buckets[1].expectedInMinor).toBe(1_000_00);
    expect(forecast.buckets[1].expectedOutMinor).toBe(400_00);
    expect(forecast.buckets[1].expectedNetMinor).toBe(600_00);
    expect(forecast.buckets[2].expectedNetMinor).toBe(250_00);
    expect(forecast.buckets[2].cumulativeMinor).toBe(850_00);
    expect(forecast.totalOpenInMinor).toBe(1_250_00);
    expect(forecast.totalOpenOutMinor).toBe(400_00);
  });

  it("reports money expected past the horizon separately instead of cramming it into the last week", () => {
    const forecast = buildCashFlowForecast({
      asOf: AS_OF,
      weeks: 2,
      openItems: [receivable({ dueDate: "2027-01-15", balanceMinor: 300_00 })],
    });
    expect(forecast.beyondHorizonInMinor).toBe(300_00);
    expect(forecast.buckets.every((bucket) => bucket.expectedInMinor === 0)).toBe(true);
  });

  it("projects nothing when nothing is open", () => {
    const forecast = buildCashFlowForecast({ asOf: AS_OF, weeks: 13, openItems: [] });
    expect(forecast.buckets).toHaveLength(13);
    expect(forecast.buckets.every((bucket) => bucket.expectedNetMinor === 0)).toBe(true);
    expect(forecast.totalOpenInMinor).toBe(0);
  });
});

describe("describeForecastBasis", () => {
  it("says plainly when there is no history to lean on", () => {
    const forecast = buildCashFlowForecast({ asOf: AS_OF, openItems: [] });
    expect(describeForecastBasis(forecast)).toContain("no settled invoice");
  });

  it("quotes the lag and the sample it came from", () => {
    const forecast = buildCashFlowForecast({
      asOf: AS_OF,
      openItems: [],
      lagSamples: [
        lag("receivable", "2026-06-01", "2026-06-12"),
        lag("payable", "2026-06-01", "2026-05-30"),
      ],
    });
    expect(describeForecastBasis(forecast)).toContain("median 11 days late (1 paid invoices)");
    expect(describeForecastBasis(forecast)).toContain("median -2 days early (1 paid bills)");
  });
});
