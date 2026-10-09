import { describe, expect, it } from "vitest";
import {
  addDays,
  buildCashForecast,
  chartPoints,
  cutName,
  describeForecastBasis,
  expandRecurring,
  medianLagDays,
  monthDay,
  type OpenItem,
  type RecurringTemplateInput,
  type SettlementLagSample,
} from "@/lib/domain/forecast";

const TODAY = "2026-07-31"; // a Friday: the first week still starts on it
const BANK = "bank-account-1";
const CARD = "card-account-1";
const BANKS = new Set([BANK]);

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
  ...receivable({ documentId: "bill-1", documentNumber: "BILL-000004", partyName: "Gem Supply Co", ...over }),
  side: "payable",
});

const lag = (side: "receivable" | "payable", dueDate: string, settledOn: string): SettlementLagSample => ({
  side,
  dueDate,
  settledOn,
  amountMinor: 100_00,
});

const template = (over: Partial<RecurringTemplateInput> = {}): RecurringTemplateInput => ({
  id: "tpl-1",
  name: "Office rent",
  documentType: "bill",
  frequency: "monthly",
  intervalCount: 1,
  startDate: "2026-06-05",
  nextRunDate: "2026-08-05",
  endDate: null,
  status: "active",
  totalMinor: 2_000_00,
  payload: { due_days: 0 },
  ...over,
});

const expand = (templates: RecurringTemplateInput[], today = TODAY) =>
  expandRecurring({ templates, today, horizonEnd: addDays(today, 90), bankAccountIds: BANKS, baseCurrency: "USD" });

describe("helpers", () => {
  it("adds days across a month boundary", () => {
    expect(addDays("2026-07-31", 1)).toBe("2026-08-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("writes a month and day", () => {
    expect(monthDay("2026-10-16")).toBe("Oct 16");
    expect(monthDay("2026-01-05")).toBe("Jan 5");
  });

  it("cuts a long template name to 40 characters, ellipsis included", () => {
    expect(cutName("Office rent")).toBe("Office rent");
    const cut = cutName("A".repeat(60));
    expect(cut).toHaveLength(40);
    expect(cut.endsWith("…")).toBe(true);
    expect(cutName("B".repeat(40))).toBe("B".repeat(40));
  });
});

describe("medianLagDays", () => {
  it("takes the middle value, not the average, so one outlier cannot move it", () => {
    const samples = [
      lag("receivable", "2026-01-10", "2026-01-12"),
      lag("receivable", "2026-02-10", "2026-02-15"),
      lag("receivable", "2026-03-10", "2027-03-10"),
    ];
    expect(medianLagDays(samples)).toBe(5);
  });

  it("averages the two middle values on an even sample", () => {
    expect(
      medianLagDays([lag("receivable", "2026-01-10", "2026-01-14"), lag("receivable", "2026-02-10", "2026-02-20")]),
    ).toBe(7);
  });

  it("keeps early payment as a negative lag", () => {
    expect(medianLagDays([lag("receivable", "2026-01-10", "2026-01-05")])).toBe(-5);
  });

  it("has no answer with nothing to learn from", () => {
    expect(medianLagDays([])).toBeNull();
  });
});

describe("buildCashForecast: the weeks", () => {
  it("makes thirteen seven-day weeks starting on today, labelled This week then w/c", () => {
    const forecast = buildCashForecast({ today: TODAY, mode: "due", openingMinor: 0, openItems: [] });
    expect(forecast.weeks).toHaveLength(13);
    expect(forecast.weeks[0]).toMatchObject({ label: "This week", start: "2026-07-31", end: "2026-08-06" });
    expect(forecast.weeks[1]).toMatchObject({ label: "w/c Aug 7", start: "2026-08-07", end: "2026-08-13" });
    expect(forecast.weeks[12].end).toBe("2026-10-29");
  });

  it("puts a due date in the week it falls in, and starts cash from the opening balance", () => {
    const forecast = buildCashForecast({
      today: TODAY,
      mode: "due",
      openingMinor: 5_000_00,
      openItems: [
        receivable({ dueDate: "2026-08-06", balanceMinor: 1_000_00 }), // last day of week one
        receivable({ documentId: "inv-2", dueDate: "2026-08-07", balanceMinor: 250_00 }), // first day of week two
        payable({ dueDate: "2026-08-08", balanceMinor: 400_00 }),
      ],
    });
    expect(forecast.weeks[0].fromCustomersMinor).toBe(1_000_00);
    expect(forecast.weeks[1].fromCustomersMinor).toBe(250_00);
    expect(forecast.weeks[1].toSuppliersMinor).toBe(400_00);
    expect(forecast.weeks[0].closingMinor).toBe(6_000_00);
    expect(forecast.weeks[1].netMinor).toBe(-150_00);
    expect(forecast.weeks[1].closingMinor).toBe(5_850_00);
    expect(forecast.closingMinor).toBe(5_850_00);
    expect(forecast.dueInMinor).toBe(1_250_00);
    expect(forecast.dueOutMinor).toBe(400_00);
  });

  it("shows the lowest point only when the running balance dips under the opening cash", () => {
    const rising = buildCashForecast({
      today: TODAY,
      mode: "due",
      openingMinor: 1_000_00,
      openItems: [receivable({ balanceMinor: 500_00 })],
    });
    expect(rising.lowest).toBeNull();

    const dipping = buildCashForecast({
      today: TODAY,
      mode: "due",
      openingMinor: 1_000_00,
      openItems: [payable({ dueDate: "2026-08-12", balanceMinor: 300_00 }), receivable({ dueDate: "2026-08-20", balanceMinor: 900_00 })],
    });
    expect(dipping.lowest).toEqual({ label: "w/c Aug 7", start: "2026-08-07", minor: 700_00 });
    expect(dipping.firstBelowZero).toBeNull();
  });

  it("names the first week that ends below zero", () => {
    const forecast = buildCashForecast({
      today: TODAY,
      mode: "due",
      openingMinor: 100_00,
      openItems: [payable({ dueDate: "2026-08-12", balanceMinor: 500_00 }), payable({ documentId: "b2", dueDate: "2026-08-25", balanceMinor: 50_00 })],
    });
    expect(forecast.firstBelowZero).toEqual({ start: "2026-08-07", minor: -400_00 });
    expect(forecast.closingMinor).toBe(-450_00);
  });
});

describe("buildCashForecast: overdue, the switch and the horizon", () => {
  const settled = [
    lag("receivable", "2026-06-01", "2026-06-12"),
    lag("receivable", "2026-06-10", "2026-06-21"),
    lag("receivable", "2026-07-01", "2026-07-12"),
    lag("payable", "2026-06-01", "2026-06-04"),
  ]; // customers 11 days late, suppliers 3 days late

  it("lands overdue items in week one under both settings", () => {
    for (const mode of ["due", "usual"] as const) {
      const forecast = buildCashForecast({
        today: TODAY,
        mode,
        openingMinor: 0,
        openItems: [receivable({ dueDate: "2026-04-21", balanceMinor: 759_07 }), payable({ dueDate: "2026-07-01", balanceMinor: 120_00 })],
        lagSamples: settled,
      });
      expect(forecast.weeks[0].fromCustomersMinor, mode).toBe(759_07);
      expect(forecast.weeks[0].toSuppliersMinor, mode).toBe(120_00);
      expect(forecast.overdueInMinor).toBe(759_07);
      expect(forecast.overdueOutMinor).toBe(120_00);
    }
  });

  it("moves only the customer and supplier columns when the switch changes", () => {
    const input = {
      today: TODAY,
      openingMinor: 1_000_00,
      openItems: [receivable({ dueDate: "2026-08-05", balanceMinor: 900_00 }), payable({ dueDate: "2026-08-05", balanceMinor: 100_00 })],
      lagSamples: settled,
      recurring: expand([template({ nextRunDate: "2026-08-05" })]),
    };
    const byDue = buildCashForecast({ ...input, mode: "due" });
    const usual = buildCashForecast({ ...input, mode: "usual" });
    // 08-05 + 11 days = 08-16 → week three (starts 08-14); supplier +3 days = 08-08 → week two.
    expect(byDue.weeks[0].fromCustomersMinor).toBe(900_00);
    expect(usual.weeks[0].fromCustomersMinor).toBe(0);
    expect(usual.weeks[2].fromCustomersMinor).toBe(900_00);
    expect(byDue.weeks[0].toSuppliersMinor).toBe(100_00);
    expect(usual.weeks[1].toSuppliersMinor).toBe(100_00);
    expect(usual.weeks.map((w) => w.recurringMinor)).toEqual(byDue.weeks.map((w) => w.recurringMinor));
    expect(usual.receivableLagDays).toBe(11);
  });

  it("leaves usual-pay on the due dates when nothing has settled to learn from", () => {
    const forecast = buildCashForecast({ today: TODAY, mode: "usual", openingMinor: 0, openItems: [receivable()] });
    expect(forecast.receivableLagDays).toBeNull();
    expect(forecast.weeks[0].fromCustomersMinor).toBe(1_000_00);
  });

  it("sums items beyond the horizon apart, and inside plus beyond is every open item", () => {
    const forecast = buildCashForecast({
      today: TODAY,
      mode: "due",
      openingMinor: 0,
      openItems: [
        receivable({ dueDate: "2026-10-29", balanceMinor: 100_00 }), // last day of week thirteen
        receivable({ documentId: "inv-2", dueDate: "2026-10-30", balanceMinor: 300_00 }), // one day past
        payable({ dueDate: "2027-01-15", balanceMinor: 80_00 }),
      ],
    });
    expect(forecast.weeks[12].fromCustomersMinor).toBe(100_00);
    expect(forecast.beyondHorizonInMinor).toBe(300_00);
    expect(forecast.beyondHorizonOutMinor).toBe(80_00);
    expect(forecast.insideInMinor + forecast.beyondHorizonInMinor).toBe(forecast.totalOpenInMinor);
    expect(forecast.insideOutMinor + forecast.beyondHorizonOutMinor).toBe(forecast.totalOpenOutMinor);
    expect(forecast.totalOpenInMinor).toBe(400_00);
  });

  it("projects nothing when nothing is open", () => {
    const forecast = buildCashForecast({ today: TODAY, mode: "due", openingMinor: 42_00, openItems: [] });
    expect(forecast.weeks.every((w) => w.netMinor === 0 && w.closingMinor === 42_00)).toBe(true);
    expect(forecast.lowest).toBeNull();
  });
});

describe("expandRecurring", () => {
  it("skips run dates before today and counts the template as behind", () => {
    const result = expand([template({ nextRunDate: "2026-07-05", startDate: "2026-06-05" })]);
    // 07-05 is past; the next, 08-05, is the first counted.
    expect(result.behindCount).toBe(1);
    expect(result.occurrences.map((o) => o.date)).toEqual(["2026-08-05", "2026-09-05", "2026-10-05"]);
  });

  it("steps by frequency and interval and stops at the horizon", () => {
    const weekly = expand([template({ frequency: "weekly", intervalCount: 2, nextRunDate: "2026-08-03", startDate: "2026-08-03" })]);
    expect(weekly.occurrences.map((o) => o.date)).toEqual([
      "2026-08-03", "2026-08-17", "2026-08-31", "2026-09-14", "2026-09-28", "2026-10-12", "2026-10-26",
    ]);
    expect(weekly.behindCount).toBe(0);
  });

  it("respects end_date, inclusive", () => {
    const result = expand([template({ endDate: "2026-09-05" })]);
    expect(result.occurrences.map((o) => o.date)).toEqual(["2026-08-05", "2026-09-05"]);
  });

  it("ignores paused and ended templates", () => {
    const result = expand([template({ status: "paused" }), template({ id: "t2", status: "ended" })]);
    expect(result.occurrences).toEqual([]);
    expect(result.behindCount).toBe(0);
  });

  it("counts an invoice as money in, due days after the run date", () => {
    const result = expand([template({ documentType: "invoice", totalMinor: 700_00, nextRunDate: "2026-08-05", payload: { due_days: 30 } })]);
    expect(result.occurrences[0]).toMatchObject({ date: "2026-09-04", amountMinor: 700_00 });
    // The October run's cash date (11-04) is past the horizon, so it is left out.
    expect(result.occurrences.map((o) => o.date)).toEqual(["2026-09-04", "2026-10-05"]);
  });

  it("counts a bill as money out, the same way", () => {
    const result = expand([template({ documentType: "bill", totalMinor: 300_00, nextRunDate: "2026-08-05", payload: { due_days: 10 } })]);
    expect(result.occurrences[0]).toMatchObject({ date: "2026-08-15", amountMinor: -300_00 });
  });

  it("counts an expense paid from a bank account on the run date, and skips one paid by card", () => {
    const bank = template({ id: "e1", documentType: "expense", totalMinor: 90_00, payload: { payment_account_id: BANK } });
    const card = template({ id: "e2", documentType: "expense", totalMinor: 90_00, payload: { payment_account_id: CARD } });
    const result = expand([bank, card]);
    expect(result.occurrences.every((o) => o.templateId === "e1" && o.amountMinor === -90_00)).toBe(true);
    expect(result.occurrences[0].date).toBe("2026-08-05");
    // The card template is still behind-schedule material if its date passed, but here it is not.
    expect(result.behindCount).toBe(0);
  });

  it("reads a journal's bank lines, signed, and ignores its other lines", () => {
    const journal = template({
      documentType: "journal",
      totalMinor: 500_00,
      payload: {
        lines: [
          { account_id: BANK, debit_minor: 0, credit_minor: 500_00 },
          { account_id: "expense-1", debit_minor: 500_00, credit_minor: 0 },
        ],
      },
    });
    const received = template({
      id: "j2",
      documentType: "journal",
      payload: { lines: [{ account_id: BANK, debit_minor: 60_00, credit_minor: 0 }, { account_id: "income-1", debit_minor: 0, credit_minor: 60_00 }] },
    });
    const noBank = template({ id: "j3", documentType: "journal", payload: { lines: [{ account_id: "a", debit_minor: 5, credit_minor: 0 }, { account_id: "b", debit_minor: 0, credit_minor: 5 }] } });
    const result = expand([journal, received, noBank]);
    expect(result.occurrences.filter((o) => o.templateId === "tpl-1")[0].amountMinor).toBe(-500_00);
    expect(result.occurrences.filter((o) => o.templateId === "j2")[0].amountMinor).toBe(60_00);
    expect(result.occurrences.some((o) => o.templateId === "j3")).toBe(false);
  });

  it("leaves out a payload that names another currency, and counts it", () => {
    const result = expand([template({ payload: { due_days: 0, currency_code: "EUR" } })]);
    expect(result.occurrences).toEqual([]);
    expect(result.foreignCurrencyCount).toBe(1);
  });

  it("steps through a template years behind and counts only what is still ahead", () => {
    const result = expand([template({ frequency: "weekly", nextRunDate: "2000-01-03", startDate: "2000-01-03" })]);
    expect(result.behindCount).toBe(1);
    expect(result.occurrences.length).toBeGreaterThan(0);
    expect(result.occurrences.every((o) => o.date >= TODAY)).toBe(true);
  });

  it("gives up on a template so far behind its steps run out, rather than looping", () => {
    const result = expand([template({ frequency: "weekly", nextRunDate: "1900-01-01", startDate: "1900-01-01" })]);
    expect(result.behindCount).toBe(1);
    expect(result.occurrences).toEqual([]);
  });
});

describe("buildCashForecast: recurring in the weeks", () => {
  it("adds recurring money to its week, lists template names once, and reports the behind count", () => {
    const recurring = expand([
      template({ id: "a", name: "Office rent", totalMinor: 2_000_00, nextRunDate: "2026-08-05", endDate: "2026-08-31" }),
      template({ id: "b", name: "Retainer", documentType: "invoice", totalMinor: 800_00, nextRunDate: "2026-08-04", startDate: "2026-08-04", payload: { due_days: 0 }, endDate: "2026-08-31" }),
      template({ id: "c", name: "Old lease", nextRunDate: "2026-05-01", startDate: "2026-05-01", endDate: "2026-05-01" }),
    ]);
    const forecast = buildCashForecast({ today: TODAY, mode: "due", openingMinor: 1_000_00, openItems: [], recurring });
    expect(forecast.weeks[0].recurringInMinor).toBe(800_00);
    expect(forecast.weeks[0].recurringOutMinor).toBe(2_000_00);
    expect(forecast.weeks[0].recurringMinor).toBe(-1_200_00);
    expect(forecast.weeks[0].recurringNames).toEqual(["Retainer", "Office rent"]);
    expect(forecast.weeks[0].closingMinor).toBe(-200_00);
    expect(forecast.templatesBehind).toBe(1);
    expect(forecast.dueInMinor).toBe(800_00);
    expect(forecast.dueOutMinor).toBe(2_000_00);
  });

  it("plots cash at week end with money in and out per week", () => {
    const forecast = buildCashForecast({
      today: TODAY,
      mode: "due",
      openingMinor: 100_00,
      openItems: [receivable({ dueDate: "2026-08-10", balanceMinor: 50_00 })],
    });
    const points = chartPoints(forecast);
    expect(points).toHaveLength(13);
    expect(points[0].label).toBe("Now");
    expect(points[1]).toEqual({ label: "Aug 7", inMinor: 50_00, outMinor: 0, closingMinor: 150_00 });
  });
});

describe("describeForecastBasis", () => {
  it("says plainly when there is no history to lean on", () => {
    const forecast = buildCashForecast({ today: TODAY, mode: "usual", openingMinor: 0, openItems: [] });
    expect(describeForecastBasis(forecast)).toContain("no settled invoice");
  });

  it("quotes the lag and the sample it came from", () => {
    const forecast = buildCashForecast({
      today: TODAY,
      mode: "usual",
      openingMinor: 0,
      openItems: [],
      lagSamples: [lag("receivable", "2026-06-01", "2026-06-12"), lag("payable", "2026-06-01", "2026-05-30")],
    });
    expect(describeForecastBasis(forecast)).toContain("median 11 days late (1 paid invoices)");
    expect(describeForecastBasis(forecast)).toContain("median 2 days early (1 paid bills)");
  });
});
